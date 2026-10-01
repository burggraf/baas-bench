import { chmod, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseBootstrapCredentials(logs) {
  const lines = String(logs).split(/\r?\n/);
  const index = lines.findLastIndex(line => line.includes('Created new admin user:'));
  const field = (line, name) => {
    const start = line.indexOf(`${name}:`);
    return start < 0 ? '' : line.slice(start + name.length + 1).trim().replaceAll("'", '');
  };
  const email = field(lines[index + 1] ?? '', 'email');
  const password = field(lines[index + 2] ?? '', 'password');
  if (index < 0 || !email || !password || /[\r\n\0]/.test(email + password)) throw new Error('TrailBase bootstrap administrator was not found in backend logs');
  return { email, password };
}

export async function writeBootstrapCredentials(logs, path) {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('invalid TrailBase bootstrap credential path');
  await writeFile(path, `${JSON.stringify(parseBootstrapCredentials(logs))}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(path, 0o600);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path] = process.argv.slice(2);
  if (process.argv.length !== 3) {
    console.error('usage: trailbase-bootstrap.mjs <absolute-output-path>');
    process.exitCode = 2;
  } else {
    let logs = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      logs += chunk;
      if (Buffer.byteLength(logs) > 1_048_576) throw new Error('TrailBase logs exceed the bootstrap parsing limit');
    }
    void writeBootstrapCredentials(logs, path).catch(error => { console.error(String(error?.message ?? error).slice(0, 300)); process.exitCode = 1; });
  }
}
