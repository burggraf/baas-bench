import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinodeApi } from '../benchmark-sets/realworld-api-v4/shared/lib/linode-controller.mjs';

const load = () => import('../benchmark-sets/realworld-api-v4/shared/lib/linode-controller.mjs');

test('Linode token file is parsed as restricted private data', async () => {
  const { readLinodeToken } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'linode-v4-token-'));
  const path = join(directory, '.linode.env');
  try {
    await writeFile(path, 'LINODE_TOKEN=controller-secret\n', { mode: 0o600 });
    assert.equal(await readLinodeToken(path), 'controller-secret');
    assert.equal(spawnSync('git', ['check-ignore', '-q', '.linode.env'], { cwd: fileURLToPath(new URL('../', import.meta.url)) }).status, 0);
    await chmod(path, 0o644);
    await assert.rejects(readLinodeToken(path), /private/);
    await chmod(path, 0o600);
    await writeFile(path, 'LINODE_TOKEN=$(touch /tmp/pwned)\n');
    await assert.rejects(readLinodeToken(path), /invalid LINODE_TOKEN file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Linode API uses controller-only bearer auth and paginates without leaking tokens', async () => {
  const { LinodeApi } = await load();
  const calls = [];
  const api = new LinodeApi({ token: 'controller-secret', fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return new Response(JSON.stringify({ data: [{ id: url.includes('page=1') ? 1 : 2 }], page: url.includes('page=1') ? 1 : 2, pages: 2 }), { status: 200 });
  } });
  assert.deepEqual(await api.list('/v4/linode/types'), [{ id: 1 }, { id: 2 }]);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer controller-secret');
  assert.match(calls[0][0], /page=1/);
  assert.match(calls[1][0], /page=2/);
  const failed = new LinodeApi({ token: 'controller-secret', fetchImpl: async () => new Response('controller-secret', { status: 403 }) });
  await assert.rejects(failed.request('GET', '/v4/regions'), error => error.status === 403 && !error.message.includes('controller-secret'));
  const rejected = new LinodeApi({ token: 'controller-secret', fetchImpl: async () => new Response(JSON.stringify({ errors: [{ field: 'interfaces.1.vpc.ipv4.addresses.0.address', reason: 'must be within the subnet; controller-secret' }] }), { status: 400 }) });
  await assert.rejects(rejected.request('POST', '/v4/linode/instances', {}), error => error.status === 400 && error.message.includes('interfaces.1.vpc.ipv4.addresses.0.address') && error.message.includes('must be within the subnet') && !error.message.includes('controller-secret'));
});

test('Linode API retries transient GET fetch failures without replaying resource creation', async () => {
  let getAttempts = 0;
  const api = new LinodeApi({ token: 'controller-secret', fetchImpl: async () => {
    getAttempts++;
    if (getAttempts < 3) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ data: [], page: 1, pages: 1 }), { status: 200 });
  } });
  assert.deepEqual(await api.list('/v4/regions'), []);
  assert.equal(getAttempts, 3);
  let postAttempts = 0;
  const post = new LinodeApi({ token: 'controller-secret', fetchImpl: async () => { postAttempts++; throw new TypeError('fetch failed'); } });
  await assert.rejects(post.request('POST', '/v4/linode/instances', {}), /fetch failed/);
  assert.equal(postAttempts, 1);
});

test('real Linode API client fails closed without spend and deletion approval', async () => {
  const { LinodeApi, provisionPair, cleanupPair } = await load();
  let requests = 0;
  const api = new LinodeApi({ token: 'controller-secret', fetchImpl: async () => { requests++; throw new Error('live request forbidden in test'); } });
  await assert.rejects(provisionPair({ api, config: provisionConfig }), /explicit live approval/);
  const { api: mocked } = fakeApi();
  const inventory = await provisionPair({ api: mocked, config: provisionConfig, save: async () => {} });
  await assert.rejects(cleanupPair({ api, inventory, save: async () => {}, sleep: async () => {} }), /exact run-ID deletion confirmation/);
  assert.equal(requests, 0);
});

test('hardware selection uses the cheapest available VPC-capable dedicated 8 GiB plan', async () => {
  const { selectHardwareProfile, estimatePairCost } = await load();
  const regions = [
    { id: 'us-west', status: 'ok', capabilities: ['Linodes', 'Linode Interfaces'] },
    { id: 'us-lax', status: 'ok', capabilities: ['Linodes', 'Linode Interfaces', 'VPCs'] },
    { id: 'us-east', status: 'ok', capabilities: ['Linodes'] },
  ];
  const types = [
    { id: 'g6-standard-4', class: 'standard', memory: 8192, price: { hourly: 0.08 } },
    { id: 'g6-dedicated-4', class: 'dedicated', memory: 8192, price: { hourly: 0.12 }, region_prices: [{ id: 'us-west', hourly: 0.05 }, { id: 'us-lax', hourly: 0.1 }] },
  ];
  const availability = [
    { region: 'us-west', plan: 'g6-dedicated-4', available: true },
    { region: 'us-lax', plan: 'g6-dedicated-4', available: true },
    { region: 'us-east', plan: 'g6-dedicated-4', available: true },
  ];
  const profile = selectHardwareProfile(regions, types, availability);
  assert.equal(profile.region, 'us-lax');
  assert.equal(profile.type.id, 'g6-dedicated-4');
  assert.equal(profile.hourlyUsd, 0.1);
  assert.equal(estimatePairCost(profile.hourlyUsd, 3, 1), 1.6);
  assert.throws(() => selectHardwareProfile(regions, types.slice(0, 1), availability), /dedicated 8192 MiB/);
});

test('hardware profile resolver reads current regions, types, and per-region availability', async () => {
  const { resolveHardwareProfile } = await load();
  const calls = [];
  const api = {
    async list(path) {
      calls.push(path);
      if (path === '/v4/regions') return [{ id: 'us-west', label: 'West', status: 'ok', capabilities: ['Linode Interfaces'] }, { id: 'us-lax', label: 'LAX', status: 'ok', capabilities: ['Linode Interfaces', 'VPCs'] }];
      return [{ id: 'g6-dedicated-4', class: 'dedicated', memory: 8192, region_prices: [{ id: 'us-west', hourly: .12 }, { id: 'us-lax', hourly: .10 }] }];
    },
    async request(method, path) { calls.push(`${method} ${path}`); return [{ region: path.includes('us-west') ? 'us-west' : 'us-lax', plan: 'g6-dedicated-4', available: true }]; },
  };
  const profile = await resolveHardwareProfile(api);
  assert.equal(profile.region, 'us-lax');
  assert.deepEqual(calls, ['/v4/regions', '/v4/linode/types', 'GET /v4/regions/us-lax/availability']);
});

test('region resolution prefers west, lax, then sea, and falls back to any VPC-capable US region', async () => {
  const { resolveHardwareProfile } = await load();
  const regions = [
    { id: 'us-west', country: 'us', status: 'ok', capabilities: ['Linode Interfaces'] },
    { id: 'us-lax', country: 'us', status: 'ok', capabilities: ['Linode Interfaces', 'VPCs'] },
    { id: 'us-sea', country: 'us', status: 'ok', capabilities: ['Linode Interfaces', 'VPCs'] },
    { id: 'us-ord', country: 'us', status: 'ok', capabilities: ['Linode Interfaces', 'VPCs'] },
  ];
  let available = new Set(['us-sea', 'us-ord']);
  const api = {
    async list(path) { return path === '/v4/regions' ? regions : [{ id: 'g6-dedicated-4', class: 'dedicated', memory: 8192, price: { hourly: 0.1 }, region_prices: [{ id: 'us-sea', hourly: 0.12 }, { id: 'us-ord', hourly: 0.05 }] }]; },
    async request(method, path) { const region = path.split('/')[3]; return [{ region, plan: 'g6-dedicated-4', available: available.has(region) }]; },
  };
  assert.equal((await resolveHardwareProfile(api)).region, 'us-sea');
  available = new Set(['us-ord']);
  assert.equal((await resolveHardwareProfile(api)).region, 'us-ord');
});

test('campaign reservations enforce the fixed spend cap and settle actual estimates', async () => {
  const { reserveCampaignSpend, settleCampaignSpend } = await load();
  const ledger = { schema_version: 1, capUsd: 30, spentUsd: 5, reservations: {} };
  reserveCampaignSpend(ledger, 'obs-001', 10);
  assert.throws(() => reserveCampaignSpend(ledger, 'obs-002', 16), /campaign budget/);
  settleCampaignSpend(ledger, 'obs-001', 8.25);
  assert.equal(ledger.spentUsd, 13.25);
  assert.deepEqual(ledger.reservations, {});
});

test('manual inventory inspection is local and omits private host addresses', async () => {
  const { writePrivateJson } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'linode-v4-inspect-'));
  const path = join(directory, 'inventory.json');
  try {
    await writePrivateJson(path, { schema_version: 1, run_id: 'obs-20260929-inspect', status: 'ready', region: 'us-west', type: 'g6-dedicated-4', resources: { backend: { id: 5, label: 'owned-backend', publicIpv4: '192.0.2.99' } } });
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../bin/bench-v4-linode.mjs', import.meta.url)), 'inspect', path], { encoding: 'utf8' });
    assert.match(output, /obs-20260929-inspect/);
    assert.match(output, /owned-backend/);
    assert.equal(output.includes('192.0.2.99'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recovery CLI fails closed without an explicit deletion confirmation', () => {
  const output = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/bench-v4-linode.mjs', import.meta.url)), 'recover', '/tmp/not-read.json', '--campaign', '/tmp/not-read-ledger.json'], { encoding: 'utf8', env: { ...process.env, LINODE_TOKEN: '' } });
  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /--confirm-delete/);
});

test('pilot CLI fails before API work without approval or deletion confirmation', () => {
  const cli = fileURLToPath(new URL('../bin/bench-v4-linode.mjs', import.meta.url));
  const noApproval = spawnSync(process.execPath, [cli, 'pilot', '/tmp/pilot-inventory.json', '--platform', 'trailbase', '--max-reserve-usd', '1.94', '--run-id', 'obs-20260929-abc123', '--campaign', '/tmp/pilot-ledger.json', '--controller-cidr', '203.0.113.4/32', '--confirm-delete', 'obs-20260929-abc123'], { encoding: 'utf8', env: { ...process.env, LINODE_TOKEN: 'controller-secret', LIVE_APPROVAL_PHRASE: '' } });
  assert.notEqual(noApproval.status, 0);
  assert.match(noApproval.stderr, /LIVE_APPROVAL_PHRASE/);
  const wrongDelete = spawnSync(process.execPath, [cli, 'pilot', '/tmp/pilot-inventory.json', '--run-id', 'obs-20260929-abc123', '--campaign', '/tmp/pilot-ledger.json', '--controller-cidr', '203.0.113.4/32', '--confirm-delete', 'other-run'], { encoding: 'utf8', env: { ...process.env, LINODE_TOKEN: 'controller-secret', LIVE_APPROVAL_PHRASE: 'I_APPROVE_V4_LINODE_ACTIONS_UP_TO_USD_30' } });
  assert.notEqual(wrongDelete.status, 0);
  assert.match(wrongDelete.stderr, /confirm-delete/);
});

test('private inventory persistence is atomic, restrictive, and round-trips', async () => {
  const { writePrivateJson, readPrivateJson } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'linode-v4-inventory-'));
  const path = join(directory, 'run', 'inventory.json');
  try {
    const record = { schema_version: 1, run_id: 'obs-42', status: 'provisioning' };
    await writePrivateJson(path, record);
    assert.deepEqual(await readPrivateJson(path), record);
    assert.equal((await stat(path)).mode & 0o077, 0);
    assert.equal((await readFile(path, 'utf8')).includes('controller-secret'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function fakeApi(options = {}) {
  const settings = { failRunner: false, failDeleteRunner: false, mismatchedBackend: false, ...options };
  const calls = [];
  const resources = new Map();
  let nextId = 10;
  const api = {
    async request(method, path, body, signal) {
      calls.push([method, path, body, signal]);
      if (method === 'POST' && path === '/v4/vpcs') {
        const item = { id: ++nextId, label: body.label, description: body.description, subnets: [{ id: ++nextId, ...body.subnets[0] }] };
        resources.set(pathFor('vpc', item.id), item); return item;
      }
      if (method === 'POST' && path === '/v4/networking/firewalls') {
        assert.equal(body.status, undefined, 'firewall status is read-only');
        const item = { id: ++nextId, label: body.label, status: 'enabled' }; resources.set(pathFor('firewall', item.id), item); return item;
      }
      if (method === 'POST' && path === '/v4/linode/instances') {
        if (settings.failRunner && body.label.endsWith('-runner')) {
          const item = { id: ++nextId, label: body.label, tags: body.tags, status: 'running' };
          resources.set(pathFor('linode', item.id), item);
          throw new Error('simulated create timeout');
        }
        const item = { id: ++nextId, label: body.label, tags: body.tags, status: 'running', ipv4: ['10.203.0.99', '172.232.100.100'],
          interfaces: body.interfaces.map((iface, index) => { const { firewall_id, ...network } = structuredClone(iface);
            if (network.public) network.public.ipv4.addresses[0].address = '172.232.100.100';
            if (network.vpc) network.vpc.vpc_id = 11;
            return { id: 1000 + nextId * 2 + index, public: null, vpc: null, vlan: null, ...network }; }).reverse(),
          firewallIds: body.interfaces.map(iface => iface.firewall_id).reverse() };
        resources.set(pathFor('linode', item.id), item); return item;
      }
      const interfaces = path.match(/^\/v4\/linode\/instances\/(\d+)\/interfaces$/);
      if (method === 'GET' && interfaces) {
        const envelope = { interfaces: structuredClone(resources.get(pathFor('linode', Number(interfaces[1]))).interfaces) };
        return settings.changeInterfaces ? settings.changeInterfaces(envelope) : envelope;
      }
      const attachment = path.match(/^\/v4\/linode\/instances\/(\d+)\/interfaces\/(\d+)\/firewalls\?page=(\d+)&page_size=100$/);
      if (method === 'GET' && attachment) {
        const host = resources.get(pathFor('linode', Number(attachment[1])));
        const index = host.interfaces.findIndex(iface => iface.id === Number(attachment[2]));
        const firewalls = [structuredClone(resources.get(pathFor('firewall', host.firewallIds[index])))];
        const data = settings.changeFirewalls ? settings.changeFirewalls(firewalls, host.interfaces[index]) : firewalls;
        const envelope = { data, page: Number(attachment[3]), pages: 1, results: data.length };
        return settings.changeAttachmentEnvelope ? settings.changeAttachmentEnvelope(envelope) : envelope;
      }
      const match = path.match(/^\/v4\/(?:linode\/instances|networking\/firewalls|vpcs)\/(\d+)$/);
      if (match && method === 'GET') {
        const value = resources.get(path);
        if (!value) { const error = new Error('not found'); error.status = 404; throw error; }
        return settings.mismatchedBackend && path === pathFor('linode', 11) ? { ...value, label: 'somebody-elses-instance' } : value;
      }
      if (match && method === 'DELETE') {
        if (settings.failDeleteRunner && path.includes('linode/instances') && resources.get(path)?.label.endsWith('-runner')) throw new Error('simulated delete failure');
        resources.delete(path); return null;
      }
      throw new Error(`unexpected API call ${method} ${path}`);
    },
    async list(path, signal) {
      calls.push(['LIST', path, signal]);
      if (/\/interfaces\/\d+\/firewalls$/.test(path)) return LinodeApi.prototype.list.call(api, path, signal);
      const prefix = path.endsWith('/') ? path : `${path}/`;
      return [...resources.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
    },
  };
  return { api, calls, resources, setFailDeleteRunner: value => { settings.failDeleteRunner = value; } };
}

function pathFor(kind, id) {
  return `/v4/${kind === 'linode' ? 'linode/instances' : kind === 'firewall' ? 'networking/firewalls' : 'vpcs'}/${id}`;
}

const provisionConfig = {
  runId: 'obs-20260929-abc123', region: 'us-lax', type: 'g6-dedicated-4', image: 'linode/ubuntu24.04',
  sshPublicKey: 'ssh-ed25519 AAAATEST runner-key', controllerCidr: '203.0.113.4/32', subnetCidr: '10.203.0.0/24',
};

test('pair provisioning writes inventory before resources and cleanup deletes only owned IDs', async () => {
  const { provisionPair, cleanupPair } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'linode-v4-pair-'));
  const path = join(directory, 'inventory.json');
  const { api, calls } = fakeApi();
  const accountKey = 'ssh-ed25519 AAAATEST mba-m1';
  const config = { ...provisionConfig, additionalSshPublicKeys: [accountKey] };
  const saved = [];
  const save = async inventory => { saved.push(structuredClone(inventory)); };
  try {
    const inventory = await provisionPair({ api, config, inventoryPath: path, save });
    assert.equal(inventory.status, 'ready');
    assert.equal(inventory.resources.backend.id, 15);
    assert.equal(inventory.resources.runner.id, 16);
    assert.ok(saved.some(item => item.pending?.kind === 'vpc'));
    assert.ok(saved.some(item => item.pending?.kind === 'backend'));
    assert.equal(JSON.stringify(inventory).includes('AAAATEST'), false);
    assert.equal(calls.filter(([method]) => method === 'POST').length, 5);
    const firewalls = calls.filter(([method, path]) => method === 'POST' && path === '/v4/networking/firewalls').map(([, , body]) => body);
    assert.equal(firewalls.length, 2);
    assert.ok(firewalls.every(body => body.label.length <= 32));
    assert.deepEqual(firewalls.find(body => body.label === inventory.labels.publicFirewall).rules.inbound[0].addresses.ipv4, ['203.0.113.4/32']);
    assert.deepEqual(firewalls.find(body => body.label === inventory.labels.vpcFirewall).rules.inbound[0].addresses.ipv4, ['10.203.0.11/32']);
    const backendCreate = calls.find(([method, path, body]) => method === 'POST' && path === '/v4/linode/instances' && body.label.endsWith('-backend'))[2];
    assert.deepEqual(backendCreate.authorized_keys, [config.sshPublicKey, accountKey]);
    const runnerCreate = calls.find(([method, path, body]) => method === 'POST' && path === '/v4/linode/instances' && body.label.endsWith('-runner'))[2];
    assert.deepEqual(runnerCreate.authorized_keys, [config.sshPublicKey, accountKey]);
    assert.deepEqual(backendCreate.interfaces.map(iface => iface.default_route.ipv4), [true, false]);
    assert.equal(backendCreate.interfaces[1].vpc.ipv4.addresses[0].address, '10.203.0.10');
    assert.equal(backendCreate.network_helper, true);
    assert.equal(inventory.resources.backend.publicIpv4, '172.232.100.100');
    assert.ok(saved.filter(item => item.status === 'provisioning').every(item => !item.resources.backend?.publicIpv4 && !item.resources.backend?.privateIpv4));
    assert.equal(inventory.resources.runner.privateIpv4, '10.203.0.11');
    assert.equal(calls.filter(([method, path]) => method === 'GET' && /interfaces\/\d+\/firewalls\?page=1/.test(path)).length, 4);
    const cleaned = await cleanupPair({ api, inventory, save, sleep: async () => {} });
    assert.equal(cleaned.status, 'deleted');
    const deletedIds = calls.filter(([method]) => method === 'DELETE').map(([, path]) => Number(path.split('/').at(-1)));
    assert.deepEqual(deletedIds, [16, 15, 14, 13, 11]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('pair provisioning waits for both Linodes to enter the running state', async () => {
  const { provisionPair } = await load();
  const { api } = fakeApi();
  const originalRequest = api.request;
  let backendPolls = 0;
  api.request = async (method, path, body, signal) => {
    const actual = await originalRequest(method, path, body, signal);
    if (method === 'GET' && path === pathFor('linode', 15) && backendPolls++ === 0) return { ...actual, status: 'provisioning' };
    return actual;
  };
  const inventory = await provisionPair({ api, config: provisionConfig, save: async () => {}, sleep: async ms => assert.equal(ms, 250), pollIntervalMs: 250 });
  assert.equal(backendPolls, 2);
  assert.equal(inventory.status, 'ready');
  assert.ok(inventory.ready_at);
});

test('definitive Linode rejection clears pending ownership without retrying creation', async () => {
  const { provisionPair } = await load();
  const calls = [];
  const api = { request: async (method, path) => { calls.push([method, path]); const error = new Error('forbidden'); error.status = 403; throw error; }, list: async () => { throw new Error('definitive rejection needs no listing'); } };
  let latest;
  let caught;
  try { await provisionPair({ api, config: provisionConfig, save: async inventory => { latest = structuredClone(inventory); }, sleep: async () => {} }); }
  catch (error) { caught = error; }
  assert.equal(caught.status, 403);
  assert.equal(latest.pending, null);
  assert.equal(latest.status, 'deleted');
  assert.deepEqual(calls, [['POST', '/v4/vpcs']]);
});

test('ambiguous creation is reconciled by unique run label; primary create error survives cleanup error', async () => {
  const { provisionPair } = await load();
  const { api } = fakeApi({ failRunner: true, failDeleteRunner: true });
  let latest;
  let error;
  try { await provisionPair({ api, config: provisionConfig, save: async inventory => { latest = structuredClone(inventory); }, sleep: async () => {} }); }
  catch (caught) { error = caught; }
  assert.match(error.message, /simulated create timeout/);
  assert.equal(latest.status, 'needs_recovery');
  assert.equal(latest.resources.runner.id, 16);
  assert.match(String(error.cleanupError), /simulated delete failure/);
});

test('pilot preflight checks local tools, validated definitions, and tracked/untracked launch changes', async () => {
  const { preflightPilot } = await import('../benchmark-sets/realworld-api-v4/shared/lib/bench-execution.mjs');
  for (const dirty of ['', ' M benchmark-sets/realworld-api-v4/shared/lib/run.mjs\n', '?? benchmark-sets/realworld-api-v4/shared/new.mjs\n', ' M bin/bench\n', ' M services/trailbase/envoy.yaml\n', ' M versions.env\n']) {
    const calls = [];
    const task = preflightPilot({ repositoryRoot: '/repo', command: async (name, args, options) => {
      calls.push([name, args]); assert.equal(options.cwd, '/repo'); assert.equal(options.timeoutMs, 30_000);
      return { stdout: name === 'git' ? dirty : 'PASS\n' };
    } });
    if (dirty) await assert.rejects(task, /dirty; commit them before provisioning/); else await task;
    assert.equal(calls[0][0], 'sh');
    assert.deepEqual(calls[1], ['/repo/bin/bench', ['validate', 'realworld-api-v4/project-management-capacity/supabase/javascript-sdk']]);
    assert.ok(calls[2][1].includes('--porcelain'));
    assert.ok(calls[2][1].includes('bin/bench-v4-linode.mjs'));
    assert.ok(calls[2][1].includes('services/trailbase'));
    assert.ok(calls[2][1].includes('versions.env'));
  }
  const trailbaseCalls = [];
  await preflightPilot({ repositoryRoot: '/repo', platform: 'trailbase', command: async (name, args) => { trailbaseCalls.push([name, args]); return { stdout: '' }; } });
  assert.deepEqual(trailbaseCalls[1], ['/repo/bin/bench', ['validate', 'realworld-api-v4/project-management-capacity/trailbase/javascript-sdk']]);
  await assert.rejects(preflightPilot({ repositoryRoot: '/repo', platform: 'unknown', command: async () => {} }), /unsupported V4 pilot platform/);
  await assert.rejects(preflightPilot({ repositoryRoot: '/repo', command: async () => { throw new Error('missing controller tool'); } }), /missing controller tool/);
});

test('pilot rejects a failed local preflight before querying Linode or creating credentials', async () => {
  const { runPilot } = await import('../benchmark-sets/realworld-api-v4/shared/lib/pilot-workflow.mjs');
  let paidWork = false;
  await assert.rejects(runPilot({
    api: { request() {}, list: async () => { paidWork = true; } },
    config: { runId: 'obs-preflight123' }, repositoryRoot: '/repo', bootstrapScriptPath: '/script', controllerCidr: '203.0.113.4/32',
    preflight: async () => { throw new Error('pilot definitions are dirty'); },
    selectProfile: async () => { paidWork = true; throw new Error('must not reach Linode'); },
    createKey: async () => { paidWork = true; throw new Error('must not create credentials'); },
  }), /pilot definitions are dirty/);
  assert.equal(paidWork, false);
});

test('pilot workflow runs and verifies the selected TrailBase case with its ephemeral SSH credential', async () => {
  const { runPilot } = await import('../benchmark-sets/realworld-api-v4/shared/lib/pilot-workflow.mjs');
  const events = [];
  let sshConfigPath;
  const key = { privateKey: '/tmp/pilot-key', publicKey: 'ssh-ed25519 AAAATEST pilot', cleanup: async () => { events.push('key-cleanup'); } };
  const result = await runPilot({
    platform: 'trailbase',
    api: { request() {}, list: async path => { assert.equal(path, '/v4/profile/sshkeys'); return [{ label: 'mba-m1', ssh_key: 'ssh-ed25519 AAAATEST mba-m1' }]; } }, config: { runId: 'obs-20260929-abc123', image: 'linode/ubuntu24.04' }, repositoryRoot: '/repo', bootstrapScriptPath: fileURLToPath(new URL('../services/linode/bootstrap.sh', import.meta.url)), inventoryPath: '/tmp/inventory.json', campaignPath: '/tmp/ledger.json', controllerCidr: '203.0.113.4/32', maxHours: 2, transferReserveUsd: 1, liveApproval: 'approval', deleteConfirmation: 'obs-20260929-abc123',
    preflight: async ({ platform }) => { assert.equal(platform, 'trailbase'); },
    selectProfile: async () => ({ region: 'us-lax', type: { id: 'g6-dedicated-4', transfer: 5000 }, hourlyUsd: .1 }), createKey: async () => key,
    startAgent: async () => ({ env: { SSH_AUTH_SOCK: '/tmp/agent' }, stop: async () => { events.push('agent-stop'); } }),
    deploy: async ({ inventory, runnerKeyFile }) => { events.push('deploy'); assert.equal(runnerKeyFile, key.privateKey); return { environment: { DEPLOYED: inventory.resources.backend.privateIpv4, BAAS_BENCH_V4_SSH_CONFIG: '/stale/ssh_config' }, hostProvenance: { backend: { dockerService: 'active' }, runner: { dockerService: 'active' } } }; },
    executeBench: async ({ environment, platform }) => { assert.equal(platform, 'trailbase'); sshConfigPath = environment.BAAS_BENCH_V4_SSH_CONFIG; assert.equal((await stat(sshConfigPath)).mode & 0o777, 0o600); events.push('run'); assert.equal(environment.DEPLOYED, '10.203.0.10'); return '/tmp/bundle'; }, verifyBench: async (result, platform) => { assert.equal(platform, 'trailbase'); events.push(`verify:${result}`); },
    observe: async options => { assert.equal(options.transferReserveUsd, 0); assert.deepEqual(options.config.additionalSshPublicKeys, ['ssh-ed25519 AAAATEST mba-m1']); const inventory = { status: 'bootstrapping', resources: { backend: { publicIpv4: '172.233.137.153', privateIpv4: '10.203.0.10' } } }; await options.bootstrap({ inventory }); assert.equal(inventory.hardware_profile.type.id, 'g6-dedicated-4'); assert.equal(inventory.host_provenance.runner.dockerService, 'active'); const bundle = await options.run({ inventory, signal: new AbortController().signal }); await options.verify(bundle, inventory); return { result: bundle }; },
  });
  assert.equal(result.profile.region, 'us-lax');
  assert.deepEqual(events, ['deploy', 'run', 'verify:/tmp/bundle', 'agent-stop', 'key-cleanup']);
  await assert.rejects(stat(sshConfigPath), { code: 'ENOENT' });
});

test('pilot reservation cap shortens a run and rejects budgets below one billable hour', async () => {
  const { runPilot } = await import('../benchmark-sets/realworld-api-v4/shared/lib/pilot-workflow.mjs');
  const { estimatePairCost } = await load();
  let observedMaxHours;
  let keyCreated = false;
  const common = {
    platform: 'trailbase', maxHours: 8, api: { request() {}, list: async () => [{ label: 'mba-m1', ssh_key: 'ssh-ed25519 AAAATEST mba-m1' }] },
    config: { runId: 'obs-budget123', image: 'linode/ubuntu24.04' }, repositoryRoot: '/repo', bootstrapScriptPath: '/script', controllerCidr: '203.0.113.4/32',
    preflight: async () => {}, selectProfile: async () => ({ region: 'us-lax', type: { id: 'g6-dedicated-4', transfer: 5000 }, hourlyUsd: 0.108 }),
    createKey: async () => { keyCreated = true; return { privateKey: '/tmp/key', publicKey: 'ssh-ed25519 AAAATEST pilot', cleanup: async () => {} }; },
    createSshConfig: async () => ({ configPath: '/tmp/ssh_config', cleanup: async () => {} }), startAgent: async () => ({ env: { SSH_AUTH_SOCK: '/tmp/agent' }, stop: async () => {} }),
    observe: async options => { observedMaxHours = options.maxHours; return { result: '/tmp/evidence', estimateUsd: estimatePairCost(0.108, options.maxHours + 1, 0), actualUsd: 0, inventory: {} }; },
  };
  await runPilot({ ...common, maxReservationUsd: 0.50 });
  assert.equal(estimatePairCost(0.108, observedMaxHours + 1, 0), 0.50);
  const floor = observedMaxHours;
  keyCreated = false;
  await assert.rejects(runPilot({ ...common, maxReservationUsd: 0.21 }), /exceeds the remaining approval budget/);
  assert.equal(keyCreated, false);
  assert.equal(observedMaxHours, floor);
});

test('pilot fails before creating its run key when the named Linode SSH key is absent', async () => {
  const { runPilot } = await import('../benchmark-sets/realworld-api-v4/shared/lib/pilot-workflow.mjs');
  let keyCreated = false;
  await assert.rejects(runPilot({
    api: { request() {}, list: async () => [] },
    config: { runId: 'obs-20260929-abc123', image: 'linode/ubuntu24.04' },
    repositoryRoot: '/repo', bootstrapScriptPath: '/repo/services/linode/bootstrap.sh',
    inventoryPath: '/tmp/inventory.json', campaignPath: '/tmp/ledger.json', controllerCidr: '203.0.113.4/32',
    preflight: async () => {},
    selectProfile: async () => ({ region: 'us-lax', type: { id: 'g6-dedicated-4', transfer: 5000 }, hourlyUsd: .1 }),
    createKey: async () => { keyCreated = true; throw new Error('must not generate a run key'); },
  }), /Linode account SSH key "mba-m1" is missing or ambiguous/);
  assert.equal(keyCreated, false);
});

test('observation reserves campaign budget, verifies evidence before cleanup, then notifies', async () => {
  const { runObservation, readPrivateJson } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'linode-v4-run-'));
  const campaignPath = join(directory, 'campaign', 'ledger.json');
  const inventoryPath = join(directory, 'campaign', 'runs', `${provisionConfig.runId}.json`);
  const { api, calls } = fakeApi();
  const events = [];
  let now = 0;
  try {
    const outcome = await runObservation({
      api, config: provisionConfig, inventoryPath, campaignPath, hourlyUsd: 0.1, maxHours: 2, transferReserveUsd: 1,
      now: () => now, sleep: async () => {},
      bootstrap: async ({ inventory, signal }) => { events.push('bootstrap'); assert.equal(inventory.status, 'bootstrapping'); assert.equal(signal.aborted, false); },
      run: async ({ signal }) => { events.push('run'); assert.equal(signal.aborted, false); now = 3_600_000; return { result: 'evidence' }; },
      verify: async value => { events.push('verify'); assert.equal(value.result, 'evidence'); },
      notify: async message => { events.push(`notify:${message.status}:${message.cleanup}`); throw new Error('ntfy offline'); },
    });
    assert.deepEqual(events, ['bootstrap', 'run', 'verify', 'notify:success:complete']);
    assert.equal(outcome.actualUsd, 1.2);
    assert.equal(outcome.inventory.status, 'deleted');
    assert.equal((await readPrivateJson(campaignPath)).spentUsd, 1.2);
    assert.deepEqual(calls.filter(([method]) => method === 'DELETE').length, 5);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('observation waits for cancelled bootstrap to settle before deleting hosts', async () => {
  const { runObservation } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'linode-v4-cancel-'));
  const { api } = fakeApi();
  let settled = false;
  const request = api.request;
  api.request = async (method, ...args) => {
    if (method === 'DELETE') assert.equal(settled, true, 'cleanup must follow bootstrap cancellation');
    return request(method, ...args);
  };
  try {
    await assert.rejects(runObservation({
      api, config: provisionConfig, inventoryPath: join(directory, 'run.json'), campaignPath: join(directory, 'ledger.json'),
      hourlyUsd: 0.1, maxHours: 0.0002, transferReserveUsd: 0, sleep: async () => {},
      bootstrap: async ({ signal }) => {
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        await new Promise(resolve => setTimeout(resolve, 20));
        settled = true;
        signal.throwIfAborted();
      },
      run: async () => assert.fail('cancelled bootstrap must not start benchmark'), verify: async () => {},
    }), /maximum duration/);
    assert.equal(settled, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('observation keeps benchmark failure over cleanup and notification failures', async () => {
  const { runObservation } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'linode-v4-failure-'));
  const { api } = fakeApi({ failDeleteRunner: true });
  const primary = new Error('benchmark failed');
  let now = 0;
  try {
    let caught;
    try {
      await runObservation({
        api, config: { ...provisionConfig, runId: 'obs-20260929-fail123' }, inventoryPath: join(directory, 'run.json'), campaignPath: join(directory, 'ledger.json'),
        hourlyUsd: 0.1, maxHours: 2, transferReserveUsd: 1, now: () => now, sleep: async () => {},
        run: async () => { now = 60_000; throw primary; }, verify: async () => assert.fail('must not verify failed run'),
        notify: async message => { assert.equal(message.status, 'failed'); throw new Error('notification failed'); },
      });
    } catch (error) { caught = error; }
    assert.equal(caught, primary);
    assert.match(caught.cleanupError, /simulated delete failure/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recovery reconciles an interrupted run and charges its full reserved ceiling', async () => {
  const { runObservation, recoverObservation, readPrivateJson, writePrivateJson } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'linode-v4-recover-'));
  const campaignPath = join(directory, 'ledger.json');
  const inventoryPath = join(directory, 'inventory.json');
  const fixture = fakeApi({ failDeleteRunner: true });
  try {
    let primary;
    try {
      await runObservation({
        api: fixture.api, config: { ...provisionConfig, runId: 'obs-20260929-recovery' }, inventoryPath, campaignPath,
        hourlyUsd: 0.1, maxHours: 2, transferReserveUsd: 1, sleep: async () => {},
        run: async () => { throw new Error('benchmark failed'); }, verify: async () => {},
      });
    } catch (error) { primary = error; }
    assert.match(primary.cleanupError, /simulated delete failure/);
    assert.equal((await readPrivateJson(campaignPath)).reservations['obs-20260929-recovery'], 1.6);
    const ownerPath = `${campaignPath}.lock/owner.json`;
    const owner = await readPrivateJson(ownerPath);
    await writePrivateJson(ownerPath, { ...owner, pid: 99999999 });
    fixture.setFailDeleteRunner(false);
    const recovered = await recoverObservation({ api: fixture.api, inventoryPath, campaignPath, force: true, sleep: async () => {} });
    assert.equal(recovered.status, 'deleted');
    assert.equal((await readPrivateJson(campaignPath)).spentUsd, 1.6);
    assert.deepEqual((await readPrivateJson(campaignPath)).reservations, {});
    await assert.rejects(stat(`${campaignPath}.lock`), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cleanup refuses a mismatched instance owner label', async () => {
  const { provisionPair, cleanupPair } = await load();
  const { api, calls } = fakeApi();
  const inventory = await provisionPair({ api, config: provisionConfig, save: async () => {} });
  const ownedId = inventory.resources.backend.id;
  const originalRequest = api.request;
  api.request = async (method, path, body) => {
    if (method === 'GET' && path === pathFor('linode', ownedId)) {
      const value = await originalRequest(method, path, body);
      return { ...value, label: 'unowned-instance' };
    }
    return originalRequest(method, path, body);
  };
  await assert.rejects(cleanupPair({ api, inventory, save: async () => {}, sleep: async () => {} }), /ownership check failed/);
  assert.equal(calls.some(([method, path]) => method === 'DELETE' && path === pathFor('linode', ownedId)), false);
});

for (const [name, changeInterfaces, changeFirewalls] of [
  ['paginated interfaces envelope', () => ({ data: [], pages: 1 })],
  ['missing interface', e => ({ interfaces: e.interfaces.slice(0, 1) })],
  ['invalid interface ID', e => { e.interfaces[0].id = '123'; return e; }],
  ['duplicate interface ID', e => { e.interfaces[0].id = e.interfaces[1].id; return e; }],
  ['wrong subnet', e => { e.interfaces[0].vpc.subnet_id++; return e; }],
  ['wrong VPC', e => { e.interfaces[0].vpc.vpc_id++; return e; }],
  ['wrong role address', e => { e.interfaces[0].vpc.ipv4.addresses[0].address = '10.203.0.99'; return e; }],
  ['no VPC primary address', e => { e.interfaces[0].vpc.ipv4.addresses[0].primary = false; return e; }],
  ['duplicate public interfaces', e => { e.interfaces[0] = { ...structuredClone(e.interfaces[1]), id: e.interfaces[0].id }; return e; }],
  ['wrong VPC route', e => { e.interfaces[0].default_route.ipv4 = true; return e; }],
  ['wrong public route', e => { e.interfaces[1].default_route.ipv4 = false; return e; }],
  ['no primary address', e => { e.interfaces[1].public.ipv4.addresses[0].primary = false; return e; }],
  ['multiple primary addresses', e => { e.interfaces[1].public.ipv4.addresses.push({ address: '172.232.100.101', primary: true }); return e; }],
  ...['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '198.51.100.10', '224.0.0.1', '0.0.0.0', '255.255.255.255'].map(address => [`nonpublic ${address}`, e => { e.interfaces[1].public.ipv4.addresses[0].address = address; return e; }]),
  ['absent firewall', undefined, () => []],
  ['disabled VPC firewall', undefined, (f, iface) => { if (iface.vpc) f[0].status = 'disabled'; return f; }],
  ['disabled firewall', undefined, f => { f[0].status = 'disabled'; return f; }],
  ['wrong firewall ID', undefined, f => { f[0].id++; return f; }],
  ['wrong firewall label', undefined, f => { f[0].label = 'not-owned'; return f; }],
  ['unexpected firewall', undefined, f => [...f, { ...f[0], id: 999 }]],
]) {
  test(`network readiness rejects ${name} and cleans owned resources`, async () => {
    const { provisionPair } = await load();
    const { api, resources, calls } = fakeApi({ changeInterfaces, changeFirewalls });
    let latest;
    await assert.rejects(provisionPair({ api, config: provisionConfig, save: async value => { latest = structuredClone(value); }, sleep: async () => {} }), /interface|firewall|address|route|network/i);
    assert.equal(latest.status, 'deleted');
    assert.equal(resources.size, 0);
    assert.equal(calls.filter(([method]) => method === 'DELETE').length, 5);
    assert.equal(latest.resources.backend.publicIpv4, undefined);
  });
}

test('observation joins cancelled run and records its secondary failure before deletion', async () => {
  const { runObservation, readPrivateJson } = await load();
  const directory = await mkdtemp(join(tmpdir(), 'v4-run-cancel-'));
  const { api } = fakeApi();
  const request = api.request;
  let settled = false;
  api.request = async (method, ...args) => {
    if (method === 'DELETE') assert.equal(settled, true, 'cleanup must follow run settlement');
    return request(method, ...args);
  };
  try {
    await assert.rejects(runObservation({ api, config: provisionConfig, inventoryPath: join(directory, 'run.json'), campaignPath: join(directory, 'ledger.json'), hourlyUsd: .1, maxHours: .0001, transferReserveUsd: 0, sleep: async () => {},
      run: async ({ signal }) => {
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        await new Promise(resolve => setTimeout(resolve, 30));
        settled = true;
        throw new Error('run terminated');
      }, verify: async () => assert.fail('cancelled run must not verify'),
    }), error => /maximum duration/.test(error.message) && error.runError === 'run terminated');
    assert.equal(settled, true);
    assert.equal((await readPrivateJson(join(directory, 'run.json'))).status, 'deleted');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const failure of [false, true]) {
  test(`pilot always cleans key after agent stop fails (${failure ? 'primary failure' : 'success'})`, async () => {
    const { runPilot } = await import('../benchmark-sets/realworld-api-v4/shared/lib/pilot-workflow.mjs');
    const primary = new Error('primary observation failure');
    const agentError = new Error('agent cleanup failed');
    let keyCleaned = false;
    await assert.rejects(runPilot({ api: { request() {}, list: async () => [{ label: 'mba-m1', ssh_key: 'ssh-ed25519 AAAATEST mba-m1' }] }, config: { runId: 'obs-test123' }, repositoryRoot: '/repo', bootstrapScriptPath: '/script', controllerCidr: '203.0.113.4/32',
      preflight: async () => {},
      selectProfile: async () => ({ type: { transfer: 1 } }),
      createKey: async () => ({ cleanup: async () => { keyCleaned = true; if (failure) throw new Error('key cleanup failed'); } }),
      startAgent: async () => ({ stop: async () => { throw agentError; } }),
      observe: async () => { if (failure) throw primary; return {}; },
    }), error => failure ? error === primary && error.agentCleanupError === 'agent cleanup failed' && error.keyCleanupError === 'key cleanup failed' : error === agentError);
    assert.equal(keyCleaned, true);
  });
}

test('API list passes cancellation to every attachment page and rejects malformed envelopes', async () => {
  const { LinodeApi } = await load();
  const controller = new AbortController();
  const path = '/v4/linode/instances/15/interfaces/1030/firewalls';
  let pages = 0;
  const api = new LinodeApi({ token: 'synthetic-token', fetchImpl: async (url, options) => {
    assert.match(url, /interfaces\/1030\/firewalls\?page=/);
    assert.equal(options.signal.aborted, false);
    if (++pages === 2) { controller.abort(); assert.equal(options.signal.aborted, true); }
    return new Response(JSON.stringify({ data: [{ id: pages }], pages: 2, page: pages, results: 2 }));
  } });
  assert.deepEqual(await api.list(path, controller.signal), [{ id: 1 }, { id: 2 }]);
  const malformed = new LinodeApi({ token: 'synthetic-token', fetchImpl: async () => new Response(JSON.stringify({ interfaces: [] })) });
  await assert.rejects(malformed.list(path), /paginated response/);
});


test('malformed attachment envelopes fail readiness and still delete owned resources', async () => {
  const { provisionPair } = await load();
  const { api, resources } = fakeApi({ changeAttachmentEnvelope: () => ({ interfaces: [] }) });
  let latest;
  await assert.rejects(provisionPair({ api, config: provisionConfig, save: async value => { latest = structuredClone(value); }, sleep: async () => {} }), /paginated response/);
  assert.equal(latest.status, 'deleted');
  assert.equal(resources.size, 0);
});

test('network readiness requests carry the provisioning signal', async () => {
  const { provisionPair } = await load();
  const controller = new AbortController();
  const { api, calls } = fakeApi();
  await provisionPair({ api, config: provisionConfig, signal: controller.signal });
  const readiness = calls.filter(([method, path]) => method === 'GET' && path.includes('/interfaces'));
  assert.equal(readiness.length, 6);
  assert.ok(readiness.every(call => call[3] === controller.signal));
});


test('observation resource cleanup follows real process-tree cancellation and pipe closure', async () => {
  const { runObservation } = await load();
  const { runCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/command.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'v4-observation-tree-'));
  const stoppedFile = join(directory, 'stopped');
  const { api, calls } = fakeApi();
  const request = api.request;
  let settled = false;
  let naturalExpiry = false;
  api.request = async (method, ...args) => {
    if (method === 'DELETE') {
      assert.equal(settled, true, 'cleanup must follow work settlement');
      assert.equal(await readFile(stoppedFile, 'utf8'), 'TERM', 'descendant must receive cancellation before cloud cleanup');
    }
    return request(method, ...args);
  };
  const descendant = `const fs = require('node:fs');
    process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(stoppedFile)}, 'TERM'); process.exit(0); });
    setTimeout(() => { fs.writeFileSync(${JSON.stringify(stoppedFile)}, 'natural'); process.exit(0); }, 1500);`;
  const script = `const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();
    setInterval(() => {}, 1000);`;
  try {
    await assert.rejects(runObservation({ api, config: provisionConfig, inventoryPath: join(directory, 'run.json'), campaignPath: join(directory, 'ledger.json'), hourlyUsd: .1, maxHours: .0002, transferReserveUsd: 0, sleep: async () => {},
      run: async ({ signal }) => {
        try { await runCommand(process.execPath, ['-e', script], { signal }); }
        finally { settled = true; naturalExpiry = (await readFile(stoppedFile, 'utf8')) === 'natural'; }
      }, verify: async () => assert.fail('cancelled tree must not verify'),
    }), /maximum duration/);
    assert.equal(naturalExpiry, false);
    assert.equal(calls.filter(([method]) => method === 'DELETE').length, 5);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('root observation deadline terminates nested local-timeout pipe holders before resource cleanup', async () => {
  const { runObservation } = await load();
  const { runCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/command.mjs');
  const commandModule = new URL('../benchmark-sets/realworld-api-v4/shared/lib/command.mjs', import.meta.url).href;
  const directory = await mkdtemp(join(tmpdir(), 'v4-nested-deadline-'));
  const pidFile = join(directory, 'grandchild');
  const localTermFile = join(directory, 'local-term');
  const heartbeat = join(directory, 'ancestor-alive');
  let pid; let settled = false;
  const { api, calls } = fakeApi();
  const request = api.request;
  const running = value => { const state = spawnSync('ps', ['-o', 'stat=', '-p', String(value)], { encoding: 'utf8' }); return state.status === 0 && !/^Z/.test(state.stdout.trim()); };
  api.request = async (method, ...args) => {
    if (method === 'DELETE') {
      assert.equal(settled, true);
      assert.equal(running(pid), false, 'grandchild must terminate before cloud cleanup');
    }
    return request(method, ...args);
  };
  const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 4000);`;
  const child = `const fs = require('node:fs');
    process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(localTermFile)}, 'local'); process.exit(0); });
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();
    setInterval(() => {}, 1000);`;
  const outer = `import { runCommand } from ${JSON.stringify(commandModule)};
    import { writeFileSync } from 'node:fs';
    setTimeout(() => writeFileSync(${JSON.stringify(heartbeat)}, 'alive'), 1000);
    await runCommand(process.execPath, ['-e', ${JSON.stringify(child)}], { timeoutMs: 500, env: {} });`;
  try {
    await assert.rejects(runObservation({ api, config: provisionConfig, inventoryPath: join(directory, 'run.json'), campaignPath: join(directory, 'ledger.json'), hourlyUsd: .1, maxHours: .0006, transferReserveUsd: 0, sleep: async () => {},
      run: async ({ signal }) => {
        try { await runCommand(process.execPath, ['--input-type=module', '-e', outer], { timeoutMs: 10_000, signal }); }
        finally { pid = Number(await readFile(pidFile, 'utf8')); settled = true; }
      }, verify: async () => assert.fail('cancelled tree must not verify'),
    }), /maximum duration/);
    assert.equal(await readFile(localTermFile, 'utf8'), 'local', 'nested local timeout must target its child');
    assert.equal(await readFile(heartbeat, 'utf8'), 'alive', 'nested local timeout must not kill the ancestor group');
    assert.equal(calls.filter(([method]) => method === 'DELETE').length, 5);
    assert.equal(running(pid), false);
  } finally { if (pid && running(pid)) process.kill(pid, 'SIGKILL'); await rm(directory, { recursive: true, force: true }); }
});


test('pilot preserves primary and all cleanup failures while attempting private SSH state cleanup', async () => {
  const { runPilot } = await import('../benchmark-sets/realworld-api-v4/shared/lib/pilot-workflow.mjs');
  const { createSshConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs');
  const state = await createSshConfig();
  const primary = new Error('observation failed');
  let cleaned = false;
  try {
    await assert.rejects(runPilot({ api: { request() {}, list: async () => [{ label: 'mba-m1', ssh_key: 'ssh-ed25519 AAAATEST mba-m1' }] }, config: { runId: 'obs-test123' }, repositoryRoot: '/repo', bootstrapScriptPath: '/script', controllerCidr: '203.0.113.4/32',
      preflight: async () => {},
      selectProfile: async () => ({ type: { transfer: 1 } }),
      createKey: async () => ({ cleanup: async () => { throw new Error('key cleanup failed'); } }),
      createSshConfig: async () => ({ ...state, cleanup: async () => { cleaned = true; await state.cleanup(); throw new Error('SSH state cleanup failed'); } }),
      startAgent: async () => ({ stop: async () => { throw new Error('agent cleanup failed'); } }),
      observe: async () => { throw primary; },
    }), error => error === primary && error.agentCleanupError === 'agent cleanup failed' && error.keyCleanupError === 'key cleanup failed' && error.sshConfigCleanupError === 'SSH state cleanup failed');
    assert.equal(cleaned, true);
    await assert.rejects(stat(state.configPath), { code: 'ENOENT' });
  } finally { await state.cleanup(); }
});
