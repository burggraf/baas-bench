import { performance } from 'node:perf_hooks';

export function percentile(samples, proportion) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(proportion * sorted.length) - 1];
}

function errorKind(error) {
  return error instanceof Error ? error.constructor.name : 'unknown_error';
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
}

export async function runStage({
  concurrency,
  durationMs,
  trial,
  createClient,
  operation,
  validate,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('invalid concurrency');
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError('invalid duration');

  const clients = [];
  for (let vu = 1; vu <= concurrency; vu += 1) clients.push(await createClient(vu));

  let attempted = 0;
  let completed = 0;
  let failed = 0;
  const latencies = [];
  const errorKinds = {};
  const errorSamples = [];
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;

  async function worker(client, vu) {
    let sequence = 0;
    while (performance.now() < deadline) {
      attempted += 1;
      const operationStartedAt = performance.now();
      try {
        const value = await operation(client, { trial, vu, sequence });
        if (!validate(value)) {
          failed += 1;
          errorKinds.invalid_response = (errorKinds.invalid_response ?? 0) + 1;
        } else {
          completed += 1;
          latencies.push(performance.now() - operationStartedAt);
        }
      } catch (error) {
        failed += 1;
        const kind = errorKind(error);
        errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
        if (errorSamples.length < 20) errorSamples.push({ kind, message: errorMessage(error) });
      }
      sequence += 1;
    }
  }

  let guard;
  const hardLimit = new Promise((_, reject) => {
    guard = setTimeout(() => reject(new Error('stage did not settle within 60 seconds')), durationMs + 60_000);
  });
  try {
    await Promise.race([
      Promise.all(clients.map((client, index) => worker(client, index + 1))),
      hardLimit,
    ]);
  } finally {
    clearTimeout(guard);
  }

  return {
    concurrency,
    duration_ms: performance.now() - startedAt,
    attempted,
    completed,
    failed,
    latencies_ms: latencies,
    error_kinds: errorKinds,
    error_samples: errorSamples,
  };
}
