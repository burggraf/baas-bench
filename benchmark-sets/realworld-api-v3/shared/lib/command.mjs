import { execFile } from 'node:child_process';

const SAFE_COMMAND = /^[A-Za-z0-9._/-]+$/;

export function runCommand(command, args = [], options = {}) {
  if (typeof command !== 'string' || !SAFE_COMMAND.test(command) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error('invalid command');
  }
  const timeout = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error('invalid command timeout');
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout, maxBuffer: 1024 * 1024, encoding: 'utf8', env: options.env }, (error, stdout, stderr) => {
      if (error) { const normalized = String(stderr ?? '').trim().replace(/\s+/g, ' '); const detail = normalized.length > 1200 ? `${normalized.slice(0, 600)} ... ${normalized.slice(-600)}` : normalized; return reject(new Error(`${command} command failed${detail ? `: ${detail}` : ''}`)); }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    if (options.input !== undefined) child.stdin.end(String(options.input));
  });
}
