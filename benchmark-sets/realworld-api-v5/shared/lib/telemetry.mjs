import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

export const TELEMETRY_INTERVAL_MS = 5000;
const nonnegative = value => Number.isFinite(value) && value >= 0;

// Only process telemetry. Backend host/container evidence is a separate required source.
export async function startProcessTelemetry({ startAt, intervalMs = TELEMETRY_INTERVAL_MS, signal, onSample = () => {} } = {}) {
  if (!Number.isSafeInteger(startAt) || startAt < 0 || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > TELEMETRY_INTERVAL_MS || typeof onSample !== 'function') throw new Error('invalid process telemetry options');
  if (signal?.aborted) throw new Error('telemetry cancelled');
  if (startAt > Date.now()) await sleep(startAt - Date.now(), undefined, { signal });
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const report = { pid: process.pid, startedAt: Date.now(), intervalMs, samples: [], failureReasons: [] };
  let previousCpu = process.cpuUsage(), previousTime = performance.now(), timer, stopped = false;
  const stop = () => {
    if (!stopped) {
      stopped = true; clearTimeout(timer); histogram.disable();
      signal?.removeEventListener('abort', abort);
      report.endedAt = Date.now();
    }
    return report;
  };
  const abort = () => { report.failureReasons.push('cancelled'); stop(); };
  const sample = () => {
    if (stopped) return;
    const cpu = process.cpuUsage(), time = performance.now();
    const elapsed = time - previousTime;
    const row = { timestampMs: Date.now(), cpuPercent: elapsed > 0 ? (cpu.user + cpu.system - previousCpu.user - previousCpu.system) / (elapsed * 10) : NaN,
      rssBytes: process.memoryUsage().rss, eventLoop: { p99Ms: histogram.percentile(99) / 1e6, maxMs: histogram.max / 1e6 } };
    report.samples.push(row);
    previousCpu = cpu; previousTime = time; histogram.reset();
    try { onSample(row); } catch { report.failureReasons.push('sample_delivery'); stop(); return; }
    schedule();
  };
  const schedule = () => { timer = setTimeout(sample, Math.max(0, startAt + (report.samples.length + 1) * intervalMs - Date.now())); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort(); else schedule();
  return { stop };
}

export function validateProcessTelemetry(report, { startAt, endedAt, durationMs } = {}) {
  const reasons = [];
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endedAt) || endedAt <= startAt) return { valid: false, validityReasons: ['invalid telemetry boundary'] };
  if (!report || !Number.isSafeInteger(report.pid) || report.pid < 1 || !Number.isSafeInteger(report.startedAt) || !Number.isSafeInteger(report.endedAt) || report.intervalMs !== TELEMETRY_INTERVAL_MS || !Array.isArray(report.samples)) return { valid: false, validityReasons: ['missing or malformed process telemetry'] };
  if (Math.abs(report.startedAt - startAt) > 100) reasons.push('process start alignment exceeded');
  if (report.endedAt < endedAt) reasons.push('process telemetry ended before stage');
  const expectedSamples = Number.isSafeInteger(durationMs) && durationMs > 0
    ? Math.ceil(durationMs / TELEMETRY_INTERVAL_MS)
    : Math.floor((report.endedAt - startAt) / TELEMETRY_INTERVAL_MS);
  if (expectedSamples < 1 || report.samples.length !== expectedSamples) reasons.push('process telemetry samples incomplete for requested stage duration');
  let previous = startAt;
  for (let index = 0; index < report.samples.length; index++) {
    const row = report.samples[index];
    if (!row || !Number.isSafeInteger(row.timestampMs) || row.timestampMs <= previous || !nonnegative(row.cpuPercent) || !Number.isSafeInteger(row.rssBytes) || row.rssBytes <= 0 || !nonnegative(row.eventLoop?.p99Ms) || !nonnegative(row.eventLoop?.maxMs)) { reasons.push('malformed process telemetry sample'); continue; }
    if (Math.abs(row.timestampMs - (startAt + (index + 1) * TELEMETRY_INTERVAL_MS)) >= TELEMETRY_INTERVAL_MS || row.timestampMs > report.endedAt) reasons.push('process telemetry sample alignment exceeded');
    previous = row.timestampMs;
  }
  if (report.failureReasons?.length) reasons.push('process telemetry producer failed');
  const metrics = [row => row?.cpuPercent > 90, row => row?.eventLoop?.p99Ms > 100, row => row?.eventLoop?.maxMs > 250];
  if (metrics.some(metric => report.samples.some((_row, index) => index + 2 < report.samples.length && report.samples.slice(index, index + 3).every(metric)))) reasons.push('process overload for three consecutive samples');
  return { valid: reasons.length === 0, validityReasons: [...new Set(reasons)] };
}

// No percentile averaging or pooling of headroom: every workload process must pass.
export function validateRunnerTelemetry({ coordinator, workers } = {}, boundaries) {
  const reasons = [];
  if (!Array.isArray(workers) || workers.length !== 3) reasons.push('three workload process telemetry sources required');
  const reports = [coordinator, ...(Array.isArray(workers) ? workers : [])];
  if (new Set(reports.map(report => report?.pid)).size !== reports.length) reasons.push('duplicate process telemetry source');
  for (const [index, report] of reports.entries()) {
    const result = validateProcessTelemetry(report, boundaries);
    for (const reason of result.validityReasons) reasons.push(`${index === 0 ? 'coordinator' : `worker-${index}`}: ${reason}`);
  }
  return { valid: reasons.length === 0, validityReasons: reasons, admission_evidence: false };
}
