export const FIXTURE_COUNT = 10_000;
export const LOADS = [1, 10, 100, 1000];

export function fixture(index) {
  if (!Number.isInteger(index) || index < 1 || index > FIXTURE_COUNT) {
    throw new RangeError('fixture index must be between 1 and 10000');
  }
  return {
    fixture_key: index,
    author: `user-${String(((index - 1) % 1000) + 1).padStart(4, '0')}`,
    message: `Guestbook message ${String(index).padStart(5, '0')} from basic-js-v1`,
    created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
  };
}

export function fixtures() {
  return Array.from({ length: FIXTURE_COUNT }, (_, index) => fixture(index + 1));
}

export function fixtureIndex(trial, vu, sequence) {
  let value = (
    0x9e3779b9 ^
    Math.imul(trial, 0x85ebca6b) ^
    Math.imul(vu, 0xc2b2ae35) ^
    Math.imul(sequence + 1, 0x27d4eb2f)
  ) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) % FIXTURE_COUNT;
}
