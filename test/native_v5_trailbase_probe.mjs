// Explicit integration command; not included in repository regression commands.
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createTrailBaseAdapter } from '../benchmark-sets/realworld-api-v5/shared/lib/adapters/trailbase.mjs';
import { runNativeConformance } from '../benchmark-sets/realworld-api-v5/shared/lib/native-conformance.mjs';
import { parseBootstrapCredentials } from '../benchmark-sets/realworld-api-v4/shared/lib/admin/trailbase-bootstrap.mjs';
import { runTrailBaseScaleProbe, SCALE_SNAPSHOT_MIGRATION } from './native_v5_trailbase_scale.mjs';
import { nativeProbeProvenance, nativeSourceManifest } from './native_v5_provenance.mjs';

if (process.argv.length !== 3 || !['--local-disposable', '--local-declared-scale'].includes(process.argv[2])) {
  console.error('usage: node test/native_v5_trailbase_probe.mjs {--local-disposable|--local-declared-scale}');
  process.exit(2);
}
const scale = process.argv[2] === '--local-declared-scale';
const root = fileURLToPath(new URL('../', import.meta.url));
const shared = join(root, 'benchmark-sets/realworld-api-v5/shared');
const runtime = join(root, '.runtime/conformance-v5');
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const dir = mkdtempSync(join(runtime, 'trailbase-'));
const name = `v5-probe-${dir.split('/').at(-1)}`;
const depot = join(dir, 'depot');
const image = readFileSync(join(root, 'benchmark-sets/realworld-api-v5/versions.env'), 'utf8').match(/^TRAILBASE_IMAGE=(\S+)$/m)?.[1];
assert.match(image, /^trailbase\/trailbase:[\w.]+@sha256:[a-f0-9]{64}$/);
const require = createRequire(join(runtime, 'sdk/package.json'));
const { initClient } = await import(require.resolve('trailbase'));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false, admin, base, sessions;
const report = { scope: scale ? 'declared-scale-conformance-not-measurement' : 'synthetic-native-probe-not-qualification', platform: 'trailbase', image, started_at: new Date().toISOString(), linode_spend_usd: 0, cleanup: false };
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`owned Docker ${args[0]} failed`);
  return args[0] === 'logs' ? result.stdout + result.stderr : result.stdout;
}
async function query(sql) {
  const response = await admin.fetch('/api/_admin/query', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': admin.tokens()?.csrf_token ?? '' }, signal: AbortSignal.timeout(scale ? 180000 : 30000), body: JSON.stringify({ query: sql, attached_databases: null }) });
  assert.equal(response.ok, true, `native admin query HTTP ${response.status}`);
  const result = await response.json();
  assert.ok(Array.isArray(result.rows));
  return result.rows.map(row => row.map(value => value === 'Null' ? null : value?.Text ?? value?.Integer ?? value?.Real ?? value));
}
async function denied(action, constraint = false) { await assert.rejects(action(), error => Number(error.status) >= 400 && Number(error.status) < (constraint ? 600 : 500)); }
async function main() {
  report.provenance = nativeProbeProvenance(root);
  report.phase = 'image-preflight';
  const contextHost = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
  const dockerHost = process.env.DOCKER_CONTEXT ? contextHost : process.env.DOCKER_HOST || contextHost;
  assert.match(dockerHost, /^unix:\/\//, 'a local Docker socket is required');
  process.env.DOCKER_HOST = dockerHost; delete process.env.DOCKER_CONTEXT;
  docker(['image', 'inspect', image]); // Do not implicitly pull a mutable image.
  mkdirSync(join(depot, 'migrations/main'), { recursive: true });
  // The parent run directory is private; container UID needs write access to its depot.
  for (const path of [depot, join(depot, 'migrations'), join(depot, 'migrations/main')]) chmodSync(path, 0o777);
  copyFileSync(join(shared, 'trailbase/bootstrap-config.textproto'), join(depot, 'config.textproto'));
  copyFileSync(join(shared, 'trailbase/migration.sql'), join(depot, 'migrations/main/U1785764902__v5.sql'));
  writeFileSync(join(depot, 'migrations/main/U1785764903__probe.sql'), "CREATE TABLE v5_probe_failure(id INTEGER PRIMARY KEY) STRICT; CREATE TRIGGER v5_probe_failure BEFORE INSERT ON activities WHEN EXISTS(SELECT 1 FROM v5_probe_failure) BEGIN SELECT RAISE(ABORT,'probe rollback'); END;\n" + (scale ? SCALE_SNAPSHOT_MIGRATION : ''), { mode: 0o600 });
  writeFileSync(join(dir, 'inventory.json'), JSON.stringify({ container: name, depot, scope: report.scope }), { mode: 0o600 });
  report.phase = 'container-start';
  started = true; // Cleanup also covers an ambiguous docker-run outcome.
  const portNumber = await new Promise((resolve, reject) => {
    const server = createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
  docker(['run', '-d', '--name', name, '--label', 'baas-bench.scope=v5-local-conformance', '--cpus', '2', '--memory', '4g', '-p', `127.0.0.1:${portNumber}:4000`, '-e', 'ADDRESS=0.0.0.0:4000', '--mount', `type=bind,source=${depot},target=/app/traildepot`, image]);
  const port = docker(['port', name, '4000/tcp']).trim();
  assert.match(port, /^127\.0\.0\.1:\d+$/); base = `http://${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/healthcheck`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {} await pause(500); }
  assert.ok(ready, 'bounded readiness check failed');
  report.phase = 'admin-login';
  const creds = parseBootstrapCredentials(docker(['logs', name]));
  admin = initClient(base); await admin.login(creds.email, creds.password);
  report.phase = 'schema-check';
  assert.equal((await query("SELECT count(*) FROM sqlite_schema WHERE name='users'"))[0][0], 1);
  copyFileSync(join(shared, 'trailbase/config.textproto'), join(depot, 'config.textproto'));
  docker(['kill', '--signal', 'SIGHUP', name]);
  if (scale) {
    report.phase = 'declared-scale';
    report.scale = await runTrailBaseScaleProbe({ query, initClient, base, dir, async renewAdmin() {
      admin = initClient(base); await admin.login(creds.email, creds.password);
    }, async createUser(email, password) {
      const response = await admin.fetch('/api/_admin/user', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', 'CSRF-Token': admin.tokens()?.csrf_token ?? '' }, body: JSON.stringify({ email, password, verified: true, admin: false }) });
      assert.equal(response.ok, true); return response.json();
    } });
    report.local_checks_passed = report.scale.passed;
    return;
  }
  report.phase = 'native-user-create';
  const users = [];
  for (const role of ['owner', 'admin', 'member', 'outsider']) {
    const email = `${role}@v5-probe.example.test`, password = `V5-probe-${role}-Aa91!`;
    const response = await admin.fetch('/api/_admin/user', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CSRF-Token': admin.tokens()?.csrf_token ?? '' }, body: JSON.stringify({ email, password, verified: true, admin: false }) });
    assert.equal(response.ok, true);
    const value = await response.json(); assert.equal(typeof value.id, 'string');
    users.push({ role, email, password, subject: value.id.replaceAll('-', '') });
  }
  const now = '2026-01-01T00:00:00.000Z';
  const title = String.raw`A literal 100%_work\load [special].*`;
  report.phase = 'fixture-import';
  await query(users.map(user => `INSERT INTO users(external_id,auth_subject,email,display_name,created_at,updated_at) VALUES(${quote(user.role)},${quote(user.subject)},${quote(user.email)},${quote(user.role)},'${now}','${now}');`).join('\n') + `
    INSERT INTO organizations VALUES(1,'orga','A','owner','${now}'),(2,'orgb','B','outsider','${now}');
    INSERT INTO memberships VALUES(1,'mowner','orga','owner','owner','${now}'),(2,'madmin','orga','admin','admin','${now}'),(3,'mmember','orga','member','member','${now}'),(4,'moutsider','orgb','outsider','owner','${now}');
    INSERT INTO projects VALUES(1,'projecta','orga','A','active','${now}','${now}'),(2,'projectb','orgb','B','active','${now}','${now}');
    INSERT INTO tasks VALUES(1,'taska','orga','projecta','owner','member',${quote(title)},'','todo','low',NULL,'${now}','${now}',NULL),(2,'tasknull','orga','projecta','owner',NULL,'Null assignee','','todo','low',NULL,'${now}','${now}',NULL),(3,'taskb','orgb','projectb','outsider',NULL,'Outside','','todo','low',NULL,'${now}','${now}',NULL);
    INSERT INTO organizations VALUES(3,'revorg','Revocation','owner','${now}');
    INSERT INTO memberships VALUES(5,'revowner','revorg','owner','owner','${now}'),(6,'revmember','revorg','member','member','${now}');
    INSERT INTO projects VALUES(3,'revproject','revorg','Revocation','active','${now}','${now}');
    INSERT INTO tasks VALUES(4,'revtask','revorg','revproject','owner',NULL,'Revocation control','','todo','low',NULL,'${now}','${now}',NULL);
    INSERT INTO comments VALUES(1,'commenta','orga','projecta','taska','owner','Original','${now}','${now}',NULL);`);
  report.phase = 'session-prepare';
  const adapter = createTrailBaseAdapter({ initClient, endpoint: base, timeoutMs: 5000 });
  sessions = {};
  for (const user of users) sessions[user.role] = await adapter.createSession({ email: user.email, password: user.password });
  const { member, outsider } = sessions;
  const scope = { organizationId: 'orga', projectId: 'projecta' };
  const raw = async (session, table, id) => (await session.client.records(table).list({ pagination: { limit: 100 }, filters: [{ column: 'external_id', value: id }] })).records;
  const state = async () => query("SELECT json_object('tasks',(SELECT json_group_array(json_object('id',external_id,'title',title,'actor',last_actor_id)) FROM tasks),'activities',(SELECT json_group_array(json_object('id',external_id,'actor',actor_id,'action',action)) FROM activities))");
  let task;
  const checks = {
    async 'self-peer-visibility'() {
      assert.equal((await raw(member, 'users', 'member')).length, 1);
      assert.equal((await raw(member, 'users', 'owner')).length, 1);
      assert.equal((await raw(outsider, 'users', 'owner')).length, 0); return true;
    },
    async 'native-tenant-authorization'() {
      assert.equal((await raw(outsider, 'tasks', 'taska')).length, 0);
      const before = await state();
      await denied(() => outsider.client.records('tasks').update(1, { title: 'Forbidden', last_actor_id: 'outsider' }));
      assert.deepEqual(await state(), before); return true;
    },
    async 'comment-project-permissions'() {
      await denied(() => member.client.records('projects').update(1, { name: 'Forbidden' }));
      await denied(() => member.client.records('comments').update(1, { body: 'Forbidden', last_actor_id: 'member' }));
      assert.equal((await raw(member, 'projects', 'projecta'))[0].name, 'A');
      assert.equal((await raw(member, 'comments', 'commenta'))[0].body, 'Original'); return true;
    },
    async 'actor-binding'() {
      const before = await state();
      for (const actor of ['owner', 'outsider']) await denied(() => member.client.records('tasks').create({ external_id: `spoof-${actor}`, organization_id: 'orga', project_id: 'projecta', creator_id: actor, last_actor_id: 'member', title: 'Spoof', description: '', status: 'todo', priority: 'low', created_at: now, updated_at: now }));
      await denied(() => member.client.records('tasks').update(1, { title: 'Spoof', last_actor_id: 'owner' }));
      const identities = async () => query("SELECT json_object('users',(SELECT json_group_array(json_array(external_id,auth_subject,email)) FROM users),'memberships',(SELECT json_group_array(json_array(external_id,organization_id,user_id)) FROM memberships),'comments',(SELECT json_group_array(json_array(external_id,organization_id,project_id,task_id,author_id)) FROM comments))");
      const unchanged = await identities();
      for (const body of [{ external_id: 'newidentity' }, { auth_subject: 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa' }, { email: 'changed@v5-probe.example.test' }]) await denied(() => member.client.records('users').update(3, body));
      for (const body of [{ organization_id: 'orga' }, { user_id: 'member' }]) await denied(() => sessions.owner.client.records('memberships').update(3, body));
      for (const body of [{ organization_id: 'orga' }, { project_id: 'projecta' }, { task_id: 'taska' }, { author_id: 'owner' }]) await denied(() => sessions.owner.client.records('comments').update(1, { ...body, last_actor_id: 'owner' }));
      assert.deepEqual(await identities(), unchanged);
      assert.deepEqual(await state(), before); return true;
    },
    async 'server-integrity'() {
      const before = await state();
      const payload = { organization_id: 'orga', project_id: 'projecta', creator_id: 'member', last_actor_id: 'member', title: 'Invalid', description: '', status: 'todo', priority: 'low', created_at: now, updated_at: now };
      const control = await member.client.records('tasks').create({ ...payload, external_id: 'validcontrol', title: 'Valid native integrity control' });
      assert.equal((await member.client.records('tasks').read(control)).external_id, 'validcontrol');
      const unchanged = await state();
      for (const changes of [{ project_id: 'projectb' }, { assignee_id: 'outsider' }, { status: 'invalid' }, { priority: 'invalid' }, { title: '' }]) {
        await denied(() => member.client.records('tasks').create({ ...payload, external_id: 'invalid', ...changes }), true);
      }
      assert.notDeepEqual(unchanged, before);
      assert.deepEqual(await state(), unchanged); return true;
    },
    async 'atomic-activity'() {
      task = await member.createTask({ ...scope, title: 'V5 created', description: '' });
      await member.updateTask({ ...scope, taskId: task.id, title: 'V5 updated' });
      const comment = await member.addComment({ ...scope, taskId: task.id, body: 'Created comment' });
      await member.updateComment({ ...scope, taskId: task.id, commentId: comment.id, body: 'Updated comment' });
      const activity = await query(`SELECT actor_id,action,subject_type,subject_id FROM activities WHERE subject_id=${quote(task.id)} ORDER BY id`);
      assert.deepEqual(activity, ['created', 'updated', 'commented', 'comment_updated'].map(action => ['member', action, 'task', task.id]));
      const dashboard = await member.dashboard(scope);
      assert.equal(dashboard.recentActivity.filter(row => row.subjectId === task.id).length, 4); return true;
    },
    async 'activity-failure-rollback'() {
      const before = await state(); await query('INSERT INTO v5_probe_failure VALUES(1)');
      try { await assert.rejects(member.updateTask({ ...scope, taskId: task.id, title: 'Rollback' }), error => Number(error.status) === 500); }
      finally { await query('DELETE FROM v5_probe_failure'); }
      assert.deepEqual(await state(), before); return true;
    },
    async 'durable-settings'() {
      report.database_settings = {};
      for (const key of ['journal_mode', 'synchronous', 'foreign_keys']) report.database_settings[key] = (await query(`SELECT * FROM pragma_${key}`))[0][0];
      assert.deepEqual(report.database_settings, { journal_mode: 'wal', synchronous: 1, foreign_keys: 1 }); return true;
    },
    async 'restart-persistence'() {
      const before = await state(); docker(['restart', name]);
      let ready = false;
      for (let i = 0; i < 40; i++) { try { if ((await raw(member, 'tasks', task.id))[0]?.title === 'V5 updated') { ready = true; break; } } catch {} await pause(500); }
      assert.ok(ready); assert.deepEqual(await state(), before); return true;
    },
  };
  report.phase = 'native-checks';
  report.conformance = await runNativeConformance({ sessions, fixture: { ...scope, taskId: 'taska', otherAuthorCommentId: 'commenta', memberMembershipId: 'mmember', taskIds: ['taska', 'tasknull'], unassignedTaskIds: ['tasknull'], searches: [{ query: String.raw`100%_work\load [special].*`, ids: ['taska'] }, { query: 'LITERAL', ids: ['taska'] }, { query: 'nonmatching sentinel', ids: [] }] }, membershipRemoval: { scope: { organizationId: 'revorg', projectId: 'revproject' }, taskIds: ['revtask'], remove: () => query("DELETE FROM memberships WHERE external_id='revmember'"), restore: () => query(`INSERT OR IGNORE INTO memberships VALUES(6,'revmember','revorg','member','member','${now}')`) }, readAuthState: () => query("SELECT * FROM _user WHERE email='member@v5-probe.example.test'"), checks });
  // Fixture-scale identity and complete Auth/session reset are deliberately absent.
  const expectedMissing = ['fixture-integrity', 'reset-baseline'];
  report.local_checks_passed = report.conformance.findings.every(row => row.passed === !expectedMissing.includes(row.name));
  assert.equal(report.local_checks_passed, true, 'native assertions failed; inspect private report');
}
try { await main(); }
catch (error) { report.failed = true; report.failure_type = error?.name ?? 'Error'; if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) report.failure_http_status = error.status; if (error?.cleanupErrors) report.session_cleanup_failure_types = error.cleanupErrors.map(item => item?.name ?? 'Error'); process.exitCode = 1; }
finally {
  if (report.provenance) {
    try { report.provenance.source_changed_during_probe = nativeSourceManifest(root).sha256 !== report.provenance.sources.sha256; }
    catch { report.provenance.source_verification_failed = true; process.exitCode = 1; }
  }
  if (scale && !report.scale) {
    try { report.scale = JSON.parse(readFileSync(join(dir, 'scale-evidence.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') { report.evidence_read_failed = true; process.exitCode = 1; } }
  }
  if (started) {
    try { docker(['rm', '-f', name]); report.cleanup = true; rmSync(depot, { recursive: true, force: true }); }
    catch { report.cleanup_failed = true; process.exitCode = 1; }
  }
  report.finished_at = new Date().toISOString();
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ report: join(dir, 'report.json'), local_checks_passed: report.local_checks_passed === true, qualified: false, cleanup: report.cleanup }));
}
