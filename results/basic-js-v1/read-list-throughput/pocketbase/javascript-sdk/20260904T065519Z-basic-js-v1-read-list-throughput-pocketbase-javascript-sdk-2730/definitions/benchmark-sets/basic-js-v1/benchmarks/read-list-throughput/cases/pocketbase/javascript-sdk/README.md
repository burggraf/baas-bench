# PocketBase / JavaScript SDK list read

## Endpoint or query path

The timed path calls `getList(1, 20, { sort: '-created_at', fields: 'id,author,message,created_at', skipTotal: true })` against the `bb_basic_js_v1_guestbook` Records API at `http://127.0.0.1:8090`.

## Implementation and dependencies

Node.js 22+ uses `pocketbase@0.28.0`. Shared code owns timing, deterministic inputs, response projection, and validation. No result is published here.

## Setup and fixtures

A runtime-only PocketBase superuser creates the collection and uses the superuser SQL endpoint for safely quoted sub-5,000-byte fixture inserts. Setup verifies every one of the 10,000 fixtures and stores native IDs in ignored mode-600 state. Reset removes only rows whose fixture key is null; teardown removes the case collection and runtime superuser.

## Indexes

A descending `created_at` index serves the list order. A partial unique fixture-key index supports exact lifecycle verification; fixture timestamps are unique.

## Authentication

The timed client is unauthenticated. Empty list/view/create rules permit public reads and bounded author/message creates; update and delete rules remain null, and public clients cannot provide fixture keys or timestamps.

## Connections and pooling

One client per virtual user is created before timing and kept for the stage. Each virtual user has one request in flight, so duplicate-request auto-cancellation remains at the SDK default without cross-user cancellation.

## Platform tuning

No retries, batching, application cache, custom transport, auto-cancellation override, or PocketBase-specific performance tuning is used.

## Deviations from the benchmark contract

PocketBase stores `fixture_key` as nullable JSON because its number field is not nullable. Administrative verification requires every non-null JSON fixture key to be an integer. The deviation is not exposed by timed reads.
