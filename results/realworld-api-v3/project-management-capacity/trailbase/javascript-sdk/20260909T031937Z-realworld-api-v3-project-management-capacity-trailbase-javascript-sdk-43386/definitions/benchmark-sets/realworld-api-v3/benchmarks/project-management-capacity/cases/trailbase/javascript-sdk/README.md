# TrailBase project-management capacity

This case runs authenticated project-management workflows through TrailBase's official JavaScript client and Record APIs on Node.js 22 or newer. Each virtual user receives an isolated client/auth session; SQLite migrations, record API configuration, ACLs, indexes, and deterministic fixture loading are administrative.

Record API requests use tenant filters, bounded pagination, stable ordering, and native create/read/update operations. The adapter normalizes TrailBase records into the shared task/comment/user contract and bounds SDK operations with cancellation timeouts.

TrailBase's Record API and native authentication are the declared access path for this case.
