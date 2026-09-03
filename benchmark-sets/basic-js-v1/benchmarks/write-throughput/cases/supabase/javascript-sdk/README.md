# Supabase / JavaScript SDK write

## Endpoint or query path

The timed PostgREST call at `http://127.0.0.1:8000` is `.insert({ author, message }).select('id').single()` on `bb_basic_js_v1_guestbook`.

## Implementation and dependencies

Node.js 22+ uses `@supabase/supabase-js@2.115.0`. The shared runner creates deterministic unique content and accepts only a non-empty returned ID. No result is published by this definition.

## Setup and fixtures

SQL administration uses `bin/baas compose supabase exec -T db psql`. Setup creates policies and 10,000 fixtures. Before every load, reset deletes rows whose `fixture_key` is null and verifies the baseline. Readiness and stage checks verify created data/counts outside timing. Teardown drops the case-owned table.

## Indexes

The table has a UUID primary key, unique nullable fixture key, and the sibling benchmark's `(created_at DESC, fixture_key DESC)` index. No write-specific index is added.

## Authentication

The publishable key is used without a user session. Anonymous RLS permits selecting and inserting allowed columns only; update, delete, fixture-key insertion, and administration remain denied.

## Connections and pooling

There is one client per virtual user, created before timing. The default SDK fetch transport and PostgREST behavior are unchanged; auth persistence and refresh are disabled for the unauthenticated workload.

## Platform tuning

There are no retries, bulk writes, application caches, custom transports, or platform-specific tuning.

## Deviations from the benchmark contract

Supabase supplies a server-generated UUID and `now()` timestamp as permitted. Otherwise the logical write contract is unchanged.
