import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildVirtualUserSpecs } from '../dataset.mjs';
import { measureRemoteCall } from '../measurement.mjs';

const iso = value => typeof value === 'number' ? new Date(value).toISOString() : value;
const mapUser = row => ({ id: row.id, email: row.email, displayName: row.displayName ?? row.display_name, createdAt: iso(row.createdAt ?? row.created_at), updatedAt: iso(row.updatedAt ?? row.updated_at) });
const mapTask = row => ({ id: row.id, organizationId: row.organizationId ?? row.organization_id, projectId: row.projectId ?? row.project_id, creatorId: row.creatorId ?? row.creator_id, assigneeId: row.assigneeId ?? row.assignee_id ?? null, title: row.title, description: row.description, status: row.status, priority: row.priority, dueDate: iso(row.dueDate ?? row.due_date ?? null), createdAt: iso(row.createdAt ?? row.created_at), updatedAt: iso(row.updatedAt ?? row.updated_at) });
const mapComment = row => ({ id: row.id, organizationId: row.organizationId ?? row.organization_id, projectId: row.projectId ?? row.project_id, taskId: row.taskId ?? row.task_id, authorId: row.authorId ?? row.author_id, body: row.body, createdAt: iso(row.createdAt ?? row.created_at), updatedAt: iso(row.updatedAt ?? row.updated_at) });
const mapActivity = row => ({ id: row.id, organizationId: row.organizationId ?? row.organization_id, projectId: row.projectId ?? row.project_id ?? null, actorId: row.actorId ?? row.actor_id, action: row.action, subjectType: row.subjectType ?? row.subject_type, subjectId: row.subjectId ?? row.subject_id, createdAt: iso(row.createdAt ?? row.created_at) });
const mapMembership = row => ({ ...row, createdAt: iso(row.createdAt ?? row.created_at) });
function page(value) { const p = value.page ?? 0, size = value.pageSize ?? 20; if (!Number.isSafeInteger(p) || p < 0 || !Number.isSafeInteger(size) || size < 1 || size > 100) throw new Error('invalid page'); return [p, size]; }
function ref(api, path) { return path.split('.').reduce((value, key) => value?.[key], api); }

export function createConvexAdapter({ ConvexHttpClient, api, address = process.env.CONVEX_URL || 'http://127.0.0.1:3210', timeoutMs = 30_000, users = [], jwtPrivateKey } = {}) {
  if (typeof ConvexHttpClient !== 'function' || !api) throw new TypeError('Convex client and API are required');
  async function remote(client, method, target, args, signal, limit = timeoutMs) {
    return measureRemoteCall(async () => {
      const controller = new AbortController();
      const forward = signal ? () => controller.abort(signal.reason) : undefined;
      if (signal) { if (signal.aborted) forward(); else signal.addEventListener('abort', forward, { once: true }); }
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(new Error('Convex request timed out')); reject(new Error('Convex request timed out')); }, limit); });
      try {
        const pending = client[method](target, args);
        return await Promise.race([pending, timeout]);
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? new Error('Convex request aborted');
        const message = String(error?.message ?? error); if (/invalid credentials|invalidauthheader|authentication required/i.test(message)) { const tagged = new Error(message, { cause: error }); tagged.status = 401; throw tagged; } if (/access denied|manager access denied/i.test(message)) { const tagged = new Error(message, { cause: error }); tagged.status = 403; throw tagged; }
        throw error;
      } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', forward); }
    });
  }
  function issueToken(userId, fallback) {
    if (!jwtPrivateKey) return fallback ?? `convex-token-${userId}`;
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encoded({ alg: 'RS256', typ: 'JWT', kid: 'realworld-api-v3' });
    const payload = encoded({ sub: userId, iss: 'http://127.0.0.1:3210', aud: 'convex', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
    const input = `${header}.${payload}`; const signature = createSign('RSA-SHA256').update(input).sign(jwtPrivateKey, 'base64url'); return `${input}.${signature}`;
  }
  function makeSession(client, token, options = {}, sessionToken = token) {
    const session = { client, accessToken: token, sessionToken, timeoutMs: options.timeoutMs ?? timeoutMs, controller: new AbortController(), userId: undefined };
    let externalAbort;
    if (options.signal) { externalAbort = () => session.controller.abort(options.signal.reason); if (options.signal.aborted) externalAbort(); else options.signal.addEventListener('abort', externalAbort, { once: true }); }
    const call = (fn, signal) => {
      const controller = new AbortController(); const abort = () => controller.abort(session.controller.signal.reason); const external = () => controller.abort(signal.reason);
      if (session.controller.signal.aborted) abort(); else session.controller.signal.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) external(); else signal?.addEventListener('abort', external, { once: true });
      return Promise.resolve().then(() => fn(controller.signal)).finally(() => { session.controller.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', external); });
    };
    session.cancelPending = () => { session.controller.abort(new Error('Convex session cancelled')); };
    session.close = async () => { try { await session.signOut(); } finally { session.cancelPending(); if (typeof client.close === 'function') await client.close(); if (externalAbort) options.signal.removeEventListener('abort', externalAbort); } };
    session.getProfile = () => call(async signal => { const value = await remote(client, 'query', ref(api, 'auth.me'), {}, signal, session.timeoutMs); if (!value) throw new Error('malformed Convex profile'); session.userId = value.id; return mapUser(value); });
    session.refreshSession = () => call(async signal => { const result = await remote(client, 'mutation', ref(api, 'auth.refresh'), { token: session.sessionToken }, signal, session.timeoutMs); if (result?.token) { session.sessionToken = result.token; session.accessToken = issueToken(result.userId ?? session.userId, result.token); client.setAuth(session.accessToken); } return session; });
    session.refresh = session.refreshSession;
    session.signOut = () => call(async signal => { await remote(client, 'mutation', ref(api, 'auth.signOut'), { token: session.sessionToken }, signal, session.timeoutMs); client.setAuth(''); });
    const methods = ['dashboard', 'listTasks', 'getTask', 'createTask', 'updateTask', 'addComment', 'updateComment', 'searchTasks', 'updateMembershipRole', 'updateProfile'];
    for (const name of methods) session[name] = (args = {}) => call(signal => adapter[name]({ ...args, ...(name === 'createTask' ? { creatorId: session.userId } : {}), ...(name === 'addComment' ? { authorId: session.userId } : {}), session, signal }), args.signal);
    return session;
  }
  const adapter = {
    accessPath: 'javascript-sdk',
    deviations: ['Convex uses deployed function references and its native JWT identity bridge; Convex does not expose a generic REST CRUD API.'],
    virtualUsers(count = 10_000, seed = 42) { return buildVirtualUserSpecs(count, seed); },
    correctnessFixture() { const specs = buildVirtualUserSpecs(3_201, 42); const owner = specs[0], outsider = specs[1], admin = specs[1_600], member = specs[3_200]; return { organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId, owner: owner.credentials, member: { ...member.credentials, organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId }, admin: { ...admin.credentials, organizationId: owner.organizationId, projectId: owner.projectId, taskId: owner.taskId, commentId: owner.commentId }, outsider: outsider.credentials, memberMembershipId: 'memv3' + (3_200).toString(36).padStart(11, '0'), adminMembershipId: 'memv3' + (1_600).toString(36).padStart(11, '0'), ownerMembershipId: 'memv3' + '00000000000', memberUserId: member.credentials.email.match(/user-(usrv3[0-9a-z]+)/)?.[1] }; },
    async createSession(credentials, options = {}) { const client = new ConvexHttpClient(address, { skipConvexDeploymentUrlCheck: true }); let result; try { result = await remote(client, 'mutation', ref(api, 'auth.signIn'), { email: credentials.email, password: credentials.password }, options.signal, options.timeoutMs ?? timeoutMs); } catch (error) { if (/invalid credentials/i.test(String(error?.message ?? error))) { const authError = new Error(String(error?.message ?? error), { cause: error }); authError.status = 401; throw authError; } throw error; } if (!result?.token || !result.userId) throw new Error('malformed Convex session'); const jwt = issueToken(result.userId, result.token); client.setAuth(jwt); const session = makeSession(client, jwt, options, result.token); session.userId = result.userId; return session; },
  };
  adapter.dashboard = async ({ organizationId, projectId, activityPage = { page: 0, pageSize: 20 }, session, signal }) => { const value = await remote(session.client, 'query', ref(api, 'project.dashboard'), { organizationId, projectId, page: activityPage.page, pageSize: activityPage.pageSize }, signal, session.timeoutMs); if (!value?.organization || value.organization.id !== organizationId) throw new Error('Convex tenant boundary violation'); return { ...value, projects: (value.projects ?? []).map(row => ({ ...row, organizationId: row.organizationId ?? row.organization_id })), recentActivity: (value.recentActivity ?? []).map(mapActivity) }; };
  adapter.listTasks = async ({ organizationId, projectId, status, assigneeId, page: number = 0, pageSize = 20, session, signal }) => { const [p, size] = page({ page: number, pageSize }); const received = await remote(session.client, 'query', ref(api, 'task.list'), { organizationId, projectId, status, assigneeId, page: p, pageSize: size }, signal, session.timeoutMs); const value = Array.isArray(received) ? { items: received, total: received.length, hasNext: false } : received; if (!value?.items) throw new Error('malformed Convex task response'); return { ...value, items: value.items.map(mapTask), page: p, pageSize: size }; };
  adapter.getTask = async ({ organizationId, projectId, taskId, comments, session, signal }) => { const value = await remote(session.client, 'query', ref(api, 'task.get'), { organizationId, projectId, taskId, comments }, signal, session.timeoutMs); if (!value?.task || value.task.organizationId !== organizationId || value.task.projectId !== projectId) throw new Error('Convex tenant boundary violation'); return { ...value, task: mapTask(value.task), creator: mapUser(value.creator), assignee: value.assignee ? mapUser(value.assignee) : null, comments: { ...value.comments, items: (value.comments?.items ?? []).map(mapComment) } }; };
  adapter.createTask = async ({ organizationId, projectId, title, description, priority = 'medium', session, signal }) => mapTask(await remote(session.client, 'mutation', ref(api, 'task.create'), { organizationId, projectId, title, description, priority }, signal, session.timeoutMs));
  adapter.updateTask = async ({ organizationId, projectId, taskId, session, signal, ...changes }) => mapTask(await remote(session.client, 'mutation', ref(api, 'task.update'), { organizationId, projectId, taskId, ...changes }, signal, session.timeoutMs));
  adapter.addComment = async ({ organizationId, projectId, taskId, body, session, signal }) => mapComment(await remote(session.client, 'mutation', ref(api, 'comment.create'), { organizationId, projectId, taskId, body }, signal, session.timeoutMs));
  adapter.updateComment = async ({ organizationId, projectId, taskId, commentId, body, session, signal }) => mapComment(await remote(session.client, 'mutation', ref(api, 'comment.update'), { organizationId, projectId, taskId, commentId, body }, signal, session.timeoutMs));
  adapter.searchTasks = async ({ organizationId, projectId, query, page: number = 0, pageSize = 20, session, signal }) => { const [p, size] = page({ page: number, pageSize }); const value = await remote(session.client, 'query', ref(api, 'task.search'), { organizationId, projectId, query, page: p, pageSize: size }, signal, session.timeoutMs); return { ...value, items: (value?.items ?? []).map(mapTask), page: p, pageSize: size }; };
  adapter.updateMembershipRole = async ({ organizationId, membershipId, role, session, signal }) => mapMembership(await remote(session.client, 'mutation', ref(api, 'membership.updateRole'), { organizationId, membershipId, role }, signal, session.timeoutMs));
  adapter.updateProfile = async ({ displayName, session, signal }) => mapUser(await remote(session.client, 'mutation', ref(api, 'user.updateProfile'), { displayName }, signal, session.timeoutMs));
  return adapter;
}

let defaultAdapter;
async function getDefaultAdapter() { if (!defaultAdapter) { const [{ ConvexHttpClient }, apiModule, key] = await Promise.all([import('convex/browser'), import('../../convex/_generated/api.js'), readFile(`${process.env.BAAS_BENCH_RUNTIME}/state/convex-private-key.pem`, 'utf8')]); defaultAdapter = createConvexAdapter({ ConvexHttpClient, api: apiModule.api, address: process.env.CONVEX_URL || 'http://127.0.0.1:3210', jwtPrivateKey: key }); } return defaultAdapter; }
export async function createSession(credentials, options) { return (await getDefaultAdapter()).createSession(credentials, options); }
export function createBackend(options = {}) { return options.ConvexHttpClient ? createConvexAdapter(options) : getDefaultAdapter(); }
