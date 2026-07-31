import test from 'node:test';
import assert from 'node:assert/strict';
import { updateUnderwaterState } from '../src/water/UnderwaterPostProcess.js';

test('underwater state uses hysteresis around the moving water surface', () => {
  const options = { enabled: true, enterOffset: 0.1, exitOffset: 0.22 };

  assert.equal(updateUnderwaterState(false, 0.2, 0, options), false);
  assert.equal(updateUnderwaterState(false, -0.11, 0, options), true);
  assert.equal(updateUnderwaterState(true, 0.18, 0, options), true);
  assert.equal(updateUnderwaterState(true, 0.23, 0, options), false);
});

test('underwater state disables immediately and rejects invalid camera values', () => {
  assert.equal(updateUnderwaterState(true, -4, 0, { enabled: false }), false);
  assert.equal(updateUnderwaterState(false, Number.NaN, 0, { enabled: true }), false);
});
