// V6 private diagnostic: the approved closed seed subset, independent of V5 lifecycle tooling.
import { fixtureBatches, FIXTURE_COLUMNS } from './profile/lib/fixture.mjs';
import { buildVirtualUserSpecs, entityId } from '../benchmark-sets/realworld-api-v5/shared/lib/dataset.mjs';
const WARMUP = Object.freeze({ users: 50, seed: 42 });
const tables = Object.keys(FIXTURE_COLUMNS);
export async function lifecycleFixture() {
  const specs = buildVirtualUserSpecs(WARMUP.users, WARMUP.seed).map((spec, index) => ({ ...spec, userId: entityId('user', index) }));
  const users = new Set(specs.map(spec => spec.userId));
  const organizations = new Set(specs.map(spec => spec.organizationId));
  const projects = new Set(specs.map(spec => spec.projectId));
  const tasks = new Set(specs.map(spec => spec.taskId)), comments = new Set(specs.map(spec => spec.commentId));
  const rows = Object.fromEntries(tables.map(table => [table, []]));
  const activityProjects = new Set();
  for await (const batch of fixtureBatches()) {
    for (const row of batch.rows) {
      if (batch.table === 'tasks' && tasks.has(row[0])) { rows.tasks.push(row); users.add(row[3]); if (row[4]) users.add(row[4]); }
      if (batch.table === 'comments' && comments.has(row[0])) { rows.comments.push(row); users.add(row[4]); }
      if (batch.table === 'activities' && projects.has(row[2]) && !activityProjects.has(row[2]) && (row[5] === 'task' ? tasks.has(row[6]) : projects.has(row[6]))) {
        rows.activities.push(row); users.add(row[3]); activityProjects.add(row[2]);
      }
    }
  }
  for await (const batch of fixtureBatches()) {
    if (batch.table === 'users') rows.users.push(...batch.rows.filter(row => users.has(row[0])));
    if (batch.table === 'organizations') rows.organizations.push(...batch.rows.filter(row => organizations.has(row[0])));
    if (batch.table === 'memberships') rows.memberships.push(...batch.rows.filter(row => users.has(row[2]) && organizations.has(row[1])));
    if (batch.table === 'projects') rows.projects.push(...batch.rows.filter(row => projects.has(row[0])));
    if (batch.table === 'tasks') break;
  }
  return { specs, rows };
}
