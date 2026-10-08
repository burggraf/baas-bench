import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The live depot and every restore stay in Docker's Linux filesystem. Only a
// closed tar archive (and static bootstrap input) crosses the host/VM boundary.
export class TrailVolume {
  constructor(backend) { this.b = backend; }
  name() {
    const inv = this.b.inv;
    assert.ok(inv?.storage === 'docker-volume' && inv.volume === `${inv.name}-depot`, 'TrailBase requires a fresh Docker-volume preparation');
    return inv.volume;
  }
  check({ stopped = false } = {}) {
    const name = this.name(), b = this.b;
    const volumes = JSON.parse(b.docker(['volume', 'inspect', name]));
    assert.ok(volumes.length === 1 && volumes[0].Name === name && volumes[0].Labels?.['baas-bench.v6-owner'] === b.inv.owner, 'refusing unowned volume');
    const ids = b.docker(['ps', '-aq', '--filter', `volume=${name}`]).trim().split(/\s+/).filter(Boolean);
    const containers = ids.length ? JSON.parse(b.docker(['inspect', ...ids])) : [];
    for (const c of containers) {
      assert.equal(c.Config?.Labels?.['baas-bench.v6-owner'], b.inv.owner, 'refusing unowned volume user');
      if (stopped) assert.equal(c.State?.Running, false, 'volume operation requires stopped writers');
    }
    return containers;
  }
  helper(script, { input = false, readonly = false } = {}) {
    const b = this.b;
    this.check({ stopped: true });
    return b.docker(['run', '--rm', '--pull', 'never', '--name', `${b.inv.name}-volume-helper`, '--label', `baas-bench.v6-owner=${b.inv.owner}`, '--user', '0:0', '--entrypoint', '/bin/sh', '--mount', `type=volume,source=${this.name()},target=/depot,volume-nocopy${readonly ? ',readonly' : ''}`, '--mount', input ? `type=bind,source=${b.depot},target=/input,readonly` : `type=bind,source=${b.dir},target=/archive${readonly ? '' : ',readonly'}`, b.pins.TRAILBASE_IMAGE, '-c', `set -eu; ${script}`]);
  }
  initialize() {
    const b = this.b, name = this.name();
    assert.equal(b.docker(['volume', 'ls', '-q', '--filter', `name=^${name}$`]).trim(), '', 'volume name already exists; no automatic reuse');
    b.docker(['volume', 'create', '--label', `baas-bench.v6-owner=${b.inv.owner}`, name]);
    this.helper(`test -z "$(find /depot -mindepth 1 -maxdepth 1 -print -quit)"; cp -a /input/. /depot/; chown -R ${process.getuid()}:${process.getgid()} /depot; chmod 700 /depot`, { input: true });
  }
  audit() {
    const b = this.b, snapshot = join(b.dir, 'depot.tar');
    assert.ok(existsSync(snapshot), 'closed depot snapshot absent');
    const names = b.command('tar', ['-tf', snapshot]).trim().split('\n');
    assert.ok(names.length && names.every(n => n && !n.startsWith('/') && !n.split('/').includes('..')), 'unsafe snapshot archive path');
    const copy = join(b.runDir, `snapshot-audit-${randomBytes(6).toString('hex')}`);
    mkdirSync(copy, { mode: 0o700 });
    b.command('tar', ['-xf', snapshot, '-C', copy]);
    const result = b.sqlite(join(copy, 'data/session.db'), 'SELECT (SELECT count(*) FROM _session),(SELECT count(*) FROM _authorization_code),(SELECT count(*) FROM _otp_code);', { readOnly: true }).trim();
    assert.match(result, /^\d+\|\d+\|\d+$/, 'malformed offline native session counts');
    const [sessions, authorizationCodes, otpCodes] = result.split('|').map(Number);
    assert.ok([sessions, authorizationCodes, otpCodes].every(v => Number.isSafeInteger(v) && v === 0), 'baseline session state is not empty');
    return { sessions, authorizationCodes, otpCodes };
  }
  snapshot() {
    const b = this.b;
    this.helper(`test -z "$(find /depot -type l -print -quit)"; tar -cf /archive/depot.tar -C /depot .; chown ${process.getuid()}:${process.getgid()} /archive/depot.tar; chmod 600 /archive/depot.tar`, { readonly: true });
    b.offlineSessionCounts = this.audit();
  }
  restore() {
    const b = this.b;
    this.check({ stopped: true });
    const counts = this.audit(); // Fail before any preservation or volume mutation.
    const containers = b.owned();
    assert.ok(containers.length <= 1, 'ambiguous owned TrailBase deployment');
    for (const c of containers) {
      assert.equal(c.Config?.Labels?.['baas-bench.v6-owner'], b.inv.owner, 'refusing unowned deployment');
      assert.equal(c.State?.Running, false, 'restore requires stopped deployment');
      const mount = c.Mounts?.filter(m => m.Destination === '/app/traildepot');
      assert.ok(mount?.length === 1 && mount[0].Type === 'volume' && mount[0].Name === this.name(), 'unexpected live depot mount');
      assert.match(c.Id, /^[a-f0-9]{64}$/, 'invalid owned container ID');
      const name = `${b.inv.name}-preserved-${randomBytes(12).toString('hex')}`;
      const path = join(b.runDir, `${name}.json`);
      const evidence = { id: c.Id, owner: b.inv.owner, original_name: b.inv.name, preserved_name: name, status: 'planned', at: new Date().toISOString() };
      writeFileSync(path, JSON.stringify(evidence, null, 2), { mode: 0o600, flag: 'wx' });
      b.docker(['rename', c.Id, name]);
      assert.equal(b.owned().length, 0, 'preserved container still occupies deployment name');
      writeFileSync(path, JSON.stringify({ ...evidence, status: 'preserved' }, null, 2), { mode: 0o600 });
    }
    this.helper(`find /depot -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xf /archive/depot.tar -C /depot; chown -R ${process.getuid()}:${process.getgid()} /depot; chmod 700 /depot`);
    b.offlineSessionCounts = counts;
    b.admin = null;
  }
}
