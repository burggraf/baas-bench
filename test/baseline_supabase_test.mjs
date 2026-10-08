import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { NativeBaseline, stableBindMountManifest } from '../baseline/native.mjs';
import { runInNewContext } from 'node:vm';

const exact = JSON.parse(readFileSync(new URL('./fixtures/v6_supabase_mounts.json', import.meta.url)));
function deployment() {
  const dir = mkdtempSync(join(tmpdir(), 'v6-supabase-fake-'));
  const source = join(dir, 'supabase/docker');
  mkdirSync(source, { recursive: true });
  const config = { services: {}, volumes: { 'db-config': {}, 'deno-cache': {}, 'storage-data': {} } };
  for (const v of exact.binds) {
    const path = join(source, v.source);
    if (v.source === 'volumes/db/data' || ['volumes/functions', 'volumes/snippets'].includes(v.source)) {
      mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'input'), 'original');
    } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'original'); }
    const s = config.services[v.service] ??= { image: 'synthetic-image', volumes: [] };
    s.volumes.push({ type: 'bind', source: path, target: v.target, read_only: v.read_only });
  }
  for (const name of ['auth', 'rest', 'realtime', 'storage', 'imgproxy', 'meta']) config.services[name] = { image: 'synthetic-image' };
  config.services['api-gw'].image = 'envoyproxy/envoy:v1.39.1';
  writeFileSync(join(source, '.env'), 'POSTGRES_PASSWORD=synthetic-test-password\nANON_KEY=synthetic-anon\nSERVICE_ROLE_KEY=synthetic-service\n');
  writeFileSync(join(source, 'docker-compose.yml'), 'synthetic source compose');
  return { dir, source, config, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('exact-pin Supabase bind inputs are all fingerprinted, including writable SQL and source directories', () => {
  const d = deployment(); try {
    const manifest = stableBindMountManifest(d.config, d.source);
    const expected = exact.binds.filter(v => v.source !== 'volumes/db/data');
    assert.equal(manifest.length, expected.length, 'every exact-pin stable bind requires coverage');
    for (const v of expected) {
      const entry = manifest.find(m => m.service === v.service && m.target === v.target);
      assert.ok(entry, `missing coverage: ${v.service}:${v.target}`);
      assert.equal(entry.read_only, v.read_only);
      assert.ok(entry.files.length);
    }
  } finally { d.clean(); }
});

test('writable initialization SQL tampering changes the bind manifest', () => {
  const d = deployment(); try {
    const before = stableBindMountManifest(d.config, d.source);
    writeFileSync(join(d.source, 'volumes/db/roles.sql'), 'changed');
    assert.notDeepEqual(stableBindMountManifest(d.config, d.source), before);
  } finally { d.clean(); }
});

test('only the exact native PostgreSQL data mount is excluded as mutable', () => {
  const d = deployment(); try {
    const before = stableBindMountManifest(d.config, d.source);
    writeFileSync(join(d.source, 'volumes/db/data/input'), 'database changed');
    assert.deepEqual(stableBindMountManifest(d.config, d.source), before);
    const data = d.config.services.db.volumes.find(v => v.source.endsWith('/data'));
    data.target = '/unexpected';
    assert.throws(() => stableBindMountManifest(d.config, d.source), /mutable.*mount/);
  } finally { d.clean(); }
});

test('mutable data mount cannot redirect writes through a symlink', () => {
  const d = deployment(); try {
    const data = join(d.source, 'volumes/db/data'), external = join(d.dir, 'external-data');
    mkdirSync(external); rmSync(data, { recursive: true }); symlinkSync(external, data);
    assert.throws(() => stableBindMountManifest(d.config, d.source), /mutable.*mount/);
  } finally { d.clean(); }
});

test('unexpected external binds are refused rather than silently omitted', () => {
  const d = deployment(); try {
    d.config.services.rest.volumes = [{ type: 'bind', source: '/var/run/docker.sock', target: '/socket', read_only: true }];
    assert.throws(() => stableBindMountManifest(d.config, d.source), /outside.*source/);
  } finally { d.clean(); }
});

test('symlinked ancestors cannot hide input files outside the source root', () => {
  const d = deployment(); try {
    const external = join(d.dir, 'external'); mkdirSync(external); writeFileSync(join(external, 'config'), 'external');
    symlinkSync(external, join(d.source, 'linked'));
    d.config.services.rest.volumes = [{ type: 'bind', source: join(d.source, 'linked/config'), target: '/config', read_only: true }];
    assert.throws(() => stableBindMountManifest(d.config, d.source), /symbolic link/);
  } finally { d.clean(); }
});

function setupBackend(d, ref = exact.upstream_ref) {
  const calls = [];
  const b = Object.create(NativeBaseline.prototype);
  Object.assign(b, { root: '/synthetic-v6-root', dir: d.dir, source: d.source, runDir: d.dir, pins: { SUPABASE_REF: exact.upstream_ref, SUPABASE_ENVOY_IMAGE: 'envoy-pin' }, inv: { owner: 'ours', name: 'v6-supabase-test', base: 'http://127.0.0.1:54321' }, localDocker() {},
    spawnCommand(exe, args, options) {
      calls.push({ exe, args });
      if (exe.endsWith('/bin/baas')) { assert.deepEqual(args, ['setup', 'supabase']); assert.equal(options.env.BAAS_RUNTIME_DIR, d.dir); return { status: 0, stdout: '', stderr: '' }; }
      if (exe === 'git') return { status: 0, stdout: ref + '\n', stderr: '' };
      assert.equal(exe, 'docker');
      if (args.includes('config')) return { status: 0, stdout: JSON.stringify(d.config), stderr: '' };
      assert.deepEqual(args.slice(0, 2), ['image', 'inspect']); return { status: 0, stdout: JSON.stringify([{ Id: 'sha256:' + 'a'.repeat(64) }]), stderr: '' };
    }
  });
  return { b, calls };
}

test('actual isolated Supabase setup binds source provenance and stays within total resource ceilings', async () => {
  const d = deployment(); try {
    const { b, calls } = setupBackend(d); await b.setupSupabase();
    const configured = JSON.parse(readFileSync(join(d.dir, 'compose.json')));
    const services = Object.values(configured.services);
    assert.equal(services.length, 11);
    assert.ok(services.reduce((s, v) => s + Number(v.cpus), 0) <= 4.000001, 'approved 4 CPUs applies to the whole backend, not each service');
    assert.ok(services.reduce((s, v) => s + Number(v.mem_limit.replace(/m$/, '')), 0) <= 4096, '4 GiB applies to the whole backend');
    for (const s of services) { assert.equal(s.image, 'sha256:' + 'a'.repeat(64)); assert.equal(s.labels['baas-bench.v6-owner'], 'ours'); assert.equal(s.restart, 'no'); }
    assert.equal(configured.services['api-gw'].ports[0].host_ip, '127.0.0.1');
    assert.ok(calls.some(c => c.exe === 'git' && c.args.includes('HEAD')));
    assert.equal(JSON.parse(readFileSync(join(d.dir, 'source.json'))).ref, exact.upstream_ref);
  } finally { d.clean(); }
});

test('approved CPU reallocation leaves memory ceilings and native health checks unchanged', async () => {
  const d = deployment(); try {
    const health = { test: ['CMD-SHELL', "node -e \"fetch('http://localhost:3000/api/platform/profile').then(r => { if (r.status !== 200) throw new Error(r.status) })\""], interval: '5s', timeout: '10s', start_period: '20s', retries: 3 };
    d.config.services.studio.healthcheck = health;
    const { b } = setupBackend(d); await b.setupSupabase();
    const configured = JSON.parse(readFileSync(join(d.dir, 'compose.json')));
    assert.equal(configured.services.db.cpus, 1, 'DB receives 1 CPU within the approved 4-CPU total');
    assert.equal(configured.services.studio.cpus, 0.3, 'Studio keeps its passing startup CPU ceiling');
    assert.equal(configured.services.db.mem_limit, '1536m');
    for (const [name, s] of Object.entries(configured.services)) if (name !== 'db') {
      assert.equal(s.mem_limit, '256m'); assert.equal(s.cpus, 0.3, 'all ten non-DB services receive 0.3 CPU');
    }
    assert.deepEqual(configured.services.studio.healthcheck, health, 'never relax stock health checks to admit startup');
  } finally { d.clean(); }
});

test('Supabase startup waits for all unchanged native health checks before seeding', async () => {
  const calls = [], b = Object.create(NativeBaseline.prototype);
  Object.assign(b, { pg: true, inv: { owner: 'ours' }, owned() { return []; }, loadKeys() {}, compose(args) { calls.push(args); } });
  await b.start();
  assert.deepEqual(calls, [['up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '120']]);
});

test('native static checkout inputs stay readable while their runtime parent stays private', async () => {
  const d = deployment(), original = process.umask(0o077); try {
    const { b } = setupBackend(d), spawn = b.spawnCommand;
    b.spawnCommand = (exe, args, options) => {
      if (exe.endsWith('/bin/baas')) {
        assert.equal(process.umask(), 0o022, 'public checkout inputs need native non-owner read permissions');
        assert.equal(lstatSync(d.dir).mode & 0o077, 0, 'outer runtime must remain private');
      }
      return spawn(exe, args, options);
    };
    await b.setupSupabase(); assert.equal(process.umask(), 0o077);
    assert.equal(lstatSync(join(d.source, '.env')).mode & 0o077, 0);
    assert.equal(lstatSync(join(d.dir, 'compose.json')).mode & 0o077, 0);
  } finally { process.umask(original); d.clean(); }
});

test('failed source setup restores the private process umask', async () => {
  const d = deployment(), original = process.umask(0o077); try {
    const { b } = setupBackend(d);
    b.spawnCommand = () => { assert.equal(process.umask(), 0o022); return { status: 1, stdout: '', stderr: 'synthetic setup failure' }; };
    await assert.rejects(b.setupSupabase(), /isolated Supabase source setup failed/);
    assert.equal(process.umask(), 0o077);
  } finally { process.umask(original); d.clean(); }
});

test('native PostgreSQL snapshot and restore wait for bounded DB-only readiness', async () => {
  const d = deployment(); try {
    const { b } = setupBackend(d); await b.setupSupabase();
    const calls = [];
    b.pg = true; b.baselineState = { auth: 'synthetic' }; b.stop = async () => calls.push(['stop']);
    b.owned = () => [{ Config: { Labels: { 'com.docker.compose.service': 'db' } }, State: { Running: true } }];
    b.compose = args => {
      calls.push(args);
      if (args[0] === 'up') {
        assert.ok(args.includes('--wait'), 'DB-only start must wait before native backup/restore');
        assert.equal(args[args.indexOf('--wait-timeout') + 1], '120');
        assert.equal(args.at(-1), 'db'); assert.ok(args.includes('--no-deps')); assert.ok(args.includes('never'));
      }
      if (args[0] === 'cp' && args[1] === 'db:/tmp/v6-baseline.dump') writeFileSync(join(d.dir, 'database.dump'), 'synthetic backup');
      if (args.includes('--list')) {
        const actual = JSON.parse(readFileSync(new URL('./fixtures/v6_supabase_archive_list.json', import.meta.url)));
        return args.includes('--create') ? actual.withCreate : actual.withoutCreate;
      }
      return '';
    };
    b.docker = () => JSON.stringify([{ Id: 'sha256:' + 'a'.repeat(64), Architecture: 'arm64', RepoDigests: [] }]);
    const snapshot = await b.snapshot();
    assert.ok(snapshot.files.includes('source.json'));
    assert.ok(calls.some(args => args.includes('pg_dump') && args.includes('--create')), 'archive preserves database creation/settings');
    calls.length = 0;
    await b.restore({ state: b.baselineState });
    const restore = calls.find(args => args.includes('pg_restore') && !args.includes('--list'));
    const drop = calls.find(args => args.includes('dropdb'));
    assert.deepEqual(drop, ['exec', '-T', 'db', 'dropdb', '--force', '--if-exists', '-U', 'supabase_admin', '--maintenance-db', 'template1', 'postgres'], 'terminate only connections to the owned postgres database');
    assert.ok(calls.indexOf(drop) < calls.indexOf(restore), 'force-drop precedes archived creation/restore');
    assert.equal(restore[restore.indexOf('-U') + 1], 'supabase_admin', 'full native restore needs the maintenance administrator to restore owned event triggers');
    assert.ok(!restore.includes('--no-owner') && !restore.includes('--disable-triggers'), 'retain native ownership and triggers');
    assert.ok(restore.includes('--exit-on-error') && restore.includes('--clean') && restore.includes('--if-exists'));
    assert.ok(restore.includes('--create'), 'drop/recreate database rather than individually dropping inherited constraints');
    assert.equal(restore[restore.indexOf('-d') + 1], 'template1', 'maintenance connection stays outside the recreated database');
    assert.equal(calls.filter(args => args[0] === 'up').length, 1);
    const normalCompose = b.compose;
    for (const wrong of ['; dbname: unrelated\n1; 1262 1 DATABASE - unrelated postgres\n', '; dbname: postgres\n1; 1262 1 DATABASE - unrelated postgres\n', '; dbname: postgres\n1; 1262 1 DATABASE - postgres postgres\n2; 1262 2 DATABASE - unrelated postgres\n']) {
      calls.length = 0;
      b.compose = args => args.includes('--list') ? wrong : normalCompose(args);
      await assert.rejects(b.restore({ state: b.baselineState }), /archive.*database/);
      assert.ok(!calls.some(args => args.includes('dropdb') || (args.includes('pg_restore') && !args.includes('--list'))), 'wrong archive target cannot drop or recreate any database');
    }
    b.compose = normalCompose; calls.length = 0;
    b.owned = () => [{ Config: { Labels: { 'com.docker.compose.service': 'db' } }, State: { Running: true } }, { Config: { Labels: { 'com.docker.compose.service': 'auth' } }, State: { Running: true } }];
    await assert.rejects(b.restore({ state: b.baselineState }), /database.*writers/);
    assert.ok(!calls.some(args => args.includes('dropdb') || (args.includes('pg_restore') && !args.includes('--list'))), 'never drop or recreate while another service is running');
    calls.length = 0;
    b.owned = () => [{ Config: { Labels: { 'com.docker.compose.service': 'db' } }, State: { Running: true } }];
    const blocked = new Error('native forced drop blocked');
    b.compose = args => { if (args.includes('dropdb')) { calls.push(args); throw blocked; } return normalCompose(args); };
    await assert.rejects(b.restore({ state: b.baselineState }), e => e === blocked);
    assert.ok(!calls.some(args => args.includes('pg_restore') && !args.includes('--list')), 'native forced-drop failure stops before archive restore');
  } finally { d.clean(); }
});

test('Supabase readiness uses its normal native anonymous key rather than an unauthenticated gateway request', async () => {
  const requests = [];
  // Evaluate the actual method body with a fake timer and HTTP transport; no real
  // platform and no 120-second delay. Do not rewrite its control flow or assertions.
  const ready = runInNewContext(`({ ${NativeBaseline.prototype.ready.toString()} }).ready`, {
    AbortSignal, sleep: async () => {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: options.headers?.apikey === 'synthetic-anon' && options.headers?.Authorization === 'Bearer synthetic-anon' };
    }
  });
  await ready.call({ pg: true, anon: 'synthetic-anon', inv: { base: 'http://native-gateway' } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://native-gateway/auth/v1/health');
});

test('TrailBase readiness remains unauthenticated and rejects persistent unhealthy responses', async () => {
  const requests = [];
  const ready = runInNewContext(`({ ${NativeBaseline.prototype.ready.toString()} }).ready`, {
    AbortSignal, sleep: async () => {},
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true }; }
  });
  await ready.call({ pg: false, inv: { base: 'http://native-trailbase' } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://native-trailbase/api/healthcheck');
  assert.equal(requests[0].options.headers?.apikey, undefined);
  const unhealthy = runInNewContext(`({ ${NativeBaseline.prototype.ready.toString()} }).ready`, {
    AbortSignal, sleep: async () => {}, fetch: async () => ({ ok: false })
  });
  await assert.rejects(unhealthy.call({ pg: true, anon: 'synthetic-anon', inv: { base: 'http://native-gateway' } }), /native readiness failed/);
});

test('owned cleanup records native pre-stop state without recording environment secrets', async () => {
  const d = deployment(); try {
    const { b } = setupBackend(d); b.pg = true;
    const c = { Id: 'a'.repeat(64), Config: { Image: 'immutable-image', Labels: { 'baas-bench.v6-owner': 'ours', 'com.docker.compose.service': 'rest' }, Env: ['SECRET=synthetic-do-not-retain'] }, State: { Running: true, ExitCode: 0, OOMKilled: false }, RestartCount: 0 };
    const calls = []; b.owned = () => [c];
    b.docker = args => { calls.push(args); return args[0] === 'ps' ? c.Id : args[0] === 'inspect' ? JSON.stringify([c]) : ''; };
    await b.stop();
    assert.ok(existsSync(join(d.dir, 'owned-pre-stop-state.json')), 'native cleanup must retain pre-stop state to distinguish termination from a crash');
    const evidence = readFileSync(join(d.dir, 'owned-pre-stop-state.json'), 'utf8');
    assert.equal(evidence.includes('synthetic-do-not-retain'), false);
    assert.equal(evidence.includes('SECRET'), false);
    assert.deepEqual(JSON.parse(evidence).containers, [{ id: c.Id, service: 'rest', image: 'immutable-image', running: true, exitCode: 0, oomKilled: false, restarts: 0 }]);
    assert.ok(calls.some(args => args[0] === 'stop'));
  } finally { d.clean(); }
});

test('wrong Supabase source revision prevents deployment configuration', async () => {
  const d = deployment(); try {
    const { b } = setupBackend(d, 'b'.repeat(40));
    await assert.rejects(b.setupSupabase(), /source.*pin/);
  } finally { d.clean(); }
});
