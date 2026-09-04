# Appwrite / JavaScript SDK item-read

## Endpoint or query path

The timed path is Appwrite TablesDB at `http://127.0.0.1:8080/v1`. The official SDK call `tables.getRow(...)` reads one deterministic pseudo-random baseline native row ID.

## Implementation and dependencies

Node.js 22+ uses `appwrite@26.2.0`. Shared code owns timing, validation, deterministic fixtures, and metrics. No result is published by this definition.

## Setup and fixtures

Setup uses the supported self-hosted Console account, session, team, project, and API-key endpoints, then `node-appwrite@28.0.0` TablesDB administration. Console and project credentials remain only in ignored mode-600 runtime state. Setup bulk-creates the first 9,980 deterministic rows, creates the final 20 individually to preserve deterministic native-timestamp ordering, and stores all native IDs. Teardown removes only the case-owned project, team, and Console account.

## Indexes

Appwrite's native row ID and creation timestamp fields provide newest-first reads. A unique nullable `fixture_key` index supports baseline identity and lifecycle verification.

## Authentication

The timed SDK client supplies the project ID but no API key or user session. Table permissions allow any client to read and create rows; row security is disabled. Administrative credentials are unavailable to the timed client.

## Connections and pooling

There is one client per virtual user. The official SDK's default fetch transport is retained.

## Platform tuning

No retry, batching in the timed path, application cache, transport replacement, or platform-specific performance tuning is enabled. Setup alone uses the native bulk row API for fixture loading.

## Deviations from the benchmark contract

Appwrite uses native `$createdAt` values rather than the shared deterministic fixture timestamps; this is the approved platform-required timestamp deviation. Its native TablesDB IDs, permissions, and SDK implementation otherwise preserve the benchmark's fixture and response semantics.
