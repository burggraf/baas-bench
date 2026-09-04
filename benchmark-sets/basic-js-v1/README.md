# Basic JavaScript API throughput

`basic-js-v1` measures three independent operations on a public guestbook: list the newest 20 entries, read one baseline entry by native ID, and create one entry. It uses each product's mainstream JavaScript SDK through its normal HTTP API.

## Included platforms and clients

- Supabase — `@supabase/supabase-js@2.115.0`
- Convex — `convex@1.45.0`
- Appwrite — `appwrite@26.2.0` (TablesDB); setup uses `node-appwrite@28.0.0`
- Nhost — `@nhost/nhost-js@4.8.0`
- Directus — `@directus/sdk@25.0.1`
- PocketBase — `pocketbase@0.28.0`
- TrailBase — `trailbase@0.14.1`

Node.js 22 or newer is required.

## Security boundary

The workload is intentionally **unauthenticated**. Public/anonymous clients may only read and create guestbook entries; update, delete, schema, and administrative access remain unavailable. Authentication, token issuance, refresh, session storage, and user-specific authorization are outside this set's scope. This local benchmark configuration is not production security guidance.

## Workload

The baseline contains 10,000 deterministic entries. Loads run at 1, 10, 100, and 1,000 virtual users. A virtual user is one asynchronous closed-loop worker with one client per virtual user and at most one request in flight for that client. There is no think time or arrival-rate pacing.

Each benchmark uses one 5-second warm-up at every load and three 15-second measured trials at every load. Setup, reset, readiness checks, dependency loading, and client construction are outside timing. Read and write workloads are separate benchmarks.

## Neon exclusion

Neon is deliberately excluded. Its official JavaScript driver requires Neon's SQL-over-HTTP or WebSocket proxy, while this repository's prepared self-hosted deployment exposes only PostgreSQL protocol access. Using `pg` would bypass the API layer measured for every included platform; adding an unofficial proxy would alter the prepared deployment. Neon belongs in a future direct-database set or a set backed by a reproducible supported proxy.

## Release status

Validated evidence bundles are published under `results/basic-js-v1/`; see the [result report](../../results/basic-js-v1/REPORT.md). No cross-platform rankings are published, and the primary metric does not constitute an overall platform ranking. Platform-specific behavior and permitted deviations are disclosed in benchmark methodologies and case READMEs.
