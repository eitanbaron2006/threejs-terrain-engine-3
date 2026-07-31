import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WaterInteractionSystem } from '../src/water/WaterInteractionSystem.js';
import { WaterSpatialModel } from '../src/water/WaterSpatialModel.js';

function createSystem() {
  const scene = new THREE.Scene();
  const spatialModel = new WaterSpatialModel({
    worldSize: 1200,
    waterLevel: 2,
    seed: 1337,
    sampleHeight: () => -20,
  });
  return new WaterInteractionSystem({
    scene,
    spatialModel,
    settings: {
      floatingSphereCount: 2,
      floatingSphereRadius: 3,
      waterObjectDensity: 0.58,
      floatingSpheresEnabled: true,
    },
  });
}

test('projectile sweep applies an impulse through the public water API', () => {
  const system = createSystem();
  const body = system.bodies[0];
  const start = body.position.clone().add(new THREE.Vector3(-12, 1.2, 0));
  const end = body.position.clone().add(new THREE.Vector3(12, 1.2, 0));

  const result = system.traceProjectile({
    start,
    end,
    velocity: new THREE.Vector3(70, 0, 0),
    radius: 0.16,
    mass: 2.4,
  });

  assert.equal(result.hit, true);
  assert.ok(body.velocity.x > 0);
  assert.ok(body.angularVelocity.lengthSq() > 0);
  system.dispose();
});

test('reset restores seeded sphere positions and clears motion', () => {
  const system = createSystem();
  const body = system.bodies[0];
  const initial = body.position.clone();
  body.position.add(new THREE.Vector3(20, -3, 10));
  body.velocity.set(4, 3, 2);
  body.angularVelocity.set(1, 2, 3);

  system.reset();

  assert.ok(body.position.distanceTo(initial) < 1e-9);
  assert.equal(body.velocity.lengthSq(), 0);
  assert.equal(body.angularVelocity.lengthSq(), 0);
  system.dispose();
});

test('projectile sweep reports a miss without changing bodies', () => {
  const system = createSystem();
  const before = system.bodies.map((body) => body.velocity.clone());
  const result = system.traceProjectile({
    start: new THREE.Vector3(-10, 100, -10),
    end: new THREE.Vector3(10, 100, 10),
    velocity: new THREE.Vector3(70, 0, 0),
    radius: 0.16,
    mass: 2.4,
  });

  assert.equal(result.hit, false);
  system.bodies.forEach((body, index) => {
    assert.ok(body.velocity.equals(before[index]));
  });
  system.dispose();
});

test('moving floating bodies expose physical water displacement segments', () => {
  const system = createSystem();
  const body = system.bodies[0];
  body.velocity.set(2, -1, 0.5);

  system.update(1 / 60);
  const displacements = system.consumeDisplacements();

  assert.equal(displacements.length, system.bodies.length);
  assert.ok(displacements[0].previous.distanceTo(displacements[0].current) > 0);
  assert.equal(displacements[0].radius, body.radius);
  assert.deepEqual(system.consumeDisplacements(), []);
  system.dispose();
});
