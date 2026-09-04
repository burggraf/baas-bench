import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const actions = new Set(['setup', 'verify', 'reset', 'teardown']);
const platforms = new Set(['supabase', 'neon', 'nhost', 'directus', 'trailbase', 'pocketbase']);
const operations = new Set(['list', 'item', 'write']);
const loaders = {
  supabase: () => import('./admin/supabase.mjs'),
  neon: () => import('./admin/neon.mjs'),
  nhost: () => import('./admin/nhost.mjs'),
  directus: () => import('./admin/directus.mjs'),
  trailbase: () => import('./admin/trailbase.mjs'),
  pocketbase: () => import('./admin/pocketbase.mjs'),
};

function parseArguments(args) {
  if (args.length !== 6) throw new Error('invalid administrative arguments');
  const [action, platform, operation, phase, trialText, outputDir] = args;
  if (!actions.has(action)) throw new Error('invalid administrative action');
  if (!platforms.has(platform)) throw new Error('invalid platform');
  if (!operations.has(operation)) throw new Error('invalid operation');
  if (!['setup', 'verify', 'warmup', 'measure', 'teardown'].includes(phase)) throw new Error('invalid phase');
  if (!/^\d+$/.test(trialText)) throw new Error('invalid trial');
  const trial = Number(trialText);
  if (!Number.isSafeInteger(trial)) throw new Error('invalid trial');
  if (!isAbsolute(outputDir)) throw new Error('output directory must be absolute');

  const validLifecycle =
    (action === 'setup' && phase === 'setup' && trial === 0) ||
    (action === 'teardown' && phase === 'teardown' && trial === 0) ||
    (action === 'verify' && phase === 'verify' && trial === 0) ||
    (['verify', 'reset'].includes(action) && ['warmup', 'measure'].includes(phase) && trial > 0);
  if (!validLifecycle) throw new Error('invalid action phase or trial');
  return { action, platform, operation, phase, trial, outputDir };
}

export async function loadAdmin(platform) {
  return loaders[platform]();
}

export async function runAdmin(args, dependencies = {}) {
  const context = parseArguments(args);
  const module = await (dependencies.loadModule ?? loadAdmin)(context.platform);
  const handler = module[context.action];
  if (typeof handler !== 'function') throw new Error(`platform does not implement ${context.action}`);
  await handler({ ...context, env: dependencies.env ?? process.env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAdmin(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
