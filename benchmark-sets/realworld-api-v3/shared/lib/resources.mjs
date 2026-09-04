import { monitorEventLoopDelay } from 'node:perf_hooks';
import { runCommand } from './command.mjs';

const PLATFORMS = new Set(['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon']);
const byteUnits = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, KB: 1_000, MB: 1_000_000, GB: 1_000_000_000 };

function bytes(text) {
  const match = String(text).trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB)$/i);
  if (!match) return null;
  const unit = Object.keys(byteUnits).find(key => key.toLowerCase() === match[2].toLowerCase());
  const value = Number(match[1]) * byteUnits[unit];
  return Number.isSafeInteger(Math.round(value)) ? Math.round(value) : null;
}

export async function discoverPlatformContainers(platform, command = runCommand) {
  if (!PLATFORMS.has(platform)) throw new Error('invalid platform');
  const { stdout } = await command('docker', ['compose', '-p', `baas-${platform}`, 'ps', '-q'], { timeoutMs: 5_000 });
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
  const count = options.samples ?? 300;
  const intervalMs = options.intervalMs ?? 1_000;
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('invalid resource sampling options');
  const command = options.command ?? runCommand;
  const sleep = options.sleep ?? sleepDefault;
  const now = options.now ?? Date.now;
  const cpuUsage = options.cpuUsage ?? process.cpuUsage;
  const memoryUsage = options.memoryUsage ?? process.memoryUsage;
  const monitor = (options.monitorFactory ?? createMonitor)();
  monitor.enable?.();
  let previousCpu = cpuUsage();
  let previousTime = now();
  const samples = [];
  const validityReasons = [];
  try {
    for (let index = 0; index < count && !options.signal?.aborted; index++) {
      await sleep(intervalMs, options.signal);
      const timestampMs = now();
      const currentCpu = cpuUsage();
      const elapsedMs = timestampMs - previousTime;
      const usedMicros = currentCpu.user + currentCpu.system - previousCpu.user - previousCpu.system;
      const runner = { cpuPercent: elapsedMs > 0 ? Math.max(0, usedMicros / (elapsedMs * 10)) : 0, rssBytes: memoryUsage().rss };
      let containers = { cpuPercent: 0, memoryBytes: 0, count: 0 };
      if (options.containerIds?.length) {
        try {
          const response = await command('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...options.containerIds], { timeoutMs: 5_000 });
          containers = parseDockerStats(response.stdout, new Set(options.containerIds));
          if (containers.count !== options.containerIds.length) validityReasons.push(`sample ${index + 1}: missing container telemetry (${containers.count}/${options.containerIds.length})`);
        } catch (error) {
          validityReasons.push(`sample ${index + 1}: container probe failed: ${String(error?.message ?? error).slice(0, 300)}`);
        }
      }
      const p99 = monitor.percentile(99) / 1e6;
      const max = (typeof monitor.max === 'function' ? monitor.max() : monitor.max) / 1e6;
      samples.push({ timestampMs, runner, eventLoop: { p99Ms: Number.isFinite(p99) ? p99 : null, maxMs: Number.isFinite(max) ? max : null }, containers });
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
