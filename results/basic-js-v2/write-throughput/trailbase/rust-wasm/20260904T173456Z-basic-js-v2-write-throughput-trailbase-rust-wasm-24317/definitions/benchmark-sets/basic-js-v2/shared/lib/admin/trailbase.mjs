import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fixture, fixtures, writeRecord } from '../fixtures.mjs';
import { runCommand } from '../command.mjs';
import { readJson } from '../config.mjs';

const apiName = 'bb_basic_js_v2_guestbook';
const endpoint = 'http://127.0.0.1:4000';
const depot = '/app/traildepot';
const migrationFilename = 'U1785764800__create_bb_basic_js_v2_guestbook.sql';
const migrationVersion = 1_785_764_800;

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function validId(value) {
  return (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && value.length > 0);
}

function validateCredentials(value) {
  if (!value || typeof value.email !== 'string' || !value.email || typeof value.password !== 'string' || !value.password ||
      /[\u0000-\u001f\u007f]/.test(value.email) || /[\u0000-\u001f\u007f]/.test(value.password)) {
    throw new Error('TrailBase runtime administrator credentials are invalid');
  }
  return value;
}

function attachCleanupError(original, cleanupError) {
  if (original instanceof Error) {
    original.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
}

function valueFromSql(value) {
  if (value === 'Null') return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['Integer', 'Real', 'Text']) {
      if (Object.hasOwn(value, key)) return value[key];
    }
  }
  throw new Error('TrailBase administrative query returned an invalid SQL value');
}

function rowsFromQuery(response) {
  if (!response || !Array.isArray(response.rows)) throw new Error('TrailBase administrative query returned an invalid response');
  return response.rows.map((row) => {
    if (!Array.isArray(row)) throw new Error('TrailBase administrative query returned an invalid row');
    return row.map(valueFromSql);
  });
}

function statusOf(error) {
  return error?.status ?? error?.response?.status ?? error?.cause?.status;
}

export function createTrailBaseAdmin({
  initClient,
  run = runCommand,
  root,
  runtime,
  environmentRuntime = process.env.BAAS_RUNTIME_DIR ?? join(root, '.runtime'),
  migrationSql,
  configFragment,
  credentials,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const stateDir = join(runtime, 'state');
  const credentialsPath = join(stateDir, 'trailbase-admin.json');
  const idsPath = join(stateDir, 'trailbase-ids.json');
  const bootstrapPath = join(environmentRuntime, 'trailbase', 'bootstrap-admin.json');
  const command = join(root, 'bin/baas');
  let activeCredentials = credentials ? validateCredentials(credentials) : undefined;
  let client;
  let promoted = false;
  let provisioning = false;

  async function saveJson(path, value) {
    await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  }

  async function loadCredentials() {
    if (!activeCredentials) activeCredentials = validateCredentials(await readJson(credentialsPath));
    return activeCredentials;
  }

  async function loadBootstrapCredentials() {
    try {
      return validateCredentials(await readJson(bootstrapPath));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const logs = await run(command, ['compose', 'trailbase', 'logs', '--no-color', 'trailbase']);
    const matches = [...`${logs.stdout ?? ''}\n${logs.stderr ?? ''}`.matchAll(
      /Created new admin user:[\s\S]*?email:\s*'([^'\r\n]+)'[\s\S]*?password:\s*'([^'\r\n]+)'/g,
    )];
    const match = matches.at(-1);
    if (!match) throw new Error('TrailBase bootstrap administrator credentials are unavailable');
    const value = validateCredentials({ email: match[1], password: match[2] });
    await mkdir(join(environmentRuntime, 'trailbase'), { recursive: true });
    await saveJson(bootstrapPath, value);
    return value;
  }

  async function connect() {
    if (client) return client;
    let value = await loadCredentials();
    let next = initClient(endpoint);
    try {
      await next.login(value.email, value.password);
    } catch (error) {
      if (credentials !== undefined) throw error;
      await rm(bootstrapPath, { force: true });
      activeCredentials = await loadBootstrapCredentials();
      await saveJson(credentialsPath, activeCredentials);
      value = activeCredentials;
      next = initClient(endpoint);
      await next.login(value.email, value.password);
    }
    const tokens = next.tokens();
    if (!tokens || typeof tokens.auth_token !== 'string' || !tokens.auth_token ||
        typeof tokens.csrf_token !== 'string' || !tokens.csrf_token) {
      throw new Error('TrailBase runtime administrator login returned invalid tokens');
    }
    client = next;
    promoted = true;
    return client;
  }

  async function adminRequest(path, method, body) {
    const active = await connect();
    const csrf = active.tokens().csrf_token;
    const response = await active.fetch(`/api/_admin${path}`, {
      method,
      headers: { 'CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response?.ok) throw Object.assign(new Error(`TrailBase administrative ${method} ${path} failed`), { status: response?.status });
    if (response.status === 204) return undefined;
    return response.json();
  }

  async function query(sql) {
    return rowsFromQuery(await adminRequest('/query', 'POST', { query: sql, attached_databases: null }));
  }

  async function tableExists() {
    return (await query(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ${sqlLiteral(apiName)}`)).length === 1;
  }

  async function migrationWasApplied() {
    const rows = await query(`SELECT count(*) FROM "_schema_history" WHERE version = ${migrationVersion} AND name = 'create_bb_basic_js_v2_guestbook'`);
    return rows.length === 1 && rows[0][0] === 1;
  }

  async function removeOwnedTable() {
    if (!(await tableExists())) return;
    await adminRequest('/table', 'DELETE', { name: apiName, dry_run: false });
    await signalReload();
    await waitForTableState(false, 'TrailBase table-delete migration did not remove the benchmark table');
  }

  async function installMigration() {
    const directory = `${depot}/migrations/main`;
    const inspected = await run(command, [
      'compose', 'trailbase', 'exec', '-T', 'trailbase', 'sh', '-c',
      'if [ -f "$1/$2" ]; then printf "present\\n"; cat "$1/$2"; else printf "absent\\n"; fi',
      'inspect-migration', directory, migrationFilename,
    ]);
    if (inspected.stdout.startsWith('present\n')) {
      if (inspected.stdout.slice('present\n'.length) !== migrationSql) {
        throw new Error('TrailBase benchmark migration conflicts with the applied depot migration');
      }
      return;
    }
    if (inspected.stdout !== 'absent\n') throw new Error('TrailBase migration inspection returned invalid output');
    await run(command, [
      'compose', 'trailbase', 'exec', '-T', 'trailbase', 'sh', '-c',
      'set -C; umask 077; mkdir -p "$1"; cat > "$1/$2"',
      'install-migration', directory, migrationFilename,
    ], { input: migrationSql });
  }

  async function readConfig() {
    return (await run(command, ['compose', 'trailbase', 'exec', '-T', 'trailbase', 'cat', `${depot}/config.textproto`])).stdout;
  }

  async function installConfig() {
    const existing = await readConfig();
    if (existing.includes(configFragment)) return;
    if (existing.includes(apiName) || existing.includes('baas-bench basic-js-v2')) {
      throw new Error('TrailBase depot has a conflicting basic-js-v2 Record API configuration');
    }
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    await run(command, [
      'compose', 'trailbase', 'exec', '-T', 'trailbase', 'sh', '-c',
      'cat >> "$1"', 'append-config', `${depot}/config.textproto`,
    ], { input: `${separator}${configFragment}` });
  }

  async function removeDeploymentArtifacts() {
    const existing = await readConfig();
    if (existing.includes(configFragment)) {
      await run(command, [
        'compose', 'trailbase', 'exec', '-T', 'trailbase', 'sh', '-c',
        'cat > "$1"', 'remove-config', `${depot}/config.textproto`,
      ], { input: existing.replace(configFragment, '') });
    }
    await run(command, [
      'compose', 'trailbase', 'exec', '-T', 'trailbase', 'sh', '-c',
      'rm -f "$1" "$2"', 'remove-artifacts',
      `${depot}/migrations/main/${migrationFilename}`, `${depot}/wasm/baas-bench.wasm`,
    ]);
    await signalReload();
  }

  async function signalReload() {
    await run(command, ['compose', 'trailbase', 'kill', '-s', 'SIGHUP', 'trailbase']);
  }

  async function waitForTableState(expected, message) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await tableExists() === expected) return;
      await sleep(100);
    }
    throw new Error(message);
  }

  async function waitForTable() {
    return waitForTableState(true, 'TrailBase migration did not create the benchmark table');
  }

  async function anonymousList() {
    return (await initClient(endpoint).records(apiName).list({ pagination: { limit: 20 }, order: ['-created_at'] })).records;
  }

  async function waitForRecordApi() {
    let lastError;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const records = await anonymousList();
        if (Array.isArray(records)) return;
      } catch (error) {
        lastError = error;
      }
      await sleep(100);
    }
    throw new Error('TrailBase Record API did not reload', { cause: lastError });
  }

  async function insertFixtures() {
    const prefix = `INSERT INTO "${apiName}" (fixture_key, author, message, created_at) VALUES `;
    const rows = fixtures();
    for (let offset = 0; offset < rows.length; offset += 250) {
      const values = rows.slice(offset, offset + 250).map((row) =>
        `(${row.fixture_key},${sqlLiteral(row.author)},${sqlLiteral(row.message)},${sqlLiteral(row.created_at)})`);
      await query(`${prefix}${values.join(',')}`);
    }
  }

  async function readBaseline() {
    const rows = await query(`SELECT fixture_key, id, author, message, created_at FROM "${apiName}" WHERE fixture_key IS NOT NULL ORDER BY fixture_key`);
    if (rows.length !== 10_000) throw new Error('TrailBase baseline row count is invalid');
    const ids = [];
    for (let index = 0; index < rows.length; index += 1) {
      const [key, id, author, message, createdAt] = rows[index];
      const expected = fixture(index + 1);
      if (key !== expected.fixture_key || !validId(id) || author !== expected.author || message !== expected.message ||
          Date.parse(createdAt) !== Date.parse(expected.created_at)) {
        throw new Error(`TrailBase fixture ${index + 1} is invalid`);
      }
      ids.push(id);
    }
    return ids;
  }

  async function verifySchema() {
    const rows = await query(`SELECT sql FROM sqlite_schema WHERE name IN (${sqlLiteral(apiName)}, 'idx_bb_guestbook_created_at') ORDER BY type DESC`);
    const definitions = rows.map((row) => row[0]).join('\n');
    for (const pattern of [
      /CREATE TABLE bb_basic_js_v2_guestbook/,
      /id INTEGER PRIMARY KEY/,
      /author TEXT NOT NULL CHECK\s*\(length\(author\) BETWEEN 1 AND 32\)/,
      /message TEXT NOT NULL CHECK\s*\(length\(message\) BETWEEN 1 AND 256\)/,
      /created_at TEXT NOT NULL DEFAULT \(strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)\)/,
      /fixture_key INTEGER UNIQUE/,
      /\) STRICT/,
      /created_at DESC/,
    ]) {
      if (!pattern.test(definitions)) throw new Error('TrailBase benchmark schema is invalid');
    }
  }

  async function expectForbidden(active, path, options) {
    try {
      await active.fetch(path, options);
    } catch (error) {
      if ([401, 403].includes(statusOf(error))) return;
      throw error;
    }
    throw new Error(`TrailBase anonymous request unexpectedly succeeded: ${options?.method ?? 'GET'} ${path}`);
  }

  async function verifyRecordApi(ids, allowWrites = false) {
    const anonymous = initClient(endpoint);
    const result = await anonymous.records(apiName).list({ pagination: { limit: 20 }, order: ['-created_at'] });
    if (!Array.isArray(result?.records) || result.records.length !== 20 || result.records.some((row, index) => {
      if (Object.keys(row).sort().join(',') !== 'author,created_at,id,message' || !validId(row.id) ||
          typeof row.author !== 'string' || row.author.length < 1 || row.author.length > 32 ||
          typeof row.message !== 'string' || row.message.length < 1 || row.message.length > 256 ||
          !Number.isFinite(Date.parse(row.created_at))) return true;
      if (allowWrites) return false;
      const expected = fixture(10_000 - index);
      return row.id !== ids[9_999 - index] || row.author !== expected.author || row.message !== expected.message ||
        Date.parse(row.created_at) !== Date.parse(expected.created_at);
    })) throw new Error('TrailBase anonymous list contract is invalid');
    const recordPath = `/api/records/v1/${apiName}/${ids[0]}`;
    await expectForbidden(anonymous, `${recordPath}`, { method: 'PATCH', body: JSON.stringify({ author: 'forbidden' }) });
    await expectForbidden(anonymous, `${recordPath}`, { method: 'DELETE' });
    await expectForbidden(anonymous, `/api/records/v1/${apiName}/schema`, { method: 'GET' });
    await expectForbidden(anonymous, `/api/records/v1/${apiName}`, {
      method: 'POST',
      body: JSON.stringify({ author: 'forbidden', message: 'forbidden', created_at: new Date().toISOString() }),
    });
  }

  async function verify({ allowWrites, operation } = {}) {
    const permitMeasuredWrites = allowWrites ?? operation === 'write';
    await verifySchema();
    const counts = await query(`SELECT count(*), count(fixture_key), sum(CASE WHEN fixture_key IS NULL THEN 1 ELSE 0 END) FROM "${apiName}"`);
    if (counts.length !== 1 || counts[0][1] !== 10_000 || counts[0][0] < 10_000 || counts[0][2] !== counts[0][0] - 10_000) {
      throw new Error('TrailBase benchmark row counts are invalid');
    }
    const ids = await readBaseline();
    await verifyRecordApi(ids, permitMeasuredWrites);
    return true;
  }

  async function setupImpl() {
    provisioning = true;
    await mkdir(stateDir, { recursive: true });
    activeCredentials ??= await loadBootstrapCredentials();
    validateCredentials(activeCredentials);
    await saveJson(credentialsPath, activeCredentials);
    await installMigration();
    promoted = true;
    await connect();
    if (!(await tableExists())) {
      if (await migrationWasApplied()) {
        await query(migrationSql);
      } else {
        await signalReload();
        await waitForTable();
      }
    }
    await verifySchema();
    await query(`DELETE FROM "${apiName}"`);
    await installConfig();
    await signalReload();
    await waitForRecordApi();
    await insertFixtures();
    const ids = await readBaseline();
    await saveJson(idsPath, ids);
    await verify();
    provisioning = false;
  }

  async function setup() {
    try {
      return await setupImpl();
    } catch (error) {
      try {
        await teardown();
      } catch (cleanupError) {
        attachCleanupError(error, cleanupError);
      }
      throw error;
    }
  }

  async function reset() {
    await query(`DELETE FROM "${apiName}" WHERE fixture_key IS NULL`);
    await verify();
  }

  async function verifyReadiness(context) {
    if (context.operation === 'list') {
      const ids = await readJson(idsPath);
      if (!Array.isArray(context.result) || context.result.length !== 20 || context.result.some((row, index) => {
        const expected = fixture(10_000 - index);
        return Object.keys(row).sort().join(',') !== 'author,created_at,id,message' || row.id !== ids[9_999 - index] ||
          row.author !== expected.author || row.message !== expected.message || Date.parse(row.created_at) !== Date.parse(expected.created_at);
      })) throw new Error('TrailBase readiness list is invalid');
    } else if (context.operation === 'write') {
      if (!context.result || !validId(context.result.id)) throw new Error('TrailBase readiness write has no ID');
      const rows = await query(`SELECT author, message, created_at, fixture_key FROM "${apiName}" WHERE id = ${sqlLiteral(context.result.id)}`);
      const expected = writeRecord(context);
      if (rows.length !== 1 || rows[0][0] !== expected.author || rows[0][1] !== expected.message ||
          !Number.isFinite(Date.parse(rows[0][2])) || rows[0][3] !== null) {
        throw new Error('TrailBase readiness write is invalid');
      }
    }
    return true;
  }

  async function cleanupReadiness(context) {
    if (context?.result && validId(context.result.id)) await query(`DELETE FROM "${apiName}" WHERE id = ${sqlLiteral(context.result.id)}`);
  }

  async function verifyStage(context) {
    await verify({ allowWrites: context.operation === 'write' });
    const rows = await query(`SELECT count(*) FROM "${apiName}" WHERE fixture_key IS NULL`);
    const expected = context.operation === 'write' ? context.stage.completed : 0;
    if (rows.length !== 1 || rows[0][0] !== expected) throw new Error('TrailBase stage write count is invalid');
    return true;
  }

  async function teardown() {
    let first;
    let value;
    try {
      value = await loadCredentials();
      if (promoted || !provisioning) {
        promoted = true;
        await removeOwnedTable();
      }
    } catch (error) {
      first = error;
    }
    try {
      await removeDeploymentArtifacts();
    } catch (error) {
      if (!first) first = error;
      else attachCleanupError(first, error);
    }
    try {
      await Promise.all([rm(credentialsPath, { force: true }), rm(idsPath, { force: true })]);
    } catch (error) {
      if (!first) first = error;
      else attachCleanupError(first, error);
    }
    client = undefined;
    promoted = false;
    provisioning = false;
    if (first) throw first;
  }

  return { setup, verify, reset, teardown, verifyReadiness, cleanupReadiness, verifyStage };
}

let defaultAdmin;
async function getDefaultAdmin() {
  if (!defaultAdmin) defaultAdmin = (async () => {
    const runtime = process.env.BAAS_BENCH_RUNTIME;
    const [{ initClient }, migrationSql, configFragment] = await Promise.all([
      import('trailbase'),
      readFile(join(runtime, 'trailbase', migrationFilename), 'utf8'),
      readFile(join(runtime, 'trailbase', 'record-api.textproto'), 'utf8'),
    ]);
    return createTrailBaseAdmin({
      initClient,
      root: process.env.BAAS_BENCH_ROOT,
      runtime,
      migrationSql,
      configFragment,
    });
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
