import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  fixture,
  fixtureIndex,
} from '../benchmark-sets/basic-js-v1/shared/lib/fixtures.mjs';
import {
  percentile,
  runStage,
} from '../benchmark-sets/basic-js-v1/shared/lib/runner.mjs';
import { summarize } from '../benchmark-sets/basic-js-v1/shared/lib/summary.mjs';

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
      if (client.vu === 1) throw new Error('network failed');
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
  assert.equal(result.latencies_ms.length, 0);
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
