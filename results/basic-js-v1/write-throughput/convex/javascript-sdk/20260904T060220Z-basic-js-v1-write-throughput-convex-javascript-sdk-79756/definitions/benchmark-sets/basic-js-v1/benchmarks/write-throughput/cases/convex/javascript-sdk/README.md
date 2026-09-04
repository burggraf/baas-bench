# Convex / JavaScript SDK write

## Endpoint or query path

The timed call is `ConvexHttpClient.mutation(api.guestbook.create, { author, message })`. The public mutation validates lengths, supplies numeric `Date.now()` and null fixture key, and returns the native ID.

## Implementation and dependencies

Node.js 22+ uses `convex@1.45.0` with generated references. Deterministic payload creation is shared. No result is published here.

## Setup and fixtures

Setup deploys functions/schema with a runtime-only admin key, imports 10,000 fixtures, records IDs, and exports a baseline ZIP. Every load restores that ZIP; readiness writes are also removed by restore. Teardown empties the table and removes case functions/schema.

## Indexes

The schema includes native ID, created-at, and fixture-key indexes shared by the three cases; no write-only index is added.

## Authentication

The mutation is intentionally public and has no auth guard. Timed clients never receive the self-hosted admin key; no update/delete function is deployed.

## Connections and pooling

One client is created per virtual user, allowing mutations across users while preserving each client's default sequential mutation queue. `skipQueue` is not used.

## Platform tuning

No retry, batch mutation, cache, queue bypass, custom transport, or platform tuning is enabled.

## Deviations from the benchmark contract

Convex supplies a native ID; the function stores server `Date.now()` as milliseconds and projects timestamps as ISO text.
