import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FpsProjectileSystem } from '../src/player/FpsProjectileSystem.js';
import { WaterInteractionSystem } from '../src/water/WaterInteractionSystem.js';
import { WaterSpatialModel } from '../src/water/WaterSpatialModel.js';

function createSystem(overrides = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 3, 0);
  camera.lookAt(0, 3, -1);
  camera.updateMatrixWorld(true);
  const waterSystem = {
    getSurfaceHeight: () => -10,
    traceProjectile: () => ({ hit: false }),
    addProjectileRipple: () => true,
  };
  const world = {
    sampleHeight: () => -100,
  };
  return new FpsProjectileSystem({
    scene,
    camera,
    world,
    waterSystem,
    settings: {
      fpsProjectilesEnabled: true,
      projectileSpeed: 70,
      projectileMass: 2.4,
      projectileFireRate: 5,
      ...overrides.settings,
    },
    capacity: overrides.capacity,
    lifetime: overrides.lifetime,
  });
}

test('fires only when FPS and pointer lock are active', () => {
  const system = createSystem();

  assert.equal(system.fire({ fpsEnabled: true, pointerLocked: false }), false);
  assert.equal(system.fire({ fpsEnabled: false, pointerLocked: true }), false);
  assert.equal(system.activeCount, 0);
  assert.equal(system.fire({ fpsEnabled: true, pointerLocked: true }), true);
  assert.equal(system.activeCount, 1);

  system.dispose();
});

test('projectile pool stays bounded and reuses expired slots', () => {
  const system = createSystem({
    capacity: 2,
    lifetime: 0.08,
    settings: { projectileFireRate: 20 },
  });

  assert.equal(system.fire({ fpsEnabled: true, pointerLocked: true }), true);
  system.update(0.12);
  assert.equal(system.activeCount, 0);
  assert.equal(system.fire({ fpsEnabled: true, pointerLocked: true }), true);

  assert.equal(system.createdProjectileCount, 2);
  assert.equal(system.activeCount, 1);
  system.dispose();
});

test('projectile update sends a swept segment to the water interaction API', () => {
  const system = createSystem();
  let trace = null;
  system.waterSystem.traceProjectile = (projectile) => {
    trace = projectile;
    return { hit: false };
  };

  system.fire({ fpsEnabled: true, pointerLocked: true });
  system.update(0.016);

  assert.ok(trace);
  assert.ok(trace.start.distanceTo(trace.end) > 0);
  assert.equal(trace.mass, 2.4);
  system.dispose();
});

test('disabled projectile setting blocks fire and clears active shots', () => {
  const system = createSystem();
  system.fire({ fpsEnabled: true, pointerLocked: true });
  system.applySettings({
    fpsProjectilesEnabled: false,
    projectileSpeed: 70,
    projectileMass: 2.4,
    projectileFireRate: 5,
  });

  assert.equal(system.activeCount, 0);
  assert.equal(system.fire({ fpsEnabled: true, pointerLocked: true }), false);
  system.dispose();
});

test('a real floating-sphere collision moves both bodies instead of deleting the shot', () => {
  const scene = new THREE.Scene();
  const spatialModel = new WaterSpatialModel({
    worldSize: 1200,
    waterLevel: 0,
    seed: 1337,
    sampleHeight: () => -30,
  });
  const interactions = new WaterInteractionSystem({
    scene,
    spatialModel,
    settings: {
      floatingSphereCount: 1,
      floatingSphereRadius: 3,
      waterObjectDensity: 0.58,
      floatingSpheresEnabled: true,
    },
  });
  const target = interactions.bodies[0];
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(target.position).add(new THREE.Vector3(0, 0, 18));
  camera.lookAt(target.position);
  camera.updateMatrixWorld(true);
  const system = new FpsProjectileSystem({
    scene,
    camera,
    world: { sampleHeight: () => -30 },
    waterSystem: {
      getSurfaceHeight: () => 0,
      traceProjectile: (projectile) => interactions.traceProjectile(projectile),
      addProjectileRipple: () => true,
    },
    settings: {
      fpsProjectilesEnabled: true,
      projectileSpeed: 70,
      projectileMass: 2.4,
      projectileFireRate: 5,
    },
  });

  system.fire({ fpsEnabled: true, pointerLocked: true });
  for (let index = 0; index < 30; index += 1) system.update(1 / 60);

  assert.equal(system.activeCount, 1);
  assert.ok(target.velocity.z < -0.1);
  assert.ok(system.projectiles[0].velocity.z > 0);

  system.dispose();
  interactions.dispose();
});
