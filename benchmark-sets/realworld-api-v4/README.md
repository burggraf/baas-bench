# Real-world API capacity V4

V4 carries forward the V3 deterministic, authenticated project-management capacity workload, but runs each BaaS on its own fixed 8 GiB dedicated-CPU Linode backend while a separate VM generates load. The baseline profile is identical across platforms; a separate 8 GiB dedicated-CPU runner is used for the pilot, and a smaller runner is permitted only after it demonstrates adequate headroom.

Each independent observation provisions a fresh backend/runner pair in a same-region private network, seeds and verifies the full one-million-record fixture, measures all capacity stages, retrieves and verifies evidence, then deletes the VMs and run-owned billable resources. There is no fixed cooldown between platforms. Three balanced, valid observations per platform are required for a formal comparison. Total campaign spend is capped at USD $30.

The workload contract and platform access paths derive from [`realworld-api-v3`](../realworld-api-v3/README.md). V4 does not include results yet. Do not combine V3 local co-located runs with V4 remote two-host results. See [`METHODOLOGY.md`](benchmarks/project-management-capacity/METHODOLOGY.md) and the [V4 implementation plan](../../docs/plans/2026-09-29-realworld-api-v4-remote-capacity-plan.md).

## Versions checked 2026-09-29

V4 overrides the repository defaults in [`versions.env`](versions.env); V3's existing pins remain unchanged. Upstream releases and registry digests were checked on this date. No floating `latest` BaaS image tag is used; V4 records exact release versions, immutable source refs, and image digests where applicable.

| Platform | V4 server pin | V4 client pin |
| --- | --- | --- |
| Supabase | Self-hosted source `e693f206` | `@supabase/supabase-js` 2.117.2 |
| Neon | Latest source commit at check: `fa504217`; pinned images retained | `@neondatabase/serverless` 1.1.0 |
| Convex | Precompiled source `5c7cb5b`; backend/dashboard image digests | `convex` 1.46.0 |
| Appwrite | 2.3.0, source `d66a7eff` | `appwrite` 28.1.0 |
| Nhost | Source `d417c72d`; Traefik 3.7.13 | `@nhost/nhost-js` 4.8.0 |
| Directus | 12.4.1 | `@directus/sdk` 26.0.0 |
| PocketBase | 0.40.4 | `pocketbase` 0.28.1 |
| TrailBase | 0.34.1 | `trailbase` 0.14.1 |

The administrative Appwrite Node SDK is pinned separately at `node-appwrite` 29.0.0. These are current stable pins at the check date, not a promise to auto-track future releases; refresh and revalidate them before a later campaign.

## Controller status

The controller library now has mocked Linode API provisioning, campaign-budget reservations, restrictive local inventories, ownership-checked cleanup, and interruption recovery. No live provisioning has been run. The manual `bin/bench-v4-linode.mjs inspect INVENTORY.json` command shows local ownership state without printing IP addresses; `recover INVENTORY.json --campaign LEDGER.json --confirm-delete RUN_ID` is destructive, requires `LINODE_TOKEN` on the controller and an exact run-ID confirmation, and charges the full reserved ceiling after recovery. Do not use it without account-owner approval. Provision-and-run CLI wiring, native per-platform HTTPS/private-CA setup, and complete host provenance remain unfinished.
