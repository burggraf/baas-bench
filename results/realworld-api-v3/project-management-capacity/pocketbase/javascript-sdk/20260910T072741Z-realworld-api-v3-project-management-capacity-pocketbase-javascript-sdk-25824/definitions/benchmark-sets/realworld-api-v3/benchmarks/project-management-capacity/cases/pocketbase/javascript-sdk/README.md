# PocketBase project-management capacity

This case runs authenticated project-management workflows through the official `pocketbase@0.28.0` JavaScript SDK on Node.js 22 or newer. Each virtual user uses an isolated PocketBase client and native auth collection token. Migration, collection rules/indexes, deterministic fixture loading, and reset are administrative.

RecordService list calls use bounded pages, stable ordering, and parameterized `pb.filter` expressions for tenant and search predicates. Mutations use the native record APIs and the adapter normalizes PocketBase timestamps and IDs into the shared contract. SDK calls are timeout-bounded because RecordService does not expose a portable abort option.
