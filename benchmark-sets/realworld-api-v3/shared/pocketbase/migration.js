migrate((db) => {
  const collections = [
    { name: 'users', type: 'auth', fields: [{ name: 'id', type: 'text', required: true }, { name: 'display_name', type: 'text', required: true }] },
    ...['organizations', 'memberships', 'projects', 'tasks', 'comments', 'activities'].map(name => ({ name, type: 'base', fields: [{ name: 'id', type: 'text', required: true }, { name: 'organization_id', type: 'text', required: true }] })),
  ];
  for (const definition of collections) {
    const collection = new Collection({ name: definition.name, type: definition.type, fields: definition.fields, listRule: '@request.auth.id != ""', viewRule: '@request.auth.id != ""', createRule: '@request.auth.id != ""', updateRule: '@request.auth.id != ""' });
    dao.saveCollection(collection);
  }
}, (db) => {
  for (const name of ['activities', 'comments', 'tasks', 'projects', 'memberships', 'organizations', 'users']) {
    const collection = dao.findCollectionByNameOrId(name);
    if (collection) dao.deleteCollection(collection);
  }
});
