import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, lstatSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { FIXTURE_COLUMNS } from './profile/lib/fixture.mjs';
import { parseBootstrapCredentials } from '../benchmark-sets/realworld-api-v4/shared/lib/admin/trailbase-bootstrap.mjs';
import { TrailVolume } from './trail-volume.mjs';
import { waitForCapacityTokenEligibility } from './auth.mjs';

const tables = Object.keys(FIXTURE_COLUMNS);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const quote = v => v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function commandOutput(result, includeStderr = false) {
  const stdout = result.stdout ?? '';
  return includeStderr ? [stdout, result.stderr ?? ''].filter(Boolean).join('\n') : stdout;
}
export function assertOwned(containers, owner) {
  for (const c of containers) assert.equal(c.Config?.Labels?.['baas-bench.v6-owner'], owner, 'refusing unowned deployment');
}
export function stableBindMountManifest(config, sourceRoot) {
  const root = resolve(sourceRoot);
  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'unsafe bind source root');
  const filesUnder = path => {
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `symbolic link in stable bind mount: ${relative(root, path)}`);
    if (stat.isFile()) return [{ path: relative(root, path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }];
    assert.ok(stat.isDirectory(), `unsupported stable bind mount entry: ${relative(root, path)}`);
    return readdirSync(path).sort().flatMap(name => filesUnder(join(path, name)));
  };
  return Object.entries(config.services).sort(([a], [b]) => a.localeCompare(b)).flatMap(([service, value]) =>
    (value.volumes ?? []).filter(volume => volume.type === 'bind').flatMap(volume => {
      const source = resolve(volume.source);
      assert.ok(source.startsWith(root + sep), 'bind mount outside isolated source root');
      const local = relative(root, source);
      for (let parent = dirname(source); parent !== root; parent = dirname(parent)) {
        assert.ok(!lstatSync(parent).isSymbolicLink(), 'symbolic link in bind source ancestor');
      }
      if (local === 'volumes/db/data') {
        const stat = lstatSync(source, { throwIfNoEntry: false });
        assert.ok(service === 'db' && volume.target === '/var/lib/postgresql/data' && volume.read_only !== true && (!stat || (stat.isDirectory() && !stat.isSymbolicLink())), 'unexpected mutable database mount');
        return []; // Native PostgreSQL data is mutable; every other bind is a retained input.
      }
      return [{ service, target: volume.target, source: local, read_only: volume.read_only === true, files: filesUnder(source) }];
    })
  ).sort((a, b) => `${a.service}:${a.target}`.localeCompare(`${b.service}:${b.target}`));
}
export class NativeBaseline {
  constructor({ root, dir, platform, fixture }) {
    Object.assign(this, { root, dir, platform, fixture });
    this.pg = platform === 'supabase';
    this.depot = join(dir, 'depot');
    this.source = join(dir, 'supabase/docker');
    this.shared = join(root, 'baseline/profile');
    this.inventoryPath = join(dir, 'inventory.json');
    this.runDir = join(dir, `run-${Date.now()}-${randomBytes(3).toString('hex')}`);
    mkdirSync(this.runDir, { mode: 0o700 });
    this.pins = Object.fromEntries(readFileSync(join(root, 'benchmark-sets/realworld-api-v5/versions.env'), 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => l.split(/=(.*)/s).slice(0, 2)));
    if (existsSync(this.inventoryPath)) {
      this.inv = JSON.parse(readFileSync(this.inventoryPath));
      assert.ok([1, 2].includes(this.inv.format) && this.inv.platform === platform && /^[a-f0-9]{32}$/.test(this.inv.owner) && this.inv.name === `v6-${platform}-${this.inv.owner.slice(0, 12)}` && /^http:\/\/127\.0\.0\.1:\d+$/.test(this.inv.base), 'invalid ownership inventory');
    }
  }
  command(exe, args, input, timeout = 180000, includeStderr = false) {
    const run = this.spawnCommand ?? spawnSync;
    const r = run(exe, args, { input, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      writeFileSync(join(this.runDir, `command-failure-${Date.now()}.log`), r.stderr ?? String(r.error ?? ''), { mode: 0o600 });
      throw new Error(`${exe} ${args[0]} failed (status ${r.status}; private log retained)`);
    }
    return commandOutput(r, includeStderr);
  }
  localDocker() {
    if (this.localConfigured) return;
    const contextHost = this.command('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
    const host = process.env.DOCKER_CONTEXT ? contextHost : process.env.DOCKER_HOST || contextHost;
    assert.match(host, /^unix:\/\//, 'only local Docker allowed');
    process.env.DOCKER_HOST = host; delete process.env.DOCKER_CONTEXT; this.localConfigured = true;
  }
  docker(args, input, timeout = 180000, includeStderr = false) { this.localDocker(); return this.command('docker', args, input, timeout, includeStderr); }
  compose(args, input) { return this.docker(['compose', '-p', this.inv.name, '--project-directory', this.source, '-f', join(this.dir, 'compose.json'), ...args], input); }
  save(name, value) { writeFileSync(join(this.dir, name), JSON.stringify(value, null, 2), { mode: 0o600 }); }
  async preflight() {
    assert.ok(!this.inv || existsSync(join(this.dir, 'manifest.json')), 'incomplete preparation: preserve evidence and rebuild explicitly, never reseed in place');
    const disk = this.command('df', ['-Pk', this.dir]).trim().split('\n').at(-1).trim().split(/\s+/);
    assert.ok(Number(disk[3]) >= 5 * 1024 * 1024, 'at least 5 GiB free disk required; no automatic image pull');
    this.localDocker();
    if (!this.pg) { this.command('sqlite3', ['--version']); this.docker(['image', 'inspect', this.pins.TRAILBASE_IMAGE]); }
    // Event-driven timer, not a holding shell sleep. Follow-up operator runs via managed process.
    console.log('V6 preflight: require continuously empty Docker listing for 300 seconds');
    let emptySince = null;
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      const ids = this.docker(['ps', '-q']).trim();
      if (ids) emptySince = null; else emptySince ??= Date.now();
      if (emptySince !== null && Date.now() - emptySince >= 300000) return;
      await sleep(1000);
    }
    throw new Error('Docker was not continuously empty for 5 minutes within 15 minutes; nothing started');
  }
  owned() {
    if (!this.inv) return [];
    const ids = this.pg ? this.docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${this.inv.name}`]).trim().split(/\s+/).filter(Boolean)
      : this.docker(['ps', '-aq', '--filter', `name=^/${this.inv.name}$`]).trim().split(/\s+/).filter(Boolean);
    const cs = ids.length ? JSON.parse(this.docker(['inspect', ...ids])) : [];
    assertOwned(cs, this.inv.owner); return cs;
  }
  async stop() {
    const cs = this.owned(); // Detect a colliding name/project even when it lacks our label.
    if (!this.inv) return;
    if (this.pg && this.runDir) {
      writeFileSync(join(this.runDir, 'owned-pre-stop-state.json'), JSON.stringify({ at: new Date().toISOString(), containers: cs.map(c => ({ id: c.Id, service: c.Config?.Labels?.['com.docker.compose.service'] ?? null, image: c.Config?.Image, running: c.State?.Running, exitCode: c.State?.ExitCode, oomKilled: c.State?.OOMKilled, restarts: c.RestartCount })) }, null, 2), { mode: 0o600 });
    }
    const ids = this.docker(['ps', '-aq', '--filter', `label=baas-bench.v6-owner=${this.inv.owner}`]).trim().split(/\s+/).filter(Boolean);
    if (ids.length) {
      assertOwned(JSON.parse(this.docker(['inspect', ...ids])), this.inv.owner);
      this.docker(['stop', '--time', '30', ...ids]);
    } else if (cs.length) throw new Error('owned deployment disappeared during stop');
  }
  async newInventory() {
    assert.ok(!existsSync(this.inventoryPath), 'incomplete existing preparation: preserve and inspect manually; no automatic reseed');
    const owner = randomBytes(16).toString('hex');
    const port = await new Promise((resolve, reject) => {
      const server = createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(e => e ? reject(e) : resolve(port)); });
    });
    this.inv = { format: this.pg ? 1 : 2, platform: this.platform, owner, name: `v6-${this.platform}-${owner.slice(0, 12)}`, base: `http://127.0.0.1:${port}` };
    if (!this.pg) Object.assign(this.inv, { storage: 'docker-volume', volume: `${this.inv.name}-depot` });
    this.save('inventory.json', this.inv);
    if (!this.pg) {
      mkdirSync(join(this.depot, 'migrations/main'), { recursive: true, mode: 0o700 });
      copyFileSync(join(this.shared, 'trailbase/bootstrap-config.textproto'), join(this.depot, 'config.textproto'));
      copyFileSync(join(this.shared, 'trailbase/migration.sql'), join(this.depot, 'migrations/main/U1785764902__v5.sql'));
      this.volume().initialize();
    }
  }
  async setupSupabase() {
    assert.ok(lstatSync(this.dir).isDirectory() && !lstatSync(this.dir).isSymbolicLink() && (lstatSync(this.dir).mode & 0o077) === 0, 'Supabase runtime parent must be private');
    // Git's public static inputs must be readable by native service UIDs. The outer
    // runtime remains 0700 and bin/baas restricts generated .env keys to 0600.
    const previousMask = process.umask(0o022);
    let r;
    try {
      r = (this.spawnCommand ?? spawnSync)(join(this.root, 'bin/baas'), ['setup', 'supabase'], { env: { ...process.env, BAAS_RUNTIME_DIR: this.dir, BAAS_VERSION_PROFILE: 'realworld-api-v5' }, encoding: 'utf8', timeout: 180000 });
    } finally { process.umask(previousMask); }
    writeFileSync(join(this.runDir, 'source-setup.log'), `${r.stdout ?? ''}\n${r.stderr ?? ''}`, { mode: 0o600 });
    assert.equal(r.status, 0, 'isolated Supabase source setup failed');
    const ref = this.command('git', ['-C', dirname(this.source), 'rev-parse', 'HEAD']).trim();
    assert.equal(ref, this.pins.SUPABASE_REF, 'Supabase source revision does not match pin');
    const envPath = join(this.source, '.env');
    const envText = readFileSync(envPath, 'utf8').replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`);
    writeFileSync(envPath, envText, { mode: 0o600 });
    const config = JSON.parse(this.docker(['compose', '--project-directory', this.source, '--env-file', envPath, '-f', join(this.source, 'docker-compose.yml'), 'config', '--format', 'json']));
    config.name = this.inv.name;
    const otherServices = Object.keys(config.services).filter(name => name !== 'db').length;
    assert.ok(config.services.db && config.services.studio && otherServices > 1, 'native multi-service Supabase required');
    let gateway = false;
    for (const [name, s] of Object.entries(config.services)) {
      delete s.container_name; delete s.ports; s.restart = 'no';
      s.labels = { ...s.labels, 'baas-bench.v6-owner': this.inv.owner };
      // Approved local Supabase diagnostic: at most 4 CPUs / 4 GiB in fixed
      // per-service ceilings, not a shared pool or equivalent to TrailBase's 2 CPUs.
      s.cpus = name === 'db' ? 1 : Math.floor(3000000 / otherServices) / 1000000;
      s.mem_limit = name === 'db' ? '1536m' : `${Math.floor(2560 / otherServices)}m`;
      if (s.image?.startsWith('envoyproxy/envoy:')) {
        s.image = this.pins.SUPABASE_ENVOY_IMAGE; gateway = true;
        s.ports = [{ target: 8000, published: this.inv.base.split(':').at(-1), host_ip: '127.0.0.1', protocol: 'tcp' }];
      }
      assert.ok(s.image && !s.build, 'only pinned upstream images allowed');
      // Resolve source-pinned upstream tags once to immutable local content IDs.
      s.image = JSON.parse(this.docker(['image', 'inspect', s.image]))[0].Id;
      for (const v of s.volumes ?? []) if (v.type === 'bind') assert.ok(v.source.startsWith(`${this.source}/`) || v.source === '/var/run/docker.sock', 'unexpected mount');
    }
    assert.ok(gateway, 'pinned native gateway absent');
    for (const v of Object.values(config.volumes ?? {})) { delete v.name; assert.ok(!v.external); }
    for (const v of Object.values(config.networks ?? {})) { delete v.name; assert.ok(!v.external); }
    stableBindMountManifest(config, this.source); // Validate coverage before any backend starts.
    this.save('source.json', { ref, compose_sha256: createHash('sha256').update(readFileSync(join(this.source, 'docker-compose.yml'))).digest('hex') });
    this.save('compose.json', config);
  }
  async start() {
    const fresh = !this.inv;
    if (fresh) {
      // newInventory writes only ownership and TrailBase config; Supabase setup is explicitly isolated.
      await this.newInventory();
      if (this.pg) await this.setupSupabase();
    }
    this.owned();
    if (this.pg) {
      this.loadKeys(); this.compose(['up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '120']);
    } else {
      this.docker(['image', 'inspect', this.pins.TRAILBASE_IMAGE]);
      this.volume().check();
      const existing = this.owned();
      assert.ok(existing.length <= 1, 'ambiguous owned TrailBase deployment');
      for (const c of existing) {
        const mounts = c.Mounts?.filter(m => m.Destination === '/app/traildepot');
        assert.ok(mounts?.length === 1 && mounts[0].Type === 'volume' && mounts[0].Name === this.inv.volume, 'unexpected live depot mount');
      }
      if (existing.length) this.docker(['start', this.inv.name]);
      else this.docker(['run', '-d', '--pull', 'never', '--name', this.inv.name, '--label', `baas-bench.v6-owner=${this.inv.owner}`, '--user', `${process.getuid()}:${process.getgid()}`, '--cpus', '2', '--memory', '4g', '-p', `127.0.0.1:${this.inv.base.split(':').at(-1)}:4000`, '-e', 'ADDRESS=0.0.0.0:4000', '--mount', `type=volume,source=${this.inv.volume},target=/app/traildepot,volume-nocopy`, this.pins.TRAILBASE_IMAGE]);
    }
  }
  loadKeys() {
    const text = readFileSync(join(this.source, '.env'), 'utf8');
    const get = k => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].replace(/^['"]|['"]$/g, '');
    this.anon = get('ANON_KEY'); this.service = get('SERVICE_ROLE_KEY'); assert.ok(this.anon && this.service);
  }
  async call(path, { method = 'GET', body, token, admin = false } = {}) {
    const response = await fetch(`${this.inv.base}${path}`, { method, signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', ...(this.pg ? { apikey: admin ? this.service : this.anon, Authorization: `Bearer ${token ?? (admin ? this.service : this.anon)}` } : token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, `native HTTP ${response.status}: ${path.split('?')[0]}`);
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }
  verifyConfiguration() {
    if (!this.pg) { this.volume().check(); return; }
    const source = JSON.parse(readFileSync(join(this.dir, 'source.json'), 'utf8'));
    assert.equal(source.ref, this.pins.SUPABASE_REF, 'Supabase source provenance changed');
    assert.equal(this.command('git', ['-C', dirname(this.source), 'rev-parse', 'HEAD']).trim(), source.ref, 'Supabase source revision does not match pin');
    const expected = JSON.parse(readFileSync(join(this.dir, 'mounts.json'), 'utf8'));
    const compose = JSON.parse(readFileSync(join(this.dir, 'compose.json'), 'utf8'));
    assert.deepEqual(stableBindMountManifest(compose, this.source), expected, 'Supabase bind-mounted configuration changed');
  }
  async ready() {
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(`${this.inv.base}${this.pg ? '/auth/v1/health' : '/api/healthcheck'}`, { signal: AbortSignal.timeout(5000), ...(this.pg ? { headers: { apikey: this.anon, Authorization: `Bearer ${this.anon}` } } : {}) });
        if (r.ok) return;
      } catch {}
      await sleep(1000);
    }
    throw new Error('native readiness failed');
  }
  async bootstrapCredentials({ now = () => performance.now(), pause = sleep } = {}) {
    const path = join(this.dir, 'admin.json');
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
    const deadline = now() + 5000;
    let lastError;
    while (now() < deadline) {
      const remaining = deadline - now();
      if (remaining < 1) break;
      const timeout = Math.min(2000, Math.floor(remaining));
      const logs = this.docker(['logs', '--tail', '100', this.inv.name], undefined, timeout, true);
      try {
        const credentials = parseBootstrapCredentials(logs);
        this.save('admin.json', credentials);
        return credentials;
      } catch (error) { lastError = error; }
      const remainingAfter = deadline - now();
      if (remainingAfter > 0) await pause(Math.min(250, remainingAfter));
    }
    throw lastError ?? new Error('TrailBase bootstrap administrator was not found in backend logs');
  }
  async adminClient() {
    if (!this.admin) {
      const require = createRequire(join(this.root, '.runtime/conformance-v5/sdk/package.json'));
      const { initClient } = await import(require.resolve('trailbase'));
      const creds = await this.bootstrapCredentials();
      this.admin = initClient(this.inv.base); await this.admin.login(creds.email, creds.password);
    }
    return this.admin;
  }
  async query(sql) {
    if (this.pg) {
      const output = this.compose(['exec', '-T', 'db', 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], `SELECT coalesce(json_agg(r), '[]'::json) FROM (${sql}) r;`);
      return JSON.parse(output.trim()).map(Object.values);
    }
    const admin = await this.adminClient();
    const r = await admin.fetch('/api/_admin/query', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', 'CSRF-Token': admin.tokens()?.csrf_token ?? '' }, body: JSON.stringify({ query: sql, attached_databases: null }) });
    assert.ok(r.ok, 'native admin query failed');
    return (await r.json()).rows.map(row => row.map(v => v === 'Null' ? null : v?.Text ?? v?.Integer ?? v?.Real ?? v));
  }
  async execute(sql) {
    if (this.pg) this.compose(['exec', '-T', 'db', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], sql);
    else await this.query(sql);
  }
  async seed() {
    if (this.pg) await this.execute(readFileSync(join(this.shared, 'sql/postgres-schema.sql'), 'utf8') + '\n' + readFileSync(join(this.shared, 'sql/supabase-rls.sql'), 'utf8'));
    for (const table of tables) {
      const cols = FIXTURE_COLUMNS[table].map(c => !this.pg && c === 'id' ? 'external_id' : c);
      await this.execute(`INSERT INTO ${this.pg ? 'public.' : ''}${table}(${cols.join(',')}) VALUES ${this.fixture.rows[table].map(r => `(${r.map(quote).join(',')})`).join(',')};`);
    }
    const password = `V6-${randomBytes(24).toString('hex')}!`;
    for (const row of this.fixture.rows.users) {
      let user;
      if (this.pg) user = await this.call('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email: row[1], password, email_confirm: true } });
      else {
        const admin = await this.adminClient();
        const r = await admin.fetch('/api/_admin/user', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', 'CSRF-Token': admin.tokens()?.csrf_token ?? '' }, body: JSON.stringify({ email: row[1], password, verified: true, admin: false }) });
        assert.ok(r.ok, 'native Auth bootstrap failed'); user = await r.json();
      }
      assert.equal(typeof user.id, 'string');
      await this.execute(`UPDATE ${this.pg ? 'public.' : ''}users SET auth_subject=${quote(this.pg ? user.id : user.id.replaceAll('-', ''))} WHERE ${this.pg ? 'id' : 'external_id'}=${quote(row[0])}`);
    }
    this.save('credentials.json', { password });
    if (!this.pg) {
      this.volume().check(); this.owned();
      this.docker(['cp', join(this.shared, 'trailbase/config.textproto'), `${this.inv.name}:/app/traildepot/config.textproto`]);
      this.docker(['kill', '--signal', 'SIGHUP', this.inv.name]);
    }
  }
  async state() {
    const state = { application: {}, auth: null };
    for (const t of tables) {
      const logicalColumns = FIXTURE_COLUMNS[t].map(c => !this.pg && c === 'id' ? 'external_id' : c);
      const logical = await this.query(`SELECT ${logicalColumns.join(',')} FROM ${this.pg ? 'public.' : ''}${t} ORDER BY ${this.pg ? 'id' : 'external_id'}`);
      const normalize = rows => rows.map(r => r.map((v, i) => v != null && /(_at|due_date)$/.test(FIXTURE_COLUMNS[t][i]) ? new Date(v).toISOString() : v)).sort((a, b) => a[0].localeCompare(b[0]));
      assert.deepEqual(normalize(logical), normalize(this.fixture.rows[t]), `${t} logical fixture mismatch`);
      const rows = await this.query(`SELECT * FROM ${this.pg ? 'public.' : ''}${t} ORDER BY ${this.pg ? 'id' : 'external_id'}`);
      state.application[t] = { count: rows.length, sha256: hash(rows), logical_sha256: hash(normalize(logical)) };
    }
    const linkage = await this.query(this.pg ? 'SELECT count(*) FROM public.users u JOIN auth.users a ON u.auth_subject=a.id::text AND u.email=a.email'
      : 'SELECT count(*) FROM users u JOIN _user a ON lower(u.auth_subject)=lower(hex(a.id)) AND u.email=a.email');
    assert.equal(linkage[0][0], this.fixture.rows.users.length, 'native Auth linkage mismatch');
    const auth = await this.query(this.pg ? 'SELECT * FROM auth.users ORDER BY id' : 'SELECT * FROM _user WHERE email IN (SELECT email FROM users) ORDER BY email');
    state.auth = hash(auth);
    if (this.pg) { state.identities = hash(await this.query('SELECT * FROM auth.identities ORDER BY id')); assert.equal((await this.query('SELECT count(*) FROM auth.sessions'))[0][0], 0, 'baseline must have zero sessions'); assert.equal((await this.query('SELECT count(*) FROM auth.refresh_tokens'))[0][0], 0, 'baseline must have zero refresh tokens'); }
    return state;
  }
  async assertRefreshRevoked(refreshToken) {
    assert.ok(typeof refreshToken === 'string' && refreshToken.length > 0, 'administrator refresh token missing');
    const r = await fetch(`${this.inv.base}/api/auth/v1/refresh`, { method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
    assert.ok([400, 401, 403].includes(r.status), 'administrator refresh session was not definitively revoked');
  }
  async clearVerificationSession() {
    if (this.pg) {
      const sessions = Number((await this.query('SELECT count(*) FROM auth.sessions'))[0][0]);
      const refreshTokens = Number((await this.query('SELECT count(*) FROM auth.refresh_tokens'))[0][0]);
      assert.equal(sessions, 0, 'Supabase sessions remain before actor login');
      assert.equal(refreshTokens, 0, 'Supabase refresh tokens remain before actor login');
      return { native_sessions: sessions, refresh_tokens: refreshTokens, admin_session_cleared: true };
    }
    const admin = this.admin;
    this.admin = null;
    if (this.inv?.storage === 'docker-volume') {
      assert.ok(admin, 'verification administrator session required');
      const refresh = admin.tokens()?.refresh_token;
      await admin.logout();
      await this.assertRefreshRevoked(refresh);
      return { native_sessions: null, offline_baseline_sessions: this.offlineSessionCounts?.sessions ?? null, session_count_source: 'stopped-volume archive, not live host SQLite', admin_session_cleared: true, admin_refresh_rejected: true };
    }
    if (admin) await admin.logout();
    const sessions = this.trailSessions();
    assert.equal(sessions, 0, 'TrailBase sessions remain before actor login');
    return { native_sessions: sessions, admin_session_cleared: true };
  }
  async verify(manifest) {
    this.baselineState = await this.state();
    if (manifest) assert.deepEqual(this.baselineState, manifest.state, 'restored application/Auth hash mismatch');
    const sessions = await this.clearVerificationSession();
    writeFileSync(join(this.runDir, 'start-state.json'), JSON.stringify({ application_auth: this.baselineState, sessions }, null, 2), { mode: 0o600 });
  }
  volume() { return new TrailVolume(this); }
  sqlite(path, sql, { readOnly = false } = {}) { return this.command('sqlite3', ['-noinit', '-batch', ...(readOnly ? ['-readonly'] : []), '-noheader', '-list', '-bail', path, sql]); }
  trailSessions() {
    if (this.inv?.storage === 'docker-volume') return null; // No coherent live host view; native Auth endpoints prove sessions.
    const p = join(this.depot, 'data/session.db');
    assert.ok(existsSync(p), 'native session DB absent');
    return Number(this.sqlite(p, 'SELECT count(*) FROM _session;'));
  }
  async snapshot() {
    const files = ['inventory.json', 'credentials.json', 'images.json'];
    const imageFacts = image => { const m = JSON.parse(this.docker(['image', 'inspect', image]))[0]; return { id: m.Id, architecture: m.Architecture, repo_digests: m.RepoDigests }; };
    if (this.pg) {
      this.compose(['stop']); this.compose(['up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'db']);
      this.compose(['exec', '-T', 'db', 'pg_dump', '--create', '-U', 'postgres', '-d', 'postgres', '-Fc', '-f', '/tmp/v6-baseline.dump']);
      this.compose(['cp', 'db:/tmp/v6-baseline.dump', join(this.dir, 'database.dump')]);
      files.push('database.dump', 'compose.json', 'source.json');
      this.save('mounts.json', stableBindMountManifest(JSON.parse(readFileSync(join(this.dir, 'compose.json'), 'utf8')), this.source));
      files.push('mounts.json');
      writeFileSync(join(this.dir, 'environment.snapshot'), readFileSync(join(this.source, '.env')), { mode: 0o600 }); files.push('environment.snapshot');
      this.save('images.json', Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(this.dir, 'compose.json'))).services).map(([n, s]) => [n, imageFacts(s.image)])));
    } else {
      await this.stop();
      this.save('images.json', { trailbase: imageFacts(this.pins.TRAILBASE_IMAGE) });
      this.volume().snapshot(); // Closed native archive, including every DB/WAL, is audited read-only offline.
      files.push('depot.tar', 'admin.json');
    }
    return { files, state: this.baselineState };
  }
  async restore(manifest) {
    assert.ok(manifest?.state, 'restored manifest lacks state');
    assert.ok(this.inv, 'owned inventory required');
    await this.stop();
    if (this.pg) {
      this.loadKeys();
      const images = JSON.parse(readFileSync(join(this.dir, 'images.json')));
      const config = JSON.parse(readFileSync(join(this.dir, 'compose.json')));
      for (const [n, image] of Object.entries(images)) assert.equal(JSON.parse(this.docker(['image', 'inspect', config.services[n].image]))[0].Id, image.id, 'backend image changed');
      assert.equal(readFileSync(join(this.source, '.env'), 'utf8'), readFileSync(join(this.dir, 'environment.snapshot'), 'utf8'), 'deployment keys/config changed');
      this.compose(['up', '-d', '--no-deps', '--pull', 'never', '--wait', '--wait-timeout', '120', 'db']);
      this.compose(['cp', join(this.dir, 'database.dump'), 'db:/tmp/v6-baseline.dump']);
      // --list alone hides DATABASE entries; --create selects them without executing SQL.
      const contents = this.compose(['exec', '-T', 'db', 'pg_restore', '--list', '--create', '/tmp/v6-baseline.dump']);
      assert.match(contents, /^;[ \t]*dbname:[ \t]*postgres[ \t]*$/m, 'archive database must be postgres');
      const databaseEntries = contents.split('\n').filter(line => /^\d+;[ \t]+\d+[ \t]+\d+[ \t]+DATABASE[ \t]+-/.test(line));
      assert.equal(databaseEntries.length, 1, 'archive must contain exactly one database');
      assert.match(databaseEntries[0], /^\d+;[ \t]+\d+[ \t]+\d+[ \t]+DATABASE[ \t]+-[ \t]+postgres[ \t]+\S+[ \t]*$/, 'archive database creation target must be postgres');
      const containers = this.owned();
      assert.equal(containers.filter(c => c.Config.Labels['com.docker.compose.service'] === 'db' && c.State.Running).length, 1, 'owned database required');
      assert.ok(containers.every(c => c.Config.Labels['com.docker.compose.service'] === 'db' || !c.State.Running), 'database recreation requires stopped writers');
      // Native pg_cron/pg_net workers stay connected with all other services stopped.
      // Force terminates only connections to this owned database; blockers still fail closed.
      this.compose(['exec', '-T', 'db', 'dropdb', '--force', '--if-exists', '-U', 'supabase_admin', '--maintenance-db', 'template1', 'postgres']);
      // --create with --clean recreates the archived database from template1,
      // avoiding per-object drops of inherited native partition constraints.
      // Native event-trigger ownership requires the maintenance administrator;
      // client Auth/RLS and native ownership/triggers remain unchanged.
      this.compose(['exec', '-T', 'db', 'pg_restore', '--exit-on-error', '--clean', '--if-exists', '--create', '-U', 'supabase_admin', '-d', 'template1', '/tmp/v6-baseline.dump']);
    } else {
      const image = JSON.parse(readFileSync(join(this.dir, 'images.json'))).trailbase;
      assert.equal(JSON.parse(this.docker(['image', 'inspect', this.pins.TRAILBASE_IMAGE]))[0].Id, image.id, 'backend image changed');
      this.volume().restore();
    }
  }
  async authenticate() {
    const spec = this.fixture.specs[0];
    const email = this.fixture.rows.users.find(r => r[0] === spec.userId)[1];
    const password = JSON.parse(readFileSync(join(this.dir, 'credentials.json'))).password;
    const login = await this.call(this.pg ? '/auth/v1/token?grant_type=password' : '/api/auth/v1/login', { method: 'POST', body: this.pg ? { email, password } : { email_or_username: email, password } });
    const token = this.pg ? login.access_token : login.auth_token;
    assert.equal(typeof token, 'string', 'native authentication failed');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    if (this.pg) await waitForCapacityTokenEligibility(claims);
    assert.ok(claims.exp * 1000 - Date.now() >= 120000, 'token lifetime too short');
    const path = this.pg ? `/rest/v1/users?id=eq.${spec.userId}` : `/api/records/v1/users?filter[external_id]=${spec.userId}&limit=1`;
    const profile = await this.call(path, { token });
    const row = this.pg ? profile[0] : profile.records?.[0];
    assert.equal(row?.email, email, 'native authenticated identity mismatch');
    this.runPrefix = `v6${randomUUID().replaceAll('-', '')}`;
    this.runConfig = { platform: this.platform, base: this.inv.base, token, csrf: login.csrf_token, anon: this.anon, organization: spec.organizationId, project: spec.projectId, user: spec.userId, prefix: this.runPrefix };
    writeFileSync(join(this.runDir, 'config.json'), JSON.stringify(this.runConfig), { mode: 0o600 });
  }
  k6Network() {
    if (this.pg) return {
      base: process.platform === 'darwin' ? `http://host.docker.internal:${this.inv.base.split(':').at(-1)}` : this.inv.base,
      dockerArgs: process.platform === 'linux' ? ['--network', 'host'] : [],
      kind: 'legacy-host-loopback',
    }; // Preserve Supabase's approved multi-service topology and measurement route.
    const containers = this.owned();
    assertOwned(containers, this.inv.owner);
    assert.ok(containers.length === 1 && containers[0].State?.Running === true, 'k6 requires one running owned TrailBase container');
    const c = containers[0];
    assert.match(c.Id, /^[a-f0-9]{64}$/, 'invalid k6 backend container ID');
    assert.equal(c.Config.Image, this.pins.TRAILBASE_IMAGE, 'k6 backend image changed');
    const mounts = c.Mounts?.filter(m => m.Destination === '/app/traildepot');
    assert.ok(this.inv.storage === 'docker-volume' && mounts?.length === 1 && mounts[0].Type === 'volume' && mounts[0].Name === this.inv.volume, 'unexpected k6 depot mount');
    return { base: 'http://127.0.0.1:4000', dockerArgs: ['--network', `container:${c.Id}`], kind: 'direct-linux-network-namespace', backend_container_id: c.Id };
  }
  async k6() {
    const image = readFileSync(join(this.root, 'versions.env'), 'utf8').match(/^K6_IMAGE=(\S+)$/m)?.[1];
    assert.match(image ?? '', /^grafana\/k6:1\.6\.1@sha256:[a-f0-9]{64}$/);
    this.docker(['image', 'inspect', image]);
    const network = this.k6Network();
    const config = { ...this.runConfig, base: network.base };
    writeFileSync(join(this.runDir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
    writeFileSync(join(this.runDir, 'provenance.json'), JSON.stringify({ diagnostic: true, admitted_v5: false, platform: this.platform, k6_image: image, node: process.versions.node, measurement_network: network, baseline_manifest: hash(JSON.parse(readFileSync(join(this.dir, 'manifest.json')))), workload_sha256: createHash('sha256').update(readFileSync(join(this.root, 'baseline/test.js'))).digest('hex') }, null, 2), { mode: 0o600 });
    const args = ['run', '--rm', '--pull', 'never', '--name', `${this.inv.name}-k6`, '--label', `baas-bench.v6-owner=${this.inv.owner}`, '--user', `${process.getuid()}:${process.getgid()}`, ...network.dockerArgs, '--mount', `type=bind,source=${this.runDir},target=/work`, '--mount', `type=bind,source=${join(this.root, 'baseline/test.js')},target=/test.js,readonly`, image, 'run', '--out', 'json=/work/metrics.json', '/test.js'];
    const r = (this.spawnCommand ?? spawnSync)('docker', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(this.runDir, 'k6.log'), `${r.stdout ?? ''}\n${r.stderr ?? ''}`, { mode: 0o600 });
    assert.equal(r.status, 0, 'k6 failed; private logs retained');
    const summary = JSON.parse(readFileSync(join(this.runDir, 'summary.json')));
    assert.ok(summary.metrics?.checks?.values?.fails === 0, 'k6 checks failed');
    assert.ok(summary.metrics?.http_req_failed?.values?.passes === 0, 'k6 HTTP failures');
  }
  async postcheck() {
    const p = this.pg ? 'public.' : '', id = this.pg ? 'id' : 'external_id';
    const tasks = await this.query(`SELECT ${id},organization_id,project_id,creator_id FROM ${p}tasks WHERE ${id} LIKE ${quote(this.runPrefix + '%')} ORDER BY ${id}`);
    assert.ok(tasks.length, 'no k6 tasks created');
    assert.equal((await this.query(`SELECT count(*) FROM ${p}tasks`))[0][0], this.fixture.rows.tasks.length + tasks.length);
    assert.equal((await this.query(`SELECT count(*) FROM ${p}activities`))[0][0], this.fixture.rows.activities.length + tasks.length);
    for (const [task, org, project, actor] of tasks) {
      const activity = await this.query(`SELECT organization_id,project_id,actor_id,action,subject_type FROM ${p}activities WHERE subject_id=${quote(task)}`);
      assert.deepEqual(activity, [[org, project, actor, 'created', 'task']], 'exactly one atomic linked activity required');
    }
    writeFileSync(join(this.runDir, 'postcheck.json'), JSON.stringify({ diagnostic: true, tasks: tasks.length, atomic_activities: tasks.length, passed: true }), { mode: 0o600 });
  }
}
