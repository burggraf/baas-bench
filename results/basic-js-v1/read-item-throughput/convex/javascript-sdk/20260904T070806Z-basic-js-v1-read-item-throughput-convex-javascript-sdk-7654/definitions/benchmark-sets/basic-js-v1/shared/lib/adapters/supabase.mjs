import { join } from 'node:path';

import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';
import { readEnvValue, readJson, runtimeRoot } from '../config.mjs';

const table = 'bb_basic_js_v1_guestbook';
const fields = 'id,author,message,created_at';

function requestError(error) {
  if (error) throw new Error(error.message || 'Supabase request failed');
}

function validRecord(record) {
  return record &&
    Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    (typeof record.id === 'string' || typeof record.id === 'number') && String(record.id).length > 0 &&
    typeof record.author === 'string' && record.author.length > 0 && record.author.length <= 32 &&
    typeof record.message === 'string' && record.message.length > 0 && record.message.length <= 256 &&
    typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

export function createSupabaseAdapter({ sdkCreateClient, url, key, ids, selectFixtureIndex = fixtureIndex }) {
  return {
    async createClient() {
      return sdkCreateClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    },

    async operation(client, context) {
      if (context.operation === 'list') {
        const { data, error } = await client.from(table)
          .select(fields)
          .order('created_at', { ascending: false })
          .limit(20);
        requestError(error);
        return data;
      }
      if (context.operation === 'item') {
        const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
        const id = ids[index];
        if (id === undefined) throw new Error(`missing Supabase fixture ID at index ${index}`);
        const { data, error } = await client.from(table).select(fields).eq('id', id).single();
        requestError(error);
        return data;
      }
      if (context.operation === 'write') {
        const { data, error } = await client.from(table)
          .insert(writeRecord(context))
          .select('id')
          .single();
        requestError(error);
        return { id: data?.id };
      }
      throw new Error('invalid operation');
    },

    validate(result, context) {
      if (context.operation === 'list') return Array.isArray(result) && result.length === 20 && result.every(validRecord);
      if (context.operation === 'write') return result && (typeof result.id === 'string' || typeof result.id === 'number') && String(result.id).length > 0;
      if (!validRecord(result)) return false;
      const index = selectFixtureIndex(context.trial, context.vu, context.sequence);
      const expected = fixture(index + 1);
      return String(result.id) === String(ids[index]) &&
        result.author === expected.author &&
        result.message === expected.message &&
        Date.parse(result.created_at) === Date.parse(expected.created_at);
    },
  };
}

let defaultAdapter;
async function getDefaultAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = (async () => {
      const [{ createClient: sdkCreateClient }, key, ids] = await Promise.all([
        import('@supabase/supabase-js'),
        readEnvValue(join(runtimeRoot(), 'supabase/docker/.env'), 'SUPABASE_PUBLISHABLE_KEY'),
        readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state/supabase-ids.json')),
      ]);
      return createSupabaseAdapter({ sdkCreateClient, url: 'http://127.0.0.1:8000', key, ids });
    })();
  }
  return defaultAdapter;
}

export async function createClient(context) {
  return (await getDefaultAdapter()).createClient(context);
}

export async function operation(client, context) {
  return (await getDefaultAdapter()).operation(client, context);
}

export async function validate(result, context) {
  return (await getDefaultAdapter()).validate(result, context);
}
