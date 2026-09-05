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
  async function teardown() { await psql("DO $$ BEGIN IF to_regclass('auth.sessions') IS NOT NULL THEN DELETE FROM auth.sessions WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'user-%@example.test'); END IF; IF to_regclass('auth.users') IS NOT NULL THEN DELETE FROM auth.users WHERE email LIKE 'user-%@example.test'; END IF; END $$; DROP SCHEMA IF EXISTS benchmark_fixture CASCADE; DROP SCHEMA IF EXISTS benchmark_auth CASCADE; DROP TABLE IF EXISTS public.activities, public.comments, public.tasks, public.projects, public.memberships, public.organizations, public.users CASCADE; DROP SCHEMA IF EXISTS benchmark_private CASCADE; DROP SCHEMA IF EXISTS benchmark_extensions CASCADE;"); }
  return {
    async setup() {
      try {
        await psql(await loadSchemaText());
        await copyDataset({ batches: seedDataset(seed, 1000), maxBatchSize: 1000, copy: async ({ statement, data }) => { await psql(`${data}\\.\n`, ['-c', statement]); } });
        await psql(`UPDATE public.users SET auth_subject = id WHERE auth_subject IS NULL;`);
        await createNeonPasswords(async (sql, params) => psql(sql.replace('$1', `'${params[0].replaceAll("'", "''")}'`)), password);
        await psql(`DO $$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email,
      benchmark_extensions.crypt('${password.replaceAll("'", "''")}', benchmark_extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('display_name', u.display_name)
    FROM public.users u ON CONFLICT (email) DO NOTHING;
    UPDATE public.users u SET auth_subject = a.id::text FROM auth.users a WHERE a.email = u.email;
  END IF;
END $$;`);
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
