import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../command.mjs';
import { DATASET_COUNTS, entityId, seedDataset } from '../dataset.mjs';

export const collections = Object.freeze(['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities']);
const baseCollections = collections.slice(1);
const endpoint = 'http://127.0.0.1:8090';
const text = (name, required = false) => ({ name, type: 'text', required });
const definitions = [
  { name: 'users', type: 'auth', fields: [text('benchmark_id', true), text('display_name', true), text('created_at', true), text('updated_at', true)], listRule: '@request.auth.id != ""', viewRule: '@request.auth.id != ""', createRule: '@request.auth.id != ""', updateRule: '@request.auth.id != ""' },
  { name: 'organizations', fields: [text('benchmark_id'), text('name', true), text('owner_id', true), text('created_at', true)] },
  { name: 'memberships', fields: [text('benchmark_id'), text('organization_id', true), text('user_id', true), text('role', true), text('created_at', true)] },
  { name: 'projects', fields: [text('benchmark_id'), text('organization_id', true), text('name', true), text('status', true), text('created_at', true), text('updated_at', true)] },
  { name: 'tasks', fields: [text('benchmark_id'), text('organization_id', true), text('project_id', true), text('creator_id', true), text('assignee_id'), text('title', true), text('description', true), text('status', true), text('priority', true), text('due_date'), text('created_at', true), text('updated_at', true)] },
  { name: 'comments', fields: [text('benchmark_id'), text('organization_id', true), text('project_id', true), text('task_id', true), text('author_id', true), text('body', true), text('created_at', true), text('updated_at', true)] },
  { name: 'activities', fields: [text('benchmark_id'), text('organization_id', true), text('project_id'), text('actor_id', true), text('action', true), text('subject_type', true), text('subject_id', true), text('created_at', true)] },
].map(definition => ({ ...definition, listRule: definition.listRule ?? '@request.auth.id != ""', viewRule: definition.viewRule ?? '@request.auth.id != ""', createRule: definition.createRule ?? '@request.auth.id != ""', updateRule: definition.updateRule ?? '@request.auth.id != ""' }));

function sql(value) { return value === null || value === undefined ? "''" : `'${String(value).replaceAll("'", "''")}'`; }
function record(entity, source) {
  if (entity === 'task') { const project = Number.parseInt(source.projectId.slice(5), 36); source = { ...source, organizationId: entityId('organization', project % DATASET_COUNTS.organizations) }; }
  if (entity === 'comment') { const task = Number.parseInt(source.taskId.slice(5), 36); const project = task % DATASET_COUNTS.projects; source = { ...source, projectId: entityId('project', project), organizationId: entityId('organization', project % DATASET_COUNTS.organizations) }; }
  const fields = { organization: ['id', 'name', 'ownerId', 'createdAt'], membership: ['id', 'organizationId', 'userId', 'role', 'createdAt'], project: ['id', 'organizationId', 'name', 'status', 'createdAt', 'updatedAt'], task: ['id', 'organizationId', 'projectId', 'creatorId', 'assigneeId', 'title', 'description', 'status', 'priority', 'dueDate', 'createdAt', 'updatedAt'], comment: ['id', 'organizationId', 'projectId', 'taskId', 'authorId', 'body', 'createdAt', 'updatedAt'], activity: ['id', 'organizationId', 'projectId', 'actorId', 'action', 'subjectType', 'subjectId', 'createdAt'] }[entity];
  return fields.map(field => sql(source[field])).join(',');
}
function table(entity) { return entity === 'organization' ? 'organizations' : entity === 'activity' ? 'activities' : `${entity}s`; }
async function insertRows(sqlRun, name, columns, values) { let chunk = []; let length = 0; for (const value of values) { if (chunk.length && length + value.length + 2 > 4_000) { await sqlRun(`INSERT INTO ${name} (${columns}) VALUES ${chunk.join(',')}`); chunk = []; length = 0; } chunk.push(value); length += value.length + 2; } if (chunk.length) await sqlRun(`INSERT INTO ${name} (${columns}) VALUES ${chunk.join(',')}`); }

export function createPocketBaseAdmin({ PocketBase, run = runCommand, root, runtime, execute } = {}) {
  const state = join(runtime ?? '.', 'state');
  const credentialsPath = join(state, 'pocketbase-superuser.json');
  const command = join(root ?? process.cwd(), 'bin/baas');
  let client;
  let credentials;
  async function commandRun(args, options = {}) { return run(command, ['compose', 'pocketbase', 'exec', '-T', 'pocketbase', ...args], { timeoutMs: 60_000, ...options }); }
  async function loadCredentials() { if (!credentials) credentials = JSON.parse(await readFile(credentialsPath, 'utf8')); return credentials; }
  async function superuser(action, values) { return commandRun(['/pb/pocketbase', '--dir=/pb/pb_data', 'superuser', action, ...values]); }
  async function connect() { if (!client) { const value = await loadCredentials(); client = new PocketBase(endpoint); await client.collection('_superusers').authWithPassword(value.email, value.password); } return client; }
  async function sqlRun(query) { try { return await (await connect()).sql.run(query); } catch (error) { throw new Error(`PocketBase SQL failed: ${error.message} ${JSON.stringify(error.response ?? {})} query=${query.slice(0, 600)}`); } }
  async function removeCollections() { const pb = await connect(); for (const name of collections) { try { await pb.collections.delete(name); } catch (error) { if (error?.status !== 404) throw error; } } }
  async function seedUsers(seed) { const pb = await connect(); const stream = seedDataset(seed, 500); let hash; let firstBatch = true; for await (const batch of stream) { if (batch.entity !== 'user') break; if (!hash) { const first = batch.records[0]; await pb.collection('users').create({ email: first.email, password: `Bb-v3-${seed}-capacity!`, passwordConfirm: `Bb-v3-${seed}-capacity!`, benchmark_id: first.id, display_name: first.displayName, created_at: first.createdAt, updated_at: first.updatedAt }); hash = (await sqlRun(`SELECT password FROM users WHERE benchmark_id = ${sql(first.id)}`)).rows?.[0]?.[0]; if (!hash) throw new Error('PocketBase password hash was not created'); } const records = firstBatch ? batch.records.slice(1) : batch.records; const values = records.map(value => `('${randomBytes(8).toString('hex').slice(0, 15)}', '${randomBytes(8).toString('hex').slice(0, 15)}', ${sql(value.email)}, ${sql(hash)}, ${sql(value.id)}, ${sql(value.displayName)}, ${sql(value.createdAt)}, ${sql(value.updatedAt)})`); await insertRows(sqlRun, 'users', 'id,tokenKey,email,password,benchmark_id,display_name,created_at,updated_at', values); firstBatch = false; } }
  async function seedRows(seed) { for await (const batch of seedDataset(seed, 500)) { if (batch.entity === 'user') continue; const name = table(batch.entity); const values = batch.records.map(value => `(${record(batch.entity, value)})`); await insertRows(sqlRun, `"${name}"`, definitions.find(item => item.name === name).fields.map(field => field.name).join(','), values); } }
  async function setupImpl(seed = 42) { await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700); credentials = { email: `realworld-api-v3-pocketbase-${randomBytes(8).toString('hex')}@localhost.invalid`, password: `${randomBytes(24).toString('base64url')}Aa1!` }; await writeFile(credentialsPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 }); await superuser('upsert', [credentials.email, credentials.password]); const pb = await connect(); await removeCollections(); await pb.collections.import(definitions, false); await seedUsers(seed); await seedRows(seed); await verify(); }
  async function teardown() { let failure; try { if (credentialsPath) { await connect(); await removeCollections(); } } catch (error) { failure = error; } try { if (credentials) await superuser('delete', [credentials.email]); } catch (error) { if (!failure) failure = error; } try { await rm(credentialsPath, { force: true }); } catch (error) { if (!failure) failure = error; } client = undefined; credentials = undefined; if (failure) throw failure; }
  return {
    async setup() { try { await setupImpl(); } catch (error) { try { await teardown(); } catch (cleanup) { error.cleanupError = cleanup; } throw error; } },
    async verify() { const query = collections.map(name => `SELECT '${name}' AS table_name, CAST(count(*) AS TEXT) AS row_count FROM "${name}"`).join(' UNION ALL '); const result = await sqlRun(query); const expected = { users: DATASET_COUNTS.users, organizations: DATASET_COUNTS.organizations, memberships: DATASET_COUNTS.memberships, projects: DATASET_COUNTS.projects, tasks: DATASET_COUNTS.tasks, comments: DATASET_COUNTS.comments, activities: DATASET_COUNTS.activities }; for (const row of result.rows ?? []) if (Number(row[1]) !== expected[row[0]]) throw new Error(`PocketBase count mismatch for ${row[0]}`); return result; },
    async reset() { await teardown(); await setupImpl(); },
    teardown,
  };
}
let instance;
async function getDefault() { if (!instance) { const { default: PocketBase } = await import('pocketbase'); instance = createPocketBaseAdmin({ PocketBase, root: process.env.BAAS_BENCH_ROOT, runtime: process.env.BAAS_BENCH_RUNTIME }); } return instance; }
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
