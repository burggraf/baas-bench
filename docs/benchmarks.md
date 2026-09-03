# Benchmark authoring

A **set** is a versioned collection, a **benchmark** is its shared question and methodology, and a **case** is one platform/access-path implementation. A shared contract does not make every case directly comparable: report and filter access path, topology, client, and other material dimensions.

## Commands

```sh
bin/bench new set <set>
bin/bench new benchmark <set> <benchmark>
bin/bench new case <set> <benchmark> <platform> <variant>
bin/bench validate all
bin/bench validate <set>/<benchmark>/<platform>/<variant>
bin/bench run <set> <benchmark> <platform> <variant> [--allow-dirty] [--keep]
bin/bench publish .results/<run-id>
```

Benchmark administrators that need a container-native tool may use `bin/baas compose <service> <compose-args...>`. This validated passthrough reuses the prepared service's project directory, Compose files, and restricted environment without duplicating deployment knowledge in a case. It rejects Compose `up` and `down`; platform lifecycle remains owned by `bin/bench run`.

## Directory model

```text
benchmark-sets/<set>/
  set.conf
  README.md
  shared/                 # optional set-level files captured with each run
  benchmarks/<benchmark>/
    benchmark.conf
    METHODOLOGY.md
    fixtures/
    cases/<platform>/<variant>/
      case.conf
      README.md
      setup.sh
      verify.sh
      reset.sh
      run.sh
      teardown.sh
```

A set groups a versioned body of work. A benchmark owns the fairness-sensitive contract. A case is one implementation of that contract. Put REST, GraphQL, database-function, direct database, pooled database, ORM, and extension implementations in separate cases even when they target the same platform.

A set may contain an optional `shared/` directory for workload code or other definitions shared by its cases. When present, `bin/bench run` snapshots it under `definitions/benchmark-sets/<set>/shared/`; it is included in definition checksums and publication consistency checks. Sets without `shared/` do not receive an empty directory.

## Authoring walkthrough

The following names illustrate the workflow; they are not committed definitions:

1. Run `bin/bench new set example-v1`. Complete its `set.conf` and README.
2. Run `bin/bench new benchmark example-v1 read-throughput`. Complete `benchmark.conf` and every section of `METHODOLOGY.md`; place deterministic shared fixture inputs under `fixtures/`.
3. Run `bin/bench new case example-v1 read-throughput supabase rest-api`. Complete `case.conf`, document its exact path and deviations, and implement all five hooks.
4. Create additional platform/access-path cases under the same benchmark. Each must preserve the benchmark's operation semantics and declared metrics.
5. Run `bin/bench validate example-v1/read-throughput/supabase/rest-api`, then `bin/bench validate all` before committing.
6. Commit the completed definitions. Clean committed definitions are required for publishable runs.
7. Run `bin/bench run example-v1 read-throughput supabase rest-api`. The runner starts and later stops Supabase; do not wrap it in a separate `bin/baas start`.
8. Inspect `.results/<run-id>/run.json`, `environment.json`, logs, summaries, and raw output. Fix the case rather than publishing an invalid run.
9. Run `bin/bench publish .results/<run-id>` to copy validated compact evidence into `results/`, then review and commit that evidence.

## Metadata

Use one `key=value` entry per line. Metadata is parsed as data and never sourced as shell. Blank lines, comments, duplicate keys, control characters, empty required values, and secret-like keys are rejected.

`set.conf`:

| Key | Meaning |
|---|---|
| `schema_version` | Must be `1`. |
| `id` | Must match the set directory. |
| `title` | Human-readable title. |
| `description` | Scope of the set. |

`benchmark.conf` adds:

| Key | Meaning |
|---|---|
| `id` | Must match the benchmark directory. |
| `primary_metric` | Lowercase underscore metric key. |
| `primary_unit` | Reported unit, such as `ops/s` or `ms`. |
| `primary_direction` | `higher` or `lower`. |
| `required_metrics` | Comma-separated numeric metric keys required from every case. |
| `warmup_trials` | Non-negative integer. |
| `measured_trials` | Positive integer. |

`case.conf` adds:

| Key | Meaning |
|---|---|
| `platform` | One of the names returned by `bin/baas list`; must match the path. |
| `variant` | Lowercase hyphenated case name; must match the path. |
| `access_path` | API, function, direct database, ORM, extension, or another disclosed path. |
| `connection` | Connection topology such as HTTP, direct, or pooler. |
| `client` | Load client, SDK, driver, or ORM. |
| `implementation` | Implementation language/runtime. |

Set, benchmark, platform, and variant IDs use lowercase letters, digits, and hyphens. Metric keys use lowercase letters, digits, and underscores.

## Hooks

Hooks are executable POSIX shell scripts. `setup.sh` creates case-owned resources; `verify.sh` checks fixtures and correctness; `reset.sh` restores the baseline before every trial; `run.sh` executes one trial; `teardown.sh` removes case-owned resources. Each receives `BENCH_PHASE`, `BENCH_TRIAL`, and absolute `BENCH_OUTPUT_DIR`. Setup, initial verification, and teardown use phases `setup`, `verify`, and `teardown` with trial `0`; per-trial reset, run, and verification use phase `warmup` or `measure` with a one-based trial number.

Measured runs must write `$BENCH_OUTPUT_DIR/summary.json`. Native output belongs in `$BENCH_OUTPUT_DIR/raw/`.

```json
{
  "schema_version": 1,
  "duration_seconds": 10,
  "completed_operations": 1000,
  "failed_operations": 0,
  "error_rate": 0,
  "metrics": {
    "operations_per_second": 100,
    "latency_p95_ms": 12.4
  }
}
```

The duration and operation counts must be non-negative numbers, `error_rate` must be between 0 and 1, and every metric declared by `primary_metric` or `required_metrics` must exist and be numeric. The framework intentionally does not prescribe k6: `run.sh` may invoke k6, xk6, TypeScript, Rust, or another case-appropriate client.

## Runner lifecycle

A run validates definitions, acquires the single-host lock, snapshots definitions and checksums, records Git/Docker/host provenance, starts the selected BaaS, performs setup and initial verification, resets and executes each warm-up/measured trial, verifies correctness after each trial, and always attempts teardown and platform stop. Run bundles are atomically finalized as `complete`, `failed`, `invalid`, or `debug`.

## Review checklist

Review objective and non-goals, correctness equivalence, measured boundary, dataset/distribution/seed/indexes, authentication, cache and warm-up, workload, connections/retries/timeouts, environment, trial policy, metrics, deviations, and limitations. Fairness-sensitive values belong in methodology; disclose permitted platform tuning and deviations in the case README.

## Results

Local bundles live under ignored `.results/<run-id>/` with manifests, copied definitions, logs, warm-ups, and measured trials. Publishing writes `results/<set>/<benchmark>/<platform>/<variant>/<run-id>/` containing manifests, checksums, definitions, and measured summaries—not raw output or warm-ups.

Failures and interrupted runs are finalized as failed or invalid and retain diagnostic logs. `--keep` is for debugging only, leaves resources running, and is not publishable. `--allow-dirty` permits diagnostic execution but records a dirty run that also cannot be published. Teardown and platform shutdown are attempted automatically unless resources are deliberately kept.

Only one run may own `.results/.lock`; its `owner` file identifies the process and host. Normal exits and handled signals remove the lock. After an uncatchable process kill, confirm no benchmark is active before removing a stale lock manually.

Publication requires a clean selected definition tree at the recorded Git commit. It revalidates manifests, lifecycle completion, case definitions, measured summaries, service-version provenance, and checksums before atomically creating the committed result directory.
