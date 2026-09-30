import { runCommand } from './command.mjs';
import { createSshConfig, bindBackend } from './ssh-config.mjs';
import { createEphemeralSshKey, startSshAgent } from './ephemeral-ssh.mjs';
import { readBootstrapScript } from './remote-bootstrap.mjs';
import { bootstrapAndDeploy } from './observation-workflow.mjs';
import { resolveHardwareProfile, runObservation } from './linode-controller.mjs';
import { preflightPilot, runBench, verifyPilotBundle } from './bench-execution.mjs';
import { createProgress, emitProgress } from './progress.mjs';

export async function runPilot(options) {
  const { api, config, repositoryRoot, bootstrapScriptPath, inventoryPath, campaignPath, controllerCidr, maxHours, transferReserveUsd, liveApproval, deleteConfirmation } = options;
  if (!api?.request || !config?.runId || typeof repositoryRoot !== 'string' || typeof bootstrapScriptPath !== 'string' || typeof controllerCidr !== 'string') throw new Error('invalid V4 pilot configuration');
  const selectProfile = options.selectProfile ?? resolveHardwareProfile;
  const createKey = options.createKey ?? createEphemeralSshKey;
  const startAgent = options.startAgent ?? startSshAgent;
  const deploy = options.deploy ?? bootstrapAndDeploy;
  const observe = options.observe ?? runObservation;
  const onProgress = options.onProgress ?? emitProgress;
  const executeBench = options.executeBench ?? (args => runBench({ repositoryRoot, onProgress, ...args }));
  const verifyBench = options.verifyBench ?? verifyPilotBundle;
  if (typeof executeBench !== 'function' || typeof verifyBench !== 'function') throw new Error('V4 pilot requires benchmark execution and verification');
  const progress = createProgress('controller', { emit: onProgress });
  let key;
  let agent;
  let sshState;
  let primary;
  progress.phase('preflight');
  try {
    await (options.preflight ?? preflightPilot)({ repositoryRoot });
    const profile = await selectProfile(api);
    if (typeof api.list !== 'function') throw new Error('Linode account SSH key listing is unavailable');
    const accountKeys = (await api.list('/v4/profile/sshkeys')).filter(item => item?.label === 'mba-m1');
    if (accountKeys.length !== 1 || typeof accountKeys[0].ssh_key !== 'string') throw new Error('Linode account SSH key "mba-m1" is missing or ambiguous');
    const transferReserve = Number(profile.type.transfer) > 0 ? 0 : transferReserveUsd;
    key = await createKey();
    sshState = await (options.createSshConfig ?? createSshConfig)();
    agent = await startAgent({ privateKey: key.privateKey });
    const environment = { ...agent.env, BAAS_BENCH_V4_SSH_CONFIG: sshState.configPath };
    const command = (name, args, commandOptions = {}) => runCommand(name, args, { ...commandOptions, env: environment, rootScope: true });
    const outcome = await observe({
      ...options,
      api,
      config: { ...config, region: profile.region, type: profile.type.id, controllerCidr, sshPublicKey: key.publicKey, additionalSshPublicKeys: [accountKeys[0].ssh_key] },
      inventoryPath, campaignPath, hourlyUsd: profile.hourlyUsd, maxHours, transferReserveUsd: transferReserve, liveApproval, deleteConfirmation,
      onStatus: status => progress.phase(status === 'running' ? 'benchmark' : status === 'starting' ? 'preflight' : status),
      bootstrap: async ({ inventory, signal }) => {
        await bindBackend(sshState.configPath, inventory.resources.backend);
        const script = await readBootstrapScript(bootstrapScriptPath);
        const deployment = await deploy({ inventory, repositoryRoot, backendRoot: '/opt/baas-bench', runnerRoot: '/opt/baas-bench', runnerKeyFile: key.privateKey, script, signal, command, onPhase: phase => progress.phase(phase) });
        inventory.benchmark_environment = deployment.environment ?? deployment;
        if (deployment.hostProvenance) inventory.host_provenance = deployment.hostProvenance;
        inventory.hardware_profile = { region: profile.region, type: Object.fromEntries(['id', 'class', 'memory', 'vcpus', 'disk', 'transfer'].filter(key => profile.type[key] !== undefined).map(key => [key, profile.type[key]])), hourly_usd: profile.hourlyUsd };
      },
      run: async ({ inventory, signal }) => executeBench({ environment: { ...environment, ...inventory.benchmark_environment, BAAS_BENCH_V4_SSH_CONFIG: sshState.configPath }, signal }),
      verify: async (...args) => { progress.phase('verify-evidence'); return verifyBench(...args); },
    });
    return { ...outcome, profile };
  } catch (error) { primary = error; throw error; }
  finally {
    for (const [keyName, cleanup] of [['agentCleanupError', () => agent?.stop()], ['keyCleanupError', () => key?.cleanup()], ['sshConfigCleanupError', () => sshState?.cleanup()]]) {
      try { await cleanup(); }
      catch (error) {
        if (!primary) primary = error;
        else { try { primary[keyName] = String(error?.message ?? error).slice(0, 300); } catch { /* preserve primary */ } }
      }
    }
    progress.phase(primary ? 'failed' : 'complete');
    progress.stop();
    if (primary) throw primary;
  }
}
