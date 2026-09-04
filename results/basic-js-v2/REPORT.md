# Basic JavaScript database-path throughput — result report

> This report presents observed measurements from published evidence bundles. It does not rank platforms, name a winner, or combine direct database and server-extension paths into an overall score.

## What was tested

`basic-js-v2` measures the same guestbook list, item-read, and write semantics as `basic-js-v1`, through supported low-level database paths. PostgreSQL products use direct or bundled-pooler connections. Embedded-database products use separately labeled server-side extension paths.

## Test conditions

| Condition | Value |
|---|---|
| Baseline | 10,000 deterministic guestbook entries |
| Loads | 1, 10, 100, and 1,000 virtual users (VUs) |
| Worker model | Closed loop; one client/pool per VU; at most one in-flight operation per VU |
| Warm-up | One 5-second stage at every load |
| Measurement | Three 15-second trials at every load |
| Timing | Query/fetch promise through response parsing; setup, readiness, verification, and client cleanup are untimed |
| Retries and pacing | No retries, batching, think time, target request rate, or arrival pacing |
| Cache state | Existing platform, database, and OS caches retained |
| Host | Darwin / arm64 |
| Docker allocation | 8 CPUs; 7.82 GiB memory |
| Docker | Server 29.4.0; Compose 5.1.2 |

Twenty bundles use source commit `90007aeab3c5fd338fac665b3f6d0efba546a02a`. The corrected Directus write bundle uses `be73ef7938a5dff9bc3ea26f652325ebcaba2ea8`; that later definition adds Directus’s required database timestamp default and bounds untimed fixture verification. The measured SQL operation is otherwise unchanged.

## Platform coverage

| Case | Timed path |
|---|---|
| Neon | Node `pg` → compute PostgreSQL endpoint |
| Supabase direct | Node `pg` → directly published PostgreSQL port |
| Supabase pooler | Node `pg` → bundled Supavisor transaction pooler |
| Nhost | Node `pg` → PostgreSQL |
| Directus | Node `pg` → PostgreSQL |
| TrailBase | `fetch` → Rust WASM route → embedded SQLite |
| PocketBase | `fetch` → custom Go route → embedded SQLite |

Convex and Appwrite are excluded because their prepared deployments do not expose a supported comparable direct-database path. The extension paths include HTTP routing and runtime execution and must not be interpreted as direct client database connections.

## Results

Every table reports all three measured trials independently. Values are rounded for presentation; linked summaries retain full precision. Failed operations are excluded from latency percentiles and included in error rate.

### List-read throughput

Fetch the newest 20 guestbook entries.

#### Neon — direct PostgreSQL

Completed run [`20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987`](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/run.json), from 2026-09-04T15:52:16Z to 2026-09-04T16:01:15Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 6040.80 | 0.16 | 0.19 | 0.23 | 0 | 0.00% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/001/summary.json) |
| 1 | 10 | 16388.46 | 0.62 | 0.90 | 1.10 | 0 | 0.00% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/001/summary.json) |
| 1 | 100 | 14183.67 | 6.27 | 7.81 | 12.85 | 191 | 0.09% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/001/summary.json) |
| 1 | 1,000 | 2063.74 | 10.70 | 35.13 | 223.13 | 29,230 | 28.77% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/001/summary.json) |
| 2 | 1 | 5859.99 | 0.17 | 0.20 | 0.24 | 0 | 0.00% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/002/summary.json) |
| 2 | 10 | 16175.73 | 0.62 | 0.93 | 1.17 | 0 | 0.00% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/002/summary.json) |
| 2 | 100 | 13867.04 | 6.60 | 9.94 | 14.28 | 495 | 0.24% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/002/summary.json) |
| 2 | 1,000 | 2390.21 | 10.48 | 35.33 | 222.58 | 27,654 | 26.44% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/002/summary.json) |
| 3 | 1 | 5930.17 | 0.17 | 0.20 | 0.24 | 0 | 0.00% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/003/summary.json) |
| 3 | 10 | 16172.79 | 0.63 | 0.92 | 1.14 | 0 | 0.00% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/003/summary.json) |
| 3 | 100 | 14463.10 | 6.49 | 8.32 | 13.31 | 434 | 0.20% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/003/summary.json) |
| 3 | 1,000 | 2106.05 | 10.93 | 40.91 | 224.00 | 27,818 | 28.45% | [JSON](read-list-throughput/neon/direct-postgres/20260904T155216Z-basic-js-v2-read-list-throughput-neon-direct-postgres-11987/trials/003/summary.json) |

#### Supabase — direct PostgreSQL

Completed run [`20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309`](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/run.json), from 2026-09-04T16:01:16Z to 2026-09-04T16:06:33Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 4664.89 | 0.21 | 0.26 | 0.33 | 0 | 0.00% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/001/summary.json) |
| 1 | 10 | 15347.74 | 0.66 | 0.95 | 1.16 | 0 | 0.00% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/001/summary.json) |
| 1 | 100 | 8953.77 | 7.46 | 12.30 | 16.76 | 8,859 | 5.99% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/001/summary.json) |
| 1 | 1,000 | 2319.01 | 12.69 | 31.17 | 220.07 | 26,086 | 28.69% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/001/summary.json) |
| 2 | 1 | 4755.51 | 0.20 | 0.25 | 0.30 | 0 | 0.00% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/002/summary.json) |
| 2 | 10 | 15096.32 | 0.67 | 0.97 | 1.22 | 0 | 0.00% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/002/summary.json) |
| 2 | 100 | 9225.58 | 7.33 | 10.87 | 14.83 | 10,712 | 6.78% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/002/summary.json) |
| 2 | 1,000 | 2901.43 | 14.31 | 31.95 | 219.45 | 27,630 | 30.68% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/002/summary.json) |
| 3 | 1 | 4693.45 | 0.21 | 0.25 | 0.31 | 0 | 0.00% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/003/summary.json) |
| 3 | 10 | 14700.56 | 0.68 | 1.01 | 1.28 | 0 | 0.00% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/003/summary.json) |
| 3 | 100 | 9098.11 | 7.67 | 11.48 | 14.63 | 8,827 | 5.81% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/003/summary.json) |
| 3 | 1,000 | 3395.47 | 14.93 | 37.15 | 221.51 | 27,125 | 30.88% | [JSON](read-list-throughput/supabase/direct-postgres/20260904T160116Z-basic-js-v2-read-list-throughput-supabase-direct-postgres-20309/trials/003/summary.json) |

#### Supabase — Supavisor pooler

Completed run [`20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163`](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/run.json), from 2026-09-04T16:06:34Z to 2026-09-04T16:12:15Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 3966.54 | 0.25 | 0.30 | 0.37 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/001/summary.json) |
| 1 | 10 | 12926.47 | 0.71 | 1.18 | 1.58 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/001/summary.json) |
| 1 | 100 | 11993.03 | 7.14 | 13.79 | 18.36 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/001/summary.json) |
| 1 | 1,000 | 2607.95 | 13.74 | 42.11 | 223.91 | 50,113 | 44.54% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/001/summary.json) |
| 2 | 1 | 3928.12 | 0.25 | 0.30 | 0.36 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/002/summary.json) |
| 2 | 10 | 13030.51 | 0.71 | 1.17 | 1.56 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/002/summary.json) |
| 2 | 100 | 11945.58 | 7.22 | 13.45 | 17.90 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/002/summary.json) |
| 2 | 1,000 | 1868.76 | 15.09 | 46.77 | 230.77 | 49,614 | 45.48% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/002/summary.json) |
| 3 | 1 | 3925.86 | 0.25 | 0.31 | 0.36 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/003/summary.json) |
| 3 | 10 | 12856.97 | 0.72 | 1.19 | 1.63 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/003/summary.json) |
| 3 | 100 | 11383.52 | 7.47 | 14.52 | 19.38 | 0 | 0.00% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/003/summary.json) |
| 3 | 1,000 | 2018.96 | 15.65 | 41.79 | 222.65 | 51,014 | 43.90% | [JSON](read-list-throughput/supabase/pooler-postgres/20260904T160634Z-basic-js-v2-read-list-throughput-supabase-pooler-postgres-27163/trials/003/summary.json) |

#### Nhost — direct PostgreSQL

Completed run [`20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086`](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/run.json), from 2026-09-04T16:12:16Z to 2026-09-04T16:18:00Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 6031.72 | 0.16 | 0.19 | 0.23 | 0 | 0.00% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/001/summary.json) |
| 1 | 10 | 16244.47 | 0.64 | 0.91 | 1.09 | 0 | 0.00% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/001/summary.json) |
| 1 | 100 | 13265.19 | 6.77 | 8.65 | 12.82 | 3,078 | 1.52% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/001/summary.json) |
| 1 | 1,000 | 1714.62 | 11.11 | 43.02 | 231.38 | 32,329 | 34.91% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/001/summary.json) |
| 2 | 1 | 6032.13 | 0.16 | 0.19 | 0.23 | 0 | 0.00% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/002/summary.json) |
| 2 | 10 | 15090.66 | 0.63 | 1.05 | 1.95 | 0 | 0.00% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/002/summary.json) |
| 2 | 100 | 13574.61 | 6.59 | 8.25 | 13.08 | 2,820 | 1.37% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/002/summary.json) |
| 2 | 1,000 | 1958.03 | 12.18 | 46.48 | 234.85 | 32,934 | 35.82% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/002/summary.json) |
| 3 | 1 | 5984.70 | 0.16 | 0.20 | 0.24 | 0 | 0.00% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/003/summary.json) |
| 3 | 10 | 16162.64 | 0.63 | 0.91 | 1.11 | 0 | 0.00% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/003/summary.json) |
| 3 | 100 | 14330.55 | 6.33 | 7.72 | 12.70 | 1,008 | 0.47% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/003/summary.json) |
| 3 | 1,000 | 1709.98 | 10.61 | 50.29 | 230.34 | 32,245 | 35.07% | [JSON](read-list-throughput/nhost/direct-postgres/20260904T161216Z-basic-js-v2-read-list-throughput-nhost-direct-postgres-34086/trials/003/summary.json) |

#### Directus — direct PostgreSQL

Completed run [`20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036`](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/run.json), from 2026-09-04T16:18:01Z to 2026-09-04T16:24:21Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 4962.84 | 0.20 | 0.23 | 0.28 | 0 | 0.00% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/001/summary.json) |
| 1 | 10 | 15574.66 | 0.67 | 0.94 | 1.09 | 0 | 0.00% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/001/summary.json) |
| 1 | 100 | 13537.81 | 6.98 | 8.66 | 13.81 | 1,300 | 0.64% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/001/summary.json) |
| 1 | 1,000 | 2841.37 | 17.16 | 40.48 | 220.58 | 28,194 | 29.93% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/001/summary.json) |
| 2 | 1 | 4918.34 | 0.20 | 0.24 | 0.29 | 0 | 0.00% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/002/summary.json) |
| 2 | 10 | 15352.99 | 0.68 | 0.96 | 1.12 | 0 | 0.00% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/002/summary.json) |
| 2 | 100 | 13321.55 | 7.03 | 9.06 | 13.92 | 1,284 | 0.64% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/002/summary.json) |
| 2 | 1,000 | 3121.19 | 17.17 | 37.76 | 224.47 | 28,132 | 29.61% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/002/summary.json) |
| 3 | 1 | 4952.57 | 0.20 | 0.24 | 0.30 | 0 | 0.00% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/003/summary.json) |
| 3 | 10 | 15579.86 | 0.67 | 0.94 | 1.10 | 0 | 0.00% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/003/summary.json) |
| 3 | 100 | 13436.22 | 7.00 | 8.75 | 13.86 | 1,378 | 0.68% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/003/summary.json) |
| 3 | 1,000 | 2969.20 | 18.50 | 40.18 | 227.02 | 28,878 | 32.08% | [JSON](read-list-throughput/directus/direct-postgres/20260904T161801Z-basic-js-v2-read-list-throughput-directus-direct-postgres-39036/trials/003/summary.json) |

#### TrailBase — Rust WASM extension

Completed run [`20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044`](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/run.json), from 2026-09-04T15:47:06Z to 2026-09-04T15:51:51Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1088.55 | 0.87 | 1.24 | 1.70 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/001/summary.json) |
| 1 | 10 | 2915.03 | 3.35 | 5.08 | 6.26 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/001/summary.json) |
| 1 | 100 | 3485.05 | 22.15 | 44.02 | 231.95 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/001/summary.json) |
| 1 | 1,000 | 2582.18 | 164.19 | 680.42 | 2212.82 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/001/summary.json) |
| 2 | 1 | 1082.92 | 0.89 | 1.12 | 1.61 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/002/summary.json) |
| 2 | 10 | 3053.68 | 3.21 | 4.84 | 5.90 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/002/summary.json) |
| 2 | 100 | 3685.06 | 20.44 | 37.15 | 232.46 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/002/summary.json) |
| 2 | 1,000 | 2121.94 | 149.99 | 749.24 | 2700.26 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/002/summary.json) |
| 3 | 1 | 1109.26 | 0.87 | 1.12 | 1.58 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/003/summary.json) |
| 3 | 10 | 2981.65 | 3.27 | 5.05 | 6.17 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/003/summary.json) |
| 3 | 100 | 3743.09 | 22.60 | 37.13 | 229.57 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/003/summary.json) |
| 3 | 1,000 | 2414.29 | 162.01 | 725.25 | 1890.59 | 0 | 0.00% | [JSON](read-list-throughput/trailbase/rust-wasm/20260904T154706Z-basic-js-v2-read-list-throughput-trailbase-rust-wasm-7044/trials/003/summary.json) |

#### PocketBase — Go extension

Completed run [`20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931`](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/run.json), from 2026-09-04T16:24:22Z to 2026-09-04T16:29:14Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 2467.35 | 0.27 | 0.99 | 3.50 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/001/summary.json) |
| 1 | 10 | 6625.30 | 1.16 | 3.71 | 5.60 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/001/summary.json) |
| 1 | 100 | 6881.31 | 11.77 | 42.19 | 68.87 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/001/summary.json) |
| 1 | 1,000 | 6058.43 | 119.47 | 289.90 | 369.93 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/001/summary.json) |
| 2 | 1 | 2217.57 | 0.31 | 1.08 | 3.77 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/002/summary.json) |
| 2 | 10 | 6456.71 | 1.16 | 4.03 | 5.70 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/002/summary.json) |
| 2 | 100 | 7133.87 | 10.94 | 42.19 | 69.98 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/002/summary.json) |
| 2 | 1,000 | 7092.81 | 125.34 | 286.73 | 361.02 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/002/summary.json) |
| 3 | 1 | 2196.52 | 0.31 | 1.06 | 3.85 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/003/summary.json) |
| 3 | 10 | 6823.25 | 1.18 | 3.40 | 4.83 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/003/summary.json) |
| 3 | 100 | 6941.35 | 11.40 | 43.40 | 69.52 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/003/summary.json) |
| 3 | 1,000 | 6867.46 | 127.74 | 284.10 | 404.19 | 0 | 0.00% | [JSON](read-list-throughput/pocketbase/go-extension/20260904T162422Z-basic-js-v2-read-list-throughput-pocketbase-go-extension-44931/trials/003/summary.json) |

### Item-read throughput

Fetch one deterministic baseline entry by native primary ID.

#### Neon — direct PostgreSQL

Completed run [`20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795`](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/run.json), from 2026-09-04T16:29:15Z to 2026-09-04T16:35:43Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 3308.46 | 0.23 | 0.46 | 1.09 | 0 | 0.00% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/001/summary.json) |
| 1 | 10 | 11090.24 | 0.71 | 2.25 | 3.35 | 0 | 0.00% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/001/summary.json) |
| 1 | 100 | 9351.76 | 10.36 | 23.23 | 28.86 | 4,100 | 2.84% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/001/summary.json) |
| 1 | 1,000 | 2421.58 | 12.37 | 36.86 | 213.44 | 20,193 | 19.20% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/001/summary.json) |
| 2 | 1 | 3278.66 | 0.23 | 0.47 | 1.10 | 0 | 0.00% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/002/summary.json) |
| 2 | 10 | 11162.53 | 0.69 | 2.22 | 3.30 | 0 | 0.00% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/002/summary.json) |
| 2 | 100 | 9649.00 | 10.03 | 22.49 | 28.12 | 3,350 | 2.26% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/002/summary.json) |
| 2 | 1,000 | 2476.53 | 11.02 | 38.86 | 218.06 | 20,471 | 20.38% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/002/summary.json) |
| 3 | 1 | 3331.71 | 0.22 | 0.46 | 1.07 | 0 | 0.00% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/003/summary.json) |
| 3 | 10 | 11083.87 | 0.71 | 2.25 | 3.36 | 0 | 0.00% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/003/summary.json) |
| 3 | 100 | 9467.36 | 10.15 | 22.56 | 28.45 | 2,996 | 2.06% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/003/summary.json) |
| 3 | 1,000 | 1650.86 | 13.53 | 38.76 | 212.91 | 19,533 | 18.75% | [JSON](read-item-throughput/neon/direct-postgres/20260904T162915Z-basic-js-v2-read-item-throughput-neon-direct-postgres-49795/trials/003/summary.json) |

#### Supabase — direct PostgreSQL

Completed run [`20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599`](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/run.json), from 2026-09-04T16:35:44Z to 2026-09-04T16:41:46Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 6852.10 | 0.14 | 0.18 | 0.23 | 0 | 0.00% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/001/summary.json) |
| 1 | 10 | 22279.61 | 0.42 | 0.72 | 1.00 | 0 | 0.00% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/001/summary.json) |
| 1 | 100 | 15840.32 | 2.72 | 7.38 | 11.71 | 5,961 | 2.31% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/001/summary.json) |
| 1 | 1,000 | 5030.70 | 3.15 | 14.24 | 206.81 | 19,187 | 11.92% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/001/summary.json) |
| 2 | 1 | 6147.85 | 0.16 | 0.20 | 0.25 | 0 | 0.00% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/002/summary.json) |
| 2 | 10 | 22374.56 | 0.42 | 0.72 | 1.00 | 0 | 0.00% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/002/summary.json) |
| 2 | 100 | 13182.83 | 2.96 | 7.80 | 201.55 | 9,447 | 4.29% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/002/summary.json) |
| 2 | 1,000 | 2496.00 | 3.42 | 14.11 | 207.22 | 19,975 | 12.93% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/002/summary.json) |
| 3 | 1 | 5879.01 | 0.17 | 0.20 | 0.25 | 0 | 0.00% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/003/summary.json) |
| 3 | 10 | 22040.86 | 0.42 | 0.74 | 1.01 | 0 | 0.00% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/003/summary.json) |
| 3 | 100 | 13165.23 | 3.38 | 8.28 | 32.51 | 8,295 | 3.81% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/003/summary.json) |
| 3 | 1,000 | 4443.15 | 3.81 | 14.73 | 208.50 | 20,128 | 14.09% | [JSON](read-item-throughput/supabase/direct-postgres/20260904T163544Z-basic-js-v2-read-item-throughput-supabase-direct-postgres-56599/trials/003/summary.json) |

#### Supabase — Supavisor pooler

Completed run [`20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466`](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/run.json), from 2026-09-04T16:41:47Z to 2026-09-04T16:47:36Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 4813.82 | 0.21 | 0.26 | 0.32 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/001/summary.json) |
| 1 | 10 | 15599.21 | 0.60 | 1.02 | 1.43 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/001/summary.json) |
| 1 | 100 | 17473.11 | 4.76 | 8.54 | 13.71 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/001/summary.json) |
| 1 | 1,000 | 1580.90 | 6.27 | 206.58 | 237.42 | 57,533 | 51.67% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/001/summary.json) |
| 2 | 1 | 4780.18 | 0.21 | 0.25 | 0.31 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/002/summary.json) |
| 2 | 10 | 15675.97 | 0.59 | 1.01 | 1.40 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/002/summary.json) |
| 2 | 100 | 17798.94 | 4.57 | 8.43 | 13.59 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/002/summary.json) |
| 2 | 1,000 | 1669.94 | 6.50 | 207.40 | 227.68 | 54,921 | 51.76% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/002/summary.json) |
| 3 | 1 | 4800.25 | 0.21 | 0.25 | 0.32 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/003/summary.json) |
| 3 | 10 | 15595.76 | 0.60 | 1.02 | 1.43 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/003/summary.json) |
| 3 | 100 | 18145.45 | 4.36 | 8.13 | 13.26 | 0 | 0.00% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/003/summary.json) |
| 3 | 1,000 | 1814.29 | 5.16 | 204.54 | 221.92 | 57,696 | 47.87% | [JSON](read-item-throughput/supabase/pooler-postgres/20260904T164147Z-basic-js-v2-read-item-throughput-supabase-pooler-postgres-63466/trials/003/summary.json) |

#### Nhost — direct PostgreSQL

Completed run [`20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337`](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/run.json), from 2026-09-04T16:47:38Z to 2026-09-04T16:53:48Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 8257.51 | 0.12 | 0.15 | 0.20 | 0 | 0.00% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/001/summary.json) |
| 1 | 10 | 26177.04 | 0.32 | 0.78 | 1.13 | 0 | 0.00% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/001/summary.json) |
| 1 | 100 | 22438.26 | 1.92 | 5.64 | 10.14 | 3,776 | 1.05% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/001/summary.json) |
| 1 | 1,000 | 3777.50 | 2.35 | 16.46 | 212.03 | 27,669 | 19.29% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/001/summary.json) |
| 2 | 1 | 7919.26 | 0.12 | 0.15 | 0.19 | 0 | 0.00% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/002/summary.json) |
| 2 | 10 | 26555.88 | 0.31 | 0.78 | 1.10 | 0 | 0.00% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/002/summary.json) |
| 2 | 100 | 21591.88 | 1.76 | 5.54 | 12.33 | 5,401 | 1.55% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/002/summary.json) |
| 2 | 1,000 | 2785.95 | 2.92 | 20.79 | 213.69 | 29,109 | 23.19% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/002/summary.json) |
| 3 | 1 | 7858.41 | 0.12 | 0.15 | 0.19 | 0 | 0.00% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/003/summary.json) |
| 3 | 10 | 26515.17 | 0.31 | 0.78 | 1.10 | 0 | 0.00% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/003/summary.json) |
| 3 | 100 | 23303.06 | 2.05 | 5.45 | 9.93 | 3,874 | 1.09% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/003/summary.json) |
| 3 | 1,000 | 2906.45 | 2.84 | 24.73 | 215.09 | 29,183 | 22.75% | [JSON](read-item-throughput/nhost/direct-postgres/20260904T164738Z-basic-js-v2-read-item-throughput-nhost-direct-postgres-70337/trials/003/summary.json) |

#### Directus — direct PostgreSQL

Completed run [`20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301`](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/run.json), from 2026-09-04T16:53:49Z to 2026-09-04T16:59:39Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 6061.71 | 0.16 | 0.20 | 0.25 | 0 | 0.00% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/001/summary.json) |
| 1 | 10 | 22742.06 | 0.41 | 0.70 | 0.94 | 0 | 0.00% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/001/summary.json) |
| 1 | 100 | 22287.99 | 2.37 | 6.32 | 10.81 | 1,451 | 0.43% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/001/summary.json) |
| 1 | 1,000 | 5082.22 | 3.17 | 17.45 | 210.84 | 21,938 | 13.41% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/001/summary.json) |
| 2 | 1 | 6067.00 | 0.16 | 0.20 | 0.24 | 0 | 0.00% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/002/summary.json) |
| 2 | 10 | 23601.60 | 0.40 | 0.66 | 0.88 | 0 | 0.00% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/002/summary.json) |
| 2 | 100 | 21306.86 | 2.65 | 6.25 | 10.30 | 1,395 | 0.41% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/002/summary.json) |
| 2 | 1,000 | 4446.41 | 2.96 | 19.11 | 211.77 | 21,537 | 13.86% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/002/summary.json) |
| 3 | 1 | 5951.91 | 0.16 | 0.20 | 0.26 | 0 | 0.00% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/003/summary.json) |
| 3 | 10 | 23504.16 | 0.40 | 0.67 | 0.88 | 0 | 0.00% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/003/summary.json) |
| 3 | 100 | 20682.61 | 2.51 | 6.30 | 11.19 | 1,670 | 0.51% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/003/summary.json) |
| 3 | 1,000 | 3846.80 | 4.01 | 22.01 | 214.89 | 19,684 | 14.52% | [JSON](read-item-throughput/directus/direct-postgres/20260904T165349Z-basic-js-v2-read-item-throughput-directus-direct-postgres-75301/trials/003/summary.json) |

#### TrailBase — Rust WASM extension

Completed run [`20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230`](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/run.json), from 2026-09-04T16:59:40Z to 2026-09-04T17:04:21Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1197.19 | 0.78 | 1.18 | 1.82 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/001/summary.json) |
| 1 | 10 | 3394.18 | 2.87 | 4.51 | 5.79 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/001/summary.json) |
| 1 | 100 | 4519.95 | 19.20 | 32.38 | 214.35 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/001/summary.json) |
| 1 | 1,000 | 2721.51 | 132.94 | 664.78 | 1651.70 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/001/summary.json) |
| 2 | 1 | 1205.56 | 0.78 | 1.13 | 1.52 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/002/summary.json) |
| 2 | 10 | 3441.04 | 2.82 | 4.54 | 5.83 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/002/summary.json) |
| 2 | 100 | 4598.29 | 19.03 | 31.46 | 213.06 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/002/summary.json) |
| 2 | 1,000 | 2713.88 | 149.77 | 473.87 | 1480.84 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/002/summary.json) |
| 3 | 1 | 1156.02 | 0.80 | 1.26 | 1.70 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/003/summary.json) |
| 3 | 10 | 3448.47 | 2.82 | 4.43 | 5.65 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/003/summary.json) |
| 3 | 100 | 4621.70 | 18.24 | 30.69 | 215.56 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/003/summary.json) |
| 3 | 1,000 | 2740.38 | 151.44 | 535.43 | 1236.21 | 0 | 0.00% | [JSON](read-item-throughput/trailbase/rust-wasm/20260904T165940Z-basic-js-v2-read-item-throughput-trailbase-rust-wasm-81230/trials/003/summary.json) |

#### PocketBase — Go extension

Completed run [`20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141`](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/run.json), from 2026-09-04T17:04:22Z to 2026-09-04T17:09:31Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 3054.85 | 0.20 | 1.01 | 3.14 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/001/summary.json) |
| 1 | 10 | 9955.45 | 0.76 | 2.78 | 4.15 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/001/summary.json) |
| 1 | 100 | 9319.29 | 7.08 | 42.77 | 66.44 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/001/summary.json) |
| 1 | 1,000 | 9415.16 | 96.09 | 185.12 | 296.06 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/001/summary.json) |
| 2 | 1 | 2989.48 | 0.21 | 1.00 | 3.26 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/002/summary.json) |
| 2 | 10 | 9962.00 | 0.76 | 2.76 | 4.15 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/002/summary.json) |
| 2 | 100 | 9069.47 | 6.74 | 46.25 | 69.29 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/002/summary.json) |
| 2 | 1,000 | 9053.17 | 94.68 | 196.55 | 309.41 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/002/summary.json) |
| 3 | 1 | 2967.01 | 0.22 | 1.00 | 3.34 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/003/summary.json) |
| 3 | 10 | 9876.54 | 0.77 | 2.73 | 4.23 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/003/summary.json) |
| 3 | 100 | 8855.70 | 7.08 | 45.87 | 69.51 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/003/summary.json) |
| 3 | 1,000 | 8956.43 | 98.75 | 210.91 | 320.74 | 0 | 0.00% | [JSON](read-item-throughput/pocketbase/go-extension/20260904T170422Z-basic-js-v2-read-item-throughput-pocketbase-go-extension-86141/trials/003/summary.json) |

### Write throughput

Insert one guestbook entry and return its native ID.

#### Neon — direct PostgreSQL

Completed run [`20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952`](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/run.json), from 2026-09-04T17:09:33Z to 2026-09-04T17:16:08Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 284.58 | 3.20 | 5.86 | 8.38 | 0 | 0.00% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/001/summary.json) |
| 1 | 10 | 1491.18 | 6.21 | 10.77 | 15.45 | 0 | 0.00% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/001/summary.json) |
| 1 | 100 | 1671.77 | 53.58 | 101.65 | 174.28 | 2,152 | 7.89% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/001/summary.json) |
| 1 | 1,000 | 356.57 | 104.61 | 295.35 | 715.39 | 24,651 | 67.58% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/001/summary.json) |
| 2 | 1 | 193.37 | 4.50 | 8.98 | 12.93 | 0 | 0.00% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/002/summary.json) |
| 2 | 10 | 1232.12 | 7.47 | 12.71 | 15.56 | 0 | 0.00% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/002/summary.json) |
| 2 | 100 | 1106.50 | 79.30 | 190.18 | 290.41 | 4,734 | 22.17% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/002/summary.json) |
| 2 | 1,000 | 201.63 | 115.34 | 363.34 | 794.65 | 24,565 | 70.44% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/002/summary.json) |
| 3 | 1 | 192.92 | 4.70 | 9.00 | 12.16 | 0 | 0.00% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/003/summary.json) |
| 3 | 10 | 1042.86 | 8.54 | 16.33 | 25.21 | 0 | 0.00% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/003/summary.json) |
| 3 | 100 | 959.51 | 90.41 | 183.26 | 477.89 | 5,454 | 27.39% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/003/summary.json) |
| 3 | 1,000 | 532.86 | 54.24 | 256.91 | 717.59 | 24,721 | 57.18% | [JSON](write-throughput/neon/direct-postgres/20260904T170933Z-basic-js-v2-write-throughput-neon-direct-postgres-90952/trials/003/summary.json) |

#### Supabase — direct PostgreSQL

Completed run [`20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720`](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/run.json), from 2026-09-04T17:16:09Z to 2026-09-04T17:22:27Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 2370.93 | 0.33 | 0.83 | 1.96 | 0 | 0.00% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/001/summary.json) |
| 1 | 10 | 8797.57 | 0.97 | 2.30 | 3.51 | 0 | 0.00% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/001/summary.json) |
| 1 | 100 | 6548.03 | 6.09 | 15.44 | 206.57 | 9,830 | 7.77% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/001/summary.json) |
| 1 | 1,000 | 2803.93 | 7.50 | 25.57 | 213.18 | 19,348 | 19.74% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/001/summary.json) |
| 2 | 1 | 2988.07 | 0.29 | 0.46 | 1.61 | 0 | 0.00% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/002/summary.json) |
| 2 | 10 | 9910.74 | 0.89 | 2.02 | 2.64 | 0 | 0.00% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/002/summary.json) |
| 2 | 100 | 7625.71 | 5.89 | 14.79 | 206.72 | 11,225 | 8.58% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/002/summary.json) |
| 2 | 1,000 | 2581.03 | 7.31 | 30.39 | 217.89 | 18,667 | 20.46% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/002/summary.json) |
| 3 | 1 | 2613.18 | 0.31 | 0.60 | 1.85 | 0 | 0.00% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/003/summary.json) |
| 3 | 10 | 9124.85 | 0.95 | 2.13 | 3.11 | 0 | 0.00% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/003/summary.json) |
| 3 | 100 | 7219.02 | 6.13 | 15.33 | 207.29 | 10,680 | 8.59% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/003/summary.json) |
| 3 | 1,000 | 1221.61 | 7.99 | 28.15 | 217.31 | 19,635 | 21.10% | [JSON](write-throughput/supabase/direct-postgres/20260904T171609Z-basic-js-v2-write-throughput-supabase-direct-postgres-98720/trials/003/summary.json) |

#### Supabase — Supavisor pooler

Completed run [`20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833`](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/run.json), from 2026-09-04T17:22:28Z to 2026-09-04T17:28:32Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 2220.35 | 0.35 | 1.27 | 1.82 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/001/summary.json) |
| 1 | 10 | 6614.85 | 1.28 | 2.95 | 4.78 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/001/summary.json) |
| 1 | 100 | 9167.70 | 10.38 | 15.30 | 18.51 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/001/summary.json) |
| 1 | 1,000 | 1281.41 | 9.99 | 210.37 | 289.65 | 50,492 | 53.29% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/001/summary.json) |
| 2 | 1 | 2082.36 | 0.36 | 1.32 | 1.94 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/002/summary.json) |
| 2 | 10 | 6029.98 | 1.37 | 3.46 | 5.33 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/002/summary.json) |
| 2 | 100 | 9127.20 | 9.99 | 14.30 | 19.76 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/002/summary.json) |
| 2 | 1,000 | 1350.75 | 9.67 | 209.46 | 235.45 | 54,742 | 53.57% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/002/summary.json) |
| 3 | 1 | 2397.87 | 0.35 | 0.74 | 1.71 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/003/summary.json) |
| 3 | 10 | 6935.51 | 1.25 | 2.78 | 4.11 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/003/summary.json) |
| 3 | 100 | 9432.29 | 10.18 | 14.47 | 18.16 | 0 | 0.00% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/003/summary.json) |
| 3 | 1,000 | 1362.90 | 9.70 | 209.59 | 239.82 | 56,981 | 54.74% | [JSON](write-throughput/supabase/pooler-postgres/20260904T172228Z-basic-js-v2-write-throughput-supabase-pooler-postgres-6833/trials/003/summary.json) |

#### Nhost — direct PostgreSQL

Completed run [`20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751`](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/run.json), from 2026-09-04T17:28:33Z to 2026-09-04T17:33:57Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 359.59 | 2.56 | 4.48 | 6.28 | 0 | 0.00% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/001/summary.json) |
| 1 | 10 | 4654.06 | 1.64 | 3.90 | 11.48 | 0 | 0.00% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/001/summary.json) |
| 1 | 100 | 7613.02 | 8.85 | 18.65 | 203.27 | 11,221 | 8.76% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/001/summary.json) |
| 1 | 1,000 | 1231.37 | 15.92 | 212.17 | 267.85 | 26,430 | 40.24% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/001/summary.json) |
| 2 | 1 | 343.30 | 2.85 | 4.00 | 5.84 | 0 | 0.00% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/002/summary.json) |
| 2 | 10 | 5446.29 | 1.54 | 3.01 | 5.66 | 0 | 0.00% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/002/summary.json) |
| 2 | 100 | 9017.98 | 7.87 | 15.09 | 44.32 | 11,301 | 7.48% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/002/summary.json) |
| 2 | 1,000 | 2439.36 | 12.52 | 38.53 | 220.12 | 25,926 | 27.71% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/002/summary.json) |
| 3 | 1 | 357.06 | 2.58 | 4.19 | 6.39 | 0 | 0.00% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/003/summary.json) |
| 3 | 10 | 5615.43 | 1.52 | 3.06 | 5.08 | 0 | 0.00% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/003/summary.json) |
| 3 | 100 | 9244.19 | 7.86 | 14.84 | 56.00 | 10,716 | 7.10% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/003/summary.json) |
| 3 | 1,000 | 1394.11 | 13.72 | 210.37 | 250.63 | 29,163 | 39.12% | [JSON](write-throughput/nhost/direct-postgres/20260904T172833Z-basic-js-v2-write-throughput-nhost-direct-postgres-14751/trials/003/summary.json) |

#### Directus — direct PostgreSQL

Completed run [`20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889`](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/run.json), from 2026-09-04T18:04:53Z to 2026-09-04T18:11:22Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 420.50 | 2.27 | 3.43 | 4.40 | 0 | 0.00% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/001/summary.json) |
| 1 | 10 | 5234.51 | 1.66 | 3.32 | 4.61 | 0 | 0.00% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/001/summary.json) |
| 1 | 100 | 11329.57 | 6.36 | 12.49 | 21.10 | 2,823 | 1.62% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/001/summary.json) |
| 1 | 1,000 | 2379.83 | 12.12 | 45.27 | 225.39 | 21,995 | 24.03% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/001/summary.json) |
| 2 | 1 | 446.46 | 2.12 | 3.18 | 5.42 | 0 | 0.00% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/002/summary.json) |
| 2 | 10 | 5384.91 | 1.54 | 2.99 | 5.80 | 0 | 0.00% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/002/summary.json) |
| 2 | 100 | 9783.27 | 7.13 | 14.08 | 54.32 | 4,331 | 2.77% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/002/summary.json) |
| 2 | 1,000 | 2163.16 | 13.33 | 67.65 | 229.54 | 21,131 | 26.11% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/002/summary.json) |
| 3 | 1 | 480.02 | 1.92 | 3.00 | 5.17 | 0 | 0.00% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/003/summary.json) |
| 3 | 10 | 5805.28 | 1.48 | 2.78 | 5.03 | 0 | 0.00% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/003/summary.json) |
| 3 | 100 | 11583.52 | 5.73 | 12.45 | 67.84 | 4,940 | 2.76% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/003/summary.json) |
| 3 | 1,000 | 2529.61 | 13.22 | 41.85 | 222.74 | 22,792 | 24.64% | [JSON](write-throughput/directus/direct-postgres/20260904T180453Z-basic-js-v2-write-throughput-directus-direct-postgres-62889/trials/003/summary.json) |

#### TrailBase — Rust WASM extension

Completed run [`20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317`](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/run.json), from 2026-09-04T17:34:56Z to 2026-09-04T17:39:26Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1019.25 | 0.88 | 1.38 | 2.69 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/001/summary.json) |
| 1 | 10 | 2500.30 | 3.38 | 6.68 | 17.93 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/001/summary.json) |
| 1 | 100 | 3451.76 | 25.54 | 51.06 | 76.74 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/001/summary.json) |
| 1 | 1,000 | 2450.99 | 208.15 | 429.02 | 961.22 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/001/summary.json) |
| 2 | 1 | 1038.15 | 0.85 | 1.28 | 2.72 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/002/summary.json) |
| 2 | 10 | 2757.98 | 3.17 | 6.53 | 12.59 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/002/summary.json) |
| 2 | 100 | 3526.36 | 25.12 | 46.93 | 108.66 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/002/summary.json) |
| 2 | 1,000 | 3419.17 | 224.20 | 425.60 | 828.27 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/002/summary.json) |
| 3 | 1 | 1067.16 | 0.84 | 1.28 | 2.59 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/003/summary.json) |
| 3 | 10 | 2923.34 | 3.05 | 5.86 | 12.19 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/003/summary.json) |
| 3 | 100 | 3849.12 | 23.83 | 40.25 | 59.13 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/003/summary.json) |
| 3 | 1,000 | 3470.04 | 221.33 | 426.74 | 831.58 | 0 | 0.00% | [JSON](write-throughput/trailbase/rust-wasm/20260904T173456Z-basic-js-v2-write-throughput-trailbase-rust-wasm-24317/trials/003/summary.json) |

#### PocketBase — Go extension

Completed run [`20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192`](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/run.json), from 2026-09-04T17:39:27Z to 2026-09-04T17:44:29Z UTC.

| Trial | VUs | Operations/s | p50 ms | p95 ms | p99 ms | Failed | Error rate | Evidence |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1 | 1634.10 | 0.39 | 1.64 | 4.80 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/001/summary.json) |
| 1 | 10 | 3425.58 | 1.33 | 8.21 | 29.88 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/001/summary.json) |
| 1 | 100 | 3595.15 | 18.71 | 82.85 | 122.47 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/001/summary.json) |
| 1 | 1,000 | 3677.96 | 193.63 | 789.13 | 1231.86 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/001/summary.json) |
| 2 | 1 | 1645.25 | 0.39 | 1.02 | 4.69 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/002/summary.json) |
| 2 | 10 | 3690.02 | 1.16 | 8.13 | 29.20 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/002/summary.json) |
| 2 | 100 | 3474.50 | 18.95 | 87.87 | 129.32 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/002/summary.json) |
| 2 | 1,000 | 3603.17 | 196.86 | 811.00 | 1239.21 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/002/summary.json) |
| 3 | 1 | 1702.36 | 0.39 | 0.96 | 4.46 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/003/summary.json) |
| 3 | 10 | 3454.95 | 1.23 | 8.24 | 34.42 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/003/summary.json) |
| 3 | 100 | 3720.85 | 18.25 | 79.01 | 119.99 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/003/summary.json) |
| 3 | 1,000 | 3668.99 | 193.16 | 799.72 | 1234.54 | 0 | 0.00% | [JSON](write-throughput/pocketbase/go-extension/20260904T173927Z-basic-js-v2-write-throughput-pocketbase-go-extension-29192/trials/003/summary.json) |

## Interpretation limits

These measurements describe warmed, anonymous, single-host, closed-loop execution on one machine. PostgreSQL direct/pooler results and HTTP extension results have different transport boundaries. High-load failures are part of the observed result, not removed or retried. The evidence does not establish general product quality, production behavior, or a cross-platform ranking.
