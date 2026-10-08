import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

// Native Auth accepted newly issued tokens that PostgREST rejected with
// PGRST303 "JWT issued at future". Admission settles the timestamp boundary
// outside measurement, without relaxing validation or retrying measured HTTP.
export async function waitForCapacityTokenEligibility(claims, { now = Date.now, monotonicNow = () => performance.now(), pause: wait = pause } = {}) {
  assert.ok(Number.isSafeInteger(claims.iat) && claims.iat >= 0, 'native token issued-at missing/invalid');
  assert.ok(Number.isSafeInteger(claims.exp) && claims.exp > claims.iat, 'native token expiration invalid');
  assert.ok(claims.nbf === undefined || (Number.isSafeInteger(claims.nbf) && claims.nbf >= 0), 'native token not-before invalid');
  const eligibleAt = Math.max(claims.iat, claims.nbf ?? claims.iat) * 1000 + 1500;
  assert.ok(Math.max(0, eligibleAt - now()) <= 5000, 'native token clock discrepancy exceeds bounded settling window');
  const deadline = monotonicNow() + 5000;
  // Timer completion does not prove that wall-clock eligibility has arrived.
  while (now() < eligibleAt) {
    const remaining = deadline - monotonicNow();
    assert.ok(remaining > 0, 'native token clock eligibility exceeded bounded wait');
    await wait(Math.min(Math.max(1, eligibleAt - now()), Math.ceil(remaining)));
  }
  assert.ok(now() < claims.exp * 1000, 'native token expired during clock eligibility wait');
}
