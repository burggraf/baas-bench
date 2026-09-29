import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const ACTIONS = new Set(['setup', 'verify', 'reset', 'teardown']);
const PLATFORMS = new Set(['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon']);

export async function dispatchAdmin(args, dependencies = {}) {
  if (args.length !== 5) throw new Error('usage: admin.mjs <action> <platform> <phase> <trial> <output-dir>');
  const [action, platform, phase, trialText, outputDir] = args;
  if (!ACTIONS.has(action) || !PLATFORMS.has(platform)) throw new Error('invalid administrative action or platform');
  if (phase && !new Set(['setup', 'verify', 'warmup', 'measure', 'teardown']).has(phase)) throw new Error('invalid phase');
  if (trialText && (!/^(0|[1-9]\d*)$/.test(trialText) || !Number.isSafeInteger(Number(trialText)))) throw new Error('invalid trial');
  if (outputDir && (!isAbsolute(outputDir) || outputDir.includes('\0') || outputDir.split(/[\\/]/).includes('..'))) throw new Error('invalid output directory');
  const module = await (dependencies.loadAdmin ?? (name => import(`./admin/${name}.mjs`)))(platform);
  const handler = module[action];
  if (typeof handler !== 'function') throw new Error(`administrative action ${action} is unavailable`);
  await handler({ platform, phase: phase || undefined, trial: trialText ? Number(trialText) : undefined, outputDir: outputDir || undefined });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dispatchAdmin(process.argv.slice(2)).catch(error => { console.error(String(error?.message ?? error).slice(0, 300)); process.exitCode = 1; });
}
