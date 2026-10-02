# Repeatable native conformance (candidate, not admission)

V5 execution and publication remain blocked. A successful small-fixture probe
is diagnostic evidence only: it cannot satisfy declared-scale fixture integrity,
complete Auth/session reset, or measurement qualification.

## Shared observable assertions

`shared/lib/native-conformance.mjs` exports `runNativeConformance` for both native
drivers. It uses the same session API for known-result literal/case searches,
ordered page/count/null-filter edges, live manager promotion/demotion, and
application-only profile changes checked against native Auth state. Role/comment
and profile mutations are restored even when an assertion fails. Drivers must
still reset activity and all other case-owned state after these checks.

Inputs are native `owner`/`member` sessions; a fixture with tenant/task/comment/
membership IDs, ordered `taskIds`, ordered `unassignedTaskIds`, and matching and
nonmatching `{query, ids}` searches; and a native `readAuthState` callback. Auth
state may include sensitive fields for in-process comparison but is never
included in the returned report. The `checks` map supplies the remaining raw API,
integrity, activity/rollback, fixture/reset and persistence assertions named in
`shared/lib/conformance.mjs`. Missing checks fail. Adapter success does not prove
raw native API authorization.

Regression command (no real services):

```sh
node --test test/native_conformance_v5_test.mjs test/native_lifecycle_v5_test.mjs test/realworld_api_v5_test.mjs
```

## Disposable TrailBase probe

Only run with explicit local-integration authorization. Requires Docker, the exact
V5-pinned Node 22.23.1 runtime, the V5-pinned TrailBase image already present, and
the pinned SDK install:

```sh
mkdir -p .runtime/conformance-v5/sdk
chmod 700 .runtime/conformance-v5 .runtime/conformance-v5/sdk
cp benchmark-sets/realworld-api-v5/shared/package*.json .runtime/conformance-v5/sdk/
npm ci --ignore-scripts --prefix .runtime/conformance-v5/sdk
.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node test/native_v5_trailbase_probe.mjs --local-disposable
```

The procedure creates a unique private run directory and uniquely named container,
uses a dynamically allocated localhost-only port and a 2-CPU/4-GiB limit, applies
candidate schema/ACLs, and installs the private failure trigger by migration.
It never connects to an existing stack or opens the live database with an external
SQLite writer. It removes only its own container/depot, including on failure.
A bounded readiness/restart check is included; database settings are recorded,
without a power-loss durability claim. Cleanup failure is recorded and remains
nonzero even if native assertions pass. An abrupt controller kill may require
manual cleanup using that run's private `inventory.json`; do not infer ownership
from a container name alone.

`report.json` stays under the ignored `.runtime/conformance-v5/trailbase-*/`
directory. `local_checks_passed` means the implemented synthetic assertions passed;
`conformance.passed` remains false because `fixture-integrity` and `reset-baseline`
are intentionally unimplemented at declared scale. No native qualification or
benchmark admission is implied. The probe is not part of automatic shell tests.

## Disposable Supabase probe

With the same SDK installation and explicit local-integration authorization; use
the exact Node 22.23.1 runtime pinned by V5:

```sh
.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node test/native_v5_supabase_probe.mjs --local-disposable
```

This uses `bin/baas setup` with a fresh private `BAAS_RUNTIME_DIR` and the V5
version profile. It never starts/stops the normal environment. The generated
Compose config removes global container/network/volume names and all host ports
except a fresh localhost gateway port. It pins Envoy, creates a fresh database,
regenerates credentials, limits the owned stack to at most 4 CPUs/8 GiB, and
starts only already-local images (`--pull never`). It reads native Auth state
only in memory. Cleanup removes its project containers/volumes and private source
and resolved config; the private report/inventory remain. Cleanup failure retains
private config for ownership-based manual recovery. No raw database or Auth state
is printed or committed.

The two drivers use identical fixture search/page expectations and activity
assertions. Both intentionally leave declared-scale fixture/reset evidence
missing; their reports cannot admit a case. The Supabase source fetch and local
setup are network operations, not paid Linode provisioning.

## Declared-scale fixture/reset probes

The user separately authorized these **local-only** checks on 2026-10-01.
Run one backend at a time; never run these concurrently or against an existing
stack. They keep the same resource bounds and ownership/cleanup as above:

```sh
.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node test/native_v5_trailbase_probe.mjs --local-declared-scale
# Only after TrailBase cleanup:
.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node test/native_v5_supabase_probe.mjs --local-declared-scale
```

Each seeds the existing seed-42 million-record fixture and 16,000 native Auth
accounts using native password defaults. It compares every logical row via
ordered SHA-256 streams against independently generated expected rows, verifies
all application/Auth identity mappings, snapshots the complete owned baseline,
and exercises two mutation/reset cycles. Modified seeded profiles/tasks/comments/
roles and newly created tasks/comments/activity/Auth accounts must disappear or
be restored. Native Auth state is restored and compared only in process; refresh
sessions must end and fresh password sign-in must work. Immediate invalidation
of already-issued stateless access JWTs is not claimed by the refresh check.

A private `progress.json` records phase and confirmed application/Auth counts;
`scale-evidence.json` retains verified baseline digests and each completed reset
cycle even if a later check fails. Reports contain only hashes/counts and outcomes,
never raw Auth snapshots. Cleanup attempts every opened actor session and preserves
the original failure alongside cleanup failure types. TrailBase controller Auth is
renewed after an acknowledged Auth restore, since that restore invalidates its
refresh session too; ambiguous restore outcomes are never automatically retried.
Supabase reset uses one transactional `TRUNCATE ... CASCADE` for its complete
owned application-table set, then restores rows in FK order. Its ten-minute
reset deadline applies only to this administrative operation; measured API
limits remain unchanged. These
are fixture/reset diagnostics, not a capacity search, a 120-second/50-user warm-up
qualification, or proof that the full native adversarial suite has passed at
scale. Both V5 hard guards remain. Do not pool the small- and full-scale reports
into automatic admission evidence.

Failed findings retain only an allowlisted error type, a valid HTTP status when
available, and a cleanup-failure count. Native messages, URLs, credentials, and
unknown error names are discarded. These diagnostics do not change acceptance.

## Reduced-fixture lifecycle diagnostic

With explicit local-integration authorization, run sequentially with the same
owned stacks, pins, bounds and cleanup as the other probes:

```sh
.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node test/native_v5_trailbase_probe.mjs --local-lifecycle
# Only after TrailBase cleanup:
.runtime/conformance-v5/node-v22.23.1-darwin-arm64/bin/node test/native_v5_supabase_probe.mjs --local-lifecycle
```

This imports a relationship-closed subset of the established seed-42 fixture:
50 established actors and their projects/tasks/comments, all required application
users/memberships, and at most one existing activity per selected project. Every
included application user receives a native Auth account. It does **not** seed or
claim the million-record fixture again. Source subset hashes/counts and private
native baseline digests are retained in `lifecycle-evidence.json`.

Two cycles exercise acknowledged complete subset application/Auth restoration,
baseline digest verification, serial fresh-session preparation (the diagnostic
avoids an unrepresentative 10-login burst), and the same 120-second/50-user
warm-up. Each request retains the five-second deadline. The V5-owned copy of the logical workflows retains the
approved weights, global-user seed derivation, think times, page sizes and
five-second API deadlines; it does not import the V4 workload runner/controller.
A failed phase prevents stage entry without a retry. Peers drain before cleanup;
all opened sessions are closed, preserving primary and cleanup failures.

The stage-entry assertion reuses the warmed sessions, verifies actor/task access,
and compares full application digests to prove warm-up writes survived without
an intervening reset or write. **It is not a timed measurement or capacity stage.**
No throughput/latency/capacity results are emitted. The shared phase helper also
requires successful session preparation and explicit warm-up success on the
conformance-gated measured-stage path. Report `admission_evidence` and
`measurement_qualified` remain false. Native adversarial/declared-scale reports
cannot be pooled with this diagnostic to admit a case. Actual declared-scale,
multicore/timed-stage integration, telemetry/headroom and evidence review remain
outstanding, and both V5 CLI guards remain unchanged.

## Timed-stage framework candidate

`shared/lib/timed-stage.mjs` implements the prepared-session timed window and
`runTimedStageFromBaseline`. The latter keeps the mandatory conformance shape
gate, resets/verifies before each stage, prepares `max(target, 50)` independent
sessions serially, warms the first 50, and measures only the target cohort using
those live contexts. Preparation, baseline checks, warm-up and final logout do
not emit measured samples. Login replacement during the measured sign-out/in
workflow does emit native-operation samples. Request errors are not retried.

Scheduling stops at the nominal stage deadline. In-flight workflows drain for
at most five seconds, then pending requests are cancelled; a second five-second
drain ceiling flags unfinished work. Integrity errors, sample-observer failure,
parent cancellation, worker exceptions, drain expiry and start lateness over
100 ms invalidate the candidate window. The elapsed denominator spans measured
start through the bounded drain, as in the retained workload; nominal duration
is also reported. The normal duration remains 300 seconds, extended below five
users. Short injected windows and fake lifecycle producers are regression tests,
not measurements or native qualification.

The V5-owned pure metrics accumulator pools individual latency samples, limits
retention to 5,000,000 samples in the stage wrapper, and does not average worker
percentiles. **Whole-stage validity stays false** while native multicore/telemetry
qualification is pending. Neither this framework result nor an injected passing
conformance report is admission evidence. Both CLI guards and the case hooks
remain blocked. Runnable framework check, without services:

```sh
node --test test/timed_stage_v5_test.mjs test/native_lifecycle_v5_test.mjs
```

## Process telemetry candidate

`shared/lib/telemetry.mjs` samples a process at absolute five-second ticks using
standard Node CPU/RSS and event-loop histogram counters. The timed-stage wrapper
starts/stops this sampler at its measured boundaries, outside session cleanup.
The validator rejects missing/malformed/non-monotonic or misaligned samples,
start lateness over 100 ms, telemetry ending before the shared stage end, and
fewer than `ceil(requested duration / 5s)` ticks even if wall-clock drift makes
the observed interval appear slightly shorter.
Each coordinator/worker source must pass separately; duplicate PIDs or a missing
member of the three-worker cohort fail. Three consecutive breaches of CPU >90%,
event-loop p99 >100 ms, or event-loop maximum >250 ms invalidate attribution.

Short sampler intervals exist only for the service-free regression check and
cannot qualify the profile. This is process telemetry, **not** backend host,
container, restart, routing or storage evidence. The three-worker coordinator below consumes these reports, but backend telemetry
and native measurement qualification remain outstanding. Stage validity and
admission remain blocked. Check:

```sh
node --test test/telemetry_v5_test.mjs test/timed_stage_v5_test.mjs
```

## Three-process coordinator candidate

`shared/lib/parallel-stage.mjs` owns three child processes and the parent
reset/verify gate. It serializes shard session preparation with global user
indices, then distributes exactly the first 50 warm-up actors across the shards.
Each worker retains its live sessions/cursors for the measured cohort. Warm-up
and measurement each use one shared future epoch; an idle shard still participates
and supplies telemetry when the global stage has fewer than three users.

Raw sample batches are pooled in the parent's bounded accumulator. Bounded IPC
queues, producer/consumer sample counts, source PIDs, legal phase transitions,
child exits, and coordinator/worker telemetry are checked. Missing evidence or
sample-consumer failure aborts the stage, never creates a low-capacity bound.
Cleanup waits for every owned child; SIGTERM followed by a bounded SIGKILL fallback
prevents orphaned workload processes. Cloud/service-admin environment tokens are
not forwarded. Backend modules are explicitly supplied factory dependencies;
there is no V4 controller import or usable production CLI yet.

Service-free regression checks fork real Node processes against an explicit fake
backend module. Short windows require `diagnostic: true`, cannot qualify the
profile, and report invalid whole-stage metrics because backend host/container
and native measurement qualification remain missing. The normal path still
requires mandatory conformance findings and the declared durations. Both V5
execution/publication guards remain unchanged:

```sh
node --test test/parallel_stage_v5_test.mjs test/timed_stage_v5_test.mjs test/telemetry_v5_test.mjs
```

## Backend telemetry candidate

`shared/lib/backend-telemetry.mjs` provides a Linux-backend-local sampler. Its
Docker commands are read-only, target an explicit local Unix socket, and require
full 64-character container IDs and the exact owned Compose project. It does not
discover stacks or follow remote Docker contexts. The inspect template collects
only identity, running/restart/start/OOM/dead state—not environment variables or
credentials. Docker stats use `--no-trunc`; missing, duplicate, unrelated or
prefix-only IDs fail. Docker's text memory units remain approximate observations.

Linux CPU counters exclude guest/guest_nice from the total because Linux already
includes them in user/nice. Memory/swap, per-interface byte/drop counters, boot ID,
and OOM-kill counters are retained. Five-second absolute ticks plus baseline and
final state reject missing/misaligned data, counter resets, changed interfaces,
host/container restarts, or observed OOM events. All Docker probes are bounded at
four seconds. macOS is explicitly unsupported as a Linux backend-host source;
Docker Desktop container data must not be presented as backend-host telemetry.
No power-loss or private-routing proof is supplied by these counters.

The parallel coordinator accepts an explicit backend telemetry factory and
ownership declaration, stops it before actor cleanup, and preserves primary
failures while attaching secondary cleanup errors. This is a dependency boundary,
not an SSH implementation or native qualification: an agent on the separate
backend and its transport still need integration/provenance checks. All returned
stage metrics and admission flags remain unqualified, including synthetically
passing telemetry. Service-free parser/failure regressions do not contact Docker:

```sh
node --test test/backend_telemetry_v5_test.mjs test/parallel_stage_v5_test.mjs
```

## Disposable native timed-stage diagnostic

Both existing disposable drivers additionally accept `--local-timed-stage`.
It uses the same closed lifecycle fixture (not a new benchmark dataset or the
million-record dataset), two application/native-Auth restoration cycles, three
real workload processes, exactly 50 warm-up actors for 120 seconds, and a
300-second measured window with retained warm sessions/cursors in each cycle.
Shard preparation remains serial. The local worker factory enforces the exact
Node/SDK pins, explicit loopback endpoints, anonymous Supabase keys, and no
TrailBase admin key. Only the parent holds reset/admin access.

The diagnostic enters through `runParallelLifecycleDiagnostic`, **not** a forged
passing mandatory-conformance report. Warm writes must exist before measurement,
delivered samples must equal pooled attempted counts, actors must remain achieved,
and balanced-load operations must succeed. Private lifecycle evidence retains
operation counts and process telemetry, not throughput/latency rankings. It still
reports `admission_evidence: false` and `measurement_qualified: false`: the reduced
fixture, local HTTP topology, and missing separate Linux backend telemetry cannot
qualify the declared profile. The normal measured helper and CLI guards are
unchanged. Run sequentially, never alongside another disposable stack:

```sh
node test/native_v5_trailbase_probe.mjs --local-timed-stage
node test/native_v5_supabase_probe.mjs --local-timed-stage
```

These commands are opt-in native probes, not repository regression tests. No
successful timed native report is claimed until a frozen-revision probe finishes
and its owned cleanup/provenance are inspected.

## Malformed values, relationships, and Unicode search

The raw native `server-integrity` assertion now pairs valid task/comment control
writes with 4xx rejection of malformed title/description/enum/identity values
and broken project/organization, creator/assignee, and comment/task/project/
organization/author links. Application and activity tables are compared before
and after the rejection set; no invalid partial write may survive. This extends
server-side evidence beyond adapter validation.

Known-result search includes composed `Ångström 東京 Café`, matched by `ÅNGSTRÖM`,
`東京`, and `CAFÉ`, as well as a decomposed `Cafe\u0301` nonmatch. These are literal
Unicode/code-point probes, not a general guarantee of locale-aware full case
folding or canonical normalization. The probe reports actual pinned native
behavior; qualification must disclose the backend locale and all results. A new
fixture row also participates in pagination and the explicit-unassigned filter.

The expanded probes passed on the disposable TrailBase and Supabase stacks at
clean source commit `d691343de5730e00d8eb0c12ea6f721c94cb6ae0`; see
[the private local run record](LOCAL-CONFORMANCE.md#expanded-native-integrity-and-unicode-probes).
This validates only the implemented synthetic assertions. `fixture-integrity`
and `reset-baseline` are still false/missing, and no admission follows.

## Monotonic deadline correction

An early duration-timer wake-up is now rechecked against the monotonic deadline;
it cannot end a timed window early. Process and backend sampling also use an
absolute monotonic schedule anchored to the shared UTC epoch, keeping observed
UTC timestamps rather than manufacturing them. Stopping a sampler captures one
actually due observation if its timer has not yet run. Missing intervals are not
backfilled: a full-interval scheduling gap fails closed. Duration-timer failures
invalidate the stage instead of silently shortening its scoring denominator.

Deterministic service-free regressions reproduce early wake-ups and the final-tick
ordering, including a missed-multiple-interval rejection. The previous TrailBase
window remains invalid; these changes do not retroactively qualify stored runs.
A native rerun is still needed after source freeze, alongside the remaining Linux
host/transport and reviewed admission gates.

## Diagnostic source provenance

New attempts record the starting Git commit, dirty-worktree flag, actual Node
version, and a path/content SHA-256 manifest for the V5 definition, native probe
sources, setup tooling/pins, imported bootstrap helper, and private SDK lockfile.
Only the lockfile hash is recorded; other private runtime contents are excluded.
The finishing source digest flags changes during the attempt. A changed or dirty
source remains diagnostic and requires frozen-revision revalidation. A lockfile
hash does not attest installed dependency bytes, and provenance alone does not
qualify a backend. `admission_evidence` remains false; neither guard is relaxed.
The completed pinned-runtime Supabase scale and synthetic adversarial attempts
recorded clean commit, source hashes, and no source changes during each run.

## Pending
- Expand the remaining value/relationship corpus. Fresh pinned-runtime native
  probes at commit `8d9cc4013706a046a15a7a6a036bc48677f16202` passed live
  membership removal on a separate tenant, protected user/membership/comment
  identity-column writes, and valid raw-write controls on both backends. The
  membership check proved the same session loses task visibility and receives
  HTTP 403 on create while self-profile remains readable; restoration recovered
  visibility. These remain synthetic-fixture findings, not declared-scale
  adversarial coverage.
- Declared-scale fixture identity and two complete Auth/session reset cycles
  passed for both TrailBase and Supabase at the pinned source/runtime. This does
  not qualify performance or replace fresh adversarial native probes.
- Qualify reset/verify/identical-warm-up/measure integration and bind native
  evidence to frozen definitions before reconsidering either hard guard.
