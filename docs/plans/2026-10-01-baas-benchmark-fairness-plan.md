# BaaS benchmark fairness and conformance remediation

**Date:** 2026-10-01

**Priority:** Highest next implementation priority after the multi-core runner work in the other terminal is complete.

**Status:** Queued by the user; planning only. Detailed contract decisions and any new paid runs require approval.

**Dependency:** The multi-core owner records the completed revision, regression results, runner profile, remaining issues, and the ownership/cleanup state of any live resources before handing off. Do not interrupt that work or infer completion from an idle terminal or stale heartbeat.

## Objective

Make the project-management capacity comparison scientifically defensible: every eligible case implements the same observable application behavior, security and persistence guarantees, and lifecycle contract on the same declared hardware/runner profile. Allow efficient, idiomatic native implementations. Do not require identical SQL, indexes, API request counts, or architecture.

Existing Supabase/TrailBase capacity observations are diagnostic measurements of their implementations, not an established relative platform-capacity result. Preserve their archived definitions, raw evidence, manifests, and classifications unchanged. Do not retroactively validate, rewrite, or pool them with corrected implementations.

This plan schedules remediation; it does not authorize cloud provisioning, paid retries, destructive recovery, a new budget, or publication of comparative rankings. Already authorized multi-core diagnostics may finish under their existing approval and ownership safeguards; they remain diagnostic, not evidence that the semantic gaps are closed.

## Scope and non-goals

- Audit all eight cases: Supabase, Neon, Convex, Appwrite, Nhost, Directus, PocketBase, and TrailBase. Repair and prove Supabase/TrailBase equivalence first, then bring other intended campaign cases through the same gates.
- Reuse the existing deterministic million-record dataset, project-management workflows, lifecycle, and test tools. No new benchmark framework, dashboard, orchestration layer, or dependency unless a demonstrated gap requires one.
- Keep V3 and historical evidence unchanged. Use a separately identified corrected definition revision/evidence series; decide whether to scaffold a new set at the contract-review gate. If a new set is selected, use `bin/bench new`.
- No promise that any platform will reach a particular user count. No optimization based on making a preferred platform win.
- API/SDK cases and materially different direct-database/application-owned-auth paths must remain separately identified. Neon inclusion in an API-capacity comparison is a reviewed decision, not an automatic assumption.

## Known findings to verify against the handoff revision

These findings describe the inspected implementations, not a completed audit of every service:

| Area | Supabase implementation | TrailBase implementation | Consequence |
| --- | --- | --- | --- |
| User reads | Self/organization-peer visibility | Any authenticated application-user read | Different authorization work and guarantees |
| Project/comment authorization | Manager-only project mutation; author/manager comment editing | Corresponding rules allow organization members | Negative contract differs; some operations are outside timed workflows |
| Identity and integrity | Creator/author checks; foreign keys and value constraints | Membership checks without equivalent identity binding or relationship/value constraints | Well-formed test payloads conceal weaker rejection behavior |
| Activity | Task/comment insert/update triggers create records | No equivalent trigger or adapter-side write | Less mutation work and a different later dashboard dataset |
| Search | Case-insensitive substring matching | Plain title filter without an explicit substring operator | Search work/results are not proven equivalent |
| Null assignee filter | Explicit null predicate | Filter dropped by adapter | Correctness fixture may mask the discrepancy |
| Profile update | Native Auth metadata plus application-user mutation | Application-user mutation only | Must define the required state and observable result |
| Reset | Full application baseline restoration | Deletes created records without restoring modified seeded state | Different lifecycle guarantees |
| Request scheduling | Sequential task-detail user lookups | Parallel user lookups | Potential avoidable adapter inefficiency, not a reason to weaken semantics |
| Harness history | Older single-process/telemetry observations | Later runner/telemetry revisions | Different evidence profiles; cannot pool as unchanged experiments |

The recently implemented Supabase unused-count removal and RLS overlay are candidate semantics-preserving improvements, not fairness certification or measured performance gains. Recheck them after the multi-core handoff and include them explicitly in the corrected revision. Exact totals remain required where the reviewed pagination contract requires them.

## Execution order and exit gates

### Phase 0 — Handoff, containment, and evidence inventory

1. Obtain the multi-core owner's completion/handoff record. Preserve their work and avoid overlapping edits while it is still in progress. Retain per-worker headroom checks, pooled raw latency samples rather than averaged percentiles, cancellation behavior, and stage-aligned telemetry.
2. Inspect the actual checkout and pending Supabase changes; record the revision and working-tree ownership before implementation. Do not overwrite another terminal's uncommitted work or silently adopt incomplete fixes.
3. Identify existing V4 attempts and their definition, runner, telemetry, and hardware profiles. Record known limitations in documentation, without modifying immutable bundles or publishing raw/private data.
4. Suspend new comparative capacity campaigns and comparative conclusions until the conformance gates pass. Do not stop, recover, or delete resources owned by the other terminal without the existing authorization/ownership checks.

**Deliverable:** Handoff checklist, historical-evidence classification, and a clearly identified remediation baseline.

**Gate:** Multi-core work is confirmed complete; live-resource ownership is understood; the implementation queue now prioritizes this plan.

### Phase 1 — All-case semantic audit

Trace setup, schema/indexes, permissions, adapters, correctness, reset, timed workflows, and side effects for each case. Do not assume a shared adapter interface or passing current correctness gate proves equivalent behavior.

Build one compact conformance matrix alongside the methodology: requirement, expected observable behavior, each case's implementation, executable check, pass/fail/unknown, and material deviation. Include the API calls and server-side writes performed by each workflow. Distinguish timed differences from correctness-only gaps and unavoidable native access-path differences from avoidable adapter work.

Audit fixture identity/distribution, exact pagination counts, ordering, search, authorization, creator/author binding, relationship/value rejection, activity, profile/auth state, reset, persistence, timeouts/retries, setup/session-preparation boundaries, and capacity-stage history. Check authentication/hash/session defaults and disclose differences rather than quietly disabling security or reducing password cost for throughput.

**Deliverable:** Evidence-backed matrix for all eight cases. Unknown is not pass.

**Gate:** Every intended case has an explicit implementation/verification entry for each requirement; blockers are visible before performance tuning.

### Phase 2 — Freeze and approve the application contract

Put the fairness-sensitive decisions in `METHODOLOGY.md`, with exact per-case implementation/deviation details in case READMEs. Propose retaining the existing seed, dataset size, workflow mix, think times, SLOs and request deadlines unless review identifies a separate methodological defect; do not change thresholds after observing outcomes.

Resolve these decisions explicitly before implementation:

- Search: case sensitivity, literal substring/escaping behavior, matching and nonmatching fixtures, stable order, exact totals, and pagination.
- Authorization: self/peer visibility, tenant membership, owner/admin powers, comment-author permissions, spoofed actor rejection, and changes taking effect without stale session/JWT permission caches.
- Integrity: consistent task/project/organization relationships, membership of creators/assignees/authors, valid statuses/priorities/roles, nonempty required values, and rejection behavior. Native constraints, policies, or native server hooks are acceptable; client-only checks are not a substitute for server enforcement.
- Activity: which mutations create which records, actor/subject attribution, dashboard visibility, and atomicity. Recommend exactly one activity for each required successful mutation and none for a failed mutation, committed with that mutation. A non-atomic two-request workaround is a different guarantee, not an undisclosed substitute.
- Profile/auth: define which application and authentication fields must change and what later reads must observe. Do not require an unnecessary extra Auth write in just one case or skip a required write in another.
- Persistence: define what a successful acknowledgment guarantees and the failure model to check. Document transactional and durability settings; do not trade away required persistence for benchmark speed.
- Lifecycle: exact reset scope, stable fixture verification, warm-up writes, and whether adaptive stages start from a restored baseline or deliberately share growing state. Review accumulated mutations and stage-order effects; never reset selectively for only one service.
- Eligibility: decide whether materially different access paths can belong to the same claim or require a separate report/profile. Cases unable to satisfy the contract are unsupported/ineligible, not zero-capacity results.
- Experiment identity: select the corrected revision/set and a separate historical evidence series. Record the finalized multi-core runner profile and allowed tuning policy.

**Deliverable:** Reviewed contract and eligibility/tuning rules.

**Gate:** User approval of material semantic, atomicity/durability, stage-state, and comparison-scope decisions. No unresolved decision may silently default differently per platform.

### Phase 3 — Make conformance executable before repairs

Write failing regressions for confirmed gaps, then extend the shared backend correctness gate using known expected fixture values—not assertions that merely accept a well-shaped response.

Required checks include:

- Known positive and negative substring searches, case/escaping decisions, stable pages, and exact totals.
- Self/peer/outsider visibility; role denial; another user's profile/comment restrictions; forged actor IDs; forged parent/tenant combinations; malformed values. Verify rejected writes leave state unchanged.
- Each required mutation creates the expected activity, exactly once; subsequent dashboard reads include it. Exercise failed mutations and the chosen atomicity guarantee.
- Role promotion, demotion, and membership revocation become visible on the next authorized operation, including on an existing session.
- Reset restores modified seeded records, profiles, roles and required auth state, removes created resources, and restores fixture identity—not just counts.
- The agreed persistence/restart contract, using a bounded dedicated integration check rather than disruptive restarts during measured stages.

Mocked SDK, SQL, and shell tests protect regressions without starting real BaaS stacks. They cannot certify backend semantics. Add bounded, explicitly authorized backend integration conformance runs outside measured intervals. Reuse the Supabase before/after SQL authorization check; do not mistake it for full Supabase/TrailBase integration certification.

Conformance failure must prevent admission to a comparative run and comparative publication. Audit the existing runner/publish path and use its failure/invalid-state mechanisms; make the smallest additional check necessary so a failed or missing mandatory conformance result cannot produce comparative evidence. Preserve primary errors when cleanup also fails.

**Deliverable:** Failing checks for known gaps and a shared mandatory conformance gate.

**Gate:** The tests demonstrably catch omitted activities, incorrect searches, weakened authorization, and incomplete reset; an unsupported case cannot bypass the gate.

### Phase 4 — Repair Supabase/TrailBase, then other eligible cases

1. Implement the reviewed contract with native mechanisms. Preserve or strengthen required security and integrity; do not weaken Supabase to match an incomplete TrailBase case.
2. Remove unused Supabase counts and prove the RLS optimization preserves permissions/constraints. Retain exact required pagination counts. Verify the deployed setup actually applies the intended policies.
3. Align TrailBase search, permission/identity enforcement, integrity, required atomic activity writes, profile behavior and reset. If native capabilities cannot meet a requirement, stop and record ineligibility or request a reviewed separate case/profile—do not hide a workaround.
4. Apply the same conformance requirements to the other intended services. A smaller conformant comparison may proceed with explicit exclusions; it is not an eight-platform claim.
5. Optimize avoidable adapter work and native indexes consistently across eligible cases. Permit indexes/RLS query plans/batching/concurrency that preserve the contract, document them, and review expensive queries under ordinary authenticated permissions. Do not use bypass-RLS/admin credentials in measured workflows, preload results, or add a private fast path to only one case.

**Deliverable:** Conformant cases with documented topology, tuning, necessary fan-out, side effects and deviations.

**Gate:** Supabase and TrailBase pass the same real-backend contract; every other case admitted to a campaign passes it too. No case is described as equivalent based solely on static configuration or mocks.

### Phase 5 — Freeze, diagnose, and requalify measurement

Freeze clean definitions, version pins, contract/conformance checks, finalized runner profile, and tuning at a recorded revision. Define membership of the comparison before collecting formal observations.

Reconcile exact backend and runner plans, region, OS/architecture, storage, TLS/proxy path, clocks, telemetry alignment, and lifecycle provenance. Confirm the multi-core runner measures all workers and invalidates insufficient headroom rather than attributing it to the backend. Invalid stages must stop the capacity search, not become low-capacity bounds.

Perform only explicitly approved diagnostics first: full fixture correctness, balanced low-load workflow verification, actual request/write amplification, resource traces, and the revised stage-state/reset policy. Add focused per-service CPU and database query/wait diagnostics where needed to explain remaining CPU pressure; avoid building a new monitoring system. Compare actual expected search/activity/permission behavior before examining capacity numbers.

**Deliverable:** Clean reproducible revision and measurement-qualification report.

**Gate:** Conformance and measurement validity both pass. No known semantic gap is classified as a harmless tuning deviation.

### Phase 6 — Separately approved campaign and reporting

Obtain fresh approval for platforms, exact backend/runner profiles, region, repetitions/order, remaining budget and maximum spend. This plan neither refreshes the historical USD $30 approval nor assumes its remaining balance. Include failed attempts and cleanup/transfer reserves in the estimate.

Use the existing `bin/bench run` lifecycle and Linode ownership/budget safeguards. Collect at least three valid independent observations per included platform in a predeclared balanced/rotated order, using fresh observation environments and one owned pair at a time. Retain invalid/interrupted attempts without silently retrying or changing the contract.

Publish only through `bin/bench publish` after conformance, telemetry, provenance, checksums, cleanup and the approved reporting methodology pass. Present capacity variation, SLOs/errors, actual workflow/request throughput, runner headroom, backend resources, topology and exclusions. Do not pool historical single-process, multi-core diagnostic, and corrected-semantic observations. No claim of a universal user/connection limit or unexplained composite ranking.

**Deliverable:** New, explicitly scoped comparison evidence, or a clearly labeled diagnostic/incomplete campaign.

**Gate:** All admitted cases satisfy the same approved contract and declared repetition/resource rules; unresolved cases are visibly excluded.

## Required implementation checks

Before committing implementation changes or declaring remediation complete:

```sh
sh -n bin/baas bin/bench test/baas_test.sh test/bench_test.sh
sh test/baas_test.sh
sh test/bench_test.sh
bin/bench validate all
node --test test/realworld_api_v4_test.mjs test/linode_v4_progress_test.mjs test/linode_v4_readiness_test.mjs test/linode_v4_controller_test.mjs test/linode_v4_multicore_test.mjs
git diff --check
```

Add new conformance regressions to the relevant existing suite or a small dedicated suite, and include their runnable commands in the handoff. Mock tests must not start real BaaS stacks. Disposable local SQL tests and real-backend conformance checks are separate checks with explicit resource boundaries/authorization; never run destructive SQL fixtures against a benchmark or production database.

## Completion checklist

- [ ] Multi-core owner handoff complete; this is the next highest-priority implementation task.
- [ ] Historical evidence preserved and documented as non-equivalent diagnostic series.
- [ ] All eight cases audited; requirement matrix has no unexplained unknowns for admitted cases.
- [ ] Shared observable contract and material decisions approved.
- [ ] Regressions catch the known semantic gaps and fail comparative admission/publication.
- [ ] Supabase and TrailBase pass identical real-backend conformance checks.
- [ ] Every additional campaign case passes the same checks or is explicitly excluded.
- [ ] Efficient implementations and tuning documented; security/persistence guarantees preserved.
- [ ] Frozen multi-core measurement profile and corrected experiment revision qualified.
- [ ] New paid campaign separately approved, with no assumed replenishment of prior budget.
- [ ] Formal evidence/reporting meets conformance, validity, repetition and publication gates.

## References

- [Benchmark authoring and evidence rules](../benchmarks.md).
- [V4 methodology and current equivalence caveat](../../benchmark-sets/realworld-api-v4/benchmarks/project-management-capacity/METHODOLOGY.md).
- [V4 remote-capacity plan](2026-09-29-realworld-api-v4-remote-capacity-plan.md).
- [V4 runner, telemetry, progress and resource safeguards](../../benchmark-sets/realworld-api-v4/README.md).
- [Supabase RLS/count changes and SQL regression instructions](../../benchmark-sets/realworld-api-v4/benchmarks/project-management-capacity/cases/supabase/javascript-sdk/README.md).
