# Real-world API Capacity Benchmark Design

**Date:** 2026-09-04  
**Status:** Approved

## Goal

Create benchmark set `realworld-api-v3` with one benchmark, `project-management-capacity`, based on the realistic project-management workload previously implemented in `../bench`. Measure SLO-qualified concurrent-user capacity through each platform's supported application API or client path. Keep `basic-js-v1` and `basic-js-v2` unchanged.

This benchmark answers how many concurrent active users the recorded co-located system supports under the defined authenticated workload. It is not a universal platform, hosted-service, cost, realtime, storage, or geographic-latency ranking.

## Cases and access paths

The benchmark has one case per platform:

- Supabase through its official JavaScript SDK;
- Convex through its official JavaScript SDK;
- Appwrite through its official JavaScript SDK;
- Nhost through its official JavaScript SDK;
- Directus through its official JavaScript SDK;
- PocketBase through its official JavaScript SDK;
- TrailBase through its official JavaScript SDK;
- Neon through `@neondatabase/serverless` and Neon's official SQL-over-HTTP proxy.

The first seven cases use native platform authentication and authorization. Neon's PostgreSQL auth backend is gated behind the official proxy crate's `testing` Cargo feature and is unavailable in the pinned default runtime binary. The repository will therefore build only the proxy package and binary from the immutable `NEON_REF` checkout with `--features testing`, using an immutable official Neon build-tools image, and copy that binary into the pinned official `NEON_IMAGE` runtime base. A repository-owned Compose overlay adds this image to the prepared topology and configures the driver through `neonConfig.fetchEndpoint`. The proxy is an HTTP SQL transport, not a complete BaaS data/auth API. Neon therefore uses app-owned PostgreSQL authentication and tenant-authorization functions. Its case metadata, README, methodology, and result report must identify this material deviation and must not present the access paths as strictly apples-to-apples. The optional Neon REST broker is excluded because its upstream development setup requires replacing a stub dependency and external authentication-provider configuration rather than providing a reproducible turnkey self-hosted service.

## Architecture

Shared Node.js 22 code under `benchmark-sets/realworld-api-v3/shared/` owns:

- deterministic data generation and virtual-user context;
- workflow selection and think time;
- session preparation and cancellation;
- timing of complete workflows and individual physical remote calls;
- response and tenant-boundary validation;
- staged load, SLO evaluation, adaptive doubling, and bounded refinement;
- runner and backend resource sampling;
- normalized summaries and bounded raw diagnostics.

Each case supplies a thin platform adapter implementing the shared application/session contract. Platform-specific administrative setup, reset, verification, and cleanup remain separate from measured adapters. Existing v1 administrative and SDK patterns and the proven algorithms in `../bench` may be reused, but the v3 implementation must be native to this repository and its lifecycle/evidence framework; it must not invoke or depend on `../bench`.

Cases use the required five POSIX hooks as thin wrappers around shared commands. Credentials and runtime state remain under `.runtime/` with restrictive permissions.

## Application and deterministic data

The logical application contains users, organizations, memberships and roles, projects, tasks, comments, and activity history. Seed `42` generates exactly 1,000,000 application records:

| Entity | Count |
|---|---:|
| Organizations | 1,600 |
| Users | 16,000 |
| Memberships | 16,000 |
| Projects | 8,000 |
| Tasks | 160,000 |
| Comments | 479,200 |
| Activities | 319,200 |
| **Total** | **1,000,000** |

Backend authentication records are additional infrastructure records and are excluded from the application-record total. Every ordinary virtual user has deterministic credentials plus tenant, project, task, and optional comment context. The same logical fields, relationships, roles, enums, null placement, text, and timestamps are generated for every platform. Generation and seeding stream bounded batches instead of retaining the full dataset in memory.

Equivalent indexes cover tenant membership, project task lists, stable pagination, activity feeds, and search. Native limitations and index deviations are disclosed per case. Administrative bulk insertion is untimed.

## Workload

The measured workflow weights are:

| Workflow | Weight | Class |
|---|---:|---|
| Dashboard | 20% | read |
| Task list | 25% | read |
| Task detail | 15% | read |
| Create task | 10% | write |
| Update task | 12% | write |
| Add comment | 10% | write |
| Search | 5% | auth/search |
| Profile update | 1% | write |
| Sign out/sign in | 2% | auth/search |

Each virtual user executes one complete workflow at a time and then waits a deterministic pseudo-random 1,000–5,000 ms. Writes are real. Task and comment mutations create equivalent activity history using transactional, trigger-backed, or closest documented platform behavior. Complete workflow semantics are scored independently from physical-call amplification.

No application cache, retries, timed bulk operations, or platform-specific performance shortcut is allowed. Existing OS, database, SDK, and platform caches remain warm.

## Correctness and reset

Before load measurement, every case verifies exact entity counts and runs the proven correctness coverage from `../bench`:

- valid and invalid authentication;
- profile mutation;
- task and comment CRUD with stable pagination;
- member tenant access and outsider isolation;
- role denial and restoration;
- refresh and sign-out behavior;
- required deterministic fixture identity.

Incorrect successful responses, tenant leakage, missing activity effects, unstable pagination, or malformed data invalidate the run. Reset restores the declared deterministic baseline before the complete measured trial. Warm-up writes remain in the measured database state, matching the previous benchmark.

## Lifecycle and load progression

One independent `bin/bench run` is one complete capacity observation:

1. Start only the selected platform.
2. Set up or reset and verify the million-record baseline.
3. Run correctness checks.
4. Prepare ordinary-user sessions.
5. Warm up for 120 seconds at 50 users.
6. Measure 300-second stages at 5, 10, 25, and 50 users.
7. Double load until an upper bound or 10,000 users.
8. Refine a passing/failing bracket with at most four integer midpoints.
9. Verify state, remove case-owned resources, and stop the platform.

`benchmark.conf` uses `warmup_trials=0` and `measured_trials=1`. The shared runner owns the internal warm-up and measured stages so the framework does not reset away warm-up writes.

Publishable comparison requires three separate runs per platform in a balanced order with a fixed 600-second cooldown between backends. Repetitions are not three back-to-back trials inside one platform lifecycle. All attempts, including invalid ones, are retained.

## Timing and metrics

Session preparation, setup, reset, fixture verification, dependency loading, and final session cleanup are outside the measured boundary. Authentication within the weighted sign-out/sign-in workflow is measured. A complete workflow sample includes all calls and validation required for that journey. Each physical remote call is measured separately and attributed to its initiating workflow.

The primary metric is `capacity_users`. A passing stage must:

- be lifecycle-, workload-, and telemetry-valid;
- achieve at least 95% of requested users;
- include at least 20 attempted workflow samples in every active class;
- have read p95 latency no greater than 500 ms;
- have write p95 latency no greater than 750 ms;
- have auth/search p95 latency no greater than 1,000 ms;
- keep each class error rate strictly below 1%.

Capacity is the highest contiguous passing stage before the first qualifying upper bound. Supporting metrics include achieved users, workflow TPS, physical API calls/s, calls per workflow, and class latency/error metrics at capacity. `raw/stages.json` retains the complete curve and bounded diagnostics.

## Resource attribution

The load generator and backend share the recorded host, so results are conservative whole-machine capacity. The runner records its CPU, RSS, and event-loop delay. Backend sampling records the exact selected Compose project's container CPU and memory. Sustained runner CPU or event-loop overload invalidates server-capacity attribution rather than being silently reported as backend saturation. Missing or malformed required telemetry also invalidates the run.

## Errors and cancellation

Recognized measured API, authentication, authorization, timeout, and transport failures count once toward the appropriate class error rate. Invalid response shape, tenant leakage, session-preparation failure, backend restart, unresolved worker, grace expiry, baseline corruption, and lifecycle or telemetry failure invalidate the run.

Each remote operation receives a five-second timeout where the official SDK transport supports cancellation. An adapter whose SDK cannot cancel must document the limitation and prove that no unresolved operation can mutate state after reset or cleanup. Cleanup is always attempted; cleanup failure is recorded in addition to, never instead of, the original failure.

Error examples are sanitized, deduplicated, and bounded. Credentials, tokens, connection strings, raw fixture data, and secret-like metadata must never enter committed evidence.

## Evidence

Every measured trial writes the framework's normalized `summary.json` plus local raw stage, error, workload, session, access-path, deviation, and resource artifacts. Publication includes only compact validated evidence. Reports must group or label materially different access paths, especially Neon SQL-over-HTTP, and must not calculate an unexplained composite ranking.

No result is publishable until three compatible rotated repetitions exist for every included platform and publication validation passes. Given 24 platform runs, cooldowns, and adaptive stages, evidence collection is expected to take many hours or days and remains separate from implementation.

## Testing

Implementation is test-driven:

1. Dependency-light fake-adapter tests cover deterministic counts, workflow selection, think time, timing, SLO selection, adaptive refinement, and failure preservation.
2. Shell contract tests exercise all case hooks with fake `docker`, `bin/baas`, SDK/admin commands, and clocks; tests never start real stacks.
3. Adapter mapping tests cover response normalization, authorization behavior, and material platform deviations.
4. Neon environment tests verify that the repository-owned image build compiles the official pinned proxy with Cargo feature `testing`, receives immutable source/build/runtime inputs, and that smoke/readiness checks use SQL over HTTP. These regression tests use fake commands and do not run Docker.
5. All eight cases pass `bin/bench validate all` and the repository-required syntax, regression, and whitespace checks.

Real-stack diagnostics are explicitly separate and cannot be described as publishable comparison evidence.

## Non-goals

This version does not replace v1/v2, test realtime or file storage, benchmark managed cloud services, add a dashboard or composite score, tune platforms independently, flush caches, use an external load generator, or claim strict access-path equivalence for Neon.
