# Directus / JavaScript SDK item

The timed path uses @directus/sdk@25.0.1 and anonymous REST at http://127.0.0.1:8055. It issues readItems (four logical fields, newest-first limit 20), readItem by the native integer ID map, or createItem with author/message. Each virtual user owns one long-lived SDK client; no authentication, retries, batching, or tuning are used in timed calls.

Directus 12 Core public access is policy-based. The virtual public policy receives basic action-wide read/create permission on this case-owned collection; field-level rules are a licensed feature and are intentionally not used. Timed SDK calls still request only the four logical fields and create only author/message. Update and delete remain denied. The collection has an auto-increment integer ID, bounded author/message strings, date-created timestamp, nullable unique integer fixture_key, and created-at index.

Administrative setup authenticates with the restricted runtime admin password, creates schema and permissions through supported APIs, loads fixtures 1 through 10,000 through PostgreSQL `COPY`, and verifies the numeric ID map. `COPY` is used because Directus's `date-created` special replaces timestamps supplied through item APIs; explicit baseline timestamps are preserved and verified. Reset removes only null-fixture benchmark writes, while generated write timestamps remain server-owned.

**Cache disclosure:** the prepared stack keeps Directus's enabled Redis API cache and auto-purge configuration. Warm-up intentionally reaches that prepared steady state; the benchmark does not disable or add a cache.
