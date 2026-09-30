import { isAbsolute } from 'node:path';
import { runCommand } from './command.mjs';
import { bootstrapHosts } from './remote-bootstrap.mjs';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new'];
const validTarget = value => typeof value === 'string' && /^([A-Za-z0-9][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value);
const validIp = value => typeof value === 'string' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) && value.split('.').every(part => Number(part) <= 255);
const safeRoot = value => typeof value === 'string' && isAbsolute(value) && /^\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes('//') && !value.endsWith('/') && !value.split('/').some(part => part === '.' || part === '..');

function targets(inventory) {
  const backend = inventory?.resources?.backend;
  const runner = inventory?.resources?.runner;
  if (!validIp(backend?.publicIpv4) || !validIp(runner?.publicIpv4) || !validIp(backend?.privateIpv4) || !validIp(runner?.privateIpv4)) throw new Error('inventory is missing host IP addresses');
  return { backend: `root@${backend.publicIpv4}`, runner: `root@${runner.publicIpv4}`, backendPrivate: backend.privateIpv4 };
}

export async function inspectHost(target, command = runCommand, signal) {
  if (!validTarget(target) || typeof command !== 'function') throw new Error('invalid host provenance probe');
  const script = "set -eu; systemctl is-active --quiet docker; printf 'architecture\\t'; uname -m; printf 'kernel\\t'; uname -r; printf 'node\\t'; node -p 'process.versions.node'; printf 'docker\\t'; docker version --format '{{.Server.Version}}'; printf 'compose\\t'; docker compose version --short; df -Pk / | awk 'NR == 2 { print \"disk_kib\\t\" $2; print \"free_kib\\t\" $4 }'";
  const { stdout } = await command('ssh', [...SSH_OPTIONS, target, script], { timeoutMs: 30_000, signal });
  const values = Object.fromEntries(String(stdout).trim().split(/\r?\n/).map(line => line.split('\t')).filter(([key, value, extra]) => !extra && /^[a-z_]+$/.test(key) && /^[A-Za-z0-9._:+-]+$/.test(value)));
  if (!/^[A-Za-z0-9_-]+$/.test(values.architecture ?? '') || !/^[A-Za-z0-9._+-]+$/.test(values.kernel ?? '') || !/^\d+\.\d+\.\d+$/.test(values.node ?? '') || !/^\d+\.\d+\.\d+$/.test(values.docker ?? '') || !/^\d+\.\d+\.\d+$/.test(values.compose ?? '') || !/^\d+$/.test(values.disk_kib ?? '') || !/^\d+$/.test(values.free_kib ?? '')) throw new Error('invalid host provenance output');
  return { architecture: values.architecture, kernel: values.kernel, node: values.node, docker: values.docker, compose: values.compose, diskKiB: Number(values.disk_kib), freeKiB: Number(values.free_kib), dockerService: 'active' };
}

export async function bootstrapAndDeploy({ inventory, repositoryRoot, backendRoot, runnerRoot, script, runnerKeyFile, signal, command = runCommand, bootstrap = bootstrapHosts, healthProbe = inspectHost, onPhase = () => {} }) {
  if (!safeRoot(repositoryRoot) || !safeRoot(backendRoot) || !safeRoot(runnerRoot) || typeof runnerKeyFile !== 'string' || !isAbsolute(runnerKeyFile) || runnerKeyFile.includes('\0')) throw new Error('invalid observation deployment configuration');
  const hosts = targets(inventory);
  if (!validTarget(hosts.backend) || !validTarget(hosts.runner)) throw new Error('invalid observation host target');
  await bootstrap({ backendTarget: hosts.backend, runnerTarget: hosts.runner, script, signal, command });
  try { onPhase('deployment'); } catch { /* diagnostic only */ }
  for (const [target, root] of [[hosts.backend, backendRoot], [hosts.runner, runnerRoot]]) {
    signal?.throwIfAborted();
    await command('ssh', [...SSH_OPTIONS, target, `umask 077 && mkdir -p '${root}' && chmod 700 '${root}'`], { timeoutMs: 30_000, signal });
    await command('rsync', ['-a', '--delete', '--exclude', '.linode.env', '--exclude', '.git', '--exclude', '.runtime', '--exclude', '.results', '--exclude', 'results', '--exclude', 'node_modules', '--', `${repositoryRoot}/`, `${target}:${root}/`], { timeoutMs: 600_000, signal });
    await command('ssh', [...SSH_OPTIONS, target, `cd '${root}' && test -x ./bin/baas && test -f ./benchmark-sets/realworld-api-v4/shared/package-lock.json`], { timeoutMs: 30_000, signal });
  }
  const environment = {
    BAAS_BENCH_V4_BACKEND_TARGET: hosts.backend,
    BAAS_BENCH_V4_BACKEND_ROOT: backendRoot,
    BAAS_BENCH_V4_BACKEND_PRIVATE_IP: hosts.backendPrivate,
    BAAS_BENCH_V4_BACKEND_DOCKER_SSH_TARGET: `root@${hosts.backendPrivate}`,
    BAAS_BENCH_V4_RUNNER_TARGET: hosts.runner,
    BAAS_BENCH_V4_RUNNER_ROOT: runnerRoot,
    BAAS_BENCH_V4_RUNNER_SSH_KEY_FILE: runnerKeyFile,
  };
  return { environment, hostProvenance: { backend: await healthProbe(hosts.backend, command, signal), runner: await healthProbe(hosts.runner, command, signal) } };
}
