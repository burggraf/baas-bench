# Nhost / JavaScript SDK list read

## Endpoint or query path

The timed path is Nhost GraphQL at `http://local.graphql.local.nhost.run/v1/graphql`. `nhost.graphql.request` selects four logical fields, orders by `created_at` descending, and limits to 20. The deterministic fixture timestamps are unique, so no hidden administrative field is exposed for a tie-break.

## Implementation and dependencies

Node.js 22+ uses `@nhost/nhost-js@4.8.0` with explicit local service URLs. Shared code owns timing and validation. No result is published here.

## Setup and fixtures

The Hasura `pg_run_sql` and metadata APIs create and track the case table, permissions, indexes, and 10,000 deterministic fixtures. The admin secret is read from restricted runtime data and sent only as an HTTP header. Native UUIDs are saved in ignored mode-600 state. Reset verifies the read-only baseline; teardown untracks and drops the table.

## Indexes

`(created_at DESC, fixture_key DESC)` serves list order, the UUID primary key serves item reads, and a unique nullable fixture key supports lifecycle management.

## Authentication

No user signs in. Hasura role `public` can select and insert allowed columns only; update, delete, and administration remain unavailable.

## Connections and pooling

There is one Nhost client per virtual user. The SDK GraphQL fetch behavior and prepared Nhost/Hasura topology are unchanged.

## Platform tuning

No retry, batch, application cache, custom transport, or platform-specific tuning is added.

## Deviations from the benchmark contract

None beyond Nhost's GraphQL/Hasura implementation and native UUIDs.
