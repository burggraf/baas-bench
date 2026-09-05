import { appendFile, chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { runCommand } from '../command.mjs';
import { DATASET_COUNTS, entityId, seedDataset } from '../dataset.mjs';

export const deployArgs = ['deploy', '--typecheck', 'disable'];
export const inspectionExportPath = path => `${path}.zip`;

export function createConvexAdmin({ run = runCommand, root, runtime, seed = 42, password = `Bb-v3-${seed}-capacity!` } = {}) {
  const state = join(runtime, 'state');
  const envPath = join(state, 'convex.env');
  const privateKeyPath = join(state, 'convex-private-key.pem');
  const baselinePath = join(state, 'convex-baseline.zip');
  const importPaths = { user: join(state, 'convex-users.jsonl'), organization: join(state, 'convex-organizations.jsonl'), membership: join(state, 'convex-memberships.jsonl'), project: join(state, 'convex-projects.jsonl'), task: join(state, 'convex-tasks.jsonl'), comment: join(state, 'convex-comments.jsonl'), activity: join(state, 'convex-activities.jsonl') };
  const importTables = { user: 'users', organization: 'organizations', membership: 'memberships', project: 'projects', task: 'tasks', comment: 'comments', activity: 'activities' };
  const importChunkSize = 20_000;
  function ordinalFromId(id, prefix) { return Number.parseInt(id.slice(prefix.length), 36); }
  function normalizeRecord(entity, record) {
    const value = entity === 'user' ? { ...record, authSubject: record.id } : { ...record };
    if (entity === 'task') { const project = ordinalFromId(value.projectId, 'prjv3'); value.organizationId = entityId('organization', project % DATASET_COUNTS.organizations); }
    if (entity === 'comment') { const task = ordinalFromId(value.taskId, 'tskv3'); const project = task % DATASET_COUNTS.projects; value.projectId = entityId('project', project); value.organizationId = entityId('organization', project % DATASET_COUNTS.organizations); }
    return Object.fromEntries(Object.entries(value).map(([field, fieldValue]) => [field, typeof fieldValue === 'string' && /At$|Date$/.test(field) ? Date.parse(fieldValue) : fieldValue]));
  }
  let cliEnv;
  async function cli(args) { if (!cliEnv) throw new Error('Convex administrative environment is missing'); return run('npx', ['convex', ...args], { cwd: runtime, env: cliEnv, timeoutMs: 60_000 }); }
  async function deploy() { await cli(deployArgs); }
  async function importFixture() { for (const entity of Object.keys(importPaths)) { const prefix = `${importPaths[entity]}.`; const files = (await readdir(state)).filter(name => name.startsWith(prefix.slice(prefix.lastIndexOf('/') + 1))).sort((a, b) => Number(a.slice(a.lastIndexOf('.') + 1)) - Number(b.slice(b.lastIndexOf('.') + 1))); for (const [index, name] of files.entries()) await cli(['import', '--table', importTables[entity], index === 0 ? '--replace' : '--append', '--format', 'jsonLines', '--yes', join(state, name)]); } }
  async function teardown() {
    if (!cliEnv) return;
    let failure;
    try { if (await import('node:fs/promises').then(({ access }) => access(baselinePath).then(() => true).catch(() => false))) await cli(['import', '--replace', '--yes', baselinePath]); } catch (error) { failure = error; }
    try { await rm(baselinePath, { force: true }); await rm(privateKeyPath, { force: true }); await Promise.all((await readdir(state).catch(() => [])).filter(name => name.startsWith('convex-') && name.endsWith('.jsonl') || /^convex-.*\.jsonl\.\d+$/.test(name)).map(name => rm(join(state, name), { force: true }))); await rm(envPath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); }
    if (failure) throw failure;
  }
  return {
    async setup() {
      try {
        await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700);
        const { stdout } = await run(join(root, 'bin/baas'), ['compose', 'convex', 'exec', '-T', 'backend', './generate_admin_key.sh']);
        const key = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1); if (!key || /\s/.test(key)) throw new Error('invalid Convex admin key response');
        cliEnv = { ...process.env, CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:3210', CONVEX_SELF_HOSTED_ADMIN_KEY: key };
        const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
        const jwks = `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), use: 'sig', alg: 'RS256', kid: 'realworld-api-v3' }] })).toString('base64')}`;
        await writeFile(privateKeyPath, privatePem, { mode: 0o600 });
        await writeFile(envPath, `CONVEX_SELF_HOSTED_URL=${cliEnv.CONVEX_SELF_HOSTED_URL}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${key}\nCONVEX_AUTH_ISSUER=http://127.0.0.1:3210\nCONVEX_AUTH_JWKS=${jwks}\n`, { mode: 0o600 });
        await cli(['env', 'set', 'CONVEX_AUTH_ISSUER', 'http://127.0.0.1:3210']);
        await cli(['env', 'set', 'CONVEX_AUTH_JWKS', jwks]);
        await cli(['env', 'set', 'CONVEX_BENCHMARK_PASSWORD', password]);
        await deploy();
        const chunks = Object.fromEntries(Object.keys(importPaths).map(entity => [entity, []]));
        const counts = Object.fromEntries(Object.keys(importPaths).map(entity => [entity, 0]));
        for await (const batch of seedDataset(seed, 500)) {
          const entity = batch.entity;
          let path = chunks[entity].at(-1);
          if (!path || counts[entity] + batch.records.length > importChunkSize) { path = `${importPaths[entity]}.${chunks[entity].length}`; chunks[entity].push(path); counts[entity] = 0; await writeFile(path, '', { mode: 0o600 }); }
          await appendFile(path, batch.records.map(record => `${JSON.stringify(normalizeRecord(entity, record))}\n`).join('')); counts[entity] += batch.records.length;
        }
        await importFixture();
      } catch (error) { try { await teardown(); } catch (cleanup) { if (error && typeof error === 'object') error.cleanupError = String(cleanup?.message ?? cleanup); } throw error; }
    },
    async verify() { await cli(['run', 'setup:verify', '{}']); },
    async reset() { await importFixture(); await verify(); },
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
