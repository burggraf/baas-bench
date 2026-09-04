import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fixture, fixtures, writeRecord } from '../fixtures.mjs';
import { runCommand } from '../command.mjs';

const url = 'http://127.0.0.1:3210';
export const deployArgs = ['deploy', '--typecheck', 'disable'];
export const inspectionExportPath = (path) => `${path}.zip`;

function parseDocuments(stdout) {
  try {
    const documents = JSON.parse(stdout);
    if (!Array.isArray(documents)) throw new Error();
    return documents;
  } catch {
    throw new Error('invalid Convex data response');
  }
}

export function createConvexAdmin({ run = runCommand, root, runtime }) {
  const stateDir = join(runtime, 'state');
  const fixturePath = join(stateDir, 'convex-fixtures.jsonl');
  const emptyPath = join(stateDir, 'convex-empty.jsonl');
  const baselinePath = join(stateDir, 'convex-baseline.zip');
  const inspectionPath = join(stateDir, 'convex-inspection');
  const envPath = join(stateDir, 'convex.env');
  let cliEnv;

  async function cli(args) {
    if (!cliEnv) throw new Error('Convex administrative environment is missing');
    return run('npx', ['convex', ...args], { cwd: runtime, env: cliEnv });
  }

  async function documents() {
    const archive = inspectionExportPath(inspectionPath);
    await rm(archive, { force: true });
    await cli(['export', '--path', archive]);
    const { stdout } = await run('unzip', ['-p', archive, 'guestbook/documents.jsonl']);
    await rm(archive, { force: true });
    return parseDocuments(`[${stdout.trim().split(/\r?\n/).filter(Boolean).join(',')}]`);
  }

  function verifyBaseline(rows) {
    const baseline = rows.filter((row) => row.fixture_key !== null).sort((left, right) => left.fixture_key - right.fixture_key);
    if (baseline.length !== 10_000) throw new Error('Convex baseline count verification failed');
    for (let index = 0; index < baseline.length; index += 1) {
      const expected = fixture(index + 1);
      const actual = baseline[index];
      if (actual.fixture_key !== expected.fixture_key || actual.author !== expected.author || actual.message !== expected.message || actual.created_at !== Date.parse(expected.created_at)) {
        throw new Error(`Convex baseline fixture ${index + 1} is invalid`);
      }
    }
    return baseline;
  }

  async function teardown() {
    if (!cliEnv) return;
    let original;
    try {
      await writeFile(emptyPath, '', { mode: 0o600 });
      await cli(['import', '--replace', '--yes', '--table', 'guestbook', emptyPath]);
      await writeFile(join(runtime, 'convex/schema.ts'), 'import { defineSchema } from "convex/server";\nexport default defineSchema({});\n');
      await rm(join(runtime, 'convex/guestbook.ts'), { force: true });
      await cli(deployArgs);
    } catch (error) {
      original = error;
    }
    await rm(fixturePath, { force: true });
    await rm(emptyPath, { force: true });
    await rm(baselinePath, { force: true });
    await rm(inspectionExportPath(inspectionPath), { force: true });
    await rm(join(stateDir, 'convex-ids.json'), { force: true });
    await rm(envPath, { force: true });
    if (original) throw original;
  }

  return {
    async setup() {
      try {
        await mkdir(stateDir, { recursive: true });
        const { stdout } = await run(join(root, 'bin/baas'), ['compose', 'convex', 'exec', '-T', 'backend', './generate_admin_key.sh']);
        const key = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
        if (!key || /\s/.test(key)) throw new Error('invalid Convex admin key response');
        cliEnv = { CONVEX_SELF_HOSTED_URL: url, CONVEX_SELF_HOSTED_ADMIN_KEY: key };
        await writeFile(envPath, `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${key}\n`, { mode: 0o600 });
        await cli(deployArgs);

        const rows = fixtures().map((row) => JSON.stringify({
          author: row.author,
          message: row.message,
          created_at: Date.parse(row.created_at),
          fixture_key: row.fixture_key,
        })).join('\n');
        await writeFile(fixturePath, `${rows}\n`, { mode: 0o600 });
        await cli(['import', '--replace', '--yes', '--table', 'guestbook', fixturePath]);
        const baseline = verifyBaseline(await documents());
        const ids = baseline.map((row) => row._id);
        if (ids.some((id) => typeof id !== 'string' || !id)) throw new Error('Convex fixture ID map verification failed');
        await writeFile(join(stateDir, 'convex-ids.json'), `${JSON.stringify(ids)}\n`, { mode: 0o600 });
        await rm(baselinePath, { force: true });
        await cli(['export', '--path', baselinePath]);
      } catch (error) {
        try {
          await teardown();
        } catch (cleanupError) {
          if (error instanceof Error) error.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        }
        throw error;
      }
    },

    async verify() { verifyBaseline(await documents()); },

    async reset() {
      await cli(['import', '--replace', '--yes', baselinePath]);
      verifyBaseline(await documents());
    },

    teardown,

    async verifyReadiness(context) {
      if (context.operation === 'list') {
        const expected = Array.from({ length: 20 }, (_, offset) => fixture(10_000 - offset));
        if (!Array.isArray(context.result) || context.result.some((row, index) =>
          row.author !== expected[index].author || row.message !== expected[index].message || Date.parse(row.created_at) !== Date.parse(expected[index].created_at))) {
          throw new Error('Convex list readiness verification failed');
        }
      } else if (context.operation === 'write') {
        const expected = writeRecord({ ...context, vu: 0, sequence: 0 });
        const row = (await documents()).find((candidate) => candidate._id === context.result.id);
        if (!row || row.author !== expected.author || row.message !== expected.message || row.fixture_key !== null) throw new Error('Convex write readiness verification failed');
      }
    },

    async cleanupReadiness() {
      await cli(['import', '--replace', '--yes', baselinePath]);
    },

    async verifyStage(context) {
      const rows = await documents();
      verifyBaseline(rows);
      const writes = rows.filter((row) => row.fixture_key === null).length;
      const expected = context.operation === 'write' ? context.stage.completed : 0;
      if (writes !== expected) throw new Error('Convex stage row count verification failed');
    },

    setEnvironment(environment) { cliEnv = environment; },
  };
}

let defaultAdmin;
async function getDefaultAdmin() {
  if (!defaultAdmin) {
    const admin = createConvexAdmin({ root: process.env.BAAS_BENCH_ROOT, runtime: process.env.BAAS_BENCH_RUNTIME });
    const text = await import('node:fs/promises').then(({ readFile }) => readFile(join(process.env.BAAS_BENCH_RUNTIME, 'state/convex.env'), 'utf8')).catch(() => '');
    const values = Object.fromEntries(text.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    if (values.CONVEX_SELF_HOSTED_URL && values.CONVEX_SELF_HOSTED_ADMIN_KEY) admin.setEnvironment(values);
    defaultAdmin = admin;
  }
  return defaultAdmin;
}

export async function setup(context) { return (await getDefaultAdmin()).setup(context); }
export async function verify(context) { return (await getDefaultAdmin()).verify(context); }
export async function reset(context) { return (await getDefaultAdmin()).reset(context); }
export async function teardown(context) { return (await getDefaultAdmin()).teardown(context); }
export async function verifyReadiness(context) { return (await getDefaultAdmin()).verifyReadiness(context); }
export async function cleanupReadiness(context) { return (await getDefaultAdmin()).cleanupReadiness(context); }
export async function verifyStage(context) { return (await getDefaultAdmin()).verifyStage(context); }
