import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { startBackendTelemetry } from './backend-telemetry.mjs';

const versions = new URL('../../versions.env', import.meta.url);
export const backendNodeVersion = 'v' + readFileSync(versions, 'utf8').match(/^NODE_VERSION=(\S+)$/m)[1];
export function backendTelemetrySourceSha256() {
  const hash = createHash('sha256');
  for (const path of ['./backend-telemetry-agent.mjs', './backend-telemetry.mjs', './telemetry.mjs', '../../versions.env']) {
    hash.update(path + '\0'); hash.update(readFileSync(new URL(path, import.meta.url))); hash.update('\0');
  }
  return hash.digest('hex');
}

// Only start/stop of the read-only, exact-owned-container sampler is supported.
export async function serveBackendTelemetryAgent({ input = process.stdin, write = line => process.stdout.write(line),
  createSampler = startBackendTelemetry } = {}) {
  const abort = new AbortController();
  let sampler, nonce, primary, stopped = false, bytes = 0;
  const disconnect = () => abort.abort();
  const bound = chunk => { bytes += chunk.length; if (bytes > 16384) { abort.abort(); input.destroy(new Error('oversized telemetry request')); } };
  input.on('data', bound); input.on('end', disconnect); input.on('error', disconnect);
  const lines = createInterface({ input });
  const send = message => write(JSON.stringify({ ...message, nonce }) + '\n');
  try {
    for await (const line of lines) {
      if (abort.signal.aborted) throw new Error('telemetry channel closed');
      const message = JSON.parse(line);
      if (!message || typeof message.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(message.nonce)) throw new Error('invalid telemetry nonce');
      if (!sampler && message.type === 'start' && Object.keys(message).every(key => ['type', 'nonce', 'startAt', 'project', 'containerIds'].includes(key))) {
        nonce = message.nonce;
        sampler = await createSampler({ startAt: message.startAt, project: message.project, containerIds: message.containerIds, signal: abort.signal });
        if (abort.signal.aborted) throw new Error('telemetry channel closed');
        send({ type: 'ready', nodeVersion: process.version, platform: process.platform, sourceSha256: backendTelemetrySourceSha256() });
      } else if (sampler && message.nonce === nonce && message.type === 'stop' && Number.isSafeInteger(message.endedAt) && message.endedAt >= 0 && Object.keys(message).every(key => ['type', 'nonce', 'endedAt'].includes(key))) {
        const report = await sampler.stop(message.endedAt);
        stopped = true;
        send({ type: 'result', report });
        return;
      } else throw new Error('invalid telemetry phase');
    }
    throw new Error('telemetry channel closed before stop');
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    lines.close(); input.removeListener('data', bound); input.removeListener('end', disconnect); input.removeListener('error', disconnect);
    if (!stopped) {
      abort.abort();
      if (sampler) try { await sampler.stop(); } catch (error) {
        if (!primary) throw error;
        primary.cleanupErrors = [...(primary.cleanupErrors ?? []), { phase: 'backend-agent-stop', name: error.name }];
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.version !== backendNodeVersion || process.platform !== 'linux') throw new Error('unsupported telemetry runtime');
    await serveBackendTelemetryAgent();
  } catch {
    // Never print SSH environment, protocol contents, container inspect data, or credentials.
    process.stderr.write('backend telemetry agent failed\n');
    process.exitCode = 1;
  }
}
