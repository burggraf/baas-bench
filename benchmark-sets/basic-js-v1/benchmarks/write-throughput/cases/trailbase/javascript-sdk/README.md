# TrailBase / JavaScript SDK create

## Endpoint or query path

The timed path calls `records("bb_basic_js_v1_guestbook").create({ author, message })` at `http://127.0.0.1:4000` and validates the scalar server-generated integer ID.

## Implementation and dependencies

Node.js 22+ uses the official `trailbase@0.14.1` package with `initClient` against the repository-pinned TrailBase 0.33.10 server. Shared code owns timing, deterministic input selection, logical normalization, and validation. No result is published here.

## Setup and fixtures

A fixed committed migration creates the case-owned STRICT SQLite table. Setup appends only the committed Record API fragment to the existing depot configuration, preserving unrelated settings, then uses the authenticated admin query API to insert and verify all 10,000 fixtures and write a mode-600 native-ID map. Reset deletes only rows with null fixture keys. Teardown uses TrailBase's supported table-delete API, which records the drop and removes the Record API configuration, then removes the case's runtime credential copy. The immutable committed create migration remains in the depot because TrailBase rejects an applied migration missing from the filesystem.

## Indexes

A descending `created_at` index serves newest-first list reads. The nullable unique integer `fixture_key` constraint protects the deterministic baseline and supports exact reset verification.

## Authentication

The timed client is unauthenticated. The world ACL grants only READ and CREATE, excludes `fixture_key`, and rejects a supplied `created_at`. No world schema, update, or delete permission exists. TrailBase 0.33.10's user CLI cannot modify the initialized depot while the server owns it. Administration therefore reuses the environment's first-boot administrator, captures its already server-logged credentials once into ignored mode-600 environment state without printing them, and keeps only a runtime copy for the case.

## Connections and pooling

One long-lived client per virtual user is created before timing. Each virtual user issues one request at a time through the SDK's default transport.

## Platform tuning

No retries, batching, application cache, custom transport, or TrailBase-specific performance tuning is used. Migration, configuration reload, readiness, reset, and verification remain outside timing.

## Deviations from the benchmark contract

None. TrailBase generates the integer ID and UTC text timestamp on the server.
