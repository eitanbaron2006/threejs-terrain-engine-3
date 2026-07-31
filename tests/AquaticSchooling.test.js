import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSchoolVelocity } from '../src/water/AquaticSchooling.js';

function speed(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

test('school steering keeps velocity bounded', () => {
  const velocity = computeSchoolVelocity({
    position: { x: 0, y: -8, z: 0 },
    velocity: { x: 12, y: 0, z: 0 },
    neighbours: [],
    center: { x: 5, y: -8, z: 0 },
    floorY: -15,
    surfaceY: -3,
    seedPhase: 0.3,
    elapsed: 1,
    maximumSpeed: 4.5,
  }, 0.1);

  assert.ok(speed(velocity) <= 4.5 + 1e-9);
});

test('school steering pushes fish away from the seabed', () => {
  const velocity = computeSchoolVelocity({
    position: { x: 0, y: -13.9, z: 0 },
    velocity: { x: 1, y: -2, z: 0 },
    neighbours: [],
    center: { x: 0, y: -9, z: 0 },
    floorY: -15,
    surfaceY: -3,
    seedPhase: 0.3,
    elapsed: 1,
    maximumSpeed: 4.5,
  }, 0.1);

  assert.ok(velocity.y > -2);
});

test('school steering pushes fish away from the water surface', () => {
  const velocity = computeSchoolVelocity({
    position: { x: 0, y: -4, z: 0 },
    velocity: { x: 1, y: 2, z: 0 },
    neighbours: [],
    center: { x: 0, y: -8, z: 0 },
    floorY: -15,
    surfaceY: -3,
    seedPhase: 0.7,
    elapsed: 2,
    maximumSpeed: 4.5,
  }, 0.1);

  assert.ok(velocity.y < 2);
});
