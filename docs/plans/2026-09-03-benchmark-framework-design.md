# Benchmark Framework Design

**Date:** 2026-09-03  
**Status:** Approved

## Goal

Provide a lightweight, reproducible workflow for defining, validating, running, and publishing benchmark cases across the eight self-hosted BaaS environments. This stage creates the framework and templates, not an actual benchmark.

A benchmark asks one shared question, such as read throughput. A case is one concrete implementation of that benchmark, such as Supabase REST, Supabase PostgreSQL through PgBouncer and Drizzle, or TrailBase through a Rust WASM extension. Results are comparable only when cases satisfy the same benchmark contract.

## Principles

- Keep scientific methodology separate from platform implementation.
- Treat every platform/access-path combination as an independently runnable case.
- Make lifecycle operations explicit and reviewable.
- Capture enough provenance to reproduce or invalidate a run.
- Keep raw local output separate from curated published evidence.
- Permit any workload runtime while requiring one normalized result contract.
- Add no matrix generator, plugin framework, dashboard, or statistics package until real benchmarks require one.

## Repository model

```text
benchmark-sets/
  <set>/
    set.conf
    README.md
    benchmarks/
      <benchmark>/
        benchmark.conf
        METHODOLOGY.md
        fixtures/
        cases/
          <platform>/
            <variant>/
              case.conf
              README.md
              setup.sh
              verify.sh
              reset.sh
              run.sh
              teardown.sh

templates/
  benchmark-set/
  benchmark/
  case/

.results/                         # ignored local runs
results/                          # committed published evidence
bin/bench
```

The hierarchy has three semantic levels:

1. **Set:** a named collection or release of benchmarks, for example `core-v1`.
2. **Benchmark:** the shared question and methodology, for example `read-throughput`.
3. **Case:** one platform and implementation variant, for example `supabase/drizzle-pooler`.

The case manifest records comparison dimensions rather than relying only on names. Dimensions include platform, access path, connection topology, client or ORM, and implementation language. A case directory is the only extension boundary needed.

Configuration uses a restricted, line-oriented `key=value` format. The CLI parses it as data and never sources it as shell, so definitions from pull requests cannot execute through metadata validation.

## Commands

The initial CLI supports:

```sh
bin/bench new set <set>
bin/bench new benchmark <set> <benchmark>
bin/bench new case <set> <benchmark> <platform> <variant>
bin/bench validate [all|<definition-path>]
bin/bench run <set> <benchmark> <platform> <variant>
bin/bench publish .results/<run-id>
```

Scaffolding commands reject existing destinations and invalid identifiers. Generated benchmark and case files retain explicit template markers and failing hook scripts until the author completes them. A fresh scaffold is therefore not accidentally runnable or publishable.

## Benchmark contract

`benchmark.conf` identifies the benchmark and defines machine-readable common controls. `METHODOLOGY.md` is the human-reviewed scientific contract. It must cover:

- objective, tested operation, and non-goals;
- correctness and response-equivalence rules;
- what is inside and outside the measured system boundary;
- dataset schema, distributions, cardinality, deterministic seed, and indexes;
- authentication and authorization behavior;
- cache state and warm-up policy;
- concurrency, ramp, duration, pacing, and workload mix;
- load-generator location and resource allocation;
- connection, pool, retry, timeout, and error policies;
- trial count, execution ordering, cooldown, and invalidation rules;
- primary metric, unit, direction, and required secondary metrics;
- permitted platform-specific tuning and deviations;
- known limitations and interpretation boundaries.

Fairness-sensitive values belong to the benchmark and apply to every case. A case may tune only values the methodology explicitly permits.

## Case contract

`case.conf` includes identity and comparison dimensions:

```text
platform=supabase
access_path=database
connection=pooler
client=drizzle
implementation=typescript
```

The case README documents the exact endpoint or query path, request semantics, implementation, dependencies, indexes, authentication, connection/pool settings, platform tuning, and justified deviations from the benchmark contract.

A case can invoke k6, xk6, TypeScript, Rust, or another tool through the same required hooks:

- `setup.sh`: create case-owned schema, code, users, and fixtures once.
- `verify.sh`: prove fixtures and tested behavior are correct.
- `reset.sh`: restore the declared baseline before each warm-up or measured trial.
- `run.sh`: execute one warm-up or measured trial and emit native and normalized output.
- `teardown.sh`: remove all case-owned resources.

Read-only reset and resource-free teardown hooks are explicit documented no-ops. All hooks are executable and receive context through environment variables, including `BENCH_PHASE`, `BENCH_TRIAL`, and `BENCH_OUTPUT_DIR`.

## Execution lifecycle

`bin/bench run` performs these steps:

1. Validate the selected set, benchmark, and case.
2. Acquire a host lock because `bin/baas` supports one active benchmark platform.
3. Reject dirty definitions unless explicitly overridden for diagnostic work.
4. Create a temporary run directory and capture initial provenance.
5. Start only the selected platform through `bin/baas start`.
6. Run setup and pre-measurement verification.
7. For each declared warm-up and measured trial, reset the baseline, run the workload, and verify correctness afterward.
8. Require every measured trial to produce a normalized `summary.json`.
9. Always attempt teardown and platform shutdown, including after failure or interruption.
10. Finalize the run atomically with `complete`, `failed`, or `invalid` status.

A debugging `--keep` mode may leave resources and the platform running, but marks the run non-publishable. Cleanup errors are recorded without replacing the original setup or workload failure.

## Result contract

Each run is an immutable local bundle:

```text
.results/<run-id>/
  run.json
  environment.json
  definitions/
  logs/
  warmups/
  trials/
    001/
      summary.json
      raw/
```

`run.json` records status, identity, timestamps, arguments, Git commit, definition checksums, and lifecycle outcomes. `environment.json` records non-secret host and deployment facts including architecture, Docker and Compose versions, pinned service versions, and configured CPU/memory limits when available.

Every measured trial summary contains schema version, duration, completed operations, failures, error rate, and a flexible `metrics` object. The benchmark declares which metric keys and units are required. Native outputs live under the trial's `raw/` directory.

Secrets and connection strings are never copied into result metadata. Redaction applies an explicit denylist and key-name patterns. Topology is represented using labels such as `direct`, `pooler`, or `http-api`.

## Publication

Generated runs stay under ignored `.results/`. Publication is explicit:

```sh
bin/bench publish .results/<run-id>
```

Publication rejects dirty, failed, invalid, debug, incomplete, or malformed runs. It copies compact durable evidence to:

```text
results/<set>/<benchmark>/<platform>/<variant>/<run-id>/
```

Published evidence includes run and environment manifests, definition checksums, and normalized measured-trial summaries. Large raw artifacts remain local by default and can later be attached to GitHub releases with URLs and checksums recorded in the published manifest.

Publication does not rank platforms or aggregate cases with materially different semantics. Reporting and statistical analysis will be designed after real benchmark output exists.

## Validation and testing

`bin/bench validate` checks:

- required files and metadata keys;
- identifier and path consistency;
- supported platform and dimension values;
- benchmark metric declarations;
- executable lifecycle hooks and shell syntax;
- unresolved template markers;
- result JSON shape when validating a completed run.

Validation cannot prove scientific equivalence; methodology and case deviations require human review.

A small shell regression suite uses temporary definitions and fake Docker, BaaS, and hook commands. It covers scaffolding, invalid metadata, unresolved templates, lifecycle order, cleanup after ordinary failure and interruption, host locking, metadata redaction, result requirements, and publication rejection. No additional test framework or runtime is introduced beyond the JSON parser required by the benchmark CLI.
