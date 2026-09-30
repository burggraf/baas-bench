import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const safePath = value => typeof value === 'string' && /^\/[A-Za-z0-9._/-]+$/.test(value) && !value.split('/').some(part => part === '.' || part === '..') && !value.includes('//');
function configText(directory, runner = false) {
  return `Host *\n  BatchMode yes\n  HostKeyAlgorithms ssh-ed25519\n  StrictHostKeyChecking ${runner ? 'yes' : 'accept-new'}\n  UserKnownHostsFile "${join(directory, 'known_hosts')}"\n  GlobalKnownHostsFile /dev/null\n  HashKnownHosts no\n  UpdateHostKeys no\n${runner ? `  IdentityFile "${join(directory, 'id_ed25519')}"\n  IdentitiesOnly yes\n` : ''}`;
}
async function privateFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o777) !== 0o600) throw new Error('V4 SSH files must be private regular files (0600)');
}
export async function validateSshConfig(path, { runner = false } = {}) {
  if (!safePath(path) || !path.endsWith('/ssh_config') || path.split('/').includes('.ssh')) throw new Error('V4 remote commands require a generated private SSH config path');
  const directory = dirname(path);
  const info = await lstat(directory);
  if (!info.isDirectory() || (info.mode & 0o777) !== 0o700) throw new Error('V4 SSH directory must be private (0700)');
  await privateFile(path);
  await privateFile(join(directory, 'known_hosts'));
  const text = await readFile(path, 'utf8');
  if (runner) {
    if (text !== configText(directory, true)) throw new Error('invalid pinned runner SSH config policy');
    await privateFile(join(directory, 'id_ed25519'));
    if (!(await readFile(join(directory, 'known_hosts'), 'utf8')).trim()) throw new Error('runner SSH backend pin is missing');
  } else if (text !== configText(directory) && text !== configText(directory, true)) throw new Error('invalid V4 SSH config policy');
  return path;
}
export async function createSshConfig() {
  const directory = await mkdtemp(join(tmpdir(), 'baas-bench-v4-ssh-'));
  try {
    if (!safePath(directory)) throw new Error('invalid V4 SSH state path');
    await chmod(directory, 0o700);
    const configPath = join(directory, 'ssh_config');
    const knownHostsPath = join(directory, 'known_hosts');
    await writeFile(knownHostsPath, '', { mode: 0o600 });
    await writeFile(configPath, configText(directory), { mode: 0o600 });
    return { directory, configPath, knownHostsPath, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    try { await rm(directory, { recursive: true, force: true }); }
    catch (cleanup) { try { error.sshConfigCleanupError = String(cleanup.message).slice(0, 300); } catch { /* preserve primary */ } }
    throw error;
  }
}
export async function sshTransportArgs(command, args, env) {
  const name = command.split('/').at(-1);
  const remoteRsync = name === 'rsync' && args.some(arg => /^[A-Za-z0-9_.@-]+:/.test(arg));
  if (name !== 'ssh' && !remoteRsync) return args;
  const config = await validateSshConfig(env.BAAS_BENCH_V4_SSH_CONFIG);
  if (name === 'ssh') {
    if (args.includes('-F')) throw new Error('V4 SSH config transport cannot be overridden');
    return ['-F', config, ...args];
  }
  if (args.some(arg => arg === '-e' || arg === '--rsh' || arg.startsWith('--rsh='))) throw new Error('V4 rsync SSH transport cannot be overridden');
  return ['-e', `ssh -F ${config}`, ...args];
}
export async function bindBackend(configPath, { publicIpv4, privateIpv4 }) {
  await validateSshConfig(configPath);
  if (isIP(publicIpv4) !== 4 || isIP(privateIpv4) !== 4) throw new Error('invalid provisioned backend addresses');
  const path = join(dirname(configPath), 'backend.json');
  await writeFile(path, JSON.stringify({ publicIpv4, privateIpv4 }), { mode: 0o600, flag: 'wx' });
}
export async function prepareRunnerSsh({ configPath, backendTarget, backendPrivateIp, runnerRoot }) {
  await validateSshConfig(configPath);
  if (!safePath(runnerRoot) || typeof backendTarget !== 'string' || !/^(?:[A-Za-z0-9_.-]+@)?[0-9.]+$/.test(backendTarget)) throw new Error('invalid runner SSH paths or backend target');
  const directory = dirname(configPath);
  const bindingPath = join(directory, 'backend.json');
  await privateFile(bindingPath);
  const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
  const backendHost = backendTarget.split('@').at(-1);
  if (backendHost !== binding.publicIpv4 || backendPrivateIp !== binding.privateIpv4) throw new Error('backend addresses do not match the provisioned observation');
  // Pin only keys already authenticated by the observation's controller connection.
  const keys = (await readFile(join(directory, 'known_hosts'), 'utf8')).split('\n').filter(line => !line.startsWith('#')).map(line => line.trim().split(/\s+/)).filter(([hosts]) => hosts?.split(',').includes(backendHost));
  if (!keys.length || keys.some(([, type, key]) => type !== 'ssh-ed25519' || !/^[A-Za-z0-9+/=]+$/.test(key ?? '')) || new Set(keys.map(([, type]) => type)).size !== keys.length) throw new Error('missing or ambiguous authenticated backend host key');
  const remoteDirectory = join(runnerRoot, '.runtime/benchmarks/realworld-api-v4');
  const knownHostsPath = join(directory, 'runner_known_hosts');
  const runnerConfigPath = join(directory, 'runner_ssh_config');
  await writeFile(knownHostsPath, keys.map(([, type, key]) => `${backendPrivateIp} ${type} ${key}\n`).join(''), { mode: 0o600 });
  await writeFile(runnerConfigPath, configText(remoteDirectory, true), { mode: 0o600 });
  await chmod(knownHostsPath, 0o600);
  await chmod(runnerConfigPath, 0o600);
  return { knownHostsPath, configPath: runnerConfigPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, ...args] = process.argv.slice(2);
  let work;
  if (action === 'validate' && args.length === 1) work = validateSshConfig(args[0]);
  else if (action === 'create' && args.length === 0) work = createSshConfig().then(state => console.log(state.configPath));
  else if (action === 'bind' && args.length === 3) work = bindBackend(args[0], { publicIpv4: args[1], privateIpv4: args[2] });
  else if (action === 'runner' && args.length === 4) work = prepareRunnerSsh({ configPath: args[0], backendTarget: args[1], backendPrivateIp: args[2], runnerRoot: args[3] });
  else { console.error('usage: ssh-config.mjs {create|validate <config>|bind <config> <backend-public-ip> <backend-private-ip>|runner <config> <backend-target> <backend-private-ip> <runner-root>}'); process.exitCode = 2; }
  if (work) void work.catch(error => { console.error(error.message); process.exitCode = 1; });
}
