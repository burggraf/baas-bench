import { mulberry32 } from "./random.mjs";
import { MAX_PAGE_SIZE, runWorkflow, selectWorkflow } from "./workflows.mjs";
import { isIntegrityError, isSessionLossError } from "./errors.mjs";
import { withRemoteMeasurement } from "./measurement.mjs";
export const SESSION_PREPARATION_CONCURRENCY = 10;
const defaultNow = () => performance.now();
const defaultSleep = (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(abortError());
        return;
    }
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.max(0, milliseconds));
    signal?.addEventListener("abort", abort, { once: true });
});
const abortError = () => Object.assign(new Error("Workload aborted"), { name: "AbortError" });
const isAbort = (error) => error instanceof Error && error.name === "AbortError";
const deriveSeed = (seed, index) => (seed + Math.imul(index, 0x9e3779b9)) >>> 0;
const emit = (callback, sample, enabled) => {
    if (enabled)
        callback?.({ ...sample, elapsedMs: Math.max(0, sample.elapsedMs), error: sample.error && { ...sample.error } });
};
const credentialKeys = new Set(["method", "email", "password"]);
const validCredentials = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !credentialKeys.has(key)))
        return false;
    const credentials = value;
    if (credentials.method !== undefined && credentials.method !== "password")
        return false;
    if (typeof credentials.email !== "string" || credentials.email.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,253}$/.test(credentials.email))
        return false;
    return typeof credentials.password === "string" && credentials.password.length > 0 && credentials.password.length <= 1024;
};
export async function runWorkload(backend, config, options) {
    const now = options.now ?? defaultNow;
    const sleep = options.sleep ?? defaultSleep;
    if (!Array.isArray(options.users))
        throw new TypeError("users must be an array");
    if (options.users.some(user => !user || !validCredentials(user.credentials) || !user.organizationId || !user.projectId || !user.taskId))
        throw new TypeError("each virtual user requires valid password credentials and tenant/project/task context");
    const redactValues = options.users.map(user => user.credentials.password);
    const durationMs = options.durationMs ?? config.stageSeconds * 1000;
    const graceMs = options.graceMs ?? Math.max(0, config.timeoutMs);
    if (!Number.isFinite(durationMs) || durationMs < 0 || !Number.isFinite(graceMs) || graceMs < 0)
        throw new RangeError("invalid workload duration or grace");
    const loopController = new AbortController();
    const requestController = new AbortController();
    const summary = { requestedUsers: options.users.length, startedUsers: 0, completedWorkflowCount: 0, failedWorkflowCount: 0, lostUsers: 0, graceExpired: false, stageFailed: false, closeErrors: 0, preparationFailed: false, preparationFailureCount: 0 };
    const active = new Set();
    let requestsCancelled = false;
    const stopScheduling = () => { if (!loopController.signal.aborted)
        loopController.abort(); };
    const cancelPending = () => {
        if (requestsCancelled)
            return;
        requestsCancelled = true;
        requestController.abort();
        for (const session of active)
            session.cancelPending();
    };
    const abortWorkload = () => { stopScheduling(); cancelPending(); };
    let boundaryClosing = false;
    const stopFromParent = () => { if (boundaryClosing)
        return; summary.stageFailed = true; abortWorkload(); };
    if (options.signal?.aborted) {
        summary.stageFailed = true;
        abortWorkload();
    }
    else
        options.signal?.addEventListener("abort", stopFromParent, { once: true });
    const closed = new WeakSet();
    let cleanupStarted = false;
    let measuring = false;
    const call = (workflow, operation, operationClass, kind, action, emitEnabled = measuring) => {
        if (!emitEnabled || !options.onSample)
            return action();
        return withRemoteMeasurement({ name: operation, workflow, kind, operationClass, now, sample: sample => emit(options.onSample, sample, true), redactValues }, action);
    };
    const closeSession = async (session, throwError = false, measured = false) => {
        if (closed.has(session))
            return;
        try {
            await call("signOutIn", "close", "authSearch", "read", () => session.close(), measured);
            closed.add(session);
        }
        catch (error) {
            if (throwError)
                throw error;
        }
    };
    const closeAll = async () => {
        for (let attempt = 0; attempt < 2 && active.size; attempt++) {
            const batch = [...active];
            for (let offset = 0; offset < batch.length; offset += SESSION_PREPARATION_CONCURRENCY) {
                await Promise.allSettled(batch.slice(offset, offset + SESSION_PREPARATION_CONCURRENCY).map(session => closeSession(session)));
            }
            for (const session of batch)
                if (closed.has(session))
                    active.delete(session);
        }
        const unresolved = [...active].filter(session => !closed.has(session)).length;
        summary.closeErrors = unresolved;
        if (unresolved > 0)
            summary.stageFailed = true;
    };
    const awaitWorkersAfterDrainDeadline = async (workersDone) => {
        let settled = false;
        const drainController = new AbortController();
        await Promise.race([
            workersDone.then(() => { settled = true; }),
            sleep(config.timeoutMs, drainController.signal).catch(() => undefined),
        ]);
        drainController.abort();
        if (!settled) {
            summary.graceExpired = true;
            summary.stageFailed = true;
            abortWorkload();
        }
        await workersDone;
    };
    const create = async (spec, workflow = "signOutIn", measured = false) => {
        const session = await call(workflow, "createSession", "authSearch", "read", () => backend.createSession(spec.credentials, { signal: requestController.signal, timeoutMs: config.timeoutMs }), measuring && measured);
        if (cleanupStarted) {
            active.add(session);
            await closeSession(session, false, false);
            throw abortError();
        }
        return session;
    };
    const prepareSessions = async () => {
        if (requestController.signal.aborted) {
            summary.preparationFailed = true;
            summary.preparationFailureCount = options.users.length;
            summary.stageFailed = true;
            return false;
        }
        for (let offset = 0; offset < options.users.length; offset += SESSION_PREPARATION_CONCURRENCY) {
            if (requestController.signal.aborted) {
                summary.preparationFailed = true;
                summary.preparationFailureCount = options.users.length - offset;
                summary.stageFailed = true;
                return false;
            }
            const batch = options.users.slice(offset, offset + SESSION_PREPARATION_CONCURRENCY);
            const settled = await Promise.allSettled(batch.map(spec => create(spec)));
            let failures = 0;
            for (const result of settled) {
                if (result.status === "fulfilled")
                    active.add(result.value);
                else
                    failures++;
            }
            if (failures || requestController.signal.aborted) {
                summary.preparationFailed = true;
                summary.preparationFailureCount = failures + (requestController.signal.aborted ? 1 : 0);
                summary.stageFailed = true;
                return false;
            }
        }
        summary.startedUsers = options.users.length;
        return true;
    };
    const users = options.users.map((spec, index) => ({ spec, random: mulberry32(deriveSeed(config.seed, index)) }));
    const runUser = async (spec, random, initial, deadline) => {
        let session = initial;
        let retired = false;
        const context = {
            get session() { if (!session)
                throw new Error("virtual user has no session"); return session; },
            set session(value) { session = value; },
            workflow: "dashboard",
            replaceSession: async () => {
                if (session) {
                    const old = session;
                    try {
                        await closeSession(old, true, true);
                    }
                    finally {
                        session = undefined;
                    }
                    if (closed.has(old))
                        active.delete(old);
                }
                session = await create(spec, "signOutIn", true);
                active.add(session);
            },
            organizationId: spec.organizationId,
            projectId: spec.projectId,
            taskId: spec.taskId,
            commentId: spec.commentId,
            random,
            pageSize: () => Math.min(MAX_PAGE_SIZE, 1 + Math.floor(random() * 25)),
            now,
            invoke: (operation, operationClass, kind, action) => call(context.workflow, operation, operationClass, kind, action),
            sample: sample => emit(options.onSample, sample, measuring),
            redactValues,
        };
        while (!loopController.signal.aborted && now() < deadline) {
            const configured = runWorkflow(selectForUser(config, random), context);
            try {
                await configured;
                summary.completedWorkflowCount++;
            }
            catch (error) {
                summary.failedWorkflowCount++;
                if (isIntegrityError(error) || options.stopOnError) {
                    summary.stageFailed = true;
                    abortWorkload();
                    break;
                }
                if (isSessionLossError(error, context.workflow)) {
                    if (!retired) {
                        retired = true;
                        summary.lostUsers++;
                    }
                    break;
                }
                if (isAbort(error) || loopController.signal.aborted)
                    break;
            }
            if (loopController.signal.aborted || now() >= deadline)
                break;
            const think = config.thinkTimeMs.min + Math.floor(random() * (config.thinkTimeMs.max - config.thinkTimeMs.min + 1));
            try {
                await sleep(think, loopController.signal);
            }
            catch (error) {
                if (!isAbort(error))
                    summary.stageFailed = true;
                break;
            }
        }
    };
    const prepared = await prepareSessions();
    if (!prepared) {
        cleanupStarted = true;
        await closeAll();
        options.signal?.removeEventListener("abort", stopFromParent);
        return summary;
    }
    if (users.length === 0) {
        options.signal?.removeEventListener("abort", stopFromParent);
        return summary;
    }
    let measuredEnded = false;
    let measurementStarted = false;
    let allWorkers;
    try {
        await options.onMeasuredStart?.();
        measurementStarted = true;
        measuring = true;
        const deadline = now() + durationMs;
        const workers = users.map(({ spec, random }, index) => runUser(spec, random, [...active][index], deadline).catch(error => { summary.stageFailed = true; if (!isAbort(error))
            summary.failedWorkflowCount++; }));
        allWorkers = Promise.all(workers).then(() => undefined);
        const workersDone = allWorkers;
        const stopperController = new AbortController();
        const stopper = (async () => { await Promise.resolve(); await sleep(durationMs, stopperController.signal); stopScheduling(); })().catch(() => { });
        await Promise.race([workersDone, stopper]);
        stopperController.abort();
        stopScheduling();
        let settled = false;
        const graceController = new AbortController();
        await Promise.race([workersDone.then(() => { settled = true; }), sleep(graceMs, graceController.signal).catch(() => { })]);
        graceController.abort();
        if (!settled) {
            summary.graceExpired = true;
            summary.stageFailed = true;
            cancelPending();
        }
        if (!settled)
            await awaitWorkersAfterDrainDeadline(workersDone);
        else
            await workersDone;
        measuring = false;
        measuredEnded = true;
        boundaryClosing = true;
        await options.onMeasuredEnd?.();
    }
    catch (error) {
        summary.stageFailed = true;
        if (!isAbort(error))
            summary.failedWorkflowCount++;
        abortWorkload();
        // Do not end measurement or close sessions while a worker can still issue backend operations.
        if (allWorkers)
            await awaitWorkersAfterDrainDeadline(allWorkers);
        measuring = false;
        if (measurementStarted && !measuredEnded) {
            boundaryClosing = true;
            measuredEnded = true;
            try {
                await options.onMeasuredEnd?.();
            }
            catch {
                summary.stageFailed = true;
            }
        }
    }
    finally {
        cleanupStarted = true;
        measuring = false;
        await closeAll();
        options.signal?.removeEventListener("abort", stopFromParent);
    }
    return summary;
}
const selectForUser = (config, random) => selectWorkflow(config.weights, random);
export const runStage = runWorkload;
