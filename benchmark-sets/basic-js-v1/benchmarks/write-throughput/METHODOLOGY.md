# Write throughput methodology

## Objective and non-goals

Measure successful unauthenticated JavaScript SDK operations per second when creating one guestbook entry. Reads, authentication, updates, deletes, realtime delivery, storage, administrative APIs, direct database access, durability beyond acknowledged platform defaults, and overall product quality are not measured. The benchmark makes no cross-case ranking.

Neon is excluded because its official JavaScript driver requires a proxy absent from the prepared self-hosted deployment; using direct PostgreSQL would not match the API paths under test.

## Correctness and response equivalence

One operation creates exactly one row with no fixture key. The author is `bench-vu-<vu>`. The message is `basic-js-v1 trial-<trial> load-<concurrency> vu-<vu> operation-<sequence>`, making content deterministic and unique within retained stages. The platform supplies the timestamp and a native ID; Appwrite's required recommended `ID.unique()` creates its native row ID client-side inside the timed operation.

A timed success must return one non-empty native ID. Setup/readiness and post-stage administrative checks, outside timing, verify stored author/message values, null fixture keys, valid generated timestamps, and the exact successful-row count. SDK errors, rejected writes, missing IDs, malformed responses, and acknowledged rows that fail post-stage verification are failures; the last condition invalidates the stage because per-operation attribution is no longer trustworthy.

## Measured system boundary

Latency starts immediately before constructing the write data and invoking the SDK create method, and ends when its promise resolves or rejects. It includes deterministic content formatting, Appwrite `ID.unique()` where required, SDK serialization, network transfer, API/database work through the platform's acknowledgement boundary, response transfer, and parsing.

Dependency loading, client construction, setup, baseline loading, administrative reset, readiness writes and cleanup, and post-stage verification are untimed. Issuing stops after 5 seconds or 15 seconds, then in-flight operations drain; throughput divides successes by actual elapsed stage duration including drain.

## Dataset, distribution, seed, and indexes

Every stage starts from 10,000 baseline entries. Fixture key `n` has author `user-XXXX`, message `Guestbook message NNNNN from basic-js-v1`, and timestamp 2025-01-01 UTC plus `n` seconds. Baseline keys 1 through 10,000 are unique. Measured writes always leave `fixture_key` null, allowing exact reset without regenerating native baseline IDs.

A nullable unique fixture-key index supports lifecycle checks, native primary keys identify rows, and the sibling list benchmark uses a descending created-at index where supported. The write path receives no extra benchmark-only index.

Appwrite uses native `$createdAt` baseline timestamps and SDK-generated native IDs. PocketBase stores nullable fixture keys as JSON. Neither deviation changes the timed write's logical fields.

## Authentication and authorization

Writes are explicitly unauthenticated. Public/anonymous policy allows guestbook read and create only; update, delete, schema, and admin actions are unavailable to timed clients. No login, user, token, refresh, session, or user-specific authorization work is included. This permissive isolated local configuration is not a production recommendation.

## Cache and warm-up policy

Loads execute as 1, 10, 100, and 1,000 virtual users. One 5-second warm-up at every load precedes three 15-second measured trials. Every stage is reset to the 10,000-row baseline, so warm-up writes do not change measured cardinality. Caches are not explicitly flushed.

No application cache exists. Directus keeps the prepared environment's Redis API cache (CACHE_ENABLED=true, CACHE_STORE=redis) and automatic purge (CACHE_AUTO_PURGE=true); warm-up intentionally reaches that prepared steady state. Writes still traverse the normal SDK/API create path.

## Workload, concurrency, duration, and pacing

Before timing, the runner creates one client per virtual user. Each of 1, 10, 100, and 1,000 closed-loop workers permits one in-flight write and immediately starts the next after acknowledgement. There is no think time, batch create, target rate, or arrival pacing.

There is one 5-second warm-up trial and three 15-second measured trials per load. Administrative reset plus one readiness write, validation, and removal happen before every stage outside timing.

## Connections, pooling, retries, timeouts, and errors

Documented SDK connection, pooling, queue, and cancellation defaults are retained. One client per virtual user avoids serializing unrelated Convex mutations and avoids cross-user PocketBase duplicate-request cancellation without changing either SDK setting. No retry, batching, application cache, custom transport, or performance tuning is added. A failed attempt is never retried.

There is no runner-added per-request timeout. Work remaining 60 seconds after the issue window triggers a hard stage failure. Bounded sanitized error classes/samples remain in ignored raw output and exclude headers, credentials, and environment values.

## Host and container environment

The benchmark uses each existing pinned local Docker deployment and adds only case-owned resources and permissions. Run evidence records Git and service revisions, Docker information, host OS/architecture, CPU, memory, and timestamps. Results require comparable resource conditions and do not represent distributed production deployment.

## Trial order, cooldown, acceptance, and invalidation

The framework executes one warm-up trial then three measured trials, each with ascending load. Before every load, reset deletes all rows with null fixture keys and verifies exactly 10,000 baseline rows. There is no fixed cooldown.

A high error rate remains valid overload evidence if successful rows and counts verify. Reset/readiness failure, baseline drift, incorrect acknowledged content, count disagreement, missing metrics, a hung/incomplete stage, teardown/lifecycle failure, dirty/debug status, or changed definitions invalidates publication.

## Metrics and units

At each load report successful operations per second; successful-operation latency p50, p95, and p99 in milliseconds; attempted, completed, and failed operation counts; and error rate. Nearest-rank percentiles sort successful latencies and select `ceil(p * count) - 1`. Failures affect error rate but have no success latency sample.

When no write succeeds, latency metrics are numeric `0`, meaning “no successful sample,” and failed attempts yield error rate `1`. `operations_per_second_vu_100` is the primary `ops/s` metric with higher direction. It is not an overall ranking.

## Permitted deviations and tuning

Platform-native IDs and generated timestamps are permitted. Appwrite performs required client-side `ID.unique()` and uses `$createdAt`; PocketBase uses a JSON fixture-key field; Directus retains prepared Redis. Cases may use only equivalent constraints/indexes and normal SDK defaults. Timed bulk APIs, retries, added caches, relaxed response validation, and platform-specific performance tuning are prohibited.

## Limitations

This short, local, closed-loop, unauthenticated create workload does not prove fsync/durability semantics are identical, model authenticated ownership, measure later read visibility, simulate WAN clients, test mixed traffic, or characterize long-running storage growth. Platform acknowledgement boundaries and native timestamp/ID behavior differ and must remain visible when interpreting evidence. No ranking should combine materially different cases.
