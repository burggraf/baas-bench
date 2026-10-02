import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNativeWorkerConfig } from './native_v5_worker_backend.mjs';
import { nativeProbeMode } from './native_v5_provenance.mjs';
const token = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

test('Disposable native timed mode remains explicitly scoped and independent of admission', () => {
  assert.deepEqual(nativeProbeMode(['--local-timed-stage']), { scale: false, lifecycle: true, parallel: true });
  assert.deepEqual(nativeProbeMode(['--local-lifecycle']), { scale: false, lifecycle: true, parallel: false });
  assert.deepEqual(nativeProbeMode(['--local-declared-scale']), { scale: true, lifecycle: false, parallel: false });
  for (const args of [[], ['--local-timed-stage', 'extra'], ['--cloud'], ['--unknown']]) assert.throws(() => nativeProbeMode(args));
});

test('Native worker factories allow only loopback anonymous endpoints, not cloud or service-admin clients', () => {
  assert.equal(validateNativeWorkerConfig({ platform: 'supabase', url: 'http://127.0.0.1:12345', key: token('anon') }).url, 'http://127.0.0.1:12345');
  assert.equal(validateNativeWorkerConfig({ platform: 'trailbase', url: 'http://127.0.0.1:12345' }).platform, 'trailbase');
  for (const options of [{ platform: 'supabase', url: 'http://127.0.0.1:12345', key: token('service_role') },
    { platform: 'trailbase', url: 'https://example.com' }, { platform: 'trailbase', url: 'http://user:secret@127.0.0.1:12345' },
    { platform: 'trailbase', url: 'http://127.0.0.1:12345/private' }, { platform: 'trailbase', url: 'http://127.0.0.1:12345?token=secret' },
    { platform: 'neon', url: 'http://127.0.0.1:12345' }, { platform: 'trailbase', url: 'http://127.0.0.1:12345', key: 'admin' }]) assert.throws(() => validateNativeWorkerConfig(options));
});
