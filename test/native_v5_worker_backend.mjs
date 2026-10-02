import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSupabaseAdapter } from '../benchmark-sets/realworld-api-v5/shared/lib/adapters/supabase.mjs';
import { createTrailBaseAdapter } from '../benchmark-sets/realworld-api-v5/shared/lib/adapters/trailbase.mjs';
import { pinnedNodeVersion } from './native_v5_provenance.mjs';

export function validateNativeWorkerConfig({ platform, url, key } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('invalid local worker endpoint'); }
  if (!['supabase', 'trailbase'].includes(platform) || endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || Number(endpoint.port) < 1 || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('native worker requires an explicit loopback endpoint');
  if (platform === 'supabase') {
    let anonymous = typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key);
    if (!anonymous) {
      try { anonymous = typeof key === 'string' && key.split('.').length === 3 && JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch {}
    }
    if (!anonymous) throw new Error('native worker requires anonymous Supabase credentials');
  } else if (key !== undefined) throw new Error('TrailBase worker must not receive an admin key');
  return { platform, url: endpoint.origin, ...(platform === 'supabase' ? { key } : {}) };
}

// Only disposable localhost diagnostics. No cloud, service-role key, or admin session.
export async function createBackend(options) {
  const config = validateNativeWorkerConfig(options);
  const root = fileURLToPath(new URL('../', import.meta.url));
  assert.equal(process.versions.node, pinnedNodeVersion(root), 'native worker requires the exact V5 Node pin');
  const sdk = join(root, '.runtime/conformance-v5/sdk');
  const require = createRequire(join(sdk, 'package.json'));
  const name = config.platform === 'supabase' ? '@supabase/supabase-js' : 'trailbase';
  const dependencies = JSON.parse(readFileSync(join(root, 'benchmark-sets/realworld-api-v5/shared/package.json'), 'utf8')).dependencies;
  assert.equal(JSON.parse(readFileSync(join(sdk, 'node_modules', name, 'package.json'), 'utf8')).version, dependencies[name], 'native worker SDK must match V5');
  const module = await import(pathToFileURL(require.resolve(name)).href);
  return config.platform === 'supabase'
    ? createSupabaseAdapter({ sdkCreateClient: module.createClient, url: config.url, key: config.key, timeoutMs: 5000 })
    : createTrailBaseAdapter({ initClient: module.initClient, endpoint: config.url, timeoutMs: 5000 });
}
