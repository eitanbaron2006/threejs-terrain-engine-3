import test from 'node:test';
import assert from 'node:assert/strict';
import {
  waterRadiusToSimulationUv,
  worldToWaterSimulationUv,
} from '../src/water/WaterSimulationCoordinates.js';

test('maps water world coordinates to the same repeating simulation space as the shader', () => {
  assert.deepEqual(worldToWaterSimulationUv(250, -125, 500), {
    u: 0.5,
    v: -0.25,
  });
});

test('water simulation coordinate mapping rejects invalid size', () => {
  assert.equal(worldToWaterSimulationUv(10, 20, 0), null);
  assert.equal(worldToWaterSimulationUv(10, 20, Number.NaN), null);
});

test('local simulation coordinates are centered on the active camera window', () => {
  const uv = worldToWaterSimulationUv(1012, -488, 96, { x: 1000, z: -500 });

  assert.ok(Math.abs(uv.u - 0.625) < 1e-9);
  assert.ok(Math.abs(uv.v - 0.625) < 1e-9);
});

test('a small projectile maps to a sub-metre ripple instead of a five-metre drop', () => {
  const radiusUv = waterRadiusToSimulationUv(0.48, 96, 256);

  assert.ok(radiusUv >= 1 / 256);
  assert.ok(radiusUv <= 0.008);
  assert.ok(radiusUv * 96 < 0.8);
});
