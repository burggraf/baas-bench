# Bounded local conformance progress (2026-10-01)

**TrailBase native probe: partial pass, not case qualification. Supabase probe:
pending. Capacity measurement/publication remain blocked.** The user's approval
was limited to one disposable local stack at a time, 45 minutes total, 4 CPUs and
8 GiB. No cloud resources, million-row seed, comparative load, or publication.

TrailBase `0.34.2` was run from its pinned arm64 digest in an owned container
limited to 2 CPUs / 4 GiB, localhost-only port binding, and a private ephemeral
bind-mounted depot. The container was removed after the probe. No pre-existing
containers, images, volumes, stack data or credentials were mutated. Two startup
attempts failed before health (first missing required core config; second loaded
record APIs before their migration). The third bootstrapped core config, applied
the owned V5 migration, then reloaded the candidate ACL config. Health and admin
schema inspection succeeded.

A bounded native Record API smoke probe with three synthetic auth accounts
observed:

- self/peer read allowed, outsider denied;
- member project mutation and editing another author's comment denied;
- forged creator/actor denied;
- authenticated task creation generated one actor-attributed task activity;
- case-insensitive regexp search, FK/enum/nonempty rejection and app-profile-only
  update/password re-login behaved as expected;
- an acknowledged task write was readable after restarting the same container;
- a baseline reset restored the seeded profile/task/comment/role and removed the
  created task/activity.

The detailed sanitized assertion report and private logs/inventory are under the
ignored `.runtime/conformance-v5/local-20261001T154018Z/`. A follow-up installed a temporary failure trigger as an owned TrailBase
migration, confirmed the trigger existed in native `sqlite_schema`, observed the
Record API return HTTP 500, and verified both task contents and activity count
were unchanged. A later owned migration removed the trigger. This proves the
specific tested SQLite mutation rollback path; it does not expose the internal
SQLite error text through the SDK response. Successful task update, comment
create and comment update each yielded exactly one actor-attributed activity.
The native admin connection reported `journal_mode=wal`, `synchronous=1`
(`NORMAL`), and `foreign_keys=1`. The bounded docker restart reread an acknowledged
write. These are local observations for pinned TrailBase 0.34.2, not universal
power-loss guarantees. The probe did not cover every negative relationship,
page/count edge, role revocation on existing sessions, Auth reset, the full search
metacharacter corpus, or a million-row fixture identity digest.

Therefore TrailBase remains unqualified. For Supabase, the committed
`test/supabase_v5_rls_test.sql` was run against a fresh disposable local PostgreSQL
17.9 cluster with `fsync=on`, `synchronous_commit=on`, `full_page_writes=on`; both
the base PostgreSQL policy and V5 statement-scoped RLS overlay passed the same
authorization/relationship/activity SQL assertions. This is real PostgreSQL
policy/trigger evidence, **not** a Supabase Auth/PostgREST stack test, so native
API integration and acknowledged-write restart qualification remain pending.
The source-level fixes, mock tests and in-memory SQLite tests do not substitute
for those remaining gates. The next bounded step is an isolated Supabase native conformance probe within
the remaining approved window.
If the deadline is reached, stop and request fresh approval rather than extending
or silently lowering the test scope.
