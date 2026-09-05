import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSchemaText, exactCountSql, verifyExactCounts, createFixtureState, resetFixtureState, createNeonPasswords } from './postgres.mjs';
import { createTlsFetch } from '../adapters/neon.mjs';
import { DATASET_COUNTS, entityId, seedDataset } from '../dataset.mjs';

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
export function createNeonSql({ sql, endpoint = 'https://localhost:4444/sql' } = {}) {
  const client = typeof sql === 'function' ? sql : sql;
  if (!client || typeof client.query !== 'function') throw new TypeError('Neon SQL transport is required');
  return { endpoint, async query(text, params = [], options = {}) { return rowsOf(await client.query(text, params, options.fetchOptions ? { fetchOptions: options.fetchOptions } : undefined)); } };
}

export function createNeonAdmin({ sql, seed = 42, password = `Bb-v3-${seed}-capacity!`, runtime } = {}) {
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
  async function verify() { return verifyExactCounts((text, params) => query(text, params)); }
  async function teardown() {
    let failure;
    try { await query('DROP SCHEMA IF EXISTS benchmark_fixture CASCADE; DROP SCHEMA IF EXISTS benchmark_auth CASCADE; DROP TABLE IF EXISTS public.activities, public.comments, public.tasks, public.projects, public.memberships, public.organizations, public.users CASCADE; DROP SCHEMA IF EXISTS benchmark_private CASCADE; DROP SCHEMA IF EXISTS benchmark_extensions CASCADE;'); }
    catch (error) { failure = error; }
    try { await rm(configPath, { force: true }); } catch (error) { if (!failure) failure = error; else failure.cleanupError = String(error?.message ?? error); }
    if (failure) throw failure;
  }
  return {
    async setup() {
      try {
        await query(await loadSchemaText());
        for await (const batch of seedDataset(seed, 1_000)) await insertBatch(batch.entity, batch.records);
        await query('UPDATE public.users SET auth_subject = id WHERE auth_subject IS NULL');
        await createNeonPasswords((text, params) => query(text, params), password);
        await createFixtureState((text, params) => query(text, params));
        await mkdir(stateDir, { recursive: true, mode: 0o700 });
        await chmod(stateDir, 0o700);
        await writeFile(configPath, `${JSON.stringify({ seed, password })}\n`, { mode: 0o600 });
        await verify();
      } catch (error) {
        try { await teardown(); } catch (cleanupError) { if (error && typeof error === 'object') error.cleanupError = String(cleanupError?.message ?? cleanupError); }
        throw error;
      }
    },
    verify,
    async reset() { await resetFixtureState((text, params) => query(text, params)); await verify(); },
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
    instance = createNeonAdmin({ sql: neon(connectionString), runtime: process.env.BAAS_BENCH_RUNTIME });
  }
  return instance;
}
export async function setup(context) { return (await getDefault()).setup(context); }
export async function verify(context) { return (await getDefault()).verify(context); }
export async function reset(context) { return (await getDefault()).reset(context); }
export async function teardown(context) { return (await getDefault()).teardown(context); }
