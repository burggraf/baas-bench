import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { runWorkflow, selectWorkflow } from './workflows.mjs';
import { WORKFLOW_WEIGHTS, WARMUP, prepareUserContexts, runWarmup } from './warmup.mjs';
import { assertConformance, runStageFromBaseline } from './conformance.mjs';
import { closeNativeSessions } from './native-conformance.mjs';
import { StageMetricsAccumulator } from './metrics.mjs';
import { startProcessTelemetry } from './telemetry.mjs';
import { withRemoteMeasurement } from './measurement.mjs';
import { isIntegrityError, isSessionLossError } from './errors.mjs';

const wait = (ms, signal) => sleep(ms, undefined, { signal });
export function stageDurationMs(users) {
  if (!Number.isSafeInteger(users) || users < 1 || users > 10000) throw new Error('invalid stage user count');
  return Math.ceil(300000 * Math.max(1, 5 / users));
}

// Prepared sessions/cursors belong to the caller. No setup, reset or cleanup is timed here.
// This kernel alone is not admission evidence or a qualified measurement profile.
export async function runTimedWindow(contexts, { durationMs, onSample, onBoundary = async () => {}, signal, startAt,
  now = () => performance.now(), wallNow = Date.now, graceMs = WARMUP.timeoutMs } = {}) {
  if (!Array.isArray(contexts) || !contexts.length || Array.from(contexts).some(context => !context?.session || typeof context.random !== 'function')) throw new Error('incomplete measured cohort');
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(graceMs) || graceMs < 0 || graceMs > WARMUP.timeoutMs || typeof onSample !== 'function' || typeof onBoundary !== 'function') throw new Error('invalid timed-window configuration');
  if (startAt !== undefined && (!Number.isSafeInteger(startAt) || wallNow() - startAt > 100)) throw new Error('stage start alignment exceeded');
  if (signal?.aborted) throw new Error('stage cancelled');
  const scheduling = new AbortController(), requests = new AbortController();
  const result = { requestedUsers: contexts.length, startedUsers: 0, lostUsers: 0, completedWorkflowCount: 0, failedWorkflowCount: 0,
    stageFailed: false, graceExpired: false, unfinishedWork: false, failureReasons: [], nominalDurationMs: durationMs, sampleCount: 0 };
  let measuring = false, workersDone, started;
  const fail = reason => { result.stageFailed = true; if (!result.failureReasons.includes(reason)) result.failureReasons.push(reason); scheduling.abort(); };
  const cancel = () => {
    requests.abort();
    for (const context of contexts) { try { context.session?.cancelPending(); } catch { fail('request_cancellation'); } }
  };
  const parentAbort = () => { fail('parent_cancelled'); cancel(); };
  signal?.addEventListener('abort', parentAbort, { once: true });
  const emit = sample => {
    if (!measuring) return;
    try { onSample(sample); result.sampleCount++; }
    catch (error) { fail('sample_delivery'); cancel(); throw error; }
  };
  const originals = contexts.map(context => ({ invoke: context.invoke, sample: context.sample, replaceSession: context.replaceSession, signal: context.signal, redactValues: context.redactValues }));
  for (const context of contexts) {
    context.redactValues = [...(context.redactValues ?? []), context.credentials?.password, context.credentials?.email].filter(value => typeof value === 'string');
    const remote = (name, operationClass, kind, action) => withRemoteMeasurement({ name, workflow: context.workflow, operationClass, kind, now, sample: emit,
      redactValues: context.redactValues }, action);
    context.sample = emit;
    context.invoke = (name, operationClass, kind, action) => remote(name, operationClass, kind, action);
    const replace = context.replaceSession;
    context.replaceSession = () => remote('createSession', 'authSearch', 'read', () => replace.call(context));
    context.signal = requests.signal;
  }
  try {
    if (startAt !== undefined && startAt > wallNow()) await wait(startAt - wallNow(), signal);
    if (signal?.aborted) throw new Error('stage cancelled');
    if (startAt !== undefined && wallNow() - startAt > 100) throw new Error('stage start alignment exceeded');
    await onBoundary('start', { startAt: startAt ?? wallNow(), durationMs });
    if (startAt !== undefined && wallNow() - startAt > 100) throw new Error('stage start alignment exceeded');
    started = now(); measuring = true;
    const deadline = started + durationMs;
    workersDone = Promise.all(contexts.map(async context => {
      result.startedUsers++;
      while (!scheduling.signal.aborted && now() < deadline) {
        try {
          await runWorkflow(selectWorkflow(WORKFLOW_WEIGHTS, context.random), context);
          result.completedWorkflowCount++;
        } catch (error) {
          result.failedWorkflowCount++;
          if (isIntegrityError(error)) { fail('integrity_error'); break; }
          if (isSessionLossError(error, context.workflow)) { result.lostUsers++; break; }
          if (scheduling.signal.aborted) break;
        }
        const remaining = deadline - now();
        if (remaining > 0 && !scheduling.signal.aborted) {
          try {
            const think = 1000 + Math.floor(context.random() * 4001);
            await wait(Math.min(remaining, think), scheduling.signal);
            if (think >= remaining) break;
          } catch {
            if (!scheduling.signal.aborted) fail('think_timer');
            break;
          }
        }
      }
    }).map(worker => worker.catch(() => { fail('worker_exception'); cancel(); })));
    const durationTimer = wait(durationMs, scheduling.signal).catch(() => {});
    // Retired users must not shorten the denominator of an otherwise scored stage.
    await durationTimer;
    scheduling.abort();
    const drain = new AbortController();
    let settled = false;
    await Promise.race([workersDone.then(() => { settled = true; }), wait(graceMs, drain.signal)]);
    drain.abort();
    if (!settled) {
      result.graceExpired = true; fail('grace_deadline'); cancel();
      const finalDrain = new AbortController();
      await Promise.race([workersDone.then(() => { settled = true; }), wait(WARMUP.timeoutMs, finalDrain.signal)]);
      finalDrain.abort();
      if (!settled) { result.unfinishedWork = true; fail('unfinished_work'); }
    }
    measuring = false;
    result.elapsedMs = Math.max(0, now() - started);
    await onBoundary('end', result);
  } catch (error) {
    fail('measurement_boundary'); cancel();
    if (started === undefined) throw error;
  } finally {
    measuring = false; scheduling.abort();
    signal?.removeEventListener('abort', parentAbort);
    contexts.forEach((context, index) => Object.assign(context, originals[index]));
  }
  return result;
}

// Framework candidate only. Production hooks/CLI remain blocked until native and
// multicore/telemetry evidence is reviewed at a frozen revision.
export async function runTimedStageFromBaseline({ conformance, backend, users, requestedUsers, reset, verifyBaseline,
  warmUp = runWarmup, durationMs = stageDurationMs(requestedUsers), onSample = () => {}, signal }) {
  assertConformance(conformance);
  if (!Number.isSafeInteger(requestedUsers) || requestedUsers < 1 || requestedUsers > 10000 || !Array.isArray(users) || users.length !== Math.max(requestedUsers, WARMUP.users) || typeof warmUp !== 'function' || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error('invalid measured-stage profile');
  const contexts = [];
  const accumulator = new StageMetricsAccumulator({ maxLatencySamples: 5000000 });
  let failure, telemetry, processTelemetry;
  try {
    return await runStageFromBaseline({ conformance, reset, verifyBaseline, stage: requestedUsers,
      prepareSessions: () => prepareUserContexts(backend, users, contexts, { concurrency: 1, signal }),
      warmUp: async () => (await warmUp(contexts.slice(0, WARMUP.users))).passed === true,
      async measure() {
        const workload = await runTimedWindow(contexts.slice(0, requestedUsers), { durationMs, signal,
          onSample(sample) { accumulator.record(sample); onSample(sample); },
          async onBoundary(phase, info) {
            if (phase === 'start') telemetry = await startProcessTelemetry({ startAt: info.startAt, signal });
            else processTelemetry = telemetry.stop();
          } });
        if (!(workload.elapsedMs > 0)) throw new Error('timing boundary unavailable');
        const metrics = accumulator.finalize(workload.elapsedMs / 1000, { requestedUsers, achievedUsers: workload.startedUsers - workload.lostUsers });
        // Accumulator validity is not whole-stage validity: missing telemetry is unknown, not pass.
        metrics.valid = false;
        metrics.validityReasons.push(...workload.failureReasons, 'multicore/telemetry qualification pending');
        return { workload, metrics, process_telemetry: processTelemetry, admission_evidence: false, measurement_qualified: false,
          profile_duration_matches: durationMs === stageDurationMs(requestedUsers) };
      },
    });
  } catch (error) { failure = error; throw error; }
  finally { telemetry?.stop(); await closeNativeSessions(contexts.map(context => context?.session), failure); }
}
