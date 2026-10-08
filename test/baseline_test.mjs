import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { runCommand, readManifest, sha256 } from '../baseline/prepare.mjs';
import { NativeBaseline, assertOwned, stableBindMountManifest, commandOutput } from '../baseline/native.mjs';

const dir = mkdtempSync(join(tmpdir(), 'v6-fake-'));
const facts = { platform: 'trailbase', pins: 'p', schema: 's', fixture: { users: { count: 1, sha256: 'h' } } };
function fake(fail = []) {
  const events = [];
  const backend = Object.fromEntries(['verifyConfiguration', 'preflight', 'start', 'seed', 'snapshot', 'restore', 'ready', 'verify', 'authenticate', 'k6', 'postcheck', 'stop'].map(name => [name, async () => {
    events.push(name); if (fail.includes(name)) throw new Error(`${name} failure`);
    if (name === 'snapshot') { writeFileSync(join(dir, 'snapshot'), 'baseline'); return { files: ['snapshot'], state: { auth: 'hash' } }; }
  }]));
  return { events, backend };
}
try {
  const sourceRoot = join(dir, 'docker-source'), configDir = join(sourceRoot, 'volumes/api-gw');
  const dataDir = join(sourceRoot, 'volumes/db/data');
  mkdirSync(configDir, { recursive: true }); mkdirSync(dataDir, { recursive: true });
  const configFile = join(configDir, 'envoy.yaml'); writeFileSync(configFile, 'listeners: []');
  writeFileSync(join(dataDir, 'database'), 'mutable');
  const composeConfig = { services: {
    'api-gw': { volumes: [{ type: 'bind', source: configFile, target: '/etc/envoy.yaml', read_only: true }] },
    db: { volumes: [{ type: 'bind', source: dataDir, target: '/var/lib/postgresql/data', read_only: false }] }
  } };
  const mounts = stableBindMountManifest(composeConfig, sourceRoot);
  assert.equal(mounts.length, 1, 'stable inputs should be fingerprinted, not native mutable database data');
  writeFileSync(join(dir, 'compose.json'), JSON.stringify(composeConfig));
  writeFileSync(join(dir, 'mounts.json'), JSON.stringify(mounts));
  const configVerifier = Object.create(NativeBaseline.prototype);
  writeFileSync(join(dir, 'source.json'), JSON.stringify({ ref: 'synthetic-ref' }));
  Object.assign(configVerifier, { pg: true, source: sourceRoot, dir, pins: { SUPABASE_REF: 'synthetic-ref' }, command: () => 'synthetic-ref' });
  configVerifier.verifyConfiguration();
  writeFileSync(configFile, 'listeners: changed');
  assert.throws(() => configVerifier.verifyConfiguration(), /bind-mounted configuration changed/);
  writeFileSync(configFile, 'listeners: []');
  const sessionCalls = [];
  const sessionVerifier = Object.create(NativeBaseline.prototype);
  Object.assign(sessionVerifier, { pg: false, admin: { logout: async () => sessionCalls.push('logout') }, trailSessions: () => { sessionCalls.push('count'); return 0; } });
  assert.deepEqual(await sessionVerifier.clearVerificationSession(), { native_sessions: 0, admin_session_cleared: true });
  assert.deepEqual(sessionCalls, ['logout', 'count'], 'administrator session must be revoked before checking actor-session baseline');
  assert.equal(sessionVerifier.admin, null);
  const dirtySessionVerifier = Object.create(NativeBaseline.prototype);
  Object.assign(dirtySessionVerifier, { pg: false, admin: null, trailSessions: () => 1 });
  await assert.rejects(dirtySessionVerifier.clearVerificationSession(), /sessions remain before actor login/);
  const verifyDir = join(dir, 'verify-state'); mkdirSync(verifyDir);
  const verifyCalls = [], expectedState = { application: {}, auth: 'fixture-hash' };
  const verifyFlow = Object.create(NativeBaseline.prototype);
  Object.assign(verifyFlow, { runDir: verifyDir, state: async () => { verifyCalls.push('state'); return expectedState; }, clearVerificationSession: async () => { verifyCalls.push('sessions'); return { native_sessions: 0, admin_session_cleared: true }; } });
  await verifyFlow.verify({ state: expectedState });
  assert.deepEqual(verifyCalls, ['state', 'sessions']);
  assert.deepEqual(JSON.parse(readFileSync(join(verifyDir, 'start-state.json'))), { application_auth: expectedState, sessions: { native_sessions: 0, admin_session_cleared: true } });
  const bootstrapDir = join(dir, 'bootstrap'); mkdirSync(bootstrapDir);
  const syntheticBootstrapLog = "Created new admin user:\n email: 'v6-admin@example.test'\n password: 'synthetic-password-for-test'";
  assert.equal(commandOutput({ stdout: '', stderr: syntheticBootstrapLog }, true), syntheticBootstrapLog, 'capture stderr for successful Docker log commands');
  assert.equal(commandOutput({ stdout: '', stderr: syntheticBootstrapLog }), '', 'preserve stdout-only behavior for other commands');
  const bootstrapResponses = [{ status: 0, stdout: '', stderr: 'TrailBase starting' }, { status: 0, stdout: '', stderr: syntheticBootstrapLog }];
  const bootstrapTimeouts = [], bootstrapPauses = []; let bootstrapClock = 0;
  const bootstrap = Object.create(NativeBaseline.prototype);
  Object.assign(bootstrap, { dir: bootstrapDir, inv: { name: 'v6-trailbase-test' }, localDocker: () => {}, spawnCommand: (exe, args, options) => { assert.equal(exe, 'docker'); assert.deepEqual(args, ['logs', '--tail', '100', 'v6-trailbase-test']); bootstrapTimeouts.push(options.timeout); assert.ok(options.timeout > 0 && options.timeout <= 2000, 'bootstrap log reads must be individually bounded'); return bootstrapResponses.shift() ?? { status: 0, stdout: '', stderr: '' }; } });
  const adminCredentials = await bootstrap.bootstrapCredentials({ now: () => bootstrapClock, pause: async ms => { bootstrapPauses.push(ms); bootstrapClock = 3600; } });
  assert.deepEqual(adminCredentials, { email: 'v6-admin@example.test', password: 'synthetic-password-for-test' });
  assert.equal(bootstrapResponses.length, 0, 'bootstrap log polling must retry before failing');
  assert.deepEqual(bootstrapTimeouts, [2000, 1400], 'each read is capped by the remaining deadline');
  assert.deepEqual(bootstrapPauses, [250], 'retry delay is bounded');
  assert.deepEqual(JSON.parse(readFileSync(join(bootstrapDir, 'admin.json'))), adminCredentials, 'parsed credentials are saved only after the bootstrap marker appears');
  const exhaustedDir = join(dir, 'bootstrap-exhausted'); mkdirSync(exhaustedDir);
  let exhaustedClock = 0, exhaustedReads = 0;
  const exhaustedBootstrap = Object.create(NativeBaseline.prototype);
  Object.assign(exhaustedBootstrap, { dir: exhaustedDir, inv: { name: 'v6-trailbase-test' }, docker: (_args, _input, timeout) => { exhaustedReads++; assert.equal(timeout, 2000); exhaustedClock = 6000; return 'TrailBase starting'; } });
  await assert.rejects(exhaustedBootstrap.bootstrapCredentials({ now: () => exhaustedClock, pause: async () => {} }), /TrailBase bootstrap administrator was not found/);
  assert.equal(exhaustedReads, 1, 'expired bootstrap deadline must stop polling');
  assert.equal(existsSync(join(exhaustedDir, 'admin.json')), false);
  const dockerError = new Error('synthetic Docker log failure');
  const failedBootstrap = Object.create(NativeBaseline.prototype);
  Object.assign(failedBootstrap, { dir: join(dir, 'bootstrap-docker-error'), inv: { name: 'v6-trailbase-test' }, docker: () => { throw dockerError; } });
  mkdirSync(failedBootstrap.dir);
  await assert.rejects(failedBootstrap.bootstrapCredentials(), error => error === dockerError);
  assert.equal(existsSync(join(failedBootstrap.dir, 'admin.json')), false);
  const sqliteArgs = [];
  const sqliteProbe = Object.create(NativeBaseline.prototype);
  Object.assign(sqliteProbe, { command: (exe, args) => { sqliteArgs.push({ exe, args }); return '0\n'; } });
  assert.equal(sqliteProbe.sqlite(join(dir, 'session.db'), 'SELECT count(*) FROM _session;'), '0\n');
  assert.deepEqual(sqliteArgs, [{ exe: 'sqlite3', args: ['-noinit', '-batch', '-noheader', '-list', '-bail', join(dir, 'session.db'), 'SELECT count(*) FROM _session;'] }], 'SQLite CLI output must ignore per-user startup formatting');
  // Repeated restore, hidden-file removal, stopped/owned-resource refusal and
  // preservation failures now exercise the Linux depot in baseline_volume_test.mjs.

  const missing = fake();
  await assert.rejects(runCommand('run', { dir, facts, backend: missing.backend }), /prepare/);
  assert.deepEqual(missing.events, [], 'unprepared run must not touch Docker');
  const first = fake();
  await runCommand('prepare', { dir, facts, backend: first.backend });
  assert.deepEqual(first.events, ['preflight', 'start', 'ready', 'seed', 'verify', 'snapshot', 'stop']);
  const original = readFileSync(join(dir, 'manifest.json'), 'utf8');
  writeFileSync(join(dir, 'manifest.json'), original.replace('"auth": "hash"', '"auth": "tampered"'));
  assert.throws(() => readManifest(dir, facts), /manifest checksum/);
  writeFileSync(join(dir, 'manifest.json'), original);
  const reuse = fake();
  await runCommand('prepare', { dir, facts, backend: reuse.backend });
  assert.deepEqual(reuse.events, ['verifyConfiguration'], 'matching baseline verifies deployment configuration without starting/reseeding');
  assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), original);
  reuse.events.length = 0;
  await assert.rejects(runCommand('prepare', { dir, facts: { ...facts, pins: 'changed' }, backend: reuse.backend }), /stale/);
  assert.deepEqual(reuse.events, []);
  writeFileSync(join(dir, 'snapshot'), 'tampered');
  assert.throws(() => readManifest(dir, facts), /checksum/);
  writeFileSync(join(dir, 'snapshot'), 'baseline');
  const good = fake();
  await runCommand('run', { dir, facts, backend: good.backend });
  assert.deepEqual(good.events, ['verifyConfiguration', 'preflight', 'restore', 'start', 'ready', 'verify', 'authenticate', 'k6', 'postcheck', 'stop']);
  for (const step of ['verifyConfiguration', 'restore', 'ready', 'verify', 'authenticate']) {
    const bad = fake([step]);
    await assert.rejects(runCommand('run', { dir, facts, backend: bad.backend }), new RegExp(`${step} failure`));
    assert.ok(!bad.events.includes('k6'), `${step} must prevent k6`);
    assert.equal(bad.events.at(-1), 'stop');
  }
  const both = fake(['k6', 'stop']);
  await assert.rejects(runCommand('run', { dir, facts, backend: both.backend }), e => e.message === 'k6 failure' && e.cleanupError.message === 'stop failure');
  const stop = fake(); await runCommand('stop', { dir, facts, backend: stop.backend });
  assert.deepEqual(stop.events, ['stop']);
  const badSnapshot = JSON.parse(original); badSnapshot.files = { '../escape': sha256('baseline') };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(badSnapshot));
  assert.throws(() => readManifest(dir, facts), /manifest/);
  writeFileSync(join(dir, 'manifest.json'), '{}');
  assert.throws(() => readManifest(dir, facts), /manifest/);
  assert.throws(() => assertOwned([{ Config: { Labels: { 'baas-bench.v6-owner': 'foreign' } } }], 'ours'), /unowned/);
  assertOwned([{ Config: { Labels: { 'baas-bench.v6-owner': 'ours' } } }], 'ours');
  // Exercise the actual native stop path with fake Docker, never a real stack.
  const native = Object.create(NativeBaseline.prototype);
  native.inv = { owner: 'ours', name: 'v6-trailbase-ours' }; native.pg = false;
  const commands = [];
  native.docker = args => { commands.push(args); if (args[0] === 'ps') return 'backend\nk6'; if (args[0] === 'inspect') return JSON.stringify([{ Name: '/backend', Config: { Labels: { 'baas-bench.v6-owner': 'ours' } } }, { Name: '/k6', Config: { Labels: { 'baas-bench.v6-owner': 'ours' } } }]); return ''; };
  await native.stop();
  assert.ok(commands.some(c => c[0] === 'stop' && c.includes('k6')), 'stop must cover owned k6 leftovers');
  native.docker = args => { if (args[0] === 'ps') return 'foreign'; if (args[0] === 'inspect') return JSON.stringify([{ Config: { Labels: {} } }]); throw new Error('destructive command must not run'); };
  await assert.rejects(native.stop(), /unowned/);
  // Run both actual scenario branches against fake k6 HTTP, not a live backend.
  const source = readFileSync(new URL('../baseline/test.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export const /g, 'const ').replace(/export function /g, 'function ').replace('export default function ()', 'function iteration()');
  for (const platform of ['supabase', 'trailbase']) {
    const cfg = { platform, base: 'http://fake', token: 'user-token', anon: 'anon', organization: 'org', project: 'project', user: 'user', prefix: 'v6test' };
    const requests = []; let payload, malformed = false, failedChecks = 0, sleepCount = 0;
    const response = value => ({ status: 200, json: key => { if (malformed) throw new Error('malformed JSON'); return key ? value[key] : value; } });
    const api = runInNewContext(`${source}\n({ options, setup, iteration, handleSummary });`, {
      open: () => JSON.stringify(cfg), __ITER: 0,
      check: (value, checks) => { const passed = Object.values(checks).every(fn => fn(value)); if (!passed) failedChecks++; return passed; }, fail: text => { throw new Error(text); }, sleep: seconds => { assert.equal(seconds, 1); sleepCount++; },
      http: {
        get: (url, opts) => { requests.push([opts.tags.operation, url]); assert.equal(opts.timeout, '5s'); assert.equal(opts.headers.Authorization, 'Bearer user-token'); return response(opts.tags.operation === 'list' ? platform === 'supabase' ? [{ organization_id: 'org', project_id: 'project' }] : { records: [{ organization_id: 'org', project_id: 'project' }] } : platform === 'supabase' ? [payload] : payload); },
        post: (url, body, opts) => { requests.push([opts.tags.operation, url]); payload = JSON.parse(body); return response(platform === 'supabase' ? [payload] : { ids: [42] }); }
      }
    });
    assert.equal(api.options.vus, 1); assert.equal(api.options.duration, '60s'); api.setup(); api.iteration();
    assert.equal(sleepCount, 1, 'successful iteration must be paced');
    assert.deepEqual(requests.map(r => r[0]), ['list', 'create', 'reread']);
    assert.ok(requests[2][1].endsWith(platform === 'supabase' ? 'id=eq.v6test0' : '/42'));
    assert.equal(payload.creator_id, 'user');
    if (platform === 'trailbase') assert.equal(payload.last_actor_id, 'user');
    assert.ok(api.handleSummary({ metrics: {} })['/work/summary.json']);
    malformed = true;
    assert.throws(() => api.iteration());
    assert.equal(sleepCount, 2, 'failed iteration must still be paced');
    assert.ok(failedChecks > 0, 'malformed response must explicitly fail checks, not just throw a k6 JS exception');
  }
  console.log('V6 fake lifecycle, ownership and k6 HTTP regressions passed (NOT live evidence)');
} finally { rmSync(dir, { recursive: true, force: true }); }
