import { readFile } from 'node:fs/promises';
import { runCommand } from './command.mjs';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
const validTarget = value => typeof value === 'string' && /^([A-Za-z0-9][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value);

function counters(line) {
  const values = String(line ?? '').trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 8 || values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('invalid host CPU counters');
  const [user, nice, system, idle, iowait, irq, softirq, steal] = values;
  return { user, nice, system, idle, iowait, irq, softirq, steal, total: values.reduce((sum, value) => sum + value, 0) };
}

function meminfo(text) {
  const values = Object.fromEntries(String(text).split(/\r?\n/).map(line => line.match(/^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB$/)).filter(Boolean).map(([, key, value]) => [key, Number(value) * 1024]));
  if (!Object.values(values).every(Number.isSafeInteger)) throw new Error('invalid host memory counters');
  return { totalBytes: values.MemTotal, availableBytes: values.MemAvailable, swapTotalBytes: values.SwapTotal, swapFreeBytes: values.SwapFree };
}

function network(text) {
  let rxBytes = 0; let txBytes = 0; let rxDrops = 0; let txDrops = 0; let interfaces = 0;
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.+)$/);
    if (!match || match[1] === 'lo') continue;
    const values = match[2].trim().split(/\s+/).map(Number);
    if (values.length < 12 || values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('invalid host network counters');
    rxBytes += values[0]; rxDrops += values[3]; txBytes += values[8]; txDrops += values[11]; interfaces++;
  }
  if (!interfaces) throw new Error('host network interface counters are unavailable');
  return { rxBytes, txBytes, rxDrops, txDrops, interfaces };
}

export function parseHostTelemetry({ stat, meminfo: memory, netdev }) {
  const cpuLine = String(stat).split(/\r?\n/).find(line => /^cpu\s/.test(line));
  return { cpu: counters(cpuLine), memory: meminfo(memory), network: network(netdev) };
}

export async function sampleLocalHost(read = readFile) {
  const [stat, memory, netdev] = await Promise.all(['/proc/stat', '/proc/meminfo', '/proc/net/dev'].map(path => read(path, 'utf8')));
  return parseHostTelemetry({ stat, meminfo: memory, netdev });
}

export async function sampleRemoteHost(target, command = runCommand) {
  if (!validTarget(target)) throw new Error('invalid host telemetry SSH target');
  const { stdout } = await command('ssh', [...SSH_OPTIONS, target, "cat /proc/stat; printf '\\036'; cat /proc/meminfo; printf '\\036'; cat /proc/net/dev"], { timeoutMs: 5_000 });
  const parts = stdout.split('\x1e');
  if (parts.length !== 3) throw new Error('invalid remote host telemetry response');
  return parseHostTelemetry({ stat: parts[0], meminfo: parts[1], netdev: parts[2] });
}
