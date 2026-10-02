import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLinuxHost, parseOwnedStats, validateOwnedState, validateBackendTelemetry, startBackendTelemetry } from '../benchmark-sets/realworld-api-v5/shared/lib/backend-telemetry.mjs';

const id = 'a'.repeat(64), other = 'b'.repeat(64), project = 'v5-owned';
const hostInput = () => ({ stat: 'cpu  10 1 2 30 4 5 6 7 8 9\ncpu0 1 2 3 4 5 6 7 8 9 10\n',
  meminfo: 'MemTotal: 1000 kB\nMemAvailable: 700 kB\nSwapTotal: 20 kB\nSwapFree: 20 kB\n',
  netdev: ' eth0: 100 1 0 2 0 0 0 0 200 1 0 3 0 0 0 0\n lo: 100 1 0 0 0 0 0 0 100 1 0 0 0 0 0 0\n',
  vmstat: 'oom_kill 0\n', bootId: '12345678-1234-1234-1234-123456789012\n' });
const state = () => ({ id, project, running: true, restarts: 0, startedAt: '2026-10-01T00:00:00Z', oomKilled: false, dead: false });
const stats = row => JSON.stringify({ ID: id, CPUPerc: '12.5%', MemUsage: '2MiB / 1GiB', ...row });

test('Linux host parsing does not count guest CPU ticks twice and retains steal/network/swap/OOM', () => {
  const host = parseLinuxHost(hostInput());
  assert.equal(host.cpu.total, 65);
  assert.equal(host.cpu.steal, 7);
  assert.equal(host.memory.availableBytes, 700 * 1024);
  assert.equal(host.network.interfaces.length, 1);
  assert.equal(host.network.interfaces[0].txDrops, 3);
  assert.equal(host.oomKillCount, 0);
});

test('Linux host parsing rejects missing, malformed and unsafe counters', () => {
  for (const change of [input => { input.stat = ''; }, input => { input.meminfo = 'MemTotal: 1000 kB'; }, input => { input.netdev = 'lo: 1'; }, input => { input.vmstat = ''; }, input => { input.bootId = 'bad'; }, input => { input.stat = 'cpu 9007199254740992 0 0 0 0 0 0 0'; }]) {
    const input = hostInput(); change(input); assert.throws(() => parseLinuxHost(input));
  }
});

test('Owned stats require exact complete container IDs and valid metrics, never prefix-match unrelated containers', () => {
  assert.deepEqual(parseOwnedStats(stats(), [id]), { cpuPercent: 12.5, memoryBytes: 2 * 1024 ** 2, count: 1 });
  for (const text of [stats({ ID: id.slice(0, 12) }), stats({ ID: other }), `${stats()}\n${stats()}`, 'bad', stats({ CPUPerc: '' }), stats({ MemUsage: 'bad' })]) assert.throws(() => parseOwnedStats(text, [id]));
  assert.throws(() => parseOwnedStats(stats(), [id, other]));
});

test('Owned state rejects wrong projects, stopped/OOM containers and restarts without reading credentials', () => {
  assert.deepEqual(validateOwnedState([state()], { containerIds: [id], project }), [state()]);
  for (const change of [row => { row.project = 'unrelated'; }, row => { row.running = false; }, row => { row.oomKilled = true; }, row => { row.dead = true; }, row => { row.restarts = 1; }]) {
    const row = state(); change(row); assert.throws(() => validateOwnedState([row], { containerIds: [id], project, baseline: [state()] }));
  }
});

test('Non-Linux backend sampling refuses Docker before collecting evidence', { skip: process.platform === 'linux' }, async () => {
  await assert.rejects(startBackendTelemetry({ startAt: Date.now(), containerIds: [id], project }), /requires Linux/);
});

test('Backend validation requires complete aligned coverage and invalidates host/container restart or lost counters', () => {
  const startAt = 100000, endedAt = 115000, host = parseLinuxHost(hostInput());
  const report = () => ({ platform: 'linux', project, containerIds: [id], startAt, startedAt: startAt, endedAt, intervalMs: 5000, baseline: { host, states: [state()] }, final: { host, states: [state()] }, failureReasons: [],
    samples: [1, 2, 3].map(index => ({ timestampMs: startAt + index * 5000, host: structuredClone(host), states: [state()], containers: { cpuPercent: 1, memoryBytes: 100, count: 1 } })) });
  assert.equal(validateBackendTelemetry(report(), { startAt, endedAt, durationMs: 15000, project, containerIds: [id] }).valid, true);
  assert.equal(validateBackendTelemetry(report(), { startAt, endedAt, durationMs: 15001, project, containerIds: [id] }).valid, false);
  for (const change of [r => { r.platform = 'darwin'; }, r => { r.samples.pop(); }, r => { r.samples[1].timestampMs += 5000; }, r => { r.final.states[0].restarts++; }, r => { r.final.host = { ...host, bootId: '87654321-1234-1234-1234-123456789012' }; }, r => { r.samples[1].host.cpu.total = 0; }, r => { r.samples[1].host.oomKillCount++; }, r => { r.samples[1].containers.count = 0; }]) {
    const r = report(); change(r); assert.equal(validateBackendTelemetry(r, { startAt, endedAt, project, containerIds: [id] }).valid, false);
  }
});
