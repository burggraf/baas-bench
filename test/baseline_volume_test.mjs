import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NativeBaseline } from '../baseline/native.mjs';

const dir = mkdtempSync(join(tmpdir(), 'v6-volume-fake-'));
try {
  const factoryDir=join(dir,'factory'), shared=join(dir,'shared');
  mkdirSync(factoryDir); mkdirSync(join(shared,'trailbase'),{recursive:true});
  writeFileSync(join(shared,'trailbase/bootstrap-config.textproto'),'bootstrap'); writeFileSync(join(shared,'trailbase/migration.sql'),'migration');
  const factory=Object.create(NativeBaseline.prototype); let initialized=false;
  Object.assign(factory,{pg:false,platform:'trailbase',dir:factoryDir,depot:join(factoryDir,'depot'),shared,inventoryPath:join(factoryDir,'inventory.json'),volume(){return {initialize(){assert.equal(factory.inv.storage,'docker-volume');assert.equal(factory.inv.volume,`${factory.inv.name}-depot`);initialized=true;}};}});
  await factory.newInventory(); assert.equal(factory.inv.format,2); assert.equal(initialized,true);
  assert.equal(JSON.parse(readFileSync(factory.inventoryPath)).volume,factory.inv.volume);
  assert.equal(readFileSync(join(factory.depot,'config.textproto'),'utf8'),'bootstrap');
  await assert.rejects(factory.newInventory(),/incomplete existing preparation/);
  const vmDepot = join(dir, 'linux-volume'), input = join(dir, 'depot');
  mkdirSync(vmDepot); mkdirSync(input);
  writeFileSync(join(input, 'config.textproto'), 'synthetic config');
  const inv = { format: 2, platform: 'trailbase', owner: '1'.repeat(32), name: `v6-trailbase-${'1'.repeat(12)}`, volume: `v6-trailbase-${'1'.repeat(12)}-depot`, storage: 'docker-volume', base: 'http://127.0.0.1:4000' };
  const calls = [], retained = [];
  let volumeExists = false, volumeOwner = inv.owner, current = null, foreignMount = false, renameFailure = null;
  const backend = Object.create(NativeBaseline.prototype);
  Object.assign(backend, {
    pg: false, dir, runDir: dir, depot: input, inv, pins: { TRAILBASE_IMAGE: 'pinned-image' },
    owned: () => current ? [current] : [], async stop() { if(current) current.State.Running = false; },
    docker(args) {
      calls.push(args);
      if(args[0] === 'image') return JSON.stringify([{Id:'pinned-image'}]);
      if(args[0] === 'volume' && args[1] === 'ls') return volumeExists ? inv.volume : '';
      if(args[0] === 'volume' && args[1] === 'create') { assert.ok(args.includes(`baas-bench.v6-owner=${inv.owner}`)); volumeExists=true; return inv.volume; }
      if(args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([{Name:inv.volume, Labels:{'baas-bench.v6-owner':volumeOwner}}]);
      if(args[0] === 'ps') return foreignMount ? 'foreign' : [...retained, ...(current ? [current] : [])].map(c=>c.Id).join('\n');
      if(args[0] === 'inspect') return JSON.stringify(foreignMount ? [{Id:'foreign',State:{Running:false},Config:{Labels:{'baas-bench.v6-owner':'foreign'}}}] : [...retained,...(current ? [current] : [])]);
      if(args[0] === 'rename') {
        if(renameFailure) throw renameFailure;
        assert.equal(args[1],current.Id); assert.equal(current.State.Running,false);
        retained.push(current); current=null; return '';
      }
      if(args[0] === 'run' && args.includes('--entrypoint')) {
        assert.ok(args.includes('--pull') && args[args.indexOf('--pull')+1] === 'never');
        assert.ok(args.some(a=>a === `type=volume,source=${inv.volume},target=/depot,volume-nocopy` || a === `type=volume,source=${inv.volume},target=/depot,volume-nocopy,readonly`));
        assert.ok(args.includes(`baas-bench.v6-owner=${inv.owner}`));
        assert.equal(args[args.indexOf('--entrypoint')+1], '/bin/sh');
        let script=args.at(-1).replaceAll(/\/depot(?=\/|\s|[;"']|$)/g,vmDepot).replaceAll('/input',input).replaceAll('/archive',dir);
        const r=spawnSync('/bin/sh',['-c',script],{encoding:'utf8'}); assert.equal(r.status,0,r.stderr); return r.stdout;
      }
      if(args[0] === 'run') {
        assert.equal(current,null);
        assert.ok(args.includes(`type=volume,source=${inv.volume},target=/app/traildepot,volume-nocopy`),'live SQLite must not be a host bind mount');
        assert.equal(args[args.indexOf('--cpus')+1],'2'); assert.equal(args[args.indexOf('--memory')+1],'4g'); assert.equal(args.at(-1),'pinned-image');
        current={Id:String(retained.length+1).repeat(64),State:{Running:true},Config:{Labels:{'baas-bench.v6-owner':inv.owner},Image:'pinned-image'},Mounts:[{Type:'volume',Name:inv.volume,Destination:'/app/traildepot',RW:true}]}; return current.Id;
      }
      assert.fail(`unexpected fake Docker operation ${args[0]}`);
    },
  });
  assert.equal(typeof backend.volume, 'function', 'TrailBase needs an owned Docker-volume lifecycle');
  const storage = backend.volume();
  storage.initialize();
  assert.equal(readFileSync(join(vmDepot,'config.textproto'),'utf8'),'synthetic config');
  assert.throws(()=>storage.initialize(),/volume name already exists/,'never adopt or overwrite a colliding volume');
  assert.equal(backend.trailSessions(),null,'never query a host-side live DB on the volume path');
  await backend.start();
  assert.equal(current.State.Running,true);
  mkdirSync(join(vmDepot,'data'));
  const sqlite = spawnSync('sqlite3',[join(vmDepot,'data/session.db'),'CREATE TABLE _session(id TEXT); CREATE TABLE _authorization_code(id TEXT); CREATE TABLE _otp_code(id TEXT);'],{encoding:'utf8'});
  assert.equal(sqlite.status,0,sqlite.stderr);
  writeFileSync(join(vmDepot,'baseline-file'),'snapshot');
  assert.throws(()=>storage.snapshot(),/stopped writers/,'never archive a live SQLite/WAL set');
  await backend.stop();
  storage.snapshot();
  assert.ok(existsSync(join(dir,'depot.tar')));
  assert.deepEqual(storage.audit(),{sessions:0,authorizationCodes:0,otpCodes:0});
  const originalSqlite=backend.sqlite;
  backend.sqlite=()=> 'NaN|0|0\n';
  assert.throws(()=>storage.audit(),/malformed offline native session counts/);
  backend.sqlite=originalSqlite;
  writeFileSync(join(dir,'images.json'),JSON.stringify({trailbase:{id:'pinned-image'}}));
  const inode=statSync(vmDepot).ino;
  for(let i=0;i<5;i++) {
    writeFileSync(join(vmDepot,'stale-file'),'write'); writeFileSync(join(vmDepot,'.stale-hidden'),'write');
    await backend.restore({state:{auth:'baseline'}});
    assert.equal(statSync(vmDepot).ino,inode);
    assert.equal(readFileSync(join(vmDepot,'baseline-file'),'utf8'),'snapshot');
    assert.equal(existsSync(join(vmDepot,'stale-file')),false); assert.equal(existsSync(join(vmDepot,'.stale-hidden')),false);
    assert.equal(backend.admin,null);
    assert.equal(retained.length,i+1,'retain each prior owned container and its Docker logs');
    await backend.start();
  }
  assert.equal(calls.filter(a=>['rm','start'].includes(a[0])).length,0,'no container deletion or stale restart after restore');
  const refuseMutation = async (change, pattern) => {
    change(); const before=calls.length;
    await assert.rejects(backend.restore({state:{}}),pattern);
    assert.equal(calls.slice(before).some(a=>a[0]==='rename'||(a[0]==='run'&&a.includes('--entrypoint'))),false,'refusal precedes preservation/volume changes');
    assert.equal(readFileSync(join(vmDepot,'baseline-file'),'utf8'),'snapshot');
  };
  await refuseMutation(()=>{volumeOwner='foreign';},/unowned volume/); volumeOwner=inv.owner;
  await refuseMutation(()=>{foreignMount=true;},/unowned volume user/); foreignMount=false;
  renameFailure=new Error('ambiguous rename failure');
  writeFileSync(join(vmDepot,'before-failure'),'preserve');
  await assert.rejects(backend.restore({state:{}}),e=>e===renameFailure);
  assert.equal(readFileSync(join(vmDepot,'before-failure'),'utf8'),'preserve'); renameFailure=null;
  await backend.stop();
  spawnSync('sqlite3',[join(vmDepot,'data/session.db'),"INSERT INTO _session VALUES('synthetic-session');"]);
  assert.throws(()=>storage.snapshot(),/baseline session state is not empty/,'nonempty native session state must fail the snapshot gate');
  const readonlyCalls=[];
  const auditBackend=Object.create(NativeBaseline.prototype);
  Object.assign(auditBackend,{command(exe,args){readonlyCalls.push({exe,args});return '0|0|0\n';}});
  auditBackend.sqlite('offline-copy.db','SELECT 1',{readOnly:true});
  assert.ok(readonlyCalls[0].args.includes('-readonly'),'offline inspection must not mutate the backup');
  const logoutOrder=[];
  const sessionVerifier=Object.create(NativeBaseline.prototype);
  Object.assign(sessionVerifier,{inv,offlineSessionCounts:{sessions:0,authorizationCodes:0,otpCodes:0},admin:{tokens:()=>({refresh_token:'synthetic-admin-refresh'}),logout:async()=>logoutOrder.push('logout')},async assertRefreshRevoked(token){assert.equal(token,'synthetic-admin-refresh');logoutOrder.push('refresh denied');}});
  const proof=await sessionVerifier.clearVerificationSession();
  assert.deepEqual(logoutOrder,['logout','refresh denied']);
  assert.equal(proof.native_sessions,null,'an offline baseline plus revocation is not a live row-count measurement');
  assert.equal(proof.offline_baseline_sessions,0); assert.equal(proof.admin_refresh_rejected,true);
  assert.equal(sessionVerifier.admin,null);
  const realFetch=globalThis.fetch;
  try {
    const revocation=Object.create(NativeBaseline.prototype); revocation.inv=inv;
    globalThis.fetch=async(_url,options)=>{assert.equal(JSON.parse(options.body).refresh_token,'synthetic-admin-refresh');return {status:401};};
    await revocation.assertRefreshRevoked('synthetic-admin-refresh');
    globalThis.fetch=async()=>({status:500});
    await assert.rejects(revocation.assertRefreshRevoked('synthetic-admin-refresh'),/not definitively revoked/);
    globalThis.fetch=async()=>({status:200});
    await assert.rejects(revocation.assertRefreshRevoked('synthetic-admin-refresh'),/not definitively revoked/);
  } finally { globalThis.fetch=realFetch; }
  console.log('V6 fake owned-volume, offline snapshot/session and repeated restore regressions passed (NOT live evidence)');
} finally {rmSync(dir,{recursive:true,force:true});}
