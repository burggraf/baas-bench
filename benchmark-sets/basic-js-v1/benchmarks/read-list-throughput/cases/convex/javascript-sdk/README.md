# Convex / JavaScript SDK list read

## Endpoint or query path

The timed call is `ConvexHttpClient.query(api.guestbook.list, {})` at `http://127.0.0.1:3210`. The public query uses `by_created_at`, descending order, takes 20, and projects the four logical fields.

## Implementation and dependencies

Node.js 22+ uses `convex@1.45.0`. Committed TypeScript functions/schema deploy from the ignored runtime package. No result is published here.

## Setup and fixtures

Setup generates a self-hosted admin key into mode-600 ignored state, deploys once, imports 10,000 deterministic JSONL rows, records native IDs, and exports a baseline snapshot. Reset imports that snapshot to preserve IDs. Teardown empties the table and deploys an empty schema.

## Indexes

Convex indexes `created_at` and `fixture_key`; Convex appends its native creation-time tie-break. Native IDs serve item reads.

## Authentication

The timed function is public and has no auth guard. No admin key enters the timed client. Only the committed list/get/create functions exist.

## Connections and pooling

One `ConvexHttpClient` is created per virtual user before timing. Each user issues one sequential request; SDK defaults remain unchanged.

## Platform tuning

No retry, batching, cache, `skipQueue`, custom transport, or Convex-specific tuning is enabled.

## Deviations from the benchmark contract

Convex stores `created_at` as Unix milliseconds and returns ISO text from the function. Its index has a native creation-time tie-break.
