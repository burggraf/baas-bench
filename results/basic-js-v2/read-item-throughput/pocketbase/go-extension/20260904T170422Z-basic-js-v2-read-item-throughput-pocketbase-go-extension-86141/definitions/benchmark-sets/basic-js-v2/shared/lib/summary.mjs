import { LOADS } from './fixtures.mjs';
import { percentile } from './runner.mjs';

export function summarize(stages) {
  if (stages.length !== LOADS.length || stages.some((stage, index) => stage.concurrency !== LOADS[index])) {
    throw new Error('expected stages for virtual users 1, 10, 100, and 1000');
  }

  const metrics = {};
  let durationMs = 0;
  let attempted = 0;
  let completed = 0;
  let failed = 0;

  for (const stage of stages) {
    const suffix = `vu_${stage.concurrency}`;
    const errorRate = stage.attempted === 0 ? 0 : stage.failed / stage.attempted;
    metrics[`operations_per_second_${suffix}`] = stage.duration_ms === 0 ? 0 : stage.completed / (stage.duration_ms / 1000);
    metrics[`latency_p50_ms_${suffix}`] = percentile(stage.latencies_ms, 0.5);
    metrics[`latency_p95_ms_${suffix}`] = percentile(stage.latencies_ms, 0.95);
    metrics[`latency_p99_ms_${suffix}`] = percentile(stage.latencies_ms, 0.99);
    metrics[`attempted_operations_${suffix}`] = stage.attempted;
    metrics[`completed_operations_${suffix}`] = stage.completed;
    metrics[`failed_operations_${suffix}`] = stage.failed;
    metrics[`error_rate_${suffix}`] = errorRate;
    durationMs += stage.duration_ms;
    attempted += stage.attempted;
    completed += stage.completed;
    failed += stage.failed;
  }

  return {
    schema_version: 1,
    duration_seconds: durationMs / 1000,
    completed_operations: completed,
    failed_operations: failed,
    error_rate: attempted === 0 ? 0 : failed / attempted,
    metrics,
  };
}
