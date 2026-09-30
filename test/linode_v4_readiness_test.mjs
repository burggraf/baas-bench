import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupabaseAdmin } from '../benchmark-sets/realworld-api-v4/shared/lib/admin/supabase.mjs';
import { createSshConfig } from '../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs';
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

test('Supabase admin preserves an SSH timeout through real bin/baas and cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v4-admin-ssh-'));
  const fakeBin = join(root, 'bin');
  const runtime = join(root, 'runtime');
  const sshState = await createSshConfig();
  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
  try {
    await mkdir(fakeBin);
    const log = join(root, 'ssh.log');
    await writeFile(join(fakeBin, 'ssh'), `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$SSH_LOG"
count=$(cat "$SSH_COUNT" 2>/dev/null || echo 0)
count=$((count + 1))
printf '%s' "$count" > "$SSH_COUNT"
if [ "$count" -eq 1 ]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -E ]; then
      node -e 'if ((require("node:fs").statSync(process.argv[1]).mode & 511) !== 384) process.exit(9)' "$2"
      printf '%s\\n' 'debug1: Connection established.' 'debug1: SSH2_MSG_KEXINIT sent' 'debug1: private debug material synthetic-secret' 'ssh_dispatch_run_fatal: Connection to 192.0.2.8 port 22: Operation timed out' > "$2"
      break
    fi
    shift
  done
  exit 255
fi
exit 0
`, { mode: 0o755 });
    const environment = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SSH_LOG: log,
      SSH_COUNT: join(root, 'ssh.count'),
      BAAS_VERSION_PROFILE: 'realworld-api-v4',
      BAAS_RUNTIME_DIR: runtime,
      BAAS_BENCH_V4_BACKEND_TARGET: 'root@192.0.2.8',
      BAAS_BENCH_V4_BACKEND_ROOT: '/opt/baas-bench',
      BAAS_BENCH_V4_BACKEND_PRIVATE_IP: '10.203.0.10',
      BAAS_BENCH_V4_SSH_CONFIG: sshState.configPath,
    };
    const run = (command, args, options) => runCommand(command, args, { ...options, env: environment });
    let caught;
    try { await createSupabaseAdmin({ root: repositoryRoot, runtime, run }).setup(); }
    catch (error) { caught = error; }
    assert.match(caught?.message ?? '', /bin\/baas command failed \[255\]/);
    assert.equal(caught.cleanupError, undefined, 'the second, successful cleanup must not replace the original SSH failure');
    assert.match(caught.message, /V4 backend SSH last_milestone=key-exchange authenticated_seen=no command_sent_seen=no reason=timeout exit=255 target=root@192\.0\.2\.8 started_at=.*finished_at=.*elapsed_seconds=\d+/);
    assert.doesNotMatch(caught.message, /synthetic-secret/);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(sshState.directory)).sort(), ['known_hosts', 'ssh_config']);
    const calls = (await readFile(log, 'utf8')).trim().split('\n');
    assert.equal(calls.length, 2, 'the failing setup attempt and compensating cleanup both traverse the real CLI');
    assert.ok(calls.every(call => call.includes(`-F ${sshState.configPath}`)));
    assert.ok(calls.every(call => call.includes('-o ConnectTimeout=15 root@192.0.2.8')));
  } finally {
    await sshState.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});

test('V4 backend SSH diagnostics preserve exits and expose only allowlisted milestones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v4-ssh-milestones-'));
  const state = await createSshConfig();
  const cli = fileURLToPath(new URL('../bin/baas', import.meta.url));
  try {
    await writeFile(join(root, 'ssh'), `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = -E ]; then printf '%s\\n' "$SSH_TRACE_TEXT" > "$2"; break; fi
  shift
done
printf 'remote-output'
exit "$SSH_EXIT"
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, BAAS_VERSION_PROFILE: 'realworld-api-v4', BAAS_BENCH_V4_BACKEND_TARGET: 'root@192.0.2.8', BAAS_BENCH_V4_BACKEND_ROOT: '/opt/baas-bench', BAAS_BENCH_V4_SSH_CONFIG: state.configPath };
    for (const [trace, milestone, authenticated, commandSent, reason, status] of [
      ['ssh: connect to host 192.0.2.8 port 22: Operation timed out', 'unknown', 'no', 'no', 'timeout', 255],
      ['debug1: SSH2_MSG_KEXINIT sent\nHost key verification failed.', 'key-exchange', 'no', 'no', 'host-key', 255],
      ['debug1: SSH2_MSG_NEWKEYS received\ndebug1: Next authentication method: publickey\nroot@192.0.2.8: Permission denied (publickey).', 'authentication', 'no', 'no', 'authentication', 255],
      ['Authenticated to 192.0.2.8\ndebug1: Sending command: synthetic-secret', 'command-sent', 'yes', 'yes', 'unknown', 42],
      ['Authenticated to 192.0.2.8\ndebug1: SSH2_MSG_KEXINIT sent\nssh_dispatch_run_fatal: Connection to 192.0.2.8 port 22: Operation timed out', 'key-exchange', 'yes', 'no', 'timeout', 255],
    ]) {
      await assert.rejects(runCommand(cli, ['stop', 'supabase'], { env: { ...env, SSH_TRACE_TEXT: trace, SSH_EXIT: String(status) } }), error => {
        assert.ok(error.message.includes(`[${status}]`));
        assert.ok(error.message.includes(`last_milestone=${milestone} authenticated_seen=${authenticated} command_sent_seen=${commandSent} reason=${reason} exit=${status}`));
        assert.match(error.message, /started_at=.*finished_at=.*elapsed_seconds=\d+/);
        assert.doesNotMatch(error.message, /synthetic-secret/);
        return true;
      });
    }
    const success = await runCommand(cli, ['stop', 'supabase'], { env: { ...env, SSH_TRACE_TEXT: 'debug1: Sending command: synthetic-secret', SSH_EXIT: '0' } });
    assert.equal(success.stdout, 'remote-output');
    assert.equal(success.stderr, '');
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(state.directory)).sort(), ['known_hosts', 'ssh_config']);
  } finally { await state.cleanup(); await rm(root, { recursive: true, force: true }); }
});

test('Supabase setup streams COPY once, counts only server-confirmed batches, and never replays', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v4-seed-failure-'));
  const failure = new Error('SSH transport timeout');
  const calls = [];
  const run = async (_command, args, options) => {
    calls.push({ args, input: options.input });
    if (calls.length === 3) {
      assert.equal(typeof options.input?.[Symbol.asyncIterator], 'function');
      const input = options.input[Symbol.asyncIterator]();
      const first = await input.next();
      const second = await input.next();
      assert.ok(first.value.startsWith('COPY public.users'));
      assert.ok(second.value.startsWith('COPY public.users'));
      assert.ok(first.value.includes('__BAAS_BENCH_V4_COPY_OK__1__users__1000'));
      const marker = '__BAAS_BENCH_V4_COPY_OK__1__users__1000\n';
      assert.equal(typeof options.onStdout, 'function');
      options.onStdout(Buffer.from(marker.slice(0, 17)));
      options.onStdout(Buffer.from(marker.slice(17)));
      // Confirmed progress must survive even without a final aggregated stdout result.
      failure.stdout = '';
      await input.return();
      throw failure;
    }
    if (calls.length === 4) throw new Error('cleanup failed');
    return { stdout: '', stderr: '' };
  };
  try {
    const admin = createSupabaseAdmin({ root, runtime: join(root, 'runtime'), run });
    await assert.rejects(admin.setup(), error => {
      assert.match(error.message, /Supabase setup phase=copy:users copied_batches=1 copied_rows=1000 produced_batches=2 produced_rows=2000 input_bytes=\d+ elapsed_ms=\d+: SSH transport timeout/);
      assert.equal(error.cause, failure);
      assert.equal(error.cleanupError, 'cleanup failed');
      return true;
    });
    assert.equal(calls.length, 4, 'one COPY stream plus one compensating cleanup, never SQL replay');
    assert.ok(!calls[2].args.includes('-c'), 'all COPY statements share one psql process');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Supabase fixture loading streams ordered bounded COPY batches through one psql session', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const runtime = await mkdtemp(join(tmpdir(), 'v4-seed-stream-'));
  const { DATASET_COUNTS } = await import('../benchmark-sets/realworld-api-v4/shared/lib/dataset.mjs');
  const calls = [];
  let batches = 0;
  let rows = 0;
  let copySessions = 0;
  const run = async (_command, args, options) => {
    calls.push(args);
    if (typeof options.input?.[Symbol.asyncIterator] === 'function') {
      copySessions++;
      const markers = [];
      for await (const chunk of options.input) {
        assert.ok(chunk.startsWith('COPY public.'));
        assert.ok(chunk.includes(' FROM STDIN;\n'));
        assert.ok(chunk.includes('\\.\n\\echo '));
        const marker = chunk.match(/\\echo ([^\n]+)\n$/)?.[1];
        assert.ok(marker);
        rows += Number(marker.split('__').at(-1));
        batches++;
        options.onStdout(Buffer.from(`${marker}\n`));
        markers.push(marker);
      }
      return { stdout: `${markers.join('\n')}\n`, stderr: '' };
    }
    if (args.includes('-At')) return { stdout: Object.entries(DATASET_COUNTS).map(([table, count]) => `${table}|${count}`).join('\n'), stderr: '' };
    return { stdout: '', stderr: '' };
  };
  try {
    await createSupabaseAdmin({ root, runtime, run }).setup();
    assert.equal(copySessions, 1);
    assert.equal(batches, 1002);
    assert.equal(rows, Object.values(DATASET_COUNTS).reduce((sum, count) => sum + count, 0));
    assert.equal(calls.filter(args => args.includes('-c')).length, 0);
  } finally { await rm(runtime, { recursive: true, force: true }); }
});

test('backend failure snapshots are bounded, read-only and avoid SQL, environment and container secrets', async () => {
  const { captureHostFailure } = await import('../benchmark-sets/realworld-api-v4/shared/lib/host-telemetry.mjs');
  let calls = 0;
  const command = async (name, args, options) => {
    calls++;
    assert.equal(name, 'ssh');
    assert.equal(args.at(-2), 'root@198.51.100.10');
    assert.equal(options.timeoutMs, 10_000);
    const script = args.at(-1);
    for (const section of ['/proc/loadavg', '/proc/meminfo', 'sshd -T', 'journalctl -u ssh', 'journalctl -k', 'docker ps']) assert.ok(script.includes(section));
    assert.doesNotMatch(script, /printenv|docker inspect|docker logs|psql|SELECT|LINODE_TOKEN/);
    return { stdout: 'synthetic host snapshot' };
  };
  assert.equal(await captureHostFailure('root@198.51.100.10', command), 'synthetic host snapshot');
  assert.equal(calls, 1, 'diagnostics must not retry SSH or database commands');
  await assert.rejects(captureHostFailure('-bad-target', command), /invalid.*target/);
  assert.equal(calls, 1);
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


test('runCommand preserves string stdin, streams async input with backpressure, and keeps process safeguards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v4-command-'));
  try {
    const result = await runCommand(process.execPath, ['-e', "process.stdin.on('data', data => process.stdout.write(process.env.MARKER + ':' + process.cwd() + ':' + data));"], { input: 'payload', env: { MARKER: 'test' }, cwd: root });
    assert.equal(result.stdout, `test:${await realpath(root)}:payload`);
    await assert.rejects(runCommand(process.execPath, ['-e', "process.stderr.write('failure detail'); process.exit(7)" ]), /\[7\].*failure detail/);
    await assert.rejects(runCommand('/missing-v4-command'), /ENOENT/);
    await assert.rejects(runCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))" ]), /maxBuffer/);
    const chunk = Buffer.alloc(64 * 1024, 'x');
    const input = (async function* () { for (let index = 0; index < 100; index++) yield chunk; }());
    const streamed = await runCommand(process.execPath, ['-e', "let bytes = 0; for await (const chunk of process.stdin) bytes += chunk.length; process.stdout.write(String(bytes));"], { input });
    assert.equal(streamed.stdout, String(chunk.length * 100));
    const earlyInput = (async function* () { yield Buffer.alloc(8 * 1024 * 1024); }());
    await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(0)'], { input: earlyInput }), /input stream closed before completion/);
    const producerError = new Error('input producer failed');
    const brokenInput = (async function* () { yield chunk; throw producerError; }());
    await assert.rejects(runCommand(process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], { input: brokenInput }), /input producer failed/);
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


test('V4 SSH state is private and isolated from earlier/global hosts; runner pins use the bound backend', async () => {
  const { createSshConfig, validateSshConfig, bindBackend, prepareRunnerSsh, sshTransportArgs } = await import('../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs');
  const first = await createSshConfig();
  const second = await createSshConfig();
  try {
    const { stat, chmod, symlink } = await import('node:fs/promises');
    assert.notEqual(first.configPath, second.configPath);
    for (const state of [first, second]) {
      assert.equal((await stat(state.directory)).mode & 0o777, 0o700);
      assert.equal((await stat(state.configPath)).mode & 0o777, 0o600);
      assert.equal((await stat(state.knownHostsPath)).mode & 0o777, 0o600);
      const config = spawnSync('ssh', ['-G', '-F', state.configPath, '172.233.137.153'], { encoding: 'utf8' });
      assert.equal(config.status, 0, config.stderr);
      assert.match(config.stdout, /stricthostkeychecking accept-new/);
      assert.match(config.stdout, /^hostkeyalgorithms ssh-ed25519$/m);
      assert.ok(config.stdout.includes(`userknownhostsfile ${state.knownHostsPath}`));
      assert.match(config.stdout, /globalknownhostsfile \/dev\/null/);
      assert.equal(config.stdout.includes('.ssh/known_hosts'), false);
    }
    await writeFile(first.knownHostsPath, '172.233.137.153 ssh-ed25519 AAAATESTFIRST\n');
    assert.equal(await readFile(second.knownHostsPath, 'utf8'), '');
    await bindBackend(first.configPath, { publicIpv4: '172.233.137.153', privateIpv4: '10.203.0.10' });
    const pinned = await prepareRunnerSsh({ configPath: first.configPath, backendTarget: 'root@172.233.137.153', backendPrivateIp: '10.203.0.10', runnerRoot: '/opt/baas-bench' });
    assert.equal(await readFile(pinned.knownHostsPath, 'utf8'), '10.203.0.10 ssh-ed25519 AAAATESTFIRST\n');
    const runner = await readFile(pinned.configPath, 'utf8');
    assert.match(runner, /StrictHostKeyChecking yes/);
    assert.match(runner, /UserKnownHostsFile.*realworld-api-v4\/known_hosts/);
    assert.match(runner, /IdentityFile.*realworld-api-v4\/id_ed25519/);
    for (const change of [{ backendTarget: 'root@172.233.137.154' }, { backendPrivateIp: '10.203.0.11' }]) {
      await assert.rejects(prepareRunnerSsh({ configPath: first.configPath, backendTarget: 'root@172.233.137.153', backendPrivateIp: '10.203.0.10', runnerRoot: '/opt/baas-bench', ...change }), /backend.*match/i);
    }
    assert.deepEqual(await sshTransportArgs('ssh', ['host', 'true'], { BAAS_BENCH_V4_SSH_CONFIG: first.configPath }), ['-F', first.configPath, 'host', 'true']);
    assert.deepEqual(await sshTransportArgs('rsync', ['-a', '--', '/source/', 'host:/dest/'], { BAAS_BENCH_V4_SSH_CONFIG: first.configPath }), ['-e', `ssh -F ${first.configPath}`, '-a', '--', '/source/', 'host:/dest/']);
    await assert.rejects(sshTransportArgs('ssh', ['host'], {}), /SSH config/);
    await assert.rejects(validateSshConfig('/tmp/.ssh/ssh_config'), /generated private SSH config/);
    await assert.rejects(sshTransportArgs('ssh', ['host'], { BAAS_BENCH_V4_SSH_CONFIG: '/tmp/path;bad/ssh_config' }), /SSH config/);
    const original = await readFile(first.configPath, 'utf8');
    await writeFile(first.configPath, original + 'Include ~/.ssh/config\n');
    await assert.rejects(validateSshConfig(first.configPath), /policy/);
    await rm(first.configPath);
    await symlink(second.configPath, first.configPath);
    await assert.rejects(validateSshConfig(first.configPath), /private regular/);
    await rm(first.configPath);
    await writeFile(first.configPath, original, { mode: 0o600 });
    await chmod(first.configPath, 0o644);
    await assert.rejects(validateSshConfig(first.configPath), /private|0600/);
  } finally { await first.cleanup(); await second.cleanup(); }
});

test('recognizable changed SSH host keys are hard failures, not readiness retries', async () => {
  for (const message of ['REMOTE HOST IDENTIFICATION HAS CHANGED!', 'Host key verification failed', 'no matching host key type found']) {
    let probes = 0;
    await assert.rejects(bootstrapHosts({ ...hosts, attempts: 24, sleep: async () => assert.fail('must not retry host-key failure'), command: async () => { probes++; throw new Error(message); } }), error => error.message === message);
    assert.equal(probes, 1);
  }
});


test('native SSH accepts a recycled address in a fresh observation but rejects a changed key within it', async () => {
  const { createSshConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs');
  const { createServer, createConnection } = await import('node:net');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'v4-local-sshd-')));
  const first = await createSshConfig();
  const second = await createSshConfig();
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  let server; let serverClose;
  const stop = async () => { if (server) { server.kill('SIGTERM'); await serverClose; server = undefined; } };
  const start = async key => {
    await stop();
    const configPath = join(root, 'sshd_config');
    await writeFile(configPath, `Port ${port}
ListenAddress 127.0.0.1
HostKey ${key}
PidFile ${root}/sshd.pid
AuthorizedKeysFile none
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
`, { mode: 0o600 });
    server = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', configPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    serverClose = new Promise(resolve => server.once('close', resolve));
    let diagnostics = '';
    server.stderr.on('data', data => { diagnostics += data; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) assert.fail(`local sshd failed: ${diagnostics}`);
      const ready = await new Promise(resolve => {
        const socket = createConnection({ host: '127.0.0.1', port });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
      });
      if (ready) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('local sshd did not become ready');
  };
  const connect = state => runCommand('ssh', ['-p', String(port), '-o', 'HostKeyAlias=172.233.137.153', '-o', 'IdentityAgent=none', '-o', 'IdentityFile=none', '-o', 'PreferredAuthentications=none', '127.0.0.1', 'true'], { env: { ...process.env, BAAS_BENCH_V4_SSH_CONFIG: state.configPath } });
  try {
    for (const name of ['a', 'b']) await runCommand('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(root, name)]);
    await start(join(root, 'a'));
    await assert.rejects(connect(first), /Permission denied/);
    const firstKey = await readFile(first.knownHostsPath, 'utf8');
    assert.ok(firstKey.includes('172.233.137.153'));
    await start(join(root, 'b'));
    await assert.rejects(connect(first), /REMOTE HOST IDENTIFICATION HAS CHANGED/);
    await assert.rejects(connect(second), /Permission denied/);
    assert.notEqual(await readFile(second.knownHostsPath, 'utf8'), firstKey);
    assert.equal(await readFile(first.knownHostsPath, 'utf8'), firstKey);
    await start(join(root, 'a'));
    await assert.rejects(connect(second), /REMOTE HOST IDENTIFICATION HAS CHANGED/);
  } finally { await stop(); await first.cleanup(); await second.cleanup(); await rm(root, { recursive: true, force: true }); }
});


test('all managed V4 SSH and rsync transports use explicit private config', async () => {
  const { createSshConfig } = await import('../benchmark-sets/realworld-api-v4/shared/lib/ssh-config.mjs');
  const { runLongCommand } = await import('../benchmark-sets/realworld-api-v4/shared/lib/remote-execution.mjs');
  const state = await createSshConfig();
  const bin = join(state.directory, 'bin');
  const log = join(state.directory, 'args');
  try {
    await mkdir(bin);
    for (const name of ['ssh', 'rsync']) await writeFile(join(bin, name), '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$SSH_TEST_LOG"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SSH_TEST_LOG: log, BAAS_BENCH_V4_SSH_CONFIG: state.configPath };
    await runCommand('ssh', ['root@host', 'true'], { env });
    assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), ['-F', state.configPath, 'root@host', 'true']);
    await runLongCommand('ssh', ['root@host', 'true'], { env });
    assert.equal((await readFile(log, 'utf8')).split('\n')[1], state.configPath);
    await runCommand('rsync', ['-a', '--', '/source/', 'root@host:/dest/'], { env });
    assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n'), ['-e', `ssh -F ${state.configPath}`, '-a', '--', '/source/', 'root@host:/dest/']);
  } finally { await state.cleanup(); }
});
