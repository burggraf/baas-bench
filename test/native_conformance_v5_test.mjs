import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runNativeConformance } from '../benchmark-sets/realworld-api-v5/shared/lib/native-conformance.mjs';
import { assertConformance } from '../benchmark-sets/realworld-api-v5/shared/lib/conformance.mjs';

test('native probe CLIs reject missing or unexpected authorization arguments before setup', () => {
  for (const platform of ['trailbase', 'supabase']) {
    for (const args of [[], ['--existing-stack'], ['--local-disposable', 'unexpected']]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./native_v5_${platform}_probe.mjs`, import.meta.url)), ...args], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /usage:/);
      assert.equal(result.stdout, '');
    }
  }
});

function probe({ badSearch = false, badCount = false, staleRole = false, authWrite = false } = {}) {
  let role = 'member', body = 'Original', displayName = 'Member', authName = 'Native';
  const fixture = { organizationId: 'org', projectId: 'project', taskId: 'a', otherAuthorCommentId: 'comment', memberMembershipId: 'membership', taskIds: ['a', 'b'], unassignedTaskIds: ['b'], searches: [{ query: 'literal_%\\.*', ids: ['a'] }, { query: 'missing', ids: [] }] };
  const member = {
    async searchTasks({ query }) { const ids = query === 'missing' ? [] : ['a']; return { items: (badSearch ? ['wrong'] : ids).map(id => ({ id })), total: ids.length, hasNext: false }; },
    async listTasks({ assigneeId, page }) { const ids = assigneeId === null ? ['b'] : ['a', 'b']; return { items: ids.slice(page, page + 1).map(id => ({ id })), total: badCount && page >= ids.length ? 0 : ids.length, hasNext: page + 1 < ids.length, page, pageSize: 1 }; },
    async getTask() { return { comments: { items: [{ id: 'comment', body }] } }; },
    async updateComment(input) { if (role !== 'admin' && !staleRole) throw Object.assign(new Error('denied'), { status: 403 }); body = input.body; return { body }; },
    async getProfile() { return { displayName }; },
    async updateProfile(input) { displayName = input.displayName; if (authWrite) authName = displayName; return { displayName }; },
  };
  const owner = { async updateMembershipRole(input) { role = input.role; }, async updateComment(input) { body = input.body; } };
  return { sessions: { member, owner }, fixture, async readAuthState() { return { name: authName }; }, state() { return { role, body, displayName }; } };
}

test('shared native checks require remaining native evidence and restore their mutations', async () => {
  const input = probe();
  const report = await runNativeConformance(input);
  for (const name of ['search-semantics', 'pagination-and-null-filters', 'live-role-revocation', 'application-only-profile']) assert.equal(report.findings.find(row => row.name === name).passed, true);
  assert.equal(report.passed, false);
  assert.throws(() => assertConformance(report), /incomplete/);
  assert.deepEqual(input.state(), { role: 'member', body: 'Original', displayName: 'Member' });
});

for (const [option, name] of [['badSearch', 'search-semantics'], ['badCount', 'pagination-and-null-filters'], ['staleRole', 'live-role-revocation'], ['authWrite', 'application-only-profile']]) {
  test(`shared native checks reject ${option}`, async () => {
    const input = probe({ [option]: true });
    const report = await runNativeConformance(input);
    assert.equal(report.findings.find(row => row.name === name).passed, false);
    assert.deepEqual(input.state(), { role: 'member', body: 'Original', displayName: 'Member' });
  });
}

test('empty search or pagination fixtures cannot pass vacuously', async () => {
  const input = probe(); input.fixture.searches = []; input.fixture.taskIds = [];
  const report = await runNativeConformance(input);
  for (const name of ['search-semantics', 'pagination-and-null-filters']) assert.equal(report.findings.find(row => row.name === name).passed, false);
});

test('shared profile check cannot pass without a native Auth-state reader', async () => {
  const input = probe(); delete input.readAuthState;
  const report = await runNativeConformance(input);
  assert.equal(report.findings.find(row => row.name === 'application-only-profile').passed, false);
});
