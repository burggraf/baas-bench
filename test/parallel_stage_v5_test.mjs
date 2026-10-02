import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runParallelStageFromBaseline, runParallelLifecycleDiagnostic } from '../benchmark-sets/realworld-api-v5/shared/lib/parallel-stage.mjs';
import { REQUIRED_CHECKS } from '../benchmark-sets/realworld-api-v5/shared/lib/conformance.mjs';
import { buildVirtualUserSpecs } from '../benchmark-sets/realworld-api-v5/shared/lib/dataset.mjs';

const config = () => ({ conformance: { passed: true, findings: REQUIRED_CHECKS.map(name => ({ name, passed: true })) },
  reset: async () => {}, verifyBaseline: async () => true, users: buildVirtualUserSpecs(50), requestedUsers: 3,
  backendModule: new URL('./fixtures/v5_worker_backend.mjs', import.meta.url).href,
  durationMs: 40, warmupMs: 40, startDelayMs: 200, diagnostic: true });

function assertExited(rows) {
  for (const row of rows) assert.throws(() => process.kill(row.pid, 0), error => error.code === 'ESRCH');
}

test('V5 forks three real workers, preserves the global cohort, pools delivered samples and cleans processes', async () => {
  const samples = [], events = [], previous = process.env.V5_TEST_SECRET;
  process.env.V5_TEST_SECRET = 'fixture-secret';
  let result;
  try {
    result = await runParallelStageFromBaseline({ ...config(), reset: async () => { events.push('reset'); }, verifyBaseline: async () => { events.push('verify'); return true; }, onSample: sample => samples.push(sample) });
  } finally { if (previous === undefined) delete process.env.V5_TEST_SECRET; else process.env.V5_TEST_SECRET = previous; }
  assert.deepEqual(events, ['reset', 'verify']);
  assert.equal(new Set(result.workers.map(worker => worker.pid)).size, 3);
  assert.equal(result.workers.reduce((total, worker) => total + worker.samples, 0), samples.length);
  assert.ok(samples.some(sample => sample.type === 'workflow'));
  assert.equal(result.metrics.requestedUsers, 3);
  assert.equal(result.metrics.achievedUsers, 3);
  assert.equal(result.coordinatorTelemetry.pid, process.pid);
  assert.equal(result.coordinatorTelemetry.intervalMs, 5000);
  assert.equal(result.metrics.valid, false);
  assert.equal(result.measurement_qualified, false);
  assert.equal(result.admission_evidence, false);
  assertExited(result.workers);
});

test('V5 three-worker profile handles a one-user stage without silently dropping idle processes', async () => {
  const result = await runParallelStageFromBaseline({ ...config(), requestedUsers: 1 });
  assert.equal(result.workers.length, 3);
  assert.equal(result.metrics.requestedUsers, 1);
  assert.equal(result.metrics.achievedUsers, 1);
  assertExited(result.workers);
});

test('V5 worker/collector failures abort barriers and terminate every owned process', async () => {
  for (const fault of ['prepare', 'consumer', 'crash', 'drop']) {
    const failPreparation = fault === 'prepare';
    const dir = mkdtempSync(join(tmpdir(), 'v5-worker-pids-')), pidFile = join(dir, 'pids');
    try {
      await assert.rejects(runParallelStageFromBaseline({ ...config(), backendOptions: { failPreparation, pidFile, sampleFault: ['crash', 'drop'].includes(fault) ? fault : undefined },
        onSample() { if (fault === 'consumer') throw new Error('broken consumer'); } }), /process evidence|process exited/);
      const rows = readFileSync(pidFile, 'utf8').trim().split('\n').map(value => ({ pid: Number(value) }));
      assert.equal(rows.length, failPreparation ? 1 : 3);
      assertExited(rows);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('V5 parallel lifecycle diagnostics never fabricate passing conformance findings', async () => {
  const { conformance: _unused, ...options } = config();
  let warmed = false;
  const result = await runParallelLifecycleDiagnostic({ ...options, onWarmupComplete: async () => { warmed = true; } });
  assert.equal(warmed, true);
  assert.equal(result.admission_evidence, false);
  assert.equal(result.measurement_qualified, false);
  assertExited(result.workers);
  await assert.rejects(runParallelLifecycleDiagnostic({ ...options, diagnostic: false }), /diagnostic/);
});

test('V5 backend telemetry factory is stopped before cleanup and cannot admit a stage', async () => {
  const calls = [];
  const result = await runParallelStageFromBaseline({ ...config(), backendOwnership: { project: 'v5-owned', containerIds: ['a'.repeat(64)] },
    backendTelemetryFactory: async ({ startAt }) => { calls.push('start'); return { stop(endedAt) { calls.push('stop'); return { startAt, endedAt }; } }; } });
  assert.equal(calls[0], 'start');
  assert.ok(calls.includes('stop'));
  assert.equal(result.backendTelemetry.valid, false);
  assert.equal(result.metrics.valid, false);
});

test('V5 secondary backend telemetry cleanup failure preserves and annotates the primary failure', async () => {
  const cleanup = new Error('fixture cleanup failure');
  await assert.rejects(runParallelStageFromBaseline({ ...config(), backendOwnership: { project: 'v5-owned', containerIds: ['a'.repeat(64)] },
    backendTelemetryFactory: async () => ({ stop() { throw cleanup; } }), onSample() { throw new Error('fixture consumer failure'); } }),
  error => /process evidence/.test(error.message) && error.cleanupErrors?.[0] === cleanup);
});

test('V5 cancelled parallel work does not invoke reset', async () => {
  const abort = new AbortController(); abort.abort();
  let reset = false;
  await assert.rejects(runParallelStageFromBaseline({ ...config(), signal: abort.signal, reset: async () => { reset = true; } }), /cancelled/);
  assert.equal(reset, false);
});

test('V5 cancellation after acknowledged reset prevents verification and worker creation', async () => {
  const abort = new AbortController();
  let verified = false;
  await assert.rejects(runParallelStageFromBaseline({ ...config(), signal: abort.signal, reset: async () => abort.abort(),
    verifyBaseline: async () => { verified = true; return true; } }), /cancelled/);
  assert.equal(verified, false);
});

test('V5 shortened parallel windows require explicit diagnostic mode', async () => {
  await assert.rejects(runParallelStageFromBaseline({ ...config(), diagnostic: false }), /diagnostic mode/);
  await assert.rejects(runParallelStageFromBaseline({ ...config(), conformance: { passed: false, findings: [] } }), /conformance/);
});
