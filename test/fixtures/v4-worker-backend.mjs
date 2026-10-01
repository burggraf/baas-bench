import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { BenchmarkOperationError } from '../../benchmark-sets/realworld-api-v4/shared/lib/correctness.mjs';
import { measureRemoteCall } from '../../benchmark-sets/realworld-api-v4/shared/lib/measurement.mjs';

export function createBackend() {
  return {
    sessionPreparationConcurrency: 1,
    sessionPreparationBatchDelayMs: 2,
    async createSession(credentials) {
      const log = (event, fields = {}) => { if (process.env.V4_TEST_WORKER_LOG) appendFileSync(process.env.V4_TEST_WORKER_LOG, `${JSON.stringify({ event, pid: process.pid, at: Date.now(), ...fields })}\n`); };
      log('prepare-start');
      await sleep(5);
      log('prepare-end');
      if (credentials.password === 'prepare-fail') throw new Error('fake preparation failure');
      let first = true;
      return {
        cancelPending() {},
        async close() { log('close'); },
        async listTasks({ pageSize }) {
          if (first) { first = false; log('first-page', { email: credentials.email, pageSize }); }
          if (credentials.password === 'crash') process.exit(17);
          if (credentials.password === 'integrity-fail') throw new Error('invalid fixture response');
          return measureRemoteCall(async () => {
            if (credentials.password === 'operation-fail') throw new BenchmarkOperationError('timeout', { code: 'timeout' });
            return { items: [], page: 0, pageSize, total: 0, hasNext: false };
          });
        },
      };
    },
  };
}
