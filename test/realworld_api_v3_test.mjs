import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, readFileSync } from 'node:fs';
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
