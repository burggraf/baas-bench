import { randomUUID } from 'node:crypto';

const tracked = new Map([
  ['tasks', { subjectType: 'task', createAction: 'created', updateAction: 'updated' }],
  ['comments', { subjectType: 'comment', createAction: 'commented', updateAction: 'comment_updated' }],
]);

export default ({ action }) => {
  action('items.create', (event, context) => {
    const config = tracked.get(event.collection);
    if (config) return record(event.collection, config, event, context);
  });
  action('items.update', (event, context) => {
    const config = tracked.get(event.collection);
    if (config) return record(event.collection, config, event, context);
  });
};

async function record(collection, config, event, context) {
  const { database, accountability } = context ?? {};
  const actor = accountability?.user;
  if (!database || !actor) return;
  const external = await database('directus_users').where({ id: actor }).first('external_identifier');
  if (!external?.external_identifier) return;
  const key = Array.isArray(event.keys) ? event.keys[0] : event.key;
  const row = event.payload?.organization_id && event.payload?.project_id ? event.payload : await database(collection).where({ id: key }).first();
  if (!row?.id || !row.organization_id || !row.project_id) return;
  await database('activities').insert({
    id: randomUUID().replaceAll('-', '').slice(0, 15),
    organization_id: row.organization_id,
    project_id: row.project_id,
    actor_id: external.external_identifier,
    action: event.event.endsWith('.create') ? config.createAction : config.updateAction,
    subject_type: config.subjectType,
    subject_id: row.id,
    created_at: new Date(),
  });
}
