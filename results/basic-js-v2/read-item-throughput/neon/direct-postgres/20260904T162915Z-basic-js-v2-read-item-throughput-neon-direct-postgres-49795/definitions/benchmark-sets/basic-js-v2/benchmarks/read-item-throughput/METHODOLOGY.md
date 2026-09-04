# Read-item database-path throughput

## Objective

Measure successful operations per second for reading one deterministic baseline guestbook entry by native primary key through each platform’s supported low-level database path. PostgreSQL cases use direct or bundled-pooler connections; TrailBase uses a server-side Rust WASM extension and PocketBase uses custom Go routes, both with internal SQLite access. This is not an API or platform-quality ranking.

## Contract and data

The setup creates 10,000 deterministic rows with `author`, `message`, `created_at`, and a nullable unique `fixture_key`. It records native IDs in fixture-key order under ignored runtime state. Each operation uses the same xorshift-derived fixture index as `basic-js-v1` and selects only `id, author, message, created_at`. The response must match the selected row exactly.

## Timing and workload

For PostgreSQL cases, a Node.js 22 `pg` client uses one lazy one-connection pool per virtual user; latency begins immediately before the parameterized `SELECT` and ends when its promise settles. For the extension cases, latency begins before `fetch` and ends after JSON parsing, including HTTP routing, Rust WASM or Go handler execution, SQLite query execution, response transfer, and parsing. Setup, client construction and cleanup, reset, readiness, and verification are untimed.

Loads are 1, 10, 100, and 1,000 closed-loop workers. Each worker has at most one query in flight and immediately starts the next. There is one 5-second warm-up and three 15-second measured trials per load, in ascending load order. Existing OS, database, and pooler caches are retained.

## Cases and fairness

Neon is tested through its compute PostgreSQL endpoint. Supabase is tested through its separately published direct database port and through Supavisor on the pooler port included in its self-hosted Docker deployment. Nhost and Directus are tested through their PostgreSQL ports. The Directus compose definition publishes its existing database service without changing database configuration. TrailBase is a separate HTTP extension case: its Rust WASM handler executes equivalent SQL against embedded SQLite using `trailbase_wasm::db::query`; HTTP routing, WASM execution, and JSON encoding remain inside the timed boundary. PocketBase is another HTTP extension case: custom Go routes query embedded SQLite through `app.DB()` for reads and use internal record persistence for writes; routing, handler execution, and JSON encoding remain timed. No retries, batching, application cache, extra indexes, or query tuning are added. PostgreSQL cases use the same SQL shape and pinned `pg` dependency; extension cases use equivalent operations through pinned TrailBase Rust and PocketBase Go dependencies.

Failures, malformed rows, missing fixture IDs, hung stages, baseline corruption, and lifecycle errors invalidate a run. Successful operations per second and successful latency p50/p95/p99 are reported for every load; failed operations are counted once and excluded from latency percentiles. Results from direct and pooler paths are separate and must not be combined with v1 API results.
