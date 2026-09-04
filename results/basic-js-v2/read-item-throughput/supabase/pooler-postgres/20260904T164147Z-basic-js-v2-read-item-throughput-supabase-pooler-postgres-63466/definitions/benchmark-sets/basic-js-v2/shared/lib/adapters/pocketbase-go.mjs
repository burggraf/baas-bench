import { join } from 'node:path';
import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readJson } from '../config.mjs';

function validRecord(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    typeof record.id === 'string' && record.id.length > 0 && typeof record.author === 'string' &&
    typeof record.message === 'string' && typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

export function createPocketBaseGoAdapter({ ids, fetchImpl = fetch, endpoint = 'http://127.0.0.1:8090' }) {
  async function request(path, options) {
    const response = await fetchImpl(`${endpoint}${path}`, options);
    if (!response.ok) throw new Error(`PocketBase Go extension request failed (${response.status})`);
    return response.json();
  }

  return {
    async createClient() { return {}; },
    async operation(_client, context) {
      if (context.operation === 'list') return request('/bb-basic-js-v2/list');
      if (context.operation === 'item') {
        const index = fixtureIndex(context.trial, context.vu, context.sequence);
        return request(`/bb-basic-js-v2/item?id=${encodeURIComponent(ids[index])}`);
      }
      if (context.operation === 'write') {
        return request('/bb-basic-js-v2/write', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(writeRecord(context)),
        });
      }
      throw new Error('invalid operation');
    },
    validate(result, context) {
      if (context.operation === 'list') {
        return Array.isArray(result) && result.length === 20 && result.every((row, offset) => {
          const index = 9_999 - offset;
          const expected = fixture(index + 1);
          return validRecord(row) && row.id === ids[index] && row.author === expected.author &&
            row.message === expected.message && Date.parse(row.created_at) === Date.parse(expected.created_at);
        });
      }
      if (context.operation === 'write') return result && typeof result.id === 'string' && result.id.length > 0;
      if (!validRecord(result)) return false;
      const index = fixtureIndex(context.trial, context.vu, context.sequence);
      const expected = fixture(index + 1);
      return result.id === ids[index] && result.author === expected.author &&
        result.message === expected.message && Date.parse(result.created_at) === Date.parse(expected.created_at);
    },
  };
}

let adapter;
async function getAdapter() {
  if (!adapter) {
    const ids = await readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/pocketbase-ids.json'));
    adapter = createPocketBaseGoAdapter({ ids });
  }
  return adapter;
}
export async function createClient(context) { return (await getAdapter()).createClient(context); }
export async function operation(client, context) { return (await getAdapter()).operation(client, context); }
export async function validate(result, context) { return (await getAdapter()).validate(result, context); }
