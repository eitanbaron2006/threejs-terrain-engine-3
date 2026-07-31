import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeProjectileWaterImpact } from '../src/water/WaterImpactModel.js';

test('small projectiles create compact short-lived water impacts', () => {
  const impact = computeProjectileWaterImpact({
    radius: 0.16,
    mass: 2.4,
    velocity: new THREE.Vector3(0, -32, 0),
    normal: new THREE.Vector3(0, 1, 0),
  });

  assert.ok(impact.rippleRadius >= 0.3 && impact.rippleRadius <= 0.75);
  assert.ok(impact.rippleStrength > 0 && impact.rippleStrength <= 0.008);
  assert.ok(impact.foamRadius <= 0.9);
  assert.ok(impact.foamLifetime <= 1.1);
  assert.ok(impact.dropletCount >= 4 && impact.dropletCount <= 12);
});

test('grazing impacts produce less displacement than vertical impacts', () => {
  const vertical = computeProjectileWaterImpact({
    radius: 0.16,
    mass: 2.4,
    velocity: new THREE.Vector3(0, -30, 0),
    normal: new THREE.Vector3(0, 1, 0),
  });
  const grazing = computeProjectileWaterImpact({
    radius: 0.16,
    mass: 2.4,
    velocity: new THREE.Vector3(29, -3, 0),
    normal: new THREE.Vector3(0, 1, 0),
  });

  assert.ok(grazing.rippleStrength < vertical.rippleStrength);
  assert.ok(grazing.dropletCount <= vertical.dropletCount);
});
