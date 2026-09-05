# Directus project-management capacity

This case runs authenticated project-management workflows through `@directus/sdk@25.0.1` REST and authentication services on Node.js 22 or newer. Each virtual user has an isolated Directus client and native password session; collection, field, relation, permission, index, and fixture setup happen administratively outside measurement.

All measured list, search, item, and mutation requests carry organization/project/task filters and stable created-time/ID ordering. The adapter normalizes Directus REST rows into the shared contract and bounds SDK calls with per-request cancellation timeouts.

Directus REST plus native user sessions are the declared access path for this case.
