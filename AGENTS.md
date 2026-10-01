# Repository instructions

These instructions apply to the entire repository.

## Purpose and current state

This repository provides reproducible local Docker environments and a framework for comparing eight self-hosted BaaS platforms: Supabase, Neon, Convex, Appwrite, Nhost, Directus, PocketBase, and TrailBase.

The environment tooling and benchmark framework are implemented. No actual benchmark definition or published result is committed yet. Do not invent benchmark workloads, schemas, rankings, or results unless the task explicitly requests them.

## Source map

- `bin/baas`: setup, isolation, start, smoke, stop, and status for platforms.
- `versions.env`: pinned upstream revisions and container images.
- `services/`: repository-owned Compose definitions.
- `.runtime/`: ignored fetched deployments, generated secrets, and persistent runtime state.
- `bin/bench`: benchmark scaffolding, validation, execution, and publication.
- `templates/`: set, benchmark, methodology, case, and lifecycle-hook templates.
- `benchmark-sets/`: committed benchmark definitions.
- `.results/`: ignored local run bundles, including logs and raw output.
- `results/`: compact, validated evidence intended for Git publication.
- `docs/benchmarks.md`: authoritative benchmark authoring guide.
- `docs/plans/`: approved designs and historical implementation plans.
- `test/`: dependency-light shell regression tests.

## Required checks

Before committing any change, run the checks relevant to it. Before declaring the repository complete, run all of them:

```sh
sh -n bin/baas bin/bench test/baas_test.sh test/bench_test.sh
sh test/baas_test.sh
sh test/bench_test.sh
bin/bench validate all
git diff --check
```

Tests must not start real BaaS stacks. Follow the existing tests and substitute fake `docker`, `bin/baas`, and hook commands.

## Shell and dependency rules

- Keep executable scripts POSIX `/bin/sh`; do not add Bash-only syntax.
- Quote path and user-derived values.
- Parse `*.conf` files as restricted data. Never source or evaluate them.
- Use platform tools or existing dependencies before adding another dependency.
- Write a failing regression test before changing CLI behavior or fixing a bug.
- Preserve the original failure when cleanup also fails; record both outcomes.

## BaaS environment rules

- Pin upstream revisions and mutable images in `versions.env`.
- Keep generated credentials in `.runtime/` with restrictive permissions.
- `bin/baas start NAME` must stop other prepared benchmark stacks first.
- Stopping must preserve volumes and benchmark data unless destruction is explicitly requested.
- A smoke check proves readiness only; it is not a benchmark.
- Keep Apple Silicon (`linux/arm64`) and Docker Compose v2 compatibility.

## Benchmark hierarchy

```text
benchmark-sets/<set>/
  set.conf
  README.md
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

Use `bin/bench new` rather than copying directories manually. Keep each platform/access-path combination in its own case—for example, Supabase REST, Supabase PostgreSQL through PgBouncer and Drizzle, and TrailBase Rust WASM are separate cases implementing one shared benchmark contract.

Fairness-sensitive behavior belongs in `METHODOLOGY.md`: semantics, dataset and seed, indexes, authentication, cache state, warm-up, workload shape, timing boundary, concurrency, duration, retries, timeouts, resources, trial ordering, metrics, acceptance, and invalidation. A case README documents its exact implementation, topology, tuning, and deviations.

Generated `TODO` markers and failing hooks are intentional. A new scaffold must not validate or run until its author resolves every required decision.

## Benchmark lifecycle and evidence

`bin/bench run` owns platform orchestration. Cases provide five executable hooks:

1. `setup.sh` creates case-owned resources.
2. `verify.sh` proves fixture and response correctness.
3. `reset.sh` restores the declared baseline before each trial.
4. `run.sh` performs one warm-up or measured trial.
5. `teardown.sh` removes case-owned resources.

Measured runs must write the normalized `summary.json` contract documented in `docs/benchmarks.md`. Native output belongs in the trial's `raw/` directory.

Never commit `.runtime/`, `.results/`, credentials, connection strings, or raw benchmark output. Publish only through `bin/bench publish`; it rejects dirty, debug, failed, invalid, stale, malformed, or tampered bundles. Do not hand-edit published evidence or calculate cross-case rankings unless an approved reporting methodology exists.

## Next implementation priority: benchmark fairness

[BaaS benchmark fairness and conformance remediation](docs/plans/2026-10-01-baas-benchmark-fairness-plan.md) is the **highest implementation priority**. The user confirmed completed multi-core handoff at clean `0e75c15` on 2026-10-01, approved the V5 observable contract, and explicitly selected V5 as the active corrected benchmark definition going forward. V4 remains reference; no claim of published or qualified V4 evidence is made. The eight-case audit is complete; candidate native repairs and regression gates are in progress. Do not overwrite another terminal's work.

Prioritize concrete native conformance probes, complete reset/auth/session lifecycle, bounded persistence checks and measurement qualification before further comparative capacity campaigns or isolated performance tuning. V5 remains blocked from execution/publication; format validation and in-memory SQLite/mocked tests do not admit a case. Existing Supabase/TrailBase observations are diagnostic implementations, not established apples-to-apples platform results; preserve historical bundles unchanged. This priority does not cancel already authorized multi-core diagnostics or authorize new paid runs, retries, destructive recovery, budget extensions, or publication. Follow the plan's approval and conformance gates.

## V4 live pilot progress

While an authorized Linode V4 pilot is running, inspect its local status without a token, SSH, or another monitoring connection:

```sh
node bin/bench-v4-linode.mjs status .runtime/linode-v4/runs/RUN_ID/inventory.json
```

Replace `RUN_ID` with the pilot's run ID. The command reads the sibling private `progress.json` and reports the latest phase/counters per source, heartbeat and activity ages, phase-only estimates, controller liveness, and stale warnings. A stale runner/seed heartbeat means progress is unconfirmed—not that the process is dead. Do not retry work or recover/delete resources based on that warning alone; inspect the inventory and follow the existing approval/recovery safeguards. The V4 README's [Live progress](benchmark-sets/realworld-api-v4/README.md#live-progress) section documents fields, phases, and transport behavior.

For an assigned live pilot, schedule local status snapshots at the requested interval (currently 20 minutes), not a wake-up on every heartbeat. Keep the owning Pi process running: managed-process shutdown kills its jobs and removes temporary logs. Retain controller/monitor logs privately in the run directory. If the controller disappears, inspect inventory ownership and cleanup state as well as progress; recovered resources may be deleted while the last progress event still says deployment. Never automatically restart a paid attempt.
