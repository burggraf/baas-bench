import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const moduleUrl = new URL('../benchmark-sets/realworld-api-v4/shared/lib/progress.mjs', import.meta.url);

test('progress heartbeats preserve activity age, count stage work, and stop their timer', async () => {
  const { createProgress } = await import(moduleUrl);
  const events = [];
  let time = 1000; let tick; let stopped = false;
  const progress = createProgress('runner', { now: () => time, emit: event => events.push(event), schedule: fn => { tick = fn; return 1; }, cancel: () => { stopped = true; } });
  progress.phase('measure', { stage_users: 100, duration_ms: 300000, completed_operations: 0 });
  time = 2000;
  progress.count({ completed_operations: 12 });
  time = 16000; tick();
  assert.equal(events.at(-1).elapsed_ms, 15000);
  assert.equal(events.at(-1).completed_operations, 12);
  assert.equal(events.at(-1).last_activity_at, 2000);
  assert.equal(events.at(-1).kind, 'heartbeat');
  progress.phase('telemetry-drain', { telemetry_samples: 20, telemetry_expected: 300 });
  assert.equal(events.at(-1).completed_operations, undefined);
  progress.stop(); assert.equal(stopped, true);
});

test('bounded progress decoding rejects secrets and survives split or oversized lines', async () => {
  const { progressDecoder, encodeProgress } = await import(moduleUrl);
  const events = [];
  const consume = progressDecoder(event => events.push(event));
  const line = encodeProgress({ source: 'runner', phase: 'measure', kind: 'heartbeat', updated_at: 1000, last_activity_at: 900, elapsed_ms: 100 });
  consume(line.slice(0, 10)); consume(line.slice(10));
  consume('V4_PROGRESS {"source":"runner","phase":"measure","password":"secret"}\n');
  consume('x'.repeat(10000)); consume('\n'); consume(line);
  assert.equal(events.length, 2);
  assert.throws(() => encodeProgress({ source: 'runner', phase: 'measure', password: 'secret' }), /invalid progress/);
});

test('local status distinguishes stale runner heartbeat from live controller', async () => {
  const { createProgressStore, progressStatus } = await import(moduleUrl);
  const root = await mkdtemp(join(tmpdir(), 'v4-progress-'));
  try {
    const path = join(root, 'progress.json');
    let time = 1000;
    const store = createProgressStore(path, 'obs-test123', { now: () => time, log: () => {} });
    store.receive({ source: 'runner', phase: 'measure', kind: 'heartbeat', updated_at: 1000, last_activity_at: 1000, elapsed_ms: 0 });
    time = 61000;
    store.receive({ source: 'controller', phase: 'benchmark', kind: 'heartbeat', updated_at: time, last_activity_at: 1000, elapsed_ms: 60000 });
    const status = progressStatus(JSON.parse(await readFile(path, 'utf8')), time);
    assert.equal(status.sources.runner.stale, true);
    assert.equal(status.sources.controller.stale, false);
    assert.equal(status.sources.runner.received_age_seconds, 60);
    assert.match(status.warnings.join(' '), /runner heartbeat is stale/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const cli = spawnSync(process.execPath, ['bin/bench-v4-linode.mjs', 'status', join(root, 'inventory.json')], { encoding: 'utf8', env: { ...process.env, LINODE_TOKEN: '' } });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).run_id, 'obs-test123');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runner reports measurement, telemetry drain, and outcome with operation counters', async () => {
  const { executeRun } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
  const { createProgress } = await import(moduleUrl);
  const root = await mkdtemp(join(tmpdir(), 'v4-stage-progress-'));
  const events = []; let time = 0;
  const progress = createProgress('runner', { now: () => ++time, emit: event => events.push(event), schedule: () => 1, cancel: () => {} });
  try {
    const raw = await executeRun({ platform: 'supabase', phase: 'measure', trial: 1, outputDir: root, warmupMs: 0, stageMs: 1000 }, {
      progress, adapter: { fixture: {}, users: Array.from({ length: 50 }, () => ({})) },
      correctness: async () => ({ aborted: false, findings: [{ passed: true }] }),
      workload: async (_backend, _config, options) => {
        options.onProgress?.('prepare-sessions', { prepared_users: options.users.length });
        await options.onMeasuredStart?.();
        if (options.durationMs) {
          for (const type of ['remote', 'workflow']) options.onSample({ type, name: 'dashboard', workflow: 'dashboard', operationClass: 'read', kind: 'read', success: true, elapsedMs: 1 });
        }
        await options.onMeasuredEnd?.();
        options.onProgress?.('close-sessions');
        return { startedUsers: options.users.length, stageFailed: false, failureReasons: [] };
      },
      collectResources: async options => { options.onProgress(1); return { samples: [], valid: true }; },
      nextStage: ({ measuredUsers }) => measuredUsers.length ? null : 5,
      evaluateCapacity: () => ({ selectedCapacityUsers: 5, saturation: false, stages: [{ requestedUsers: 5, passed: true, invalid: false }], reasons: [] }),
      monotonic: () => (time += 1000),
    });
    const done = events.find(event => event.phase === 'stage-complete');
    assert.equal(done.outcome, 'pass');
    assert.equal(done.completed_operations, 1);
    assert.equal(done.completed_workflows, 1);
    assert.equal(done.telemetry_samples, 1);
    assert.ok(events.some(event => event.phase === 'telemetry-drain'));
    assert.equal(raw.stages[0].workload.stageFailed, false);
    assert.equal(events.at(-1).phase, 'complete');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('remote transport forwards only progress, not arbitrary stderr, over its existing pipe', async () => {
  const { encodeProgress } = await import(moduleUrl);
  const remoteModule = new URL('../benchmark-sets/realworld-api-v4/shared/lib/remote-execution.mjs', import.meta.url);
  const event = { source: 'runner', phase: 'measure', kind: 'heartbeat', updated_at: 1000, last_activity_at: 1000, elapsed_ms: 0 };
  const script = `import { runLongCommand } from ${JSON.stringify(remoteModule.href)};
    await runLongCommand(process.execPath, ['-e', ${JSON.stringify(`process.stderr.write('password=secret\\n'); process.stderr.write(${JSON.stringify(encodeProgress({ ...event, source: 'controller' }))}); process.stderr.write(${JSON.stringify(encodeProgress(event))});`)}], { timeoutMs: 5000 });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, BAAS_BENCH_V4_PROGRESS_FD: '2' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, encodeProgress(event));
});

test('benchmark lifecycle progress is opt-in and restricted to V4', async () => {
  const shell = await readFile(new URL('../bin/bench', import.meta.url), 'utf8');
  assert.match(shell, /\[ "\$\{SET_ID:-\}" = realworld-api-v4 \]/);
  assert.match(shell, /\[ "\$\{BAAS_BENCH_V4_PROGRESS_FD:-\}" = 3 \]/);
  assert.match(shell, /bench_progress backend-start/);
  assert.match(shell, /bench_progress backend-stop/);
  assert.match(shell, /bench_progress "\$name"/);
});

test('runBench receives live progress on its separate descriptor without changing evidence stdout', async () => {
  const { runBench } = await import('../benchmark-sets/realworld-api-v4/shared/lib/bench-execution.mjs');
  const { encodeProgress } = await import(moduleUrl);
  const root = await mkdtemp(join(tmpdir(), 'v4-progress-bench-'));
  try {
    await mkdir(join(root, 'bin'));
    const event = { source: 'runner', phase: 'measure', kind: 'heartbeat', updated_at: 1000, last_activity_at: 1000, elapsed_ms: 0 };
    const argsPath = join(root, 'args');
    await writeFile(join(root, 'bin/bench'), `#!/bin/sh\nprintf '%s' '${encodeProgress(event)}' >&3\nprintf '%s' \"$*\" > '${argsPath}'\nprintf '/tmp/evidence\\n'\n`, { mode: 0o700 });
    const events = [];
    const path = await runBench({ repositoryRoot: root, platform: 'trailbase', timeoutMs: 5000, onProgress: event => events.push(event) });
    assert.equal(path, '/tmp/evidence');
    assert.match(await readFile(argsPath, 'utf8'), /run realworld-api-v4 project-management-capacity trailbase javascript-sdk/);
    assert.deepEqual(events, [event]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
