# Directus project-management capacity

This case runs authenticated project-management workflows through `@directus/sdk@25.0.1` REST and authentication services on Node.js 22 or newer. Each virtual user has an isolated Directus client and API-only native password session; collection, field, relation, permission, and index setup happen administratively outside measurement.

All measured list, search, item, and mutation requests carry organization/project/task filters and stable created-time/ID ordering. The adapter enforces tenant and role checks because Directus 12 Core does not enforce custom permission rules without a license. A Directus hook records task and comment activity inside the server process.

Directus REST plus native user sessions are the declared access path. Tenant authorization and activity recording are benchmark-owned Directus adapter/extension behavior and are disclosed as case deviations.
