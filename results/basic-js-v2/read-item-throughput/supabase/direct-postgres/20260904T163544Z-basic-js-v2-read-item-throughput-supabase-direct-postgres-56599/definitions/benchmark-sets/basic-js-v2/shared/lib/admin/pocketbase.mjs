import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fixture, fixtures, writeRecord } from '../fixtures.mjs';
import { runCommand } from '../command.mjs';
import { readJson } from '../config.mjs';

const collection = 'bb_basic_js_v2_guestbook';
const endpoint = 'http://127.0.0.1:8090';
const superuserEmail = 'basic-js-v2-pocketbase@localhost.invalid';
const createdIndex = 'CREATE INDEX idx_bb_basic_js_v2_guestbook_created_at ON bb_basic_js_v2_guestbook (created_at DESC)';
const fixtureIndexSql = 'CREATE UNIQUE INDEX idx_bb_basic_js_v2_guestbook_fixture_key ON bb_basic_js_v2_guestbook (fixture_key) WHERE fixture_key IS NOT NULL';
const definition = {
  name: collection,
  type: 'base',
  listRule: '',
  viewRule: '',
  createRule: '@request.body.fixture_key:isset = false && @request.body.created_at:isset = false',
  updateRule: null,
  deleteRule: null,
  fields: [
    { name: 'author', type: 'text', required: true, min: 1, max: 32 },
    { name: 'message', type: 'text', required: true, min: 1, max: 256 },
    { name: 'created_at', type: 'autodate', onCreate: true, onUpdate: false },
    { name: 'fixture_key', type: 'json', required: false, maxSize: 32 },
  ],
  indexes: [createdIndex, fixtureIndexSql],
};

function statusOf(error) {
  return error?.status ?? error?.response?.status ?? error?.cause?.status;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function validId(value) {
  return typeof value === 'string' && value.length > 0;
}

function newCredentials() {
  return { email: superuserEmail, password: `${randomBytes(24).toString('base64url')}Aa1!` };
}

function validateCredentials(value) {
  if (!value || typeof value.email !== 'string' || !value.email || typeof value.password !== 'string' || !value.password ||
      /[\u0000-\u001f\u007f]/.test(value.email) || /[\u0000-\u001f\u007f]/.test(value.password)) {
    throw new Error('PocketBase superuser credentials are invalid');
  }
  return value;
}

function attachCleanupError(original, cleanupError) {
  if (original instanceof Error) {
    original.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
}

export function createPocketBaseAdmin({ PocketBase, run = runCommand, root, runtime, credentials }) {
  const stateDir = join(runtime, 'state');
  const credentialsPath = join(stateDir, 'pocketbase-superuser.json');
  const idsPath = join(stateDir, 'pocketbase-ids.json');
  const command = join(root, 'bin/baas');
  let activeCredentials = credentials ? validateCredentials(credentials) : undefined;
  let client;

  async function saveJson(path, value) {
    await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  }

  async function loadCredentials() {
    if (!activeCredentials) activeCredentials = validateCredentials(await readJson(credentialsPath));
    return activeCredentials;
  }

  async function superuser(action, values) {
    return run(command, [
      'compose', 'pocketbase', 'exec', '-T', 'pocketbase', '/pb/pocketbase', '--dir=/pb/pb_data',
      'superuser', action, ...values,
    ]);
  }

  async function connect() {
    if (client) return client;
    const value = await loadCredentials();
    const next = new PocketBase(endpoint);
    await next.collection('_superusers').authWithPassword(value.email, value.password);
    client = next;
    return client;
  }

  async function runSql(query) {
    if (Buffer.byteLength(query, 'utf8') >= 5000) throw new Error('PocketBase administrative SQL exceeds 4999 bytes');
    return (await connect()).sql.run(query);
  }

  async function collectionExists() {
    try {
      await (await connect()).collections.getOne(collection);
      return true;
    } catch (error) {
      if (statusOf(error) === 404) return false;
      throw error;
    }
  }

  async function removeCollection() {
    if (await collectionExists()) await (await connect()).collections.delete(collection);
  }

  async function verifySchema() {
    const actual = await (await connect()).collections.getOne(collection);
    if (actual.name !== collection || actual.type !== 'base' || actual.listRule !== '' || actual.viewRule !== '' ||
        actual.createRule !== definition.createRule || actual.updateRule !== null || actual.deleteRule !== null) {
      throw new Error('PocketBase collection rules are invalid');
    }
    const fields = Object.fromEntries(actual.fields.map((field) => [field.name, field]));
    if (fields.author?.type !== 'text' || fields.author.required !== true || fields.author.min !== 1 || fields.author.max !== 32 ||
        fields.message?.type !== 'text' || fields.message.required !== true || fields.message.min !== 1 || fields.message.max !== 256 ||
        fields.created_at?.type !== 'autodate' || fields.created_at.onCreate !== true || fields.created_at.onUpdate !== false ||
        fields.fixture_key?.type !== 'json' || fields.fixture_key.required !== false || fields.fixture_key.maxSize !== 32) {
      throw new Error('PocketBase collection fields are invalid');
    }
    if (!Array.isArray(actual.indexes) || !actual.indexes.includes(createdIndex) || !actual.indexes.includes(fixtureIndexSql)) {
      throw new Error('PocketBase collection indexes are invalid');
    }
  }

  async function readBaseline(expectedWrites) {
    const counts = await runSql(`SELECT count(*), count(fixture_key), sum(CASE WHEN fixture_key IS NULL THEN 1 ELSE 0 END) FROM "${collection}"`);
    const countRow = counts.rows?.[0];
    const total = Number(countRow?.[0]);
    const baseline = Number(countRow?.[1]);
    const writes = Number(countRow?.[2]);
    if (!Number.isInteger(total) || baseline !== 10_000 || writes !== total - 10_000 ||
        (expectedWrites !== undefined && writes !== expectedWrites)) {
      throw new Error('PocketBase baseline counts are invalid');
    }

    const ids = [];
    for (let offset = 0; offset < 10_000; offset += 1000) {
      const result = await runSql(`SELECT fixture_key, id, author, message, created_at FROM "${collection}" WHERE fixture_key IS NOT NULL ORDER BY CAST(fixture_key AS INTEGER) LIMIT 1000 OFFSET ${offset}`);
      if (!Array.isArray(result.rows) || result.rows.length !== 1000) throw new Error('PocketBase baseline page is invalid');
      for (let index = 0; index < result.rows.length; index += 1) {
        const row = result.rows[index];
        const expected = fixture(offset + index + 1);
        const key = Number(row?.[0]);
        if (!Number.isInteger(key) || key !== expected.fixture_key || !validId(row?.[1]) || row?.[2] !== expected.author ||
            row?.[3] !== expected.message || typeof row?.[4] !== 'string' || Date.parse(row[4]) !== Date.parse(expected.created_at)) {
          throw new Error('PocketBase baseline row is invalid');
        }
        ids.push(row[1]);
      }
    }
    return ids;
  }

  async function insertFixtures() {
    const prefix = `INSERT INTO "${collection}" (fixture_key, author, message, created_at) VALUES `;
    let values = [];
    async function flush() {
      if (values.length === 0) return;
      await runSql(`${prefix}${values.join(',')}`);
      values = [];
    }
    for (const row of fixtures()) {
      const value = `(${row.fixture_key},${sqlLiteral(row.author)},${sqlLiteral(row.message)},${sqlLiteral(row.created_at)})`;
      if (Buffer.byteLength(`${prefix}${[...values, value].join(',')}`, 'utf8') >= 5000) await flush();
      values.push(value);
    }
    await flush();
  }

  async function teardown() {
    let original;
    let value;
    try {
      value = await loadCredentials();
      await removeCollection();
    } catch (error) {
      if (error?.code !== 'ENOENT') original = error;
    }
    if (value) {
      try {
        await runSql(`DELETE FROM "_superusers" WHERE email = ${sqlLiteral(value.email)}`);
      } catch (error) {
        if (!original) original = error;
        else attachCleanupError(original, error);
      }
    }
    try {
      await Promise.all([rm(credentialsPath, { force: true }), rm(idsPath, { force: true })]);
    } catch (error) {
      if (!original) original = error;
      else attachCleanupError(original, error);
    }
    client = undefined;
    activeCredentials = undefined;
    if (original) throw original;
  }

  async function setupImpl() {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    activeCredentials = credentials ? validateCredentials(credentials) : newCredentials();
    await saveJson(credentialsPath, activeCredentials);
    await superuser('upsert', [activeCredentials.email, activeCredentials.password]);
    await removeCollection();
    await (await connect()).collections.create(definition);
    await verifySchema();
    await insertFixtures();
    const ids = await readBaseline(0);
    await saveJson(idsPath, ids);
  }

  return {
    async setup() {
      try {
        await setupImpl();
      } catch (error) {
        try {
          await teardown();
        } catch (cleanupError) {
          attachCleanupError(error, cleanupError);
        }
        throw error;
      }
    },

    async verify() {
      await verifySchema();
      await readBaseline();
    },

    async reset() {
      await runSql(`DELETE FROM "${collection}" WHERE fixture_key IS NULL`);
      await readBaseline(0);
    },

    teardown,

    async verifyReadiness(context) {
      if (context.operation === 'list') {
        const ids = await readJson(idsPath);
        if (!Array.isArray(context.result) || context.result.length !== 20 || context.result.some((row, index) => {
          const fixtureNumber = 10_000 - index;
          const expected = fixture(fixtureNumber);
          return row.id !== ids[fixtureNumber - 1] || row.author !== expected.author || row.message !== expected.message ||
            Date.parse(row.created_at) !== Date.parse(expected.created_at);
        })) throw new Error('PocketBase list readiness verification failed');
      } else if (context.operation === 'write') {
        if (!validId(context.result?.id)) throw new Error('PocketBase readiness write has no ID');
        const result = await runSql(`SELECT author, message, created_at, fixture_key FROM "${collection}" WHERE id = ${sqlLiteral(context.result.id)}`);
        const row = result.rows?.[0];
        const expected = writeRecord(context);
        if (!row || row[0] !== expected.author || row[1] !== expected.message || typeof row[2] !== 'string' ||
            !Number.isFinite(Date.parse(row[2])) || row[3] !== null) {
          throw new Error('PocketBase readiness write is invalid');
        }
      }
    },

    async cleanupReadiness(context) {
      if (validId(context.result?.id)) await (await connect()).collection(collection).delete(context.result.id);
    },

    async verifyStage(context) {
      const expectedWrites = context.operation === 'write' ? context.stage.completed : 0;
      await verifySchema();
      await readBaseline(expectedWrites);
    },
  };
}

let defaultAdmin;
async function getDefaultAdmin() {
  if (!defaultAdmin) {
    defaultAdmin = (async () => {
      if (!process.env.BAAS_BENCH_ROOT || !process.env.BAAS_BENCH_RUNTIME) throw new Error('benchmark runtime environment is missing');
      const { default: PocketBase } = await import('pocketbase');
      return createPocketBaseAdmin({
        PocketBase,
        root: process.env.BAAS_BENCH_ROOT,
        runtime: process.env.BAAS_BENCH_RUNTIME,
      });
    })();
  }
  return defaultAdmin;
}

export async function setup(context) { return (await getDefaultAdmin()).setup(context); }
export async function verify(context) { return (await getDefaultAdmin()).verify(context); }
export async function reset(context) { return (await getDefaultAdmin()).reset(context); }
export async function teardown(context) { return (await getDefaultAdmin()).teardown(context); }
export async function verifyReadiness(context) { return (await getDefaultAdmin()).verifyReadiness(context); }
export async function cleanupReadiness(context) { return (await getDefaultAdmin()).cleanupReadiness(context); }
export async function verifyStage(context) { return (await getDefaultAdmin()).verifyStage(context); }
