import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fixture, fixtures, writeRecord } from '../fixtures.mjs';
import { readEnvValue, runtimeRoot } from '../config.mjs';

const name = 'bb_basic_js_v2_guestbook';
const table = { schema: 'public', name };
const baseUrl = 'http://local.graphql.local.nhost.run';

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function createNhostAdmin({ fetchImpl = fetch, secret, runtime }) {
  const stateDir = join(runtime, 'state');

  async function request(path, body) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hasura-admin-secret': secret },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Nhost administration failed (${response.status}): ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  }

  async function metadata(type, args) {
    return request('/v1/metadata', { type, args: { source: 'default', ...args } });
  }

  async function runSql(sql) {
    return request('/v2/query', { type: 'pg_run_sql', args: { source: 'default', sql, cascade: false, read_only: false } });
  }

  async function verifyBaseline() {
    const response = await runSql(`SELECT count(*)::text, min(fixture_key)::text, max(fixture_key)::text,
count(*) FILTER (WHERE
  author <> 'user-' || lpad((((fixture_key - 1) % 1000) + 1)::text, 4, '0') OR
  message <> 'Guestbook message ' || lpad(fixture_key::text, 5, '0') || ' from basic-js-v2' OR
  created_at <> '2025-01-01T00:00:00Z'::timestamptz + fixture_key * interval '1 second')::text
FROM public.${name} WHERE fixture_key IS NOT NULL;`);
    const row = response.result?.[1];
    if (!row || Number(row[0]) !== 10_000 || Number(row[1]) !== 1 || Number(row[2]) !== 10_000 || Number(row[3]) !== 0) {
      throw new Error('Nhost baseline verification failed');
    }
  }

  async function teardown() {
    let original;
    try {
      await metadata('pg_untrack_table', { table, cascade: true });
    } catch (error) {
      original = error;
    }
    try {
      await runSql(`DROP TABLE IF EXISTS public.${name};`);
    } catch (cleanupError) {
      if (!original) original = cleanupError;
      else if (original instanceof Error) original.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
    try {
      await rm(join(stateDir, 'nhost-ids.json'), { force: true });
    } catch (cleanupError) {
      if (!original) original = cleanupError;
      else if (original instanceof Error) original.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
    if (original) throw original;
  }

  return {
    async setup() {
      try {
        await runSql(`DROP TABLE IF EXISTS public.${name};
CREATE TABLE public.${name} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author text NOT NULL CHECK (char_length(author) BETWEEN 1 AND 32),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  fixture_key integer UNIQUE
);
CREATE INDEX bb_basic_js_v2_guestbook_created_at_idx ON public.${name} (created_at DESC, fixture_key DESC);`);
        await metadata('pg_track_table', { table });
        await metadata('pg_create_select_permission', {
          table,
          role: 'public',
          permission: { columns: ['id', 'author', 'message', 'created_at'], filter: {}, allow_aggregations: false },
        });
        await metadata('pg_create_insert_permission', {
          table,
          role: 'public',
          permission: { columns: ['author', 'message'], check: {}, set: {}, backend_only: false },
        });
        const rows = fixtures();
        for (let offset = 0; offset < rows.length; offset += 250) {
          const values = rows.slice(offset, offset + 250).map((row) =>
            `(${row.fixture_key},${sqlLiteral(row.author)},${sqlLiteral(row.message)},${sqlLiteral(row.created_at)}::timestamptz)`).join(',');
          await runSql(`INSERT INTO public.${name} (fixture_key, author, message, created_at) VALUES ${values};`);
        }
        const response = await runSql(`SELECT id::text FROM public.${name} WHERE fixture_key IS NOT NULL ORDER BY fixture_key;`);
        const ids = response.result?.slice(1).map((row) => row[0]);
        if (!Array.isArray(ids) || ids.length !== 10_000 || ids.some((id) => typeof id !== 'string' || !id)) {
          throw new Error('Nhost fixture ID map verification failed');
        }
        await mkdir(stateDir, { recursive: true });
        await writeFile(join(stateDir, 'nhost-ids.json'), `${JSON.stringify(ids)}\n`, { mode: 0o600 });
        await verifyBaseline();
      } catch (error) {
        try {
          await teardown();
        } catch (cleanupError) {
          if (error instanceof Error) error.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        }
        throw error;
      }
    },

    async verify() { await verifyBaseline(); },

    async reset() {
      await runSql(`DELETE FROM public.${name} WHERE fixture_key IS NULL;`);
      await verifyBaseline();
    },

    teardown,

    async verifyReadiness(context) {
      if (context.operation === 'list') {
        const expected = Array.from({ length: 20 }, (_, offset) => fixture(10_000 - offset));
        if (!Array.isArray(context.result) || context.result.some((row, index) =>
          row.author !== expected[index].author || row.message !== expected[index].message || Date.parse(row.created_at) !== Date.parse(expected[index].created_at))) {
          throw new Error('Nhost list readiness verification failed');
        }
      } else if (context.operation === 'write') {
        const expected = writeRecord({ ...context, vu: 0, sequence: 0 });
        const response = await runSql(`SELECT author, message FROM public.${name} WHERE id = ${sqlLiteral(context.result.id)}::uuid;`);
        const row = response.result?.[1];
        if (!row || row[0] !== expected.author || row[1] !== expected.message) throw new Error('Nhost write readiness verification failed');
      }
    },

    async cleanupReadiness(context) {
      await runSql(`DELETE FROM public.${name} WHERE id = ${sqlLiteral(context.result.id)}::uuid;`);
    },

    async verifyStage(context) {
      await verifyBaseline();
      const response = await runSql(`SELECT count(*)::text FROM public.${name} WHERE fixture_key IS NULL;`);
      const writes = Number(response.result?.[1]?.[0]);
      const expected = context.operation === 'write' ? context.stage.completed : 0;
      if (!Number.isSafeInteger(writes) || writes !== expected) throw new Error('Nhost stage row count verification failed');
    },
  };
}

let defaultAdmin;
async function getDefaultAdmin() {
  if (!defaultAdmin) {
    defaultAdmin = (async () => {
      const secret = await readEnvValue(join(runtimeRoot(), 'nhost/examples/docker-compose/.env'), 'GRAPHQL_ADMIN_SECRET');
      return createNhostAdmin({ secret, runtime: process.env.BAAS_BENCH_RUNTIME });
    })();
  }
  return defaultAdmin;
}

export async function setup(context) { return (await getDefaultAdmin()).setup(context); }
export async function verify(context) { return (await getDefaultAdmin()).verify(context); }
export async function reset(context) { return (await getDefaultAdmin()).reset(context); }
export async function teardown(context) { return (await getDefaultAdmin()).teardown(context); }
export async function verifyReadiness(context) { return (await getDefaultAdmin()).verifyReadiness(context); }
export async function cleanupReadiness(context) { return (await getDefaultAdmin()).cleanupReadiness(context); }
export async function verifyStage(context) { return (await getDefaultAdmin()).verifyStage(context); }
