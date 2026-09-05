import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSchemaText, exactCountSql, verifyExactCounts, createFixtureState, resetFixtureState } from './postgres.mjs';
import { seedDataset } from '../dataset.mjs';

export const HASURA_ROLE = 'user';
export const applicationTables = Object.freeze(['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities']);

export function createNhostAdmin({ execute, runtime, seed = 42 } = {}) {
  const state = join(runtime ?? '.', 'state'); const configPath = join(state, 'nhost-config.json');
  if (typeof execute !== 'function') execute = async () => { throw new Error('Nhost administrative SQL transport is required'); };
  async function query(sql, values = []) { return execute(sql, values); }
  async function teardown() { let failure; try { await query('DROP SCHEMA IF EXISTS benchmark_fixture CASCADE; DROP SCHEMA IF EXISTS benchmark_auth CASCADE; DROP TABLE IF EXISTS public.activities, public.comments, public.tasks, public.projects, public.memberships, public.organizations, public.users CASCADE;'); } catch (error) { failure = error; } try { await rm(configPath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); } if (failure) throw failure; }
  return {
    async setup() { try { await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700); await query(await loadSchemaText()); for await (const batch of seedDataset(seed, 500)) await execute(`INSERT INTO public.${batch.entity === 'user' ? 'users' : `${batch.entity}s`} SELECT * FROM jsonb_to_recordset($1::jsonb) AS rows`, [JSON.stringify(batch.records)]); await createFixtureState(query); await writeFile(configPath, `${JSON.stringify({ seed, role: HASURA_ROLE })}\n`, { mode: 0o600 }); await this.verify(); } catch (error) { try { await teardown(); } catch (cleanup) { if (error && typeof error === 'object') error.cleanupError = String(cleanup?.message ?? cleanup); } throw error; } },
    async verify() { return verifyExactCounts(query); },
    async reset() { await resetFixtureState(query); return this.verify(); },
    teardown,
    countSql: exactCountSql(),
  };
}
let instance;
async function getDefault() { if (!instance) instance = createNhostAdmin({ runtime: process.env.BAAS_BENCH_RUNTIME }); return instance; }
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
