import { join } from 'node:path';

import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readJson } from '../config.mjs';

function validRecord(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    typeof record.id === 'string' && record.id.length > 0 &&
    typeof record.author === 'string' && record.author.length > 0 && record.author.length <= 32 &&
    typeof record.message === 'string' && record.message.length > 0 && record.message.length <= 256 &&
    typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

export function createConvexAdapter({ ConvexHttpClient, api, ids, selectFixtureIndex = fixtureIndex }) {
  return {
    async createClient() { return new ConvexHttpClient('http://127.0.0.1:3210'); },

    async operation(client, context) {
      if (context.operation === 'list') return client.query(api.guestbook.list, {});
      if (context.operation === 'item') {
        const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
        const id = ids[index];
        if (id === undefined) throw new Error(`missing Convex fixture ID at index ${index}`);
        return client.query(api.guestbook.get, { id });
      }
      if (context.operation === 'write') {
        const id = await client.mutation(api.guestbook.create, writeRecord(context));
        return { id };
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
      const [{ ConvexHttpClient }, { api }, ids] = await Promise.all([
        import('convex/browser'),
        import('../../convex/_generated/api.js'),
        readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/convex-ids.json')),
      ]);
      return createConvexAdapter({ ConvexHttpClient, api, ids });
    })();
  }
  return defaultAdapter;
}

export async function createClient(context) { return (await getDefaultAdapter()).createClient(context); }
export async function operation(client, context) { return (await getDefaultAdapter()).operation(client, context); }
export async function validate(result, context) { return (await getDefaultAdapter()).validate(result, context); }
