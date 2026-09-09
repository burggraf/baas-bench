import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../command.mjs';
import { loadSchemaText, exactCountSql, verifyExactCounts, createFixtureState, resetFixtureState } from './postgres.mjs';
import { DATASET_COUNTS, entityId, seedDataset } from '../dataset.mjs';

function sqlRecord(entity, record) {
  if (entity === 'task') { const project = Number.parseInt(record.projectId.slice(5), 36); record = { ...record, organizationId: entityId('organization', project % DATASET_COUNTS.organizations) }; }
  if (entity === 'comment') { const task = Number.parseInt(record.taskId.slice(5), 36); const project = task % DATASET_COUNTS.projects; record = { ...record, projectId: entityId('project', project), organizationId: entityId('organization', project % DATASET_COUNTS.organizations) }; }
  const fields = { user: ['id', 'email', 'displayName', 'createdAt', 'updatedAt'], organization: ['id', 'name', 'ownerId', 'createdAt'], membership: ['id', 'organizationId', 'userId', 'role', 'createdAt'], project: ['id', 'organizationId', 'name', 'status', 'createdAt', 'updatedAt'], task: ['id', 'organizationId', 'projectId', 'creatorId', 'assigneeId', 'title', 'description', 'status', 'priority', 'dueDate', 'createdAt', 'updatedAt'], comment: ['id', 'organizationId', 'projectId', 'taskId', 'authorId', 'body', 'createdAt', 'updatedAt'], activity: ['id', 'organizationId', 'projectId', 'actorId', 'action', 'subjectType', 'subjectId', 'createdAt'] }[entity];
  return Object.fromEntries(fields.map(name => [name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), record[name] ?? null]));
}

export const DIRECTUS_COLLECTIONS = Object.freeze(['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities']);
async function verifyMinimumCounts(query) {
  const rows = await query(exactCountSql(), []);
  const counts = new Map(rows.map(row => [row.table ?? row.table_name, BigInt(row.count ?? row.row_count)]));
  for (const [table, expected] of Object.entries(DATASET_COUNTS)) if ((counts.get(table) ?? 0n) < BigInt(expected)) throw new Error(`${table} count is below baseline`);
  return true;
}
const BENCHMARK_ROLE = '11111111-1111-4111-8111-111111111111';
const BENCHMARK_POLICY = '22222222-2222-4222-8222-222222222222';
const ACTIVITY_HOOK_SOURCE = new URL('../../directus/hooks/realworld-activity/index.js', import.meta.url);
export function createDirectusAdmin({ execute, runtime, hashPassword, root = process.env.BAAS_BENCH_ROOT || process.cwd(), seed = 42 } = {}) {
  const state = join(runtime ?? '.', 'state'); const configPath = join(state, 'directus-config.json');
  if (typeof execute !== 'function') execute = async () => { throw new Error('Directus administrative SQL transport is required'); };
  async function query(sql, values = []) { return execute(sql, values); }
  async function restartAfterHookInstall() {
    await runCommand(join(root, 'bin/baas'), ['compose', 'directus', 'restart', 'directus'], { timeoutMs: 60_000 });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try { await runCommand(join(root, 'bin/baas'), ['smoke', 'directus'], { timeoutMs: 10_000 }); return; }
      catch { await new Promise(resolve => setTimeout(resolve, 1_000)); }
    }
    throw new Error('Directus activity hook restart did not become ready');
  }
  async function installActivityHook() {
    const source = await readFile(ACTIVITY_HOOK_SOURCE, 'utf8');
    await runCommand(join(root, 'bin/baas'), ['compose', 'directus', 'exec', '-T', 'directus', 'sh', '-c', "mkdir -p /directus/extensions/realworld-activity && cat > /directus/extensions/realworld-activity/index.js && printf '%s' '{\"name\":\"realworld-activity\",\"version\":\"1.0.0\",\"type\":\"module\",\"directus:extension\":{\"type\":\"hook\",\"path\":\"index.js\",\"source\":\"index.js\",\"host\":\"*\"}}' > /directus/extensions/realworld-activity/package.json"], { input: source, timeoutMs: 60_000 });
    await query("INSERT INTO directus_extensions (id, enabled, source, folder) SELECT benchmark_extensions.gen_random_uuid(), true, 'local', 'realworld-activity' WHERE NOT EXISTS (SELECT 1 FROM directus_extensions WHERE source = 'local' AND folder = 'realworld-activity')");
    await restartAfterHookInstall();
  }
  async function removeActivityHook() {
    await runCommand(join(root, 'bin/baas'), ['compose', 'directus', 'exec', '-T', 'directus', 'sh', '-c', 'rm -rf /directus/extensions/realworld-activity'], { timeoutMs: 60_000 });
  }
  async function teardown() { let failure; try { await query(`DELETE FROM directus_permissions WHERE policy = '${BENCHMARK_POLICY}'; DELETE FROM directus_access WHERE policy = '${BENCHMARK_POLICY}'; DELETE FROM directus_users WHERE external_identifier LIKE 'usrv3%'; DELETE FROM directus_policies WHERE id = '${BENCHMARK_POLICY}'; DELETE FROM directus_roles WHERE id = '${BENCHMARK_ROLE}'; DROP SCHEMA IF EXISTS benchmark_fixture CASCADE; DROP SCHEMA IF EXISTS benchmark_auth CASCADE; DROP SCHEMA IF EXISTS benchmark_private CASCADE; DROP TABLE IF EXISTS public.activities, public.comments, public.tasks, public.projects, public.memberships, public.organizations, public.users CASCADE;`); } catch (error) { failure = error; } try { await rm(configPath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); } if (failure) throw failure; }
  return {
    async setup() { try { await teardown(); await installActivityHook(); await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700); await query(await loadSchemaText()); await query(`INSERT INTO directus_collections (collection, accountability) SELECT collection, 'all' FROM unnest(ARRAY['users','organizations','memberships','projects','tasks','comments','activities']) AS collection WHERE NOT EXISTS (SELECT 1 FROM directus_collections existing WHERE existing.collection = collection); INSERT INTO directus_fields (collection, field, required, searchable) SELECT c.table_name, c.column_name, c.is_nullable = 'NO', true FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name IN ('users','organizations','memberships','projects','tasks','comments','activities') AND NOT EXISTS (SELECT 1 FROM directus_fields f WHERE f.collection = c.table_name AND f.field = c.column_name);`); for await (const batch of seedDataset(seed, 500)) { const table = batch.entity === 'user' ? 'users' : batch.entity === 'activity' ? 'activities' : `${batch.entity}s`; await execute(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table}, $1::jsonb)`, [JSON.stringify(batch.records.map(record => sqlRecord(batch.entity, record)))]); } if (hashPassword) { const hash = await hashPassword(`Bb-v3-${seed}-capacity!`); await query(`INSERT INTO directus_roles (id, name) VALUES ('${BENCHMARK_ROLE}', 'realworld-api-v3-user'); INSERT INTO directus_policies (id, name, admin_access, app_access) VALUES ('${BENCHMARK_POLICY}', 'realworld-api-v3-policy', false, false); INSERT INTO directus_access (id, role, policy) VALUES ('33333333-3333-4333-8333-333333333333', '${BENCHMARK_ROLE}', '${BENCHMARK_POLICY}'); INSERT INTO directus_permissions (collection, action, permissions, validation, presets, fields, policy) SELECT collection, action, NULL, NULL, NULL, '*', '${BENCHMARK_POLICY}' FROM (VALUES ${DIRECTUS_COLLECTIONS.flatMap(collection => ['read', 'create', 'update', 'delete'].map(action => `('${collection}', '${action}')`)).join(',')}) AS permissions(collection, action); INSERT INTO directus_users (id, email, password, first_name, status, provider, external_identifier, role) SELECT benchmark_extensions.gen_random_uuid(), replace(email, '@example.test', '@example.com'), '${hash.replaceAll("'", "''")}', display_name, 'active', 'default', id, '${BENCHMARK_ROLE}' FROM public.users;`, []); await restartAfterHookInstall(); } await createFixtureState(query); await writeFile(configPath, `${JSON.stringify({ seed, collections: DIRECTUS_COLLECTIONS })}\n`, { mode: 0o600 }); await this.verify(); } catch (error) { try { await teardown(); } catch (cleanup) { if (error && typeof error === 'object') error.cleanupError = String(cleanup?.message ?? cleanup); } throw error; } },
    async verify() { return verifyMinimumCounts(query); },
    async reset() { await resetFixtureState(query); return this.verify(); },
    teardown: async () => { let failure; try { await teardown(); } catch (error) { failure = error; } try { await removeActivityHook(); } catch (error) { if (!failure) failure = error; else failure.cleanupError = error; } if (failure) throw failure; },
    countSql: exactCountSql(),
  };
}
let instance;
async function getDefault() { if (!instance) { const root = process.env.BAAS_BENCH_ROOT || process.cwd(); const execute = async (sql, values = []) => { const rendered = values.reduce((query, value, index) => query.replaceAll(`$${index + 1}`, `'${String(value).replaceAll("'", "''")}'`), sql); const result = await runCommand(join(root, 'bin/baas'), ['compose', 'directus', 'exec', '-T', 'database', 'psql', '-U', 'directus', '-d', 'directus', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: rendered, timeoutMs: 60_000 }); return result.stdout.trim() ? result.stdout.trim().split(/\r?\n/).map(line => { const [table_name, row_count] = line.split('|'); return { table_name, row_count }; }) : []; }; const hashPassword = async password => { const result = await runCommand(join(root, 'bin/baas'), ['compose', 'directus', 'exec', '-T', 'directus', 'node', '-e', "const dir=require('fs').readdirSync('/directus/node_modules/.pnpm').find(name=>name.startsWith('argon2@')); require('/directus/node_modules/.pnpm/'+dir+'/node_modules/argon2').hash(process.argv[1]).then(console.log)", password], { timeoutMs: 60_000 }); return result.stdout.trim(); }; instance = createDirectusAdmin({ runtime: process.env.BAAS_BENCH_RUNTIME, root, execute, hashPassword }); } return instance; }
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
