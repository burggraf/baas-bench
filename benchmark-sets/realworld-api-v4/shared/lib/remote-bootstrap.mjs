import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { runCommand } from './command.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new'];
const validTarget = value => typeof value === 'string' && /^([A-Za-z0-9][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value);

export async function readBootstrapScript(path) {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('bootstrap script path must be absolute');
  const script = await readFile(path, 'utf8');
  if (!script.startsWith('#!/bin/sh\n') || script.length > 32_768) throw new Error('invalid bootstrap script');
  return script;
}

export async function bootstrapHosts({ backendTarget, runnerTarget, script, command = runCommand, signal, attempts = 24, sleep = ms => delay(ms, undefined, { signal }) }) {
  if (!validTarget(backendTarget) || !validTarget(runnerTarget) || typeof script !== 'string' || !script.startsWith('#!/bin/sh\n') || script.length > 32_768 || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 24) throw new Error('invalid host bootstrap configuration');
  for (const target of [backendTarget, runnerTarget]) {
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      try {
        await command('ssh', [...SSH_OPTIONS, target, 'true'], { timeoutMs: 15_000, signal });
        break;
      } catch (error) {
        signal?.throwIfAborted();
        if (attempt >= attempts) throw new Error(`SSH host ${target} did not become ready: ${error.message}`, { cause: error });
        await sleep(5_000);
      }
    }
  }
  for (const target of [backendTarget, runnerTarget]) {
    signal?.throwIfAborted();
    await command('ssh', [...SSH_OPTIONS, target, 'sh -s'], { input: script, timeoutMs: 600_000, signal });
  }
  return { backendTarget, runnerTarget };
}
