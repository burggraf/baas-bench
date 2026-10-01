# Supabase JavaScript SDK — V5 candidate

**Unqualified; execution and publication are blocked.** Native Auth remains the
identity boundary; ordinary authenticated PostgREST requests perform application
operations. Administration is outside measurement; no bypass-RLS measured path.

The existing statement-scoped RLS overlay and composite relationship constraints
are retained. Updates are restricted to application mutation columns, preventing
Auth/tenant/creator/author rebinding. Activity writes remain database-triggered,
transactional and server-attributed; clients cannot write activity rows directly.
Profile changes update `users.display_name` only, not Auth metadata. Search escapes
backslash, percent and underscore for literal `ILIKE`; required pagination totals
must be present and exact. Dashboard queries do not request unused totals.

Native deployment/column grants, adversarial search, profile Auth invariance,
complete reset, failure injection, acknowledged-write persistence after process
restart, actual request/write amplification and runner qualification remain to
be proved. The copied SQL is a candidate, not a deployed/certified database.
SDK/upstream pins are in the set package lock and `versions.env`; TLS/proxy,
storage/durability, hardware and SDK retry behavior must be recorded before admission.
