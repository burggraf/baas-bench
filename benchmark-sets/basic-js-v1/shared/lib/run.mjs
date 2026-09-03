import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LOADS } from './fixtures.mjs';
import { loadAdmin } from './admin.mjs';
import { runStage } from './runner.mjs';
import { summarize } from './summary.mjs';

const platforms = new Set(['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase']);
const operations = new Set(['list', 'item', 'write']);
const adapterLoaders = {
  supabase: () => import('./adapters/supabase.mjs'),
  convex: () => import('./adapters/convex.mjs'),
  appwrite: () => import('./adapters/appwrite.mjs'),
  nhost: () => import('./adapters/nhost.mjs'),
  directus: () => import('./adapters/directus.mjs'),
  pocketbase: () => import('./adapters/pocketbase.mjs'),
  trailbase: () => import('./adapters/trailbase.mjs'),
};

function parseArguments(args) {
  if (args.length !== 5) throw new Error('invalid run arguments');
  const [platform, operation, phase, trialText, outputDir] = args;
  if (!platforms.has(platform)) throw new Error('invalid platform');
  if (!operations.has(operation)) throw new Error('invalid operation');
  if (!['warmup', 'measure'].includes(phase)) throw new Error('invalid phase');
  if (!/^[1-9]\d*$/.test(trialText) || !Number.isSafeInteger(Number(trialText))) throw new Error('invalid trial');
  if (!isAbsolute(outputDir)) throw new Error('output directory must be absolute');
  return { platform, operation, phase, trial: Number(trialText), outputDir };
}

async function cleanupReadiness(admin, context, result, originalError) {
  try {
    await admin.cleanupReadiness({ ...context, result });
  } catch (cleanupError) {
    if (!originalError) throw cleanupError;
    originalError.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
  if (originalError) throw originalError;
}

export async function executeRun(context, dependencies) {
  const { admin, adapter } = dependencies;
  const runStageFn = dependencies.runStage ?? runStage;
  const durationMs = context.phase === 'warmup' ? 5_000 : 15_000;
  const rawDir = join(context.outputDir, 'raw');
  await mkdir(rawDir, { recursive: true });
  const stages = [];

  for (const load of LOADS) {
    const stageContext = { ...context, load };
    await admin.reset(stageContext);

    let readinessResult;
    let readinessError;
    try {
      const client = await adapter.createClient({ ...stageContext, vu: 0, readiness: true });
      readinessResult = await adapter.operation(client, { ...stageContext, vu: 0, sequence: 0, readiness: true });
      if (!(await adapter.validate(readinessResult, { ...stageContext, vu: 0, sequence: 0, readiness: true }))) {
        throw new Error('readiness operation returned an invalid response');
      }
      await admin.verifyReadiness({ ...stageContext, result: readinessResult });
    } catch (error) {
      readinessError = error;
    }
    if (context.operation === 'write' && readinessResult !== undefined) {
      await cleanupReadiness(admin, stageContext, readinessResult, readinessError);
    } else if (readinessError) {
      throw readinessError;
    }

    const stage = await runStageFn({
      concurrency: load,
      durationMs,
      trial: context.trial,
      createClient: (vu) => adapter.createClient({ ...stageContext, vu }),
      operation: (client, operationContext) => adapter.operation(client, { ...stageContext, ...operationContext }),
      validate: (result, operationContext) => adapter.validate(result, { ...stageContext, ...operationContext }),
    });
    stages.push(stage);
    await writeFile(join(rawDir, `vu-${load}.json`), `${JSON.stringify(stage, null, 2)}\n`, { mode: 0o600 });
    await admin.verifyStage({ ...stageContext, stage });
  }

  if (context.phase === 'measure') {
    await writeFile(join(context.outputDir, 'summary.json'), `${JSON.stringify(summarize(stages), null, 2)}\n`, { mode: 0o600 });
  }
}

export async function runFromArguments(args, dependencies = {}) {
  const context = parseArguments(args);
  const [admin, adapter] = await Promise.all([
    (dependencies.loadAdmin ?? loadAdmin)(context.platform),
    (dependencies.loadAdapter ?? adapterLoaders[context.platform])(),
  ]);
  await executeRun(context, { ...dependencies, admin, adapter });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromArguments(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
