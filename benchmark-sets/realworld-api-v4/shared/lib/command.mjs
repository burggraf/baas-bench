import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sshTransportArgs } from './ssh-config.mjs';

const SAFE_COMMAND = /^[A-Za-z0-9._/-]+$/;
const managedChildren = new WeakMap();
const SCOPE_ENV = 'BAAS_BENCH_V4_COMMAND_SCOPE';

// Only a root owns an isolated POSIX group. Shell/Node descendants inherit its scope,
// including when they supply an explicit env. The marker never authorizes group kills.
// ponytail: nested cancellation is PID-local; the root deadline bounds the tree.
// Independent nested tree bounds would need termination forwarding/joining.
// Custom spawners must honor detached.
export function spawnManaged(command, args, options, spawnImpl = spawn) {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('managed commands require macOS or Linux POSIX process groups');
  const { rootScope = false, ...spawnOptions } = options ?? {};
  const ownsGroup = rootScope || process.env[SCOPE_ENV] !== '1';
  const env = { ...(spawnOptions.env ?? process.env), [SCOPE_ENV]: '1' };
  const child = spawnImpl(command, args, { ...spawnOptions, env, detached: ownsGroup });
  managedChildren.set(child, ownsGroup);
  return child;
}

// Abort is a termination request, not completion. All callers wait for close.
export function waitForChild(child, { timeoutMs, signal, label = 'command', maxBuffer = 1024 * 1024, tailOutput = false, input, onStdout, onStderr } = {}) {
  if (!managedChildren.has(child)) throw new Error('cannot manage an unowned process group');
  const groupId = child.pid;
  const ownsGroup = managedChildren.get(child);
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0);
    let primary; let killTimer; let inputStreamError;
    let inputDone = Promise.resolve();
    const terminate = signal => {
      // Spawn failures have no PID; ESRCH also covers an already-terminated group.
      if (!Number.isSafeInteger(groupId) || groupId <= 1 || groupId === process.pid) return;
      try { if (ownsGroup) process.kill(-groupId, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') primary.terminationError = String(error.message).slice(0, 300); }
    };
    const stop = error => {
      if (primary) return;
      primary = error;
      terminate('SIGTERM');
      killTimer = setTimeout(() => terminate('SIGKILL'), 10_000);
    };
    const abort = () => stop(new Error(`${label} aborted`, { cause: signal.reason }));
    const timer = setTimeout(() => stop(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    const collect = (previous, data) => {
      const buffer = Buffer.concat([previous, Buffer.from(data)]);
      if (buffer.length > maxBuffer && !tailOutput) stop(new Error(`${label} output exceeds maxBuffer`));
      return tailOutput ? buffer.subarray(-maxBuffer) : buffer.subarray(0, maxBuffer);
    };
    const observe = (callback, data) => { try { callback?.(data); } catch { /* diagnostics do not alter command results */ } };
    child.stdout?.on('data', data => { stdout = collect(stdout, data); observe(onStdout, data); });
    child.stderr?.on('data', data => { stderr = collect(stderr, data); observe(onStderr, data); });
    child.once('error', stop);
    child.stdin?.on('error', error => { if (error.code !== 'EPIPE') stop(error); });
    child.once('close', (code, exitSignal) => {
      void inputDone.then(() => {
        // Descendants with closed/ignored stdio must not survive an early parent close.
        if (primary && ownsGroup) terminate('SIGKILL');
        clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
        const output = { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), code, signal: exitSignal };
        if (primary) { Object.assign(primary, { stdout: output.stdout, stderr: output.stderr }); reject(primary); }
        else if (inputStreamError && code === 0) reject(Object.assign(new Error(`${label} input stream closed before completion`, { cause: inputStreamError }), output));
        else resolve(output);
      });
    });
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    if (input !== undefined && child.stdin) {
      if (typeof input?.[Symbol.asyncIterator] === 'function') {
        inputDone = pipeline(Readable.from(input, { objectMode: false }), child.stdin).catch(error => {
          if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_PREMATURE_CLOSE' || error.code === 'ERR_STREAM_DESTROYED') inputStreamError = error;
          else stop(error);
        });
      } else child.stdin.end(String(input));
    }
  });
}

export function runCommand(command, args = [], options = {}) {
  if (typeof command !== 'string' || !SAFE_COMMAND.test(command) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('invalid command');
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error('invalid command timeout');
  return Promise.resolve().then(async () => {
    options.signal?.throwIfAborted();
    const transportArgs = await sshTransportArgs(command, args, options.env ?? process.env);
    const child = spawnManaged(command, transportArgs, { stdio: ['pipe', 'pipe', 'pipe'], env: options.env, cwd: options.cwd, rootScope: options.rootScope });
    let output;
    try {
      output = await waitForChild(child, { timeoutMs, signal: options.signal, input: options.input, onStdout: options.onStdout, onStderr: options.onStderr, label: `${command} command` });
      if (output.code !== 0) throw Object.assign(new Error('command failed'), output);
    } catch (error) {
      const normalized = String(error.stderr || error.stdout || '').trim().replace(/\s+/g, ' ');
      const detail = normalized.length > 1200 ? `${normalized.slice(0, 600)} ... ${normalized.slice(-600)}` : normalized;
      const status = error.code || error.signal || '';
      throw new Error(`${command} command failed${status ? ` [${status}]` : ''}: ${error.message}${detail ? `: ${detail}` : ''}`, { cause: error });
    }
    return { stdout: output.stdout, stderr: output.stderr };
  });
}
