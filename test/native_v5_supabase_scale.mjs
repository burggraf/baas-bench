import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureBatches, FIXTURE_COLUMNS } from '../benchmark-sets/realworld-api-v5/shared/lib/fixture.mjs';
import { DATASET_COUNTS, buildVirtualUserSpecs } from '../benchmark-sets/realworld-api-v5/shared/lib/dataset.mjs';
import { createSupabaseAdapter } from '../benchmark-sets/realworld-api-v5/shared/lib/adapters/supabase.mjs';
import { closeNativeSessions } from '../benchmark-sets/realworld-api-v5/shared/lib/native-conformance.mjs';

const tables = Object.keys(FIXTURE_COLUMNS);
const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
export function restoreSupabaseScaleSQL(tables, userColumns, identityColumns) {
  return 'BEGIN;\nTRUNCATE TABLE ' + [...tables].reverse().map(table => `public.${table}`).join(',') + ' CASCADE;\n' +
    tables.map(table => `INSERT INTO public.${table} SELECT * FROM v5_scale_baseline.${table};`).join('\n') +
    `\nDELETE FROM auth.users; INSERT INTO auth.users(${userColumns}) SELECT ${userColumns} FROM v5_scale_baseline.auth_users; INSERT INTO auth.identities(${identityColumns}) SELECT ${identityColumns} FROM v5_scale_baseline.auth_identities; COMMIT;`;
}

export async function runSupabaseScaleProbe({ sql, createUser, createClient, base, anon, call, dir }) {
  const progress = { scope: 'declared-scale-conformance-not-measurement', phase: 'seed', application_records: 0, auth_accounts: 0 };
  const save = () => { progress.updated_at = new Date().toISOString(); writeFileSync(join(dir, 'progress.json'), JSON.stringify(progress, null, 2), { mode: 0o600 }); };
  const expected = {}, hashers = {}, emails = [];
  for (const table of tables) hashers[table] = createHash('sha256');
  for await (const batch of fixtureBatches(42, 500)) {
    sql(`INSERT INTO public.${batch.table}(${batch.columns.join(',')}) VALUES ${batch.rows.map(row => `(${row.map(quote).join(',')})`).join(',')}`);
    for (const row of batch.rows) { hashers[batch.table].update(JSON.stringify(row) + '\n'); if (batch.table === 'users') emails.push({ id: row[0], email: row[1] }); }
    progress.application_records += batch.rows.length; save();
    if (progress.application_records % 100000 === 0) console.log(`V5_SCALE_SEED ${progress.application_records}`);
  }
  for (const table of tables) expected[table] = { count: DATASET_COUNTS[table], sha256: hashers[table].digest('hex') };
  progress.phase = 'native-auth'; save();
  for (let start = 0; start < emails.length; start += 100) {
    const mappings = [];
    for (const user of emails.slice(start, start + 100)) {
      const created = await createUser(user.email, 'Bb-v3-42-capacity!'); assert.equal(typeof created.id, 'string');
      mappings.push(`WHEN id=${quote(user.id)} THEN ${quote(created.id)}`); progress.auth_accounts++;
    }
    sql(`UPDATE public.users SET auth_subject=CASE ${mappings.join(' ')} ELSE auth_subject END WHERE id IN (${emails.slice(start, start + 100).map(user => quote(user.id)).join(',')})`); save();
    if (progress.auth_accounts % 1000 === 0) console.log(`V5_SCALE_AUTH ${progress.auth_accounts}`);
  }
  const rows = statement => sql(statement).trim().split('\n').filter(Boolean).map(row => JSON.parse(row));
  async function verify() {
    const actual = {};
    for (const table of tables) {
      const columns = FIXTURE_COLUMNS[table].map(column => ['created_at', 'updated_at', 'due_date'].includes(column) ? `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` : column);
      const hash = createHash('sha256'); let cursor = '', count = 0;
      for (;;) {
        const batch = rows(`SELECT json_build_array(${columns.join(',')}) FROM public.${table} WHERE id>${quote(cursor)} COLLATE "C" ORDER BY id COLLATE "C" LIMIT 1000`);
        if (!batch.length) break;
        for (const row of batch) hash.update(JSON.stringify(row) + '\n');
        count += batch.length; cursor = batch.at(-1)[0];
      }
      actual[table] = { count, sha256: hash.digest('hex') };
      assert.deepEqual(actual[table], expected[table], `${table} logical fixture mismatch`);
    }
    assert.equal(Number(sql('SELECT count(*) FROM public.users u JOIN auth.users a ON u.auth_subject=a.id::text AND u.email=a.email').trim()), DATASET_COUNTS.users);
    return actual;
  }
  progress.phase = 'verify-fixture'; save();
  const baseline = await verify();
  const evidence = { passed: false, seed: 42, application_records: progress.application_records, native_auth_accounts: progress.auth_accounts, baseline, reset_cycles: [], measurement_qualified: false };
  const saveEvidence = () => writeFileSync(join(dir, 'scale-evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  saveEvidence();
  sql('CREATE SCHEMA v5_scale_baseline;\n' + tables.map(table => `CREATE TABLE v5_scale_baseline.${table} AS SELECT * FROM public.${table};`).join('\n') + '\nCREATE TABLE v5_scale_baseline.auth_users AS SELECT * FROM auth.users; CREATE TABLE v5_scale_baseline.auth_identities AS SELECT * FROM auth.identities;');
  const authState = () => sql("SELECT jsonb_build_object('users',(SELECT jsonb_build_object('count',count(*),'sha256',encode(benchmark_extensions.digest(string_agg(to_jsonb(u)::text,E'\\n' ORDER BY id),'sha256'),'hex')) FROM auth.users u),'identities',(SELECT jsonb_build_object('count',count(*),'sha256',encode(benchmark_extensions.digest(string_agg(to_jsonb(i)::text,E'\\n' ORDER BY id),'sha256'),'hex')) FROM auth.identities i))").trim();
  const authBaseline = authState();
  evidence.native_auth_baseline = JSON.parse(authBaseline); saveEvidence();
  const authColumns = table => rows(`SELECT to_json(column_name) FROM information_schema.columns WHERE table_schema='auth' AND table_name=${quote(table)} AND is_generated='NEVER' ORDER BY ordinal_position`).map(column => `"${column}"`).join(',');
  const userColumns = authColumns('users'), identityColumns = authColumns('identities');
  const adapter = createSupabaseAdapter({ sdkCreateClient: createClient, url: base, key: anon, timeoutMs: 10000 });
  const specs = buildVirtualUserSpecs(3201, 42), ownerSpec = specs[0], memberSpec = specs[3200];
  const fixture = adapter.correctnessFixture(), resetCycles = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    progress.phase = `mutation-cycle-${cycle + 1}`; save();
    let owner, member, refresh, mutationError;
    try {
      owner = await adapter.createSession(ownerSpec.credentials);
      member = await adapter.createSession(memberSpec.credentials);
      const token = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: memberSpec.credentials });
      assert.equal(token.ok, true); refresh = token.data.refresh_token;
      await owner.updateProfile({ displayName: 'Modified baseline profile' });
      await owner.updateTask({ organizationId: fixture.organizationId, projectId: fixture.projectId, taskId: fixture.taskId, title: 'Modified baseline task' });
      await owner.updateComment({ organizationId: fixture.organizationId, projectId: fixture.projectId, taskId: fixture.taskId, commentId: fixture.commentId, body: 'Modified baseline comment' });
      await owner.updateMembershipRole({ organizationId: fixture.organizationId, membershipId: fixture.memberMembershipId, role: 'admin' });
      const task = await member.createTask({ organizationId: fixture.organizationId, projectId: fixture.projectId, title: 'Created reset task', description: '' });
      await member.addComment({ organizationId: fixture.organizationId, projectId: fixture.projectId, taskId: task.id, body: 'Created reset comment' });
      await createUser(`extra-${cycle}@v5-scale.example.test`, 'V5-extra-password-Aa91!');
      sql(`UPDATE auth.users SET email='mutated-${cycle}@v5-scale.example.test' WHERE email=${quote(memberSpec.credentials.email)}`);
    } catch (error) { mutationError = error; }
    finally { await closeNativeSessions([member, owner], mutationError); }
    progress.phase = `reset-cycle-${cycle + 1}`; save();
    sql(restoreSupabaseScaleSQL(tables, userColumns, identityColumns), { timeout: 600000 });
    progress.phase = `verify-reset-cycle-${cycle + 1}`; save();
    const restored = await verify(); assert.equal(authState(), authBaseline, 'native Auth baseline mismatch');
    assert.equal(Number(sql('SELECT count(*) FROM auth.sessions').trim()), 0);
    const refreshed = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refresh } });
    assert.ok([400, 401].includes(refreshed.status));
    assert.ok(['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(refreshed.data?.error_code), 'refresh denial must be native session invalidation');
    const login = await adapter.createSession(memberSpec.credentials); await login.getProfile(); await login.close();
    resetCycles.push({ cycle: cycle + 1, application_digest_restored: true, native_auth_restored: true, fresh_login_passed: true, refresh_session_ended: true, fixture: restored });
    evidence.reset_cycles = resetCycles; saveEvidence();
    console.log(`V5_SCALE_RESET ${cycle + 1}`);
  }
  progress.phase = 'complete'; save();
  evidence.passed = true; saveEvidence();
  return evidence;
}
