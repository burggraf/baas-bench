# Nhost / JavaScript SDK write

## Endpoint or query path

The timed local GraphQL mutation is `insert_bb_basic_js_v1_guestbook_one(object: $object) { id }`, executed with `nhost.graphql.request`.

## Implementation and dependencies

Node.js 22+ uses `@nhost/nhost-js@4.8.0` and explicit local URLs. Shared code creates deterministic content and validates the returned ID. No result is published here.

## Setup and fixtures

Hasura SQL/metadata APIs create the table, anonymous permissions, and 10,000 fixtures using the restricted runtime admin secret. Every load resets null fixture-key rows and verifies the baseline. Readiness and stage counts are checked outside timing. Teardown untracks then drops the table.

## Indexes

The UUID primary key, unique nullable fixture key, and sibling list-order index are present. No write-only index is added.

## Authentication

The request is unauthenticated under Hasura role `public`. It may insert `author` and `message` and read allowed fields, but cannot set fixture keys, update, delete, or administer data.

## Connections and pooling

One Nhost client is created per virtual user before timing. SDK GraphQL and prepared Nhost connection behavior remain at defaults.

## Platform tuning

No retries, bulk writes, application caching, custom transport, or platform tuning are enabled.

## Deviations from the benchmark contract

Nhost provides the native UUID and server timestamp as permitted; otherwise none.
