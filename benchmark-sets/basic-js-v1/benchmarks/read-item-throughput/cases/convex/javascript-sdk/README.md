# Convex / JavaScript SDK item read

## Endpoint or query path

The timed call is `ConvexHttpClient.query(api.guestbook.get, { id })` against the public function at `http://127.0.0.1:3210`. The function uses `ctx.db.get` and projects four fields.

## Implementation and dependencies

Node.js 22+ uses `convex@1.45.0` and generated function references. Shared code selects fixture IDs deterministically. No result is published here.

## Setup and fixtures

The admin CLI key remains in mode-600 ignored state. Setup deploys schema/functions, imports 10,000 JSONL fixtures, records native IDs, and exports a pristine snapshot. Snapshot reset preserves IDs; teardown clears the case table and functions/schema.

## Indexes

The measured path is Convex's native ID lookup. The schema also includes indexes for sibling list ordering and fixture management.

## Authentication

The timed query is public and unauthenticated. The administration key is available only to untimed CLI subprocesses.

## Connections and pooling

There is one long-lived `ConvexHttpClient` per virtual user. Normal HTTP-client behavior is retained.

## Platform tuning

No retries, batching, application cache, queue override, or performance tuning are added.

## Deviations from the benchmark contract

`created_at` is stored numerically and projected as ISO text; IDs are Convex-native.
