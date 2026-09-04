import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LOADS } from './fixtures.mjs';
import { loadAdmin } from './admin.mjs';
import { runStage } from './runner.mjs';
import { summarize } from './summary.mjs';

const platforms = new Set(['supabase', 'neon', 'nhost', 'directus', 'trailbase', 'pocketbase']);
const operations = new Set(['list', 'item', 'write']);
const adapterLoaders = {
  supabase: () => import('./adapters/postgres.mjs'),
  neon: () => import('./adapters/postgres.mjs'),
  nhost: () => import('./adapters/postgres.mjs'),
  directus: () => import('./adapters/postgres.mjs'),
  trailbase: () => import('./adapters/trailbase-wasm.mjs'),
  pocketbase: () => import('./adapters/pocketbase-go.mjs'),
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

    const readinessContext = { ...stageContext, vu: 0, sequence: 0, readiness: true };
    let readinessResult;
    let readinessError;
    let readinessClient;
    try {
      readinessClient = await adapter.createClient(readinessContext);
      readinessResult = await adapter.operation(readinessClient, readinessContext);
      if (!(await adapter.validate(readinessResult, readinessContext))) {
        throw new Error('readiness operation returned an invalid response');
      }
      await admin.verifyReadiness({ ...readinessContext, result: readinessResult });
    } catch (error) {
      readinessError = error;
    }
    let readinessLifecycleError;
    try {
      if (context.operation === 'write' && readinessResult !== undefined) {
        await cleanupReadiness(admin, readinessContext, readinessResult, readinessError);
      } else if (readinessError) {
        throw readinessError;
      }
    } catch (error) {
      readinessLifecycleError = error;
    } finally {
      try {
        if (readinessClient && adapter.closeClient) await adapter.closeClient(readinessClient);
      } catch (cleanupError) {
        if (readinessLifecycleError instanceof Error) readinessLifecycleError.cleanupError = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        else readinessLifecycleError = cleanupError;
      }
    }
    if (readinessLifecycleError) throw readinessLifecycleError;

    const stage = await runStageFn({
      concurrency: load,
      durationMs,
      trial: context.trial,
      createClient: (vu) => adapter.createClient({ ...stageContext, vu }),
      closeClient: adapter.closeClient,
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
    process.exit(1);
  });
}
