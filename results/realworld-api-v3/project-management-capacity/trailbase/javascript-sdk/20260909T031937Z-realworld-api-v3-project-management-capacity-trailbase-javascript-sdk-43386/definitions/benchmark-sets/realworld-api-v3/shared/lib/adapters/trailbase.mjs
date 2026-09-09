import { randomUUID } from 'node:crypto';
import { buildVirtualUserSpecs } from '../dataset.mjs';
import { measureRemoteCall } from '../measurement.mjs';

const logicalId = row => row?.external_id ?? row?.id;
const mapUser = row => ({ id: logicalId(row), email: row?.email, displayName: row?.display_name ?? row?.displayName, createdAt: row?.created_at ?? row?.createdAt, updatedAt: row?.updated_at ?? row?.updatedAt });
const mapProject = row => ({ id: logicalId(row), organizationId: row?.organization_id, name: row?.name, status: row?.status, createdAt: row?.created_at, updatedAt: row?.updated_at });
const mapTask = row => ({ id: logicalId(row), organizationId: row?.organization_id, projectId: row?.project_id, creatorId: row?.creator_id, assigneeId: row?.assignee_id ?? null, title: row?.title, description: row?.description, status: row?.status, priority: row?.priority, dueDate: row?.due_date ?? null, createdAt: row?.created_at ?? row?.createdAt, updatedAt: row?.updated_at ?? row?.updatedAt });
const mapComment = row => ({ id: logicalId(row), organizationId: row?.organization_id, projectId: row?.project_id, taskId: row?.task_id, authorId: row?.author_id, body: row?.body, createdAt: row?.created_at, updatedAt: row?.updated_at });
const mapActivity = row => ({ id: logicalId(row), organizationId: row?.organization_id, projectId: row?.project_id ?? null, actorId: row?.actor_id, action: row?.action, subjectType: row?.subject_type, subjectId: row?.subject_id, createdAt: row?.created_at });
function pageArgs(page = 0, pageSize = 20) { if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('invalid page'); return [page, pageSize]; }
function rows(value) { return Array.isArray(value) ? value : value?.records ?? value?.data ?? []; }
function filters(value) { return Object.entries(value ?? {}).map(([column, item]) => ({ column, value: String(item), ...(item === null ? { op: 'isNull' } : {}) })); }

export function createTrailBaseAdapter({ initClient, client, endpoint = process.env.TRAILBASE_URL || 'http://127.0.0.1:4000', timeoutMs = 30_000 } = {}) {
  if (!client && typeof initClient !== 'function') throw new TypeError('TrailBase client factory is required');
  async function remote(operation, signal, limit = timeoutMs) {
    return measureRemoteCall(async () => {
      let timerId;
      const timer = new Promise((_, reject) => { timerId = setTimeout(() => reject(new Error('TrailBase request timed out')), limit); });
      let onAbort;
      const cancelled = signal && new Promise((_, reject) => { onAbort = () => reject(signal.reason ?? new Error('TrailBase request aborted')); if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); });
      try { return await Promise.race(cancelled ? [operation, timer, cancelled] : [operation, timer]); }
      finally { clearTimeout(timerId); if (onAbort) signal.removeEventListener('abort', onAbort); }
    });
  }
  const makeClient = () => client ?? initClient(endpoint);
  function makeSession(tb, user, options = {}) {
    const session = { client: tb, userId: user?.id, timeoutMs: options.timeoutMs ?? timeoutMs, controller: new AbortController() };
    let externalAbort;
    if (options.signal) { externalAbort = () => session.controller.abort(options.signal.reason); if (options.signal.aborted) externalAbort(); else options.signal.addEventListener('abort', externalAbort, { once: true }); }
    const call = (fn, signal) => {
      if (session.signedOut) return Promise.reject(Object.assign(new Error('TrailBase session is signed out'), { status: 401 }));
      const controller = new AbortController();
      const abort = () => controller.abort(session.controller.signal.reason);
      const external = () => controller.abort(signal.reason);
      if (session.controller.signal.aborted) abort(); else session.controller.signal.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) external(); else signal?.addEventListener('abort', external, { once: true });
      return Promise.resolve().then(() => fn(controller.signal)).finally(() => { session.controller.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', external); });
    };
    session.cancelPending = () => session.controller.abort(new Error('TrailBase session cancelled'));
    session.close = async () => { try { await session.signOut(); } finally { session.cancelPending(); if (externalAbort) options.signal.removeEventListener('abort', externalAbort); } };
    session.getProfile = () => call(async signal => {
      const row = session.userId ? await byLogical(session, 'users', session.userId, signal) : (typeof tb.user === 'function' ? tb.user() : tb.auth?.user);
      return mapUser(row);
    });
    session.refreshSession = () => call(async signal => { if (typeof tb.refreshAuthToken === 'function') await remote(tb.refreshAuthToken({ force: true }), signal, session.timeoutMs); else if (typeof tb.auth?.refresh === 'function') await remote(tb.auth.refresh(), signal, session.timeoutMs); return session; });
    session.refresh = session.refreshSession;
    session.signOut = async () => { if (session.signedOut) return; try { await call(async signal => { if (typeof tb.logout === 'function') await remote(tb.logout(), signal, session.timeoutMs); else if (typeof tb.auth?.logout === 'function') await remote(tb.auth.logout(), signal, session.timeoutMs); }, undefined); } finally { session.signedOut = true; } };
    for (const name of ['dashboard', 'listTasks', 'getTask', 'createTask', 'updateTask', 'addComment', 'updateComment', 'searchTasks', 'updateMembershipRole', 'updateProfile']) session[name] = args => call(signal => adapter[name]({ ...args, ...(name === 'createTask' ? { creatorId: session.userId } : {}), ...(name === 'addComment' ? { authorId: session.userId } : {}), session, signal }), args?.signal);
    return session;
  }
  const adapter = {
    accessPath: 'javascript-sdk',
    deviations: ['TrailBase measured traffic uses the official JavaScript Record API and native auth endpoint; SQLite schema, migrations, and record API ACLs are administrative.'],
    virtualUsers(count = 10_000, seed = 42) { return buildVirtualUserSpecs(count, seed); },
    correctnessFixture() { const specs = buildVirtualUserSpecs(3_201, 42); const owner = specs[0], outsider = specs[1], admin = specs[1_600], member = specs[3_200]; return { organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId, owner: owner.credentials, member: { ...member.credentials, organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId }, admin: { ...admin.credentials, organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId }, outsider: outsider.credentials, memberMembershipId: 'memv3' + (3_200).toString(36).padStart(11, '0'), adminMembershipId: 'memv3' + (1_600).toString(36).padStart(11, '0'), ownerMembershipId: 'memv3' + '00000000000', memberUserId: member.credentials.email.match(/user-(usrv3[0-9a-z]+)/)?.[1] }; },
    async createSession(credentials, options = {}) {
      const tb = makeClient();
      let user;
      if (typeof tb.login === 'function') { await remote(tb.login(credentials.email, credentials.password), options.signal, options.timeoutMs ?? timeoutMs); user = typeof tb.user === 'function' ? tb.user() : undefined; const matched = await remote(tb.records('users').list({ pagination: { limit: 1 }, filters: [{ column: 'email', value: credentials.email }] }), options.signal, options.timeoutMs ?? timeoutMs); user = { ...user, id: logicalId(rows(matched)[0]) ?? user?.id }; }
      else if (typeof tb.auth?.login === 'function') { const result = await remote(tb.auth.login(credentials), options.signal, options.timeoutMs ?? timeoutMs); user = result?.user ?? result?.record ?? tb.auth.user; }
      else if (typeof tb.auth?.signIn === 'function') { const result = await remote(tb.auth.signIn(credentials), options.signal, options.timeoutMs ?? timeoutMs); user = result?.user ?? result?.record ?? tb.auth.user; }
      else throw new Error('TrailBase client has no login method');
      return makeSession(tb, user, options);
    },
  };
  const list = (session, name, options, signal) => remote(session.client.records(name).list(options), signal, session.timeoutMs);
  const byLogical = async (session, name, id, signal) => { if (typeof id === 'number') return remote(session.client.records(name).read(id), signal, session.timeoutMs); const result = await list(session, name, { pagination: { limit: 1 }, filters: [{ column: 'external_id', value: String(id) }] }, signal); const row = rows(result)[0]; if (!row) throw Object.assign(new Error(`TrailBase record not found: ${name}/${id}`), { status: 403 }); return row; };
  const createRow = async (session, name, data, signal) => { const payload = data.external_id ? data : { external_id: `wrv3-${randomUUID()}`, ...data }; const id = await remote(session.client.records(name).create(payload), signal, session.timeoutMs); return remote(session.client.records(name).read(id?.id ?? id), signal, session.timeoutMs); };
  const updateRow = async (session, name, id, data, signal) => { const row = await byLogical(session, name, id, signal); await remote(session.client.records(name).update(row.id, data), signal, session.timeoutMs); return remote(session.client.records(name).read(row.id), signal, session.timeoutMs); };
  adapter.dashboard = async ({ organizationId, projectId, activityPage = { page: 0, pageSize: 20 }, session, signal }) => { const [org, projects, activities] = await Promise.all([byLogical(session, 'organizations', organizationId, signal), list(session, 'projects', { pagination: { limit: 100 }, filters: filters({ organization_id: organizationId }), order: ['created_at', 'id'] }, signal), list(session, 'activities', { pagination: { limit: activityPage.pageSize, offset: activityPage.page * activityPage.pageSize }, filters: filters({ organization_id: organizationId, project_id: projectId }), order: ['-created_at', '-id'] }, signal)]); return { organization: { id: logicalId(org), name: org.name, ownerId: org.owner_id, createdAt: org.created_at }, projects: rows(projects).map(mapProject), recentActivity: rows(activities).map(mapActivity) }; };
  adapter.listTasks = async ({ organizationId, projectId, status, assigneeId, page = 0, pageSize = 20, session, signal }) => { const [p, size] = pageArgs(page, pageSize); const result = await list(session, 'tasks', { pagination: { limit: size, offset: p * size }, filters: filters({ organization_id: organizationId, project_id: projectId, ...(status ? { status } : {}), ...(assigneeId ? { assignee_id: assigneeId } : {}) }), order: ['created_at', 'id'], count: true }, signal); const items = rows(result); const total = result?.total_count ?? result?.totalCount ?? items.length; return { items: items.map(mapTask), page: p, pageSize: size, total, hasNext: total > (p + 1) * size }; };
  adapter.getTask = async ({ organizationId, projectId, taskId, comments: commentPage = {}, session, signal }) => { const row = await byLogical(session, 'tasks', taskId, signal); if (row.organization_id !== organizationId || row.project_id !== projectId) throw Object.assign(new Error('TrailBase tenant boundary violation'), { status: 403 }); const comments = await adapter.listComments({ organizationId, projectId, taskId, page: commentPage.page ?? 0, pageSize: commentPage.pageSize ?? 20, session, signal }); const [creator, assignee] = await Promise.all([byLogical(session, 'users', row.creator_id, signal), row.assignee_id ? byLogical(session, 'users', row.assignee_id, signal) : null]); return { task: mapTask(row), creator: mapUser(creator), assignee: assignee ? mapUser(assignee) : null, comments }; };
  adapter.listComments = async ({ organizationId, projectId, taskId, page = 0, pageSize = 20, session, signal }) => { const [p, size] = pageArgs(page, pageSize); const result = await list(session, 'comments', { pagination: { limit: size, offset: p * size }, filters: filters({ organization_id: organizationId, project_id: projectId, task_id: taskId }), order: ['created_at', 'id'], count: true }, signal); const items = rows(result); const total = result?.total_count ?? result?.totalCount ?? items.length; return { items: items.map(mapComment), page: p, pageSize: size, total, hasNext: total > (p + 1) * size }; };
  adapter.createTask = async ({ organizationId, projectId, title, description, priority = 'medium', session, signal }) => { const now = new Date().toISOString(); return mapTask(await createRow(session, 'tasks', { organization_id: organizationId, project_id: projectId, creator_id: session.userId, title, description, priority, status: 'todo', due_date: null, created_at: now, updated_at: now }, signal)); };
  adapter.updateTask = async ({ taskId, session, signal, ...changes }) => mapTask(await updateRow(session, 'tasks', taskId, changes, signal));
  adapter.addComment = async ({ organizationId, projectId, taskId, body, session, signal }) => { const now = new Date().toISOString(); return mapComment(await createRow(session, 'comments', { organization_id: organizationId, project_id: projectId, task_id: taskId, author_id: session.userId, body, created_at: now, updated_at: now }, signal)); };
  adapter.updateComment = async ({ commentId, body, session, signal }) => mapComment(await updateRow(session, 'comments', commentId, { body }, signal));
  adapter.searchTasks = async ({ organizationId, projectId, query, page = 0, pageSize = 20, session, signal }) => { const [p, size] = pageArgs(page, pageSize); const result = await list(session, 'tasks', { pagination: { limit: size, offset: p * size }, filters: filters({ organization_id: organizationId, project_id: projectId, title: query }), order: ['created_at', 'id'], count: true }, signal); const items = rows(result); const total = result?.total_count ?? result?.totalCount ?? items.length; return { items: items.map(mapTask), page: p, pageSize: size, total, hasNext: total > (p + 1) * size }; };
  adapter.updateMembershipRole = async ({ organizationId, membershipId, role, session, signal }) => { const row = await byLogical(session, 'memberships', membershipId, signal); if (row.organization_id !== organizationId) throw Object.assign(new Error('TrailBase tenant boundary violation'), { status: 403 }); await remote(session.client.records('memberships').update(row.id, { role }), signal, session.timeoutMs); return { id: logicalId(row), organizationId: row.organization_id, userId: row.user_id, role, createdAt: row.created_at }; };
  adapter.updateProfile = async ({ displayName, session, signal }) => mapUser(await updateRow(session, 'users', session.userId, { display_name: displayName }, signal));
  return adapter;
}
let defaultAdapter;
async function getDefault() { if (!defaultAdapter) { const { initClient } = await import('trailbase'); defaultAdapter = createTrailBaseAdapter({ initClient }); } return defaultAdapter; }
export async function createSession(credentials, options) { return (await getDefault()).createSession(credentials, options); }
export function createBackend(options = {}) { return options.client || options.initClient ? createTrailBaseAdapter(options) : getDefault(); }
