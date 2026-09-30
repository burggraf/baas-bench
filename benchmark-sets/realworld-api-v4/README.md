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

The controller library has mocked Linode API provisioning, campaign-budget reservations, restrictive local inventories, ownership-checked cleanup, and interruption recovery. The manual `bin/bench-v4-linode.mjs inspect INVENTORY.json` command shows local ownership state without printing IP addresses; `recover INVENTORY.json --campaign LEDGER.json --confirm-delete RUN_ID` is destructive, requires `LINODE_TOKEN` on the controller and an exact run-ID confirmation, and charges the full reserved ceiling after recovery. Do not use it without account-owner approval. The `pilot` command resolves the current eligible profile, creates an ephemeral SSH credential and private observation-scoped host-key state, adds the account's exact `mba-m1` public key to both hosts, bootstraps both x86_64 hosts with pinned Node/Docker/Compose binaries, deploys the checkout, runs the Supabase observation, verifies its local bundle, and cleans up. Missing or ambiguous account keys fail before host creation. Live Supabase pilots have exercised private HTTPS, fixture verification, workload correctness, evidence transfer, and cleanup, but a fully valid capacity pilot is still pending. Pilot acceptance checks transferred checksums and rejects invalid measured stages, even when the orchestration process completed successfully. Native HTTPS work for other platforms and complete host provenance remain unfinished.

## Live progress

Future pilots stream bounded, allowlisted `V4_PROGRESS` JSON lines and retain the latest per-source state in mode-0600 `progress.json` beside the private inventory. Read it without SSH, API access, or a token:

```sh
node bin/bench-v4-linode.mjs status .runtime/linode-v4/runs/RUN_ID/inventory.json
```

Updates cover provisioning, bootstrap/deployment, backend startup, setup, server-confirmed COPY rows/batches, authentication seeding, fixture verification, runner synchronization, correctness, warm-up, session preparation, measured stages, session cleanup, telemetry drain, evidence transfer/verification, and resource deletion. Runner and seed processes emit heartbeats every 15 seconds; measured stages include user count, completed/failed workflows and physical requests, elapsed/planned duration, completed-stage count, and pass/fail/invalid outcomes. Operation counters and `last_activity_at` distinguish a responsive process from observed work. Workload termination flags and safe reason codes are retained in each raw stage.

The controller's heartbeat is separate from the runner's. Status reports per-source receipt age (controller clock), activity age, controller PID liveness, phase-only progress/remaining seconds, and stale-heartbeat warnings after 45 seconds. Missing progress is uncertainty, not proof of a dead process; a live PID/SSH session is not proof of forward progress. Warnings are also streamed while the controller is alive. No overall percentage or fixed campaign ETA is invented for adaptive stages or setup steps with unknown completion time. Telemetry drain shows collected/expected samples; its sequential Docker/host probes can extend wall time beyond measured workload duration, including after an early abort.

Progress rides the existing SSH command, not extra monitoring SSH connections. A separate inherited descriptor carries V4 hook progress past the benchmark's log redirection; the remote runner uses stderr and the controller forwards only schema-checked progress lines. Credentials, SQL, endpoint arguments, and arbitrary remote stderr are never part of progress. Monitoring does not retry work, alter acceptance thresholds, or replace primary/cleanup failures. V3 and manual commands without the progress descriptor retain their existing behavior. The observability heartbeat and counter bookkeeping have small nonzero runner overhead and are part of the V4 runner profile; no new dependency or monitoring service is installed.


## Failure diagnostics

A failed Supabase setup reports its phase, server-confirmed COPY batches/rows, input-produced batches/rows, current input size, and setup elapsed time in the run's `logs/hooks.log`. Backend SSH failures report the last observed allowlisted debug milestone (best-effort, not definitive phase), whether authentication and command submission were ever seen, the original exit status, and connection timestamps/duration. Rekey can reset the last milestone, so the booleans preserve progress. Temporary verbose traces remain private and are deleted rather than retained in evidence. SQL, stdin, keys, and environment are not added to these diagnostics. A failed setup also attempts one read-only host snapshot (SSH policy/journal, kernel memory-pressure events, current load/memory/disk/connections, and container health) with a 10-second command deadline before stack teardown/stop. Diagnostic failures do not replace the setup failure, and no SQL is automatically replayed. Failed setup is not evidence that no fixture rows were inserted; use the completed-row counters.

The 2026-09-30 pilot investigation found that Supabase's five-second request deadline threw a plain `Error`. The workload deliberately treats untyped errors as integrity failures, so one timeout could abort all users and invalidate that stage. V4's Supabase adapter now emits the existing typed `BenchmarkOperationError('timeout')` at every deadline site: these failures count against the class error-rate SLO instead of globally aborting the workload. There are still no request retries. Malformed responses, tenant-boundary failures, cancellation, and failed session cleanup retain their invalidation behavior. Previous bundles are preserved unchanged; this fix does not retrospectively validate them.

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
