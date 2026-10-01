import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function nativeSourceManifest(root) {
  const paths = ['versions.env', 'bin/baas', 'benchmark-sets/realworld-api-v4/shared/lib/admin/trailbase-bootstrap.mjs', '.runtime/conformance-v5/sdk/package-lock.json'];
  const pending = ['benchmark-sets/realworld-api-v5'];
  while (pending.length) {
    const path = pending.pop();
    const stat = lstatSync(join(root, path));
    assert.ok(!stat.isSymbolicLink(), 'native source must not follow symlinks');
    if (stat.isDirectory()) for (const name of readdirSync(join(root, path))) pending.push(`${path}/${name}`);
    else { assert.ok(stat.isFile()); paths.push(path); }
  }
  for (const name of readdirSync(join(root, 'test'))) if (/^native_v5_.*\.mjs$/.test(name)) paths.push(`test/${name}`);
  const files = paths.sort().map(path => {
    const stat = lstatSync(join(root, path));
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    return { path, sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex') };
  });
  return { files, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}

export function nativeProbeProvenance(root) {
  const git = args => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, 'native provenance Git inspection failed');
    return result.stdout.trim();
  };
  return { git_commit: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--untracked-files=all']) !== '', node_version: process.version, sources: nativeSourceManifest(root), admission_evidence: false };
}
