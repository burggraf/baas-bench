import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedDataset } from '../dataset.mjs';

const tableNames = ['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities'];
export const APPWRITE_TABLES = Object.freeze(tableNames);

export function createAppwriteAdmin({ sdk, runtime, endpoint = 'http://127.0.0.1:8080/v1', projectId = 'realworld-api-v3', databaseId = 'realworld-api-v3', key, tablesDB, provision } = {}) {
  const state = join(runtime ?? '.', 'state'); const configPath = join(state, 'appwrite-config.json');
  let db = tablesDB;
  async function ensureTables() {
    if (typeof provision === 'function') return provision();
    if (!sdk || !key) throw new Error('Appwrite administration requires SDK and project key');
    const client = new sdk.Client().setEndpoint(endpoint).setProject(projectId).setKey(key);
    const tables = db ?? new sdk.TablesDB(client); db = tables;
    await tables.create({ databaseId, name: 'realworld-api-v3', enabled: true }).catch(error => { if (error?.code !== 409) throw error; });
    for (const tableId of tableNames) await tables.createTable({ databaseId, tableId, name: tableId, enabled: true, rowSecurity: true }).catch(error => { if (error?.code !== 409) throw error; });
  }
  async function teardown() { let failure; if (db?.delete) { try { await db.delete({ databaseId }); } catch (error) { if (error?.code !== 404) failure = error; } } try { await rm(configPath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); } if (failure) throw failure; }
  return {
    async setup() {
      try {
        await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700); await ensureTables();
        for await (const batch of seedDataset(42, 100)) { const rows = batch.records.map(record => ({ rowId: record.id, data: record })); await db.createRows({ databaseId, tableId: batch.entity === 'user' ? 'users' : `${batch.entity}s`, rows }); }
        await writeFile(configPath, `${JSON.stringify({ endpoint, projectId, databaseId })}\n`, { mode: 0o600 });
        await this.verify();
      } catch (error) { try { await teardown(); } catch (cleanup) { if (error && typeof error === 'object') error.cleanupError = String(cleanup?.message ?? cleanup); } throw error; }
    },
    async verify() { if (!db) throw new Error('Appwrite TablesDB is not configured'); for (const tableId of tableNames) { const result = await db.listRows({ databaseId, tableId, queries: [], total: true }); if (!Array.isArray(result.rows)) throw new Error(`invalid Appwrite ${tableId} response`); } },
    async reset() { if (!db) throw new Error('Appwrite TablesDB is not configured'); for (const tableId of tableNames) await db.deleteRows({ databaseId, tableId, queries: [] }); await this.verify(); },
    teardown,
  };
}
let instance;
async function getDefault() { if (!instance) { const sdk = await import('node-appwrite'); instance = createAppwriteAdmin({ sdk, runtime: process.env.BAAS_BENCH_RUNTIME, key: process.env.APPWRITE_ADMIN_KEY }); } return instance; }
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
