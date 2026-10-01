import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const users = Array.from({ length: 6 }, (_, index) => ({ credentials: { email: `user${index}@example.test`, password: 'secret' }, organizationId: 'org', projectId: 'project', taskId: 'task' }));
const config = { seed: 42, timeoutMs: 100, thinkTimeMs: { min: 5, max: 5 }, weights: { dashboard: 0, taskList: 100, taskDetail: 0, createTask: 0, updateTask: 0, addComment: 0, search: 0, profileUpdate: 0, signIn: 0 } };
const backendModule = new URL('./fixtures/v4-worker-backend.mjs', import.meta.url).href;

test('multicore runs disjoint users with synchronized boundaries and exact merged samples', async () => {
  const { runParallelWorkload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/parallel-workload.mjs');
  const samples = []; const boundaries = [];
  const result = await runParallelWorkload('trailbase', config, {
    users, backendModule, durationMs: 200, graceMs: 100, startDelayMs: 200, resourceIntervalMs: 50,
    onSample: sample => samples.push(sample),
    onMeasuredStart: ({ startAt }) => boundaries.push(['start', startAt]),
    onMeasuredEnd: () => boundaries.push(['end']),
  });
  assert.equal(result.startedUsers, 6);
  assert.equal(result.stageFailed, false);
  assert.equal(result.closeErrors, 0);
  assert.equal(result.completedWorkflowCount, samples.filter(s => s.type === 'workflow' && s.success).length);
  assert.equal(samples.filter(s => s.type === 'remote').length, result.completedWorkflowCount);
  assert.equal(result.workerResources.length, 3);
  assert.deepEqual(result.workerResources.map(w => w.userOffset), [0, 2, 4]);
  assert.equal(new Set(result.workerResources.map(w => w.pid)).size, 3);
  assert.ok(result.workerResources.every(w => w.samples.length === 4 && w.valid));
  assert.ok(result.workerResources.every(w => Math.abs(w.startedAt - boundaries[0][1]) <= 100));
  assert.deepEqual(boundaries.map(b => b[0]), ['start', 'end']);
  for (const worker of result.workerResources) assert.throws(() => process.kill(worker.pid, 0), { code: 'ESRCH' });
  const { StageMetricsAccumulator } = await import('../benchmark-sets/realworld-api-v4/shared/lib/metrics.mjs');
  const accumulator = new StageMetricsAccumulator();
  for (const sample of samples) accumulator.record(sample);
  const stage = accumulator.finalize(1, { requestedUsers: 6, achievedUsers: 6 });
  const latencies = samples.filter(s => s.type === 'workflow').map(s => s.elapsedMs).sort((a, b) => a - b);
  assert.equal(stage.operationClassMetrics.read.latencyP95Ms, latencies[Math.ceil(latencies.length * .95) - 1]);
});

test('worker preparation failure prevents every worker from measuring', async () => {
  const { runParallelWorkload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/parallel-workload.mjs');
  await assert.rejects(runParallelWorkload('trailbase', config, {
    users: users.map((u, i) => i === 2 ? { ...u, credentials: { ...u.credentials, password: 'prepare-fail' } } : u),
    backendModule, durationMs: 100, onMeasuredStart: () => assert.fail('measurement must not start'),
  }), /preparation/);
});

test('worker crashes abort the stage rather than silently dropping its users', async () => {
  const { runParallelWorkload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/parallel-workload.mjs');
  await assert.rejects(runParallelWorkload('trailbase', config, {
    users: users.map((u, i) => i === 2 ? { ...u, credentials: { ...u.credentials, password: 'crash' } } : u),
    backendModule, durationMs: 100, startDelayMs: 100,
  }), /worker.*exit/);
});

test('shards preserve global session preparation limits and finish measurement before cleanup', async () => {
  const { runParallelWorkload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/parallel-workload.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'v4-worker-preparation-'));
  const previous = process.env.V4_TEST_WORKER_LOG;
  process.env.V4_TEST_WORKER_LOG = join(dir, 'events.jsonl');
  let startAt, endedAt;
  try {
    await runParallelWorkload('trailbase', config, { users, backendModule, durationMs: 100, resourceIntervalMs: 50, startDelayMs: 100,
      onMeasuredStart: event => { startAt = event.startAt; }, onMeasuredEnd: () => { endedAt = Date.now(); },
    });
    const events = (await readFile(process.env.V4_TEST_WORKER_LOG, 'utf8')).trim().split('\n').map(JSON.parse);
    let preparing = 0, maximum = 0;
    for (const event of events) {
      if (event.event === 'prepare-start') { preparing++; maximum = Math.max(maximum, preparing); }
      if (event.event === 'prepare-end') { preparing--; assert.ok(event.at < startAt); }
      if (event.event === 'close') assert.ok(event.at >= endedAt);
    }
    assert.equal(maximum, 1);
    assert.equal(events.filter(e => e.event === 'close').length, users.length);
    const { deriveUserSeed } = await import('../benchmark-sets/realworld-api-v4/shared/lib/workload.mjs');
    const { mulberry32 } = await import('../benchmark-sets/realworld-api-v4/shared/lib/random.mjs');
    for (const [index, user] of users.entries()) {
      const random = mulberry32(deriveUserSeed(config.seed, index));
      random(); // Workflow selection consumes the first draw.
      const first = events.filter(e => e.event === 'first-page' && e.email === user.credentials.email);
      assert.equal(first.length, 1);
      assert.equal(first[0].pageSize, 1 + Math.floor(random() * 25));
    }
  } finally {
    if (previous === undefined) delete process.env.V4_TEST_WORKER_LOG; else process.env.V4_TEST_WORKER_LOG = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('measured worker timeouts are scored but integrity failures cancel the stage', async () => {
  const { runParallelWorkload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/parallel-workload.mjs');
  const samples = [];
  const result = await runParallelWorkload('trailbase', config, {
    users: users.map(u => ({ ...u, credentials: { ...u.credentials, password: 'operation-fail' } })),
    backendModule, durationMs: 100, resourceIntervalMs: 50, startDelayMs: 100, onSample: sample => samples.push(sample),
  });
  assert.equal(result.stageFailed, false);
  assert.ok(result.failedWorkflowCount > 0);
  assert.equal(result.failedWorkflowCount, samples.filter(s => s.type === 'workflow' && !s.success).length);
  await assert.rejects(runParallelWorkload('trailbase', config, {
    users: users.map((u, i) => i === 2 ? { ...u, credentials: { ...u.credentials, password: 'integrity-fail' } } : u),
    backendModule, durationMs: 100, resourceIntervalMs: 50, startDelayMs: 100,
  }), /worker.*failed/);
});

test('backend-local telemetry uses one bounded SSH collection and preserves missing samples', async () => {
  const { collectRemoteResources } = await import('../benchmark-sets/realworld-api-v4/shared/lib/resources.mjs');
  let commands = 0;
  const local = { samples: [{ timestampMs: 5000, runner: { cpuPercent: 1 }, eventLoop: { p99Ms: 1, maxMs: 1 }, hosts: { runner: {} } }], valid: true, validityReasons: [] };
  const remote = { timestampMs: 5000, containers: { count: 1, cpuPercent: 50, memoryBytes: 100 }, hosts: { backend: { cpu: { user: 1, nice: 0, system: 0, idle: 1, iowait: 0, irq: 0, softirq: 0, steal: 0, total: 2 }, memory: { totalBytes: 1024, availableBytes: 512, swapTotalBytes: 0, swapFreeBytes: 0 }, network: { rxBytes: 0, txBytes: 0, rxDrops: 0, txDrops: 0, interfaces: 1 } } } };
  const options = { samples: 1, intervalMs: 5000, startAt: 0, containerIds: ['aaaaaaaaaaaa'], dockerSshTarget: 'root@10.203.0.10', remoteScript: '/opt/bench/lib/resources.mjs', collectLocal: async () => structuredClone(local) };
  const result = await collectRemoteResources({ ...options, command: async (exe, args, commandOptions) => {
    commands++;
    assert.equal(exe, 'ssh');
    assert.match(args.at(-1), /resources\.mjs' stream/);
    assert.equal(commandOptions.timeoutMs, 35000);
    return { stdout: JSON.stringify({ samples: [remote], valid: true, validityReasons: [] }) };
  } });
  assert.equal(commands, 1);
  assert.equal(result.valid, true);
  assert.equal(result.samples[0].containers.cpuPercent, 50);
  assert.equal(result.samples[0].backendTimestampMs, 5000);
  const missing = await collectRemoteResources({ ...options, command: async () => ({ stdout: JSON.stringify({ samples: [], valid: false, validityReasons: ['missing'] }) }) });
  assert.equal(missing.valid, false);
  assert.match(missing.validityReasons.join(' '), /missing/);
  const skewed = await collectRemoteResources({ ...options, command: async () => ({ stdout: JSON.stringify({ samples: [{ ...remote, timestampMs: 15000 }], valid: true, validityReasons: [] }) }) });
  assert.equal(skewed.valid, false);
  assert.match(skewed.validityReasons.join(' '), /alignment/);
});

test('large pooled latency buckets do not exceed the JavaScript argument limit', async () => {
  const { StageMetricsAccumulator } = await import('../benchmark-sets/realworld-api-v4/shared/lib/metrics.mjs');
  const metrics = new StageMetricsAccumulator({ maxLatencySamples: 200_000 });
  for (let i = 0; i < 150_000; i++) metrics.record({ type: 'workflow', name: 'taskList', workflow: 'taskList', operationClass: 'read', kind: 'read', success: true, elapsedMs: 1 });
  const stage = metrics.finalize(1, { requestedUsers: 100, achievedUsers: 100 });
  assert.equal(stage.operationClassMetrics.read.attempted, 150_000);
  assert.equal(stage.operationClassMetrics.read.latencyP95Ms, 1);
});

test('one overloaded worker invalidates attribution even with a healthy coordinator', async () => {
  const { executeRun } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
  const { StageMetricsAccumulator } = await import('../benchmark-sets/realworld-api-v4/shared/lib/metrics.mjs');
  const outputDir = await mkdtemp(join(tmpdir(), 'v4-worker-overload-'));
  try {
    const raw = await executeRun({ platform: 'trailbase', phase: 'measure', trial: 1, outputDir, warmupMs: 0, stageMs: 300_000 }, {
      multicore: true, backend: { users: Array.from({ length: 100 }, () => ({})), fixture: {} },
      correctness: async () => ({ findings: [{ passed: true }] }),
      workload: async (_backend, _config, options) => {
        if (!options.durationMs) return {};
        await options.onMeasuredStart(); await options.onMeasuredEnd();
        return { startedUsers: options.users.length, stageFailed: false, workerResources: [{ valid: true, startedAt: 0, samples: Array.from({ length: 60 }, (_, i) => ({ timestampMs: (i + 1) * 5000, runner: { cpuPercent: 95 }, eventLoop: { p99Ms: 1, maxMs: 1 } })) }] };
      },
      metricsFactory: options => {
        assert.equal(options.maxLatencySamples, 5_000_000);
        return new StageMetricsAccumulator(options);
      },
      collectResources: async () => ({ valid: true, validityReasons: [], samples: Array.from({ length: 60 }, () => ({ runner: { cpuPercent: 1 }, eventLoop: { p99Ms: 1, maxMs: 1 } })) }),
    });
    assert.equal(raw.stages.length, 1);
    assert.equal(raw.stages[0].valid, false);
    assert.match(raw.stages[0].validityReasons.join(' '), /worker 1: runner overload/);
    assert.equal(raw.resources[0].workers.length, 1);
    assert.equal(raw.runnerProfile, 'multicore-3-backend-local-telemetry');
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('invalid user offsets fail before creating sessions', async () => {
  const { runWorkload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/workload.mjs');
  await assert.rejects(runWorkload({ createSession: () => assert.fail('no sessions before validation') }, config, { users, userOffset: -1, durationMs: 0 }), /invalid global user offset/);
});

test('parallel workers retain global-user random seeds', async () => {
  const { deriveUserSeed } = await import('../benchmark-sets/realworld-api-v4/shared/lib/workload.mjs');
  assert.equal(deriveUserSeed(42, 4), (42 + Math.imul(4, 0x9e3779b9)) >>> 0);
  assert.notEqual(deriveUserSeed(42, 0), deriveUserSeed(42, 4));
});
