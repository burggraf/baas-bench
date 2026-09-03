# Read-list throughput methodology

## Objective and non-goals

Measure successful unauthenticated JavaScript SDK operations per second when fetching the 20 newest entries from a 10,000-entry guestbook. This benchmark does not measure authentication, realtime delivery, storage, administrative APIs, writes, direct database access, or overall platform quality. It produces no cross-case ranking.

Neon is excluded because its official JavaScript client needs a SQL-over-HTTP or WebSocket proxy absent from the prepared self-hosted deployment. Direct `pg` access would bypass the API layer used by every included case.

## Correctness and response equivalence

One operation selects only `id`, `author`, `message`, and `created_at`, orders by `created_at` descending with a deterministic native-ID or fixture-key tie-break where supported, and requests exactly 20 records. A success must contain exactly 20 records, each with a non-empty native ID, the expected bounded strings, and a valid timestamp. Before timing, readiness verifies that the returned records are baseline fixture keys 10,000 through 9,981 in descending order; fixture keys are not selected during timed requests.

SDK errors, HTTP failures, wrong counts, malformed fields, and incorrect successful responses are failed operations. Only contract-valid responses count as throughput.

## Measured system boundary

Timing begins immediately before the SDK list method and ends when its promise resolves or rejects. It includes SDK request creation, network transfer, API processing, database work, response transfer, and SDK response parsing. Dependency loading, client construction, setup, fixture loading, reset, readiness, and post-stage verification are outside timing.

A measured stage ends after its 5-second or 15-second issue window and after already in-flight requests settle. Throughput uses that actual elapsed duration, including drain time.

## Dataset, distribution, seed, and indexes

The baseline has 10,000 rows with fixture keys 1 through 10,000. For fixture key `n`:

- `author` is `user-` plus `((n - 1) mod 1000) + 1`, zero-padded to four digits;
- `message` is `Guestbook message ` plus `n` zero-padded to five digits plus ` from basic-js-v1`;
- `created_at` is 2025-01-01 00:00:00 UTC plus `n` seconds.

Each platform uses its native primary key. Baseline fixture keys are unique and measured writes, in other benchmarks, leave the fixture key null. The list path has an equivalent descending `created_at` index where explicit indexing is supported, plus a deterministic tie-break. Native platform indexes that cannot be expressed identically are disclosed by the case.

Appwrite uses its native `$createdAt` rather than an explicit fixture timestamp and loads rows in deterministic ascending batches. PocketBase stores the fixture key in a nullable JSON field because its numeric fields are not nullable. These deviations are not exposed in timed projections.

## Authentication and authorization

The workload is explicitly unauthenticated. Public or anonymous policy permits selecting and creating guestbook rows only; update, delete, schema, and administrative access are denied through the timed client. No sign-in, token issuance, refresh, session storage, or per-user authorization is measured. This isolated local permission model is not production guidance.

## Cache and warm-up policy

Every trial visits loads 1, 10, 100, and 1,000 in ascending order. Each load receives a 5-second warm-up in the one warm-up trial, followed later by three measured trials with a 15-second stage per load. The benchmark does not flush OS, database, SDK, or platform caches between stages, so measured trials represent a warmed local service.

No application cache is added. Directus retains the prepared deployment's enabled Redis response cache and automatic invalidation defaults; this material platform default is disclosed rather than disabled.

## Workload, concurrency, duration, and pacing

Loads are 1, 10, 100, and 1,000 virtual users. The runner creates one client per virtual user before timing. Each virtual user is a closed-loop asynchronous worker with at most one request in flight and immediately starts another after completion. There is no think time, batching, target request rate, or arrival pacing.

There is one 5-second warm-up trial and three 15-second measured trials at every load. Administrative reset and one readiness request occur before every stage and are untimed.

## Connections, pooling, retries, timeouts, and errors

SDK transport, connection reuse, pooling, and duplicate-request behavior remain at documented defaults. Separate clients avoid artificial cross-user Convex mutation queuing and PocketBase duplicate-request cancellation without disabling either default. The runner adds no retry, batch operation, application cache, or platform-specific tuning. Errors are counted once and are not retried.

There is no added per-request timeout. A stage that does not settle within 60 seconds after its issue window is aborted and invalidated. Up to 20 sanitized local error samples and bounded error-class counts are retained only in raw local output.

## Host and container environment

The existing pinned local Docker deployment is used unchanged except for case-owned schema, data, and public permissions. The framework records Git revision, pinned service versions, Docker details, host OS, architecture, CPU, memory, and timestamps in the run bundle. No claim is made that hosts with different resources are directly comparable.

## Trial order, cooldown, acceptance, and invalidation

The framework runs one warm-up trial, then three measured trials. Within each trial, loads run ascending. The baseline is reset and verified before each load; for this read-only benchmark reset is a verified no-op after setup. There is no fixed cooldown.

A high error rate, including overload at 1,000 virtual users, remains valid evidence if the stage finishes and correctness checks pass. A missing or altered baseline, failed reset/readiness, invalid successful response, missing metric, hung stage, failed post-stage verification, lifecycle failure, dirty/debug run, or changed captured definition invalidates publication.

## Metrics and units

For each load, report successful operations per second; successful-operation p50, p95, and p99 latency in milliseconds; attempted, completed, and failed counts; and error rate. Percentiles use nearest-rank selection: sort successful latencies and select `ceil(p * count) - 1`. Failed operations are excluded from latency samples and included in error rate.

If no operation succeeds, latency percentiles are numeric `0`, meaning “no successful sample,” not zero-duration service; error rate is `1` when attempts failed. `operations_per_second_vu_100` is the primary metric in `ops/s`, higher is better. It is not an overall platform score.

## Permitted deviations and tuning

Only schema/API mappings required by native platforms are permitted. Appwrite uses `$createdAt`; PocketBase uses nullable JSON for fixture keys; Directus keeps its prepared Redis cache. SDK-specific default connections and native primary keys remain enabled. No case may add indexes beyond equivalent list order, primary-key lookup, and fixture management; change retries, batch timed operations, or add undocumented tuning.

## Limitations

This is a single-host, short-duration, closed-loop, unauthenticated list-read workload against one small dataset. It does not isolate network, SDK, API, database, or cache costs; represent geographically distributed clients; characterize long-run stability; or predict production behavior. Results from different hardware or materially different access paths must not be combined into a ranking.
