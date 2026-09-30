import { spawn } from 'node:child_process';
import { spawnManaged, waitForChild } from './command.mjs';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const MAX_RUN_MS = 12 * 60 * 60 * 1_000;

export function runBench({ repositoryRoot, environment = {}, signal, spawnImpl = spawn, timeoutMs = MAX_RUN_MS } = {}) {
  if (!isAbsolute(repositoryRoot) || repositoryRoot.includes('\0') || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RUN_MS) throw new Error('invalid benchmark execution configuration');
  return Promise.resolve().then(async () => {
    signal?.throwIfAborted();
    const child = spawnManaged(join(repositoryRoot, 'bin/bench'), ['run', 'realworld-api-v4', 'project-management-capacity', 'supabase', 'javascript-sdk'], { cwd: repositoryRoot, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'], rootScope: true }, spawnImpl);
    const { stdout, stderr, code } = await waitForChild(child, { timeoutMs, signal, label: 'benchmark', maxBuffer: 1_000_000, tailOutput: true });
    if (code !== 0) throw new Error(`benchmark failed (${code}): ${stderr.trim().slice(-1200)}`);
    const path = stdout.trim().split(/\r?\n/).at(-1);
    if (!isAbsolute(path)) throw new Error('benchmark did not return an absolute evidence path');
    return path;
  });
}

export async function verifyPilotBundle(path) {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('invalid pilot evidence path');
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error('pilot evidence is not a directory');
  const manifest = JSON.parse(await readFile(join(path, 'run.json'), 'utf8'));
  if (manifest?.status !== 'complete' || manifest?.set !== 'realworld-api-v4' || manifest?.platform !== 'supabase' || manifest?.variant !== 'javascript-sdk' || manifest?.lifecycle?.start !== 'complete' || manifest?.lifecycle?.setup !== 'complete' || manifest?.lifecycle?.teardown !== 'complete' || manifest?.lifecycle?.stop !== 'complete') throw new Error('pilot evidence lifecycle is incomplete');
  return resolve(path);
}
