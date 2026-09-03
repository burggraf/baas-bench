# Nhost / JavaScript SDK item read

## Endpoint or query path

The timed path calls `nhost.graphql.request` against local Hasura with `bb_basic_js_v1_guestbook_by_pk(id: $id)` and selects only `id`, `author`, `message`, and `created_at`.

## Implementation and dependencies

Node.js 22+ and `@nhost/nhost-js@4.8.0` use explicit local service URLs. The shared runner selects the native ID deterministically. No result is published here.

## Setup and fixtures

Hasura administrative APIs create/track the table, apply permissions, and insert 10,000 fixtures. The restricted admin secret never enters argv or output. Setup stores UUIDs in ignored mode-600 runtime state. Reset verifies the baseline; teardown untracks and drops only the case table.

## Indexes

The measured lookup uses the UUID primary key. Fixture management and sibling list ordering use the equivalent unique fixture-key and descending timestamp indexes.

## Authentication

The timed client is unauthenticated and receives Hasura's `public` role. Public select/create are allowed; update, delete, schema, and administration are denied.

## Connections and pooling

One long-lived Nhost client is created per virtual user. Normal SDK GraphQL transport and prepared service defaults remain enabled.

## Platform tuning

No retries, batching, caching, transport replacement, or Nhost-specific performance tuning are used.

## Deviations from the benchmark contract

None beyond native UUID and Hasura GraphQL mappings.
