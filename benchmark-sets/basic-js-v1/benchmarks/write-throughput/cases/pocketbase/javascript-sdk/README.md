# PocketBase / JavaScript SDK write

## Endpoint or query path

The timed path calls `create({ author, message }, { fields: 'id' })` on `bb_basic_js_v1_guestbook` through the Records API at `http://127.0.0.1:8090`. PocketBase generates the native record ID and `created_at` value.

## Implementation and dependencies

Node.js 22+ uses `pocketbase@0.28.0`. The shared runner creates deterministic bounded content and validates the returned ID. No result is published here.

## Setup and fixtures

A case-owned runtime superuser creates the schema and loads 10,000 deterministic fixtures with safely quoted SQL chunks below the endpoint's 5,000-byte limit. Before every stage reset removes null-fixture-key writes and rechecks every baseline row. Readiness and stage verification check exact write contents and counts outside timing; teardown removes the collection and superuser.

## Indexes

PocketBase's primary key indexes native IDs. A descending timestamp index supports sibling list reads, and a partial unique fixture-key index supports exact fixture management.

## Authentication

The timed request is unauthenticated. Public create accepts only `author` and `message`; fixture-key and timestamp injection is rejected. Public update and delete rules remain null.

## Connections and pooling

One client per virtual user is created before timing and kept for the stage. A virtual user issues sequential requests, preserving default SDK duplicate-request auto-cancellation without collisions between clients.

## Platform tuning

No retry, batch API, application cache, custom transport, auto-cancellation override, or PocketBase-specific tuning is enabled.

## Deviations from the benchmark contract

PocketBase's nullable JSON fixture key is used because its numeric field cannot be null. Every non-null fixture key is administratively verified as an integer; measured writes leave it null.
