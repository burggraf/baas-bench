import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import {
  TrailBaseCapacity,
  buildCapacityActors,
  buildAdditionalActors,
  capacityTaskId,
  evaluateActorSessionEvidence,
  evaluateCapacityPersistence,
  evaluateCapacitySummary,
  runAdaptiveCapacitySweep,
} from '../baseline/capacity.mjs';

const fixture = {
  rows: {
    users: [
      ['user-a', 'a@example.test', 'A', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
      ['user-b', 'b@example.test', 'B', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ],
    memberships: [
      ['membership-a', 'org-a', 'user-a', 'owner', '2026-01-01T00:00:00.000Z', null],
      ['membership-b', 'org-b', 'user-b', 'member', '2026-01-01T00:00:00.000Z', null],
    ],
    projects: [
      ['project-a', 'org-a', 'A', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
      ['project-b', 'org-b', 'B', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ],
  },
};

const actors = buildCapacityActors(fixture);
assert.deepEqual(actors.map(({ user, organization, project }) => [user, organization, project]), [
  ['user-a', 'org-a', 'project-a'],
  ['user-b', 'org-b', 'project-b'],
]);
assert.throws(() => buildCapacityActors({ rows: { ...fixture.rows, memberships: fixture.rows.memberships.slice(0, 1) } }), /active project context/);
const additional = buildAdditionalActors(actors, { count: 3, runId: 'a'.repeat(32) });
assert.equal(additional.length, 3);
assert.equal(new Set([...actors.map(a => a.user), ...additional.map(a => a.user)]).size, 5, 'expanded pool must use distinct user identities');
assert.equal(new Set([...actors.map(a => a.email), ...additional.map(a => a.email)]).size, 5, 'expanded pool must use distinct emails');
assert.ok(additional.every(a => actors.some(base => base.organization === a.organization && base.project === a.project)), 'extra actors reuse only established tenant/project contexts');
assert.throws(() => buildAdditionalActors(actors, { count: 1, runId: 'not-a-run-id' }), /run id/);

const authenticatedSessions = [
  { user: 'user-a', email: 'a@example.test', token: 'access-a', refreshToken: 'refresh-a', refreshVerified: true },
  { user: 'user-b', email: 'b@example.test', token: 'access-b', refreshToken: 'refresh-b', refreshVerified: true },
];
const sessionEvidence = evaluateActorSessionEvidence(authenticatedSessions);
assert.equal(sessionEvidence.passed, true, 'independent native refresh checks prove authenticated sessions');
assert.equal(sessionEvidence.distinctAccounts, 2);
assert.equal(sessionEvidence.distinctAccessTokens, 2);
assert.equal(sessionEvidence.distinctRefreshTokens, 2);
assert.equal(sessionEvidence.verifiedRefreshSessions, 2);
assert.equal(evaluateActorSessionEvidence(authenticatedSessions.map(actor => ({ ...actor, refreshVerified: false }))).passed, false, 'every refresh token must be accepted by TrailBase');
assert.equal(evaluateActorSessionEvidence([{ ...authenticatedSessions[0] }, { ...authenticatedSessions[1], token: 'access-a' }]).passed, false, 'VU access tokens may not be shared');
assert.equal(evaluateActorSessionEvidence([{ ...authenticatedSessions[0] }, { ...authenticatedSessions[1], refreshToken: 'refresh-a' }]).passed, false, 'VU refresh tokens may not be shared');

const validPersistence = evaluateCapacityPersistence([2, 2, 2, 0, 0, 0, 52, 52], 50, 50);
assert.equal(validPersistence.passed, true);
assert.equal(validPersistence.tasks, 2);
assert.equal(validPersistence.atomicActivities, 2);
for (const invalidCounts of [
  [0, 0, 0, 0, 0, 0, 50, 50],
  [2, 1, 1, 0, 0, 0, 52, 51],
  [2, 3, 2, 1, 0, 0, 52, 53],
  [2, 2, 2, 0, 1, 0, 52, 52],
  [2, 2, 2, 0, 0, 1, 52, 52],
  [2, 2, 2, 0, 0, 0, 51, 52],
]) assert.equal(evaluateCapacityPersistence(invalidCounts, 50, 50).passed, false);

const ids = new Set();
for (let stage = 1; stage <= 330; stage *= 2) {
  for (let vu = 1; vu <= stage; vu++) {
    const id = capacityTaskId('run-prefix', stage, vu, 0);
    assert.ok(!ids.has(id), 'task IDs must not collide across stages or VUs');
    ids.add(id);
  }
}
assert.notEqual(capacityTaskId('run-prefix', 1, 1, 1), capacityTaskId('run-prefix', 2, 1, 1));
assert.throws(() => capacityTaskId('run-prefix', 1, 0, 0), /VU/);

function summary({ httpFailure = 0.001, builtinFailure = 0.001, checkFails = 0, p95 = 200, p99 = 1000 } = {}) {
  return { metrics: {
    capacity_http_failure: { values: { rate: httpFailure } },
    http_req_failed: { values: { rate: builtinFailure } },
    checks: { values: { passes: 90, fails: checkFails, rate: checkFails ? 0.99 : 1 } },
    ...Object.fromEntries(['list', 'create', 'reread'].map(operation => [`capacity_${operation}_duration`, { values: { count: 30, 'p(95)': p95, 'p(99)': p99 } }])),
  } };
}
assert.equal(evaluateCapacitySummary(summary()).passed, true, 'the configured inclusive SLO boundaries pass');
assert.equal(evaluateCapacitySummary(summary({ httpFailure: 0.00101 })).passed, false);
assert.equal(evaluateCapacitySummary(summary({ builtinFailure: 0.002 })).passed, false);
assert.equal(evaluateCapacitySummary(summary({ checkFails: 1 })).passed, false, 'functional correctness is strict');
assert.equal(evaluateCapacitySummary(summary({ p95: 201 })).passed, false);
assert.equal(evaluateCapacitySummary(summary({ p99: 1001 })).passed, false);
assert.equal(evaluateCapacitySummary({ metrics: {} }).passed, false, 'missing evidence must fail closed');

const postcheckRunner = Object.create(TrailBaseCapacity.prototype);
let postcheckQueryCount = 0, postcheckSql = '';
Object.assign(postcheckRunner, {
  capacityPrefix: 'capacity-test-run',
  fixture: { rows: { tasks: Array(50), activities: Array(50) } },
  async query(sql) { postcheckQueryCount++; postcheckSql = sql; return [[2, 2, 2, 0, 0, 0, 52, 52]]; },
});
const postcheckResult = await postcheckRunner.postcheckStage(4, actors);
assert.equal(postcheckResult.passed, true);
assert.equal(postcheckResult.tasks, 2);
assert.equal(postcheckQueryCount, 1, 'persistence verification should return bounded aggregate counts');
assert.match(postcheckSql, /FROM activities WHERE subject_id LIKE 'capacity-test-run-s4-%'/);
assert.match(postcheckSql, /LEFT JOIN tasks t ON t\.external_id = a\.subject_id/);
assert.doesNotMatch(postcheckSql, /LEFT JOIN activities a ON a\.subject_id=t\.external_id/, 'avoid per-task scans and transferring all joined rows');

// Execute the actual audit SQL without automatic indexes, using the native schema's
// existing unique task ID index. No Docker or BaaS stack is started by this test.
const auditDb = new DatabaseSync(':memory:');
try {
  auditDb.exec(`
    PRAGMA automatic_index=OFF;
    CREATE TABLE tasks (external_id TEXT UNIQUE NOT NULL, organization_id TEXT, project_id TEXT, creator_id TEXT);
    CREATE TABLE activities (external_id TEXT UNIQUE NOT NULL, subject_id TEXT, organization_id TEXT, project_id TEXT, actor_id TEXT, action TEXT, subject_type TEXT);
    INSERT INTO tasks VALUES ('baseline-task','org-a','project-a','user-a');
    INSERT INTO activities VALUES ('baseline-activity','baseline-task','org-a','project-a','user-a','created','task');
  `);
  const insertTask = auditDb.prepare('INSERT INTO tasks VALUES (?,?,?,?)');
  const insertActivity = auditDb.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?)');
  const fullCohort = [...actors, ...buildAdditionalActors(actors, { count: 165, runId: 'b'.repeat(32) }), ...Array.from({ length: 163 }, (_, i) => ({ user: `other-${i}`, organization: 'org-a', project: 'project-a' }))];
  assert.equal(fullCohort.length, 330);
  auditDb.exec('BEGIN');
  for (let i = 0; i < 20000; i++) {
    const actor = fullCohort[i % fullCohort.length];
    const id = `capacity-test-run-s4-u${i % fullCohort.length + 1}-i${i}`;
    insertTask.run(id, actor.organization, actor.project, actor.user);
    insertActivity.run(`activity-${i}`, id, actor.organization, actor.project, actor.user, 'created', 'task');
  }
  auditDb.exec('COMMIT');
  const sqliteRunner = Object.create(TrailBaseCapacity.prototype);
  Object.assign(sqliteRunner, {
    capacityPrefix: 'capacity-test-run',
    fixture: { rows: { tasks: [null], activities: [null] } },
    async query(sql) { return auditDb.prepare(sql).all().map(Object.values); },
  });
  const start = performance.now();
  const persisted = await sqliteRunner.postcheckStage(4, fullCohort);
  assert.equal(persisted.passed, true);
  assert.equal(persisted.tasks, 20000);
  assert.ok(performance.now() - start < 5000, '20k-write audit must not perform quadratic activity scans');
  const queryPlan = auditDb.prepare(`EXPLAIN QUERY PLAN ${postcheckSql}`).all().map(row => row.detail).join('\n');
  assert.match(queryPlan, /SEARCH t USING INDEX .*external_id=\?/);
  assert.doesNotMatch(queryPlan, /SCAN a LEFT-JOIN/);
  for (const corruption of [
    "DELETE FROM activities WHERE external_id='activity-0'",
    "INSERT INTO activities SELECT 'duplicate',subject_id,organization_id,project_id,actor_id,action,subject_type FROM activities WHERE external_id='activity-0'",
    "DELETE FROM activities WHERE external_id='activity-1'; INSERT INTO activities SELECT 'duplicate',subject_id,organization_id,project_id,actor_id,action,subject_type FROM activities WHERE external_id='activity-0'", // Balanced missing+duplicate must fail even though total counts match.
    "UPDATE activities SET subject_id='capacity-test-run-s4-orphan' WHERE external_id='activity-0'",
    "UPDATE tasks SET creator_id='unknown' WHERE external_id='capacity-test-run-s4-u1-i0'",
    "UPDATE tasks SET organization_id='org-b' WHERE external_id='capacity-test-run-s4-u1-i0'",
    "UPDATE tasks SET project_id='project-b' WHERE external_id='capacity-test-run-s4-u1-i0'",
    "UPDATE activities SET actor_id='user-b' WHERE external_id='activity-0'",
    "UPDATE activities SET organization_id='org-b' WHERE external_id='activity-0'",
    "UPDATE activities SET project_id='project-b' WHERE external_id='activity-0'",
    "UPDATE activities SET action=NULL WHERE external_id='activity-0'",
    "UPDATE activities SET subject_type='comment' WHERE external_id='activity-0'",
    "INSERT INTO tasks VALUES ('unexpected','org-a','project-a','user-a')",
    "INSERT INTO activities VALUES ('unexpected','baseline-task','org-a','project-a','user-a','created','task')",
  ]) {
    auditDb.exec('SAVEPOINT corruption');
    auditDb.exec(corruption);
    assert.equal((await sqliteRunner.postcheckStage(4, fullCohort)).passed, false, `audit must detect: ${corruption}`);
    auditDb.exec('ROLLBACK TO corruption; RELEASE corruption');
  }
} finally { auditDb.close(); }
assert.equal(evaluateCapacityPersistence([2, 2], 50, 50).passed, false, 'incomplete counts fail closed');
assert.equal(evaluateCapacityPersistence([2, 2, 2, 0, 0, 0, null, 52], 50, 50).passed, false, 'null counts fail closed');

const observed = [];
const refined = await runAdaptiveCapacitySweep(async vus => {
  observed.push(vus);
  return { vus, passed: vus < 70 };
}, { actorCap: 165, hardCap: 330, resolution: 5 });
assert.deepEqual(observed, [1, 2, 4, 8, 16, 32, 64, 128, 96, 80, 72, 68]);
assert.equal(refined.status, 'bracketed');
assert.equal(refined.lowerBoundVus, 68);
assert.equal(refined.firstFailingVus, 72);
assert.ok(refined.firstFailingVus - refined.lowerBoundVus <= 5);

const bounded = [];
const stoppedAtActorCap = await runAdaptiveCapacitySweep(async vus => {
  bounded.push(vus);
  return { vus, passed: vus < 165 };
}, { actorCap: 165, hardCap: 330, resolution: 50 });
assert.ok(bounded.includes(165));
assert.ok(!bounded.includes(330), '330 actors may be provisioned only after the 165-user rung passes');
assert.equal(stoppedAtActorCap.firstFailingVus, 165);

const expanded = [];
const expandedBoundary = await runAdaptiveCapacitySweep(async vus => {
  expanded.push(vus);
  return { vus, passed: vus < 220 };
}, { actorCap: 165, hardCap: 330, resolution: 5 });
assert.ok(expanded.includes(330), 'authorized expansion is exercised only after the actor-cap rung passes');
assert.ok(expandedBoundary.lowerBoundVus < 220 && expandedBoundary.firstFailingVus >= 220);
assert.ok(expandedBoundary.firstFailingVus - expandedBoundary.lowerBoundVus <= 5);

const saturated = await runAdaptiveCapacitySweep(async vus => ({ vus, passed: true }), { actorCap: 165, hardCap: 330 });
assert.equal(saturated.status, 'at-least');
assert.equal(saturated.lowerBoundVus, 330);
assert.equal(saturated.firstFailingVus, null);

// Run the actual k6 JavaScript workload with fake HTTP, in two VU contexts.
const source = readFileSync(new URL('../baseline/capacity-test.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/^export const /gm, 'const ')
  .replace(/^export function /gm, 'function ')
  .replace('export default function (data)', 'function iteration(data)');
const cfg = {
  platform: 'trailbase', base: 'http://fake', prefix: 'capacity-run', stage: 4, vus: 2, duration: '2s',
  actors: [
    { token: 'token-a', csrf: 'csrf-a', user: 'user-a', organization: 'org-a', project: 'project-a' },
    { token: 'token-b', csrf: 'csrf-b', user: 'user-b', organization: 'org-b', project: 'project-b' },
  ],
};
const payloads = new Map(), requests = [], failures = [], sleeps = [];
let failCreate = false;
let nativeId = 0;
class FakeRate { add(value, tags) { failures.push({ value, tags }); } }
class FakeTrend { constructor(name, isTime) { assert.ok(name.startsWith('capacity_') && isTime); } add(value) { assert.ok(Number.isFinite(value)); } }
const response = (status, value) => ({ status, timings: { duration: 10 }, json: key => key ? value?.[key] : value });
const context = {
  open: path => { assert.equal(path, '/work/config.json'); return JSON.stringify(cfg); },
  Rate: FakeRate,
  Trend: FakeTrend,
  check: (value, assertions) => Object.values(assertions).every(fn => { try { return fn(value); } catch { return false; } }),
  sleep: seconds => sleeps.push(seconds),
  http: {
    get: (url, params) => {
      const operation = params.tags.operation;
      requests.push({ operation, url, auth: params.headers.Authorization });
      if (operation === 'list') {
        const actor = cfg.actors.find(row => `Bearer ${row.token}` === params.headers.Authorization);
        return response(200, { records: [{ organization_id: actor.organization, project_id: actor.project }] });
      }
      const payload = payloads.get(params.headers.Authorization);
      return response(200, payload);
    },
    post: (_url, body, params) => {
      const payload = JSON.parse(body);
      payloads.set(params.headers.Authorization, payload);
      requests.push({ operation: params.tags.operation, auth: params.headers.Authorization });
      if (failCreate) return response(503, {});
      return response(201, { ids: [String(++nativeId)] });
    },
  },
};
const workload = runInNewContext(`${source}\n({ options, setup, iteration, handleSummary });`, context);
assert.equal(workload.options.scenarios.capacity.executor, 'constant-vus');
assert.equal(workload.options.scenarios.capacity.vus, 2);
assert.equal(workload.options.scenarios.capacity.duration, '2s');
assert.equal(workload.options.scenarios.capacity.gracefulStop, '10s');
assert.ok(workload.options.summaryTrendStats.includes('p(99)'), 'summary must include p99');
const data = workload.setup();
data.actors[1].token = data.actors[0].token;
assert.throws(() => workload.setup(), /must not share accounts or sessions/);
data.actors[1].token = 'token-b';
for (let vu = 1; vu <= 2; vu++) {
  context.__VU = vu; context.__ITER = 0;
  workload.iteration(data);
}
const taskIds = [...payloads.values()].map(payload => payload.external_id);
assert.equal(new Set(taskIds).size, 2, 'same __ITER across VUs must produce distinct task IDs');
assert.ok(taskIds.every(id => id.includes('-s4-u')));
assert.deepEqual(requests.filter(r => r.operation === 'list').map(r => r.auth), ['Bearer token-a', 'Bearer token-b']);
assert.ok(requests.every(r => r.auth === 'Bearer token-a' || r.auth === 'Bearer token-b'));
assert.equal(sleeps.length, 2); assert.ok(sleeps.every(seconds => seconds === 1));
assert.ok(failures.every(f => f.value === false), 'successful expected statuses must not be recorded as request errors');

failCreate = true; requests.length = 0; failures.length = 0;
context.__VU = 1; context.__ITER = 1;
workload.iteration(data);
assert.deepEqual(failures.map(f => f.value), [false, true], 'a failed HTTP response is counted separately without aborting the whole k6 stage');
assert.equal(requests.filter(r => r.operation === 'reread').length, 0, 'skip reread when create failed');
assert.equal(sleeps.length, 3, 'failed requests remain paced');
assert.ok(workload.handleSummary({ metrics: {} })['/work/summary.json']);

// Exercise per-VU login orchestration with independent fake native sessions.
const sessionDir = mkdtempSync(join(tmpdir(), 'v6-capacity-sessions-'));
try {
  const stageDir = join(sessionDir, 'stage'); mkdirSync(stageDir);
  writeFileSync(join(sessionDir, 'credentials.json'), JSON.stringify({ password: 'synthetic-test-password' }));
  const sessionRunner = Object.create(TrailBaseCapacity.prototype);
  const logins = [], refreshes = [], tokenEmails = new Map(), refreshTokenEmails = new Map();
  let refreshedTokenCount = 0;
  const makeToken = suffix => {
    const jwtClaims = Buffer.from(JSON.stringify({ exp: Math.floor((Date.now() + 600000) / 1000) })).toString('base64url');
    return `e30.${jwtClaims}.${suffix}`;
  };
  Object.assign(sessionRunner, {
    dir: sessionDir,
    async call(path, { body, token }) {
      if (path === '/api/auth/v1/login') {
        logins.push(body.email_or_username);
        const authToken = makeToken(`session-${logins.length}`);
        const refreshToken = `refresh-${logins.length}`;
        tokenEmails.set(authToken, body.email_or_username);
        refreshTokenEmails.set(refreshToken, body.email_or_username);
        return { auth_token: authToken, refresh_token: refreshToken, csrf_token: `csrf-${logins.length}` };
      }
      if (path === '/api/auth/v1/refresh') {
        const email = refreshTokenEmails.get(body.refresh_token);
        assert.ok(email, 'only an issued refresh token may be checked');
        refreshes.push(body.refresh_token);
        const authToken = makeToken(`refreshed-${++refreshedTokenCount}`);
        tokenEmails.set(authToken, email);
        return { auth_token: authToken, csrf_token: `csrf-refreshed-${refreshedTokenCount}` };
      }
      const actor = fixture.rows.users.find(row => row[1] === tokenEmails.get(token));
      assert.ok(actor, 'profile checks must use a token issued for a fixture actor');
      return { records: [{ email: actor[1] }] };
    },
    trailSessions: () => 0, // Host-side SQLite count is diagnostic; native refresh API is authoritative.
  });
  const loggedActors = await sessionRunner.loginActors(actors, stageDir);
  assert.equal(new Set(loggedActors.map(actor => actor.user)).size, actors.length);
  assert.equal(new Set(loggedActors.map(actor => actor.token)).size, actors.length, 'each account must own a distinct authenticated session');
  assert.ok(loggedActors.every(actor => !Object.hasOwn(actor, 'refreshToken')), 'refresh tokens must not escape setup memory');
  assert.deepEqual(logins.sort(), actors.map(actor => actor.email).sort());
  assert.equal(refreshes.length, actors.length, 'each login refresh token must be verified before load');
  assert.equal(new Set(refreshes).size, actors.length, 'the native refresh tokens must be distinct');
  const persistedSessionEvidence = JSON.parse(readFileSync(join(stageDir, 'actor-session-check.json'), 'utf8'));
  assert.equal(persistedSessionEvidence.hostReportedRefreshSessionRows, 0, 'record the observed host-side count without treating it as session proof');
  assert.equal(persistedSessionEvidence.hostRefreshSessionCountMatches, false, 'the native endpoint remains authoritative when the host-side count disagrees');
  assert.equal(persistedSessionEvidence.distinctAccessTokens, actors.length);
  assert.equal(persistedSessionEvidence.distinctRefreshTokens, actors.length);
  assert.equal(persistedSessionEvidence.verifiedRefreshSessions, actors.length);
  assert.equal(persistedSessionEvidence.verifiedProfiles, actors.length);
  assert.equal(persistedSessionEvidence.passed, true);
  assert.equal(JSON.stringify(persistedSessionEvidence).includes('session-'), false, 'session evidence must not persist bearer tokens');
  assert.equal(JSON.stringify(persistedSessionEvidence).includes('refresh-'), false, 'session evidence must not persist refresh tokens');
} finally { rmSync(sessionDir, { recursive: true, force: true }); }

// The capacity command restores the private baseline even after the sweep reaches an expected failure rung.
const cleanupRunner = Object.create(TrailBaseCapacity.prototype);
let restoreCalls = 0;
Object.assign(cleanupRunner, {
  capacityManifest: { state: {} },
  async runCapacityStage(vus) { return { vus, passed: vus === 1 }; },
  async restore() { restoreCalls++; },
});
await cleanupRunner.k6();
assert.equal(restoreCalls, 1);
assert.equal(cleanupRunner.capacitySummary.status, 'bracketed');
assert.equal(cleanupRunner.capacitySummary.lowerBoundVus, 1);
assert.equal(cleanupRunner.capacitySummary.firstFailingVus, 2);

// A crashed/exited backend is not sent a destructive/redundant stop; only live, owned containers stop.
const stopRunner = Object.create(TrailBaseCapacity.prototype);
const stopCommands = [];
Object.assign(stopRunner, {
  inv: { owner: 'capacity-owner', name: 'v6-trailbase-test' },
  pg: false,
  docker(args) {
    stopCommands.push(args);
    if (args[0] === 'ps' && args.some(arg => arg.startsWith('name='))) return 'backend-id';
    if (args[0] === 'ps') return 'backend-id\nk6-id';
    if (args[0] === 'inspect' && args.length === 2) return JSON.stringify([{ Id: 'backend-id', State: { Running: false }, Config: { Labels: { 'baas-bench.v6-owner': 'capacity-owner' } } }]);
    if (args[0] === 'inspect') return JSON.stringify([
      { Id: 'backend-id', State: { Running: false }, Config: { Labels: { 'baas-bench.v6-owner': 'capacity-owner' } } },
      { Id: 'k6-id', State: { Running: true }, Config: { Labels: { 'baas-bench.v6-owner': 'capacity-owner' } } },
    ]);
    return '';
  },
});
await stopRunner.stop();
assert.ok(stopCommands.some(args => args[0] === 'stop' && args.includes('k6-id') && !args.includes('backend-id')));

console.log('V6 capacity planning, SLO, actor-pool, session and k6 workload regressions passed (NOT live evidence)');
