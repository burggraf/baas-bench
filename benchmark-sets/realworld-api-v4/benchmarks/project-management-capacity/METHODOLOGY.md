# Project-management capacity methodology

## Scope

V4 measures the same SLO-qualified authenticated project-management workload as V3, with the self-hosted BaaS and load generator on separate same-region Linode VMs. It answers capacity for the declared VM plans and private-network path, not arbitrary production deployments, geographic latency, managed BaaS offerings, or a platform-independent hardware ranking. V3 local/co-located results and V4 remote results are separate evidence series.

## Lifecycle and hardware profile

Each independent observation provisions one fresh pair: one 8 GiB dedicated-CPU backend VM and one separately declared runner VM (8 GiB dedicated CPU for the pilot; 4 GiB may be selected only after measured headroom qualification). All platforms in the 8 GiB backend campaign use the exact same Linode plan ID, region, operating-system image, architecture, storage policy, Docker/Compose versions, and network topology. One BaaS stack runs at a time. The runner's own CPU, event loop, memory, swap, network and connection headroom are recorded; runner saturation invalidates backend attribution.

The pair remains allocated for the entire observation, including all adaptive stages; it is not recreated per stage. The controller waits for the remote run, retrieves and verifies results, attempts teardown on success/failure/interruption, and deletes both instances and any run-owned billable resources. The baseline does not retain provider snapshots, volumes, or fixture archives. A future snapshot/cache approach is a distinct profile and must prove restore correctness. A local inventory and recovery command cover interrupted cleanup. Optional authenticated ntfy notification is sent after cleanup is attempted; notification failures do not overwrite run/cleanup outcomes.

Campaign spend is capped at USD $30 total across provisioning, pilots, valid and invalid observations, and retries. At most one pair may be active. Before provisioning, the controller checks current type pricing and remaining budget; during the run it accounts for both VM-hour rates and stops scheduling or terminates work before the remaining budget is exhausted, preserving a transfer reserve. VPC traffic is used for measured requests. G8 Dedicated transfer is usage-billed, so public result/bootstrap transfers are minimized and estimated separately. No cloud resource is considered cleaned up until API deletion is confirmed; power-off is not cleanup.

## Dataset and correctness

Seed `42` creates exactly 1,000,000 deterministic application records: 1,600 organizations, 16,000 users, 16,000 memberships, 8,000 projects, 160,000 tasks, 479,200 comments, and 319,200 activities. The V3-derived ID format, fields, relationships, roles, timestamps, text distribution, indexes, and tenant shape are retained. Authentication infrastructure users are additional records. Data generation and seeding use bounded batches. Fixture provisioning, reset, and verification are outside measured intervals.

Every observation verifies exact counts and the V3 correctness contract: valid/invalid authentication, profile mutation, CRUD/pagination, tenant isolation, role denial/restoration, refresh/sign-out, and deterministic fixture identity. A restore or seed that fails verification invalidates the observation. Each case README documents native schema/index details and material access-path differences, including Neon SQL-over-HTTP and application-owned auth.

## Workload and stages

The workload retains V3's dashboard, task-list, task-detail, create-task, update-task, add-comment, search, profile-update and sign-out/sign-in weights. Each virtual user performs one complete workflow at a time with deterministic selection and 1,000–5,000 ms think time. Requests time out after five seconds; there are no retries. The run warms up for 120 seconds at 50 users, then measures adaptive 300-second stages, beginning at 5, 10, 25 and 50 users, doubling to a bound or 10,000 users and refining a passing/failing bracket with at most four integer midpoints. Lower-than-five-user stages extend duration to preserve sample exposure. Warm-up writes remain in the measured database state.

Each case uses the selected platform's same V3-defined application-facing access path. Measured calls travel from the runner to a private backend endpoint over the same-region VPC; no BaaS API port is exposed to the public internet. The exact endpoint, DNS/hostname mapping, platform-native HTTPS listener, private-CA trust, and ports are declared per case before formal trials. Only synthetic benchmark identities/secrets are used. Any TLS termination, proxy, protocol, or endpoint deviation is recorded and included in the measured topology.

## Acceptance, resources, and invalidation

A passing stage must be telemetry- and lifecycle-valid, achieve at least 95% of requested users, include at least 20 workflow samples in every active class, meet read/write/auth-search p95 limits of 500/750/1000 ms, and keep each class error rate strictly below 1%. Capacity is the highest contiguous passing stage before the first detected saturation point. Primary metric: `capacity_users`; supporting metrics are achieved users, workflow and physical-operation throughput/amplification, class latency and error rates.

The runner records process CPU/RSS/event-loop delay and host CPU/steal, memory/swap, network throughput/drops and connection limits. The backend records exact Compose-container CPU/memory plus host CPU/steal, memory/swap, disk I/O/space, network and service restart/health. Measurements align to stage boundaries and include timestamps and host profiles. Sustained runner overload, missing/malformed telemetry, service restart, incomplete work, failed fixture verification, unexpected public route, or resource pressure that prevents attribution invalidates the observation; it is not reported as a low backend capacity.

## Trials and reporting

A formal 8 GiB comparison requires at least three valid independent observations per included platform in a predeclared balanced/rotated order. Every attempt, including invalid/interrupted attempts, is retained. A fresh VM pair is used per observation and deleted afterward; there is no fixed 600-second inter-platform cooldown. Record start/finish times, creation/deletion outcomes, exact plan/region/network/image/runtime versions, estimated spend, and resource traces to expose time-varying provider contention. Do not pool different backend/runner plan profiles.

Publish only through `bin/bench publish`, after local evidence transfer, checksum verification, cleanup, and manifest validation. Reports show distributions/variation per platform and hardware profile, capacity curves, access paths, class p95/error rates, throughput, runner headroom, backend resource use, cost, and deviations. No unexplained composite ranking. A partial campaign is diagnostic, not a formal comparison.
