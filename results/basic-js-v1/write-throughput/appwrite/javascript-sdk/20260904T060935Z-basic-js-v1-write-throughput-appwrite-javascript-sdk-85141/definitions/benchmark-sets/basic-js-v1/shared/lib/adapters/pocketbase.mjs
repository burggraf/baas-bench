import { join } from 'node:path';

import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readJson } from '../config.mjs';

const collection = 'bb_basic_js_v1_guestbook';
const fields = 'id,author,message,created_at';

function normalize(record) {
  return record && {
    id: record.id,
    author: record.author,
    message: record.message,
    created_at: record.created_at,
  };
}

function validRecord(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    typeof record.id === 'string' && record.id.length > 0 &&
    typeof record.author === 'string' && record.author.length > 0 && record.author.length <= 32 &&
    typeof record.message === 'string' && record.message.length > 0 && record.message.length <= 256 &&
    typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

export function createPocketBaseAdapter({ PocketBase, ids, selectFixtureIndex = fixtureIndex }) {
  return {
    async createClient() {
      return new PocketBase('http://127.0.0.1:8090');
    },

    async operation(client, context) {
      const records = client.collection(collection);
      if (context.operation === 'list') {
        const result = await records.getList(1, 20, {
          sort: '-created_at',
          fields,
          skipTotal: true,
        });
        return result?.items?.map(normalize);
      }
      if (context.operation === 'item') {
        const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
        const id = ids[index];
        if (id === undefined) throw new Error(`missing PocketBase fixture ID at index ${index}`);
        const result = normalize(await records.getOne(id, { fields }));
        if (!result) throw new Error('PocketBase item response has no record');
        return result;
      }
      if (context.operation === 'write') {
        const result = await records.create(writeRecord(context), { fields: 'id' });
        if (typeof result?.id !== 'string' || result.id.length === 0) throw new Error('PocketBase create response has no ID');
        return { id: result.id };
      }
      throw new Error('invalid operation');
    },

    validate(result, context) {
      if (context.operation === 'list') return Array.isArray(result) && result.length === 20 && result.every(validRecord);
      if (context.operation === 'write') return result && typeof result.id === 'string' && result.id.length > 0;
      if (!validRecord(result)) return false;
      const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
      const expected = fixture(index + 1);
      return result.id === ids[index] && result.author === expected.author && result.message === expected.message &&
        Date.parse(result.created_at) === Date.parse(expected.created_at);
    },
  };
}

let defaultAdapter;
async function getDefaultAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = (async () => {
      const [{ default: PocketBase }, ids] = await Promise.all([
        import('pocketbase'),
        readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/pocketbase-ids.json')),
      ]);
      return createPocketBaseAdapter({ PocketBase, ids });
    })();
  }
  return defaultAdapter;
}

export async function createClient(context) { return (await getDefaultAdapter()).createClient(context); }
export async function operation(client, context) { return (await getDefaultAdapter()).operation(client, context); }
export async function validate(result, context) { return (await getDefaultAdapter()).validate(result, context); }
