# V6 reusable k6 baseline (private local diagnostics)

## Main-checkout migration

The tooling now lives in `/Users/markb/dev/baas-bench` on `main`. Its approved
fixture and native SQL/configuration are isolated in `baseline/fixture.mjs` and
`baseline/profile/`; existing benchmark definitions are unchanged. A regression
matches every logical fixture count/hash to the previously tested V6 contract.
Pins use the existing version profile; k6 is pinned in root `versions.env`.

**Main native baseline/reset admission passed on 2026-10-08.** Fresh preparation
and two independently restored 1-user/60-second trials each produced 59 iterations,
177 requests, 354 passing checks, zero HTTP failures and 59 task/activity pairs.
Final application/Auth hashes and immutable checksums matched with 165 native
users, zero sessions/refresh tokens, no OOMs/restarts and all 11 services stopped.
Private evidence is in `.runtime/k6-baseline/main-rebuild-20261008T133335526Z/`.
A complete counterordered main replay subsequently passed all 14 stages, including
three trials each at 16, 24, 32 and 40 users. Its final pristine reset, immutable
checksums, exact service allocation, zero OOMs/restarts and stopped/idle state
passed. Evidence is private in
`.runtime/k6-baseline/main-lower-dual-capture-20261008/`.

This is a successful repeated **40-user level in that sequence**, not an established
maximum or a stable cross-run capacity bound. Earlier main attempts retain mixed
32/40-user latency results and were interrupted separately by an actor-setup 401
and a PostgreSQL disconnect during archive database recreation. Their final resets
passed; incomplete campaigns must not be converted to completed confirmations.
Neither intermittent failure was reproduced or fixed: six restored authentication
cycles (384 profile checks) and ten restore-only cycles passed, followed by the
fully instrumented replay. Two quiet-admission expirations started no workload.
A separate failed restore probe dropped SQL stdin in its private instrumentation;
that wrapper alone was corrected with a failing/passing regression before retry.
All original attempts remain preserved. Commit preparation removed a trailing
blank line from `baseline/fixture.mjs`; the native evidence retains its original
pre-formatting source fingerprint. The logical fixture regression remains the
contract check, but the old immutable manifest cannot admit the changed source:
prepare a fresh baseline before further runs from this commit.
This is local diagnostic evidence, not measurement qualification, publication,
or a comparative platform ranking.

All other live observations below are historical diagnostics performed in
`/private/tmp/baas-bench-v5-linux-pilot`, whose private `.runtime/k6-baseline/`
artifacts remain there unchanged. They do not certify this migrated source.
No runtime, credential, inventory or immutable manifest was copied or rewritten.
Main created a fresh, separately owned baseline for its new measurements.
Migration changes source fingerprints and cannot admit the old baseline.

## Preserved diagnostic history

Supabase and TrailBase only. These are private local diagnostics, **not V5
admission, publishable results, capacity qualification or rankings**. Three
earlier local TrailBase prepares passed the idle gate but failed validation;
their private runtimes remain preserved under `.runtime/k6-baseline/failed/`.
The subsequent prepare passed after capturing Docker-log stderr and forcing
headerless, initialization-free SQLite output. Its manifest verifies fixture
and Auth state plus zero sessions. Two 60-second k6 diagnostics then restored
that manifest and completed: run one had 59 iterations, 177 requests and 354
passing checks; run two had 60 iterations, 180 requests and 360 passing checks.
Both had zero HTTP-failure rate and postchecks matched each iteration to one
task and one atomic activity. These are local implementation checks, not V5
admission or publishable benchmark results. The owned TrailBase container is
stopped.
Supabase's exact source revision was audited locally on 2026-10-07 against
`e693f206f5050b0004a86e12e533bb75ba2a9c76`. Coverage now fingerprints all 15 stable
bind inputs, including writable initialization SQL, functions and snippets;
only the exact native PostgreSQL data bind is excluded as mutable. The sanitized
mount regression fixture retains the upstream revision and Compose hash in
`test/fixtures/v6_supabase_mounts.json`.

**Supabase live completion:** the native forced-recreation probe passed, then a
fresh source-bound preparation and exactly two restored 1-user/60-second runs
completed at 4 CPUs / 4 GiB. Each run had 59 iterations, 177 requests, 354 passing
checks, zero HTTP failures, and exactly 59 persisted task/atomic-activity pairs.
Final restoration matched application/Auth hashes with 165 native users and
identities, zero sessions/refresh tokens and unchanged immutable checksums.
All 11 services were live without OOM/restarts before intentional final cleanup;
all are stopped, Docker is idle and the lock is absent. Evidence stays private
under the directory named by `.runtime/k6-baseline/latest-supabase-v6-proof.txt`.
This proves the reduced local baseline/reset flow, not capacity, cloud operation,
publication or equivalence to TrailBase's retained 2-CPU results.

The following preparation/restore failures remain preserved as historical V6
diagnostics; fake checks alone did not establish the live completion above.
The first Supabase prepare stopped before seeding on 2026-10-07: all 120 gateway
health requests returned 401 because the checker omitted the required native
API key. The checker now uses the normal anonymous API key, not an admin key
or an authorization bypass. Its failing regression and fix are retained. All
owned containers were stopped; the incomplete runtime and logs remain intact.
The operator approved one evidence-preserving fresh preparation on 2026-10-07.
The failed runtime, all 11 stopped containers and all three named volumes were
retained; no resources were deleted. That fresh attempt stopped before seeding because
Studio's unchanged health checks timed out, blocking the gateway dependency.
There was no OOM and no measured workload. Both failed runtimes remain
preserved/stopped. A bounded startup CPU-allocation probe and conditional fresh
preparation/tests were subsequently approved; no automatic retry occurs if a
probe fails. The first probe passed Studio's stock health check at 0.3 CPU, but
failed the full-stack health gate on Postgres Meta: its HTTP listener was not
ready before the unchanged health check declared it unhealthy at 0.1 CPU.
No fixture seeding, actor login, conditional preparation or measured trial ran.
The second startup cycle was not attempted; all probe resources are retained
and stopped. The operator subsequently approved increasing Supabase's local
CPU ceiling to 4, keeping 4 GiB memory and stock health checks, and continuing
one preserved fresh preparation, two fixed tests and final restoration. This
approval does not authorize a capacity campaign, cloud spending or TrailBase
rerun. Preparation passed at the increased budget, but the first restored run
stopped before measurement because the helper used restricted `postgres` for
an event-trigger restore requiring native `supabase_admin`. The operator approved
the maintenance-role repair and preservation of that immutable baseline, then
one fresh source-bound preparation, two fixed tests and final restore check.
That restored run got past event-trigger ownership but then failed on in-place
cleanup of an inherited native Realtime partition constraint. The operator
approved database-level recreation and another preserved fresh preparation,
two fixed tests and final restore check. That attempt stopped at the archive
checker before database recreation because the inspector omitted `--create`.
Read-only inspection confirmed the real archive's single `postgres` database;
SQL rendering confirmed database-level recreation and no inherited-constraint
drops. The operator approved the missing-flag repair and another preserved
fresh preparation. Its restore passed archive checks but found two remaining
database connections. The operator approved a bounded DB-only inspection and
forced-recreation probe before any further preparation. Inspection identified
exactly one `pg_cron launcher` and one `pg_net 0.20.3 worker`; immutable files
matched, and no fixture seed, actor login or measured workload ran. The first
force-probe admission window expired before any attempt. After the operator
authorized local retries, the admitted forced-recreation probe proved exact
retained application/Auth state and immutable checksums, enabling the successful
fresh preparation, two fixed tests and final restoration described above.

## Local commands

From `/Users/markb/dev/baas-bench` on `main`, run the commands below
**sequentially**, using a managed process for each prepare/run (no shell
background/nohup). Each prepare/run requires Docker's running-container listing
to remain empty continuously for five minutes; it resets the timer on contention
and fails after 15 minutes. Stop does not wait. A global exclusive lock prevents
overlapping V6 commands. Do not remove a leftover lock until the controller's
absence is confirmed. The operator approved the local Supabase capacity sweep
at 4 CPUs / 4 GiB after its baseline/reset proof, capped at 330 distinct users.
Local retries are authorized; Linode/cloud runs still require separate approval.

```sh
baseline/baseline.sh prepare supabase
baseline/baseline.sh run supabase
baseline/baseline.sh run supabase
baseline/baseline.sh stop supabase

# TrailBase requires source-matching preparation; preserve stale baselines first.
baseline/baseline.sh prepare trailbase
baseline/baseline.sh run trailbase
baseline/baseline.sh run trailbase
baseline/baseline.sh stop trailbase
```

`run` automatically restores the complete application/Auth/session snapshot,
checks baseline hashes/counts and native Auth linkage before actor login.
TrailBase's stopped-volume backup must contain zero session, authorization-code
and OTP rows. Verification's sole new administrator session is logged out and
its refresh token must be rejected by the native endpoint. Live session counts
are not read through host file sharing: `start-state.json` separately records
the offline baseline count and native revocation proof, never a fabricated live
count. Supabase session and refresh-token counts are checked directly. It then
authenticates a normal seeded application user and checks identity/token lifetime
before launching k6.
The workload is 1 VU, 60 seconds, a 1-second pause, first-page task list, task
create and reread with field assertions. Native operations are tagged separately;
requests have a five-second timeout, no redirects and no retries. Login is
outside measured iterations, in Node; Node sends no measured workload requests.
Postcheck requires exactly one correctly linked atomic activity for each created
task and checks task/activity totals. Every command stops only owned containers;
baselines and volumes survive. No global prune or implicit baseline rebuild.

Matching prepare validates checksums without starting/reseeding. Supabase's
stable bind-mounted inputs (read-only or writable) are individually fingerprinted
and revalidated before reuse/restore. External binds and symlinked inputs are
refused, and the actual Git source revision must match its recorded pin; changed native pins/schema/config/fixture
or altered snapshots/manifests are rejected. Load
script/k6 changes do not require reseeding. An incomplete prepare is deliberately
fail-closed. Preserve its private directory and obtain approval for an explicit
rebuild; there is no destructive reset command.

## Separate authenticated capacity diagnostic

### Supabase live capacity outcome

The local 4-CPU / 4-GiB diagnostic completed an adaptive sweep and counterordered
boundary controls on 2026-10-08. The initial sweep passed through 32 users, passed
48, and failed 52, 56 and 64 on latency. Confirmation contradicted a stable
48–52 boundary: **48 passed 1/4 trials and 52 passed 1/4 trials**, counting each
initial trial and three confirmation trials. Therefore **no reliable maximum or
repeatedly confirmed lower bound is established**. The single passing 32-user
stage delivered about 92.3 requests/s; it was not repeated and is not a certified
capacity result. The workload remains 60-second stages with one-second think time,
per-operation p95 ≤200 ms / p99 ≤1000 ms, HTTP failure rate ≤0.1%, and strict
correctness gates. Every stage passed native task/activity persistence and service
resource/liveness checks; one 52-user stage had a small nonzero HTTP failure rate
below the error SLO but failed latency. No SLO was relaxed to obtain a bound.

Before this run, the repaired token-eligibility gate passed four independently
restored Auth-only cycles of 52 distinct users. Final full application/Auth hashes,
zero sessions/refresh tokens and immutable snapshot checksums matched. All 11
services stopped without OOMs or restarts; Docker was idle, the lock absent, and
the controller recorded no foreign containers or telemetry errors. This does not
exclude every possible source of local-host timing variation. All earlier failed
attempts remain intact. Successful private evidence is under
`.runtime/k6-baseline/supabase-v6-capacity-clock-recheck-20261008T030000Z/`, with
`capacity-and-controls.json` reporting `unstable-or-unconfirmed`, and native run
`supabase/run-1791430288569-29a91f`. Nothing is published or measurement-qualified.
TrailBase remains stopped; its historical 2-CPU/direct-Linux observations are not
comparable to this 4-CPU/host-loopback Supabase diagnostic.

### Commands and admission

The approved Supabase diagnostic uses the verified reduced native baseline:

```sh
baseline/capacity.sh supabase
```

It retains native Auth, RLS, constraints and atomic activity triggers. Setup
checks each normal user's native subject, initial/refreshed access tokens,
RLS-visible application identity, and exact native session/active-refresh counts.
A native Auth-only probe reproduced PostgREST `PGRST303: JWT issued at future`
for a newly issued authenticated token that native Auth accepted. Setup now waits
until 1.5 seconds after its issued-at/not-before boundary, bounded to five seconds;
large clock discrepancies fail closed. The first live settling probe stopped at
its local eligibility guard; the timer wait now rechecks wall-clock eligibility
within a monotonic five-second deadline, with early-wake and frozen-clock
regressions. Remaining clock failures record only timestamp/role metadata, never
tokens. This is outside measurement, does not relax JWT validation, and does not
retry measured requests. Its live repaired
Auth gate subsequently passed four live cycles; repeated capacity trials
completed but did not establish a stable boundary, as reported above.
Additional actors have PostgreSQL-compatible logical IDs and normal memberships;
only account provisioning uses administrator access, outside measurement.
Each independently restored stage uses the native REST list/create/reread paths.
Postcheck audits task/activity pairing and tenant/creator context in one bounded
aggregate statement, plus all 11 services' health, restarts, OOM and exact quotas.
The resource policy is fixed ceilings: PostgreSQL 1 CPU / 1536 MiB and each of the
ten other services 0.3 CPU / 256 MiB, totaling 4 CPUs / 4 GiB. This is not a
borrowable 4-CPU shared pool. Its measurement route is host loopback, not the
historical TrailBase direct-Linux route. Native Auth setup failures are admission
failures, not measured request-capacity boundaries. Supabase remains capped at
330; `--max-vus 660` is rejected before Docker or locking. The approved controller
adds quiet-host admission, telemetry, repeated boundary controls and a final
pristine application/Auth/session reset. No capacity result is established until
those live gates complete, and no cross-platform ranking is authorized.

TrailBase's historical independently authorized profile remains available with:

```sh
baseline/capacity.sh trailbase
```

The default remains capped at 330. The operator approved the next bounded
expansion to **660** on 2026-10-06, after four diagnostic 330-user trials passed.
Use the higher cap only with explicit approval:

```sh
baseline/capacity.sh trailbase --max-vus 660
```

The parser accepts only exact `330` or `660` values for TrailBase and only `330`
for Supabase, rejecting malformed or larger caps before Docker or the run lock. A 660 sweep must pass
fresh 165- and 330-user guards before proceeding above those counts. Each stage
also enforces its selected cap and guard evidence before creating stage files,
restoring state or provisioning users. Higher actor support requires fresh
native preparation/write-reset proof; SQLite/mocked tests are not admission.
The approved follow-up additionally waits for a quiet host, records host and
owned-backend CPU metadata, and repeats the boundary or capped lower bound.
Empty Docker alone does not establish a quiet Mac. No unrelated jobs or power
settings are changed automatically.

This is deliberately separate from `baseline.sh run trailbase`; it leaves the
fixed 1-VU/60-second baseline workload unchanged. It uses one distinct Auth
account, access token, and refresh token per active VU; verifies each access
token against its account profile; calls TrailBase's native refresh endpoint
with each refresh token; and checks the returned access token against the same
profile. Shared identities or tokens fail setup. On the Linux-volume layout,
host-side session-count fields are explicitly `null` (unavailable), not zero;
native refresh acceptance is the pass/fail proof of each session. Historical
bind-mount runs retain their original diagnostic host counts unchanged. Login, refresh, and profile checks happen
before measurement, so this measures authenticated request capacity, not
sign-in or refresh throughput. The workload is first
page list, create and reread, with a one-second think time; task IDs include the
rung, VU and per-VU iteration.

The provisional rung SLO is **HTTP request failures ≤0.1%, 100% successful
functional/persistence correctness checks, and for each operation p95 ≤200 ms
and p99 ≤1 second**. The numeric latency/error examples are not a universal
industry standard: [Microsoft Well-Architected performance targets](https://learn.microsoft.com/en-us/azure/well-architected/performance-efficiency/performance-targets)
call 0.1% a common error-rate target, recommend percentile targets and give
200 ms / 99% sign-in-under-1-second examples; its [performance testing guidance](https://learn.microsoft.com/en-us/azure/well-architected/performance-efficiency/performance-test)
uses a p95-under-200-ms example. The [Google SRE workbook](https://sre.google/workbook/implementing-slos/)
emphasizes customer-appropriate SLOs and gives an API example of p99 under
900 ms. These values are therefore an explicit provisional gate for this local
diagnostic, not a claim about every product or production environment.

The sweep holds each rung for 60 seconds and tests 1, 2, 4, 8, 16, 32, 64,
128, then all 165 existing eligible actors. Only if 165 passes does it add up
to 165 temporary, distinct Auth users and memberships (assigned to existing
organization/project contexts) and test 330. Each rung starts from a restored
private baseline, logs in only its active actors, verifies their identities and
sessions, runs k6, then checks task/activity persistence. With explicit
`--max-vus 660`, a passing 330-user guard permits up to 495 temporary accounts
and memberships in total (660 distinct active identities), reusing the same
existing tenant/project contexts. The application/Auth rows are restored between
rungs; no session or account is shared between active VUs. The post-load audit
returns eight aggregate counts in one database snapshot, scans stage activities
and uses the existing unique task-ID index rather than rescanning activities
for every task. It still verifies exactly one activity per task, actor/tenant
context, action/type, no orphan activities and baseline-plus-write totals.
An audit timeout aborts the sweep; it is not a measured capacity failure and
does not admit the rung. On the first measured failed rung it bisects the
last-pass/first-fail bracket until it is at most five VUs
wide. If the selected cap passes, it reports **at least 330** or **at least
660**, respectively, and stops; this is a single-sweep lower bound until repeated,
not a maximum. Expansion above 660 needs new approval and implementation.
TrailBase remains capped at 2 CPUs / 4 GiB.
Measured TrailBase requests use the running, ownership-checked backend's Linux
network namespace (`--network container:ID`, `http://127.0.0.1:4000`), for both
the fixed baseline and capacity workloads. Controller/Auth setup still uses host
loopback outside measurement. Each stage records the exact route/container ID;
capacity summaries declare this topology. The old Mac/Docker forwarding route
produced inconsistent 165-user latency in diagnostics; direct Linux trials
passed twice. That supports the operator-approved route change but is not proof
of every latency spike's cause. Earlier proxy-route results stay unchanged and
must not be treated as interchangeable with direct-route results. The one
five-minute empty-Docker preflight applies to the overall command; rung restores
are internal to that run. No cloud or Supabase resources are involved.

Stage summaries, raw k6 metrics, logs and capacity output remain private in
`.runtime/k6-baseline/trailbase/run-*/`. The capacity-added Auth/application
rows and tasks are discarded by restoration; no bundle is V5 admission or
publishable benchmark evidence. Do not use these results for cross-platform
rankings.

## Requirements and provenance

- Docker Desktop (macOS) or local Unix-socket Docker/Compose v2 (Linux); no remote
  Docker/SSH/cloud calls. Published service ports bind only `127.0.0.1`.
  TrailBase k6 shares only its verified backend's Linux network namespace, not
  its PID namespace, files or CPU cgroup. This avoids a measured round-trip
  through Mac/VM port forwarding. Supabase's existing host-loopback route is
  unchanged for the fixed 1-VU smoke profile. Its latency is not directly
  comparable to TrailBase's direct-Linux route; route parity remains a gate
  before any separately approved comparative capacity campaign.
- Pinned Node 22.23.1 at
  `/Users/markb/dev/baas-bench/.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node`.
  The public POSIX wrapper intentionally uses the operator's exact approved
  runtime. A Linux installation needs an explicitly reviewed wrapper-path change.
- Existing TrailBase SDK in `.runtime/conformance-v5/sdk`; no dependencies added.
  Host `sqlite3`/`tar` inspect detached, stopped-volume backup copies only, with
  SQLite opened read-only. The existing pinned TrailBase image supplies Linux
  shell/tar tools for volume initialization, snapshot and restore; no helper
  dependency or image download is added.
- Native backend images must already be present; the CLI never pulls them.
  Supabase source setup reuses `bin/baas setup` with isolated runtime and existing
  native pins, not `start` or a conformance/scale campaign. Public static source
  files remain readable by native service UIDs inside a private 0700 runtime;
  generated keys, Compose configuration and snapshots remain 0600. Its full
  11-service backend has operator-approved local diagnostic ceilings totaling
  4 CPUs / 4 GiB: PostgreSQL 1 CPU / 1536 MiB and each of the other ten services
  0.3 CPU / 256 MiB. This CPU-only increase was approved on 2026-10-07 after
  startup probes exposed services missing native health deadlines at 0.1 CPU.
  Memory and stock health-check settings remain unchanged; startup waits for
  all native health checks before seeding. These are separate ceilings, not a
  shared bursting pool. TrailBase remains at its historical 2 CPUs / 4 GiB;
  its existing results are not directly comparable to this Supabase profile.
  A later comparison requires fresh runs under an agreed equivalent resource
  policy and measurement conditions. At least 5 GiB free disk is required.
- k6 `grafana/k6:1.6.1` index digest is pinned in `versions.env`, verified by
  registry HEAD on 2026-10-05 without downloading an image. Before integration,
  review/pull **only** that small image if absent:

```sh
docker pull grafana/k6:1.6.1@sha256:a5ad6bc089a08d77c3ec49f3db8c6fa7a148e4073efcac44c675dbaf3568d8e1
```

`lifecycleFixture()` was executed locally: users **165**, organizations **50**,
memberships **165**, projects **50**, tasks **50**, comments **50**, activities
**37**; **567 logical rows**, seed 42. All 165 application identities receive
native Auth accounts. Both platforms use identical logical rows. Manifest facts
bind source hashes, architecture, Node, seed, counts and per-table hashes;
snapshot files have SHA-256 checksums and the manifest has a checksum sidecar.
These checks detect corruption/staleness, not a malicious local owner rewriting
both manifest and sidecar. Keep the private directory trusted.

TrailBase's live depot resides exclusively in an owner-labelled Docker-managed
Linux volume, not a Mac/VM bind mount. Static bootstrap/config files and closed
archives may cross the host boundary; live SQLite files never do. After cleanly
stopping all volume writers, a same-pin Linux helper archives the entire depot,
including all DB/WAL files, native Auth, signing keys and config. A detached copy
is inspected read-only on the host: nonzero session, authorization-code or OTP
counts reject preparation rather than being silently cleared. The native admin
query endpoint's restriction on attaching the session DB is not bypassed.

Restore validates the closed backup and volume ownership, rejects even stopped
unowned containers mounting that volume, preserves the previous stopped owned
container and its Docker logs under a unique name, and then clears/extracts the
snapshot **inside Linux**. The next start uses the same pinned image, loopback
port and resource limits with that volume. No existing container or volume is
deleted; uncertain preservation failures abort before volume mutation. Helpers
are disposable, labelled, offline-only containers from the already present
pinned image. Existing bind-mount runtimes/manifests require an explicitly
approved, evidence-preserving fresh preparation; they are never migrated or
reseeded automatically. Historical metrics are not reinterpreted as volume
results.
Supabase stops all writers, starts only its owned PostgreSQL
service and takes a full native `pg_dump -Fc`; restore keeps other services
stopped during `pg_restore --clean --if-exists --create --exit-on-error`, using
native `supabase_admin` only for this maintenance restore. `pg_dump --create -Fc`
retains database-level settings. Restore connects to `template1` to drop/recreate
only the archived `postgres` database, rather than individually dropping native
inherited partition constraints. Before recreation, the archive must name exactly
that one database and ownership checks must prove only the owned DB service is
running. Inspection uses `pg_restore --list --create`: plain `--list` omits
DATABASE entries even when the archive contains them. A sanitized real-archive
listing fixture guards this behavior; unrelated/multiple database entries still
reject recreation. Native `pg_cron` and `pg_net` workers remain connected even
with all other services stopped. After the archive/ownership/writer guards,
`dropdb --force --if-exists -U supabase_admin --maintenance-db template1 postgres`
terminates only target-database connections, then strict archive recreation runs.
Native blockers still fail closed; no restore follows a failed forced drop.
Other databases, containers, volumes and historical evidence remain intact. The restricted `postgres`
role cannot drop native event triggers owned by the platform administrator.
Native ownership/triggers are retained; client Auth/RLS is not weakened. Pinned source,
private Compose/environment and resolved immutable image IDs/digests and native
architectures are retained/checked. The
full database backup restores Auth login-mutated fields and sessions as well
as application data. Supabase remains a multi-service Compose deployment.

Artifacts are under `.runtime/k6-baseline/PLATFORM/` (private directory/umask
077): manifest, immutable snapshot and credentials; `run-*/` holds start state,
provenance, k6 summary, per-operation raw metrics, logs and postcheck. Failed
commands retain private diagnostics; primary and cleanup failures are both
recorded. Supabase also retains a credential-free `owned-pre-stop-state.json`
for each command: live service state before intentional cleanup must not be
confused with signal/connection-close exit statuses produced during shutdown.
Private verification requires every native service alive with zero OOM/restarts
before stopping, keeps all post-stop statuses and requires owned resources
stopped afterward. Never commit/publish these files or expose production keys.

## Fake regression/repository gates

```sh
export PATH=/Users/markb/dev/baas-bench/.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin:$PATH
sh -n baseline/baseline.sh baseline/capacity.sh test/baseline_test.sh
sh test/baseline_test.sh
sh -n bin/baas bin/bench test/baas_test.sh test/bench_test.sh
sh test/baas_test.sh
sh test/bench_test.sh
bin/bench validate all
git diff --check
```

Supabase's reduced local live gates passed: native bootstrap, PostgreSQL full
restore with extension/service dependencies, local Docker loopback reachability,
two actual k6 runs and final reset. Broader capacity/endurance and cloud operation
remain unproven. Do not substitute fake passes for fresh native evidence under
any changed resource, topology or workload policy. Changes to shared preparation/native code make old
source-bound TrailBase manifests stale by design; retain those snapshots and
historical results unchanged rather than rewriting their checksums.
