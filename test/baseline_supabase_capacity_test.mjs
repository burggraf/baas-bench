import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as capacity from '../baseline/capacity.mjs';
const actors = [1, 2].map(i => ({ user: `user${i}`, email: `u${i}@example.test`, displayName: `User ${i}`, organization: `org${i}`, project: `project${i}` }));
const temporary = () => { const dir = mkdtempSync(join(tmpdir(), 'v6-supabase-capacity-')); writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ password: 'synthetic-password' })); return dir; };
function runner(dir, extra = {}) { assert.equal(typeof capacity.SupabaseCapacity, 'function', 'Supabase needs a native capacity adapter'); return Object.assign(Object.create(capacity.SupabaseCapacity.prototype), { dir, platform: 'supabase', pg: true, ...extra }); }
test('native token eligibility waits outside measurement for the issued-at boundary, bounded and fail closed', async () => {
  assert.equal(typeof capacity.waitForCapacityTokenEligibility, 'function');
  let clock=100000, pauses=[];
  const options={now:()=>clock,pause:async ms=>{pauses.push(ms);clock+=ms;}};
  await capacity.waitForCapacityTokenEligibility({iat:100,exp:3700},options);
  assert.equal(clock,101500); assert.deepEqual(pauses,[1500]);
  pauses=[]; await capacity.waitForCapacityTokenEligibility({iat:99,exp:3700},options); assert.deepEqual(pauses,[]);
  await assert.rejects(capacity.waitForCapacityTokenEligibility({iat:120,exp:3700},options),/clock|bounded/);
  await assert.rejects(capacity.waitForCapacityTokenEligibility({iat:100,nbf:120,exp:3700},options),/clock|bounded/);
  await assert.rejects(capacity.waitForCapacityTokenEligibility({iat:'100',exp:3700},options));
  await assert.rejects(capacity.waitForCapacityTokenEligibility({iat:100,exp:100},options));
  clock=100000; pauses=[]; let elapsed=0;
  await capacity.waitForCapacityTokenEligibility({iat:100,exp:3700},{now:()=>clock,monotonicNow:()=>elapsed,pause:async ms=>{pauses.push(ms);const actual=pauses.length===1?ms-1:ms;clock+=actual;elapsed+=actual;}});
  assert.equal(clock,101500); assert.deepEqual(pauses,[1500,1], 'an early timer wake must recheck and wait, not reject an otherwise valid native token');
  await assert.rejects(capacity.waitForCapacityTokenEligibility({iat:100,exp:3700},{now:()=>100000,monotonicNow:()=>elapsed,pause:async()=>{elapsed+=5000;}}),/bounded|clock/);
});
test('Supabase CLI admits only its bounded 330-user local sweep', () => {
  assert.deepEqual(capacity.parseCapacityArgs(['supabase']), { platform: 'supabase', hardCap: 330 });
  assert.deepEqual(capacity.parseCapacityArgs(['supabase', '--max-vus', '330']), { platform: 'supabase', hardCap: 330 });
  assert.throws(() => capacity.parseCapacityArgs(['supabase', '--max-vus', '660']));
  assert.throws(() => capacity.parseCapacityArgs(['supabase', '--max-vus', '331']));
});
test('Supabase expanded fixture identifiers respect native PostgreSQL checks', () => {
  const extra = capacity.buildAdditionalActors(actors, { count: 165, runId: 'a'.repeat(32), platform: 'supabase' });
  assert.equal(new Set(extra.map(a => a.user)).size, 165);
  for (const a of extra) { assert.match(a.user, /^[a-z0-9]+$/); assert.match(a.membership, /^[a-z0-9]+$/); assert.ok(actors.some(b => b.organization === a.organization && b.project === a.project)); }
});
test('Supabase login proves native subjects, refreshed tokens, RLS profiles and native session counts', async () => {
  const dir = temporary(), stage = join(dir, 'stage'); mkdirSync(stage);
  try {
    const issued = new Map(), refreshed = new Map(); let wrongSubject = false, nativeSessions = 2;
    const jwt = (sub, suffix) => `e30.${Buffer.from(JSON.stringify({ sub, iat: Math.floor(Date.now()/1000)-2, exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url')}.${suffix}`;
    const b = runner(dir, { async call(path, { body, token, admin } = {}) {
      assert.ok(!admin, 'measured actors never use service/admin authorization');
      if (path === '/auth/v1/token?grant_type=password') { const a = actors.find(a => a.email === body.email); const sub = `subject${a.user}`; const access = jwt(sub, a.user); issued.set(access, a); return { access_token: access, refresh_token: `refresh${a.user}`, user: { id: sub, email: a.email } }; }
      if (path === '/auth/v1/token?grant_type=refresh_token') { const a = actors.find(a => `refresh${a.user}` === body.refresh_token); assert.ok(a); const access = jwt(wrongSubject ? 'wrong' : `subject${a.user}`, `new${a.user}`); issued.set(access, a); refreshed.set(a.user, access); return { access_token: access, refresh_token: `rotated${a.user}`, user: { id: `subject${a.user}`, email: a.email } }; }
      const a = issued.get(token); assert.ok(a);
      if (path === '/auth/v1/user') return { id: `subject${a.user}`, email: a.email };
      assert.match(path, /^\/rest\/v1\/users\?/); return [{ id: a.user, email: a.email, auth_subject: `subject${a.user}` }];
    }, async query(sql) { assert.match(sql, /auth\.sessions/); assert.match(sql, /auth\.refresh_tokens/); return [[nativeSessions, 2]]; } });
    const sessions = await b.loginActors(actors, stage);
    assert.equal(sessions.length, 2); for (const s of sessions) { assert.equal(s.token, refreshed.get(s.user)); assert.ok(!('refreshToken' in s)); }
    const evidence = readFileSync(join(stage, 'actor-session-check.json'), 'utf8');
    assert.equal(JSON.parse(evidence).passed, true); assert.ok(!evidence.includes('e30.') && !evidence.includes('rotateduser'));
    wrongSubject = true; await assert.rejects(b.loginActors(actors, stage));
    wrongSubject = false; nativeSessions = 1; await assert.rejects(b.loginActors(actors, stage), /session/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Supabase actor provisioning uses native confirmed Auth, PostgreSQL IDs and benchmark membership only', async () => {
  const dir = temporary(); try {
    const sql = [], calls = [], extra = capacity.buildAdditionalActors(actors, { count: 1, runId: 'b'.repeat(32), platform: 'supabase' });
    const b = runner(dir, { async execute(q) { sql.push(q); }, async call(path, options) { calls.push({ path, ...options }); return { id: 'native-subject', email: extra[0].email }; }, async clearVerificationSession() {} });
    await b.provisionAdditionalActors(extra);
    assert.equal(calls[0].path, '/auth/v1/admin/users'); assert.equal(calls[0].admin, true); assert.equal(calls[0].body.email_confirm, true);
    assert.match(sql.join('\n'), /public\.users/); assert.match(sql.join('\n'), /public\.memberships/); assert.match(sql.join('\n'), /auth_subject/);
    assert.ok(!sql.join('\n').includes('external_id') && !sql.join('\n').includes('DISABLE ROW LEVEL SECURITY'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Supabase persistence audit uses PostgreSQL null-safe comparisons and distinct aggregate names', async () => {
  const dir = temporary(); try {
    let sql; const b = runner(dir, { capacityPrefix: 'v6capabc', fixture: { rows: { tasks: Array(50), activities: Array(37) } }, async query(q) { sql = q; return [[2, 2, 2, 0, 0, 0, 52, 39]]; } });
    assert.equal((await b.postcheckStage(1, actors)).passed, true);
    assert.match(sql, /public\.tasks/); assert.match(sql, /t\.id = a\.subject_id/); assert.match(sql, /IS DISTINCT FROM/); assert.match(sql, /v6capabcs1u%/);
    assert.ok(!sql.includes('external_id')); assert.equal((sql.match(/AS (stage_task_count|stage_activity_count|subject_count|orphan_count|invalid_task_count|invalid_activity_count|total_task_count|total_activity_count)\b/g) || []).length, 8);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Supabase stage service evidence rejects zero quotas, restarts, OOM and unhealthy services', async () => {
  const dir = temporary(); try {
    const containers = Array.from({length: 11}, (_, i) => ({ State: { Running: true, OOMKilled: false, Health: {Status:'healthy'} }, RestartCount: 0, Config: {Labels:{'com.docker.compose.service': i ? `service${i}` : 'db'}}, HostConfig:{NanoCpus:i ? 300000000 : 1000000000, Memory:(i ? 256 : 1536)*1024**2} }));
    const b = runner(dir, { owned: () => containers });
    assert.equal((await b.stageResources(dir)).passed, true);
    [containers[0].HostConfig.NanoCpus, containers[1].HostConfig.NanoCpus] = [containers[1].HostConfig.NanoCpus, containers[0].HostConfig.NanoCpus];
    assert.equal((await b.stageResources(dir)).passed, false, 'aggregate total alone must not admit a different fixed service allocation');
    [containers[0].HostConfig.NanoCpus, containers[1].HostConfig.NanoCpus] = [containers[1].HostConfig.NanoCpus, containers[0].HostConfig.NanoCpus];
    for (const [object, key, value] of [[containers[0].HostConfig,'NanoCpus',0], [containers[0].HostConfig,'Memory',0], [containers[0],'RestartCount',1], [containers[0].State,'OOMKilled',true], [containers[0].State.Health,'Status','unhealthy']]) { const old = object[key]; object[key] = value; assert.equal((await b.stageResources(dir)).passed, false); object[key] = old; }
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
test('actual Supabase k6 workload uses native REST, anonymous API key, distinct sessions and valid IDs', () => {
  const source = readFileSync(new URL('../baseline/capacity-test.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ').replace('export default function (data)', 'function iteration(data)');
  const cfg = { platform: 'supabase', anon: 'synthetic-anon', base: 'http://native', prefix: 'v6capabc', stage: 1, vus: 2, duration: '60s', actors: actors.map(a => ({ ...a, token: `token${a.user}` })) }, requests = [], payloads = new Map(), checks = [];
  const response = body => ({ status: Array.isArray(body) ? 200 : 201, timings: { duration: 1 }, json: () => body });
  const ctx = { open: () => JSON.stringify(cfg), Rate: class { add() {} }, Trend: class { add() {} }, sleep: seconds => assert.equal(seconds, 1), check: (v, tests) => { const pass = Object.values(tests).every(fn => fn(v)); checks.push(pass); return pass; }, http: {
    get(url, p) { requests.push({ url, p }); const a = cfg.actors.find(a => `Bearer ${a.token}` === p.headers.Authorization); assert.ok(a); if (p.tags.operation === 'list') return response([{ organization_id: a.organization, project_id: a.project }]); return response([payloads.get(a.user)]); },
    post(url, body, p) { requests.push({ url, p }); const a = cfg.actors.find(a => `Bearer ${a.token}` === p.headers.Authorization); const payload = JSON.parse(body); assert.match(payload.id, /^[a-z0-9]+$/); assert.ok(!('external_id' in payload) && !('last_actor_id' in payload)); payloads.set(a.user, payload); return { ...response({}), json: () => [payload] }; }
  } };
  const w = runInNewContext(`${source}\n({setup, iteration});`, ctx), data = w.setup();
  for (let vu = 1; vu <= 2; vu++) { ctx.__VU = vu; ctx.__ITER = 0; w.iteration(data); }
  assert.equal(requests.length, 6); assert.equal(payloads.size, 2); assert.equal(new Set([...payloads.values()].map(p => p.id)).size, 2); assert.ok(checks.every(Boolean));
  for (const {url,p} of requests) { assert.match(url, /^http:\/\/native\/rest\/v1\/tasks/); assert.equal(p.headers.apikey, 'synthetic-anon'); }
  assert.equal(requests.find(r => r.p.tags.operation === 'create').p.headers.Prefer, 'return=representation');
});
