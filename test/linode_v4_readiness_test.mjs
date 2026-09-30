import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapAndDeploy } from '../benchmark-sets/realworld-api-v4/shared/lib/observation-workflow.mjs';
import { bootstrapHosts } from '../benchmark-sets/realworld-api-v4/shared/lib/remote-bootstrap.mjs';
import { runCommand } from '../benchmark-sets/realworld-api-v4/shared/lib/command.mjs';

const hosts = { backendTarget: 'root@198.51.100.10', runnerTarget: 'root@198.51.100.11', script: '#!/bin/sh\nexit 0\n' };

test('SSH readiness retries probes only and bootstraps each host once', async () => {
  const calls = [];
  let failures = 2;
  await bootstrapHosts({ ...hosts, attempts: 3, sleep: async () => {}, command: async (name, args) => {
    calls.push(args.at(-1));
    if (args.at(-1) === 'true' && failures-- > 0) throw new Error('connection timeout');
  } });
  assert.deepEqual(calls, ['true', 'true', 'true', 'true', 'sh -s', 'sh -s']);
});

test('permanent SSH failure never executes bootstrap', async () => {
  const calls = [];
  await assert.rejects(bootstrapHosts({ ...hosts, attempts: 2, sleep: async () => {}, command: async (name, args) => {
    calls.push(args.at(-1));
    throw new Error('connection timeout');
  } }), /SSH.*ready.*connection timeout/);
  assert.deepEqual(calls, ['true', 'true']);
});

test('SSH readiness abort prevents subsequent probes and installation', async () => {
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(bootstrapHosts({ ...hosts, signal: controller.signal, sleep: async () => {}, command: async (name, args, options) => {
    assert.equal(options.signal, controller.signal);
    calls.push(args.at(-1));
    controller.abort(new Error('observation cancelled'));
    throw new Error('connection timeout');
  } }), /observation cancelled/);
  assert.deepEqual(calls, ['true']);
});

test('runCommand honors pre-aborted cancellation rather than executing', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal }), /abort/i);
});

test('real rsync deployment excludes the controller token and preserves external tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'linode-v4-sync-'));
  const source = join(root, 'source');
  const tools = join(root, 'tools');
  const backend = join(root, 'backend');
  const runner = join(root, 'runner');
  try {
    for (const directory of [source, tools, backend, runner]) await mkdir(directory);
    await writeFile(join(source, '.linode.env'), 'LINODE_TOKEN=synthetic-test-only\n');
    await writeFile(join(source, 'source.txt'), 'source');
    await writeFile(join(tools, 'node'), 'installed-tool');
    const signal = new AbortController().signal;
    await bootstrapAndDeploy({
      inventory: { resources: { backend: { publicIpv4: '198.51.100.10', privateIpv4: '10.203.0.10' }, runner: { publicIpv4: '198.51.100.11', privateIpv4: '10.203.0.11' } } },
      repositoryRoot: source, backendRoot: backend, runnerRoot: runner, runnerKeyFile: join(root, 'key'), script: '#!/bin/sh\n', signal,
      bootstrap: async options => assert.equal(options.signal, signal),
      healthProbe: async (target, command, receivedSignal) => { assert.equal(receivedSignal, signal); return {}; },
      command: async (name, args, options) => {
        assert.equal(options.signal, signal);
        if (name === 'rsync') return runCommand(name, [...args.slice(0, -1), args.at(-1).split(':')[1] + '/'], options);
        return { stdout: '' };
      },
    });
    for (const directory of [backend, runner]) {
      assert.equal(await readFile(join(directory, 'source.txt'), 'utf8'), 'source');
      await assert.rejects(readFile(join(directory, '.linode.env')), { code: 'ENOENT' });
    }
    assert.equal(await readFile(join(tools, 'node'), 'utf8'), 'installed-tool');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Real local children prove cancellation settles only after termination, not an abort callback.
for (const mode of ['delay', 'ignore']) {
  for (const trigger of ['abort', 'timeout']) {
    test(`runCommand ${trigger} waits for ${mode}-TERM child close`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'v4-child-'));
      const pidFile = join(root, 'pid');
      const stoppedFile = join(root, 'stopped');
      const controller = new AbortController();
      const script = `const fs = require('node:fs');
        process.on('SIGTERM', () => { ${mode === 'delay' ? "setTimeout(() => { fs.writeFileSync(process.argv[2], 'stopped'); process.exit(0); }, 250);" : ''} });
        fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);`;
      let work; let pid; let watchdog; let escalatedByTest = false;
      try {
        work = runCommand(process.execPath, ['-e', script, pidFile, stoppedFile], { signal: controller.signal, timeoutMs: trigger === 'timeout' ? 500 : 30_000 });
        // Attach a handler immediately, while waiting for the child's ready marker.
        const rejection = assert.rejects(work, trigger === 'timeout' ? /timed out/ : /abort/i);
        for (let attempt = 0; attempt < 100; attempt++) {
          try { pid = Number(await readFile(pidFile, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
        }
        assert.ok(pid, 'local child must be ready');
        watchdog = setTimeout(() => { escalatedByTest = true; process.kill(pid, 'SIGKILL'); }, 12_000);
        if (trigger === 'abort') controller.abort();
        await rejection;
        assert.equal(escalatedByTest, false, 'production must escalate without the test watchdog');
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'child must have closed before settlement');
        if (mode === 'delay') assert.equal(await readFile(stoppedFile, 'utf8'), 'stopped');
      } finally { clearTimeout(watchdog); controller.abort(); if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } await work?.catch(() => {}); await rm(root, { recursive: true, force: true }); }
    });
  }
}

test('runBench escalates ignored termination and settles after close', async () => {
  const { spawn } = await import('node:child_process');
  const { runBench } = await import('../benchmark-sets/realworld-api-v4/shared/lib/bench-execution.mjs');
  for (const trigger of ['abort', 'timeout']) {
    let child;
    let closed = false;
    const controller = new AbortController();
    const work = runBench({ repositoryRoot: '/repo', signal: controller.signal, timeoutMs: trigger === 'timeout' ? 500 : 30_000,
      spawnImpl: (command, args, options) => {
        child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"], { detached: options.detached });
        child.once('close', () => { closed = true; });
        child.stdout.once('data', () => { if (trigger === 'abort') controller.abort(); });
        return child;
      },
    });
    try {
      await assert.rejects(Promise.race([work, new Promise((_, reject) => setTimeout(() => { child.kill('SIGKILL'); reject(new Error('escalation missing')); }, 12_000).unref())]), trigger === 'timeout' ? /timed out/ : /aborted/);
      assert.equal(closed, true);
    } finally { child.kill('SIGKILL'); await work.catch(() => {}); }
  }
});


test('runCommand preserves stdin, environment, cwd, output caps and process failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v4-command-'));
  try {
    const result = await runCommand(process.execPath, ['-e', "process.stdin.on('data', data => process.stdout.write(process.env.MARKER + ':' + process.cwd() + ':' + data));"], { input: 'payload', env: { MARKER: 'test' }, cwd: root });
    assert.equal(result.stdout, `test:${await realpath(root)}:payload`);
    await assert.rejects(runCommand(process.execPath, ['-e', "process.stderr.write('failure detail'); process.exit(7)" ]), /\[7\].*failure detail/);
    await assert.rejects(runCommand('/missing-v4-command'), /ENOENT/);
    await assert.rejects(runCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))" ]), /maxBuffer/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runLongCommand shares close-before-settle cancellation and timeout', async () => {
  const { runLongCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-execution.mjs');
  const root = await mkdtemp(join(tmpdir(), 'v4-long-command-'));
  try {
    for (const trigger of ['abort', 'timeout']) {
      const pidFile = join(root, trigger);
      const controller = new AbortController();
      const script = "const fs = require('node:fs'); process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100)); fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);";
      const work = runLongCommand(process.execPath, ['-e', script, pidFile], { signal: controller.signal, timeoutMs: trigger === 'timeout' ? 500 : 5000 });
      const rejection = assert.rejects(work, trigger === 'abort' ? /aborted/ : /timed out/);
      let pid;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { pid = Number(await readFile(pidFile, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
      }
      assert.ok(pid);
      if (trigger === 'abort') controller.abort();
      await rejection;
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});


function processRunning(pid) {
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return state.status === 0 && !/^Z/.test(state.stdout.trim());
}

// The descendant's natural lifetime bounds the failing version; no watchdog kills it.
function pipeHoldingParent(pidFile, { exitParent = false, ignoreTerm = false, holdPipes = true, lifetimeMs = 1500 } = {}) {
  const descendant = `const fs = require('node:fs');
    process.on('SIGTERM', () => { ${ignoreTerm ? '' : 'setTimeout(() => process.exit(0), 50);'} });
    fs.writeFileSync(process.argv[1], String(process.pid));
    setTimeout(() => process.exit(0), ${lifetimeMs});`;
  return `const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}, ${JSON.stringify(pidFile)}], { stdio: ${JSON.stringify(holdPipes ? ['ignore', 'inherit', 'inherit'] : 'ignore')} });
    child.unref();
    ${exitParent ? 'process.exit(0);' : 'setInterval(() => {}, 1000);'}`;
}

async function descendantPid(path) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { return Number(await readFile(path, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  assert.fail('descendant did not become ready');
}

for (const trigger of ['abort', 'timeout']) {
  test(`process tree ${trigger} terminates a pipe-holding descendant after direct parent exit`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'v4-tree-'));
    const pidFile = join(root, 'descendant');
    const controller = new AbortController();
    let pid;
    const work = runCommand(process.execPath, ['-e', pipeHoldingParent(pidFile, { exitParent: true })], { signal: controller.signal, timeoutMs: trigger === 'timeout' ? 500 : 5000 });
    const outcome = work.catch(error => error);
    try {
      pid = await descendantPid(pidFile);
      const started = Date.now();
      if (trigger === 'abort') controller.abort();
      assert.match((await outcome).message, trigger === 'timeout' ? /timed out/ : /aborted/);
      assert.ok(Date.now() - started < 1000, 'descendant must be terminated, not left until its natural expiry');
      assert.equal(processRunning(pid), false, 'descendant must be dead before settlement');
    } finally { controller.abort(); if (pid && processRunning(pid)) process.kill(pid, 'SIGKILL'); await outcome; await rm(root, { recursive: true, force: true }); }
  });
}

test('benchmark process group escalates an ignored TERM after direct parent exit and waits for close', async () => {
  const { runBench } = await import('../benchmark-sets/realworld-api-v4/shared/lib/bench-execution.mjs');
  const root = await mkdtemp(join(tmpdir(), 'v4-bench-tree-'));
  const pidFile = join(root, 'descendant');
  let child; let closed = false; let exited = false; let pid;
  const work = runBench({ repositoryRoot: root, timeoutMs: 500, spawnImpl: (command, args, options) => {
    child = spawn(process.execPath, ['-e', pipeHoldingParent(pidFile, { exitParent: true, ignoreTerm: true, lifetimeMs: 11_500 })], { ...options, cwd: root });
    child.once('exit', () => { exited = true; });
    child.once('close', () => { closed = true; });
    return child;
  } });
  const outcome = work.catch(error => error);
  try {
    pid = await descendantPid(pidFile);
    const started = Date.now();
    assert.match((await outcome).message, /timed out/);
    assert.equal(exited, true);
    assert.equal(closed, true, 'settlement must follow close');
    assert.ok(Date.now() - started < 11_000, 'group KILL must precede descendant natural expiry');
    assert.equal(processRunning(pid), false);
  } finally { if (pid && processRunning(pid)) process.kill(pid, 'SIGKILL'); await outcome; await rm(root, { recursive: true, force: true }); }
});

test('long-command cancellation kills descendants even when they do not hold pipes', async () => {
  const { runLongCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-execution.mjs');
  const root = await mkdtemp(join(tmpdir(), 'v4-long-tree-'));
  const pidFile = join(root, 'descendant');
  const controller = new AbortController();
  let pid;
  const work = runLongCommand(process.execPath, ['-e', pipeHoldingParent(pidFile, { ignoreTerm: true, holdPipes: false })], { signal: controller.signal });
  const outcome = work.catch(error => error);
  try {
    pid = await descendantPid(pidFile);
    controller.abort();
    assert.match((await outcome).message, /aborted/);
    assert.equal(processRunning(pid), false, 'close must not cancel escalation and leave a survivor');
  } finally { controller.abort(); if (pid && processRunning(pid)) process.kill(pid, 'SIGKILL'); await outcome; await rm(root, { recursive: true, force: true }); }
});


test('managed process groups are isolated and cancellation leaves unrelated processes alive', async () => {
  const { spawnManaged, waitForChild } = await import('../benchmark-sets/realworld-api-v4/shared/lib/command.mjs');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const unrelatedClose = new Promise(resolve => unrelated.once('close', resolve));
  const controller = new AbortController();
  const child = spawnManaged(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  child.once('close', () => { closed = true; });
  const work = waitForChild(child, { signal: controller.signal, timeoutMs: 5000 });
  const outcome = work.catch(error => error);
  try {
    await new Promise(resolve => child.stdout.once('data', resolve));
    const groupId = pid => Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
    assert.equal(groupId(child.pid), child.pid);
    assert.notEqual(groupId(child.pid), groupId(process.pid));
    assert.equal(groupId(unrelated.pid), groupId(process.pid));
    assert.throws(() => waitForChild(unrelated, { timeoutMs: 1 }), /unowned process group/);
    controller.abort();
    assert.match((await outcome).message, /aborted/);
    assert.equal(closed, true);
    assert.equal(processRunning(unrelated.pid), true, 'unrelated controller-group process must not be signalled');
  } finally { controller.abort(); await outcome; unrelated.kill('SIGKILL'); await unrelatedClose; }
});


const commandModule = new URL('../benchmark-sets/realworld-api-v4/shared/lib/command.mjs', import.meta.url).href;

for (const trigger of ['timeout', 'abort']) {
  test(`nested current runCommand ${trigger} keeps explicit-env child in the root cancellation scope`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'v4-nested-'));
    const pidFile = join(root, 'inner');
    const outerPidFile = join(root, 'outer');
    const envFile = join(root, 'env');
    const controller = new AbortController();
    const inner = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(envFile)}, JSON.stringify({ scope: process.env.BAAS_BENCH_V4_COMMAND_SCOPE, override: process.env.OVERRIDE })); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => process.exit(0), 3000);`;
    const script = `import { runCommand } from ${JSON.stringify(commandModule)};
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(outerPidFile)}, String(process.pid));
      await runCommand(process.execPath, ['-e', ${JSON.stringify(inner)}], { env: { OVERRIDE: 'retained', BAAS_BENCH_V4_COMMAND_SCOPE: '0' }, timeoutMs: 5000 });`;
    let pid;
    const work = runCommand(process.execPath, ['--input-type=module', '-e', script], { signal: controller.signal, timeoutMs: trigger === 'timeout' ? 1000 : 5000 });
    const outcome = work.catch(error => error);
    try {
      pid = await descendantPid(pidFile);
      assert.deepEqual(JSON.parse(await readFile(envFile, 'utf8')), { scope: '1', override: 'retained' });
      const group = Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
      assert.equal(group, Number(await readFile(outerPidFile, 'utf8')), 'nested child must inherit the owning root group');
      if (trigger === 'abort') controller.abort();
      assert.match((await outcome).message, trigger === 'timeout' ? /timed out/ : /aborted/);
      assert.equal(processRunning(pid), false, 'inner current helper must terminate before outer settles');
      const outerPid = Number(await readFile(outerPidFile, 'utf8'));
      assert.notEqual(pid, outerPid);
    } finally { controller.abort(); if (pid && processRunning(pid)) process.kill(pid, 'SIGKILL'); await outcome; await rm(root, { recursive: true, force: true }); }
  });
}

test('actual bench hook/case/admin/Supabase command chain remains in the root scope', async () => {
  const { runBench } = await import('../benchmark-sets/realworld-api-v4/shared/lib/bench-execution.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'v4-admin-scope-')));
  const pidFile = join(root, 'docker-pid');
  const source = new URL('../', import.meta.url);
  const set = join(root, 'benchmark-sets', 'realworld-api-v4');
  const caseDir = join(set, 'benchmarks/project-management-capacity/cases/supabase/javascript-sdk');
  const runtime = join(root, '.runtime/benchmarks/realworld-api-v4');
  let pid; let child;
  try {
    await mkdir(caseDir, { recursive: true });
    await mkdir(join(set, 'shared'), { recursive: true });
    await mkdir(runtime, { recursive: true });
    await mkdir(join(root, 'bin'));
    await mkdir(join(root, 'logs'));
    await cp(new URL('benchmark-sets/realworld-api-v4/shared/case.sh', source), join(set, 'shared/case.sh'));
    await cp(new URL('benchmark-sets/realworld-api-v4/benchmarks/project-management-capacity/cases/supabase/javascript-sdk/teardown.sh', source), join(caseDir, 'teardown.sh'));
    await cp(new URL('benchmark-sets/realworld-api-v4/shared/lib', source), join(runtime, 'lib'), { recursive: true });
    await writeFile(join(root, 'bin/baas'), '#!/bin/sh\nexec docker "$@"\n', { mode: 0o755 });
    await writeFile(join(root, 'bin/docker'), `#!${process.execPath}
const fs = require('node:fs');
      if (!process.argv.includes('psql')) process.exit(9);
      fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      process.stdin.resume(); setTimeout(() => process.exit(0), 4000);
`, { mode: 0o755 });
    await writeFile(join(root, 'bin/ssh'), '#!/bin/sh\nexit 9\n', { mode: 0o755 });
    // Execute the current CLI hook function, not a copied implementation. This fixture
    // does not execute CLI definition validation/orchestration or create an evidence bundle.
    const bench = await readFile(new URL('bin/bench', source), 'utf8');
    const hooks = [...bench.matchAll(/^hook\(\) \{\n[\s\S]*?^\}/gm)];
    assert.equal(hooks.length, 1, 'bin/bench hook extraction must remain unambiguous');
    const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const script = `${hooks[0][0]}
CASE_DIR=${shellQuote(caseDir)}
TMP_RUN=${shellQuote(root)}
hook teardown teardown 0 "$TMP_RUN"
`;
    const work = runBench({ repositoryRoot: root, timeoutMs: 2000, environment: { PATH: `${join(root, 'bin')}:${process.env.PATH}`, BAAS_BENCH_V4_COMMAND_SCOPE: '1' },
      spawnImpl: (command, args, options) => { child = spawn('/bin/sh', ['-c', script], options); return child; },
    });
    const outcome = work.catch(error => error);
    try { pid = await descendantPid(pidFile); } catch (error) { throw new Error(`${error.message}: ${(await outcome).message}: ${await readFile(join(root, 'logs/hooks.log'), 'utf8')}`); }
    assert.match((await outcome).message, /timed out/);
    assert.equal(processRunning(pid), false, 'nested mock Docker must terminate before benchmark settles');
  } finally { if (pid && processRunning(pid)) process.kill(pid, 'SIGKILL'); if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGKILL'); await rm(root, { recursive: true, force: true }); }
});


test('runBench establishes a root deadline even when invoked from an inherited scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v4-bench-root-'));
  const pidFile = join(root, 'worker');
  const benchModule = new URL('../benchmark-sets/realworld-api-v4/shared/lib/bench-execution.mjs', import.meta.url).href;
  const worker = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => process.exit(0), 3000);`;
  const script = `import { runBench } from ${JSON.stringify(benchModule)};
    import { spawn } from 'node:child_process';
    await runBench({ repositoryRoot: ${JSON.stringify(root)}, timeoutMs: 500,
      spawnImpl: (command, args, options) => spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], options),
    }).catch(error => { if (!error.message.includes('timed out')) throw error; });
    console.log('caller alive');`;
  let pid;
  const work = runCommand(process.execPath, ['--input-type=module', '-e', script], { timeoutMs: 2000 });
  const outcome = work.catch(error => error);
  try {
    pid = await descendantPid(pidFile);
    const group = Number(spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim());
    assert.equal(group, pid, 'benchmark entry point must own an isolated root');
    assert.equal((await outcome).stdout.trim(), 'caller alive');
    assert.equal(processRunning(pid), false);
  } finally { if (pid && processRunning(pid)) process.kill(pid, 'SIGKILL'); await outcome; await rm(root, { recursive: true, force: true }); }
});
