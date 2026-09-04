export const FIXED_METRICS = Object.freeze([
  'capacity_users', 'capacity_bounded', 'achieved_users_at_capacity',
  'workflow_tps_at_capacity', 'remote_operations_per_second_at_capacity',
  'read_latency_p95_ms_at_capacity', 'write_latency_p95_ms_at_capacity',
  'auth_search_latency_p95_ms_at_capacity', 'read_error_rate_at_capacity',
  'write_error_rate_at_capacity', 'auth_search_error_rate_at_capacity',
]);

const zeroMetrics = () => Object.fromEntries(FIXED_METRICS.map(name => [name, 0]));

export function summarize(stages, capacity) {
  if (!Array.isArray(stages) || !capacity || typeof capacity !== 'object') throw new Error('invalid summary input');
  const metrics = zeroMetrics();
  const selected = Number.isSafeInteger(capacity.selectedCapacityUsers) ? capacity.selectedCapacityUsers : 0;
  const stage = stages.find(candidate => candidate.requestedUsers === selected && candidate.valid);
  if (stage) {
    const classes = stage.operationClassMetrics ?? {};
    Object.assign(metrics, {
      capacity_users: selected,
      capacity_bounded: capacity.stages?.some(item => !item.passed && !item.invalid) ? 1 : 0,
      achieved_users_at_capacity: stage.achievedUsers,
      workflow_tps_at_capacity: stage.workflowTransactionsPerSecond,
      remote_operations_per_second_at_capacity: stage.remoteOperationsPerSecond,
      read_latency_p95_ms_at_capacity: classes.read?.latencyP95Ms ?? 0,
      write_latency_p95_ms_at_capacity: classes.write?.latencyP95Ms ?? 0,
      auth_search_latency_p95_ms_at_capacity: classes.authSearch?.latencyP95Ms ?? 0,
      read_error_rate_at_capacity: classes.read?.errorRate ?? 0,
      write_error_rate_at_capacity: classes.write?.errorRate ?? 0,
      auth_search_error_rate_at_capacity: classes.authSearch?.errorRate ?? 0,
    });
  }
  if (Object.values(metrics).some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('summary metrics must be finite');
  const completed = stages.reduce((sum, item) => sum + Object.values(item.operationClassMetrics ?? {}).reduce((total, metric) => total + (metric.completed ?? 0), 0), 0);
  const failed = stages.reduce((sum, item) => sum + Object.values(item.operationClassMetrics ?? {}).reduce((total, metric) => total + (metric.failed ?? 0), 0), 0);
  return {
    schema_version: 1,
    duration_seconds: stages.reduce((sum, item) => sum + (item.elapsedSeconds ?? 0), 0),
    completed_operations: completed,
    failed_operations: failed,
    error_rate: completed + failed === 0 ? 0 : failed / (completed + failed),
    metrics,
  };
}
