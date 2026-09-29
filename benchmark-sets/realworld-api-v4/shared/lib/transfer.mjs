import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const MANIFEST = '.transfer-manifest.json';

async function filesBelow(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(root, path));
    else if (entry.isFile()) { if (relative(root, path).split(sep).join('/') !== MANIFEST) files.push(path); }
    else throw new Error('transfer output contains a non-regular file');
  }
  return files;
}

async function digest(path) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length; }
  return { sha256: hash.digest('hex'), size };
}

export async function createTransferManifest(directory) {
  if (!isAbsolute(directory) || !(await lstat(directory)).isDirectory()) throw new Error('transfer directory must be absolute');
  const files = [];
  for (const path of await filesBelow(directory)) {
    const details = await digest(path);
    files.push({ path: relative(directory, path).split(sep).join('/'), ...details });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifest = { schema_version: 1, files };
  await writeFile(join(directory, MANIFEST), `${JSON.stringify(manifest)}\n`, { mode: 0o600, flag: 'wx' });
  return manifest;
}

export async function verifyTransferManifest(directory) {
  if (!isAbsolute(directory) || !(await lstat(directory)).isDirectory()) throw new Error('transfer directory must be absolute');
  const manifest = JSON.parse(await readFile(join(directory, MANIFEST), 'utf8'));
  if (manifest?.schema_version !== 1 || !Array.isArray(manifest.files)) throw new Error('invalid transfer manifest');
  const listed = new Map();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0 || listed.has(entry.path)) throw new Error('invalid transfer manifest entry');
    listed.set(entry.path, entry);
  }
  const actual = await filesBelow(directory);
  const paths = actual.map(path => relative(directory, path).split(sep).join('/')).sort((a, b) => a.localeCompare(b, 'en'));
  const expected = [...listed.keys()].sort((a, b) => a.localeCompare(b, 'en'));
  if (paths.length !== expected.length || paths.some((path, index) => path !== expected[index])) throw new Error('transfer file set mismatch');
  for (const path of actual) {
    const name = relative(directory, path).split(sep).join('/');
    const details = await digest(path);
    const entry = listed.get(name);
    if (details.sha256 !== entry.sha256 || details.size !== entry.size) throw new Error(`transfer checksum mismatch: ${name}`);
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, directory, ...rest] = process.argv.slice(2);
  const operation = action === 'seal' ? createTransferManifest : action === 'verify' ? verifyTransferManifest : null;
  if (!operation || !directory || rest.length) { console.error('usage: transfer.mjs <seal|verify> <absolute-directory>'); process.exitCode = 2; }
  else void operation(directory).catch(error => { console.error(String(error?.message ?? error).slice(0, 300)); process.exitCode = 1; });
}
