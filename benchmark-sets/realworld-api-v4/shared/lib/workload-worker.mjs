import { setTimeout as sleep } from 'node:timers/promises';
import { runWorkload } from './workload.mjs';
import { collectResources, RESOURCE_SAMPLE_INTERVAL_MS } from './resources.mjs';

const controller = new AbortController();
let phase = 'setup';
const waits = new Map();
const received = new Map();
const wait = type => received.has(type) ? Promise.resolve(received.get(type)) : new Promise(resolve => waits.set(type, resolve));
process.on('message', message => { received.set(message.type, message); waits.get(message.type)?.(message); });
process.on('disconnect', () => process.exit(1));
process.on('SIGTERM', () => { controller.abort(); process.exit(1); });
const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));

async function main() {
  const job = await wait('init');
  const backend = await (await import(job.backendModule ?? `./adapters/${job.platform}.mjs`)).createBackend();
  let samples = [];
  let sampleCount = 0;
  const pending = new Set();
  let deliveryError;
  const flush = () => {
    if (!samples.length) return;
    if (pending.size >= 16) throw new Error('worker sample delivery overloaded');
    const batch = samples; samples = [];
    const promise = send({ type: 'samples', samples: batch });
    pending.add(promise);
    promise.catch(error => { deliveryError = error; controller.abort(); }).finally(() => pending.delete(promise));
  };
  const flushTimer = setInterval(() => { try { flush(); } catch (error) { deliveryError = error; controller.abort(); } }, 250);
  let resourcePromise, startedAt;
  try {
    phase = 'preparation';
    const result = await runWorkload(backend, job.config, {
      users: job.users, userOffset: job.userOffset, durationMs: job.durationMs, graceMs: job.graceMs, signal: controller.signal, skipPrepareWorkload: true,
      onSample: sample => { if (deliveryError) throw deliveryError; sampleCount++; samples.push(sample); if (samples.length >= 256) flush(); },
      onProgress: (phase, fields) => {
        if (phase === 'prepare-sessions') void send({ type: 'prepared', users: fields.prepared_users }).catch(error => { deliveryError = error; controller.abort(); });
      },
      onMeasuredStart: async () => {
        await send({ type: 'ready' });
        const { startAt } = await wait('start');
        await sleep(Math.max(0, startAt - Date.now()), undefined, { signal: controller.signal });
        startedAt = Date.now();
        phase = 'measurement';
        const intervalMs = job.resourceIntervalMs ?? RESOURCE_SAMPLE_INTERVAL_MS;
        resourcePromise = collectResources({ samples: Math.max(1, Math.ceil(job.durationMs / intervalMs)), intervalMs, startAt });
        resourcePromise.catch(() => controller.abort());
      },
      onMeasuredEnd: async summary => {
        if (summary.stageFailed) {
          await send({ type: 'error', phase });
          throw new Error('worker workload invalid');
        }
        flush();
        await Promise.all([...pending]);
        if (deliveryError) throw deliveryError;
        await send({ type: 'ended' });
        await wait('cleanup');
        phase = 'cleanup';
      },
    });
    flush();
    await Promise.all([...pending]);
    if (deliveryError) throw deliveryError;
    phase = 'telemetry';
    result.resources = resourcePromise ? { ...await resourcePromise, startedAt, pid: process.pid } : { samples: [], valid: false, validityReasons: ['worker never started'], pid: process.pid };
    result.sampleCount = sampleCount;
    await send({ type: 'result', result });
    process.exit(0);
  } finally { clearInterval(flushTimer); }
}
void main().catch(async () => { try { await send({ type: 'error', phase }); } finally { process.exit(1); } });
