import { appendFileSync } from 'node:fs';
import { buildVirtualUserSpecs, entityId } from '../../benchmark-sets/realworld-api-v5/shared/lib/dataset.mjs';
import { measureRemoteCall } from '../../benchmark-sets/realworld-api-v5/shared/lib/measurement.mjs';

// Service-free subprocess fixture; never imported by a native driver.
export function createBackend({ failPreparation = false, pidFile, sampleFault } = {}) {
  if (process.env.V5_TEST_SECRET !== undefined) throw new Error('unexpected inherited secret');
  if (pidFile) appendFileSync(pidFile, `${process.pid}\n`, { mode: 0o600 });
  if (sampleFault) {
    const send = process.send.bind(process);
    process.send = (message, callback) => {
      if (message.type === 'samples') {
        if (sampleFault === 'crash') process.exit(23);
        callback?.(); return true; // Deliberate lost IPC batch.
      }
      return send(message, callback);
    };
  }
  return { sessionPreparationBatchDelayMs: 0, async createSession(credentials) {
    if (failPreparation) throw new Error('fixture preparation failure');
    const index = Number.parseInt(credentials.email.match(/usrv3([0-9a-z]+)/)[1], 36);
    const spec = buildVirtualUserSpecs(index + 1).at(-1), userId = entityId('user', index);
    const profile = { id: userId, email: credentials.email, displayName: 'User', createdAt: 'date', updatedAt: 'date' };
    let serial = 0;
    const tasks = new Map();
    const task = id => tasks.get(id) ?? { id, organizationId: spec.organizationId, projectId: spec.projectId, creatorId: userId, assigneeId: null, title: 'Task', description: 'Description', status: 'todo', priority: 'medium', dueDate: null, createdAt: 'date', updatedAt: 'date' };
    const page = (items, args) => ({ items, page: args.page ?? 0, pageSize: args.pageSize ?? 20, total: items.length, hasNext: false });
    const remote = work => measureRemoteCall(work);
    return { async getProfile() { return remote(async () => profile); }, async updateProfile(args) { return remote(async () => ({ ...profile, displayName: args.displayName })); },
      async signOut() { return remote(async () => true); }, async close() {}, cancelPending() {},
      async dashboard() { return remote(async () => ({ organization: { id: spec.organizationId }, projects: [{ id: spec.projectId, organizationId: spec.organizationId }], recentActivity: [] })); },
      async listTasks(args) { return remote(async () => page([task(spec.taskId)], args)); },
      async searchTasks(args) { return remote(async () => page([], args)); },
      async getTask(args) { return remote(async () => ({ task: task(args.taskId), creator: profile, assignee: null, comments: page([], args.comments ?? {}) })); },
      async createTask(args) { return remote(async () => { const row = { ...task(`new${index}x${serial++}`), title: args.title, description: args.description }; tasks.set(row.id, row); return row; }); },
      async updateTask(args) { return remote(async () => { const row = { ...task(args.taskId), title: args.title }; tasks.set(row.id, row); return row; }); },
      async addComment(args) { return remote(async () => ({ id: `comment${serial++}`, organizationId: spec.organizationId, taskId: args.taskId, authorId: userId, body: args.body, createdAt: 'date', updatedAt: 'date' })); },
    };
  } };
}
