# Supabase project-management capacity

This case runs authenticated project-management workflows through `@supabase/supabase-js@2.115.0` on Node.js 22 or newer. Each virtual user uses an isolated Supabase client with native email/password Auth; PostgreSQL schema, RLS policies, indexes, deterministic fixture loading, and reset are administrative.

Measured operations use Auth and PostgREST only. Tenant predicates, stable ordering, filters, exact pagination counts, mutations, activity triggers, profile updates, refresh, sign-out, request cancellation, and timeout handling are normalized by the adapter into the shared workflow contract.
