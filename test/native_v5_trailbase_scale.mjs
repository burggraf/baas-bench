import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureBatches, FIXTURE_COLUMNS } from '../benchmark-sets/realworld-api-v5/shared/lib/fixture.mjs';
import { DATASET_COUNTS, buildVirtualUserSpecs } from '../benchmark-sets/realworld-api-v5/shared/lib/dataset.mjs';
import { createTrailBaseAdapter } from '../benchmark-sets/realworld-api-v5/shared/lib/adapters/trailbase.mjs';
import { closeNativeSessions } from '../benchmark-sets/realworld-api-v5/shared/lib/native-conformance.mjs';

const tables = Object.keys(FIXTURE_COLUMNS);
const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
export const SCALE_SNAPSHOT_MIGRATION = tables.map(table => `CREATE TABLE v5_baseline_${table} AS SELECT * FROM ${table} WHERE 0;`).join('\n') + '\nCREATE TABLE v5_baseline_auth AS SELECT * FROM _user WHERE 0;\n';
export const RESTORE_APPLICATION_SQL = [...tables].reverse().map(table => `DELETE FROM ${table};`).join('\n') + '\n' + tables.map(table => `INSERT INTO ${table} SELECT * FROM v5_baseline_${table};`).join('\n');

// No timed capacity search. This verifies a full fixture and two reset cycles.
export async function restoreTrailBaseScaleBaseline({ query, authColumns, renewAdmin }) {
  await query('BEGIN;\n' + RESTORE_APPLICATION_SQL + `\nDELETE FROM _user; INSERT INTO _user(${authColumns.join(',')}) SELECT ${authColumns.join(',')} FROM v5_baseline_auth; COMMIT;`);
  // Auth restoration deletes the controller's refresh session too. Re-login,
  // never retry an ambiguously acknowledged restore or retain old actor sessions.
  await renewAdmin();
}

export async function runTrailBaseScaleProbe({ query, createUser, initClient, base, dir, renewAdmin }) {
  const progress = { scope: 'declared-scale-conformance-not-measurement', phase: 'seed', application_records: 0, auth_accounts: 0 };
  const save = () => { progress.updated_at = new Date().toISOString(); writeFileSync(join(dir, 'progress.json'), JSON.stringify(progress, null, 2), { mode: 0o600 }); };
  const expected = {}, hashers = {};
  const emails = [];
  for (const table of tables) hashers[table] = createHash('sha256');
  for await (const batch of fixtureBatches(42, 500)) {
    const columns = batch.columns.map(column => column === 'id' ? 'external_id' : column);
    await query(`INSERT INTO ${batch.table}(${columns.join(',')}) VALUES ${batch.rows.map(row => `(${row.map(quote).join(',')})`).join(',')}`);
    for (const row of batch.rows) { hashers[batch.table].update(JSON.stringify(row) + '\n'); if (batch.table === 'users') emails.push({ id: row[0], email: row[1] }); }
    progress.application_records += batch.rows.length;
    save();
    if (progress.application_records % 100000 === 0) console.log(`V5_SCALE_SEED ${progress.application_records}`);
  }
  for (const table of tables) expected[table] = { count: DATASET_COUNTS[table], sha256: hashers[table].digest('hex') };
  progress.phase = 'native-auth'; save();
  for (let start = 0; start < emails.length; start += 100) {
    const mappings = [];
    for (const user of emails.slice(start, start + 100)) {
      const created = await createUser(user.email, 'Bb-v3-42-capacity!');
      assert.equal(typeof created.id, 'string');
      mappings.push(`WHEN external_id=${quote(user.id)} THEN ${quote(created.id.replaceAll('-', ''))}`);
      progress.auth_accounts++;
    }
    await query(`UPDATE users SET auth_subject=CASE ${mappings.join(' ')} ELSE auth_subject END WHERE external_id IN (${emails.slice(start, start + 100).map(user => quote(user.id)).join(',')})`);
    save();
    if (progress.auth_accounts % 1000 === 0) console.log(`V5_SCALE_AUTH ${progress.auth_accounts}`);
  }
  async function verify() {
    const actual = {};
    for (const table of tables) {
      const columns = FIXTURE_COLUMNS[table].map(column => column === 'id' ? 'external_id' : column);
      const hash = createHash('sha256'); let cursor = '', count = 0;
      for (;;) {
        const rows = await query(`SELECT ${columns.join(',')} FROM ${table} WHERE external_id>${quote(cursor)} ORDER BY external_id LIMIT 1000`);
        if (!rows.length) break;
        for (const row of rows) hash.update(JSON.stringify(row) + '\n');
        count += rows.length; cursor = rows.at(-1)[0];
      }
      actual[table] = { count, sha256: hash.digest('hex') };
      assert.deepEqual(actual[table], expected[table], `${table} logical fixture mismatch`);
    }
    assert.equal((await query('SELECT count(*) FROM users u JOIN _user a ON lower(u.auth_subject)=lower(hex(a.id)) AND u.email=a.email'))[0][0], DATASET_COUNTS.users);
    return actual;
  }
  progress.phase = 'verify-fixture'; save();
  const baseline = await verify();
  const evidence = { passed: false, seed: 42, application_records: progress.application_records, native_auth_accounts: progress.auth_accounts, baseline, reset_cycles: [], measurement_qualified: false };
  const saveEvidence = () => writeFileSync(join(dir, 'scale-evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  saveEvidence();
  await query(tables.map(table => `INSERT INTO v5_baseline_${table} SELECT * FROM ${table};`).join('\n') + '\nINSERT INTO v5_baseline_auth SELECT * FROM _user;');
  const authColumns = (await query('PRAGMA table_info(_user)')).map(row => row[1]);
  async function authState() {
    const hash = createHash('sha256'); let cursor = '', count = 0;
    const emailIndex = authColumns.indexOf('email'); assert.ok(emailIndex >= 0);
    for (;;) {
      const rows = await query(`SELECT * FROM _user WHERE email>${quote(cursor)} ORDER BY email LIMIT 1000`);
      if (!rows.length) break;
      for (const row of rows) hash.update(JSON.stringify(row) + '\n');
      count += rows.length; cursor = rows.at(-1)[emailIndex];
    }
    assert.equal(count, (await query('SELECT count(*) FROM _user'))[0][0]);
    return { count, sha256: hash.digest('hex') };
  }
  const authBaseline = await authState();
  evidence.native_auth_baseline = authBaseline; saveEvidence();
  const adapter = createTrailBaseAdapter({ initClient, endpoint: base, timeoutMs: 10000 });
  const specs = buildVirtualUserSpecs(3201, 42);
  const ownerSpec = specs[0], memberSpec = specs[3200];
  const fixture = adapter.correctnessFixture();
  const resetCycles = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    progress.phase = `mutation-cycle-${cycle + 1}`; save();
    let owner, member, refresh, mutationError;
    try {
      owner = await adapter.createSession(ownerSpec.credentials);
      member = await adapter.createSession(memberSpec.credentials);
      refresh = member.client.tokens()?.refresh_token;
      assert.ok(refresh, 'native refresh token missing');
      await owner.updateProfile({ displayName: 'Modified baseline profile' });
      await owner.updateTask({ organizationId: fixture.organizationId, projectId: fixture.projectId, taskId: fixture.taskId, title: 'Modified baseline task' });
      await owner.updateComment({ organizationId: fixture.organizationId, projectId: fixture.projectId, taskId: fixture.taskId, commentId: fixture.commentId, body: 'Modified baseline comment' });
      await owner.updateMembershipRole({ organizationId: fixture.organizationId, membershipId: fixture.memberMembershipId, role: 'admin' });
      const task = await member.createTask({ organizationId: fixture.organizationId, projectId: fixture.projectId, title: 'Created reset task', description: '' });
      await member.addComment({ organizationId: fixture.organizationId, projectId: fixture.projectId, taskId: task.id, body: 'Created reset comment' });
      await createUser(`extra-${cycle}@v5-scale.example.test`, 'V5-extra-password-Aa91!');
      await query(`UPDATE _user SET email='mutated-${cycle}@v5-scale.example.test' WHERE email=${quote(memberSpec.credentials.email)}`);
    } catch (error) { mutationError = error; }
    finally { await closeNativeSessions([member, owner], mutationError); }
    const refreshed = await fetch(`${base}/api/auth/v1/refresh`, { method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) });
    assert.equal(refreshed.status, 401, 'closed native refresh session must be rejected by Auth');
    progress.phase = `reset-cycle-${cycle + 1}`; save();
    await restoreTrailBaseScaleBaseline({ query, authColumns, renewAdmin });
    progress.phase = `verify-reset-cycle-${cycle + 1}`; save();
    const restored = await verify();
    assert.deepEqual(await authState(), authBaseline, 'native Auth baseline mismatch');
    const login = await adapter.createSession(memberSpec.credentials);
    await login.getProfile(); await login.close();
    resetCycles.push({ cycle: cycle + 1, application_digest_restored: true, native_auth_restored: true, fresh_login_passed: true, refresh_session_ended: true, fixture: restored });
    evidence.reset_cycles = resetCycles; saveEvidence();
    console.log(`V5_SCALE_RESET ${cycle + 1}`);
  }
  progress.phase = 'complete'; save();
  evidence.passed = true; saveEvidence();
  return evidence;
}
