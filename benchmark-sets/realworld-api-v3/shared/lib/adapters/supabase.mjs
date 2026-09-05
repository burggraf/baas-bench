import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { measureRemoteCall } from '../measurement.mjs';
async function readKey(path, name) { const text = await readFile(path, 'utf8'); const line = text.split(/\\r?\\n/).find(value => value.startsWith(`${name}=`)); if (!line) throw new Error(`missing ${name}`); return line.slice(name.length + 1); }

// Verified @supabase/supabase-js API (pinned runtime): createClient(url, key, options),
// client.auth.signInWithPassword({email,password}), refreshSession(), signOut(),
// getUser(), and PostgREST builders with select/eq/order/range/single/insert/update.
const taskFields = 'id,organization_id,project_id,creator_id,assignee_id,title,description,status,priority,due_date,created_at,updated_at';
const userFields = 'id,email,display_name,created_at,updated_at';
const commentFields = 'id,organization_id,project_id,task_id,author_id,body,created_at,updated_at';
const activityFields = 'id,organization_id,project_id,actor_id,action,subject_type,subject_id,created_at';
const mapUser = row => ({ id: row.id, email: row.email, displayName: row.display_name ?? row.user_metadata?.display_name, createdAt: row.created_at, updatedAt: row.updated_at });
const mapTask = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id, creatorId: row.creator_id, assigneeId: row.assignee_id ?? null, title: row.title, description: row.description, status: row.status, priority: row.priority, dueDate: row.due_date ?? null, createdAt: row.created_at, updatedAt: row.updated_at });
const mapComment = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id, authorId: row.author_id, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at });
const mapActivity = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id ?? null, actorId: row.actor_id, action: row.action, subjectType: row.subject_type, subjectId: row.subject_id, createdAt: row.created_at });
function ensure(error) { if (error) throw new Error(error.message || 'Supabase request failed'); }
function pageArgs(value) { const page = value.page ?? 0; const pageSize = value.pageSize ?? 20; if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('invalid page'); return [page, pageSize]; }
function checkTenant(row, organizationId, projectId) { if (!row || row.organization_id !== organizationId || (projectId && row.project_id !== projectId)) throw new Error('Supabase tenant boundary violation'); }

export function createSupabaseAdapter({ client, sdkCreateClient, url, key, timeoutMs = 30_000 } = {}) {
  async function request(action, signal) {
    return measureRemoteCall(async () => {
      if (signal && typeof action?.abortSignal === 'function') action.abortSignal(signal);
      let timer;
      const pending = Promise.resolve(action);
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Supabase request timed out')), timeoutMs); });
      const cancelled = signal && new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason ?? new Error('Supabase request aborted'));
        else signal.addEventListener('abort', () => reject(signal.reason ?? new Error('Supabase request aborted')), { once: true });
      });
      try {
        const result = await Promise.race(cancelled ? [pending, timeout, cancelled] : [pending, timeout]);
        ensure(result?.error);
        return result;
      } finally { clearTimeout(timer); }
    });
  }
  async function query(table, fields, configure, signal) { const builder = configure((client ?? {}).from(table).select(fields)); return request(builder, signal); }
  function makeSession(authClient) {
    const session = { cancelPending() { if (session.controller) session.controller.abort(); }, close() { session.cancelPending(); },
      async refresh() { const result = await request(authClient.auth.refreshSession(), session.signal); ensure(result.data?.session); return result.data.session; },
      async signOut() { await request(authClient.auth.signOut(), session.signal); },
      async getProfile() { const result = await request(authClient.auth.getUser(), session.signal); const user = result.data?.user; if (!user) throw new Error('malformed Supabase user'); return mapUser(user); },
    }; session.controller = new AbortController(); Object.defineProperty(session, 'signal', { get: () => session.controller.signal });
    return session;
  }
  async function createSession(credentials) {
    const authClient = client ?? { auth: {} };
    const result = await request(authClient.auth.signInWithPassword(credentials));
    if (!result.data?.session) throw new Error('malformed Supabase session');
    const session = makeSession(authClient); session.accessToken = result.data.session.access_token; return session;
  }
  const adapter = { createSession };
  adapter.dashboard = async ({ organizationId, projectId, activityPage = { page: 0, pageSize: 20 }, signal }) => {
    if (!organizationId) throw new Error('tenant context is required');
    const [orgResult, projectResult, activityResult] = await Promise.all([
      query('organizations', 'id,name,owner_id,created_at', q => q.eq('id', organizationId).single(), signal),
      query('projects', 'id,organization_id,name,status,created_at,updated_at', q => q.eq('organization_id', organizationId).order('created_at', { ascending: true }), signal),
      query('activities', activityFields, q => q.eq('organization_id', organizationId).eq('project_id', projectId).order('created_at', { ascending: false }).range(activityPage.page * activityPage.pageSize, activityPage.page * activityPage.pageSize + activityPage.pageSize - 1), signal),
    ]);
    if (!orgResult.data?.id || orgResult.data.id !== organizationId) throw new Error('malformed Supabase organization response');
    const projects = (projectResult.data ?? []).map(row => { checkTenant(row, organizationId); return { id: row.id, organizationId: row.organization_id, name: row.name, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; });
    const activities = (activityResult.data ?? []).map(row => { checkTenant(row, organizationId, projectId); return mapActivity(row); });
    return { organization: { id: orgResult.data.id, name: orgResult.data.name, ownerId: orgResult.data.owner_id, createdAt: orgResult.data.created_at }, projects, recentActivity: activities };
  };
  adapter.listTasks = async ({ organizationId, projectId, page = 0, pageSize = 20, signal }) => {
    if (!organizationId || !projectId) throw new Error('tenant context is required'); const [p, size] = pageArgs({ page, pageSize });
    const result = await query('tasks', taskFields, q => q.eq('organization_id', organizationId).eq('project_id', projectId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(p * size, p * size + size - 1), signal);
    const rows = result.data ?? []; if (!Array.isArray(rows)) throw new Error('malformed Supabase task response'); rows.forEach(row => checkTenant(row, organizationId, projectId));
    return { items: rows.map(mapTask), page: p, pageSize: size, total: result.count ?? rows.length, hasNext: (result.count ?? rows.length) > (p + 1) * size };
  };
  adapter.getTask = async ({ organizationId, projectId, taskId, signal }) => { const result = await query('tasks', taskFields, q => q.eq('id', taskId).eq('organization_id', organizationId).eq('project_id', projectId).single(), signal); checkTenant(result.data, organizationId, projectId); const comments = await adapter.listComments({ organizationId, projectId, taskId, page: 0, pageSize: 20, signal }); return { task: mapTask(result.data), creator: await adapter.getUser(result.data.creator_id, signal), assignee: result.data.assignee_id ? await adapter.getUser(result.data.assignee_id, signal) : null, comments }; };
  adapter.listComments = async ({ organizationId, projectId, taskId, page = 0, pageSize = 20, signal }) => { const [p, size] = pageArgs({ page, pageSize }); const result = await query('comments', commentFields, q => q.eq('organization_id', organizationId).eq('project_id', projectId).eq('task_id', taskId).order('created_at', { ascending: true }).order('id', { ascending: true }).range(p * size, p * size + size - 1), signal); const rows = result.data ?? []; rows.forEach(row => checkTenant(row, organizationId, projectId)); return { items: rows.map(mapComment), page: p, pageSize: size, total: result.count ?? rows.length, hasNext: (result.count ?? rows.length) > (p + 1) * size }; };
  adapter.getUser = async (id, signal) => { const result = await query('users', userFields, q => q.eq('id', id).single(), signal); if (!result.data?.id) throw new Error('malformed Supabase user response'); return mapUser(result.data); };
  adapter.searchTasks = async ({ organizationId, projectId, query: term, page = 0, pageSize = 20, signal }) => { const [p, size] = pageArgs({ page, pageSize }); const result = await query('tasks', taskFields, q => q.eq('organization_id', organizationId).eq('project_id', projectId).ilike('title', `%${String(term ?? '').replaceAll('%', '\\%')}%`).order('created_at', { ascending: true }).order('id', { ascending: true }).range(p * size, p * size + size - 1), signal); const rows = result.data ?? []; rows.forEach(row => checkTenant(row, organizationId, projectId)); return { items: rows.map(mapTask), page: p, pageSize: size, total: result.count ?? rows.length, hasNext: (result.count ?? rows.length) > (p + 1) * size }; };
  adapter.createTask = async ({ organizationId, projectId, title, description, priority = 'medium', signal }) => { const result = await request(client.from('tasks').insert({ organization_id: organizationId, project_id: projectId, title, description, priority }).select(taskFields).single(), signal); checkTenant(result.data, organizationId, projectId); return mapTask(result.data); };
  adapter.updateTask = async ({ organizationId, projectId, taskId, signal, ...changes }) => { const result = await request(client.from('tasks').update(Object.fromEntries(Object.entries(changes).filter(([k]) => ['title', 'description', 'status', 'priority', 'due_date'].includes(k)))).eq('id', taskId).eq('organization_id', organizationId).eq('project_id', projectId).select(taskFields).single(), signal); checkTenant(result.data, organizationId, projectId); return mapTask(result.data); };
  adapter.addComment = async ({ organizationId, projectId, taskId, body, signal }) => { const result = await request(client.from('comments').insert({ organization_id: organizationId, project_id: projectId, task_id: taskId, body }).select(commentFields).single(), signal); checkTenant(result.data, organizationId, projectId); return mapComment(result.data); };
  adapter.updateProfile = async ({ displayName }) => { const result = await request(client.auth.updateUser({ data: { display_name: displayName } })); return mapUser(result.data?.user); };
  adapter.signOut = async () => { if (client) await request(client.auth.signOut()); };
  adapter.getProfile = async () => makeSession(client).getProfile();
  return adapter;
}
let defaultAdapter;
async function getDefaultAdapter() { if (!defaultAdapter) { const [{ createClient }, key] = await Promise.all([import('@supabase/supabase-js'), readKey(join(process.env.BAAS_BENCH_RUNTIME || join(process.env.BAAS_BENCH_ROOT || '.', '.runtime'), 'supabase/docker/.env'), 'SUPABASE_PUBLISHABLE_KEY')]); const url = process.env.SUPABASE_URL || 'http://127.0.0.1:8000'; defaultAdapter = createSupabaseAdapter({ client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) }); } return defaultAdapter; }
export async function createSession(credentials) { return (await getDefaultAdapter()).createSession(credentials); }
export function createBackend(options = {}) { return options.client ? createSupabaseAdapter(options) : getDefaultAdapter(); }
