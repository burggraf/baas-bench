# Neon project-management capacity

This case is the lifecycle scaffold for the project-management capacity workload through Neon's official SQL-over-HTTP proxy using `@neondatabase/serverless@1.1.0` on Node.js 22 or newer. The five hooks delegate to the set-level dispatcher; workload, administration, fixture, correctness, and telemetry behavior is intentionally deferred.

Unlike the other cases, this is an HTTP SQL transport rather than a complete BaaS data/auth API. It will use application-owned PostgreSQL authentication and tenant-authorization functions, so comparisons must identify this material deviation.

No benchmark result can be produced by this scaffold. Platform-specific topology, indexes, tuning, and further deviations must be documented when the adapter is implemented.
