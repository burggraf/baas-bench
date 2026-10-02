// Explicit integration command; never run by automatic shell/unit tests.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createSupabaseAdapter } from '../benchmark-sets/realworld-api-v5/shared/lib/adapters/supabase.mjs';
import { runNativeConformance } from '../benchmark-sets/realworld-api-v5/shared/lib/native-conformance.mjs';
import { runSupabaseScaleProbe } from './native_v5_supabase_scale.mjs';
import { runNativeLifecycleProbe } from './native_v5_lifecycle.mjs';
import { nativeProbeProvenance, nativeSourceManifest, pinnedNodeVersion, nativeProbeMode } from './native_v5_provenance.mjs';

let mode;
try { mode = nativeProbeMode(process.argv.slice(2)); } catch {
  console.error('usage: node test/native_v5_supabase_probe.mjs {--local-disposable|--local-declared-scale|--local-lifecycle|--local-timed-stage}'); process.exit(2);
}
const { scale, lifecycle, parallel } = mode;
const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = join(root, '.runtime/conformance-v5');
const shared = join(root, 'benchmark-sets/realworld-api-v5/shared');
const require = createRequire(join(runtime, 'sdk/package.json'));
const { createClient } = await import(require.resolve('@supabase/supabase-js'));
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const dir = mkdtempSync(join(runtime, 'supabase-'));
const project = `v5-probe-${dir.split('/').at(-1).toLowerCase()}`;
const source = join(dir, 'supabase/docker');
const configPath = join(dir, 'compose.json');
const compose = ['compose', '-p', project, '--project-directory', source, '-f', configPath];
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { scope: parallel ? 'reduced-fixture-timed-stage-diagnostic' : lifecycle ? 'reduced-fixture-lifecycle-diagnostic' : scale ? 'declared-scale-conformance-not-measurement' : 'synthetic-native-probe-not-qualification', platform: 'supabase', started_at: new Date().toISOString(), linode_spend_usd: 0, cleanup: false };
let started = false, base, anon, service, sessions;
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    const error = new Error(`owned ${executable} command failed`);
    error.command_status = Number.isInteger(result.status) ? result.status : null;
    error.command_signal = ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(result.signal) ? result.signal : null;
    error.command_timeout = result.error?.code === 'ETIMEDOUT';
    error.command_error_type = ['ETIMEDOUT', 'ENOENT', 'EACCES'].includes(result.error?.code) ? result.error.code : undefined;
    throw error;
  }
  return result.stdout;
}
function docker(args, options) { return command('docker', args, options); }
function sql(query, { timeout = 180_000 } = {}) { return docker([...compose, 'exec', '-T', 'db', 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: query, timeout }); }
async function call(path, { method = 'GET', key = anon, token = key, body } = {}) {
  const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(5000), headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { status: response.status, ok: response.ok, data: text ? JSON.parse(text) : null };
}
async function main() {
  report.provenance = nativeProbeProvenance(root);
  assert.equal(process.versions.node, pinnedNodeVersion(root), 'native probe requires the pinned V5 Node runtime');
  report.phase = 'local-docker-preflight';
  const contextHost = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
  const dockerHost = process.env.DOCKER_CONTEXT ? contextHost : process.env.DOCKER_HOST || contextHost;
  assert.match(dockerHost, /^unix:\/\//, 'a local Docker socket is required');
  process.env.DOCKER_HOST = dockerHost; delete process.env.DOCKER_CONTEXT;
  report.phase = 'isolated-source-setup';
  command(join(root, 'bin/baas'), ['setup', 'supabase'], { env: { ...process.env, BAAS_RUNTIME_DIR: dir, BAAS_VERSION_PROFILE: 'realworld-api-v5' } });
  report.source_ref = readFileSync(join(dir, 'supabase/.baas-ref'), 'utf8').trim();
  const envPath = join(source, '.env');
  let envText = readFileSync(envPath, 'utf8');
  envText = envText.replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`);
  writeFileSync(envPath, envText, { mode: 0o600 });
  const env = Object.fromEntries(envText.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).replace(/^['"]|['"]$/g, '')]; }));
  anon = env.ANON_KEY; service = env.SERVICE_ROLE_KEY; assert.ok(anon && service);
  report.phase = 'isolated-compose-config';
  const config = JSON.parse(docker(['compose', '--project-directory', source, '--env-file', envPath, '-f', join(source, 'docker-compose.yml'), 'config', '--format', 'json']));
  config.name = project;
  const portNumber = await new Promise((resolve, reject) => {
    const server = createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); });
  });
  let gateway;
  for (const [name, value] of Object.entries(config.services)) {
    delete value.container_name; delete value.ports;
    value.restart = 'no';
    value.cpus = name === 'db' ? 1 : 0.2;
    value.mem_limit = name === 'db' ? '1536m' : '384m';
    if (value.image?.startsWith('envoyproxy/envoy:')) {
      gateway = name;
      value.image = readFileSync(join(root, 'benchmark-sets/realworld-api-v5/versions.env'), 'utf8').match(/^SUPABASE_ENVOY_IMAGE=(\S+)$/m)[1];
      value.ports = [{ target: 8000, published: String(portNumber), host_ip: '127.0.0.1', protocol: 'tcp' }];
    }
    for (const volume of value.volumes ?? []) {
      if (volume.type === 'bind') assert.ok(volume.source.startsWith(`${source}/`) || volume.source === '/var/run/docker.sock', 'unexpected bind mount');
    }
  }
  assert.ok(gateway, 'pinned gateway service not found');
  assert.ok(Object.values(config.services).reduce((total, value) => total + value.cpus, 0) <= 4, 'CPU budget exceeded');
  assert.ok(Object.keys(config.services).length <= 17, 'memory budget exceeded');
  for (const value of Object.values(config.volumes ?? {})) { delete value.name; assert.ok(!value.external); }
  for (const value of Object.values(config.networks ?? {})) { delete value.name; assert.ok(!value.external); }
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 }); chmodSync(configPath, 0o600);
  writeFileSync(join(dir, 'inventory.json'), JSON.stringify({ project, compose_file: configPath, source, scope: report.scope }), { mode: 0o600 });
  base = `http://127.0.0.1:${portNumber}`;
  report.phase = 'container-start'; started = true;
  docker([...compose, 'up', '-d', '--pull', 'never']);
  let ready = false;
  for (let i = 0; i < 120; i++) { try { if ((await call('/auth/v1/health')).ok) { ready = true; break; } } catch {} await pause(1000); }
  assert.ok(ready, 'bounded native Auth readiness failed');
  report.phase = 'schema-and-fixture';
  sql(readFileSync(join(shared, 'sql/postgres-schema.sql'), 'utf8') + '\n' + readFileSync(join(shared, 'sql/supabase-rls.sql'), 'utf8'));
  if (scale) {
    report.phase = 'declared-scale';
    report.scale = await runSupabaseScaleProbe({ sql, createClient, base, anon, call, dir, async createUser(email, password) {
      const result = await call('/auth/v1/admin/users', { method: 'POST', key: service, token: service, body: { email, password, email_confirm: true } });
      assert.equal(result.ok, true); return result.data;
    } });
    report.local_checks_passed = report.scale.passed;
    return;
  }
  if (lifecycle) {
    report.phase = 'lifecycle';
    report.lifecycle = await runNativeLifecycleProbe({ platform: 'supabase', dir, parallel, workerOptions: { platform: 'supabase', url: base, key: anon }, execute: async query => sql(query),
      rows: async query => sql(`SELECT row_to_json(r) FROM (${query}) r`).trim().split('\n').filter(Boolean).map(line => Object.values(JSON.parse(line))),
      backend: createSupabaseAdapter({ sdkCreateClient: createClient, url: base, key: anon, timeoutMs: 5000 }),
      async createUser(email, password) {
        const result = await call('/auth/v1/admin/users', { method: 'POST', key: service, token: service, body: { email, password, email_confirm: true } });
        assert.equal(result.ok, true); return result.data;
      } });
    report.local_checks_passed = report.lifecycle.passed;
    return;
  }
  const users = [];
  for (const role of ['owner', 'admin', 'member', 'outsider']) {
    const email = `${role}@v5-probe.example.test`, password = `V5-probe-${role}-Aa91!`;
    const result = await call('/auth/v1/admin/users', { method: 'POST', key: service, token: service, body: { email, password, email_confirm: true } });
    assert.equal(result.ok, true); assert.equal(typeof result.data.id, 'string');
    users.push({ role, email, password, subject: result.data.id });
  }
  const now = '2026-01-01T00:00:00.000Z';
  const title = String.raw`A literal 100%_work\load [special].*`;
  const unicodeTitle = 'Ångström 東京 Café';
  sql(users.map(user => `INSERT INTO public.users VALUES(${quote(user.role)},${quote(user.subject)},${quote(user.email)},${quote(user.role)},'${now}','${now}');`).join('\n') + `
    INSERT INTO public.organizations VALUES('orga','A','owner','${now}'),('orgb','B','outsider','${now}');
    INSERT INTO public.memberships VALUES('mowner','orga','owner','owner','${now}'),('madmin','orga','admin','admin','${now}'),('mmember','orga','member','member','${now}'),('moutsider','orgb','outsider','owner','${now}');
    INSERT INTO public.projects VALUES('projecta','orga','A','active','${now}','${now}'),('projectb','orgb','B','active','${now}','${now}');
    INSERT INTO public.tasks(id,organization_id,project_id,creator_id,assignee_id,title,description,status,priority,due_date,created_at,updated_at) VALUES('taska','orga','projecta','owner','member',${quote(title)},'','todo','low',NULL,'${now}','${now}'),('tasknull','orga','projecta','owner',NULL,'Null assignee','','todo','low',NULL,'${now}','${now}'),('taskb','orgb','projectb','outsider',NULL,'Outside','','todo','low',NULL,'${now}','${now}'),('taskunicode','orga','projecta','owner',NULL,${quote(unicodeTitle)},'','todo','low',NULL,'${now}','${now}');
    INSERT INTO public.organizations VALUES('revorg','Revocation','owner','${now}');
    INSERT INTO public.memberships VALUES('revowner','revorg','owner','owner','${now}'),('revmember','revorg','member','member','${now}');
    INSERT INTO public.projects VALUES('revproject','revorg','Revocation','active','${now}','${now}');
    INSERT INTO public.tasks(id,organization_id,project_id,creator_id,title,description,status,priority,created_at,updated_at) VALUES('revtask','revorg','revproject','owner','Revocation control','','todo','low','${now}','${now}');
    INSERT INTO public.comments VALUES('commenta','orga','projecta','taska','owner','Original','${now}','${now}');
    DELETE FROM public.activities;
    CREATE TABLE public.v5_probe_failure(id integer PRIMARY KEY);
    CREATE FUNCTION public.v5_probe_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM public.v5_probe_failure) THEN RAISE EXCEPTION 'probe rollback'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER v5_probe_failure BEFORE INSERT ON public.activities FOR EACH ROW EXECUTE FUNCTION public.v5_probe_failure();
    NOTIFY pgrst,'reload schema';`);
  report.phase = 'session-prepare';
  const adapter = createSupabaseAdapter({ sdkCreateClient: createClient, url: base, key: anon, timeoutMs: 5000 });
  sessions = {};
  for (const user of users) sessions[user.role] = await adapter.createSession({ email: user.email, password: user.password });
  const { member, outsider } = sessions;
  const scope = { organizationId: 'orga', projectId: 'projecta' };
  const raw = (session, table, id) => call(`/rest/v1/${table}?id=eq.${id}`, { token: session.accessToken });
  const state = () => sql("SELECT jsonb_build_object('tasks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t),'comments',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.comments c),'activities',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.activities a))").trim();
  const denied = async (path, body, session = member) => {
    const response = await call(`/rest/v1/${path}`, { method: path.includes('?') ? 'PATCH' : 'POST', token: session.accessToken, body });
    assert.ok(!response.ok || (Array.isArray(response.data) && response.data.length === 0), 'native forbidden write succeeded');
  };
  let task;
  const checks = {
    async 'self-peer-visibility'() {
      for (const id of ['member', 'owner']) { const result = await raw(member, 'users', id); assert.equal(result.ok, true); assert.equal(result.data.length, 1); }
      const result = await raw(outsider, 'users', 'owner'); assert.equal(result.ok, true); assert.equal(result.data.length, 0); return true;
    },
    async 'native-tenant-authorization'() {
      const row = await raw(outsider, 'tasks', 'taska'); assert.equal(row.ok, true); assert.equal(row.data.length, 0);
      const before = state(); await denied('tasks?id=eq.taska', { title: 'Forbidden' }, outsider); assert.equal(state(), before); return true;
    },
    async 'comment-project-permissions'() {
      await denied('projects?id=eq.projecta', { name: 'Forbidden' }); await denied('comments?id=eq.commenta', { body: 'Forbidden' });
      assert.equal((await raw(member, 'projects', 'projecta')).data[0].name, 'A'); assert.equal((await raw(member, 'comments', 'commenta')).data[0].body, 'Original'); return true;
    },
    async 'actor-binding'() {
      const before = state();
      for (const creator_id of ['owner', 'outsider']) await denied('tasks', { id: 'spoof', organization_id: 'orga', project_id: 'projecta', creator_id, title: 'Spoof', description: '', status: 'todo', priority: 'low', created_at: now, updated_at: now });
      await denied('tasks?id=eq.taska', { creator_id: 'outsider' });
      const identities = () => sql("SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM public.users u),'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.memberships m),'comments',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.comments c))").trim();
      const unchanged = identities();
      for (const body of [{ id: 'newidentity' }, { auth_subject: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { email: 'changed@v5-probe.example.test' }]) await denied('users?id=eq.member', body);
      for (const body of [{ organization_id: 'orga' }, { user_id: 'member' }]) await denied('memberships?id=eq.mmember', body, sessions.owner);
      for (const body of [{ organization_id: 'orga' }, { project_id: 'projecta' }, { task_id: 'taska' }, { author_id: 'owner' }]) await denied('comments?id=eq.commenta', body, sessions.owner);
      assert.equal(identities(), unchanged);
      assert.equal(state(), before); return true;
    },
    async 'server-integrity'() {
      const before = state();
      const payload = { id: 'invalid', organization_id: 'orga', project_id: 'projecta', creator_id: 'member', title: 'Invalid', description: '', status: 'todo', priority: 'low', created_at: now, updated_at: now };
      const control = await call('/rest/v1/tasks', { method: 'POST', token: member.accessToken, body: { ...payload, id: 'validcontrol', title: 'Valid native integrity control' } });
      assert.equal(control.ok, true); assert.equal(control.data[0].id, 'validcontrol');
      const unchanged = state();
      const rejected4xx = async (table, body) => {
        const response = await call(`/rest/v1/${table}`, { method: 'POST', token: member.accessToken, body });
        assert.ok(response.status >= 400 && response.status < 500, `malformed ${table} write must be rejected as client input`);
      };
      for (const changes of [{ organization_id: 'orgb' }, { project_id: 'projectb' }, { creator_id: 'missing' }, { assignee_id: 'outsider' }, { assignee_id: 'missing' },
        { status: 'invalid' }, { priority: 'invalid' }, { title: '' }, { title: null }, { description: null }]) await rejected4xx('tasks', { ...payload, ...changes });
      const commentPayload = { id: 'commentcontrol', organization_id: 'orga', project_id: 'projecta', task_id: 'validcontrol', author_id: 'member', body: 'Valid native relationship control', created_at: now, updated_at: now };
      const commentControl = await call('/rest/v1/comments', { method: 'POST', token: member.accessToken, body: commentPayload });
      assert.equal(commentControl.ok, true); assert.equal(commentControl.data[0].id, 'commentcontrol');
      const afterCommentControl = state();
      for (const changes of [{ organization_id: 'orgb' }, { project_id: 'projectb' }, { task_id: 'taskb' }, { author_id: 'outsider' }, { author_id: 'missing' }, { body: '' }, { body: null }]) {
        await rejected4xx('comments', { ...commentPayload, id: 'commentinvalid', ...changes });
      }
      assert.notEqual(unchanged, before);
      assert.equal(state(), afterCommentControl);
      return true;
    },
    async 'atomic-activity'() {
      task = await member.createTask({ ...scope, title: 'V5 created', description: '' });
      await member.updateTask({ ...scope, taskId: task.id, title: 'V5 updated' });
      const comment = await member.addComment({ ...scope, taskId: task.id, body: 'Created comment' });
      await member.updateComment({ ...scope, taskId: task.id, commentId: comment.id, body: 'Updated comment' });
      const activities = JSON.parse(sql(`SELECT json_agg(json_build_array(actor_id,action,subject_type,subject_id) ORDER BY created_at,id) FROM public.activities WHERE subject_id=${quote(task.id)}`));
      assert.deepEqual(activities, ['created','updated','commented','comment_updated'].map(action => ['member', action, 'task', task.id]));
      assert.equal((await member.dashboard(scope)).recentActivity.filter(row => row.subjectId === task.id).length, 4); return true;
    },
    async 'activity-failure-rollback'() {
      const before = state(); sql('INSERT INTO public.v5_probe_failure VALUES(1)');
      try { await assert.rejects(member.updateTask({ ...scope, taskId: task.id, title: 'Rollback' })); }
      finally { sql('DELETE FROM public.v5_probe_failure'); }
      assert.equal(state(), before); return true;
    },
    async 'durable-settings'() {
      report.database_settings = Object.fromEntries(sql("SELECT name||'='||setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','wal_level') ORDER BY name").trim().split('\n').map(row => row.split('=')));
      for (const key of ['fsync', 'synchronous_commit', 'full_page_writes']) assert.equal(report.database_settings[key], 'on'); return true;
    },
    async 'restart-persistence'() {
      const before = state(); docker([...compose, 'restart', 'db']);
      let ready = false;
      for (let i = 0; i < 60; i++) { try { const row = await raw(member, 'tasks', task.id); if (row.ok && row.data[0]?.title === 'V5 updated') { ready = true; break; } } catch {} await pause(1000); }
      assert.ok(ready); assert.equal(state(), before); return true;
    },
  };
  report.phase = 'native-checks';
  report.conformance = await runNativeConformance({ sessions, fixture: { ...scope, taskId: 'taska', otherAuthorCommentId: 'commenta', memberMembershipId: 'mmember', taskIds: ['taska', 'tasknull', 'taskunicode'], unassignedTaskIds: ['tasknull', 'taskunicode'], searches: [{ query: String.raw`100%_work\load [special].*`, ids: ['taska'] }, { query: 'LITERAL', ids: ['taska'] }, { query: 'nonmatching sentinel', ids: [] }, { query: 'ÅNGSTRÖM', ids: ['taskunicode'], unicode: true }, { query: '東京', ids: ['taskunicode'], unicode: true }, { query: 'CAFÉ', ids: ['taskunicode'], unicode: true }, { query: 'Café', ids: [], unicode: true }] }, membershipRemoval: { scope: { organizationId: 'revorg', projectId: 'revproject' }, taskIds: ['revtask'], remove: async () => sql("DELETE FROM public.memberships WHERE id='revmember'"), restore: async () => sql(`INSERT INTO public.memberships VALUES('revmember','revorg','member','member','${now}') ON CONFLICT DO NOTHING`) }, readAuthState: async () => JSON.parse(sql("SELECT row_to_json(u) FROM auth.users u WHERE email='member@v5-probe.example.test'")), checks });
  const expectedMissing = ['fixture-integrity', 'reset-baseline'];
  report.local_checks_passed = report.conformance.findings.every(row => row.passed === !expectedMissing.includes(row.name));
  assert.equal(report.local_checks_passed, true, 'native assertions failed; inspect private report');
}
try { await main(); }
catch (error) { report.failed = true; report.failure_type = error?.name ?? 'Error'; if (Number.isInteger(error?.command_status)) report.failure_command_status = error.command_status; if (error?.command_timeout) report.failure_command_timeout = true; if (error?.command_signal) report.failure_command_signal = error.command_signal; if (error?.command_error_type) report.failure_command_error_type = error.command_error_type; if (error?.cleanupErrors) report.session_cleanup_failure_types = error.cleanupErrors.map(item => item?.name ?? 'Error'); process.exitCode = 1; }
finally {
  if (report.provenance) {
    try { report.provenance.source_changed_during_probe = nativeSourceManifest(root).sha256 !== report.provenance.sources.sha256; }
    catch { report.provenance.source_verification_failed = true; process.exitCode = 1; }
  }
  if (scale && !report.scale) {
    try { report.scale = JSON.parse(readFileSync(join(dir, 'scale-evidence.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') { report.evidence_read_failed = true; process.exitCode = 1; } }
  }
  if (lifecycle && !report.lifecycle) {
    try { report.lifecycle = JSON.parse(readFileSync(join(dir, 'lifecycle-evidence.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') { report.evidence_read_failed = true; process.exitCode = 1; } }
  }
  if (started) {
    try { docker([...compose, 'down', '--volumes', '--remove-orphans']); report.cleanup = true; }
    catch { report.cleanup_failed = true; process.exitCode = 1; }
  }
  if (report.cleanup || !started) rmSync(join(dir, 'supabase'), { recursive: true, force: true });
  if (report.cleanup) rmSync(configPath, { force: true });
  report.finished_at = new Date().toISOString();
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ report: join(dir, 'report.json'), local_checks_passed: report.local_checks_passed === true, qualified: false, cleanup: report.cleanup }));
}
