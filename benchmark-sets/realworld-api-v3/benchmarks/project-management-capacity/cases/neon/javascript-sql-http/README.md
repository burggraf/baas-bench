# Neon project-management capacity

This case runs the project-management capacity workload through Neon's official SQL-over-HTTP proxy using `@neondatabase/serverless@1.1.0` on Node.js 22 or newer. It uses the shared PostgreSQL schema, deterministic million-record fixture, RLS policies, and benchmark-owned password/session functions.

Each authenticated operation is sent as a parameterized two-query Neon transaction: `benchmark_auth.validate_session` establishes the application identity, followed by the tenant-scoped operation. The proxy itself authenticates with its local PostgreSQL connection string; this is deliberately separate from benchmark application sessions. Requests use the proxy's TLS endpoint at `https://localhost:4444/sql`, with per-request abort and timeout handling.

This is a material access-path deviation from the seven native SDK cases: Neon exposes SQL-over-HTTP rather than a native BaaS data/auth API. Capacity results must therefore retain this access-path and authentication disclosure. The proxy source is pinned and built with the `testing` feature; no live result is publishable until the complete lifecycle and balanced repetitions have been run.
