# Convex project-management capacity

This case runs the authenticated project-management capacity workload through Convex deployed functions using `convex@1.45.0` on Node.js 22 or newer. Measured traffic uses `ConvexHttpClient` query and mutation calls only; administrative deployment and fixture loading use the self-hosted Convex CLI outside the measured stage.

The deployment defines deterministic users, organizations, memberships, projects, tasks, comments, activities, and application sessions. Every public function resolves the authenticated identity and checks organization membership; manager-only membership changes enforce owner/admin roles. Task and comment mutations return normalized records and activity data is retained in the dashboard path.

Convex uses deployed function references and its JWT identity bridge rather than a generic REST CRUD API. This access path, function execution model, and authentication behavior are retained as case deviations in capacity comparisons.
