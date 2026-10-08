import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { waitForCapacityTokenEligibility } from './auth.mjs';
export { waitForCapacityTokenEligibility } from './auth.mjs';
import { lifecycleFixture } from './fixture.mjs';
import { NativeBaseline, assertOwned } from './native.mjs';
import { fixtureFacts, readManifest, runCommand } from './prepare.mjs';

const HOLD_SECONDS = 60;
const MAX_CAPACITY_VUS = 660;
const MAX_ADDITIONAL_ACTORS = MAX_CAPACITY_VUS - 165;
const quote = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const sha256File = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export const CAPACITY_SLO = Object.freeze({
  maxHttpFailureRate: 0.001,
  maxP95Ms: 200,
  maxP99Ms: 1000,
  operations: Object.freeze(['list', 'create', 'reread']),
});

export function capacityTaskId(prefix, stage, vu, iteration) {
  assert.equal(typeof prefix, 'string');
  assert.ok(prefix.length > 0);
  assert.ok(Number.isSafeInteger(stage) && stage > 0, 'stage must be a positive integer');
  assert.ok(Number.isSafeInteger(vu) && vu > 0, 'VU must be a positive integer');
  assert.ok(Number.isSafeInteger(iteration) && iteration >= 0, 'iteration must be a nonnegative integer');
  return `${prefix}-s${stage}-u${vu}-i${iteration}`;
}

export function buildCapacityActors(fixture) {
  const projects = new Map(fixture.rows.projects.map(row => [row[1], row[0]]));
  const memberships = new Map();
  for (const row of fixture.rows.memberships) {
    if (row[5] == null && projects.has(row[1])) {
      const rows = memberships.get(row[2]) ?? [];
      rows.push(row);
      memberships.set(row[2], rows);
    }
  }
  const users = [...fixture.rows.users].sort((a, b) => a[0].localeCompare(b[0]));
  const actors = users.map(([user, email, displayName]) => {
    const membership = (memberships.get(user) ?? []).sort((a, b) => a[1].localeCompare(b[1]))[0];
    assert.ok(membership, `actor lacks an active project context: ${user}`);
    return {
      user,
      email,
      displayName,
      organization: membership[1],
      project: projects.get(membership[1]),
      additional: false,
    };
  });
  assert.equal(new Set(actors.map(actor => actor.user)).size, actors.length, 'fixture actor identities must be unique');
  assert.equal(new Set(actors.map(actor => actor.email)).size, actors.length, 'fixture actor emails must be unique');
  return actors;
}

export function buildAdditionalActors(baseActors, { count, runId, platform = 'trailbase' }) {
  assert.ok(Array.isArray(baseActors) && baseActors.length > 0, 'base actor contexts required');
  assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= MAX_ADDITIONAL_ACTORS, 'invalid additional actor count');
  assert.match(runId ?? '', /^[a-f0-9]{32}$/, 'invalid capacity run id');
  const existingUsers = new Set(baseActors.map(actor => actor.user));
  const existingEmails = new Set(baseActors.map(actor => actor.email));
  return Array.from({ length: count }, (_, offset) => {
    const index = baseActors.length + offset;
    const context = baseActors[offset % baseActors.length];
    const user = platform === 'supabase' ? `v6capu${runId}${index.toString(36)}` : `v6cap_u_${runId}_${index.toString(36)}`;
    const membership = platform === 'supabase' ? `v6capm${runId}${index.toString(36)}` : `v6cap_m_${runId}_${index.toString(36)}`;
    const email = `v6cap_${runId}_${index.toString(36)}@capacity.example.test`;
    assert.ok(!existingUsers.has(user) && !existingEmails.has(email), 'additional actor collides with fixture identity');
    return {
      user,
      email,
      displayName: `Capacity user ${index + 1}`,
      organization: context.organization,
      project: context.project,
      membership,
      role: 'member',
      additional: true,
    };
  });
}

export function evaluateActorSessionEvidence(sessions) {
  const accounts = new Set(sessions.map(session => session.user)).size;
  const emails = new Set(sessions.map(session => session.email)).size;
  const accessTokens = new Set(sessions.map(session => session.token)).size;
  const refreshTokens = new Set(sessions.map(session => session.refreshToken).filter(token => typeof token === 'string' && token.length > 0)).size;
  const verifiedRefreshSessions = sessions.filter(session => session.refreshVerified === true).length;
  const failures = [];
  if (!sessions.length || accounts !== sessions.length) failures.push('active VUs do not have distinct accounts');
  if (emails !== sessions.length) failures.push('active VUs do not have distinct email identities');
  if (accessTokens !== sessions.length) failures.push('active VUs do not have distinct access tokens');
  if (refreshTokens !== sessions.length) failures.push('active VUs do not have distinct refresh tokens');
  if (verifiedRefreshSessions !== sessions.length) failures.push('not all native refresh sessions were accepted');
  return {
    passed: failures.length === 0,
    failureReasons: failures,
    distinctAccounts: accounts,
    distinctEmails: emails,
    distinctAccessTokens: accessTokens,
    distinctRefreshTokens: refreshTokens,
    verifiedRefreshSessions,
  };
}

export function evaluateCapacityPersistence(counts, baselineTasks, baselineActivities) {
  if (!Array.isArray(counts) || counts.length !== 8 || !counts.every(value => Number.isSafeInteger(value) && value >= 0)) {
    return { passed: false, failureReasons: ['persistence aggregate counts missing or malformed'], tasks: null, atomicActivities: null, totalTasks: null, totalActivities: null, orphanActivities: null };
  }
  const [tasks, activities, subjects, orphanActivities, invalidTasks, invalidActivities, totalTasks, totalActivities] = counts;
  const failures = [];
  if (tasks === 0) failures.push('no successful task writes observed');
  if (activities !== tasks || subjects !== tasks) failures.push('task does not have exactly one linked activity');
  if (invalidTasks !== 0 || invalidActivities !== 0) failures.push('task/activity actor, tenant, linkage or action mismatch');
  if (orphanActivities !== 0) failures.push('orphan capacity activity detected');
  if (totalTasks !== baselineTasks + tasks) failures.push('task total differs from baseline plus capacity writes');
  if (totalActivities !== baselineActivities + tasks) failures.push('activity total differs from baseline plus atomic writes');
  return { passed: failures.length === 0, failureReasons: failures, tasks, atomicActivities: failures.length === 0 ? tasks : null, totalTasks, totalActivities, orphanActivities };
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function metricValues(summary, name) { return summary?.metrics?.[name]?.values ?? null; }
function rateMetric(summary, name) {
  const value = metricValues(summary, name)?.rate;
  return finite(value) ? value : null;
}

export function evaluateCapacitySummary(summary, limits = CAPACITY_SLO) {
  const metrics = summary?.metrics ?? {};
  const failures = [];
  const rates = {
    capacityHttpFailure: rateMetric(summary, 'capacity_http_failure'),
    k6HttpFailure: rateMetric(summary, 'http_req_failed'),
  };
  if (rates.capacityHttpFailure == null || rates.k6HttpFailure == null) failures.push('HTTP failure-rate metric missing');
  else {
    if (rates.capacityHttpFailure > limits.maxHttpFailureRate) failures.push('HTTP failure rate exceeds SLO');
    if (rates.k6HttpFailure > limits.maxHttpFailureRate) failures.push('k6 HTTP failure rate exceeds SLO');
  }

  const checks = metricValues(summary, 'checks');
  const checksPassed = checks != null && finite(checks.passes) && checks.passes > 0 && checks.fails === 0 && checks.rate === 1;
  if (!checksPassed) failures.push('functional response checks did not all pass');

  const operationLatency = {};
  for (const operation of limits.operations) {
    const values = metricValues(summary, `capacity_${operation}_duration`);
    const p95 = values?.['p(95)'];
    const p99 = values?.['p(99)'];
    const requestCount = values?.count;
    operationLatency[operation] = {
      count: finite(requestCount) ? requestCount : null,
      p95_ms: finite(p95) ? p95 : null,
      p99_ms: finite(p99) ? p99 : null,
      passed: finite(requestCount) && requestCount > 0 && finite(p95) && p95 <= limits.maxP95Ms && finite(p99) && p99 <= limits.maxP99Ms,
    };
    if (!operationLatency[operation].passed) failures.push(`${operation} latency or sample-count SLO failed`);
  }

  const httpRequests = metricValues(summary, 'http_reqs');
  const iterations = metricValues(summary, 'iterations');
  return {
    passed: failures.length === 0,
    failureReasons: failures,
    metrics: {
      http_failure_rate: rates.capacityHttpFailure,
      k6_http_failure_rate: rates.k6HttpFailure,
      http_requests: finite(httpRequests?.count) ? httpRequests.count : null,
      requests_per_second: finite(httpRequests?.rate) ? httpRequests.rate : null,
      iterations: finite(iterations?.count) ? iterations.count : null,
      checks: checks == null ? null : { passes: checks.passes ?? null, fails: checks.fails ?? null, rate: checks.rate ?? null },
      operations: operationLatency,
    },
  };
}

function coarseSteps(actorCap, hardCap) {
  const steps = [];
  for (let value = 1; value < actorCap; value *= 2) steps.push(value);
  if (!steps.includes(actorCap)) steps.push(actorCap);
  if (hardCap > 165) steps.push(165);
  if (hardCap > 330) steps.push(330);
  if (hardCap > actorCap) steps.push(hardCap);
  return [...new Set(steps)].sort((a, b) => a - b);
}

export async function runAdaptiveCapacitySweep(runStage, { actorCap = 165, hardCap = 330, resolution = 5 } = {}) {
  assert.equal(typeof runStage, 'function');
  assert.ok(Number.isSafeInteger(actorCap) && actorCap > 0 && actorCap <= 165, 'actor cap must be within the existing 165-user fixture');
  assert.ok(Number.isSafeInteger(hardCap) && hardCap >= actorCap && hardCap <= MAX_CAPACITY_VUS, 'hard cap must not exceed the authorized 660-user ceiling');
  assert.ok(Number.isSafeInteger(resolution) && resolution >= 1);
  const stages = [];
  let lowerBoundVus = 0;
  let firstFailingVus = null;

  const execute = async vus => {
    const outcome = await runStage(vus, { ordinal: stages.length + 1 });
    assert.ok(outcome && typeof outcome.passed === 'boolean', 'capacity stage must return a pass/fail result');
    if (outcome.vus != null) assert.equal(outcome.vus, vus, 'capacity stage result VU count mismatch');
    const result = { ...outcome, vus };
    stages.push(result);
    if (result.passed) lowerBoundVus = vus;
    else firstFailingVus = vus;
    return result;
  };

  for (const vus of coarseSteps(actorCap, hardCap)) {
    const result = await execute(vus);
    if (!result.passed) break;
  }
  if (firstFailingVus != null) {
    while (firstFailingVus - lowerBoundVus > resolution) {
      const midpoint = Math.floor((lowerBoundVus + firstFailingVus) / 2);
      if (midpoint <= lowerBoundVus || midpoint >= firstFailingVus) break;
      const result = await execute(midpoint);
      if (!result.passed) firstFailingVus = midpoint;
    }
    return { status: 'bracketed', lowerBoundVus, firstFailingVus, resolution, stages };
  }
  return { status: 'at-least', lowerBoundVus, firstFailingVus: null, resolution, stages };
}

class NativeCapacity extends NativeBaseline {
  constructor(options) {
    const hardCap = options.hardCap ?? 330;
    assert.ok(Number.isSafeInteger(hardCap) && hardCap >= 165 && hardCap <= MAX_CAPACITY_VUS, 'invalid capacity hard cap');
    super(options);
    this.capacityHardCap = hardCap;
    assert.ok(['trailbase', 'supabase'].includes(this.platform), 'unsupported native capacity platform');
    if (this.pg) assert.ok(hardCap <= 330, 'Supabase local capacity ceiling is 330 users');
    this.baseActors = buildCapacityActors(this.fixture);
    assert.equal(this.baseActors.length, 165, 'expected the verified 165-user local fixture');
    this.capacityRunId = randomBytes(16).toString('hex');
    this.capacityPrefix = `v6cap${this.capacityRunId}`;
    this.capacityManifest = options.manifest;
    this.capacitySummary = null;
  }

  // runCommand authenticates once for the fixed 1-VU baseline. This profile creates exactly one
  // user session per active VU immediately before each independently restored capacity rung.
  async authenticate() {}

  async stop() {
    if (this.pg) return super.stop(); // Retain credential-free native pre-stop evidence for all 11 services.
    const named = this.owned(); // Also rejects an unowned container colliding with this deployment name.
    if (!this.inv) return;
    const ids = this.docker(['ps', '-aq', '--filter', `label=baas-bench.v6-owner=${this.inv.owner}`]).trim().split(/\s+/).filter(Boolean);
    if (!ids.length) {
      if (named.length) throw new Error('owned deployment disappeared during stop');
      return;
    }
    const containers = JSON.parse(this.docker(['inspect', ...ids]));
    assertOwned(containers, this.inv.owner);
    const running = containers.filter(container => container.State?.Running).map(container => container.Id);
    if (running.length) this.docker(['stop', '--time', '30', ...running]);
  }

  async provisionAdditionalActors(actors) {
    if (!actors.length) return;
    const now = new Date().toISOString();
    await this.execute(`INSERT INTO users(external_id,email,display_name,created_at,updated_at) VALUES ${actors.map(actor => `(${[actor.user, actor.email, actor.displayName, now, now].map(quote).join(',')})`).join(',')};`);
    await this.execute(`INSERT INTO memberships(external_id,organization_id,user_id,role,created_at,revoked_at) VALUES ${actors.map(actor => `(${[actor.membership, actor.organization, actor.user, actor.role, now, null].map(quote).join(',')})`).join(',')};`);
    const password = JSON.parse(readFileSync(join(this.dir, 'credentials.json'), 'utf8')).password;
    const admin = await this.adminClient();
    let failure;
    try {
      for (const actor of actors) {
        const response = await admin.fetch('/api/_admin/user', {
          method: 'POST', signal: AbortSignal.timeout(30000),
          headers: { 'Content-Type': 'application/json', 'CSRF-Token': admin.tokens()?.csrf_token ?? '' },
          body: JSON.stringify({ email: actor.email, password, verified: true, admin: false }),
        });
        assert.ok(response.ok, 'capacity Auth account provisioning failed');
        const user = await response.json();
        assert.equal(typeof user.id, 'string', 'capacity Auth account identifier missing');
        await this.execute(`UPDATE users SET auth_subject=${quote(user.id.replaceAll('-', ''))} WHERE external_id=${quote(actor.user)};`);
      }
    } catch (error) { failure = error; }
    try { await this.clearVerificationSession(); } catch (error) { if (failure) failure.cleanupError = error; else failure = error; }
    if (failure) throw failure;
  }

  async loginActors(actors, stageDir) {
    const password = JSON.parse(readFileSync(join(this.dir, 'credentials.json'), 'utf8')).password;
    const sessions = new Array(actors.length);
    const batchSize = 4;
    for (let offset = 0; offset < actors.length; offset += batchSize) {
      const batch = actors.slice(offset, offset + batchSize);
      const loggedIn = await Promise.all(batch.map(async actor => {
        const login = await this.call('/api/auth/v1/login', { method: 'POST', body: { email_or_username: actor.email, password } });
        const token = login?.auth_token;
        assert.equal(typeof token, 'string', 'capacity actor login failed');
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
        assert.ok(claims.exp * 1000 - Date.now() >= (HOLD_SECONDS + 120) * 1000, 'capacity actor token lifetime too short');
        const profilePath = `/api/records/v1/users?filter[external_id]=${encodeURIComponent(actor.user)}&limit=1`;
        const profile = await this.call(profilePath, { token });
        assert.equal(profile.records?.[0]?.email, actor.email, 'capacity actor identity did not resolve');
        const refreshToken = login?.refresh_token;
        assert.equal(typeof refreshToken, 'string', 'capacity actor refresh token missing');
        const refreshed = await this.call('/api/auth/v1/refresh', { method: 'POST', body: { refresh_token: refreshToken } });
        assert.equal(typeof refreshed?.auth_token, 'string', 'capacity actor refresh token was not accepted');
        const refreshedProfile = await this.call(profilePath, { token: refreshed.auth_token });
        assert.equal(refreshedProfile.records?.[0]?.email, actor.email, 'refreshed capacity actor identity did not resolve');
        return { ...actor, token, csrf: login.csrf_token, refreshToken, refreshVerified: true };
      }));
      loggedIn.forEach((actor, index) => { sessions[offset + index] = actor; });
    }
    const evidence = evaluateActorSessionEvidence(sessions);
    const hostReportedRefreshSessionRows = this.trailSessions();
    const sessionCheck = {
      ...evidence,
      hostReportedRefreshSessionRows,
      hostRefreshSessionCountMatches: hostReportedRefreshSessionRows == null ? null : hostReportedRefreshSessionRows === sessions.length,
      session_count_source: this.inv?.storage === 'docker-volume' ? 'not read live; native refresh/profile acceptance proves each session' : 'legacy host cross-check',
      verifiedProfiles: sessions.length,
      passed: evidence.passed && sessions.length === actors.length,
    };
    writeFileSync(join(stageDir, 'actor-session-check.json'), JSON.stringify(sessionCheck, null, 2), { mode: 0o600 });
    assert.ok(sessionCheck.passed, `actor session evidence failed: ${evidence.failureReasons.join('; ')}`);
    return sessions.map(({ refreshToken, refreshVerified, ...actor }) => actor);
  }

  async restoreStage(manifest, stageDir) {
    await this.restore(manifest);
    await this.start();
    await this.ready();
    await this.verify(manifest);
    copyFileSync(join(this.runDir, 'start-state.json'), join(stageDir, 'start-state.json'));
  }

  async backendAvailable() {
    try {
      const response = await fetch(`${this.inv.base}/api/healthcheck`, { signal: AbortSignal.timeout(3000) });
      return response.ok;
    } catch { return false; }
  }

  async postcheckStage(stage, actors) {
    const prefix = `${this.capacityPrefix}-s${stage}-`;
    assert.ok(actors.length > 0, 'persistence check requires actor contexts');
    // Scan activities once per aggregate and probe the existing UNIQUE task ID
    // index, rather than scanning unindexed activities for every task. Return one
    // row in one statement/snapshot; no schema tuning or deadline relaxation.
    const contexts = actors.map(actor => `WHEN ${quote(actor.user)} THEN t.organization_id IS ${quote(actor.organization)} AND t.project_id IS ${quote(actor.project)}`).join('\n');
    const rows = await this.query(`WITH
      stage_tasks AS (SELECT * FROM tasks WHERE external_id LIKE ${quote(prefix + '%')}),
      stage_activities AS (SELECT * FROM activities WHERE subject_id LIKE ${quote(prefix + '%')})
      SELECT
        (SELECT count(*) FROM stage_tasks),
        (SELECT count(*) FROM stage_activities),
        (SELECT count(DISTINCT subject_id) FROM stage_activities),
        (SELECT count(*) FROM stage_activities a LEFT JOIN tasks t ON t.external_id = a.subject_id WHERE t.external_id IS NULL),
        (SELECT count(*) FROM stage_tasks t WHERE (CASE t.creator_id ${contexts} ELSE 0 END) = 0),
        (SELECT count(*) FROM stage_activities a LEFT JOIN tasks t ON t.external_id = a.subject_id
          WHERE t.external_id IS NULL OR a.organization_id IS NOT t.organization_id OR a.project_id IS NOT t.project_id
            OR a.actor_id IS NOT t.creator_id OR a.action IS NOT 'created' OR a.subject_type IS NOT 'task' OR a.external_id IS NULL OR a.external_id = ''),
        (SELECT count(*) FROM tasks),
        (SELECT count(*) FROM activities)`);
    return evaluateCapacityPersistence(rows.length === 1 ? rows[0] : null, this.fixture.rows.tasks.length, this.fixture.rows.activities.length);
  }

  async stageResources() { return null; }

  async runCapacityStage(vus, { ordinal }) {
    assert.ok(Number.isSafeInteger(vus) && vus > 0 && vus <= (this.capacityHardCap ?? 330) && vus <= MAX_CAPACITY_VUS, 'stage exceeds capacity hard cap');
    if (vus > 165) assert.ok(this.guard165Passed, 'fresh passing 165-user guard required before expansion');
    if (vus > 330) assert.ok(this.guard330Passed, 'fresh passing 330-user guard required before expansion');
    const stageDir = join(this.runDir, `stage-${String(ordinal).padStart(2, '0')}-vus-${String(vus).padStart(3, '0')}`);
    mkdirSync(stageDir, { mode: 0o700 });
    if (ordinal > 1) await this.restoreStage(this.capacityManifest, stageDir);
    else copyFileSync(join(this.runDir, 'start-state.json'), join(stageDir, 'start-state.json'));

    const actors = this.baseActors.slice(0, Math.min(vus, this.baseActors.length));
    if (vus > this.baseActors.length) {
      const extra = buildAdditionalActors(this.baseActors, { count: vus - this.baseActors.length, runId: this.capacityRunId, platform: this.platform });
      await this.provisionAdditionalActors(extra);
      actors.push(...extra);
    }
    assert.equal(actors.length, vus, 'capacity actor pool must match VU count');
    const sessions = await this.loginActors(actors, stageDir);
    const network = this.k6Network();
    const configPath = join(stageDir, 'config.json');
    const startedAt = new Date().toISOString();
    const config = {
      platform: this.platform,
      base: network.base,
      ...(this.pg ? { anon: this.anon } : {}),
      prefix: this.capacityPrefix,
      stage: ordinal,
      vus,
      duration: `${HOLD_SECONDS}s`,
      actors: sessions.map(({ token, csrf, user, organization, project }) => ({ token, csrf, user, organization, project })),
    };
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });

    const image = readFileSync(join(this.root, 'versions.env'), 'utf8').match(/^K6_IMAGE=(\S+)$/m)?.[1];
    assert.match(image ?? '', /^grafana\/k6:1\.6\.1@sha256:[a-f0-9]{64}$/);
    this.docker(['image', 'inspect', image]);
    const script = join(this.root, 'baseline/capacity-test.js');
    const args = ['run', '--rm', '--pull', 'never', '--name', `${this.inv.name}-k6`, '--label', `baas-bench.v6-owner=${this.inv.owner}`, '--user', `${process.getuid()}:${process.getgid()}`, ...network.dockerArgs, '--mount', `type=bind,source=${stageDir},target=/work`, '--mount', `type=bind,source=${script},target=/test.js,readonly`, image, 'run', '--out', 'json=/work/metrics.json', '/test.js'];
    const r = (this.spawnCommand ?? spawnSync)('docker', args, { encoding: 'utf8', timeout: (HOLD_SECONDS + 120) * 1000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(stageDir, 'k6.log'), `${r.stdout ?? ''}\n${r.stderr ?? ''}`, { mode: 0o600 });
    try { unlinkSync(configPath); } catch {}
    assert.equal(r.status, 0, 'capacity k6 stage failed to execute; private stage logs retained');
    const summary = JSON.parse(readFileSync(join(stageDir, 'summary.json'), 'utf8'));
    const slo = evaluateCapacitySummary(summary);
    const available = await this.backendAvailable();
    const postcheck = available
      ? await this.postcheckStage(ordinal, actors)
      : { passed: false, failureReasons: ['backend unavailable after load'], tasks: null, atomicActivities: null, totalTasks: null, totalActivities: null, orphanActivities: null };
    const resources = await this.stageResources(stageDir);
    const result = {
      ordinal,
      vus,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      measured_duration_ms: finite(summary.state?.testRunDurationMs) ? summary.state.testRunDurationMs : null,
      measurement_network: network,
      passed: slo.passed && postcheck.passed && (!resources || resources.passed),
      failureReasons: [...slo.failureReasons, ...postcheck.failureReasons, ...(resources && !resources.passed ? ['native service liveness/resource evidence failed'] : [])],
      ...(resources ? { nativeResourcesPassed: resources.passed } : {}),
      slo: slo.metrics,
      persistence: postcheck,
      artifact: relative(this.runDir, stageDir),
    };
    writeFileSync(join(stageDir, 'stage-outcome.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    const brief = { stage: ordinal, vus, passed: result.passed, httpFailureRate: slo.metrics.http_failure_rate, requestsPerSecond: slo.metrics.requests_per_second, failureReasons: result.failureReasons };
    console.log(`V6_CAPACITY_STAGE ${JSON.stringify(brief)}`);
    if (vus === 165) this.guard165Passed = result.passed;
    if (vus === 330) this.guard330Passed = result.passed;
    return result;
  }

  async k6() {
    let failure;
    try {
      this.capacitySummary = await runAdaptiveCapacitySweep((vus, stage) => this.runCapacityStage(vus, stage), { actorCap: 165, hardCap: this.capacityHardCap ?? 330, resolution: 5 });
    } catch (error) { failure = error; }
    try { await this.restore(this.capacityManifest); } catch (error) { if (failure) failure.cleanupError = error; else failure = error; }
    if (failure) throw failure;
  }

  async postcheck() {
    assert.ok(this.capacitySummary, 'capacity sweep result missing');
    const report = {
      diagnostic: true,
      admitted_v5: false,
      measurement_qualified: false,
      platform: this.platform ?? 'trailbase',
      slo: { ...CAPACITY_SLO, correctness: 'all checks and persisted task/activity invariants must pass' },
      method: {
        identity: 'one distinct account and authenticated native session per VU',
        sign_in_measured: false,
        hold_seconds_per_rung: HOLD_SECONDS,
        think_time_seconds: 1,
        operations: ['list first task page', 'create one task with an atomic activity', 'reread created task'],
        authorized_hard_cap: this.capacityHardCap ?? 330,
        coarse_steps: coarseSteps(165, this.capacityHardCap ?? 330),
        midpoint_resolution_vus: 5,
        platform_limits: { cpus: this.pg ? 4 : 2, memory: '4 GiB' },
        storage: this.pg ? 'native PostgreSQL database; full immutable archive with forced owned-database recreation' : 'owned Docker-managed Linux volume; closed snapshots audited offline',
        measurement_network: this.pg ? 'host-loopback' : 'direct-linux-network-namespace',
        controller_auth_network: 'host loopback, outside measurement',
      },
      fixture: {
        baseline_unique_users: this.baseActors.length,
        expanded_unique_users: Math.max(...this.capacitySummary.stages.map(stage => stage.vus)),
        organizations: this.fixture.rows.organizations.length,
        projects: this.fixture.rows.projects.length,
        expansion_uses_existing_tenant_project_contexts: true,
      },
      baseline_manifest_sha256: sha256File(join(this.dir, 'manifest.json')),
      capacity_runner_sha256: sha256File(join(this.root, 'baseline/capacity.mjs')),
      k6_workload_sha256: sha256File(join(this.root, 'baseline/capacity-test.js')),
      node: process.versions.node,
      k6_image: readFileSync(join(this.root, 'versions.env'), 'utf8').match(/^K6_IMAGE=(\S+)$/m)?.[1],
      ...this.capacitySummary,
    };
    this.saveToRunDir('capacity-summary.json', report);
    console.log(`V6 capacity sweep complete: ${report.status === 'at-least' ? `at least ${report.lowerBoundVus} users` : `${report.lowerBoundVus} passed; ${report.firstFailingVus} first failed`}; local diagnostic only`);
  }

  saveToRunDir(name, value) {
    writeFileSync(join(this.runDir, name), JSON.stringify(value, null, 2), { mode: 0o600 });
  }
}

export class TrailBaseCapacity extends NativeCapacity {
  constructor(options) { assert.equal(options.platform, 'trailbase'); super(options); }
}

export class SupabaseCapacity extends NativeCapacity {
  constructor(options) { assert.equal(options.platform, 'supabase'); super(options); }

  async provisionAdditionalActors(actors) {
    if (!actors.length) return;
    const now = new Date().toISOString();
    for (const actor of actors) { assert.match(actor.user, /^[a-z0-9]+$/); assert.match(actor.membership, /^[a-z0-9]+$/); }
    await this.execute(`BEGIN;
      INSERT INTO public.users(id,email,display_name,created_at,updated_at) VALUES ${actors.map(a => `(${[a.user,a.email,a.displayName,now,now].map(quote).join(',')})`).join(',')};
      INSERT INTO public.memberships(id,organization_id,user_id,role,created_at,revoked_at) VALUES ${actors.map(a => `(${[a.membership,a.organization,a.user,a.role,now,null].map(quote).join(',')})`).join(',')}; COMMIT;`);
    const password = JSON.parse(readFileSync(join(this.dir, 'credentials.json'))).password;
    for (const actor of actors) {
      const user = await this.call('/auth/v1/admin/users', { method: 'POST', admin: true, body: { email: actor.email, password, email_confirm: true } });
      assert.equal(typeof user.id, 'string', 'native capacity Auth subject missing');
      assert.equal(user.email, actor.email, 'native capacity Auth email mismatch');
      await this.execute(`UPDATE public.users SET auth_subject=${quote(user.id)} WHERE id=${quote(actor.user)};`);
    }
    await this.clearVerificationSession();
  }

  async loginActors(actors, stageDir) {
    const password = JSON.parse(readFileSync(join(this.dir, 'credentials.json'))).password, sessions = [];
    const verify = async (actor, token, subject) => {
      assert.equal(typeof token, 'string', 'native capacity access token missing');
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      assert.equal(claims.sub, subject, 'native capacity JWT subject mismatch');
      try { await waitForCapacityTokenEligibility(claims); }
      catch (error) {
        if (this.runDir) this.saveToRunDir('token-eligibility-failure.json', { at: new Date().toISOString(), iat: claims.iat, nbf: claims.nbf ?? null, exp: claims.exp, role: claims.role ?? null, reason: error.message });
        throw error;
      }
      assert.ok(claims.exp * 1000 - Date.now() >= (HOLD_SECONDS + 120) * 1000, 'capacity token lifetime too short');
      const user = await this.call('/auth/v1/user', { token });
      assert.equal(user.id, subject); assert.equal(user.email, actor.email);
      const profile = await this.call(`/rest/v1/users?id=eq.${encodeURIComponent(actor.user)}&select=id,email,auth_subject&limit=1`, { token });
      assert.equal(profile.length, 1); assert.equal(profile[0].id, actor.user); assert.equal(profile[0].email, actor.email); assert.equal(profile[0].auth_subject, subject);
    };
    for (let offset = 0; offset < actors.length; offset += 4) {
      sessions.push(...await Promise.all(actors.slice(offset, offset + 4).map(async actor => {
        const login = await this.call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: actor.email, password } });
        assert.equal(login.user?.email, actor.email); assert.equal(typeof login.user?.id, 'string');
        await verify(actor, login.access_token, login.user.id);
        assert.equal(typeof login.refresh_token, 'string', 'native refresh token missing');
        const refreshed = await this.call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: login.refresh_token } });
        assert.equal(refreshed.user?.id, login.user.id); assert.equal(typeof refreshed.refresh_token, 'string');
        await verify(actor, refreshed.access_token, login.user.id);
        return { ...actor, subject: login.user.id, token: refreshed.access_token, refreshToken: refreshed.refresh_token, refreshVerified: true };
      })));
    }
    const evidence = evaluateActorSessionEvidence(sessions);
    const rows = await this.query('SELECT (SELECT count(*) FROM auth.sessions) AS session_count, (SELECT count(*) FROM auth.refresh_tokens WHERE NOT revoked) AS active_refresh_count');
    assert.deepEqual(rows, [[actors.length, actors.length]], 'native session and active refresh counts must match VUs');
    assert.equal(new Set(sessions.map(a => a.subject)).size, actors.length, 'native subjects must be distinct');
    const report = { ...evidence, platform: 'supabase', verifiedProfiles: sessions.length, nativeSessions: rows[0][0], nativeActiveRefreshTokens: rows[0][1], session_count_source: 'native Auth, refresh and RLS profiles plus PostgreSQL session counts' };
    writeFileSync(join(stageDir, 'actor-session-check.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    assert.ok(report.passed, 'native capacity session evidence failed');
    return sessions.map(({ refreshToken, refreshVerified, subject, ...actor }) => actor);
  }

  async backendAvailable() {
    try { const r = await fetch(`${this.inv.base}/auth/v1/health`, { signal: AbortSignal.timeout(3000), headers: { apikey: this.anon, Authorization: `Bearer ${this.anon}` } }); return r.ok; } catch { return false; }
  }

  async postcheckStage(stage, actors) {
    assert.ok(actors.length > 0);
    const prefix = `${this.capacityPrefix}s${stage}u`;
    const contexts = actors.map(a => `WHEN ${quote(a.user)} THEN t.organization_id IS NOT DISTINCT FROM ${quote(a.organization)} AND t.project_id IS NOT DISTINCT FROM ${quote(a.project)}`).join('\n');
    const rows = await this.query(`WITH stage_tasks AS (SELECT * FROM public.tasks WHERE id LIKE ${quote(prefix + '%')}),
      stage_activities AS (SELECT * FROM public.activities WHERE subject_id LIKE ${quote(prefix + '%')}) SELECT
      (SELECT count(*) FROM stage_tasks) AS stage_task_count,
      (SELECT count(*) FROM stage_activities) AS stage_activity_count,
      (SELECT count(DISTINCT subject_id) FROM stage_activities) AS subject_count,
      (SELECT count(*) FROM stage_activities a LEFT JOIN public.tasks t ON t.id = a.subject_id WHERE t.id IS NULL) AS orphan_count,
      (SELECT count(*) FROM stage_tasks t WHERE (CASE t.creator_id ${contexts} ELSE false END) IS NOT TRUE) AS invalid_task_count,
      (SELECT count(*) FROM stage_activities a LEFT JOIN public.tasks t ON t.id = a.subject_id WHERE t.id IS NULL
        OR a.organization_id IS DISTINCT FROM t.organization_id OR a.project_id IS DISTINCT FROM t.project_id
        OR a.actor_id IS DISTINCT FROM t.creator_id OR a.action IS DISTINCT FROM 'created' OR a.subject_type IS DISTINCT FROM 'task'
        OR a.id IS NULL OR a.id = '') AS invalid_activity_count,
      (SELECT count(*) FROM public.tasks) AS total_task_count,
      (SELECT count(*) FROM public.activities) AS total_activity_count`);
    return evaluateCapacityPersistence(rows.length === 1 ? rows[0] : null, this.fixture.rows.tasks.length, this.fixture.rows.activities.length);
  }

  async stageResources(stageDir) {
    const containers = this.owned();
    const healthy = containers.length === 11 && containers.every(c => c.State.Running && !c.State.OOMKilled && c.RestartCount === 0
      && (!c.State.Health || c.State.Health.Status === 'healthy')
      && c.HostConfig.NanoCpus === (c.Config.Labels['com.docker.compose.service'] === 'db' ? 1000000000 : 300000000)
      && c.HostConfig.Memory === (c.Config.Labels['com.docker.compose.service'] === 'db' ? 1536 : 256) * 1024 ** 2)
      && new Set(containers.map(c => c.Config.Labels['com.docker.compose.service'])).size === 11
      && containers.some(c => c.Config.Labels['com.docker.compose.service'] === 'db')
      && containers.reduce((n,c) => n + c.HostConfig.NanoCpus, 0) === 4000000000
      && containers.reduce((n,c) => n + c.HostConfig.Memory, 0) === 4 * 1024 ** 3;
    const evidence = containers.map(c => ({ service: c.Config.Labels['com.docker.compose.service'], running: c.State.Running, health: c.State.Health?.Status ?? null, oomKilled: c.State.OOMKilled, restarts: c.RestartCount, nanoCpus: c.HostConfig.NanoCpus, memory: c.HostConfig.Memory }));
    const report = { passed: healthy, containers: evidence };
    writeFileSync(join(stageDir, 'native-resources.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    return report;
  }

  async k6() {
    await super.k6(); // Always restores, including after an expected failed rung.
    await this.start(); await this.ready(); await this.verify(this.capacityManifest);
  }
}

export function parseCapacityArgs(args) {
  assert.ok(Array.isArray(args) && ['trailbase', 'supabase'].includes(args[0]) && (args.length === 1 || (args.length === 3 && args[1] === '--max-vus' && (args[0] === 'supabase' ? ['330'] : ['330', '660']).includes(args[2]))), 'usage: baseline/capacity.sh {trailbase|supabase} [--max-vus {330|660}]; Supabase ceiling: 330');
  return { platform: args[0], hardCap: args.length === 1 ? 330 : Number(args[2]) };
}

async function main() {
  let options;
  try { options = parseCapacityArgs(process.argv.slice(2)); } catch {}
  if (process.versions.node !== '22.23.1' || !options) {
    console.error('usage: baseline/capacity.sh {trailbase|supabase} [--max-vus {330|660}] (requires pinned Node 22.23.1; Supabase ceiling 330; TrailBase 660 needs explicit operator approval)');
    process.exitCode = 2;
    return;
  }
  process.umask(0o077);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = join(root, '.runtime/k6-baseline', options.platform);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(root, '.runtime/k6-baseline/lock');
  mkdirSync(lock, { mode: 0o700 });
  try {
    const fixture = await lifecycleFixture();
    const facts = await fixtureFacts(root, options.platform, fixture);
    const manifest = readManifest(dir, facts);
    const Capacity = options.platform === 'supabase' ? SupabaseCapacity : TrailBaseCapacity;
    const backend = new Capacity({ root, dir, platform: options.platform, fixture, manifest, hardCap: options.hardCap });
    await runCommand('run', { dir, facts, backend });
    console.log(`V6 capacity ${options.platform} complete (private local diagnostic only)`);
  } catch (error) {
    const report = { diagnostic: true, primary: error.message, cleanup: error.cleanupError?.message ?? null };
    writeFileSync(join(dir, `capacity-failure-${Date.now()}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.error(JSON.stringify(report));
    process.exitCode = 1;
  } finally { rmSync(lock, { recursive: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
