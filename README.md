# bench-backends-k6

Reproducible local Docker environments for comparing self-hosted backend-as-a-service systems:

- Supabase
- Neon
- Convex
- Appwrite
- Nhost
- Directus
- PocketBase
- TrailBase

This first stage only provisions each environment and proves it accepts a request. Benchmark schemas and k6 workloads come later.

## Benchmark framework

The dependency-light benchmark framework scaffolds and validates benchmark definitions, runs cases through `bin/baas`, and publishes compact evidence. See the [approved design](docs/plans/2026-09-03-benchmark-framework-design.md) and [authoring guide](docs/benchmarks.md). `jq` is required only for `bin/bench run` and `bin/bench publish`.

## Requirements

- macOS or Linux
- Docker with Compose v2 (Docker Desktop, OrbStack, or Docker Engine)
- Git, curl, and OpenSSL
- At least 16 GB RAM recommended for the largest stacks

The current versions target `linux/arm64` as well as `linux/amd64`.

## Usage

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
