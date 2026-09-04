# Analysis

These explanations are hypotheses based on the observed throughput and latency patterns, not isolated causal measurements. The benchmark combines SDK, HTTP, API, database, cache, and acknowledgement costs, so implementation details and local resource contention can all contribute.

## List-read throughput

### Supabase
Supabase was very fast at low concurrency, then plateaued and became more latent as concurrency increased. Its PostgreSQL-backed API and efficient connection handling likely explain the strong single-client and 10-VU results, while contention in the API/database path becomes visible at 100–1,000 VUs. The absence of errors suggests the limiting factor was queueing and service capacity rather than instability.

### Convex
Convex delivered the strongest and most consistent list-read results, maintaining roughly 7,800–8,100 operations/s at 1,000 VUs with comparatively low latency. The native query execution path appears well suited to this read-only workload, and the narrow, fixed-size query likely benefits from efficient application-side dispatch and caching. Its stable trials and zero failures indicate graceful saturation under this test.

### Appwrite
Appwrite was substantially slower even with one VU and degraded sharply as concurrency rose, reaching multi-second median and very high tail latency at 1,000 VUs. The TablesDB request path likely carries more API, validation, and service-layer overhead for a paginated list than the lighter-weight competitors, with queueing amplifying that cost under load. It remained error-free, so the tradeoff here was latency and throughput rather than correctness.

### Nhost
Nhost matched Supabase at one and 10 VUs but lost throughput sooner at higher concurrency, especially in the less consistent 1,000-VU trials. Its GraphQL-based path likely adds query parsing, planning, and response-processing overhead, while the underlying PostgreSQL service still provides good low-load performance. The wide high-concurrency tails suggest resource contention or queueing in the GraphQL/API stack.

### Directus
Directus reached a clear ceiling near 480–490 operations/s: throughput barely changed from 10 to 1,000 VUs, while tail latency rose dramatically. The retained Redis API cache likely helped keep the response path stable and bounded, but the Directus application layer and request serialization appear to impose a fixed capacity for this workload. Zero errors alongside a flat throughput curve is consistent with saturation rather than failed requests.

### PocketBase
PocketBase performed strongly across all loads and remained comparatively effective at 1,000 VUs. Its compact, embedded-service design and direct REST path likely minimize framework and network-layer overhead, while the simple list query is inexpensive for the local datastore. The broader p95/p99 spread than TrailBase or Convex suggests some event-loop, datastore, or host contention, but not a loss of availability.

### TrailBase
TrailBase was among the fastest low- and medium-concurrency list readers, with low latency through 100 VUs. Its lightweight HTTP/SDK path and local embedded database likely keep per-request overhead small. At 1,000 VUs, trial-to-trial throughput varied more than at lower loads, indicating host or service saturation, but latency and throughput remained materially better than the heavier API stacks and no operations failed.

## Item-read throughput

### Supabase
Supabase handled primary-key reads better than list reads at high concurrency, sustaining about 3,400–3,500 operations/s at 1,000 VUs. A deterministic indexed lookup is simpler for PostgreSQL than sorting and returning 20 rows, so database work is reduced; the remaining latency likely comes from the API and connection path. The consistent trials and zero errors indicate predictable scaling until local capacity is reached.

### Convex
Convex was highly effective for item reads, with roughly 6,600–6,700 operations/s at 1,000 VUs and low median latency. A single-key lookup maps naturally to its query model and avoids the extra work of assembling a list, which likely explains the strong result. The higher p95 relative to the median under load suggests queueing in the tail, but the service stayed stable and error-free.

### Appwrite
Appwrite improved substantially over its list-read throughput for item reads, reaching around 740–790 operations/s at high load, but remained slower than the other platforms. Native primary-key access reduces database work, yet the TablesDB and API layers still contribute significant fixed overhead. The increasing tails at 1,000 VUs point to queueing and constrained service capacity rather than request failures.

### Nhost
Nhost showed a similar pattern to its list reads: good low-load performance, followed by a drop and wider tails at 100–1,000 VUs. The indexed item lookup reduces database work, but GraphQL request execution and serialization remain on the critical path. The stable zero-error results suggest that the observed degradation is principally capacity and latency pressure in the API path.

### Directus
Directus again formed a throughput ceiling around 480–500 operations/s, regardless of whether the item lookup used a single key. The cache and application stack appear capable of serving a bounded number of requests, but additional VUs mostly accumulated queueing, producing very large p95 and p99 values. The similarity to list-read throughput suggests the framework and service path dominate the difference between these two query shapes.

### PocketBase
PocketBase was one of the fastest item-read implementations, especially from 10 through 1,000 VUs. A direct primary-key lookup in a compact embedded service is a favorable combination for this workload, with little query or framework overhead. Its increasing tail latency at 1,000 VUs indicates saturation of the shared host or service, but throughput stayed high and all requests succeeded.

### TrailBase
TrailBase scaled well for item reads, reaching approximately 5,300–5,800 operations/s at 100–1,000 VUs with low median latency. The native primary-key path likely benefits from an indexed lookup and a lightweight service boundary, making this operation particularly efficient. The p95/p99 tails widened under heavy load and the first trial was somewhat variable, which is consistent with contention, but there were no failures.

## Write throughput

### Supabase
Supabase writes were very fast at 10 VUs but fell sharply at 100 VUs and then remained near 700–765 operations/s at 1,000 VUs. Inserts require transaction handling, index maintenance, and an acknowledgement response, so database write contention appears much earlier than for reads. The consistent zero-error behavior suggests the service serialized or queued writes successfully, with the cost appearing as latency rather than rejection.

### Convex
Convex writes were much slower than its reads and increased only modestly from one to 1,000 VUs, while latency became several seconds at the highest load. This likely reflects the extra work required for mutation execution, validation, transactional consistency, and acknowledgement compared with a query. The flat, low throughput and large tails indicate a mutation bottleneck under this workload, not an availability problem.

### Appwrite
Appwrite writes started near its list-read baseline and improved with concurrency, then leveled off around 320–370 operations/s at high load. TablesDB creation likely involves service-layer validation, timestamp handling, persistence, and response construction, all of which make writes more expensive than reads. The substantial tail latency at 1,000 VUs is consistent with a saturated application/database pipeline; no writes failed.

### Nhost
Nhost was reasonably strong at low and medium write concurrency, reaching roughly 1,650–1,800 operations/s at 100 VUs, but collapsed to about 460–480 operations/s at 1,000 VUs. GraphQL mutation processing and PostgreSQL transaction/acknowledgement work likely combine into a sharp high-concurrency bottleneck. The repeatable multi-second tails and zero errors suggest queueing or lock/resource contention rather than correctness failures.

### Directus
Directus had the lowest write throughput at every meaningful load and flattened near 245–280 operations/s from 100 to 1,000 VUs. Although the read cache can help reads, creates must pass through the full Directus permission, validation, serialization, and persistence path, so cached reads do not translate into cached writes. The very high p95 and p99 values at 1,000 VUs show severe queueing under saturation, while the absence of errors indicates successful but slow processing.

### PocketBase
PocketBase delivered strong write throughput and scaled smoothly through 1,000 VUs, remaining around 4,100–4,200 operations/s. Its compact service and direct persistence path likely keep mutation overhead low for this simple record shape, although serialization and datastore locking still widen the tail under load. The close agreement across trials and zero failures indicate that the local write path handled concurrency efficiently on the test host.

### TrailBase
TrailBase was the fastest or near-fastest writer at medium and high concurrency, reaching about 4,600–5,150 operations/s at 1,000 VUs. Its lightweight API and local database path likely reduce both request overhead and mutation acknowledgement cost. One 1,000-VU trial dipped markedly, showing sensitivity to transient contention or host scheduling, but the other trials recovered strongly and all operations completed successfully.

## Overall caveat

The patterns are specific to this warmed, single-host, anonymous, closed-loop benchmark. They should be read as clues about these particular SDK/API paths and workload shapes, not as general rankings of the platforms or predictions of authenticated, remote, mixed-read/write production behavior.
