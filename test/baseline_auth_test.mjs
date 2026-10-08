import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeBaseline } from '../baseline/native.mjs';
test('fixed Supabase baseline applies the same bounded JWT admission as capacity before RLS profile access', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'v6-auth-admission-'));
  try {
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({password:'synthetic-test-password'}));
    const future = Math.floor(Date.now()/1000)+60;
    const token = `e30.${Buffer.from(JSON.stringify({iat:future,exp:future+3600})).toString('base64url')}.synthetic`;
    const calls=[];
    const b=Object.assign(Object.create(NativeBaseline.prototype), {dir,runDir:dir,pg:true,fixture:{specs:[{userId:'user1',organizationId:'org1',projectId:'project1'}],rows:{users:[['user1','u@example.test']]}},inv:{base:'http://fake'},async call(path){calls.push(path);return path.startsWith('/auth/')?{access_token:token}:[{email:'u@example.test'}];}});
    await assert.rejects(b.authenticate(),/clock|bounded/);
    assert.equal(calls.length,1,'unsettled JWT must never reach the native RLS profile or measurement');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
