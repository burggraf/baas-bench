import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeSourceManifest, pinnedNodeVersion } from './native_v5_provenance.mjs';
import { DatabaseSync } from 'node:sqlite';
import { SCALE_SNAPSHOT_MIGRATION, RESTORE_APPLICATION_SQL, restoreTrailBaseScaleBaseline } from './native_v5_trailbase_scale.mjs';
import { restoreSupabaseScaleSQL } from './native_v5_supabase_scale.mjs';
import { runTrailBaseScaleProbe } from './native_v5_trailbase_scale.mjs';
import { runNativeConformance, closeNativeSessions } from '../benchmark-sets/realworld-api-v5/shared/lib/native-conformance.mjs';
import { assertConformance, runConformance } from '../benchmark-sets/realworld-api-v5/shared/lib/conformance.mjs';
import { fixtureBatches, FIXTURE_COLUMNS } from '../benchmark-sets/realworld-api-v5/shared/lib/fixture.mjs';
import { DATASET_COUNTS, entityId } from '../benchmark-sets/realworld-api-v5/shared/lib/dataset.mjs';

test('TrailBase full restore SQL preserves seeded values and Auth IDs across repeated cycles', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE _user(id BLOB PRIMARY KEY,email TEXT,password_hash TEXT);');
    db.exec(readFileSync(new URL('../benchmark-sets/realworld-api-v5/shared/trailbase/migration.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO _user VALUES(x'aa','owner@example.test','native-hash');
      INSERT INTO users VALUES(1,'owner','aa','owner@example.test','Owner','2026-01-01','2026-01-01');
      INSERT INTO organizations VALUES(1,'org','Org','owner','2026-01-01');
      INSERT INTO memberships VALUES(1,'membership','org','owner','owner','2026-01-01');
      INSERT INTO projects VALUES(1,'project','org','Project','active','2026-01-01','2026-01-01');
      INSERT INTO tasks VALUES(1,'task','org','project','owner',NULL,'Original','','todo','low',NULL,'2026-01-01','2026-01-01',NULL);
      INSERT INTO comments VALUES(1,'comment','org','project','task','owner','Original','2026-01-01','2026-01-01',NULL);`);
    db.exec(SCALE_SNAPSHOT_MIGRATION);
    const tables = Object.keys(FIXTURE_COLUMNS);
    db.exec(tables.map(table => `INSERT INTO v5_baseline_${table} SELECT * FROM ${table};`).join('\n') + '\nINSERT INTO v5_baseline_auth SELECT * FROM _user;');
    const state = () => JSON.stringify([...tables, '_user'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
    const before = state();
    for (let cycle = 0; cycle < 2; cycle++) {
      db.exec("UPDATE tasks SET title='Changed',last_actor_id='owner'; UPDATE comments SET body='Changed',last_actor_id='owner'; UPDATE users SET display_name='Changed'; UPDATE memberships SET role='admin'; UPDATE _user SET email='changed@example.test'; INSERT INTO _user VALUES(x'bb','extra@example.test','extra-hash');");
      assert.notEqual(state(), before);
      db.exec('BEGIN;\n' + RESTORE_APPLICATION_SQL + '\nDELETE FROM _user; INSERT INTO _user SELECT * FROM v5_baseline_auth; COMMIT;');
      assert.equal(state(), before);
    }
  } finally { db.close(); }
});

test('Supabase scale reset truncates all application tables atomically and restores auth rows', () => {
  const sql = restoreSupabaseScaleSQL(['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities'], '"id","email"', '"id","user_id"');
  assert.match(sql, /^BEGIN;\nTRUNCATE TABLE public\.activities,public\.comments,public\.tasks,public\.projects,public\.memberships,public\.organizations,public\.users CASCADE;/);
  assert.match(sql, /INSERT INTO public\.users SELECT \* FROM v5_scale_baseline\.users/);
  assert.match(sql, /DELETE FROM auth\.users; INSERT INTO auth\.users/);
  assert.match(sql, /INSERT INTO auth\.identities.*COMMIT;$/);
  assert.equal((sql.match(/TRUNCATE TABLE/g) ?? []).length, 1);
});

test('TrailBase restores once then renews the controller session before verification', async () => {
  const calls = [];
  await restoreTrailBaseScaleBaseline({ authColumns: ['id', 'email'], query: async sql => { assert.match(sql, /DELETE FROM _user/); calls.push('restore'); }, renewAdmin: async () => calls.push('login') });
  assert.deepEqual(calls, ['restore', 'login']);
  const failure = new Error('restore failed');
  calls.length = 0;
  await assert.rejects(restoreTrailBaseScaleBaseline({ authColumns: ['id'], query: async () => { calls.push('restore'); throw failure; }, renewAdmin: async () => calls.push('login') }), error => error === failure);
  assert.deepEqual(calls, ['restore']);
});

test('V5 fixture mapping streams one million logical rows with valid tenant and parent IDs', async () => {
  const counts = Object.fromEntries(Object.keys(DATASET_COUNTS).map(table => [table, 0]));
  for await (const batch of fixtureBatches(42, 997)) {
    assert.deepEqual(batch.columns, FIXTURE_COLUMNS[batch.table]);
    for (const row of batch.rows) {
      assert.equal(row.length, batch.columns.length);
      const ordinal = Number.parseInt(row[0].slice(5), 36);
      if (batch.table === 'tasks') {
        assert.equal(row[1], entityId('organization', ordinal % DATASET_COUNTS.organizations));
        assert.equal(row[2], entityId('project', ordinal % DATASET_COUNTS.projects));
        assert.match(row[5], /^Task /); assert.match(row[6], /^Description /);
        assert.ok(['todo', 'in_progress', 'done', 'cancelled'].includes(row[7]));
        assert.ok(['low', 'medium', 'high', 'urgent'].includes(row[8]));
      }
      if (batch.table === 'comments') {
        const task = ordinal % DATASET_COUNTS.tasks;
        assert.equal(row[1], entityId('organization', task % DATASET_COUNTS.organizations));
        assert.equal(row[2], entityId('project', task % DATASET_COUNTS.projects));
        assert.equal(row[3], entityId('task', task));
        assert.match(row[5], /^Comment /);
      }
    }
    counts[batch.table] += batch.rows.length;
  }
  assert.deepEqual(counts, DATASET_COUNTS);
  assert.equal(Object.values(counts).reduce((a, b) => a + b), 1000000);
});

test('native probe CLIs reject missing or unexpected authorization arguments before setup', () => {
  for (const platform of ['trailbase', 'supabase']) {
    for (const args of [[], ['--existing-stack'], ['--local-disposable', 'unexpected']]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./native_v5_${platform}_probe.mjs`, import.meta.url)), ...args], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /usage:/);
      assert.equal(result.stdout, '');
    }
  }
});

test('native provenance hashes source bytes and paths, excludes private runtime contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'v5-provenance-'));
  const put = (path, value) => { const file = join(root, path); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, value); };
  try {
    put('benchmark-sets/realworld-api-v5/shared/schema.sql', 'schema');
    put('test/native_v5_driver.mjs', 'driver');
    put('benchmark-sets/realworld-api-v4/shared/lib/admin/trailbase-bootstrap.mjs', 'bootstrap');
    put('bin/baas', 'setup');
    put('versions.env', 'pins');
    put('.runtime/conformance-v5/sdk/package-lock.json', '{}');
    put('.runtime/conformance-v5/sdk/package.json', JSON.stringify({ engines: { node: '>=22' } }));
    put('benchmark-sets/realworld-api-v5/versions.env', 'NODE_VERSION=22.23.1\n');
    assert.equal(pinnedNodeVersion(root), '22.23.1');
    put('.runtime/conformance-v5/secret.env', 'never report this');
    const initial = nativeSourceManifest(root);
    assert.deepEqual(nativeSourceManifest(root), initial);
    assert.equal(JSON.stringify(initial).includes('never report this'), false);
    assert.equal(initial.files.some(row => row.path.endsWith('secret.env')), false);
    put('.runtime/conformance-v5/secret.env', 'changed private data');
    assert.deepEqual(nativeSourceManifest(root), initial);
    put('benchmark-sets/realworld-api-v5/shared/schema.sql', 'changed schema');
    assert.notEqual(nativeSourceManifest(root).sha256, initial.sha256);
    put('test/native_v5_extra.mjs', 'new source');
    assert.equal(nativeSourceManifest(root).files.length, initial.files.length + 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('conformance failure diagnostics retain status but exclude raw errors and unknown names', async () => {
  const error = Object.assign(new Error('private-token-value'), { name: 'private-token-value', status: 401, cleanupErrors: [new Error('private-password')] });
  const report = await runConformance({ async 'fixture-integrity'() { throw error; } });
  const finding = report.findings.find(row => row.name === 'fixture-integrity');
  assert.equal(finding.passed, false);
  assert.equal(finding.failure_type, 'Error');
  assert.equal(finding.failure_http_status, 401);
  assert.equal(finding.cleanup_failure_count, 1);
  assert.equal(JSON.stringify(report).includes('private-'), false);
});

test('native session cleanup tries every session and preserves the primary error', async () => {
  const calls = [], primary = new Error('mutation failed');
  const sessions = [1, 2].map(id => ({ async close() { calls.push(id); throw new Error(`cleanup ${id}`); } }));
  await assert.rejects(closeNativeSessions(sessions, primary), error => error === primary && error.cleanupErrors.length === 2);
  assert.deepEqual(calls, [1, 2]);
  calls.length = 0;
  await assert.rejects(closeNativeSessions(sessions), error => error.message === 'cleanup 1' && error.cleanupErrors.length === 2);
  assert.deepEqual(calls, [1, 2]);
});

function probe({ badSearch = false, badCount = false, staleRole = false, authWrite = false, staleMembership = false } = {}) {
  let active = true;
  let role = 'member', body = 'Original', displayName = 'Member', authName = 'Native';
  const fixture = { organizationId: 'org', projectId: 'project', taskId: 'a', otherAuthorCommentId: 'comment', memberMembershipId: 'membership', taskIds: ['a', 'b'], unassignedTaskIds: ['b'], searches: [{ query: 'literal_%\\.*', ids: ['a'] }, { query: 'missing', ids: [] }, { query: 'ÅNGSTRÖM', ids: ['a'], unicode: true }, { query: 'Café', ids: [], unicode: true }] };
  const member = {
    async searchTasks({ query }) { const ids = fixture.searches.find(row => row.query === query)?.ids ?? []; return { items: (badSearch ? ['wrong'] : ids).map(id => ({ id })), total: ids.length, hasNext: false }; },
    async createTask() { if (!active && !staleMembership) throw Object.assign(new Error('denied'), { status: 403 }); return { id: 'unexpected' }; },
    async listTasks({ organizationId, assigneeId, page }) { if (organizationId === 'revorg') { const ids = active || staleMembership ? ['revtask'] : []; return { items: ids.map(id => ({ id })), total: ids.length }; } const ids = assigneeId === null ? ['b'] : ['a', 'b']; return { items: ids.slice(page, page + 1).map(id => ({ id })), total: badCount && page >= ids.length ? 0 : ids.length, hasNext: page + 1 < ids.length, page, pageSize: 1 }; },
    async getTask() { return { comments: { items: [{ id: 'comment', body }] } }; },
    async updateComment(input) { if (role !== 'admin' && !staleRole) throw Object.assign(new Error('denied'), { status: 403 }); body = input.body; return { body }; },
    async getProfile() { return { displayName }; },
    async updateProfile(input) { displayName = input.displayName; if (authWrite) authName = displayName; return { displayName }; },
  };
  const owner = { async updateMembershipRole(input) { role = input.role; }, async updateComment(input) { body = input.body; } };
  return { sessions: { member, owner }, fixture, membershipActive: () => active, membershipRemoval: { scope: { organizationId: 'revorg', projectId: 'revproject' }, taskIds: ['revtask'], async remove() { active = false; }, async restore() { active = true; } }, async readAuthState() { return { name: authName }; }, state() { return { role, body, displayName }; } };
}

test('shared native checks require remaining native evidence and restore their mutations', async () => {
  const input = probe();
  const report = await runNativeConformance(input);
  for (const name of ['search-semantics', 'pagination-and-null-filters', 'live-role-revocation', 'application-only-profile']) assert.equal(report.findings.find(row => row.name === name).passed, true);
  assert.equal(report.passed, false);
  assert.throws(() => assertConformance(report), /incomplete/);
  assert.deepEqual(input.state(), { role: 'member', body: 'Original', displayName: 'Member' });
  assert.equal(input.membershipActive(), true);
});

for (const [option, name] of [['badSearch', 'search-semantics'], ['badCount', 'pagination-and-null-filters'], ['staleRole', 'live-role-revocation'], ['staleMembership', 'live-role-revocation'], ['authWrite', 'application-only-profile']]) {
  test(`shared native checks reject ${option}`, async () => {
    const input = probe({ [option]: true });
    const report = await runNativeConformance(input);
    assert.equal(report.findings.find(row => row.name === name).passed, false);
    assert.deepEqual(input.state(), { role: 'member', body: 'Original', displayName: 'Member' });
    assert.equal(input.membershipActive(), true);
  });
}

test('live revocation cannot pass without a membership-removal fixture', async () => {
  const input = probe(); delete input.membershipRemoval;
  const report = await runNativeConformance(input);
  assert.equal(report.findings.find(row => row.name === 'live-role-revocation').passed, false);
});

test('empty search or pagination fixtures cannot pass vacuously', async () => {
  const input = probe(); input.fixture.searches = []; input.fixture.taskIds = [];
  const report = await runNativeConformance(input);
  for (const name of ['search-semantics', 'pagination-and-null-filters']) assert.equal(report.findings.find(row => row.name === name).passed, false);
});

test('native search cannot pass without Unicode match and canonical-normalization boundary fixtures', async () => {
  const input = probe(); input.fixture.searches = input.fixture.searches.filter(row => !row.unicode);
  const report = await runNativeConformance(input);
  assert.equal(report.findings.find(row => row.name === 'search-semantics').passed, false);
});

test('shared profile check cannot pass without a native Auth-state reader', async () => {
  const input = probe(); delete input.readAuthState;
  const report = await runNativeConformance(input);
  assert.equal(report.findings.find(row => row.name === 'application-only-profile').passed, false);
});
