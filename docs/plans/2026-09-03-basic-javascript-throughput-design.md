# Basic JavaScript API Throughput Benchmark Design

**Date:** 2026-09-03  
**Status:** Approved

## Goal

Create the first real benchmark set for this repository: a small public guestbook application implemented through each platform's mainstream JavaScript API client. Measure list-read, item-read, and write throughput independently at increasing concurrency while keeping operation semantics, fixtures, timing, validation, and reporting consistent.

The benchmark measures API data-path throughput, not authentication, realtime delivery, file storage, administrative APIs, or direct database performance. It will define benchmarks and runnable cases but will not publish results or rank platforms.

## Scope

Create benchmark set `basic-js-v1` with three benchmarks:

1. `read-list-throughput`: fetch the 20 newest guestbook entries.
2. `read-item-throughput`: fetch one deterministic pseudo-random baseline entry by its platform-native primary ID.
3. `write-throughput`: create one guestbook entry.

Each benchmark has a `javascript-sdk` case for:

- Supabase using `@supabase/supabase-js`;
- Convex using `convex` and `ConvexHttpClient`;
- Appwrite using the `appwrite` web SDK's current TablesDB API;
- Nhost using `@nhost/nhost-js`;
- Directus using `@directus/sdk`;
- PocketBase using `pocketbase`;
- TrailBase using `trailbase@0.14.1` and `initClient` (`@trailbase/client` does not exist).

### Neon exclusion

Neon is deliberately omitted. Neon's official `@neondatabase/serverless` JavaScript driver requires Neon's SQL-over-HTTP or WebSocket proxy. The repository's pinned official self-hosted Compose example exposes the compute node's PostgreSQL protocol but does not include that proxy. Using `pg` would bypass the API/proxy layer included in every other case and would therefore create a materially different, advantaged access path.

Adding a separately built proxy only for this benchmark would expand and alter the prepared Neon deployment without a turnkey supported self-hosted topology. Neon should instead be included later in a direct-database benchmark alongside equivalent PostgreSQL access paths for Supabase, Nhost, and Directus, or after a reproducible supported proxy deployment is added.

## Application and data contract

The application is a public guestbook. Every platform stores the same logical record:

| Field | Contract |
|---|---|
| `id` | Platform-native primary key. |
| `author` | Non-empty string, maximum 32 characters. |
| `message` | Non-empty string, maximum 256 characters. |
| `created_at` | Timestamp used for newest-first ordering. |
| `fixture_key` | Nullable integer used only for deterministic fixture management. |

The baseline contains 10,000 entries generated from a fixed seed and formula. Authors, messages, and timestamps are semantically identical across platforms. Baseline records have unique fixture keys; measured writes leave `fixture_key` null so administrative reset can remove them without rebuilding the baseline.

The list operation selects only `id`, `author`, `message`, and `created_at`, orders by `created_at` descending, and returns exactly 20 records. The item operation chooses a baseline primary ID using the same deterministic pseudo-random sequence for every case and returns those same four fields. Setup records each platform's generated baseline IDs in ignored runtime state so the measured operation uses the native primary-key lookup path.

The write operation creates one entry with deterministic unique content and a platform- or SDK-generated native ID and a platform-generated timestamp. A successful timed write must return a non-empty ID. Appwrite's recommended `ID.unique()` generates its required row ID in the client; the other cases use native server-generated IDs. Setup and post-stage verification check stored fields outside the measured interval rather than adding a second read to each timed write.

An equivalent descending-order index on `created_at` is created where the platform supports explicit indexes. Native primary-key indexing serves item reads. Any platform-specific index behavior or limitation is disclosed in its case README.

## Authentication and permissions

The benchmark is explicitly unauthenticated. It measures public data API throughput without sign-in, token issuance, refresh, session storage, or per-user authorization overhead.

- Supabase uses its public project key without a user session and Row Level Security policies permitting anonymous select and insert.
- Convex exposes public query and mutation functions.
- Appwrite uses the project identifier and public collection/table permissions.
- Nhost uses Hasura's anonymous role with select and insert permissions.
- Directus uses its public role.
- PocketBase uses public collection rules.
- TrailBase uses world read/create ACLs.

Only read and create are public. Update, delete, and administrative operations remain unavailable through the timed client. This configuration is for an isolated local benchmark and is not production security guidance. The unauthenticated boundary must be prominent in the set README, benchmark methodologies, and case documentation.

## Architecture

Use a shared Node.js load runner with thin platform adapters. The runner owns concurrency, timing, deterministic operation selection, response validation, latency collection, failure classification, and normalized summary generation. Each adapter owns SDK construction plus only these timed methods:

- list newest entries;
- read an entry by native ID;
- create an entry.

Each virtual user uses one normally configured, long-lived SDK client and issues one request at a time, matching separate browser or application instances. Client construction occurs outside timing. This avoids artificial cross-user serialization in Convex and duplicate-request cancellation in PocketBase while preserving both SDK defaults. No application-level cache, batch API, retry loop, or platform-specific performance tuning is enabled. The shared workload requires Node.js 22 or newer, as required by the pinned current SDKs.

Platform-specific administrative setup/reset code is separate from timed adapters. It may use documented administrative APIs or container-native tools to create and remove case-owned resources. Credentials remain in ignored runtime state and never enter committed metadata, definitions, summaries, or logs.

Shared code and one pinned npm lockfile live under `benchmark-sets/basic-js-v1/shared/`. `bin/bench` receives one minimal framework extension: when a set has a `shared/` directory, selected-run definition snapshots include it. Existing definition checksums and publication comparisons then cover the shared runner and adapters without copying them into all three benchmarks.

Pinned dependencies are installed into `.runtime/benchmarks/basic-js-v1/`, not into the committed definition tree. Cases use the framework's required five executable POSIX hooks as thin wrappers around shared commands:

1. `setup.sh` installs dependencies and creates resources, permissions, indexes, fixtures, and runtime ID maps.
2. `verify.sh` checks fixture count, representative records, and post-run correctness.
3. `reset.sh` restores the baseline before a trial.
4. `run.sh` invokes the shared runner for the benchmark operation.
5. `teardown.sh` removes case-owned resources.

The write workload also resets measured rows between load levels so every stage begins from exactly 10,000 baseline records. Read resets are documented no-ops after baseline verification.

## Load model and timing boundary

The load levels are 1, 10, 100, and 1,000 concurrent virtual users. Virtual users are asynchronous closed-loop workers in one Node.js process: each starts its next request immediately after its previous request completes. There is no think time or arrival-rate pacing. “Users” therefore means concurrent operations, not simulated human behavior.

Each benchmark runs:

- one warm-up trial, with 5 seconds at each load level;
- three measured trials, with 15 seconds at each load level.

Before every load level, administrative code restores the declared baseline and the runner performs one untimed readiness/correctness request. SDK construction, dependency loading, reset, fixture verification, and connection establishment are outside the measured interval.

The measured boundary starts immediately before releasing virtual-user loops and ends when the stage duration expires and in-flight requests settle. Per-operation latency begins immediately before the SDK method call and ends when its returned promise resolves or rejects, naturally including the SDK's request creation, network transfer, server work, and response parsing.

## Metrics and error policy

Every load level reports:

- successful operations per second;
- successful-operation latency p50, p95, and p99 in milliseconds;
- attempted operation count;
- successful operation count;
- failed operation count;
- error rate.

`operations_per_second_vu_100` is the benchmark's primary metric. One hundred virtual users is a substantial load while being less likely than 1,000 to describe only overload collapse. Metrics for every load remain required and published; the primary metric does not establish an overall platform ranking.

The normalized summary's duration and counts aggregate the four measured stages. Raw local stage output preserves per-stage failure classifications and latency observations. Published evidence contains aggregate metric values only.

SDK errors, network errors, non-success responses, and invalid response shapes count as failed operations and are not retried. Throughput counts only successful contract-valid operations. Latency percentiles are calculated from successful operations, while error rate is reported separately. A high error rate remains valid overload evidence. A missing baseline, incorrect successful response, failed reset, missing metric, hung/incomplete stage, or broken post-run correctness check invalidates the run.

## Testing and validation

Implementation follows test-driven development:

1. Add a failing regression to `test/bench_test.sh` proving set-level shared files are copied into run snapshots and checked during publication.
2. Add a dependency-free Node test with a fake adapter to verify concurrency, timing, deterministic selection, validation, failure counts, percentiles, and summary generation.
3. Add shell contract tests for benchmark metadata and hooks using fake platform, Docker, npm, and administrative commands. Tests must never start real BaaS stacks.
4. Validate all 21 cases through `bin/bench validate all` and run the repository's required shell syntax, regression, and whitespace checks.
5. Perform explicitly labeled real-stack integration diagnostics where practical. Do not commit raw output, publish implementation-time runs, invent results, or calculate rankings.

Case READMEs document their exact endpoint, SDK methods, setup mechanism, public permission model, connection behavior, indexes, and deviations. The methodology documents operation equivalence, anonymous access, closed-loop load semantics, cache and warm-up policy, reset behavior, metrics, acceptance, limitations, and Neon exclusion.

## Explicit non-goals

This version adds no dashboard, ranking engine, report generator, adaptive maximum-load search, authentication workload, realtime workload, file workload, mixed read/write workload, custom Neon proxy, direct-database comparison, batch operations, or platform-specific tuning. Those require separate approved methodologies after this basic benchmark produces trustworthy evidence.
