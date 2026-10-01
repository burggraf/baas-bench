export const REQUIRED_CHECKS = Object.freeze([
  'fixture-integrity', 'search-semantics', 'pagination-and-null-filters',
  'self-peer-visibility', 'native-tenant-authorization', 'live-role-revocation',
  'actor-binding', 'server-integrity', 'comment-project-permissions',
  'atomic-activity', 'activity-failure-rollback', 'application-only-profile',
  'reset-baseline', 'durable-settings', 'restart-persistence',
]);

// Only a completed producer's findings are accepted. This shape check is not
// itself integration evidence, a durable-settings audit, or run authorization.
export function assertConformance(report) {
  if (report?.passed !== true || !Array.isArray(report.findings)) throw new Error('incomplete conformance report');
  const names = new Set();
  for (const finding of report.findings) {
    if (!finding || typeof finding.name !== 'string' || finding.passed !== true || names.has(finding.name)) throw new Error('failed or duplicate conformance finding');
    names.add(finding.name);
  }
  const missing = REQUIRED_CHECKS.filter(name => !names.has(name));
  if (missing.length) throw new Error(`missing conformance checks: ${missing.join(', ')}`);
}

export async function runConformance(checks) {
  const findings = [];
  for (const name of REQUIRED_CHECKS) {
    try {
      if (typeof checks?.[name] !== 'function' || await checks[name]() !== true) throw new Error('missing or unsuccessful native check');
      findings.push({ name, passed: true });
    } catch (error) {
      // Never retain native messages, URLs, tokens, or arbitrary error names.
      const safeTypes = ['Error', 'AssertionError', 'BenchmarkOperationError', 'FetchError', 'TimeoutError', 'AbortError', 'AggregateError'];
      const finding = { name, passed: false, failure_type: safeTypes.includes(error?.name) ? error.name : 'Error' };
      if (Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599) finding.failure_http_status = error.status;
      if (Array.isArray(error?.cleanupErrors)) finding.cleanup_failure_count = error.cleanupErrors.length;
      findings.push(finding);
    }
  }
  return { passed: findings.every(finding => finding.passed), findings };
}

// Every adaptive stage owns a fresh baseline and identical warm-up. A failed
// restore/verification/warm-up prevents measurement; no implicit retries.
export async function runStageFromBaseline({ conformance, reset, verifyBaseline, warmUp, measure, stage }) {
  assertConformance(conformance);
  for (const hook of [reset, verifyBaseline, warmUp, measure]) if (typeof hook !== 'function') throw new Error('missing stage lifecycle hook');
  await reset();
  if (await verifyBaseline() !== true) throw new Error('baseline verification failed');
  await warmUp();
  return measure(stage);
}
