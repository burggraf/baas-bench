import {
  ACTIVITY_ACTIONS,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from './domain.mjs';
import { mulberry32 } from './random.mjs';

export const DATASET_COUNTS = Object.freeze({
  organizations: 1_600,
  users: 16_000,
  memberships: 16_000,
  projects: 8_000,
  tasks: 160_000,
  comments: 479_200,
  activities: 319_200,
});

export const TOTAL_APPLICATION_RECORDS = Object.values(DATASET_COUNTS)
  .reduce((total, count) => total + count, 0);

const definitions = Object.freeze([
  ['user', 'users', 'usr'],
  ['organization', 'organizations', 'org'],
  ['membership', 'memberships', 'mem'],
  ['project', 'projects', 'prj'],
  ['task', 'tasks', 'tsk'],
  ['comment', 'comments', 'cmt'],
  ['activity', 'activities', 'act'],
]);
const byEntity = new Map(definitions.map((definition) => [definition[0], definition]));
const BASE_TIME = Date.UTC(2020, 0, 1);
const USERS_PER_ORGANIZATION = DATASET_COUNTS.users / DATASET_COUNTS.organizations;
const PROJECTS_PER_ORGANIZATION = DATASET_COUNTS.projects / DATASET_COUNTS.organizations;

export function entityId(entity, ordinal) {
  const definition = byEntity.get(entity);
  if (!definition) throw new RangeError(`invalid entity: ${entity}`);
  const limit = DATASET_COUNTS[definition[1]];
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= limit) {
    throw new RangeError(`invalid ${entity} ordinal`);
  }
  return `${definition[2]}v3${ordinal.toString(36).padStart(11, '0')}`;
}

export function membershipRole(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= DATASET_COUNTS.memberships) {
    throw new RangeError('invalid membership ordinal');
  }
  const slot = Math.floor(ordinal / DATASET_COUNTS.organizations);
  return slot === 0 ? 'owner' : slot === 1 ? 'admin' : 'member';
}

function userInOrganization(organization, slot) {
  return organization + (slot % USERS_PER_ORGANIZATION) * DATASET_COUNTS.organizations;
}

function projectInOrganization(organization, slot) {
  return organization + (slot % PROJECTS_PER_ORGANIZATION) * DATASET_COUNTS.organizations;
}

function timestamp(ordinal) {
  return new Date(BASE_TIME + ordinal * 60_000).toISOString();
}

function text(kind, ordinal, random) {
  return `${kind} ${ordinal} ${Math.floor(random() * 1_000_000).toString(36)}`;
}

function pick(values, random) {
  return values[Math.floor(random() * values.length)];
}

export async function* seedDataset(seed = 42, batchSize = 1_000) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be a positive integer');
  }
  const random = mulberry32(seed);

  for (const [entity, countName] of definitions) {
    const total = DATASET_COUNTS[countName];
    for (let start = 0; start < total; start += batchSize) {
      const records = [];
      for (let ordinal = start; ordinal < Math.min(start + batchSize, total); ordinal += 1) {
        if (entity === 'user') {
          const created = ordinal + Math.floor(random() * 1_000);
          records.push({
            id: entityId(entity, ordinal),
            email: `user-${entityId(entity, ordinal)}@example.test`,
            displayName: text('User', ordinal, random),
            createdAt: timestamp(created),
            updatedAt: timestamp(created + 1 + Math.floor(random() * 1_000)),
          });
        } else if (entity === 'organization') {
          records.push({
            id: entityId(entity, ordinal),
            name: text('Organization', ordinal, random),
            ownerId: entityId('user', userInOrganization(ordinal, 0)),
            createdAt: timestamp(ordinal),
          });
        } else if (entity === 'membership') {
          const organization = ordinal % DATASET_COUNTS.organizations;
          records.push({
            id: entityId(entity, ordinal),
            organizationId: entityId('organization', organization),
            userId: entityId('user', ordinal),
            role: membershipRole(ordinal),
            createdAt: timestamp(ordinal),
          });
        } else if (entity === 'project') {
          const organization = ordinal % DATASET_COUNTS.organizations;
          records.push({
            id: entityId(entity, ordinal),
            organizationId: entityId('organization', organization),
            name: text('Project', ordinal, random),
            status: pick(PROJECT_STATUSES, random),
            createdAt: timestamp(ordinal),
            updatedAt: timestamp(ordinal + 1),
          });
        } else if (entity === 'task') {
          const organization = ordinal % DATASET_COUNTS.organizations;
          const project = projectInOrganization(organization, Math.floor(ordinal / DATASET_COUNTS.organizations));
          records.push({
            id: entityId(entity, ordinal),
            projectId: entityId('project', project),
            creatorId: entityId('user', userInOrganization(organization, ordinal)),
            assigneeId: ordinal % 5 === 0 ? null : entityId('user', userInOrganization(organization, ordinal * 7)),
            title: text('Task', ordinal, random),
            description: text('Description', ordinal, random),
            status: pick(TASK_STATUSES, random),
            priority: pick(TASK_PRIORITIES, random),
            dueDate: ordinal % 3 === 0 ? timestamp(ordinal + 100) : null,
            createdAt: timestamp(ordinal),
            updatedAt: timestamp(ordinal + 1),
          });
        } else if (entity === 'comment') {
          const task = ordinal % DATASET_COUNTS.tasks;
          const organization = task % DATASET_COUNTS.organizations;
          records.push({
            id: entityId(entity, ordinal),
            taskId: entityId('task', task),
            authorId: entityId('user', userInOrganization(organization, ordinal * 11)),
            body: text('Comment', ordinal, random),
            createdAt: timestamp(ordinal),
            updatedAt: timestamp(ordinal + 1),
          });
        } else {
          const organization = ordinal % DATASET_COUNTS.organizations;
          const project = ordinal % DATASET_COUNTS.projects;
          const isTask = ordinal % 2 === 0;
          records.push({
            id: entityId(entity, ordinal),
            organizationId: entityId('organization', organization),
            projectId: ordinal % 4 === 0 ? null : entityId('project', project),
            actorId: entityId('user', userInOrganization(organization, ordinal * 13)),
            action: pick(ACTIVITY_ACTIONS, random),
            subjectType: isTask ? 'task' : 'project',
            subjectId: isTask
              ? entityId('task', ordinal % DATASET_COUNTS.tasks)
              : entityId('project', project),
            createdAt: timestamp(ordinal),
          });
        }
      }
      yield { entity, records };
    }
  }
}

export function buildVirtualUserSpecs(count, seed = 42) {
  if (!Number.isSafeInteger(count) || count < 1 || count > DATASET_COUNTS.users) {
    throw new RangeError('requested users exceed seeded users');
  }
  const password = `Bb-v3-${seed}-capacity!`;
  return Array.from({ length: count }, (_, ordinal) => {
    const organization = ordinal % DATASET_COUNTS.organizations;
    const project = projectInOrganization(organization, ordinal);
    const task = project;
    const id = entityId('user', ordinal);
    return {
      credentials: { email: `user-${id}@example.test`, password },
      organizationId: entityId('organization', organization),
      projectId: entityId('project', project),
      taskId: entityId('task', task),
      commentId: entityId('comment', task),
    };
  });
}
