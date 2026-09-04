import { join } from 'node:path';
import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readJson } from '../config.mjs';

const endpoint = 'http://127.0.0.1:4000';

function validRecord(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    Number.isSafeInteger(record.id) && typeof record.author === 'string' &&
    typeof record.message === 'string' && typeof record.created_at === 'string' &&
    Number.isFinite(Date.parse(record.created_at));
}

async function request(path, options) {
  const response = await fetch(`${endpoint}${path}`, options);
  if (!response.ok) throw new Error(`TrailBase WASM request failed (${response.status})`);
  return response.json();
}

let ids;
async function fixtureIds() {
  if (!ids) ids = await readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/trailbase-ids.json'));
  return ids;
}

export async function createClient() { return {}; }

export async function operation(_client, context) {
  if (context.operation === 'list') return request('/bb-basic-js-v2/list');
  if (context.operation === 'item') {
    const index = fixtureIndex(context.trial, context.vu, context.sequence);
    return request(`/bb-basic-js-v2/item?id=${encodeURIComponent((await fixtureIds())[index])}`);
  }
  if (context.operation === 'write') {
    return request('/bb-basic-js-v2/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(writeRecord(context)),
    });
  }
  throw new Error('invalid operation');
}

export async function validate(result, context) {
  if (context.operation === 'list') {
    const fixtureIdsValue = await fixtureIds();
    return Array.isArray(result) && result.length === 20 && result.every((row, offset) => {
      const index = 9_999 - offset;
      const expected = fixture(index + 1);
      return validRecord(row) && row.id === Number(fixtureIdsValue[index]) && row.author === expected.author &&
        row.message === expected.message && Date.parse(row.created_at) === Date.parse(expected.created_at);
    });
  }
  if (context.operation === 'write') return result && Number.isSafeInteger(result.id);
  if (!validRecord(result)) return false;
  const index = fixtureIndex(context.trial, context.vu, context.sequence);
  const expected = fixture(index + 1);
  return result.id === Number((await fixtureIds())[index]) && result.author === expected.author &&
    result.message === expected.message && Date.parse(result.created_at) === Date.parse(expected.created_at);
}
