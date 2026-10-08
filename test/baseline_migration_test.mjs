import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fixtureFacts } from '../baseline/prepare.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('main V6 fixture preserves the previously measured logical contract without importing test lifecycle machinery', async () => {
  assert.ok(existsSync(new URL('../baseline/fixture.mjs', import.meta.url)), 'V6 needs an isolated fixture in main');
  const { lifecycleFixture } = await import('../baseline/fixture.mjs');
  const fixture = await lifecycleFixture();
  const expected = JSON.parse(readFileSync(new URL('./fixtures/v6_fixture_fingerprints.json', import.meta.url)));
  for (const [table, evidence] of Object.entries(expected)) {
    assert.equal(fixture.rows[table].length, evidence.count, table);
    assert.equal(digest(fixture.rows[table]), evidence.sha256, `${table} must preserve the approved logical fixture`);
  }
  const facts = await fixtureFacts(new URL('..', import.meta.url).pathname.replace(/\/$/, ''), 'supabase', fixture);
  assert.ok(Object.hasOwn(facts.sources, 'baseline/fixture.mjs'));
  assert.ok(Object.hasOwn(facts.sources, 'baseline/profile/sql/supabase-rls.sql'));
  assert.ok(!Object.hasOwn(facts.sources, 'test/native_v5_lifecycle.mjs'));
});
