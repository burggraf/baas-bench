#!/usr/bin/env node
import { readPrivateJson, LinodeApi, recoverObservation } from '../benchmark-sets/realworld-api-v4/shared/lib/linode-controller.mjs';
import { resolve } from 'node:path';

const usage = `Usage:
  node bin/bench-v4-linode.mjs inspect INVENTORY.json
  LINODE_TOKEN=… node bin/bench-v4-linode.mjs recover INVENTORY.json --campaign LEDGER.json --confirm-delete RUN_ID [--force-stale-lock]

Recovery deletes only resources recorded in the private inventory after checking IDs and ownership labels.`;

function resourceView(resources = {}) {
  return Object.fromEntries(Object.entries(resources).filter(([, value]) => value).map(([kind, value]) => [kind, { id: value.id, label: value.label, deleted: value.deleted ?? false }]));
}

async function main(argv) {
  const [command, inventoryArg, ...rest] = argv;
  if (command === '--help' || command === '-h' || !command) { console.log(usage); return; }
  if (!['inspect', 'recover'].includes(command) || !inventoryArg) throw new Error(usage);
  const inventoryPath = resolve(inventoryArg);
  if (command === 'inspect') {
    if (rest.length) throw new Error(usage);
    const inventory = await readPrivateJson(inventoryPath);
    console.log(JSON.stringify({ run_id: inventory.run_id, status: inventory.status, region: inventory.region, type: inventory.type, resources: resourceView(inventory.resources), pending: inventory.pending ?? null }, null, 2));
    return;
  }

  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === '--force-stale-lock') { options.force = true; continue; }
    if (!['--campaign', '--confirm-delete'].includes(flag) || !rest[index + 1] || options[flag]) throw new Error(usage);
    options[flag] = rest[++index];
  }
  if (!options['--campaign'] || !options['--confirm-delete']) throw new Error(usage);
  const inventory = await readPrivateJson(inventoryPath);
  if (inventory.run_id !== options['--confirm-delete']) throw new Error('--confirm-delete must exactly match the inventory run_id');
  if (!process.env.LINODE_TOKEN) throw new Error('LINODE_TOKEN must be provided in the controller environment');
  const result = await recoverObservation({
    api: new LinodeApi({ token: process.env.LINODE_TOKEN }),
    inventoryPath,
    campaignPath: resolve(options['--campaign']),
    force: options.force,
    deleteConfirmation: options['--confirm-delete'],
  });
  console.log(JSON.stringify({ run_id: result.run_id, status: result.status, budget_settlement: result.budget_settlement ?? null, resources: resourceView(result.resources) }, null, 2));
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
