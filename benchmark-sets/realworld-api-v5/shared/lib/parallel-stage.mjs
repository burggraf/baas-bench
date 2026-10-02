import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertConformance, runStageFromBaseline, runBaselinePhases } from './conformance.mjs';
import { WARMUP, WORKFLOW_WEIGHTS } from './warmup.mjs';
import { stageDurationMs } from './timed-stage.mjs';
import { StageMetricsAccumulator } from './metrics.mjs';
import { startProcessTelemetry, validateRunnerTelemetry } from './telemetry.mjs';
import { validateBackendTelemetry, validateBackendOwnership } from './backend-telemetry.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
};

// Candidate framework. Backend host/container and reviewed admission are still required.
export async function runParallelStageFromBaseline(options) {
  assertConformance(options.conformance);
  return runParallelPhases(options, true);
}

// Explicit diagnostic entry point: no manufactured conformance finding or admission.
export async function runParallelLifecycleDiagnostic(options) {
  if (options.diagnostic !== true) throw new Error('explicit diagnostic mode required');
  return runParallelPhases(options, false);
}

async function runParallelPhases({ conformance, reset, verifyBaseline, users, requestedUsers, backendModule, backendOptions = {},
  durationMs = stageDurationMs(requestedUsers), warmupMs = WARMUP.durationMs, startDelayMs = 1500, diagnostic = false, signal, onSample = () => {}, backendTelemetryFactory, backendOwnership, onWarmupComplete = () => {} }, guarded) {
  if (signal?.aborted) throw new Error('parallel stage cancelled');
  const count = Math.max(requestedUsers, WARMUP.users);
  if (!Number.isSafeInteger(requestedUsers) || requestedUsers < 1 || requestedUsers > 10000 || !Array.isArray(users) || users.length !== count || typeof backendModule !== 'string' || !backendModule.startsWith('file:') || !Number.isSafeInteger(durationMs) || durationMs < 1 || !Number.isSafeInteger(warmupMs) || warmupMs < 1 || !Number.isSafeInteger(startDelayMs) || startDelayMs < 25 || startDelayMs > 10000 || typeof onSample !== 'function') throw new Error('invalid parallel stage');
  if (!diagnostic && (durationMs !== stageDurationMs(requestedUsers) || warmupMs !== WARMUP.durationMs || startDelayMs !== 1500)) throw new Error('non-profile durations require diagnostic mode');
  if (typeof onWarmupComplete !== 'function') throw new Error('invalid warm-up observation hook');
  if (backendTelemetryFactory !== undefined && (typeof backendTelemetryFactory !== 'function' || !backendOwnership)) throw new Error('backend telemetry ownership required');
  if (backendTelemetryFactory) validateBackendOwnership(backendOwnership.containerIds, backendOwnership.project);
  const workers = [], failure = deferred(), accumulator = new StageMetricsAccumulator({ maxLatencySamples: 5000000 });
  const barrier = promise => Promise.race([promise, failure.promise]);
  const send = (worker, message) => new Promise((resolve, reject) => worker.child.send(message, error => error ? reject(error) : resolve()));
  const telemetryAbort = new AbortController();
  const abort = () => { telemetryAbort.abort(); failure.reject(new Error('parallel stage cancelled')); };
  const timer = setTimeout(() => failure.reject(new Error('parallel stage deadline')), durationMs + warmupMs + 900000);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  let coordinator, backendSampler, primaryFailure;
  try {
    const runPhases = guarded ? runStageFromBaseline : hooks => runBaselinePhases({ ...hooks, enterStage: hooks.measure });
    return await runPhases({ conformance, reset, verifyBaseline, stage: requestedUsers, signal,
      async prepareSessions() {
        for (let index = 0; index < 3; index++) {
          const offset = Math.floor(index * count / 3), end = Math.floor((index + 1) * count / 3);
          const env = {};
          for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']) if (process.env[key] !== undefined) env[key] = process.env[key];
          const child = fork(fileURLToPath(new URL('./stage-worker.mjs', import.meta.url)), [], { env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' });
          const worker = { child, ready: deferred(), warmed: deferred(), ended: deferred(), result: deferred(), exited: deferred(), sampleCount: 0, state: 'preparation' };
          workers.push(worker);
          child.on('error', () => failure.reject(new Error('workload process error')));
          child.on('close', (code, killed) => { worker.exited.resolve(); if (code !== 0 || killed || worker.state !== 'complete') failure.reject(new Error('workload process exited without complete evidence')); });
          child.on('message', message => {
            try {
              if (message?.type === 'ready' && worker.state === 'preparation' && Number.isSafeInteger(message.pid) && message.pid === child.pid) { worker.pid = message.pid; worker.state = 'ready'; worker.ready.resolve(message); }
              else if (message?.type === 'warmed' && worker.state === 'warming') { worker.state = 'warmed'; worker.warmed.resolve(message); }
              else if (message?.type === 'samples' && worker.state === 'measuring' && Array.isArray(message.samples) && message.samples.length > 0 && message.samples.length <= 256) {
                for (const sample of message.samples) { accumulator.record(sample); onSample(sample); worker.sampleCount++; }
              } else if (message?.type === 'ended' && worker.state === 'measuring' && message.sampleCount === worker.sampleCount && message.result?.stageFailed === false) { worker.state = 'ended'; worker.ended.resolve(message); }
              else if (message?.type === 'result' && worker.state === 'cleanup' && message.sampleCount === worker.sampleCount && message.resources?.pid === worker.pid) { worker.state = 'complete'; worker.result.resolve(message); }
              else throw new Error('invalid workload process evidence');
            } catch (error) { failure.reject(new Error('workload process evidence failed', { cause: error })); }
          });
          await barrier(send(worker, { type: 'init', users: users.slice(offset, end), userOffset: offset, measuredUsers: Math.max(0, Math.min(end, requestedUsers) - offset),
            warmupUsers: Math.max(0, Math.min(end, WARMUP.users) - offset), backendModule, backendOptions }));
          // No concurrent shard login bursts.
          await barrier(worker.ready.promise);
        }
        return true;
      },
      async warmUp() {
        const startAt = Date.now() + startDelayMs;
        for (const worker of workers) worker.state = 'warming';
        await barrier(Promise.all(workers.map(worker => send(worker, { type: 'warmup', startAt, durationMs: warmupMs }))));
        const results = await barrier(Promise.all(workers.map(worker => worker.warmed.promise)));
        if (results.reduce((sum, row) => sum + row.users, 0) !== WARMUP.users) throw new Error('warm-up cohort mismatch');
        if (warmupMs === WARMUP.durationMs && Object.keys(WORKFLOW_WEIGHTS).some(name => results.reduce((sum, row) => sum + (row.names?.[name === 'signIn' ? 'signOutIn' : name] ?? 0), 0) === 0)) throw new Error('warm-up coverage incomplete');
        await onWarmupComplete();
        return true;
      },
      async measure() {
        const startAt = Date.now() + startDelayMs;
        const backendPromise = backendTelemetryFactory ? Promise.resolve().then(() => backendTelemetryFactory({ startAt, signal: telemetryAbort.signal })) : Promise.resolve(null);
        backendPromise.then(sampler => { backendSampler = sampler; if (telemetryAbort.signal.aborted) return sampler?.stop(Date.now()); }).catch(error => failure.reject(error));
        const telemetryPromise = startProcessTelemetry({ startAt, signal: telemetryAbort.signal });
        telemetryPromise.then(sampler => { coordinator = sampler; }).catch(error => failure.reject(error));
        for (const worker of workers) worker.state = 'measuring';
        await barrier(Promise.all(workers.map(worker => send(worker, { type: 'measure', startAt, durationMs }))));
        const outcomes = await barrier(Promise.all(workers.map(worker => worker.ended.promise)));
        const endedAt = Date.now();
        coordinator = await barrier(telemetryPromise);
        const processReport = coordinator.stop();
        backendSampler = await barrier(backendPromise);
        const backendReport = backendSampler ? await barrier(backendSampler.stop(endedAt)) : null;
        for (const worker of workers) worker.state = 'cleanup';
        await barrier(Promise.all(workers.map(worker => send(worker, { type: 'finish' }))));
        const reports = await barrier(Promise.all(workers.map(worker => worker.result.promise)));
        await barrier(Promise.all(workers.map(worker => worker.exited.promise)));
        const sum = key => outcomes.reduce((total, row) => total + row.result[key], 0);
        if (sum('requestedUsers') !== requestedUsers || sum('startedUsers') !== requestedUsers) throw new Error('measured cohort mismatch');
        const metrics = accumulator.finalize((endedAt - startAt) / 1000, { requestedUsers, achievedUsers: sum('startedUsers') - sum('lostUsers') });
        const telemetry = validateRunnerTelemetry({ coordinator: processReport, workers: reports.map(row => row.resources) }, { startAt, endedAt, durationMs });
        const backendTelemetry = validateBackendTelemetry(backendReport, { startAt, endedAt, durationMs, containerIds: backendOwnership?.containerIds, project: backendOwnership?.project });
        metrics.valid = false;
        metrics.validityReasons.push(...telemetry.validityReasons, ...backendTelemetry.validityReasons, 'native measurement qualification pending');
        return { metrics, telemetry, coordinatorTelemetry: processReport, backendTelemetry, backendReport, workers: reports.map((row, index) => ({ pid: workers[index].pid, samples: row.sampleCount, resources: row.resources })),
          startAt, endedAt, admission_evidence: false, measurement_qualified: false, diagnostic };
      },
    });
  } catch (error) { primaryFailure = error; throw error; }
  finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); telemetryAbort.abort(); coordinator?.stop();
    for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGTERM');
    const kill = setTimeout(() => { for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL'); }, 5000);
    await Promise.all(workers.map(worker => worker.exited.promise)); clearTimeout(kill);
    try { await backendSampler?.stop(); } catch (error) {
      if (!primaryFailure) throw error;
      if (error !== primaryFailure) primaryFailure.cleanupErrors = [...(primaryFailure.cleanupErrors ?? []), error];
    }
  }
}
