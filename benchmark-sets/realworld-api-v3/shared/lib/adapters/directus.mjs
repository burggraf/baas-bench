import { randomUUID } from 'node:crypto';
import { buildVirtualUserSpecs } from '../dataset.mjs';
import { measureRemoteCall } from '../measurement.mjs';

const mapMembership = row => ({ id: row.id, organizationId: row.organization_id, userId: row.user_id, role: row.role, createdAt: row.created_at });
const mapUser = row => ({
  id: row.external_identifier ?? row.id,
  email: row.email,
  displayName: row.display_name ?? row.displayName ?? row.first_name,
  createdAt: row.created_at ?? row.createdAt,
  updatedAt: row.updated_at ?? row.updatedAt,
});
const mapTask = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id, creatorId: row.creator_id, assigneeId: row.assignee_id ?? null, title: row.title, description: row.description, status: row.status, priority: row.priority, dueDate: row.due_date ?? null, createdAt: row.created_at, updatedAt: row.updated_at });
const mapComment = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id, taskId: row.task_id, authorId: row.author_id, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at });
const mapActivity = row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id ?? null, actorId: row.actor_id, action: row.action, subjectType: row.subject_type, subjectId: row.subject_id, createdAt: row.created_at });
let mutationClock = Date.now();
function mutationTime() { mutationClock = Math.max(Date.now(), mutationClock + 1); return new Date(mutationClock).toISOString(); }
const mutationId = () => randomUUID().replaceAll('-', '').slice(0, 15);
function pageArgs(page = 0, pageSize = 20) { if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('invalid page'); return [page, pageSize]; }
function resultRows(value) { return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : value?.rows ?? []; }
function resultOne(value) { const result = Array.isArray(value) ? value : value?.data ?? value; return Array.isArray(result) ? result[0] : result; }
function logicalUserId(email) { return email?.match(/^user-(usrv3[0-9a-z]{11})@example\.test$/)?.[1]; }
function forbidden(message) { const error = new Error(message); error.status = 403; return error; }
function missingRefreshToken(error) { return String(error?.errors?.[0]?.message ?? error?.message ?? '').includes('refresh token is required'); }

export function createDirectusAdapter({ createDirectus, rest, authentication, withOptions, readItems, readItem, aggregate, createItem, updateItem, readMe, client, endpoint = process.env.DIRECTUS_URL || 'http://127.0.0.1:8055', timeoutMs = 30_000 } = {}) {
  if (!client && typeof createDirectus !== 'function') throw new TypeError('Directus client factory is required');

  async function remote(operation, signal, limit = timeoutMs) {
    return measureRemoteCall(async () => {
      let timerId;
      const timer = new Promise((_, reject) => { timerId = setTimeout(() => reject(new Error('Directus request timed out')), limit); });
      let onAbort;
      const cancelled = signal && new Promise((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error('Directus request aborted'));
        if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      });
      try { return await Promise.race(cancelled ? [operation, timer, cancelled] : [operation, timer]); }
      finally { clearTimeout(timerId); if (onAbort) signal.removeEventListener('abort', onAbort); }
    });
  }

  function makeClient() {
    if (client) return client;
    let value = createDirectus(endpoint);
    if (typeof value.with === 'function' && typeof rest === 'function') value = value.with(rest());
    if (typeof value.with === 'function' && typeof authentication === 'function') value = value.with(authentication('json'));
    return value;
  }

  async function requestValue(directus, operation, signal, limit) {
    const command = signal && typeof withOptions === 'function' ? withOptions(operation, { signal }) : operation;
    return remote(directus.request ? directus.request(command) : command, signal, limit);
  }

  function makeSession(directus, options = {}, user) {
    const session = {
      client: directus,
      timeoutMs: options.timeoutMs ?? timeoutMs,
      controller: new AbortController(),
      userId: user?.external_identifier,
      directusUserId: user?.id,
      authenticated: true,
    };
    let externalAbort;
    if (options.signal) {
      externalAbort = () => session.controller.abort(options.signal.reason);
      if (options.signal.aborted) externalAbort(); else options.signal.addEventListener('abort', externalAbort, { once: true });
    }
    const call = (fn, signal) => {
      const controller = new AbortController();
      const abort = () => controller.abort(session.controller.signal.reason);
      const external = () => controller.abort(signal.reason);
      if (session.controller.signal.aborted) abort(); else session.controller.signal.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) external(); else signal?.addEventListener('abort', external, { once: true });
      return Promise.resolve().then(() => fn(controller.signal)).finally(() => {
        session.controller.signal.removeEventListener('abort', abort);
        signal?.removeEventListener('abort', external);
      });
    };
    session.cancelPending = () => session.controller.abort(new Error('Directus session cancelled'));
    session.close = async () => {
      session.authenticated = false;
      session.cancelPending();
      if (typeof directus.stopRefreshing === 'function') directus.stopRefreshing();
      if (typeof directus.setToken === 'function') await directus.setToken(null);
      if (externalAbort) options.signal.removeEventListener('abort', externalAbort);
    };
    session.getProfile = () => call(async signal => {
      if (!session.authenticated) { const error = new Error('Directus session is signed out'); error.status = 401; throw error; }
      const request = session.userId && readItems
        ? readItems('users', { filter: { id: { _eq: session.userId } }, limit: 1 })
        : (readMe ? readMe() : { kind: 'me' });
      const value = await requestValue(directus, request, signal, session.timeoutMs);
      const raw = resultOne(value);
      if (!raw) throw new Error('Directus profile not found');
      if (raw.external_identifier) { session.directusUserId = raw.id; session.userId = raw.external_identifier; }
      else if (!session.userId) session.userId = raw.id;
      return mapUser(raw);
    });
    session.refreshSession = () => call(async signal => {
      if (typeof directus.refresh === 'function') await remote(directus.refresh(), signal, session.timeoutMs);
      return session;
    });
    session.refresh = session.refreshSession;
    session.signOut = () => call(async signal => {
      try { if (typeof directus.logout === 'function') await remote(directus.logout(), signal, session.timeoutMs); }
      catch (error) { if (!missingRefreshToken(error)) throw error; }
      finally { session.authenticated = false; if (typeof directus.stopRefreshing === 'function') directus.stopRefreshing(); if (typeof directus.setToken === 'function') await directus.setToken(null); }
    }, undefined);
    for (const name of ['dashboard', 'listTasks', 'getTask', 'createTask', 'updateTask', 'addComment', 'updateComment', 'searchTasks', 'updateMembershipRole', 'updateProfile']) {
      session[name] = args => call(signal => adapter[name]({ ...args, session, signal }), args?.signal);
    }
    return session;
  }

  const adapter = {
    accessPath: 'javascript-sdk',
    deviations: ['Directus measured traffic uses the official REST SDK with native user sessions; tenant authorization is enforced by the adapter because Directus 12 Core ignores custom permission rules.'],
    virtualUsers(count = 10_000, seed = 42) { return buildVirtualUserSpecs(count, seed); },
    correctnessFixture() {
      const specs = buildVirtualUserSpecs(3_201, 42);
      const owner = specs[0], outsider = specs[1], admin = specs[1_600], member = specs[3_200];
      return { organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId, owner: owner.credentials, member: { ...member.credentials, organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId }, admin: { ...admin.credentials, organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId }, outsider: outsider.credentials, memberMembershipId: 'memv3' + (3_200).toString(36).padStart(11, '0'), adminMembershipId: 'memv3' + (1_600).toString(36).padStart(11, '0'), ownerMembershipId: 'memv3' + '00000000000', memberUserId: member.credentials.email.match(/user-(usrv3[0-9a-z]+)/)?.[1] };
    },
    async createSession(credentials, options = {}) {
      const directus = makeClient();
      let login;
      try { if (typeof directus.login === 'function') login = await remote(directus.login({ ...credentials, email: credentials.email.replace('@example.test', '@example.com') }), options.signal, options.timeoutMs ?? timeoutMs); }
      catch (error) { const code = error?.errors?.[0]?.extensions?.code; if (code === 'INVALID_CREDENTIALS' || code === 'INVALID_PAYLOAD') error.status = 401; throw error; }
      return makeSession(directus, options, { id: login?.id, external_identifier: logicalUserId(credentials.email) });
    },
  };

  const op = (session, builder, signal) => requestValue(session.client, builder, signal, session.timeoutMs);
  const read = (name, query) => readItems ? readItems(name, query) : { collection: name, query };
  function requireIdentity(session) { if (!session?.userId) throw forbidden('Directus application identity required'); }
  async function countRows(session, collection, filter, signal) {
    if (typeof aggregate !== 'function') return undefined;
    const value = await op(session, aggregate(collection, { aggregate: { count: '*' }, query: { filter } }), signal);
    const row = resultOne(value); const count = row?.count ?? row?.['count(*)'];
    return count === undefined ? undefined : Number(count);
  }
  async function membership(session, organizationId, signal) {
    requireIdentity(session);
    const value = await op(session, read('memberships', { filter: { organization_id: { _eq: organizationId }, user_id: { _eq: session.userId } }, limit: 1 }), signal);
    return resultRows(value)[0] ?? null;
  }
  async function requireMembership(session, organizationId, signal) {
    const row = await membership(session, organizationId, signal);
    if (!row) throw forbidden('Directus membership required');
    return row;
  }
  async function requireRole(session, organizationId, signal) {
    const row = await requireMembership(session, organizationId, signal);
    if (!['owner', 'admin'].includes(row.role)) throw forbidden('Directus role is not permitted');
    return row;
  }
  async function scopedItem(session, collection, id, filters, signal) {
    const value = await op(session, read(collection, { filter: { id: { _eq: id }, ...filters }, limit: 1 }), signal);
    const row = resultRows(value)[0];
    if (!row) throw forbidden(`Directus ${collection} boundary violation`);
    return row;
  }

  adapter.dashboard = async ({ organizationId, projectId, activityPage = { page: 0, pageSize: 20 }, session, signal }) => {
    await requireMembership(session, organizationId, signal);
    const [page, pageSize] = pageArgs(activityPage.page, activityPage.pageSize);
    const [org, projects, activities] = await Promise.all([
      op(session, readItem ? readItem('organizations', organizationId) : { collection: 'organizations', id: organizationId }, signal),
      op(session, read('projects', { filter: { organization_id: { _eq: organizationId } }, sort: ['created_at', 'id'] }), signal),
      op(session, read('activities', { filter: { organization_id: { _eq: organizationId }, project_id: { _eq: projectId } }, sort: ['-created_at', '-id'], limit: pageSize, offset: page * pageSize }), signal),
    ]);
    if (!org || (org.organization_id && org.organization_id !== organizationId)) throw forbidden('Directus tenant boundary violation');
    return { organization: { id: org.id, name: org.name, ownerId: org.owner_id, createdAt: org.created_at }, projects: resultRows(projects).map(row => ({ ...row, organizationId: row.organization_id })), recentActivity: resultRows(activities).map(mapActivity) };
  };
  adapter.listTasks = async ({ organizationId, projectId, status, assigneeId, page = 0, pageSize = 20, session, signal }) => {
    await requireMembership(session, organizationId, signal);
    const [p, size] = pageArgs(page, pageSize);
    const filter = { organization_id: { _eq: organizationId }, project_id: { _eq: projectId }, ...(status ? { status: { _eq: status } } : {}), ...(assigneeId === null ? { assignee_id: { _null: true } } : assigneeId ? { assignee_id: { _eq: assigneeId } } : {}) };
    const value = await op(session, read('tasks', { filter, sort: ['created_at', 'id'], limit: size, offset: p * size, meta: 'total_count' }), signal);
    const rows = resultRows(value); const total = await countRows(session, 'tasks', filter, signal) ?? value?.meta?.total_count ?? value?.total ?? rows.length;
    return { items: rows.map(mapTask), page: p, pageSize: size, total, hasNext: total > (p + 1) * size };
  };
  adapter.getTask = async ({ organizationId, projectId, taskId, comments = {}, session, signal }) => {
    await requireMembership(session, organizationId, signal);
    const row = await scopedItem(session, 'tasks', taskId, { organization_id: { _eq: organizationId }, project_id: { _eq: projectId } }, signal);
    const commentPage = await adapter.listComments({ organizationId, projectId, taskId, page: comments.page ?? 0, pageSize: comments.pageSize ?? 20, session, signal });
    const [creator, assignee] = await Promise.all([op(session, readItem ? readItem('users', row.creator_id) : { collection: 'users', id: row.creator_id }, signal), row.assignee_id ? op(session, readItem ? readItem('users', row.assignee_id) : { collection: 'users', id: row.assignee_id }, signal) : null]);
    return { task: mapTask(row), creator: mapUser(resultOne(creator)), assignee: assignee ? mapUser(resultOne(assignee)) : null, comments: commentPage };
  };
  adapter.listComments = async ({ organizationId, projectId, taskId, page = 0, pageSize = 20, session, signal }) => {
    await requireMembership(session, organizationId, signal);
    const [p, size] = pageArgs(page, pageSize);
    const value = await op(session, read('comments', { filter: { organization_id: { _eq: organizationId }, project_id: { _eq: projectId }, task_id: { _eq: taskId } }, sort: ['created_at', 'id'], limit: size, offset: p * size, meta: 'total_count' }), signal);
    const rows = resultRows(value); const total = await countRows(session, 'comments', { organization_id: { _eq: organizationId }, project_id: { _eq: projectId }, task_id: { _eq: taskId } }, signal) ?? value?.meta?.total_count ?? value?.total ?? rows.length;
    return { items: rows.map(mapComment), page: p, pageSize: size, total, hasNext: total > (p + 1) * size };
  };
  adapter.createTask = async ({ organizationId, projectId, title, description, priority = 'medium', session, signal }) => {
    await requireMembership(session, organizationId, signal);
    const value = await op(session, createItem ? createItem('tasks', { id: mutationId(), organization_id: organizationId, project_id: projectId, creator_id: session.userId, title, description, priority, status: 'todo', created_at: mutationTime(), updated_at: mutationTime() }) : { collection: 'tasks', data: { organizationId, projectId, creatorId: session.userId, title, description, priority } }, signal);
    return mapTask(resultOne(value));
  };
  adapter.updateTask = async ({ organizationId, projectId, taskId, session, signal, ...changes }) => {
    await requireMembership(session, organizationId, signal);
    await scopedItem(session, 'tasks', taskId, { organization_id: { _eq: organizationId }, project_id: { _eq: projectId } }, signal);
    return mapTask(resultOne(await op(session, updateItem ? updateItem('tasks', taskId, { ...changes, updated_at: mutationTime() }) : { collection: 'tasks', id: taskId, changes }, signal)));
  };
  adapter.addComment = async ({ organizationId, projectId, taskId, body, session, signal }) => {
    await requireMembership(session, organizationId, signal);
    await scopedItem(session, 'tasks', taskId, { organization_id: { _eq: organizationId }, project_id: { _eq: projectId } }, signal);
    return mapComment(resultOne(await op(session, createItem ? createItem('comments', { id: mutationId(), organization_id: organizationId, project_id: projectId, task_id: taskId, author_id: session.userId, body, created_at: mutationTime(), updated_at: mutationTime() }) : { collection: 'comments', data: { organizationId, projectId, taskId, authorId: session.userId, body } }, signal)));
  };
  adapter.updateComment = async ({ organizationId, projectId, taskId, commentId, body, session, signal }) => {
    await requireMembership(session, organizationId, signal);
    const row = await scopedItem(session, 'comments', commentId, { organization_id: { _eq: organizationId }, project_id: { _eq: projectId }, task_id: { _eq: taskId } }, signal);
    if (row.author_id !== session.userId) await requireRole(session, organizationId, signal);
    return mapComment(resultOne(await op(session, updateItem ? updateItem('comments', commentId, { body, updated_at: mutationTime() }) : { collection: 'comments', id: commentId, changes: { body } }, signal)));
  };
  adapter.searchTasks = async ({ organizationId, projectId, query, page = 0, pageSize = 20, session, signal }) => {
    await requireMembership(session, organizationId, signal);
    const [p, size] = pageArgs(page, pageSize);
    const value = await op(session, read('tasks', { filter: { organization_id: { _eq: organizationId }, project_id: { _eq: projectId }, title: { _contains: query } }, sort: ['created_at', 'id'], limit: size, offset: p * size, meta: 'total_count' }), signal);
    const rows = resultRows(value); const total = await countRows(session, 'tasks', { organization_id: { _eq: organizationId }, project_id: { _eq: projectId }, title: { _contains: query } }, signal) ?? value?.meta?.total_count ?? value?.total ?? rows.length;
    return { items: rows.map(mapTask), page: p, pageSize: size, total, hasNext: total > (p + 1) * size };
  };
  adapter.updateMembershipRole = async ({ organizationId, membershipId, role, session, signal }) => {
    await requireRole(session, organizationId, signal);
    await scopedItem(session, 'memberships', membershipId, { organization_id: { _eq: organizationId } }, signal);
    return mapMembership(resultOne(await op(session, updateItem ? updateItem('memberships', membershipId, { role }) : { collection: 'memberships', id: membershipId, changes: { role } }, signal)));
  };
  adapter.updateProfile = async ({ displayName, session, signal }) => {
    requireIdentity(session);
    return mapUser(resultOne(await op(session, updateItem ? updateItem('users', session.userId, { display_name: displayName }) : { collection: 'users', id: session.userId, changes: { display_name: displayName } }, signal)));
  };
  return adapter;
}

let defaultAdapter;
async function getDefault() { if (!defaultAdapter) { const sdk = await import('@directus/sdk'); defaultAdapter = createDirectusAdapter({ ...sdk }); } return defaultAdapter; }
export async function createSession(credentials, options) { return (await getDefault()).createSession(credentials, options); }
export function createBackend(options = {}) { return options.client || options.createDirectus ? createDirectusAdapter(options) : getDefault(); }
