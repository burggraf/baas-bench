import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { TELEMETRY_INTERVAL_MS } from './telemetry.mjs';

const exec = promisify(execFile);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const counter = text => { if (!/^\d+$/.test(text ?? '') || !integer(Number(text))) throw new Error('invalid host counter'); return Number(text); };
const sum = values => { const total = values.reduce((a, b) => a + b, 0); if (!integer(total)) throw new Error('unsafe counter total'); return total; };
const cpuKeys = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal'];
const memoryKeys = ['totalBytes', 'availableBytes', 'swapTotalBytes', 'swapFreeBytes'];

export function parseLinuxHost({ stat, meminfo, netdev, vmstat, bootId }) {
  const fields = String(stat).split('\n').find(line => /^cpu\s/.test(line))?.trim().split(/\s+/).slice(1);
  if (!fields || fields.length < 8) throw new Error('missing host CPU counters');
  const values = fields.map(counter);
  // Linux guest/guest_nice are already included in user/nice.
  const cpu = { ...Object.fromEntries(cpuKeys.map((key, index) => [key, values[index]])), total: sum(values.slice(0, 8)) };
  const memory = {};
  for (const [name, key] of [['MemTotal', 'totalBytes'], ['MemAvailable', 'availableBytes'], ['SwapTotal', 'swapTotalBytes'], ['SwapFree', 'swapFreeBytes']]) {
    const match = String(meminfo).match(new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, 'm'));
    if (!match) throw new Error('missing host memory counters');
    memory[key] = counter(match[1]) * 1024;
  }
  if (!memoryKeys.every(key => integer(memory[key])) || memory.totalBytes <= 0 || memory.availableBytes > memory.totalBytes || memory.swapFreeBytes > memory.swapTotalBytes) throw new Error('invalid host memory counters');
  const interfaces = [];
  for (const line of String(netdev).split('\n')) {
    const match = line.match(/^\s*([^:\s]+):\s*(.+)$/);
    if (!match || match[1] === 'lo') continue;
    const counts = match[2].trim().split(/\s+/).map(counter);
    if (counts.length < 16 || interfaces.some(row => row.name === match[1])) throw new Error('invalid host network counters');
    interfaces.push({ name: match[1], rxBytes: counts[0], txBytes: counts[8], rxDrops: counts[3], txDrops: counts[11] });
  }
  interfaces.sort((a, b) => a.name.localeCompare(b.name));
  if (!interfaces.length) throw new Error('host network counters unavailable');
  const oom = String(vmstat).match(/^oom_kill\s+(\d+)$/m), boot = String(bootId).trim();
  if (!oom || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(boot)) throw new Error('missing host restart/OOM counters');
  return { cpu, memory, network: { interfaces }, oomKillCount: counter(oom[1]), bootId: boot };
}

export function validateBackendOwnership(containerIds, project) {
  if (!Array.isArray(containerIds) || !containerIds.length || containerIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) || new Set(containerIds).size !== containerIds.length || typeof project !== 'string' || !/^[a-z0-9][a-z0-9_-]+$/.test(project)) throw new Error('invalid container ownership');
}

export function validateOwnedState(rows, { containerIds, project, baseline } = {}) {
  validateBackendOwnership(containerIds, project);
  if (!Array.isArray(rows) || rows.length !== containerIds.length || new Set(rows.map(row => row?.id)).size !== rows.length) throw new Error('container state incomplete');
  for (const row of rows) {
    const old = baseline?.find(state => state.id === row?.id);
    if (!row || !containerIds.includes(row.id) || row.project !== project || row.running !== true || row.oomKilled !== false || row.dead !== false || !integer(row.restarts) || typeof row.startedAt !== 'string' || !Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.startedAt) <= 0) throw new Error('invalid owned container state');
    if (baseline && (!old || old.restarts !== row.restarts || old.startedAt !== row.startedAt)) throw new Error('owned container restarted');
  }
  return rows;
}

export function parseOwnedStats(text, containerIds) {
  validateBackendOwnership(containerIds, 'stats-check');
  const rows = String(text).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (rows.length !== containerIds.length || new Set(rows.map(row => row.ID)).size !== rows.length) throw new Error('container stats incomplete');
  const units = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3 };
  let cpuPercent = 0, memoryBytes = 0;
  for (const row of rows) {
    const cpu = String(row.CPUPerc).match(/^(\d+(?:\.\d+)?)%$/), memory = String(row.MemUsage).split('/')[0].trim().match(/^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB)$/);
    if (!containerIds.includes(row.ID) || !cpu || !memory) throw new Error('invalid owned container stats');
    cpuPercent += Number(cpu[1]); memoryBytes += Math.round(Number(memory[1]) * units[memory[2]]);
  }
  if (!Number.isFinite(cpuPercent) || !integer(memoryBytes)) throw new Error('invalid container metrics');
  return { cpuPercent, memoryBytes, count: rows.length };
}

function validateHost(host, previous) {
  if (!host || ![...cpuKeys, 'total'].every(key => integer(host.cpu?.[key])) || !memoryKeys.every(key => integer(host.memory?.[key])) || host.memory.totalBytes <= 0 || host.memory.availableBytes > host.memory.totalBytes || host.memory.swapFreeBytes > host.memory.swapTotalBytes || !integer(host.oomKillCount) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(host.bootId ?? '') || !Array.isArray(host.network?.interfaces) || !host.network.interfaces.length) throw new Error('malformed host telemetry');
  if (host.cpu.total !== sum(cpuKeys.map(key => host.cpu[key]))) throw new Error('invalid CPU total');
  const names = new Set();
  for (const row of host.network.interfaces) {
    if (typeof row.name !== 'string' || !row.name || names.has(row.name) || !['rxBytes', 'txBytes', 'rxDrops', 'txDrops'].every(key => integer(row[key]))) throw new Error('malformed network telemetry');
    names.add(row.name);
  }
  if (previous) {
    if (host.bootId !== previous.bootId || host.oomKillCount !== previous.oomKillCount) throw new Error('host restarted or OOM observed');
    if ([...cpuKeys, 'total'].some(key => host.cpu[key] < previous.cpu[key]) || names.size !== previous.network.interfaces.length) throw new Error('host counter reset');
    for (const old of previous.network.interfaces) {
      const row = host.network.interfaces.find(item => item.name === old.name);
      if (!row || ['rxBytes', 'txBytes', 'rxDrops', 'txDrops'].some(key => row[key] < old[key])) throw new Error('network counter reset');
    }
  }
}

export function validateBackendTelemetry(report, { startAt, endedAt, durationMs, containerIds, project } = {}) {
  const reasons = [];
  try {
    validateBackendOwnership(containerIds, project);
    if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endedAt) || endedAt <= startAt || !report || report.platform !== 'linux' || report.startAt !== startAt || report.endedAt < endedAt || !Number.isSafeInteger(report.endedAt) || !Number.isSafeInteger(report.startedAt) || Math.abs(report.startedAt - startAt) > 100 || report.intervalMs !== TELEMETRY_INTERVAL_MS || report.project !== project || JSON.stringify([...report.containerIds].sort()) !== JSON.stringify([...containerIds].sort())) throw new Error('backend telemetry boundary/source mismatch');
    const expected = Number.isSafeInteger(durationMs) && durationMs > 0
      ? Math.ceil(durationMs / TELEMETRY_INTERVAL_MS)
      : Math.floor((endedAt - startAt) / TELEMETRY_INTERVAL_MS);
    if (expected < 1 || !Array.isArray(report.samples) || report.samples.length !== expected || report.failureReasons?.length) throw new Error('backend telemetry incomplete for requested stage duration');
    validateOwnedState(report.baseline?.states, { containerIds, project });
    validateHost(report.baseline?.host);
    let previous = report.baseline.host, timestamp = startAt;
    for (const [index, row] of report.samples.entries()) {
      if (!row || !Number.isSafeInteger(row.timestampMs) || row.timestampMs <= timestamp || row.timestampMs > endedAt || Math.abs(row.timestampMs - (startAt + (index + 1) * TELEMETRY_INTERVAL_MS)) >= TELEMETRY_INTERVAL_MS || row.containers?.count !== containerIds.length || !Number.isFinite(row.containers.cpuPercent) || row.containers.cpuPercent < 0 || !integer(row.containers.memoryBytes)) throw new Error('backend sample malformed or misaligned');
      validateOwnedState(row.states, { containerIds, project, baseline: report.baseline.states });
      validateHost(row.host, previous); previous = row.host; timestamp = row.timestampMs;
    }
    validateOwnedState(report.final?.states, { containerIds, project, baseline: report.baseline.states });
    validateHost(report.final?.host, previous);
  } catch { reasons.push('backend host/container telemetry missing, malformed, restarted or misaligned'); }
  return { valid: reasons.length === 0, validityReasons: reasons, admission_evidence: false };
}

const STATE_TEMPLATE = '{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"running":{{json .State.Running}},"restarts":{{json .RestartCount}},"startedAt":{{json .State.StartedAt}},"oomKilled":{{json .State.OOMKilled}},"dead":{{json .State.Dead}}}';

// Run on the Linux backend itself, against an explicit local Unix socket and owned IDs.
// No discovery, remote Docker context, SSH transport, credentials, or mutating command.
export async function startBackendTelemetry({ startAt, containerIds, project, socket = 'unix:///var/run/docker.sock', signal } = {}) {
  validateBackendOwnership(containerIds, project);
  if (process.platform !== 'linux') throw new Error('backend host telemetry requires Linux');
  if (!Number.isSafeInteger(startAt) || startAt < 0 || !/^unix:\/\/\/[A-Za-z0-9._/-]+$/.test(socket) || socket.slice(7).split('/').some(part => part === '.' || part === '..')) throw new Error('invalid backend telemetry options');
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']) if (process.env[key] !== undefined) env[key] = process.env[key];
  const docker = async args => (await exec('docker', ['--host', socket, ...args], { env, timeout: 4000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, signal })).stdout;
  const states = async () => validateOwnedState((await docker(['inspect', '--format', STATE_TEMPLATE, ...containerIds])).trim().split('\n').map(line => JSON.parse(line)), { containerIds, project });
  const host = async () => {
    const paths = ['/proc/stat', '/proc/meminfo', '/proc/net/dev', '/proc/vmstat', '/proc/sys/kernel/random/boot_id'];
    const [stat, meminfo, netdev, vmstat, bootId] = await Promise.all(paths.map(path => readFile(path, 'utf8')));
    return parseLinuxHost({ stat, meminfo, netdev, vmstat, bootId });
  };
  const snapshot = async () => { const [h, s] = await Promise.all([host(), states()]); return { host: h, states: s }; };
  const baseline = await snapshot();
  if (signal?.aborted) throw new Error('backend telemetry cancelled');
  if (startAt > Date.now()) await sleep(startAt - Date.now(), undefined, { signal });
  const report = { platform: process.platform, project, containerIds: [...containerIds], startAt, startedAt: Date.now(), intervalMs: TELEMETRY_INTERVAL_MS, baseline, samples: [], failureReasons: [] };
  let timer, stopped = false, pending = Promise.resolve(), stopPromise;
  const tick = async () => {
    const timestampMs = Date.now();
    try {
      const [data, text] = await Promise.all([snapshot(), docker(['stats', '--no-trunc', '--no-stream', '--format', '{{json .}}', ...containerIds])]);
      report.samples.push({ timestampMs, ...data, containers: parseOwnedStats(text, containerIds) });
    } catch { report.failureReasons.push('backend_probe_failed'); stopped = true; }
    if (!stopped) schedule();
  };
  const schedule = () => { timer = setTimeout(() => { pending = tick(); }, Math.max(0, startAt + (report.samples.length + 1) * TELEMETRY_INTERVAL_MS - Date.now())); };
  const abort = () => { stopped = true; clearTimeout(timer); report.failureReasons.push('cancelled'); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort(); else schedule();
  return { stop(endedAt = Date.now()) {
    if (!stopPromise) stopPromise = (async () => {
      stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); report.endedAt = endedAt;
      await pending;
      try { report.final = await snapshot(); } catch { report.failureReasons.push('backend_final_probe_failed'); }
      return report;
    })();
    return stopPromise;
  } };
}
