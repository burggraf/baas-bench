import http from 'k6/http';
import { check, fail, sleep } from 'k6';

const cfg = JSON.parse(open('/work/config.json'));
const pg = cfg.platform === 'supabase';
const thresholds = { checks: ['rate==1'], http_req_failed: ['rate==0'] };
for (const op of ['list', 'create', 'reread']) thresholds[`http_req_duration{operation:${op}}`] = ['max>=0'];
export const options = { vus: 1, duration: '60s', gracefulStop: '10s', maxRedirects: 0, thresholds };
// Native login and identity/token-lifetime validation occur in Node before k6 starts.
export function setup() { if (!cfg.token) fail('missing native user token'); return cfg; }
function params(op) {
  return { timeout: '5s', redirects: 0, tags: { operation: op, name: op }, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}`, ...(pg ? { apikey: cfg.anon, Prefer: 'return=representation' } : { 'CSRF-Token': cfg.csrf ?? '' }) } };
}
function checked(value, assertions, op) { if (!check(value, assertions, { operation: op })) fail(`${op} response assertion failed`); }
export default function () {
  try {
    const listURL = pg ? `/rest/v1/tasks?organization_id=eq.${cfg.organization}&project_id=eq.${cfg.project}&order=created_at.asc,id.asc&limit=20&offset=0` : `/api/records/v1/tasks?filter[organization_id]=${cfg.organization}&filter[project_id]=${cfg.project}&order=created_at,external_id&limit=20`;
    const list = http.get(cfg.base + listURL, params('list'));
    checked(list, { 'list HTTP 200': r => r.status === 200 }, 'list');
    const listed = pg ? list.json() : list.json('records');
    checked(listed, { 'first page rows match tenant': rows => Array.isArray(rows) && rows.length > 0 && rows.length <= 20 && rows.every(r => r.organization_id === cfg.organization && r.project_id === cfg.project) }, 'list');
    const id = `${cfg.prefix}${__ITER}`;
    const now = new Date().toISOString();
    const payload = { [pg ? 'id' : 'external_id']: id, organization_id: cfg.organization, project_id: cfg.project, creator_id: cfg.user, title: `V6 task ${__ITER}`, description: 'Reusable baseline diagnostic task', status: 'todo', priority: 'medium', created_at: now, updated_at: now, ...(!pg ? { last_actor_id: cfg.user } : {}) };
    const created = http.post(cfg.base + (pg ? '/rest/v1/tasks' : '/api/records/v1/tasks'), JSON.stringify(payload), params('create'));
    checked(created, { 'create HTTP success': r => r.status === 200 || r.status === 201 }, 'create');
    const native = pg ? created.json()[0]?.id : created.json('ids')[0];
    checked(native, { 'native task id returned': v => v !== undefined && v !== null }, 'create');
    const reread = http.get(cfg.base + (pg ? `/rest/v1/tasks?id=eq.${id}` : `/api/records/v1/tasks/${encodeURIComponent(native)}`), params('reread'));
    checked(reread, { 'reread HTTP 200': r => r.status === 200 }, 'reread');
    const row = pg ? reread.json()[0] : reread.json();
    checked(row, { 'reread matches task payload': r => r && Object.entries(payload).every(([k, v]) => k === 'created_at' || k === 'updated_at' ? Date.parse(r[k]) === Date.parse(v) : r[k] === v) }, 'reread');
  } catch (_) {
    check(false, { 'iteration completed without error': value => value === true }, { operation: 'iteration' });
    fail('iteration failed (response/assertion error)');
  } finally {
    sleep(1);
  }
}
export function handleSummary(data) { return { '/work/summary.json': JSON.stringify(data, null, 2) }; }
