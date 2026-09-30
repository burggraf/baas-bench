import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from './command.mjs';

const publicKey = /^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n\0]+)?$/;

export async function createEphemeralSshKey({ prefix = 'baas-bench-v4-', command = runCommand } = {}) {
  if (typeof prefix !== 'string' || !/^[A-Za-z0-9._-]+$/.test(prefix)) throw new Error('invalid ephemeral SSH key prefix');
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const privateKey = join(directory, 'id_ed25519');
  try {
    await chmod(directory, 0o700);
    await command('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'baas-bench-v4-ephemeral', '-f', privateKey], { timeoutMs: 30_000 });
    await chmod(privateKey, 0o600);
    const key = (await readFile(`${privateKey}.pub`, 'utf8')).trim();
    if (!publicKey.test(key)) throw new Error('invalid generated SSH public key');
    return { privateKey, publicKey: key, async cleanup() { await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export async function startSshAgent({ privateKey, command = runCommand } = {}) {
  if (typeof privateKey !== 'string' || !privateKey.startsWith('/') || privateKey.includes('\0')) throw new Error('invalid SSH private key path');
  const { stdout } = await command('ssh-agent', ['-s'], { timeoutMs: 30_000 });
  const socket = stdout.match(/^SSH_AUTH_SOCK=([^;\r\n]+);/m)?.[1];
  const pid = stdout.match(/^SSH_AGENT_PID=([1-9][0-9]*);/m)?.[1];
  if (!socket || !pid) throw new Error('invalid ssh-agent response');
  const env = { ...process.env, SSH_AUTH_SOCK: socket, SSH_AGENT_PID: pid };
  try { await command('ssh-add', [privateKey], { timeoutMs: 30_000, env }); }
  catch (error) { await command('ssh-agent', ['-k'], { timeoutMs: 30_000, env }).catch(() => {}); throw error; }
  return { env, async stop() { await command('ssh-agent', ['-k'], { timeoutMs: 30_000, env }); } };
}
