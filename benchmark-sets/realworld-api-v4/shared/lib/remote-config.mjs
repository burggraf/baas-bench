import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const PLATFORMS = new Set(['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon']);
const PLATFORM_ENV = Object.freeze({
  supabase: ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'],
  convex: ['CONVEX_URL', 'CONVEX_AUTH_ISSUER'],
  appwrite: ['APPWRITE_URL', 'APPWRITE_PROJECT_ID', 'APPWRITE_DATABASE_ID'],
  nhost: ['NHOST_AUTH_URL', 'NHOST_GRAPHQL_URL', 'NHOST_SUBDOMAIN', 'NHOST_REGION'],
  directus: ['DIRECTUS_URL'],
  pocketbase: ['POCKETBASE_URL'],
  trailbase: ['TRAILBASE_URL'],
  neon: ['NEON_PROXY_URL', 'NEON_DATABASE_URL', 'NEON_PROXY_CA'],
});
const HTTPS_KEYS = new Set(['SUPABASE_URL', 'CONVEX_URL', 'CONVEX_AUTH_ISSUER', 'APPWRITE_URL', 'NHOST_AUTH_URL', 'NHOST_GRAPHQL_URL', 'DIRECTUS_URL', 'POCKETBASE_URL', 'TRAILBASE_URL', 'NEON_PROXY_URL']);
const validTarget = value => typeof value === 'string' && /^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value);
const safeLocalPath = value => typeof value === 'string' && value.startsWith('/') && !value.includes('\0') && !value.split('/').includes('..');
const safeRemotePath = value => typeof value === 'string' && value.startsWith('/') && !value.includes('//') && !value.endsWith('/') && value.split('/').every(part => part !== '.' && part !== '..' && [...part].every(char => /[A-Za-z0-9._-]/.test(char)));

function isPrivateIpv4(value) {
  if (isIP(value) !== 4) return false;
  const [first, second] = value.split('.').map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168 && Number(value.split('.')[2]) < 128);
}

function isHttpsEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

export function applyRemoteConfig(config, platform, env = process.env) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.schema_version !== 1 || config.platform !== platform || !PLATFORMS.has(platform)) throw new Error('invalid remote runner config');
  if (!validTarget(config.docker_ssh_target)) throw new Error('invalid SSH target');
  if (typeof config.ca_file !== 'string' || !safeRemotePath(config.ca_file)) throw new Error('invalid TLS CA path');
  if (!config.env || typeof config.env !== 'object' || Array.isArray(config.env)) throw new Error('invalid remote environment');
  const allowed = new Set(PLATFORM_ENV[platform]);
  for (const [key, value] of Object.entries(config.env)) {
    if (!allowed.has(key)) throw new Error(`remote environment key not allowed: ${key}`);
    if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\r') || value.includes('\n') || value.includes('\0')) throw new Error(`invalid remote environment value: ${key}`);
    if (HTTPS_KEYS.has(key) && !isHttpsEndpoint(value)) throw new Error(`${key} must use HTTPS`);
    env[key] = value;
  }
  if (!Object.keys(config.env).some(key => HTTPS_KEYS.has(key))) throw new Error('remote config needs an HTTPS endpoint');
  env.NODE_EXTRA_CA_CERTS = config.ca_file;
  env.BAAS_BENCH_DOCKER_SSH_TARGET = config.docker_ssh_target;
  return env;
}

async function readSupabasePublicKey(path) {
  const lines = (await readFile(path, 'utf8')).split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
  const matches = lines.filter(line => line.startsWith('SUPABASE_PUBLISHABLE_KEY='));
  if (matches.length !== 1) throw new Error('Supabase publishable key is missing or duplicated');
  let value = matches[0].slice('SUPABASE_PUBLISHABLE_KEY='.length);
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  if (!value || value.length > 4096 || value.includes('\r') || value.includes('\n') || value.includes('\0')) throw new Error('invalid Supabase publishable key');
  return value;
}

export async function createRemoteConfig({ platform, runtime, runnerRoot, backendAddress, dockerSshTarget, publishableKey }) {
  if (platform !== 'supabase' || !safeLocalPath(runtime) || !safeRemotePath(runnerRoot) || !isPrivateIpv4(backendAddress) || !validTarget(dockerSshTarget) || typeof publishableKey !== 'string' || !publishableKey || publishableKey.length > 4096 || /[\r\n\0]/.test(publishableKey)) throw new Error('invalid Supabase private IPv4 remote configuration');
  const config = {
    schema_version: 1,
    platform,
    docker_ssh_target: dockerSshTarget,
    ca_file: join(runnerRoot, '.runtime/benchmarks/realworld-api-v4/ca.pem'),
    env: { SUPABASE_URL: `https://${backendAddress}:8443`, SUPABASE_PUBLISHABLE_KEY: publishableKey },
  };
  applyRemoteConfig(config, platform, {});
  await writeFile(join(runtime, 'remote-config.json'), `${JSON.stringify(config)}\n`, { mode: 0o600 });
  await chmod(join(runtime, 'remote-config.json'), 0o600);
  return config;
}

export async function prepareRemoteConfig({ platform, runtime, repoRoot, runnerRoot }) {
  if (!PLATFORMS.has(platform) || !safeLocalPath(runtime) || !safeLocalPath(repoRoot) || !safeRemotePath(runnerRoot)) throw new Error('invalid remote setup paths');
  const remoteRuntime = join(runnerRoot, '.runtime/benchmarks/realworld-api-v4');
  const configPath = join(runtime, 'remote-config.json');
  const info = await stat(configPath);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('remote config permissions must be 0600');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config?.platform !== platform || config.ca_file !== join(remoteRuntime, 'ca.pem')) throw new Error('remote config does not match this runner');
  const caInfo = await stat(join(runtime, 'ca.pem'));
  if (!caInfo.isFile() || caInfo.size === 0) throw new Error('private CA certificate is missing');
  config.env ??= {};
  if (platform === 'supabase' && !config.env.SUPABASE_PUBLISHABLE_KEY) config.env.SUPABASE_PUBLISHABLE_KEY = await readSupabasePublicKey(join(repoRoot, '.runtime/supabase/docker/.env'));
  if (platform === 'neon') config.env.NEON_PROXY_CA = config.ca_file;
  applyRemoteConfig(config, platform, {});
  await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, ...args] = process.argv.slice(2);
  let task;
  if (action === 'prepare' && args.length === 4) {
    const [platform, runtime, repoRoot, runnerRoot] = args;
    task = prepareRemoteConfig({ platform, runtime, repoRoot, runnerRoot });
  } else if (action === 'create' && args.length === 5) {
    const [platform, runtime, runnerRoot, backendAddress, dockerSshTarget] = args;
    task = readFile(0, 'utf8').then(publishableKey => createRemoteConfig({ platform, runtime, runnerRoot, backendAddress, dockerSshTarget, publishableKey: publishableKey.trim() }));
  } else {
    console.error('usage: remote-config.mjs {prepare <platform> <runtime> <repository-root> <runner-root>|create <platform> <runtime> <runner-root> <backend-private-ip> <backend-docker-ssh-target> < publishable-key}');
    process.exitCode = 2;
  }
  if (task) void task.catch(error => { console.error(String(error?.message ?? error).slice(0, 300)); process.exitCode = 1; });
}
