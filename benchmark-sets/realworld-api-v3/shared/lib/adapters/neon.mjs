import { readFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { measureRemoteCall } from '../measurement.mjs';
import { buildVirtualUserSpecs } from '../dataset.mjs';

export async function readKey(path, name) {
  const text = await readFile(path, 'utf8');
  const line = text.split(/\r?\n/).find(value => value.startsWith(`${name}=`));
  if (!line) throw new Error(`missing ${name}`);
  return line.slice(name.length + 1).replace(/^['"]|['"]$/g, '');
}

const taskFields = 'id,organization_id,project_id,creator_id,assignee_id,title,description,status,priority,due_date,created_at,updated_at';
const userFields = 'id,email,display_name,created_at,updated_at';
const commentFields = 'id,organization_id,project_id,task_id,author_id,body,created_at,updated_at';
const activityFields = 'id,organization_id,project_id,actor_id,action,subject_type,subject_id,created_at';
const mapUser = row => ({ id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at, updatedAt: row.updated_at });
const mapTask = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id, creatorId: row.creator_id, assigneeId: row.assignee_id ?? null, title: row.title, description: row.description, status: row.status, priority: row.priority, dueDate: row.due_date ?? null, createdAt: row.created_at, updatedAt: row.updated_at });
const mapComment = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id, authorId: row.author_id, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at });
const mapActivity = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id ?? null, actorId: row.actor_id, action: row.action, subjectType: row.subject_type, subjectId: row.subject_id, createdAt: row.created_at });
const rowsOf = result => Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
const one = result => rowsOf(result)[0];
function pageArgs(page = 0, pageSize = 20) {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('invalid page');
  return [page, pageSize];
}
function tenant(row, organizationId, projectId) {
  if (!row || row.organization_id !== organizationId || (projectId && row.project_id !== projectId)) throw new Error('Neon tenant boundary violation');
}
export function createTlsFetch(ca) {
  if (typeof ca !== 'string' || ca.length === 0) throw new TypeError('Neon proxy CA is required');
  return (input, init = {}) => new Promise((resolve, reject) => {
    const url = typeof input === 'string' ? new URL(input) : input;
    const headers = init.headers && typeof init.headers[Symbol.iterator] === 'function' ? Object.fromEntries(init.headers) : init.headers;
    const request = httpsRequest(url, { method: init.method ?? 'GET', headers, ca, signal: init.signal }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, statusText: response.statusMessage, headers: response.headers })));
    });
    request.on('error', reject);
    if (init.body !== undefined && init.body !== null) request.write(init.body);
    request.end();
  });
}

function tagged(sql, text, params = []) {
  const strings = [];
  const values = [];
  let cursor = 0;
  for (const match of text.matchAll(/\$(\d+)/g)) {
    strings.push(text.slice(cursor, match.index));
    values.push(params[Number(match[1]) - 1]);
    cursor = match.index + match[0].length;
  }
  strings.push(text.slice(cursor));
  return sql(strings, ...values);
}

export function createNeonAdapter({ sql, timeoutMs = 30_000 } = {}) {
  if (typeof sql !== 'function' || typeof sql.query !== 'function') throw new TypeError('Neon SQL transport is required');

  async function request(operation, signal, requestTimeoutMs = timeoutMs) {
    return measureRemoteCall(async () => {
      const controller = new AbortController();
      let onAbort;
      if (signal) {
        onAbort = () => controller.abort(signal.reason ?? new Error('Neon request aborted'));
        if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      }
      let timedOut = false;
      let timer;
      const timeout = requestTimeoutMs === undefined ? null : new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Neon request timed out')); reject(new Error('Neon request timed out')); }, requestTimeoutMs);
      });
      try {
        const pending = operation(controller.signal);
        return await (timeout ? Promise.race([pending, timeout]) : pending);
      } catch (error) {
        if (timedOut || (controller.signal.aborted && !signal?.aborted)) throw new Error('Neon request timed out');
        if (signal?.aborted) throw signal.reason ?? new Error('Neon request aborted');
        throw error;
      } finally {
        clearTimeout(timer);
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    });
  }
  async function raw(text, params, signal, requestTimeoutMs) {
    return request(async requestSignal => rowsOf(await sql.query(text, params, { fetchOptions: { signal: requestSignal } })), signal, requestTimeoutMs);
  }
  async function sessionQuery(token, text, params, signal, requestTimeoutMs) {
    return request(async requestSignal => {
      if (typeof sql.transaction !== 'function') throw new Error('Neon transaction API is required for authenticated requests');
      const results = await sql.transaction([
        tagged(sql, 'SELECT benchmark_auth.validate_session($1) AS user_id', [token]),
        tagged(sql, text, params),
      ], { fetchOptions: { signal: requestSignal } });
      return rowsOf(results?.[1]);
    }, signal, requestTimeoutMs);
  }
  async function sessionOne(token, text, params, signal) { return one(await sessionQuery(token, text, params, signal)); }
  async function sessionRows(session, text, params = {}, signal) { return sessionQuery(session.accessToken, text, params, signal, session.timeoutMs); }

  function makeSession(token, options = {}) {
    const session = { accessToken: token, timeoutMs: options.timeoutMs ?? timeoutMs, controller: new AbortController() };
    let externalAbort;
    if (options.signal) {
      externalAbort = () => session.controller.abort(options.signal.reason);
      if (options.signal.aborted) externalAbort(); else options.signal.addEventListener('abort', externalAbort, { once: true });
    }
    const call = (fn, signal) => {
      const controller = new AbortController();
      const forward = () => controller.abort(session.controller.signal.reason);
      const forwardExternal = () => controller.abort(signal.reason);
      if (session.controller.signal.aborted) forward(); else session.controller.signal.addEventListener('abort', forward, { once: true });
      if (signal?.aborted) forwardExternal(); else signal?.addEventListener('abort', forwardExternal, { once: true });
      return Promise.resolve().then(() => fn(controller.signal)).finally(() => {
        session.controller.signal.removeEventListener('abort', forward);
        signal?.removeEventListener('abort', forwardExternal);
      });
    };
    session.cancelPending = () => session.controller.abort(new Error('Neon session cancelled'));
    session.close = async () => {
      try { await session.signOut(); } finally { session.cancelPending(); if (externalAbort) options.signal.removeEventListener('abort', externalAbort); }
    };
    session.refreshSession = () => call(async signal => { await raw('SELECT benchmark_auth.validate_session($1)', [session.accessToken], signal, session.timeoutMs); return session; }, undefined);
    session.refresh = session.refreshSession;
    session.signOut = () => call(async signal => { await raw('SELECT benchmark_auth.sign_out($1)', [session.accessToken], signal, session.timeoutMs); }, undefined);
    session.getProfile = () => call(async signal => mapUser(await sessionOne(session.accessToken, `SELECT ${userFields} FROM public.users WHERE id = benchmark_private.current_user_id()`, [], signal)), undefined);
    const methods = ['dashboard', 'listTasks', 'getTask', 'createTask', 'updateTask', 'addComment', 'updateComment', 'searchTasks', 'updateMembershipRole', 'updateProfile'];
    for (const name of methods) session[name] = args => call(signal => adapter[name]({ ...args, ...(name === 'createTask' ? { creatorId: session.userId } : {}), ...(name === 'addComment' ? { authorId: session.userId } : {}), signal, session }), args?.signal);
    return session;
  }

  const adapter = {
    accessPath: 'sql-over-http',
    deviations: ['Neon uses application-owned PostgreSQL authentication and tenant authorization functions rather than a native BaaS API.'],
    virtualUsers(count = 10_000, seed = 42) { return buildVirtualUserSpecs(count, seed); },
    correctnessFixture() {
      const specs = buildVirtualUserSpecs(3_201, 42);
      const owner = specs[0], outsider = specs[1], admin = specs[1_600], member = specs[3_200];
      return { organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId,
        owner: owner.credentials, member: { ...member.credentials, organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId },
        admin: { ...admin.credentials, organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId }, outsider: outsider.credentials,
        memberMembershipId: 'memv3' + (3_200).toString(36).padStart(11, '0'), adminMembershipId: 'memv3' + (1_600).toString(36).padStart(11, '0'), ownerMembershipId: 'memv3' + '00000000000', memberUserId: member.credentials.email.match(/user-(usrv3[0-9a-z]+)/)?.[1] };
    },
    async createSession(credentials, options = {}) {
      const rows = await raw('SELECT benchmark_auth.sign_in($1, $2) AS token', [credentials?.email, credentials?.password], options.signal, options.timeoutMs ?? timeoutMs);
      const token = one(rows)?.token;
      if (typeof token !== 'string' || token.length < 16) throw new Error('malformed Neon session');
      const session = makeSession(token, options);
      const identity = one(await raw('SELECT benchmark_auth.validate_session($1) AS user_id', [token], options.signal, options.timeoutMs ?? timeoutMs));
      session.userId = identity?.user_id;
      if (typeof session.userId !== 'string' || session.userId.length === 0) throw new Error('malformed Neon identity');
      return session;
    },
  };
  adapter.dashboard = async ({ organizationId, projectId, activityPage = { page: 0, pageSize: 20 }, session, signal }) => {
    if (!organizationId || !session) throw new Error('tenant context is required');
    const [page, size] = pageArgs(activityPage.page, activityPage.pageSize);
    const [org, projects, activities] = await Promise.all([
      sessionOne(session.accessToken, 'SELECT id,name,owner_id,created_at FROM public.organizations WHERE id = $1', [organizationId], signal),
      sessionRows(session, 'SELECT id,organization_id,name,status,created_at,updated_at FROM public.projects WHERE organization_id = $1 ORDER BY created_at,id', [organizationId], signal),
      sessionRows(session, 'SELECT ' + activityFields + ' FROM public.activities WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4', [organizationId, projectId, size, page * size], signal),
    ]);
    if (!org || org.id !== organizationId) throw new Error('malformed Neon organization response');
    projects.forEach(row => tenant(row, organizationId)); activities.forEach(row => tenant(row, organizationId, projectId));
    return { organization: { id: org.id, name: org.name, ownerId: org.owner_id, createdAt: org.created_at }, projects: projects.map(row => ({ id: row.id, organizationId: row.organization_id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })), recentActivity: activities.map(mapActivity) };
  };
  adapter.listTasks = async ({ organizationId, projectId, status, assigneeId, page = 0, pageSize = 20, session, signal }) => {
    const [p, size] = pageArgs(page, pageSize); if (!organizationId || !projectId || !session) throw new Error('tenant context is required');
    const params = [organizationId, projectId]; let where = 'organization_id = $1 AND project_id = $2';
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    if (assigneeId === null) where += ' AND assignee_id IS NULL'; else if (assigneeId) { params.push(assigneeId); where += ` AND assignee_id = $${params.length}`; }
    params.push(size, p * size);
    const rows = await sessionRows(session, `SELECT ${taskFields}, count(*) OVER() AS total_count FROM public.tasks WHERE ${where} ORDER BY created_at,id LIMIT $${params.length - 1} OFFSET $${params.length}`, params, signal);
    rows.forEach(row => tenant(row, organizationId, projectId)); const total = Number(rows[0]?.total_count ?? 0);
    return { items: rows.map(mapTask), page: p, pageSize: size, total, hasNext: total > (p + 1) * size };
  };
  adapter.getTask = async ({ organizationId, projectId, taskId, session, signal }) => {
    const row = await sessionOne(session.accessToken, `SELECT ${taskFields} FROM public.tasks WHERE id = $1 AND organization_id = $2 AND project_id = $3`, [taskId, organizationId, projectId], signal); tenant(row, organizationId, projectId);
    const [creator, assignee, comments] = await Promise.all([
      sessionOne(session.accessToken, `SELECT ${userFields} FROM public.users WHERE id = $1`, [row.creator_id], signal),
      row.assignee_id ? sessionOne(session.accessToken, `SELECT ${userFields} FROM public.users WHERE id = $1`, [row.assignee_id], signal) : null,
      adapter.listComments({ organizationId, projectId, taskId, page: 0, pageSize: 20, session, signal }),
    ]);
    return { task: mapTask(row), creator: mapUser(creator), assignee: assignee ? mapUser(assignee) : null, comments };
  };
  adapter.listComments = async ({ organizationId, projectId, taskId, page = 0, pageSize = 20, session, signal }) => {
    const [p, size] = pageArgs(page, pageSize); const rows = await sessionRows(session, `SELECT ${commentFields}, count(*) OVER() AS total_count FROM public.comments WHERE organization_id = $1 AND project_id = $2 AND task_id = $3 ORDER BY created_at,id LIMIT $4 OFFSET $5`, [organizationId, projectId, taskId, size, p * size], signal); rows.forEach(row => tenant(row, organizationId, projectId)); const total = Number(rows[0]?.total_count ?? 0); return { items: rows.map(mapComment), page: p, pageSize: size, total, hasNext: total > (p + 1) * size };
  };
  adapter.searchTasks = async ({ organizationId, projectId, query: term, page = 0, pageSize = 20, session, signal }) => {
    const [p, size] = pageArgs(page, pageSize); const rows = await sessionRows(session, `SELECT ${taskFields}, count(*) OVER() AS total_count FROM public.tasks WHERE organization_id = $1 AND project_id = $2 AND title ILIKE $3 ORDER BY created_at,id LIMIT $4 OFFSET $5`, [organizationId, projectId, `%${String(term ?? '').replaceAll('%', '\\%')}%`, size, p * size], signal); rows.forEach(row => tenant(row, organizationId, projectId)); const total = Number(rows[0]?.total_count ?? 0); return { items: rows.map(mapTask), page: p, pageSize: size, total, hasNext: total > (p + 1) * size };
  };
  adapter.createTask = async ({ organizationId, projectId, creatorId, title, description, priority = 'medium', session, signal }) => { const row = await sessionOne(session.accessToken, `INSERT INTO public.tasks (organization_id,project_id,creator_id,title,description,priority) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${taskFields}`, [organizationId, projectId, creatorId, title, description, priority], signal); tenant(row, organizationId, projectId); return mapTask(row); };
  adapter.updateTask = async ({ organizationId, projectId, taskId, session, signal, ...changes }) => { const allowed = ['title', 'description', 'status', 'priority', 'due_date']; const values = [organizationId, projectId, taskId]; const sets = []; for (const key of allowed) if (changes[key] !== undefined) { values.push(changes[key]); sets.push(`${key} = $${values.length}`); } if (!sets.length) throw new Error('no task changes'); const row = await sessionOne(session.accessToken, `UPDATE public.tasks SET ${sets.join(',')},updated_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND id=$3 RETURNING ${taskFields}`, values, signal); tenant(row, organizationId, projectId); return mapTask(row); };
  adapter.addComment = async ({ organizationId, projectId, taskId, authorId, body, session, signal }) => { const row = await sessionOne(session.accessToken, `INSERT INTO public.comments (organization_id,project_id,task_id,author_id,body) VALUES ($1,$2,$3,$4,$5) RETURNING ${commentFields}`, [organizationId, projectId, taskId, authorId, body], signal); tenant(row, organizationId, projectId); return mapComment(row); };
  adapter.updateComment = async ({ organizationId, projectId, taskId, commentId, body, session, signal }) => { const row = await sessionOne(session.accessToken, `UPDATE public.comments SET body=$1,updated_at=clock_timestamp() WHERE id=$2 AND organization_id=$3 AND project_id=$4 AND task_id=$5 RETURNING ${commentFields}`, [body, commentId, organizationId, projectId, taskId], signal); tenant(row, organizationId, projectId); return mapComment(row); };
  adapter.updateMembershipRole = async ({ organizationId, membershipId, role, session, signal }) => { const row = await sessionOne(session.accessToken, 'UPDATE public.memberships SET role=$1 WHERE organization_id=$2 AND id=$3 RETURNING id,organization_id,user_id,role,created_at', [role, organizationId, membershipId], signal); if (!row || row.organization_id !== organizationId) throw new Error('Neon tenant boundary violation'); return row; };
  adapter.updateProfile = async ({ displayName, session, signal }) => { const row = await sessionOne(session.accessToken, `UPDATE public.users SET display_name=$1,updated_at=clock_timestamp() WHERE id=benchmark_private.current_user_id() RETURNING ${userFields}`, [displayName], signal); return mapUser(row); };
  return adapter;
}

let defaultAdapter;
async function getDefaultAdapter() {
  if (!defaultAdapter) {
    const { neon, neonConfig } = await import('@neondatabase/serverless');
    neonConfig.fetchEndpoint = 'https://localhost:4444/sql';
    const root = process.env.BAAS_BENCH_ROOT || process.cwd();
    const runtimeRoot = process.env.BAAS_RUNTIME_DIR || join(root, '.runtime');
    const caPath = process.env.NEON_PROXY_CA || join(runtimeRoot, 'neon', 'proxy-certs', 'localhost.crt');
    try { neonConfig.fetchFunction = createTlsFetch(await readFile(caPath, 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const connectionString = process.env.NEON_DATABASE_URL || 'postgresql://cloud_admin:cloud_admin@localhost:4444/postgres?sslmode=require';
    defaultAdapter = createNeonAdapter({ sql: neon(connectionString) });
  }
  return defaultAdapter;
}
export async function createSession(credentials, options) { return (await getDefaultAdapter()).createSession(credentials, options); }
export function createBackend(options = {}) { return options.sql ? createNeonAdapter(options) : getDefaultAdapter(); }
