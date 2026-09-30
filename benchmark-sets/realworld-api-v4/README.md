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

The controller library now has mocked Linode API provisioning, campaign-budget reservations, restrictive local inventories, ownership-checked cleanup, and interruption recovery. No successful end-to-end live pilot is claimed. The manual `bin/bench-v4-linode.mjs inspect INVENTORY.json` command shows local ownership state without printing IP addresses; `recover INVENTORY.json --campaign LEDGER.json --confirm-delete RUN_ID` is destructive, requires `LINODE_TOKEN` on the controller and an exact run-ID confirmation, and charges the full reserved ceiling after recovery. Do not use it without account-owner approval. The `pilot` command now resolves the current eligible profile, creates an ephemeral SSH credential and private observation-scoped host-key state, bootstraps both x86_64 hosts with pinned Node/Docker/Compose binaries, deploys the checkout, runs the Supabase observation, verifies its local bundle, and cleans up. End-to-end live readiness remains unverified. Supabase's native Envoy HTTPS/private-CA path has passed a startup check with the digest-pinned Envoy image, but it has not been exercised against a live VM pair. Native HTTPS work for the other platforms and complete host provenance remain unfinished.


## Failure diagnostics

A failed Supabase setup reports its phase, successfully copied batches/rows, current input size, and elapsed time in the run's `logs/hooks.log`. Backend SSH failures report fixed handshake milestones and the original exit status; temporary verbose traces remain private and are deleted rather than retained in evidence. SQL, stdin, keys, and environment are not added to these diagnostics. A failed setup also attempts one read-only host snapshot (SSH policy/journal, kernel memory-pressure events, current load/memory/disk/connections, and container health) with a 10-second command deadline before stack teardown/stop. Diagnostic failures do not replace the setup failure, and no SQL is automatically replayed. Failed setup is not evidence that no fixture rows were inserted; use the completed-row counters.

## Observation-scoped SSH

The pilot creates a fresh `ssh_config` and `known_hosts` for each observation (0700 directory, 0600 regular files). Every V4 controller SSH call, including rsync and backend orchestration, uses that config explicitly. User/system SSH configuration and global known-hosts files are not consulted or modified. First controller contact uses `accept-new`; subsequent key changes and unsupported host-key algorithms are hard failures, not readiness retries. Generated configs require Ed25519 host keys, supported by the pinned fresh Ubuntu 24.04 hosts.

The runner receives a separate strict-checking config, the authenticated controller-side backend host-key pin mapped to the inventory's verified private backend IP, and an ephemeral identity under its private V4 runtime—not `~/.ssh`. Backend/public-private address mismatches fail before transfer. Controller host-key files are cleaned with the ephemeral credential; runner files disappear with the run-owned VM. Cleanup failures preserve the primary error.

Manual V4 **remote** commands must also supply generated private SSH state; absent, public, symlinked, or nonconforming configs fail closed. Local V4 and V3 commands are unchanged. For an independently authorized manual observation:

```sh
BAAS_BENCH_V4_SSH_CONFIG=$(node benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs create)
export BAAS_BENCH_V4_SSH_CONFIG
ssh_state=${BAAS_BENCH_V4_SSH_CONFIG%/*}
trap 'rm -rf -- "$ssh_state"' 0
# Bind the backend addresses from the verified observation inventory, before setup:
node benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs bind   "$BAAS_BENCH_V4_SSH_CONFIG" BACKEND_PUBLIC_IPV4 BACKEND_PRIVATE_IPV4
```

Use `ssh -F "$BAAS_BENCH_V4_SSH_CONFIG"` for manual probes so setup can reuse the same controller pin. The case dispatcher stages the runner's strict config and pin after runtime rsync. Do not reuse a previous observation's files or remove global host keys to work around recycled addresses.

This remains **TOFU** on the observation's first public SSH connection, not out-of-band verification of a Linode host fingerprint. A changed key within that observation is rejected; a fresh observation deliberately starts a fresh trust scope. No further live attempt is authorized by these instructions.
