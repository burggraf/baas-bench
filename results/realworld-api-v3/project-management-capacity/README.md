# V3 project-management capacity results

## Test description

The V3 benchmark evaluates each BaaS independently on the same eight-core, 8 GB local Docker environment using a deterministic project-management dataset of one million records. Each implementation must pass 15 correctness checks covering authentication, CRUD, pagination, tenant isolation, permissions, session handling, and required data before running a non-scoring warm-up and an adaptive concurrency search. Virtual users execute the same weighted mix of dashboard, task-list, task-detail, task creation and updates, comments, search, profile updates, and sign-in workflows with fixed think times, five-second request timeouts, and no retries. Capacity is the highest contiguous user level meeting all requirements before the first detected saturation point: at least 95% of users active, under 1% errors per operation class, and p95 latency at or below 500 ms for reads, 750 ms for writes, and 1,000 ms for authentication/search. Setup, fixture reset, session preparation, cleanup, and approved platform maintenance occur outside measured intervals; results are published only when lifecycle, correctness, repository state, definitions, and evidence checks all pass.

## Testing methodology

- **Environment:** One platform at a time on the same local Docker host with 8 CPUs and approximately 8 GB of memory.
- **Dataset:** 1,000,000 application records: 1,600 organizations, 16,000 users, 16,000 memberships, 8,000 projects, 160,000 tasks, 479,200 comments, and 319,200 activities.
- **Correctness gate:** 15 checks covering authentication, profile updates, task and comment CRUD, pagination, tenant isolation, role enforcement, session refresh/sign-out, and fixture integrity.
- **Workload:** Deterministically weighted project-management workflows with 1–5 second think times. Each virtual user executes complete workflows serially.
- **Measurement:** A non-scoring 50-user warm-up precedes adaptive capacity stages. Requests have a five-second timeout and are not retried. Session preparation and cleanup are excluded from measured intervals.
- **Passing SLOs:** At least 95% of requested users remain active; each operation class has an error rate below 1%; p95 latency remains at or below 500 ms for reads, 750 ms for writes, and 1,000 ms for authentication/search.
- **Capacity:** The highest contiguous passing concurrency level before the first detected saturation point. Saturation is detected when a material user increase yields less than 10% additional throughput while p95 latency rises. Every published result is bounded by a higher failing stage, detected saturation, or failure at one user.
- **Evidence:** Each case passed its full lifecycle and definition-integrity checks from a clean commit. The configured benchmark used one measured repetition, so the results are directional rather than a statistical comparison across repeated runs.

See [`benchmark-sets/realworld-api-v3/benchmarks/project-management-capacity/METHODOLOGY.md`](../../../benchmark-sets/realworld-api-v3/benchmarks/project-management-capacity/METHODOLOGY.md) for the authoritative methodology and each result directory for its immutable evidence snapshot.

## Results

All cases passed 15/15 correctness checks. Latency and throughput values are reported at the selected capacity stage; Neon has no passing stage, so those fields are not applicable. These are single-run observations listed by observed capacity, not a formal ranking; the methodology requires three balanced repetitions, declared ordering, and cooldowns for a publishable cross-platform comparison.

| Platform | Observed capacity users | Workflow TPS | Remote ops/s | p95 read | p95 write | p95 auth/search |
|---|---:|---:|---:|---:|---:|---:|
| TrailBase | **850** | 283.57 | 652.94 | 11.01 ms | 13.06 ms | 30.27 ms |
| Nhost | **700** | 228.31 | 516.07 | 307.31 ms | 150.57 ms | 126.77 ms |
| Convex | **500** | 160.95 | 170.26 | 322.49 ms | 403.25 ms | 615.86 ms |
| Supabase | **300** | 98.66 | 186.16 | 118.94 ms | 44.12 ms | 236.32 ms |
| Directus | **162** | 51.32 | 185.65 | 400.54 ms | 324.49 ms | 628.13 ms |
| PocketBase | **21** | 6.72 | 20.53 | 410.79 ms | 43.00 ms | 287.46 ms |
| Appwrite | **4** | 1.23 | 3.44 | 440.17 ms | 248.60 ms | 261.85 ms |
| Neon | **0** | — | — | — | — | — |

## Platform analysis

### TrailBase — 850 users

TrailBase's lightweight Rust/SQLite Record API was an excellent fit for indexed CRUD on one machine and retained very low latency at its selected stage. This result uses its native Record API. Authentication admission tuning is a reasonable area to investigate if later repetitions confirm the same boundary.

### Nhost — 700 users

Nhost's Hasura GraphQL path and PostgreSQL permissions avoid a separate custom application data layer, which plausibly contributed to its strong observed capacity. The case represents normal Nhost SDK, Auth, and Hasura usage. Larger PostgreSQL and Hasura connection/resource allocations are reasonable tuning candidates for future runs.

### Convex — 500 users

Convex kept authorization and business logic in deployed functions, allowing each remote operation to perform substantial work close to the data. The case follows Convex's intended function model, although its remote-operation rate is not directly comparable with more granular CRUD APIs. Additional backend resources are the clearest legitimate tuning candidate.

### Supabase — 300 users

PostgREST and PostgreSQL RLS handled the selected stage efficiently, with particularly strong write latency. The case represents normal Supabase JS, Auth, PostgREST, and RLS usage. Larger PostgreSQL, PgBouncer, and GoTrue pools are legitimate tuning candidates for future repetitions.

### Directus — 162 users

Directus's REST path includes schema abstraction, authentication, and multiple requests per workflow, which plausibly explains its lower observed capacity. The result represents Directus REST, but Directus Core could not enforce the required custom permission model without a license, so tenant checks were benchmark-owned. Licensed native permissions, more Node workers, caching, or fewer round trips could change later results.

### PocketBase — 21 users

PocketBase's compact single-process SQLite architecture produced fast writes but read latency close to the SLO at its selected stage. The million-record relational workload is demanding for PocketBase's usual deployment model. The native SDK and Record APIs were used; stronger compound indexes and SQLite/cache tuning may help, but this workload favors architectures built for greater concurrency.

### Appwrite — 4 users

Appwrite's TablesDB and Account operations traverse a comparatively large local service stack. Read p95 was already 440 ms at the selected four-user stage, while writes and authentication retained more SLO headroom. The case used the official SDK, explicit permissions, and a full-text index; more API workers, database connections/resources, and a leaner local service topology are reasonable tuning candidates.

### Neon — 0 users

Neon's published result is valid for the tested local stack but should not be treated as representative of hosted Neon. It had no SLO-passing stage. Local diagnostics suggested host storage pressure, pageserver layer churn, and the test proxy's compute-backed control-plane authentication as likely contributors, but those diagnostics are not part of the published bundle. A host with adequate free disk, settled fixture storage, and a more representative proxy/auth topology should be used before drawing comparative conclusions.

## Fairness and limitations

The benchmark used the same hardware, dataset, workflows, correctness contract, SLOs, timing rules, and no-retry policy for every platform while preserving each platform's declared SDK or API path. The single-run observations are useful for evaluating these specific self-hosted local deployments, but they are not yet a publishable cross-platform comparison under the approved methodology. They are also not a managed-cloud comparison: the platforms expose different abstraction levels, and Directus and Neon required disclosed benchmark-owned behavior. Three balanced repetitions with declared ordering and 600-second cooldowns between backends are required before presenting formal rankings or comparative conclusions.
