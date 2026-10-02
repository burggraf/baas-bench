# Local conformance progress (2026-10-01)

**Status:** bounded native-stack probes passed for Supabase and TrailBase on synthetic fixtures. Neither candidate is qualified. V5 run and publication guards remain in place. Declared-scale local fixture/reset checks completed on the pinned source/runtime. No capacity campaign, comparative result, or publication has been performed or authorized.

## Authorization and spend

The user authorized further local conformance testing without per-test approval and Linode testing only within a strict **$2.00 additional-usage cap** starting 2026-10-01 16:34 UTC. No Linode resources were used; tracked Linode spend remains **$0.00**. The user subsequently authorized declared-scale local conformance: 1,000,000 application records and 16,000 native Auth accounts per backend, one disposable stack at a time. Testing approval does not authorize comparative capacity campaigns or publication.

## Supabase native stack

A private, isolated Compose project used the V5-pinned Supabase source revision `e693f206f5050b0004a86e12e533bb75ba2a9c76`, localhost API/DB bindings, regenerated local secrets, a unique Compose project, and a fresh disposable database. The pinned stack included Postgres 17.6.1.136, GoTrue 2.196.0, PostgREST 14.17, Realtime 2.134.10, Storage 1.74.0, and the pinned Envoy digest. An early attempt copied an existing Postgres data directory with credentials from its original stack; it failed authentication. That private copy was removed before the passing fresh-database run; the original runtime was not changed.

The latest sanitized report is `.runtime/conformance-v5/local-20261001T1634Z/supabase-probe.json`. On four synthetic Auth users and a two-tenant fixture, the probe passed checks for:

- baseline and optimized PostgreSQL RLS/trigger SQL;
- native Auth sign-in and self/peer versus outsider visibility;
- literal search (including `%`, `_`, and backslash), exact counts, null filters, and empty beyond-end pages;
- manager-only project writes, comment authorship, forged actors, and cross-tenant relationships;
- V5 adapter task creation/activity, live manager promotion and revocation on the same JWT, and application-only profile changes with unchanged Auth metadata and password;
- an injected activity-trigger failure rolling back both the adapter mutation and activity;
- acknowledged data surviving a bounded Postgres-container restart; and
- restoration of the synthetic app/Auth baseline, including row counts, profile values, roles, assignee, comments, and empty activity state.

The observed database settings were `fsync=on`, `synchronous_commit=on`, `full_page_writes=on`, and `wal_level=logical`. This proves visibility after a process restart for this local stack, not power-loss durability. The SQL-policy test ran in a separate temporary database that was dropped afterward. The Compose project and its owned containers/volumes are removed after the probe.

The native run exposed one adapter mismatch: PostgREST returns `PGRST103`/HTTP 416 for a page starting beyond the last row, rather than an empty page. The Supabase adapter now retries that uncommon case with an exact-count HEAD request and returns the contract's empty page/count. A regression test covers task, comment, and search pagination.

## TrailBase native probe

A fresh isolated TrailBase 0.34.2 stack used the pinned image digest, localhost-only binding, a private ephemeral depot, the V5 migration and ACL config, and four synthetic Auth users across two tenants. The private test-only activity-failure trigger was installed through a separate migration before Record APIs loaded; no external SQLite writer or existing runtime was used.

The latest sanitized report, `.runtime/conformance-v5/local-20261001T1740Z/trailbase/trailbase-probe.json`, records **10 passing assertions**: native self/peer reads and outsider row filtering; literal search with `%`, `_`, backslash, brackets, and regex punctuation; exact-count/null-filter/empty beyond-end pagination; denied member project and another-author comment edits; actor binding, cross-tenant rejection, and actor-attributed activity; live role promotion/revocation on the same session; application-only profile change with preserved Auth email/password and successful re-login; failure-trigger rollback of both task and activity; acknowledged write visibility after a bounded process restart; and exact restoration of the small app/Auth fixture, including role, profile, task, assignee, comment, and activity state. Settings were `journal_mode=wal`, `synchronous=1` (`NORMAL`), and `foreign_keys=1`. This is process-restart evidence only, not power-loss durability.

The earlier partial probe and its inventory remain under `.runtime/conformance-v5/local-20261001T154018Z/`; the latest private probe artifacts are under `.runtime/conformance-v5/local-20261001T1740Z/trailbase/`. These small synthetic fixtures do not establish full Auth-account teardown, million-record identity/reset conformance, or the repeated runner reset/warm-up lifecycle. TrailBase remains unqualified.

Fresh synthetic native probes at pinned-source commit `8d9cc4013706a046a15a7a6a036bc48677f16202` passed implemented checks on both backends, including the newly added live membership-removal, protected identity-field, and valid-write-control assertions. Both probes recorded Node 22.23.1, clean source, no mid-run changes, and successful cleanup. Their overall conformance reports correctly remain false because declared-scale-only `fixture-integrity` and `reset-baseline` checks are intentionally absent from synthetic mode. Reports: `.runtime/conformance-v5/trailbase-VhR8W1/report.json` and `.runtime/conformance-v5/supabase-2odFao/report.json`.

## Repeatable procedure work

The shared known-result native assertions and both disposable procedures are
documented in [NATIVE-CONFORMANCE.md](NATIVE-CONFORMANCE.md). Both procedures
were run locally: each passed the same **13 implemented mandatory findings** on
the same four-user/two-tenant fixture; `fixture-integrity` and `reset-baseline`
remain explicitly failed/missing, so each overall conformance report is false.
The reports are `.runtime/conformance-v5/trailbase-37jHqH/report.json` and
`.runtime/conformance-v5/supabase-CV5TVX/report.json`. Owned containers, volumes
and depots/source/config were removed after both passing probes. Linode spend
remains $0.00. Successful synthetic assertions do not remove either hard guard.

## Declared-scale local conformance (not measurement)

The first owned TrailBase attempt, `.runtime/conformance-v5/trailbase-7JRCNT/`,
confirmed 1,000,000 seeded application records and 16,000 native Auth accounts,
then reached its first reset. Its administrative query hit the harness's
30-second timeout; the reset result is unconfirmed, not a capacity or backend
eligibility finding. Its container/depot were removed. A fresh retry uses a
bounded three-minute administrative query deadline, without changing measured
API deadlines. Its private `progress.json` records confirmed counts and phases.
The pinned-Node retry, `.runtime/conformance-v5/trailbase-mjn3KM/`, passed
fixture digests and native identity mapping for all 1,000,000 application records
and 16,000 native Auth accounts, then passed both complete mutation/reset cycles.
Each cycle restored application and native Auth digests, rejected the ended refresh
session, and passed fresh login. Provenance records clean source commit
`abf60168f4aa91dd3e0b4adddeeca6c86c6e3225`, Node 22.23.1, the pinned TrailBase
image, and no mid-run source changes. Owned container/depot cleanup succeeded.
This supersedes earlier timeout and controller-session attempts; reports are not
pooled. It proves declared-scale fixture/reset behavior only. Native membership
revocation, remaining adversarial cases, restart and measurement lifecycle remain
gates.

Supabase declared-scale testing started only after confirmed TrailBase cleanup.
The pinned-Node run `.runtime/conformance-v5/supabase-7MLB99/` passed fixture
digests and Auth identity mapping for 1,000,000 application records and 16,000
native Auth accounts, followed by both full mutation/reset cycles. Each cycle
restored app/Auth digests, invalidated refresh sessions and passed fresh login.
Provenance records clean source commit `abf60168f4aa91dd3e0b4adddeeca6c86c6e3225`,
Node 22.23.1, and no mid-run source changes. The transactional TRUNCATE reset
completed within its bounded administrative deadline. Owned Compose resources and
private configuration were removed. The previous Node 26 attempt's failure is
superseded; reports are not pooled. This establishes declared-scale fixture/reset
behavior only, not benchmark measurement, capacity, durability after power loss,
or qualification. Identical warm-up and the measurement lifecycle remain
separate gates.

## Three-worker native timed diagnostics (not qualification)

Both disposable backends completed the new `--local-timed-stage` mode on the
same frozen, clean source revision `3f0702496a4f92ef80739238f88fb9e2d84827c9`
with exact Node 22.23.1, matching source-manifest SHA-256
`e896e964c97357e3b9450d5eb8f30e4bfe6d3fdf1b7e9693ca24c0d63400fa61`, no
source edits during the run, and owned-stack cleanup confirmed. TrailBase ran
first, then Supabase. Private reports:

- TrailBase: `.runtime/conformance-v5/trailbase-w1H0Mm/report.json`
- Supabase: `.runtime/conformance-v5/supabase-D9ltIU/report.json`

Each backend completed two 300-second windows with all 50 actors achieved,
restored application/Auth baseline before each cycle, retained warm-up writes,
and recorded zero failed workflow/native-operation samples. The pooled delivered
sample totals were 32,854 for TrailBase and 28,285 for Supabase. A stricter
post-run review now requires all 60 scheduled five-second samples for each
300-second stage: TrailBase cycle 2 had only 59 samples on each worker and must
be invalidated. Supabase workers had 60 in both cycles. The initial diagnostic
reports did not retain the coordinator's raw sample series, so that series cannot
be independently rechecked; the current runner now preserves it. These are private
reduced-fixture diagnostic counts, **not** throughput/latency results, a ranking,
or admission evidence. No Linux backend-host/container telemetry was available
from this macOS Docker Desktop run: backend telemetry is explicitly invalid/missing.
The reports retain `admission_evidence: false` and `measurement_qualified: false`;
both CLI guards remain unchanged. No Linode
resources were provisioned and no comparative/publication authorization was used.

## Expanded native integrity and Unicode probes

After commit `d691343de5730e00d8eb0c12ea6f721c94cb6ae0`, both existing small
synthetic native probes were rerun sequentially under exact Node 22.23.1 from a
clean source tree. Their manifest SHA-256 was
`05452531168ed185e1781a219616b65bcec271eff54f936d498718b476b3dda0`.

- TrailBase: `.runtime/conformance-v5/trailbase-OFDcfW/report.json`
- Supabase: `.runtime/conformance-v5/supabase-ctxZPi/report.json`

Both reported `local_checks_passed: true` and owned cleanup success. The expanded
raw-write tests passed valid task/comment controls plus malformed value and
cross-tenant relationship rejection without partial application/activity rows.
Search passed composed-accent upper-case matches, CJK literal matching, and the
decomposed canonical-sequence nonmatch. The synthetic report correctly keeps
`fixture-integrity` and `reset-baseline` false/missing, so these probes remain
unqualified and do not replace declared-scale or reset evidence. Observed settings
remain TrailBase WAL/synchronous=1/foreign keys enabled and Supabase
fsync/synchronous-commit/full-page-writes on; process-restart results are not
power-loss durability. The TrailBase restart check emitted a transient connection
refusal while its owned process restarted, then passed the bounded readiness and
reread assertions. Reports retain `qualified: false`; no V5 CLI guard changed.

## Remaining gates

- Promote the private native probes into maintainable committed conformance procedures and bind their verified evidence to V5 run admission/publication. Current private reports and mocked/in-memory tests are not admission evidence.
- Expand native conformance to remaining value/relationship corpus and determine which findings must also be repeated at declared scale.
- Decide eligibility for the other audited cases; exclude any that cannot meet the shared contract.
- Qualify the corrected runner, repeated baseline/reset/warm-up lifecycle, and measurement profile before enabling any V5 benchmark execution.

No comparative capacity campaign or publication is allowed by the current testing authorization. Keep both V5 hard guards until all required gates are independently satisfied.
