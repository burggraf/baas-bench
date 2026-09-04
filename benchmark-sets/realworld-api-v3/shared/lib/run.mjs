import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCorrectness } from './correctness.mjs';
import { StageMetricsAccumulator } from './metrics.mjs';
import { evaluateCapacity, nextCapacityStage } from './capacity.mjs';
import { runWorkload } from './workload.mjs';
import { collectResources, discoverPlatformContainers, evaluateRunnerOverload } from './resources.mjs';
import { summarize } from './summary.mjs';

const PLATFORMS = new Set(['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon']);
const DEFAULT_CONFIG = Object.freeze({
  seed: 42, stageSeconds: 300, timeoutMs: 5_000, thinkTimeMs: { min: 1_000, max: 5_000 },
  weights: { dashboard: 20, taskList: 25, taskDetail: 15, createTask: 10, updateTask: 12, addComment: 10, search: 5, profileUpdate: 1, signIn: 2 },
  slos: { read: { p95Ms: 500, maxErrorRate: 0.01 }, write: { p95Ms: 1_000, maxErrorRate: 0.01 }, authSearch: { p95Ms: 1_000, maxErrorRate: 0.01 } },
});

function parseArguments(args) {
  if (args.length !== 4) throw new Error('usage: run.mjs <platform> <phase> <trial> <absolute-output-dir>');
  const [platform, phase, trialText, outputDir] = args;
  if (!PLATFORMS.has(platform)) throw new Error('invalid platform');
  if (phase !== 'measure') throw new Error('phase must be measure');
  if (!/^[1-9]\d*$/.test(trialText) || !Number.isSafeInteger(Number(trialText))) throw new Error('invalid trial');
  if (!isAbsolute(outputDir) || outputDir.includes('\0') || outputDir.split(/[\\/]/).includes('..')) throw new Error('output directory must be an absolute normalized path');
  return { platform, phase, trial: Number(trialText), outputDir };
}

const safeErrors = errors => errors.slice(0, 100).map(value => {
  const text = String(value?.message ?? value ?? 'operation failed')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [REDACTED]')
    .replace(/\b(password|secret|token|key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
  return text.slice(0, 300);
});

export async function preservePrimaryFailure(work, teardown) {
  let primary;
  let didFail = false;
  try { return await work(); } catch (error) { primary = error; didFail = true; }
  finally {
    try { await teardown(); }
    catch (error) {
      if (!didFail) throw error;
      // Teardown is secondary: annotate extensible failures when possible, but never
      // let annotation (or a primitive throw) replace the original failure.
      if (primary && (typeof primary === 'object' || typeof primary === 'function')) {
        try { primary.teardownError = String(error?.message ?? error).slice(0, 300); } catch { /* primary may be frozen */ }
      }
    }
  }
  throw primary;
}

export async function executeRun(context, dependencies) {
  const warmupMs = context.warmupMs ?? 120_000;
  const stageMs = context.stageMs ?? 300_000;
  if (!PLATFORMS.has(context.platform) || context.phase !== 'measure' || !Number.isSafeInteger(context.trial) || context.trial < 1 || !isAbsolute(context.outputDir)) throw new Error('invalid run context');
  if (!Number.isFinite(warmupMs) || warmupMs < 0 || !Number.isFinite(stageMs) || stageMs <= 0) throw new Error('invalid durations');
  await mkdir(context.outputDir, { recursive: true, mode: 0o700 });
  await chmod(context.outputDir, 0o700);

  const adapter = dependencies.adapter;
  if (!adapter || !Array.isArray(adapter.users) || !adapter.fixture) throw new Error('adapter did not provide fixture and users');
  const config = { ...DEFAULT_CONFIG, ...dependencies.config, stageSeconds: stageMs / 1_000 };
  const correctnessFn = dependencies.correctness ?? runCorrectness;
  const workloadFn = dependencies.workload ?? runWorkload;
  const resourcesFn = dependencies.collectResources ?? collectResources;
  const evaluate = dependencies.evaluateCapacity ?? evaluateCapacity;
  const chooseNext = dependencies.nextStage ?? nextCapacityStage;
  const monotonic = dependencies.monotonic ?? (() => performance.now());
  const correctness = await correctnessFn(adapter, adapter.fixture);
  if (correctness.aborted || correctness.findings?.some(finding => !finding.passed)) throw new Error('correctness checks failed');
  if (adapter.users.length < 50) throw new Error('adapter returned fewer than 50 virtual users');

  // Deliberately do not reset after this write-capable warm-up: its state remains for measured stages.
  const warmup = await workloadFn(adapter, config, { users: adapter.users.slice(0, 50), durationMs: warmupMs, graceMs: config.timeoutMs });
  if (warmup.stageFailed || warmup.failedWorkflowCount) throw new Error('warm-up failed');

  const stages = [];
  const resources = [];
  const failures = [];
  const measuredUsers = [];
  let lowerPass;
  let upperFailure;
  let refinements = 0;
  let capacity = { selectedCapacityUsers: 0, stages: [], reasons: [], saturation: false };
  for (;;) {
    if (upperFailure !== undefined && lowerPass === undefined) break;
    const refining = lowerPass !== undefined && upperFailure !== undefined;
    const requestedUsers = chooseNext({ measuredUsers, lowerPass, upperFailure, refinements, maxUsers: adapter.users.length });
    if (requestedUsers === null) break;
    if (!Number.isSafeInteger(requestedUsers) || requestedUsers < 1 || requestedUsers > adapter.users.length || measuredUsers.includes(requestedUsers)) throw new Error('invalid adaptive capacity decision');
    const accumulator = (dependencies.metricsFactory ?? (options => new StageMetricsAccumulator(options)))({ maxErrorExamples: 100 });
    let start;
    let end;
    let resourcePromise;
    const resourceSamples = Math.max(1, Math.ceil(stageMs / 1_000));
    const containerIds = dependencies.containerIds ?? [];
    const result = await workloadFn(adapter, config, {
      users: adapter.users.slice(0, requestedUsers), durationMs: stageMs, graceMs: config.timeoutMs,
      onSample: sample => accumulator.record(sample),
      onMeasuredStart: async () => { start = monotonic(); resourcePromise = resourcesFn({ platform: context.platform, containerIds, samples: resourceSamples, intervalMs: 1_000 }); },
      onMeasuredEnd: async () => { end = monotonic(); },
    });
    if (start === undefined || end === undefined || !resourcePromise) throw new Error('measured stage boundaries unavailable');
    const resource = await resourcePromise;
    const elapsed = (end - start) / 1_000;
    const stage = accumulator.finalize(elapsed, { requestedUsers, achievedUsers: Math.max(0, result.startedUsers - (result.lostUsers ?? 0)) });
    const overload = evaluateRunnerOverload(resource.samples ?? []);
    if (overload) stage.validityReasons.push(overload);
    if (!resource.valid) stage.validityReasons.push(...(resource.validityReasons ?? ['resource collection failed']));
    if (result.stageFailed) stage.validityReasons.push('workload failed');
    if (dependencies.containerDiscoveryError) stage.validityReasons.push(`container discovery failed: ${String(dependencies.containerDiscoveryError?.message ?? dependencies.containerDiscoveryError).slice(0, 300)}`);
    stage.valid = stage.validityReasons.length === 0;
    failures.push(...(stage.errorExamples ?? []));
    stage.errorExamples = safeErrors(stage.errorExamples ?? []);
    stages.push(stage); resources.push({ requestedUsers, samples: resource.samples ?? [] }); measuredUsers.push(requestedUsers);
    stages.sort((a, b) => a.requestedUsers - b.requestedUsers);
    capacity = evaluate(stages, config, { minSamples: 20 });
    const current = capacity.stages.find(item => item.requestedUsers === requestedUsers);
    if (current?.passed) lowerPass = Math.max(lowerPass ?? 0, requestedUsers);
    else if (current && !current.invalid) upperFailure = Math.min(upperFailure ?? requestedUsers, requestedUsers);
    if (refining) refinements++;
  }

  const raw = { schemaVersion: 1, platform: context.platform, trial: context.trial, accessPath: context.accessPath ?? adapter.accessPath ?? 'unknown', deviations: [...(context.deviations ?? adapter.deviations ?? [])], correctness, warmup: { users: 50, durationMs: warmupMs, writesReset: false }, stages, resources, capacity, errors: safeErrors(failures) };
  await writeFile(join(context.outputDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await writeFile(join(context.outputDir, 'summary.json'), `${JSON.stringify(summarize(stages, capacity), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return raw;
}

export async function runFromArguments(args, dependencies = {}) {
  const context = parseArguments(args);
  const loadAdapter = dependencies.loadAdapter ?? (platform => import(`./adapters/${platform}.mjs`).then(module => module.createAdapter()));
  const adapter = await loadAdapter(context.platform);
  let ids = [];
  let containerDiscoveryError;
  try { ids = await (dependencies.discoverContainers ?? discoverPlatformContainers)(context.platform); }
  catch (error) { containerDiscoveryError = error; }
  return preservePrimaryFailure(
    () => executeRun({ ...context, accessPath: adapter.accessPath, deviations: adapter.deviations }, { ...dependencies, adapter, containerIds: ids, containerDiscoveryError }),
    () => dependencies.teardown?.(context) ?? Promise.resolve(),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromArguments(process.argv.slice(2)).catch(error => { console.error(String(error?.message ?? error).slice(0, 300)); process.exitCode = 1; });
}
