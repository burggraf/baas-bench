import { writeSync, writeFileSync, renameSync, lstatSync } from 'node:fs';
import { isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';

const PREFIX = 'V4_PROGRESS ';
const sources = new Set(['controller', 'lifecycle', 'seed', 'runner']);
const phases = new Set(['preflight', 'provisioning', 'waiting_for_hosts', 'ready', 'bootstrapping', 'deployment', 'benchmark', 'environment', 'backend-start', 'setup', 'verify', 'reset', 'run', 'teardown', 'backend-stop', 'sync-runner', 'cleanup-baseline', 'schema', 'copy', 'auth-subjects', 'application-passwords', 'auth-users', 'fixture-snapshot', 'runtime-config', 'verify-counts', 'correctness', 'warmup', 'prepare-sessions', 'measure', 'close-sessions', 'telemetry-drain', 'stage-complete', 'transfer', 'verify-evidence', 'deleting', 'deleted', 'needs_recovery', 'complete', 'failed']);
const numeric = new Set(['updated_at', 'last_activity_at', 'elapsed_ms', 'duration_ms', 'stage_users', 'stage_index', 'stages_completed', 'completed_operations', 'failed_operations', 'completed_workflows', 'failed_workflows', 'prepared_users', 'telemetry_samples', 'telemetry_expected', 'copied_rows', 'copied_batches', 'total_rows']);
const terminals = new Set(['complete', 'failed', 'deleted', 'needs_recovery']);

export function encodeProgress(event) {
  if (!event || !sources.has(event.source) || !phases.has(event.phase) || !['phase', 'heartbeat', 'progress'].includes(event.kind)) throw new Error('invalid progress event');
  if (['updated_at', 'last_activity_at', 'elapsed_ms'].some(key => !Number.isFinite(event[key]) || event[key] < 0)) throw new Error('invalid progress timestamps');
  for (const [key, value] of Object.entries(event)) {
    if (['source', 'phase', 'kind'].includes(key)) continue;
    if (key === 'outcome' && ['pass', 'fail', 'invalid'].includes(value)) continue;
    if (!numeric.has(key) || !Number.isFinite(value) || value < 0) throw new Error('invalid progress field');
  }
  return `${PREFIX}${JSON.stringify(event)}\n`;
}

// Bound untrusted remote output; only allowlisted progress is ever forwarded.
export function lineDecoder(consume, maxLength = 4096) {
  const decoder = new StringDecoder('utf8');
  let pending = ''; let dropping = false;
  return chunk => {
    for (const part of decoder.write(Buffer.from(chunk)).split(/(?<=\n)/)) {
      const end = part.endsWith('\n');
      if (!dropping) {
        pending += part;
        if (pending.length > maxLength) { pending = ''; dropping = true; }
        else if (end) consume(pending.trimEnd());
      }
      if (end) { pending = ''; dropping = false; }
    }
  };
}
export function progressDecoder(consume) {
  return lineDecoder(line => {
    if (!line.startsWith(PREFIX)) return;
    let event;
    try { event = JSON.parse(line.slice(PREFIX.length)); encodeProgress(event); } catch { return; }
    consume(event);
  });
}
export function emitProgress(event) {
  const fd = process.env.BAAS_BENCH_V4_PROGRESS_FD;
  if (fd !== '2' && fd !== '3') return;
  try { writeSync(Number(fd), encodeProgress(event)); } catch { /* monitoring must not replace benchmark/cleanup failures */ }
}

export function createProgress(source, options = {}) {
  const now = options.now ?? Date.now;
  const emit = options.emit ?? emitProgress;
  let state; let started;
  const send = kind => {
    if (!state) return;
    try { emit({ ...state, kind, updated_at: now(), elapsed_ms: Math.max(0, now() - started) }); } catch { /* diagnostic only */ }
  };
  const timer = (options.schedule ?? setInterval)(() => send('heartbeat'), 15000);
  timer?.unref?.();
  return {
    phase(phase, fields = {}) {
      started = now(); state = { source, phase, ...fields, last_activity_at: started }; send('phase');
    },
    count(fields) {
      if (!state) return;
      if (Object.entries(fields).some(([key, value]) => state[key] !== value)) state.last_activity_at = now();
      Object.assign(state, fields);
    },
    stop() { (options.cancel ?? clearInterval)(timer); },
  };
}

export function createProgressStore(path, runId, { now = Date.now, log = line => process.stderr.write(line) } = {}) {
  if (!isAbsolute(path) || !/^[a-z0-9][a-z0-9-]{5,40}$/.test(runId)) throw new Error('invalid progress store path/run ID');
  const directory = lstatSync(dirname(path));
  if (!directory.isDirectory() || (directory.mode & 0o077)) throw new Error('progress directory must be private (0700)');
  const state = { schema_version: 1, run_id: runId, controller_pid: process.pid, sources: {} };
  writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' });
  const temporary = `${path}.${process.pid}.tmp`;
  let warned = false; let lastWarning = '';
  return {
    receive(event) {
      const line = encodeProgress(event);
      state.sources[event.source] = { ...event, received_at: now() };
      try {
        writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
      } catch {
        if (!warned) { warned = true; log('V4 progress file write failed; streamed updates remain available\n'); }
      }
      log(line);
      const warnings = progressStatus(state, now()).warnings.join('; ');
      if (warnings && warnings !== lastWarning) log(`V4_PROGRESS_WARNING ${warnings}\n`);
      lastWarning = warnings;
    },
  };
}

export function progressStatus(state, now = Date.now()) {
  if (state?.schema_version !== 1 || !state.sources || !Number.isSafeInteger(state.controller_pid) || state.controller_pid < 1 || !/^[a-z0-9][a-z0-9-]{5,40}$/.test(state.run_id ?? '') || Object.keys(state).some(key => !['schema_version', 'run_id', 'controller_pid', 'sources'].includes(key))) throw new Error('invalid progress state');
  let controllerAlive = true;
  try { process.kill(state.controller_pid, 0); } catch (error) { controllerAlive = error.code === 'EPERM'; }
  const view = Object.fromEntries(Object.entries(state.sources).map(([source, event]) => {
    const { received_at, ...fields } = event;
    encodeProgress(fields);
    if (event.source !== source || !Number.isFinite(received_at) || received_at < 0) throw new Error('invalid progress receipt');
    const age = Math.max(0, now - event.received_at);
    const activityAge = Math.max(0, event.updated_at - event.last_activity_at + age);
    const timed = event.phase === 'measure' || event.phase === 'warmup';
    return [source, { ...event, received_age_seconds: Math.floor(age / 1000), activity_age_seconds: Math.floor(activityAge / 1000), stale: !terminals.has(event.phase) && age > 45000,
      ...(timed && event.duration_ms > 0 ? { phase_percent: Math.min(100, Math.floor(100 * event.elapsed_ms / event.duration_ms)), phase_remaining_seconds: Math.max(0, Math.ceil((event.duration_ms - event.elapsed_ms) / 1000)) } : {}),
      ...(event.telemetry_expected > 0 ? { telemetry_percent: Math.min(100, Math.floor(100 * event.telemetry_samples / event.telemetry_expected)), telemetry_remaining_samples: Math.max(0, event.telemetry_expected - event.telemetry_samples) } : {}) }];
  }));
  const finished = terminals.has(view.controller?.phase);
  const warnings = [];
  if (!finished && !controllerAlive) warnings.push('controller process is not alive; inspect inventory before recovery');
  for (const source of ['runner', 'seed']) {
    if (!finished && view[source]?.stale) warnings.push(`${source} heartbeat is stale; process liveness and forward progress are unconfirmed`);
  }
  return { ...state, controller_alive: controllerAlive, sources: view, warnings, eta: 'Phase estimates only; adaptive stages and setup duration have no fixed overall ETA.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, phase, ...extra] = process.argv.slice(2);
  if (extra.length || !sources.has(source) || !phases.has(phase)) { console.error('usage: progress.mjs <source> <phase>'); process.exitCode = 2; }
  else emitProgress({ source, phase, kind: 'phase', updated_at: Date.now(), last_activity_at: Date.now(), elapsed_ms: 0 });
}
