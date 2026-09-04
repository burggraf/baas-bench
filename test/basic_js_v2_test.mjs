import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fixture, fixtureIndex } from '../benchmark-sets/basic-js-v2/shared/lib/fixtures.mjs';
import * as postgresModule from '../benchmark-sets/basic-js-v2/shared/lib/adapters/postgres.mjs';
import { createPostgresAdapter } from '../benchmark-sets/basic-js-v2/shared/lib/adapters/postgres.mjs';
import { runStage } from '../benchmark-sets/basic-js-v2/shared/lib/runner.mjs';
import { createPocketBaseGoAdapter } from '../benchmark-sets/basic-js-v2/shared/lib/adapters/pocketbase-go.mjs';

const ids = Array.from({ length: 10_000 }, (_, index) => `id-${index + 1}`);
const setRoot = new URL('../benchmark-sets/basic-js-v2/', import.meta.url);

test('database-path cases cover supported direct and extension topologies', async () => {
  const cases = ['neon/direct-postgres', 'supabase/direct-postgres', 'supabase/pooler-postgres', 'nhost/direct-postgres', 'directus/direct-postgres', 'trailbase/rust-wasm', 'pocketbase/go-extension'];
  for (const benchmark of ['read-list-throughput', 'read-item-throughput', 'write-throughput']) {
    for (const name of cases) {
      const config = readFileSync(new URL(`benchmarks/${benchmark}/cases/${name}/case.conf`, setRoot), 'utf8');
      assert.match(config, name === 'trailbase/rust-wasm' || name === 'pocketbase/go-extension' ? /access_path=extension/ : /access_path=direct database/);
    }
  }
  assert.match(readFileSync(new URL('shared/case.sh', setRoot), 'utf8'), /supabase\|neon\|nhost\|directus\|trailbase\|pocketbase/);
  assert.match(readFileSync(new URL('../../services/directus/compose.yml', setRoot), 'utf8'), /127\.0\.0\.1:5432:5432/);
  assert.match(readFileSync(new URL('../../bin/baas', setRoot), 'utf8'), /127\.0\.0\.1:15432:5432/);
  const wasm = readFileSync(new URL('shared/wasm-rust/src/lib.rs', setRoot), 'utf8');
  const trailbaseAdmin = readFileSync(new URL('shared/lib/admin/trailbase.mjs', setRoot), 'utf8');
  assert.match(trailbaseAdmin, /async function removeDeploymentArtifacts/);
  assert.match(trailbaseAdmin, /baas-bench\.wasm/);
  const pocketbase = readFileSync(new URL('shared/pocketbase-go/main.go', setRoot), 'utf8');
  const pocketbaseImage = readFileSync(new URL('shared/pocketbase-go/Dockerfile', setRoot), 'utf8');
  assert.match(pocketbaseImage, /--dir=\/pb\/pb_data/);
  const pocketbaseAdmin = readFileSync(new URL('shared/lib/admin/pocketbase.mjs', setRoot), 'utf8');
  assert.match(pocketbaseAdmin, /idx_bb_basic_js_v2_guestbook_created_at/);
  assert.match(pocketbaseAdmin, /idx_bb_basic_js_v2_guestbook_fixture_key/);
  for (const route of ['/bb-basic-js-v2/list', '/bb-basic-js-v2/item', '/bb-basic-js-v2/write']) {
    assert.match(wasm, new RegExp(route));
    assert.match(pocketbase, new RegExp(route));
  }
  let poolConfig;
  const adapter = createPostgresAdapter({ Pool: class { constructor(config) { poolConfig = config; } }, platform: 'neon', ids });
  await adapter.createClient();
  assert.deepEqual(poolConfig, { host: '127.0.0.1', port: 55433, user: 'cloud_admin', password: 'cloud_admin', database: 'postgres', max: 1 });
  const index = fixtureIndex(1, 1, 0);
  const expected = fixture(index + 1);
  const client = {
    query: async (sql, values) => ({
      rows: [{ id: ids[index], author: expected.author, message: expected.message, created_at: expected.created_at }],
      sql,
      values,
    }),
  };
  const result = await adapter.operation(client, { operation: 'item', trial: 1, vu: 1, sequence: 0 });
  assert.equal(await adapter.validate(result, { operation: 'item', trial: 1, vu: 1, sequence: 0 }), true);
  assert.match((await client.query('SELECT 1')).sql, /SELECT/);
});

test('PostgreSQL adapter exports pool cleanup', () => {
  assert.equal(typeof postgresModule.closeClient, 'function');
});

test('client cleanup is outside the measured stage duration', async () => {
  const stage = await runStage({
    concurrency: 1,
    durationMs: 5,
    trial: 1,
    createClient: async () => ({}),
    operation: async () => ({}),
    validate: async () => true,
    closeClient: async () => new Promise((resolve) => setTimeout(resolve, 100)),
  });
  assert.ok(stage.duration_ms < 80, `cleanup leaked into duration: ${stage.duration_ms}ms`);
});

test('database adapters reject list rows with wrong order', async () => {
  const pocketbase = createPocketBaseGoAdapter({ ids });
  const postgres = createPostgresAdapter({ Pool: class {}, platform: 'neon', ids });
  const rows = [9_999, 10_000, ...Array.from({ length: 18 }, (_, offset) => 9_998 - offset)].map((number) => {
    const value = fixture(number);
    return { id: ids[number - 1], author: value.author, message: value.message, created_at: value.created_at };
  });
  assert.equal(await pocketbase.validate(rows, { operation: 'list' }), false);
  assert.equal(await postgres.validate(rows, { operation: 'list' }), false);
});
