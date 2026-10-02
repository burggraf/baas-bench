import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { mulberry32 } from './random.mjs';
import { runWorkflow, selectWorkflow } from './workflows.mjs';
import { entityId, DATASET_COUNTS } from './dataset.mjs';

export const WARMUP = Object.freeze({ users: 50, durationMs: 120000, seed: 42, timeoutMs: 5000 });
export const WORKFLOW_WEIGHTS = Object.freeze({ dashboard: 20, taskList: 25, taskDetail: 15, createTask: 10, updateTask: 12, addComment: 10, search: 5, profileUpdate: 1, signIn: 2 });

// Callers own contexts, including partially prepared cohorts on failure.
export async function prepareWarmupContexts(backend, specs, contexts, options = {}) {
  if (contexts.length || specs.length !== WARMUP.users) throw new Error('warm-up requires a fresh 50-user cohort');
  return prepareUserContexts(backend, specs, contexts, options);
}

export async function prepareUserContexts(backend, specs, contexts, { now = () => performance.now(), wait = sleep, concurrency: requestedConcurrency, userOffset = 0, signal } = {}) {
  if (!Array.isArray(specs) || !specs.length || contexts.length || !Number.isSafeInteger(userOffset) || userOffset < 0 || specs.length + userOffset > DATASET_COUNTS.users) throw new Error('invalid prepared cohort');
  if (Array.from(specs).some(spec => !spec?.credentials || typeof spec.credentials.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(spec.credentials.email) || typeof spec.credentials.password !== 'string' || !spec.credentials.password.length || spec.credentials.password.length > 1024 || ['organizationId', 'projectId', 'taskId'].some(key => typeof spec[key] !== 'string' || !spec[key]))) throw new Error('invalid actor specification');
  if (new Set(specs.map(spec => spec.credentials.email)).size !== specs.length) throw new Error('duplicate prepared actor');
  const concurrency = requestedConcurrency ?? Math.min(10, backend.sessionPreparationConcurrency ?? 10);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error('invalid preparation concurrency');
  for (let start = 0; start < specs.length; start += concurrency) {
    const results = await Promise.allSettled(specs.slice(start, start + concurrency).map(async (spec, offset) => {
      const index = start + offset;
      const random = mulberry32((WARMUP.seed + Math.imul(userOffset + index, 0x9e3779b9)) >>> 0);
      const context = { ...spec, userId: spec.userId ?? entityId('user', userOffset + index), random, now, signal, sample() {}, pageSize: () => 1 + Math.floor(random() * 25),
        invoke: async (_name, _operationClass, _kind, work) => work() };
      contexts[index] = context;
      context.session = await backend.createSession(spec.credentials, { timeoutMs: WARMUP.timeoutMs, signal });
      context.replaceSession = async () => {
        await context.session.close();
        context.session = undefined;
        context.session = await backend.createSession(spec.credentials, { timeoutMs: WARMUP.timeoutMs, signal: context.signal });
      };
      const profile = await context.session.getProfile();
      if (profile.id !== context.userId || profile.email !== spec.credentials.email) throw new Error('prepared actor mismatch');
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    if (start + concurrency < specs.length) await wait(backend.sessionPreparationBatchDelayMs ?? 0);
  }
  return true;
}

// The same prepared contexts survive into stage entry; no reset/re-login here.
export async function runWarmup(contexts, { now = () => performance.now(), wait = sleep } = {}) {
  if (contexts.length !== WARMUP.users || Array.from(contexts).some(context => !context?.session)) throw new Error('incomplete warm-up cohort');
  const started = now(), deadline = started + WARMUP.durationMs;
  const workflows = Object.fromEntries(Object.keys(WORKFLOW_WEIGHTS).map(name => [name, 0]));
  let failure;
  await Promise.all(contexts.map(async context => {
    try {
      while (!failure && now() < deadline) {
        const name = selectWorkflow(WORKFLOW_WEIGHTS, context.random);
        await runWorkflow(name, context);
        workflows[name]++;
        const remaining = deadline - now();
        if (remaining > 0 && !failure) await wait(Math.min(remaining, 1000 + Math.floor(context.random() * 4001)));
      }
    } catch (error) { failure ??= error instanceof Error ? error : new Error('warm-up operation failed'); }
  }));
  if (failure) throw failure;
  if (now() < deadline || Object.values(workflows).some(count => count === 0)) throw new Error('incomplete warm-up coverage');
  return { passed: true, users: contexts.length, duration_ms: WARMUP.durationMs, seed: WARMUP.seed, workflows };
}
