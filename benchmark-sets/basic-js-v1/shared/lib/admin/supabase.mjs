import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fixture, fixtures, writeRecord } from '../fixtures.mjs';

const table = 'public.bb_basic_js_v1_guestbook';

export function runCommand(command, args, { input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`command failed (${code}): ${stderr.trim().slice(0, 500)}`));
    });
    child.stdin.end(input);
  });
}

function parseJsonOutput(stdout, label) {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error(`invalid ${label} response from Supabase administration`);
  }
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function setupSql() {
  const csv = fixtures().map((row) => `${row.fixture_key},${row.author},${row.message},${row.created_at}`).join('\n');
  return `BEGIN;
DROP TABLE IF EXISTS ${table};
CREATE TABLE ${table} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author text NOT NULL CHECK (char_length(author) BETWEEN 1 AND 32),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  fixture_key integer UNIQUE
);
CREATE INDEX bb_basic_js_v1_guestbook_created_at_idx ON ${table} (created_at DESC, fixture_key DESC);
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
GRANT SELECT (id, author, message, created_at), INSERT (author, message) ON ${table} TO anon;
CREATE POLICY bb_basic_js_v1_guestbook_select ON ${table} FOR SELECT TO anon USING (true);
CREATE POLICY bb_basic_js_v1_guestbook_insert ON ${table} FOR INSERT TO anon WITH CHECK (fixture_key IS NULL);
\\copy ${table} (fixture_key, author, message, created_at) FROM STDIN WITH (FORMAT csv)
${csv}
\\.
NOTIFY pgrst, 'reload schema';
COMMIT;
`;
}

const baselineSql = `SELECT json_build_object(
  'count', count(*),
  'min', min(fixture_key),
  'max', max(fixture_key),
  'bad', count(*) FILTER (WHERE
    author <> 'user-' || lpad((((fixture_key - 1) % 1000) + 1)::text, 4, '0') OR
    message <> 'Guestbook message ' || lpad(fixture_key::text, 5, '0') || ' from basic-js-v1' OR
    created_at <> '2025-01-01T00:00:00Z'::timestamptz + fixture_key * interval '1 second')
) FROM ${table} WHERE fixture_key IS NOT NULL;
`;

export function createSupabaseAdmin({ run = runCommand, root, runtime }) {
  const command = join(root, 'bin/baas');
  const stateDir = join(runtime, 'state');
  const idsPath = join(stateDir, 'supabase-ids.json');
  const psqlArgs = ['compose', 'supabase', 'exec', '-T', 'db', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-At'];

  async function psql(input) {
    return run(command, psqlArgs, { input });
  }

  async function verifyBaseline() {
    const { stdout } = await psql(baselineSql);
    const result = parseJsonOutput(stdout, 'baseline');
    if (Number(result.count) !== 10_000 || Number(result.min) !== 1 || Number(result.max) !== 10_000 || Number(result.bad) !== 0) {
      throw new Error('Supabase baseline verification failed');
    }
  }

  async function teardown() {
    await psql(`DROP TABLE IF EXISTS ${table};\nNOTIFY pgrst, 'reload schema';\n`);
  }

  return {
    async setup() {
      try {
        await psql(setupSql());
        const { stdout } = await psql(`SELECT coalesce(json_agg(id::text ORDER BY fixture_key), '[]'::json) FROM ${table} WHERE fixture_key IS NOT NULL;\n`);
        const ids = parseJsonOutput(stdout, 'fixture ID map');
        if (!Array.isArray(ids) || ids.length !== 10_000 || ids.some((id) => typeof id !== 'string' || id.length === 0)) {
          throw new Error('Supabase fixture ID map verification failed');
        }
        await mkdir(stateDir, { recursive: true });
        await writeFile(idsPath, `${JSON.stringify(ids)}\n`, { mode: 0o600 });
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

    async verify() {
      await verifyBaseline();
    },

    async reset() {
      await psql(`DELETE FROM ${table} WHERE fixture_key IS NULL;\n`);
      await verifyBaseline();
    },

    teardown,

    async verifyReadiness(context) {
      if (context.operation === 'list') {
        const expected = Array.from({ length: 20 }, (_, offset) => fixture(10_000 - offset));
        if (!Array.isArray(context.result) || context.result.some((row, index) =>
          row.author !== expected[index].author || row.message !== expected[index].message || Date.parse(row.created_at) !== Date.parse(expected[index].created_at))) {
          throw new Error('Supabase list readiness verification failed');
        }
      } else if (context.operation === 'write') {
        const expected = writeRecord({ ...context, vu: 0, sequence: 0 });
        const { stdout } = await psql(`SELECT json_build_object('author', author, 'message', message) FROM ${table} WHERE id = ${sqlLiteral(context.result.id)};\n`);
        const actual = parseJsonOutput(stdout, 'write readiness');
        if (actual.author !== expected.author || actual.message !== expected.message) throw new Error('Supabase write readiness verification failed');
      }
    },

    async cleanupReadiness(context) {
      await psql(`DELETE FROM ${table} WHERE id = ${sqlLiteral(context.result.id)};\n`);
    },

    async verifyStage(context) {
      await verifyBaseline();
      const { stdout } = await psql(`SELECT count(*) FROM ${table} WHERE fixture_key IS NULL;\n`);
      const writes = Number(stdout.trim());
      const expected = context.operation === 'write' ? context.stage.completed : 0;
      if (!Number.isSafeInteger(writes) || writes !== expected) throw new Error('Supabase stage row count verification failed');
    },
  };
}

let defaultAdmin;
function getDefaultAdmin() {
  if (!defaultAdmin) {
    if (!process.env.BAAS_BENCH_ROOT || !process.env.BAAS_BENCH_RUNTIME) throw new Error('benchmark runtime environment is missing');
    defaultAdmin = createSupabaseAdmin({ root: process.env.BAAS_BENCH_ROOT, runtime: process.env.BAAS_BENCH_RUNTIME });
  }
  return defaultAdmin;
}

export async function setup(context) { return getDefaultAdmin().setup(context); }
export async function verify(context) { return getDefaultAdmin().verify(context); }
export async function reset(context) { return getDefaultAdmin().reset(context); }
export async function teardown(context) { return getDefaultAdmin().teardown(context); }
export async function verifyReadiness(context) { return getDefaultAdmin().verifyReadiness(context); }
export async function cleanupReadiness(context) { return getDefaultAdmin().cleanupReadiness(context); }
export async function verifyStage(context) { return getDefaultAdmin().verifyStage(context); }
