import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWarmupContexts, runWarmup, WARMUP, WORKFLOW_WEIGHTS } from '../benchmark-sets/realworld-api-v5/shared/lib/warmup.mjs';
import { runBaselinePhases } from '../benchmark-sets/realworld-api-v5/shared/lib/conformance.mjs';
import { closeNativeSessions } from '../benchmark-sets/realworld-api-v5/shared/lib/native-conformance.mjs';
import { lifecycleFixture } from './native_v5_lifecycle.mjs';

const specs = Array.from({ length: 50 }, (_, index) => ({ userId: `user${index}`, credentials: { email: `user${index}@example.test`, password: 'private' }, organizationId: 'org', projectId: 'project', taskId: 'task' }));
function fakeBackend({ rejectIndex } = {}) {
  const sessions = [];
  return { sessions, sessionPreparationConcurrency: 10, sessionPreparationBatchDelayMs: 0,
    async createSession(credentials, options) {
      assert.equal(options.timeoutMs, 5000);
      const index = specs.findIndex(spec => spec.credentials.email === credentials.email);
      if (index === rejectIndex) throw new Error('login failed');
      const profile = { id: specs[index].userId, email: credentials.email, displayName: 'User', createdAt: 'date', updatedAt: 'date' };
      const task = { id: 'task', organizationId: 'org', projectId: 'project', creatorId: profile.id, assigneeId: null, title: 'Task', description: 'Description', status: 'todo', priority: 'medium', dueDate: null, createdAt: 'date', updatedAt: 'date' };
      const comment = { id: 'comment', organizationId: 'org', taskId: 'task', authorId: profile.id, body: 'Body', createdAt: 'date', updatedAt: 'date' };
      const page = items => ({ items, page: 0, pageSize: 1, total: items.length, hasNext: false });
      const session = { closed: false, async close() { this.closed = true; }, async signOut() {}, async getProfile() { return profile; }, async updateProfile() { return profile; },
        async dashboard() { return { organization: { id: 'org' }, projects: [{ id: 'project', organizationId: 'org' }], recentActivity: [] }; },
        async listTasks() { return page([task]); }, async searchTasks() { return page([task]); },
        async getTask() { return { task, creator: profile, assignee: null, comments: page([comment]) }; },
        async createTask() { return task; }, async updateTask() { return task; }, async addComment() { return comment; } };
      sessions.push(session); return session;
    },
  };
}

test('V5 retains the approved warm-up constants and workflow mix', () => {
  assert.deepEqual(WARMUP, { users: 50, durationMs: 120000, seed: 42, timeoutMs: 5000 });
  assert.deepEqual(WORKFLOW_WEIGHTS, { dashboard: 20, taskList: 25, taskDetail: 15, createTask: 10, updateTask: 12, addComment: 10, search: 5, profileUpdate: 1, signIn: 2 });
});

test('V5 prepared contexts run a complete warm-up and retain live sessions at entry', async () => {
  const backend = fakeBackend(), contexts = [];
  let clock = 0;
  const time = { now: () => clock, wait: async ms => { clock += Math.max(1, Math.ceil(ms / 50)); } };
  const events = [];
  await runBaselinePhases({
    async reset() { events.push('reset'); }, async verifyBaseline() { events.push('verify'); return true; },
    async prepareSessions() { events.push('prepare'); return prepareWarmupContexts(backend, specs, contexts, time); },
    async warmUp() { events.push('warm-up'); const result = await runWarmup(contexts, time); assert.ok(Object.values(result.workflows).every(count => count > 0)); return result.passed; },
    async enterStage() { events.push('entry'); assert.equal(contexts.length, 50); assert.ok(contexts.every(context => !context.session.closed)); },
  });
  assert.deepEqual(events, ['reset', 'verify', 'prepare', 'warm-up', 'entry']);
  await closeNativeSessions(contexts.map(context => context.session));
  assert.ok(backend.sessions.every(session => session.closed));
});

test('V5 rejects sparse cohorts and does not swallow non-Error workflow failures', async () => {
  const backend = fakeBackend(), contexts = [];
  await prepareWarmupContexts(backend, specs, contexts);
  let clock = 0;
  const time = { now: () => clock, wait: async ms => { clock += Math.max(1, Math.ceil(ms / 50)); } };
  const sparse = contexts.slice(); delete sparse[0];
  await assert.rejects(runWarmup(sparse, time), /incomplete warm-up cohort/);
  contexts[0].invoke = async () => { throw null; };
  await assert.rejects(runWarmup(contexts, time), /warm-up operation failed/);
  await closeNativeSessions(contexts.map(context => context.session));
});

test('V5 lifecycle can prepare sessions serially even when adapter default is concurrent', async () => {
  const backend = fakeBackend(), contexts = [];
  let interBatchDelays = 0;
  await prepareWarmupContexts(backend, specs, contexts, { concurrency: 1, wait: async () => { interBatchDelays++; } });
  assert.equal(interBatchDelays, 49);
  assert.equal(contexts.length, 50);
  await closeNativeSessions(contexts.map(context => context.session));
});

test('V5 preparation failure leaves all successful concurrent sessions available for cleanup', async () => {
  const backend = fakeBackend({ rejectIndex: 3 }), contexts = [];
  await assert.rejects(prepareWarmupContexts(backend, specs, contexts), /login failed/);
  assert.equal(backend.sessions.length, 9);
  await closeNativeSessions(contexts.map(context => context?.session));
  assert.ok(backend.sessions.every(session => session.closed));
});

test('V5 warm-up failures drain peers, fail closed and never enter a stage', async () => {
  const backend = fakeBackend(), contexts = [];
  await prepareWarmupContexts(backend, specs, contexts);
  for (const context of contexts) context.session.dashboard = async () => { throw new Error('native failure'); };
  let entered = false;
  await assert.rejects(runBaselinePhases({ reset: async () => {}, verifyBaseline: async () => true, prepareSessions: async () => true,
    warmUp: async () => (await runWarmup(contexts)).passed, enterStage: async () => { entered = true; } }), /native failure/);
  assert.equal(entered, false);
  await closeNativeSessions(contexts.map(context => context.session));
});

test('V5 lifecycle diagnostic uses a closed subset of established seed identities', async () => {
  const { rows, specs } = await lifecycleFixture();
  assert.equal(specs.length, 50);
  const users = new Set(rows.users.map(row => row[0])), orgs = new Set(rows.organizations.map(row => row[0])), projects = new Set(rows.projects.map(row => row[0])), tasks = new Set(rows.tasks.map(row => row[0]));
  assert.equal(rows.tasks.length, 50); assert.equal(rows.comments.length, 50);
  assert.ok(rows.users.length < 500);
  for (const spec of specs) assert.ok(users.has(spec.userId) && orgs.has(spec.organizationId) && projects.has(spec.projectId) && tasks.has(spec.taskId));
  for (const row of rows.organizations) assert.ok(users.has(row[2]));
  for (const row of rows.memberships) assert.ok(orgs.has(row[1]) && users.has(row[2]));
  for (const row of rows.tasks) assert.ok(orgs.has(row[1]) && projects.has(row[2]) && users.has(row[3]) && (row[4] === null || users.has(row[4])));
  for (const row of rows.comments) assert.ok(orgs.has(row[1]) && projects.has(row[2]) && tasks.has(row[3]) && users.has(row[4]));
  for (const row of rows.activities) assert.ok(orgs.has(row[1]) && projects.has(row[2]) && users.has(row[3]) && (row[5] === 'task' ? tasks.has(row[6]) : projects.has(row[6])));
});
