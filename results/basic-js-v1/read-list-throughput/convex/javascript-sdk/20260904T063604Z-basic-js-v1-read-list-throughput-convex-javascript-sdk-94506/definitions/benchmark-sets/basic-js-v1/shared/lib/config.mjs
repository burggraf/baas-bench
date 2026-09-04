import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function runtimeRoot(env = process.env) {
  if (env.BAAS_RUNTIME_DIR) return env.BAAS_RUNTIME_DIR;
  if (!env.BAAS_BENCH_ROOT) throw new Error('BAAS_BENCH_ROOT is required');
  return join(env.BAAS_BENCH_ROOT, '.runtime');
}

export async function readEnvValue(path, key) {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  const matches = lines.filter((line) => line.startsWith(`${key}=`));
  if (matches.length !== 1) throw new Error(`expected exactly one ${key} entry in ${path}`);
  const value = matches[0].slice(key.length + 1);
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`invalid ${key} entry in ${path}`);
  return value;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
