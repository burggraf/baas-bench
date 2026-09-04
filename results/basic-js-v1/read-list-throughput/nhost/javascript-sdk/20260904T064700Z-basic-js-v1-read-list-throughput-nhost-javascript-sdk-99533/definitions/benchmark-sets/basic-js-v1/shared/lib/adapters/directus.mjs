import { join } from 'node:path';
import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readJson } from '../config.mjs';

const collection = 'bb_basic_js_v1_guestbook';
const fields = ['id', 'author', 'message', 'created_at'];

function normalize(record) {
  return record && { id: record.id, author: record.author, message: record.message, created_at: record.created_at };
}
function valid(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    Number.isInteger(record.id) && record.id > 0 && typeof record.author === 'string' && record.author.length > 0 &&
    record.author.length <= 32 && typeof record.message === 'string' && record.message.length > 0 &&
    record.message.length <= 256 && typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

export function createDirectusAdapter({ createDirectus, rest, readItems, readItem, createItem, endpoint = 'http://127.0.0.1:8055', ids, selectFixtureIndex = fixtureIndex }) {
  return {
    async createClient() { return createDirectus(endpoint).with(rest()); },
    async operation(client, context) {
      if (context.operation === 'list') return (await client.request(readItems(collection, { fields, sort: ['-created_at'], limit: 20 }))).map(normalize);
      if (context.operation === 'item') {
        const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
        const id = ids[index];
        if (id === undefined) throw new Error(`missing Directus fixture ID at index ${index}`);
        const row = await client.request(readItem(collection, id, { fields }));
        if (!row) throw new Error('Directus item response is empty');
        return normalize(row);
      }
      if (context.operation === 'write') {
        const row = await client.request(createItem(collection, writeRecord(context), { fields: ['id'] }));
        if (!row || row.id === undefined || row.id === null || row.id === '') throw new Error('Directus write response has no ID');
        return { id: row.id };
      }
      throw new Error('invalid operation');
    },
    validate(result, context) {
      if (context.operation === 'list') return Array.isArray(result) && result.length === 20 && result.every(valid);
      if (context.operation === 'write') return result && Number.isInteger(result.id) && result.id > 0;
      if (!valid(result)) return false;
      const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
      const expected = fixture(index + 1);
      return result.id === ids[index] && result.author === expected.author && result.message === expected.message &&
        Date.parse(result.created_at) === Date.parse(expected.created_at);
    },
  };
}

let defaultAdapter;
async function getDefaultAdapter() {
  if (!defaultAdapter) defaultAdapter = (async () => {
    const [{ createDirectus, rest, readItems, readItem, createItem }, ids] = await Promise.all([
      import('@directus/sdk'), readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/directus-ids.json')),
    ]);
    return createDirectusAdapter({ createDirectus, rest, readItems, readItem, createItem, ids });
  })();
  return defaultAdapter;
}
export async function createClient(context) { return (await getDefaultAdapter()).createClient(context); }
export async function operation(client, context) { return (await getDefaultAdapter()).operation(client, context); }
export async function validate(result, context) { return (await getDefaultAdapter()).validate(result, context); }
