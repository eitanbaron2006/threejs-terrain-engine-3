import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  integrateProjectile,
  sweptSphereHit,
} from '../src/player/ProjectilePhysics.js';

function createProjectile(overrides = {}) {
  return {
    position: new THREE.Vector3(0, 0, 0),
    previousPosition: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, -60),
    radius: 0.16,
    age: 0,
    lifetime: 4,
    inWater: false,
    ...overrides,
  };
}

test('underwater drag rapidly reduces projectile speed', () => {
  const projectile = createProjectile({
    position: new THREE.Vector3(0, -2, 0),
    previousPosition: new THREE.Vector3(0, -2, 0),
  });

  const result = integrateProjectile(projectile, {
    gravity: 9.81,
    surfaceY: 1,
    waterDrag: 0.085,
    floorY: -20,
  }, 0.1);

  assert.ok(Math.abs(projectile.velocity.z) < 45);
  assert.equal(projectile.inWater, true);
  assert.equal(result.expired, false);
});

test('projectile reports a single water-entry crossing', () => {
  const projectile = createProjectile({
    position: new THREE.Vector3(0, 1.2, 0),
    previousPosition: new THREE.Vector3(0, 1.2, 0),
    velocity: new THREE.Vector3(0, -8, 0),
  });

  const first = integrateProjectile(projectile, {
    gravity: 0,
    surfaceY: 1,
    waterDrag: 0,
    floorY: -20,
  }, 0.05);
  const second = integrateProjectile(projectile, {
    gravity: 0,
    surfaceY: 1,
    waterDrag: 0,
    floorY: -20,
  }, 0.05);

  assert.equal(first.enteredWater, true);
  assert.equal(second.enteredWater, false);
});

test('terrain contact is reported without expiring the projectile', () => {
  const projectile = createProjectile({
    position: new THREE.Vector3(0, 0.3, 0),
    previousPosition: new THREE.Vector3(0, 0.3, 0),
    velocity: new THREE.Vector3(0, -8, 0),
  });

  const result = integrateProjectile(projectile, {
    gravity: 9.81,
    surfaceY: -20,
    floorY: 0,
  }, 0.05);

  assert.equal(result.hitFloor, true);
  assert.equal(result.expired, false);
});

test('swept sphere catches a fast crossing projectile', () => {
  const hit = sweptSphereHit(
    new THREE.Vector3(-10, 0, 0),
    new THREE.Vector3(10, 0, 0),
    0.15,
    new THREE.Vector3(0, 0, 0),
    3,
  );

  assert.ok(hit);
  assert.ok(hit.time >= 0 && hit.time <= 1);
  assert.ok(Math.abs(hit.point.x + 3.15) < 1e-6);
});

test('swept sphere rejects a near miss', () => {
  const hit = sweptSphereHit(
    new THREE.Vector3(-10, 4, 0),
    new THREE.Vector3(10, 4, 0),
    0.15,
    new THREE.Vector3(0, 0, 0),
    3,
  );
  assert.equal(hit, null);
});
