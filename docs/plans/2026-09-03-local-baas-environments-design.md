# Local BaaS Environments Design

## Scope

Prepare reproducible, self-hosted Docker environments for Supabase, Neon, Convex, Appwrite, Nhost, Directus, PocketBase, and TrailBase on an Apple Silicon Mac. Provide lifecycle and smoke-test tooling only; benchmark schemas, data, and k6 workloads are deliberately deferred.

## Deployment strategy

`bin/baas` is the single entry point:

```text
bin/baas list
bin/baas setup <name|all>
bin/baas start <name>
bin/baas smoke <name>
bin/baas stop <name|all>
bin/baas status
```

Large upstream deployments are sparse-checked-out or downloaded at immutable revisions into ignored `.runtime/` directories. Small deployments live under `services/`. `versions.env` records every source revision and product version. This keeps the repository small while preserving the exact upstream configuration used.

`start` always stops all eight projects before starting its target. Data volumes remain intact between runs. This enforces the requested resource isolation without destructive cleanup.

## Service choices

| Service | Deployment used | Smoke call | Caveat |
|---|---|---|---|
| Supabase | Official `docker/` self-host bundle, `self-hosted/v0.8.0` | Auth health through port 8000 | This is the production-oriented self-host stack, not `supabase start`; logs/analytics remain disabled as upstream defaults. Supabase documents 4 GB minimum and 8 GB recommended. |
| Neon | Official repository `docker-compose/` cluster | SQL `SELECT 1` through compute | Officially described as a local Compose example, not a supported production distribution. It does run pageserver, three safekeepers, broker, compute, and MinIO rather than Neon Local/Cloud. |
| Convex | Official self-host Compose | `GET /version` | Uses the upstream default SQLite persistence. Backend and dashboard images are pinned by OCI digest because the upstream file uses `latest`. |
| Appwrite | Official release Compose and environment | `GET /v1/health/version` | Full default stack is intentionally retained and is the heaviest environment. |
| Nhost | Official reference Compose example | Hasura GraphQL query | Nhost labels this a demonstration/reference stack and community-supported unless a support agreement exists. |
| Directus | Official documented Postgres + Redis + Directus topology | `GET /server/ping` | Local credentials are generated during setup. Directus 12 restricts the detailed health endpoint to authenticated users. |
| PocketBase | Image built from the official release archive, following the official Dockerfile example | `GET /api/health` | PocketBase does not publish an official image. The build selects the Linux architecture automatically. |
| TrailBase | Official versioned Docker image | `GET /api/healthcheck` | Uses its native SQLite-backed single-container deployment. |

## Data, secrets, and ports

Runtime secrets and generated upstream files live only in `.runtime/`, which is gitignored. Local Compose data uses named volumes where practical. These are benchmark-machine credentials, not an Internet-facing production security configuration.

Default endpoints are intentionally left close to upstream documentation: Supabase `8000`, Neon Postgres `55433`, Convex `3210`, Appwrite `8080`, Nhost host-routed services on `80`, Directus `8055`, PocketBase `8090`, and TrailBase `4000`.

## Failure handling and validation

The CLI fails on missing Docker/Git/curl prerequisites, unknown service names, failed downloads, invalid Compose configuration, unhealthy endpoints, or SQL errors. `setup` is idempotent at the pinned revision. Smoke checks use bounded retries during `start`, then execute once when called directly.

A dependency-free shell test records fake Docker/curl invocations to verify service enumeration, invalid-name handling, and the critical invariant that all stacks are stopped before a target starts. Integration validation runs `docker compose config` for all eight environments and starts/smokes/stops each environment individually.

## Sources

- Supabase: https://supabase.com/docs/guides/self-hosting/docker
- Neon: https://github.com/neondatabase/neon/blob/main/docs/docker.md
- Convex: https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md
- Appwrite: https://appwrite.io/docs/advanced/self-hosting/installation
- Nhost: https://docs.nhost.io/platform/self-hosting and `examples/docker-compose/README.md`
- Directus: https://directus.io/docs/self-hosting/deploying
- PocketBase: https://pocketbase.io/docs/going-to-production/
- TrailBase: https://github.com/trailbaseio/trailbase#readme
