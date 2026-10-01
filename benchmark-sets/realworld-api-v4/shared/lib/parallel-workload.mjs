import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

// Three workload processes leave one of the pilot's four cores for coordination.
export const WORKLOAD_PROCESSES = 3;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {}); // All barriers are consumed below, including early failures.
  return { promise, resolve, reject };
};

export async function runParallelWorkload(platform, config, options) {
  const count = Math.min(options.users.length, WORKLOAD_PROCESSES, Math.max(1, availableParallelism() - 1));
  if (!count) throw new Error('parallel workload requires users');
  const workers = [];
  const failure = deferred();
  const abort = () => failure.reject(new Error('parallel workload cancelled'));
  const timer = setTimeout(() => failure.reject(new Error('parallel workload deadline')), options.durationMs + 630_000);
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
  const barrier = work => Promise.race([work, failure.promise]);
  const send = (worker, message) => new Promise((resolve, reject) => worker.child.send(message, error => error ? reject(error) : resolve()));
  try {
    // Preparing one shard at a time preserves the adapter's global login limit/delay.
    for (let index = 0; index < count; index++) {
      const offset = Math.floor(index * options.users.length / count);
      const end = Math.floor((index + 1) * options.users.length / count);
      const env = { ...process.env };
      delete env.LINODE_TOKEN;
      delete env.BAAS_BENCH_V4_PROGRESS_FD;
      const child = fork(fileURLToPath(new URL('./workload-worker.mjs', import.meta.url)), [], { env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' });
      const worker = { child, offset, sampleCount: 0, ready: deferred(), ended: deferred(), result: deferred(), exited: deferred() };
      workers.push(worker);
      child.on('error', error => failure.reject(error));
      child.on('close', (code, signal) => {
        worker.exited.resolve();
        if (code !== 0 || !worker.receivedResult) failure.reject(new Error(`workload worker ${index + 1} exited (${signal ?? code}) without complete evidence`));
      });
      child.on('message', message => {
        try {
          if (message.type === 'samples') {
            worker.sampleCount += message.samples.length;
            for (const sample of message.samples) options.onSample?.(sample);
          }
          else if (message.type === 'prepared') options.onProgress?.('prepare-sessions', { prepared_users: offset + message.users });
          else if (message.type === 'ready') worker.ready.resolve();
          else if (message.type === 'ended') worker.ended.resolve();
          else if (message.type === 'result') {
            worker.receivedResult = true;
            worker.result.resolve(message.result);
            if (message.result.preparationFailed) failure.reject(new Error(`workload worker ${index + 1} session preparation failed`));
          } else if (message.type === 'error') {
            const phase = ['setup', 'preparation', 'measurement', 'cleanup', 'telemetry'].includes(message.phase) ? message.phase : 'unknown';
            failure.reject(new Error(`workload worker ${index + 1} failed during ${phase}`));
          }
        } catch (error) { failure.reject(error); }
      });
      await barrier(send(worker, { type: 'init', platform, backendModule: options.backendModule, config, users: options.users.slice(offset, end), userOffset: offset, durationMs: options.durationMs, graceMs: options.graceMs, resourceIntervalMs: options.resourceIntervalMs }));
      await barrier(worker.ready.promise);
    }
    const startAt = Date.now() + (options.startDelayMs ?? 1_500);
    await barrier(Promise.resolve(options.onMeasuredStart?.({ startAt })));
    await barrier(Promise.all(workers.map(worker => send(worker, { type: 'start', startAt }))));
    await barrier(Promise.all(workers.map(worker => worker.ended.promise)));
    await barrier(Promise.resolve(options.onMeasuredEnd?.()));
    options.onProgress?.('close-sessions');
    const results = [];
    for (const worker of workers) {
      await barrier(send(worker, { type: 'cleanup' }));
      const row = await barrier(worker.result.promise);
      if (row.sampleCount !== worker.sampleCount) throw new Error('workload worker sample delivery incomplete');
      results.push(row);
    }
    await barrier(Promise.all(workers.map(worker => worker.exited.promise)));
    const result = { requestedUsers: options.users.length, failureReasons: [], workerResources: [] };
    for (const key of ['startedUsers', 'completedWorkflowCount', 'failedWorkflowCount', 'lostUsers', 'closeErrors', 'preparationFailureCount']) result[key] = results.reduce((sum, row) => sum + row[key], 0);
    for (const key of ['graceExpired', 'stageFailed', 'preparationFailed']) result[key] = results.some(row => row[key]);
    result.failureReasons = [...new Set(results.flatMap(row => row.failureReasons))];
    result.workerResources = results.map((row, index) => ({ userOffset: workers[index].offset, ...row.resources }));
    if (result.workerResources.some(row => Math.abs(row.startedAt - startAt) > 100)) {
      result.stageFailed = true;
      result.failureReasons.push('worker_start_alignment');
    }
    return result;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    // Join every process before returning, including cancellation/crash paths.
    for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGTERM');
    const killTimer = setTimeout(() => { for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL'); }, 5_000);
    await Promise.all(workers.map(worker => worker.exited.promise));
    clearTimeout(killTimer);
  }
}
