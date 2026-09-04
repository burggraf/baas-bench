import { chmod, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, fixtures, writeRecord } from '../fixtures.mjs';
import { readEnvValue, readJson, runtimeRoot } from '../config.mjs';
import { runCommand } from '../command.mjs';

const collection = 'bb_basic_js_v1_guestbook';
const logicalFields = ['id', 'author', 'message', 'created_at'];

function apiError(error, label) {
  const wrapped = new Error(`Directus ${label} failed: ${error?.message || error}`, { cause: error });
  if (statusOf(error) !== undefined) wrapped.status = statusOf(error);
  throw wrapped;
}
function statusOf(error) { return error?.status ?? error?.response?.status ?? error?.cause?.status; }

export function createDirectusAdmin({ sdk, endpoint = 'http://127.0.0.1:8055', runtime, root, password, email = 'admin@example.com', run = runCommand }) {
  const stateDir = join(runtime, 'state');
  let client;
  async function connect() {
    const anonymous = sdk.createDirectus(endpoint).with(sdk.rest({
      onRequest(options) {
        const headers = new Headers(options.headers);
        headers.set('Cache-Control', 'no-store');
        return { ...options, headers };
      },
    })).with(sdk.authentication('json'));
    await anonymous.login({ email, password });
    anonymous.stopRefreshing();
    client = anonymous;
    return client;
  }
  async function request(command, label) { try { return await (client || await connect()).request(command); } catch (error) { apiError(error, label); } }
  async function exists() {
    const collections = await request(sdk.readCollections(), 'collection lookup');
    if (!Array.isArray(collections)) throw new Error('Directus collection lookup returned an invalid response');
    return collections.some((item) => item.collection === collection);
  }
  async function removeOwned() {
    if (await exists()) await request(sdk.deleteCollection(collection), 'collection deletion');
  }
  async function publicAccess(label) {
    return request(sdk.customEndpoint({
      path: '/access',
      method: 'GET',
      params: { filter: { _and: [{ role: { _null: true } }, { user: { _null: true } }] }, fields: ['policy'], limit: 2 },
    }), label);
  }
  async function setupImpl() {
    await mkdir(stateDir, { recursive: true });
    await removeOwned();
    const definitions = [
      { field: 'id', type: 'integer', meta: { hidden: true, readonly: true }, schema: { is_primary_key: true, is_nullable: false, has_auto_increment: true } },
      { field: 'author', type: 'string', meta: { required: true }, schema: { is_nullable: false, max_length: 32 } },
      { field: 'message', type: 'string', meta: { required: true }, schema: { is_nullable: false, max_length: 256 } },
      { field: 'created_at', type: 'timestamp', meta: { special: ['date-created'], readonly: true, interface: 'datetime' }, schema: { is_nullable: false, is_indexed: true } },
      { field: 'fixture_key', type: 'integer', meta: { hidden: true }, schema: { is_nullable: true, is_unique: true, is_indexed: true } },
    ];
    await request(sdk.createCollection({ collection, schema: {}, fields: definitions, meta: { icon: 'book' } }), 'collection creation');
    const access = await publicAccess('public policy lookup');
    if (!Array.isArray(access) || access.length !== 1 || !access[0]?.policy) throw new Error('Directus public policy discovery was not unique');
    const policy = access[0].policy;
    const permissions = [
      { policy, collection, action: 'read', permissions: null, validation: null, presets: null, fields: ['*'] },
      { policy, collection, action: 'create', permissions: null, validation: null, presets: null, fields: ['*'] },
    ];
    const createdPermissions = await request(sdk.createPermissions(permissions), 'permission creation');
    const permissionIds = (Array.isArray(createdPermissions) ? createdPermissions : [createdPermissions]).map((item) => item.id).filter(Boolean);
    if (permissionIds.length !== 2) throw new Error('Directus did not create exactly two permissions');
    await verifyPermissions(policy, permissionIds);
    const rows = fixtures();
    const csv = rows.map((row) => [row.fixture_key, row.author, row.message, row.created_at]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    await run(join(root, 'bin/baas'), [
      'compose', 'directus', 'exec', '-T', 'database', 'psql', '-U', 'directus', '-d', 'directus',
      '-v', 'ON_ERROR_STOP=1', '-c', `COPY "${collection}" (fixture_key, author, message, created_at) FROM STDIN WITH (FORMAT csv)`,
    ], { input: `${csv}\n` });
    const ordered = await request(sdk.readItems(collection, { fields: ['id', 'fixture_key'], sort: ['fixture_key'], limit: -1 }), 'fixture ID read');
    const map = ordered.sort((a, b) => a.fixture_key - b.fixture_key).map((row) => row.id);
    if (map.length !== rows.length || map.some((id) => !Number.isInteger(id))) throw new Error('Directus fixture ID map is invalid');
    await writeFile(join(stateDir, 'directus-ids.json'), `${JSON.stringify(map)}\n`, { mode: 0o600 });
    await chmod(join(stateDir, 'directus-ids.json'), 0o600);
    await writeFile(join(stateDir, 'directus-permissions.json'), `${JSON.stringify(permissionIds)}\n`, { mode: 0o600 });
    await chmod(join(stateDir, 'directus-permissions.json'), 0o600);
    await verify();
  }
  async function verifyPermissions(policy, expectedIds) {
    const actual = await request(sdk.readPermissions({ filter: { policy, collection }, fields: ['id', 'policy', 'collection', 'action', 'permissions', 'validation', 'presets', 'fields'], limit: -1 }), 'permission verification');
    if (!Array.isArray(actual) || actual.length !== 2 || actual.some((row) => !expectedIds.includes(row.id))) throw new Error('Directus permission set is invalid');
    const read = actual.find((row) => row.action === 'read');
    const create = actual.find((row) => row.action === 'create');
    if (!read || !create || [read, create].some((row) =>
      JSON.stringify(row.fields) !== JSON.stringify(['*']) || row.permissions !== null || row.validation !== null || row.presets !== null)) {
      throw new Error('Directus basic permission rules are invalid');
    }
  }
  async function rows() { return request(sdk.readItems(collection, { fields: [...logicalFields, 'fixture_key'], sort: ['fixture_key'], limit: -1 }), 'row verification'); }
  async function verify() {
    const access = await publicAccess('public policy verification');
    if (!Array.isArray(access) || access.length !== 1 || !access[0]?.policy) throw new Error('Directus public policy is not unique');
    const permissionIds = await readJson(join(stateDir, 'directus-permissions.json')).catch(() => []);
    await verifyPermissions(access[0].policy, permissionIds);
    const all = await rows();
    const baseline = all.filter((row) => row.fixture_key !== null && row.fixture_key !== undefined).sort((a, b) => a.fixture_key - b.fixture_key);
    if (baseline.length !== 10000 || baseline.some((row, index) => { const expected = fixture(index + 1); return row.fixture_key !== expected.fixture_key || row.author !== expected.author || row.message !== expected.message || Date.parse(row.created_at) !== Date.parse(expected.created_at); })) throw new Error('Directus baseline is invalid');
    const fields = await request(sdk.readFieldsByCollection(collection), 'field verification');
    const byName = Object.fromEntries(fields.map((field) => [field.field, field]));
    if (!byName.created_at?.schema?.is_indexed || !byName.fixture_key?.schema?.is_unique || !byName.fixture_key?.schema?.is_indexed) throw new Error('Directus indexes or unique fixture key are invalid');
    return true;
  }
  async function reset() { await request(sdk.deleteItems(collection, { filter: { fixture_key: { _null: true } } }), 'reset'); await verify();
  }
  async function teardown() {
    let first;
    try {
      const ids = await readJson(join(stateDir, 'directus-permissions.json'));
      for (const id of ids) await request(sdk.deletePermission(id), 'permission deletion');
    } catch (error) { first = error; }
    try { await removeOwned(); } catch (error) { if (!first) first = error; else first.cleanupError = error; }
    try { await Promise.all([rm(join(stateDir, 'directus-ids.json'), { force: true }), rm(join(stateDir, 'directus-permissions.json'), { force: true })]); } catch (error) { if (!first) first = error; else first.cleanupError = error; }
    if (first) throw first;
  }
  async function verifyReadiness(context) {
    if (context.operation === 'list') {
      const list = context.result;
      if (!Array.isArray(list) || list.length !== 20 || list.some((row, index) => {
        const expected = fixture(10000 - index);
        return Object.keys(row).sort().join(',') !== 'author,created_at,id,message' || row.author !== expected.author || row.message !== expected.message || Date.parse(row.created_at) !== Date.parse(expected.created_at);
      })) throw new Error('Directus readiness list is invalid');
      return true;
    }
    if (context.operation === 'write') {
      if (!context.result || context.result.id === undefined || context.result.id === null) throw new Error('Directus readiness write has no ID');
      const row = await request(sdk.readItem(collection, context.result.id, { fields: [...logicalFields, 'fixture_key'] }), 'readiness write readback');
      const expected = writeRecord(context);
      if (!row || row.fixture_key != null || row.author !== expected.author || row.message !== expected.message || !Number.isFinite(Date.parse(row.created_at))) throw new Error('Directus readiness write is invalid');
      return true;
    }
    return true;
  }
  async function cleanupReadiness(context) { if (context?.result && context.result.id !== undefined && context.result.id !== null) await request(sdk.deleteItem(collection, context.result.id), 'readiness cleanup'); }
  async function setup() {
    try { return await setupImpl(); } catch (error) {
      try { await teardown(); } catch (cleanupError) { error.cleanupError = cleanupError; }
      throw error;
    }
  }
  async function verifyStage(context) {
    await verify();
    const all = await rows();
    const writes = all.filter((row) => row.fixture_key == null).length;
    if (writes !== (context.operation === 'write' ? context.stage.completed : 0)) throw new Error('Directus stage write count is invalid');
    return true;
  }
  return { setup, verify, reset, teardown, verifyReadiness, cleanupReadiness, verifyStage };
}

let defaultAdmin;
async function getDefaultAdmin() {
  if (!defaultAdmin) defaultAdmin = (async () => {
    const sdk = await import('@directus/sdk');
    const root = runtimeRoot();
    const password = await readEnvValue(join(root, 'directus/.env'), 'DIRECTUS_ADMIN_PASSWORD');
    return createDirectusAdmin({ sdk, root: process.env.BAAS_BENCH_ROOT, runtime: join(root, 'benchmarks/basic-js-v1'), password });
  })();
  return defaultAdmin;
}
export async function setup(context) { return (await getDefaultAdmin()).setup(context); }
export async function verify(context) { return (await getDefaultAdmin()).verify(context); }
export async function reset(context) { return (await getDefaultAdmin()).reset(context); }
export async function teardown(context) { return (await getDefaultAdmin()).teardown(context); }
export async function verifyReadiness(context) { return (await getDefaultAdmin()).verifyReadiness(context); }
export async function cleanupReadiness(context) { return (await getDefaultAdmin()).cleanupReadiness(context); }
export async function verifyStage(context) { return (await getDefaultAdmin()).verifyStage(context); }
