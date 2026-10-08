import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import * as capacity from '../baseline/capacity.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = { rows: {
  users: Array.from({ length: 165 }, (_, i) => [`user-${i}`, `actor-${i}@example.test`, `Actor ${i}`]),
  memberships: Array.from({ length: 165 }, (_, i) => [`membership-${i}`, 'org', `user-${i}`, 'member', '2026-01-01', null]),
  projects: [['project', 'org', 'Project']], tasks: [], activities: [], organizations: [['org']],
} };

test('660 actors use 495 distinct additional identities in existing contexts', () => {
  const base = capacity.buildCapacityActors(fixture);
  const extra = capacity.buildAdditionalActors(base, { count: 495, runId: 'a'.repeat(32) });
  assert.equal(base.length + extra.length, 660);
  for (const key of ['user', 'email']) assert.equal(new Set([...base, ...extra].map(actor => actor[key])).size, 660);
  assert.equal(new Set(extra.map(actor => actor.membership)).size, 495);
  assert.ok(extra.every(actor => actor.organization === 'org' && actor.project === 'project' && actor.role === 'member'));
  for (const count of [-1, 496, 1.5, NaN]) assert.throws(() => capacity.buildAdditionalActors(base, { count, runId: 'a'.repeat(32) }), /actor count/);
});

test('explicit 660 sweep requires 165 and 330 guards and stops at the approved cap', async () => {
  const visited = [];
  const result = await capacity.runAdaptiveCapacitySweep(async vus => { visited.push(vus); return { vus, passed: true }; }, { hardCap: 660 });
  assert.deepEqual(visited, [1, 2, 4, 8, 16, 32, 64, 128, 165, 330, 660]);
  assert.equal(result.status, 'at-least'); assert.equal(result.lowerBoundVus, 660);
  assert.equal(result.firstFailingVus, null);
  const defaultStages = [];
  await capacity.runAdaptiveCapacitySweep(async vus => { defaultStages.push(vus); return { vus, passed: true }; });
  assert.equal(defaultStages.at(-1), 330, 'default remains the earlier approved cap');
  const smallFixtureSteps = [];
  await capacity.runAdaptiveCapacitySweep(async vus => { smallFixtureSteps.push(vus); return { vus, passed: true }; }, { actorCap: 32, hardCap: 660 });
  assert.deepEqual(smallFixtureSteps.slice(-3), [165, 330, 660], 'actorCap cannot bypass either expansion guard');
  await assert.rejects(capacity.runAdaptiveCapacitySweep(async () => ({ passed: true }), { hardCap: 661 }), /hard cap/);
});

test('failed 165 or 330 guard forbids provisioned expansion above that guard', async () => {
  for (const guard of [165, 330]) {
    const visited = [];
    await capacity.runAdaptiveCapacitySweep(async vus => { visited.push(vus); return { vus, passed: vus < guard }; }, { hardCap: 660 });
    assert.ok(visited.includes(guard)); assert.ok(visited.every(vus => vus <= guard));
    assert.ok(!visited.includes(660));
  }
});

test('660 refinement remains bounded and resolves a failing upper bracket to five VUs', async () => {
  const result = await capacity.runAdaptiveCapacitySweep(async vus => ({ vus, passed: vus <= 500 }), { hardCap: 660 });
  assert.ok(result.lowerBoundVus <= 500 && result.firstFailingVus > 500);
  assert.ok(result.firstFailingVus - result.lowerBoundVus <= 5);
  assert.ok(result.stages.every(stage => stage.vus <= 660));
});

test('CLI parses only explicit supported caps and defaults to 330', () => {
  assert.equal(typeof capacity.parseCapacityArgs, 'function', 'restricted CLI parser required');
  assert.deepEqual(capacity.parseCapacityArgs(['trailbase']), { platform: 'trailbase', hardCap: 330 });
  for (const hardCap of [330, 660]) assert.deepEqual(capacity.parseCapacityArgs(['trailbase', '--max-vus', String(hardCap)]), { platform: 'trailbase', hardCap });
  for (const args of [[], ['neon'], ['supabase', '--max-vus', '660'], ['trailbase', '--max-vus'], ['trailbase', '--max-vus', '661'], ['trailbase', '--max-vus', '0660'], ['trailbase', '--max-vus', '660junk'], ['trailbase', '--max-vus', '-1'], ['trailbase', '--max-vus=660'], ['trailbase', '--max-vus', '660', 'extra']]) assert.throws(() => capacity.parseCapacityArgs(args), /usage/);
});

test('constructor enforces selected cap and stage guards precede file or backend mutation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'v6-cap-bound-'));
  try {
    const standard = new capacity.TrailBaseCapacity({ root, dir, platform: 'trailbase', fixture });
    const expanded = new capacity.TrailBaseCapacity({ root, dir, platform: 'trailbase', fixture, hardCap: 660 });
    assert.equal(standard.capacityHardCap, 330); assert.equal(expanded.capacityHardCap, 660);
    assert.throws(() => new capacity.TrailBaseCapacity({ root, dir, platform: 'trailbase', fixture, hardCap: 661 }), /hard cap/);
    for (const [runner, vus, pattern] of [[standard, 331, /hard cap/], [expanded, 661, /hard cap/], [expanded, 330, /165.*guard/], [expanded, 660, /165.*guard/]]) {
      await assert.rejects(runner.runCapacityStage(vus, { ordinal: 1 }), pattern);
      assert.equal(existsSync(join(runner.runDir, `stage-01-vus-${vus}`)), false, 'denied trial must not create stage files');
    }
    expanded.guard165Passed = true;
    await assert.rejects(expanded.runCapacityStage(660, { ordinal: 1 }), /330.*guard/);
    assert.equal(existsSync(join(expanded.runDir, 'stage-01-vus-660')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('actual stage runner admits higher rungs only after successful SLO and persistence guards', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'v6-cap-stage-'));
  try {
    const runner = new capacity.TrailBaseCapacity({ root, dir, platform: 'trailbase', fixture, hardCap: 660 });
    writeFileSync(join(runner.runDir, 'start-state.json'), '{}');
    const added = []; let currentDir, persistencePasses = true;
    Object.assign(runner, {
      async restoreStage(_manifest, stageDir) { writeFileSync(join(stageDir, 'start-state.json'), '{}'); },
      async provisionAdditionalActors(extra) { added.push(extra.length); },
      async loginActors(actors, stageDir) { currentDir = stageDir; return actors.map(actor => ({ ...actor, token: `synthetic-${actor.user}`, csrf: 'synthetic' })); },
      k6Network: () => ({ base: 'http://127.0.0.1:4000', dockerArgs: [], kind: 'synthetic-network' }),
      docker: () => '', async backendAvailable() { return true; }, async postcheckStage() { return { passed: persistencePasses, failureReasons: persistencePasses ? [] : ['synthetic persistence refusal'] }; },
      spawnCommand() {
        const metrics = { capacity_http_failure: { values: { rate: 0 } }, http_req_failed: { values: { rate: 0 } }, checks: { values: { passes: 3, fails: 0, rate: 1 } } };
        for (const op of ['list', 'create', 'reread']) metrics[`capacity_${op}_duration`] = { values: { count: 1, 'p(95)': 1, 'p(99)': 1 } };
        writeFileSync(join(currentDir, 'summary.json'), JSON.stringify({ metrics })); return { status: 0, stdout: '', stderr: '' };
      }, inv: { name: 'synthetic-backend', owner: 'synthetic-owner' },
    });
    assert.ok((await runner.runCapacityStage(165, { ordinal: 1 })).passed); assert.equal(runner.guard165Passed, true);
    assert.ok((await runner.runCapacityStage(330, { ordinal: 2 })).passed); assert.equal(runner.guard330Passed, true);
    assert.ok((await runner.runCapacityStage(660, { ordinal: 3 })).passed); assert.deepEqual(added, [165, 495]);
    persistencePasses = false;
    assert.equal((await runner.runCapacityStage(330, { ordinal: 4 })).passed, false); assert.equal(runner.guard330Passed, false);
    await assert.rejects(runner.runCapacityStage(660, { ordinal: 5 }), /330.*guard/);
    assert.equal((await runner.runCapacityStage(165, { ordinal: 6 })).passed, false); assert.equal(runner.guard165Passed, false);
    await assert.rejects(runner.runCapacityStage(330, { ordinal: 7 }), /165.*guard/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('selected cap reaches the runner and reported provenance while restore remains mandatory', async () => {
  const runner = Object.create(capacity.TrailBaseCapacity.prototype), visited = [], reports = [];
  let restored = false;
  Object.assign(runner, { capacityHardCap: 660, baseActors: Array(165), fixture: { rows: { organizations: [], projects: [] } }, dir: join(root, 'baseline'), root,
    async runCapacityStage(vus) { visited.push(vus); return { vus, passed: true }; },
    async restore() { restored = true; }, saveToRunDir(name, report) { reports.push({ name, report }); },
  });
  // Reporting reads a baseline manifest checksum, so provide a private synthetic one.
  const dir = mkdtempSync(join(tmpdir(), 'v6-cap-report-'));
  try {
    writeFileSync(join(dir, 'manifest.json'), '{}'); runner.dir = dir;
    await runner.k6(); await runner.postcheck();
    assert.equal(visited.at(-1), 660); assert.ok(restored);
    assert.equal(reports[0].report.method.authorized_hard_cap, 660);
    assert.deepEqual(reports[0].report.method.coarse_steps.slice(-3), [165, 330, 660]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('native persistence SQL remains bounded at 40k writes and all 660 actor contexts', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA automatic_index=OFF; CREATE TABLE tasks (external_id TEXT UNIQUE NOT NULL,organization_id TEXT,project_id TEXT,creator_id TEXT); CREATE TABLE activities (external_id TEXT UNIQUE NOT NULL,subject_id TEXT,organization_id TEXT,project_id TEXT,actor_id TEXT,action TEXT,subject_type TEXT);');
    const base = capacity.buildCapacityActors(fixture), actors = [...base, ...capacity.buildAdditionalActors(base, { count: 495, runId: 'b'.repeat(32) })];
    const task = db.prepare('INSERT INTO tasks VALUES (?,?,?,?)'), activity = db.prepare('INSERT INTO activities VALUES (?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    for (let i = 0; i < 40000; i++) {
      const actor = actors[i % actors.length], id = `expanded-s1-u${i % actors.length + 1}-i${i}`;
      task.run(id, actor.organization, actor.project, actor.user); activity.run(`activity-${i}`, id, actor.organization, actor.project, actor.user, 'created', 'task');
    }
    db.exec('COMMIT');
    const runner = Object.create(capacity.TrailBaseCapacity.prototype);
    Object.assign(runner, { capacityPrefix: 'expanded', fixture: { rows: { tasks: [], activities: [] } }, async query(sql) { return db.prepare(sql).all().map(Object.values); } });
    const started = performance.now(), result = await runner.postcheckStage(1, actors);
    assert.ok(performance.now() - started < 5000, '660-context audit must remain below the existing regression deadline');
    assert.ok(result.passed); assert.equal(result.tasks, 40000); assert.equal(result.atomicActivities, 40000);
    db.exec("UPDATE tasks SET creator_id='unknown' WHERE external_id='expanded-s1-u660-i659'");
    assert.equal((await runner.postcheckStage(1, actors)).passed, false, 'last added actor corruption fails closed');
  } finally { db.close(); }
});

test('bad cap CLI exits before Docker and without taking the global lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v6-cap-cli-'));
  try {
    mkdirSync(join(dir, 'bin')); const marker = join(dir, 'docker-called');
    writeFileSync(join(dir, 'bin/docker'), '#!/bin/sh\nprintf called > "$TEST_DOCKER_MARKER"\nexit 99\n', { mode: 0o700 });
    for (const value of ['661', '0660', '660junk']) {
      const result = spawnSync(process.execPath, [join(root, 'baseline/capacity.mjs'), 'trailbase', '--max-vus', value], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, TEST_DOCKER_MARKER: marker } });
      assert.equal(result.status, 2); assert.match(result.stderr, /usage/); assert.equal(existsSync(marker), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
