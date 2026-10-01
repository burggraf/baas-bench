import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const setRoot = new URL('../benchmark-sets/realworld-api-v4/', import.meta.url);
const benchmarkRoot = new URL('benchmarks/project-management-capacity/', setRoot);
const platforms = ['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon'];

function text(relative, root = setRoot) {
  return readFileSync(new URL(relative, root), 'utf8');
}

test('command transport forwards stdin to administrative processes', async () => {
  const { runCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/command.mjs');
  const result = await runCommand(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'migration-payload', timeoutMs: 5_000 });
  assert.equal(result.stdout, 'migration-payload');
});

test('real-world API capacity scaffold declares its lifecycle and metrics', () => {
  assert.match(text('set.conf'), /^id=realworld-api-v4$/m);
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

test('V4 pins current platform and SDK releases without changing V3 pins', () => {
  const versions = text('versions.env');
  for (const pin of ['NODE_VERSION=22.23.1', 'DOCKER_VERSION=29.5.0', 'DOCKER_COMPOSE_VERSION=5.1.2', 'SUPABASE_ENVOY_IMAGE=envoyproxy/envoy@sha256:57e14a549d7bd43c8d3f6d03e8cfa653e037d4b38e133acd9b54f38c524401b4', 'TRAILBASE_VERSION=0.34.1', 'APPWRITE_VERSION=2.3.0', 'DIRECTUS_VERSION=12.4.1', 'POCKETBASE_VERSION=0.40.4', 'POSTGRES_VERSION=16.15-bookworm']) assert.ok(versions.includes(`${pin}\n`), pin);
  const bootstrap = text('../services/linode/bootstrap.sh', new URL('../', setRoot));
  for (const pin of ['NODE_VERSION=22.23.1', 'DOCKER_VERSION=29.5.0', 'COMPOSE_VERSION=5.1.2', 'git iproute2 iptables openssh-client openssl rsync', 'sha256sum -c -', 'systemctl is-active --quiet docker', 'docker info', 'journalctl -u docker', 'docker compose version --short']) assert.ok(bootstrap.includes(pin), pin);
  assert.ok(bootstrap.includes('tar -xJf "$work/node.tar.xz" -C /opt/baas-bench-tools'));
  assert.ok(!bootstrap.includes('/opt/baas-bench/node-v'));
  assert.ok(text('versions.env', new URL('../../', setRoot)).includes('TRAILBASE_VERSION=0.33.10\n'));
  assert.ok(text('cases/trailbase/javascript-sdk/case.conf', benchmarkRoot).includes('client=trailbase@0.14.1\n'));
  assert.ok(text('shared/pocketbase-go/go.mod').includes('github.com/pocketbase/pocketbase v0.40.4'));
  const pkg = JSON.parse(text('shared/package.json'));
  const lock = JSON.parse(text('shared/package-lock.json'));
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
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
  const dispatcher = text('shared/case.sh');
  assert.match(dispatcher, /remote-config\.mjs" prepare/);
  assert.match(dispatcher, /rsync -e.*ssh -F.*-a --delete/);
  assert.match(dispatcher, /remote-execution\.mjs/);
});

test('V4 case run forwards measured hooks to the configured remote runner', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rw-case-remote-')));
  const { createSshConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs');
  const sshState = await createSshConfig();
  const runtime = join(directory, 'benchmarks/realworld-api-v4');
  try {
    await mkdir(join(runtime, 'lib'), { recursive: true });
    await cp(new URL('../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs', import.meta.url), join(runtime, 'lib/ssh-config.mjs'));
    await writeFile(join(runtime, 'lib/remote-execution.mjs'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const result = spawnSync('sh', [new URL('../benchmark-sets/realworld-api-v4/shared/case.sh', import.meta.url).pathname, 'run', 'supabase'], {
      encoding: 'utf8',
      env: { ...process.env, BAAS_BENCH_V4_SSH_CONFIG: sshState.configPath, BAAS_RUNTIME_DIR: directory, BAAS_BENCH_V4_RUNNER_TARGET: 'runner.internal', BAAS_BENCH_V4_RUNNER_ROOT: '/tmp/runner-root', BENCH_PHASE: 'measure', BENCH_TRIAL: '2', BENCH_OUTPUT_DIR: '/tmp/bench output' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ['supabase', 'measure', '2', '/tmp/bench output', 'runner.internal', '/tmp/runner-root']);
  } finally { await sshState.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('V4 setup validates the runner before seeding and syncs after admin setup', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'rw-case-sync-')));
  const { createSshConfig, bindBackend } = await import('../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs');
  const sshState = await createSshConfig();
  await bindBackend(sshState.configPath, { publicIpv4: '172.233.137.153', privateIpv4: '10.0.0.10' });
  await writeFile(sshState.knownHostsPath, '172.233.137.153 ssh-ed25519 AAAATESTHOSTKEY\n');
  const runtime = join(directory, 'benchmarks/realworld-api-v4');
  const fakeBin = join(directory, 'bin');
  const log = join(directory, 'calls.log');
  const runnerKey = join(directory, 'runner-id_ed25519');
  const runnerSsh = join(directory, 'runner-ssh');
  try {
    await mkdir(join(runtime, 'node_modules'), { recursive: true });
    await mkdir(fakeBin);
    await mkdir(runnerSsh, { mode: 0o700 });
    await writeFile(join(runtime, 'package-lock.json'), text('shared/package-lock.json'));
    await writeFile(runnerKey, 'runner-private-key', { mode: 0o600 });
    await writeFile(join(fakeBin, 'node'), `#!/bin/sh
[ "$1" = -p ] && { echo 22; exit 0; }
echo "node: $*" >> "$FAKE_LOG"
case "$1" in
  *ssh-config.mjs) exec "$REAL_NODE" "$@" ;;
  *admin.mjs) if [ "\${FAKE_ADMIN_STATUS:-0}" -ne 0 ]; then echo 'synthetic admin failure' >&2; exit "$FAKE_ADMIN_STATUS"; fi ;;
  *host-telemetry.mjs) exit "\${FAKE_DIAGNOSTICS_STATUS:-0}" ;;
esac
`);
    await writeFile(join(fakeBin, 'ssh'), `#!/bin/sh
echo "ssh: $*" >> "$FAKE_LOG"
case "$*" in
  *'ca.pem'*) printf '%s\\n' private-ca ;;
  *'SUPABASE_PUBLISHABLE_KEY='*) printf '%s\\n' sb_test_public_key ;;
  *"cat > '/srv/runner/.runtime/benchmarks/realworld-api-v4/id_ed25519'"*) cat > "$FAKE_RUNNER_SSH/id_ed25519" ;;
  *"cat > '/srv/runner/.runtime/benchmarks/realworld-api-v4/known_hosts'"*) cat > "$FAKE_RUNNER_SSH/known_hosts" ;;
  *"cat > '/srv/runner/.runtime/benchmarks/realworld-api-v4/ssh_config'"*) cat > "$FAKE_RUNNER_SSH/ssh_config" ;;
esac
`);
    await writeFile(join(fakeBin, 'rsync'), `#!/bin/sh
echo "rsync: $*" >> "$FAKE_LOG"
`);
    for (const name of ['node', 'ssh', 'rsync']) await chmod(join(fakeBin, name), 0o755);
    const result = spawnSync('sh', [new URL('../benchmark-sets/realworld-api-v4/shared/case.sh', import.meta.url).pathname, 'setup', 'supabase'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_LOG: log, FAKE_RUNNER_SSH: runnerSsh, REAL_NODE: process.execPath, BAAS_BENCH_V4_SSH_CONFIG: sshState.configPath, BAAS_RUNTIME_DIR: directory, BAAS_BENCH_V4_RUNNER_TARGET: 'runner.internal', BAAS_BENCH_V4_RUNNER_ROOT: '/srv/runner', BAAS_BENCH_V4_BACKEND_TARGET: 'controller@172.233.137.153', BAAS_BENCH_V4_BACKEND_ROOT: '/srv/backend', BAAS_BENCH_V4_BACKEND_PRIVATE_IP: '10.0.0.10', BAAS_BENCH_V4_BACKEND_DOCKER_SSH_TARGET: 'bench@10.0.0.10', BAAS_BENCH_V4_RUNNER_SSH_KEY_FILE: runnerKey },
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = await readFile(log, 'utf8');
    assert.match(calls, /node: .*admin\.mjs/);
    assert.match(calls, /node: .*remote-config\.mjs/);
    assert.match(calls, /ssh: .*runner\.internal/);
    assert.match(calls, /rsync: -e ssh -F .* -a --delete --exclude node_modules .*runner\.internal:\/srv\/runner\/\.runtime\/benchmarks\/realworld-api-v4\//);
    assert.match(calls, /ssh: .*runner\.internal .*id_ed25519/);
    assert.match(calls, /ssh: .*runner\.internal .*known_hosts/);
    assert.ok(calls.split('\n').filter(line => line.startsWith('ssh:')).every(line => line.startsWith(`ssh: -F ${sshState.configPath} `)));
    assert.equal(calls.includes('~/.ssh/known_hosts'), false);
    assert.match(calls, /ssh_config.*chmod 600/);
    assert.ok(calls.indexOf('rsync:') < calls.indexOf("cat > '/srv/runner/.runtime/benchmarks/realworld-api-v4/known_hosts'"));
    assert.match(await readFile(join(sshState.directory, 'runner_known_hosts'), 'utf8'), /^10\.0\.0\.10 ssh-ed25519 AAAATESTHOSTKEY/);
    assert.equal(await readFile(join(runnerSsh, 'known_hosts'), 'utf8'), await readFile(join(sshState.directory, 'runner_known_hosts'), 'utf8'));
    assert.equal(await readFile(join(runnerSsh, 'ssh_config'), 'utf8'), await readFile(join(sshState.directory, 'runner_ssh_config'), 'utf8'));
    assert.equal(await readFile(join(runnerSsh, 'id_ed25519'), 'utf8'), 'runner-private-key');
    for (const file of ['known_hosts', 'ssh_config', 'id_ed25519']) assert.equal((await stat(join(runnerSsh, file))).mode & 0o777, 0o600);
    assert.match(calls, /ssh: .*runner\.internal .*npm ci --ignore-scripts --prefix/);
    assert.match(calls, /remote-config\.mjs create supabase .* 10\.0\.0\.10 bench@10\.0\.0\.10/);
    assert.ok(calls.indexOf('admin.mjs') < calls.indexOf('remote-config.mjs create'));
    assert.ok(calls.indexOf('remote-config.mjs create') < calls.lastIndexOf('rsync:'));
    await writeFile(log, '');
    const failed = spawnSync('sh', [new URL('../benchmark-sets/realworld-api-v4/shared/case.sh', import.meta.url).pathname, 'setup', 'supabase'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_LOG: log, REAL_NODE: process.execPath, FAKE_ADMIN_STATUS: '7', FAKE_DIAGNOSTICS_STATUS: '9', BAAS_BENCH_V4_SSH_CONFIG: sshState.configPath, BAAS_RUNTIME_DIR: directory, BAAS_BENCH_V4_BACKEND_TARGET: 'controller@172.233.137.153' },
    });
    assert.equal(failed.status, 7, 'failed diagnostics must not replace the administrative failure');
    assert.match(failed.stderr, /synthetic admin failure/);
    assert.match(failed.stderr, /V4 backend failure diagnostics failed/);
    const failedCalls = await readFile(log, 'utf8');
    assert.match(failedCalls, /host-telemetry\.mjs diagnose controller@172\.233\.137\.153/);
    assert.ok(failedCalls.indexOf('admin.mjs') < failedCalls.indexOf('host-telemetry.mjs diagnose'));
    assert.doesNotMatch(failedCalls, /remote-config\.mjs|rsync:/);
  } finally { await sshState.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('dataset streams exactly one million deterministic valid records', async () => {
  const { DATASET_COUNTS, TOTAL_APPLICATION_RECORDS, seedDataset } = await import(
    '../benchmark-sets/realworld-api-v4/shared/lib/dataset.mjs'
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
    '../benchmark-sets/realworld-api-v4/shared/lib/dataset.mjs'
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
  const { createBackend } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
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
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
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
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
  const pending = { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return this; }, then() { return new Promise(() => {}); } };
  const adapter = createSupabaseAdapter({ client: { from() { return pending; } }, timeoutMs: 5 });
  await assert.rejects(adapter.listTasks({ organizationId: 'org', projectId: 'prj' }), /timed out/);
});

test('Supabase adapter maps PostgREST rows and enforces tenant-bound pagination', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
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
  const { readKey } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'supabase-env-'));
  try {
    for (const newline of ['\n', '\r\n']) {
      const path = join(dir, `env-${newline === '\n' ? 'lf' : 'crlf'}`);
      await writeFile(path, `OTHER=no${newline}SUPABASE_PUBLISHABLE_KEY=test-key${newline}`);
      assert.equal(await readKey(path, 'SUPABASE_PUBLISHABLE_KEY'), 'test-key');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Supabase correctness fixture supplies every authenticated role and membership identity', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
  const fixture = createSupabaseAdapter({ client: {} }).correctnessFixture();
  for (const role of ['owner', 'member', 'admin', 'outsider']) {
    assert.equal(typeof fixture[role]?.email, 'string', `${role} credentials`);
    assert.equal(typeof fixture[role]?.password, 'string', `${role} password`);
  }
  for (const key of ['memberMembershipId', 'adminMembershipId', 'ownerMembershipId', 'memberUserId']) assert.match(fixture[key], /^memv3|^usrv3/);
  assert.notEqual(fixture.memberMembershipId, fixture.ownerMembershipId);
  assert.notEqual(fixture.adminMembershipId, fixture.ownerMembershipId);
  assert.notEqual(fixture.memberMembershipId, fixture.adminMembershipId);
});

test('Supabase adapter preserves authentication failures for classification', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
  const sdk = { auth: { async signInWithPassword() { return { data: {}, error: { status: 400, message: 'invalid credentials' } }; } } };
  const adapter = createSupabaseAdapter({ sdkCreateClient: () => sdk, url: 'http://supabase.test', key: 'key' });
  await assert.rejects(adapter.createSession({ email: 'u@example.test', password: 'invalid' }), error => error.status === 401);
});

test('Supabase reset preserves native auth metadata and clears sessions', async () => {
  const { RESET_FIXTURE_STATE_SQL } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/postgres.mjs');
  assert.match(RESET_FIXTURE_STATE_SQL, /auth\.users/i);
  assert.match(RESET_FIXTURE_STATE_SQL, /raw_user_meta_data/i);
  assert.match(RESET_FIXTURE_STATE_SQL, /auth\.sessions/i);
});

test('Supabase adapter maps auth sessions and profile rows without admin APIs', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
  let authArgCount;
  const auth = { signInWithPassword: async function (_credentials) { authArgCount = arguments.length; return { data: { session: { access_token: 'token' } }, error: null }; }, getUser: async () => ({ data: { user: { id: 'usr', email: 'u@example.test', user_metadata: { display_name: 'User' }, created_at: '2025-01-01', updated_at: '2025-01-01' } }, error: null }), signOut: async () => ({ error: null }) };
  const queryBuilder = { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return Promise.resolve({ data: [], count: 0, error: null }); }, insert() { return this; }, update() { return this; }, single() { return Promise.resolve({ data: null, error: null }); } };
  const client = { auth, from(table) { return table === 'users' ? { ...queryBuilder, single: async () => ({ data: { id: 'app-user', auth_subject: 'usr', email: 'u@example.test', display_name: 'User', created_at: '2025-01-01', updated_at: '2025-01-01' }, error: null }) } : queryBuilder; } };
  const adapter = createSupabaseAdapter({ client, sdkCreateClient: () => client });
  const signal = new AbortController().signal;
  const session = await adapter.createSession({ email: 'u@example.test', password: 'secret' }, { signal, timeoutMs: 1000 });
  assert.equal(authArgCount, 1);
  for (const method of ['dashboard', 'listTasks', 'getTask', 'createTask', 'updateTask', 'addComment', 'updateComment', 'searchTasks', 'updateMembershipRole', 'getProfile', 'updateProfile', 'signOut', 'cancelPending', 'close']) assert.equal(typeof session[method], 'function', method);
  assert.equal((await session.getProfile()).id, 'app-user');
  assert.deepEqual(await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 }), { items: [], page: 0, pageSize: 10, total: 0, hasNext: false });
  await session.signOut();
});

test('Supabase session timeout is per request, not session-wide', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
  const user = { id: 'usr', email: 'u@example.test', user_metadata: { display_name: 'User' }, created_at: '2025-01-01', updated_at: '2025-01-01' };
  const auth = { signInWithPassword: async () => ({ data: { session: { access_token: 'token' } }, error: null }), getUser: async () => ({ data: { user }, error: null }) };
  const userQuery = { select() { return this; }, eq() { return this; }, single: async () => ({ data: { id: 'usr', auth_subject: 'usr', email: user.email, display_name: 'User', created_at: user.created_at, updated_at: user.updated_at }, error: null }) };
  const client = { auth, from() { return userQuery; } };
  const adapter = createSupabaseAdapter({ client, sdkCreateClient: () => client, timeoutMs: 30 });
  const session = await adapter.createSession({ email: user.email, password: 'secret' }, { timeoutMs: 5 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await session.getProfile()).id, 'usr');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await session.getProfile()).id, 'usr');
  const slow = { then() { return new Promise(() => {}); } };
  const timeoutAdapter = createSupabaseAdapter({ client: { from() { return { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return slow; } }; } }, timeoutMs: 5 });
  await assert.rejects(timeoutAdapter.listTasks({ organizationId: 'org', projectId: 'prj' }), /timed out/);
});

test('Supabase timeouts are scored errors, not integrity failures that abort the whole stage', async () => {
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
  const { isIntegrityError } = await import('../benchmark-sets/realworld-api-v4/shared/lib/errors.mjs');
  const { runWorkload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/workload.mjs');
  const builder = { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return new Promise(() => {}); } };
  const adapter = createSupabaseAdapter({ client: { from: () => builder }, timeoutMs: 2 });
  await assert.rejects(adapter.listTasks({ organizationId: 'org', projectId: 'prj' }), error => error.classification === 'timeout' && !isIntegrityError(error));
  const sdkTimeout = createSupabaseAdapter({ sdkCreateClient: () => ({ auth: { signInWithPassword: async () => ({ error: { status: 0, message: 'Supabase request timed out' } }) } }) });
  await assert.rejects(sdkTimeout.createSession({ email: 'u@example.test', password: 'secret' }), error => error.classification === 'timeout' && !isIntegrityError(error));
  const session = { listTasks: args => adapter.listTasks(args), cancelPending() {}, async close() {} };
  const result = await runWorkload({ createSession: async () => session }, {
    seed: 42, timeoutMs: 10, thinkTimeMs: { min: 0, max: 0 },
    weights: { dashboard: 0, taskList: 100, taskDetail: 0, createTask: 0, updateTask: 0, addComment: 0, search: 0, profileUpdate: 0, signIn: 0 },
  }, { users: [{ credentials: { email: 'u@example.test', password: 'secret' }, organizationId: 'org', projectId: 'prj', taskId: 'tsk' }], durationMs: 30 });
  assert.equal(result.stageFailed, false);
  assert.ok(result.failedWorkflowCount > 1);
  assert.equal(isIntegrityError(new Error('Task crossed project boundary')), true);
  const invalid = await runWorkload({ createSession: async () => ({ ...session, listTasks: async () => { throw new Error('Task crossed project boundary'); } }) }, {
    seed: 42, timeoutMs: 10, thinkTimeMs: { min: 0, max: 0 },
    weights: { dashboard: 0, taskList: 100, taskDetail: 0, createTask: 0, updateTask: 0, addComment: 0, search: 0, profileUpdate: 0, signIn: 0 },
  }, { users: [{ credentials: { email: 'u@example.test', password: 'secret' }, organizationId: 'org', projectId: 'prj', taskId: 'tsk' }], durationMs: 30 });
  assert.equal(invalid.stageFailed, true);
  assert.deepEqual(invalid.failureReasons, ['integrity_error']);
});

test('workflow selection follows the approved application mix', async () => {
  const { selectWorkflow } = await import('../benchmark-sets/realworld-api-v4/shared/lib/workflows.mjs');
  const weights = { dashboard: 20, taskList: 25, taskDetail: 15, createTask: 10, updateTask: 12, addComment: 10, search: 5, profileUpdate: 1, signIn: 2 };
  const cases = [[0, 'dashboard'], [.2, 'taskList'], [.45, 'taskDetail'], [.6, 'createTask'], [.7, 'updateTask'], [.82, 'addComment'], [.92, 'search'], [.97, 'profileUpdate'], [.98, 'signIn'], [1, 'signIn']];
  for (const [value, expected] of cases) assert.equal(selectWorkflow(weights, () => value), expected);
  assert.throws(() => selectWorkflow({ ...weights, signIn: 1 }, () => 0), /total 100/);
});

test('workflow and remote measurements are separate and reject boundary leakage', async () => {
  const { measureRemoteCall, withRemoteMeasurement } = await import('../benchmark-sets/realworld-api-v4/shared/lib/measurement.mjs');
  const { runWorkflow } = await import('../benchmark-sets/realworld-api-v4/shared/lib/workflows.mjs');
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
  const { StageMetricsAccumulator } = await import('../benchmark-sets/realworld-api-v4/shared/lib/metrics.mjs');
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

test('capacity-only search starts at 100, doubles on pass, backs off on failure, and bisects the bracket', async () => {
  const { nextCapacityStage } = await import('../benchmark-sets/realworld-api-v4/shared/lib/capacity.mjs');
  assert.equal(nextCapacityStage({ measuredUsers: [] }), 100);
  assert.equal(nextCapacityStage({ measuredUsers: [100] }), 200);
  assert.equal(nextCapacityStage({ measuredUsers: [100, 200] }), 400);
  assert.equal(nextCapacityStage({ measuredUsers: [100], upperFailure: 100 }), 50);
  assert.equal(nextCapacityStage({ measuredUsers: [100, 50], upperFailure: 50 }), 25);
  assert.equal(nextCapacityStage({ measuredUsers: [100, 50, 25], lowerPass: 50, upperFailure: 100, refinements: 0 }), 75);
  assert.equal(nextCapacityStage({ measuredUsers: [100, 50, 75], lowerPass: 75, upperFailure: 100, refinements: 1 }), 87);
  assert.equal(nextCapacityStage({ measuredUsers: [100], upperFailure: 1 }), null);
  assert.equal(nextCapacityStage({ measuredUsers: [100, 50, 75, 87], lowerPass: 75, upperFailure: 100, refinements: 4 }), null);
  assert.equal(nextCapacityStage({ measuredUsers: [100, 200, 400, 800, 1_600, 3_200, 6_400] }), 10_000);
});

test('workload prepares outside measurement and closes each session once', async () => {
  const { runWorkload, SESSION_PREPARATION_CONCURRENCY } = await import('../benchmark-sets/realworld-api-v4/shared/lib/workload.mjs');
  assert.equal(SESSION_PREPARATION_CONCURRENCY, 500);
  const events = [];
  let closes = 0;
  const session = { cancelPending() {}, async close() { closes += 1; } };
  const backend = { async prepareWorkload() { events.push('maintain'); }, async createSession() { events.push('prepare'); return session; } };
  const config = {
    seed: 42, stageSeconds: 1, timeoutMs: 5_000, thinkTimeMs: { min: 1_000, max: 5_000 },
    weights: { dashboard: 20, taskList: 25, taskDetail: 15, createTask: 10, updateTask: 12, addComment: 10, search: 5, profileUpdate: 1, signIn: 2 },
  };
  const result = await runWorkload(backend, config, {
    users: [{ credentials: { email: 'user@example.test', password: 'secret' }, organizationId: 'org', projectId: 'project', taskId: 'task' }],
    durationMs: 0, graceMs: 0, now: () => 0, sleep: async () => {},
    onMeasuredStart: () => events.push('start'), onMeasuredEnd: () => events.push('end'),
  });
  assert.deepEqual(events, ['maintain', 'prepare', 'start', 'end']);
  assert.equal(result.startedUsers, 1);
  assert.equal(closes, 1);
});

test('workload honors a platform-safe session preparation concurrency', async () => {
  const { runWorkload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/workload.mjs');
  const { createSupabaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/supabase.mjs');
  assert.equal(createSupabaseAdapter({}).sessionPreparationConcurrency, 10);
  assert.equal(createSupabaseAdapter({}).sessionPreparationBatchDelayMs, 100);
  let active = 0;
  let maximum = 0;
  const sleeps = [];
  const backend = {
    sessionPreparationConcurrency: 2,
    sessionPreparationBatchDelayMs: 7,
    async createSession() {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
      return { cancelPending() {}, async close() {} };
    },
  };
  const users = Array.from({ length: 5 }, (_, index) => ({ credentials: { email: `user${index}@example.test`, password: 'secret' }, organizationId: 'org', projectId: 'project', taskId: 'task' }));
  const config = { seed: 42, stageSeconds: 0, timeoutMs: 5_000, thinkTimeMs: { min: 0, max: 0 }, weights: { dashboard: 100 } };
  const result = await runWorkload(backend, config, { users, durationMs: 0, graceMs: 0, sleep: async milliseconds => { sleeps.push(milliseconds); } });
  assert.equal(result.startedUsers, 5);
  assert.equal(maximum, 2);
  assert.equal(sleeps.filter(milliseconds => milliseconds === 7).length, 6);
});

test('operation errors are classified and credentials are redacted and bounded', async () => {
  const { BenchmarkOperationError, classifyOperationError } = await import('../benchmark-sets/realworld-api-v4/shared/lib/correctness.mjs');
  const { safeErrorDetails } = await import('../benchmark-sets/realworld-api-v4/shared/lib/errors.mjs');
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
  const { discoverPlatformContainers, parseDockerStats } = await import('../benchmark-sets/realworld-api-v4/shared/lib/resources.mjs');
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

test('pilot evidence verifier requires a complete V4 Supabase lifecycle bundle', async () => {
  const { verifyPilotBundle } = await import('../benchmark-sets/realworld-api-v4/shared/lib/bench-execution.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'rw-pilot-bundle-'));
  try {
    await writeFile(join(directory, 'run.json'), JSON.stringify({ status: 'complete', set: 'realworld-api-v4', platform: 'supabase', variant: 'javascript-sdk', lifecycle: { start: 'complete', setup: 'complete', teardown: 'complete', stop: 'complete' } }));
    const { createTransferManifest } = await import('../benchmark-sets/realworld-api-v4/shared/lib/transfer.mjs');
    const trial = join(directory, 'trials/001');
    await mkdir(trial, { recursive: true });
    const raw = { schemaVersion: 1, platform: 'supabase', trial: 1, correctness: { aborted: false, findings: [{ passed: true }] }, stages: [{ valid: true }], capacity: { stages: [{ invalid: false }] } };
    await writeFile(join(trial, 'raw.json'), JSON.stringify(raw));
    await writeFile(join(trial, 'summary.json'), '{}');
    await createTransferManifest(trial);
    assert.equal(await verifyPilotBundle(directory), directory);
    raw.stages[0].valid = false;
    raw.capacity.stages[0].invalid = true;
    await writeFile(join(trial, 'raw.json'), JSON.stringify(raw));
    await rm(join(trial, '.transfer-manifest.json'));
    await createTransferManifest(trial);
    await assert.rejects(verifyPilotBundle(directory), /invalid measured stages/);
    await writeFile(join(directory, 'run.json'), JSON.stringify({ status: 'failed' }));
    await assert.rejects(verifyPilotBundle(directory), /lifecycle is incomplete/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ephemeral SSH agent state is parsed, scoped, and cleaned up', async () => {
  const { startSshAgent } = await import('../benchmark-sets/realworld-api-v4/shared/lib/ephemeral-ssh.mjs');
  const calls = [];
  const agent = await startSshAgent({ privateKey: '/tmp/ephemeral-key', command: async (name, args, options = {}) => {
    calls.push({ name, args, options });
    if (name === 'ssh-agent' && args[0] === '-s') return { stdout: 'SSH_AUTH_SOCK=/tmp/agent.sock; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=123; export SSH_AGENT_PID;\n' };
    return { stdout: '' };
  } });
  assert.equal(agent.env.SSH_AUTH_SOCK, '/tmp/agent.sock');
  assert.equal(calls[1].name, 'ssh-add');
  await agent.stop();
  assert.deepEqual(calls.at(-1).args, ['-k']);
  await assert.rejects(startSshAgent({ privateKey: 'relative' }), /invalid SSH private key path/);
});

test('host bootstrap sends only the pinned script to validated fresh hosts', async () => {
  const { bootstrapHosts, readBootstrapScript } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-bootstrap.mjs');
  const script = await readBootstrapScript(fileURLToPath(new URL('../services/linode/bootstrap.sh', import.meta.url)));
  const calls = [];
  await bootstrapHosts({ backendTarget: 'root@198.51.100.10', runnerTarget: 'root@198.51.100.11', script, command: async (name, args, options) => { calls.push({ name, args, options }); return { stdout: '' }; } });
  assert.deepEqual(calls.map(call => call.name), ['ssh', 'ssh', 'ssh', 'ssh']);
  assert.deepEqual(calls.map(call => call.args.at(-1)), ['true', 'true', 'sh -s', 'sh -s']);
  assert.ok(calls.slice(2).every(call => call.options.input === script && call.options.timeoutMs === 600_000));
  await assert.rejects(bootstrapHosts({ backendTarget: 'root@host;id', runnerTarget: 'root@198.51.100.11', script, command: async () => {} }), /invalid host bootstrap/);
});

test('observation deployment bootstraps both hosts and transfers no local runtime or results', async () => {
  const { bootstrapAndDeploy } = await import('../benchmark-sets/realworld-api-v4/shared/lib/observation-workflow.mjs');
  const calls = [];
  const env = await bootstrapAndDeploy({
    inventory: { resources: { backend: { publicIpv4: '198.51.100.10', privateIpv4: '10.203.0.10' }, runner: { publicIpv4: '198.51.100.11', privateIpv4: '10.203.0.11' } } },
    repositoryRoot: '/opt/controller/baas-bench', backendRoot: '/opt/baas-bench', runnerRoot: '/opt/baas-bench', runnerKeyFile: '/opt/controller/key', script: '#!/bin/sh\nexit 0\n',
    bootstrap: async value => { calls.push(['bootstrap', value]); },
    healthProbe: async target => ({ target, dockerService: 'active' }),
    command: async (name, args) => { calls.push([name, args]); return { stdout: '' }; },
  });
  assert.equal(calls[0][0], 'bootstrap');
  const rsync = calls.filter(([name]) => name === 'rsync');
  assert.equal(rsync.length, 2);
  assert.ok(rsync.every(([, args]) => ['.git', '.runtime', '.results', 'results', 'node_modules', '.linode.env'].every(exclusion => args.includes(exclusion))));
  assert.equal(env.environment.BAAS_BENCH_V4_BACKEND_DOCKER_SSH_TARGET, 'root@10.203.0.10');
  assert.equal(env.environment.BAAS_BENCH_V4_RUNNER_SSH_KEY_FILE, '/opt/controller/key');
  assert.deepEqual(env.hostProvenance, { backend: { target: 'root@198.51.100.10', dockerService: 'active' }, runner: { target: 'root@198.51.100.11', dockerService: 'active' } });
  await assert.rejects(bootstrapAndDeploy({ inventory: { resources: { backend: {}, runner: {} } }, repositoryRoot: '/repo', backendRoot: '/backend', runnerRoot: '/runner', runnerKeyFile: '/key', script: '#!/bin/sh\n', command: async () => {} }), /missing host IP/);
});

test('host provenance requires active Docker and records fixed host facts', async () => {
  const { inspectHost } = await import('../benchmark-sets/realworld-api-v4/shared/lib/observation-workflow.mjs');
  const health = await inspectHost('root@198.51.100.10', async () => ({ stdout: 'architecture\tx86_64\nkernel\t6.8.0-1\nnode\t22.23.1\ndocker\t29.5.0\ncompose\t5.1.2\ndisk_kib\t1048576\nfree_kib\t524288\n' }));
  assert.deepEqual(health, { architecture: 'x86_64', kernel: '6.8.0-1', node: '22.23.1', docker: '29.5.0', compose: '5.1.2', diskKiB: 1048576, freeKiB: 524288, dockerService: 'active' });
  await assert.rejects(inspectHost('root@198.51.100.10', async () => ({ stdout: 'architecture\tx86_64\n' })), /invalid host provenance output/);
});

test('host telemetry records CPU steal, memory/swap, and non-loopback network counters', async () => {
  const { parseHostTelemetry, sampleRemoteHost } = await import('../benchmark-sets/realworld-api-v4/shared/lib/host-telemetry.mjs');
  const fixture = { stat: 'cpu  1 2 3 4 5 6 7 8 0 0\n', meminfo: 'MemTotal:       100 kB\nMemAvailable:   40 kB\nSwapTotal:      20 kB\nSwapFree:       10 kB\n', netdev: 'Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n lo: 10 0 0 9 0 0 0 0 10 0 0 9 0 0 0 0\n eth0: 100 0 0 2 0 0 0 0 200 0 0 3 0 0 0 0\n' };
  const local = parseHostTelemetry(fixture);
  assert.equal(local.cpu.steal, 8);
  assert.equal(local.memory.availableBytes, 40 * 1024);
  assert.deepEqual(local.network, { rxBytes: 100, txBytes: 200, rxDrops: 2, txDrops: 3, interfaces: 1 });
  const calls = [];
  const remote = await sampleRemoteHost('bench@10.0.0.10', async (name, args) => { calls.push([name, args]); return { stdout: `${fixture.stat}\x1e${fixture.meminfo}\x1e${fixture.netdev}` }; });
  assert.deepEqual(remote, local);
  assert.equal(calls[0][0], 'ssh');
  await assert.rejects(sampleRemoteHost('bad;host'), /invalid host telemetry SSH target/);
});

test('resource collection invalidates missing runner or backend host telemetry', async () => {
  const { collectResources } = await import('../benchmark-sets/realworld-api-v4/shared/lib/resources.mjs');
  let now = 0;
  const result = await collectResources({
    samples: 1, intervalMs: 1_000, sleep: async () => {}, now: () => (now += 1_000),
    cpuUsage: () => ({ user: 0, system: 0 }), memoryUsage: () => ({ rss: 1 }),
    monitorFactory: () => ({ enable() {}, disable() {}, reset() {}, percentile: () => 0, max: 0 }),
    runnerHostProbe: async () => ({ cpu: {}, memory: {}, network: {} }), backendHostProbe: async () => { throw new Error('unreachable'); },
  });
  assert.deepEqual(result.samples[0].hosts.runner, { cpu: {}, memory: {}, network: {} });
  assert.equal(result.valid, false);
  assert.match(result.validityReasons[0], /backend host telemetry failed: unreachable/);
});

test('remote container probes use a validated SSH target for backend telemetry', async () => {
  const { discoverPlatformContainers, collectResources } = await import('../benchmark-sets/realworld-api-v4/shared/lib/resources.mjs');
  const calls = [];
  const command = async (name, args) => { calls.push([name, args]); return { stdout: name === 'ssh' && args.at(-1)?.includes("'ps'") ? 'aaaaaaaaaaaa\n' : '{"ID":"aaaaaaaaaaaa","CPUPerc":"1%","MemUsage":"1MiB / 2GiB"}\n' }; };
  const ids = await discoverPlatformContainers('directus', command, { sshTarget: 'backend-telemetry' });
  assert.deepEqual(ids, ['aaaaaaaaaaaa']);
  assert.deepEqual(calls[0], ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'backend-telemetry', "docker 'compose' '-p' 'baas-directus' 'ps' '-q'"]]);
  await assert.rejects(discoverPlatformContainers('directus', command, { sshTarget: 'backend;touch /tmp/pwned' }), /invalid SSH target/);
  let now = 0;
  const result = await collectResources({
    platform: 'directus', containerIds: ids, dockerSshTarget: 'backend-telemetry', samples: 1,
    intervalMs: 1_000, sleep: async () => {}, now: () => (now += 1_000),
    cpuUsage: () => ({ user: 0, system: 0 }), memoryUsage: () => ({ rss: 1 }),
    monitorFactory: () => ({ enable() {}, disable() {}, reset() {}, percentile: () => 0, max: 0 }),
    command,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(calls[1], ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'backend-telemetry', "docker 'stats' '--no-stream' '--format' '{{json .}}' 'aaaaaaaaaaaa'"]]);
});

test('remote runner config is platform-scoped and requires HTTPS endpoints', async () => {
  const { applyRemoteConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-config.mjs');
  const env = {};
  applyRemoteConfig({
    schema_version: 1, platform: 'supabase', docker_ssh_target: 'backend-telemetry', ca_file: '/tmp/private-ca.crt', ssh_config_file: '/tmp/ssh_config',
    env: { SUPABASE_URL: 'https://supabase.baas.internal:8443', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  }, 'supabase', env);
  assert.equal(env.SUPABASE_URL, 'https://supabase.baas.internal:8443');
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/tmp/private-ca.crt');
  assert.equal(env.BAAS_BENCH_DOCKER_SSH_TARGET, 'backend-telemetry');
  assert.equal(env.BAAS_BENCH_V4_SSH_CONFIG, '/tmp/ssh_config');
  assert.throws(() => applyRemoteConfig({ schema_version: 1, platform: 'supabase', docker_ssh_target: 'backend-telemetry', ca_file: '/tmp/private-ca.crt', ssh_config_file: '/tmp/ssh_config', env: { SUPABASE_URL: 'http://backend:8000' } }, 'supabase', {}), /HTTPS/);
  assert.throws(() => applyRemoteConfig({ schema_version: 1, platform: 'directus', docker_ssh_target: 'backend-telemetry', ca_file: '/tmp/private-ca.crt', ssh_config_file: '/tmp/ssh_config', env: { SUPABASE_URL: 'https://backend' } }, 'directus', {}), /not allowed/);
  assert.throws(() => applyRemoteConfig({ schema_version: 1, platform: 'supabase', docker_ssh_target: 'backend;id', env: {} }, 'supabase', {}), /invalid SSH target/);
});

test('remote runner loads only restrictive config and confirms its CA exists', async () => {
  const { loadRemoteConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-run.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'rw-remote-run-'));
  const { createSshConfig, bindBackend, prepareRunnerSsh } = await import('../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs');
  const sshState = await createSshConfig();
  await writeFile(sshState.knownHostsPath, '172.233.137.153 ssh-ed25519 AAAATESTHOSTKEY\n');
  await bindBackend(sshState.configPath, { publicIpv4: '172.233.137.153', privateIpv4: '10.0.0.10' });
  const pin = await prepareRunnerSsh({ configPath: sshState.configPath, backendTarget: 'root@172.233.137.153', backendPrivateIp: '10.0.0.10', runnerRoot: directory });
  const runnerSshDir = join(directory, '.runtime/benchmarks/realworld-api-v4');
  await mkdir(runnerSshDir, { recursive: true, mode: 0o700 });
  await cp(pin.configPath, join(runnerSshDir, 'ssh_config'));
  await cp(pin.knownHostsPath, join(runnerSshDir, 'known_hosts'));
  await writeFile(join(runnerSshDir, 'id_ed25519'), 'synthetic-only', { mode: 0o600 });
  const configPath = join(directory, 'remote-config.json');
  const caPath = join(directory, 'ca.pem');
  try {
    await writeFile(caPath, 'private-ca');
    const config = { schema_version: 1, platform: 'directus', docker_ssh_target: 'backend-telemetry', ca_file: caPath, ssh_config_file: join(runnerSshDir, 'ssh_config'), env: { DIRECTUS_URL: 'https://directus.baas.internal:8443' } };
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const env = {};
    await loadRemoteConfig(configPath, 'directus', env);
    assert.equal(env.DIRECTUS_URL, 'https://directus.baas.internal:8443');
    assert.equal(env.NODE_EXTRA_CA_CERTS, caPath);
    assert.equal(env.BAAS_BENCH_V4_SSH_CONFIG, join(runnerSshDir, 'ssh_config'));
    await chmod(join(runnerSshDir, 'ssh_config'), 0o644);
    await assert.rejects(loadRemoteConfig(configPath, 'directus', {}), /0600/);
    await chmod(configPath, 0o644);
    await assert.rejects(loadRemoteConfig(configPath, 'directus', {}), /permissions must be 0600/);
  } finally { await sshState.cleanup(); await rm(directory, { recursive: true, force: true }); }
});

test('remote setup creates a private Supabase runner config from backend-only inputs', async () => {
  const { createRemoteConfig, prepareRemoteConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-config.mjs');
  const createdDirectory = await mkdtemp(join(tmpdir(), 'rw-created-remote-config-'));
  try {
    await mkdir(createdDirectory, { recursive: true });
    await writeFile(join(createdDirectory, 'ca.pem'), 'private-ca');
    const created = await createRemoteConfig({ platform: 'supabase', runtime: createdDirectory, runnerRoot: '/opt/runner', backendAddress: '10.0.0.10', dockerSshTarget: 'bench@10.0.0.10', publishableKey: 'sb_test_public_key' });
    assert.deepEqual(created.env, { SUPABASE_URL: 'https://10.0.0.10:8443', SUPABASE_PUBLISHABLE_KEY: 'sb_test_public_key' });
    assert.equal(created.ca_file, '/opt/runner/.runtime/benchmarks/realworld-api-v4/ca.pem');
    assert.equal(created.ssh_config_file, '/opt/runner/.runtime/benchmarks/realworld-api-v4/ssh_config');
    assert.equal((await stat(join(createdDirectory, 'remote-config.json'))).mode & 0o077, 0);
    await assert.rejects(createRemoteConfig({ platform: 'supabase', runtime: createdDirectory, runnerRoot: '/opt/runner', backendAddress: 'backend.example.test', dockerSshTarget: 'bench@10.0.0.10', publishableKey: 'key' }), /private IPv4/);
    await assert.rejects(createRemoteConfig({ platform: 'supabase', runtime: createdDirectory, runnerRoot: '/opt/runner', backendAddress: '203.0.113.10', dockerSshTarget: 'bench@10.0.0.10', publishableKey: 'key' }), /private IPv4/);
  } finally { await rm(createdDirectory, { recursive: true, force: true }); }
});

test('remote-config CLI reads the Supabase publishable key from stdin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rw-config-stdin-'));
  const cli = fileURLToPath(new URL('../benchmark-sets/realworld-api-v4/shared/lib/remote-config.mjs', import.meta.url));
  try {
    const { runCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/command.mjs');
    await runCommand(process.execPath, [cli, 'create', 'supabase', root, '/opt/runner', '10.0.0.10', 'bench@10.0.0.10'], { input: 'sb_test_public_key\n', timeoutMs: 5_000 });
    const config = JSON.parse(await readFile(join(root, 'remote-config.json'), 'utf8'));
    assert.equal(config.env.SUPABASE_PUBLISHABLE_KEY, 'sb_test_public_key');
    assert.equal((await stat(join(root, 'remote-config.json'))).mode & 0o077, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('remote setup prepares a private runner config with only the Supabase public key', async () => {
  const { prepareRemoteConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-config.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'rw-remote-config-'));
  const runtime = join(directory, 'runtime');
  const repo = join(directory, 'repo');
  try {
    await mkdir(runtime, { recursive: true });
    await mkdir(join(repo, '.runtime/supabase/docker'), { recursive: true });
    await writeFile(join(runtime, 'ca.pem'), 'private-ca');
    await writeFile(join(repo, '.runtime/supabase/docker/.env'), 'SUPABASE_PUBLISHABLE_KEY=sb_test_public_key\nJWT_SECRET=not-forwarded\n');
    await writeFile(join(runtime, 'remote-config.json'), `${JSON.stringify({ schema_version: 1, platform: 'supabase', docker_ssh_target: 'backend-telemetry', ca_file: '/opt/bench/.runtime/benchmarks/realworld-api-v4/ca.pem', ssh_config_file: '/opt/bench/.runtime/benchmarks/realworld-api-v4/ssh_config', env: { SUPABASE_URL: 'https://supabase.baas.internal:8443' } })}\n`, { mode: 0o600 });
    const config = await prepareRemoteConfig({ platform: 'supabase', runtime, repoRoot: repo, runnerRoot: '/opt/bench' });
    assert.equal(config.env.SUPABASE_PUBLISHABLE_KEY, 'sb_test_public_key');
    assert.equal('JWT_SECRET' in config.env, false);
    assert.equal((await stat(join(runtime, 'remote-config.json'))).mode & 0o077, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Neon runner trusts the per-observation CA for its native proxy', async () => {
  const { prepareRemoteConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-config.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'rw-neon-remote-config-'));
  const runtime = join(directory, 'runtime');
  try {
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, 'ca.pem'), 'campaign-root-ca');
    const config = { schema_version: 1, platform: 'neon', docker_ssh_target: 'backend-telemetry', ca_file: '/srv/runner/.runtime/benchmarks/realworld-api-v4/ca.pem', ssh_config_file: '/srv/runner/.runtime/benchmarks/realworld-api-v4/ssh_config', env: { NEON_PROXY_URL: 'https://neon.baas.internal:4444/sql', NEON_DATABASE_URL: 'postgresql://cloud_admin:secret@localhost:5432/postgres' } };
    await writeFile(join(runtime, 'remote-config.json'), JSON.stringify(config), { mode: 0o600 });
    const prepared = await prepareRemoteConfig({ platform: 'neon', runtime, repoRoot: directory, runnerRoot: '/srv/runner' });
    assert.equal(prepared.env.NEON_PROXY_CA, config.ca_file);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('remote evidence transfer manifest verifies exact files and checksums', async () => {
  const { createTransferManifest, verifyTransferManifest } = await import('../benchmark-sets/realworld-api-v4/shared/lib/transfer.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'rw-transfer-'));
  try {
    await mkdir(join(directory, 'raw'));
    await writeFile(join(directory, 'summary.json'), '{"ok":true}');
    await writeFile(join(directory, 'raw', 'response.json'), '{"count":1}');
    await createTransferManifest(directory);
    assert.equal(await verifyTransferManifest(directory), true);
    await writeFile(join(directory, 'raw', 'response.json'), '{"count":2}');
    await assert.rejects(verifyTransferManifest(directory), /checksum mismatch/);
    await writeFile(join(directory, 'raw', 'extra.log'), 'unexpected');
    await assert.rejects(verifyTransferManifest(directory), /file set mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('remote trial checksums transferred artifacts and preserves run failure over cleanup failure', async () => {
  const { runRemoteTrial } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-execution.mjs');
  const { createTransferManifest } = await import('../benchmark-sets/realworld-api-v4/shared/lib/transfer.mjs');
  const local = await mkdtemp(join(tmpdir(), 'rw-remote-local-'));
  const failedLocal = await mkdtemp(join(tmpdir(), 'rw-remote-failed-'));
  const remote = await mkdtemp(join('/tmp', 'baas-bench-v4.'));
  const events = [];
  let failRun = false;
  let failCleanup = false;
  const runError = new Error('remote run failed');
  const command = async (name, args) => {
    if (name === 'ssh') {
      const remoteCommand = args.at(-1);
      events.push(['ssh', remoteCommand]);
      if (remoteCommand.includes('mktemp -d')) { await mkdir(remote, { recursive: true }); return { stdout: `${remote}\n` }; }
      if (remoteCommand.includes('remote-run.mjs')) {
        if (failRun) throw runError;
        await writeFile(join(remote, 'summary.json'), '{"ok":true}');
        await mkdir(join(remote, 'raw'));
        await writeFile(join(remote, 'raw.json'), '{"stage":1}');
        return { stdout: '', stderr: '' };
      }
      if (remoteCommand.includes('transfer.mjs seal')) { await createTransferManifest(remote); return { stdout: '', stderr: '' }; }
      if (remoteCommand.startsWith('rm -rf --')) {
        if (failCleanup) throw new Error('remote cleanup denied');
        await rm(remote, { recursive: true, force: true });
        return { stdout: '', stderr: '' };
      }
    }
    if (name === 'rsync') {
      events.push(['rsync']);
      await cp(remote, args[3], { recursive: true });
      return { stdout: '', stderr: '' };
    }
    throw new Error(`unexpected command ${name}`);
  };
  try {
    await mkdir(join(local, 'raw'));
    const result = await runRemoteTrial({ target: 'runner-transfer', platform: 'supabase', phase: 'measure', trial: 1, outputDir: local, remoteRoot: '/opt/baas-bench-v4', remoteRuntime: '/opt/baas-bench-v4/.runtime/benchmarks/realworld-api-v4' }, { runCommand: command, runLongCommand: command });
    assert.equal(result.transferred, true);
    assert.equal(events.some(([kind]) => kind === 'rsync'), true);
    assert.equal(failRun, false);
    failRun = true;
    failCleanup = true;
    await assert.rejects(runRemoteTrial({ target: 'runner-transfer', platform: 'supabase', phase: 'measure', trial: 2, outputDir: failedLocal, remoteRoot: '/opt/baas-bench-v4', remoteRuntime: '/opt/baas-bench-v4/.runtime/benchmarks/realworld-api-v4' }, { runCommand: command, runLongCommand: command }), error => error === runError && error.cleanupError === 'remote cleanup denied');
    assert.ok(events.some(([kind, remoteCommand]) => kind === 'ssh' && remoteCommand.startsWith('rm -rf --')));
  } finally { await rm(local, { recursive: true, force: true }); await rm(failedLocal, { recursive: true, force: true }); await rm(remote, { recursive: true, force: true }); }
});

test('long remote commands terminate on timeout or cancellation', async () => {
  const { runLongCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-execution.mjs');
  await assert.rejects(runLongCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 25 }), /timed out/);
  const controller = new AbortController();
  const pending = runLongCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5_000, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
});

test('authenticated ntfy completion notification is optional and failure-safe', async () => {
  const { sendCompletionNotification } = await import('../benchmark-sets/realworld-api-v4/shared/lib/notify.mjs');
  const calls = [];
  const sent = await sendCompletionNotification({ topic: 'bench-runs', token: 'tk_secret', runId: 'run-42', status: 'failed', estimatedUsd: 2.75, cleanup: 'complete' }, async (url, options) => { calls.push([url, options]); return { ok: true, status: 200 }; });
  assert.equal(sent, true);
  assert.equal(calls[0][0], 'https://ntfy.sh/bench-runs');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer tk_secret');
  assert.match(calls[0][1].body, /run-42.*failed.*2.75.*complete/);
  assert.equal(await sendCompletionNotification({ topic: '', token: '' }), false);
  await assert.rejects(sendCompletionNotification({ topic: 'bench-runs', token: 'tk_secret', runId: 'run-42', status: 'success', estimatedUsd: 1, cleanup: 'complete' }, async () => ({ ok: false, status: 401 })), /ntfy notification failed/);
});

test('resources sample complete one-second windows and detect sustained overload per metric', async () => {
  const { collectResources, evaluateRunnerOverload } = await import('../benchmark-sets/realworld-api-v4/shared/lib/resources.mjs');
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

test('resource probes use a fixed cadence rather than adding probe time to every interval', async () => {
  const { collectResources } = await import('../benchmark-sets/realworld-api-v4/shared/lib/resources.mjs');
  let now = 0;
  const sleeps = [];
  const stats = '{"ID":"aaaaaaaaaaaa","CPUPerc":"1%","MemUsage":"1MiB / 2GiB"}';
  const result = await collectResources({
    platform: 'supabase', containerIds: ['aaaaaaaaaaaa'], samples: 3, intervalMs: 5_000,
    now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; },
    cpuUsage: () => ({ user: 0, system: 0 }), memoryUsage: () => ({ rss: 1 }),
    monitorFactory: () => ({ enable() {}, disable() {}, reset() {}, percentile: () => 0, max: 0 }),
    command: async () => { now += 2_000; return { stdout: stats }; },
    runnerHostProbe: async () => { now += 1_000; return {}; },
    backendHostProbe: async () => { now += 1_000; return {}; },
  });
  assert.deepEqual(sleeps, [5_000, 1_000, 1_000]);
  assert.deepEqual(result.samples.map(sample => sample.timestampMs), [5_000, 10_000, 15_000]);
  assert.equal(result.valid, true);
});

test('resource collection invalidates missing and failed container probes', async () => {
  const { collectResources } = await import('../benchmark-sets/realworld-api-v4/shared/lib/resources.mjs');
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
  const { capacityStageDurationMs, executeRun } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
  assert.equal(capacityStageDurationMs(300_000, 1), 1_500_000);
  assert.equal(capacityStageDurationMs(300_000, 2), 750_000);
  assert.equal(capacityStageDurationMs(300_000, 5), 300_000);
  assert.equal(capacityStageDurationMs(300_000, 10), 300_000);
  const outputDir = await mkdtemp(join(tmpdir(), 'rw-runner-'));
  const events = [];
  try {
    await executeRun({ platform: 'neon', phase: 'measure', trial: 1, outputDir, accessPath: 'sql-over-http', deviations: ['auth emulated'], warmupMs: 1, stageMs: 300_000 }, {
      adapter: { users: Array.from({ length: 100 }, (_, i) => ({ i })), fixture: {} },
      correctness: async () => { events.push('correctness'); return { findings: [{ passed: true }] }; },
      reset: async () => { events.push('reset'); },
      workload: async (_adapter, _config, options) => {
        const users = options.users.length;
        const warmup = users === 50 && !events.includes('stage:5');
        events.push(warmup ? 'warmup-write' : `stage:${users}`);
        options.onMeasuredStart?.(); options.onSample?.({}); options.onMeasuredEnd?.();
        return { startedUsers: users, lostUsers: 0, stageFailed: warmup, failedWorkflowCount: warmup ? 1 : 0 };
      },
      metricsFactory: () => ({ record() {}, finalize(_elapsed, counts) { return passingStage(counts.requestedUsers); } }),
      collectResources: async options => {
        assert.equal(options.samples, 60);
        assert.equal(options.intervalMs, 5_000);
        return { samples: Array.from({ length: options.samples }, () => ({ runner: { cpuPercent: 95 }, eventLoop: { p99Ms: 0, maxMs: 0 } })), valid: true, validityReasons: [] };
      },
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

test('an invalid measured stage stops capacity search instead of being treated as an SLO bound', async () => {
  const { executeRun } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
  const outputDir = await mkdtemp(join(tmpdir(), 'rw-product-failure-'));
  try {
    await executeRun({ platform: 'supabase', phase: 'measure', trial: 1, outputDir, warmupMs: 0, stageMs: 1 }, {
      adapter: { users: Array.from({ length: 50 }, (_, i) => ({ i })), fixture: {} },
      correctness: async () => ({ findings: [{ passed: true }] }),
      workload: async (_adapter, _config, options) => {
        options.onMeasuredStart?.();
        options.onMeasuredEnd?.();
        return { startedUsers: options.users.length, lostUsers: 0, stageFailed: options.users.length === 10 };
      },
      metricsFactory: options => {
        assert.equal(options.maxLatencySamples, 1_000_000);
        return { record() {}, finalize(_elapsed, counts) { return passingStage(counts.requestedUsers); } };
      },
      collectResources: async () => ({ samples: [], valid: true, validityReasons: [] }),
      evaluateCapacity: stages => ({
        selectedCapacityUsers: stages[0].requestedUsers,
        stages: stages.map(stage => stage.requestedUsers === 5
          ? { requestedUsers: 5, passed: true, invalid: false, operationClasses: { read: { passed: true } } }
          : { requestedUsers: 10, passed: false, invalid: true, operationClasses: { read: { passed: false } } }),
        reasons: [], saturation: false,
      }),
      nextStage: ({ measuredUsers, upperFailure }) => {
        if (!measuredUsers.length) return 5;
        if (measuredUsers.length === 1) return 10;
        assert.equal(upperFailure, 10);
        return null;
      },
      monotonic: (() => { let n = 0; return () => ++n; })(),
    });
    const raw = JSON.parse(readFileSync(join(outputDir, 'raw.json'), 'utf8'));
    const summary = JSON.parse(readFileSync(join(outputDir, 'summary.json'), 'utf8'));
    assert.deepEqual(raw.stages.map(stage => stage.requestedUsers), [5, 10]);
    assert.deepEqual(raw.stages[1].validityReasons, ['workload failed']);
    assert.equal(summary.metrics.capacity_bounded, 1);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('resource-invalid stage stops before trying a higher capacity level', async () => {
  const { executeRun } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
  const outputDir = await mkdtemp(join(tmpdir(), 'rw-invalid-capacity-stop-'));
  const measuredUsers = [];
  try {
    await executeRun({ platform: 'supabase', phase: 'measure', trial: 1, outputDir, warmupMs: 0, stageMs: 1 }, {
      adapter: { users: Array.from({ length: 1_000 }, (_, i) => ({ i })), fixture: {} },
      correctness: async () => ({ findings: [{ passed: true }] }),
      workload: async (_adapter, _config, options) => {
        if (options.durationMs) measuredUsers.push(options.users.length);
        options.onMeasuredStart?.(); options.onMeasuredEnd?.();
        return { startedUsers: options.users.length, lostUsers: 0, stageFailed: false };
      },
      metricsFactory: () => ({ record() {}, finalize(_elapsed, counts) { return passingStage(counts.requestedUsers); } }),
      collectResources: async () => ({ samples: [], valid: false, validityReasons: ['remote host probe failed'] }),
    });
    const raw = JSON.parse(readFileSync(join(outputDir, 'raw.json'), 'utf8'));
    assert.deepEqual(measuredUsers, [100]);
    assert.deepEqual(raw.stages.map(stage => stage.requestedUsers), [100]);
    assert.match(raw.stages[0].validityReasons.join(' '), /remote host probe failed/);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('session preparation failure bounds capacity without losing completed stages', async () => {
  const { executeRun } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
  const outputDir = await mkdtemp(join(tmpdir(), 'rw-preparation-failure-'));
  try {
    await executeRun({ platform: 'trailbase', phase: 'measure', trial: 1, outputDir, warmupMs: 0, stageMs: 1 }, {
      adapter: { users: Array.from({ length: 50 }, (_, i) => ({ i })), fixture: {} },
      correctness: async () => ({ findings: [{ passed: true }] }),
      workload: async (_adapter, _config, options) => {
        if (options.users.length === 10) return { startedUsers: 0, lostUsers: 0, stageFailed: true, preparationFailed: true, preparationFailureCount: 1 };
        options.onMeasuredStart?.();
        options.onMeasuredEnd?.();
        return { startedUsers: options.users.length, lostUsers: 0, stageFailed: false, preparationFailed: false };
      },
      metricsFactory: () => ({ record() {}, finalize(_elapsed, counts) { return passingStage(counts.requestedUsers); } }),
      collectResources: async () => ({ samples: [], valid: true, validityReasons: [] }),
      nextStage: ({ measuredUsers, upperFailure }) => {
        if (!measuredUsers.length) return 5;
        if (measuredUsers.length === 1) return 10;
        assert.equal(upperFailure, 10);
        return null;
      },
      monotonic: (() => { let n = 0; return () => ++n; })(),
    });
    const raw = JSON.parse(readFileSync(join(outputDir, 'raw.json'), 'utf8'));
    const summary = JSON.parse(readFileSync(join(outputDir, 'summary.json'), 'utf8'));
    assert.deepEqual(raw.stages.map(stage => stage.requestedUsers), [5, 10]);
    assert.equal(raw.stages[1].elapsedSeconds, 0);
    assert.match(raw.stages[1].validityReasons.join(' '), /session preparation failed for 1 user/);
    assert.equal(summary.metrics.capacity_users, 5);
    assert.equal(summary.metrics.capacity_bounded, 1);
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('summary contains every fixed numeric metric and zeroes without a passing stage', async () => {
  const { summarize, FIXED_METRICS } = await import('../benchmark-sets/realworld-api-v4/shared/lib/summary.mjs');
  const summary = summarize([], { selectedCapacityUsers: 0, stages: [], saturation: false });
  assert.deepEqual(Object.keys(summary.metrics).sort(), [...FIXED_METRICS].sort());
  assert.ok(Object.values(summary.metrics).every(value => typeof value === 'number' && value === 0));
  const belowOne = summarize([], { selectedCapacityUsers: 0, stages: [{ requestedUsers: 1, passed: false, invalid: false, operationClasses: {} }], saturation: false });
  assert.equal(belowOne.metrics.capacity_users, 0);
  assert.equal(belowOne.metrics.capacity_bounded, 1);
});

test('runner CLI exits after completed writes instead of waiting for SDK handles', async () => {
  const { runCli } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
  const exits = [];
  const errors = [];
  await runCli([], {}, { run: async () => 'complete', exit: code => exits.push(code), error: message => errors.push(message) });
  await runCli([], {}, { run: async () => { throw new Error('failed safely'); }, exit: code => exits.push(code), error: message => errors.push(message) });
  assert.deepEqual(exits, [0, 1]);
  assert.deepEqual(errors, ['failed safely']);
});

test('runner overload invalidates attribution and every primary failure survives teardown failure', async () => {
  const { preservePrimaryFailure } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
  await assert.rejects(preservePrimaryFailure(async () => 'ok', async () => { throw new Error('teardown only'); }), /teardown only/);
  const primary = new Error('primary');
  await assert.rejects(preservePrimaryFailure(async () => { throw primary; }, async () => { throw new Error('teardown'); }), error => error === primary && error.teardownError === 'teardown');
  const frozen = Object.freeze(new Error('frozen primary'));
  await assert.rejects(preservePrimaryFailure(async () => { throw frozen; }, async () => { throw new Error('teardown'); }), error => error === frozen);
  await assert.rejects(preservePrimaryFailure(async () => { throw 'primitive primary'; }, async () => { throw new Error('teardown'); }), error => error === 'primitive primary');
});

test('run discovery failures invalidate measured stages and artifacts bound errors', async () => {
  const { executeRun } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
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
  const { runFromArguments } = await import('../benchmark-sets/realworld-api-v4/shared/lib/run.mjs');
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
  } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/postgres.mjs');
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
  assert.match(CREATE_FIXTURE_STATE_SQL, /realworld-api-v4-baseline-v1/);
  assert.match(RESET_FIXTURE_STATE_SQL, /realworld-api-v4-baseline-v1/);
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
    copyDataset, encodeCopyRow, verifyExactCounts, verifyMinimumCounts,
  } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/postgres.mjs');
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

  const { DATASET_COUNTS } = await import('../benchmark-sets/realworld-api-v4/shared/lib/dataset.mjs');
  const exact = Object.entries(DATASET_COUNTS).map(([table, count]) => ({ table, count: String(count) }));
  await verifyExactCounts(async (_sql, values) => { assert.deepEqual(values, []); return exact; });
  await assert.rejects(verifyExactCounts(async () => exact.map((row, index) => index ? row : { ...row, count: String(Number(row.count) - 1) })), /organizations.*expected/i);
  const extra = exact.map((row, index) => index ? row : { ...row, count: String(Number(row.count) + 1) });
  await assert.rejects(verifyExactCounts(async () => extra), /organizations.*expected/i);
  await verifyMinimumCounts(async () => extra);
  await assert.rejects(verifyMinimumCounts(async () => exact.map((row, index) => index ? row : { ...row, count: String(Number(row.count) - 1) })), /organizations.*expected at least/i);
  await assert.rejects(verifyExactCounts(async () => exact.slice(1)), /organizations.*missing/i);
  await assert.rejects(verifyExactCounts(async () => [...exact, { table: 'intruder', count: '0' }]), /unexpected table/i);
});

test('postgres COPY stream encoding preserves bounded batches and exact COPY framing data', async () => {
  const { encodeCopyBatches, encodeCopyRow } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/postgres.mjs');
  const batches = (async function* () {
    yield { entity: 'user', records: [
      { id: 'u1', email: 'a@example.test', displayName: 'A\\tB', createdAt: '2020-01-01', updatedAt: '2020-01-02' },
      { id: 'u2', email: 'b@example.test', displayName: null, createdAt: '2020-01-01', updatedAt: '2020-01-02' },
    ] };
  }());
  const encoded = [];
  for await (const batch of encodeCopyBatches({ batches, maxBatchSize: 2 })) encoded.push(batch);
  assert.equal(encoded.length, 1);
  assert.equal(encoded[0].statement, 'COPY public.users (id, email, display_name, created_at, updated_at) FROM STDIN');
  assert.equal(encoded[0].rowCount, 2);
  assert.equal(encoded[0].data, encodeCopyRow(['u1', 'a@example.test', 'A\\tB', '2020-01-01', '2020-01-02']) + encodeCopyRow(['u2', 'b@example.test', null, '2020-01-01', '2020-01-02']));
  await assert.rejects(() => encodeCopyBatches({ batches: (async function* () { yield { entity: 'user', records: [{}, {}, {}] }; }()), maxBatchSize: 2 }).next(), /batch exceeds/);
});

test('postgres admin parameterized administrative transports preserve SQL, values, results, and failures', async () => {
  const {
    CREATE_FIXTURE_STATE_SQL, RESET_FIXTURE_STATE_SQL, CREATE_NEON_PASSWORDS_SQL,
    createFixtureState, resetFixtureState, createNeonPasswords,
  } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/postgres.mjs');
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

test('Neon adapter uses SQL-over-HTTP transactions for authenticated tenant operations', async () => {
  const { createNeonAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/neon.mjs');
  const calls = [];
  const sql = (strings, ...values) => {
    assert.deepEqual(strings.raw, [...strings]);
    return { text: strings.reduce((out, part, index) => out + part + (index < values.length ? `$${index + 1}` : ''), ''), values };
  };
  sql.query = async (text, values, options) => {
    calls.push({ type: 'query', text, values, options });
    if (/sign_in/i.test(text)) return [{ token: 'neon-session-token-123456' }];
    if (/validate_session/i.test(text)) return [{ user_id: 'usrv3' }];
    return [];
  };
  sql.transaction = async (queries, options) => {
    calls.push({ type: 'transaction', queries, options });
    const data = queries[2];
    const task = { id: 'task', organization_id: 'org', project_id: 'project', creator_id: 'usrv3', assignee_id: null, title: 'Task', description: 'Task', status: 'todo', priority: 'low', due_date: null, created_at: new Date('2025-01-01'), updated_at: new Date('2025-01-01') };
    if (/from public\.users/i.test(data.text)) return [[], [{ user_id: 'usrv3' }], [{ id: 'usrv3', email: 'user@example.test', display_name: 'User', created_at: new Date('2025-01-01'), updated_at: new Date('2025-01-01') }]];
    if (/insert into public\.tasks/i.test(data.text)) return [[], [{ user_id: 'usrv3' }], [task]];
    if (/from public\.tasks where id/i.test(data.text)) return [[], [{ user_id: 'usrv3' }], [task]];
    return [[], [{ user_id: 'usrv3' }], []];
  };
  const backend = createNeonAdapter({ sql, timeoutMs: 1000 });
  const session = await backend.createSession({ email: 'user@example.test', password: 'secret' });
  assert.equal(backend.accessPath, 'sql-over-http');
  const profile = await session.getProfile();
  assert.equal(profile.id, 'usrv3');
  assert.equal(profile.createdAt, '2025-01-01T00:00:00.000Z');
  assert.ok(calls.some(call => call.type === 'transaction' && /SET LOCAL ROLE benchmark_client/.test(call.queries[0].text) && /validate_session/.test(call.queries[1].text)));
  const created = await session.createTask({ organizationId: 'org', projectId: 'project', title: 'Task', description: 'Task', priority: 'low' });
  assert.equal(created.status, 'todo');
  assert.match(calls.at(-1).queries[2].text, /'todo'/);
  await session.getTask({ organizationId: 'org', projectId: 'project', taskId: 'task', comments: { page: 2, pageSize: 7 } });
  const commentQuery = calls.findLast(call => call.type === 'transaction' && /from public\.comments/i.test(call.queries[2].text));
  assert.deepEqual(commentQuery.queries[2].values.slice(-2), [7, 14]);
  assert.deepEqual(calls.find(call => call.type === 'query').values, ['user@example.test', 'secret']);
  await session.signOut();
});

test('Neon adapter exposes the complete session workflow contract and parameterizes input', async () => {
  const { createNeonAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/neon.mjs');
  const sql = (strings, ...values) => ({ text: strings.join('?'), values });
  sql.query = async text => /sign_in/i.test(text) ? [{ token: 'neon-session-token-123456' }] : /validate_session/i.test(text) ? [{ user_id: 'u' }] : [];
  sql.transaction = async () => [[{ user_id: 'u' }], []];
  const adapter = createNeonAdapter({ sql });
  assert.equal(adapter.sessionPreparationConcurrency, 10);
  assert.equal(adapter.sessionPreparationBatchDelayMs, 100);
  const session = await adapter.createSession({ email: "a' OR 1=1 --", password: 'p$1' });
  for (const method of ['dashboard', 'listTasks', 'getTask', 'createTask', 'updateTask', 'addComment', 'updateComment', 'searchTasks', 'updateMembershipRole', 'updateProfile', 'getProfile', 'refreshSession', 'signOut', 'cancelPending', 'close']) assert.equal(typeof session[method], 'function', method);
  const fixture = adapter.correctnessFixture();
  assert.equal(fixture.member.organizationId, fixture.organizationId);
  assert.equal(fixture.admin.organizationId, fixture.organizationId);
});

test('Neon proxy recovery waits for SQL-over-HTTP readiness', async () => {
  const { restartNeonProxy } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/neon.mjs');
  const calls = [];
  let smokeAttempts = 0;
  const run = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'smoke' && ++smokeAttempts < 3) throw new Error('not ready');
  };
  await restartNeonProxy('/repo', { run, sleep: async () => {} });
  assert.deepEqual(calls[0], ['compose', 'neon', 'restart', 'proxy']);
  assert.equal(smokeAttempts, 3);
});

test('Neon SQL admin transport preserves parameterized requests and restrictive config', async () => {
  const { createNeonSql, createNeonAdmin, NEON_CLIENT_ROLE_SQL } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/neon.mjs');
  assert.match(NEON_CLIENT_ROLE_SQL, /CREATE ROLE benchmark_client NOLOGIN/);
  assert.match(NEON_CLIENT_ROLE_SQL, /NOSUPERUSER NOBYPASSRLS/);
  assert.match(NEON_CLIENT_ROLE_SQL, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO benchmark_client/);
  const calls = [];
  const counts = [{ table: 'organizations', count: '1600' }, { table: 'users', count: '16000' }, { table: 'memberships', count: '16000' }, { table: 'projects', count: '8000' }, { table: 'tasks', count: '160000' }, { table: 'comments', count: '479200' }, { table: 'activities', count: '319200' }];
  const sql = { query: async (text, values, options) => { calls.push({ text, values, options }); return /count\(\*\)/i.test(text) ? counts : [{ ok: true }]; } };
  const transport = createNeonSql({ sql });
  assert.deepEqual(await transport.query('SELECT $1', ['value']), [{ ok: true }]);
  assert.deepEqual(calls[0].values, ['value']);
  assert.equal(await createNeonAdmin({ sql, runtime: '/tmp/neon-v3-test' }).verify(), true);
  assert.match(calls[1].text, /count\(\*\)/i);
});

test('Neon setup removes stale benchmark resources before creating the schema', async () => {
  const { createNeonAdmin } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/neon.mjs');
  const runtime = await mkdtemp(join(tmpdir(), 'neon-v3-setup-'));
  const events = [];
  const counts = [{ table: 'organizations', count: '1600' }, { table: 'users', count: '16000' }, { table: 'memberships', count: '16000' }, { table: 'projects', count: '8000' }, { table: 'tasks', count: '160000' }, { table: 'comments', count: '479200' }, { table: 'activities', count: '319200' }];
  const sql = { query: async text => {
    if (/DROP SCHEMA IF EXISTS benchmark_fixture/.test(text)) events.push('drop');
    else if (/CREATE SCHEMA IF NOT EXISTS benchmark_extensions/.test(text)) events.push('schema');
    return /count\(\*\)/i.test(text) ? counts : [];
  } };
  try {
    const admin = createNeonAdmin({ sql, runtime, recoverConnections: async () => { events.push('recover'); } });
    await admin.setup();
    assert.deepEqual(events.slice(0, 3), ['recover', 'drop', 'schema']);
  } finally { await rm(runtime, { recursive: true, force: true }); }
});

test('Neon administration recovers proxy connections before teardown', async () => {
  const { createNeonAdmin } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/neon.mjs');
  const calls = [];
  const counts = [{ table: 'organizations', count: '1600' }, { table: 'users', count: '16000' }, { table: 'memberships', count: '16000' }, { table: 'projects', count: '8000' }, { table: 'tasks', count: '160000' }, { table: 'comments', count: '479200' }, { table: 'activities', count: '319200' }];
  const sql = { query: async text => { calls.push(text); return /count\(\*\)/i.test(text) ? counts : []; } };
  const admin = createNeonAdmin({ sql, runtime: '/tmp/neon-v3-recovery-test', recoverConnections: async () => { calls.push('recover'); } });
  await admin.reset();
  assert.equal(calls[0], 'recover');
  assert.match(calls[1], /TRUNCATE TABLE benchmark_auth\.sessions/);
  calls.length = 0;
  await admin.teardown();
  assert.equal(calls[0], 'recover');
  assert.match(calls[1], /DROP SCHEMA IF EXISTS benchmark_fixture/);
});

test('Neon SQL admin transport splits trusted scripts into one atomic HTTP transaction', async () => {
  const { createNeonSql, splitSqlStatements } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/neon.mjs');
  const script = `BEGIN;
CREATE FUNCTION example() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM 'value;still-string';
END $$;
-- ignored ; comment
CREATE TABLE example_table (value text);
COMMIT;`;
  assert.deepEqual(splitSqlStatements(script), [
    "BEGIN",
    "CREATE FUNCTION example() RETURNS void LANGUAGE plpgsql AS $$ BEGIN\n  PERFORM 'value;still-string';\nEND $$",
    '-- ignored ; comment\nCREATE TABLE example_table (value text)',
    'COMMIT',
  ]);
  const calls = [];
  const query = text => { calls.push(text); return Promise.resolve([{ text }]); };
  const sql = { query, transaction: async build => Promise.all(build({ query })) };
  const transport = createNeonSql({ sql });
  assert.deepEqual(await transport.query(script), [{ text: '-- ignored ; comment\nCREATE TABLE example_table (value text)' }]);
  assert.equal(calls.length, 2);
});

test('Convex capacity adapter uses native HTTP client auth and the shared session contract', async () => {
  const { createConvexAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/convex.mjs');
  const calls = [];
  const api = { auth: { signIn: 'auth.signIn', me: 'auth.me', signOut: 'auth.signOut', refresh: 'auth.refresh' }, project: { dashboard: 'project.dashboard' }, task: { list: 'task.list', get: 'task.get', create: 'task.create', update: 'task.update', search: 'task.search' }, comment: { list: 'comment.list', create: 'comment.create', update: 'comment.update' }, membership: { updateRole: 'membership.updateRole' }, user: { updateProfile: 'user.updateProfile' } };
  class FakeClient {
    setAuth(token) { calls.push(['auth', token]); }
    query(ref, args) { calls.push(['query', ref, args]); if (ref === api.auth.me) return Promise.resolve({ id: 'usr', email: 'u@example.test', displayName: 'User', createdAt: '2025-01-01', updatedAt: '2025-01-01' }); return Promise.resolve([]); }
    mutation(ref, args) { calls.push(['mutation', ref, args]); if (ref === api.auth.signIn) return Promise.resolve({ token: 'convex-token', userId: 'usr' }); return Promise.resolve({}); }
    close() { calls.push(['close']); return Promise.resolve(); }
  }
  const adapter = createConvexAdapter({ ConvexHttpClient: FakeClient, api, users: [{ credentials: { email: 'u@example.test', password: 'pw' }, organizationId: 'org', projectId: 'prj', taskId: 'tsk', commentId: 'cmt' }] });
  const session = await adapter.createSession({ email: 'u@example.test', password: 'pw' });
  assert.equal((await session.getProfile()).id, 'usr');
  assert.equal(typeof session.listTasks, 'function');
  await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  assert.ok(calls.some(call => call[0] === 'auth' && call[1] === 'convex-token'));
  assert.ok(calls.some(call => call[0] === 'query' && call[1] === api.task.list));
  await session.close();
});

test('Convex assets declare tenant authorization, indexes, and bounded lifecycle administration', async () => {
  const { readFileSync } = await import('node:fs');
  const schema = readFileSync(new URL('../benchmark-sets/realworld-api-v4/shared/convex/schema.ts', import.meta.url), 'utf8');
  const authorize = readFileSync(new URL('../benchmark-sets/realworld-api-v4/shared/convex/authorize.ts', import.meta.url), 'utf8');
  const admin = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/convex.mjs');
  const adminSource = readFileSync(new URL('../benchmark-sets/realworld-api-v4/shared/lib/admin/convex.mjs', import.meta.url), 'utf8');
  assert.match(schema, /organizations|projects|tasks|comments|activities/);
  assert.match(schema, /by_organization|by_project|by_task/);
  assert.match(authorize, /getUserIdentity|organization/);
  assert.deepEqual(admin.deployArgs, ['deploy', '--typecheck', 'disable']);
  assert.deepEqual(admin.postImportCheckpointLogArgs, ['compose', 'convex', 'logs', '--no-color', '--since', '15s', '--tail', '100', 'backend']);
  assert.deepEqual(admin.fixtureImportArgs('tasks', '/tmp/tasks.jsonl'), ['import', '--table', 'tasks', '--replace', '--format', 'jsonLines', '--yes', '/tmp/tasks.jsonl']);
  const removed = [];
  assert.equal(await admin.consumePristineMarker('/tmp/pristine', { accessFn: async () => {}, rmFn: async path => removed.push(path) }), true);
  assert.deepEqual(removed, ['/tmp/pristine']);
  assert.equal(await admin.consumePristineMarker('/tmp/missing', { accessFn: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }), false);
  await assert.rejects(admin.consumePristineMarker('/tmp/broken', { accessFn: async () => { throw new Error('transport'); } }), /transport/);
  assert.match(adminSource, /timeoutMs: 600_000/);
  assert.match(adminSource, /Writing table summary checkpoint/);
  assert.doesNotMatch(adminSource, /--append|importChunkSize|postImportRestartArgs|\['smoke', 'convex'\]/);
});

test('Appwrite adapter isolates Account and TablesDB sessions and normalizes rows', async () => {
  const { createAppwriteAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/appwrite.mjs');
  const calls = [];
  const api = {
    Client: class { setEndpoint() { return this; } setProject() { return this; } },
    Account: class { async createEmailPasswordSession(value) { calls.push(['signIn', value]); return { $id: 'session' }; } async get() { calls.push(['get']); return { $id: 'usr', email: 'u@example.test', name: 'User', registration: '2025-01-01', $updatedAt: '2025-01-01' }; } async deleteSession(value) { calls.push(['signOut', value]); } },
    TablesDB: class { async listRows(value) { calls.push(['list', value]); return { rows: [], total: 0 }; } },
    Query: { equal: (field, value) => `equal(${field},${value})`, orderAsc: field => `asc(${field})`, limit: value => `limit(${value})`, offset: value => `offset(${value})` },
  };
  const adapter = createAppwriteAdapter({ ...api, endpoint: 'http://appwrite/v1', projectId: 'p', databaseId: 'db', tableIds: { tasks: 'tasks' } });
  const session = await adapter.createSession({ email: 'u@example.test', password: 'pw' });
  assert.equal((await session.getProfile()).id, 'usr');
  await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  assert.ok(calls.some(call => call[0] === 'signIn'));
  assert.ok(calls.some(call => call[0] === 'list' && call[1].databaseId === 'db'));
  await session.signOut();
  await session.signOut();
  await session.close();
  assert.equal(calls.filter(call => call[0] === 'signOut').length, 1);
  assert.equal(adapter.sessionPreparationConcurrency, 10);
  assert.equal(adapter.sessionPreparationBatchDelayMs, 100);

  const timeoutAdapter = createAppwriteAdapter({ ...api, Account: class extends api.Account { async get() { return new Promise(() => {}); } }, timeoutMs: 1 });
  const timeoutSession = await timeoutAdapter.createSession({ email: 'u@example.test', password: 'pw' });
  await assert.rejects(timeoutSession.getProfile(), error => error.classification === 'timeout' && error.status === 408);
  await timeoutSession.close();

  const failureAdapter = createAppwriteAdapter({ ...api, Account: class extends api.Account { async get() { throw Object.assign(new Error('backend unavailable'), { code: 500 }); } } });
  const failureSession = await failureAdapter.createSession({ email: 'u@example.test', password: 'pw' });
  await assert.rejects(failureSession.getProfile(), error => error.classification === 'transport/sdk' && error.status === 500);
  await failureSession.close();
});

test('Appwrite admin authenticates cleanup and retains console credentials', async () => {
  const { consumeAppwritePristineMarker, createAppwriteAdmin } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/appwrite.mjs');
  const { createAppwriteAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/appwrite.mjs');
  const { access, mkdir, readFile, writeFile } = await import('node:fs/promises');
  const runtime = await mkdtemp(join(tmpdir(), 'baas-bench-appwrite-'));
  const state = join(runtime, 'state');
  const calls = [];
  const removed = [];
  assert.equal(await consumeAppwritePristineMarker('/tmp/pristine', { readFileFn: async () => 'pristine', rmFn: async path => removed.push(path) }), true);
  assert.deepEqual(removed, ['/tmp/pristine']);
  assert.equal(await consumeAppwritePristineMarker('/tmp/missing', { readFileFn: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }), false);
  await assert.rejects(consumeAppwritePristineMarker('/tmp/broken', { readFileFn: async () => { throw new Error('transport'); } }), /transport/);
  await mkdir(state);
  await writeFile(join(state, 'appwrite-console.json'), JSON.stringify({ email: 'admin@example.test', password: 'secret' }));
  await writeFile(join(state, 'appwrite-admin.json'), '{}');
  await writeFile(join(state, 'appwrite-config.json'), '{}');
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, status: options.method === 'POST' ? 201 : 204, text: async () => '', headers: { getSetCookie: () => options.method === 'POST' ? ['a_session=token; Path=/'] : [] } };
  };
  try {
    await createAppwriteAdmin({ runtime, fetchImpl }).teardown();
    assert.match(calls[0].url, /\/account\/sessions\/email$/);
    assert.ok(calls.slice(1).every(call => call.headers.cookie === 'a_session=token'));
    await access(join(state, 'appwrite-console.json'));
    await assert.rejects(access(join(state, 'appwrite-admin.json')));
    await assert.rejects(access(join(state, 'appwrite-config.json')));
  } finally { await rm(runtime, { recursive: true, force: true }); }

  const adminSource = await readFile(new URL('../benchmark-sets/realworld-api-v4/shared/lib/admin/appwrite.mjs', import.meta.url), 'utf8');
  assert.equal(typeof createAppwriteAdmin, 'function');
  assert.equal(createAppwriteAdapter({ Client: class {}, Account: class {}, TablesDB: class {}, api: {}, databaseId: 'db' }).accessPath, 'javascript-sdk');
  assert.match(adminSource, /\$id/);
  assert.match(adminSource, /platformId = 'bb-realworld-api-v4-web4'/);
  assert.match(adminSource, /keyId = 'bb-realworld-api-v4-key4'/);
  assert.match(adminSource, /\/platforms.*\[409\]/);
  assert.match(adminSource, /\/keys.*\[409\]/);
  assert.match(adminSource, /create\("users"\)/);
  assert.match(adminSource, /TablesDBIndexType\.Fulltext/);
  assert.match(adminSource, /tasks_title_fulltext/);
  assert.match(adminSource, /appwrite-fixture-pristine/);
  assert.match(adminSource, /if \(await consumeAppwritePristineMarker\(pristinePath\)\) return/);
});

test('Nhost adapter uses native auth and parameterized GraphQL requests', async () => {
  const { createNhostAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/nhost.mjs');
  const calls = [];
  const client = {
    auth: {
      signInEmailPassword: async value => { calls.push(['signIn', value]); return { body: { session: { accessToken: 'jwt', refreshToken: 'refresh', user: { id: 'usr', email: 'u@example.test', displayName: 'User', createdAt: '2025-01-01', updatedAt: '2025-01-01' } } } }; },
      refreshSession: async () => ({ body: { session: { accessToken: 'jwt2', refreshToken: 'refresh2' } } }),
      signOut: async () => { calls.push(['signOut']); },
    },
    graphql: { request: async value => { calls.push(['graphql', value]); return { body: { data: value.query.includes('listTasks') ? { tasks: [], tasksAggregate: { aggregate: { count: 0 } } } : { users: [{ id: 'usr', email: 'u@example.test', displayName: 'User', createdAt: '2025-01-01', updatedAt: '2025-01-01' }] } } }; } },
  };
  const adapter = createNhostAdapter({ createClient: () => client, client });
  const session = await adapter.createSession({ email: 'u@example.test', password: 'pw' });
  assert.equal((await session.getProfile()).id, 'usr');
  await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  assert.ok(calls.some(call => call[0] === 'signIn'));
  assert.ok(calls.some(call => call[0] === 'graphql' && call[1].variables.organizationId === 'org'));
  await session.close();
});

test('Nhost admin and adapter expose the Hasura GraphQL access path', async () => {
  const { createNhostAdmin } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/nhost.mjs');
  const { createNhostAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/nhost.mjs');
  assert.equal(typeof createNhostAdmin, 'function');
  assert.equal(createNhostAdapter({ createClient: () => ({}) }).accessPath, 'graphql');
});

test('Directus adapter uses isolated REST/auth clients and tenant filters', async () => {
  const { createDirectusAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/directus.mjs');
  const calls = [];
  const client = { async login(value) { calls.push(['login', value]); return { access_token: 'token' }; }, async refresh() { return {}; }, async logout() { calls.push(['logout']); }, async request(operation) { calls.push(['request', operation]); if (operation.kind === 'me') return { id: 'usr', email: 'u@example.test', display_name: 'User', created_at: '2025-01-01', updated_at: '2025-01-01' }; if (operation.collection === 'memberships') return { data: [{ user_id: 'usr' }] }; return { data: [], total: 0 }; }, with() { return this; } };
  const adapter = createDirectusAdapter({ client, createDirectus: () => client, rest: () => 'rest', authentication: () => 'auth' });
  const session = await adapter.createSession({ email: 'u@example.test', password: 'pw' });
  assert.equal((await session.getProfile()).id, 'usr');
  await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  assert.ok(calls.some(call => call[0] === 'login'));
  assert.ok(calls.some(call => call[0] === 'request' && JSON.stringify(call[1]).includes('organization_id')));
  await session.close();
});

test('Directus session cleanup stops SDK refresh timers without blocking on logout', async () => {
  const { createDirectusAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/directus.mjs');
  let stopped = 0; let cleared = 0;
  const client = { async login() { return {}; }, stopRefreshing() { stopped += 1; }, async setToken() { cleared += 1; } };
  const session = await createDirectusAdapter({ client, createDirectus: () => client }).createSession({ email: 'u@example.test', password: 'pw' });
  await session.close();
  assert.equal(stopped, 1);
  assert.equal(cleared, 1);
});

test('Directus admin and adapter expose REST access-path metadata', async () => {
  const { createDirectusAdmin, DIRECTUS_SQL_TIMEOUT_MS } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/directus.mjs');
  const { createDirectusAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/directus.mjs');
  assert.equal(typeof createDirectusAdmin, 'function');
  assert.equal(DIRECTUS_SQL_TIMEOUT_MS, 600_000);
  const adapter = createDirectusAdapter({ client: {}, createDirectus: () => ({}) });
  assert.equal(adapter.accessPath, 'javascript-sdk');
  assert.equal(adapter.sessionPreparationConcurrency, 10);
});

test('Directus derives the application identity before profile and tenant calls', async () => {
  const { createDirectusAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/directus.mjs');
  const calls = [];
  const client = {
    async login(value) { calls.push(['login', value]); return { id: 'directus-user-id' }; },
    async logout() {},
    async request(operation) {
      calls.push(['request', operation]);
      if (operation.collection === 'users') return { data: [{ id: 'usrv300000000000', email: 'u@example.test', display_name: 'User', created_at: '2025-01-01', updated_at: '2025-01-01' }] };
      if (operation.collection === 'memberships') return { data: [{ id: 'mem', organization_id: 'org', user_id: 'usrv300000000000', role: 'owner' }] };
      return { data: [], meta: { total_count: 0 } };
    },
  };
  const adapter = createDirectusAdapter({ client, readItems: (collection, query) => ({ collection, query }) });
  const session = await adapter.createSession({ email: 'user-usrv300000000000@example.test', password: 'pw' });
  assert.equal((await session.getProfile()).id, 'usrv300000000000');
  await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  assert.ok(calls.some(call => call[0] === 'request' && call[1].collection === 'users' && call[1].query.filter.id._eq === 'usrv300000000000'));
  assert.ok(calls.some(call => call[0] === 'request' && call[1].collection === 'memberships' && call[1].query.filter.user_id._eq === 'usrv300000000000'));
});

test('Directus rejects tenant operations when the session has no application identity', async () => {
  const { createDirectusAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/directus.mjs');
  let requests = 0;
  const client = { async login() { return { id: 'directus-user-id' }; }, async request() { requests += 1; return { data: [] }; } };
  const adapter = createDirectusAdapter({ client, readItems: (collection, query) => ({ collection, query }) });
  const session = await adapter.createSession({ email: 'u@example.test', password: 'pw' });
  await assert.rejects(session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 }), error => error.status === 403);
  assert.equal(requests, 0);
});

test('Directus passes abort signals into SDK REST requests', async () => {
  const { createDirectusAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/directus.mjs');
  const signals = [];
  const client = {
    async login() { return { id: 'directus-user-id' }; },
    async request(operation) { return operation.collection === 'memberships' ? { data: [{ user_id: 'usrv300000000000' }] } : { data: [], meta: { total_count: 0 } }; },
  };
  const adapter = createDirectusAdapter({
    client,
    readItems: (collection, query) => ({ collection, query }),
    withOptions: (operation, options) => { signals.push(options.signal); return operation; },
  });
  const session = await adapter.createSession({ email: 'user-usrv300000000000@example.test', password: 'pw' });
  await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  assert.ok(signals.length >= 2);
  assert.ok(signals.every(signal => signal instanceof AbortSignal));
});

test('Directus runtime uses an IPv4 healthcheck and API-only benchmark users', async () => {
  const { readFile } = await import('node:fs/promises');
  const compose = await readFile(new URL('../services/directus/compose.yml', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../benchmark-sets/realworld-api-v4/shared/lib/admin/directus.mjs', import.meta.url), 'utf8');
  assert.match(compose, /http:\/\/127\.0\.0\.1:8055\/server\/ping/);
  assert.match(admin, /admin_access, app_access\) VALUES \([\s\S]*false, false\)/);
  assert.doesNotMatch(admin, /argon2@0\.44\.0/);
});

test('Directus activity hook handles task and comment mutations', async () => {
  const { readFile } = await import('node:fs/promises');
  const hook = await readFile(new URL('../benchmark-sets/realworld-api-v4/shared/directus/hooks/realworld-activity/index.js', import.meta.url), 'utf8');
  assert.match(hook, /items\.create/);
  assert.match(hook, /items\.update/);
  assert.match(hook, /external_identifier/);
  assert.match(hook, /activities/);
  const caseScript = await readFile(new URL('../benchmark-sets/realworld-api-v4/shared/case.sh', import.meta.url), 'utf8');
  assert.match(caseScript, /cp -R "\$script_dir\/directus" "\$runtime\/"/);
});

test('PocketBase adapter isolates auth stores and uses parameterized record filters', async () => {
  const { createPocketBaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/pocketbase.mjs');
  const calls = [];
  const pb = { filter: (text, values) => JSON.stringify({ text, values }), authStore: { clear() { calls.push(['clear']); } }, collection(name) { return { async authWithPassword(email, password) { calls.push(['login', name, email, password]); return { record: { id: 'usr', email, name: 'User', created: '2025-01-01', updated: '2025-01-01' } }; }, async authRefresh() { calls.push(['refresh']); return {}; }, async getOne(id) { calls.push(['getOne', name, id]); return { id, organization_id: 'org', project_id: 'prj', creator_id: 'usr', title: 't', description: 'd', status: 'todo', priority: 'low', created: '2025-01-01', updated: '2025-01-01' }; }, async getList(page, size, options) { calls.push(['list', name, page, size, options]); return { items: [], totalItems: 0 }; }, async create(data) { calls.push(['create', name, data]); return { id: 'new', ...data, created: '2025-01-01', updated: '2025-01-01' }; }, async update(id, data) { return { id, ...data, created: '2025-01-01', updated: '2025-01-01' }; } }; } };
  const adapter = createPocketBaseAdapter({ PocketBase: function () { return pb; }, client: pb });
  const session = await adapter.createSession({ email: 'u@example.test', password: 'pw' });
  assert.equal((await session.getProfile()).id, 'usr');
  await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  assert.ok(calls.some(call => call[0] === 'login'));
  assert.ok(calls.some(call => call[0] === 'list' && call[4].options === undefined));
  await session.close();
});

test('Supabase teardown clears isolated auth users efficiently', async () => {
  const { readFile } = await import('node:fs/promises');
  const admin = await readFile(new URL('../benchmark-sets/realworld-api-v4/shared/lib/admin/supabase.mjs', import.meta.url), 'utf8');
  const { runCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/command.mjs');
  assert.match(admin, /TRUNCATE TABLE auth\.users CASCADE/);
  assert.match(admin, /timeoutMs: 600_000/);
  assert.throws(() => runCommand(process.execPath, [], { timeoutMs: 600_001 }), /invalid command timeout/);
});

test('PocketBase migration and admin expose collection lifecycle', async () => {
  const { createPocketBaseAdmin } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/pocketbase.mjs');
  const { readFileSync } = await import('node:fs');
  const migration = readFileSync(new URL('../benchmark-sets/realworld-api-v4/shared/pocketbase/migration.js', import.meta.url), 'utf8');
  assert.equal(typeof createPocketBaseAdmin, 'function');
  assert.match(migration, /organizations|tasks|comments|activities/);
  assert.match(migration, /title|description|priority/);
  const admin = readFileSync(new URL('../benchmark-sets/realworld-api-v4/shared/lib/admin/pocketbase.mjs', import.meta.url), 'utf8');
  assert.match(admin, /authWithPassword|superuser/);
  assert.match(admin, /seedDataset/);
  assert.match(admin, /randomBytes\(16\)\.toString\('hex'\)\.slice\(0, 30\)/);
  assert.match(admin, /emailVisibility/);
  assert.match(admin, /Number\(row\[1\]\) < expected\[row\[0\]\]/);
});

test('TrailBase adapter uses the official record client with isolated auth sessions', async () => {
  const { createTrailBaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/trailbase.mjs');
  const calls = [];
  const client = { auth: { async login(value) { calls.push(['login', value]); return { user: { id: 'usr' }, token: 'token' }; }, async refresh() {}, async logout() { calls.push(['logout']); } }, records(name) { return { async list(options) { calls.push(['list', name, options]); if (name === 'users') return { records: [{ id: 'usr', email: 'u@example.test' }] }; if (name === 'memberships') return { records: [{ id: 42, external_id: 'mem', organization_id: 'org', user_id: 'usr', role: 'member', created_at: '2025-01-01' }] }; return { records: [], totalCount: 0 }; }, async read(id) { calls.push(['read', name, id]); return { id, organization_id: 'org', project_id: 'prj', creator_id: 'usr', title: 't', description: 'd', status: 'todo', priority: 'low', created_at: '2025-01-01', updated_at: '2025-01-01' }; }, async create(data) { calls.push(['create', name, data]); return { id: 'new', ...data }; }, async update(id, data) { calls.push(['update', name, id, data]); return { id, ...data }; } }; } };
  const adapter = createTrailBaseAdapter({ initClient: () => client, client });
  const session = await adapter.createSession({ email: 'u@example.test', password: 'pw' });
  assert.equal((await session.getProfile()).id, 'usr');
  await session.listTasks({ organizationId: 'org', projectId: 'prj', page: 0, pageSize: 10 });
  const updatedMembership = await session.updateMembershipRole({ organizationId: 'org', membershipId: 'mem', role: 'admin' });
  assert.deepEqual(updatedMembership, { id: 'mem', organizationId: 'org', userId: 'usr', role: 'admin', createdAt: '2025-01-01' });
  assert.ok(calls.some(call => call[0] === 'login'));
  assert.ok(calls.some(call => call[0] === 'list' && call[2].pagination.limit === 10));
  assert.ok(calls.some(call => call[0] === 'update' && call[1] === 'memberships' && call[2] === 42));
  await session.signOut();
  await assert.rejects(() => session.getProfile(), error => error?.status === 401);
  await session.close();
});

test('TrailBase getTask forwards comment pagination to the record API', async () => {
  const { createTrailBaseAdapter } = await import('../benchmark-sets/realworld-api-v4/shared/lib/adapters/trailbase.mjs');
  const calls = [];
  const client = { auth: { async login() {}, async logout() {} }, records(name) { return { async list(options) { calls.push(['list', name, options]); if (name === 'users') return { records: [{ id: 1, external_id: 'usr', email: 'u@example.test', display_name: 'User', created_at: '2025-01-01', updated_at: '2025-01-01' }] }; if (name === 'tasks') return { records: [{ id: 2, external_id: 'task', organization_id: 'org', project_id: 'prj', creator_id: 'usr', assignee_id: null, title: 'Task', description: 'Description', status: 'todo', priority: 'low', due_date: null, created_at: '2025-01-01', updated_at: '2025-01-01' }] }; return { records: [], total_count: 0 }; }, async read(id) { calls.push(['read', name, id]); return { id, external_id: 'task', organization_id: 'org', project_id: 'prj', creator_id: 'usr', assignee_id: null, title: 'Task', description: 'Description', status: 'todo', priority: 'low', due_date: null, created_at: '2025-01-01', updated_at: '2025-01-01' }; }, async update() {}, async create() {} }; } };
  const adapter = createTrailBaseAdapter({ initClient: () => client, client });
  const session = await adapter.createSession({ email: 'u@example.test', password: 'pw' });
  await session.getTask({ organizationId: 'org', projectId: 'prj', taskId: 'task', comments: { page: 2, pageSize: 3 } });
  const commentCall = calls.find(call => call[0] === 'list' && call[1] === 'comments');
  assert.deepEqual(commentCall[2].pagination, { limit: 3, offset: 6 });
  await session.close();
});

test('TrailBase migration, config, and admin expose tenant-scoped record APIs', async () => {
  const { createTrailBaseAdmin } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin/trailbase.mjs');
  const { readFileSync } = await import('node:fs');
  const migration = readFileSync(new URL('../benchmark-sets/realworld-api-v4/shared/trailbase/migration.sql', import.meta.url), 'utf8');
  const adminSource = readFileSync(new URL('../benchmark-sets/realworld-api-v4/shared/lib/admin/trailbase.mjs', import.meta.url), 'utf8');
  const config = readFileSync(new URL('../benchmark-sets/realworld-api-v4/shared/trailbase/config.textproto', import.meta.url), 'utf8');
  assert.equal(typeof createTrailBaseAdmin, 'function');
  assert.match(migration, /organizations|tasks|comments|activities/);
  assert.match(config, /record_apis/);
  assert.match(config, /EXISTS/);
  assert.match(config, /name: "users"[\s\S]*read_access_rule: "_USER_\.id IS NOT NULL"/);
  assert.match(config, /update_access_rule/);
  assert.match(adminSource, /result\[0\]\?\.\[0\] < count/);
});

test('all real-world adapters and administrative modules expose the shared lifecycle contract', async () => {
  const modules = Object.fromEntries(await Promise.all(platforms.map(async platform => [platform, {
    adapter: await import(`../benchmark-sets/realworld-api-v4/shared/lib/adapters/${platform}.mjs`),
    admin: await import(`../benchmark-sets/realworld-api-v4/shared/lib/admin/${platform}.mjs`),
  }])));
  for (const platform of platforms) {
    assert.equal(typeof modules[platform].adapter.createBackend, 'function', `${platform} backend factory`);
    assert.equal(typeof modules[platform].admin.setup, 'function', `${platform} setup`);
    assert.equal(typeof modules[platform].admin.verify, 'function', `${platform} verify`);
    assert.equal(typeof modules[platform].admin.reset, 'function', `${platform} reset`);
    assert.equal(typeof modules[platform].admin.teardown, 'function', `${platform} teardown`);
    assert.doesNotMatch(text(`benchmarks/project-management-capacity/cases/${platform}/${platform === 'neon' ? 'javascript-sql-http' : 'javascript-sdk'}/README.md`), /scaffold|deferred|TODO/i);
  }
  assert.doesNotMatch(text('README.md'), /scaffold|deferred|TODO/i);
  assert.doesNotMatch(text('METHODOLOGY.md', benchmarkRoot), /deferred|TODO/i);
});

test('administrative dispatch invokes exactly the requested platform handler', async () => {
  const { dispatchAdmin } = await import('../benchmark-sets/realworld-api-v4/shared/lib/admin.mjs');
  const calls = [];
  await dispatchAdmin(['reset', 'neon', 'measure', '2', '/tmp/output'], {
    loadAdmin: async platform => ({ reset: context => calls.push([platform, context]) }),
  });
  assert.deepEqual(calls, [['neon', { platform: 'neon', phase: 'measure', trial: 2, outputDir: '/tmp/output' }]]);
  await dispatchAdmin(['setup', 'directus', 'setup', '0', '/tmp/output'], {
    loadAdmin: async platform => ({ setup: context => calls.push([platform, context]) }),
  });
  assert.deepEqual(calls[1], ['directus', { platform: 'directus', phase: 'setup', trial: 0, outputDir: '/tmp/output' }]);
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
  assert.match(hook, /remote-execution\.mjs/);
  assert.match(hook, /lib\/admin\.mjs/);
  const pkg = JSON.parse(text('shared/package.json'));
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.dependencies['@neondatabase/serverless'], '1.1.0');
  assert.equal(pkg.dependencies['@supabase/supabase-js'], '2.117.2');
  const lock = JSON.parse(text('shared/package-lock.json'));
  assert.equal(lock.packages[''].dependencies['@neondatabase/serverless'], '1.1.0');
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
});
