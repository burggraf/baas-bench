# Supabase / JavaScript SDK item read

## Endpoint or query path

The timed path is PostgREST at `http://127.0.0.1:8000`, called with `.select('id,author,message,created_at').eq('id', nativeId).single()` on `bb_basic_js_v1_guestbook`.

## Implementation and dependencies

Node.js 22+ uses `@supabase/supabase-js@2.115.0`. The shared runner selects deterministic fixture IDs and validates exact logical records. No result is published by this definition.

## Setup and fixtures

Administrative SQL runs through `bin/baas compose supabase exec -T db psql`. Setup creates the table, loads and verifies 10,000 fixtures, and writes their native UUID map to ignored mode-600 runtime state. Read resets verify the baseline; teardown drops only the case table.

## Indexes

The measured lookup uses the UUID primary-key index. The schema also has a unique nullable fixture-key constraint and the equivalent sibling list-order index.

## Authentication

The generated publishable key is used without sign-in. RLS and grants allow anonymous select/create only, with no public update, delete, schema, or administrative access.

## Connections and pooling

One normally configured client is created per virtual user outside timing. SDK fetch and PostgREST connection reuse remain at defaults; unauthenticated session persistence/refresh are disabled.

## Platform tuning

No retries, batching, application cache, custom transport, or Supabase-specific performance tuning are added.

## Deviations from the benchmark contract

None beyond native UUIDs and the PostgREST/RLS implementation. The timed read uses the required native primary-key path.
