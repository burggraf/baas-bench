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
ignored `.runtime/conformance-v5/local-20261001T154018Z/`. The report records a
successful check labeled “activity trigger failure rolls back task update”; this
is **not accepted as sufficient failure-injection proof yet** because the probe
caught any request rejection, did not assert the injected database error reason,
and did not verify that its temporary failure trigger had been loaded. Likewise,
PRAGMA queries returned but their values were not recorded; persistence defaults
are not yet documented. The probe did not cover every negative relationship,
page/count edge, mutation type, role revocation on existing sessions, Auth reset,
search metacharacter corpus, or full fixture identity digest.

Therefore TrailBase remains unqualified. Supabase remains untested against a
native local stack. The source-level fixes, mock tests and in-memory SQLite tests
do not substitute for those gates. The next bounded step is to strengthen and
repeat TrailBase failure-injection/persistence evidence, then attempt a separately
isolated Supabase native conformance probe within the remaining approved window.
If the deadline is reached, stop and request fresh approval rather than extending
or silently lowering the test scope.
