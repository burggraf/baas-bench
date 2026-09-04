import { join } from 'node:path';
import { readEnvValue, readJson, runtimeRoot } from '../config.mjs';
import { fixture, fixtureIndex, writeRecord } from '../fixtures.mjs';

const table = 'bb_basic_js_v2_guestbook';
const fields = 'id,author,message,created_at';

function validRecord(record) {
  return record && Object.keys(record).sort().join(',') === 'author,created_at,id,message' &&
    (typeof record.id === 'string' || typeof record.id === 'number') && String(record.id).length > 0 &&
    typeof record.author === 'string' && record.author.length > 0 && record.author.length <= 32 &&
    typeof record.message === 'string' && record.message.length > 0 && record.message.length <= 256 &&
    typeof record.created_at === 'string' && Number.isFinite(Date.parse(record.created_at));
}

export function createPostgresAdapter({ Pool, platform, mode = 'direct', ids }) {
  return {
    async createClient() {
      let port = platform === 'supabase' ? 15432 : 5432;
      let user = 'postgres';
      let database = 'postgres';
      let password = 'cloud_admin';
      if (platform === 'neon') {
        port = 55433;
        user = 'cloud_admin';
      } else {
        const root = runtimeRoot();
        const envPath = platform === 'supabase' ? join(root, 'supabase/docker/.env') :
          platform === 'nhost' ? join(root, 'nhost/examples/docker-compose/.env') : join(root, 'directus/.env');
        const passwordKey = platform === 'directus' ? 'DIRECTUS_DB_PASSWORD' : 'POSTGRES_PASSWORD';
        password = await readEnvValue(envPath, passwordKey);
        if (mode === 'pooler') {
          port = 6543;
          user = `postgres.${await readEnvValue(envPath, 'POOLER_TENANT_ID')}`;
        } else {
          user = platform === 'directus' ? 'directus' : 'postgres';
        }
        database = platform === 'directus' ? 'directus' : 'postgres';
      }
      return new Pool({ host: '127.0.0.1', port, user, password, database, max: 1 });
    },
    async closeClient(client) { await client.end(); },
    async operation(client, context) {
      if (context.operation === 'list') return (await client.query(`SELECT ${fields} FROM ${table} ORDER BY created_at DESC LIMIT 20`)).rows;
      if (context.operation === 'item') {
        const index = fixtureIndex(context.trial, context.vu, context.sequence);
        return (await client.query(`SELECT ${fields} FROM ${table} WHERE id = $1`, [ids[index]])).rows[0];
      }
      if (context.operation === 'write') {
        const row = writeRecord(context);
        return (await client.query(`INSERT INTO ${table} (author, message) VALUES ($1, $2) RETURNING id`, [row.author, row.message])).rows[0];
      }
      throw new Error('invalid operation');
    },
    validate(result, context) {
      if (context.operation === 'list') {
        return Array.isArray(result) && result.length === 20 && result.every((row, offset) => {
          const index = 9_999 - offset;
          const expected = fixture(index + 1);
          return validRecord(row) && String(row.id) === String(ids[index]) && row.author === expected.author &&
            row.message === expected.message && Date.parse(row.created_at) === Date.parse(expected.created_at);
        });
      }
      if (context.operation === 'write') return result && (typeof result.id === 'string' || typeof result.id === 'number');
      if (!validRecord(result)) return false;
      const index = fixtureIndex(context.trial, context.vu, context.sequence);
      const expected = fixture(index + 1);
      return String(result.id) === String(ids[index]) && result.author === expected.author &&
        result.message === expected.message && Date.parse(result.created_at) === Date.parse(expected.created_at);
    },
  };
}

let adapter;
async function getAdapter() {
  if (!adapter) {
    const [{ Pool }] = await Promise.all([import('pg')]);
    const platform = process.env.BAAS_DB_PLATFORM;
    if (!platform) throw new Error('BAAS_DB_PLATFORM is required');
    const ids = await readJson(join(process.env.BAAS_BENCH_RUNTIME, 'state', `${platform}-ids.json`));
    adapter = createPostgresAdapter({ Pool, platform, mode: process.env.BAAS_DB_MODE, ids });
  }
  return adapter;
}
export async function createClient(context) { return (await getAdapter()).createClient(context); }
export async function closeClient(client) { return (await getAdapter()).closeClient(client); }
export async function operation(client, context) { return (await getAdapter()).operation(client, context); }
export async function validate(result, context) { return (await getAdapter()).validate(result, context); }
