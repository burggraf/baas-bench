import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serveBackendTelemetryAgent, backendTelemetrySourceSha256 } from '../benchmark-sets/realworld-api-v5/shared/lib/backend-telemetry-agent.mjs';
const nonce = 'a'.repeat(32);
const start = { type: 'start', nonce, startAt: 100, project: 'v5-owned', containerIds: ['b'.repeat(64)] };
const send = (input, message) => input.write(JSON.stringify(message) + '\n');

function harness({ stopError = false } = {}) {
  const input = new PassThrough(), messages = [], calls = [];
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const done = serveBackendTelemetryAgent({ input, write(line) {
    const message = JSON.parse(line); messages.push(message);
    if (message.type === 'ready') ready();
  }, async createSampler(options) {
    calls.push(options);
    return { async stop(endedAt) {
      calls.push({ endedAt, aborted: options.signal.aborted });
      if (stopError) throw new Error('secondary cleanup error');
      return { platform: 'linux', samples: [] };
    } };
  } });
  done.catch(() => {});
  return { input, messages, calls, started, done };
}

test('V5 backend agent exposes only read-only sampler start/stop and source identity', async () => {
  const h = harness(); send(h.input, start); await h.started;
  assert.match(h.messages[0].sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(h.messages[0].sourceSha256, backendTelemetrySourceSha256());
  send(h.input, { type: 'stop', nonce, endedAt: 200 }); await h.done;
  assert.equal(h.calls[1].endedAt, 200);
  assert.equal(h.messages[1].type, 'result');
  h.input.destroy();
});

test('V5 backend agent rejects duplicate start and attempts cleanup preserving its primary error', async () => {
  const h = harness({ stopError: true }); send(h.input, start); await h.started;
  send(h.input, start);
  await assert.rejects(h.done, error => {
    assert.match(error.message, /invalid telemetry phase/);
    assert.equal(error.cleanupErrors[0].phase, 'backend-agent-stop');
    return true;
  });
  assert.equal(h.calls[1].aborted, true);
  h.input.destroy();
});

test('V5 backend agent rejects disconnect before stop and cleans the sampler', async () => {
  const h = harness(); send(h.input, start); await h.started; h.input.end();
  await assert.rejects(h.done, /closed before stop/);
  assert.equal(h.calls[1].aborted, true);
});

test('V5 backend agent bounds unterminated input before starting Docker probes', async () => {
  const h = harness(); h.input.write('x'.repeat(16385));
  await assert.rejects(h.done, /oversized telemetry request/);
  assert.equal(h.calls.length, 0);
});

test('V5 backend agent rejects administrative fields before invoking the sampler', async () => {
  const h = harness(); send(h.input, { ...start, command: 'docker rm' });
  await assert.rejects(h.done, /invalid telemetry phase/);
  assert.equal(h.calls.length, 0);
  h.input.destroy();
});
