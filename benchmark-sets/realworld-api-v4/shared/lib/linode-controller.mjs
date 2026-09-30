import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isIP } from 'node:net';
import { hostname } from 'node:os';

const API_BASE = 'https://api.linode.com';
export const LIVE_APPROVAL_PHRASE = 'I_APPROVE_V4_LINODE_ACTIONS_UP_TO_USD_30';
const REGIONS = ['us-west', 'us-lax', 'us-sea'];
const validSshPublicKey = value => typeof value === 'string' && /^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: [^\r\n\0]+)?$/.test(value);
const RESOURCES = {
  vpc: { path: '/v4/vpcs', endpoint: id => `/v4/vpcs/${id}` },
  publicFirewall: { path: '/v4/networking/firewalls', endpoint: id => `/v4/networking/firewalls/${id}` },
  vpcFirewall: { path: '/v4/networking/firewalls', endpoint: id => `/v4/networking/firewalls/${id}` },
  backend: { path: '/v4/linode/instances', endpoint: id => `/v4/linode/instances/${id}` },
  runner: { path: '/v4/linode/instances', endpoint: id => `/v4/linode/instances/${id}` },
};

function apiErrorDetails(text, token) {
  let errors;
  try { errors = JSON.parse(text).errors; } catch { return ''; }
  if (!Array.isArray(errors)) return '';
  return errors.slice(0, 5).map(error => {
    const clean = value => typeof value === 'string' ? value.replace(/[\r\n\t\0-\x1f\x7f]/g, ' ').split(token).join('[REDACTED]').slice(0, 180) : '';
    const field = clean(error?.field);
    const reason = clean(error?.reason);
    return reason ? `${field ? `${field}: ` : ''}${reason}` : '';
  }).filter(Boolean).join('; ').slice(0, 700);
}

export class LinodeApiError extends Error {
  constructor(method, path, status, details = '') {
    super(`Linode API ${method} ${path} failed (${status})${details ? `: ${details}` : ''}`);
    this.name = 'LinodeApiError';
    this.method = method;
    this.path = path;
    this.status = status;
  }
}

export class LinodeApi {
  constructor({ token, fetchImpl = fetch, baseUrl = API_BASE, timeoutMs = 30_000 } = {}) {
    if (typeof token !== 'string' || token.length < 10 || /[\r\n\0]/.test(token)) throw new Error('LINODE_TOKEN is required');
    if (typeof fetchImpl !== 'function' || typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) throw new Error('invalid Linode API client');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error('invalid Linode API timeout');
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(method, path, body, signal) {
    if (!['GET', 'POST', 'DELETE'].includes(method) || typeof path !== 'string' || !path.startsWith('/v4/') || path.includes('..') || /[\r\n\0]/.test(path)) throw new Error('invalid Linode API request');
    const headers = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const options = { method, headers, signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, options);
    if (!response.ok) {
      let text = '';
      try { text = (await response.text()).slice(0, 8_192); } catch { /* keep the API status */ }
      throw new LinodeApiError(method, path, response.status, apiErrorDetails(text, this.token));
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async list(path, signal) {
    const items = [];
    for (let page = 1; ; page++) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await this.request('GET', `${path}${separator}page=${page}&page_size=100`, undefined, signal);
      if (!response || !Array.isArray(response.data) || !Number.isSafeInteger(response.pages) || response.pages < page) throw new Error('invalid Linode paginated response');
      items.push(...response.data);
      if (page >= response.pages) return items;
    }
  }
}

function regionHourly(type, regionId) {
  const price = type.region_prices?.find(item => item.id === regionId)?.hourly ?? type.price?.hourly;
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export function selectHardwareProfile(regions, types, availability, options = {}) {
  const preferred = options.regions ?? REGIONS;
  const available = new Set(availability.filter(item => item.available !== false).map(item => `${item.region}/${item.plan}`));
  const candidates = [];
  for (let preference = 0; preference < preferred.length; preference++) {
    const regionId = preferred[preference];
    const region = regions.find(item => item.id === regionId && item.status === 'ok' && item.capabilities?.includes('Linode Interfaces') && item.capabilities?.includes('VPCs'));
    if (!region) continue;
    for (const type of types) {
      if (type.class !== 'dedicated' || type.memory !== 8192 || !available.has(`${regionId}/${type.id}`)) continue;
      const hourlyUsd = regionHourly(type, regionId);
      if (hourlyUsd !== null) candidates.push({ region: regionId, regionLabel: region.label, type, hourlyUsd, preference });
    }
  }
  if (!candidates.length) throw new Error('no available dedicated 8192 MiB Linode type in preferred VPC regions');
  const preferredCandidates = candidates.filter(candidate => candidate.preference < REGIONS.length);
  const eligible = preferredCandidates.length ? preferredCandidates : candidates;
  eligible.sort((a, b) => a.hourlyUsd - b.hourlyUsd || a.preference - b.preference || a.type.id.localeCompare(b.type.id));
  const { preference, ...selected } = eligible[0];
  return selected;
}

export async function resolveHardwareProfile(api) {
  if (!api?.list || !api?.request) throw new Error('invalid Linode profile API');
  const [regions, types] = await Promise.all([api.list('/v4/regions'), api.list('/v4/linode/types')]);
  const preferred = [...REGIONS, ...regions.filter(item => item?.country?.toLowerCase() === 'us' && !REGIONS.includes(item.id)).map(item => item.id).sort()];
  const vpcRegions = preferred.filter(id => regions.some(item => item.id === id && item.status === 'ok' && item.capabilities?.includes('Linode Interfaces') && item.capabilities?.includes('VPCs')));
  const availabilityByRegion = await Promise.all(vpcRegions.map(region => api.request('GET', `/v4/regions/${region}/availability`)));
  const availability = availabilityByRegion.flat();
  if (!availability.every(item => item && typeof item.region === 'string' && typeof item.plan === 'string' && typeof item.available === 'boolean')) throw new Error('invalid Linode regional availability response');
  return selectHardwareProfile(regions, types, availability, { regions: preferred });
}

export function estimatePairCost(hourlyUsd, maxHours, transferReserveUsd) {
  if (![hourlyUsd, maxHours, transferReserveUsd].every(Number.isFinite) || hourlyUsd <= 0 || maxHours <= 0 || transferReserveUsd < 0) throw new Error('invalid pair cost estimate');
  return Math.round((2 * hourlyUsd * maxHours + transferReserveUsd) * 100) / 100;
}

function validateLedger(ledger) {
  if (!ledger || ledger.schema_version !== 1 || !Number.isFinite(ledger.capUsd) || ledger.capUsd !== 30 || !Number.isFinite(ledger.spentUsd) || ledger.spentUsd < 0 || !ledger.reservations || typeof ledger.reservations !== 'object' || Array.isArray(ledger.reservations)) throw new Error('invalid V4 campaign ledger');
  for (const [runId, amount] of Object.entries(ledger.reservations)) if (!/^[a-z0-9][a-z0-9-]{5,40}$/.test(runId) || !Number.isFinite(amount) || amount <= 0) throw new Error('invalid V4 campaign reservation ledger');
}

export function reserveCampaignSpend(ledger, runId, amountUsd) {
  validateLedger(ledger);
  const amount = Math.round(amountUsd * 100) / 100;
  if (typeof runId !== 'string' || !/^[a-z0-9][a-z0-9-]{5,40}$/.test(runId) || !Number.isFinite(amountUsd) || amount <= 0 || Object.hasOwn(ledger.reservations, runId)) throw new Error('invalid campaign reservation');
  const reserved = Object.values(ledger.reservations).reduce((sum, value) => sum + value, 0);
  if (ledger.spentUsd + reserved + amount > ledger.capUsd) throw new Error('campaign budget would be exceeded');
  ledger.reservations[runId] = amount;
  return ledger;
}

export function settleCampaignSpend(ledger, runId, actualUsd) {
  validateLedger(ledger);
  if (!Object.hasOwn(ledger.reservations, runId) || !Number.isFinite(actualUsd) || actualUsd < 0) throw new Error('invalid campaign settlement');
  ledger.spentUsd = Math.round((ledger.spentUsd + actualUsd) * 100) / 100;
  delete ledger.reservations[runId];
  ledger.overBudget = ledger.spentUsd + Object.values(ledger.reservations).reduce((sum, value) => sum + value, 0) > ledger.capUsd;
  return ledger;
}

export async function writePrivateJson(path, value) {
  if (!isAbsolute(path)) throw new Error('inventory path must be absolute');
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await stat(directory)).mode & 0o077) throw new Error('inventory directory permissions must be 0700');
  const temporary = join(directory, `.${path.split('/').at(-1)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readPrivateJson(path) {
  if (!isAbsolute(path)) throw new Error('inventory path must be absolute');
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('private inventory permissions must be 0600');
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function readLinodeToken(path) {
  if (!isAbsolute(path)) throw new Error('LINODE_TOKEN file path must be absolute');
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('LINODE_TOKEN file must be a private regular file');
  const match = /^LINODE_TOKEN=([^\r\n]+)\r?\n?$/.exec(await readFile(path, 'utf8'));
  if (!match || /\s/.test(match[1])) throw new Error('invalid LINODE_TOKEN file');
  return match[1];
}

function validCidr(value, hostOnly = false) {
  if (typeof value !== 'string') return false;
  const [address, prefix, extra] = value.split('/');
  if (extra !== undefined || isIP(address) !== 4 || !/^(0|[1-9][0-9]?)$/.test(prefix ?? '') || Number(prefix) > 32 || (hostOnly && prefix !== '32')) return false;
  const octets = address.split('.').map(Number);
  const first = octets[0];
  if (hostOnly) return first !== 0 && first !== 127 && first !== 169 && first < 224;
  const prefixLength = Number(prefix);
  if (prefixLength < 1 || prefixLength > 28) return false;
  const addressNumber = octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
  const hostBits = BigInt(32 - prefixLength);
  const hostMask = (1n << hostBits) - 1n;
  const network = addressNumber & (((1n << 32n) - 1n) ^ hostMask);
  const end = network | hostMask;
  const privateRanges = [[0x0a000000n, 0x0affffffn], [0xac100000n, 0xac1fffffn], [0xc0a80000n, 0xc0a8ffffn]];
  const excludedStart = 0xc0a88000n;
  const excludedEnd = 0xc0a8ffffn;
  return network === addressNumber && privateRanges.some(([start, finish]) => network >= start && end <= finish) && (end < excludedStart || network > excludedEnd);
}

function privateV4Pair(cidr) {
  const octets = cidr.split('/')[0].split('.').map(Number);
  const network = octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n);
  const format = value => [24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 255n)).join('.');
  return { backend: format(network + 10n), runner: format(network + 11n) };
}

function validateProvisionConfig(config) {
  if (!config || typeof config !== 'object' || !/^[a-z0-9][a-z0-9-]{5,40}$/.test(config.runId ?? '') || !/^[a-z0-9][a-z0-9.-]*$/.test(config.region ?? '') || !/^[a-z0-9][a-z0-9.-]*$/.test(config.type ?? '') || !/^linode\/[a-z0-9.-]+$/.test(config.image ?? '')) throw new Error('invalid V4 provision profile');
  const additionalKeys = config.additionalSshPublicKeys ?? [];
  if (!validCidr(config.controllerCidr, true) || !validCidr(config.subnetCidr) || !validSshPublicKey(config.sshPublicKey) || !Array.isArray(additionalKeys) || !additionalKeys.every(validSshPublicKey)) throw new Error('invalid V4 network or SSH configuration');
}

function errorText(error) { return String(error?.message ?? error).slice(0, 300); }
function attachError(primary, key, error) { try { primary[key] = errorText(error); } catch { /* preserve the original failure */ } }

async function persist(inventory, options) {
  if (options.save) await options.save(inventory);
  else if (options.inventoryPath) await writePrivateJson(options.inventoryPath, inventory);
}

function resourceLabels(runId) {
  const short = kind => createHash('sha256').update(`${runId}:${kind}`).digest('hex').slice(0, 24);
  return {
    vpc: `bv4-${runId}-vpc`,
    publicFirewall: `b4-pub-${short('publicFirewall')}`,
    vpcFirewall: `b4-vpc-${short('vpcFirewall')}`,
    backend: `bv4-${runId}-backend`,
    runner: `bv4-${runId}-runner`,
  };
}

function resourcePayloads(config, runTag) {
  const labels = resourceLabels(config.runId);
  const privateIps = privateV4Pair(config.subnetCidr);
  const vpc = {
    label: labels.vpc,
    description: `V4 observation ${config.runId}`,
    region: config.region,
    subnets: [{ label: `bv4-${config.runId}-private`, ipv4: config.subnetCidr }],
  };
  const firewall = (kind, addresses, ports, label) => ({
    label: labels[kind],
    rules: {
      inbound_policy: 'DROP', outbound_policy: 'ACCEPT',
      inbound: [{ action: 'ACCEPT', protocol: 'TCP', ports, addresses: { ipv4: [addresses] }, label }],
      outbound: [],
    },
  });
  const instance = (role, subnetId, publicFirewallId, vpcFirewallId) => ({
    label: labels[role],
    region: config.region,
    type: config.type,
    image: config.image,
    booted: true,
    network_helper: true,
    interface_generation: 'linode',
    authorized_keys: [...new Set([config.sshPublicKey, ...(config.additionalSshPublicKeys ?? [])])],
    tags: ['baas-bench-v4', runTag],
    interfaces: [
      { public: { ipv4: { addresses: [{ address: 'auto', primary: true }] } }, default_route: { ipv4: true }, firewall_id: publicFirewallId },
      { vpc: { subnet_id: subnetId, ipv4: { addresses: [{ address: privateIps[role], primary: true }] } }, default_route: { ipv4: false }, firewall_id: vpcFirewallId },
    ],
  });
  return { labels, vpc, firewall, instance, privateIps };
}

export async function provisionPair(options) {
  const { api, config } = options;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const readyTimeoutMs = options.readyTimeoutMs ?? 300_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  if (!api?.request || typeof sleep !== 'function' || !Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs < 1_000 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 100) throw new Error('invalid Linode readiness configuration');
  validateProvisionConfig(config);
  if (api instanceof LinodeApi && (options.liveApproval !== LIVE_APPROVAL_PHRASE || options.deleteConfirmation !== config.runId)) throw new Error('explicit live approval and run-ID deletion confirmation are required');
  const runTag = `run-${config.runId}`;
  const { labels, vpc: vpcBody, firewall, instance, privateIps } = resourcePayloads(config, runTag);
  const inventory = {
    schema_version: 1,
    run_id: config.runId,
    run_tag: runTag,
    status: 'provisioning',
    created_at: new Date().toISOString(),
    region: config.region,
    type: config.type,
    image: config.image,
    labels,
    private_ips: privateIps,
    resources: { vpc: null, publicFirewall: null, vpcFirewall: null, backend: null, runner: null },
    pending: null,
  };
  await persist(inventory, options);

  const create = async (kind, body) => {
    const endpoint = RESOURCES[kind].path;
    inventory.pending = { kind, endpoint, label: labels[kind] };
    await persist(inventory, options);
    let response;
    try { response = await api.request('POST', endpoint, body, options.signal); }
    catch (error) {
      if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 499) {
        inventory.pending = null;
        await persist(inventory, options).catch(saveError => attachError(error, 'inventoryError', saveError));
      }
      throw error;
    }
    const id = Number(response?.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Linode did not return an ID for ${kind}`);
    const resource = { id, label: labels[kind] };
    if (kind === 'vpc') {
      const subnet = response.subnets?.find(item => item.label === vpcBody.subnets[0].label);
      if (!subnet?.id) throw new Error('Linode VPC response omitted the requested subnet');
      resource.subnetId = subnet.id;
    }
    inventory.resources[kind] = resource;
    inventory.pending = null;
    await persist(inventory, options);
    return resource;
  };

  try {
    const vpc = await create('vpc', vpcBody);
    const publicFirewall = await create('publicFirewall', firewall('publicFirewall', config.controllerCidr, '22', 'controller-ssh'));
    const vpcFirewall = await create('vpcFirewall', firewall('vpcFirewall', `${privateIps.runner}/32`, '1-65535', 'private-runner-to-backend'));
    const backend = await create('backend', instance('backend', vpc.subnetId, publicFirewall.id, vpcFirewall.id));
    const runner = await create('runner', instance('runner', vpc.subnetId, publicFirewall.id, vpcFirewall.id));
    inventory.status = 'waiting_for_hosts';
    await persist(inventory, options);
    await waitForInstance({ api, inventory, kind: 'backend', sleep, readyTimeoutMs, pollIntervalMs, options });
    await waitForInstance({ api, inventory, kind: 'runner', sleep, readyTimeoutMs, pollIntervalMs, options });
    inventory.status = 'ready';
    inventory.ready_at = new Date().toISOString();
    await persist(inventory, options);
    return inventory;
  } catch (error) {
    inventory.status = 'needs_recovery';
    inventory.failure = errorText(error);
    await persist(inventory, options).catch(saveError => attachError(error, 'inventoryError', saveError));
    try { await cleanupPair({ ...options, inventory }); }
    catch (cleanupError) { attachError(error, 'cleanupError', cleanupError); }
    throw error;
  }
}

function endpointFor(kind, resource) { return RESOURCES[kind].endpoint(resource.id); }
function listMatches(kind, item, inventory, pending) {
  if (item?.label !== pending.label) return false;
  if (kind === 'backend' || kind === 'runner') return Array.isArray(item.tags) && item.tags.includes(inventory.run_tag);
  if (kind === 'vpc') return item.description === `V4 observation ${inventory.run_id}`;
  return true;
}

async function reconcilePending({ api, inventory, options }) {
  const pending = inventory.pending;
  if (!pending) return;
  if (typeof api.list !== 'function') throw new Error(`ambiguous ${pending.kind} creation requires API listing recovery`);
  const matches = (await api.list(pending.endpoint)).filter(item => listMatches(pending.kind, item, inventory, pending));
  if (matches.length !== 1) throw new Error(`ambiguous ${pending.kind} creation: found ${matches.length} exact-label matches`);
  const item = matches[0];
  const resource = { id: item.id, label: item.label };
  if (pending.kind === 'vpc') {
    const subnet = item.subnets?.find(value => value.label === `bv4-${inventory.run_id}-private`);
    if (!subnet?.id) throw new Error('recovered VPC is missing its expected subnet');
    resource.subnetId = subnet.id;
  }
  inventory.resources[pending.kind] = resource;
  inventory.pending = null;
  await persist(inventory, options);
}

function ownsResource(kind, actual, expected, inventory) {
  if (!actual || actual.id !== expected.id || actual.label !== expected.label) return false;
  if (kind === 'backend' || kind === 'runner') return Array.isArray(actual.tags) && actual.tags.includes(inventory.run_tag);
  if (kind === 'vpc') return actual.description === `V4 observation ${inventory.run_id}`;
  return true;
}

function publicIpv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

async function verifyInstanceNetwork(api, path, inventory, kind, signal) {
  const envelope = await api.request('GET', `${path}/interfaces`, undefined, signal);
  if (!envelope || !Array.isArray(envelope.interfaces) || Object.keys(envelope).some(key => key !== 'interfaces')) throw new Error(`invalid interfaces envelope for ${kind}`);
  const interfaces = envelope.interfaces;
  if (interfaces.length !== 2 || interfaces.some(iface => !Number.isSafeInteger(iface?.id) || iface.id < 1) || new Set(interfaces.map(iface => iface.id)).size !== 2) throw new Error(`invalid network interface IDs for ${kind}`);
  const publicInterface = interfaces.filter(iface => iface.public && !iface.vpc && !iface.vlan);
  const vpcInterface = interfaces.filter(iface => iface.vpc && !iface.public && !iface.vlan);
  if (publicInterface.length !== 1 || vpcInterface.length !== 1) throw new Error(`expected unique public and VPC interfaces for ${kind}`);
  const primaryAddress = network => {
    const addresses = network?.ipv4?.addresses;
    if (!Array.isArray(addresses)) throw new Error(`missing interface addresses for ${kind}`);
    const primary = addresses.filter(item => item?.primary === true);
    if (primary.length !== 1 || isIP(primary[0].address) !== 4) throw new Error(`invalid primary interface address for ${kind}`);
    return primary[0].address;
  };
  const publicAddress = primaryAddress(publicInterface[0].public);
  const privateAddress = primaryAddress(vpcInterface[0].vpc);
  const vpc = inventory.resources.vpc;
  if (!publicIpv4(publicAddress) || publicInterface[0].default_route?.ipv4 !== true) throw new Error(`invalid public interface address or route for ${kind}`);
  if (vpcInterface[0].vpc.subnet_id !== vpc.subnetId || vpcInterface[0].vpc.vpc_id !== vpc.id || privateAddress !== inventory.private_ips[kind] || vpcInterface[0].default_route?.ipv4 !== false) throw new Error(`invalid VPC interface network for ${kind}`);
  for (const [iface, firewallKind] of [[publicInterface[0], 'publicFirewall'], [vpcInterface[0], 'vpcFirewall']]) {
    const attached = await api.list(`${path}/interfaces/${iface.id}/firewalls`, signal);
    const expected = inventory.resources[firewallKind];
    if (!Array.isArray(attached) || attached.length !== 1 || !ownsResource(firewallKind, attached[0], expected, inventory) || attached[0].status !== 'enabled') throw new Error(`invalid ${firewallKind} interface firewall attachment for ${kind}`);
  }
  return { publicIpv4: publicAddress, privateIpv4: privateAddress };
}

async function waitForInstance({ api, inventory, kind, sleep, readyTimeoutMs, pollIntervalMs, options }) {
  const resource = inventory.resources[kind];
  const path = endpointFor(kind, resource);
  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    const actual = await api.request('GET', path, undefined, options.signal);
    if (!ownsResource(kind, actual, resource, inventory)) throw new Error(`ownership check failed while waiting for ${kind} ${resource.id}`);
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Linode provisioning cancelled');
    if (actual.status === 'running') {
      const addresses = await verifyInstanceNetwork(api, path, inventory, kind, options.signal);
      resource.status = 'running';
      Object.assign(resource, addresses);
      await persist(inventory, options);
      return;
    }
    if (['deleting', 'offline'].includes(actual.status)) throw new Error(`Linode ${kind} entered unexpected state ${actual.status}`);
    if (Date.now() >= deadline) throw new Error(`Linode ${kind} did not become ready within ${readyTimeoutMs} ms`);
    await sleep(pollIntervalMs);
  }
}

async function deleteOne({ api, inventory, kind, resource, sleep, maxWaitMs, options }) {
  const path = endpointFor(kind, resource);
  let actual;
  try { actual = await api.request('GET', path); }
  catch (error) {
    if (error?.status === 404) { resource.deleted = true; await persist(inventory, options); return; }
    throw error;
  }
  if (!ownsResource(kind, actual, resource, inventory)) throw new Error(`ownership check failed for ${kind} ${resource.id}`);
  if (actual.status !== 'deleting') {
    try { await api.request('DELETE', path); }
    catch (error) { if (error?.status !== 404) throw error; }
  }
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    try { await api.request('GET', path); }
    catch (error) {
      if (error?.status === 404) { resource.deleted = true; await persist(inventory, options); return; }
      throw error;
    }
    if (Date.now() >= deadline) throw new Error(`Linode deletion not confirmed for ${kind} ${resource.id}`);
    await sleep(1_000);
  }
}

function validateInventory(inventory) {
  if (!inventory || inventory.schema_version !== 1 || !/^[a-z0-9][a-z0-9-]{5,40}$/.test(inventory.run_id ?? '') || inventory.run_tag !== `run-${inventory.run_id}` || !inventory.resources || typeof inventory.resources !== 'object' || Array.isArray(inventory.resources)) throw new Error('invalid V4 inventory for cleanup');
  for (const kind of Object.keys(RESOURCES)) {
    const resource = inventory.resources[kind];
    if (resource && (!Number.isSafeInteger(resource.id) || resource.id < 1 || resource.label !== resourceLabels(inventory.run_id)[kind])) throw new Error(`invalid ownership record for ${kind}`);
  }
  if (inventory.pending) {
    const pendingKind = inventory.pending.kind;
    if (!RESOURCES[pendingKind] || inventory.pending.endpoint !== RESOURCES[pendingKind].path || inventory.pending.label !== resourceLabels(inventory.run_id)[pendingKind]) throw new Error('invalid pending ownership record');
  }
}

export async function cleanupPair({ api, inventory, save, inventoryPath, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxWaitMs = 300_000, deleteConfirmation }) {
  if (!api?.request || typeof sleep !== 'function' || !Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1_000 || maxWaitMs > 1_800_000) throw new Error('invalid V4 cleanup configuration');
  validateInventory(inventory);
  if (api instanceof LinodeApi && deleteConfirmation !== inventory.run_id) throw new Error('exact run-ID deletion confirmation is required');
  const options = { save, inventoryPath };
  const errors = [];
  if (inventory.pending) {
    try { await reconcilePending({ api, inventory, options }); }
    catch (error) { errors.push(error); }
  }
  inventory.status = 'deleting';
  await persist(inventory, options).catch(error => errors.push(error));
  for (const kind of ['runner', 'backend', 'vpcFirewall', 'publicFirewall', 'vpc']) {
    const resource = inventory.resources[kind];
    if (!resource || resource.deleted) continue;
    try { await deleteOne({ api, inventory, kind, resource, sleep, maxWaitMs, options }); }
    catch (error) { errors.push(error); }
  }
  inventory.status = errors.length || inventory.pending ? 'needs_recovery' : 'deleted';
  inventory.cleanup_errors = errors.map(errorText);
  await persist(inventory, options).catch(error => errors.push(error));
  if (errors.length) throw new AggregateError(errors, `Linode cleanup incomplete: ${errors.map(errorText).join('; ')}`);
  return inventory;
}

export async function runObservation(options) {
  const { api, config, inventoryPath, campaignPath, hourlyUsd, maxHours, transferReserveUsd, run, verify, bootstrap, notify, now = Date.now } = options;
  if (!api?.request || typeof run !== 'function' || typeof verify !== 'function' || (bootstrap !== undefined && typeof bootstrap !== 'function') || !isAbsolute(inventoryPath ?? '') || !isAbsolute(campaignPath ?? '') || resolve(inventoryPath) === resolve(campaignPath) || !Number.isFinite(maxHours) || maxHours <= 0 || maxHours > 24) throw new Error('invalid V4 observation configuration');
  validateProvisionConfig(config);
  if (api instanceof LinodeApi && (options.liveApproval !== LIVE_APPROVAL_PHRASE || options.deleteConfirmation !== config.runId)) throw new Error('explicit live approval and run-ID deletion confirmation are required');
  // ponytail: reserve one hour for provisioning and teardown; overruns retain the lock and budget reservation until recovery.
  const estimateUsd = estimatePairCost(hourlyUsd, maxHours + 1, transferReserveUsd);
  const campaignDirectory = dirname(campaignPath);
  await mkdir(campaignDirectory, { recursive: true, mode: 0o700 });
  if ((await stat(campaignDirectory)).mode & 0o077) throw new Error('campaign directory permissions must be 0700');
  const lockPath = `${campaignPath}.lock`;
  try { await mkdir(lockPath, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('another V4 observation holds the campaign lock'); throw error; }
  try { await writePrivateJson(join(lockPath, 'owner.json'), { schema_version: 1, run_id: config.runId, pid: process.pid, host: hostname(), started_at: new Date().toISOString() }); }
  catch (error) { await rm(lockPath, { recursive: true, force: true }).catch(() => {}); throw error; }

  let ledger;
  let inventory;
  let result;
  let bootstrapWork;
  let runWork;
  let primary;
  let cleanupError;
  const startedAt = now();
  const save = async value => { inventory = value; await writePrivateJson(inventoryPath, value); };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('V4 observation exceeded its maximum duration')), maxHours * 3_600_000);
  const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
  try {
    try { await stat(inventoryPath); throw new Error('V4 inventory path already exists'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    inventory = { schema_version: 1, run_id: config.runId, run_tag: `run-${config.runId}`, status: 'starting', resources: { vpc: null, publicFirewall: null, vpcFirewall: null, backend: null, runner: null }, pending: null };
    await save(inventory);
    try { ledger = await readPrivateJson(campaignPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; ledger = { schema_version: 1, capUsd: 30, spentUsd: 0, reservations: {} }; }
    reserveCampaignSpend(ledger, config.runId, estimateUsd);
    await writePrivateJson(campaignPath, ledger);
    inventory = await provisionPair({ ...options, save, signal: controller.signal });
    if (bootstrap) {
      inventory.status = 'bootstrapping';
      await save(inventory);
      bootstrapWork = Promise.resolve().then(() => bootstrap({ inventory, signal: controller.signal }));
      await Promise.race([bootstrapWork, aborted]);
    }
    inventory.status = 'running';
    await save(inventory);
    runWork = Promise.resolve().then(() => run({ inventory, signal: controller.signal }));
    result = await Promise.race([runWork, aborted]);
    if (controller.signal.aborted) throw controller.signal.reason;
    await verify(result, inventory);
  } catch (error) {
    primary = error;
    for (const [key, work] of [['bootstrapError', bootstrapWork], ['runError', runWork]]) {
      if (work) await work.catch(secondary => { if (secondary !== primary) attachError(primary, key, secondary); });
    }
  }
  clearTimeout(timeout);

  if (inventory && inventory.status !== 'deleted') {
    try { await cleanupPair({ ...options, inventory, save }); }
    catch (error) { cleanupError = error; if (!primary) primary = error; else attachError(primary, 'cleanupError', error); }
  }

  const cleanupComplete = !inventory || inventory.status === 'deleted';
  try {
    if (cleanupComplete && ledger?.reservations && Object.hasOwn(ledger.reservations, config.runId)) {
      const elapsedHours = Math.max(0, (now() - startedAt) / 3_600_000);
      const actualUsd = Math.round((2 * hourlyUsd * elapsedHours + transferReserveUsd) * 100) / 100;
      settleCampaignSpend(ledger, config.runId, actualUsd);
      await writePrivateJson(campaignPath, ledger);
      if (inventory) inventory.actual_usd = actualUsd;
      if (inventory) await save(inventory);
    }
  } catch (error) { if (!primary) primary = error; else attachError(primary, 'budgetError', error); }

  if (typeof notify === 'function') {
    try { await notify({ runId: config.runId, status: primary ? 'failed' : 'success', cleanup: cleanupComplete ? 'complete' : 'failed', inventory, error: primary?.message }); }
    catch (error) { if (inventory) inventory.notification_error = errorText(error); }
  }
  if (cleanupComplete) {
    try { await rm(lockPath, { recursive: true, force: true }); }
    catch (error) { if (!primary) primary = error; else attachError(primary, 'lockError', error); }
  }
  if (primary) throw primary;
  return { result, inventory, actualUsd: inventory?.actual_usd ?? 0, estimateUsd };
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export async function recoverObservation({ api, inventoryPath, campaignPath, force = false, sleep, maxWaitMs, deleteConfirmation }) {
  if (!isAbsolute(inventoryPath ?? '') || !isAbsolute(campaignPath ?? '') || resolve(inventoryPath) === resolve(campaignPath)) throw new Error('recovery paths must be distinct absolute paths');
  const inventory = await readPrivateJson(inventoryPath);
  if (inventory.schema_version !== 1 || !inventory.run_id) throw new Error('invalid V4 recovery inventory');
  if (api instanceof LinodeApi && deleteConfirmation !== inventory.run_id) throw new Error('exact run-ID deletion confirmation is required');
  const directory = dirname(campaignPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await stat(directory)).mode & 0o077) throw new Error('campaign directory permissions must be 0700');
  const lockPath = `${campaignPath}.lock`;
  const ownerPath = join(lockPath, 'owner.json');
  try { await mkdir(lockPath, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = await readPrivateJson(ownerPath); } catch { /* force is required if ownership cannot be proven */ }
    if (owner?.run_id && owner.run_id !== inventory.run_id) throw new Error('campaign lock belongs to a different observation');
    if (owner?.host === hostname() && processAlive(owner.pid)) throw new Error('campaign lock owner is still running');
    const stale = owner?.host === hostname() && !processAlive(owner.pid);
    if (!stale && !force) throw new Error('campaign lock ownership is uncertain; explicit recovery force is required');
    const displaced = `${lockPath}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
    await rename(lockPath, displaced);
    try { await mkdir(lockPath, { mode: 0o700 }); }
    catch (createError) { await rename(displaced, lockPath).catch(() => {}); throw createError; }
    await rm(displaced, { recursive: true, force: true });
  }
  await writePrivateJson(ownerPath, { schema_version: 1, run_id: inventory.run_id, pid: process.pid, host: hostname(), started_at: new Date().toISOString(), recovery: true });
  const save = value => writePrivateJson(inventoryPath, value);
  await cleanupPair({ api, inventory, save, sleep, maxWaitMs, deleteConfirmation });
  const ledger = await readPrivateJson(campaignPath);
  const reserved = ledger.reservations?.[inventory.run_id];
  if (reserved !== undefined) {
    settleCampaignSpend(ledger, inventory.run_id, reserved);
    await writePrivateJson(campaignPath, ledger);
    inventory.actual_usd = reserved;
    inventory.budget_settlement = 'reserved-maximum';
  }
  inventory.recovered_at = new Date().toISOString();
  await save(inventory);
  await rm(lockPath, { recursive: true, force: true });
  return inventory;
}
