import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fixture,
  fixtureIndex,
  writeRecord,
} from '../benchmark-sets/basic-js-v1/shared/lib/fixtures.mjs';
import {
  percentile,
  runStage,
} from '../benchmark-sets/basic-js-v1/shared/lib/runner.mjs';
import { summarize } from '../benchmark-sets/basic-js-v1/shared/lib/summary.mjs';
import { runAdmin } from '../benchmark-sets/basic-js-v1/shared/lib/admin.mjs';
import { runFromArguments } from '../benchmark-sets/basic-js-v1/shared/lib/run.mjs';
import { createSupabaseAdapter } from '../benchmark-sets/basic-js-v1/shared/lib/adapters/supabase.mjs';
import { createSupabaseAdmin } from '../benchmark-sets/basic-js-v1/shared/lib/admin/supabase.mjs';
import { createNhostAdapter } from '../benchmark-sets/basic-js-v1/shared/lib/adapters/nhost.mjs';
import { createConvexAdapter } from '../benchmark-sets/basic-js-v1/shared/lib/adapters/convex.mjs';
import { deployArgs as convexDeployArgs, inspectionExportPath } from '../benchmark-sets/basic-js-v1/shared/lib/admin/convex.mjs';
import { createAppwriteAdapter } from '../benchmark-sets/basic-js-v1/shared/lib/adapters/appwrite.mjs';
import { createAppwriteAdmin } from '../benchmark-sets/basic-js-v1/shared/lib/admin/appwrite.mjs';
import { createDirectusAdapter } from '../benchmark-sets/basic-js-v1/shared/lib/adapters/directus.mjs';
import { createDirectusAdmin } from '../benchmark-sets/basic-js-v1/shared/lib/admin/directus.mjs';
import { createTrailBaseAdapter } from '../benchmark-sets/basic-js-v1/shared/lib/adapters/trailbase.mjs';
import { createTrailBaseAdmin } from '../benchmark-sets/basic-js-v1/shared/lib/admin/trailbase.mjs';

const setRoot = new URL('../benchmark-sets/basic-js-v1/', import.meta.url);
const benchmarkIds = [
  'read-list-throughput',
  'read-item-throughput',
  'write-throughput',
];
const loads = [1, 10, 100, 1000];
const metricNames = loads.flatMap((load) => [
  `operations_per_second_vu_${load}`,
  `latency_p50_ms_vu_${load}`,
  `latency_p95_ms_vu_${load}`,
  `latency_p99_ms_vu_${load}`,
  `attempted_operations_vu_${load}`,
  `completed_operations_vu_${load}`,
  `failed_operations_vu_${load}`,
  `error_rate_vu_${load}`,
]);

function read(relativePath) {
  return readFileSync(new URL(relativePath, setRoot), 'utf8');
}

function parseConf(contents) {
  return Object.fromEntries(contents.trim().split('\n').map((line) => line.split('=', 2)));
}

test('set metadata is exact', () => {
  assert.deepEqual(parseConf(read('set.conf')), {
    schema_version: '1',
    id: 'basic-js-v1',
    title: 'Basic JavaScript API throughput',
    description: 'Unauthenticated guestbook list-read, item-read, and write throughput through mainstream JavaScript SDKs',
  });
});

test('benchmark definitions require the complete load metric contract', () => {
  for (const id of benchmarkIds) {
    const config = parseConf(read(`benchmarks/${id}/benchmark.conf`));
    assert.equal(config.id, id);
    assert.equal(config.primary_metric, 'operations_per_second_vu_100');
    assert.equal(config.primary_unit, 'ops/s');
    assert.equal(config.primary_direction, 'higher');
    assert.equal(config.warmup_trials, '1');
    assert.equal(config.measured_trials, '3');
    assert.deepEqual(config.required_metrics.split(','), metricNames);
  }
});

test('set and methodologies disclose the shared benchmark policy', () => {
  const documents = [
    read('README.md'),
    ...benchmarkIds.map((id) => read(`benchmarks/${id}/METHODOLOGY.md`)),
  ];
  for (const document of documents) {
    const normalized = document.toLowerCase();
    assert.match(normalized, /unauthenticated/);
    assert.match(normalized, /neon/);
    assert.match(normalized, /one client per virtual user/);
    assert.match(document, /1, 10, 100, and 1,000/);
    assert.match(normalized, /5-second/);
    assert.match(normalized, /15-second/);
  }

  const headings = [
    'Objective and non-goals',
    'Correctness and response equivalence',
    'Measured system boundary',
    'Dataset, distribution, seed, and indexes',
    'Authentication and authorization',
    'Cache and warm-up policy',
    'Workload, concurrency, duration, and pacing',
    'Connections, pooling, retries, timeouts, and errors',
    'Host and container environment',
    'Trial order, cooldown, acceptance, and invalidation',
    'Metrics and units',
    'Permitted deviations and tuning',
    'Limitations',
  ];
  for (const id of benchmarkIds) {
    const methodology = read(`benchmarks/${id}/METHODOLOGY.md`);
    const normalized = methodology.toLowerCase();
    for (const heading of headings) assert.match(methodology, new RegExp(`^## ${heading}$`, 'm'));
    for (const term of ['10,000', 'readiness', 'reset', 'index', 'retry', 'batch', 'application cache', 'nearest-rank', 'invalidat', 'appwrite', 'directus', 'pocketbase']) {
      assert.ok(normalized.includes(term), `${id} must disclose ${term}`);
    }
  }
});

test('workload dependencies and Node version are pinned', () => {
  const expected = {
    '@directus/sdk': '25.0.1',
    '@nhost/nhost-js': '4.8.0',
    '@supabase/supabase-js': '2.115.0',
    appwrite: '26.2.0',
    convex: '1.45.0',
    'node-appwrite': '28.0.0',
    pocketbase: '0.28.0',
    trailbase: '0.14.1',
  };
  const packageJson = JSON.parse(read('shared/package.json'));
  const packageLock = JSON.parse(read('shared/package-lock.json'));
  assert.deepEqual(packageJson.engines, { node: '>=22' });
  assert.deepEqual(packageJson.dependencies, expected);
  assert.deepEqual(packageLock.packages[''].dependencies, expected);
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(packageLock.packages[`node_modules/${name}`].version, version);
  }
});

test('dispatch rejects invalid input before loading platform modules', async () => {
  let loads = 0;
  const loadModule = async () => {
    loads += 1;
    return {};
  };
  const invalidAdminArguments = [
    ['unknown', 'supabase', 'list', 'setup', '0', '/tmp/output'],
    ['setup', 'unknown', 'list', 'setup', '0', '/tmp/output'],
    ['setup', 'supabase', 'unknown', 'setup', '0', '/tmp/output'],
    ['setup', 'supabase', 'list', 'unknown', '0', '/tmp/output'],
    ['setup', 'supabase', 'list', 'setup', 'x', '/tmp/output'],
    ['setup', 'supabase', 'list', 'setup', '0', 'relative'],
  ];
  for (const args of invalidAdminArguments) {
    await assert.rejects(runAdmin(args, { loadModule }), /invalid|absolute/);
  }

  const invalidRunArguments = [
    ['unknown', 'list', 'measure', '1', '/tmp/output'],
    ['supabase', 'unknown', 'measure', '1', '/tmp/output'],
    ['supabase', 'list', 'unknown', '1', '/tmp/output'],
    ['supabase', 'list', 'measure', 'x', '/tmp/output'],
    ['supabase', 'list', 'measure', '1', 'relative'],
  ];
  for (const args of invalidRunArguments) {
    await assert.rejects(runFromArguments(args, { loadAdmin: loadModule, loadAdapter: loadModule }), /invalid|absolute/);
  }
  assert.equal(loads, 0);
});

test('measured run resets, checks, records, and summarizes every load', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'basic-js-measure-'));
  const events = [];
  const admin = {
    async reset({ load }) { events.push(`reset:${load}`); },
    async verifyReadiness({ load }) { events.push(`ready:${load}`); },
    async cleanupReadiness({ load }) { events.push(`cleanup:${load}`); },
    async verifyStage({ load }) { events.push(`verify:${load}`); },
  };
  const adapter = {
    async createClient({ vu, load }) {
      events.push(`client:${load}:${vu}`);
      return { vu };
    },
    async operation(_client, { load, readiness }) {
      events.push(`operation:${load}:${readiness === true ? 'ready' : 'timed'}`);
      return { id: 'created-id' };
    },
    validate(result) { return result.id === 'created-id'; },
  };
  const runStageFn = async ({ concurrency, durationMs }) => {
    events.push(`stage:${concurrency}:${durationMs}`);
    return {
      concurrency,
      duration_ms: 1000,
      attempted: 10,
      completed: 10,
      failed: 0,
      latencies_ms: [1],
      error_kinds: {},
      error_samples: [],
    };
  };

  try {
    await runFromArguments(['supabase', 'write', 'measure', '2', outputDir], {
      loadAdmin: async () => admin,
      loadAdapter: async () => adapter,
      runStage: runStageFn,
    });
    for (const load of [1, 10, 100, 1000]) {
      const prefix = [
        `reset:${load}`,
        `client:${load}:0`,
        `operation:${load}:ready`,
        `ready:${load}`,
        `cleanup:${load}`,
        `stage:${load}:15000`,
        `verify:${load}`,
      ];
      assert.deepEqual(events.splice(0, prefix.length), prefix);
      assert.ok(existsSync(join(outputDir, 'raw', `vu-${load}.json`)));
    }
    assert.ok(existsSync(join(outputDir, 'summary.json')));
    assert.equal(JSON.parse(readFileSync(join(outputDir, 'summary.json'))).completed_operations, 40);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('warm-up run writes raw stages without a summary', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'basic-js-warmup-'));
  const admin = {
    async reset() {},
    async verifyReadiness() {},
    async cleanupReadiness() { assert.fail('read readiness must not be cleaned up'); },
    async verifyStage() {},
  };
  const adapter = {
    async createClient() { return {}; },
    async operation() { return { ok: true }; },
    validate(result) { return result.ok; },
  };
  try {
    await runFromArguments(['supabase', 'list', 'warmup', '1', outputDir], {
      loadAdmin: async () => admin,
      loadAdapter: async () => adapter,
      runStage: async ({ concurrency, durationMs }) => ({
        concurrency,
        duration_ms: durationMs,
        attempted: 1,
        completed: 1,
        failed: 0,
        latencies_ms: [1],
        error_kinds: {},
        error_samples: [],
      }),
    });
    assert.ok(existsSync(join(outputDir, 'raw', 'vu-1000.json')));
    assert.equal(existsSync(join(outputDir, 'summary.json')), false);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('Supabase case hooks delegate to the set-level dispatcher', () => {
  for (const benchmark of benchmarkIds) {
    for (const hook of ['setup', 'verify', 'reset', 'run', 'teardown']) {
      const contents = read(`benchmarks/${benchmark}/cases/supabase/javascript-sdk/${hook}.sh`);
      assert.match(contents, new RegExp(`shared/case\\.sh" ${hook} supabase `));
      assert.match(contents, /\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/shared\/case\.sh/);
    }
  }
});

test('Supabase adapter uses the expected fluent SDK operations', async () => {
  const calls = [];
  const responses = [
    { data: Array.from({ length: 20 }, (_, index) => ({ id: `id-${index}`, author: 'user-0001', message: 'message', created_at: '2025-01-01T00:00:01.000Z' })), error: null },
    { data: { id: 'id-2', author: 'user-0002', message: 'Guestbook message 00002 from basic-js-v1', created_at: '2025-01-01T00:00:02+00:00' }, error: null },
    { data: { id: 'new-id' }, error: null },
  ];
  const client = {
    from(table) {
      calls.push(['from', table]);
      const response = responses.shift();
      return {
        select(fields) { calls.push(['select', fields]); return this; },
        order(field, options) { calls.push(['order', field, options]); return this; },
        limit(limit) { calls.push(['limit', limit]); return this; },
        eq(field, value) { calls.push(['eq', field, value]); return this; },
        single() { calls.push(['single']); return this; },
        insert(value) { calls.push(['insert', value]); return this; },
        then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
      };
    },
  };
  const sdkCalls = [];
  const adapter = createSupabaseAdapter({
    sdkCreateClient(url, key, options) { sdkCalls.push({ url, key, options }); return client; },
    url: 'http://127.0.0.1:8000',
    key: 'public-key',
    ids: ['id-1', 'id-2'],
    selectFixtureIndex: () => 1,
  });
  const sdkClient = await adapter.createClient({ vu: 1 });
  assert.equal(sdkClient, client);
  assert.equal(sdkCalls.length, 1);
  assert.deepEqual(sdkCalls[0].options.auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });

  const list = await adapter.operation(client, { operation: 'list' });
  assert.equal(list.length, 20);
  const item = await adapter.operation(client, { operation: 'item', trial: 1, vu: 1, sequence: 0 });
  assert.equal(item.id, 'id-2');
  const created = await adapter.operation(client, { operation: 'write', trial: 2, load: 10, vu: 3, sequence: 4 });
  assert.deepEqual(created, { id: 'new-id' });
  assert.deepEqual(calls, [
    ['from', 'bb_basic_js_v1_guestbook'],
    ['select', 'id,author,message,created_at'],
    ['order', 'created_at', { ascending: false }],
    ['limit', 20],
    ['from', 'bb_basic_js_v1_guestbook'],
    ['select', 'id,author,message,created_at'],
    ['eq', 'id', 'id-2'],
    ['single'],
    ['from', 'bb_basic_js_v1_guestbook'],
    ['insert', { author: 'bench-vu-3', message: 'basic-js-v1 trial-2 load-10 vu-3 operation-4' }],
    ['select', 'id'],
    ['single'],
  ]);
  assert.equal(adapter.validate(list, { operation: 'list' }), true);
  assert.equal(adapter.validate(item, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), true);
  assert.equal(adapter.validate(created, { operation: 'write' }), true);
});

test('Supabase adapter rejects SDK errors', async () => {
  const adapter = createSupabaseAdapter({
    sdkCreateClient: () => ({
      from: () => ({
        select() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: null, error: { message: 'denied' } }); },
      }),
    }),
    url: 'http://127.0.0.1:8000',
    key: 'public-key',
    ids: [],
  });
  const client = await adapter.createClient({ vu: 1 });
  await assert.rejects(adapter.operation(client, { operation: 'list' }), /denied/);
});

test('Supabase administration uses compose psql and preserves setup failure', async () => {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, input: options.input });
    if (calls.length === 1) throw new Error('setup failed');
    throw new Error('cleanup failed');
  };
  const admin = createSupabaseAdmin({ run, root: '/repo', runtime: '/runtime' });
  await assert.rejects(
    admin.setup({ operation: 'list' }),
    (error) => error.message === 'setup failed' && error.cleanupError === 'cleanup failed',
  );
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.command, '/repo/bin/baas');
    assert.deepEqual(call.args.slice(0, 6), ['compose', 'supabase', 'exec', '-T', 'db', 'psql']);
    assert.equal(call.args.join(' ').includes('password'), false);
  }

  const lifecycleCalls = [];
  const lifecycle = createSupabaseAdmin({
    run: async (command, args, options) => {
      lifecycleCalls.push({ command, args, input: options.input });
      const stdout = options.input.includes("'count', count(*)") ? '{"count":10000,"min":1,"max":10000,"bad":0}' : '';
      return { stdout };
    },
    root: '/repo',
    runtime: '/runtime',
  });
  await lifecycle.reset({ operation: 'write' });
  await lifecycle.verifyReadiness({
    operation: 'list',
    result: Array.from({ length: 20 }, (_, offset) => ({
      ...fixture(10_000 - offset),
      id: `id-${offset}`,
      created_at: fixture(10_000 - offset).created_at.replace('.000Z', '+00:00'),
    })),
  });
  await lifecycle.teardown({ operation: 'write' });
  assert.match(lifecycleCalls[0].input, /fixture_key IS NULL/);
  assert.match(lifecycleCalls[2].input, /DROP TABLE/);
});

test('Nhost adapter sends exact GraphQL operations and validates responses', async () => {
  const requests = [];
  const responses = [
    { body: { data: { bb_basic_js_v1_guestbook: Array.from({ length: 20 }, (_, index) => ({ id: `id-${index}`, author: 'a', message: 'm', created_at: '2025-01-01T00:00:01+00:00' })) } } },
    { body: { data: { bb_basic_js_v1_guestbook_by_pk: { id: 'id-2', author: 'user-0002', message: 'Guestbook message 00002 from basic-js-v1', created_at: '2025-01-01T00:00:02+00:00' } } } },
    { body: { data: { insert_bb_basic_js_v1_guestbook_one: { id: 'new-id' } } } },
  ];
  const client = { graphql: { async request(request) { requests.push(request); return responses.shift(); } } };
  const options = [];
  const adapter = createNhostAdapter({
    sdkCreateClient(value) { options.push(value); return client; },
    ids: ['id-1', 'id-2'],
    selectFixtureIndex: () => 1,
  });
  assert.equal(await adapter.createClient({ vu: 1 }), client);
  assert.deepEqual(options[0], {
    authUrl: 'http://local.auth.local.nhost.run/v1',
    graphqlUrl: 'http://local.graphql.local.nhost.run/v1/graphql',
    storageUrl: 'http://local.storage.local.nhost.run/v1',
    functionsUrl: 'http://local.functions.local.nhost.run/v1',
  });
  const list = await adapter.operation(client, { operation: 'list' });
  const itemContext = { operation: 'item', trial: 1, vu: 1, sequence: 0 };
  const item = await adapter.operation(client, itemContext);
  const writeContext = { operation: 'write', trial: 2, load: 10, vu: 3, sequence: 4 };
  const created = await adapter.operation(client, writeContext);
  assert.deepEqual(requests.map((request) => request.variables), [undefined, { id: 'id-2' }, { object: { author: 'bench-vu-3', message: 'basic-js-v1 trial-2 load-10 vu-3 operation-4' } }]);
  assert.match(requests[0].query, /order_by: \{ created_at: desc \}, limit: 20/);
  assert.doesNotMatch(requests[0].query, /fixture_key/);
  assert.match(requests[1].query, /bb_basic_js_v1_guestbook_by_pk\(id: \$id\)/);
  assert.match(requests[2].query, /insert_bb_basic_js_v1_guestbook_one\(object: \$object\)/);
  assert.equal(adapter.validate(list, { operation: 'list' }), true);
  assert.equal(adapter.validate(item, itemContext), true);
  assert.equal(adapter.validate(created, writeContext), true);
});

test('Nhost adapter rejects GraphQL errors and invalid shapes', async () => {
  const adapter = createNhostAdapter({ sdkCreateClient: () => ({}), ids: [] });
  const errorClient = { graphql: { request: async () => ({ body: { errors: [{ message: 'denied' }] } }) } };
  await assert.rejects(adapter.operation(errorClient, { operation: 'list' }), /denied/);
  assert.equal(adapter.validate(null, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), false);
  assert.equal(adapter.validate([{ id: 'only-one' }], { operation: 'list' }), false);
  assert.equal(adapter.validate({ id: '' }, { operation: 'write' }), false);
});

test('Convex functions implement the shared public contract', () => {
  const schema = read('shared/convex/schema.ts');
  const functions = read('shared/convex/guestbook.ts');
  assert.match(schema, /index\("by_created_at", \["created_at"\]\)/);
  assert.match(schema, /index\("by_fixture_key", \["fixture_key"\]\)/);
  assert.match(functions, /order\("desc"\)\.take\(20\)/);
  assert.match(functions, /ctx\.db\.get\(id\)/);
  assert.match(functions, /author\.length < 1 \|\| author\.length > 32/);
  assert.match(functions, /message\.length < 1 \|\| message\.length > 256/);
  assert.match(functions, /created_at: Date\.now\(\), fixture_key: null/);
});

test('Convex CLI arguments match pinned deployment behavior', () => {
  assert.deepEqual(convexDeployArgs, ['deploy', '--typecheck', 'disable']);
  assert.equal(inspectionExportPath('/tmp/inspect'), '/tmp/inspect.zip');
});

test('Convex adapter uses public generated references without queue overrides', async () => {
  const calls = [];
  class FakeClient {
    constructor(url) { calls.push(['client', url]); }
    async query(reference, args) {
      calls.push(['query', reference, args]);
      if (reference === 'list-ref') return Array.from({ length: 20 }, (_, index) => ({ id: `id-${index}`, author: 'a', message: 'm', created_at: '2025-01-01T00:00:01.000Z' }));
      return { id: 'id-2', author: 'user-0002', message: 'Guestbook message 00002 from basic-js-v1', created_at: '2025-01-01T00:00:02.000Z' };
    }
    async mutation(reference, args) { calls.push(['mutation', reference, args]); return 'new-id'; }
  }
  const adapter = createConvexAdapter({
    ConvexHttpClient: FakeClient,
    api: { guestbook: { list: 'list-ref', get: 'get-ref', create: 'create-ref' } },
    ids: ['id-1', 'id-2'],
    selectFixtureIndex: () => 1,
  });
  const first = await adapter.createClient({ vu: 1 });
  const second = await adapter.createClient({ vu: 2 });
  assert.notEqual(first, second);
  const list = await adapter.operation(first, { operation: 'list' });
  const itemContext = { operation: 'item', trial: 1, vu: 1, sequence: 0 };
  const item = await adapter.operation(first, itemContext);
  const writeContext = { operation: 'write', trial: 2, load: 10, vu: 3, sequence: 4 };
  const created = await adapter.operation(second, writeContext);
  assert.equal(adapter.validate(list, { operation: 'list' }), true);
  assert.equal(adapter.validate(item, itemContext), true);
  assert.equal(adapter.validate(created, writeContext), true);
  assert.deepEqual(calls, [
    ['client', 'http://127.0.0.1:3210'],
    ['client', 'http://127.0.0.1:3210'],
    ['query', 'list-ref', {}],
    ['query', 'get-ref', { id: 'id-2' }],
    ['mutation', 'create-ref', { author: 'bench-vu-3', message: 'basic-js-v1 trial-2 load-10 vu-3 operation-4' }],
  ]);
});

test('Appwrite adapter uses TablesDB row APIs and client-timed IDs', async () => {
  const calls = [];
  let uniqueCalls = 0;
  class Client {
    setEndpoint(value) { calls.push(['endpoint', value]); return this; }
    setProject(value) { calls.push(['project', value]); return this; }
  }
  class TablesDB {
    async listRows(args) { calls.push(['listRows', args]); return { rows: Array.from({ length: 20 }, (_, index) => ({ $id: `id-${index}`, $createdAt: '2025-01-01T00:00:01.000Z', author: 'a', message: 'm' })) }; }
    async getRow(args) { calls.push(['getRow', args]); return { $id: args.rowId, $createdAt: '2025-01-01T00:00:02.000Z', author: 'user-0002', message: 'Guestbook message 00002 from basic-js-v1' }; }
    async createRow(args) { calls.push(['createRow', args]); return { $id: args.rowId, $createdAt: '2025-01-01T00:00:03.000Z', ...args.data }; }
  }
  const Query = {
    select: (fields) => `select:${fields.join(',')}`,
    orderDesc: (field) => `desc:${field}`,
    limit: (count) => `limit:${count}`,
  };
  const ID = { unique() { uniqueCalls += 1; return 'unique-id'; } };
  const adapter = createAppwriteAdapter({ Client, TablesDB, Query, ID, projectId: 'project', databaseId: 'database', tableId: 'table', ids: ['id-1', 'id-2'], selectFixtureIndex: () => 1 });
  const client = await adapter.createClient({ vu: 1 });
  const list = await adapter.operation(client, { operation: 'list' });
  const itemContext = { operation: 'item', trial: 1, vu: 1, sequence: 0 };
  const item = await adapter.operation(client, itemContext);
  const writeContext = { operation: 'write', trial: 2, load: 10, vu: 3, sequence: 4 };
  const created = await adapter.operation(client, writeContext);
  assert.equal(uniqueCalls, 1);
  assert.deepEqual(calls, [
    ['endpoint', 'http://127.0.0.1:8080/v1'],
    ['project', 'project'],
    ['listRows', { databaseId: 'database', tableId: 'table', queries: ['select:$id,author,message,$createdAt', 'desc:$createdAt', 'desc:$id', 'limit:20'], total: false }],
    ['getRow', { databaseId: 'database', tableId: 'table', rowId: 'id-2', queries: ['select:$id,author,message,$createdAt'] }],
    ['createRow', { databaseId: 'database', tableId: 'table', rowId: 'unique-id', data: { author: 'bench-vu-3', message: 'basic-js-v1 trial-2 load-10 vu-3 operation-4' } }],
  ]);
  assert.equal(adapter.validate(list, { operation: 'list' }), true);
  assert.equal(adapter.validate(item, itemContext), true);
  assert.equal(adapter.validate(created, writeContext), true);
});

test('Appwrite adapter rejects malformed SDK responses', async () => {
  let uniqueCalls = 0;
  const adapter = createAppwriteAdapter({
    Client: class { setEndpoint() { return this; } setProject() { return this; } },
    TablesDB: class {},
    Query: { select: () => 'select' },
    ID: { unique() { uniqueCalls += 1; return `id-${uniqueCalls}`; } },
    projectId: 'project',
    databaseId: 'database',
    tableId: 'table',
    ids: ['fixture-id'],
    selectFixtureIndex: () => 0,
  });
  assert.equal(adapter.validate([{ id: 'only-one' }], { operation: 'list' }), false);
  assert.equal(adapter.validate({ id: 'fixture-id', author: fixture(1).author, message: fixture(1).message, created_at: '' }, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), false);
  assert.equal(adapter.validate({ id: '' }, { operation: 'write' }), false);
  await assert.rejects(adapter.operation({}, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), /tables\.getRow is not a function/);
  await assert.rejects(createAppwriteAdapter({ Client: class {}, TablesDB: class {}, Query: {}, ID: {}, projectId: '', databaseId: '', tableId: '', ids: [], selectFixtureIndex: () => 2 }).operation({}, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), /missing Appwrite fixture ID/);
  assert.equal(uniqueCalls, 0);
});

test('Appwrite administration bootstraps supported Console resources and protects credentials', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'basic-js-appwrite-'));
  const stateDir = join(runtime, 'state');
  mkdirSync(stateDir);
  for (const file of ['appwrite-console.json', 'appwrite-admin.json']) {
    writeFileSync(join(stateDir, file), file.includes('console') ? JSON.stringify({ password: 'Bb-existing-password!' }) : '{}');
    chmodSync(join(stateDir, file), 0o644);
  }
  const consoleCalls = [];
  const sdkCalls = [];
  const rows = [];
  const response = (status, body = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { getSetCookie: () => status === 201 ? ['a_session_console=value; Path=/'] : [] },
    text: async () => JSON.stringify(body),
  });
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname.replace('/v1', '');
    consoleCalls.push([options.method, path, options.body && JSON.parse(options.body)]);
    if (path === '/account' && options.method === 'POST') return response(409, { message: 'exists' });
    if (path === '/account/sessions/email') return response(201, { $id: 'session' });
    if (path.endsWith('/keys') && options.method === 'POST') return response(201, { secret: 'project-secret' });
    if (options.method === 'DELETE') return response(204);
    return response(201, { $id: 'resource' });
  };
  class Client {
    setEndpoint(value) { sdkCalls.push(['endpoint', value]); return this; }
    setProject(value) { sdkCalls.push(['project', value]); return this; }
    setKey(value) { sdkCalls.push(['key', value]); return this; }
  }
  class TablesDB {
    async create(args) { sdkCalls.push(['create', args]); }
    async createTable(args) { sdkCalls.push(['createTable', args]); }
    async createStringColumn(args) { sdkCalls.push(['string', args]); }
    async createIntegerColumn(args) { sdkCalls.push(['integer', args]); }
    async getColumn(args) { return { ...args, status: 'available' }; }
    async createIndex(args) { sdkCalls.push(['index', args]); }
    async getIndex(args) { return { ...args, status: 'available' }; }
    async createRows(args) {
      sdkCalls.push(['rows', args.rows.length]);
      for (const row of args.rows) rows.push({ ...row, $createdAt: fixture(row.fixture_key).created_at });
    }
    async listRows(args) {
      const cursor = args.queries.find((value) => value.startsWith('cursor:'))?.slice(7);
      const selected = rows.filter((row) => !cursor || row.$id > cursor).sort((a, b) => a.$id.localeCompare(b.$id)).slice(0, 1000);
      return { rows: selected };
    }
    async delete() { sdkCalls.push(['delete']); }
  }
  let generated = 0;
  const sdk = {
    Client,
    TablesDB,
    Query: {
      orderAsc: (field) => `asc:${field}`,
      limit: (count) => `limit:${count}`,
      cursorAfter: (id) => `cursor:${id}`,
      isNull: (field) => `null:${field}`,
    },
    ID: { unique: () => `row-${String(++generated).padStart(5, '0')}` },
    Permission: { read: (role) => `read:${role}`, create: (role) => `create:${role}` },
    Role: { any: () => 'any' },
    TablesDBIndexType: { Unique: 'unique' },
    OrderBy: { Asc: 'asc' },
  };
  const admin = createAppwriteAdmin({ sdk, fetchImpl, runtime, sleep: async () => {} });
  try {
    await admin.setup();
    assert.equal(rows.length, 10_000);
    assert.equal(statSync(join(stateDir, 'appwrite-console.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(stateDir, 'appwrite-admin.json')).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(join(stateDir, 'appwrite.json'))), { projectId: 'bb-basic-js-v1-project', databaseId: 'bb-basic-js-v1', tableId: 'guestbook' });
    assert.ok(consoleCalls.some(([method, path]) => method === 'POST' && path === '/account/sessions/email'));
    assert.ok(consoleCalls.some(([method, path]) => method === 'POST' && path === '/projects'));
    const table = sdkCalls.find(([name]) => name === 'createTable')[1];
    assert.equal(table.rowSecurity, false);
    assert.deepEqual(table.permissions, ['read:any', 'create:any']);
    assert.ok(sdkCalls.some(([name, args]) => name === 'index' && args.type === 'unique'));
    const batchSizes = sdkCalls.filter(([name]) => name === 'rows').map(([, size]) => size);
    assert.deepEqual(batchSizes.slice(-20), Array(20).fill(1));
    await admin.teardown();
    assert.equal(existsSync(join(stateDir, 'appwrite-console.json')), false);
    assert.ok(consoleCalls.some(([method, path]) => method === 'DELETE' && path === '/account'));
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('Appwrite case hooks delegate to the set-level dispatcher', () => {
  const operations = { 'read-list-throughput': 'list', 'read-item-throughput': 'item', 'write-throughput': 'write' };
  for (const [benchmark, operation] of Object.entries(operations)) {
    const config = parseConf(read(`benchmarks/${benchmark}/cases/appwrite/javascript-sdk/case.conf`));
    assert.equal(config.client, 'appwrite@26.2.0');
    assert.equal(config.access_path, 'tablesdb');
    for (const hook of ['setup', 'verify', 'reset', 'run', 'teardown']) {
      const contents = read(`benchmarks/${benchmark}/cases/appwrite/javascript-sdk/${hook}.sh`);
      assert.match(contents, new RegExp(`shared/case\\.sh" ${hook} appwrite ${operation}`));
    }
  }
});

test('fixture data is deterministic and bounded', () => {
  assert.deepEqual(fixture(1), {
    fixture_key: 1,
    author: 'user-0001',
    message: 'Guestbook message 00001 from basic-js-v1',
    created_at: '2025-01-01T00:00:01.000Z',
  });
  assert.equal(fixture(9981).created_at, '2025-01-01T02:46:21.000Z');
  assert.equal(fixture(10000).created_at, '2025-01-01T02:46:40.000Z');
  assert.ok(fixture(10000).author.length <= 32);
  assert.ok(fixture(10000).message.length <= 256);
  assert.throws(() => fixture(0), RangeError);
  assert.throws(() => fixture(10001), RangeError);
});

test('item selection is deterministic per trial and virtual user', () => {
  const first = Array.from({ length: 8 }, (_, sequence) => fixtureIndex(2, 7, sequence));
  const repeat = Array.from({ length: 8 }, (_, sequence) => fixtureIndex(2, 7, sequence));
  const otherUser = Array.from({ length: 8 }, (_, sequence) => fixtureIndex(2, 8, sequence));
  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first, otherUser);
  assert.ok(first.every((index) => index >= 0 && index < 10000));
});

test('percentile uses nearest rank and zero for no successful samples', () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2);
  assert.equal(percentile([4, 1, 3, 2], 0.95), 4);
});

test('runStage creates one sequential client per virtual user', async () => {
  const active = new Map();
  let clients = 0;
  let globalActive = 0;
  let maxGlobalActive = 0;

  const result = await runStage({
    concurrency: 3,
    durationMs: 1,
    trial: 1,
    createClient(vu) {
      clients += 1;
      return { vu };
    },
    async operation(client) {
      const count = (active.get(client.vu) ?? 0) + 1;
      active.set(client.vu, count);
      assert.equal(count, 1);
      globalActive += 1;
      maxGlobalActive = Math.max(maxGlobalActive, globalActive);
      await new Promise((resolve) => setTimeout(resolve, 10));
      globalActive -= 1;
      active.set(client.vu, 0);
      return { ok: true };
    },
    validate(value) {
      return value?.ok === true;
    },
  });

  assert.equal(clients, 3);
  assert.equal(result.attempted, 3);
  assert.equal(result.completed, 3);
  assert.equal(result.failed, 0);
  assert.equal(maxGlobalActive, 3);
});

test('runStage counts rejection and invalid responses without retrying them', async () => {
  let calls = 0;
  const result = await runStage({
    concurrency: 2,
    durationMs: 1,
    trial: 1,
    createClient(vu) {
      return { vu };
    },
    async operation(client) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (client.vu === 1) throw new Error('request failed: Authorization Bearer secret-token https://example.test/?token=secret');
      return { ok: false };
    },
    validate(value) {
      return value?.ok === true;
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.attempted, 2);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.error_kinds, { invalid_response: 1, Error: 1 });
  assert.deepEqual(result.error_samples, [{ kind: 'Error', message: 'operation failed' }]);
  assert.equal(result.latencies_ms.length, 0);
});

test('runStage hard guard stops worker bookkeeping after rejection', async () => {
  let validations = 0;
  const stage = runStage({
    concurrency: 1,
    durationMs: 1,
    settleGraceMs: 5,
    trial: 1,
    createClient() { return {}; },
    async operation() {
      return { ok: true };
    },
    async validate() {
      await new Promise((resolve) => setTimeout(resolve, 20));
      validations += 1;
      return true;
    },
  });
  await assert.rejects(stage, /stage did not settle/);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(validations, 1);
  assert.match(read('shared/lib/runner.mjs'), /const valid = await validate[\s\S]*?if \(!acceptingResults\) return;[\s\S]*?if \(!valid\)/);
});

test('summarize emits numeric metrics for every load', () => {
  const stages = [1, 10, 100, 1000].map((concurrency, index) => ({
    concurrency,
    duration_ms: 1000 + index,
    attempted: 10 + index,
    completed: index === 3 ? 0 : 9 + index,
    failed: index === 3 ? 13 : 1,
    latencies_ms: index === 3 ? [] : [1, 2, 3, 4],
  }));
  const summary = summarize(stages);

  assert.equal(summary.schema_version, 1);
  assert.equal(summary.completed_operations, 30);
  assert.equal(summary.failed_operations, 16);
  assert.equal(summary.metrics.operations_per_second_vu_100, 10.978043912175648);
  assert.equal(summary.metrics.latency_p95_ms_vu_1, 4);
  assert.equal(summary.metrics.latency_p99_ms_vu_1000, 0);
  assert.equal(summary.metrics.error_rate_vu_1000, 1);
  assert.equal(Object.keys(summary.metrics).length, 32);
  assert.ok(Object.values(summary.metrics).every(Number.isFinite));
});

test('Directus adapter uses anonymous SDK commands and native integer IDs', async () => {
  const calls = [];
  const authCalls = [];
  const commands = {
    readItems: (name, options) => ({ type: 'list', name, options }),
    readItem: (name, id, options) => ({ type: 'item', name, id, options }),
    createItem: (name, data, options) => ({ type: 'write', name, data, options }),
  };
  const sdk = {
    createDirectus(endpoint) {
      calls.push(['create', endpoint]);
      return { with(plugin) { calls.push(['with', plugin]); return this; }, request: async (command) => {
        calls.push(['request', command]);
        if (command.type === 'list') return [{ id: 7, author: 'user-0001', message: 'Guestbook message 00007 from basic-js-v1', created_at: '2025-01-01T00:00:07.000Z' }];
        if (command.type === 'item') return { id: 42, author: 'user-0001', message: 'Guestbook message 00007 from basic-js-v1', created_at: '2025-01-01T00:00:07.000Z' };
        return { id: 99 };
      }, login() { authCalls.push('login'); } };
    },
    rest: () => 'rest',
  };
  const adapter = createDirectusAdapter({ ...sdk, readItems: commands.readItems, readItem: commands.readItem, createItem: commands.createItem, ids: [42], selectFixtureIndex: () => 0 });
  const client = await adapter.createClient({ vu: 1 });
  assert.deepEqual(calls.slice(0, 2), [['create', 'http://127.0.0.1:8055'], ['with', 'rest']]);
  assert.equal(authCalls.length, 0);
  const list = await adapter.operation(client, { operation: 'list' });
  assert.deepEqual(list[0], { id: 7, author: 'user-0001', message: 'Guestbook message 00007 from basic-js-v1', created_at: '2025-01-01T00:00:07.000Z' });
  const item = await adapter.operation(client, { operation: 'item', trial: 1, vu: 1, sequence: 0 });
  assert.equal(item.id, 42);
  const write = await adapter.operation(client, { operation: 'write', trial: 1, load: 1, vu: 1, sequence: 0 });
  assert.deepEqual(write, { id: 99 });
  assert.equal(calls.find((entry) => entry[0] === 'request' && entry[1].type === 'list')[1].options.limit, 20);
  assert.equal(calls.find((entry) => entry[0] === 'request' && entry[1].type === 'item')[1].id, 42);
  const missingMap = createDirectusAdapter({ ...sdk, readItems: commands.readItems, readItem: commands.readItem, createItem: commands.createItem, ids: [] });
  await assert.rejects(() => missingMap.operation(client, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), /missing Directus fixture ID/);
});

test('Directus adapter rejects missing rows and IDs', async () => {
  const command = (type) => ({ type });
  const client = { request: async ({ type }) => type === 'item' ? null : {} };
  const adapter = createDirectusAdapter({ createDirectus: () => client, rest: () => ({}), readItems: () => command('list'), readItem: () => command('item'), createItem: () => command('write'), ids: [] });
  await assert.rejects(() => adapter.operation(client, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), /missing Directus fixture ID/);
  await assert.rejects(() => adapter.operation(client, { operation: 'write', trial: 1, load: 1, vu: 1, sequence: 0 }), /no ID/);
});

test('Directus admin verifies exact baseline, readiness, stage count, and cleans state', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'basic-js-directus-admin-'));
  mkdirSync(join(runtime, 'state'), { recursive: true });
  writeFileSync(join(runtime, 'state/directus-permissions.json'), '[1,2]\n');
  const baseline = Array.from({ length: 10000 }, (_, i) => ({ ...fixture(i + 1), id: i + 1 }));
  const calls = [];
  const commandCalls = [];
  const sdk = {};
  for (const name of ['readItem', 'readCollections', 'deleteCollection', 'createCollection', 'customEndpoint', 'readItems', 'readFieldsByCollection', 'createPermissions', 'readPermissions', 'createItems', 'deleteItems', 'deletePermission', 'deleteItem']) sdk[name] = (...args) => ({ name, args });
  sdk.rest = () => 'rest';
  sdk.authentication = () => 'auth';
  sdk.createDirectus = () => ({ with() { return this; }, async login() {}, stopRefreshing() { calls.push({ name: 'stopRefreshing' }); }, async request(command) {
    calls.push(command);
    if (command.name === 'customEndpoint' && command.args[0].path === '/access') return [{ policy: 'policy-1' }];
    if (command.name === 'readItems' && command.args[0] === 'bb_basic_js_v1_guestbook') return command.args[1]?.limit === 20 ? baseline.slice(-20).reverse() : baseline;
    if (command.name === 'readFieldsByCollection') return [
      { field: 'created_at', schema: { is_indexed: true } },
      { field: 'fixture_key', schema: { is_unique: true, is_indexed: true } },
    ];
    if (command.name === 'createPermissions') return [{ id: 1 }, { id: 2 }];
    if (command.name === 'readPermissions') return [{ id: 1, action: 'read', fields: ['*'], permissions: null, validation: null, presets: null }, { id: 2, action: 'create', fields: ['*'], permissions: null, validation: null, presets: null }];
    if (command.name === 'readItem') return { id: 10001, fixture_key: null, ...writeRecord({ trial: 1, load: 1, vu: 1, sequence: 0 }), created_at: new Date().toISOString() };
    return [];
  } });
  const admin = createDirectusAdmin({
    sdk,
    runtime,
    root: '/repo',
    password: 'secret',
    run: async (command, args, options) => { commandCalls.push({ command, args, input: options.input }); return { stdout: '' }; },
  });
  await admin.setup();
  const definition = calls.find((command) => command.name === 'createCollection').args[0];
  assert.deepEqual(definition.schema, {});
  assert.deepEqual(definition.fields.map((field) => field.field), ['id', 'author', 'message', 'created_at', 'fixture_key']);
  const permissions = calls.find((command) => command.name === 'createPermissions').args[0];
  assert.deepEqual(permissions.map(({ action, fields, permissions: rule, validation, presets }) => ({ action, fields, permissions: rule, validation, presets })), [
    { action: 'read', fields: ['*'], permissions: null, validation: null, presets: null },
    { action: 'create', fields: ['*'], permissions: null, validation: null, presets: null },
  ]);
  await admin.verifyReadiness({ operation: 'list', result: baseline.slice(-20).reverse().map(({ fixture_key, ...row }) => row) });
  await admin.verifyReadiness({ operation: 'write', trial: 1, load: 1, vu: 1, sequence: 0, result: { id: 10001 } });
  await admin.verifyStage({ operation: 'list', stage: { completed: 0 } });
  assert.ok(calls.some((command) => command.name === 'readFieldsByCollection'));
  assert.ok(calls.some((command) => command.name === 'stopRefreshing'));
  assert.ok(calls.some((command) => command.name === 'customEndpoint' && command.args[0].path === '/access'));
  assert.equal(commandCalls.length, 1);
  assert.equal(commandCalls[0].command, '/repo/bin/baas');
  assert.deepEqual(commandCalls[0].args.slice(0, 6), ['compose', 'directus', 'exec', '-T', 'database', 'psql']);
  assert.equal(commandCalls[0].input.trim().split('\n').length, 10_000);
  rmSync(runtime, { recursive: true, force: true });
});

test('Directus collection lookup scans the unfiltered system list and propagates server errors', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'basic-js-directus-status-'));
  mkdirSync(join(runtime, 'state'), { recursive: true });
  const command = (name) => ({ name });
  const makeSdk = (response) => ({
    readCollections: () => command('readCollections'), deleteCollection: () => command('deleteCollection'),
    deletePermission: () => command('deletePermission'), rest: () => ({}), authentication: () => ({}),
    createDirectus: () => ({ with() { return this; }, async login() {}, stopRefreshing() {}, async request({ name }) {
      if (name === 'readCollections') {
        if (response instanceof Error) throw response;
        return response;
      }
      return [];
    } }),
  });
  writeFileSync(join(runtime, 'state/directus-permissions.json'), '[]\n');
  await createDirectusAdmin({ sdk: makeSdk([]), runtime, password: 'secret' }).teardown();
  writeFileSync(join(runtime, 'state/directus-permissions.json'), '[]\n');
  await createDirectusAdmin({ sdk: makeSdk([{ collection: 'other' }, { collection: 'bb_basic_js_v1_guestbook' }]), runtime, password: 'secret' }).teardown();
  for (const error of [Object.assign(new Error('failure'), { status: 401 }), Object.assign(new Error('failure'), { status: 500 })]) {
    writeFileSync(join(runtime, 'state/directus-permissions.json'), '[]\n');
    await assert.rejects(() => createDirectusAdmin({ sdk: makeSdk(error), runtime, password: 'secret' }).teardown(), (wrapped) => wrapped.status === error.status && wrapped.cause?.status === error.status);
  }
  rmSync(runtime, { recursive: true, force: true });
});

test('PocketBase adapter uses one anonymous SDK client per VU and exact record APIs', async () => {
  const { createPocketBaseAdapter } = await import('../benchmark-sets/basic-js-v1/shared/lib/adapters/pocketbase.mjs');
  const calls = [];
  class PocketBase {
    constructor(endpoint) { calls.push(['client', endpoint]); }
    autoCancellation(value) { calls.push(['autoCancellation', value]); return this; }
    collection(name) {
      assert.equal(name, 'bb_basic_js_v1_guestbook');
      return {
        async getList(page, perPage, options) {
          calls.push(['getList', page, perPage, options]);
          return { items: Array.from({ length: 20 }, (_, index) => ({ id: `id-${index}`, author: 'author', message: 'message', created_at: '2025-01-01T00:00:01.000Z', fixture_key: 1 })) };
        },
        async getOne(id, options) {
          calls.push(['getOne', id, options]);
          return { id, author: 'user-0002', message: 'Guestbook message 00002 from basic-js-v1', created_at: '2025-01-01T00:00:02.000Z', fixture_key: 2 };
        },
        async create(data, options) {
          calls.push(['create', data, options]);
          return { id: 'new-id', created_at: 'ignored' };
        },
      };
    }
  }
  const adapter = createPocketBaseAdapter({ PocketBase, ids: ['id-1', 'id-2'], selectFixtureIndex: () => 1 });
  const first = await adapter.createClient({ vu: 1 });
  const second = await adapter.createClient({ vu: 2 });
  assert.notEqual(first, second);
  const list = await adapter.operation(first, { operation: 'list' });
  const itemContext = { operation: 'item', trial: 1, vu: 1, sequence: 0 };
  const item = await adapter.operation(first, itemContext);
  const writeContext = { operation: 'write', trial: 2, load: 10, vu: 3, sequence: 4 };
  const created = await adapter.operation(second, writeContext);
  assert.deepEqual(list[0], { id: 'id-0', author: 'author', message: 'message', created_at: '2025-01-01T00:00:01.000Z' });
  assert.deepEqual(item, { id: 'id-2', author: 'user-0002', message: 'Guestbook message 00002 from basic-js-v1', created_at: '2025-01-01T00:00:02.000Z' });
  assert.deepEqual(created, { id: 'new-id' });
  assert.equal(adapter.validate(list, { operation: 'list' }), true);
  assert.equal(adapter.validate(item, itemContext), true);
  assert.equal(adapter.validate(created, writeContext), true);
  assert.deepEqual(calls, [
    ['client', 'http://127.0.0.1:8090'],
    ['client', 'http://127.0.0.1:8090'],
    ['getList', 1, 20, { sort: '-created_at', fields: 'id,author,message,created_at', skipTotal: true }],
    ['getOne', 'id-2', { fields: 'id,author,message,created_at' }],
    ['create', { author: 'bench-vu-3', message: 'basic-js-v1 trial-2 load-10 vu-3 operation-4' }, { fields: 'id' }],
  ]);
});

test('PocketBase adapter rejects missing IDs and malformed records', async () => {
  const { createPocketBaseAdapter } = await import('../benchmark-sets/basic-js-v1/shared/lib/adapters/pocketbase.mjs');
  const client = {
    collection() {
      return {
        async getList() { return { items: [] }; },
        async getOne() { return null; },
        async create() { return {}; },
      };
    },
  };
  const adapter = createPocketBaseAdapter({ PocketBase: class {}, ids: [], selectFixtureIndex: () => 0 });
  await assert.rejects(() => adapter.operation(client, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), /missing PocketBase fixture ID/);
  await assert.rejects(() => adapter.operation(client, { operation: 'write', trial: 1, load: 1, vu: 1, sequence: 0 }), /no ID/);
  assert.equal(adapter.validate(await adapter.operation(client, { operation: 'list' }), { operation: 'list' }), false);
});

test('PocketBase admin provisions current fields, chunked SQL, exact state, and safe cleanup', async () => {
  const { createPocketBaseAdmin } = await import('../benchmark-sets/basic-js-v1/shared/lib/admin/pocketbase.mjs');
  const runtime = mkdtempSync(join(tmpdir(), 'basic-js-pocketbase-admin-'));
  const commands = [];
  const sql = [];
  const collectionCalls = [];
  let definition;
  let collectionExists = false;
  const credentials = { email: 'basic-js-v1@localhost.invalid', password: 'not-logged-secret' };
  const baselinePage = (offset) => Array.from({ length: 1000 }, (_, index) => {
    const expected = fixture(offset + index + 1);
    return [String(expected.fixture_key), `id-${expected.fixture_key}`, expected.author, expected.message, expected.created_at];
  });
  class PocketBase {
    constructor(endpoint) {
      assert.equal(endpoint, 'http://127.0.0.1:8090');
      this.collections = {
        getOne: async (name) => {
          collectionCalls.push(['getOne', name]);
          if (!collectionExists) throw Object.assign(new Error('not found'), { status: 404 });
          return definition;
        },
        create: async (value) => {
          definition = value;
          collectionExists = true;
          collectionCalls.push(['create', value]);
          return value;
        },
        delete: async (name) => {
          collectionCalls.push(['deleteCollection', name]);
          collectionExists = false;
        },
      };
      this.sql = {
        run: async (query) => {
          sql.push(query);
          if (/SELECT fixture_key, id, author, message, created_at/.test(query)) {
            const offset = Number(query.match(/OFFSET (\d+)/)?.[1] ?? 0);
            return { rows: baselinePage(offset) };
          }
          if (/SELECT author, message, created_at, fixture_key/.test(query)) {
            const expected = writeRecord({ trial: 1, load: 1, vu: 0, sequence: 0 });
            return { rows: [[expected.author, expected.message, new Date().toISOString(), null]] };
          }
          if (/SELECT count\(\*\),/.test(query)) return { rows: [['10000', '10000', '0']] };
          return { rows: [] };
        },
      };
    }
    collection(name) {
      if (name === '_superusers') return { authWithPassword: async (email, password) => collectionCalls.push(['auth', email, password]) };
      assert.equal(name, 'bb_basic_js_v1_guestbook');
      return { delete: async (id) => collectionCalls.push(['deleteRecord', id]) };
    }
  }
  const run = async (command, args) => {
    commands.push([command, args]);
    return { stdout: '', stderr: '' };
  };
  try {
    const admin = createPocketBaseAdmin({ PocketBase, run, root: '/repo', runtime, credentials });
    await admin.setup();
    assert.deepEqual(commands[0], ['/repo/bin/baas', ['compose', 'pocketbase', 'exec', '-T', 'pocketbase', '/pb/pocketbase', '--dir=/pb/pb_data', 'superuser', 'upsert', credentials.email, credentials.password]]);
    assert.equal(statSync(join(runtime, 'state/pocketbase-superuser.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(runtime, 'state/pocketbase-ids.json')).mode & 0o777, 0o600);
    assert.deepEqual(definition.fields.map((field) => [field.name, field.type]), [
      ['author', 'text'], ['message', 'text'], ['created_at', 'autodate'], ['fixture_key', 'json'],
    ]);
    assert.equal(definition.listRule, '');
    assert.equal(definition.viewRule, '');
    assert.match(definition.createRule, /fixture_key:isset = false/);
    assert.equal(definition.updateRule, null);
    assert.equal(definition.deleteRule, null);
    assert.ok(sql.filter((query) => query.startsWith('INSERT INTO')).length > 1);
    assert.ok(sql.every((query) => Buffer.byteLength(query, 'utf8') < 5000));
    assert.equal(sql.filter((query) => /SELECT fixture_key, id, author, message, created_at/.test(query)).length, 10);
    await admin.verifyReadiness({ operation: 'list', result: Array.from({ length: 20 }, (_, index) => {
      const expected = fixture(10000 - index);
      return { id: `id-${expected.fixture_key}`, author: expected.author, message: expected.message, created_at: expected.created_at };
    }) });
    await admin.verifyReadiness({ operation: 'write', result: { id: 'created-id' }, trial: 1, load: 1, vu: 0, sequence: 0 });
    await admin.cleanupReadiness({ result: { id: 'created-id' } });
    await admin.verifyStage({ operation: 'list', stage: { completed: 3 } });
    await admin.reset();
    await admin.teardown();
    assert.ok(collectionCalls.some((call) => call[0] === 'deleteRecord' && call[1] === 'created-id'));
    assert.equal(existsSync(join(runtime, 'state/pocketbase-superuser.json')), false);
    assert.equal(existsSync(join(runtime, 'state/pocketbase-ids.json')), false);
    assert.equal(commands.length, 1);
    assert.ok(sql.some((query) => query === `DELETE FROM "_superusers" WHERE email = '${credentials.email}'`));
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('PocketBase cases are complete thin JavaScript SDK delegations', () => {
  const operations = { 'read-list-throughput': 'list', 'read-item-throughput': 'item', 'write-throughput': 'write' };
  for (const [benchmark, operation] of Object.entries(operations)) {
    const config = parseConf(read(`benchmarks/${benchmark}/cases/pocketbase/javascript-sdk/case.conf`));
    assert.deepEqual(config, {
      schema_version: '1',
      platform: 'pocketbase',
      variant: 'javascript-sdk',
      access_path: 'records-rest',
      connection: 'http',
      client: 'pocketbase@0.28.0',
      implementation: 'javascript-node-22',
    });
    const readme = read(`benchmarks/${benchmark}/cases/pocketbase/javascript-sdk/README.md`).toLowerCase();
    assert.match(readme, /nullable json/);
    assert.match(readme, /one .*client per virtual user/);
    assert.match(readme, /unauthenticated/);
    for (const hook of ['setup', 'verify', 'reset', 'run', 'teardown']) {
      const contents = read(`benchmarks/${benchmark}/cases/pocketbase/javascript-sdk/${hook}.sh`);
      assert.match(contents, new RegExp(`shared/case\\.sh" ${hook} pocketbase ${operation}`));
    }
  }
});

test('PocketBase setup preserves its original failure when cleanup also fails', async () => {
  const { createPocketBaseAdmin } = await import('../benchmark-sets/basic-js-v1/shared/lib/admin/pocketbase.mjs');
  const runtime = mkdtempSync(join(tmpdir(), 'basic-js-pocketbase-failure-'));
  const original = new Error('collection creation failed');
  class PocketBase {
    constructor() {
      this.collections = {
        async getOne() { throw Object.assign(new Error('not found'), { status: 404 }); },
        async create() { throw original; },
      };
      this.sql = { async run() { throw new Error('superuser cleanup failed'); } };
    }
    collection() { return { async authWithPassword() {} }; }
  }
  const run = async (_command, args) => {
    if (args.includes('delete')) throw new Error('superuser cleanup failed');
    return { stdout: '', stderr: '' };
  };
  try {
    const admin = createPocketBaseAdmin({
      PocketBase,
      run,
      root: '/repo',
      runtime,
      credentials: { email: 'basic-js-v1@localhost.invalid', password: 'not-logged-secret' },
    });
    await assert.rejects(() => admin.setup(), (error) => error === original && error.cleanupError === 'superuser cleanup failed' && !error.message.includes('not-logged-secret'));
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('TrailBase adapter uses initClient and exact anonymous record APIs', async () => {
  const calls = [];
  const records = {
    async list(options) {
      calls.push(['list', options]);
      return { records: Array.from({ length: 20 }, (_, index) => ({
        id: index + 1,
        author: 'author',
        message: 'message',
        created_at: '2025-01-01T00:00:01.000Z',
        fixture_key: index + 1,
      })) };
    },
    async read(id) {
      calls.push(['read', id]);
      return { id, author: 'user-0002', message: 'Guestbook message 00002 from basic-js-v1', created_at: '2025-01-01T00:00:02.000Z', fixture_key: 2 };
    },
    async create(value) { calls.push(['create', value]); return 10001; },
  };
  const clients = [];
  const initClient = (endpoint) => {
    calls.push(['client', endpoint]);
    const client = { records(name) { calls.push(['records', name]); return records; } };
    clients.push(client);
    return client;
  };
  const adapter = createTrailBaseAdapter({ initClient, ids: [1, 2], selectFixtureIndex: () => 1 });
  const first = await adapter.createClient({ vu: 1 });
  const second = await adapter.createClient({ vu: 2 });
  assert.notEqual(first, second);
  const list = await adapter.operation(first, { operation: 'list' });
  const itemContext = { operation: 'item', trial: 1, vu: 1, sequence: 0 };
  const item = await adapter.operation(first, itemContext);
  const writeContext = { operation: 'write', trial: 2, load: 10, vu: 3, sequence: 4 };
  const created = await adapter.operation(second, writeContext);
  assert.deepEqual(list[0], { id: 1, author: 'author', message: 'message', created_at: '2025-01-01T00:00:01.000Z' });
  assert.deepEqual(item, { id: 2, author: 'user-0002', message: 'Guestbook message 00002 from basic-js-v1', created_at: '2025-01-01T00:00:02.000Z' });
  assert.deepEqual(created, { id: 10001 });
  assert.equal(adapter.validate(list, { operation: 'list' }), true);
  assert.equal(adapter.validate(item, itemContext), true);
  assert.equal(adapter.validate(created, writeContext), true);
  assert.deepEqual(calls, [
    ['client', 'http://127.0.0.1:4000'],
    ['client', 'http://127.0.0.1:4000'],
    ['records', 'bb_basic_js_v1_guestbook'],
    ['list', { pagination: { limit: 20 }, order: ['-created_at'] }],
    ['records', 'bb_basic_js_v1_guestbook'],
    ['read', 2],
    ['records', 'bb_basic_js_v1_guestbook'],
    ['create', { author: 'bench-vu-3', message: 'basic-js-v1 trial-2 load-10 vu-3 operation-4' }],
  ]);
});

test('TrailBase adapter rejects missing IDs, malformed lists, and non-scalar create IDs', async () => {
  const records = { async list() { return {}; }, async read() { return null; }, async create() { return { id: 1 }; } };
  const adapter = createTrailBaseAdapter({ initClient: () => ({ records: () => records }), ids: [], selectFixtureIndex: () => 0 });
  const client = await adapter.createClient({ vu: 1 });
  await assert.rejects(() => adapter.operation(client, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), /missing TrailBase fixture ID/);
  await assert.rejects(() => adapter.operation(client, { operation: 'write', trial: 1, load: 1, vu: 1, sequence: 0 }), /scalar ID/);
  assert.equal(adapter.validate(await adapter.operation(client, { operation: 'list' }), { operation: 'list' }), false);
});

test('TrailBase schema and Record API fragment enforce the public benchmark contract', () => {
  const migration = read('shared/trailbase/U1785764700__create_bb_basic_js_v1_guestbook.sql');
  assert.match(migration, /CREATE TABLE bb_basic_js_v1_guestbook/);
  assert.match(migration, /INTEGER PRIMARY KEY/);
  assert.match(migration, /CHECK\s*\(length\(author\) BETWEEN 1 AND 32\)/);
  assert.match(migration, /CHECK\s*\(length\(message\) BETWEEN 1 AND 256\)/);
  assert.match(migration, /strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/);
  assert.match(migration, /fixture_key INTEGER UNIQUE/);
  assert.match(migration, /\) STRICT;/);
  assert.match(migration, /created_at DESC/);

  const config = read('shared/trailbase/record-api.textproto');
  assert.match(config, /acl_world: \[READ, CREATE\]/);
  assert.match(config, /excluded_columns: \["fixture_key"\]/);
  assert.match(config, /create_access_rule: "_REQ_\.created_at IS NULL"/);
  assert.doesNotMatch(config, /acl_authenticated|UPDATE|DELETE|SCHEMA/);
});

test('TrailBase admin preserves config and supports setup, teardown, then setup again', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'basic-js-trailbase-admin-'));
  const unrelatedConfig = 'server: { application_name: "kept" }\n';
  let config = unrelatedConfig;
  let tableExists = false;
  let pendingDrop = false;
  let migrationRecorded = false;
  let fallbackCreates = 0;
  let migrationFile;
  const commands = [];
  const adminQueries = [];
  const migrationSql = read('shared/trailbase/U1785764700__create_bb_basic_js_v1_guestbook.sql');
  const configFragment = read('shared/trailbase/record-api.textproto');
  const wrap = (value) => value === null ? 'Null' : typeof value === 'number' ? { Integer: value } : { Text: value };
  const baselineRows = () => Array.from({ length: 10000 }, (_, index) => {
    const expected = fixture(index + 1);
    return [expected.fixture_key, expected.fixture_key, expected.author, expected.message, expected.created_at].map(wrap);
  });
  const queryResponse = (query) => {
    adminQueries.push(query);
    if (/FROM "_schema_history"/.test(query)) return { rows: [[wrap(migrationRecorded ? 1 : 0)]] };
    if (/FROM sqlite_schema WHERE type = 'table'/.test(query)) return { rows: tableExists ? [[wrap(1)]] : [] };
    if (/SELECT fixture_key, id, author, message, created_at/.test(query)) return { rows: baselineRows() };
    if (/SELECT count\(\*\), count\(fixture_key\)/.test(query)) return { rows: [[wrap(10000), wrap(10000), wrap(0)]] };
    if (/SELECT count\(\*\) FROM "bb_basic_js_v1_guestbook" WHERE fixture_key IS NULL/.test(query)) return { rows: [[wrap(0)]] };
    if (/SELECT sql FROM sqlite_schema/.test(query)) return { rows: [[wrap(migrationSql)], [wrap('CREATE INDEX idx_bb_guestbook_created_at ON bb_basic_js_v1_guestbook (created_at DESC)')]] };
    if (/^CREATE TABLE/m.test(query)) { tableExists = true; fallbackCreates += 1; }
    return { rows: [] };
  };
  const response = (body = {}) => ({ ok: true, status: 200, async json() { return body; }, async text() { return JSON.stringify(body); } });
  const initClient = () => ({
    async login() {
      assert.ok(commands.some(({ args }) => args.includes('install-migration')));
    },
    tokens() { return { auth_token: 'auth-secret', refresh_token: 'refresh-secret', csrf_token: 'csrf-secret' }; },
    async fetch(path, options = {}) {
      if (path === '/api/_admin/query') return response(queryResponse(JSON.parse(options.body).query));
      if (path === '/api/_admin/table' && options.method === 'DELETE') {
        pendingDrop = true;
        config = unrelatedConfig;
        return response({ sql: 'DROP TABLE' });
      }
      throw Object.assign(new Error('forbidden'), { status: 403 });
    },
    records(name) {
      assert.equal(name, 'bb_basic_js_v1_guestbook');
      return {
        async list() {
          return { records: Array.from({ length: 20 }, (_, index) => {
            const { fixture_key: _fixtureKey, ...record } = fixture(10000 - index);
            return { ...record, id: 10000 - index };
          }) };
        },
      };
    },
  });
  const run = async (command, args, options = {}) => {
    commands.push({ command, args, input: options.input });
    if (args[2] === 'logs') return {
      stdout: "trailbase-1 | Created new admin user:\ntrailbase-1 |     email: 'admin@localhost'\ntrailbase-1 |     password: 'bootstrap-secret'\n",
      stderr: '',
    };
    if (args.includes('inspect-migration')) return { stdout: migrationFile === undefined ? 'absent\n' : `present\n${migrationFile}`, stderr: '' };
    if (args.includes('cat') && args.at(-1) === '/app/traildepot/config.textproto') return { stdout: config, stderr: '' };
    if (args.includes('append-config')) config += options.input;
    if (args.includes('install-migration')) {
      migrationFile = options.input;
      if (!migrationRecorded) {
        migrationRecorded = true;
        tableExists = true;
      }
    }
    if (args[2] === 'kill') {
      if (pendingDrop) { pendingDrop = false; tableExists = false; }
      else if (!migrationRecorded) { migrationRecorded = true; tableExists = true; }
    }
    return { stdout: '', stderr: '' };
  };
  try {
    const admin = createTrailBaseAdmin({
      initClient,
      run,
      root: runtime,
      runtime,
      environmentRuntime: join(runtime, '.runtime'),
      migrationSql,
      configFragment,
      sleep: async () => {},
    });
    await admin.setup();
    assert.equal(config, `${unrelatedConfig}${configFragment}`);
    assert.equal(statSync(join(runtime, 'state/trailbase-admin.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(runtime, 'state/trailbase-ids.json')).mode & 0o777, 0o600);
    assert.ok(commands.some(({ args }) => args[2] === 'logs'));
    assert.equal(commands.some(({ args }) => args.includes('user') && args.includes('add')), false);
    assert.equal(commands.some(({ args }) => args.includes('admin') && args.includes('promote')), false);
    assert.equal(statSync(join(runtime, '.runtime/trailbase/bootstrap-admin.json')).mode & 0o777, 0o600);
    const migrationWrite = commands.find(({ args, input }) => args.includes('install-migration') && input === migrationSql);
    assert.ok(migrationWrite);
    assert.match(migrationWrite.args[7], /set -C/);
    assert.ok(adminQueries.some((query) => query.startsWith('INSERT INTO "bb_basic_js_v1_guestbook"')));
    await admin.teardown();
    assert.equal(config, unrelatedConfig);
    assert.equal(tableExists, false);
    assert.equal(commands.some(({ args }) => args.includes('rm') && args.includes('-f')), false);
    await admin.setup();
    assert.equal(fallbackCreates, 1);
    assert.equal(commands.filter(({ args }) => args.includes('install-migration')).length, 1);
    assert.equal(config, `${unrelatedConfig}${configFragment}`);
    await admin.verifyReadiness({ operation: 'list', result: Array.from({ length: 20 }, (_, index) => {
      const expected = fixture(10000 - index);
      return { id: 10000 - index, author: expected.author, message: expected.message, created_at: expected.created_at };
    }) });
    await admin.verifyStage({ operation: 'list', stage: { completed: 3 } });
    await admin.teardown();
    assert.equal(existsSync(join(runtime, 'state/trailbase-admin.json')), false);
    assert.equal(existsSync(join(runtime, 'state/trailbase-ids.json')), false);
    migrationFile = 'CREATE TABLE conflicting (id INTEGER);\n';
    const conflicting = createTrailBaseAdmin({
      initClient,
      run,
      root: runtime,
      runtime,
      environmentRuntime: join(runtime, '.runtime'),
      migrationSql,
      configFragment,
      credentials: { email: 'admin@localhost', password: 'bootstrap-secret' },
      sleep: async () => {},
    });
    await assert.rejects(() => conflicting.setup(), /migration conflicts/);
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('TrailBase setup preserves its original failure when cleanup also fails', async () => {
  const runtime = mkdtempSync(join(tmpdir(), 'basic-js-trailbase-failure-'));
  const original = new Error('admin login failed');
  let logins = 0;
  const run = async (_command, args, options = {}) => {
    if (args.includes('inspect-migration')) return { stdout: 'absent\n', stderr: '' };
    return { stdout: '', stderr: '', input: options.input };
  };
  try {
    const admin = createTrailBaseAdmin({
      initClient: () => ({
        async login() {
          logins += 1;
          if (logins === 1) throw original;
          throw new Error('admin cleanup failed');
        },
      }),
      run,
      root: '/repo',
      runtime,
      migrationSql: 'CREATE TABLE owned (id INTEGER);\n',
      configFragment: 'record_apis: []\n',
      credentials: { email: 'basic-js-v1-test@localhost.invalid', password: 'not-logged-secret' },
    });
    await assert.rejects(() => admin.setup(), (error) => error === original && error.cleanupError === 'admin cleanup failed' && !error.message.includes('not-logged-secret'));
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test('TrailBase cases are complete thin JavaScript SDK delegations', () => {
  const operations = { 'read-list-throughput': 'list', 'read-item-throughput': 'item', 'write-throughput': 'write' };
  for (const [benchmark, operation] of Object.entries(operations)) {
    const config = parseConf(read(`benchmarks/${benchmark}/cases/trailbase/javascript-sdk/case.conf`));
    assert.deepEqual(config, {
      schema_version: '1',
      platform: 'trailbase',
      variant: 'javascript-sdk',
      access_path: 'record-api',
      connection: 'http',
      client: 'trailbase@0.14.1',
      implementation: 'javascript-node-22',
    });
    const readme = read(`benchmarks/${benchmark}/cases/trailbase/javascript-sdk/README.md`).toLowerCase();
    assert.match(readme, /trailbase 0\.33\.10/);
    assert.match(readme, /one .*client per virtual user/);
    assert.match(readme, /unauthenticated/);
    assert.match(readme, /strict/);
    for (const hook of ['setup', 'verify', 'reset', 'run', 'teardown']) {
      const contents = read(`benchmarks/${benchmark}/cases/trailbase/javascript-sdk/${hook}.sh`);
      assert.match(contents, new RegExp(`shared/case\\.sh" ${hook} trailbase ${operation}`));
    }
  }
});
