export async function sendCompletionNotification({ topic, token, runId, status, estimatedUsd, cleanup }, fetchImpl = fetch) {
  if (!topic && !token) return false;
  if (typeof topic !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(topic) || typeof token !== 'string' || !token || /[\r\n\0]/.test(token)) throw new Error('invalid ntfy configuration');
  if (typeof runId !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(runId)) throw new Error('invalid notification run ID');
  if (!['success', 'failed', 'interrupted'].includes(status) || !['complete', 'failed', 'not-needed'].includes(cleanup)) throw new Error('invalid notification status');
  if (typeof estimatedUsd !== 'number' || !Number.isFinite(estimatedUsd) || estimatedUsd < 0) throw new Error('invalid estimated spend');
  const response = await fetchImpl(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Title: 'BaaS V4 benchmark complete' },
    body: `run=${runId} status=${status} estimate_usd=${estimatedUsd.toFixed(2)} cleanup=${cleanup}`,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`ntfy notification failed (${response.status})`);
  return true;
}
