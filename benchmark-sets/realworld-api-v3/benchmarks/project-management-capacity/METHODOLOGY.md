# Project-management capacity methodology

## Scope

This benchmark measures SLO-qualified concurrent-user capacity for one deterministic authenticated project-management workload through each platform's supported application-facing path. It is not a universal platform, cost, hosted-service, realtime, storage, or geographic-latency ranking.

## Lifecycle and dataset

Setup provisions the platform topology, schema, permissions, indexes, authentication users, and exactly one million deterministic application records: 1,600 organizations, 16,000 users, 16,000 memberships, 8,000 projects, 160,000 tasks, 479,200 comments, and 319,200 activities. Correctness runs before warm-up and measured stages. Reset restores the declared fixture baseline and clears benchmark-created sessions/state. Teardown removes only benchmark-owned resources and preserves the primary failure if cleanup also fails.

The runner performs a zero-duration framework warm-up, then prepares authenticated virtual-user sessions outside measurement. Each virtual user executes serial complete dashboard, task-list, task-detail, create-task, update-task, add-comment, search, profile-update, and sign-out/sign-in workflows with deterministic selection and 1,000–5,000 ms think time. Requests have a five-second timeout, no retries, and bounded cancellation/grace handling.

## Capacity and SLOs

The search tests stages 5, 10, 25, and 50, doubles until the first failure or 10,000 users, then performs at most four bounded integer refinements. Capacity is the highest contiguous passing stage. A passing stage must achieve at least 95% of requested users, include at least 20 samples in each active class, keep read/write/auth-search p95 latency at or below 500/750/1000 ms, and keep each class error rate strictly below 1%.

## Metrics and evidence

The primary metric is `capacity_users`. Supporting metrics include achieved users, workflow throughput, physical remote-operation throughput and amplification, p95 latency, and error rate for read, write, and auth/search classes. Workflow timing and physical SDK/HTTP calls are recorded separately. Raw stage curves, bounded sanitized errors, correctness findings, resource samples, and normalized summaries are written with restrictive permissions.

Resource attribution samples the platform's Compose containers during each measured stage. Missing, failed, incomplete, or sustained-overload samples invalidate a stage. No application cache, retry, timed bulk operation, or platform-specific measured shortcut is permitted. Native SDK and platform defaults remain in scope.

## Access paths and publication

Seven cases use their platform's official JavaScript SDK and native authentication/authorization. Neon uses `@neondatabase/serverless@1.1.0` over the official local SQL-over-HTTP proxy, with application-owned PostgreSQL password/session functions and RLS tenant authorization; this is a material access-path deviation and is never presented as native BaaS auth. Each case README records its topology and deviations.

A publishable comparison requires three valid balanced repetitions per platform, declared trial ordering, cooldowns, clean repository state, validated/tamper-checked bundles, and no debug or failed artifacts. This repository contains no benchmark results.
