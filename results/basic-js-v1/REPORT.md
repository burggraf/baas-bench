# Basic JavaScript API throughput — result report

> This report presents observed measurements from the published evidence bundles. It does not rank platforms, name a winner, or combine materially different results into an overall score.

## What was tested

`basic-js-v1` measures three independent operations against a public guestbook through each product’s mainstream JavaScript SDK and normal HTTP API:

- **List read:** fetch the newest 20 entries.
- **Item read:** fetch one deterministic pseudo-random baseline entry by native ID.
- **Write:** create one entry and receive its native ID.

Timed clients were anonymous. Authentication, administrative APIs, direct database access, realtime, storage, updates, and deletes were outside the measured operations.

## Test conditions

| Condition | Value |
|---|---|
| Baseline | 10,000 deterministic guestbook entries |
| Loads | 1, 10, 100, and 1,000 virtual users (VUs) |
| Worker model | Closed loop; one long-lived SDK client per VU; at most one in-flight request per client |
| Warm-up | One 5-second stage at every load |
| Measurement | Three 15-second trials at every load |
| Stage completion | In-flight requests drain after the issue window; actual elapsed time is the throughput denominator |
| Retries and pacing | No retries, timed batching, think time, target request rate, or arrival pacing |
| Added optimization | No application cache, ORM, custom transport, or benchmark-specific performance tuning |
| Cache state | Platform, database, OS, HTTP, and SDK caches were not flushed; measured trials describe warmed local services |
| Runtime | Node.js 22+ |
| Host | `Darwin` / `arm64` |
| Docker allocation | 8 CPUs; 7.82 GiB memory |
| Docker | Server 29.4.0; Compose 5.1.2 |
| Benchmark source commit | `6c9bf828c48f54a754536cb79865c1d76a96f8dc` |

Successful-operation latency percentiles use nearest-rank selection. Failed operations are excluded from latency samples but included in the error rate. Full workload semantics, invalidation rules, and limitations are preserved in each bundle’s captured definitions.

## Platform coverage

### Included

| BaaS | Timed JavaScript client | Access path |
|---|---|---|
| Supabase | `@supabase/supabase-js@2.115.0` | Public/anonymous native SDK data API |
| Convex | `convex@1.45.0` | Public/anonymous native SDK data API |
| Appwrite | `appwrite@26.2.0` (TablesDB) | Public/anonymous native SDK data API |
| Nhost | `@nhost/nhost-js@4.8.0` | Public/anonymous native SDK data API |
| Directus | `@directus/sdk@25.0.1` | Public/anonymous native SDK data API |
| PocketBase | `pocketbase@0.28.0` | Public/anonymous native SDK data API |
| TrailBase | `trailbase@0.14.1` | Public/anonymous native SDK data API |

Appwrite used TablesDB. Directus Core required broader action-wide public read/create permissions because field-level/custom permission rules require licensing; timed reads still selected only benchmark fields. Directus retained its prepared Redis API cache. Appwrite used native `$createdAt`; PocketBase used a nullable JSON fixture key. These implementation details are documented in the relevant captured case definitions.

### Excluded

| BaaS | Reason |
|---|---|
| Neon | The prepared self-hosted stack does not expose the SQL-over-HTTP or WebSocket proxy required by Neon’s official JavaScript driver. Using `pg` would measure direct PostgreSQL rather than the comparable SDK/API layer; adding an unofficial proxy would alter the prepared deployment. |

## Results

Every table reports the three measured trials independently. Values are rounded for presentation; the linked JSON summaries retain full precision. `Failed` is the failed-operation count and `Error rate` is failures divided by attempted operations.

### List-read throughput

Fetch the newest 20 guestbook entries, selecting only native ID, author, message, and creation timestamp.

#### Supabase

Completed run [`20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668`](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/run.json), from 2026-09-04T06:31:37Z to 2026-09-04T06:36:03Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 977.75 | 0.98 | 1.28 | 1.82 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/001/summary.json) |
| 1 | 10 | 3924.22 | 2.42 | 4.06 | 5.19 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/001/summary.json) |
| 1 | 100 | 3137.95 | 30.38 | 44.76 | 58.99 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/001/summary.json) |
| 1 | 1,000 | 2292.05 | 352.02 | 957.67 | 1062.39 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/001/summary.json) |
| 2 | 1 | 955.36 | 1.00 | 1.32 | 1.86 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/002/summary.json) |
| 2 | 10 | 3890.34 | 2.43 | 4.09 | 5.32 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/002/summary.json) |
| 2 | 100 | 3027.41 | 31.34 | 47.47 | 62.54 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/002/summary.json) |
| 2 | 1,000 | 2922.96 | 335.79 | 392.54 | 502.02 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/002/summary.json) |
| 3 | 1 | 989.11 | 0.97 | 1.27 | 1.84 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/003/summary.json) |
| 3 | 10 | 3959.09 | 2.40 | 4.01 | 5.15 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/003/summary.json) |
| 3 | 100 | 3073.72 | 31.20 | 45.22 | 59.31 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/003/summary.json) |
| 3 | 1,000 | 2774.82 | 348.07 | 445.23 | 608.36 | 0 | 0.00% | [JSON](read-list-throughput/supabase/javascript-sdk/20260904T063137Z-basic-js-v1-read-list-throughput-supabase-javascript-sdk-91668/trials/003/summary.json) |

#### Convex

Completed run [`20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506`](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/run.json), from 2026-09-04T06:36:04Z to 2026-09-04T06:41:54Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 3400.75 | 0.28 | 0.35 | 0.76 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/001/summary.json) |
| 1 | 10 | 8915.91 | 0.98 | 2.35 | 3.21 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/001/summary.json) |
| 1 | 100 | 8132.63 | 11.98 | 16.65 | 19.94 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/001/summary.json) |
| 1 | 1,000 | 7986.90 | 120.08 | 160.67 | 252.08 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/001/summary.json) |
| 2 | 1 | 3340.98 | 0.28 | 0.35 | 0.79 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/002/summary.json) |
| 2 | 10 | 9109.42 | 0.96 | 2.29 | 3.14 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/002/summary.json) |
| 2 | 100 | 8157.32 | 12.03 | 16.50 | 19.52 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/002/summary.json) |
| 2 | 1,000 | 7943.03 | 121.06 | 161.74 | 291.79 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/002/summary.json) |
| 3 | 1 | 3243.78 | 0.28 | 0.42 | 0.98 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/003/summary.json) |
| 3 | 10 | 8777.43 | 0.98 | 2.46 | 3.34 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/003/summary.json) |
| 3 | 100 | 8171.25 | 11.97 | 16.42 | 19.67 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/003/summary.json) |
| 3 | 1,000 | 7840.34 | 122.12 | 167.08 | 253.53 | 0 | 0.00% | [JSON](read-list-throughput/convex/javascript-sdk/20260904T063604Z-basic-js-v1-read-list-throughput-convex-javascript-sdk-94506/trials/003/summary.json) |

#### Appwrite

Completed run [`20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517`](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/run.json), from 2026-09-04T06:41:55Z to 2026-09-04T06:46:59Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 72.12 | 13.49 | 15.92 | 18.22 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/001/summary.json) |
| 1 | 10 | 182.73 | 50.44 | 97.86 | 135.46 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/001/summary.json) |
| 1 | 100 | 175.38 | 383.58 | 1458.89 | 2877.25 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/001/summary.json) |
| 1 | 1,000 | 146.01 | 4518.16 | 17009.83 | 20478.24 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/001/summary.json) |
| 2 | 1 | 69.97 | 13.83 | 17.03 | 19.73 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/002/summary.json) |
| 2 | 10 | 174.29 | 52.38 | 103.68 | 143.92 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/002/summary.json) |
| 2 | 100 | 151.72 | 396.24 | 1798.12 | 4189.00 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/002/summary.json) |
| 2 | 1,000 | 141.14 | 2851.45 | 19228.88 | 21156.52 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/002/summary.json) |
| 3 | 1 | 69.89 | 13.89 | 17.09 | 20.19 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/003/summary.json) |
| 3 | 10 | 166.61 | 54.58 | 103.88 | 150.76 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/003/summary.json) |
| 3 | 100 | 150.83 | 425.88 | 1667.76 | 4001.77 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/003/summary.json) |
| 3 | 1,000 | 140.91 | 4268.79 | 18256.94 | 20835.98 | 0 | 0.00% | [JSON](read-list-throughput/appwrite/javascript-sdk/20260904T064155Z-basic-js-v1-read-list-throughput-appwrite-javascript-sdk-98517/trials/003/summary.json) |

#### Nhost

Completed run [`20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533`](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/run.json), from 2026-09-04T06:47:00Z to 2026-09-04T06:50:52Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 973.89 | 0.97 | 1.30 | 1.96 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/001/summary.json) |
| 1 | 10 | 3497.45 | 2.66 | 4.99 | 6.42 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/001/summary.json) |
| 1 | 100 | 2171.56 | 43.29 | 57.99 | 120.21 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/001/summary.json) |
| 1 | 1,000 | 2119.43 | 433.58 | 465.00 | 1977.78 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/001/summary.json) |
| 2 | 1 | 975.62 | 0.98 | 1.30 | 1.94 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/002/summary.json) |
| 2 | 10 | 3519.84 | 2.62 | 5.08 | 6.70 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/002/summary.json) |
| 2 | 100 | 2416.14 | 41.88 | 50.29 | 58.42 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/002/summary.json) |
| 2 | 1,000 | 1506.28 | 452.32 | 2089.79 | 4464.08 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/002/summary.json) |
| 3 | 1 | 972.36 | 0.98 | 1.31 | 1.98 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/003/summary.json) |
| 3 | 10 | 3623.23 | 2.56 | 4.83 | 6.33 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/003/summary.json) |
| 3 | 100 | 2316.03 | 42.41 | 49.97 | 56.93 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/003/summary.json) |
| 3 | 1,000 | 2239.76 | 432.02 | 456.00 | 1211.43 | 0 | 0.00% | [JSON](read-list-throughput/nhost/javascript-sdk/20260904T064700Z-basic-js-v1-read-list-throughput-nhost-javascript-sdk-99533/trials/003/summary.json) |

#### Directus

Completed run [`20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642`](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/run.json), from 2026-09-04T06:50:53Z to 2026-09-04T06:55:18Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 397.98 | 2.30 | 3.94 | 4.29 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/001/summary.json) |
| 1 | 10 | 482.54 | 20.39 | 26.21 | 30.84 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/001/summary.json) |
| 1 | 100 | 485.33 | 203.36 | 214.10 | 357.52 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/001/summary.json) |
| 1 | 1,000 | 485.85 | 537.53 | 15965.54 | 16678.18 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/001/summary.json) |
| 2 | 1 | 404.66 | 2.28 | 3.71 | 4.10 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/002/summary.json) |
| 2 | 10 | 466.05 | 21.07 | 26.84 | 30.76 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/002/summary.json) |
| 2 | 100 | 486.98 | 197.91 | 262.35 | 744.16 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/002/summary.json) |
| 2 | 1,000 | 482.12 | 405.28 | 15761.79 | 16476.08 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/002/summary.json) |
| 3 | 1 | 401.89 | 2.29 | 3.66 | 4.31 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/003/summary.json) |
| 3 | 10 | 488.83 | 20.15 | 25.93 | 31.29 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/003/summary.json) |
| 3 | 100 | 484.30 | 203.24 | 231.04 | 384.00 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/003/summary.json) |
| 3 | 1,000 | 480.26 | 550.92 | 15932.95 | 16647.28 | 0 | 0.00% | [JSON](read-list-throughput/directus/javascript-sdk/20260904T065053Z-basic-js-v1-read-list-throughput-directus-javascript-sdk-642/trials/003/summary.json) |

#### PocketBase

Completed run [`20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730`](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/run.json), from 2026-09-04T06:55:19Z to 2026-09-04T06:59:32Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1362.14 | 0.53 | 1.86 | 4.74 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/001/summary.json) |
| 1 | 10 | 4236.63 | 1.70 | 6.31 | 8.77 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/001/summary.json) |
| 1 | 100 | 5006.35 | 15.66 | 56.90 | 98.74 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/001/summary.json) |
| 1 | 1,000 | 4399.71 | 131.66 | 395.64 | 815.00 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/001/summary.json) |
| 2 | 1 | 1189.51 | 0.57 | 2.37 | 5.19 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/002/summary.json) |
| 2 | 10 | 4246.72 | 1.70 | 6.33 | 8.60 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/002/summary.json) |
| 2 | 100 | 4636.52 | 17.08 | 58.37 | 101.68 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/002/summary.json) |
| 2 | 1,000 | 4133.42 | 133.43 | 447.88 | 1498.22 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/002/summary.json) |
| 3 | 1 | 1272.32 | 0.56 | 2.10 | 4.97 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/003/summary.json) |
| 3 | 10 | 4185.86 | 1.72 | 6.38 | 8.69 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/003/summary.json) |
| 3 | 100 | 4703.26 | 17.32 | 56.38 | 101.97 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/003/summary.json) |
| 3 | 1,000 | 4522.84 | 149.16 | 387.22 | 767.12 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/javascript-sdk/20260904T065519Z-basic-js-v1-read-list-throughput-pocketbase-javascript-sdk-2730/trials/003/summary.json) |

#### TrailBase

Completed run [`20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792`](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/run.json), from 2026-09-04T06:59:33Z to 2026-09-04T07:03:35Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1495.74 | 0.64 | 0.80 | 1.16 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/001/summary.json) |
| 1 | 10 | 4230.04 | 2.26 | 3.75 | 4.82 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/001/summary.json) |
| 1 | 100 | 4361.26 | 22.42 | 31.09 | 36.43 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/001/summary.json) |
| 1 | 1,000 | 3988.42 | 189.26 | 418.34 | 805.24 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/001/summary.json) |
| 2 | 1 | 1484.28 | 0.65 | 0.81 | 1.16 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/002/summary.json) |
| 2 | 10 | 4285.10 | 2.23 | 3.71 | 4.67 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/002/summary.json) |
| 2 | 100 | 4375.71 | 22.19 | 32.09 | 38.15 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/002/summary.json) |
| 2 | 1,000 | 2591.23 | 171.55 | 362.04 | 843.90 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/002/summary.json) |
| 3 | 1 | 1451.21 | 0.66 | 0.83 | 1.19 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/003/summary.json) |
| 3 | 10 | 4338.42 | 2.20 | 3.66 | 4.66 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/003/summary.json) |
| 3 | 100 | 4615.72 | 21.18 | 30.02 | 35.38 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/003/summary.json) |
| 3 | 1,000 | 2910.50 | 180.36 | 389.91 | 824.05 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/javascript-sdk/20260904T065933Z-basic-js-v1-read-list-throughput-trailbase-javascript-sdk-3792/trials/003/summary.json) |


### Item-read throughput

Fetch one deterministic pseudo-random baseline entry through each platform’s native primary-key API.

#### Supabase

Completed run [`20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819`](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/run.json), from 2026-09-04T07:03:36Z to 2026-09-04T07:08:05Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1098.87 | 0.86 | 1.20 | 1.83 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/001/summary.json) |
| 1 | 10 | 4378.81 | 2.13 | 3.81 | 5.00 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/001/summary.json) |
| 1 | 100 | 3786.87 | 25.26 | 35.75 | 47.55 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/001/summary.json) |
| 1 | 1,000 | 3515.89 | 277.54 | 321.36 | 403.43 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/001/summary.json) |
| 2 | 1 | 1115.72 | 0.86 | 1.12 | 1.59 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/002/summary.json) |
| 2 | 10 | 4422.69 | 2.12 | 3.71 | 4.86 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/002/summary.json) |
| 2 | 100 | 3694.52 | 25.74 | 38.07 | 52.86 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/002/summary.json) |
| 2 | 1,000 | 3492.69 | 280.32 | 319.06 | 410.38 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/002/summary.json) |
| 3 | 1 | 1082.32 | 0.89 | 1.14 | 1.64 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/003/summary.json) |
| 3 | 10 | 4389.71 | 2.13 | 3.74 | 5.00 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/003/summary.json) |
| 3 | 100 | 3772.96 | 25.46 | 36.15 | 45.10 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/003/summary.json) |
| 3 | 1,000 | 3421.16 | 286.97 | 335.46 | 354.55 | 0 | 0.00% | [JSON](read-item-throughput/supabase/javascript-sdk/20260904T070336Z-basic-js-v1-read-item-throughput-supabase-javascript-sdk-4819/trials/003/summary.json) |

#### Convex

Completed run [`20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654`](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/run.json), from 2026-09-04T07:08:06Z to 2026-09-04T07:13:55Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 985.94 | 1.29 | 1.94 | 2.75 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/001/summary.json) |
| 1 | 10 | 7054.35 | 0.95 | 4.15 | 6.17 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/001/summary.json) |
| 1 | 100 | 6866.58 | 12.17 | 34.56 | 48.14 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/001/summary.json) |
| 1 | 1,000 | 6581.29 | 121.04 | 344.27 | 446.51 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/001/summary.json) |
| 2 | 1 | 960.49 | 1.33 | 1.91 | 2.68 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/002/summary.json) |
| 2 | 10 | 7367.67 | 0.91 | 4.02 | 6.09 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/002/summary.json) |
| 2 | 100 | 7319.10 | 11.28 | 34.88 | 47.01 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/002/summary.json) |
| 2 | 1,000 | 6659.85 | 123.95 | 306.35 | 419.91 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/002/summary.json) |
| 3 | 1 | 964.24 | 1.32 | 1.97 | 2.78 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/003/summary.json) |
| 3 | 10 | 6972.21 | 0.92 | 4.14 | 6.30 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/003/summary.json) |
| 3 | 100 | 6794.71 | 11.75 | 35.66 | 56.56 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/003/summary.json) |
| 3 | 1,000 | 6718.67 | 123.58 | 307.80 | 365.15 | 0 | 0.00% | [JSON](read-item-throughput/convex/javascript-sdk/20260904T070806Z-basic-js-v1-read-item-throughput-convex-javascript-sdk-7654/trials/003/summary.json) |

#### Appwrite

Completed run [`20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734`](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/run.json), from 2026-09-04T07:13:56Z to 2026-09-04T07:18:38Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 159.63 | 5.66 | 10.03 | 12.49 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/001/summary.json) |
| 1 | 10 | 550.44 | 15.09 | 36.97 | 53.81 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/001/summary.json) |
| 1 | 100 | 769.75 | 89.83 | 361.26 | 629.69 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/001/summary.json) |
| 1 | 1,000 | 766.72 | 791.28 | 3870.22 | 5516.13 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/001/summary.json) |
| 2 | 1 | 199.64 | 4.50 | 7.87 | 9.80 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/002/summary.json) |
| 2 | 10 | 661.48 | 12.69 | 29.71 | 40.61 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/002/summary.json) |
| 2 | 100 | 792.34 | 85.47 | 342.26 | 592.23 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/002/summary.json) |
| 2 | 1,000 | 764.70 | 734.27 | 4220.39 | 8508.99 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/002/summary.json) |
| 3 | 1 | 191.61 | 4.69 | 8.17 | 11.25 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/003/summary.json) |
| 3 | 10 | 626.41 | 13.24 | 31.71 | 44.51 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/003/summary.json) |
| 3 | 100 | 792.44 | 91.38 | 331.04 | 521.61 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/003/summary.json) |
| 3 | 1,000 | 740.70 | 938.46 | 3658.78 | 4622.35 | 0 | 0.00% | [JSON](read-item-throughput/appwrite/javascript-sdk/20260904T071356Z-basic-js-v1-read-item-throughput-appwrite-javascript-sdk-11734/trials/003/summary.json) |

#### Nhost

Completed run [`20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822`](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/run.json), from 2026-09-04T07:18:39Z to 2026-09-04T07:22:32Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1133.77 | 0.83 | 1.11 | 2.13 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/001/summary.json) |
| 1 | 10 | 4443.03 | 2.05 | 4.14 | 5.69 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/001/summary.json) |
| 1 | 100 | 2622.41 | 38.80 | 48.80 | 57.66 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/001/summary.json) |
| 1 | 1,000 | 2172.17 | 410.81 | 520.37 | 2261.91 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/001/summary.json) |
| 2 | 1 | 1132.16 | 0.84 | 1.10 | 1.75 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/002/summary.json) |
| 2 | 10 | 3736.77 | 2.32 | 5.17 | 7.96 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/002/summary.json) |
| 2 | 100 | 2332.33 | 40.84 | 57.49 | 101.43 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/002/summary.json) |
| 2 | 1,000 | 2250.32 | 432.92 | 507.31 | 1366.75 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/002/summary.json) |
| 3 | 1 | 1124.01 | 0.84 | 1.11 | 2.07 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/003/summary.json) |
| 3 | 10 | 4413.01 | 2.06 | 4.20 | 5.72 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/003/summary.json) |
| 3 | 100 | 2507.51 | 39.30 | 48.57 | 55.63 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/003/summary.json) |
| 3 | 1,000 | 2290.87 | 430.93 | 452.94 | 861.69 | 0 | 0.00% | [JSON](read-item-throughput/nhost/javascript-sdk/20260904T071839Z-basic-js-v1-read-item-throughput-nhost-javascript-sdk-12822/trials/003/summary.json) |

#### Directus

Completed run [`20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786`](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/run.json), from 2026-09-04T07:22:33Z to 2026-09-04T07:27:01Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 346.70 | 2.48 | 4.50 | 5.14 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/001/summary.json) |
| 1 | 10 | 433.15 | 21.46 | 33.64 | 36.97 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/001/summary.json) |
| 1 | 100 | 481.05 | 181.35 | 362.81 | 620.37 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/001/summary.json) |
| 1 | 1,000 | 484.16 | 462.53 | 15797.29 | 16478.47 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/001/summary.json) |
| 2 | 1 | 393.02 | 2.27 | 3.89 | 4.83 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/002/summary.json) |
| 2 | 10 | 471.00 | 20.70 | 26.70 | 34.04 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/002/summary.json) |
| 2 | 100 | 497.44 | 195.46 | 233.35 | 570.93 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/002/summary.json) |
| 2 | 1,000 | 484.19 | 503.03 | 16116.37 | 16820.37 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/002/summary.json) |
| 3 | 1 | 383.69 | 2.36 | 4.04 | 4.72 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/003/summary.json) |
| 3 | 10 | 474.08 | 20.84 | 24.15 | 29.77 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/003/summary.json) |
| 3 | 100 | 491.89 | 198.66 | 214.96 | 440.62 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/003/summary.json) |
| 3 | 1,000 | 497.81 | 496.13 | 15805.53 | 16519.36 | 0 | 0.00% | [JSON](read-item-throughput/directus/javascript-sdk/20260904T072233Z-basic-js-v1-read-item-throughput-directus-javascript-sdk-13786/trials/003/summary.json) |

#### PocketBase

Completed run [`20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804`](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/run.json), from 2026-09-04T07:27:02Z to 2026-09-04T07:31:33Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 2313.62 | 0.30 | 1.07 | 3.26 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/001/summary.json) |
| 1 | 10 | 8168.78 | 0.96 | 3.13 | 4.79 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/001/summary.json) |
| 1 | 100 | 7923.47 | 8.87 | 45.02 | 77.29 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/001/summary.json) |
| 1 | 1,000 | 5807.04 | 101.78 | 267.38 | 348.66 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/001/summary.json) |
| 2 | 1 | 2260.75 | 0.33 | 1.01 | 3.49 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/002/summary.json) |
| 2 | 10 | 8102.24 | 0.97 | 3.18 | 4.84 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/002/summary.json) |
| 2 | 100 | 8027.03 | 8.89 | 44.44 | 75.55 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/002/summary.json) |
| 2 | 1,000 | 7761.75 | 110.70 | 279.03 | 638.77 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/002/summary.json) |
| 3 | 1 | 2290.85 | 0.32 | 1.01 | 3.43 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/003/summary.json) |
| 3 | 10 | 7564.93 | 1.04 | 3.36 | 5.15 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/003/summary.json) |
| 3 | 100 | 7493.63 | 10.40 | 33.19 | 71.03 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/003/summary.json) |
| 3 | 1,000 | 7675.20 | 113.47 | 269.65 | 366.20 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/javascript-sdk/20260904T072702Z-basic-js-v1-read-item-throughput-pocketbase-javascript-sdk-15804/trials/003/summary.json) |

#### TrailBase

Completed run [`20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831`](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/run.json), from 2026-09-04T07:31:33Z to 2026-09-04T07:35:23Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1799.72 | 0.53 | 0.66 | 0.93 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/001/summary.json) |
| 1 | 10 | 5134.58 | 1.85 | 3.11 | 4.44 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/001/summary.json) |
| 1 | 100 | 5685.70 | 16.39 | 25.16 | 31.71 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/001/summary.json) |
| 1 | 1,000 | 5167.40 | 113.77 | 348.19 | 1475.01 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/001/summary.json) |
| 2 | 1 | 1491.91 | 0.55 | 1.44 | 2.65 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/002/summary.json) |
| 2 | 10 | 4973.94 | 1.91 | 3.22 | 4.49 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/002/summary.json) |
| 2 | 100 | 5479.05 | 17.17 | 26.29 | 33.24 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/002/summary.json) |
| 2 | 1,000 | 5764.95 | 135.40 | 352.67 | 739.71 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/002/summary.json) |
| 3 | 1 | 1809.40 | 0.53 | 0.67 | 1.01 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/003/summary.json) |
| 3 | 10 | 4965.84 | 1.90 | 3.31 | 4.51 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/003/summary.json) |
| 3 | 100 | 5311.80 | 17.34 | 27.32 | 35.72 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/003/summary.json) |
| 3 | 1,000 | 5444.02 | 129.42 | 364.62 | 755.57 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/javascript-sdk/20260904T073133Z-basic-js-v1-read-item-throughput-trailbase-javascript-sdk-16831/trials/003/summary.json) |


### Write throughput

Create one guestbook entry and wait for the platform SDK/API acknowledgement; each successful write returns a native ID.

#### Supabase

Completed run [`20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078`](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/run.json), from 2026-09-04T05:57:37Z to 2026-09-04T06:02:19Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 604.39 | 1.59 | 2.17 | 2.96 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/001/summary.json) |
| 1 | 10 | 2998.00 | 3.14 | 5.32 | 6.84 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/001/summary.json) |
| 1 | 100 | 827.60 | 99.05 | 288.33 | 450.81 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/001/summary.json) |
| 1 | 1,000 | 764.95 | 1216.37 | 2049.71 | 2931.09 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/001/summary.json) |
| 2 | 1 | 628.20 | 1.52 | 2.11 | 2.91 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/002/summary.json) |
| 2 | 10 | 2721.47 | 3.35 | 6.13 | 8.44 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/002/summary.json) |
| 2 | 100 | 814.97 | 96.85 | 312.79 | 504.37 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/002/summary.json) |
| 2 | 1,000 | 708.19 | 1278.22 | 2320.03 | 4032.62 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/002/summary.json) |
| 3 | 1 | 611.00 | 1.56 | 2.18 | 2.91 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/003/summary.json) |
| 3 | 10 | 2936.60 | 3.21 | 5.41 | 6.84 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/003/summary.json) |
| 3 | 100 | 867.07 | 96.88 | 263.13 | 434.44 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/003/summary.json) |
| 3 | 1,000 | 726.45 | 1302.55 | 2090.33 | 2681.32 | 0 | 0.00% | [JSON](write-throughput/supabase/javascript-sdk/20260904T055737Z-basic-js-v1-write-throughput-supabase-javascript-sdk-76078/trials/003/summary.json) |

#### Convex

Completed run [`20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756`](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/run.json), from 2026-09-04T06:02:20Z to 2026-09-04T06:09:34Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 71.96 | 13.63 | 17.92 | 23.52 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/001/summary.json) |
| 1 | 10 | 129.41 | 77.32 | 124.51 | 149.65 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/001/summary.json) |
| 1 | 100 | 327.68 | 274.61 | 556.60 | 768.81 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/001/summary.json) |
| 1 | 1,000 | 356.79 | 2354.63 | 4748.74 | 4909.21 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/001/summary.json) |
| 2 | 1 | 70.53 | 14.00 | 19.32 | 22.73 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/002/summary.json) |
| 2 | 10 | 129.25 | 77.49 | 128.63 | 184.15 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/002/summary.json) |
| 2 | 100 | 389.17 | 239.84 | 404.79 | 639.23 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/002/summary.json) |
| 2 | 1,000 | 399.42 | 2374.29 | 4676.08 | 9389.34 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/002/summary.json) |
| 3 | 1 | 69.73 | 13.93 | 18.73 | 22.62 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/003/summary.json) |
| 3 | 10 | 112.17 | 85.58 | 157.79 | 289.68 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/003/summary.json) |
| 3 | 100 | 329.27 | 273.16 | 513.54 | 713.09 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/003/summary.json) |
| 3 | 1,000 | 388.95 | 2540.56 | 2846.53 | 2948.63 | 0 | 0.00% | [JSON](write-throughput/convex/javascript-sdk/20260904T060220Z-basic-js-v1-write-throughput-convex-javascript-sdk-79756/trials/003/summary.json) |

#### Appwrite

Completed run [`20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141`](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/run.json), from 2026-09-04T06:09:35Z to 2026-09-04T06:14:48Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 73.91 | 12.70 | 19.86 | 31.47 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/001/summary.json) |
| 1 | 10 | 280.95 | 26.54 | 80.67 | 127.30 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/001/summary.json) |
| 1 | 100 | 369.26 | 182.74 | 770.94 | 1378.74 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/001/summary.json) |
| 1 | 1,000 | 345.47 | 1935.64 | 7957.42 | 9796.87 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/001/summary.json) |
| 2 | 1 | 72.17 | 12.38 | 21.46 | 39.04 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/002/summary.json) |
| 2 | 10 | 265.30 | 28.49 | 83.89 | 129.50 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/002/summary.json) |
| 2 | 100 | 346.91 | 189.45 | 843.28 | 1479.02 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/002/summary.json) |
| 2 | 1,000 | 344.89 | 1131.24 | 10372.71 | 13400.26 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/002/summary.json) |
| 3 | 1 | 74.32 | 12.29 | 18.86 | 26.34 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/003/summary.json) |
| 3 | 10 | 279.36 | 27.47 | 81.24 | 111.80 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/003/summary.json) |
| 3 | 100 | 354.40 | 191.59 | 783.02 | 1241.57 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/003/summary.json) |
| 3 | 1,000 | 319.92 | 1626.58 | 8224.96 | 15606.30 | 0 | 0.00% | [JSON](write-throughput/appwrite/javascript-sdk/20260904T060935Z-basic-js-v1-write-throughput-appwrite-javascript-sdk-85141/trials/003/summary.json) |

#### Nhost

Completed run [`20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287`](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/run.json), from 2026-09-04T06:14:49Z to 2026-09-04T06:18:47Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 241.03 | 3.95 | 5.59 | 6.83 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/001/summary.json) |
| 1 | 10 | 1745.75 | 5.53 | 8.15 | 10.61 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/001/summary.json) |
| 1 | 100 | 1655.10 | 57.26 | 74.26 | 152.98 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/001/summary.json) |
| 1 | 1,000 | 458.03 | 1655.60 | 5409.23 | 7679.32 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/001/summary.json) |
| 2 | 1 | 244.98 | 3.92 | 5.55 | 7.43 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/002/summary.json) |
| 2 | 10 | 1797.83 | 5.34 | 7.97 | 10.41 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/002/summary.json) |
| 2 | 100 | 1803.58 | 55.05 | 67.63 | 79.36 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/002/summary.json) |
| 2 | 1,000 | 478.96 | 1545.17 | 5343.88 | 7839.78 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/002/summary.json) |
| 3 | 1 | 243.80 | 3.93 | 5.45 | 6.68 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/003/summary.json) |
| 3 | 10 | 1815.49 | 5.29 | 7.87 | 9.95 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/003/summary.json) |
| 3 | 100 | 1656.61 | 58.04 | 71.70 | 118.68 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/003/summary.json) |
| 3 | 1,000 | 455.89 | 1633.91 | 5613.74 | 8081.12 | 0 | 0.00% | [JSON](write-throughput/nhost/javascript-sdk/20260904T061449Z-basic-js-v1-write-throughput-nhost-javascript-sdk-86287/trials/003/summary.json) |

#### Directus

Completed run [`20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320`](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/run.json), from 2026-09-04T06:18:48Z to 2026-09-04T06:23:18Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 140.70 | 6.82 | 8.90 | 12.60 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/001/summary.json) |
| 1 | 10 | 281.13 | 34.93 | 45.51 | 52.35 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/001/summary.json) |
| 1 | 100 | 274.74 | 360.23 | 391.74 | 643.66 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/001/summary.json) |
| 1 | 1,000 | 244.50 | 3782.86 | 10046.61 | 11200.34 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/001/summary.json) |
| 2 | 1 | 138.58 | 6.90 | 9.26 | 12.12 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/002/summary.json) |
| 2 | 10 | 274.79 | 35.76 | 46.79 | 54.06 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/002/summary.json) |
| 2 | 100 | 268.46 | 363.76 | 462.22 | 683.50 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/002/summary.json) |
| 2 | 1,000 | 261.99 | 3765.67 | 8341.32 | 9567.32 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/002/summary.json) |
| 3 | 1 | 140.12 | 6.86 | 8.82 | 12.04 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/003/summary.json) |
| 3 | 10 | 279.13 | 35.16 | 45.59 | 51.93 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/003/summary.json) |
| 3 | 100 | 275.01 | 359.37 | 391.21 | 700.86 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/003/summary.json) |
| 3 | 1,000 | 266.98 | 3686.59 | 8417.97 | 9767.26 | 0 | 0.00% | [JSON](write-throughput/directus/javascript-sdk/20260904T061848Z-basic-js-v1-write-throughput-directus-javascript-sdk-87320/trials/003/summary.json) |

#### PocketBase

Completed run [`20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564`](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/run.json), from 2026-09-04T06:23:19Z to 2026-09-04T06:27:23Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1674.18 | 0.43 | 0.97 | 3.84 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/001/summary.json) |
| 1 | 10 | 3775.42 | 1.16 | 7.90 | 32.35 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/001/summary.json) |
| 1 | 100 | 4046.58 | 17.30 | 71.31 | 104.47 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/001/summary.json) |
| 1 | 1,000 | 4146.28 | 171.55 | 704.24 | 1081.12 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/001/summary.json) |
| 2 | 1 | 1652.85 | 0.44 | 0.79 | 3.70 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/002/summary.json) |
| 2 | 10 | 3400.71 | 1.21 | 8.70 | 37.86 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/002/summary.json) |
| 2 | 100 | 3914.03 | 17.88 | 74.62 | 107.17 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/002/summary.json) |
| 2 | 1,000 | 4184.14 | 171.03 | 690.66 | 1073.51 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/002/summary.json) |
| 3 | 1 | 1687.73 | 0.44 | 0.78 | 3.65 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/003/summary.json) |
| 3 | 10 | 3507.03 | 1.13 | 8.21 | 41.69 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/003/summary.json) |
| 3 | 100 | 4051.42 | 17.31 | 70.33 | 100.39 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/003/summary.json) |
| 3 | 1,000 | 4106.87 | 175.40 | 706.25 | 1078.20 | 0 | 0.00% | [JSON](write-throughput/pocketbase/javascript-sdk/20260904T062319Z-basic-js-v1-write-throughput-pocketbase-javascript-sdk-89564/trials/003/summary.json) |

#### TrailBase

Completed run [`20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611`](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/run.json), from 2026-09-04T06:27:24Z to 2026-09-04T06:31:36Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1460.23 | 0.66 | 0.82 | 1.19 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/001/summary.json) |
| 1 | 10 | 3867.35 | 2.44 | 4.13 | 5.66 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/001/summary.json) |
| 1 | 100 | 4774.33 | 20.15 | 29.71 | 35.13 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/001/summary.json) |
| 1 | 1,000 | 4631.50 | 164.02 | 384.64 | 757.99 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/001/summary.json) |
| 2 | 1 | 1494.57 | 0.64 | 0.82 | 1.27 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/002/summary.json) |
| 2 | 10 | 4038.87 | 2.38 | 3.85 | 5.12 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/002/summary.json) |
| 2 | 100 | 4837.70 | 20.01 | 29.40 | 35.67 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/002/summary.json) |
| 2 | 1,000 | 2220.48 | 148.20 | 355.28 | 753.47 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/002/summary.json) |
| 3 | 1 | 1429.94 | 0.67 | 0.83 | 1.22 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/003/summary.json) |
| 3 | 10 | 4088.95 | 2.35 | 3.78 | 5.02 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/003/summary.json) |
| 3 | 100 | 4982.73 | 19.48 | 28.33 | 33.59 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/003/summary.json) |
| 3 | 1,000 | 5156.74 | 151.90 | 363.59 | 738.19 | 0 | 0.00% | [JSON](write-throughput/trailbase/javascript-sdk/20260904T062723Z-basic-js-v1-write-throughput-trailbase-javascript-sdk-90611/trials/003/summary.json) |

## Interpretation boundaries

- These are short-duration, single-host, closed-loop measurements of specific anonymous SDK operations.
- SDK, local network, API, database, cache, and acknowledgement costs are intentionally combined.
- Platform defaults and acknowledgement semantics differ; write results do not prove identical durability.
- The results do not model authenticated ownership, WAN latency, mixed traffic, long-running stability, or production deployment.
- No average across trials, composite score, ranking, or winner is asserted.

## Evidence layout

Each completed case is published at:

```text
results/basic-js-v1/<benchmark>/<platform>/javascript-sdk/<run-id>/
```

Each bundle contains `run.json`, `environment.json`, three measured `summary.json` files, captured definitions, and definition checksums. Raw request output and logs are not published.
