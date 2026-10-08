import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeBaseline} from '../baseline/native.mjs';
import {TrailBaseCapacity} from '../baseline/capacity.mjs';

const dir=mkdtempSync(join(tmpdir(),'v6-network-fake-'));
try {
 const root=fileURLToPath(new URL('../',import.meta.url));
 const inv={name:'v6-trailbase-test',owner:'ours',base:'http://127.0.0.1:65000',volume:'v6-trailbase-test-depot',storage:'docker-volume'};
 const container={Id:'a'.repeat(64),State:{Running:true},Config:{Image:'native-pin',Labels:{'baas-bench.v6-owner':'ours'}},Mounts:[{Type:'volume',Name:inv.volume,Destination:'/app/traildepot'}]};
 let cs=[container];
 const backend=Object.create(NativeBaseline.prototype);
 Object.assign(backend,{pg:false,root,dir,runDir:dir,inv,pins:{TRAILBASE_IMAGE:'native-pin'},owned:()=>cs});
 assert.equal(typeof backend.k6Network,'function','both TrailBase runners need a shared direct-Linux route');
 const route=backend.k6Network();
 assert.equal(route.base,'http://127.0.0.1:4000');
 assert.deepEqual(route.dockerArgs,['--network',`container:${container.Id}`]);
 assert.equal(route.kind,'direct-linux-network-namespace');
 assert.equal(route.backend_container_id,container.Id);
 assert.equal(inv.base,'http://127.0.0.1:65000','controller/Auth loopback must remain unchanged');
 for(const [bad,pattern] of [
  [[],/one running owned/], [[container,container],/one running owned/],
  [[{...container,State:{Running:false}}],/running owned/],
  [[{...container,Config:{...container.Config,Labels:{'baas-bench.v6-owner':'foreign'}}}],/unowned/],
  [[{...container,Id:'bad;container'}],/container ID/],
  [[{...container,Config:{...container.Config,Image:'changed'}}],/backend image/],
  [[{...container,Mounts:[{Type:'bind',Destination:'/app/traildepot'}]}],/depot mount/],
 ]){cs=bad;assert.throws(()=>backend.k6Network(),pattern);}
 cs=[container];
 const pg=Object.create(NativeBaseline.prototype);
 Object.assign(pg,{pg:true,inv:{base:inv.base},owned(){assert.fail('Supabase route must not select a monolithic TrailBase container');}});
 const pgRoute=pg.k6Network();
 assert.equal(pgRoute.base,process.platform==='darwin'?'http://host.docker.internal:65000':inv.base);
 assert.deepEqual(pgRoute.dockerArgs,process.platform==='linux'?['--network','host']:[]);

 const expectedSummary={metrics:{capacity_http_failure:{values:{rate:0}},http_req_failed:{values:{rate:0,passes:0}},checks:{values:{passes:3,fails:0,rate:1}},http_reqs:{values:{count:3,rate:3}},iterations:{values:{count:1}},...Object.fromEntries(['list','create','reread'].map(op=>[`capacity_${op}_duration`,{values:{count:1,'p(95)':1,'p(99)':1}}]))},state:{testRunDurationMs:60000}};
 const captures=[];
 const runFake=(exe,args,options)=>{
  assert.equal(exe,'docker');assert.equal(args[0],'run');
  assert.equal(args[args.indexOf('--pull')+1],'never','route changes must not trigger image downloads');
  assert.equal(args[args.indexOf('--network')+1],`container:${container.Id}`);
  const mount=args.find(a=>a.startsWith('type=bind,source=')&&a.endsWith(',target=/work'));
  const work=mount.slice('type=bind,source='.length,-',target=/work'.length);
  const cfg=JSON.parse(readFileSync(join(work,'config.json')));
  assert.equal(cfg.base,'http://127.0.0.1:4000');
  captures.push({args,config:cfg});
  writeFileSync(join(work,'summary.json'),JSON.stringify(expectedSummary));
  return {status:0,stdout:'fake k6',stderr:''};
 };
 Object.assign(backend,{runConfig:{base:inv.base,token:'synthetic-access-token',prefix:'v6test'},docker(){return '';},spawnCommand:runFake});
 writeFileSync(join(dir,'manifest.json'),JSON.stringify({synthetic:true}));
 await backend.k6();
 const provenance=JSON.parse(readFileSync(join(dir,'provenance.json')));
 assert.equal(provenance.measurement_network.kind,route.kind);
 assert.equal(provenance.measurement_network.backend_container_id,container.Id);
 const capacityDir=join(dir,'capacity');mkdirSync(capacityDir);
 const actor={user:'user',organization:'org',project:'project',token:'synthetic-access-token',csrf:'synthetic-csrf'};
 const capacity=Object.create(TrailBaseCapacity.prototype);
 Object.assign(capacity,{...backend,runDir:capacityDir,baseActors:[actor],capacityPrefix:'v6captest',async loginActors(){return [actor];},async backendAvailable(){return true;},async postcheckStage(){return {passed:true,failureReasons:[],tasks:1,atomicActivities:1};}});
 writeFileSync(join(capacityDir,'start-state.json'),JSON.stringify({synthetic:true}));
 const outcome=await capacity.runCapacityStage(1,{ordinal:1});
 assert.equal(outcome.passed,true);
 assert.equal(outcome.measurement_network.kind,route.kind);
 assert.equal(outcome.measurement_network.backend_container_id,container.Id);
 assert.equal(captures.length,2,'exercise both real runners with fake Docker, not just route construction');
 assert.equal(inv.base,'http://127.0.0.1:65000');
 console.log('V6 fake direct-network, ownership and actual runner invocation regressions passed (NOT live evidence)');
}finally{rmSync(dir,{recursive:true,force:true});}
