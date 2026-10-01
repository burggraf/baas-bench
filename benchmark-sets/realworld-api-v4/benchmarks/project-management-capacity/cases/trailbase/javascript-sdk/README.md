# TrailBase project-management capacity

This case runs authenticated project-management workflows through TrailBase's official JavaScript client and Record APIs on Node.js 22 or newer. Each virtual user receives an isolated client/auth session; SQLite migrations, record API configuration, ACLs, indexes, and deterministic fixture loading are administrative.

Record API requests use tenant filters, bounded pagination, stable ordering, and native create/read/update operations. The adapter normalizes TrailBase records into the shared task/comment/user contract and bounds SDK operations with cancellation timeouts.

TrailBase 0.34.2's Record API and native authentication are the declared access path. The remote V4 runner connects over the private VPC to a pinned Envoy TLS gateway bound only to the backend's private IPv4 address; the TrailBase HTTP port is loopback-only, and the gateway's upstream hop stays inside the Docker network. The runner trusts a per-observation CA. TLS termination and proxy overhead are part of the measured topology.
