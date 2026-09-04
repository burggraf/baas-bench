import { join } from 'node:path';

import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readJson } from '../config.mjs';

const apiName = 'bb_basic_js_v1_guestbook';

function normalize(record) {
  return record && {
    id: record.id,
    author: record.author,
    message: record.message,
    created_at: record.created_at,
  };
}

function validId(value) {
  return (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && value.length > 0);
}

function validRecord(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    validId(record.id) &&
    typeof record.author === 'string' && record.author.length > 0 && record.author.length <= 32 &&
    typeof record.message === 'string' && record.message.length > 0 && record.message.length <= 256 &&
    typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

export function createTrailBaseAdapter({ initClient, ids, selectFixtureIndex = fixtureIndex }) {
  return {
    async createClient() {
      return initClient('http://127.0.0.1:4000');
    },

    async operation(client, context) {
      const records = client.records(apiName);
      if (context.operation === 'list') {
        const result = await records.list({ pagination: { limit: 20 }, order: ['-created_at'] });
        return Array.isArray(result?.records) ? result.records.map(normalize) : undefined;
      }
      if (context.operation === 'item') {
        const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
        const id = ids[index];
        if (id === undefined) throw new Error(`missing TrailBase fixture ID at index ${index}`);
        const result = normalize(await records.read(id));
        if (!result) throw new Error('TrailBase item response has no record');
        return result;
      }
      if (context.operation === 'write') {
        const id = await records.create(writeRecord(context));
        if (!validId(id)) throw new Error('TrailBase create response has no scalar ID');
        return { id };
      }
      throw new Error('invalid operation');
    },

    validate(result, context) {
      if (context.operation === 'list') return Array.isArray(result) && result.length === 20 && result.every(validRecord);
      if (context.operation === 'write') return result && validId(result.id);
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
      const [{ initClient }, ids] = await Promise.all([
        import('trailbase'),
        readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/trailbase-ids.json')),
      ]);
      return createTrailBaseAdapter({ initClient, ids });
    })();
  }
  return defaultAdapter;
}

export async function createClient(context) { return (await getDefaultAdapter()).createClient(context); }
export async function operation(client, context) { return (await getDefaultAdapter()).operation(client, context); }
export async function validate(result, context) { return (await getDefaultAdapter()).validate(result, context); }
