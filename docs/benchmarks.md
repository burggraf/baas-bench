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

## Authoring walkthrough

To author an example, run `new set example-v1`, then create benchmark `read-throughput` and case `supabase/rest-api`; these names illustrate the workflow only and are not definitions in this repository. Replace every `TODO`, complete the methodology, and validate before running.

## Metadata

`set.conf` requires schema version, id, title, and description. `benchmark.conf` additionally requires primary metric/unit/direction, required metrics, and non-negative warmups plus positive measured trials. `case.conf` requires platform, variant, access path, connection, client, and implementation. IDs use lowercase hyphenated names; metric keys use lowercase underscore names. Metadata is data, never shell source, and must not contain secrets. Use one `key=value` entry per line; blank lines, comments, duplicate keys, and control characters are rejected.

## Hooks

Hooks are executable POSIX shell scripts. `setup.sh` creates case-owned resources; `verify.sh` checks fixtures and correctness; `reset.sh` restores the baseline before every trial; `run.sh` executes one trial; `teardown.sh` removes case-owned resources. Each receives `BENCH_PHASE`, `BENCH_TRIAL`, and absolute `BENCH_OUTPUT_DIR`. Setup, initial verification, and teardown use phases `setup`, `verify`, and `teardown` with trial `0`; per-trial reset, run, and verification use phase `warmup` or `measure` with a one-based trial number.

Measured runs must write `summary.json` containing numeric non-negative `duration_seconds`, `completed_operations`, `failed_operations`, `error_rate` (0–1), schema version 1, and declared numeric metrics. Native output belongs in a trial's local `raw/` directory.

## Review checklist

Review objective and non-goals, correctness equivalence, measured boundary, dataset/distribution/seed/indexes, authentication, cache and warm-up, workload, connections/retries/timeouts, environment, trial policy, metrics, deviations, and limitations. Fairness-sensitive values belong in methodology; disclose permitted platform tuning and deviations in the case README.

## Results

Local bundles live under ignored `.results/<run-id>/` with manifests, copied definitions, logs, warm-ups, and measured trials. Publishing writes `results/<set>/<benchmark>/<platform>/<variant>/<run-id>/` containing manifests, checksums, definitions, and measured summaries—not raw output or warm-ups.

Failures and interrupted runs are finalized as failed or invalid and retain diagnostic logs. `--keep` is for debugging only, leaves resources running, and is not publishable. `--allow-dirty` permits diagnostic execution but records a dirty run that also cannot be published. Teardown and platform shutdown are attempted automatically unless resources are deliberately kept.

Only one run may own `.results/.lock`; its `owner` file identifies the process and host. Normal exits and handled signals remove the lock. After an uncatchable process kill, confirm no benchmark is active before removing a stale lock manually.

Publication requires a clean selected definition tree at the recorded Git commit. It revalidates manifests, lifecycle completion, case definitions, measured summaries, service-version provenance, and checksums before atomically creating the committed result directory.
