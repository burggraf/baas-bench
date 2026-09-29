import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const load = () => import('../benchmark-sets/realworld-api-v4/shared/lib/linode-controller.mjs');

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

test('hardware selection uses dedicated 8 GiB plans and the cheaper preferred region', async () => {
  const { selectHardwareProfile, estimatePairCost } = await load();
  const regions = [
    { id: 'us-west', status: 'ok', capabilities: ['Linodes', 'Linode Interfaces'] },
    { id: 'us-lax', status: 'ok', capabilities: ['Linodes', 'Linode Interfaces'] },
    { id: 'us-east', status: 'ok', capabilities: ['Linodes'] },
  ];
  const types = [
    { id: 'g6-standard-4', class: 'standard', memory: 8192, price: { hourly: 0.08 } },
    { id: 'g6-dedicated-4', class: 'dedicated', memory: 8192, price: { hourly: 0.12 }, region_prices: [{ id: 'us-west', hourly: 0.12 }, { id: 'us-lax', hourly: 0.1 }] },
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
    async request(method, path, body) {
      calls.push([method, path, body]);
      if (method === 'POST' && path === '/v4/vpcs') {
        const item = { id: ++nextId, label: body.label, description: body.description, subnets: [{ id: ++nextId, ...body.subnets[0] }] };
        resources.set(pathFor('vpc', item.id), item); return item;
      }
      if (method === 'POST' && path === '/v4/networking/firewalls') {
        const item = { id: ++nextId, label: body.label }; resources.set(pathFor('firewall', item.id), item); return item;
      }
      if (method === 'POST' && path === '/v4/linode/instances') {
        if (settings.failRunner && body.label.endsWith('-runner')) {
          const item = { id: ++nextId, label: body.label, tags: body.tags, status: 'running' };
          resources.set(pathFor('linode', item.id), item);
          throw new Error('simulated create timeout');
        }
        const item = { id: ++nextId, label: body.label, tags: body.tags, status: 'running' };
        resources.set(pathFor('linode', item.id), item); return item;
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
    async list(path) {
      calls.push(['LIST', path]);
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
  const saved = [];
  const save = async inventory => { saved.push(structuredClone(inventory)); };
  try {
    const inventory = await provisionPair({ api, config: provisionConfig, inventoryPath: path, save });
    assert.equal(inventory.status, 'ready');
    assert.equal(inventory.resources.backend.id, 15);
    assert.equal(inventory.resources.runner.id, 16);
    assert.ok(saved.some(item => item.pending?.kind === 'vpc'));
    assert.ok(saved.some(item => item.pending?.kind === 'backend'));
    assert.equal(JSON.stringify(inventory).includes('AAAATEST'), false);
    assert.equal(calls.filter(([method]) => method === 'POST').length, 5);
    const firewalls = calls.filter(([method, path]) => method === 'POST' && path === '/v4/networking/firewalls').map(([, , body]) => body);
    assert.equal(firewalls.length, 2);
    assert.deepEqual(firewalls.find(body => body.label.endsWith('publicFirewall')).rules.inbound[0].addresses.ipv4, ['203.0.113.4/32']);
    assert.deepEqual(firewalls.find(body => body.label.endsWith('vpcFirewall')).rules.inbound[0].addresses.ipv4, ['10.203.0.11/32']);
    const backendCreate = calls.find(([method, path, body]) => method === 'POST' && path === '/v4/linode/instances' && body.label.endsWith('-backend'))[2];
    assert.deepEqual(backendCreate.interfaces.map(iface => iface.default_route.ipv4), [true, false]);
    assert.equal(backendCreate.interfaces[1].vpc.ipv4.addresses[0].address, '10.203.0.10');
    assert.equal(inventory.resources.runner.privateIpv4, '10.203.0.11');
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
      run: async ({ signal }) => { events.push('run'); assert.equal(signal.aborted, false); now = 3_600_000; return { result: 'evidence' }; },
      verify: async value => { events.push('verify'); assert.equal(value.result, 'evidence'); },
      notify: async message => { events.push(`notify:${message.status}:${message.cleanup}`); throw new Error('ntfy offline'); },
    });
    assert.deepEqual(events, ['run', 'verify', 'notify:success:complete']);
    assert.equal(outcome.actualUsd, 1.2);
    assert.equal(outcome.inventory.status, 'deleted');
    assert.equal((await readPrivateJson(campaignPath)).spentUsd, 1.2);
    assert.deepEqual(calls.filter(([method]) => method === 'DELETE').length, 5);
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
