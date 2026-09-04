import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fixture, fixtures, writeRecord } from '../fixtures.mjs';

const endpoint = 'http://127.0.0.1:8080/v1';
const accountId = 'bb-basic-js-v1-user';
const accountEmail = 'bb-basic-js-v1@example.test';
const teamId = 'bb-basic-js-v1-team';
const projectId = 'bb-basic-js-v1-project';
const platformId = 'bb-basic-js-v1-web';
const keyId = 'bb-basic-js-v1-key';
const databaseId = 'bb-basic-js-v1';
const tableId = 'guestbook';
const keyScopes = ['databases.read', 'databases.write', 'tables.read', 'tables.write', 'columns.read', 'columns.write', 'indexes.read', 'indexes.write', 'rows.read', 'rows.write'];

async function writeSecret(path, value) {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function createAppwriteAdmin({ sdk, fetchImpl = fetch, runtime, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
  const stateDir = join(runtime, 'state');
  const consolePath = join(stateDir, 'appwrite-console.json');
  const adminPath = join(stateDir, 'appwrite-admin.json');
  let tables;
  let query;
  let cookie = '';
  let password;

  async function consoleRequest(method, path, body, allowed = []) {
    const response = await fetchImpl(`${endpoint}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-appwrite-project': 'console',
        'x-appwrite-response-format': '1.9.0',
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok && !allowed.includes(response.status)) throw new Error(`Appwrite Console request failed (${response.status}): ${text.slice(0, 500)}`);
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) cookie = cookies.map((value) => value.split(';', 1)[0]).join('; ');
    return text && response.ok ? JSON.parse(text) : null;
  }

  async function login() {
    if (!password) {
      const saved = await readFile(consolePath, 'utf8').then(JSON.parse).catch(() => null);
      password = saved?.password;
    }
    if (!password) throw new Error('Appwrite Console credentials are missing');
    cookie = '';
    await consoleRequest('POST', '/account/sessions/email', { email: accountEmail, password });
  }

  async function bootstrap() {
    await mkdir(stateDir, { recursive: true });
    const saved = await readFile(consolePath, 'utf8').then(JSON.parse).catch(() => null);
    password = saved?.password || `Bb-${randomBytes(18).toString('hex')}!`;
    await consoleRequest('POST', '/account', { userId: accountId, email: accountEmail, password, name: 'baas-bench basic-js-v1' }, [409]);
    await writeSecret(consolePath, `${JSON.stringify({ email: accountEmail, password })}\n`);
    await login();
    await consoleRequest('DELETE', `/projects/${projectId}`, undefined, [404]);
    await consoleRequest('DELETE', `/teams/${teamId}`, undefined, [404]);
    await consoleRequest('POST', '/teams', { teamId, name: 'baas-bench basic-js-v1', roles: [] });
    await consoleRequest('POST', '/projects', { projectId, name: 'baas-bench basic-js-v1', teamId });
    await consoleRequest('POST', `/projects/${projectId}/platforms`, { platformId, type: 'web', name: 'localhost', hostname: 'localhost' });
    const key = await consoleRequest('POST', `/projects/${projectId}/keys`, { keyId, name: 'baas-bench basic-js-v1', scopes: keyScopes });
    if (!key?.secret) throw new Error('Appwrite project key response has no secret');
    await writeSecret(join(stateDir, 'appwrite.json'), `${JSON.stringify({ projectId, databaseId, tableId })}\n`);
    await writeSecret(adminPath, `${JSON.stringify({ projectId, key: key.secret })}\n`);
    return key.secret;
  }

  function connect(key) {
    const client = new sdk.Client().setEndpoint(endpoint).setProject(projectId).setKey(key);
    tables = new sdk.TablesDB(client);
    query = sdk.Query;
  }

  async function poll(getter, label) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const resource = await getter();
      if (resource.status === 'available') return resource;
      if (resource.status === 'failed') throw new Error(`Appwrite ${label} failed`);
      await sleep(250);
    }
    throw new Error(`Appwrite ${label} timed out`);
  }

  async function allRows() {
    const rows = [];
    let cursor;
    do {
      const queries = [query.orderAsc('$id'), query.limit(1000)];
      if (cursor) queries.push(query.cursorAfter(cursor));
      const page = await tables.listRows({ databaseId, tableId, queries, total: false });
      if (!Array.isArray(page.rows)) throw new Error('invalid Appwrite row list');
      rows.push(...page.rows);
      cursor = page.rows.length === 1000 ? page.rows.at(-1).$id : undefined;
    } while (cursor);
    return rows;
  }

  function verifyBaseline(rows) {
    const baseline = rows.filter((row) => row.fixture_key !== null && row.fixture_key !== undefined).sort((left, right) => left.fixture_key - right.fixture_key);
    if (baseline.length !== 10_000) throw new Error('Appwrite baseline count verification failed');
    baseline.forEach((row, index) => {
      const expected = fixture(index + 1);
      if (row.fixture_key !== expected.fixture_key || row.author !== expected.author || row.message !== expected.message || !Number.isFinite(Date.parse(row.$createdAt))) {
        throw new Error(`Appwrite baseline fixture ${index + 1} is invalid`);
      }
    });
    return baseline;
  }

  async function teardown() {
    let original;
    if (tables) {
      try { await tables.delete({ databaseId }); } catch (error) { if (error?.code !== 404) original = error; }
    }
    try {
      await login();
      await consoleRequest('DELETE', `/projects/${projectId}`, undefined, [404]);
      await consoleRequest('DELETE', `/teams/${teamId}`, undefined, [404]);
      await consoleRequest('DELETE', '/account', undefined, [404]);
    } catch (cleanupError) {
      if (!original) original = cleanupError;
      else if (original instanceof Error) original.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
    await rm(join(stateDir, 'appwrite.json'), { force: true });
    await rm(adminPath, { force: true });
    await rm(join(stateDir, 'appwrite-ids.json'), { force: true });
    await rm(consolePath, { force: true });
    password = undefined;
    cookie = '';
    if (original) throw original;
  }

  return {
    async setup() {
      try {
        const key = await bootstrap();
        connect(key);
        await tables.create({ databaseId, name: 'basic-js-v1', enabled: true });
        await tables.createTable({ databaseId, tableId, name: 'guestbook', permissions: [sdk.Permission.read(sdk.Role.any()), sdk.Permission.create(sdk.Role.any())], rowSecurity: false, enabled: true });
        await tables.createStringColumn({ databaseId, tableId, key: 'author', size: 32, required: true });
        await tables.createStringColumn({ databaseId, tableId, key: 'message', size: 256, required: true });
        await tables.createIntegerColumn({ databaseId, tableId, key: 'fixture_key', required: false });
        for (const key of ['author', 'message', 'fixture_key']) {
          await poll(() => tables.getColumn({ databaseId, tableId, key }), `column ${key}`);
        }
        await tables.createIndex({ databaseId, tableId, key: 'by_fixture_key', type: sdk.TablesDBIndexType.Unique, columns: ['fixture_key'], orders: [sdk.OrderBy.Asc] });
        await poll(() => tables.getIndex({ databaseId, tableId, key: 'by_fixture_key' }), 'fixture index');

        const baseline = fixtures();
        const ids = [];
        async function createFixtureRows(source) {
          const rows = source.map((row) => {
            const id = sdk.ID.unique();
            ids.push(id);
            return { $id: id, author: row.author, message: row.message, fixture_key: row.fixture_key };
          });
          await tables.createRows({ databaseId, tableId, rows });
        }
        const individuallyCreated = 20;
        const bulkEnd = baseline.length - individuallyCreated;
        for (let offset = 0; offset < bulkEnd; offset += 100) {
          await createFixtureRows(baseline.slice(offset, Math.min(offset + 100, bulkEnd)));
        }
        for (let offset = bulkEnd; offset < baseline.length; offset += 1) {
          await createFixtureRows([baseline[offset]]);
        }
        const verified = verifyBaseline(await allRows());
        const byFixture = verified.map((row) => row.$id);
        if (byFixture.some((id, index) => id !== ids[index])) throw new Error('Appwrite fixture ID order verification failed');
        await writeSecret(join(stateDir, 'appwrite-ids.json'), `${JSON.stringify(byFixture)}\n`);
      } catch (error) {
        try { await teardown(); } catch (cleanupError) {
          if (error instanceof Error) error.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        }
        throw error;
      }
    },

    async verify() { verifyBaseline(await allRows()); },

    async reset() {
      while (true) {
        const page = await tables.listRows({ databaseId, tableId, queries: [query.isNull('fixture_key'), query.limit(1)], total: false });
        if (!page.rows?.length) break;
        await tables.deleteRows({ databaseId, tableId, queries: [query.isNull('fixture_key')] });
      }
      verifyBaseline(await allRows());
    },

    teardown,

    async verifyReadiness(context) {
      if (context.operation === 'list') {
        const expected = Array.from({ length: 20 }, (_, offset) => fixture(10_000 - offset));
        if (!Array.isArray(context.result) || context.result.length !== 20 || context.result.some((row, index) =>
          row.author !== expected[index].author || row.message !== expected[index].message)) {
          throw new Error('Appwrite list readiness verification failed');
        }
        for (let index = 1; index < context.result.length; index += 1) {
          const previous = context.result[index - 1];
          const current = context.result[index];
          if (Date.parse(previous.created_at) < Date.parse(current.created_at) ||
              (previous.created_at === current.created_at && String(previous.id) < String(current.id))) {
            throw new Error('Appwrite list order verification failed');
          }
        }
      } else if (context.operation === 'write') {
        const row = await tables.getRow({ databaseId, tableId, rowId: context.result.id });
        const expected = writeRecord({ ...context, vu: 0, sequence: 0 });
        if (row.author !== expected.author || row.message !== expected.message || row.fixture_key != null || !Number.isFinite(Date.parse(row.$createdAt))) {
          throw new Error('Appwrite write readiness verification failed');
        }
      }
    },

    async cleanupReadiness(context) { await tables.deleteRow({ databaseId, tableId, rowId: context.result.id }); },

    async verifyStage(context) {
      const rows = await allRows();
      verifyBaseline(rows);
      const writes = rows.filter((row) => row.fixture_key == null).length;
      const expected = context.operation === 'write' ? context.stage.completed : 0;
      if (writes !== expected) throw new Error('Appwrite stage row count verification failed');
    },

    connect,
    setPassword(value) { password = value; },
  };
}

let defaultAdmin;
async function getDefaultAdmin() {
  if (!defaultAdmin) {
    const [sdk, credentials] = await Promise.all([
      import('node-appwrite'),
      readFile(join(process.env.BAAS_BENCH_RUNTIME, 'state/appwrite-admin.json'), 'utf8').then(JSON.parse).catch(() => null),
    ]);
    const admin = createAppwriteAdmin({ sdk, runtime: process.env.BAAS_BENCH_RUNTIME });
    if (credentials?.key) admin.connect(credentials.key);
    defaultAdmin = admin;
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
