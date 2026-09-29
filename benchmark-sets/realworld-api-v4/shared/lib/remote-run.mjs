import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyRemoteConfig } from './remote-config.mjs';

export async function loadRemoteConfig(path, platform, env = process.env) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) throw new Error('remote config path must be absolute');
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('remote config permissions must be 0600');
  const config = JSON.parse(await readFile(path, 'utf8'));
  applyRemoteConfig(config, platform, env);
  const ca = await stat(config.ca_file);
  if (!ca.isFile() || ca.size === 0) throw new Error('private CA certificate is missing');
  return config;
}

export async function runRemote(args, io = {}) {
  if (args.length !== 4) throw new Error('usage: remote-run.mjs <platform> <phase> <trial> <absolute-output-dir>');
  const [platform, phase, trial, outputDir] = args;
  if (!['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon'].includes(platform)) throw new Error('invalid platform');
  if (phase !== 'measure' || !/^[1-9]\d*$/.test(trial) || !isAbsolute(outputDir)) throw new Error('invalid remote run context');
  const configPath = process.env.BAAS_BENCH_V4_REMOTE_CONFIG;
  if (!configPath) throw new Error('BAAS_BENCH_V4_REMOTE_CONFIG is required');
  await loadRemoteConfig(configPath, platform);
  const script = new URL('./run.mjs', import.meta.url);
  const child = (io.spawn ?? spawn)(process.execPath, [script.pathname, ...args], { env: process.env, stdio: 'ignore' });
  const forward = signal => { if (!child.killed) child.kill(signal); };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  try {
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (value, signal) => resolveExit(value ?? (signal ? 128 : 1)));
    });
    if (code !== 0) throw new Error(`remote runner exited with status ${code}`);
  } finally {
    process.off('SIGINT', forward);
    process.off('SIGTERM', forward);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runRemote(process.argv.slice(2)).catch(error => { console.error(String(error?.message ?? error).slice(0, 300)); process.exitCode = 1; });
}
