import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../command.mjs';
import { seedDataset } from '../dataset.mjs';

export const deployArgs = ['deploy', '--typecheck', 'disable'];
export const inspectionExportPath = path => `${path}.zip`;

export function createConvexAdmin({ run = runCommand, root, runtime, seed = 42, password = `Bb-v3-${seed}-capacity!` } = {}) {
  const state = join(runtime, 'state');
  const envPath = join(state, 'convex.env');
  const baselinePath = join(state, 'convex-baseline.zip');
  const source = join(runtime, 'convex');
  let cliEnv;
  async function cli(args) { if (!cliEnv) throw new Error('Convex administrative environment is missing'); return run('npx', ['convex', ...args], { cwd: runtime, env: cliEnv, timeoutMs: 60_000 }); }
  async function deploy() { await cli(deployArgs); }
  async function teardown() {
    if (!cliEnv) return;
    let failure;
    try { if (await import('node:fs/promises').then(({ access }) => access(baselinePath).then(() => true).catch(() => false))) await cli(['import', '--replace', '--yes', baselinePath]); } catch (error) { failure = error; }
    try { await rm(baselinePath, { force: true }); await rm(envPath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); }
    if (failure) throw failure;
  }
  return {
    async setup() {
      try {
        await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700);
        const { stdout } = await run(join(root, 'bin/baas'), ['compose', 'convex', 'exec', '-T', 'backend', './generate_admin_key.sh']);
        const key = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1); if (!key || /\s/.test(key)) throw new Error('invalid Convex admin key response');
        cliEnv = { ...process.env, CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:3210', CONVEX_SELF_HOSTED_ADMIN_KEY: key };
        await writeFile(envPath, `CONVEX_SELF_HOSTED_URL=${cliEnv.CONVEX_SELF_HOSTED_URL}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${key}\n`, { mode: 0o600 });
        await cli(['env', 'set', 'CONVEX_AUTH_ISSUER', 'http://127.0.0.1:3210']);
        await deploy();
        let cleared;
        do { const result = await cli(['run', 'setup:clear', JSON.stringify({ limit: 100 })]); cleared = Number.parseInt(result.stdout.trim().split(/\s+/).at(-1), 10); if (!Number.isSafeInteger(cleared)) throw new Error('invalid Convex clear result'); } while (cleared > 0);
        for await (const batch of seedDataset(seed, 500)) { const records = batch.records.map(record => Object.fromEntries(Object.entries(batch.entity === 'user' ? { ...record, authSubject: record.id } : record).map(([field, value]) => [field, typeof value === 'string' && /At$|Date$/.test(field) ? Date.parse(value) : value]))); await cli(['run', 'setup:seed', JSON.stringify({ entity: batch.entity, records })]); }
        await cli(['export', '--path', baselinePath]);
      } catch (error) { try { await teardown(); } catch (cleanup) { if (error && typeof error === 'object') error.cleanupError = String(cleanup?.message ?? cleanup); } throw error; }
    },
    async verify() { await cli(['run', 'setup:verify', '{}']); },
    async reset() { await cli(['import', '--replace', '--yes', baselinePath]); await verify(); },
    teardown,
    setEnvironment(environment) { cliEnv = { ...process.env, ...environment }; },
  };
}
let instance;
async function getDefault() {
  if (!instance) {
    const admin = createConvexAdmin({ root: process.env.BAAS_BENCH_ROOT, runtime: process.env.BAAS_BENCH_RUNTIME });
    const text = await import('node:fs/promises').then(({ readFile }) => readFile(join(process.env.BAAS_BENCH_RUNTIME, 'state/convex.env'), 'utf8')).catch(() => '');
    const values = Object.fromEntries(text.trim().split(/\r?\n/).filter(Boolean).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
    if (values.CONVEX_SELF_HOSTED_URL && values.CONVEX_SELF_HOSTED_ADMIN_KEY) admin.setEnvironment(values);
    instance = admin;
  }
  return instance;
}
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
