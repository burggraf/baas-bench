migrate((db) => {
  const text = (name, required = false) => ({ name, type: 'text', required });
  const collections = [
    { name: 'users', type: 'auth', fields: [text('benchmark_id', true), text('display_name', true), text('created_at', true), text('updated_at', true)] },
    { name: 'organizations', fields: [text('benchmark_id'), text('name', true), text('owner_id', true), text('created_at', true)] },
    { name: 'memberships', fields: [text('benchmark_id'), text('organization_id', true), text('user_id', true), text('role', true), text('created_at', true)] },
    { name: 'projects', fields: [text('benchmark_id'), text('organization_id', true), text('name', true), text('status', true), text('created_at', true), text('updated_at', true)] },
    { name: 'tasks', fields: [text('benchmark_id'), text('organization_id', true), text('project_id', true), text('creator_id', true), text('assignee_id'), text('title', true), text('description', true), text('status', true), text('priority', true), text('due_date'), text('created_at', true), text('updated_at', true)] },
    { name: 'comments', fields: [text('benchmark_id'), text('organization_id', true), text('project_id', true), text('task_id', true), text('author_id', true), text('body', true), text('created_at', true), text('updated_at', true)] },
    { name: 'activities', fields: [text('benchmark_id'), text('organization_id', true), text('project_id'), text('actor_id', true), text('action', true), text('subject_type', true), text('subject_id', true), text('created_at', true)] },
  ];
  for (const definition of collections) {
    const collection = new Collection({ name: definition.name, type: definition.type || 'base', fields: definition.fields, listRule: '@request.auth.id != ""', viewRule: '@request.auth.id != ""', createRule: '@request.auth.id != ""', updateRule: '@request.auth.id != ""' });
    dao.saveCollection(collection);
  }
}, (db) => {
  for (const name of ['activities', 'comments', 'tasks', 'projects', 'memberships', 'organizations', 'users']) {
    const collection = dao.findCollectionByNameOrId(name);
    if (collection) dao.deleteCollection(collection);
  }
});
