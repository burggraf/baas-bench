import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const cfg = JSON.parse(open('/work/config.json'));
const httpFailure = new Rate('capacity_http_failure');
const operationDuration = Object.fromEntries(['list', 'create', 'reread'].map(operation => [operation, new Trend(`capacity_${operation}_duration`, true)]));
export const options = {
  scenarios: {
    capacity: {
      executor: 'constant-vus',
      vus: cfg.vus,
      duration: cfg.duration,
      gracefulStop: '10s',
    },
  },
  maxRedirects: 0,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)', 'count'],
};

export function setup() {
  if (!['trailbase', 'supabase'].includes(cfg.platform) || (cfg.platform === 'supabase' && (!cfg.anon || !/^[a-z0-9]+$/.test(cfg.prefix))) || !Number.isSafeInteger(cfg.vus) || cfg.vus < 1 || cfg.actors.length !== cfg.vus || !cfg.prefix || !cfg.stage) {
    throw new Error('invalid capacity stage configuration');
  }
  if (cfg.actors.some(actor => !actor.token || !actor.user || !actor.organization || !actor.project)) {
    throw new Error('capacity actor session missing required identity/context');
  }
  if (new Set(cfg.actors.map(actor => actor.user)).size !== cfg.vus || new Set(cfg.actors.map(actor => actor.token)).size !== cfg.vus) {
    throw new Error('capacity VUs must not share accounts or sessions');
  }
  return cfg;
}

function params(actor, operation) {
  return {
    timeout: '5s',
    redirects: 0,
    tags: { operation },
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${actor.token}`,
      ...(cfg.platform === 'supabase' ? { apikey: cfg.anon, Prefer: 'return=representation' } : { 'CSRF-Token': actor.csrf ?? '' }),
    },
  };
}

function request(method, url, body, actor, operation) {
  let response;
  try {
    const requestParams = params(actor, operation);
    response = method === 'GET'
      ? http.get(url, requestParams)
      : http.post(url, JSON.stringify(body), requestParams);
  } catch (_) {
    httpFailure.add(true, { operation });
    return null;
  }
  if (typeof response.timings?.duration === 'number' && Number.isFinite(response.timings.duration)) {
    operationDuration[operation].add(response.timings.duration);
  }
  const expected = operation === 'create' ? response.status === 200 || response.status === 201 : response.status === 200;
  httpFailure.add(!expected, { operation });
  return response;
}

function safeJson(response, key) {
  try { return key ? response.json(key) : response.json(); } catch (_) { return null; }
}

function validList(records, actor) {
  return Array.isArray(records) && records.length > 0 && records.length <= 20 &&
    records.every(row => row.organization_id === actor.organization && row.project_id === actor.project);
}

function sameTask(row, payload) {
  return row && Object.entries(payload).every(([key, value]) =>
    key === 'created_at' || key === 'updated_at'
      ? Date.parse(row[key]) === Date.parse(value)
      : row[key] === value
  );
}

export default function (data) {
  const actor = data.actors[__VU - 1];
  try {
    const pg = data.platform === 'supabase';
    const listPath = pg
      ? `/rest/v1/tasks?organization_id=eq.${encodeURIComponent(actor.organization)}&project_id=eq.${encodeURIComponent(actor.project)}&order=created_at.asc,id.asc&limit=20`
      : `/api/records/v1/tasks?filter[organization_id]=${encodeURIComponent(actor.organization)}&filter[project_id]=${encodeURIComponent(actor.project)}&order=created_at,external_id&limit=20`;
    const list = request('GET', data.base + listPath, null, actor, 'list');
    if (!list || list.status !== 200) return;
    const records = pg ? safeJson(list) : safeJson(list, 'records');
    if (!check(records, { 'first page is scoped to the actor tenant': rows => validList(rows, actor) }, { operation: 'list' })) return;

    const id = pg ? `${data.prefix}s${data.stage}u${__VU}i${__ITER}` : `${data.prefix}-s${data.stage}-u${__VU}-i${__ITER}`;
    const now = new Date().toISOString();
    const payload = {
      ...(pg ? { id } : { external_id: id }),
      organization_id: actor.organization,
      project_id: actor.project,
      creator_id: actor.user,
      title: `V6 capacity task ${data.stage}/${__VU}/${__ITER}`,
      description: 'Private local multi-user capacity diagnostic',
      status: 'todo',
      priority: 'medium',
      created_at: now,
      updated_at: now,
      ...(!pg ? { last_actor_id: actor.user } : {}),
    };
    const created = request('POST', data.base + (pg ? '/rest/v1/tasks' : '/api/records/v1/tasks'), payload, actor, 'create');
    if (!created || (created.status !== 200 && created.status !== 201)) return;
    const nativeId = pg ? safeJson(created)?.[0]?.id : safeJson(created, 'ids')?.[0];
    if (!check({ nativeId }, { 'create returns native task ID': value => value.nativeId !== undefined && value.nativeId !== null && (!pg || value.nativeId === id) }, { operation: 'create' })) return;

    const rereadPath = pg ? `/rest/v1/tasks?id=eq.${encodeURIComponent(nativeId)}&select=*&limit=1` : `/api/records/v1/tasks/${encodeURIComponent(nativeId)}`;
    const reread = request('GET', data.base + rereadPath, null, actor, 'reread');
    if (!reread || reread.status !== 200) return;
    const row = pg ? safeJson(reread)?.[0] : safeJson(reread);
    check(row, { 'reread matches submitted task': value => sameTask(value, payload) }, { operation: 'reread' });
  } catch (_) {
    check(false, { 'capacity iteration completed correctly': value => value === true }, { operation: 'iteration' });
  } finally {
    sleep(1);
  }
}

export function handleSummary(data) {
  return { '/work/summary.json': JSON.stringify(data, null, 2) };
}
