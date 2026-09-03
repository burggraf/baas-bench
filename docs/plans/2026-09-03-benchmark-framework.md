# Benchmark Framework Implementation Plan

**Status:** Implemented. See [`docs/benchmarks.md`](../benchmarks.md) for current operational documentation.

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add dependency-light templates and a POSIX shell CLI for scaffolding, validating, running, and publishing reproducible cross-platform benchmark cases without adding an actual benchmark.

**Architecture:** `benchmark-sets/<set>/benchmarks/<benchmark>/cases/<platform>/<variant>` holds definitions; committed `templates/` supplies authoring scaffolds. `bin/bench` parses restricted `key=value` metadata, delegates platform lifecycle to `bin/baas`, invokes five case hooks, writes immutable JSON run bundles under ignored `.results/`, and publishes validated compact evidence under `results/`.

**Tech Stack:** POSIX shell, `jq` 1.6+, existing `bin/baas`, Git, Docker CLI, `shasum`/`sha256sum`, shell regression tests.

**Working agreement:** The user explicitly requested implementation on `main`; do not create a worktree.

---

## Shared contracts

Implement these contracts once and keep them stable throughout the tasks.

### Metadata files

`set.conf` required keys:

```text
schema_version=1
id=<path set id>
title=<non-TODO text>
description=<non-TODO text>
```

`benchmark.conf` required keys:

```text
schema_version=1
id=<path benchmark id>
title=<non-TODO text>
description=<non-TODO text>
primary_metric=<metric key>
primary_unit=<unit text>
primary_direction=higher|lower
required_metrics=<comma-separated metric keys>
warmup_trials=<non-negative integer>
measured_trials=<positive integer>
```

`case.conf` required keys:

```text
schema_version=1
platform=<supported bin/baas platform>
variant=<path variant id>
access_path=<non-TODO text>
connection=<non-TODO text>
client=<non-TODO text>
implementation=<non-TODO text>
```

Identifiers and metric keys match `[a-z0-9][a-z0-9-]*` and `[a-z][a-z0-9_]*` respectively. Configuration lines match `^[a-z][a-z0-9_]*=[^[:cntrl:]]*$`; reject blank required values, duplicate keys, unknown schema versions, and sensitive keys matching `password|secret|token|credential|api_key|connection_string`.

### Trial summary

Every measured trial writes this minimum JSON shape to `$BENCH_OUTPUT_DIR/summary.json`:

```json
{
  "schema_version": 1,
  "duration_seconds": 10,
  "completed_operations": 1000,
  "failed_operations": 0,
  "error_rate": 0,
  "metrics": {
    "operations_per_second": 100
  }
}
```

The four numeric values must be non-negative, `error_rate` must be at most 1, and every metric named by `primary_metric` and `required_metrics` must exist with a numeric value.

### Test overrides

`bin/bench` must honor these testable path overrides:

```sh
SETS=${BENCH_SETS_DIR:-$ROOT/benchmark-sets}
LOCAL_RESULTS=${BENCH_LOCAL_RESULTS_DIR:-$ROOT/.results}
PUBLISHED_RESULTS=${BENCH_RESULTS_DIR:-$ROOT/results}
BAAS=${BENCH_BAAS_BIN:-$ROOT/bin/baas}
```

`BENCH_ALLOW_DIRTY=1` is equivalent to `run --allow-dirty` for test fixtures. Do not add further configuration until a real benchmark needs it.

---

### Task 1: Add committed authoring templates and scaffolding

**Files:**
- Create: `templates/benchmark-set/set.conf`
- Create: `templates/benchmark-set/README.md`
- Create: `templates/benchmark/benchmark.conf`
- Create: `templates/benchmark/METHODOLOGY.md`
- Create: `templates/case/case.conf`
- Create: `templates/case/README.md`
- Create: `templates/case/setup.sh`
- Create: `templates/case/verify.sh`
- Create: `templates/case/reset.sh`
- Create: `templates/case/run.sh`
- Create: `templates/case/teardown.sh`
- Create: `benchmark-sets/.gitkeep`
- Create: `results/.gitkeep`
- Create: `bin/bench`
- Create: `test/bench_test.sh`

**Step 1: Write the failing scaffolding test**

Create `test/bench_test.sh` with a temporary definitions/results root and these first assertions:

```sh
#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
BENCH="$ROOT/bin/bench"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

export BENCH_SETS_DIR="$TMP/benchmark-sets"
export BENCH_LOCAL_RESULTS_DIR="$TMP/.results"
export BENCH_RESULTS_DIR="$TMP/results"

"$BENCH" new set core-v1
"$BENCH" new benchmark core-v1 read-throughput
"$BENCH" new case core-v1 read-throughput supabase rest-api

SET="$BENCH_SETS_DIR/core-v1"
BENCHMARK="$SET/benchmarks/read-throughput"
CASE="$BENCHMARK/cases/supabase/rest-api"

[ -f "$SET/set.conf" ] || fail "set scaffold missing"
[ -f "$BENCHMARK/METHODOLOGY.md" ] || fail "methodology scaffold missing"
[ -f "$CASE/case.conf" ] || fail "case scaffold missing"
for hook in setup verify reset run teardown; do
  [ -x "$CASE/$hook.sh" ] || fail "$hook hook is not executable"
done
grep -q '^id=core-v1$' "$SET/set.conf" || fail "set id was not substituted"
grep -q '^id=read-throughput$' "$BENCHMARK/benchmark.conf" || fail "benchmark id was not substituted"
grep -q '^platform=supabase$' "$CASE/case.conf" || fail "platform was not substituted"
grep -q '^variant=rest-api$' "$CASE/case.conf" || fail "variant was not substituted"

if "$BENCH" new set core-v1 >/dev/null 2>&1; then
  fail "existing set was overwritten"
fi
if "$BENCH" new case core-v1 read-throughput unknown rest-api >/dev/null 2>&1; then
  fail "unknown platform was accepted"
fi

printf '%s\n' PASS
```

**Step 2: Run the test and verify it fails**

Run: `sh test/bench_test.sh`  
Expected: FAIL because `bin/bench` does not exist.

**Step 3: Add the minimum templates**

Use the shared metadata contracts above. Template values that authors must replace are exactly `TODO`, making them easy to validate.

Every hook starts with:

```sh
#!/bin/sh
set -eu
echo "TODO: implement <hook> for this case" >&2
exit 1
```

`METHODOLOGY.md` contains headings for every approved methodology decision: objective/non-goals, correctness, measured boundary, dataset, authentication, cache/warm-up, workload, connections/retries/timeouts, environment, trial policy, metrics, deviations, and limitations.

`templates/case/README.md` contains headings for endpoint/query path, implementation/dependencies, setup, indexes, auth, connections/pooling, tuning, and deviations.

**Step 4: Implement only `new` in `bin/bench`**

Start with:

```sh
#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SETS=${BENCH_SETS_DIR:-$ROOT/benchmark-sets}
LOCAL_RESULTS=${BENCH_LOCAL_RESULTS_DIR:-$ROOT/.results}
PUBLISHED_RESULTS=${BENCH_RESULTS_DIR:-$ROOT/results}
BAAS=${BENCH_BAAS_BIN:-$ROOT/bin/baas}
TEMPLATES=$ROOT/templates

usage() {
  echo "usage: bin/bench {new|validate|run|publish} ..." >&2
  exit 2
}

valid_id() { printf '%s\n' "$1" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; }
valid_platform() { "$BAAS" list | grep -qx "$1"; }
replace() {
  file=$1 token=$2 value=$3
  sed "s|{{$token}}|$value|g" "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}
```

Implement:

- `new set ID`: copy `templates/benchmark-set`, create `benchmarks/`, substitute `SET_ID`.
- `new benchmark SET ID`: require the set, copy `templates/benchmark`, create `fixtures/` and `cases/`, substitute `BENCHMARK_ID`.
- `new case SET BENCHMARK PLATFORM VARIANT`: require the benchmark and supported platform, copy `templates/case`, substitute `PLATFORM` and `VARIANT`, then `chmod +x` all hooks.
- reject invalid IDs and existing destinations before writing anything.

**Step 5: Run the scaffolding test**

Run: `sh test/bench_test.sh`  
Expected: `PASS`.

**Step 6: Commit**

```sh
git add templates benchmark-sets results bin/bench test/bench_test.sh
git commit -m "feat: add benchmark authoring templates"
```

---

### Task 2: Validate benchmark definitions

**Files:**
- Modify: `test/bench_test.sh`
- Modify: `bin/bench`

**Step 1: Add failing validation assertions**

After scaffolding, assert the fresh TODO-filled definition fails:

```sh
if "$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null 2>&1; then
  fail "unfinished template passed validation"
fi
```

Replace all TODO values and methodology markers in the temporary tree using test-only `sed`, then assert:

```sh
"$BENCH" validate core-v1/read-throughput/supabase/rest-api >/dev/null || fail "valid case failed validation"
"$BENCH" validate all >/dev/null || fail "valid tree failed validation"
```

Add isolated mutations, restoring each afterward, proving rejection of:

- duplicate metadata key;
- `schema_version=2`;
- path/ID mismatch;
- unsupported platform;
- non-integer or zero `measured_trials`;
- invalid primary direction;
- missing required hook;
- non-executable hook;
- shell syntax error;
- unresolved `TODO` in methodology/case docs or hooks;
- sensitive metadata key such as `password=do-not-store-this`.

**Step 2: Run and verify failure**

Run: `sh test/bench_test.sh`  
Expected: FAIL because `validate` is not implemented.

**Step 3: Add safe configuration helpers**

Implement without `eval` or `.`:

```sh
conf_value() {
  awk -F= -v wanted="$2" '$1 == wanted { sub(/^[^=]*=/, ""); print; found++ }
    END { exit found == 1 ? 0 : 1 }' "$1"
}
```

Add helpers that validate line syntax, duplicates, required keys, sensitive key names, identifiers, integers, allowed enums, and unresolved `TODO` markers. Keep error messages path-specific.

Case validation derives set, benchmark, platform, and variant from the path; it validates parent manifests before the case. `validate all` finds `case.conf` files beneath `$SETS` in sorted order and validates every leaf. If no cases exist, it still validates each set and benchmark manifest it finds.

Use `sh -n` for every lifecycle hook. Require `jq` only for run-result validation, not for authoring/scaffolding commands.

**Step 4: Run focused and existing tests**

Run:

```sh
sh -n bin/bench test/bench_test.sh
sh test/bench_test.sh
sh test/baas_test.sh
```

Expected: both suites print `PASS`.

**Step 5: Commit**

```sh
git add bin/bench test/bench_test.sh
git commit -m "feat: validate benchmark definitions"
```

---

### Task 3: Run the happy-path lifecycle and collect trial output

**Files:**
- Modify: `test/bench_test.sh`
- Modify: `bin/bench`

**Step 1: Add a fake platform lifecycle and deterministic hooks**

Create a fake `$BENCH_BAAS_BIN` in the test temp directory. `list` prints the eight platforms; `start` and `stop` append to `$BENCH_TEST_LOG`.

Replace generated hooks with test hooks that append these records:

```text
setup
verify
reset:warmup:1
run:warmup:1
verify
reset:measure:1
run:measure:1
verify
reset:measure:2
run:measure:2
verify
teardown
```

The run hook writes valid `summary.json` only when `BENCH_PHASE=measure`; configure one warm-up and two measured trials. Export `BENCH_ALLOW_DIRTY=1` because the temporary definitions are not committed.

Assert `bin/bench run ...`:

- invokes `baas start supabase` before setup;
- follows the exact hook order above;
- invokes `baas stop supabase` last;
- creates exactly one finalized run directory;
- creates two measured summary files and no required warm-up summary;
- writes `run.json` with `status=complete` and `debug=false`.

**Step 2: Run and verify failure**

Run: `sh test/bench_test.sh`  
Expected: FAIL because `run` is not implemented.

**Step 3: Add required tool and result validation helpers**

For `run` and `publish`, require `jq`, `git`, `docker`, and either `shasum` or `sha256sum`. Add a `sha256` helper selecting the available native command.

Validate trial summaries with one `jq -e` expression covering the shared contract and required metrics parsed from `benchmark.conf`. Do not aggregate trial values.

**Step 4: Implement the successful lifecycle**

Parse:

```sh
bin/bench run SET BENCHMARK PLATFORM VARIANT [--allow-dirty] [--keep]
```

Reject extra/unknown flags. Before running:

- validate the case;
- reject tracked/untracked changes below its set unless allowed;
- acquire `$LOCAL_RESULTS/.lock` with `mkdir`;
- create `.tmp-$RUN_ID` beneath `$LOCAL_RESULTS`;
- copy only selected set, benchmark, fixtures, and case definitions into `definitions/`;
- write hook logs separately.

Use a run ID composed of UTC timestamp, identities, and PID. Export absolute `BENCH_OUTPUT_DIR`, plus `BENCH_PHASE` and one-based `BENCH_TRIAL` for each hook. Invoke reset before every warm-up and measured run and verify after each. Require normalized summaries only for measured runs.

At successful completion, write `run.json`, rename the temporary directory atomically to `$LOCAL_RESULTS/$RUN_ID`, and print that path.

**Step 5: Run all shell tests**

Run:

```sh
sh test/bench_test.sh
sh test/baas_test.sh
```

Expected: both print `PASS`.

**Step 6: Commit**

```sh
git add bin/bench test/bench_test.sh
git commit -m "feat: run benchmark case lifecycle"
```

---

### Task 4: Make failures, interrupts, locking, and provenance safe

**Files:**
- Modify: `test/bench_test.sh`
- Modify: `bin/bench`

**Step 1: Add failing safety tests**

Add independent assertions that:

1. A failing `run.sh` returns non-zero, still invokes teardown and platform stop, keeps logs, and finalizes `status=failed`.
2. A post-run `verify.sh` failure finalizes `status=invalid`.
3. A malformed/missing measured `summary.json` finalizes `status=invalid`.
4. Pre-creating `$LOCAL_RESULTS/.lock` rejects a second run before platform start.
5. A hook sending `TERM` to its parent triggers teardown/stop and returns non-zero.
6. `--keep` skips teardown/stop, finalizes `debug=true`, and never reports a normal complete publishable run.
7. Without `--allow-dirty` or `BENCH_ALLOW_DIRTY=1`, changed definitions are rejected.

Use separate temporary result directories per scenario so failed bundles are unambiguous.

**Step 2: Run and verify at least one new assertion fails**

Run: `sh test/bench_test.sh`  
Expected: FAIL in cleanup/status behavior.

**Step 3: Implement one cleanup trap**

Track these plain shell variables:

```sh
LOCK_HELD=0
PLATFORM_STARTED=0
SETUP_STARTED=0
KEEP=0
RUN_STATUS=failed
PRIMARY_EXIT=0
```

Install traps only after acquiring the lock. The cleanup function must:

- disable its own traps first;
- preserve the original exit status;
- attempt teardown if setup started and not keeping resources;
- attempt `baas stop` if platform started and not keeping resources;
- record cleanup failures without hiding an earlier failure;
- write/finalize run metadata when a temporary run exists;
- remove the lock;
- exit non-zero for failed, invalid, interrupted, or cleanup-failed runs.

Set `RUN_STATUS=invalid` immediately before post-run correctness/summary validation and back to `failed` before beginning another operational step. Set it to `complete` only after all trials pass. For `--keep`, use `status=debug` rather than `complete`.

**Step 4: Capture bounded, safe provenance**

Generate `environment.json` from an explicit allowlist only:

- `uname -s` and `uname -m`;
- Docker server version;
- Compose version;
- Docker-reported CPU count and memory bytes;
- Git commit;
- SHA-256 of `versions.env`;
- UTC timestamp.

Never enumerate process environment variables, Compose environment, or service connection strings. Generate JSON only through `jq -n --arg/--argjson`.

Generate a sorted `definitions.sha256` covering copied definition files and scripts.

**Step 5: Run tests and inspect one bundle**

Run:

```sh
sh -n bin/bench test/bench_test.sh
sh test/bench_test.sh
sh test/baas_test.sh
find "$BENCH_LOCAL_RESULTS_DIR" -maxdepth 3 -type f | sort  # inside test diagnostics if needed
```

Expected: tests pass; complete and failed runs retain metadata/log evidence; no secret values appear.

**Step 6: Commit**

```sh
git add bin/bench test/bench_test.sh
git commit -m "fix: make benchmark runs failure-safe"
```

---

### Task 5: Publish only valid compact evidence

**Files:**
- Modify: `test/bench_test.sh`
- Modify: `bin/bench`

**Step 1: Add failing publication tests**

From the happy-path local bundle, assert:

```sh
published=$($BENCH publish "$run_dir")
expected="$BENCH_RESULTS_DIR/core-v1/read-throughput/supabase/rest-api/$run_id"
[ "$published" = "$expected" ] || fail "unexpected publish destination"
[ -f "$expected/run.json" ] || fail "published run manifest missing"
[ -f "$expected/trials/001/summary.json" ] || fail "published summary missing"
[ ! -d "$expected/trials/001/raw" ] || fail "raw output was committed"
```

Also prove publication rejects:

- failed, invalid, or debug runs;
- incomplete/malformed run metadata;
- missing/malformed measured summary;
- current Git HEAD different from the recorded run commit;
- dirty selected definitions;
- an existing destination;
- a source outside `$LOCAL_RESULTS`.

**Step 2: Run and verify failure**

Run: `sh test/bench_test.sh`  
Expected: FAIL because `publish` is not implemented.

**Step 3: Implement publication**

Canonicalize the source using `cd "$source" && pwd -P` and require it to be an immediate child of canonical `$LOCAL_RESULTS`. Validate `run.json` with `jq`, requiring `status=complete`, `debug=false`, all path identities, run ID, and recorded commit.

Re-run selected definition validation, checksum validation, current clean/commit checks, and every measured summary validation. Create the destination only after all checks pass.

Copy:

```text
run.json
environment.json
definitions.sha256
definitions/
trials/*/summary.json
```

Do not copy hook logs, warm-ups, or `raw/`. Use a temporary sibling destination and atomic rename. Print the final path.

**Step 4: Run all tests**

Run:

```sh
sh test/bench_test.sh
sh test/baas_test.sh
git diff --check
```

Expected: both test suites print `PASS`; no whitespace errors.

**Step 5: Commit**

```sh
git add bin/bench test/bench_test.sh
git commit -m "feat: publish validated benchmark evidence"
```

---

### Task 6: Document the author workflow and verify the framework

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Create: `docs/benchmarks.md`
- Modify: `test/bench_test.sh`

**Step 1: Add repository hygiene assertions**

Add to `test/bench_test.sh`:

```sh
grep -qx '\.results/' "$ROOT/.gitignore" || fail "local benchmark results are not ignored"
[ -d "$ROOT/results" ] || fail "published results directory missing"
```

Run: `sh test/bench_test.sh`  
Expected: FAIL until `.results/` is ignored.

**Step 2: Document the minimum workflow**

Add `.results/` to `.gitignore`.

Update `README.md` with a short Benchmark Framework section linking the design and authoring guide, and list `jq` as required only for running/publishing benchmarks.

Create `docs/benchmarks.md` covering:

1. the set/benchmark/case distinction;
2. all `bin/bench` commands;
3. a complete authoring walkthrough using example names but explicitly not creating those definitions;
4. metadata field reference;
5. lifecycle hook inputs and responsibilities;
6. normalized summary JSON contract;
7. methodology/reviewer checklist;
8. local result and publication layouts;
9. failure/debug behavior;
10. rules for fair case variants and disclosure of platform-specific tuning.

State clearly that a shared benchmark contract does not imply every case is directly comparable; access path and other dimensions must be reported and filtered.

**Step 3: Run complete verification**

Run:

```sh
sh -n bin/baas bin/bench test/baas_test.sh test/bench_test.sh
sh test/baas_test.sh
sh test/bench_test.sh
bin/bench validate all
git diff --check
git status --short
```

Expected:

- both test suites print `PASS`;
- `validate all` succeeds with no actual benchmarks present;
- only intended framework files are modified;
- no `.results/` files appear in Git status.

**Step 4: Request code review**

Use the requesting-code-review skill. The review must inspect:

- shell portability and quoting;
- path traversal and unsafe metadata execution;
- cleanup behavior under failures/signals;
- secret/provenance handling;
- publication eligibility checks;
- whether templates cover the approved methodology.

Apply only verified findings, rerunning the complete verification command afterward.

**Step 5: Commit and push**

```sh
git add .gitignore README.md docs/benchmarks.md test/bench_test.sh
git commit -m "docs: add benchmark authoring workflow"
git push
git status --short --branch
```

Expected: branch is clean and synchronized with `origin/main`.
