import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createSshBackendTelemetryFactory } from '../benchmark-sets/realworld-api-v5/shared/lib/backend-telemetry-transport.mjs';

const options = { host: '10.20.30.40', user: 'root', identityFile: '/private/owned-key', knownHostsFile: '/private/known-hosts',
  nodePath: '/opt/node/bin/node', agentPath: '/opt/v5/backend-telemetry-agent.mjs', project: 'v5-owned', containerIds: ['a'.repeat(64)] };
const fixture = new URL('./fixtures/v5_telemetry_agent.mjs', import.meta.url);
function factory(fault, extra = {}) {
  let child;
  const create = createSshBackendTelemetryFactory({ ...options, ...extra, spawnImpl(exe, args, settings) {
    assert.equal(exe, 'ssh');
    assert.ok(args.includes('StrictHostKeyChecking=yes'));
    assert.ok(args.includes('/dev/null'));
    assert.equal(settings.env.LINODE_TOKEN, undefined);
    child = spawn(process.execPath, [fixture.pathname, fault], settings);
    return child;
  } });
  return { create, exited() { assert.ok(child.exitCode !== null || child.signalCode !== null); } };
}

test('V5 telemetry transport exchanges bounded nonce-bound messages and waits for owned process exit', async () => {
  const f = factory('normal');
  const sampler = await f.create({ startAt: Date.now() });
  const report = await sampler.stop(Date.now());
  assert.equal(report.platform, 'linux');
  assert.equal(await sampler.stop(), report);
  f.exited();
});

test('V5 telemetry transport rejects public/DNS targets and unsafe shell paths before launching anything', () => {
  for (const change of [{ host: 'example.com' }, { host: '8.8.8.8' }, { agentPath: '/opt/agent;touch' }, { user: '-option' }, { identityFile: '../key' }]) {
    assert.throws(() => createSshBackendTelemetryFactory({ ...options, ...change, spawnImpl() { assert.fail('must not launch'); } }));
  }
});

for (const fault of ['wrong-nonce', 'wrong-node', 'wrong-platform', 'wrong-source', 'malformed', 'exit', 'oversized']) test(`V5 transport rejects ${fault} and reaps the agent`, async () => {
  const f = factory(fault);
  await assert.rejects(f.create({ startAt: Date.now() }), /telemetry/);
  f.exited();
});

test('V5 transport rejects unterminated trailing output after a result', async () => {
  const f = factory('trailing');
  const sampler = await f.create({ startAt: Date.now() });
  await assert.rejects(sampler.stop(Date.now()), /telemetry/);
  f.exited();
});

test('V5 transport deadline terminates and reaps a silent agent', async () => {
  const f = factory('silent', { maxRuntimeMs: 10 });
  await assert.rejects(f.create({ startAt: Date.now() }), /telemetry/);
  f.exited();
});

test('V5 cancellation closes an agent that never announces readiness', async () => {
  const abort = new AbortController(), f = factory('silent');
  const promise = f.create({ startAt: Date.now(), signal: abort.signal });
  abort.abort();
  await assert.rejects(promise, /telemetry/);
  f.exited();
});
