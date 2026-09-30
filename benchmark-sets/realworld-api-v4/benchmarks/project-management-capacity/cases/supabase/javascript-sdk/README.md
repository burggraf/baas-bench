# Supabase project-management capacity

This case runs authenticated project-management workflows through `@supabase/supabase-js@2.117.2` on Node.js 22 or newer. Each virtual user uses an isolated Supabase client with native email/password Auth; PostgreSQL schema, RLS policies, indexes, deterministic fixture loading, and reset are administrative.

Measured operations use Auth and PostgREST only. Tenant predicates, stable ordering, filters, exact pagination counts, mutations, activity triggers, profile updates, refresh, sign-out, request cancellation, and timeout handling are normalized by the adapter into the shared workflow contract.

The backend's native Envoy gateway exposes a per-observation CA-signed HTTPS listener on its VPC address. The HTTP listener is loopback-only; the runner receives only the CA certificate and Supabase publishable key.


V4 remote setup requires `BAAS_BENCH_V4_SSH_CONFIG` from the observation's private SSH state. Controller probes, orchestration, and rsync use it explicitly; the runner's Docker/host SSH probes use a separate strict config and backend pin in its private V4 runtime. No global known-hosts or identity file is overwritten. See the set README for manual setup and the first-contact TOFU boundary.
