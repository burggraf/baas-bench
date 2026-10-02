import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureBatches, FIXTURE_COLUMNS } from '../benchmark-sets/realworld-api-v5/shared/lib/fixture.mjs';
import { buildVirtualUserSpecs, entityId } from '../benchmark-sets/realworld-api-v5/shared/lib/dataset.mjs';
import { runBaselinePhases } from '../benchmark-sets/realworld-api-v5/shared/lib/conformance.mjs';
import { prepareWarmupContexts, runWarmup, WARMUP } from '../benchmark-sets/realworld-api-v5/shared/lib/warmup.mjs';
import { closeNativeSessions } from '../benchmark-sets/realworld-api-v5/shared/lib/native-conformance.mjs';
import { runParallelLifecycleDiagnostic } from '../benchmark-sets/realworld-api-v5/shared/lib/parallel-stage.mjs';
import { classifyOperationError } from '../benchmark-sets/realworld-api-v5/shared/lib/correctness.mjs';
import { restoreSupabaseScaleSQL } from './native_v5_supabase_scale.mjs';
import { restoreTrailBaseScaleBaseline } from './native_v5_trailbase_scale.mjs';

const tables = Object.keys(FIXTURE_COLUMNS);
const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Closed subset of the established seed, not a new benchmark or declared scale.
export async function lifecycleFixture() {
  const specs = buildVirtualUserSpecs(WARMUP.users, WARMUP.seed).map((spec, index) => ({ ...spec, userId: entityId('user', index) }));
  const users = new Set(specs.map(spec => spec.userId));
  const organizations = new Set(specs.map(spec => spec.organizationId));
  const projects = new Set(specs.map(spec => spec.projectId));
  const tasks = new Set(specs.map(spec => spec.taskId)), comments = new Set(specs.map(spec => spec.commentId));
  const rows = Object.fromEntries(tables.map(table => [table, []]));
  const activityProjects = new Set();
  for await (const batch of fixtureBatches()) {
    for (const row of batch.rows) {
      if (batch.table === 'tasks' && tasks.has(row[0])) { rows.tasks.push(row); users.add(row[3]); if (row[4]) users.add(row[4]); }
      if (batch.table === 'comments' && comments.has(row[0])) { rows.comments.push(row); users.add(row[4]); }
      if (batch.table === 'activities' && projects.has(row[2]) && !activityProjects.has(row[2]) && (row[5] === 'task' ? tasks.has(row[6]) : projects.has(row[6]))) {
        rows.activities.push(row); users.add(row[3]); activityProjects.add(row[2]);
      }
    }
  }
  for await (const batch of fixtureBatches()) {
    if (batch.table === 'users') rows.users.push(...batch.rows.filter(row => users.has(row[0])));
    if (batch.table === 'organizations') rows.organizations.push(...batch.rows.filter(row => organizations.has(row[0])));
    if (batch.table === 'memberships') rows.memberships.push(...batch.rows.filter(row => users.has(row[2]) && organizations.has(row[1])));
    if (batch.table === 'projects') rows.projects.push(...batch.rows.filter(row => projects.has(row[0])));
    if (batch.table === 'tasks') break;
  }
  return { specs, rows };
}

export async function runNativeLifecycleProbe({ platform, execute, rows: queryRows, createUser, backend, renewAdmin, dir, parallel = false, workerOptions }) {
  assert.ok(['supabase', 'trailbase'].includes(platform));
  const postgres = platform === 'supabase', prefix = postgres ? 'public.' : '', id = postgres ? 'id' : 'external_id';
  const fixture = await lifecycleFixture();
  const evidence = { passed: false, scope: parallel ? 'reduced-fixture-timed-stage-diagnostic' : 'reduced-fixture-lifecycle-diagnostic', admission_evidence: false, measurement_qualified: false,
    warmup: WARMUP, session_preparation_concurrency: 1, fixture: Object.fromEntries(tables.map(table => [table, { count: fixture.rows[table].length, sha256: digest(fixture.rows[table]) }])), cycles: [] };
  const save = phase => {
    evidence.phase = phase;
    evidence.updated_at = new Date().toISOString();
    writeFileSync(join(dir, 'lifecycle-evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log(`V5_LIFECYCLE_PHASE ${phase}`);
  };
  save('seed');
  for (const table of tables) {
    const columns = FIXTURE_COLUMNS[table].map(column => column === 'id' ? id : column);
    if (fixture.rows[table].length) await execute(`INSERT INTO ${prefix}${table}(${columns.join(',')}) VALUES ${fixture.rows[table].map(row => `(${row.map(quote).join(',')})`).join(',')}`);
  }
  for (const row of fixture.rows.users) {
    const native = await createUser(row[1], 'Bb-v3-42-capacity!');
    assert.equal(typeof native.id, 'string');
    const subject = postgres ? native.id : native.id.replaceAll('-', '');
    await execute(`UPDATE ${prefix}users SET auth_subject=${quote(subject)} WHERE ${id}=${quote(row[0])}`);
  }
  async function applicationState() {
    const state = {};
    for (const table of tables) state[table] = digest(await queryRows(`SELECT * FROM ${prefix}${table} ORDER BY ${id}`));
    return state;
  }
  const authState = async () => postgres
    ? digest([await queryRows('SELECT * FROM auth.users ORDER BY id'), await queryRows('SELECT * FROM auth.identities ORDER BY id')])
    : digest(await queryRows('SELECT * FROM _user ORDER BY email'));
  const baseline = await applicationState(), authBaseline = await authState();
  let restore;
  if (postgres) {
    await execute('CREATE SCHEMA v5_scale_baseline;\n' + tables.map(table => `CREATE TABLE v5_scale_baseline.${table} AS SELECT * FROM public.${table};`).join('\n') + '\nCREATE TABLE v5_scale_baseline.auth_users AS SELECT * FROM auth.users; CREATE TABLE v5_scale_baseline.auth_identities AS SELECT * FROM auth.identities;');
    const columns = async table => (await queryRows(`SELECT column_name FROM information_schema.columns WHERE table_schema='auth' AND table_name=${quote(table)} AND is_generated='NEVER' ORDER BY ordinal_position`)).map(row => `"${row[0]}"`).join(',');
    const sql = restoreSupabaseScaleSQL(tables, await columns('users'), await columns('identities'));
    restore = () => execute(sql);
  } else {
    await execute(tables.map(table => `INSERT INTO v5_baseline_${table} SELECT * FROM ${table};`).join('\n') + '\nINSERT INTO v5_baseline_auth SELECT * FROM _user;');
    const authColumns = (await queryRows('PRAGMA table_info(_user)')).map(row => row[1]);
    restore = () => restoreTrailBaseScaleBaseline({ query: execute, authColumns, renewAdmin });
  }
  evidence.application_baseline = baseline;
  for (let cycle = 1; cycle <= 2; cycle++) {
    const contexts = [];
    let failure;
    try {
      const baselineHooks = {
        async reset() { save(`reset-${cycle}`); await restore(); },
        async verifyBaseline() {
          save(`verify-${cycle}`);
          assert.deepEqual(await applicationState(), baseline);
          assert.equal(await authState(), authBaseline);
          return true;
        },
      };
      if (parallel) {
        save(`parallel-${cycle}`);
        const result = await runParallelLifecycleDiagnostic({ ...baselineHooks, diagnostic: true, users: fixture.specs, requestedUsers: WARMUP.users,
          backendModule: new URL('./native_v5_worker_backend.mjs', import.meta.url).href, backendOptions: workerOptions,
          async onWarmupComplete() {
            save(`warm-state-${cycle}`);
            assert.notDeepEqual(await applicationState(), baseline, 'warm-up writes must be retained before measurement');
            save(`measurement-${cycle}`);
          } });
        const counts = Object.values(result.metrics.operations).map(row => ({ type: row.type, name: row.name, workflow: row.workflow, attempted: row.attemptedCount, completed: row.completedCount, failed: row.failedCount }));
        const delivered = result.workers.reduce((sum, worker) => sum + worker.samples, 0);
        assert.equal(counts.reduce((sum, row) => sum + row.attempted, 0), delivered, 'every delivered native/workflow sample must be accounted for');
        evidence.cycles.push({ cycle, baseline_restored: true, native_auth_restored: true, warm_state_retained: true, timed_window_completed: true,
          users: result.metrics.requestedUsers, achieved_users: result.metrics.achievedUsers, start_at_ms: result.startAt, end_at_ms: result.endedAt,
          operation_counts: counts, delivered_samples: delivered, process_telemetry: result.telemetry, worker_telemetry: result.workers,
          backend_telemetry: result.backendTelemetry, measurement_qualified: false, admission_evidence: false });
        save(`timed-window-${cycle}`);
        assert.equal(result.metrics.achievedUsers, WARMUP.users);
        assert.ok(counts.every(row => row.failed === 0), 'balanced-load native diagnostic requires successful operations');
        assert.notDeepEqual(await applicationState(), baseline, 'measurement must not restore the baseline');
      } else await runBaselinePhases({
        ...baselineHooks,
        async prepareSessions() { save(`prepare-${cycle}`); return prepareWarmupContexts(backend, fixture.specs, contexts, { concurrency: 1 }); },
        async warmUp() {
          save(`warm-up-${cycle}`);
          evidence.current_warmup = await runWarmup(contexts);
          return evidence.current_warmup.passed;
        },
        async enterStage() {
          save(`stage-entry-${cycle}`);
          const warmed = await applicationState();
          assert.notDeepEqual(warmed, baseline, 'warm-up writes must be retained');
          const sessions = contexts.map(context => context.session);
          for (const context of contexts) {
            assert.equal((await context.session.getProfile()).id, context.userId);
            const page = await context.session.listTasks({ organizationId: context.organizationId, projectId: context.projectId, page: 0, pageSize: 1 });
            assert.ok(page.total > 0 && page.items.length === 1);
          }
          assert.deepEqual(contexts.map(context => context.session), sessions, 'stage entry must reuse warm sessions');
          assert.deepEqual(await applicationState(), warmed, 'no reset or writes between warm-up and stage entry');
          evidence.cycles.push({ cycle, baseline_restored: true, native_auth_restored: true, warmup: evidence.current_warmup, warm_state_retained: true, stage_entry_passed: true });
          delete evidence.current_warmup;
        },
      });
    } catch (error) {
      failure = error;
      evidence.failure = { type: error?.name === 'BenchmarkOperationError' ? 'BenchmarkOperationError' : 'Error', classification: classifyOperationError(error), ...(Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? { status: error.status } : {}) };
      save(`failed-${cycle}`);
    } finally { await closeNativeSessions(contexts.map(context => context?.session), failure); }
    save(`cycle-${cycle}-complete`);
  }
  evidence.passed = true;
  save('complete');
  return evidence;
}
