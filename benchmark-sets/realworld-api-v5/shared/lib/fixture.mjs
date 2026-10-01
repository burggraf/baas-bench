import { seedDataset, DATASET_COUNTS, entityId } from './dataset.mjs';

export const FIXTURE_COLUMNS = Object.freeze({
  users: ['id', 'email', 'display_name', 'created_at', 'updated_at'],
  organizations: ['id', 'name', 'owner_id', 'created_at'],
  memberships: ['id', 'organization_id', 'user_id', 'role', 'created_at'],
  projects: ['id', 'organization_id', 'name', 'status', 'created_at', 'updated_at'],
  tasks: ['id', 'organization_id', 'project_id', 'creator_id', 'assignee_id', 'title', 'description', 'status', 'priority', 'due_date', 'created_at', 'updated_at'],
  comments: ['id', 'organization_id', 'project_id', 'task_id', 'author_id', 'body', 'created_at', 'updated_at'],
  activities: ['id', 'organization_id', 'project_id', 'actor_id', 'action', 'subject_type', 'subject_id', 'created_at'],
});
const ordinal = id => Number.parseInt(id.slice(5), 36);

// Logical fixture columns only. Native Auth mappings are verified separately.
export async function* fixtureBatches(seed = 42, batchSize = 1000) {
  for await (const batch of seedDataset(seed, batchSize)) {
    const table = batch.entity === 'activity' ? 'activities' : `${batch.entity}s`;
    const rows = batch.records.map(record => {
      if (batch.entity === 'user') return [record.id, record.email, record.displayName, record.createdAt, record.updatedAt];
      if (batch.entity === 'organization') return [record.id, record.name, record.ownerId, record.createdAt];
      if (batch.entity === 'membership') return [record.id, record.organizationId, record.userId, record.role, record.createdAt];
      if (batch.entity === 'project') return [record.id, record.organizationId, record.name, record.status, record.createdAt, record.updatedAt];
      if (batch.entity === 'task') return [record.id, entityId('organization', ordinal(record.projectId) % DATASET_COUNTS.organizations), record.projectId, record.creatorId, record.assigneeId, record.title, record.description, record.status, record.priority, record.dueDate, record.createdAt, record.updatedAt];
      if (batch.entity === 'comment') {
        const project = ordinal(record.taskId) % DATASET_COUNTS.projects;
        return [record.id, entityId('organization', project % DATASET_COUNTS.organizations), entityId('project', project), record.taskId, record.authorId, record.body, record.createdAt, record.updatedAt];
      }
      return [record.id, record.organizationId, record.projectId, record.actorId, record.action, record.subjectType, record.subjectId, record.createdAt];
    });
    yield { table, columns: FIXTURE_COLUMNS[table], rows };
  }
}
