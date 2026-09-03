import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fixture,
  fixtureIndex,
} from '../benchmark-sets/basic-js-v1/shared/lib/fixtures.mjs';
import {
  percentile,
  runStage,
} from '../benchmark-sets/basic-js-v1/shared/lib/runner.mjs';
import { summarize } from '../benchmark-sets/basic-js-v1/shared/lib/summary.mjs';

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
