import test from 'node:test';
import assert from 'node:assert/strict';
import { startProcessTelemetry, validateProcessTelemetry, validateRunnerTelemetry } from '../benchmark-sets/realworld-api-v5/shared/lib/telemetry.mjs';

const startAt = 100000;
const report = (pid = 1) => ({ pid, startedAt: startAt, endedAt: startAt + 15000, intervalMs: 5000, samples: [1, 2, 3].map(index => ({ timestampMs: startAt + index * 5000, cpuPercent: 20, rssBytes: 4096, eventLoop: { p99Ms: 10, maxMs: 20 } })) });

test('V5 headroom validation accepts complete aligned process samples', () => {
  assert.equal(validateProcessTelemetry(report(), { startAt, endedAt: startAt + 15000 }).valid, true);
  assert.equal(validateRunnerTelemetry({ coordinator: report(1), workers: [report(2), report(3), report(4)] }, { startAt, endedAt: startAt + 15000 }).valid, true);
});

test('V5 telemetry rejects missing workers, duplicate processes, late starts and lost samples', () => {
  for (const workers of [[], [report(2), report(3)], [report(2), report(2), report(4)]]) assert.equal(validateRunnerTelemetry({ coordinator: report(1), workers }, { startAt, endedAt: startAt + 15000 }).valid, false);
  for (const change of [r => { r.samples.pop(); }, r => { r.startedAt += 101; }, r => { r.samples[1].timestampMs += 5000; }, r => { r.samples[1].cpuPercent = NaN; }, r => { r.endedAt -= 1; }]) {
    const r = report(); change(r);
    assert.equal(validateProcessTelemetry(r, { startAt, endedAt: startAt + 15000 }).valid, false);
  }
});

test('V5 three consecutive breaches invalidate attribution for each process independently', () => {
  for (const [key, value] of [['cpuPercent', 91], ['p99Ms', 101], ['maxMs', 251]]) {
    const r = report();
    for (const sample of r.samples) if (key === 'cpuPercent') sample[key] = value; else sample.eventLoop[key] = value;
    assert.equal(validateProcessTelemetry(r, { startAt, endedAt: startAt + 15000 }).valid, false);
    r.samples[1].cpuPercent = 20; r.samples[1].eventLoop = { p99Ms: 10, maxMs: 20 };
    assert.equal(validateProcessTelemetry(r, { startAt, endedAt: startAt + 15000 }).valid, true);
  }
});

test('V5 real process sampler stops cleanly and short diagnostic intervals cannot qualify', async () => {
  const epoch = Date.now();
  const sampler = await startProcessTelemetry({ startAt: epoch, intervalMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 35));
  const result = sampler.stop();
  assert.equal(result.pid, process.pid);
  assert.ok(result.samples.length >= 1);
  assert.ok(result.samples.every(sample => Number.isFinite(sample.cpuPercent) && sample.rssBytes > 0));
  const count = result.samples.length;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(result.samples.length, count);
  assert.equal(validateProcessTelemetry(result, { startAt: epoch, endedAt: result.endedAt }).valid, false);
});
