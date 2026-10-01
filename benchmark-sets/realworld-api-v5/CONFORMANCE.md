# Eight-case audit and V5 admission matrix

Audited source baseline: `0e75c15dc5e9a0797223f10054b2bb29f7932763`.
Two independent, fresh-context read-only audits covered all eight V4 cases;
parent reviewed the reported code paths. No native stacks, cloud calls or
performance runs were performed. The table records **historical V4 source**,
not V5 qualification or a platform capability ranking. Native persistence,
actual retry/refresh behavior and measured request amplification remain unknown
for every case. Unknown is not pass.

`V4` below means `benchmark-sets/realworld-api-v4/shared/`.

| Case | Search/count/order | Native security/integrity | Atomic activity | Profile/reset | V5 admission |
| --- | --- | --- | --- | --- | --- |
| Supabase | `%`-only escaping misses `_`/backslash; missing-count fallback | Self/peer and tenant RLS, insert actors/FKs/enums; direct protected-column updates need restriction | SQL transactional trigger; native API failure path untested | Auth + app profile; full app snapshot, Auth/session details not exact | Unqualified candidate; initial repairs only |
| TrailBase | Plain title filter; dropped null; physical-ID tie order; missing-count fallback and pinned empty-page count defect | Global user read, member project/comment mutation, no actor/FK/value equivalence | No trigger/activity write | App profile; created-row deletion does not restore seeded mutations | Unqualified candidate; initial repairs only |
| Neon | Window-count returns 0 beyond end; incomplete escaping | Shared SQL RLS/constraints but transport carries application-owned SQL/auth boundary | Shared transactional SQL trigger | App profile; full app/password/session reset | Excluded SQL/application-owned-auth access path, not native API comparison |
| Nhost | Aggregate counts; incomplete escaping; probable unused GraphQL-variable validation issue | Empty Hasura filters/checks/presets; client guards are bypassable; owner/BYPASSRLS behavior unknown; SQL constraints exist | Trigger exists, Hasura identity/actor resolution not proved | App profile; full app reset but native auth setup reuse/session state incomplete | Unqualified; native permissions/identity and integration repairs required |
| Convex | Literal substring; search tie order/nonzero dashboard page unresolved | Member/manager functions, but missing parent/value checks and author-only edits; client-issued JWT/plaintext shared-password auth differs | No activity insertion | App profile; table replace changes physical IDs and omits authSessions | Unqualified; integrity/activity/auth trust path must be reviewed |
| Appwrite | Fulltext search is not literal substring; dropped null; missing-total fallback | Broad table CRUD with row security disabled; client-only role/actor checks; optional strings/no FKs/enums | No activity insertion | Account name changes but application user remains stale; bulk reseed/pristine-marker behavior unproved | Unqualified; native boundary/transaction/search guarantees must be established |
| Directus | Contains + separate count; native locale/snapshot consistency and default project limit unknown | Broad native permissions; adapter guards bypassable; SQL FKs/values remain | Action hook attribution can skip; transaction/rollback/duplicates differ or unknown | App profile; full app snapshot, native auth state not exact | Unqualified; reviewed server boundary and atomic hook/trigger required |
| PocketBase | Filters one page in client, wrong case/total; seeded empty-string versus null unknown | Authenticated global collection CRUD; client guards; text relationships/no enums | No V4 activity hook | Combined auth/app profile; reimport changes native IDs/token keys | Unqualified; native rules/hooks, search and reset required |

## Cited implementation evidence

- Supabase/Neon/Nhost: `V4/lib/adapters/{supabase,neon,nhost}.mjs`,
  `V4/lib/admin/{supabase,neon,nhost,postgres}.mjs`,
  `V4/sql/{postgres-schema,supabase-rls}.sql`. Neon pagination uses
  `count(*) OVER()`; Nhost admin installs `filter:{}`, `check:{}`, empty presets.
- TrailBase: `V4/lib/adapters/trailbase.mjs` (`listTasks`, `searchTasks`, mutation
  methods); `V4/trailbase/{config.textproto,migration.sql}`; `V4/lib/admin/trailbase.mjs`
  (`reset`, auth-user reuse). Pinned upstream count behavior is independently
  visible in `trailbaseio/trailbase`, tag `v0.34.2`,
  `crates/core/src/records/list_records.rs`: an empty result returns total zero;
  `limit=0` still queries one matching record for the independent total. Its
  `crates/core/templates/update_record_access_query.sql` defines `_REQ_FIELDS_`.
- Convex: `V4/convex/{benchmark,authorize,schema,auth,setup}.ts`,
  `V4/lib/adapters/convex.mjs`, `V4/lib/admin/convex.mjs`.
- Appwrite: `V4/lib/adapters/appwrite.mjs`, `V4/lib/admin/appwrite.mjs`:
  `rowSecurity:false` and broad authenticated permissions are not tenant security.
- Directus: `V4/lib/adapters/directus.mjs`, `V4/lib/admin/directus.mjs`,
  `V4/directus/hooks/realworld-activity/index.js`, shared PostgreSQL schema.
- PocketBase: `V4/lib/adapters/pocketbase.mjs`, `V4/lib/admin/pocketbase.mjs`,
  `V4/pocketbase/migration.js`. The older `pocketbase-go/main.go` guestbook routes
  do not supply V4 task/comment activity hooks.
- Shared gate/stages: `V4/lib/{correctness,run,workflows}.mjs`. Shape checks do
  not establish known-result search, raw-native negatives, full reset or restart
  persistence; adaptive stages accumulate mutations.

## Source-level workflow amplification, not measured requests

For initialized assigned-task sessions, dashboard/list/detail/create/update/
comment/search/profile logical calls are respectively:

| Case | Dashboard | List | Detail | Create | Update | Comment | Search | Profile |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Supabase | 3 | 1 | 4 | 1 | 1 | 1 | 1 | 2 |
| TrailBase | 3 | 1 | 4 | 2 | 3 | 2 | 1 | 3 |
| Neon | 3 | 1 | 4 | 1 | 1 | 1 | 1 | 1 |
| Nhost | 2 | 2 | 5 | 2 | 2 | 2 | 1 | 1 |
| Convex | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Appwrite | 4 | 2 | 6 | 2 | 2 | 2 | 2 | 1 |
| Directus | 4 | 3 | 7 | 2 | 3 | 2 | 3 | 1 |
| PocketBase | 4 | 2 | 6 | 2 | 3 | 2 | 2 | 2 |

Unassigned details save one lookup except Convex's combined native function.
Neon uses one SQL-over-HTTP transaction with role/session/query statements per
logical data request, not three transport requests. Source counts exclude token
refresh, retries, session preparation, TLS, SDK internals and failed requests.
Sign-out/in additionally performs native/session mutations and identity/profile
reads; exact network fan-out requires native tracing. Task/comment writes add
one transactional activity in Supabase/Neon; Nhost depends on unproved identity;
Directus hook count/atomicity is unknown; others omit it. No physical row-write,
WAL/index-write or performance numbers are inferred from this table.

## Required executable evidence before admission

All cases need the same known-result searches (including escaping), exact counts
on beyond-end pages and tied-order/null fixtures; direct native self/peer/outsider,
role/author denial, spoofed actors/parents/tenants, malformed values and live
revocation; unchanged state on rejection; one attributable activity per successful
mutation and rollback under injected failure; app-profile/Auth invariance;
complete logical reset digest after seeded mutations plus new rows; durable
settings and acknowledged-write process restart. Run balanced low-load request/
write tracing only after conformance. Freeze exact versions/definitions, topology
and multicore telemetry/headroom afterward. No power-loss claim or paid capacity
attempt is implied by a process restart or this audit.

Initial V5 tests execute in-memory SQLite relationships/ACL expressions/trigger
rollback and protocol/stage/admission regressions. Native API deployment/parser,
full baseline restore, restart checks and actual measurement integration are still
pending. No case is admitted; exclusions are visible rather than low capacities.
