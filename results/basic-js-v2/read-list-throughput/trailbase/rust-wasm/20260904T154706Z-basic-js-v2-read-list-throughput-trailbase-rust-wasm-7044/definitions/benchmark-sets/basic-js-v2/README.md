# Basic JavaScript direct-database throughput

`basic-js-v2` repeats the `basic-js-v1` guestbook list, item, and write workloads through PostgreSQL rather than a platform HTTP API.

## Cases

- Neon — direct PostgreSQL through its self-hosted compute endpoint
- Supabase — direct PostgreSQL and the self-hosted Supavisor pooler
- Nhost — direct PostgreSQL
- Directus — direct PostgreSQL
- TrailBase — Rust WASM extension with internal SQLite queries over HTTP
- PocketBase — custom Go extension with internal SQLite access over HTTP

Convex and Appwrite do not expose a supported PostgreSQL-compatible database endpoint in the prepared self-hosting setup, so they have no direct-database cases here.

The same fixture, load, trial, correctness, and timing contract as v1 applies. Access path and connection topology are separate cases. TrailBase and PocketBase extension paths include HTTP routing and server-side extension execution and must not be treated as direct client database connections.
