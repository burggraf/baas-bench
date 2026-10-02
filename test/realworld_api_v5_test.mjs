import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createSupabaseAdapter } from '../benchmark-sets/realworld-api-v5/shared/lib/adapters/supabase.mjs';
import { createTrailBaseAdapter } from '../benchmark-sets/realworld-api-v5/shared/lib/adapters/trailbase.mjs';

const root = new URL('../benchmark-sets/realworld-api-v5/', import.meta.url);
const text = path => readFileSync(new URL(path, root), 'utf8');

test('V5 profile mutation updates application state without an Auth metadata write', async () => {
  let authWrites = 0;
  const row = { id: 'user', display_name: 'Changed' };
  const client = {
    auth: { async updateUser() { authWrites++; return { data: { user: row } }; } },
    from() { return { update() { return this; }, eq() { return this; }, select() { return this; }, async single() { return { data: row }; } }; },
  };
  const adapter = createSupabaseAdapter({ client });
  assert.equal((await adapter.updateProfile({ userId: 'user', displayName: 'Changed' })).displayName, 'Changed');
  assert.equal(authWrites, 0);
});

test('V5 TrailBase searches a literal substring and preserves explicit null assignee filters', async () => {
  const calls = [];
  const client = { records(table) { return { async list(options) { calls.push([table, options]); return { records: [], total_count: 0 }; } }; } };
  const adapter = createTrailBaseAdapter({ client });
  const session = { client, timeoutMs: 1000 };
  await adapter.searchTasks({ organizationId: 'org', projectId: 'project', query: 'workload', session });
  await adapter.listTasks({ organizationId: 'org', projectId: 'project', assigneeId: null, session });
  assert.ok(calls[0][1].filters.some(f => f.column === 'title' && f.op === 'regexp' && f.value === '(?i)workload'));
  assert.ok(calls[1][1].filters.some(f => f.column === 'assignee_id' && f.op === 'isNull'));
  assert.equal(calls[0][1].count, true);
  const literal = String.raw`A_%\\.*`;
  await adapter.searchTasks({ organizationId: 'org', projectId: 'project', query: literal, session });
  const pattern = calls[2][1].filters.find(f => f.column === 'title');
  const regexp = new RegExp(pattern.value.slice(4), 'i');
  assert.ok(regexp.test(`prefix${literal.toLowerCase()}suffix`));
  assert.equal(regexp.test('prefixAXanythingSuffix'), false);
});

test('V5 exact pagination totals survive empty beyond-end pages and missing totals fail', async () => {
  const calls = [];
  const client = { records() { return { async list(options) { calls.push(options); return { records: [], total_count: options.pagination.limit === 0 ? 12 : 0 }; } }; } };
  const adapter = createTrailBaseAdapter({ client });
  const session = { client, timeoutMs: 1000 };
  assert.equal((await adapter.listTasks({ organizationId: 'org', projectId: 'project', page: 9, session })).total, 12);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].pagination.offset, 0);
  const missingClient = { records() { return { async list() { return { records: [] }; } }; } };
  const missingAdapter = createTrailBaseAdapter({ client: missingClient });
  await assert.rejects(missingAdapter.listTasks({ organizationId: 'org', projectId: 'project', session: { client: missingClient, timeoutMs: 1000 } }), /count|total/i);
  const builder = { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return this; }, then(resolve) { resolve({ data: [] }); } };
  await assert.rejects(createSupabaseAdapter({ client: { from() { return builder; } } }).listTasks({ organizationId: 'org', projectId: 'project' }), /count|total/i);
});

test('V5 Supabase pages beyond the final range return an empty page with the real exact count', async () => {
  const calls = [];
  const client = { from(table) {
    const builder = {
      table, options: {}, select(_fields, options) { this.options = options ?? {}; return this; },
      eq() { return this; }, is() { return this; }, ilike() { return this; }, order() { return this; }, range() { return this; },
      then(resolve) { calls.push({ table: this.table, options: this.options }); resolve(this.options.head ? { data: null, count: 1 } : { error: { status: 416, code: 'PGRST103', message: 'Requested range not satisfiable' } }); },
    };
    return builder;
  } };
  const adapter = createSupabaseAdapter({ client });
  const [tasks, comments, search] = await Promise.all([
    adapter.listTasks({ organizationId: 'org', projectId: 'project', page: 1, pageSize: 1 }),
    adapter.listComments({ organizationId: 'org', projectId: 'project', taskId: 'task', page: 1, pageSize: 1 }),
    adapter.searchTasks({ organizationId: 'org', projectId: 'project', query: 'needle', page: 1, pageSize: 1 }),
  ]);
  for (const page of [tasks, comments, search]) assert.deepEqual({ items: page.items, total: page.total, hasNext: page.hasNext }, { items: [], total: 1, hasNext: false });
  assert.equal(calls.length, 6);
  assert.ok(calls.filter(call => call.options.head).every(call => call.options.count === 'exact'));
  await assert.rejects(adapter.listTasks({ organizationId: 'org', projectId: 'project', page: Number.MAX_SAFE_INTEGER, pageSize: 2 }), /invalid page/);
});

test('V5 TrailBase schema enforces relationships and provides atomic mutation activity triggers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(text('shared/trailbase/migration.sql'));
    assert.ok(db.prepare("PRAGMA foreign_key_list('tasks')").all().length > 0);
    assert.ok(db.prepare("PRAGMA foreign_key_list('comments')").all().length > 0);
    const triggers = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name IN ('tasks', 'comments')").all();
    assert.ok(triggers.length >= 4, 'task/comment INSERT/UPDATE activity triggers required');
    assert.ok(triggers.every(row => /INSERT INTO activities/i.test(row.sql)));
  } finally { db.close(); }
});

test('V5 SQLite constraints and activity rollback execute, not just match source text', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(text('shared/trailbase/migration.sql'));
    db.exec(`INSERT INTO users VALUES(1,'owner','a1','owner@example.test','Owner','2026-01-01','2026-01-01');
      INSERT INTO organizations VALUES(1,'org','Organization','owner','2026-01-01');
      INSERT INTO memberships VALUES(1,'membership','org','owner','owner','2026-01-01');
      INSERT INTO projects VALUES(1,'project','org','Project','active','2026-01-01','2026-01-01');`);
    const insert = db.prepare(`INSERT INTO tasks(external_id,organization_id,project_id,creator_id,title,description,status,priority,created_at,updated_at,last_actor_id) VALUES(?,'org',?,'owner',?,'','todo','medium','2026-01-01','2026-01-01','owner')`);
    assert.throws(() => insert.run('invalidparent','missing','Task'), /FOREIGN KEY/);
    assert.throws(() => insert.run('invalidtitle','project',''), /CHECK/);
    insert.run('task','project','Task');
    db.exec("UPDATE tasks SET title='Changed' WHERE external_id='task';");
    db.exec(`INSERT INTO comments(external_id,organization_id,project_id,task_id,author_id,body,created_at,updated_at,last_actor_id) VALUES('comment','org','project','task','owner','Body','2026-01-01','2026-01-01','owner');
      UPDATE comments SET body='Changed' WHERE external_id='comment';`);
    assert.deepEqual(db.prepare('SELECT actor_id, action, subject_type, subject_id FROM activities ORDER BY id').all().map(row => ({ ...row })), ['created','updated','commented','comment_updated'].map(action => ({ actor_id: 'owner', action, subject_type: 'task', subject_id: 'task' })));
    assert.throws(() => db.exec("UPDATE tasks SET status='invalid';"), /CHECK/);
    db.exec("CREATE TRIGGER injected_activity_failure BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    assert.throws(() => db.exec("UPDATE tasks SET title='Must roll back';"), /injected/);
    assert.equal(db.prepare('SELECT title FROM tasks').get().title, 'Changed');
    assert.equal(db.prepare('SELECT count(*) AS n FROM activities').get().n, 4);
  } finally { db.close(); }
});

test('V5 TrailBase native ACL SQL enforces peer visibility, actor binding and edit roles', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(text('shared/trailbase/migration.sql'));
    db.exec(`INSERT INTO users VALUES(1,'owner','aa','owner@example.test','Owner','2026-01-01','2026-01-01'),(2,'member','bb','member@example.test','Member','2026-01-01','2026-01-01'),(3,'outsider','cc','outside@example.test','Outside','2026-01-01','2026-01-01');
      INSERT INTO organizations VALUES(1,'org','Organization','owner','2026-01-01'),(2,'outside','Outside','outsider','2026-01-01');
      INSERT INTO memberships VALUES(1,'owner-membership','org','owner','owner','2026-01-01'),(2,'member-membership','org','member','member','2026-01-01'),(3,'outside-membership','outside','outsider','owner','2026-01-01');
      INSERT INTO projects VALUES(1,'project','org','Project','active','2026-01-01','2026-01-01');
      INSERT INTO tasks VALUES(1,'task','org','project','owner',NULL,'Task','','todo','medium',NULL,'2026-01-01','2026-01-01',NULL);
      INSERT INTO comments VALUES(1,'comment','org','project','task','owner','Body','2026-01-01','2026-01-01',NULL);`);
    const blocks = [...text('shared/trailbase/config.textproto').matchAll(/record_apis:\s*\[\{([\s\S]*?)\}\]/g)];
    function allowed(table, operation, actor, rowId, request = {}) {
      const block = blocks.find(match => match[1].includes(`name: "${table}"`))?.[1];
      const rule = block?.match(new RegExp(`${operation}_access_rule: "([^"]+)"`))?.[1];
      assert.ok(rule, `missing ${table} ${operation} rule`);
      const columns = db.prepare(`PRAGMA table_info('${table}')`).all().map(column => column.name);
      const sql = `WITH _USER_(id) AS (VALUES(?)), _ROW_ AS (SELECT * FROM ${table} WHERE external_id=?), _REQ_FIELDS_(_) AS (SELECT value FROM json_each(?)), _REQ_ AS (SELECT ${columns.map(column => `? AS "${column}"`).join(',')}) SELECT CAST((${rule}) AS INTEGER) AS allowed FROM _USER_, _ROW_, _REQ_`;
      return db.prepare(sql).get(Buffer.from(actor, 'hex'), rowId, JSON.stringify(Object.keys(request)), ...columns.map(column => request[column] ?? null))?.allowed === 1;
    }
    assert.ok(allowed('users','read','aa','owner'));
    assert.ok(allowed('users','read','bb','owner'));
    assert.equal(allowed('users','read','cc','owner'), false);
    assert.equal(allowed('users','update','aa','member',{ display_name: 'Forged' }), false);
    assert.equal(allowed('users','update','aa','owner',{ auth_subject: 'cc' }), false);
    assert.ok(allowed('tasks','create','bb','task',{ organization_id: 'org', creator_id: 'member', last_actor_id: 'member' }));
    assert.equal(allowed('tasks','create','bb','task',{ organization_id: 'org', creator_id: 'owner', last_actor_id: 'member' }), false);
    assert.equal(allowed('tasks','update','bb','task',{ title: 'Changed' }), false);
    assert.ok(allowed('tasks','update','bb','task',{ title: 'Changed', last_actor_id: 'member' }));
    assert.equal(allowed('tasks','update','bb','task',{ creator_id: 'owner', last_actor_id: 'member' }), false);
    assert.equal(allowed('comments','update','bb','comment',{ body: 'Forged', last_actor_id: 'member' }), false);
    assert.ok(allowed('comments','update','aa','comment',{ body: 'Changed', last_actor_id: 'owner' }));
    assert.equal(allowed('projects','create','bb','project',{ organization_id: 'org' }), false);
    assert.ok(allowed('projects','create','aa','project',{ organization_id: 'org' }));
    assert.ok(allowed('memberships','update','aa','member-membership',{ role: 'admin' }));
    assert.equal(allowed('memberships','update','aa','member-membership',{ role: 'admin', user_id: 'owner' }), false);
  } finally { db.close(); }
});

test('V5 resets and repeats identical warm-up before every measured stage', async () => {
  const { REQUIRED_CHECKS, runConformance, runStageFromBaseline } = await import('../benchmark-sets/realworld-api-v5/shared/lib/conformance.mjs');
  const incomplete = await runConformance({});
  assert.equal(incomplete.passed, false);
  assert.equal(incomplete.findings.length, REQUIRED_CHECKS.length);
  const conformance = await runConformance(Object.fromEntries(REQUIRED_CHECKS.map(name => [name, async () => true])));
  const calls = [];
  const hooks = { conformance, async reset() { calls.push('reset'); }, async verifyBaseline() { calls.push('verify'); return true; }, async prepareSessions() { calls.push('prepare'); return true; }, async warmUp() { calls.push('same-warm-up'); return true; }, async measure(stage) { calls.push(stage); return stage; } };
  await runStageFromBaseline({ ...hooks, stage: 100 });
  await runStageFromBaseline({ ...hooks, stage: 106 });
  assert.deepEqual(calls, ['reset','verify','prepare','same-warm-up',100,'reset','verify','prepare','same-warm-up',106]);
  calls.length = 0;
  await assert.rejects(runStageFromBaseline({ ...hooks, async reset() { throw new Error('restore failed'); }, stage: 200 }), /restore failed/);
  assert.deepEqual(calls, []);
  await assert.rejects(runStageFromBaseline({ ...hooks, async verifyBaseline() { return false; }, stage: 200 }), /baseline verification failed/);
  assert.deepEqual(calls, ['reset']);
  for (const phase of ['prepareSessions', 'warmUp']) {
    calls.length = 0;
    await assert.rejects(runStageFromBaseline({ ...hooks, [phase]: async () => false, stage: 200 }), /failed/);
    assert.equal(calls.includes(200), false);
  }
});

test('V5 cannot measure without the stronger mandatory conformance checks', async () => {
  const { REQUIRED_CHECKS, assertConformance } = await import('../benchmark-sets/realworld-api-v5/shared/lib/conformance.mjs');
  assert.ok(REQUIRED_CHECKS.includes('search-semantics'));
  assert.ok(REQUIRED_CHECKS.includes('atomic-activity'));
  assert.ok(REQUIRED_CHECKS.includes('reset-baseline'));
  assert.ok(REQUIRED_CHECKS.includes('restart-persistence'));
  assert.throws(() => assertConformance({ passed: true, findings: [] }), /missing|incomplete/i);
  assert.throws(() => assertConformance({ passed: true, findings: REQUIRED_CHECKS.map(name => ({ name, passed: name !== 'atomic-activity' })) }), /failed|incomplete/i);
  assert.throws(() => assertConformance({ passed: true, findings: REQUIRED_CHECKS.map(name => ({ name, passed: true })).concat({ name: 'extra', passed: false }) }), /failed|incomplete/i);
});
