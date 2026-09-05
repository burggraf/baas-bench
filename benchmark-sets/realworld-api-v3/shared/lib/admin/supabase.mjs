import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../command.mjs';
import { seedDataset, buildVirtualUserSpecs } from '../dataset.mjs';
import { loadSchemaText, copyDataset, exactCountSql, verifyExactCounts, createFixtureState, resetFixtureState, createNeonPasswords } from './postgres.mjs';

const psqlArgs = ['compose', 'supabase', 'exec', '-T', 'db', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
function jsonRows(stdout) { try { return JSON.parse(stdout.trim()); } catch { throw new Error('invalid Supabase administration response'); } }
export function createSupabaseAdmin({ run = runCommand, root, runtime, seed = 42, password = `Bb-v3-${seed}-capacity!` }) {
  const command = join(root, 'bin/baas');
  const state = join(runtime, 'state');
  async function psql(sql, args = []) { return run(command, [...psqlArgs, ...args], { input: sql, timeoutMs: 60_000 }); }
  async function query(sql) { const result = await psql(sql, ['-At']); return result.stdout; }
  async function verify() { await verifyExactCounts(async sql => (await query(sql)).trim().split('\n').filter(Boolean).map(line => { const [table, row_count] = line.split('\t'); return { table, row_count }; })); }
  async function teardown() { await psql('DROP SCHEMA IF EXISTS benchmark_fixture CASCADE; DROP SCHEMA IF EXISTS benchmark_auth CASCADE; DROP SCHEMA IF EXISTS benchmark_private CASCADE; DROP SCHEMA IF EXISTS benchmark_extensions CASCADE;'); }
  return {
    async setup() {
      try {
        await psql(await loadSchemaText());
        await copyDataset({ batches: seedDataset(seed, 1000), maxBatchSize: 1000, copy: async ({ statement, data }) => { await psql(`${data}\\.\n`, ['-c', statement]); } });
        await psql(`UPDATE public.users SET auth_subject = id WHERE auth_subject IS NULL;`);
        await createNeonPasswords(async (sql, params) => psql(sql.replace('$1', `'${params[0].replaceAll("'", "''")}'`)), password);
        await psql(await `SELECT ${JSON.stringify('ok')};`);
        await createFixtureState(async sql => psql(sql));
        await mkdir(state, { recursive: true });
        await writeFile(join(state, 'supabase-config.json'), `${JSON.stringify({ seed, password })}\n`, { mode: 0o600 });
        await verify();
      } catch (error) { try { await teardown(); } catch (cleanup) { error.cleanupError = cleanup?.message ?? String(cleanup); } throw error; }
    },
    verify,
    async reset() { await resetFixtureState(sql => psql(sql)); await verify(); },
    teardown,
  };
}
let instance;
function getDefault() { if (!instance) { if (!process.env.BAAS_BENCH_ROOT || !process.env.BAAS_BENCH_RUNTIME) throw new Error('benchmark runtime environment is missing'); instance = createSupabaseAdmin({ root: process.env.BAAS_BENCH_ROOT, runtime: process.env.BAAS_BENCH_RUNTIME }); } return instance; }
export async function setup(context) { return getDefault().setup(context); }
export async function verify(context) { return getDefault().verify(context); }
export async function reset(context) { return getDefault().reset(context); }
export async function teardown(context) { return getDefault().teardown(context); }
