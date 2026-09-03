# baas-bench

Reproducible local Docker environments for comparing self-hosted backend-as-a-service systems:

- Supabase
- Neon
- Convex
- Appwrite
- Nhost
- Directus
- PocketBase
- TrailBase

The repository has two layers: `bin/baas` provisions and isolates the systems under test, while `bin/bench` scaffolds, validates, runs, and publishes benchmark cases. The framework is ready, but no benchmark definitions or results are committed yet.

A benchmark defines one shared methodology; each platform and access-path combination is a separate case. For example, REST API, database function, direct PostgreSQL, pooled ORM, and WASM-extension implementations belong in distinct cases under the same benchmark.

## Requirements

- macOS or Linux
- Docker with Compose v2 (Docker Desktop, OrbStack, or Docker Engine)
- Git, curl, and OpenSSL
- `jq` 1.6+ for benchmark execution and publication
- `shasum` or `sha256sum`
- At least 16 GB RAM recommended for the largest stacks

The current versions target `linux/arm64` as well as `linux/amd64`. Workload-specific runtimes such as k6, xk6, Node.js, or Rust are required only by cases that invoke them.

## BaaS lifecycle

```sh
# Fetch pinned upstream definitions, generate local secrets, and validate Compose.
bin/baas setup all

# Start exactly one environment. This stops every other benchmark stack first.
bin/baas start supabase

# Make one service-specific HTTP, GraphQL, or SQL call.
bin/baas smoke supabase

# Stop containers without deleting their data.
bin/baas stop supabase
bin/baas stop all

# Show all prepared stacks.
bin/baas status
```

Available names:

```text
supabase neon convex appwrite nhost directus pocketbase trailbase
```

Generated deployments and secrets are stored in `.runtime/` and are not committed. Product versions and immutable upstream revisions are in [`versions.env`](versions.env).

## Benchmark workflow

```sh
# Create the hierarchy; generated TODOs deliberately fail validation.
bin/bench new set core-v1
bin/bench new benchmark core-v1 read-throughput
bin/bench new case core-v1 read-throughput supabase rest-api

# After completing the methodology, metadata, and all five case hooks:
bin/bench validate core-v1/read-throughput/supabase/rest-api
bin/bench run core-v1 read-throughput supabase rest-api

# Inspect the immutable local bundle, then publish compact evidence.
bin/bench publish .results/<run-id>
```

Definitions live under `benchmark-sets/<set>/benchmarks/<benchmark>/cases/<platform>/<variant>/`. Local runs under `.results/` are ignored; validated published evidence belongs under `results/`. See [`docs/benchmarks.md`](docs/benchmarks.md) for the complete authoring contract and [`AGENTS.md`](AGENTS.md) for repository contribution rules.

## Development checks

```sh
sh -n bin/baas bin/bench test/baas_test.sh test/bench_test.sh
sh test/baas_test.sh
sh test/bench_test.sh
bin/bench validate all
```

The regression tests use fake Docker and BaaS commands; they do not start the real stacks.

## Endpoints

| Service | Endpoint used by smoke test |
|---|---|
| Supabase | `http://localhost:8000/auth/v1/health` |
| Neon | PostgreSQL at `localhost:55433` |
| Convex | `http://localhost:3210/version` |
| Appwrite | `http://localhost:8080/v1/health/version` |
| Nhost | `http://local.graphql.local.nhost.run/v1/version` |
| Directus | `http://localhost:8055/server/ping` |
| PocketBase | `http://localhost:8090/api/health` |
| TrailBase | `http://localhost:4000/api/healthcheck` |

## What each environment represents

- **Supabase:** the official Docker self-hosting bundle, not the Supabase CLI development stack. Logs/analytics remain disabled as in the default self-host install. A named storage volume is used for macOS compatibility.
- **Neon:** Neon's official repository Compose example: pageserver, three safekeepers, storage broker, compute, and MinIO. This is not Neon Local, but Neon does not describe this example as a supported production distribution.
- **Convex:** the official self-hosted backend and dashboard, using its default persistent SQLite database.
- **Appwrite:** the complete official self-hosted Compose stack. It is the largest environment.
- **Nhost:** Nhost's full reference Compose stack. Nhost calls it a demonstration and provides community-only support without a support agreement.
- **Directus:** the officially documented Directus + PostgreSQL + Redis topology.
- **PocketBase:** a locally built image based on PocketBase's official Dockerfile guidance; PocketBase publishes release binaries but no official image.
- **TrailBase:** the official versioned single-container image.

See [`docs/plans/2026-09-03-local-baas-environments-design.md`](docs/plans/2026-09-03-local-baas-environments-design.md) for sources and design details.

## Isolation

`bin/baas start NAME` calls `docker compose stop` on all prepared benchmark projects before starting `NAME`. Containers and volumes are retained, but inactive systems consume no CPU or RAM. Docker itself and unrelated local containers are not managed by this repository.

Before collecting benchmark results, also disable unrelated containers and keep Docker's CPU/memory allocation fixed between runs.

## Verified host and compatibility notes

All eight environments were start/smoke/stop verified on an Apple M1 MacBook Air with 16 GB RAM, OrbStack, and Docker Engine 29.4.0 (`linux/arm64`).

- Nhost's pinned reference uses Traefik 3.1, whose old Docker API client is rejected by Docker 29. The setup wrapper substitutes digest-pinned Traefik 3.6.1.
- Appwrite requires `mongo-entrypoint.sh` and `mongo-init.js` alongside its Compose file; setup fetches both. Its proxy is refreshed after simultaneous stack restarts so Docker labels are rediscovered.
- Directus 12 restricts `/server/health`; the unauthenticated smoke check therefore uses the documented `/server/ping` liveness endpoint after PostgreSQL and Redis pass their Compose health checks.
