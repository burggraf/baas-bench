# Supabase project-management capacity

This case runs authenticated project-management workflows through `@supabase/supabase-js@2.117.2` on Node.js 22 or newer. Each virtual user uses an isolated Supabase client with native email/password Auth; PostgreSQL schema, RLS policies, indexes, deterministic fixture loading, and reset are administrative.

Measured operations use Auth and PostgREST only. Tenant predicates, stable ordering, filters, exact pagination counts, mutations, activity triggers, profile updates, refresh, sign-out, request cancellation, and timeout handling are normalized by the adapter into the shared workflow contract.

## Read and RLS efficiency

Exact totals are requested only for paginated tasks, comments, and search results. Dashboard, identity mapping, user lookup, and single-task reads do not request unused counts; pagination still returns exact totals and `hasNext`.

Setup applies `shared/sql/supabase-rls.sql` after the common PostgreSQL schema. This Supabase-only overlay uses uncorrelated authorized-organization subqueries and scalar identity subqueries instead of repeated per-row identity/membership checks. Tasks and comments authorize their stored organization IDs; the existing composite foreign keys prevent forged task/project/tenant relationships. Self/peer user visibility, owner/admin restrictions, author/creator checks, activity triggers, and all constraints remain in force. Memberships come from the database on each statement, not stale JWT tenant/role claims. Other PostgreSQL cases and V3 are unchanged.

Regression checks: `node --test test/realworld_api_v4_test.mjs`; for actual SQL authorization checks, run `psql -X -v ON_ERROR_STOP=1 -d disposable_db -f test/supabase_v4_rls_test.sql` as the superuser of a **fresh disposable local database**. The SQL check exercises identical read/write/denial, relationship-forgery, activity, and role-change expectations before and after the overlay; it must never run against a benchmark or production database.

Historical runs retain their archived definitions. These implementation changes require fresh observations; they do not revise old capacity evidence or establish a performance gain by themselves. See the methodology's implementation-equivalence caveat before comparing Supabase with TrailBase.

The backend's native Envoy gateway exposes a per-observation CA-signed HTTPS listener on its VPC address. The HTTP listener is loopback-only; the runner receives only the CA certificate and Supabase publishable key.


Fixture loading keeps 1,000-row COPY boundaries and ordering, but streams them through one psql process over one setup SSH session; batch-completion markers distinguish confirmed COPYs from input merely produced. The session closes before verification and measurement—there is no persistent benchmark tunnel.

V4 remote setup requires `BAAS_BENCH_V4_SSH_CONFIG` from the observation's private SSH state. Controller probes, orchestration, and rsync use it explicitly; the runner's Docker/host SSH probes use a separate strict config and backend pin in its private V4 runtime. No global known-hosts or identity file is overwritten. See the set README for manual setup and the first-contact TOFU boundary.
