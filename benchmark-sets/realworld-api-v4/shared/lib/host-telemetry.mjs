import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
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

export async function captureHostFailure(target, command = runCommand) {
  if (!validTarget(target)) throw new Error('invalid failure diagnostics SSH target');
  const script = `printf 'timestamp\\n'; date -u '+%Y-%m-%dT%H:%M:%SZ'
printf 'kernel/ssh-version\\n'; uname -r; ssh -V 2>&1
printf 'load/memory\\n'; cat /proc/loadavg; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo
printf 'disk/connections\\n'; df -Pk /; ss -s
printf 'sshd-policy\\n'; sshd -T | grep -E '^(maxstartups|persourcemaxstartups|persourcepenalties|maxsessions|logingracetime|clientaliveinterval|clientalivecountmax|usedns|tcpkeepalive|kexalgorithms) '
printf 'sshd-journal\\n'; journalctl -u ssh --since '-30 minutes' --no-pager -n 80 | grep -E 'Accepted publickey|Connection|Disconnected|Timeout|fatal|error' || true
printf 'kernel-pressure\\n'; journalctl -k --since '-30 minutes' --no-pager -n 200 | grep -Ei 'out of memory|oom-kill|killed process|conntrack.*full' || true
printf 'container-health\\n'; docker ps -a --filter label=com.docker.compose.project=baas-supabase --format '{{.Names}} {{.Status}}'
`;
  const { stdout } = await command('ssh', [...SSH_OPTIONS, target, script], { timeoutMs: 10_000 });
  return stdout.slice(0, 32_768);
}

export async function sampleRemoteHost(target, command = runCommand) {
  if (!validTarget(target)) throw new Error('invalid host telemetry SSH target');
  const { stdout } = await command('ssh', [...SSH_OPTIONS, target, "cat /proc/stat; printf '\\036'; cat /proc/meminfo; printf '\\036'; cat /proc/net/dev"], { timeoutMs: 5_000 });
  const parts = stdout.split('\x1e');
  if (parts.length !== 3) throw new Error('invalid remote host telemetry response');
  return parseHostTelemetry({ stat: parts[0], meminfo: parts[1], netdev: parts[2] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, target, ...extra] = process.argv.slice(2);
  if (action !== 'diagnose' || !target || extra.length) { console.error('usage: host-telemetry.mjs diagnose <backend-target>'); process.exitCode = 2; }
  else captureHostFailure(target).then(output => process.stderr.write(`V4 backend failure snapshot\n${output}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
