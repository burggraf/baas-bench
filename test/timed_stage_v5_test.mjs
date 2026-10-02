import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { runTimedWindow, runTimedStageFromBaseline, stageDurationMs } from '../benchmark-sets/realworld-api-v5/shared/lib/timed-stage.mjs';
import { REQUIRED_CHECKS } from '../benchmark-sets/realworld-api-v5/shared/lib/conformance.mjs';
import { StageMetricsAccumulator } from '../benchmark-sets/realworld-api-v5/shared/lib/metrics.mjs';
import { measureRemoteCall } from '../benchmark-sets/realworld-api-v5/shared/lib/measurement.mjs';
import { BenchmarkOperationError } from '../benchmark-sets/realworld-api-v5/shared/lib/correctness.mjs';

function context(action = async () => ({ id: 'user', email: 'user@example.test', displayName: 'User', createdAt: 'date', updatedAt: 'date' })) {
  return { userId: 'user', credentials: { email: 'user@example.test', password: 'private-password' }, session: { getProfile: () => measureRemoteCall(action), cancelPending() {} },
    random: () => .975, now: () => performance.now(), sample() {}, invoke: async (_name, _class, _kind, work) => work(),
    async replaceSession() { this.session = { getProfile: () => measureRemoteCall(action), cancelPending() {} }; } };
}

test('V5 timed window emits workflow and native-operation samples, excludes cleanup, and drains', async () => {
  const actor = context(), samples = [], boundaries = [];
  // Select profileUpdate, whose source implementation uses updateProfile.
  actor.session.updateProfile = actor.session.getProfile;
  const result = await runTimedWindow([actor], { durationMs: 20, onSample: sample => samples.push(sample), onBoundary: phase => boundaries.push(phase) });
  assert.equal(result.stageFailed, false);
  assert.ok(result.completedWorkflowCount >= 1);
  assert.deepEqual(boundaries, ['start', 'end']);
  assert.ok(samples.some(sample => sample.type === 'remote'));
  assert.ok(samples.some(sample => sample.type === 'workflow'));
  const count = samples.length;
  await actor.invoke('outside', 'read', 'read', () => measureRemoteCall(async () => true));
  assert.equal(samples.length, count, 'no samples outside measurement');
});

test('V5 early timer wake-ups cannot shorten the monotonic stage duration', async () => {
  let clock = 0, wakes = 0;
  const result = await runTimedWindow([], { allowIdle: true, durationMs: 20, graceMs: 0, onSample() {}, now: () => clock,
    wait: async ms => { wakes++; clock += Math.max(1, Math.floor(ms / 2)); } });
  assert.equal(result.stageFailed, false);
  assert.ok(result.elapsedMs >= 20);
  assert.ok(wakes > 1);
});

test('V5 duration-timer failure invalidates the stage instead of scoring a shortened window', async () => {
  const result = await runTimedWindow([], { allowIdle: true, durationMs: 20, onSample() {}, wait: async () => { throw new Error('timer unavailable'); } });
  assert.equal(result.stageFailed, true);
  assert.ok(result.failureReasons.includes('duration_timer'));
});

test('V5 login replacement is included in the native-operation stream', async () => {
  const actor = context(), samples = [];
  actor.random = () => .99;
  actor.session.signOut = () => measureRemoteCall(async () => true);
  actor.replaceSession = async () => { await measureRemoteCall(async () => true); };
  const result = await runTimedWindow([actor], { durationMs: 20, onSample: sample => samples.push(sample) });
  assert.equal(result.stageFailed, false);
  assert.ok(samples.some(sample => sample.type === 'remote' && sample.name === 'createSession' && sample.operationClass === 'authSearch'));
});

test('V5 accumulator pools raw samples and rejects sample ceilings', () => {
  const sample = { type: 'workflow', name: 'profileUpdate', workflow: 'profileUpdate', operationClass: 'write', kind: 'write', success: true };
  const pool = new StageMetricsAccumulator({ maxLatencySamples: 4 });
  for (const elapsedMs of [1, 2, 3, 100]) pool.record({ ...sample, elapsedMs });
  const metrics = pool.finalize(1, { requestedUsers: 2, achievedUsers: 2 });
  assert.equal(metrics.operationClassMetrics.write.latencyP95Ms, 100);
  const bounded = new StageMetricsAccumulator({ maxLatencySamples: 1 });
  bounded.record({ ...sample, elapsedMs: 1 }); bounded.record({ ...sample, elapsedMs: 2 });
  assert.equal(bounded.finalize(1, { requestedUsers: 1, achievedUsers: 1 }).valid, false);
});

test('V5 scored request timeouts remain failures without automatic retries', async () => {
  let requests = 0;
  const actor = context(async () => { requests++; throw new BenchmarkOperationError('timeout', { code: 'timeout', status: 408 }); });
  actor.session.updateProfile = actor.session.getProfile;
  const samples = [];
  const result = await runTimedWindow([actor], { durationMs: 20, onSample: sample => samples.push(sample) });
  assert.equal(result.stageFailed, false);
  assert.equal(result.failedWorkflowCount, 1);
  assert.equal(requests, 1);
  assert.ok(samples.every(sample => sample.success === false));
});

test('V5 workflow and remote samples both redact actor credentials', async () => {
  const actor = context(async () => { throw new Error('private-password user@example.test'); }), samples = [];
  actor.session.updateProfile = actor.session.getProfile;
  await runTimedWindow([actor], { durationMs: 20, onSample: sample => samples.push(sample) });
  assert.ok(samples.length >= 2);
  assert.equal(JSON.stringify(samples).includes('private-password'), false);
  assert.equal(JSON.stringify(samples).includes('user@example.test'), false);
});

test('V5 retired sessions do not shorten a scored stage denominator', async () => {
  const actor = context(async () => { throw new BenchmarkOperationError('authentication', { status: 401 }); });
  actor.session.updateProfile = actor.session.getProfile;
  const result = await runTimedWindow([actor], { durationMs: 30, onSample() {} });
  assert.equal(result.lostUsers, 1);
  assert.equal(result.stageFailed, false);
  assert.ok(result.elapsedMs >= 25);
});

test('V5 unexpected integrity failures invalidate the timed window', async () => {
  const actor = context(async () => { throw new Error('malformed response'); });
  actor.session.updateProfile = actor.session.getProfile;
  const result = await runTimedWindow([actor], { durationMs: 20, onSample() {} });
  assert.equal(result.stageFailed, true);
  assert.ok(result.failureReasons.includes('integrity_error'));
});

test('V5 timed-window observer failure invalidates rather than silently dropping evidence', async () => {
  const actor = context(); actor.session.updateProfile = actor.session.getProfile;
  const result = await runTimedWindow([actor], { durationMs: 20, onSample() { throw new Error('sample sink failed'); } });
  assert.equal(result.stageFailed, true);
  assert.ok(result.failureReasons.includes('sample_delivery'));
});

test('V5 drain expiry cancels in-flight requests and invalidates the stage', async () => {
  let rejectPending;
  const actor = context(() => new Promise((_resolve, reject) => { rejectPending = reject; }));
  actor.session.updateProfile = actor.session.getProfile;
  actor.session.cancelPending = () => rejectPending?.(new BenchmarkOperationError('timeout', { code: 'timeout', status: 408 }));
  const result = await runTimedWindow([actor], { durationMs: 10, graceMs: 1, onSample() {} });
  assert.equal(result.stageFailed, true);
  assert.equal(result.graceExpired, true);
  assert.equal(result.unfinishedWork, false);
  assert.ok(result.failureReasons.includes('grace_deadline'));
});

test('V5 unexpected worker exceptions do not escape the drain barrier', async () => {
  const actor = context(); actor.session.updateProfile = actor.session.getProfile;
  let ticks = 0;
  const result = await runTimedWindow([actor], { durationMs: 10, onSample() {}, now() {
    if (++ticks === 2) throw new Error('worker fault');
    return performance.now();
  } });
  assert.equal(result.stageFailed, true);
  assert.ok(result.failureReasons.includes('worker_exception'));
});

test('V5 measured lifecycle retains warmed sessions, excludes preparation/warm-up/cleanup, and remains unqualified', async () => {
  const events = [], samples = [], sessions = [];
  const users = Array.from({ length: 50 }, (_, index) => ({ userId: `user${index}`, credentials: { email: `user${index}@example.test`, password: 'private' }, organizationId: 'org', projectId: 'project', taskId: 'task' }));
  const backend = { async createSession(credentials) {
    const index = users.findIndex(user => user.credentials.email === credentials.email);
    const profile = { id: `user${index}`, email: credentials.email, displayName: 'User', createdAt: 'date', updatedAt: 'date' };
    const session = { closed: false, async getProfile() { return measureRemoteCall(async () => profile); }, async updateProfile() { return measureRemoteCall(async () => profile); }, cancelPending() {}, async close() { this.closed = true; } };
    sessions.push(session); return session;
  } };
  const hooks = { conformance: { passed: true, findings: REQUIRED_CHECKS.map(name => ({ name, passed: true })) }, backend, users, requestedUsers: 1,
    reset: async () => { events.push('reset'); }, verifyBaseline: async () => { events.push('verify'); return true; },
    warmUp: async contexts => {
      events.push('warm-up'); assert.equal(contexts.length, 50); contexts[0].random = () => .975;
      assert.equal(contexts[0].session, sessions[0]);
      await contexts[0].session.updateProfile({ displayName: 'Warm' });
      return { passed: true };
    }, durationMs: 20, onSample: sample => samples.push(sample) };
  const result = await runTimedStageFromBaseline(hooks);
  assert.deepEqual(events, ['reset', 'verify', 'warm-up']);
  assert.equal(samples.length, 2, 'one measured workflow/remote pair only');
  assert.ok(sessions.every(session => session.closed));
  assert.equal(result.metrics.valid, false);
  assert.equal(result.measurement_qualified, false);
  assert.equal(result.admission_evidence, false);
  assert.equal(result.profile_duration_matches, false);
  events.length = 0; sessions.length = 0; samples.length = 0;
  await assert.rejects(runTimedStageFromBaseline({ ...hooks, warmUp: async () => ({ passed: false }) }), /warm-up failed/);
  assert.equal(samples.length, 0);
  assert.ok(sessions.every(session => session.closed));
  await assert.rejects(runTimedStageFromBaseline({ ...hooks, conformance: { passed: false, findings: [] } }), /conformance/);
  assert.equal(stageDurationMs(100), 300000); assert.equal(stageDurationMs(1), 1500000);
});

test('V5 timed window rejects late starts and cancellation before issuing requests', async () => {
  const actor = context(); actor.session.updateProfile = actor.session.getProfile;
  await assert.rejects(runTimedWindow([actor], { durationMs: 20, startAt: Date.now() - 1000, onSample() {} }), /alignment/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(runTimedWindow([actor], { durationMs: 20, signal: abort.signal, onSample() {} }), /cancelled/);
});
