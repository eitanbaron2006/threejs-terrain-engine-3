import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applySphereImpact,
  sphereSimulationMass,
} from '../src/water/WaterInteractionPhysics.js';

function createBody(overrides = {}) {
  return {
    radius: 3,
    mass: 160,
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    ...overrides,
  };
}

function impact(overrides = {}) {
  return {
    projectileMass: 2,
    relativeVelocity: new THREE.Vector3(60, 0, 0),
    normal: new THREE.Vector3(-1, 0, 0),
    contactOffset: new THREE.Vector3(-3, 0, 0),
    restitution: 0.25,
    ...overrides,
  };
}

test('floating sphere simulation mass increases with radius and density', () => {
  const light = sphereSimulationMass(2, 0.4);
  const heavy = sphereSimulationMass(3, 0.8);
  assert.ok(heavy > light * 2);
});

test('faster and heavier projectiles transfer more momentum', () => {
  const targetA = createBody();
  const targetB = createBody();

  applySphereImpact(targetA, impact({
    projectileMass: 1,
    relativeVelocity: new THREE.Vector3(30, 0, 0),
  }));
  applySphereImpact(targetB, impact({
    projectileMass: 3,
    relativeVelocity: new THREE.Vector3(60, 0, 0),
  }));

  assert.ok(targetB.velocity.length() > targetA.velocity.length() * 3);
  assert.ok(targetB.velocity.x > 0);
});

test('off-center impact adds angular velocity', () => {
  const target = createBody();
  applySphereImpact(target, impact({
    contactOffset: new THREE.Vector3(-2.5, 1.6, 0),
  }));

  assert.ok(target.angularVelocity.lengthSq() > 0);
  assert.notEqual(target.angularVelocity.z, 0);
});

test('separating projectile does not add energy', () => {
  const target = createBody();
  const impulse = applySphereImpact(target, impact({
    relativeVelocity: new THREE.Vector3(-20, 0, 0),
  }));

  assert.equal(impulse, 0);
  assert.equal(target.velocity.lengthSq(), 0);
});
