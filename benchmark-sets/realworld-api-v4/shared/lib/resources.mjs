import { monitorEventLoopDelay } from 'node:perf_hooks';
import { runCommand } from './command.mjs';
import { runLongCommand } from './remote-execution.mjs';
import { sampleLocalHost } from './host-telemetry.mjs';
import { pathToFileURL } from 'node:url';

const PLATFORMS = new Set(['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon']);
export const RESOURCE_SAMPLE_INTERVAL_MS = 5_000;
const byteUnits = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, KB: 1_000, MB: 1_000_000, GB: 1_000_000_000 };

function bytes(text) {
  const match = String(text).trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB)$/i);
  if (!match) return null;
  const unit = Object.keys(byteUnits).find(key => key.toLowerCase() === match[2].toLowerCase());
  const value = Number(match[1]) * byteUnits[unit];
  return Number.isSafeInteger(Math.round(value)) ? Math.round(value) : null;
}

function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

function dockerInvocation(args, sshTarget) {
  if (sshTarget === undefined || sshTarget === '') return ['docker', args];
  if (typeof sshTarget !== 'string' || !/^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*$/.test(sshTarget)) throw new Error('invalid SSH target');
  const remoteCommand = ['docker', ...args.map(shellQuote)].join(' ');
  return ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', sshTarget, remoteCommand]];
}

export async function discoverPlatformContainers(platform, command = runCommand, options = {}) {
  if (!PLATFORMS.has(platform)) throw new Error('invalid platform');
  const [executable, args] = dockerInvocation(['compose', '-p', `baas-${platform}`, 'ps', '-q'], options.sshTarget);
  const { stdout } = await command(executable, args, { timeoutMs: 5_000 });
  const ids = stdout.split(/\r?\n/).map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!ids.length) throw new Error('no compose containers discovered');
  if (ids.some(id => !/^[0-9a-f]{12,64}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('invalid compose container IDs');
  return ids;
}

export function parseDockerStats(text, ownedIds) {
  let cpuPercent = 0;
  let memoryBytes = 0;
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/).filter(Boolean)) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const id = String(row.ID ?? row.Container ?? '').toLowerCase();
    const matches = [...ownedIds].filter(owned => owned === id || owned.startsWith(id) || id.startsWith(owned));
    const cpu = Number(String(row.CPUPerc ?? '').replace(/%$/, ''));
    const memory = bytes(String(row.MemUsage ?? '').split('/')[0]);
    if (matches.length !== 1 || seen.has(matches[0]) || !Number.isFinite(cpu) || cpu < 0 || memory === null) continue;
    seen.add(matches[0]); cpuPercent += cpu; memoryBytes += memory;
  }
  return { cpuPercent, memoryBytes, count: seen.size };
}

const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
const createMonitor = () => { const monitor = monitorEventLoopDelay({ resolution: 10 }); monitor.enable(); return monitor; };

export async function collectResources(options) {
  const count = options.samples ?? 60;
  const intervalMs = options.intervalMs ?? RESOURCE_SAMPLE_INTERVAL_MS;
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('invalid resource sampling options');
  const command = options.command ?? runCommand;
  const sleep = options.sleep ?? sleepDefault;
  const now = options.now ?? Date.now;
  const cpuUsage = options.cpuUsage ?? process.cpuUsage;
  const memoryUsage = options.memoryUsage ?? process.memoryUsage;
  if (options.startAt !== undefined) await sleep(Math.max(0, options.startAt - now()), options.signal);
  const monitor = (options.monitorFactory ?? createMonitor)();
  monitor.enable?.();
  let previousCpu = cpuUsage();
  let previousTime = now();
  const samples = [];
  const validityReasons = [];
  let nextSampleAt = (options.startAt ?? now()) + intervalMs;
  try {
    for (let index = 0; index < count && !options.signal?.aborted; index++) {
      await sleep(Math.max(0, nextSampleAt - now()), options.signal);
      const timestampMs = now();
      nextSampleAt += intervalMs;
      const currentCpu = cpuUsage();
      const elapsedMs = timestampMs - previousTime;
      const usedMicros = currentCpu.user + currentCpu.system - previousCpu.user - previousCpu.system;
      const runner = { cpuPercent: elapsedMs > 0 ? Math.max(0, usedMicros / (elapsedMs * 10)) : 0, rssBytes: memoryUsage().rss };
      let containers = { cpuPercent: 0, memoryBytes: 0, count: 0 };
      if (options.containerIds?.length) {
        try {
          const [executable, args] = dockerInvocation(['stats', '--no-stream', '--format', '{{json .}}', ...options.containerIds], options.dockerSshTarget);
          const response = await command(executable, args, { timeoutMs: 5_000 });
          containers = parseDockerStats(response.stdout, new Set(options.containerIds));
          if (containers.count !== options.containerIds.length) validityReasons.push(`sample ${index + 1}: missing container telemetry (${containers.count}/${options.containerIds.length})`);
        } catch (error) {
          validityReasons.push(`sample ${index + 1}: container probe failed: ${String(error?.message ?? error).slice(0, 300)}`);
        }
      }
      const hosts = {};
      for (const [name, probe] of [['runner', options.runnerHostProbe], ['backend', options.backendHostProbe]]) {
        if (typeof probe !== 'function') continue;
        try { hosts[name] = await probe(); }
        catch (error) { validityReasons.push(`sample ${index + 1}: ${name} host telemetry failed: ${String(error?.message ?? error).slice(0, 300)}`); }
      }
      const p99 = monitor.percentile(99) / 1e6;
      const max = (typeof monitor.max === 'function' ? monitor.max() : monitor.max) / 1e6;
      if (![runner.cpuPercent, runner.rssBytes, p99, max].every(value => Number.isFinite(value) && value >= 0)) validityReasons.push(`sample ${index + 1}: malformed runner telemetry`);
      samples.push({ timestampMs, runner, eventLoop: { p99Ms: Number.isFinite(p99) ? p99 : null, maxMs: Number.isFinite(max) ? max : null }, containers, hosts });
      options.onSample?.(samples.at(-1));
      try { options.onProgress?.(samples.length); } catch { /* diagnostic only */ }
      monitor.reset();
      previousCpu = currentCpu; previousTime = timestampMs;
    }
    if (!samples.length) validityReasons.push('resource samples unavailable');
    if (samples.length !== count) validityReasons.push(`resource samples incomplete (${samples.length}/${count})`);
    return { samples, valid: samples.length === count && validityReasons.length === 0, validityReasons };
  } finally { monitor.disable?.(); }
}

export function evaluateRunnerOverload(samples, thresholds = {}) {
  const cpu = thresholds.cpuPercent ?? 90;
  const p99 = thresholds.p99Ms ?? 100;
  const max = thresholds.maxMs ?? 250;
  const breachedForThree = metric => {
    for (let index = 0; index + 3 <= samples.length; index++) {
      if (samples.slice(index, index + 3).every(metric)) return true;
    }
    return false;
  };
  if (breachedForThree(sample => sample.runner.cpuPercent > cpu)
    || breachedForThree(sample => sample.eventLoop.p99Ms > p99)
    || breachedForThree(sample => sample.eventLoop.maxMs > max)) {
    return 'runner overload for three consecutive samples; backend capacity attribution invalid';
  }
  return null;
}

export async function collectRemoteResources(options) {
  const script = options.remoteScript ?? process.env.BAAS_BENCH_V4_TELEMETRY_SCRIPT;
  if (typeof script !== 'string' || !/^\/[A-Za-z0-9._/-]+$/.test(script) || script.split('/').some(part => part === '..' || part === '.')) throw new Error('invalid backend telemetry script');
  const count = options.samples;
  const intervalMs = options.intervalMs;
  const startAt = options.startAt ?? Date.now();
  if (!Number.isSafeInteger(count) || count < 1 || count > 720 || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || !Number.isSafeInteger(startAt) || startAt < 0 || !options.containerIds?.length || options.containerIds.some(id => !/^[0-9a-f]{12,64}$/.test(id))) throw new Error('invalid backend telemetry options');
  // One command per stage; docker and /proc sampling occur on the backend itself.
  const [exe, args] = dockerInvocation([], options.dockerSshTarget);
  if (exe !== 'ssh') throw new Error('backend telemetry requires SSH');
  args[args.length - 1] = `node ${shellQuote(script)} stream ${count} ${intervalMs} ${startAt} ${options.containerIds.join(' ')}`;
  const remotePromise = (options.command ?? runLongCommand)(exe, args, { timeoutMs: count * intervalMs + 30_000, captureOutput: true, signal: options.signal })
    .then(({ stdout }) => JSON.parse(stdout))
    .catch(() => ({ samples: [], valid: false, validityReasons: ['backend-local telemetry command failed'] }));
  const localPromise = (options.collectLocal ?? collectResources)({ samples: count, intervalMs, startAt, signal: options.signal, runnerHostProbe: () => sampleLocalHost(), onProgress: options.onProgress });
  const [local, remote] = await Promise.all([localPromise, remotePromise]);
  const reasons = [...local.validityReasons];
  if (local.samples.length !== count) reasons.push('coordinator telemetry missing samples');
  if (!Array.isArray(remote.samples) || remote.samples.length !== count || typeof remote.valid !== 'boolean' || !Array.isArray(remote.validityReasons)) reasons.push('backend-local telemetry missing or malformed');
  if (remote.valid !== true) reasons.push(...(Array.isArray(remote.validityReasons) ? remote.validityReasons : ['backend-local telemetry invalid']));
  for (let index = 0; index < local.samples.length; index++) {
    const row = remote.samples?.[index];
    const expectedAt = startAt + (index + 1) * intervalMs;
    const host = row?.hosts?.backend;
    const fields = { cpu: ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal', 'total'], memory: ['totalBytes', 'availableBytes', 'swapTotalBytes', 'swapFreeBytes'], network: ['rxBytes', 'txBytes', 'rxDrops', 'txDrops', 'interfaces'] };
    const hostValid = host && Object.entries(fields).every(([field, keys]) => keys.every(key => Number.isFinite(host[field]?.[key]) && host[field][key] >= 0));
    if (!row || !Number.isFinite(row.timestampMs) || row.containers?.count !== options.containerIds.length || ![row.containers.cpuPercent, row.containers.memoryBytes].every(value => Number.isFinite(value) && value >= 0) || !hostValid) {
      reasons.push(`sample ${index + 1}: backend-local telemetry missing or malformed`);
      continue;
    }
    if (Math.abs(row.timestampMs - expectedAt) >= intervalMs || Math.abs(local.samples[index].timestampMs - expectedAt) >= intervalMs) reasons.push(`sample ${index + 1}: telemetry alignment exceeded one interval`);
    Object.assign(local.samples[index], { containers: row.containers, backendTimestampMs: row.timestampMs, hosts: { ...local.samples[index].hosts, backend: row.hosts.backend } });
  }
  return { samples: local.samples, valid: local.valid && remote.valid === true && reasons.length === 0, validityReasons: reasons };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, count, interval, epoch, ...ids] = process.argv.slice(2);
  if (action !== 'stream' || ![count, interval, epoch].every(text => /^\d+$/.test(text ?? '')) || !ids.length || ids.some(id => !/^[0-9a-f]{12,64}$/.test(id)) || Number(count) < 1 || Number(count) > 720 || Number(interval) < 1 || Number(interval) > 60_000 || !Number.isSafeInteger(Number(epoch))) {
    console.error('invalid backend telemetry arguments'); process.exitCode = 1;
  } else {
    void collectResources({ samples: Number(count), intervalMs: Number(interval), startAt: Number(epoch), containerIds: ids, backendHostProbe: () => sampleLocalHost() })
      .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch(() => { console.error('backend-local telemetry failed'); process.exitCode = 1; });
  }
}
