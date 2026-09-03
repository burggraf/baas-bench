# Basic JavaScript API Throughput Benchmarks Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add three reproducible throughput benchmarks for a public guestbook across Supabase, Convex, Appwrite, Nhost, Directus, PocketBase, and TrailBase using each platform's mainstream JavaScript SDK.

**Architecture:** A set-level Node.js 22 workload package owns deterministic fixtures, one-client-per-virtual-user load execution, validation, latency metrics, and summary output. Thin case hooks delegate timed work to SDK adapters and untimed resource management to platform administrators; `bin/bench` conditionally snapshots the set-level shared package so existing checksum/publication behavior covers it.

**Tech Stack:** POSIX shell, Node.js 22+, npm lockfile, Node built-in test runner, official JavaScript SDKs, existing Docker Compose environments, `jq`.

**Working agreement:** The user explicitly requested implementation directly on `main`; do not create a worktree. Keep one writer in this checkout.

---

## Approved contract and research corrections

Implement the approved design in [`2026-09-03-basic-javascript-throughput-design.md`](2026-09-03-basic-javascript-throughput-design.md), with these later-approved or source-required corrections:

1. Create one long-lived SDK client per virtual user, not one client for the whole load process. Client construction occurs before timing; each virtual user issues one request at a time. This models separate browser/application instances and preserves SDK defaults.
2. Use `trailbase@0.14.1` and `initClient`; `@trailbase/client` does not exist.
3. Keep PocketBase duplicate-request auto-cancellation enabled. Separate per-user clients plus sequential per-user requests avoid cross-user cancellation without changing the SDK default.
4. Keep Convex's mutation queue default. Separate per-user clients permit cross-user concurrency without `skipQueue` tuning.
5. Define write IDs as **platform- or SDK-generated native IDs**. Appwrite's recommended `ID.unique()` generates the required row ID in the client; every other case may use its platform's server-generated ID.
6. Use Appwrite's current recommended `TablesDB`/row API, not the deprecated Databases/document API.
7. Pin Node `>=22`, required by the current Supabase, Nhost, and Directus SDKs.
8. Neon remains excluded because the prepared self-hosted deployment has no official JavaScript-driver proxy; direct PostgreSQL would be a different access path.

### Pinned workload packages

The shared `package.json` and lockfile must pin exact versions:

```json
{
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "dependencies": {
    "@directus/sdk": "25.0.1",
    "@nhost/nhost-js": "4.8.0",
    "@supabase/supabase-js": "2.115.0",
    "appwrite": "26.2.0",
    "convex": "1.45.0",
    "node-appwrite": "28.0.0",
    "pocketbase": "0.28.0",
    "trailbase": "0.14.1"
  }
}
```

Do not add a test framework, bundler, TypeScript runtime, statistics package, load-testing package, or ORM.

### Deterministic fixture formula

Use one function for every platform:

```js
export function fixture(index) {
  if (!Number.isInteger(index) || index < 1 || index > 10_000) {
    throw new RangeError('fixture index must be between 1 and 10000');
  }
  return {
    fixture_key: index,
    author: `user-${String(((index - 1) % 1000) + 1).padStart(4, '0')}`,
    message: `Guestbook message ${String(index).padStart(5, '0')} from basic-js-v1`,
    created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
  };
}
```

The timestamp expression intentionally yields one-second-spaced UTC values. Validate the first, twentieth-newest, and last fixtures in tests. Use fixture keys 1 through 10,000 everywhere.

### Required per-load metric keys

For each `N` in `1,10,100,1000`, require numeric:

```text
operations_per_second_vu_N
latency_p50_ms_vu_N
latency_p95_ms_vu_N
latency_p99_ms_vu_N
attempted_operations_vu_N
completed_operations_vu_N
failed_operations_vu_N
error_rate_vu_N
```

Use `operations_per_second_vu_100` as the primary metric, unit `ops/s`, direction `higher`. If a stage has no successful operations, publish latency percentiles as numeric `0` and error rate `1`; methodology must state that zero latency means “no successful sample,” not zero-duration service.

---

### Task 1: Correct the design and snapshot set-level shared definitions

**Files:**
- Modify: `docs/plans/2026-09-03-basic-javascript-throughput-design.md`
- Modify: `test/bench_test.sh`
- Modify: `bin/bench`

**Step 1: Write the failing snapshot regression**

In `test/bench_test.sh`, after the temporary set is created, add a set-level shared file:

```sh
mkdir -p "$SET/shared"
printf '%s\n' 'captured shared workload' > "$SET/shared/runner.txt"
```

After the happy-path run, assert:

```sh
[ -f "$run_dir/definitions/benchmark-sets/core-v1/shared/runner.txt" ] ||
  fail "set-level shared definitions were not captured"
```

After publication, assert the same relative file exists under `$expected/definitions/`. Add a copied-bundle publication rejection that changes the current committed shared file and confirms publication fails because captured/current definitions differ.

**Step 2: Run the test and verify RED**

Run: `sh test/bench_test.sh`  
Expected: FAIL with `set-level shared definitions were not captured`.

**Step 3: Implement the minimum shared copy**

In `copy_definitions()` immediately after copying `set.conf` and `README.md`, add:

```sh
if [ -d "$source_set/shared" ]; then
  cp -R "$source_set/shared" "$target_set/"
fi
```

Do not create an empty shared directory for old sets or change checksum/publication code. Existing recursive checksums and current-definition diffs cover the copied directory automatically.

**Step 4: Correct the approved design record**

Update the design's client mapping, ID wording, and architecture sections with the eight corrections above. Keep the historical approval and explain why source research required the factual changes.

**Step 5: Verify GREEN**

Run:

```sh
sh -n bin/bench test/bench_test.sh
sh test/bench_test.sh
sh test/baas_test.sh
git diff --check
```

Expected: both suites print `PASS`; no syntax or whitespace errors.

**Step 6: Commit**

```sh
git add bin/bench test/bench_test.sh docs/plans/2026-09-03-basic-javascript-throughput-design.md
git commit -m "feat: capture shared benchmark definitions"
```

---

### Task 2: Add deterministic fixtures and load-runner core

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/lib/fixtures.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/runner.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/summary.mjs`
- Create: `test/basic_js_test.mjs`
- Modify: `test/bench_test.sh`

**Step 1: Write failing Node tests**

Create `test/basic_js_test.mjs` using only `node:test` and `node:assert/strict`. Test:

1. `fixture(1)`, `fixture(9981)`, and `fixture(10000)` exactly match the approved formula and bounded lengths.
2. Invalid fixture indexes throw.
3. A seeded item selector returns the same sequence for equal `(trial, vu)` and different sequences for different VUs.
4. Nearest-rank percentile uses `ceil(p * count) - 1`; empty samples return `0`.
5. `runStage()` constructs exactly one client per VU before timing, never has more than one operation in flight per client, reaches requested concurrency, stops issuing after the deadline, and waits for in-flight calls.
6. Rejected and invalid responses increment failures without retry.
7. `summarize()` emits all 32 required metric keys, aggregates counts/duration, and writes numeric zeros for no-success latency.

Use injected `now`, `sleep`, `createClient`, and `operation` functions only at the runner seam so tests can use a deterministic fake clock without waiting 15 seconds. Do not add general dependency injection elsewhere.

Append this to `test/bench_test.sh`:

```sh
node --test "$ROOT/test/basic_js_test.mjs"
```

**Step 2: Run and verify RED**

Run: `node --test test/basic_js_test.mjs`  
Expected: FAIL because the shared modules do not exist.

**Step 3: Implement fixture and metric primitives**

Implement:

```js
export const LOADS = [1, 10, 100, 1000];
export const FIXTURE_COUNT = 10_000;
export function fixture(index) { /* exact approved formula */ }
export function fixtures() { return Array.from({ length: FIXTURE_COUNT }, (_, i) => fixture(i + 1)); }
export function percentile(samples, proportion) { /* nearest-rank; 0 when empty */ }
```

Use a small xorshift32 selector with unsigned arithmetic. Seed it from fixed constants plus trial and VU; return an index in `[0, 9999]`. No random package and no `Math.random()`.

**Step 4: Implement `runStage()` minimally**

Contract:

```js
const result = await runStage({
  concurrency,
  durationMs,
  trial,
  createClient,
  operation,
  validate,
});
```

Create all clients before recording `startedAt`. Run one sequential async loop per client until the monotonic deadline. Time from immediately before `operation(client, context)` until resolution/rejection. A resolved response counts only after `validate` returns true. Capture bounded error-class counts and at most 20 sanitized error samples; never record request headers, credentials, payload secrets, or environment variables.

Install a stage-level hard guard at `durationMs + 60_000` that rejects the stage if in-flight promises do not settle. Clear it on success. Do not implement per-request retries or timeouts.

**Step 5: Implement summary aggregation**

`summary.mjs` accepts four stage objects and returns the framework summary shape. `duration_seconds` is the sum of actual measured stage durations including in-flight drain. `completed_operations` is successful operations; `failed_operations` is failures; top-level `error_rate` is aggregate failures/attempts, with zero attempts defined as zero.

**Step 6: Verify GREEN**

Run:

```sh
node --test test/basic_js_test.mjs
sh test/bench_test.sh
```

Expected: Node tests pass; shell suite prints `PASS`.

**Step 7: Commit**

```sh
git add benchmark-sets/basic-js-v1/shared/lib test/basic_js_test.mjs test/bench_test.sh
git commit -m "feat: add shared JavaScript load runner"
```

---

### Task 3: Add the benchmark set, package lock, and methodologies

**Files:**
- Create: `benchmark-sets/basic-js-v1/set.conf`
- Create: `benchmark-sets/basic-js-v1/README.md`
- Create: `benchmark-sets/basic-js-v1/shared/package.json`
- Create: `benchmark-sets/basic-js-v1/shared/package-lock.json`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/benchmark.conf`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/METHODOLOGY.md`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/benchmark.conf`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/METHODOLOGY.md`
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/benchmark.conf`
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/METHODOLOGY.md`
- Create: each benchmark's empty `fixtures/.gitkeep`
- Modify: `test/basic_js_test.mjs`

**Step 1: Add failing definition-contract tests**

Read the three `benchmark.conf` files from `test/basic_js_test.mjs`. Assert exact primary metric, one warm-up, three measured trials, and all 32 comma-separated required metrics. Assert the set README and every methodology mention `unauthenticated`, `Neon`, `one client per virtual user`, `1, 10, 100, and 1,000`, and the 5/15-second policy.

**Step 2: Run and verify RED**

Run: `node --test test/basic_js_test.mjs`  
Expected: FAIL because metadata/docs are absent.

**Step 3: Create set metadata and documentation**

Use:

```text
schema_version=1
id=basic-js-v1
title=Basic JavaScript API throughput
description=Unauthenticated guestbook list-read, item-read, and write throughput through mainstream JavaScript SDKs
```

The README must list all seven included clients and versions, state that no results/rankings exist yet, explain unauthenticated public read/create access, define virtual users, and explain Neon exclusion prominently.

**Step 4: Create three benchmark configs**

Each config uses the same metrics/trials and an operation-specific title/description. Keep `required_metrics` one line with no whitespace and no duplicate primary metric requirement beyond the framework's harmless revalidation.

**Step 5: Write complete methodologies**

Fill every heading required by `templates/benchmark/METHODOLOGY.md`. Include:

- exact operation and response validation;
- 10,000-row formula and indexes;
- anonymous/public permission boundary;
- one SDK client per VU;
- closed-loop/unpaced semantics;
- one 5-second warm-up and three 15-second measured runs per load;
- setup/readiness/reset outside timing;
- no SDK retry, batching, app cache, or tuning;
- nearest-rank successful-operation latency;
- zero-latency sentinel when no success;
- high error rates as valid overload evidence;
- invalidation rules;
- Appwrite native timestamp/client-generated ID deviation;
- Directus prepared Redis cache disclosure;
- PocketBase nullable JSON fixture-key deviation;
- Neon exclusion and no cross-case ranking claim.

**Step 6: Generate and verify lockfile**

Run:

```sh
npm install --package-lock-only --ignore-scripts --prefix benchmark-sets/basic-js-v1/shared
npm ci --ignore-scripts --prefix benchmark-sets/basic-js-v1/shared
node -e "for (const p of ['@directus/sdk','@nhost/nhost-js','@supabase/supabase-js','appwrite','convex','node-appwrite','pocketbase','trailbase']) console.log(p, require('./benchmark-sets/basic-js-v1/shared/node_modules/' + p + '/package.json').version)"
rm -rf benchmark-sets/basic-js-v1/shared/node_modules
```

Expected: printed versions exactly match the pinned list; `node_modules` is removed before commit.

**Step 7: Verify GREEN**

Run:

```sh
node --test test/basic_js_test.mjs
bin/bench validate all
git diff --check
```

Expected: Node tests pass; validation passes even before cases exist.

**Step 8: Commit**

```sh
git add benchmark-sets/basic-js-v1 test/basic_js_test.mjs
git commit -m "feat: define basic JavaScript throughput methodologies"
```

---

### Task 4: Add shared case dispatch and run orchestration

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/case.sh`
- Create: `benchmark-sets/basic-js-v1/shared/lib/admin.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/run.mjs`
- Modify: `test/basic_js_test.mjs`

**Step 1: Add failing dispatch tests**

Test that `admin.mjs` and `run.mjs` reject unknown actions, platforms, operations, phases, malformed trial numbers, and relative output paths before any import or command execution. Use a fake admin module to prove a measured run resets before each of the four loads, performs untimed readiness, runs stages in order, verifies after each stage, writes four raw files, and emits one summary; warm-up emits raw files but no summary.

**Step 2: Run and verify RED**

Run: `node --test test/basic_js_test.mjs`  
Expected: FAIL because dispatch modules are absent.

**Step 3: Implement `case.sh`**

Keep it POSIX shell. Arguments are action, platform, and operation. Validate them with `case` statements before resolving paths. Derive the repository root from the set directory. Use:

```text
${BAAS_RUNTIME_DIR:-<repo>/.runtime}/benchmarks/basic-js-v1
```

For `setup`, copy `package.json`, lockfile, `lib/`, and `convex/` into the ignored runtime application directory. Run `npm ci --ignore-scripts` only when the lockfile changed or runtime `node_modules` is missing; always refresh source files. Require Node major version at least 22.

Dispatch administrative actions through:

```sh
node "$runtime/lib/admin.mjs" "$action" "$platform" "$operation" ...
```

For `run`, invoke `run.mjs` with `BENCH_PHASE`, `BENCH_TRIAL`, and `BENCH_OUTPUT_DIR`.

**Step 4: Implement run orchestration**

`run.mjs` loops loads `[1,10,100,1000]`, selects 5 seconds for warm-up or 15 seconds for measure, calls admin reset before every stage, performs one untimed readiness operation and cleans it up for writes, runs the stage, writes `$BENCH_OUTPUT_DIR/raw/vu-N.json`, and calls stage verification. Only measured phase writes `summary.json`.

Use dynamic imports from allowlisted platform names; never interpolate arbitrary paths. Warm-ups write raw stage JSON but no summary.

**Step 5: Verify GREEN**

Run:

```sh
node --test test/basic_js_test.mjs
sh -n benchmark-sets/basic-js-v1/shared/case.sh
bin/bench validate all
```

Expected: Node tests pass; shell syntax and definitions-without-cases validate. Do not create a case until its platform adapter/admin implementation is complete; this preserves the repository rule that unfinished cases must not validate.

**Step 6: Commit**

```sh
git add benchmark-sets/basic-js-v1/shared test/basic_js_test.mjs
git commit -m "feat: orchestrate JavaScript benchmark stages"
```

---

For each platform task below, create its three case directories with `bin/bench new case basic-js-v1 <benchmark> <platform> javascript-sdk` only after the adapter and administrator tests pass. Replace every generated marker, make each hook a thin fixed-argument delegation to `shared/case.sh`, complete the case README, and require all three focused `bin/bench validate` commands to pass before committing. Never commit a validating case whose referenced platform module is absent or untested.

### Task 5: Implement Supabase timed and administrative paths

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/lib/adapters/supabase.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/admin/supabase.mjs`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/cases/supabase/javascript-sdk/` (`case.conf`, `README.md`, and five hooks)
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/cases/supabase/javascript-sdk/` (same seven files)
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/cases/supabase/javascript-sdk/` (same seven files)
- Modify: `bin/baas`
- Modify: `test/baas_test.sh`
- Modify: `docs/benchmarks.md`
- Modify: `test/basic_js_test.mjs`

**Step 1: Add failing adapter/admin contract tests**

Use a fake fluent Supabase client to prove list calls `select(...).order(...).limit(20)`, item calls `eq('id', id).single()`, and create calls `insert({author,message}).select('id').single()`. Prove resolved `{error}` is rejected and responses normalize to the logical shape.

Use a fake command runner to assert admin setup/reset/teardown sends SQL only through `bin/baas compose supabase exec -T db psql`, never puts the database password in argv, and preserves the original failure if cleanup fails.

**Step 2: Verify RED**

Run the named Supabase tests; expect missing modules.

**Step 3: Add the minimum `bin/baas compose` seam test-first**

If platform administration cannot use an existing public HTTP admin route, first extend `test/baas_test.sh` with a failing assertion for:

```sh
bin/baas compose supabase exec -T db psql ...
```

Then add a validated `compose SERVICE ...` command that calls existing `run_compose` without `up`, `down`, volume deletion, or service-name interpolation. Document it as benchmark-author plumbing in `docs/benchmarks.md`. This reuses existing Compose path/env logic rather than duplicating it in cases.

**Step 4: Implement Supabase administration**

Create `public.bb_basic_js_v1_guestbook` with UUID primary key, author/message constraints, timestamp default, nullable unique integer fixture key, and `(created_at DESC, fixture_key DESC)` index. Enable RLS; grant anonymous column-level select and insert; create select and insert policies; notify PostgREST schema reload.

Generate deterministic CSV in Node, stream it to container `psql \copy`, query ordered fixture-key/ID pairs into the mode-600 runtime ID map, and assert exact baseline properties. Reset null fixture-key rows. Teardown only the case-owned table and reload schema.

Read `SUPABASE_PUBLISHABLE_KEY` from `.runtime/supabase/docker/.env` as restricted data; never source or print it.

**Step 5: Implement timed adapter**

Create one `createClient('http://127.0.0.1:8000', key)` per VU. Disable auth-session persistence/refresh but do not change fetch transport, PostgREST behavior, or retries. Use exact calls documented in the design research and validate only the logical response.

**Step 6: Verify**

Run unit/contract tests, both shell suites, and `bin/bench validate` for all three Supabase cases. If the real stack is available, run an explicitly diagnostic setup/verify/teardown cycle with shortened direct runner arguments—not `bin/bench publish`—and record only pass/fail notes in the commit message, not benchmark numbers.

**Step 7: Commit**

```sh
git add bin/baas test/baas_test.sh docs/benchmarks.md benchmark-sets/basic-js-v1/shared/lib benchmark-sets/basic-js-v1/benchmarks/*/cases/supabase test/basic_js_test.mjs
git commit -m "feat: add Supabase JavaScript benchmark cases"
```

---

### Task 6: Implement Nhost timed and administrative paths

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/lib/adapters/nhost.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/admin/nhost.mjs`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/cases/nhost/javascript-sdk/` (`case.conf`, `README.md`, and five hooks)
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/cases/nhost/javascript-sdk/` (same seven files)
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/cases/nhost/javascript-sdk/` (same seven files)
- Modify: `test/basic_js_test.mjs`

**Step 1: Add failing GraphQL contract tests**

With a fake Nhost GraphQL client, assert exact list, by-primary-key, and insert-one documents/variables; normalize `response.body.data`; reject GraphQL errors, null item data, missing IDs, wrong list length, and unexpected logical fields.

**Step 2: Verify RED, then implement**

Initialize one client per VU with explicit local `authUrl`, `graphqlUrl`, `storageUrl`, and `functionsUrl`; do not sign in. Timed calls use `nhost.graphql.request` only.

Admin setup uses the Hasura `/v2/query` `pg_run_sql` route for DDL/fixture chunks and `/v1/metadata` for tracking and anonymous `public` select/insert permissions. Read `GRAPHQL_ADMIN_SECRET` from the restricted Nhost `.env` without sourcing it. Put the secret in request headers inside Node, never argv/log output.

Use the same PostgreSQL schema as Supabase. Reset null fixture-key rows through `pg_run_sql`; teardown untracks with `cascade:true` before dropping the table.

**Step 3: Verify and commit**

Run focused Node tests, three case validations, shell suites, and optional diagnostic integration. Commit as `feat: add Nhost JavaScript benchmark cases`.

---

### Task 7: Implement Convex timed and administrative paths

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/lib/adapters/convex.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/admin/convex.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/convex/schema.ts`
- Create: `benchmark-sets/basic-js-v1/shared/convex/guestbook.ts`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/cases/convex/javascript-sdk/` (`case.conf`, `README.md`, and five hooks)
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/cases/convex/javascript-sdk/` (same seven files)
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/cases/convex/javascript-sdk/` (same seven files)
- Modify: `test/basic_js_test.mjs`

**Step 1: Add failing function/adapter tests**

Test the adapter against a fake `ConvexHttpClient`: list/query, get/query, and create/mutation use the generated function references and no admin token or `skipQueue`. Assert one client per VU makes mutations concurrent across clients while each client remains sequential.

**Step 2: Implement Convex schema/functions**

Use `guestbook` fields `author`, `message`, numeric `created_at`, and nullable `fixture_key`; add `by_created_at` and `by_fixture_key` indexes. Public functions validate lengths, project only logical fields, return 20 descending rows, get native ID, and return created ID.

**Step 3: Implement deployment and fixture lifecycle**

Generate an admin key through `bin/baas compose convex exec -T backend ./generate_admin_key.sh`; write it and self-host URL only to a mode-600 runtime env file. Deploy once with `npx convex deploy --env-file ...` from the runtime package.

Import deterministic JSONL with `npx convex import --replace --yes --table guestbook`; export a baseline ZIP and ordered ID map. Reset by importing the baseline ZIP so native IDs remain stable. Teardown empties the table and deploys a cleanup definition or otherwise removes only case-owned functions/schema using a verified pinned CLI path.

**Step 4: Verify and commit**

Run focused tests, generated Convex typecheck/deploy diagnostic, three case validations, and shell suites. Commit as `feat: add Convex JavaScript benchmark cases`.

---

### Task 8: Implement Appwrite TablesDB timed and administrative paths

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/lib/adapters/appwrite.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/admin/appwrite.mjs`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/cases/appwrite/javascript-sdk/` (`case.conf`, `README.md`, and five hooks)
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/cases/appwrite/javascript-sdk/` (same seven files)
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/cases/appwrite/javascript-sdk/` (same seven files)
- Modify: `test/basic_js_test.mjs`

**Step 1: Add failing TablesDB contract tests**

With a fake TablesDB client, assert:

```js
listRows({ databaseId, tableId, queries: [select, orderDesc, limit], total: false })
getRow({ databaseId, tableId, rowId, queries: [select] })
createRow({ databaseId, tableId, rowId: ID.unique(), data: { author, message } })
```

Normalize `$id`/`$createdAt`; validate native ID and response shape. Explicitly prove `ID.unique()` is called once inside each operation and document that its negligible client work is inside timing because it is part of Appwrite's required recommended call.

**Step 2: Build a disposable bootstrap diagnostic before production admin code**

Against the pinned local stack, verify the supported Console sequence without committing credentials or results:

1. create/reuse a runtime-only Console account through project `console`;
2. create an email session with a curl cookie jar;
3. create a team;
4. create the case-owned project through `POST /v1/projects`;
5. create a least-privilege key through `POST /v1/projects/{project}/keys`.

If the pinned server rejects this documented/source-backed Console flow, stop and report the blocker rather than adding database-level project records or requiring an undocumented manual prerequisite.

**Step 3: Implement TablesDB administration**

Use `node-appwrite@28.0.0` with the generated project ID/key. Create a database, table with public read/create and row security disabled, string columns `author`/`message`, nullable integer `fixture_key`, and indexes required by fixture reset/list ordering. Poll asynchronous columns/indexes until `available`, failing on `failed` or timeout.

Bulk-create 10,000 rows through `createRows` using SDK-generated IDs. Use native `$createdAt` for the logical timestamp and create fixtures in deterministic ascending batches. Order list by `$createdAt` descending with a deterministic secondary order supported by the pinned server. Record this timestamp deviation prominently; do not add a custom client timestamp field solely for symmetry.

Reset via administrative `deleteRows` filtered to null fixture keys. Teardown deletes the case database/project/team/account where the pinned Console API safely supports it; otherwise retain only the generated Console account and remove all project data, documenting the retained local prerequisite.

**Step 4: Verify and commit**

Run focused tests, a Node Web-SDK-on-Node smoke diagnostic, three case validations, and shell suites. Commit as `feat: add Appwrite JavaScript benchmark cases`.

---

### Task 9: Implement Directus timed and administrative paths

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/lib/adapters/directus.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/admin/directus.mjs`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/cases/directus/javascript-sdk/` (`case.conf`, `README.md`, and five hooks)
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/cases/directus/javascript-sdk/` (same seven files)
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/cases/directus/javascript-sdk/` (same seven files)
- Modify: `test/basic_js_test.mjs`

**Step 1: Add failing SDK-command tests**

With a fake Directus requester, assert `readItems`, `readItem`, and `createItem` command results normalize correctly; reject missing items/IDs. Assert the anonymous adapter never calls authentication or sets a token.

**Step 2: Implement administration**

Log in using `admin@example.com` and the restricted runtime password. Create collection `bb_basic_js_v1_guestbook`, integer primary ID, bounded string fields, date-created timestamp, nullable unique fixture key, and created-at index.

Discover Directus 12's virtual public access row (`role` and `user` null), obtain its policy ID, and create exactly read/create permissions with projected fields. Do not use stale `role:null` permission payloads.

Load deterministic fixtures through container PostgreSQL `COPY` only if a diagnostic proves the date-created field permits explicit admin timestamps; otherwise use authenticated bulk item creation and verify deterministic ordering before continuing. Reset null fixture-key rows. Teardown permission records and the case collection.

**Step 3: Disclose prepared cache behavior**

Do not disable the repository's prepared Redis cache. State in all Directus READMEs and methodologies that Directus uses its default enabled API cache and auto-purge configuration, and that warm-up intentionally reaches the prepared steady state.

**Step 4: Verify and commit**

Run focused tests, policy/schema integration diagnostic, validations, and shell suites. Commit as `feat: add Directus JavaScript benchmark cases`.

---

### Task 10: Implement PocketBase timed and administrative paths

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/lib/adapters/pocketbase.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/admin/pocketbase.mjs`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/cases/pocketbase/javascript-sdk/` (`case.conf`, `README.md`, and five hooks)
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/cases/pocketbase/javascript-sdk/` (same seven files)
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/cases/pocketbase/javascript-sdk/` (same seven files)
- Modify: `test/basic_js_test.mjs`

**Step 1: Add failing SDK contract tests**

Assert each VU receives a separate `PocketBase` instance and no code calls `autoCancellation(false)`. Test exact `getList(1,20,{sort:'-created_at',fields:'id,author,message,created_at',skipTotal:true})`, `getOne`, and `create` calls.

**Step 2: Implement administration**

Create a runtime-only superuser through `bin/baas compose pocketbase exec -T pocketbase /pb/pocketbase ... superuser upsert`; authenticate via `_superusers`. Create the base collection using the current `fields` payload, public list/view/create rules, no update/delete rules, bounded text fields, `autodate` created-at field, nullable JSON fixture key, and explicit indexes.

Use the superuser SQL endpoint for safely quoted chunked fixture insertion and reset. Keep every SQL request below the pinned endpoint's 5,000-character limit. Query the ID map in pages of at most 1,000. Verify every non-null JSON fixture key is an integer and document this schema deviation.

**Step 3: Verify and commit**

Run focused tests, collection/SQL integration diagnostic, validations, and shell suites. Commit as `feat: add PocketBase JavaScript benchmark cases`.

---

### Task 11: Implement TrailBase timed and administrative paths

**Files:**
- Create: `benchmark-sets/basic-js-v1/shared/lib/adapters/trailbase.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/lib/admin/trailbase.mjs`
- Create: `benchmark-sets/basic-js-v1/shared/trailbase/U1700000000__create_bb_basic_js_v1_guestbook.sql`
- Create: `benchmark-sets/basic-js-v1/shared/trailbase/record-api.textproto`
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-list-throughput/cases/trailbase/javascript-sdk/` (`case.conf`, `README.md`, and five hooks)
- Create: `benchmark-sets/basic-js-v1/benchmarks/read-item-throughput/cases/trailbase/javascript-sdk/` (same seven files)
- Create: `benchmark-sets/basic-js-v1/benchmarks/write-throughput/cases/trailbase/javascript-sdk/` (same seven files)
- Modify: `test/basic_js_test.mjs`

Use a fixed committed migration version, not wall-clock generation during runs.

**Step 1: Add failing client contract tests**

Assert `initClient('http://127.0.0.1:4000')`, `client.records(name).list({pagination:{limit:20},order:['-created_at']})`, `.read(id)`, and `.create({author,message})`. Validate `list().records` and scalar create ID. Assert the package import is `trailbase`, never `@trailbase/client`.

**Step 2: Implement schema/config**

Create a STRICT SQLite table with integer primary key, bounded author/message checks, server-default UTC text timestamp, nullable unique integer fixture key, and descending timestamp index. Configure a world READ/CREATE Record API, exclude `fixture_key`, reject supplied `created_at`, and expose no update/delete/schema ACL.

**Step 3: Implement administration carefully**

First run a diagnostic proving a second container CLI invocation can add/promote a runtime-only admin while the server owns the depot. If it cannot, stop and implement the smallest secure fallback based on pinned startup/admin behavior; do not scrape credentials into logs.

Copy the fixed migration/config fragment into the mounted depot without replacing unrelated configuration, send SIGHUP, and verify migration then config reload. Authenticate the runtime admin and use `/api/_admin/query` for chunked fixtures, counts, ID map, and reset. Teardown through the admin table-delete route so its generated down migration and Record API cleanup remain consistent, then remove the runtime admin.

**Step 4: Verify and commit**

Run focused tests, SIGHUP/restart persistence diagnostic, validations, and shell suites. Commit as `feat: add TrailBase JavaScript benchmark cases`.

---

### Task 12: Complete cross-platform contract tests and documentation

**Files:**
- Modify: `test/basic_js_test.mjs`
- Modify: `test/bench_test.sh`
- Modify: `README.md`
- Modify: `docs/benchmarks.md`
- Modify: all three methodologies and any case README found inaccurate by diagnostics

**Step 1: Add final failing cross-platform assertions**

For every adapter, use a fake client to prove:

- one client per VU;
- exactly four normalized logical fields for reads;
- exactly 20 newest records for list;
- native-ID item selection from the runtime map;
- one write and non-empty ID;
- no authentication session, retry, batch, update, or delete in timed code.

For every admin implementation, fake command/fetch boundaries and prove setup/reset/verify/teardown actions are allowlisted, runtime files use restrictive modes, and secrets do not appear in returned diagnostics.

**Step 2: Run RED then implement only missing checks/fixes**

Do not add abstractions beyond duplicated behavior actually found across at least two platform modules. Prefer explicit adapters over a configurable universal API mapper.

**Step 3: Update user documentation**

README should show:

```sh
bin/bench validate all
bin/bench run basic-js-v1 read-list-throughput supabase javascript-sdk
bin/bench run basic-js-v1 read-item-throughput pocketbase javascript-sdk
bin/bench run basic-js-v1 write-throughput trailbase javascript-sdk
```

Explain Node 22/npm requirements, runtimes installed under `.runtime`, approximate per-case duration, anonymous access, VU semantics, and no committed results yet. `docs/benchmarks.md` should document optional set-level `shared/` capture and `bin/baas compose` if added.

**Step 4: Run complete automated verification**

```sh
sh -n bin/baas bin/bench test/baas_test.sh test/bench_test.sh
find benchmark-sets/basic-js-v1 -name '*.sh' -exec sh -n {} +
node --test test/basic_js_test.mjs
sh test/baas_test.sh
sh test/bench_test.sh
bin/bench validate all
git diff --check
git status --short
```

Expected: all tests and validation pass; no `node_modules`, `.runtime`, `.results`, credentials, connection strings, raw outputs, or unresolved markers appear in Git status.

**Step 5: Run bounded real-stack diagnostics**

For each platform, start it once and exercise setup, verify, one short direct stage per operation, reset, and teardown. Do not use shortened runs as publishable evidence and do not report throughput numbers. Confirm all stacks are stopped afterward:

```sh
bin/baas stop all
bin/baas status
```

If a real stack cannot be validated, leave its case non-runnable with an explicit marker that fails validation rather than committing an apparently complete unverified case.

**Step 6: Commit**

```sh
git add README.md docs/benchmarks.md benchmark-sets/basic-js-v1 test
git commit -m "docs: complete basic JavaScript benchmark workflow"
```

---

### Task 13: Fresh review, fix pass, and final verification

**Files:**
- Modify only files required by accepted review findings.

**Step 1: Request independent review**

Use the requesting-code-review skill. Require evidence-backed review of:

- benchmark equivalence and material deviations;
- one-client-per-VU concurrency correctness;
- timing/percentile/error math;
- public permission boundaries;
- secret and runtime-state handling;
- reset correctness and stable native-ID maps;
- POSIX shell quoting/portability;
- exact SDK/server compatibility;
- definition snapshot/publication integrity;
- whether Neon exclusion and anonymous access are prominent.

**Step 2: Apply only verified findings**

For every accepted behavior fix, add or adjust a failing regression first, observe RED, apply the smallest fix, and observe GREEN. Do not add rankings, dashboards, adaptive loads, authentication, or unrequested variants.

**Step 3: Run final required checks**

```sh
sh -n bin/baas bin/bench test/baas_test.sh test/bench_test.sh
find benchmark-sets/basic-js-v1 -name '*.sh' -exec sh -n {} +
node --test test/basic_js_test.mjs
sh test/baas_test.sh
sh test/bench_test.sh
bin/bench validate all
git diff --check
git status --short --branch
```

**Step 4: Inspect final evidence**

Confirm the Git diff contains only intended source, definitions, tests, and docs. Confirm no benchmark result is published and no performance claim/ranking is made.

**Step 5: Commit review fixes if any**

```sh
git add <only-reviewed-files>
git commit -m "fix: address JavaScript benchmark review"
```
