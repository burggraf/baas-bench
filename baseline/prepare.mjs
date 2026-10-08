import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleFixture } from './fixture.mjs';
import { NativeBaseline } from './native.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const digest = value => sha256(JSON.stringify(value));
const safeFile = name => typeof name === 'string' && /^[a-zA-Z0-9_.-]+$/.test(name) && !['.', '..', 'manifest.json'].includes(name);
export function saveManifest(dir, facts, snapshot) {
  assert.ok(snapshot && Array.isArray(snapshot.files) && snapshot.files.length && snapshot.state, 'invalid snapshot');
  const files = {};
  for (const name of snapshot.files) {
    assert.ok(safeFile(name) && lstatSync(join(dir, name)).isFile() && !lstatSync(join(dir, name)).isSymbolicLink(), 'invalid snapshot file');
    chmodSync(join(dir, name), 0o600);
    files[name] = sha256(readFileSync(join(dir, name)));
  }
  const manifest = { format: 1, facts, files, state: snapshot.state, created_at: new Date().toISOString() };
  const content = JSON.stringify(manifest, null, 2);
  writeFileSync(join(dir, 'manifest.json'), content, { mode: 0o600, flag: 'wx' });
  writeFileSync(join(dir, 'manifest.sha256'), sha256(content), { mode: 0o600, flag: 'wx' });
  return manifest;
}
export function readManifest(dir, facts) {
  let m;
  try { m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); } catch { throw new Error('malformed baseline manifest'); }
  assert.equal(sha256(readFileSync(join(dir, 'manifest.json'))), readFileSync(join(dir, 'manifest.sha256'), 'utf8'), 'manifest checksum mismatch');
  assert.ok(m?.format === 1 && m.facts && m.state && m.files && typeof m.files === 'object' && !Array.isArray(m.files) && Object.keys(m.files).length && typeof m.created_at === 'string', 'malformed baseline manifest');
  assert.equal(digest(m.facts), digest(facts), 'stale baseline: pins/schema/config/fixture changed; retain evidence and rebuild explicitly');
  for (const [name, hash] of Object.entries(m.files)) {
    assert.ok(safeFile(name) && /^[a-f0-9]{64}$/.test(hash), 'malformed baseline manifest file');
    assert.ok(lstatSync(join(dir, name)).isFile() && !lstatSync(join(dir, name)).isSymbolicLink(), 'malformed baseline manifest file');
    assert.equal(sha256(readFileSync(join(dir, name))), hash, `baseline checksum mismatch: ${name}`);
  }
  return m;
}
export async function runCommand(command, { dir, facts, backend }) {
  if (command === 'stop') { await backend.stop(); return; }
  let manifest;
  if (existsSync(join(dir, 'manifest.json'))) manifest = readManifest(dir, facts);
  if (command === 'prepare' && manifest) {
    await backend.verifyConfiguration(manifest);
    return manifest;
  }
  if (command === 'run' && !manifest) throw new Error('prepare a baseline first');
  assert.ok(['prepare', 'run'].includes(command), 'unsupported command');
  let failure, result;
  try {
    if (command === 'run') await backend.verifyConfiguration(manifest);
    await backend.preflight();
    if (command === 'run') await backend.restore(manifest);
    await backend.start();
    await backend.ready();
    if (command === 'prepare') {
      await backend.seed();
      await backend.verify();
      result = saveManifest(dir, facts, await backend.snapshot());
    } else {
      await backend.verify(manifest);
      await backend.authenticate();
      await backend.k6();
      await backend.postcheck();
    }
  } catch (error) { failure = error; }
  try { await backend.stop(); } catch (error) { if (failure) failure.cleanupError = error; else failure = error; }
  if (failure) throw failure;
  return result;
}
export async function fixtureFacts(root, platform, fixture) {
  const sources = ['benchmark-sets/realworld-api-v5/versions.env', 'baseline/fixture.mjs', 'baseline/profile/lib/fixture.mjs', 'benchmark-sets/realworld-api-v5/shared/lib/dataset.mjs', 'baseline/native.mjs', 'baseline/prepare.mjs', 'baseline/auth.mjs'];
  if (platform === 'trailbase') sources.push('.runtime/conformance-v5/sdk/package-lock.json', 'baseline/trail-volume.mjs');
  else sources.push('bin/baas', 'versions.env');
  sources.push(...(platform === 'trailbase' ? ['trailbase/migration.sql', 'trailbase/config.textproto', 'trailbase/bootstrap-config.textproto'] : ['sql/postgres-schema.sql', 'sql/supabase-rls.sql']).map(p => `baseline/profile/${p}`));
  return { platform, architecture: process.arch, node: process.versions.node, seed: 42,
    sources: Object.fromEntries(sources.map(p => [p, sha256(readFileSync(join(root, p)))])),
    fixture: Object.fromEntries(Object.entries(fixture.rows).map(([t, rows]) => [t, { count: rows.length, sha256: digest(rows) }])) };
}
async function main() {
  assert.equal(process.versions.node, '22.23.1', 'use pinned Node 22.23.1');
  const [command, platform, ...extra] = process.argv.slice(2);
  assert.ok(['prepare', 'run', 'stop'].includes(command) && ['supabase', 'trailbase'].includes(platform) && !extra.length, 'usage: baseline/baseline.sh {prepare|run|stop} {supabase|trailbase}');
  process.umask(0o077);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = join(root, '.runtime/k6-baseline', platform);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(root, '.runtime/k6-baseline/lock');
  mkdirSync(lock, { mode: 0o700 }); // Exclusive, fail closed; never steal an uncertain lock.
  try {
    const fixture = command === 'stop' ? null : await lifecycleFixture();
    const facts = fixture ? await fixtureFacts(root, platform, fixture) : null;
    const backend = new NativeBaseline({ root, dir, platform, fixture });
    await runCommand(command, { dir, facts, backend });
    console.log(`V6 ${command} ${platform} complete (local diagnostic only)`);
  } catch (e) {
    const report = { diagnostic: true, primary: e.message, cleanup: e.cleanupError?.message ?? null };
    writeFileSync(join(dir, `failure-${Date.now()}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.error(JSON.stringify(report)); process.exitCode = 1;
  } finally { rmSync(lock, { recursive: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
