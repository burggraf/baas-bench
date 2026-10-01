import assert from 'node:assert/strict';
import { runConformance } from './conformance.mjs';

// Native drivers supply raw API/security, fixture, reset and persistence checks.
// Adapter checks below are shared; they never substitute for the raw API checks.
export async function runNativeConformance({ sessions, fixture, readAuthState, checks = {} }) {
  const { member, owner } = sessions;
  const scope = { organizationId: fixture.organizationId, projectId: fixture.projectId };
  return runConformance({
    ...checks,
    async 'search-semantics'() {
      assert.ok(Array.isArray(fixture.searches) && fixture.searches.length >= 2, 'matching and nonmatching searches are required');
      assert.ok(fixture.searches.some(row => row.ids.length > 0) && fixture.searches.some(row => row.ids.length === 0));
      for (const { query, ids } of fixture.searches) {
        const page = await member.searchTasks({ ...scope, query, page: 0, pageSize: 100 });
        assert.deepEqual(page.items.map(row => row.id), ids);
        assert.equal(page.total, ids.length);
        assert.equal(page.hasNext, false);
      }
      return true;
    },
    async 'pagination-and-null-filters'() {
      assert.ok(Array.isArray(fixture.taskIds) && fixture.taskIds.length >= 2, 'multiple ordered fixture tasks are required');
      assert.ok(Array.isArray(fixture.unassignedTaskIds) && fixture.unassignedTaskIds.length > 0, 'unassigned fixture tasks are required');
      for (const assigneeId of [undefined, null]) {
        const ids = assigneeId === null ? fixture.unassignedTaskIds : fixture.taskIds;
        for (let page = 0; page <= ids.length + 1; page++) {
          const result = await member.listTasks({ ...scope, assigneeId, page, pageSize: 1 });
          assert.deepEqual(result.items.map(row => row.id), ids.slice(page, page + 1));
          assert.equal(result.total, ids.length);
          assert.equal(result.hasNext, page + 1 < ids.length);
          assert.equal(result.page, page);
          assert.equal(result.pageSize, 1);
        }
      }
      return true;
    },
    async 'live-role-revocation'() {
      const input = { ...scope, taskId: fixture.taskId, commentId: fixture.otherAuthorCommentId };
      const role = { organizationId: scope.organizationId, membershipId: fixture.memberMembershipId };
      const before = await member.getTask({ ...scope, taskId: fixture.taskId });
      const comment = before.comments.items.find(row => row.id === input.commentId);
      assert.ok(comment, 'fixture comment must be on the first page');
      try {
        await owner.updateMembershipRole({ ...role, role: 'admin' });
        assert.equal((await member.updateComment({ ...input, body: 'V5 promoted edit' })).body, 'V5 promoted edit');
        await owner.updateMembershipRole({ ...role, role: 'member' });
        await assert.rejects(member.updateComment({ ...input, body: 'V5 forbidden edit' }), error => Number(error.status) === 403);
        const after = await member.getTask({ ...scope, taskId: fixture.taskId });
        assert.equal(after.comments.items.find(row => row.id === input.commentId)?.body, 'V5 promoted edit');
      } finally {
        await owner.updateMembershipRole({ ...role, role: 'member' });
        await owner.updateComment({ ...input, body: comment.body });
      }
      return true;
    },
    async 'application-only-profile'() {
      assert.equal(typeof readAuthState, 'function', 'native Auth-state reader is required');
      const profile = await member.getProfile();
      const before = await readAuthState();
      assert.ok(before && typeof before === 'object' && Object.keys(before).length > 0, 'nonempty native Auth state is required');
      try {
        assert.equal((await member.updateProfile({ displayName: 'V5 app-only profile' })).displayName, 'V5 app-only profile');
        assert.equal((await member.getProfile()).displayName, 'V5 app-only profile');
        assert.deepEqual(await readAuthState(), before);
      } finally {
        await member.updateProfile({ displayName: profile.displayName });
      }
      return true;
    },
  });
}
