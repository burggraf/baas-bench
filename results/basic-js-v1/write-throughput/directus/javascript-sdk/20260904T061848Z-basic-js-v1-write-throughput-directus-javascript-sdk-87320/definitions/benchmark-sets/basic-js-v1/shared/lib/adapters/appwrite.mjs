import { join } from 'node:path';

import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readJson } from '../config.mjs';

const selectedFields = ['$id', 'author', 'message', '$createdAt'];

function normalize(row) {
  return row && { id: row.$id, author: row.author, message: row.message, created_at: row.$createdAt };
}

function validRecord(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    typeof record.id === 'string' && record.id.length > 0 &&
    typeof record.author === 'string' && record.author.length > 0 && record.author.length <= 32 &&
    typeof record.message === 'string' && record.message.length > 0 && record.message.length <= 256 &&
    typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

export function createAppwriteAdapter({ Client, TablesDB, Query, ID, projectId, databaseId, tableId, ids, selectFixtureIndex = fixtureIndex }) {
  return {
    async createClient() {
      const client = new Client().setEndpoint('http://127.0.0.1:8080/v1').setProject(projectId);
      return new TablesDB(client);
    },

    async operation(tables, context) {
      if (context.operation === 'list') {
        const result = await tables.listRows({
          databaseId,
          tableId,
          queries: [Query.select(selectedFields), Query.orderDesc('$createdAt'), Query.orderDesc('$id'), Query.limit(20)],
          total: false,
        });
        return result.rows?.map(normalize);
      }
      if (context.operation === 'item') {
        const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
        const rowId = ids[index];
        if (rowId === undefined) throw new Error(`missing Appwrite fixture ID at index ${index}`);
        return normalize(await tables.getRow({ databaseId, tableId, rowId, queries: [Query.select(selectedFields)] }));
      }
      if (context.operation === 'write') {
        const row = await tables.createRow({ databaseId, tableId, rowId: ID.unique(), data: writeRecord(context) });
        return { id: row?.$id };
      }
      throw new Error('invalid operation');
    },

    validate(result, context) {
      if (context.operation === 'list') return Array.isArray(result) && result.length === 20 && result.every(validRecord);
      if (context.operation === 'write') return result && typeof result.id === 'string' && result.id.length > 0;
      if (!validRecord(result)) return false;
      const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
      const expected = fixture(index + 1);
      return result.id === ids[index] && result.author === expected.author && result.message === expected.message;
    },
  };
}

let defaultAdapter;
async function getDefaultAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = (async () => {
      const [{ Client, TablesDB, Query, ID }, state, ids] = await Promise.all([
        import('appwrite'),
        readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/appwrite.json')),
        readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/appwrite-ids.json')),
      ]);
      return createAppwriteAdapter({ Client, TablesDB, Query, ID, ...state, ids });
    })();
  }
  return defaultAdapter;
}

export async function createClient(context) { return (await getDefaultAdapter()).createClient(context); }
export async function operation(client, context) { return (await getDefaultAdapter()).operation(client, context); }
export async function validate(result, context) { return (await getDefaultAdapter()).validate(result, context); }
