import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DATASET_COUNTS, entityId, seedDataset } from '../dataset.mjs';

const tableNames = ['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities'];
export const APPWRITE_TABLES = Object.freeze(tableNames);

export function createAppwriteAdmin({ sdk, fetchImpl = fetch, runtime, endpoint = 'http://127.0.0.1:8080/v1', projectId = 'realworld-api-v3', databaseId = 'realworld-api-v3', key, tablesDB, provision, password = 'Bb-v3-42-capacity!' } = {}) {
  const state = join(runtime ?? '.', 'state'); const configPath = join(state, 'appwrite-config.json'); const consolePath = join(state, 'appwrite-console.json'); const adminPath = join(state, 'appwrite-admin.json');
  const accountEmail = 'bb-realworld-api-v3-admin3@example.test'; const accountId = 'bb-realworld-api-v3-admin3'; const teamId = 'bb-realworld-api-v3-team'; const platformId = 'bb-realworld-api-v3-web'; const keyId = 'bb-realworld-api-v3-key';
  const keyScopes = ['databases.read', 'databases.write', 'tables.read', 'tables.write', 'columns.read', 'columns.write', 'indexes.read', 'indexes.write', 'rows.read', 'rows.write', 'users.read', 'users.write'];
  let db = tablesDB; let usersService; let accountService; let projectKey = key; let cookie = ''; let accountPassword;
  const normalize = (entity, record) => { const value = { ...record }; if (entity === 'task') { const project = Number.parseInt(value.projectId.slice(5), 36); value.organizationId = entityId('organization', project % DATASET_COUNTS.organizations); } if (entity === 'comment') { const task = Number.parseInt(value.taskId.slice(5), 36); const project = task % DATASET_COUNTS.projects; value.projectId = entityId('project', project); value.organizationId = entityId('organization', project % DATASET_COUNTS.organizations); } return value; };
  async function consoleRequest(method, path, body, allowed = []) { let response; let text; for (let attempt = 0; attempt < 6; attempt += 1) { response = await fetchImpl(`${endpoint}${path}`, { method, headers: { 'content-type': 'application/json', 'x-appwrite-project': 'console', 'x-appwrite-response-format': '1.9.0', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); text = await response.text(); if (response.status !== 404 || method === 'DELETE' || attempt === 5) break; await new Promise(resolve => setTimeout(resolve, 1_000)); } if (!response.ok && !allowed.includes(response.status)) throw new Error(`Appwrite Console request failed (${response.status}) ${method} ${path}: ${text.slice(0, 500)}`); const cookies = response.headers.getSetCookie?.() ?? []; if (cookies.length) cookie = cookies.map(value => value.split(';', 1)[0]).join('; '); return text && response.ok ? JSON.parse(text) : null; }
  async function bootstrap() { const saved = await readFile(consolePath, 'utf8').then(JSON.parse).catch(() => null); accountPassword = saved?.password ?? `Bb-v3-${randomBytes(18).toString('hex')}!`; await consoleRequest('POST', '/account', { userId: accountId, email: accountEmail, password: accountPassword, name: 'baas-bench realworld-api-v3' }, [409]); await writeFile(consolePath, `${JSON.stringify({ email: accountEmail, password: accountPassword })}\n`, { mode: 0o600 }); await consoleRequest('POST', '/account/sessions/email', { email: accountEmail, password: accountPassword }); await consoleRequest('DELETE', `/projects/${projectId}`, undefined, [404]); await consoleRequest('DELETE', `/teams/${teamId}`, undefined, [404]); await consoleRequest('POST', '/teams', { teamId, name: 'baas-bench realworld-api-v3', roles: [] }); await consoleRequest('POST', '/projects', { projectId, name: 'baas-bench realworld-api-v3', teamId }); await consoleRequest('POST', `/projects/${projectId}/platforms`, { platformId, type: 'web', name: 'localhost', hostname: 'localhost' }); const created = await consoleRequest('POST', `/projects/${projectId}/keys`, { keyId, name: 'baas-bench realworld-api-v3', scopes: keyScopes }); if (!created?.secret) throw new Error('Appwrite project key response has no secret'); projectKey = created.secret; await writeFile(adminPath, `${JSON.stringify({ projectId, key: projectKey })}\n`, { mode: 0o600 }); }
  function connect() { const client = new sdk.Client().setEndpoint(endpoint).setProject(projectId).setKey(projectKey); db = db ?? new sdk.TablesDB(client); }
  async function ensureClient() { if (!db) { if (!projectKey) throw new Error('Appwrite project key is missing'); connect(); } }
  async function ensureTables() {
    if (typeof provision === 'function') return provision();
    if (!sdk) throw new Error('Appwrite SDK is unavailable');
    if (!projectKey) await bootstrap();
    const client = new sdk.Client().setEndpoint(endpoint).setProject(projectId).setKey(projectKey);
    const tables = db ?? new sdk.TablesDB(client); db = tables; usersService = usersService ?? new sdk.Users(client); accountService = accountService ?? new sdk.Account(new sdk.Client().setEndpoint(endpoint).setProject(projectId));
    await tables.create({ databaseId, name: 'realworld-api-v3', enabled: true }).catch(error => { if (error?.code !== 409) throw error; });
    const columns = { users: ['id', 'email', 'displayName', 'createdAt', 'updatedAt'], organizations: ['id', 'name', 'ownerId', 'createdAt'], memberships: ['id', 'organizationId', 'userId', 'role', 'createdAt'], projects: ['id', 'organizationId', 'name', 'status', 'createdAt', 'updatedAt'], tasks: ['id', 'organizationId', 'projectId', 'creatorId', 'assigneeId', 'title', 'description', 'status', 'priority', 'dueDate', 'createdAt', 'updatedAt'], comments: ['id', 'organizationId', 'projectId', 'taskId', 'authorId', 'body', 'createdAt', 'updatedAt'], activities: ['id', 'organizationId', 'projectId', 'actorId', 'action', 'subjectType', 'subjectId', 'createdAt'] };
    for (const tableId of tableNames) { const permissions = ['read("users")', 'write("users")']; await tables.createTable({ databaseId, tableId, name: tableId, permissions, enabled: true, rowSecurity: false }).catch(async error => { if (error?.code !== 409) throw error; await tables.updateTable({ databaseId, tableId, permissions, rowSecurity: false, enabled: true }); }); for (const key of columns[tableId]) await tables.createStringColumn({ databaseId, tableId, key, size: 512, required: false }).catch(error => { if (error?.code !== 409) throw error; }); }
  }
  async function teardown() { let failure; if (db?.delete) { try { await db.delete({ databaseId }); } catch (error) { if (error?.code !== 404) failure = error; } } try { await consoleRequest('DELETE', `/projects/${projectId}`, undefined, [404]); await consoleRequest('DELETE', `/teams/${teamId}`, undefined, [404]); await consoleRequest('DELETE', '/account', undefined, [404]); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); } try { await rm(configPath, { force: true }); await rm(adminPath, { force: true }); await rm(consolePath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); } if (failure) throw failure; }
  return {
    async setup() {
      try {
        await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700); if (!key) projectKey = undefined; await ensureTables();
        for await (const batch of seedDataset(42, 100)) { const rows = batch.records.map(record => ({ $id: record.id, ...normalize(batch.entity, record) })); await db.createRows({ databaseId, tableId: batch.entity === 'user' ? 'users' : batch.entity === 'activity' ? 'activities' : `${batch.entity}s`, rows }); if (batch.entity === 'user') await Promise.all(batch.records.map(record => accountService.create({ userId: record.id, email: record.email, password, name: record.displayName }).catch(error => { if (error?.code !== 409) throw error; }))); }
        await writeFile(configPath, `${JSON.stringify({ endpoint, projectId, databaseId })}\n`, { mode: 0o600 });
        await this.verify();
      } catch (error) { try { await teardown(); } catch (cleanup) { if (error && typeof error === 'object') error.cleanupError = String(cleanup?.message ?? cleanup); } throw error; }
    },
    async verify() { await ensureClient(); for (const tableId of tableNames) { const result = await db.listRows({ databaseId, tableId, queries: [], total: true }); if (!Array.isArray(result.rows)) throw new Error(`invalid Appwrite ${tableId} response`); } },
    async reset() { await ensureClient(); for (const tableId of tableNames) await db.deleteRows({ databaseId, tableId, queries: [] }); await this.verify(); },
    teardown,
  };
}
let instance;
async function getDefault() { if (!instance) { const sdk = await import('node-appwrite'); const saved = await readFile(join(process.env.BAAS_BENCH_RUNTIME, 'state/appwrite-admin.json'), 'utf8').then(JSON.parse).catch(() => null); instance = createAppwriteAdmin({ sdk, runtime: process.env.BAAS_BENCH_RUNTIME, projectId: saved?.projectId ?? 'realworld-api-v3', key: process.env.APPWRITE_ADMIN_KEY ?? saved?.key }); } return instance; }
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
