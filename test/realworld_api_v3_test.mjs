import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const setRoot = new URL('../benchmark-sets/realworld-api-v3/', import.meta.url);
const benchmarkRoot = new URL('benchmarks/project-management-capacity/', setRoot);
const platforms = ['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon'];

function text(relative, root = setRoot) {
  return readFileSync(new URL(relative, root), 'utf8');
}

test('real-world API capacity scaffold declares its lifecycle and metrics', () => {
  assert.match(text('set.conf'), /^id=realworld-api-v3$/m);
  assert.doesNotMatch(text('README.md'), /TODO/);
  const config = text('benchmark.conf', benchmarkRoot);
  assert.match(config, /^primary_metric=capacity_users$/m);
  assert.match(config, /^primary_unit=users$/m);
  assert.match(config, /^primary_direction=higher$/m);
  assert.match(config, /^warmup_trials=0$/m);
  assert.match(config, /^measured_trials=1$/m);
  const required = config.match(/^required_metrics=(.+)$/m)?.[1].split(',') ?? [];
  assert.deepEqual(required, [
    'capacity_bounded', 'achieved_users_at_capacity', 'workflow_tps_at_capacity',
    'remote_operations_per_second_at_capacity', 'read_latency_p95_ms_at_capacity',
    'write_latency_p95_ms_at_capacity', 'auth_search_latency_p95_ms_at_capacity',
    'read_error_rate_at_capacity', 'write_error_rate_at_capacity',
    'auth_search_error_rate_at_capacity',
  ]);
  assert.doesNotMatch(text('METHODOLOGY.md', benchmarkRoot), /TODO/);
  readFileSync(new URL('fixtures/.gitkeep', benchmarkRoot));
});

test('all eight cases expose valid thin lifecycle hooks', () => {
  for (const platform of platforms) {
    const variant = platform === 'neon' ? 'javascript-sql-http' : 'javascript-sdk';
    const caseRoot = new URL(`cases/${platform}/${variant}/`, benchmarkRoot);
    const config = text('case.conf', caseRoot);
    assert.match(config, new RegExp(`^platform=${platform}$`, 'm'));
    assert.match(config, new RegExp(`^variant=${variant}$`, 'm'));
    assert.doesNotMatch(config, /TODO/);
    assert.doesNotMatch(text('README.md', caseRoot), /TODO/);
    for (const action of ['setup', 'verify', 'reset', 'run', 'teardown']) {
      const hook = new URL(`${action}.sh`, caseRoot);
      accessSync(hook, constants.X_OK);
      assert.match(readFileSync(hook, 'utf8'), new RegExp(`shared/case\\.sh" ${action} ${platform}$`, 'm'));
    }
  }
  assert.match(text('cases/neon/javascript-sql-http/case.conf', benchmarkRoot), /^access_path=sql-over-http$/m);
  assert.match(text('cases/neon/javascript-sql-http/case.conf', benchmarkRoot), /^client=@neondatabase\/serverless@1\.1\.0$/m);
});

test('dataset streams exactly one million deterministic valid records', async () => {
  const { DATASET_COUNTS, TOTAL_APPLICATION_RECORDS, seedDataset } = await import(
    '../benchmark-sets/realworld-api-v3/shared/lib/dataset.mjs'
  );
  assert.deepEqual(DATASET_COUNTS, {
    organizations: 1_600,
    users: 16_000,
    memberships: 16_000,
    projects: 8_000,
    tasks: 160_000,
    comments: 479_200,
    activities: 319_200,
  });
  assert.equal(TOTAL_APPLICATION_RECORDS, 1_000_000);

  async function digest() {
    const counts = {};
    const hash = createHash('sha256');
    let batches = 0;
    for await (const batch of seedDataset(42, 997)) {
      assert.ok(batch.records.length > 0 && batch.records.length <= 997);
      const countName = batch.entity === 'activity' ? 'activities' : `${batch.entity}s`;
      counts[countName] = (counts[countName] ?? 0) + batch.records.length;
      hash.update(JSON.stringify(batch.records[0]));
      hash.update(JSON.stringify(batch.records.at(-1)));
      batches += 1;
    }
    return { counts, hash: hash.digest('hex'), batches };
  }

  const first = await digest();
  const second = await digest();
  assert.deepEqual(first.counts, DATASET_COUNTS);
  assert.deepEqual(second, first);
  assert.ok(first.batches > 1_000);
});

test('dataset IDs, roles, references, and virtual-user contexts are stable', async () => {
  const { DATASET_COUNTS, buildVirtualUserSpecs, entityId, membershipRole, seedDataset } = await import(
    '../benchmark-sets/realworld-api-v3/shared/lib/dataset.mjs'
  );
  const ids = new Set();
  for (const [entity, limit] of Object.entries({ organization: 1_600, user: 16_000, membership: 16_000, project: 8_000, task: 160_000, comment: 479_200, activity: 319_200 })) {
    for (const ordinal of [0, limit - 1]) {
      const id = entityId(entity, ordinal);
      assert.match(id, /^[a-z0-9]+$/);
      assert.equal(ids.has(id), false);
      ids.add(id);
    }
  }
  assert.equal(membershipRole(0), 'owner');
  assert.equal(membershipRole(DATASET_COUNTS.organizations), 'admin');
  assert.equal(membershipRole(DATASET_COUNTS.organizations * 2), 'member');

  const sample = [];
  for await (const batch of seedDataset(42, 1)) {
    sample.push(batch.records[0]);
    if (sample.length === 7) break;
  }
  assert.equal(sample[0].id, entityId('user', 0));

  const users = buildVirtualUserSpecs(10_000, 42);
  assert.equal(users.length, 10_000);
  assert.deepEqual(users, buildVirtualUserSpecs(10_000, 42));
  assert.ok(users.every((user) => user.credentials.email.endsWith('@example.test') && user.credentials.password && user.organizationId && user.projectId && user.taskId));
  assert.throws(() => buildVirtualUserSpecs(16_001, 42), /exceed/);
});

test('Supabase adapter exports runtime backend and supports dashboard', async () => {
  const { createBackend } = await import('../benchmark-sets/realworld-api-v3/shared/lib/adapters/supabase.mjs');
  assert.equal(typeof createBackend, 'function');
  const rows = {
    organizations: [{ id: 'org', name: 'Org', owner_id: 'usr', created_at: '2025-01-01' }],
    projects: [{ id: 'prj', organization_id: 'org', name: 'Project', status: 'active', created_at: '2025-01-01', updated_at: '2025-01-01' }],
    activities: [{ id: 'act', organization_id: 'org', project_id: 'prj', actor_id: 'usr', action: 'created', subject_type: 'task', subject_id: 'tsk', created_at: '2025-01-01' }],
  };
  const client = { from(table) { return { select() { return { eq(field, value) { this.value = value; return this; }, single() { return Promise.resolve({ data: rows[table][0], error: null }); }, order() { return this; }, range() { return Promise.resolve({ data: rows[table], count: rows[table].length, error: null }); }, then(resolve) { return Promise.resolve({ data: rows[table], error: null }).then(resolve); } }; }, update() { return { eq() { return this; }, select() { return { single: async () => ({ data: null, error: null }) }; } }; } }; } };
  const backend = createBackend({ client });
  const value = await backend.dashboard({ organizationId: 'org', projectId: 'prj', activityPage: { page: 0, pageSize: 10 } });
  assert.equal(value.organization.id, 'org');
  assert.equal(value.projects[0].organizationId, 'org');
});

test('Supabase adapter propagates abort signals to query builders and updateTask', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v3/shared/lib/adapters/supabase.mjs');
  const signals = [];
  const builder = { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return this; }, then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); }, abortSignal(signal) { signals.push(signal); return this; } };
  const client = { from() { return { ...builder, update() { return { eq() { return this; }, select() { return { single: async () => ({ data: null, error: null }) }; } }; } }; } };
  const adapter = createSupabaseAdapter({ client });
  const signal = new AbortController().signal;
  await adapter.listTasks({ organizationId: 'org', projectId: 'prj', signal });
  await assert.rejects(adapter.updateTask({ organizationId: 'org', projectId: 'prj', taskId: 'tsk', title: 'x', signal }), /malformed|Supabase|Cannot/);
  assert.ok(signals.includes(signal));
});

test('Supabase adapter enforces request timeout', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v3/shared/lib/adapters/supabase.mjs');
  const pending = { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return this; }, then() { return new Promise(() => {}); } };
  const adapter = createSupabaseAdapter({ client: { from() { return pending; } }, timeoutMs: 5 });
  await assert.rejects(adapter.listTasks({ organizationId: 'org', projectId: 'prj' }), /timed out/);
});

test('Supabase adapter maps PostgREST rows and enforces tenant-bound pagination', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v3/shared/lib/adapters/supabase.mjs');
  const calls = [];
  const builder = {
    select(fields) { calls.push(['select', fields]); return this; },
    eq(field, value) { calls.push(['eq', field, value]); return this; },
    order(field, options) { calls.push(['order', field, options]); return this; },
    range(from, to) { calls.push(['range', from, to]); return Promise.resolve({ data: [{ id: 'tsk', organization_id: 'org', project_id: 'prj', creator_id: 'usr', assignee_id: null, title: 't', description: 'd', status: 'todo', priority: 'low', due_date: null, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' }], count: 1, error: null }); },
  };
  const client = { from(table) { calls.push(['from', table]); return builder; } };
  const adapter = createSupabaseAdapter({ client, timeoutMs: 1000 });
  const page = await adapter.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  assert.equal(page.items[0].projectId, 'prj');
  assert.equal(page.total, 1);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org'));
  assert.ok(calls.some(call => call[0] === 'order' && call[1] === 'created_at'));
  await assert.rejects(adapter.listTasks({ organizationId: 'org', projectId: 'foreign', page: 0, pageSize: 10 }), /tenant|boundary/i);
});

test('Supabase .env key lookup parses LF and CRLF files', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readKey } = await import('../benchmark-sets/realworld-api-v3/shared/lib/adapters/supabase.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'supabase-env-'));
  try {
    for (const newline of ['\n', '\r\n']) {
      const path = join(dir, `env-${newline === '\n' ? 'lf' : 'crlf'}`);
      await writeFile(path, `OTHER=no${newline}SUPABASE_PUBLISHABLE_KEY=test-key${newline}`);
      assert.equal(await readKey(path, 'SUPABASE_PUBLISHABLE_KEY'), 'test-key');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Supabase adapter maps auth sessions and profile rows without admin APIs', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v3/shared/lib/adapters/supabase.mjs');
  let authOptions;
  const auth = { signInWithPassword: async (_credentials, options) => { authOptions = options; return { data: { session: { access_token: 'token' } }, error: null }; }, getUser: async () => ({ data: { user: { id: 'usr', email: 'u@example.test', user_metadata: { display_name: 'User' }, created_at: '2025-01-01', updated_at: '2025-01-01' } }, error: null }), signOut: async () => ({ error: null }) };
  const queryBuilder = { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return Promise.resolve({ data: [], count: 0, error: null }); }, insert() { return this; }, update() { return this; }, single() { return Promise.resolve({ data: null, error: null }); } };
  const adapter = createSupabaseAdapter({ client: { auth, from() { return queryBuilder; } } });
  const signal = new AbortController().signal;
  const session = await adapter.createSession({ email: 'u@example.test', password: 'secret' }, { signal, timeoutMs: 1000 });
  assert.equal(authOptions.signal, signal);
  for (const method of ['dashboard', 'listTasks', 'getTask', 'createTask', 'updateTask', 'addComment', 'updateComment', 'searchTasks', 'updateMembershipRole', 'getProfile', 'updateProfile', 'signOut', 'cancelPending', 'close']) assert.equal(typeof session[method], 'function', method);
  assert.equal((await session.getProfile()).id, 'usr');
  assert.deepEqual(await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 }), { items: [], page: 0, pageSize: 10, total: 0, hasNext: false });
  await session.signOut();
});

test('Supabase session timeout is per request, not session-wide', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v3/shared/lib/adapters/supabase.mjs');
  const user = { id: 'usr', email: 'u@example.test', user_metadata: { display_name: 'User' }, created_at: '2025-01-01', updated_at: '2025-01-01' };
  const auth = { signInWithPassword: async () => ({ data: { session: { access_token: 'token' } }, error: null }), getUser: async () => ({ data: { user }, error: null }) };
  const adapter = createSupabaseAdapter({ client: { auth }, timeoutMs: 30 });
  const session = await adapter.createSession({ email: user.email, password: 'secret' }, { timeoutMs: 5 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await session.getProfile()).id, 'usr');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await session.getProfile()).id, 'usr');
  const slow = { then() { return new Promise(() => {}); } };
  const timeoutAdapter = createSupabaseAdapter({ client: { from() { return { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return slow; } }; } }, timeoutMs: 5 });
  await assert.rejects(timeoutAdapter.listTasks({ organizationId: 'org', projectId: 'prj' }), /timed out/);
});

test('workflow selection follows the approved application mix', async () => {
  const { selectWorkflow } = await import('../benchmark-sets/realworld-api-v3/shared/lib/workflows.mjs');
  const weights = { dashboard: 20, taskList: 25, taskDetail: 15, createTask: 10, updateTask: 12, addComment: 10, search: 5, profileUpdate: 1, signIn: 2 };
  const cases = [[0, 'dashboard'], [.2, 'taskList'], [.45, 'taskDetail'], [.6, 'createTask'], [.7, 'updateTask'], [.82, 'addComment'], [.92, 'search'], [.97, 'profileUpdate'], [.98, 'signIn'], [1, 'signIn']];
  for (const [value, expected] of cases) assert.equal(selectWorkflow(weights, () => value), expected);
  assert.throws(() => selectWorkflow({ ...weights, signIn: 1 }, () => 0), /total 100/);
});

test('workflow and remote measurements are separate and reject boundary leakage', async () => {
  const { measureRemoteCall, withRemoteMeasurement } = await import('../benchmark-sets/realworld-api-v3/shared/lib/measurement.mjs');
  const { runWorkflow } = await import('../benchmark-sets/realworld-api-v3/shared/lib/workflows.mjs');
  const samples = [];
  let now = 0;
  await withRemoteMeasurement({ name: 'listTasks', workflow: 'taskList', operationClass: 'read', kind: 'read', now: () => ++now, sample: (sample) => samples.push(sample) }, () => measureRemoteCall(async () => []));
  assert.equal(samples.length, 1);
  assert.equal(samples[0].type, 'remote');

  const context = {
    session: { listTasks: async () => ({ items: [], page: 0, pageSize: 10, total: 0, hasNext: false }) },
    workflow: 'taskList', organizationId: 'org', projectId: 'project', taskId: 'task',
    random: () => 0, pageSize: () => 10, now: () => ++now,
    invoke: (_name, _operationClass, _kind, action) => action(),
    sample: (sample) => samples.push(sample), replaceSession: async () => {},
  };
  await runWorkflow('taskList', context);
  assert.equal(samples.at(-1).type, 'workflow');
  context.session.listTasks = async () => ({ items: [{ id: 'task', projectId: 'foreign', creatorId: 'user', assigneeId: null, title: 't', description: 'd', status: 'todo', priority: 'low', dueDate: null, createdAt: 'x', updatedAt: 'x' }], page: 0, pageSize: 10, total: 1, hasNext: false });
  await assert.rejects(runWorkflow('taskList', context), /boundary/);

  context.session.dashboard = async () => ({
    organization: { id: 'org' }, projects: [],
    recentActivity: [{ id: 'activity', organizationId: 'foreign', projectId: null, actorId: 'user', action: 'created', subjectType: 'task', subjectId: 'task', createdAt: 'x' }],
  });
  await assert.rejects(runWorkflow('dashboard', context), /boundary/);
});

test('metrics keep workflow and remote calls separate and use nearest-rank p95', async () => {
  const { StageMetricsAccumulator } = await import('../benchmark-sets/realworld-api-v3/shared/lib/metrics.mjs');
  const metrics = new StageMetricsAccumulator();
  for (let elapsedMs = 1; elapsedMs <= 20; elapsedMs += 1) {
    metrics.record({ type: 'workflow', name: 'dashboard', workflow: 'dashboard', operationClass: 'read', kind: 'read', elapsedMs, success: true });
    metrics.record({ type: 'remote', name: 'dashboard', workflow: 'dashboard', operationClass: 'read', kind: 'read', elapsedMs: 1, success: true });
  }
  const stage = metrics.finalize(10, { requestedUsers: 5, achievedUsers: 5 });
  assert.equal(stage.workflowTransactionsPerSecond, 2);
  assert.equal(stage.remoteOperationsPerSecond, 2);
  assert.equal(stage.operationClassMetrics.read.latencyP95Ms, 19);
});

test('capacity stages follow the approved doubling and bounded refinement', async () => {
  const { nextCapacityStage } = await import('../benchmark-sets/realworld-api-v3/shared/lib/capacity.mjs');
  assert.equal(nextCapacityStage({ measuredUsers: [] }), 5);
  assert.equal(nextCapacityStage({ measuredUsers: [5] }), 10);
  assert.equal(nextCapacityStage({ measuredUsers: [5, 10] }), 25);
  assert.equal(nextCapacityStage({ measuredUsers: [5, 10, 25] }), 50);
  assert.equal(nextCapacityStage({ measuredUsers: [5, 10, 25, 50] }), 100);
  assert.equal(nextCapacityStage({ measuredUsers: [5, 10, 25, 50, 6_400] }), 10_000);
  assert.equal(nextCapacityStage({ measuredUsers: [5, 10, 25, 50, 100], lowerPass: 50, upperFailure: 100, refinements: 0 }), 75);
  assert.equal(nextCapacityStage({ measuredUsers: [5, 10, 25, 50, 51], lowerPass: 50, upperFailure: 51, refinements: 1 }), null);
  assert.equal(nextCapacityStage({ measuredUsers: [5, 10, 25, 50, 75, 100], lowerPass: 50, upperFailure: 100, refinements: 4 }), null);
});

test('workload prepares outside measurement and closes each session once', async () => {
  const { runWorkload, SESSION_PREPARATION_CONCURRENCY } = await import('../benchmark-sets/realworld-api-v3/shared/lib/workload.mjs');
  assert.equal(SESSION_PREPARATION_CONCURRENCY, 10);
  const events = [];
  let closes = 0;
  const session = { cancelPending() {}, async close() { closes += 1; } };
  const backend = { async createSession() { events.push('prepare'); return session; } };
  const config = {
    seed: 42, stageSeconds: 1, timeoutMs: 5_000, thinkTimeMs: { min: 1_000, max: 5_000 },
    weights: { dashboard: 20, taskList: 25, taskDetail: 15, createTask: 10, updateTask: 12, addComment: 10, search: 5, profileUpdate: 1, signIn: 2 },
  };
  const result = await runWorkload(backend, config, {
    users: [{ credentials: { email: 'user@example.test', password: 'secret' }, organizationId: 'org', projectId: 'project', taskId: 'task' }],
    durationMs: 0, graceMs: 0, now: () => 0, sleep: async () => {},
    onMeasuredStart: () => events.push('start'), onMeasuredEnd: () => events.push('end'),
  });
  assert.deepEqual(events, ['prepare', 'start', 'end']);
  assert.equal(result.startedUsers, 1);
  assert.equal(closes, 1);
});

test('operation errors are classified and credentials are redacted and bounded', async () => {
  const { BenchmarkOperationError, classifyOperationError } = await import('../benchmark-sets/realworld-api-v3/shared/lib/correctness.mjs');
  const { safeErrorDetails } = await import('../benchmark-sets/realworld-api-v3/shared/lib/errors.mjs');
  assert.equal(classifyOperationError({ status: 401 }), 'authentication');
  assert.equal(classifyOperationError({ status: 403 }), 'authorization');
  assert.equal(classifyOperationError({ code: 'timeout' }), 'timeout');
  assert.equal(classifyOperationError(new BenchmarkOperationError('invalid_response')), 'invalid_response');
  const secret = 'credential-value';
  const details = safeErrorDetails(new Error(`password=${secret} Bearer aaa.bbb.ccc ${'x'.repeat(500)}`), [secret]);
  assert.doesNotMatch(details.message, /credential-value|aaa\.bbb\.ccc/);
  assert.ok(details.message.length <= 300);
});

test('resources select compose project containers and sum docker stats', async () => {
  const { discoverPlatformContainers, parseDockerStats } = await import('../benchmark-sets/realworld-api-v3/shared/lib/resources.mjs');
  const calls = [];
  const ids = await discoverPlatformContainers('supabase', async (command, args) => {
    calls.push([command, args]);
    return { stdout: 'aaaaaaaaaaaa\nbbbbbbbbbbbb\n', stderr: '' };
  });
  assert.deepEqual(calls, [['docker', ['compose', '-p', 'baas-supabase', 'ps', '-q']]]);
  assert.deepEqual(ids, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  await assert.rejects(discoverPlatformContainers('supabase', async () => ({ stdout: '' })), /no compose containers/);
  const stats = parseDockerStats('{"ID":"aaaaaaaaaaaa","CPUPerc":"12.5%","MemUsage":"1.5MiB / 2GiB"}\n{"ID":"bbbbbbbbbbbb","CPUPerc":"7.5%","MemUsage":"512KiB / 2GiB"}\n', new Set(ids));
  assert.equal(stats.cpuPercent, 20);
  assert.equal(stats.memoryBytes, 2 * 1024 * 1024);
});

test('resources sample complete one-second windows and detect sustained overload per metric', async () => {
  const { collectResources, evaluateRunnerOverload } = await import('../benchmark-sets/realworld-api-v3/shared/lib/resources.mjs');
  let cpuMicros = 0;
  let now = 0;
  let resets = 0;
  const sleeps = [];
  const monitor = { enable() {}, disable() {}, reset() { resets++; }, percentile() { return 0; }, max: 0 };
  const result = await collectResources({
    platform: 'neon', containerIds: [], samples: 3, intervalMs: 1_000,
    now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; },
    cpuUsage: () => ({ user: (cpuMicros += 950_000), system: 0 }),
    memoryUsage: () => ({ rss: 100 }), monitorFactory: () => monitor,
  });
  assert.deepEqual(sleeps, [1_000, 1_000, 1_000]);
  assert.deepEqual(result.samples.map(sample => sample.timestampMs), [1_000, 2_000, 3_000]);
  assert.ok(result.samples.every(sample => sample.runner.cpuPercent === 95));
  assert.equal(resets, 3);
  assert.match(evaluateRunnerOverload(result.samples), /three consecutive/);

  const mixed = [
    { runner: { cpuPercent: 91 }, eventLoop: { p99Ms: 0, maxMs: 0 } },
    { runner: { cpuPercent: 0 }, eventLoop: { p99Ms: 101, maxMs: 0 } },
    { runner: { cpuPercent: 0 }, eventLoop: { p99Ms: 0, maxMs: 251 } },
  ];
  assert.equal(evaluateRunnerOverload(mixed), null);
});

test('resource collection invalidates missing and failed container probes', async () => {
  const { collectResources } = await import('../benchmark-sets/realworld-api-v3/shared/lib/resources.mjs');
  const base = {
    platform: 'supabase', containerIds: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'], samples: 1,
    intervalMs: 1_000, sleep: async () => {}, now: (() => { let now = 0; return () => (now += 1_000); })(),
    cpuUsage: () => ({ user: 0, system: 0 }), memoryUsage: () => ({ rss: 1 }),
    monitorFactory: () => ({ enable() {}, disable() {}, reset() {}, percentile: () => 0, max: 0 }),
  };
  const missing = await collectResources({ ...base, command: async () => ({ stdout: '{"ID":"aaaaaaaaaaaa","CPUPerc":"1%","MemUsage":"1MiB / 2GiB"}' }) });
  assert.equal(missing.valid, false);
  assert.match(missing.validityReasons.join(' '), /missing container telemetry/);
  const failed = await collectResources({ ...base, command: async () => { throw new Error('docker unavailable'); } });
  assert.equal(failed.valid, false);
  assert.match(failed.validityReasons.join(' '), /docker unavailable/);
  const signal = { aborted: false };
  const incomplete = await collectResources({ ...base, containerIds: [], samples: 2, signal, sleep: async () => { signal.aborted = true; } });
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.validityReasons.join(' '), /incomplete/);
});

function passingStage(users) {
  const metric = { attempted: 20, completed: 20, failed: 0, errorRate: 0, latencyP50Ms: 1, latencyP95Ms: 1, latencyP99Ms: 1, latencyMinMs: 1, latencyMaxMs: 1 };
  return { requestedUsers: users, achievedUsers: users, elapsedSeconds: 1, workflowTransactionsPerSecond: users, remoteOperationsPerSecond: users * 2, readOperationsPerSecond: users, writeOperationsPerSecond: users, operationClassMetrics: { read: metric, write: metric, authSearch: metric }, valid: true, validityReasons: [], errorExamples: [] };
}

test('runner performs correctness before warm-up, keeps warm-up writes, and follows adaptive decisions', async () => {
  const { executeRun } = await import('../benchmark-sets/realworld-api-v3/shared/lib/run.mjs');
  const outputDir = await mkdtemp(join(tmpdir(), 'rw-runner-'));
  const events = [];
  try {
    await executeRun({ platform: 'neon', phase: 'measure', trial: 1, outputDir, accessPath: 'sql-over-http', deviations: ['auth emulated'], warmupMs: 1, stageMs: 1 }, {
      adapter: { users: Array.from({ length: 100 }, (_, i) => ({ i })), fixture: {} },
      correctness: async () => { events.push('correctness'); return { findings: [{ passed: true }] }; },
      reset: async () => { events.push('reset'); },
      workload: async (_adapter, _config, options) => {
        const users = options.users.length;
        events.push(users === 50 && !events.includes('stage:5') ? 'warmup-write' : `stage:${users}`);
        options.onMeasuredStart?.(); options.onSample?.({}); options.onMeasuredEnd?.();
        return { startedUsers: users, lostUsers: 0, stageFailed: false };
      },
      metricsFactory: () => ({ record() {}, finalize(_elapsed, counts) { return passingStage(counts.requestedUsers); } }),
      collectResources: async () => ({ samples: Array.from({ length: 3 }, () => ({ runner: { cpuPercent: 95 }, eventLoop: { p99Ms: 0, maxMs: 0 } })), valid: true, validityReasons: [] }),
      evaluateCapacity: (stages, config) => {
        assert.equal(config.slos.read.p95Ms, 500);
        assert.equal(config.slos.write.p95Ms, 750);
        assert.equal(config.slos.authSearch.p95Ms, 1_000);
        return { selectedCapacityUsers: stages.at(-1).requestedUsers, stages: stages.map(stage => ({ requestedUsers: stage.requestedUsers, passed: true, invalid: false, reasons: [] })), reasons: [], saturation: false };
      },
      nextStage: ({ measuredUsers }) => [5, 10, 25][measuredUsers.length] ?? null,
      monotonic: (() => { let n = 0; return () => ++n * 1000; })(),
    });
    assert.deepEqual(events, ['correctness', 'warmup-write', 'stage:5', 'stage:10', 'stage:25']);
    assert.equal(events.filter(event => event === 'correctness').length, 1);
    const raw = JSON.parse(readFileSync(join(outputDir, 'raw.json'), 'utf8'));
    assert.equal(statSync(outputDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(outputDir, 'raw.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(outputDir, 'summary.json')).mode & 0o777, 0o600);
    assert.deepEqual(raw.stages.map(stage => stage.requestedUsers), [5, 10, 25]);
    assert.ok(raw.stages.every(stage => !stage.valid && stage.validityReasons.some(reason => reason.includes('runner overload'))));
    assert.ok(Array.isArray(raw.resources));
    assert.equal(raw.accessPath, 'sql-over-http');
    assert.deepEqual(raw.deviations, ['auth emulated']);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('summary contains every fixed numeric metric and zeroes without a passing stage', async () => {
  const { summarize, FIXED_METRICS } = await import('../benchmark-sets/realworld-api-v3/shared/lib/summary.mjs');
  const summary = summarize([], { selectedCapacityUsers: 0, stages: [], saturation: false });
  assert.deepEqual(Object.keys(summary.metrics).sort(), [...FIXED_METRICS].sort());
  assert.ok(Object.values(summary.metrics).every(value => typeof value === 'number' && value === 0));
});

test('runner overload invalidates attribution and every primary failure survives teardown failure', async () => {
  const { preservePrimaryFailure } = await import('../benchmark-sets/realworld-api-v3/shared/lib/run.mjs');
  await assert.rejects(preservePrimaryFailure(async () => 'ok', async () => { throw new Error('teardown only'); }), /teardown only/);
  const primary = new Error('primary');
  await assert.rejects(preservePrimaryFailure(async () => { throw primary; }, async () => { throw new Error('teardown'); }), error => error === primary && error.teardownError === 'teardown');
  const frozen = Object.freeze(new Error('frozen primary'));
  await assert.rejects(preservePrimaryFailure(async () => { throw frozen; }, async () => { throw new Error('teardown'); }), error => error === frozen);
  await assert.rejects(preservePrimaryFailure(async () => { throw 'primitive primary'; }, async () => { throw new Error('teardown'); }), error => error === 'primitive primary');
});

test('run discovery failures invalidate measured stages and artifacts bound errors', async () => {
  const { executeRun } = await import('../benchmark-sets/realworld-api-v3/shared/lib/run.mjs');
  const outputDir = await mkdtemp(join(tmpdir(), 'rw-discovery-'));
  try {
    await executeRun({ platform: 'supabase', phase: 'measure', trial: 1, outputDir, warmupMs: 0, stageMs: 1 }, {
      adapter: { users: Array.from({ length: 50 }, (_, i) => ({ i })), fixture: {} },
      correctness: async () => ({ findings: [{ passed: true }] }),
      workload: async (_adapter, _config, options) => {
        options.onMeasuredStart?.();
        for (let i = 0; i < 150; i++) options.onSample?.({ error: new Error(`token=secret-${i} ${'x'.repeat(400)}`) });
        options.onMeasuredEnd?.();
        return { startedUsers: options.users.length, lostUsers: 0, stageFailed: false };
      },
      metricsFactory: () => ({ record() {}, finalize(_elapsed, counts) { return { ...passingStage(counts.requestedUsers), errorExamples: Array.from({ length: 150 }, (_, i) => `token=secret-${i} ${'x'.repeat(400)}`) }; } }),
      collectResources: async () => ({ samples: [], valid: true, validityReasons: [] }),
      containerDiscoveryError: new Error('compose discovery unavailable'),
      evaluateCapacity: stages => ({ selectedCapacityUsers: 0, stages: stages.map(stage => ({ requestedUsers: stage.requestedUsers, invalid: true, passed: false })), reasons: [], saturation: false }),
      nextStage: ({ measuredUsers }) => measuredUsers.length ? null : 5,
      monotonic: (() => { let n = 0; return () => ++n; })(),
    });
    const raw = JSON.parse(readFileSync(join(outputDir, 'raw.json'), 'utf8'));
    assert.match(raw.stages[0].validityReasons.join(' '), /compose discovery unavailable/);
    assert.equal(raw.errors.length, 100);
    assert.ok(raw.errors.every(error => error.length <= 300 && !/secret-/.test(error)));
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('run argument orchestration preserves its primary failure when teardown also fails', async () => {
  const { runFromArguments } = await import('../benchmark-sets/realworld-api-v3/shared/lib/run.mjs');
  const outputDir = await mkdtemp(join(tmpdir(), 'rw-teardown-'));
  const primary = Object.freeze(new Error('correctness primary'));
  const events = [];
  try {
    await assert.rejects(runFromArguments(['neon', 'measure', '1', outputDir], {
      loadBackend: async platform => {
        events.push(`backend:${platform}`);
        return {
          async correctnessFixture() { events.push('fixture'); return {}; },
          async virtualUsers(count) { events.push(`users:${count}`); return Array.from({ length: 50 }, () => ({})); },
        };
      },
      discoverContainers: async () => [],
      correctness: async () => { throw primary; },
      teardown: async () => { throw new Error('teardown secondary'); },
    }), error => error === primary);
    assert.deepEqual(events, ['backend:neon', 'fixture', 'users:10000']);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('postgres admin schema provides tenant RLS, workload indexes, activity, reset, and app auth', async () => {
  const {
    APPLICATION_TABLES, CREATE_FIXTURE_STATE_SQL, RESET_FIXTURE_STATE_SQL,
    exactCountSql, loadSchemaText,
  } = await import('../benchmark-sets/realworld-api-v3/shared/lib/admin/postgres.mjs');
  assert.deepEqual(APPLICATION_TABLES, ['organizations', 'users', 'memberships', 'projects', 'tasks', 'comments', 'activities']);
  const schema = await loadSchemaText();
  const publicTables = [...schema.matchAll(/create table public\.(\w+)/gi)].map(match => match[1]);
  assert.deepEqual(publicTables.sort(), [...APPLICATION_TABLES].sort());
  for (const table of APPLICATION_TABLES) assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  assert.match(schema, /references public\.users\(id\)/i);
  assert.match(schema, /foreign key \(project_id, organization_id\) references public\.projects/i);
  assert.match(schema, /foreign key \(task_id, project_id, organization_id\) references public\.tasks/i);
  const indexes = {
    memberships_user_idx: 'user_id, organization_id',
    projects_organization_idx: 'organization_id, created_at, id',
    tasks_project_idx: 'organization_id, project_id, created_at, id',
    tasks_assignee_idx: 'organization_id, assignee_id',
    tasks_title_idx: null,
    comments_task_idx: 'organization_id, project_id, task_id, created_at, id',
    activities_organization_idx: 'organization_id, created_at desc, id desc',
  };
  for (const [index, columns] of Object.entries(indexes)) {
    if (columns) assert.match(schema, new RegExp(`create index ${index} on public\\.\\w+\\(${columns}\\)`, 'i'), `${index} columns/operator class`);
  }
  assert.match(schema, /create index tasks_title_idx on public\.tasks using gin\(title benchmark_extensions\.gin_trgm_ops\)/i);
  assert.match(schema, /request\.jwt\.claim\.sub/);
  assert.match(schema, /x-hasura-user-id/);
  assert.match(schema, /app\.user_id/);
  const policies = {
    organizations_member_read: 'is_member\\(id\\)',
    memberships_member_read: 'is_member\\(organization_id\\)',
    memberships_manager_write: 'is_manager\\(organization_id\\)',
    projects_member_read: 'is_member\\(organization_id\\)',
    tasks_member_read: 'is_member\\(benchmark_private\\.task_organization\\(tasks\\)\\)',
    comments_member_read: 'is_member\\(benchmark_private\\.comment_organization\\(comments\\)\\)',
    activities_member_read: 'is_member\\(organization_id\\)',
  };
  for (const [policy, predicate] of Object.entries(policies)) {
    const declaration = schema.match(new RegExp(`create policy ${policy}[^;]+`, 'i'))?.[0];
    assert.ok(declaration, `${policy} exists`);
    assert.match(declaration, new RegExp(predicate, 'i'), `${policy} tenant predicate`);
  }
  assert.match(schema, /create policy memberships_manager_write[\s\S]*?for update[\s\S]*?is_manager/i);
  assert.match(schema, /create policy tasks_member_insert[\s\S]*?creator_id = benchmark_private\.current_user_id/i);
  assert.match(schema, /create policy comments_member_insert[\s\S]*?author_id = benchmark_private\.current_user_id/i);
  const expectedPolicyCommands = [
    ['users_peer_read', 'users', 'select', 'using ( id = benchmark_private.current_user_id() or exists'],
    ['users_self_write', 'users', 'update', 'using (id = benchmark_private.current_user_id())', 'with check (id = benchmark_private.current_user_id())'],
    ['organizations_member_read', 'organizations', 'select', 'using (benchmark_private.is_member(id))'],
    ['memberships_member_read', 'memberships', 'select', 'using (benchmark_private.is_member(organization_id))'],
    ['memberships_manager_write', 'memberships', 'update', 'using (benchmark_private.is_manager(organization_id))', 'with check (benchmark_private.is_manager(organization_id))'],
    ['projects_member_read', 'projects', 'select', 'using (benchmark_private.is_member(organization_id))'],
    ['projects_manager_write', 'projects', 'all', 'using (benchmark_private.is_manager(organization_id))', 'with check (benchmark_private.is_manager(organization_id))'],
    ['tasks_member_read', 'tasks', 'select', 'using (benchmark_private.is_member(benchmark_private.task_organization(tasks)))'],
    ['tasks_member_insert', 'tasks', 'insert', 'with check (', 'creator_id = benchmark_private.current_user_id()'],
    ['tasks_member_update', 'tasks', 'update', 'using (benchmark_private.is_member(benchmark_private.task_organization(tasks)))', 'with check (benchmark_private.is_member(benchmark_private.task_organization(tasks)))'],
    ['tasks_member_delete', 'tasks', 'delete', 'using (benchmark_private.is_member(benchmark_private.task_organization(tasks)))'],
    ['comments_member_read', 'comments', 'select', 'using (benchmark_private.is_member(benchmark_private.comment_organization(comments)))'],
    ['comments_member_insert', 'comments', 'insert', 'with check (', 'author_id = benchmark_private.current_user_id()'],
    ['comments_member_update', 'comments', 'update', 'using (', 'with check (benchmark_private.is_member(benchmark_private.comment_organization(comments)))'],
    ['comments_member_delete', 'comments', 'delete', 'using (', 'benchmark_private.is_manager(benchmark_private.comment_organization(comments))'],
    ['activities_member_read', 'activities', 'select', 'using (benchmark_private.is_member(organization_id))'],
    ['activities_actor_insert', 'activities', 'insert', 'with check (', 'actor_id = benchmark_private.current_user_id()'],
  ];
  const policyStatements = [...schema.matchAll(/create policy [\s\S]*?;/gi)].map(match => match[0].toLowerCase().replaceAll(/\s+/g, ' '));
  assert.equal(policyStatements.length, expectedPolicyCommands.length, 'every application policy is declared exactly once');
  for (const [name, table, command, ...predicates] of expectedPolicyCommands) {
    const statement = policyStatements.find(value => value.includes(`create policy ${name} on public.${table} for ${command}`));
    assert.ok(statement, `${name} complete policy command`);
    for (const predicate of predicates) assert.ok(statement.includes(predicate), `${name} predicate ${predicate}`);
  }
  assert.match(schema, /create trigger tasks_activity after insert or update/i);
  assert.match(schema, /create trigger comments_activity after insert or update/i);
  const activity = schema.match(/create function benchmark_private\.log_workflow_activity[\s\S]*?\$\$;/i)?.[0] ?? '';
  assert.match(activity, /app_user text := benchmark_private\.current_user_id/);
  assert.match(activity, /if tg_table_name = 'comments'[\s\S]*?task_id := new\.task_id/i);
  assert.match(activity, /else[\s\S]*?task_id := new\.id[\s\S]*?project_id := new\.project_id/i);
  assert.match(activity, /organization_id/);
  assert.match(activity, /actor_id/);
  assert.match(activity, /values \(pg_catalog\.substr[\s\S]*?organization_id, project_id, app_user/i);
  assert.match(activity, /tg_table_name = 'comments'[\s\S]*?tg_op = 'INSERT' then 'commented' else 'comment_updated'/i);
  assert.match(activity, /tg_table_name = 'comments'[\s\S]*?else case when tg_op = 'INSERT' then 'created' else 'updated'/i);
  assert.match(activity, /'task', task_id, pg_catalog\.clock_timestamp\(\)/i);
  assert.match(schema, /create table benchmark_auth\.passwords/i);
  assert.match(schema, /create table benchmark_auth\.sessions/i);
  assert.match(schema, /create schema if not exists benchmark_extensions/i);
  assert.match(schema, /revoke all on schema benchmark_extensions from public/i);
  assert.match(schema, /create extension if not exists pgcrypto with schema benchmark_extensions/i);
  assert.match(schema, /create extension if not exists pg_trgm with schema benchmark_extensions/i);
  const definerFunctions = [
    'benchmark_private.log_workflow_activity',
    'benchmark_auth.sign_in',
    'benchmark_auth.validate_session',
    'benchmark_auth.sign_out',
  ];
  for (const functionName of definerFunctions) {
    const escapedName = functionName.replace('.', '\\.');
    const declaration = schema.match(new RegExp(`create function ${escapedName}\\([^)]*\\)[\\s\\S]*?as \\$\\$`, 'i'))?.[0];
    assert.ok(declaration, `${functionName} declaration is present`);
    assert.match(declaration, /language plpgsql security definer/i, `${functionName} is security definer`);
    assert.match(declaration, /set search_path = pg_catalog\s+as \$\$$/i, `${functionName} has a restricted search path`);
    assert.doesNotMatch(declaration, /search_path\s*=.*\b(?:public|extensions)\b/i, `${functionName} excludes writable schemas`);
  }
  for (const extensionCall of ['gen_random_uuid', 'crypt', 'gen_salt', 'gen_random_bytes', 'digest']) {
    assert.doesNotMatch(schema, new RegExp(`(?<!benchmark_extensions\\.)\\b${extensionCall}\\s*\\(`, 'i'));
  }
  assert.doesNotMatch(schema, /auth\.uid\(|auth\.users|create role|alter role/i);
  assert.match(CREATE_FIXTURE_STATE_SQL, /realworld-api-v3-baseline-v1/);
  assert.match(RESET_FIXTURE_STATE_SQL, /realworld-api-v3-baseline-v1/);
  const truncateAt = RESET_FIXTURE_STATE_SQL.search(/truncate table public\.activities, public\.comments, public\.tasks, public\.projects, public\.memberships, public\.organizations, public\.users cascade/i);
  assert.ok(truncateAt >= 0, 'reset truncates all application tables');
  const restoreOrder = ['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities'];
  let previous = truncateAt;
  for (const table of restoreOrder) {
    const at = RESET_FIXTURE_STATE_SQL.search(new RegExp(`insert into public\\.${table} select \\* from benchmark_fixture\\.${table}`, 'i'));
    assert.ok(at > previous, `${table} restore follows dependency-safe order`);
    previous = at;
  }
  const passwordsAt = RESET_FIXTURE_STATE_SQL.search(/insert into benchmark_auth\.passwords select \* from benchmark_fixture\.passwords/i);
  const sessionsAt = RESET_FIXTURE_STATE_SQL.search(/truncate table benchmark_auth\.sessions/i);
  assert.ok(passwordsAt > previous, 'password state restores after application rows');
  assert.ok(sessionsAt > passwordsAt, 'sessions clear after password restore');
  const extractFunction = name => schema.match(new RegExp(`create function ${name.replace('.', '[.]')}\\([^)]*\\)[\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
  const signIn = extractFunction('benchmark_auth.sign_in');
  const validateSession = extractFunction('benchmark_auth.validate_session');
  const signOut = extractFunction('benchmark_auth.sign_out');
  assert.match(signIn, /where u\.email = login_email[\s\S]*?p\.password_hash = benchmark_extensions\.crypt\(login_password, p\.password_hash\)/i);
  assert.match(signIn, /if app_user is null then raise exception 'invalid credentials'/i);
  assert.match(signIn, /token := pg_catalog\.encode\(benchmark_extensions\.gen_random_bytes\(32\), 'hex'\)/i);
  assert.match(signIn, /insert into benchmark_auth\.sessions[\s\S]*?benchmark_extensions\.digest\(token, 'sha256'\)/i);
  assert.match(validateSession, /where s\.token_hash = pg_catalog\.encode\(benchmark_extensions\.digest\(session_token, 'sha256'\), 'hex'\)/i);
  assert.match(validateSession, /and s\.expires_at > (?:pg_catalog\.)?clock_timestamp\(\)/i);
  assert.match(validateSession, /if app_user is null then raise exception 'invalid session'/i);
  assert.match(signOut, /delete from benchmark_auth\.sessions[\s\S]*?token_hash = pg_catalog\.encode\(benchmark_extensions\.digest\(session_token, 'sha256'\), 'hex'\)/i);
  assert.match(signIn, /set_config\('app\.user_id', app_user, true\)/i);
  assert.match(validateSession, /set_config\('app\.user_id', app_user, true\)/i);
  assert.match(signOut, /set_config\('app\.user_id', '', true\)/i);
  assert.match(exactCountSql(), /union all/i);
});

test('postgres admin streams escaped bounded COPY and verifies every exact count', async () => {
  const {
    copyDataset, encodeCopyRow, verifyExactCounts,
  } = await import('../benchmark-sets/realworld-api-v3/shared/lib/admin/postgres.mjs');
  assert.equal(encodeCopyRow(['back\\slash', 'a\tb', 'a\nb', 'a\rb', null]), 'back\\\\slash\ta\\tb\ta\\nb\ta\\rb\t\\N\n');
  const calls = [];
  const records = (async function* () {
    yield { entity: 'user', records: [
      { id: 'u1', email: 'a@example.test', displayName: 'A', createdAt: '2020-01-01', updatedAt: '2020-01-02' },
      { id: 'u2', email: 'b@example.test', displayName: null, createdAt: '2020-01-01', updatedAt: '2020-01-02' },
    ] };
  }());
  await copyDataset({
    batches: records, maxBatchSize: 2,
    copy: async ({ table, columns, data }) => calls.push({ table, columns, data }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'users');
  assert.match(calls[0].data, /\\N/);
  await assert.rejects(() => copyDataset({ batches: (async function* () { yield { entity: 'user', records: [{}, {}, {}] }; }()), maxBatchSize: 2, copy: async () => {} }), /batch exceeds/);
  await assert.rejects(() => copyDataset({ batches: (async function* () { yield { entity: 'intruder', records: [{}] }; }()), copy: async () => {} }), /unsupported entity/);

  const { DATASET_COUNTS } = await import('../benchmark-sets/realworld-api-v3/shared/lib/dataset.mjs');
  const exact = Object.entries(DATASET_COUNTS).map(([table, count]) => ({ table, count: String(count) }));
  await verifyExactCounts(async (_sql, values) => { assert.deepEqual(values, []); return exact; });
  await assert.rejects(verifyExactCounts(async () => exact.map((row, index) => index ? row : { ...row, count: String(Number(row.count) - 1) })), /organizations.*expected/i);
  await assert.rejects(verifyExactCounts(async () => exact.map((row, index) => index ? row : { ...row, count: String(Number(row.count) + 1) })), /organizations.*expected/i);
  await assert.rejects(verifyExactCounts(async () => exact.slice(1)), /organizations.*missing/i);
  await assert.rejects(verifyExactCounts(async () => [...exact, { table: 'intruder', count: '0' }]), /unexpected table/i);
});

test('postgres admin parameterized administrative transports preserve SQL, values, results, and failures', async () => {
  const {
    CREATE_FIXTURE_STATE_SQL, RESET_FIXTURE_STATE_SQL, CREATE_NEON_PASSWORDS_SQL,
    createFixtureState, resetFixtureState, createNeonPasswords,
  } = await import('../benchmark-sets/realworld-api-v3/shared/lib/admin/postgres.mjs');
  const calls = [];
  const execute = async (sql, values) => {
    calls.push([sql, values]);
    return { call: calls.length };
  };
  assert.deepEqual(await createFixtureState(execute), { call: 1 });
  assert.deepEqual(await resetFixtureState(execute), { call: 2 });
  assert.deepEqual(await createNeonPasswords(execute, 'separate-secret'), { call: 3 });
  assert.deepEqual(calls, [
    [CREATE_FIXTURE_STATE_SQL, []],
    [RESET_FIXTURE_STATE_SQL, []],
    [CREATE_NEON_PASSWORDS_SQL, ['separate-secret']],
  ]);
  assert.doesNotMatch(CREATE_NEON_PASSWORDS_SQL, /separate-secret/);

  const failure = new Error('transport failed');
  for (const invoke of [
    () => createFixtureState(async (sql, values) => { assert.equal(sql, CREATE_FIXTURE_STATE_SQL); assert.deepEqual(values, []); throw failure; }),
    () => resetFixtureState(async (sql, values) => { assert.equal(sql, RESET_FIXTURE_STATE_SQL); assert.deepEqual(values, []); throw failure; }),
    () => createNeonPasswords(async (sql, values) => { assert.equal(sql, CREATE_NEON_PASSWORDS_SQL); assert.deepEqual(values, ['pw']); throw failure; }, 'pw'),
  ]) await assert.rejects(invoke, error => error === failure);
});

test('administrative dispatch invokes exactly the requested platform handler', async () => {
  const { dispatchAdmin } = await import('../benchmark-sets/realworld-api-v3/shared/lib/admin.mjs');
  const calls = [];
  await dispatchAdmin(['reset', 'neon', 'measure', '2', '/tmp/output'], {
    loadAdmin: async platform => ({ reset: context => calls.push([platform, context]) }),
  });
  assert.deepEqual(calls, [['neon', { platform: 'neon', phase: 'measure', trial: 2, outputDir: '/tmp/output' }]]);
});

test('shared hook validates dispatch and installs an isolated Node 22 runtime', () => {
  const hook = text('shared/case.sh');
  assert.match(hook, /setup\|verify\|reset\|run\|teardown/);
  assert.match(hook, /supabase\|convex\|appwrite\|nhost\|directus\|pocketbase\|trailbase\|neon/);
  assert.match(hook, /requires Node\.js 22 or newer/);
  assert.match(hook, /npm ci --ignore-scripts --prefix "\$runtime"/);
  assert.match(hook, /cp -R "\$script_dir\/lib" "\$runtime\/"/);
  for (const asset of ['convex', 'trailbase', 'pocketbase', 'sql']) {
    assert.match(hook, new RegExp(`if \\[ -d "\\$script_dir/${asset}" \\]; then cp -R "\\$script_dir/${asset}" "\\$runtime/"; fi`));
  }
  assert.match(hook, /lib\/run\.mjs/);
  assert.match(hook, /lib\/admin\.mjs/);
  const pkg = JSON.parse(text('shared/package.json'));
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.dependencies['@neondatabase/serverless'], '1.1.0');
  assert.equal(pkg.dependencies['@supabase/supabase-js'], '2.115.0');
  const lock = JSON.parse(text('shared/package-lock.json'));
  assert.equal(lock.packages[''].dependencies['@neondatabase/serverless'], '1.1.0');
});
