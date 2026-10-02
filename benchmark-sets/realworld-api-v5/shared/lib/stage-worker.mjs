import { prepareUserContexts, WARMUP } from './warmup.mjs';
import { runTimedWindow } from './timed-stage.mjs';
import { startProcessTelemetry } from './telemetry.mjs';
import { closeNativeSessions } from './native-conformance.mjs';

const abort = new AbortController(), contexts = [], waits = new Map(), messages = new Map();
let phase = 'setup';
const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
const receive = type => messages.has(type) ? Promise.resolve(messages.get(type)) : new Promise(resolve => waits.set(type, resolve));
process.on('message', message => {
  if (!message || !['init', 'warmup', 'measure', 'finish'].includes(message.type) || messages.has(message.type)) { abort.abort(); process.exit(1); }
  messages.set(message.type, message); waits.get(message.type)?.(message);
});
process.on('disconnect', () => process.exit(1));
process.on('SIGTERM', () => { abort.abort(); process.exit(1); });

async function main() {
  let failure, telemetry, cleanupAttempted = false;
  try {
    const job = await receive('init');
    const backend = await (await import(job.backendModule)).createBackend(job.backendOptions);
    phase = 'preparation';
    await prepareUserContexts(backend, job.users, contexts, { concurrency: 1, userOffset: job.userOffset, signal: abort.signal });
    await send({ type: 'ready', pid: process.pid });
    phase = 'warmup';
    const warmup = await receive('warmup');
    const names = {};
    const warmed = await runTimedWindow(contexts.slice(0, job.warmupUsers), { allowIdle: true, startAt: warmup.startAt, durationMs: warmup.durationMs, signal: abort.signal,
      onSample(sample) { if (sample.type === 'workflow' && sample.success) names[sample.workflow] = (names[sample.workflow] ?? 0) + 1; } });
    if (warmed.stageFailed || warmed.failedWorkflowCount) throw new Error('warm-up failed');
    await send({ type: 'warmed', users: job.warmupUsers, names });
    const measure = await receive('measure'); phase = 'measurement';
    let samples = [], sampleCount = 0, deliveryError;
    const pending = new Set();
    const flush = () => {
      if (!samples.length) return;
      if (pending.size >= 16) throw new Error('sample delivery overloaded');
      const batch = samples; samples = [];
      const promise = send({ type: 'samples', samples: batch });
      pending.add(promise);
      promise.catch(error => { deliveryError = error; abort.abort(); }).finally(() => pending.delete(promise));
    };
    const timer = setInterval(() => { try { flush(); } catch (error) { deliveryError = error; abort.abort(); } }, 250);
    let result;
    try {
      result = await runTimedWindow(contexts.slice(0, job.measuredUsers), { allowIdle: true, startAt: measure.startAt, durationMs: measure.durationMs, signal: abort.signal,
        onSample(sample) { if (deliveryError) throw deliveryError; samples.push(sample); sampleCount++; if (samples.length >= 256) flush(); },
        async onBoundary(kind, info) { if (kind === 'start') telemetry = await startProcessTelemetry({ startAt: info.startAt, signal: abort.signal }); } });
      flush(); await Promise.all([...pending]);
      if (deliveryError || result.stageFailed) throw new Error('measurement failed');
      await send({ type: 'ended', result, sampleCount, endedAt: Date.now() });
      await receive('finish'); phase = 'cleanup';
      const resources = telemetry.stop();
      cleanupAttempted = true;
      await closeNativeSessions(contexts.map(context => context?.session));
      await send({ type: 'result', sampleCount, resources });
    } finally { clearInterval(timer); }
  } catch (error) { failure = error; }
  finally {
    telemetry?.stop();
    if (failure && !cleanupAttempted) { try { await closeNativeSessions(contexts.map(context => context?.session), failure); } catch {} }
  }
  if (failure) { await send({ type: 'error', phase }); process.exit(1); }
  process.exit(0);
}
void main().catch(() => process.exit(1));
