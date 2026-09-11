import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSchemaText, exactCountSql, verifyExactCounts, verifyMinimumCounts, createFixtureState, resetFixtureState, createNeonPasswords } from './postgres.mjs';
import { createTlsFetch, restartNeonProxy } from '../adapters/neon.mjs';
import { DATASET_COUNTS, entityId, seedDataset } from '../dataset.mjs';

export const NEON_CLIENT_ROLE_SQL = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'benchmark_client') THEN
    CREATE ROLE benchmark_client NOLOGIN;
  END IF;
END $$;
ALTER ROLE benchmark_client NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT benchmark_client TO cloud_admin;
GRANT USAGE ON SCHEMA public, benchmark_auth, benchmark_private, benchmark_extensions TO benchmark_client;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO benchmark_client;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA benchmark_auth, benchmark_private, benchmark_extensions TO benchmark_client;`;

const DEFINITIONS = Object.freeze({
  organization: ['organizations', ['id', 'name', 'owner_id', 'created_at'], ['id', 'name', 'ownerId', 'createdAt']],
  user: ['users', ['id', 'email', 'display_name', 'created_at', 'updated_at'], ['id', 'email', 'displayName', 'createdAt', 'updatedAt']],
  membership: ['memberships', ['id', 'organization_id', 'user_id', 'role', 'created_at'], ['id', 'organizationId', 'userId', 'role', 'createdAt']],
  project: ['projects', ['id', 'organization_id', 'name', 'status', 'created_at', 'updated_at'], ['id', 'organizationId', 'name', 'status', 'createdAt', 'updatedAt']],
  task: ['tasks', ['id', 'organization_id', 'project_id', 'creator_id', 'assignee_id', 'title', 'description', 'status', 'priority', 'due_date', 'created_at', 'updated_at'], ['id', 'organizationId', 'projectId', 'creatorId', 'assigneeId', 'title', 'description', 'status', 'priority', 'dueDate', 'createdAt', 'updatedAt']],
  comment: ['comments', ['id', 'organization_id', 'project_id', 'task_id', 'author_id', 'body', 'created_at', 'updated_at'], ['id', 'organizationId', 'projectId', 'taskId', 'authorId', 'body', 'createdAt', 'updatedAt']],
  activity: ['activities', ['id', 'organization_id', 'project_id', 'actor_id', 'action', 'subject_type', 'subject_id', 'created_at'], ['id', 'organizationId', 'projectId', 'actorId', 'action', 'subjectType', 'subjectId', 'createdAt']],
});

function rowsOf(result) { return Array.isArray(result) ? result : result?.rows ?? []; }
export function splitSqlStatements(text) {
  const statements = [];
  let start = 0;
  let state = 'normal';
  let dollarTag = '';
  for (let index = 0; index < text.length; index += 1) {
    const pair = text.slice(index, index + 2);
    if (state === 'line-comment') { if (text[index] === '\n') state = 'normal'; continue; }
    if (state === 'block-comment') { if (pair === '*/') { state = 'normal'; index += 1; } continue; }
    if (state === 'single-quote') { if (text[index] === "'" && text[index + 1] === "'") index += 1; else if (text[index] === "'") state = 'normal'; continue; }
    if (state === 'double-quote') { if (text[index] === '"' && text[index + 1] === '"') index += 1; else if (text[index] === '"') state = 'normal'; continue; }
    if (state === 'dollar-quote') { if (text.startsWith(dollarTag, index)) { index += dollarTag.length - 1; state = 'normal'; } continue; }
    if (pair === '--') { state = 'line-comment'; index += 1; continue; }
    if (pair === '/*') { state = 'block-comment'; index += 1; continue; }
    if (text[index] === "'") { state = 'single-quote'; continue; }
    if (text[index] === '"') { state = 'double-quote'; continue; }
    if (text[index] === '$') {
      const match = text.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) { dollarTag = match[0]; state = 'dollar-quote'; index += dollarTag.length - 1; continue; }
    }
    if (text[index] === ';') { const statement = text.slice(start, index).trim(); if (statement) statements.push(statement); start = index + 1; }
  }
  const statement = text.slice(start).trim();
  if (statement) statements.push(statement);
  return statements;
}
export function createNeonSql({ sql, endpoint = 'https://localhost:4444/sql' } = {}) {
  const client = typeof sql === 'function' ? sql : sql;
  if (!client || typeof client.query !== 'function') throw new TypeError('Neon SQL transport is required');
  return { endpoint, async query(text, params = [], options = {}) {
    const statements = splitSqlStatements(text);
    if (statements.length <= 1) return rowsOf(await client.query(text, params, options.fetchOptions ? { fetchOptions: options.fetchOptions } : undefined));
    if (params.length) throw new Error('parameterized Neon SQL scripts are unsupported');
    if (typeof client.transaction !== 'function') throw new TypeError('Neon SQL transaction transport is required for scripts');
    const body = statements.filter(statement => !/^(BEGIN|COMMIT)$/i.test(statement));
    const results = await client.transaction(transaction => body.map(statement => transaction.query(statement, [])), options.fetchOptions ? { fetchOptions: options.fetchOptions } : undefined);
    return rowsOf(results.at(-1));
  } };
}

export function createNeonAdmin({ sql, seed = 42, password = `Bb-v3-${seed}-capacity!`, runtime, recoverConnections } = {}) {
  const stateDir = join(runtime ?? process.env.BAAS_BENCH_RUNTIME ?? '.', 'state');
  const configPath = join(stateDir, 'neon-config.json');
  if (!sql || typeof sql.query !== 'function') throw new TypeError('Neon SQL transport is required');
  async function query(text, params = []) { return rowsOf(await sql.query(text, params)); }
  function normalizeRecord(entity, record) {
    if (entity === 'task') {
      const project = Number.parseInt(record.projectId.slice('prjv3'.length), 36);
      return { ...record, organizationId: entityId('organization', project % DATASET_COUNTS.organizations) };
    }
    if (entity === 'comment') {
      const task = Number.parseInt(record.taskId.slice('tskv3'.length), 36);
      const project = task % DATASET_COUNTS.projects;
      return { ...record, projectId: entityId('project', project), organizationId: entityId('organization', project % DATASET_COUNTS.organizations) };
    }
    return record;
  }
  async function insertBatch(entity, records) {
    const definition = DEFINITIONS[entity];
    if (!definition) throw new RangeError(`unsupported entity: ${entity}`);
    const [table, columns, fields] = definition;
    const params = [];
    const values = records.map(source => { const record = normalizeRecord(entity, source); return `(${fields.map(field => { params.push(record[field]); return `$${params.length}`; }).join(',')})`; }).join(',');
    await query(`INSERT INTO public.${table} (${columns.join(',')}) VALUES ${values}`, params);
  }
  async function verify() { return verifyMinimumCounts((text, params) => query(text, params)); }
  async function verifyExact() { return verifyExactCounts((text, params) => query(text, params)); }
  async function teardown() {
    let failure;
    try { if (recoverConnections) await recoverConnections(); } catch (error) { failure = error; }
    try { await query('DROP SCHEMA IF EXISTS benchmark_fixture CASCADE; DROP SCHEMA IF EXISTS benchmark_auth CASCADE; DROP TABLE IF EXISTS public.activities, public.comments, public.tasks, public.projects, public.memberships, public.organizations, public.users CASCADE; DROP SCHEMA IF EXISTS benchmark_private CASCADE; DROP SCHEMA IF EXISTS benchmark_extensions CASCADE;'); }
    catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); }
    try { await rm(configPath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); }
    if (failure) throw failure;
  }
  async function reset() {
    if (recoverConnections) await recoverConnections();
    await resetFixtureState((text, params) => query(text, params));
    await verifyExact();
  }
  return {
    async setup() {
      try {
        await teardown();
        await query(await loadSchemaText());
        await query(NEON_CLIENT_ROLE_SQL);
        for await (const batch of seedDataset(seed, 1_000)) await insertBatch(batch.entity, batch.records);
        await query('UPDATE public.users SET auth_subject = id WHERE auth_subject IS NULL');
        await createNeonPasswords((text, params) => query(text, params), password);
        await createFixtureState((text, params) => query(text, params));
        await mkdir(stateDir, { recursive: true, mode: 0o700 });
        await chmod(stateDir, 0o700);
        await writeFile(configPath, `${JSON.stringify({ seed, password })}\n`, { mode: 0o600 });
        await verifyExact();
      } catch (error) {
        try { await teardown(); } catch (cleanupError) { if (error && typeof error === 'object') error.cleanupError = String(cleanupError?.message ?? cleanupError); }
        throw error;
      }
    },
    verify,
    reset,
    teardown,
  };
}

let instance;
async function getDefault() {
  if (!instance) {
    const { neon, neonConfig } = await import('@neondatabase/serverless');
    neonConfig.fetchEndpoint = 'https://localhost:4444/sql';
    const root = process.env.BAAS_BENCH_ROOT || process.cwd();
    const runtimeRoot = process.env.BAAS_RUNTIME_DIR || join(root, '.runtime');
    const caPath = process.env.NEON_PROXY_CA || join(runtimeRoot, 'neon', 'proxy-certs', 'localhost.crt');
    try { neonConfig.fetchFunction = createTlsFetch(await readFile(caPath, 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const connectionString = process.env.NEON_DATABASE_URL || 'postgresql://cloud_admin:cloud_admin@localhost:4444/postgres?sslmode=require';
    const sql = createNeonSql({ sql: neon(connectionString) });
    // Timed-out SQL-over-HTTP requests can keep compute backends occupied.
    // Recycle the proxy between unmeasured phases so each stage starts clean.
    async function recoverConnections() { await restartNeonProxy(root); }
    instance = createNeonAdmin({ sql, runtime: process.env.BAAS_BENCH_RUNTIME, recoverConnections });
  }
  return instance;
}
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
