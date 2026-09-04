# Real-world API Capacity Benchmark Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add a native, reproducible `realworld-api-v3/project-management-capacity` benchmark for all eight platforms, using the approved million-record authenticated workload and SLO-based capacity search.

**Architecture:** A dependency-light Node.js 22 shared runner owns deterministic data, correctness, workload scheduling, metrics, resource sampling, capacity search, and result writing. Eight thin adapters and administrative modules map the shared contract onto each platform; POSIX hook wrappers connect them to the existing `bin/bench` lifecycle. Neon additionally receives a repository-owned Compose overlay for its official SQL-over-HTTP proxy.

**Tech Stack:** POSIX `/bin/sh`, Node.js 22 ESM and `node:test`, existing pinned JavaScript SDKs, `@neondatabase/serverless`, Docker Compose v2, jq, and platform-native schema/auth facilities.

---

## Ground rules

- Work directly on `main`, as explicitly requested; do not create a worktree.
- Follow TDD: make the named focused test fail, implement only enough to pass, rerun it, then commit.
- Port proven algorithms from `../bench` where identified, but remove TypeScript syntax and all runtime/build dependency on that sibling repository.
- Never start a real BaaS stack from regression tests. Inject adapters/clocks/command runners and fake `docker`, `bin/baas`, and SDK calls.
- Keep all benchmark-owned credentials and generated data under `.runtime/benchmarks/realworld-api-v3/` with mode `0600` files and `0700` directories.
- Preserve the primary error when cleanup also fails by attaching or recording the cleanup error.
- Before implementing an SDK adapter, use Context7 or the pinned package's installed documentation to confirm its current API.

## Shared contract used throughout

Create adapters with this minimum shape:

```js
export function createBackend(dependencies) {
  return {
    async createSession(credentials, options) {},
    async correctnessFixture() {},
    async virtualUsers(count) {},
  };
}

// createSession returns:
// getProfile, updateProfile, dashboard, listTasks, getTask,
// createTask, updateTask, addComment, updateComment,
// searchTasks, updateMembershipRole, signOut, cancelPending, close
```

Every remote SDK invocation must route through `measureRemoteCall()` so physical-call amplification is recorded independently of complete workflow latency.

### Task 1: Scaffold the benchmark set and hook contract

**Files:**
- Create: `benchmark-sets/realworld-api-v3/set.conf`
- Create: `benchmark-sets/realworld-api-v3/README.md`
- Create: `benchmark-sets/realworld-api-v3/benchmarks/project-management-capacity/benchmark.conf`
- Create: `benchmark-sets/realworld-api-v3/benchmarks/project-management-capacity/METHODOLOGY.md`
- Create: `benchmark-sets/realworld-api-v3/benchmarks/project-management-capacity/fixtures/.gitkeep`
- Create: `benchmark-sets/realworld-api-v3/shared/case.sh`
- Create: five hook files under each of the eight case directories
- Create: eight `case.conf` and eight case `README.md` files
- Create: `benchmark-sets/realworld-api-v3/shared/package.json`
- Create: `benchmark-sets/realworld-api-v3/shared/package-lock.json`
- Modify: `test/bench_test.sh`
- Test: `test/realworld_api_v3_test.mjs`

Case directories are:

```text
cases/supabase/javascript-sdk
cases/convex/javascript-sdk
cases/appwrite/javascript-sdk
cases/nhost/javascript-sdk
cases/directus/javascript-sdk
cases/pocketbase/javascript-sdk
cases/trailbase/javascript-sdk
cases/neon/javascript-sql-http
```

**Step 1: Write the failing scaffold test**

Add a `node:test` case that enumerates the eight directories, asserts all five hooks are executable, asserts `warmup_trials=0` and `measured_trials=1`, and checks that Neon alone declares `access_path=sql-over-http`. Add this test file to the final `node --test` command in `test/bench_test.sh`.

**Step 2: Run the test to verify it fails**

Run: `node --test test/realworld_api_v3_test.mjs`  
Expected: FAIL because `benchmark-sets/realworld-api-v3` does not exist.

**Step 3: Create the minimal valid scaffold**

Use these fixed summary metrics in `benchmark.conf`:

```conf
primary_metric=capacity_users
primary_unit=users
primary_direction=higher
required_metrics=capacity_bounded,achieved_users_at_capacity,workflow_tps_at_capacity,remote_operations_per_second_at_capacity,read_latency_p95_ms_at_capacity,write_latency_p95_ms_at_capacity,auth_search_latency_p95_ms_at_capacity,read_error_rate_at_capacity,write_error_rate_at_capacity,auth_search_error_rate_at_capacity
warmup_trials=0
measured_trials=1
```

`shared/case.sh` accepts exactly `<action> <platform>`, validates both, installs the shared package into `.runtime/benchmarks/realworld-api-v3` during setup, copies `lib/` and platform assets, exports `BAAS_BENCH_ROOT` and `BAAS_BENCH_RUNTIME`, and dispatches `run` to `lib/run.mjs` and lifecycle actions to `lib/admin.mjs`. Hook wrappers only resolve `shared/case.sh` and pass their fixed action/platform.

Pin the seven versions already used by `basic-js-v1`; add the exact `@neondatabase/serverless` version recorded by `npm install --package-lock-only`. Do not add TypeScript, a test framework, or a build step.

**Step 4: Validate the scaffold**

Run: `node --test test/realworld_api_v3_test.mjs && bin/bench validate all`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3 test/bench_test.sh test/realworld_api_v3_test.mjs
git commit -m "Scaffold real-world API capacity benchmark"
```

### Task 2: Implement the exact streaming dataset

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/random.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/domain.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/dataset.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Write failing deterministic-data tests**

Test that:

- the exported counts equal 1,600/16,000/16,000/8,000/160,000/479,200/319,200 and sum to exactly 1,000,000;
- batches never exceed a supplied batch size;
- two generators using seed `42` produce identical first/last records and hashes;
- IDs are stable lowercase ASCII and unique across entity types;
- each user belongs to one organization, with deterministic owner/admin/member roles;
- references produced at entity boundaries point to valid IDs;
- `buildVirtualUserSpecs(10_000)` returns valid credentials and tenant/project/task context without materializing the million records.

**Step 2: Run the focused test to verify it fails**

Run: `node --test --test-name-pattern='dataset' test/realworld_api_v3_test.mjs`  
Expected: FAIL with missing `dataset.mjs`.

**Step 3: Port and minimize the proven generator**

Port Mulberry32 and the generator structure from `../bench/src/random.ts` and `../bench/src/seed.ts` to ESM. Replace profiles with one frozen `DATASET_COUNTS` object and one ID format. Preserve deterministic ISO timestamps, nullable assignees/due dates, role distribution, and bounded async batches. Generate authentication emails/password references separately so authentication records are not counted as application records.

**Step 4: Run the focused test**

Run: `node --test --test-name-pattern='dataset' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/{random,domain,dataset}.mjs test/realworld_api_v3_test.mjs
git commit -m "Add deterministic million-record dataset"
```

### Task 3: Implement workflow semantics and correctness checks

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/errors.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/measurement.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/workflows.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/correctness.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Write failing contract tests with one fake adapter**

Cover weighted boundaries `20/25/15/10/12/10/5/1/2`, result-shape validation, project/tenant boundary rejection, task/comment activity effects, stable pagination, role denial/restoration, outsider isolation, invalid sign-in, refresh/sign-out, and cleanup after a correctness failure. Assert credential values never appear in recorded errors.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='workflow|correctness|redaction' test/realworld_api_v3_test.mjs`  
Expected: FAIL with missing modules.

**Step 3: Port the shared semantics**

Port the public behavior—not TypeScript scaffolding—from:

- `../bench/src/domain.ts`
- `../bench/src/errors.ts`
- `../bench/src/sdk-measurement.ts`
- `../bench/src/workflows.ts`
- `../bench/src/correctness.ts`

Use `AsyncLocalStorage` for the active workflow measurement context. Keep validation at the shared boundary so all adapters receive identical checks. Bound sanitized error examples to 100 and messages to 300 characters.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='workflow|correctness|redaction' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/{errors,measurement,workflows,correctness}.mjs test/realworld_api_v3_test.mjs
git commit -m "Add shared project workflow contract"
```

### Task 4: Implement paced virtual users and cancellation

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/workload.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Write failing scheduler tests**

With injected clocks/sleep/session factories, assert:

- session preparation is outside the measured boundary and bounded to concurrency 10;
- every user executes serial workflows;
- deterministic think time is always 1,000–5,000 ms;
- 2% sign-out/sign-in replaces the session;
- one complete workflow and each physical call produce separate samples;
- the deadline stops new work;
- the five-second request timeout cancels pending work;
- grace expiry, lost users, preparation failure, and unresolved writes invalidate a stage;
- every prepared session closes exactly once, even on failure.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='workload' test/realworld_api_v3_test.mjs`  
Expected: FAIL with missing `workload.mjs`.

**Step 3: Implement the scheduler**

Port the state machine from `../bench/src/workload.ts` to ESM, retaining separate scheduling and request abort controllers. Use injected `now` and `sleep`; defaults are `performance.now()` and abort-aware `setTimeout`. Keep worker loops deliberately simple—one promise per requested virtual user, no worker pool abstraction.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='workload' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/workload.mjs test/realworld_api_v3_test.mjs
git commit -m "Add paced authenticated workload runner"
```

### Task 5: Implement metrics and adaptive capacity selection

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/metrics.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/capacity.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Write failing metric/capacity tests**

Test nearest-rank p50/p95/p99, workflow versus remote-call counters, strict `<1%` error rate, inclusive latency thresholds, 95% achieved users, minimum 20 samples per active class, invalid-stage behavior, contiguous capacity, initial stages `5,10,25,50`, doubling to 10,000, and at most four integer midpoint refinements without duplicates.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='metrics|capacity' test/realworld_api_v3_test.mjs`  
Expected: FAIL with missing modules.

**Step 3: Implement the smallest proven algorithms**

Port the accumulator and SLO evaluation from `../bench/src/metrics.ts` and `../bench/src/capacity.ts`. Add a small `nextStage(stages, evaluations)` function for the approved sequence. Stop after the first conclusive upper bound plus four refinements, at an adjacent integer bracket, or at 10,000.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='metrics|capacity' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/{metrics,capacity}.mjs test/realworld_api_v3_test.mjs
git commit -m "Add SLO capacity evaluation"
```

### Task 6: Implement resource attribution and the end-to-end runner

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/command.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/resources.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/summary.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/run.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Write failing runner tests**

Use fake commands, adapters, clocks, and short durations to assert:

- setup correctness precedes the 50-user warm-up;
- warm-up writes are not reset before measured stages;
- measured stages follow adaptive capacity decisions;
- `docker compose -p baas-<platform> ps -q` identifies only selected-platform containers;
- `docker stats --no-stream` parsing sums container CPU/memory;
- runner CPU/RSS and event-loop delay are sampled once per second;
- three consecutive overload samples invalidate attribution;
- raw files are mode `0600` and include stages, resources, bounded errors, access path, and deviations;
- `summary.json` contains every fixed numeric metric, including zeroes when no stage passes;
- an original failure survives teardown failure.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='resources|runner|summary' test/realworld_api_v3_test.mjs`  
Expected: FAIL with missing modules.

**Step 3: Implement orchestration**

Port and simplify the relevant logic from `../bench/src/run.ts`, `metrics.ts`, and `system.ts`. Use Node's `monitorEventLoopDelay`, `process.cpuUsage`, `process.memoryUsage`, and `execFile`; do not add a monitoring dependency. `run.mjs` accepts `<platform> <phase> <trial> <absolute-output-dir>`, requires `phase=measure`, performs a 120-second 50-user warm-up followed by 300-second adaptive stages, and supports injected shorter values only in tests. `admin.mjs` accepts setup/verify/reset/teardown and dispatches to `lib/admin/<platform>.mjs`.

**Step 4: Run focused and lifecycle tests**

Run: `node --test --test-name-pattern='resources|runner|summary' test/realworld_api_v3_test.mjs && sh test/bench_test.sh`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib test/realworld_api_v3_test.mjs
git commit -m "Add adaptive capacity run orchestration"
```

### Task 7: Add Neon's official SQL-over-HTTP proxy to the environment

**Files:**
- Create: `services/neon/proxy.yml`
- Modify: `bin/baas`
- Modify: `test/baas_test.sh`

**Step 1: Write failing shell regression coverage**

Extend fake commands to assert:

- Neon Compose commands include both upstream `docker-compose.yml` and `services/neon/proxy.yml`;
- setup generates a private localhost TLS key/certificate under `.runtime/neon/proxy-certs` only when absent;
- the overlay uses `${NEON_IMAGE}`, the upstream `proxy` binary, `--auth-backend=postgres`, compute service endpoint, and port `127.0.0.1:4444:4444`;
- Neon smoke sends `POST /sql` with `Neon-Connection-String` and the generated CA certificate.

**Step 2: Verify failure**

Run: `sh test/baas_test.sh`  
Expected: FAIL because no proxy overlay is used.

**Step 3: Implement the overlay and minimal Compose special case**

Add one `proxy` service using the already pinned `${NEON_IMAGE}`. Mount the generated certificate/key read-only, depend on `compute_is_ready`, and run the documented official proxy command. In `run_compose`, append the second `-f` only for Neon. Generate a SAN certificate for `localhost` with `openssl`; do not disable TLS verification. Change Neon smoke from direct `psql` to a minimal `SELECT 1` HTTP request.

**Step 4: Run shell tests**

Run: `sh -n bin/baas test/baas_test.sh && sh test/baas_test.sh`  
Expected: PASS without starting Docker.

**Step 5: Commit**

```sh
git add services/neon/proxy.yml bin/baas test/baas_test.sh
git commit -m "Expose Neon SQL through official HTTP proxy"
```

### Task 8: Implement the shared PostgreSQL schema helper

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/postgres.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/sql/postgres-schema.sql`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Write failing SQL-generation tests**

Assert seven application tables, foreign keys, equivalent indexes, RLS predicates, activity triggers/functions, deterministic reset markers, app-owned Neon sign-in/session functions, and parameterized/escaped streaming COPY output. Assert exact-count verification rejects one missing or extra row.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='postgres admin' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement the reusable helper**

Keep transport injection platform-specific but share schema text, streamed tab-separated COPY encoding, exact-count queries, reset SQL, fixture-state creation, and verification. Supabase and Nhost use their native auth identity in RLS. Neon stores password hashes/sessions in benchmark-owned tables and exposes security-definer functions that set a transaction-local user identity before authorized queries.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='postgres admin' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/admin/postgres.mjs benchmark-sets/realworld-api-v3/shared/sql/postgres-schema.sql test/realworld_api_v3_test.mjs
git commit -m "Add project management PostgreSQL schema"
```

### Task 9: Implement Supabase

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/supabase.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/adapters/supabase.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Add failing Supabase mapping tests**

Mock `@supabase/supabase-js` chains and `bin/baas compose supabase exec ... psql`. Assert native password sign-in/out, auth-user linkage, RLS tenant filters, stable ordering, filters, mutation/activity behavior, timeout signal propagation, camelCase normalization, and one remote measurement per actual SDK request.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='Supabase' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement by adapting proven sources**

Use `../bench/backends/supabase/adapter.ts`, `../bench/backends/supabase/supabase/migrations/0001_benchmark.sql`, and `basic-js-v1/shared/lib/admin/supabase.mjs` as references. Seed application/auth rows administratively via `psql` COPY; measured paths must use only `@supabase/supabase-js` auth and PostgREST operations.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='Supabase' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/{admin,adapters}/supabase.mjs test/realworld_api_v3_test.mjs
git commit -m "Add Supabase capacity adapter"
```

### Task 10: Implement Neon SQL-over-HTTP

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/neon.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/adapters/neon.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Add failing Neon tests**

Mock `@neondatabase/serverless` and assert `neonConfig.fetchEndpoint` resolves to `https://localhost:4444/sql`, TLS uses the generated CA rather than disabling verification, each operation calls parameterized `sql.query()`, app sign-in/session validation is separate from proxy database authentication, tenant authorization executes in PostgreSQL, and case metadata exposes the non-apples-to-apples deviation.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='Neon' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement the adapter/admin**

Use Context7-confirmed `neon()`, `neonConfig.fetchEndpoint`, and `sql.query(query, params)`. Setup/reset use `bin/baas compose neon exec -T compute1 psql`; measured operations use only SQL over HTTP. Use the shared PostgreSQL schema and app-owned session functions. Do not use direct TCP in measured code or claim native BaaS auth.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='Neon' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/{admin,adapters}/neon.mjs test/realworld_api_v3_test.mjs
git commit -m "Add Neon SQL over HTTP capacity adapter"
```

### Task 11: Implement Convex

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/convex/schema.ts`
- Create: `benchmark-sets/realworld-api-v3/shared/convex/auth.config.ts`
- Create: `benchmark-sets/realworld-api-v3/shared/convex/auth.ts`
- Create: `benchmark-sets/realworld-api-v3/shared/convex/authorize.ts`
- Create: `benchmark-sets/realworld-api-v3/shared/convex/benchmark.ts`
- Create: `benchmark-sets/realworld-api-v3/shared/convex/setup.ts`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/convex.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/adapters/convex.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Add failing Convex tests**

Assert deployment assets define all tables/indexes, native Convex auth, tenant authorization in every public query/mutation, stable pagination, activity writes, bounded seed batches, baseline export/import reset, and `ConvexHttpClient` measured calls.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='Convex' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement using proven Convex code**

Adapt `../bench/backends/convex/app/convex/`, `adapter.ts`, `seed.ts`, and `setup.ts`, plus the self-hosted deployment pattern in `basic-js-v1/shared/lib/admin/convex.mjs`. Keep generated `_generated` files out of source; the setup deployment generates them in runtime. Stream JSONL imports and retain one baseline export for reset.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='Convex' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/convex benchmark-sets/realworld-api-v3/shared/lib/{admin,adapters}/convex.mjs test/realworld_api_v3_test.mjs
git commit -m "Add Convex capacity adapter"
```

### Task 12: Implement Appwrite

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/appwrite.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/adapters/appwrite.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Add failing Appwrite tests**

Mock `node-appwrite` administration and browser `appwrite` sessions. Assert project/database/table creation, relationships and indexes, native email/password users, team/role permissions, stable TablesDB queries, activity creation, bulk seeding in bounded chunks, reset, cancellation limits, and normalized responses.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='Appwrite' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement the smallest adapter**

Extend the established console bootstrap, API-key creation, schema polling, bulk row creation, and cleanup patterns in `basic-js-v1/shared/lib/admin/appwrite.mjs`. Use native Account sessions and TablesDB for measured workflows. Document SDK operations that cannot accept `AbortSignal`; close/replace the client and invalidate any stage with unresolved calls.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='Appwrite' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/{admin,adapters}/appwrite.mjs test/realworld_api_v3_test.mjs
git commit -m "Add Appwrite capacity adapter"
```

### Task 13: Implement Nhost

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/nhost.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/adapters/nhost.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Add failing Nhost tests**

Mock Nhost auth and GraphQL fetches. Assert native password sessions/JWT refresh/sign-out, Hasura table tracking and role permissions, tenant predicates from JWT user ID, stable GraphQL pagination/filtering, activity effects, exact seed verification, signal propagation, and response normalization.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='Nhost' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement using existing Nhost administration patterns**

Reuse restricted `.env` parsing and Hasura metadata/SQL calls from `basic-js-v1/shared/lib/admin/nhost.mjs`. Use the shared PostgreSQL schema where compatible, then track tables and create only the permissions required by the contract. Measured operations use `@nhost/nhost-js` auth and GraphQL, never admin secrets.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='Nhost' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/{admin,adapters}/nhost.mjs test/realworld_api_v3_test.mjs
git commit -m "Add Nhost capacity adapter"
```

### Task 14: Implement Directus

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/directus.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/adapters/directus.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Add failing Directus tests**

Mock `@directus/sdk` and administrative PostgreSQL calls. Assert collection/field/relation/index creation, native users/roles/policies, tenant-aware permission filters, stable REST sorting/pagination, activity effects, bulk COPY seeding, exact verification, auth refresh/logout, cancellation, and normalized data.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='Directus' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement by extending the v1 Directus patterns**

Reuse login, collection, permission, direct COPY, verification, and cleanup mechanics from `basic-js-v1/shared/lib/admin/directus.mjs`. Keep measured traffic on `@directus/sdk` REST/auth only. Avoid scanning all million rows during each verification; use exact aggregate counts plus deterministic boundary/hash samples.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='Directus' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/lib/{admin,adapters}/directus.mjs test/realworld_api_v3_test.mjs
git commit -m "Add Directus capacity adapter"
```

### Task 15: Implement PocketBase

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/pocketbase/migration.js`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/pocketbase.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/adapters/pocketbase.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Add failing PocketBase tests**

Mock the PocketBase SDK and admin SQL endpoint. Assert auth collection, seven application collections, relation/index definitions, collection rules enforcing membership/roles, stable list/search pagination, activity behavior, bounded SQLite inserts below the admin query-size limit, reset, token clearing, cancellation, and normalization.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='PocketBase' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement from proven PocketBase sources**

Adapt `../bench/backends/pocketbase/pb_migrations/0001_benchmark.js`, `adapter.ts`, and `basic-js-v1/shared/lib/admin/pocketbase.mjs`. Use deterministic application IDs and native auth-record IDs mapped during setup. Keep measured calls on the PocketBase SDK.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='PocketBase' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/pocketbase benchmark-sets/realworld-api-v3/shared/lib/{admin,adapters}/pocketbase.mjs test/realworld_api_v3_test.mjs
git commit -m "Add PocketBase capacity adapter"
```

### Task 16: Implement TrailBase

**Files:**
- Create: `benchmark-sets/realworld-api-v3/shared/trailbase/migration.sql`
- Create: `benchmark-sets/realworld-api-v3/shared/trailbase/config.textproto`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/admin/trailbase.mjs`
- Create: `benchmark-sets/realworld-api-v3/shared/lib/adapters/trailbase.mjs`
- Modify: `test/realworld_api_v3_test.mjs`

**Step 1: Add failing TrailBase tests**

Mock `trailbase` and admin APIs. Assert native auth users, SQLite schema/indexes/triggers, record API access rules, stable list/search pagination, transactional activity effects, streamed bounded inserts, config backup/restore, migration rollback, token refresh/logout, cancellation, and normalized data.

**Step 2: Verify failure**

Run: `node --test --test-name-pattern='TrailBase' test/realworld_api_v3_test.mjs`  
Expected: FAIL.

**Step 3: Implement from proven TrailBase sources**

Adapt `../bench/backends/trailbase/migrations/U1787223330__canonical.sql`, `config.textproto`, `adapter.ts`, and `basic-js-v1/shared/lib/admin/trailbase.mjs`. Preserve original failure plus configuration/migration cleanup failures. Keep all measured operations on the TrailBase JavaScript client and record API.

**Step 4: Run focused tests**

Run: `node --test --test-name-pattern='TrailBase' test/realworld_api_v3_test.mjs`  
Expected: PASS.

**Step 5: Commit**

```sh
git add benchmark-sets/realworld-api-v3/shared/trailbase benchmark-sets/realworld-api-v3/shared/lib/{admin,adapters}/trailbase.mjs test/realworld_api_v3_test.mjs
git commit -m "Add TrailBase capacity adapter"
```

### Task 17: Complete documentation and fake end-to-end coverage

**Files:**
- Modify: `benchmark-sets/realworld-api-v3/README.md`
- Modify: `benchmark-sets/realworld-api-v3/benchmarks/project-management-capacity/METHODOLOGY.md`
- Modify: all eight case `README.md` files
- Modify: `test/realworld_api_v3_test.mjs`
- Modify: `test/bench_test.sh`

**Step 1: Add the failing full-contract test**

For each platform, inject its fake admin/SDK implementation and run setup → verify → reset → shortened measured run → verify → teardown. Assert one valid normalized summary and raw artifact set, no secret strings, exact lifecycle order, and all declared access-path/deviation labels. Add negative cases for tenant leakage, malformed summary, telemetry loss, and teardown failure preserving the primary invalid state.

**Step 2: Verify failure**

Run: `node --test test/realworld_api_v3_test.mjs`  
Expected: FAIL until every adapter and document satisfies the contract.

**Step 3: Finish the authoritative documentation**

Document semantics, seed/counts, indexes, auth, warm cache state, 120/300-second timing, adaptive progression, five-second timeout, no retries, co-located resources, three-run balanced rotation, 600-second cooldown, metrics, acceptance, invalidation, and publication restrictions. Each case README records exact topology, SDK/access path, physical call mapping per workflow, cancellation behavior, setup/reset implementation, indexes, tuning, and deviations. Neon must prominently state that app-owned SQL auth is not a native BaaS auth path.

**Step 4: Run full repository verification**

Run exactly:

```sh
sh -n bin/baas bin/bench test/baas_test.sh test/bench_test.sh
sh test/baas_test.sh
sh test/bench_test.sh
bin/bench validate all
git diff --check
```

Expected: every command exits 0. No command starts a real stack.

**Step 5: Request code review and address only verified findings**

Use the requesting-code-review skill. Re-run the focused failing test before each fix, then the complete verification block after fixes.

**Step 6: Commit**

```sh
git add benchmark-sets/realworld-api-v3 test bin/baas services/neon/proxy.yml
git commit -m "Complete real-world API capacity benchmark"
```

## Deferred integration work

Do not start real services or publish results during this plan. After implementation passes fake tests, run one explicitly approved diagnostic per platform, fix environment-specific defects test-first, then conduct the separately approved 24-run balanced series. Publication and any cross-platform report require all three valid repetitions per platform and the methodology-defined cooldown/order.
