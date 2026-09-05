import { readFile } from 'node:fs/promises';

import { DATASET_COUNTS, entityId } from '../dataset.mjs';

export const APPLICATION_TABLES = Object.freeze([
  'organizations', 'users', 'memberships', 'projects', 'tasks', 'comments', 'activities',
]);

const COPY_DEFINITIONS = Object.freeze({
  organization: Object.freeze({ table: 'organizations', columns: ['id', 'name', 'owner_id', 'created_at'], fields: ['id', 'name', 'ownerId', 'createdAt'] }),
  user: Object.freeze({ table: 'users', columns: ['id', 'email', 'display_name', 'created_at', 'updated_at'], fields: ['id', 'email', 'displayName', 'createdAt', 'updatedAt'] }),
  membership: Object.freeze({ table: 'memberships', columns: ['id', 'organization_id', 'user_id', 'role', 'created_at'], fields: ['id', 'organizationId', 'userId', 'role', 'createdAt'] }),
  project: Object.freeze({ table: 'projects', columns: ['id', 'organization_id', 'name', 'status', 'created_at', 'updated_at'], fields: ['id', 'organizationId', 'name', 'status', 'createdAt', 'updatedAt'] }),
  task: Object.freeze({ table: 'tasks', columns: ['id', 'organization_id', 'project_id', 'creator_id', 'assignee_id', 'title', 'description', 'status', 'priority', 'due_date', 'created_at', 'updated_at'], fields: ['id', 'organizationId', 'projectId', 'creatorId', 'assigneeId', 'title', 'description', 'status', 'priority', 'dueDate', 'createdAt', 'updatedAt'] }),
  comment: Object.freeze({ table: 'comments', columns: ['id', 'organization_id', 'project_id', 'task_id', 'author_id', 'body', 'created_at', 'updated_at'], fields: ['id', 'organizationId', 'projectId', 'taskId', 'authorId', 'body', 'createdAt', 'updatedAt'] }),
  activity: Object.freeze({ table: 'activities', columns: ['id', 'organization_id', 'project_id', 'actor_id', 'action', 'subject_type', 'subject_id', 'created_at'], fields: ['id', 'organizationId', 'projectId', 'actorId', 'action', 'subjectType', 'subjectId', 'createdAt'] }),
});

const TABLE_SET = new Set(APPLICATION_TABLES);
const BASELINE_MARKER = 'realworld-api-v3-baseline-v1';
const schemaUrl = new URL('../../sql/postgres-schema.sql', import.meta.url);

export async function loadSchemaText(url = schemaUrl) {
  return readFile(url, 'utf8');
}

export function encodeCopyValue(value) {
  if (value === null || value === undefined) return String.raw`\N`;
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
}

export function encodeCopyRow(values) {
  if (!Array.isArray(values)) throw new TypeError('COPY row must be an array');
  return `${values.map(encodeCopyValue).join('\t')}\n`;
}

export function copyStatement(table) {
  const definition = Object.values(COPY_DEFINITIONS).find(candidate => candidate.table === table);
  if (!definition || !TABLE_SET.has(table)) throw new RangeError(`unsupported COPY table: ${table}`);
  return `COPY public.${definition.table} (${definition.columns.join(', ')}) FROM STDIN`;
}

function ordinalFromId(id, prefix) {
  if (typeof id !== 'string' || !id.startsWith(prefix) || !/^[0-9a-z]{11}$/.test(id.slice(prefix.length))) {
    throw new TypeError(`invalid deterministic ${prefix} identifier`);
  }
  return Number.parseInt(id.slice(prefix.length), 36);
}

function copyRecord(entity, record) {
  if (entity === 'task') {
    const project = ordinalFromId(record.projectId, 'prjv3');
    return { ...record, organizationId: entityId('organization', project % DATASET_COUNTS.organizations) };
  }
  if (entity === 'comment') {
    const task = ordinalFromId(record.taskId, 'tskv3');
    const project = task % DATASET_COUNTS.projects;
    return {
      ...record,
      projectId: entityId('project', project),
      organizationId: entityId('organization', project % DATASET_COUNTS.organizations),
    };
  }
  return record;
}

export async function copyDataset({ batches, copy, maxBatchSize = 1_000 }) {
  if (!batches || typeof batches[Symbol.asyncIterator] !== 'function') throw new TypeError('batches must be an async iterable');
  if (typeof copy !== 'function') throw new TypeError('copy transport is required');
  if (!Number.isSafeInteger(maxBatchSize) || maxBatchSize < 1) throw new RangeError('maxBatchSize must be a positive integer');
  const totals = Object.fromEntries(APPLICATION_TABLES.map(table => [table, 0]));
  for await (const batch of batches) {
    const definition = COPY_DEFINITIONS[batch?.entity];
    if (!definition) throw new RangeError(`unsupported entity: ${batch?.entity}`);
    if (!Array.isArray(batch.records) || batch.records.length < 1) throw new TypeError('COPY batch must contain records');
    if (batch.records.length > maxBatchSize) throw new RangeError(`COPY batch exceeds maximum of ${maxBatchSize}`);
    let data = '';
    for (const source of batch.records) {
      const record = copyRecord(batch.entity, source);
      data += encodeCopyRow(definition.fields.map(field => record[field]));
    }
    await copy({
      table: definition.table,
      columns: [...definition.columns],
      statement: copyStatement(definition.table),
      data,
      rowCount: batch.records.length,
    });
    totals[definition.table] += batch.records.length;
  }
  return totals;
}

export function exactCountSql() {
  return APPLICATION_TABLES
    .map(table => `SELECT '${table}' AS table_name, count(*)::text AS row_count FROM public.${table}`)
    .join('\nUNION ALL\n') + '\nORDER BY table_name;\n';
}

function resultRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  throw new TypeError('count transport must return rows');
}

export async function verifyExactCounts(query, expected = DATASET_COUNTS) {
  if (typeof query !== 'function') throw new TypeError('query transport is required');
  const rows = resultRows(await query(exactCountSql(), []));
  const seen = new Map();
  for (const row of rows) {
    const table = row.table ?? row.table_name;
    if (!TABLE_SET.has(table)) throw new Error(`unexpected table in exact-count result: ${table}`);
    if (seen.has(table)) throw new Error(`duplicate table in exact-count result: ${table}`);
    const rawCount = row.count ?? row.row_count;
    if (!/^\d+$/.test(String(rawCount))) throw new Error(`invalid count for ${table}`);
    seen.set(table, BigInt(rawCount));
  }
  for (const table of APPLICATION_TABLES) {
    if (!seen.has(table)) throw new Error(`${table} count is missing`);
    const wanted = BigInt(expected[table]);
    if (seen.get(table) !== wanted) throw new Error(`${table} count expected ${wanted}, received ${seen.get(table)}`);
  }
  return true;
}

const snapshotTables = APPLICATION_TABLES.map(table =>
  `CREATE TABLE benchmark_fixture.${table} AS TABLE public.${table};`).join('\n');
const RESTORE_ORDER = Object.freeze([
  'users', 'organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities',
]);
const restoreTables = RESTORE_ORDER.map(table =>
  `INSERT INTO public.${table} SELECT * FROM benchmark_fixture.${table};`).join('\n');

export const CREATE_FIXTURE_STATE_SQL = `BEGIN;
DROP SCHEMA IF EXISTS benchmark_fixture CASCADE;
CREATE SCHEMA benchmark_fixture;
CREATE TABLE benchmark_fixture.marker (value text PRIMARY KEY);
INSERT INTO benchmark_fixture.marker(value) VALUES ('${BASELINE_MARKER}');
${snapshotTables}
CREATE TABLE benchmark_fixture.passwords AS TABLE benchmark_auth.passwords;
DO $$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'raw_user_meta_data') THEN
      EXECUTE 'CREATE TABLE benchmark_fixture.auth_users AS SELECT id, email, raw_user_meta_data FROM auth.users WHERE email LIKE ''user-%@example.test''';
    ELSE
      EXECUTE 'CREATE TABLE benchmark_fixture.auth_users AS SELECT id, email FROM auth.users WHERE email LIKE ''user-%@example.test''';
    END IF;
  END IF;
END $$;
COMMIT;
`;

export const RESET_FIXTURE_STATE_SQL = `BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM benchmark_fixture.marker WHERE value = '${BASELINE_MARKER}') THEN
    RAISE EXCEPTION 'fixture baseline marker is missing';
  END IF;
END $$;
SET LOCAL row_security = off;
TRUNCATE TABLE public.activities, public.comments, public.tasks, public.projects, public.memberships, public.organizations, public.users CASCADE;
${restoreTables}
INSERT INTO benchmark_auth.passwords SELECT * FROM benchmark_fixture.passwords;
TRUNCATE TABLE benchmark_auth.sessions;
DO $$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL AND to_regclass('benchmark_fixture.auth_users') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'raw_user_meta_data') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'benchmark_fixture' AND table_name = 'auth_users' AND column_name = 'raw_user_meta_data') THEN
      EXECUTE 'UPDATE auth.users AS u SET raw_user_meta_data = b.raw_user_meta_data FROM benchmark_fixture.auth_users AS b WHERE u.id = b.id';
    END IF;
    IF to_regclass('auth.sessions') IS NOT NULL THEN
      EXECUTE 'DELETE FROM auth.sessions WHERE user_id IN (SELECT id FROM benchmark_fixture.auth_users)';
    END IF;
  END IF;
END $$;
COMMIT;
`;

export const CREATE_NEON_PASSWORDS_SQL = `INSERT INTO benchmark_auth.passwords(user_id, password_hash)
SELECT id, benchmark_extensions.crypt($1, benchmark_extensions.gen_salt('bf')) FROM public.users
ON CONFLICT (user_id) DO UPDATE SET password_hash = excluded.password_hash;`;

export async function createFixtureState(execute) {
  if (typeof execute !== 'function') throw new TypeError('execute transport is required');
  return execute(CREATE_FIXTURE_STATE_SQL, []);
}

export async function resetFixtureState(execute) {
  if (typeof execute !== 'function') throw new TypeError('execute transport is required');
  return execute(RESET_FIXTURE_STATE_SQL, []);
}

export async function createNeonPasswords(execute, password) {
  if (typeof execute !== 'function') throw new TypeError('execute transport is required');
  if (typeof password !== 'string' || password.length === 0) throw new TypeError('password is required');
  return execute(CREATE_NEON_PASSWORDS_SQL, [password]);
}
