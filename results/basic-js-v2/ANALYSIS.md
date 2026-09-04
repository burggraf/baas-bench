# Analysis

These explanations are hypotheses based on observed throughput, latency, and error patterns, not isolated causal measurements. Direct PostgreSQL, pooled PostgreSQL, and HTTP extension paths have materially different transport boundaries. This analysis does not produce a platform ranking or an overall score.

Median figures below refer to the middle of three measured trials. Full independent trial data is in [REPORT.md](REPORT.md).

## List reads

### Direct PostgreSQL paths

At one VU, the direct PostgreSQL cases completed roughly 4,700–6,000 successful operations/s with sub-millisecond p95 latency. At 10 VUs they clustered around 15,000–16,200 operations/s. This pattern is consistent with a small indexed query whose low-load cost is dominated by local PostgreSQL protocol and query execution overhead.

At 100 VUs, successful throughput remained high—about 9,100–14,200 operations/s—but every direct case recorded some failures. At 1,000 VUs, median error rates ranged from about 28% to 35% and successful throughput fell to roughly 1,700–3,000 operations/s. Each VU owns a separate one-connection pool, so these results show that the prepared PostgreSQL services did not accept or complete all work at that client count. Successful-operation latency alone therefore understates high-load degradation; error rate must be read alongside it.

### Supabase pooler

The Supavisor case completed about 12,900 operations/s at 10 VUs and 11,900 at 100 VUs without measured failures. At 1,000 VUs it completed about 2,000 operations/s with a median error rate near 45%. For this workload, the bundled pooler shifted the point at which errors appeared but did not make 1,000 independent client pools error-free.

### Embedded extension paths

PocketBase’s Go extension rose from about 2,200 operations/s at one VU to roughly 6,900 at 100 and 1,000 VUs. TrailBase’s Rust WASM path rose from about 1,100 to 3,700 operations/s at 100 VUs, then completed about 2,400 at 1,000 VUs. Both extension paths recorded zero failed operations in all list trials. Their HTTP routing, runtime execution, response encoding, transfer, and parsing remain inside the timed boundary, unlike direct PostgreSQL.

## Item reads

### Direct PostgreSQL paths

Single-VU medians ranged from about 3,300 to 7,900 operations/s. At 10 VUs the direct cases completed roughly 11,100–26,500 operations/s, reflecting the inexpensive primary-key lookup. At 100 VUs they retained about 9,500–22,400 successful operations/s but recorded median error rates of approximately 0.4%–3.8%. At 1,000 VUs, successful throughput fell to roughly 2,400–4,450 operations/s while median error rates reached about 13%–23%.

The high-load pattern is again consistent with connection or service capacity becoming more important than the indexed lookup itself. Because failures are excluded from successful latency percentiles, the relatively low p95 values for completed operations do not imply that the overall 1,000-VU workload was healthy.

### Supabase pooler

The pooler completed about 17,800 operations/s at 100 VUs with no failures, compared with about 13,200 and a 3.8% median error rate on the separately published direct port. At 1,000 VUs, however, the pooler’s median error rate was about 52% and successful throughput about 1,670 operations/s. The observed benefit at 100 VUs did not extend to the largest closed-loop client count.

### Embedded extension paths

PocketBase’s Go extension completed about 9,100 operations/s at both 100 and 1,000 VUs, with zero failures. TrailBase’s Rust WASM path completed about 4,600 at 100 VUs and 2,700 at 1,000 VUs, also with zero failures. Tail latency widened substantially at 1,000 VUs—median p95 was about 197 ms for PocketBase and 535 ms for TrailBase—showing queueing or host contention even though requests continued to complete correctly.

## Writes

### PostgreSQL persistence paths

Write behavior differed more strongly by deployment topology than read behavior. Neon’s local compute/safekeeper path completed a median of about 1,230 operations/s at 10 VUs and 1,100 at 100 VUs; its median error rate reached roughly 22% at 100 VUs and 68% at 1,000 VUs. This may reflect the additional persistence and acknowledgement work in the local Neon topology, but the benchmark does not isolate that cause.

Nhost and Directus showed a group-commit-like scaling shape: low one-VU throughput increased sharply with concurrency. Nhost completed about 5,400 operations/s at 10 VUs and 9,000 at 100 VUs; Directus’s direct database case completed about 5,400 and 11,300 respectively. Both recorded failures at 100 VUs and substantial error rates at 1,000 VUs. Directus’s measured operation bypasses the Directus application API; the case setup adds the database timestamp default needed to preserve the shared write contract.

Supabase direct completed about 9,100 operations/s at 10 VUs and 7,200 at 100 VUs, while the pooler completed about 6,600 and 9,200. The pooler had no failures at 100 VUs, whereas the direct case’s median error rate was about 8.6%. At 1,000 VUs both paths degraded: median error rates were about 20% direct and 54% pooled. As with reads, pooling changed the capacity profile but did not eliminate overload at the largest client count.

### Embedded extension paths

PocketBase’s Go extension plateaued around 3,500–3,700 successful writes/s from 10 through 1,000 VUs. TrailBase’s Rust WASM path completed roughly 2,800 writes/s at 10 VUs and 3,400–3,500 at 100–1,000 VUs. Neither extension case recorded failed writes. At 1,000 VUs, median p95 latency rose to about 800 ms for PocketBase and 427 ms for TrailBase, so their stable successful throughput came with substantial queueing.

PocketBase writes use its internal record persistence API rather than raw SQLite SQL, while TrailBase’s WASM handler executes an SQL insert. Their similar high-load throughput therefore should not be interpreted as equivalent internal work.

## Reliability and interpretation

The clearest cross-workload observation is a tradeoff at the largest load: direct and pooled PostgreSQL paths often retained low latency for operations that succeeded, but many attempted operations failed; the two HTTP extension paths completed every measured operation but accumulated higher tail latency. This is an observation about these prepared services, client connection model, and single host—not a general database or product reliability conclusion.

The 20 initially published bundles use source commit `90007ae`; the corrected Directus write bundle uses `be73ef7`. The later Directus definition adds its required database timestamp default and limits untimed lifecycle verification to fixture rows. The report does not combine trials across those commits, and each bundle captures its complete measured definition.

Results are specific to warmed, anonymous, single-host, closed-loop execution with one client per VU. They do not predict remote networking, authentication, mixed workloads, sustained endurance, production resource sizing, or application-level behavior. Compare `basic-js-v2` with `basic-js-v1` only as distinct access-path measurements; do not subtract them as a pure estimate of API overhead because schemas, client behavior, routing, connection management, and server-side work differ.
