import { createInterface } from 'node:readline';
import { MAX_BACKEND_TELEMETRY_BYTES } from '../../benchmark-sets/realworld-api-v5/shared/lib/backend-telemetry-transport.mjs';
import { backendTelemetrySourceSha256 } from '../../benchmark-sets/realworld-api-v5/shared/lib/backend-telemetry-agent.mjs';
const fault = process.argv[2];
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const message = JSON.parse(line);
  const nonce = fault === 'wrong-nonce' ? 'wrong' : message.nonce;
  if (message.type === 'start') {
    if (fault === 'exit') process.exit(23);
    if (fault === 'silent') continue;
    if (fault === 'malformed') { process.stdout.write('not-json\n'); continue; }
    if (fault === 'oversized') { process.stdout.write('x'.repeat(MAX_BACKEND_TELEMETRY_BYTES + 1)); continue; }
    process.stdout.write(JSON.stringify({ type: 'ready', nonce, nodeVersion: fault === 'wrong-node' ? 'v26.0.0' : process.version, platform: fault === 'wrong-platform' ? 'darwin' : 'linux', sourceSha256: fault === 'wrong-source' ? '0'.repeat(64) : backendTelemetrySourceSha256() }) + '\n');
  } else if (message.type === 'stop') {
    process.stdout.write(JSON.stringify({ type: 'result', nonce, report: { platform: 'linux' } }) + '\n' + (fault === 'trailing' ? 'garbage' : ''));
    process.exit(0);
  }
}
