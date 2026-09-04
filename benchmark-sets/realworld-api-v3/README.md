# Real-world API capacity

`realworld-api-v3` measures SLO-qualified concurrent-user capacity for a deterministic authenticated project-management workload through each platform's supported application-facing path. It requires Node.js 22 or newer.

Seven cases use their platform's official JavaScript SDK and native authentication and authorization. Neon uses `@neondatabase/serverless` over the official SQL-over-HTTP proxy with application-owned PostgreSQL authentication and tenant authorization; this material access-path difference must remain visible in comparisons.

This commit provides only the benchmark and lifecycle scaffold. It does not provide workload behavior or results.
