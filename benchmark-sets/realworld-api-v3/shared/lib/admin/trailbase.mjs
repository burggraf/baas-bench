import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../command.mjs';
import { seedDataset, DATASET_COUNTS } from '../dataset.mjs';

export const TRAILBASE_TABLES = Object.freeze(['users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities']);
const endpoint = 'http://127.0.0.1:4000';
const depot = '/app/traildepot';
const migrationFile = 'U1785764902__integer_realworld_api_v3.sql';
const adminFile = 'trailbase-admin.json';
const originalConfigFile = 'trailbase-original-config.textproto';
const passwordFor = seed => `Bb-v3-${seed}-capacity!`;
const sql = value => value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const idOrdinal = (id, prefix) => Number.parseInt(String(id).slice(prefix.length), 36);
function valueFromSql(value) { if (value === 'Null') return null; if (value && typeof value === 'object' && !Array.isArray(value)) return value.Integer ?? value.Real ?? value.Text; throw new Error('invalid TrailBase SQL value'); }
function rowsFromQuery(response) { if (!response || !Array.isArray(response.rows)) throw new Error('invalid TrailBase SQL response'); return response.rows.map(row => row.map(valueFromSql)); }

export function createTrailBaseAdmin({ initClient, run = runCommand, root, runtime, environmentRuntime = process.env.BAAS_RUNTIME_DIR ?? join(root, '.runtime'), seed = 42, migrationSql, configFragment, credentials, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  if (typeof initClient !== 'function') throw new TypeError('TrailBase client factory is required');
  const state = join(runtime, 'state');
  const credentialsPath = join(state, adminFile);
  const originalPath = join(state, originalConfigFile);
  const command = join(root, 'bin/baas');
  let client;
  let activeCredentials = credentials;
  async function save(path, value) { await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 }); await chmod(path, 0o600); }
  async function saveText(path, value) { await writeFile(path, value, { mode: 0o600 }); await chmod(path, 0o600); }
  async function getCredentials() { if (activeCredentials) return activeCredentials; const bootstrap = join(environmentRuntime, 'trailbase', 'bootstrap-admin.json'); activeCredentials = JSON.parse(await readFile(bootstrap, 'utf8')); return activeCredentials; }
  async function compose(args, options = {}) { return run(command, ['compose', 'trailbase', ...args], { timeoutMs: 60_000, ...options }); }
  async function connect() { if (client) return client; const value = await getCredentials(); client = initClient(endpoint); await client.login(value.email, value.password); return client; }
  async function adminRequest(path, method, body) { const active = await connect(); const tokens = active.tokens(); const response = await active.fetch(`/api/_admin${path}`, { method, headers: { 'CSRF-Token': tokens.csrf_token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!response?.ok) throw new Error(`TrailBase admin request failed: ${method} ${path} (${response?.status})`); return response.status === 204 ? undefined : response.json(); }
  async function query(statement) { return rowsFromQuery(await adminRequest('/query', 'POST', { query: statement, attached_databases: null })); }
  async function installFiles() {
    const inspected = await compose(['exec', '-T', 'trailbase', 'sh', '-c', 'if [ -f "$1/$2" ]; then cat "$1/$2"; fi', 'inspect', `${depot}/migrations/main`, migrationFile]);
    if (inspected.stdout && inspected.stdout !== migrationSql) throw new Error('TrailBase migration conflicts with an existing file');
    if (!inspected.stdout) await compose(['exec', '-T', 'trailbase', 'sh', '-c', 'set -C; umask 077; mkdir -p "$1"; cat > "$1/$2"', 'install', `${depot}/migrations/main`, migrationFile], { input: migrationSql });
    const current = await compose(['exec', '-T', 'trailbase', 'cat', `${depot}/config.textproto`]);
    const apiStart = current.stdout.indexOf('record_apis:');
    let base = apiStart >= 0 ? current.stdout.slice(0, apiStart) : current.stdout;
    base = base.replace(/\n\s*user_identifier:\s*ONLY_USERNAME\s*\n/g, '\n');
    const configured = `${base}${base.endsWith('\n') ? '' : '\n'}${configFragment}`;
    if (!(await readFile(originalPath, 'utf8').catch(() => ''))) await saveText(originalPath, base);
    await compose(['exec', '-T', 'trailbase', 'sh', '-c', 'cat > "$1"', 'write-config', `${depot}/config.textproto`], { input: configured });
    await compose(['kill', '-s', 'SIGHUP', 'trailbase']);
  }
  async function waitForTable(table) { for (let attempt = 0; attempt < 100; attempt += 1) { const found = await query(`SELECT 1 FROM sqlite_schema WHERE type='table' AND name=${sql(table)}`); if (found.length === 1) return; await sleep(100); } throw new Error(`TrailBase table did not load: ${table}`); }
  function values(entity, record) {
    if (entity === 'organization') return [record.id, record.name, record.ownerId, record.createdAt];
    if (entity === 'user') return [record.id, record.email, record.displayName, record.createdAt, record.updatedAt];
    if (entity === 'membership') return [record.id, record.organizationId, record.userId, record.role, record.createdAt];
    if (entity === 'project') return [record.id, record.organizationId, record.name, record.status, record.createdAt, record.updatedAt];
    if (entity === 'task') { const organizationId = `orgv3${(idOrdinal(record.projectId, 'prjv3') % DATASET_COUNTS.organizations).toString(36).padStart(11, '0')}`; return [record.id, organizationId, record.projectId, record.creatorId, record.assigneeId, record.title, record.description, record.status, record.priority, record.dueDate, record.createdAt, record.updatedAt]; }
    if (entity === 'comment') { const taskOrdinal = idOrdinal(record.taskId, 'tskv3'); const projectOrdinal = taskOrdinal % DATASET_COUNTS.projects; return [record.id, `orgv3${(projectOrdinal % DATASET_COUNTS.organizations).toString(36).padStart(11, '0')}`, `prjv3${projectOrdinal.toString(36).padStart(11, '0')}`, record.taskId, record.authorId, record.body, record.createdAt, record.updatedAt]; }
    return [record.id, record.organizationId, record.projectId, record.actorId, record.action, record.subjectType, record.subjectId, record.createdAt];
  }
  const columns = { organization: ['external_id', 'name', 'owner_id', 'created_at'], user: ['external_id', 'email', 'display_name', 'created_at', 'updated_at'], membership: ['external_id', 'organization_id', 'user_id', 'role', 'created_at'], project: ['external_id', 'organization_id', 'name', 'status', 'created_at', 'updated_at'], task: ['external_id', 'organization_id', 'project_id', 'creator_id', 'assignee_id', 'title', 'description', 'status', 'priority', 'due_date', 'created_at', 'updated_at'], comment: ['external_id', 'organization_id', 'project_id', 'task_id', 'author_id', 'body', 'created_at', 'updated_at'], activity: ['external_id', 'organization_id', 'project_id', 'actor_id', 'action', 'subject_type', 'subject_id', 'created_at'] };
  async function seedData() { for await (const batch of seedDataset(seed, 2_000)) { const table = batch.entity === 'activity' ? 'activities' : `${batch.entity}s`; const valuesSql = batch.records.map(record => `(${values(batch.entity, record).map(sql).join(',')})`).join(','); await query(`INSERT INTO ${table} (${columns[batch.entity].join(',')}) VALUES ${valuesSql}`); } }
  async function registerUsers() { const existing = (await query("SELECT count(*) FROM _user WHERE email LIKE 'user-%@example.test'"))[0]?.[0] ?? 0; if (existing === DATASET_COUNTS.users) return; for await (const batch of seedDataset(seed, 500)) { if (batch.entity !== 'user') continue; const mappings = []; for (const user of batch.records) { const created = await adminRequest('/user', 'POST', { email: user.email, password: passwordFor(seed), verified: true, admin: false }); const authId = created?.id; if (typeof authId !== 'string' || !authId) throw new Error('TrailBase user creation returned no ID'); mappings.push(`WHEN external_id = ${sql(user.id)} THEN ${sql(authId.replaceAll('-', ''))}`); } await query(`UPDATE users SET auth_subject = CASE ${mappings.join(' ')} ELSE auth_subject END WHERE external_id IN (${batch.records.map(user => sql(user.id)).join(',')})`); } }
  async function verify() { for (const [table, count] of Object.entries(DATASET_COUNTS)) { const result = await query(`SELECT count(*) FROM ${table}`); if (result[0]?.[0] !== count) throw new Error(`TrailBase ${table} count is invalid`); } }
  async function reset() { for (const [table, prefix] of [['activities', 'actv3'], ['comments', 'cmtv3'], ['tasks', 'tskv3']]) await query(`DELETE FROM ${table} WHERE external_id NOT LIKE '${prefix}%'`); await verify(); }
  async function teardown() { let first; try { await query("DELETE FROM _user WHERE email LIKE 'user-%@example.test'"); for (const table of TRAILBASE_TABLES) await query(`DELETE FROM ${table}`); } catch (error) { first = error; } try { const original = await readFile(originalPath, 'utf8').catch(() => ''); if (original) { await compose(['exec', '-T', 'trailbase', 'sh', '-c', 'cat > "$1"', 'restore-config', `${depot}/config.textproto`], { input: original }); await compose(['kill', '-s', 'SIGHUP', 'trailbase']); } } catch (error) { if (!first) first = error; else first.cleanupError = String(error?.message ?? error); } try { await rm(credentialsPath, { force: true }); await rm(originalPath, { force: true }); } catch (error) { if (!first) first = error; else first.cleanupError = String(error?.message ?? error); } if (first) throw first; }
  async function setup() { try { await mkdir(state, { recursive: true, mode: 0o700 }); await chmod(state, 0o700); await save(credentialsPath, await getCredentials()); await installFiles(); await waitForTable('users'); for (const table of [...TRAILBASE_TABLES].reverse()) await query(`DELETE FROM ${table}`); await seedData(); await registerUsers(); await verify(); } catch (error) { try { await teardown(); } catch (cleanup) { error.cleanupError = String(cleanup?.message ?? cleanup); } throw error; } }
  return { setup, verify, reset, teardown };
}
let instance;
async function getDefault() { if (!instance) { const runtime = process.env.BAAS_BENCH_RUNTIME; const [{ initClient }, migrationSql, configFragment] = await Promise.all([import('trailbase'), readFile(join(runtime, 'trailbase', 'migration.sql'), 'utf8'), readFile(join(runtime, 'trailbase', 'config.textproto'), 'utf8')]); instance = createTrailBaseAdmin({ initClient, root: process.env.BAAS_BENCH_ROOT, runtime, migrationSql, configFragment }); } return instance; }
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
