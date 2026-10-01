#!/usr/bin/env node
import { readPrivateJson, readLinodeToken, LinodeApi, recoverObservation, LIVE_APPROVAL_PHRASE } from '../benchmark-sets/realworld-api-v4/shared/lib/linode-controller.mjs';
import { runPilot } from '../benchmark-sets/realworld-api-v4/shared/lib/pilot-workflow.mjs';
import { PILOT_PLATFORMS } from '../benchmark-sets/realworld-api-v4/shared/lib/bench-execution.mjs';
import { resolve, dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createProgressStore, progressStatus } from '../benchmark-sets/realworld-api-v4/shared/lib/progress.mjs';
import { fileURLToPath } from 'node:url';

const usage = `Usage:
  node bin/bench-v4-linode.mjs inspect INVENTORY.json
  node bin/bench-v4-linode.mjs status INVENTORY.json
  LINODE_TOKEN=… node bin/bench-v4-linode.mjs recover INVENTORY.json --campaign LEDGER.json --confirm-delete RUN_ID [--force-stale-lock]
  LINODE_TOKEN=… LIVE_APPROVAL_PHRASE=${LIVE_APPROVAL_PHRASE} node bin/bench-v4-linode.mjs pilot INVENTORY.json [--platform supabase|trailbase] --run-id RUN_ID --campaign LEDGER.json --controller-cidr IPV4/32 --confirm-delete RUN_ID

Recovery and pilot delete only resources recorded in the private inventory after checking IDs and ownership labels. Set LINODE_TOKEN in the environment or store it in a mode-0600 .linode.env file. Pilot provisions one pair and may incur charges.`;

function resourceView(resources = {}) {
  return Object.fromEntries(Object.entries(resources).filter(([, value]) => value).map(([kind, value]) => [kind, { id: value.id, label: value.label, deleted: value.deleted ?? false }]));
}

async function main(argv) {
  const [command, inventoryArg, ...rest] = argv;
  if (command === '--help' || command === '-h' || !command) { console.log(usage); return; }
  if (!['inspect', 'status', 'recover', 'pilot'].includes(command) || !inventoryArg) throw new Error(usage);
  const inventoryPath = resolve(inventoryArg);
  if (command === 'status') {
    if (rest.length) throw new Error(usage);
    const progress = await readPrivateJson(join(dirname(inventoryPath), 'progress.json'));
    console.log(JSON.stringify(progressStatus(progress), null, 2));
    return;
  }
  if (command === 'inspect') {
    if (rest.length) throw new Error(usage);
    const inventory = await readPrivateJson(inventoryPath);
    console.log(JSON.stringify({ run_id: inventory.run_id, status: inventory.status, region: inventory.region, type: inventory.type, resources: resourceView(inventory.resources), pending: inventory.pending ?? null }, null, 2));
    return;
  }

  const options = {};
  const allowedFlags = command === 'pilot' ? ['--campaign', '--confirm-delete', '--run-id', '--controller-cidr', '--platform'] : ['--campaign', '--confirm-delete'];
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--force-stale-lock' && command === 'recover') { options.force = true; continue; }
    if (!allowedFlags.includes(flag) || !rest[index + 1] || options[flag]) throw new Error(usage);
    options[flag] = rest[++index];
  }
  if (!options['--campaign'] || !options['--confirm-delete']) throw new Error(usage);
  const platform = options['--platform'] ?? 'supabase';
  if (command === 'pilot' && !PILOT_PLATFORMS.includes(platform)) throw new Error(`unsupported V4 pilot platform: ${platform}`);
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  let token = process.env.LINODE_TOKEN;
  if (!token) {
    try { token = await readLinodeToken(resolve(root, '.linode.env')); }
    catch (error) { if (error.code === 'ENOENT') throw new Error('LINODE_TOKEN is required; set it in the environment or create a private .linode.env file'); throw error; }
  }
  const api = new LinodeApi({ token });
  if (command === 'recover') {
    const inventory = await readPrivateJson(inventoryPath);
    if (inventory.run_id !== options['--confirm-delete']) throw new Error('--confirm-delete must exactly match the inventory run_id');
    const result = await recoverObservation({ api, inventoryPath, campaignPath: resolve(options['--campaign']), force: options.force, deleteConfirmation: options['--confirm-delete'] });
    console.log(JSON.stringify({ run_id: result.run_id, status: result.status, budget_settlement: result.budget_settlement ?? null, resources: resourceView(result.resources) }, null, 2));
    return;
  }
  if (!options['--run-id'] || !options['--controller-cidr'] || process.env.LIVE_APPROVAL_PHRASE !== LIVE_APPROVAL_PHRASE) throw new Error('pilot requires run ID, controller CIDR, and the exact LIVE_APPROVAL_PHRASE');
  if (options['--confirm-delete'] !== options['--run-id']) throw new Error('--confirm-delete must exactly match --run-id');
  await mkdir(dirname(inventoryPath), { recursive: true, mode: 0o700 });
  const progress = createProgressStore(join(dirname(inventoryPath), 'progress.json'), options['--run-id']);
  const result = await runPilot({
    platform,
    onProgress: event => progress.receive(event),
    api, repositoryRoot: root, bootstrapScriptPath: resolve(root, 'services/linode/bootstrap.sh'), inventoryPath, campaignPath: resolve(options['--campaign']), controllerCidr: options['--controller-cidr'], maxHours: 8, transferReserveUsd: 2,
    config: { runId: options['--run-id'], image: 'linode/ubuntu24.04', subnetCidr: '10.203.0.0/24' }, liveApproval: process.env.LIVE_APPROVAL_PHRASE, deleteConfirmation: options['--confirm-delete'],
  });
  console.log(JSON.stringify({ run_id: result.inventory.run_id, status: result.inventory.status, estimate_usd: result.estimateUsd, actual_usd: result.actualUsd, resources: resourceView(result.inventory.resources) }, null, 2));
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
