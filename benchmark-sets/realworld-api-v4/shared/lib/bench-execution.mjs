import { spawn } from 'node:child_process';
import { runCommand, spawnManaged, waitForChild } from './command.mjs';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { progressDecoder } from './progress.mjs';
import { verifyTransferManifest } from './transfer.mjs';

const MAX_RUN_MS = 12 * 60 * 60 * 1_000;

export async function preflightPilot({ repositoryRoot, command = runCommand }) {
  if (!isAbsolute(repositoryRoot ?? '') || repositoryRoot.includes('\0')) throw new Error('invalid pilot repository path');
  const options = { cwd: repositoryRoot, timeoutMs: 30_000 };
  await command('sh', ['-c', 'for tool in git jq ssh rsync node; do command -v "$tool" >/dev/null || { printf "missing controller tool: %s\\n" "$tool" >&2; exit 1; }; done; command -v shasum >/dev/null || command -v sha256sum >/dev/null'], options);
  await command(join(repositoryRoot, 'bin/bench'), ['validate', 'realworld-api-v4/project-management-capacity/supabase/javascript-sdk'], options);
  const { stdout } = await command('git', ['-C', repositoryRoot, 'status', '--porcelain', '--', 'benchmark-sets/realworld-api-v4', 'bin/baas', 'bin/bench', 'bin/bench-v4-linode.mjs'], options);
  if (stdout.trim()) throw new Error('V4 pilot definitions or launch scripts are dirty; commit them before provisioning');
}

export function runBench({ repositoryRoot, environment = {}, signal, spawnImpl = spawn, timeoutMs = MAX_RUN_MS, onProgress = () => {} } = {}) {
  if (!isAbsolute(repositoryRoot) || repositoryRoot.includes('\0') || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RUN_MS) throw new Error('invalid benchmark execution configuration');
  return Promise.resolve().then(async () => {
    signal?.throwIfAborted();
    const child = spawnManaged(join(repositoryRoot, 'bin/bench'), ['run', 'realworld-api-v4', 'project-management-capacity', 'supabase', 'javascript-sdk'], { cwd: repositoryRoot, env: { ...process.env, ...environment, BAAS_BENCH_V4_PROGRESS_FD: '3' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], rootScope: true }, spawnImpl);
    const decode = progressDecoder(event => { if (event.source === 'controller') return; try { onProgress(event); } catch { /* diagnostic only */ } });
    child.stdio?.[3]?.on('data', decode);
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
  const trial = join(path, 'trials/001');
  await verifyTransferManifest(trial);
  const raw = JSON.parse(await readFile(join(trial, 'raw.json'), 'utf8'));
  if (raw.schemaVersion !== 1 || raw.platform !== 'supabase' || raw.trial !== 1 || raw.correctness?.aborted !== false || !raw.correctness?.findings?.length || raw.correctness.findings.some(finding => finding.passed !== true)) throw new Error('pilot evidence correctness is incomplete');
  if (!raw.stages?.length || raw.stages.some(stage => stage.valid !== true) || !raw.capacity?.stages?.length || raw.capacity.stages.some(stage => stage.invalid !== false)) throw new Error('pilot evidence contains invalid measured stages');
  return resolve(path);
}
