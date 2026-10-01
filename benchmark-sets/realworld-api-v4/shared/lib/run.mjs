import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCorrectness } from './correctness.mjs';
import { StageMetricsAccumulator } from './metrics.mjs';
import { evaluateCapacity, nextCapacityStage } from './capacity.mjs';
import { runWorkload } from './workload.mjs';
import { collectResources, discoverPlatformContainers, evaluateRunnerOverload, RESOURCE_SAMPLE_INTERVAL_MS } from './resources.mjs';
import { sampleLocalHost, sampleRemoteHost } from './host-telemetry.mjs';
import { summarize } from './summary.mjs';
import { createProgress } from './progress.mjs';

const PLATFORMS = new Set(['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon']);
const DEFAULT_CONFIG = Object.freeze({
  seed: 42, stageSeconds: 300, timeoutMs: 5_000, thinkTimeMs: { min: 1_000, max: 5_000 },
  weights: { dashboard: 20, taskList: 25, taskDetail: 15, createTask: 10, updateTask: 12, addComment: 10, search: 5, profileUpdate: 1, signIn: 2 },
  slos: { read: { p95Ms: 500, maxErrorRate: 0.01 }, write: { p95Ms: 750, maxErrorRate: 0.01 }, authSearch: { p95Ms: 1_000, maxErrorRate: 0.01 } },
});

export const capacityStageDurationMs = (stageMs, users) => Math.ceil(stageMs * Math.max(1, 5 / users));

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
  const progress = dependencies.progress ?? createProgress('runner');
  try {
    const raw = await executeMeasuredRun(context, dependencies, progress);
    progress.phase('complete', { stages_completed: raw.stages.length });
    return raw;
  } catch (error) { progress.phase('failed'); throw error; }
  finally { progress.stop(); }
}

async function executeMeasuredRun(context, dependencies, progress) {
  const warmupMs = context.warmupMs ?? 120_000;
  const stageMs = context.stageMs ?? 300_000;
  if (!PLATFORMS.has(context.platform) || context.phase !== 'measure' || !Number.isSafeInteger(context.trial) || context.trial < 1 || !isAbsolute(context.outputDir)) throw new Error('invalid run context');
  if (!Number.isFinite(warmupMs) || warmupMs < 0 || !Number.isFinite(stageMs) || stageMs <= 0) throw new Error('invalid durations');
  await mkdir(context.outputDir, { recursive: true, mode: 0o700 });
  await chmod(context.outputDir, 0o700);

  const backend = dependencies.backend ?? dependencies.adapter;
  if (!backend) throw new Error('backend is unavailable');
  const fixture = dependencies.fixture ?? backend.fixture ?? await backend.correctnessFixture?.();
  const users = dependencies.users ?? backend.users ?? await backend.virtualUsers?.(10_000);
  if (!fixture || !Array.isArray(users)) throw new Error('backend did not provide fixture and users');
  const config = { ...DEFAULT_CONFIG, ...dependencies.config, stageSeconds: stageMs / 1_000 };
  const correctnessFn = dependencies.correctness ?? runCorrectness;
  const workloadFn = dependencies.workload ?? runWorkload;
  const resourcesFn = dependencies.collectResources ?? collectResources;
  const evaluate = dependencies.evaluateCapacity ?? evaluateCapacity;
  const chooseNext = dependencies.nextStage ?? nextCapacityStage;
  const monotonic = dependencies.monotonic ?? (() => performance.now());
  const dockerSshTarget = dependencies.dockerSshTarget ?? process.env.BAAS_BENCH_DOCKER_SSH_TARGET;
  progress.phase('correctness');
  const correctness = await correctnessFn(backend, fixture);
  if (correctness.aborted || correctness.findings?.some(finding => !finding.passed)) throw new Error('correctness checks failed');
  if (users.length < 50) throw new Error('backend returned fewer than 50 virtual users');

  // Deliberately do not reset after this write-capable warm-up: its state remains for measured stages.
  progress.phase('prepare-sessions', { stage_users: 50 });
  await workloadFn(backend, config, {
    users: users.slice(0, 50), durationMs: warmupMs, graceMs: config.timeoutMs,
    onProgress: (phase, fields) => phase === 'prepare-sessions' ? progress.count(fields) : progress.phase(phase, fields),
    onMeasuredStart: () => progress.phase('warmup', { stage_users: 50, duration_ms: warmupMs }),
    onSample: () => {},
  });

  const stages = [];
  const resources = [];
  const failures = [];
  const measuredUsers = [];
  let lowerPass;
  let upperFailure;
  let refinements = 0;
  let capacity = { selectedCapacityUsers: 0, stages: [], reasons: [], saturation: false };
  for (;;) {
    const refining = lowerPass !== undefined && upperFailure !== undefined;
    const requestedUsers = chooseNext({ measuredUsers, lowerPass, upperFailure, refinements, maxUsers: users.length });
    if (requestedUsers === null) break;
    if (!Number.isSafeInteger(requestedUsers) || requestedUsers < 1 || requestedUsers > users.length || measuredUsers.includes(requestedUsers)) throw new Error('invalid adaptive capacity decision');
    const accumulator = (dependencies.metricsFactory ?? (options => new StageMetricsAccumulator(options)))({ maxErrorExamples: 100, maxLatencySamples: 1_000_000 });
    let start;
    let end;
    let resourcePromise;
    const durationMs = capacityStageDurationMs(stageMs, requestedUsers);
    const resourceSamples = Math.max(1, Math.ceil(durationMs / RESOURCE_SAMPLE_INTERVAL_MS));
    const containerIds = dependencies.containerIds ?? [];
    const counters = { completed_operations: 0, failed_operations: 0, completed_workflows: 0, failed_workflows: 0, telemetry_samples: 0, telemetry_expected: resourceSamples };
    const stageFields = { stage_users: requestedUsers, stage_index: stages.length + 1, stages_completed: stages.length };
    progress.phase('prepare-sessions', stageFields);
    const result = await workloadFn(backend, config, {
      users: users.slice(0, requestedUsers), durationMs, graceMs: config.timeoutMs,
      onProgress: (phase, fields) => phase === 'prepare-sessions' ? progress.count(fields) : progress.phase(phase, { ...stageFields, ...counters, ...fields }),
      onSample: sample => {
        accumulator.record(sample);
        const key = sample.type === 'remote' ? (sample.success ? 'completed_operations' : 'failed_operations') : (sample.success ? 'completed_workflows' : 'failed_workflows');
        counters[key]++;
        progress.count({ [key]: counters[key] });
      },
      onMeasuredStart: async () => {
        start = monotonic();
        progress.phase('measure', { ...stageFields, ...counters, duration_ms: durationMs });
        const hostTelemetry = dockerSshTarget ? { runnerHostProbe: () => sampleLocalHost(), backendHostProbe: () => sampleRemoteHost(dockerSshTarget) } : {};
        resourcePromise = resourcesFn({ platform: context.platform, containerIds, dockerSshTarget, samples: resourceSamples, intervalMs: RESOURCE_SAMPLE_INTERVAL_MS, ...hostTelemetry,
          onProgress: count => { counters.telemetry_samples = count; progress.count({ telemetry_samples: count }); },
        });
      },
      onMeasuredEnd: async () => { end = monotonic(); },
    });
    let resource;
    let stage;
    if (start === undefined || end === undefined || !resourcePromise) {
      if (!result.preparationFailed) throw new Error('measured stage boundaries unavailable');
      const failureCount = result.preparationFailureCount ?? requestedUsers;
      const noun = failureCount === 1 ? 'user' : 'users';
      resource = { samples: [], valid: true, validityReasons: [] };
      stage = {
        requestedUsers, achievedUsers: 0, elapsedSeconds: 0,
        workflowTransactionsPerSecond: 0, workflowTransactionsPerSecondByName: {},
        remoteOperationsPerSecond: 0, readOperationsPerSecond: 0, writeOperationsPerSecond: 0,
        workflowCompletionCountByName: {}, operationClassMetrics: {}, operations: {}, errorExamples: [],
        valid: false, validityReasons: [`session preparation failed for ${failureCount} ${noun}`],
      };
    } else {
      progress.phase('telemetry-drain', { ...stageFields, ...counters });
      resource = await resourcePromise;
      const elapsed = (end - start) / 1_000;
      stage = accumulator.finalize(elapsed, { requestedUsers, achievedUsers: Math.max(0, result.startedUsers - (result.lostUsers ?? 0)) });
    }
    const overload = evaluateRunnerOverload(resource.samples ?? []);
    if (overload) stage.validityReasons.push(overload);
    if (!resource.valid) stage.validityReasons.push(...(resource.validityReasons ?? ['resource collection failed']));
    if (result.stageFailed) stage.validityReasons.push('workload failed');
    if (dependencies.containerDiscoveryError) stage.validityReasons.push(`container discovery failed: ${String(dependencies.containerDiscoveryError?.message ?? dependencies.containerDiscoveryError).slice(0, 300)}`);
    stage.valid = stage.validityReasons.length === 0;
    failures.push(...(stage.errorExamples ?? []));
    stage.errorExamples = safeErrors(stage.errorExamples ?? []);
    stage.workload = result;
    stages.push(stage); resources.push({ requestedUsers, samples: resource.samples ?? [] }); measuredUsers.push(requestedUsers);
    stages.sort((a, b) => a.requestedUsers - b.requestedUsers);
    capacity = evaluate(stages, config, { minSamples: 20 });
    const current = capacity.stages.find(item => item.requestedUsers === requestedUsers);
    if (!current) throw new Error('capacity evaluation omitted measured stage');
    progress.phase('stage-complete', { ...stageFields, stages_completed: stages.length, outcome: current.passed ? 'pass' : current.invalid ? 'invalid' : 'fail', ...counters });
    if (current.invalid) break;
    if (current.passed) lowerPass = Math.max(lowerPass ?? 0, requestedUsers);
    else upperFailure = Math.min(upperFailure ?? requestedUsers, requestedUsers);
    if (refining) refinements++;
  }

  const raw = { schemaVersion: 1, platform: context.platform, trial: context.trial, accessPath: context.accessPath ?? backend.accessPath ?? 'unknown', deviations: [...(context.deviations ?? backend.deviations ?? [])], correctness, warmup: { users: 50, durationMs: warmupMs, writesReset: false }, stages, resources, capacity, errors: safeErrors(failures) };
  await writeFile(join(context.outputDir, 'raw.json'), `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await writeFile(join(context.outputDir, 'summary.json'), `${JSON.stringify(summarize(stages, capacity), null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return raw;
}

export async function runFromArguments(args, dependencies = {}) {
  const context = parseArguments(args);
  const loadBackend = dependencies.loadBackend ?? (platform => import(`./adapters/${platform}.mjs`).then(module => module.createBackend(dependencies.backendDependencies)));
  const backend = await loadBackend(context.platform);
  let ids = [];
  let containerDiscoveryError;
  const dockerSshTarget = dependencies.dockerSshTarget ?? process.env.BAAS_BENCH_DOCKER_SSH_TARGET;
  try { ids = await (dependencies.discoverContainers ?? discoverPlatformContainers)(context.platform, undefined, { sshTarget: dockerSshTarget }); }
  catch (error) { containerDiscoveryError = error; }
  return preservePrimaryFailure(
    () => executeRun({ ...context, accessPath: backend.accessPath, deviations: backend.deviations }, { ...dependencies, backend, containerIds: ids, containerDiscoveryError, dockerSshTarget }),
    () => dependencies.teardown?.(context) ?? Promise.resolve(),
  );
}

export async function runCli(args, dependencies = {}, io = {}) {
  const run = io.run ?? runFromArguments;
  const exit = io.exit ?? (code => process.exit(code));
  const report = io.error ?? (message => console.error(message));
  try { await run(args, dependencies); exit(0); }
  catch (error) { report(String(error?.message ?? error).slice(0, 300)); exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli(process.argv.slice(2));
}
