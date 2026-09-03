# Supabase / JavaScript SDK list read

## Endpoint or query path

The timed path is PostgREST at `http://127.0.0.1:8000`, called with `supabase.from('bb_basic_js_v1_guestbook').select('id,author,message,created_at').order('created_at', { ascending: false }).limit(20)`.

## Implementation and dependencies

Node.js 22+ uses `@supabase/supabase-js@2.115.0`. Shared code owns timing, validation, deterministic fixtures, and metrics. No result is published by this definition.

## Setup and fixtures

Administrative SQL runs only through `bin/baas compose supabase exec -T db psql`. Setup creates the case-owned table and policies, streams 10,000 deterministic CSV fixtures, verifies them, and stores native UUIDs in ignored mode-600 runtime state. Reset verifies the unchanged baseline; teardown drops only the case table.

## Indexes

The UUID primary key is native. A unique nullable `fixture_key` constraint supports lifecycle management, and `(created_at DESC, fixture_key DESC)` supports newest-first reads.

## Authentication

The client uses the generated Supabase publishable key without a user session. RLS and column grants permit anonymous select and insert only; update, delete, and administration are unavailable.

## Connections and pooling

There is one client per virtual user. Supabase's default fetch transport and PostgREST connection behavior are retained; authentication persistence and refresh are disabled because the workload is unauthenticated.

## Platform tuning

No retry, batching, application cache, transport replacement, or platform-specific performance tuning is enabled.

## Deviations from the benchmark contract

None beyond Supabase's native UUID and PostgREST/RLS implementation. Fixture and timestamp semantics match the benchmark contract.
