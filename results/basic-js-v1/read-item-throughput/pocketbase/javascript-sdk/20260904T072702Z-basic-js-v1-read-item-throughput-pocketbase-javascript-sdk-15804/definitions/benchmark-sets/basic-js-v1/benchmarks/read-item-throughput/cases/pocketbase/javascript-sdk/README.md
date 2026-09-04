# PocketBase / JavaScript SDK item read

## Endpoint or query path

The timed path calls `getOne(id, { fields: 'id,author,message,created_at' })` on `bb_basic_js_v1_guestbook` at `http://127.0.0.1:8090`. The shared selector obtains the native record ID from the deterministic runtime map.

## Implementation and dependencies

Node.js 22+ uses `pocketbase@0.28.0`. Shared code owns timing, deterministic item selection, normalization, and validation. No result is published here.

## Setup and fixtures

A runtime-only superuser creates the collection, loads safely quoted fixture INSERTs through the size-limited SQL endpoint, verifies all 10,000 fixtures, and writes the native ID map with mode 0600 under ignored runtime state. Reset removes measured writes; teardown deletes only the case collection and superuser.

## Indexes

The measured lookup uses PocketBase's native record primary key. A descending timestamp index and partial unique fixture-key index serve the sibling benchmark and exact lifecycle checks.

## Authentication

The timed client is unauthenticated. Public list/view/create rules expose only the intended guestbook behavior. Update and delete rules are null, and public creates cannot set fixture keys or timestamps.

## Connections and pooling

One client per virtual user is created outside timing and kept for the stage. Sequential per-VU requests preserve the SDK's default duplicate-request auto-cancellation safely.

## Platform tuning

No retries, batches, custom fetch, application cache, auto-cancellation override, or platform-specific tuning is added.

## Deviations from the benchmark contract

The nullable JSON fixture key is not a database integer field because PocketBase numbers are not nullable. Setup and every stage verify that all non-null JSON values are integers.
