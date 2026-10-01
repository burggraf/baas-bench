# Local conformance progress (2026-10-01)

**Status:** bounded native-stack probes passed for Supabase and TrailBase on synthetic fixtures. Neither candidate is qualified. V5 run and publication guards remain in place. No million-record seed, capacity campaign, comparative result, or publication has been performed or authorized.

## Authorization and spend

The user authorized further local conformance testing without per-test approval and Linode testing only within a strict **$2.00 additional-usage cap** starting 2026-10-01 16:34 UTC. No Linode resources were used; tracked Linode spend remains **$0.00**. Testing approval does not authorize comparative capacity campaigns or publication.

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

## Remaining gates

- Promote the private native probes into maintainable committed conformance procedures and bind their verified evidence to V5 run admission/publication. Current private reports and mocked/in-memory tests are not admission evidence.
- Complete TrailBase and Supabase adversarial, reset/session, and fixture-integrity coverage at the declared dataset scale.
- Decide eligibility for the other audited cases; exclude any that cannot meet the shared contract.
- Qualify the corrected runner, repeated baseline/reset/warm-up lifecycle, and measurement profile before enabling any V5 benchmark execution.

No comparative capacity campaign or publication is allowed by the current testing authorization. Keep both V5 hard guards until all required gates are independently satisfied.
