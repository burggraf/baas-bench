# V5 project-management capacity contract

**Implementation in progress. No case, measurement profile or campaign is admitted.**

The user approved this corrected series and the material guarantees below on
2026-10-01, after confirming completed multi-core handoff at clean `0e75c15`.
V4 remains source/reference; any incomplete observations are diagnostic and are
not treated as qualified historical evidence or retrospectively certified. Format validation and mocked/SQLite tests are not
native-backend conformance evidence.

## Approved application contract

- Search is case-insensitive literal title substring matching, scoped to the
  organization/project. Matching/nonmatching, mixed case, `%`, `_`, backslash and
  regexp punctuation require known-result fixtures; do not silently reinterpret
  user text as a wildcard expression or filter one fetched page in the client.
  Native locale/Unicode behavior must be tested/disclosed before qualification.
  The native probe includes composed `Ångström 東京 Café` results queried as
  `ÅNGSTRÖM`, `東京`, and `CAFÉ`, plus a decomposed `Cafe\u0301` nonmatch; do not
  silently normalize input or titles. Record the pinned backend locale and actual
  results rather than inferring cross-platform Unicode equivalence.
- Tasks/comments/search return exact filtered totals on first, intermediate,
  empty and beyond-end pages. Ascending `(created_at, logical application ID)`
  breaks ties; dashboard activities use the descending pair. An absent total is
  a conformance error, never replaced with page length. Explicit null assignee
  means unassigned, distinct from an omitted assignee filter.
- User reads allow self and organization peers, not authenticated global reads.
  Membership authorizes tenant data; owner/admin powers manage projects and roles.
  Comment edits require author or manager. Existing sessions observe promotion,
  demotion and revocation on the next authorized operation, without cached roles.
- Native server rules bind creators/authors to authenticated identity and protect
  identity/tenant/parent fields from spoofing. Relationships must agree across
  task/project/organization and comment/task/project/organization; creators,
  assignees, authors and activity actors must belong to the referenced organization.
  Required nonempty values and existing role/status/priority enums are enforced
  server-side. Raw native API calls bypassing adapter checks must be tested.
- Every successful task/comment insert or update commits exactly one activity in
  the same transaction, including no-op updates. The activity uses the current
  authenticated actor, server timestamp, and task subject (also for comments).
  Actions retain `created`, `updated`, `commented`, `comment_updated`. Later
  dashboard reads must observe it. A rejected or injected-failure mutation leaves
  neither a partial application mutation nor an activity. A second uncoordinated
  request is not an atomic substitute.
- Profile update changes the application display name only. Auth subject,
  identity, password and Auth metadata remain unchanged; profile/task-detail
  application reads observe the change. No extra Supabase Auth write is required.
- Successful mutation acknowledgment follows commit. Document actual native
  transaction, WAL/journal, synchronous/fsync and filesystem settings without
  weakening durable defaults for speed. A bounded process-restart test must
  reread acknowledged mutations, activities and relevant Auth state. This proves
  only the tested restart behavior, not power-loss or storage-loss durability.
- Restore the complete deterministic application baseline, including modified
  seeded tasks/comments/profiles/roles/activities and removing all created rows,
  before **every** adaptive measured stage; counts alone are insufficient.
  Reestablish the declared session state and run the **same** 120-second, 50-user
  warm-up before each stage. Warm-up writes are retained within that stage only.
  Reset, verification, session preparation, restart and warm-up are outside timing.
  Failed restore/verification/warm-up prevents measurement; never silently retry.

## Retained workload and intended measurement profile

Seed 42 yields exactly 1,000,000 application records: 1,600 organizations,
16,000 users, 16,000 memberships, 8,000 projects, 160,000 tasks, 479,200 comments,
and 319,200 activities. Auth infrastructure is additional. Retain established
fixture shape, text, identities and workflow definitions; native physical IDs
need not match. Verify complete logical identity and required relationships.

Workflow weights remain dashboard 20%, task list 25%, task detail 15%, task create
10%, task update 12%, add comment 10%, search `workload` 5%, profile update 1%,
sign-out/in/profile 2%. These are workflow probabilities, not HTTP percentages.
Each synthetic user has an independent session, one workflow at a time, seeded
1–5 second think times, first-page size 1–25 and a five-second request deadline;
measured requests are not retried. Native retries/refresh defaults require audit.

Initial measured target remains 100, doubling to at most 10,000 on valid passes,
halving on valid failures until a pass exists, then at most four integer bisections.
Stages last 300 seconds, extended below five users for sample exposure. Invalid
stages stop the search and never define low-capacity bounds. A stage needs 95%
user achievement, at least 20 workflow samples per active class, read/write/
auth-search p95 ≤500/750/1000 ms, and each class error rate strictly below 1%.
`capacity_users` is workload/profile-specific, not a universal account limit.

Intended topology retains a separate same-region runner and 8-GiB dedicated-CPU
backend with identical exact plan, region, OS/architecture, storage/network and
Docker/Compose pins per comparison. A four-vCPU runner uses three workload
processes with global-user seeds, pooled raw latency samples, shared stage epoch,
serialized shard session preparation and per-worker headroom—not averaged worker
percentiles. More than 100-ms start lateness, sample loss/crash, or over 5,000,000
latency samples invalidates a stage. Five-second host/container/worker telemetry
must align to stage boundaries. Three consecutive worker/coordinator samples over
90% process CPU, 100-ms event-loop p99 or 250-ms event-loop maximum invalidate
attribution. Missing telemetry, insufficient headroom, restart during measurement,
incorrect fixtures, unfinished work or unexpected public routing invalidate it.
Private HTTPS/CA/proxy ports and all overhead must be identical or declared.
The V5 runner/runtime/lifecycle implementation and profile remain unqualified;
no V4 run script or controller is silently reused.

## Admission, tuning and evidence

Neon SQL-over-HTTP/application-owned auth is audited but excluded from native API
comparisons. Every other case is unqualified until the same mandatory native
checks pass; a missing capability is explicit exclusion, not zero capacity.
See [the eight-case matrix](../../CONFORMANCE.md). Efficient native indexes,
policies, plans and batching are allowed if behavior is preserved; equal request
counts, SQL or architecture are not required. Measure/disclose actual successful
request and server-write amplification at balanced low load before capacity tests.
Never use admin/bypass credentials, result preloads or client-only authorization.

`shared/lib/conformance.mjs` enumerates mandatory findings and stage ordering.
Its report-shape checks and injectable producer are framework regressions, not a
native check implementation or run authorization. Missing/failed/duplicate
findings block that stage helper. Whole-set CLI execution/publication remains
blocked until native probes, complete restoration, persistence, and multicore
measurement integration pass at a clean reviewed revision. Qualification must
bind exact definitions, pins, checks, topology, storage settings and case set;
stale evidence cannot admit changed definitions.

A later campaign requires fresh explicit approval for platforms, plans, region,
repetition/order, budget and maximum spend. There is no carried-forward USD $30
approval. At least three valid independent observations per admitted platform,
predeclared balanced/rotated order and fresh owned environments are intended.
Retain invalid/interrupted attempts; do not pool historical diagnostics or change
thresholds after outcomes. Publish only through `bin/bench publish` after all
conformance, measurement/provenance, transfer/checksum and cleanup gates pass.
No rankings/reporting without an approved reporting methodology.
