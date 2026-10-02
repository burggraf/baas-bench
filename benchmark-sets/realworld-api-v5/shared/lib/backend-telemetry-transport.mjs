import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { validateBackendOwnership } from './backend-telemetry.mjs';
import { backendNodeVersion as nodeVersion, backendTelemetrySourceSha256 } from './backend-telemetry-agent.mjs';
export const MAX_BACKEND_TELEMETRY_BYTES = 16 * 1024 * 1024;
const pathOK = path => typeof path === 'string' && path.length <= 4096 && /^\/[A-Za-z0-9._/-]+$/.test(path) && !path.split('/').some(part => part === '.' || part === '..');
const privateHost = host => {
  if (typeof host !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  const octets = host.split('.').map(Number);
  return octets.every((value, index) => value <= 255 && String(value) === host.split('.')[index]) &&
    (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {});
  return { promise, resolve, reject };
};

// Construction does not connect. Only invoking the returned factory starts SSH.
export function createSshBackendTelemetryFactory({ host, user, identityFile, knownHostsFile, nodePath, agentPath, project, containerIds,
  maxRuntimeMs = 1800000, expectedSourceSha256 = backendTelemetrySourceSha256(), spawnImpl = spawn } = {}) {
  validateBackendOwnership(containerIds, project);
  containerIds = [...containerIds];
  if (containerIds.length > 64 || !privateHost(host) || typeof user !== 'string' || user.length > 32 || project.length > 128 || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(user) || ![identityFile, knownHostsFile, nodePath, agentPath].every(pathOK) || !Number.isSafeInteger(maxRuntimeMs) || maxRuntimeMs < 1 || maxRuntimeMs > 1800000 || !/^[a-f0-9]{64}$/.test(expectedSourceSha256) || typeof spawnImpl !== 'function') throw new Error('invalid private backend telemetry transport');
  return async ({ startAt, signal } = {}) => {
    if (!Number.isSafeInteger(startAt) || startAt < 0 || signal?.aborted) throw new Error('backend telemetry cancelled or invalid epoch');
    const nonce = randomBytes(16).toString('hex');
    const args = ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'IdentitiesOnly=yes', '-o', `UserKnownHostsFile=${knownHostsFile}`, '-o', 'GlobalKnownHostsFile=/dev/null',
      '-o', 'ClearAllForwardings=yes', '-i', identityFile, `${user}@${host}`, `${nodePath} ${agentPath}`];
    const env = {};
    for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL']) if (process.env[key] !== undefined) env[key] = process.env[key];
    const child = spawnImpl('ssh', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const ready = deferred(), result = deferred(), closed = deferred(), decoder = new StringDecoder('utf8');
    let state = 'starting', primary, finished = false, buffer = '', bytes = 0, stopPromise, killTimer;
    const fail = () => {
      primary ??= new Error('backend telemetry transport failed');
      ready.reject(primary); result.reject(primary);
      if (!finished && !killTimer) {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => { if (!finished) child.kill('SIGKILL'); }, 5000);
      }
    };
    const abort = () => fail();
    const startupTimer = setTimeout(fail, 9000), timer = setTimeout(fail, maxRuntimeMs);
    child.on('error', fail); child.stdin.on('error', fail); child.stdout.on('error', fail); child.stderr.on('data', () => {});
    child.on('close', (code, exitSignal) => {
      finished = true;
      if (code !== 0 || exitSignal || state !== 'complete' || buffer.length || decoder.end().length) fail();
      clearTimeout(timer); clearTimeout(startupTimer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      closed.resolve();
    });
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BACKEND_TELEMETRY_BYTES) { fail(); return; }
      buffer += decoder.write(chunk);
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          const message = JSON.parse(line);
          if (message.nonce !== nonce) throw new Error('wrong nonce');
          if (state === 'starting' && message.type === 'ready' && message.nodeVersion === nodeVersion && message.platform === 'linux' && message.sourceSha256 === expectedSourceSha256) {
            state = 'active'; clearTimeout(startupTimer); ready.resolve();
          } else if (state === 'stopping' && message.type === 'result' && message.report && typeof message.report === 'object' && !Array.isArray(message.report)) {
            state = 'complete'; result.resolve(message.report); child.stdin.end();
          } else throw new Error('invalid telemetry phase');
        } catch { fail(); }
      }
    });
    const send = message => child.stdin.write(JSON.stringify({ ...message, nonce }) + '\n');
    if (signal?.aborted) fail(); else signal?.addEventListener('abort', abort, { once: true });
    send({ type: 'start', startAt, project, containerIds });
    try { await ready.promise; }
    catch (error) { await closed.promise; throw error; }
    return { stop(endedAt = Date.now()) {
      if (!stopPromise) stopPromise = (async () => {
        if (!Number.isSafeInteger(endedAt) || endedAt < startAt || state !== 'active') fail();
        else { state = 'stopping'; send({ type: 'stop', endedAt }); }
        try {
          const report = await result.promise;
          await closed.promise;
          if (primary) throw primary;
          report.transport = { kind: 'private-ssh', sourceSha256: expectedSourceSha256, nodeVersion };
          return report;
        } catch (error) { await closed.promise; throw error; }
      })();
      return stopPromise;
    } };
  };
}
