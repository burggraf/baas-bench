# Read-item throughput methodology

## Objective and non-goals

Measure successful unauthenticated JavaScript SDK operations per second when reading one deterministic pseudo-random baseline guestbook entry through the platform's native primary-key path. This benchmark excludes authentication, list scans, writes, realtime, storage, administration, direct database access, and overall platform quality. It produces no cross-case ranking.

Neon is excluded because the prepared self-hosted stack lacks the SQL-over-HTTP or WebSocket proxy required by its official JavaScript client. Substituting `pg` would measure a materially different direct-database path.

## Correctness and response equivalence

Setup records each platform's 10,000 generated native IDs in fixture-key order. For every operation, a fixed unsigned xorshift-derived function of measured trial, virtual-user number, and operation sequence selects an index from 0 through 9,999. Equal inputs therefore select the same logical fixture in every case without timed random-number state or `Math.random()`.

The SDK fetches that native ID and selects only `id`, `author`, `message`, and `created_at`. A success must contain the selected non-empty native ID and the exact author, message, and timestamp expected for its fixture key. SDK errors, not-found results, malformed fields, and incorrect successful responses are failures. Fixture-map lookup and expected-value construction occur before the timed SDK call.

## Measured system boundary

Per-operation latency begins immediately before the SDK item-read method and ends when its promise resolves or rejects. It includes SDK request construction, network transfer, API and native primary-key lookup, response transfer, and SDK parsing. Setup, package loading, client construction, ID-map loading, reset, readiness, and verification are untimed.

The issue window is 5 seconds for warm-up or 15 seconds for measurement. Already in-flight requests are allowed to settle; actual stage duration, including drain, is the throughput denominator.

## Dataset, distribution, seed, and indexes

The baseline contains fixture keys 1 through 10,000. Fixture `n` has author `user-XXXX`, where `XXXX` is `((n - 1) mod 1000) + 1`; message `Guestbook message NNNNN from basic-js-v1`; and timestamp 2025-01-01 00:00:00 UTC plus `n` seconds. Each platform assigns a native primary ID, and setup persists the fixture-key-to-ID map in ignored mode-600 runtime state.

Native primary-key indexes serve measured reads. A unique nullable fixture-key index is administrative only, and an equivalent descending created-at index supports the sibling list benchmark. Appwrite uses native `$createdAt` values from deterministic ascending fixture batches. PocketBase's nullable fixture key is JSON because its numeric fields are not nullable.

## Authentication and authorization

This workload is deliberately unauthenticated. Public/anonymous clients may read and create guestbook entries, but may not update, delete, alter schema, or invoke administration. Authentication, token issuance, token refresh, session persistence, and user authorization are outside the measured contract. The local policy is not production security advice.

## Cache and warm-up policy

The load order is 1, 10, 100, and 1,000. One 5-second warm-up stage per load precedes three 15-second measured trials per load. OS, database, platform, HTTP, and SDK caches are not flushed between stages; the result describes a warmed service.

No application cache is introduced. Directus retains the prepared stack's enabled Redis API cache and automatic invalidation behavior, which is disclosed as a platform default.

## Workload, concurrency, duration, and pacing

The runner creates one client per virtual user before timing. At 1, 10, 100, and 1,000 virtual users, each closed-loop worker keeps at most one item read in flight and starts its next operation immediately after completion. There is no think time, open-loop arrival schedule, or target rate.

The benchmark performs one 5-second warm-up trial and three 15-second measured trials for each load. Reset and one contract-valid readiness read occur outside every stage.

## Connections, pooling, retries, timeouts, and errors

SDK-native connection reuse, pooling, queues, and cancellation behavior remain at defaults. One client per virtual user prevents unrelated users from sharing Convex's mutation queue or PocketBase's duplicate-request key while preserving those defaults. No timed batching, retry, application cache, transport replacement, or performance tuning is allowed. Each failed attempt counts once.

No per-request timeout is added. A hard stage watchdog invalidates work that remains unsettled 60 seconds after the issue window. Sanitized error samples and classes are local raw diagnostics and never published as credentials or request data.

## Host and container environment

Cases use the repository's pinned local Docker environments and add only benchmark-owned schema, fixtures, and permissions. Run metadata captures source revision, service revisions/images, Docker and host details, CPU, memory, architecture, and timing. Comparisons require equivalent host conditions.

## Trial order, cooldown, acceptance, and invalidation

One warm-up trial runs before three measured trials; each uses ascending load. Reset verifies the untouched baseline before each stage and is otherwise a no-op for this read-only benchmark. No fixed cooldown is imposed.

High error rates are retained as overload evidence when lifecycle and correctness checks pass. Missing fixtures or ID map, failed readiness/reset, wrong successful data, missing metrics, an incomplete/hung stage, post-stage corruption, lifecycle failure, debug/dirty execution, or definition tampering invalidates publication.

## Metrics and units

Each load reports successful operations per second, successful-operation latency p50/p95/p99 in milliseconds, attempted/completed/failed operations, and error rate. Latencies use nearest-rank selection at `ceil(p * count) - 1` after numeric sorting. Failure latency is not mixed into successful latency.

With no successful sample, all latency percentiles are numeric `0` as a sentinel—not zero service latency—and failed attempts produce error rate `1`. The primary metric is `operations_per_second_vu_100` (`ops/s`, higher is better), not a general ranking.

## Permitted deviations and tuning

Native IDs and primary-key APIs are required. Appwrite's client generates its required ID only for the sibling write benchmark and uses native `$createdAt`; PocketBase uses JSON fixture keys; Directus retains prepared Redis caching. Cases may implement only equivalent schema/index requirements and SDK defaults. Additional indexes, retries, batching, caches, or platform-specific tuning are forbidden.

## Limitations

The test is an unauthenticated, single-record, closed-loop lookup against a 10,000-row local dataset for short stages. It does not model authorization, complex filters, broad records, WAN latency, long-run behavior, mixed traffic, or direct database access. SDK, network, API, storage, and cache costs are intentionally combined, so results cannot identify one component or justify cross-path rankings.
