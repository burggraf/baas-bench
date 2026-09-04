# Project-management capacity methodology

## Scope

The benchmark will measure the highest contiguous concurrent-user stage that satisfies the defined service-level objectives for an authenticated project-management workload. It is not a universal platform, cost, hosted-service, realtime, storage, or geographic-latency ranking.

## Lifecycle contract

One framework trial owns the complete capacity observation. The shared runner will warm up internally, execute staged loads, double to find a bound, and refine that bound. Framework warm-up trials are disabled so reset cannot discard warm-up writes. Setup, deterministic million-record seeding, correctness verification, session preparation, and cleanup are outside timing.

## Workload and capacity

Virtual users execute complete dashboard, task-list, task-detail, create-task, update-task, add-comment, search, profile-update, and sign-out/sign-in workflows with deterministic selection and think time. Capacity is the highest contiguous passing user stage. A passing stage must achieve at least 95% of requested users, include at least 20 samples in each active class, keep read/write/auth-search p95 latency at or below 500/750/1000 ms, and keep each class error rate below 1%.

## Metrics and evidence

The numeric primary metric is `capacity_users`. Required supporting metrics record achieved users, workflow throughput, physical call throughput and amplification, plus p95 latency and error rate for read, write, and auth/search classes. The later runner implementation must retain the complete load curve and bounded diagnostics locally and emit the framework summary contract.

## Fairness and access paths

No application cache, retries, timed bulk operations, or platform-specific performance shortcuts are permitted. Native SDK and platform defaults remain in scope. Neon uses the official SQL-over-HTTP driver/proxy with application-owned PostgreSQL authentication and authorization, unlike the native BaaS authentication paths used by the other cases; reports must label this deviation.

## Scaffold status

Workload, fixtures, correctness logic, adapters, telemetry, and normalized result generation are intentionally deferred. This scaffold cannot produce benchmark evidence.
