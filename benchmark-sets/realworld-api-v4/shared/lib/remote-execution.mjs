import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCommand, spawnManaged, waitForChild } from './command.mjs';
import { sshTransportArgs } from './ssh-config.mjs';
import { verifyTransferManifest } from './transfer.mjs';
import { emitProgress, progressDecoder, createProgress } from './progress.mjs';

const PLATFORMS = new Set(['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon']);
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5'];
const MAX_RUN_MS = 4 * 60 * 60 * 1_000;
const safeTarget = value => typeof value === 'string' && /^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value);
const safePath = value => typeof value === 'string' && isAbsolute(value) && /^\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes('//') && !value.endsWith('/') && !value.split('/').some(part => part === '.' || part === '..');
const safeLocalPath = value => typeof value === 'string' && isAbsolute(value) && !value.includes('\0') && !value.split('/').includes('..');

export function runLongCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? MAX_RUN_MS;
  if (!/^[A-Za-z0-9._/-]+$/.test(command) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RUN_MS) throw new Error('invalid long command');
  return Promise.resolve().then(async () => {
    options.signal?.throwIfAborted();
    const transportArgs = await sshTransportArgs(command, args, options.env ?? process.env);
    const child = spawnManaged(command, transportArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: options.env, cwd: options.cwd });
    const { code, signal } = await waitForChild(child, { timeoutMs, signal: options.signal, label: 'remote command', tailOutput: true, onStderr: progressDecoder(event => { if (event.source === 'runner') emitProgress(event); }) });
    if (code !== 0) throw new Error(`remote command failed${code === null ? ` (${signal ?? 'signal'})` : ` (${code})`}`);
    return { stdout: '', stderr: '' };
  });
}

function attachSecondary(primary, key, error) {
  if (primary && (typeof primary === 'object' || typeof primary === 'function')) {
    try { primary[key] = String(error?.message ?? error).slice(0, 300); } catch { /* preserve the primary error */ }
  }
}

export async function runRemoteTrial(context, dependencies = {}) {
  const { target, platform, phase, trial, outputDir, remoteRoot, remoteRuntime } = context;
  if (!safeTarget(target) || !PLATFORMS.has(platform) || phase !== 'measure' || !Number.isSafeInteger(trial) || trial < 1 || !safeLocalPath(outputDir) || !safePath(remoteRoot) || !safePath(remoteRuntime)) throw new Error('invalid remote trial context');
  const timeoutMs = context.timeoutMs ?? MAX_RUN_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RUN_MS) throw new Error('invalid remote run timeout');
  const command = dependencies.runCommand ?? runCommand;
  const longCommand = dependencies.runLongCommand ?? runLongCommand;
  const ssh = (remoteCommand, timeout = 30_000) => command('ssh', [...SSH_OPTIONS, target, remoteCommand], { timeoutMs: timeout });
  const progress = createProgress('lifecycle');
  let remoteOutput;
  let primary;
  let transferred = false;
  try {
    try {
      const { stdout } = await ssh('umask 077 && mktemp -d /tmp/baas-bench-v4.XXXXXX', 15_000);
      const candidate = String(stdout).trim();
      if (!/^\/tmp\/baas-bench-v4\.[A-Za-z0-9]{6}$/.test(candidate)) throw new Error('remote runner returned an invalid output path');
      remoteOutput = candidate;
    } catch (error) { primary = error; }

    if (remoteOutput) {
      progress.phase('run');
      const remoteCommand = `umask 077 && BAAS_BENCH_V4_PROGRESS_FD=2 BAAS_BENCH_ROOT=${remoteRoot} BAAS_BENCH_RUNTIME=${remoteRuntime} BAAS_BENCH_V4_REMOTE_CONFIG=${remoteRuntime}/remote-config.json node ${remoteRuntime}/lib/remote-run.mjs ${platform} ${phase} ${trial} ${remoteOutput}`;
      try { await longCommand('ssh', [...SSH_OPTIONS, target, remoteCommand], { timeoutMs, signal: context.signal }); }
      catch (error) { primary = error; }

      try {
        progress.phase('transfer');
        await ssh(`node ${remoteRuntime}/lib/transfer.mjs seal ${remoteOutput}`, 300_000);
        await command('rsync', ['-a', '--', `${target}:${remoteOutput}/`, `${outputDir}/`], { timeoutMs: 300_000 });
        await verifyTransferManifest(outputDir);
        transferred = true;
      } catch (error) {
        if (!primary) primary = error;
        else attachSecondary(primary, 'transferError', error);
      }
    }
  } finally {
    if (remoteOutput) {
      try { await ssh(`rm -rf -- ${remoteOutput}`, 30_000); }
      catch (error) { if (!primary) primary = error; else attachSecondary(primary, 'cleanupError', error); }
    }
  }
  progress.phase(primary ? 'failed' : 'complete');
  progress.stop();
  if (primary) throw primary;
  return { transferred, remoteOutputDir: remoteOutput };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [platform, phase, trialText, outputDir, target, remoteRoot] = process.argv.slice(2);
  const runtime = remoteRoot && `${remoteRoot}/.runtime/benchmarks/realworld-api-v4`;
  if (!runtime || process.argv.length !== 8 || !/^[1-9]\d*$/.test(trialText)) {
    console.error('usage: remote-execution.mjs <platform> <phase> <trial> <output-dir> <runner-target> <runner-root>');
    process.exitCode = 2;
  } else {
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    void runRemoteTrial({ platform, phase, trial: Number(trialText), outputDir, target, remoteRoot, remoteRuntime: runtime, signal: abort.signal })
      .catch(error => { console.error(String(error?.message ?? error).slice(0, 300)); process.exitCode = 1; })
      .finally(() => { process.off('SIGINT', stop); process.off('SIGTERM', stop); });
  }
}
