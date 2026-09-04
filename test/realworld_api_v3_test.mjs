import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, readFileSync } from 'node:fs';

const setRoot = new URL('../benchmark-sets/realworld-api-v3/', import.meta.url);
const benchmarkRoot = new URL('benchmarks/project-management-capacity/', setRoot);
const platforms = ['supabase', 'convex', 'appwrite', 'nhost', 'directus', 'pocketbase', 'trailbase', 'neon'];

function text(relative, root = setRoot) {
  return readFileSync(new URL(relative, root), 'utf8');
}

test('real-world API capacity scaffold declares its lifecycle and metrics', () => {
  assert.match(text('set.conf'), /^id=realworld-api-v3$/m);
  assert.doesNotMatch(text('README.md'), /TODO/);
  const config = text('benchmark.conf', benchmarkRoot);
  assert.match(config, /^primary_metric=capacity_users$/m);
  assert.match(config, /^primary_unit=users$/m);
  assert.match(config, /^primary_direction=higher$/m);
  assert.match(config, /^warmup_trials=0$/m);
  assert.match(config, /^measured_trials=1$/m);
  const required = config.match(/^required_metrics=(.+)$/m)?.[1].split(',') ?? [];
  assert.deepEqual(required, [
    'capacity_bounded', 'achieved_users_at_capacity', 'workflow_tps_at_capacity',
    'remote_operations_per_second_at_capacity', 'read_latency_p95_ms_at_capacity',
    'write_latency_p95_ms_at_capacity', 'auth_search_latency_p95_ms_at_capacity',
    'read_error_rate_at_capacity', 'write_error_rate_at_capacity',
    'auth_search_error_rate_at_capacity',
  ]);
  assert.doesNotMatch(text('METHODOLOGY.md', benchmarkRoot), /TODO/);
  readFileSync(new URL('fixtures/.gitkeep', benchmarkRoot));
});

test('all eight cases expose valid thin lifecycle hooks', () => {
  for (const platform of platforms) {
    const variant = platform === 'neon' ? 'javascript-sql-http' : 'javascript-sdk';
    const caseRoot = new URL(`cases/${platform}/${variant}/`, benchmarkRoot);
    const config = text('case.conf', caseRoot);
    assert.match(config, new RegExp(`^platform=${platform}$`, 'm'));
    assert.match(config, new RegExp(`^variant=${variant}$`, 'm'));
    assert.doesNotMatch(config, /TODO/);
    assert.doesNotMatch(text('README.md', caseRoot), /TODO/);
    for (const action of ['setup', 'verify', 'reset', 'run', 'teardown']) {
      const hook = new URL(`${action}.sh`, caseRoot);
      accessSync(hook, constants.X_OK);
      assert.match(readFileSync(hook, 'utf8'), new RegExp(`shared/case\\.sh" ${action} ${platform}$`, 'm'));
    }
  }
  assert.match(text('cases/neon/javascript-sql-http/case.conf', benchmarkRoot), /^access_path=sql-over-http$/m);
  assert.match(text('cases/neon/javascript-sql-http/case.conf', benchmarkRoot), /^client=@neondatabase\/serverless@1\.1\.0$/m);
});

test('shared hook validates dispatch and installs an isolated Node 22 runtime', () => {
  const hook = text('shared/case.sh');
  assert.match(hook, /setup\|verify\|reset\|run\|teardown/);
  assert.match(hook, /supabase\|convex\|appwrite\|nhost\|directus\|pocketbase\|trailbase\|neon/);
  assert.match(hook, /requires Node\.js 22 or newer/);
  assert.match(hook, /npm ci --ignore-scripts --prefix "\$runtime"/);
  assert.match(hook, /cp -R "\$script_dir\/lib" "\$runtime\/"/);
  for (const asset of ['convex', 'trailbase', 'pocketbase', 'sql']) {
    assert.match(hook, new RegExp(`if \\[ -d "\\$script_dir/${asset}" \\]; then cp -R "\\$script_dir/${asset}" "\\$runtime/"; fi`));
  }
  assert.match(hook, /lib\/run\.mjs/);
  assert.match(hook, /lib\/admin\.mjs/);
  const pkg = JSON.parse(text('shared/package.json'));
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.dependencies['@neondatabase/serverless'], '1.1.0');
  assert.equal(pkg.dependencies['@supabase/supabase-js'], '2.115.0');
  const lock = JSON.parse(text('shared/package-lock.json'));
  assert.equal(lock.packages[''].dependencies['@neondatabase/serverless'], '1.1.0');
});
