import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../command.mjs';

export const TRAILBASE_TABLES = Object.freeze(['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities']);
export function createTrailBaseAdmin({ run = runCommand, root, runtime, execute } = {}) {
  const state = join(runtime ?? '.', 'state'); const configPath = join(state, 'trailbase-config.json');
  async function command(args) { return run(join(root, 'bin/baas'), ['compose', 'trailbase', 'exec', '-T', 'trailbase', ...args], { timeoutMs: 120_000 }); }
  async function teardown() { let failure; try { if (typeof execute === 'function') await execute('teardown'); } catch (error) { failure = error; } try { await rm(configPath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); } if (failure) throw failure; }
  return {
    async setup() { try { await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700); if (typeof execute === 'function') await execute('setup'); else await command(['sh', '-c', 'echo migration/configuration is provided by the benchmark runtime']); await writeFile(configPath, `${JSON.stringify({ tables: TRAILBASE_TABLES, accessPath: 'javascript-sdk' })}\n`, { mode: 0o600 }); } catch (error) { try { await teardown(); } catch (cleanup) { if (error && typeof error === 'object') error.cleanupError = String(cleanup?.message ?? cleanup); } throw error; } },
    async verify() { if (typeof execute === 'function') return execute('verify'); },
    async reset() { if (typeof execute === 'function') return execute('reset'); },
    teardown,
  };
}
let instance;
async function getDefault() { if (!instance) instance = createTrailBaseAdmin({ root: process.env.BAAS_BENCH_ROOT, runtime: process.env.BAAS_BENCH_RUNTIME }); return instance; }
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
