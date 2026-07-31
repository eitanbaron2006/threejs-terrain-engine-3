import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterImpactEffects } from '../src/water/WaterImpactEffects.js';

test('water impact effects create a compact foam ring and bounded spray', () => {
  const scene = new THREE.Scene();
  const effects = new WaterImpactEffects({ scene, capacity: 8, dropletCapacity: 48 });

  effects.spawn({
    x: 4,
    y: 1,
    z: -3,
    foamRadius: 0.72,
    foamLifetime: 0.8,
    dropletCount: 8,
    normalSpeed: 30,
  });

  assert.equal(effects.activeRingCount, 1);
  assert.equal(effects.activeDropletCount, 8);
  assert.ok(effects.rings[0].maximumRadius <= 0.9);

  effects.update(1.2);
  assert.equal(effects.activeRingCount, 0);
  assert.equal(effects.activeDropletCount, 0);
  effects.dispose();
});
