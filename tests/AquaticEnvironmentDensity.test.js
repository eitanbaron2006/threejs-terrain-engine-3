import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AquaticEnvironment } from '../src/water/AquaticEnvironment.js';
import { WaterSpatialModel } from '../src/water/WaterSpatialModel.js';

function createEnvironment(overrides = {}) {
  const scene = new THREE.Scene();
  const spatialModel = new WaterSpatialModel({
    worldSize: 1800,
    waterLevel: 3,
    seed: 1337,
    sampleHeight: (x, z) => -18 + Math.sin(x * 0.008) * 4 + Math.cos(z * 0.01) * 3,
  });
  return new AquaticEnvironment({
    scene,
    spatialModel,
    settings: {
      aquaticLifeEnabled: true,
      habitatDensity: 1,
      fishSchoolDensity: 1,
      vegetationDensity: 1,
      habitatQuality: 'high',
      fishEnabled: true,
      plantsEnabled: true,
      coralsEnabled: true,
      spongesEnabled: true,
      rocksEnabled: true,
      fishCount: 30,
      seagrassCount: 120,
      coralCount: 18,
      spongeCount: 12,
      underwaterRockCount: 24,
      ...overrides,
    },
    loadAsset: async () => null,
  });
}

test('aquatic environment starts with a dense active demo habitat', () => {
  const environment = createEnvironment();
  const diagnostics = environment.getDiagnostics();

  assert.ok(diagnostics.activeHabitats >= 1);
  assert.ok(diagnostics.fish >= 36);
  assert.ok(diagnostics.vegetation >= 180);
  assert.ok(diagnostics.coralMorphologies >= 3);

  environment.dispose();
});

test('zero model amounts remove fish and every seabed model family', () => {
  const environment = createEnvironment({
    fishCount: 0,
    seagrassCount: 0,
    coralCount: 0,
    spongeCount: 0,
    underwaterRockCount: 0,
  });

  assert.equal(environment.getDiagnostics().fish, 0);
  assert.equal(environment.getDiagnostics().vegetation, 0);
  assert.equal(environment.batchMeshes.some((mesh) => mesh.name.startsWith('AquaticHabitat:')), false);
  environment.dispose();
});

test('per-family visibility removes only the disabled aquatic model families', () => {
  const environment = createEnvironment({
    fishEnabled: false,
    plantsEnabled: false,
    coralsEnabled: false,
    spongesEnabled: true,
    rocksEnabled: true,
  });
  const habitatNames = environment.batchMeshes.map((mesh) => mesh.name);

  assert.equal(environment.getDiagnostics().fish, 0);
  assert.equal(habitatNames.some((name) => /grass|kelp/.test(name)), false);
  assert.equal(habitatNames.some((name) => name.includes('coral')), false);
  assert.equal(habitatNames.some((name) => name.includes('sponge')), true);
  assert.equal(habitatNames.some((name) => name.includes('rock')), true);
  environment.dispose();
});

test('aquatic demo view keeps its habitat active', () => {
  const environment = createEnvironment();
  const view = environment.getDemoView();

  assert.ok(view);
  assert.ok(environment.getDiagnostics().activeHabitats >= 1);

  environment.dispose();
});

test('rebuilding for a dry world clears stale fish and vegetation batches', () => {
  const environment = createEnvironment();
  const dryModel = new WaterSpatialModel({
    worldSize: 1800,
    waterLevel: 0,
    seed: 42,
    sampleHeight: () => 20,
  });

  environment.rebuild(dryModel, environment.settings);
  environment.update(1 / 60, { x: 0, z: 0 });

  assert.equal(environment.getDiagnostics().fish, 0);
  assert.equal(environment.getDiagnostics().vegetation, 0);
  environment.dispose();
});

test('underwater habitat instances do not receive opaque terrain shadow maps', () => {
  const environment = createEnvironment();
  const habitatMeshes = environment.batchMeshes.filter((mesh) => mesh.name.startsWith('AquaticHabitat:'));

  assert.ok(habitatMeshes.length > 0);
  assert.ok(habitatMeshes.every((mesh) => mesh.castShadow === false));
  assert.ok(habitatMeshes.every((mesh) => mesh.receiveShadow === false));
  environment.dispose();
});

test('school fish use diffuse underwater lighting instead of metallic HDRI shading', () => {
  const environment = createEnvironment();
  const fish = environment.batchMeshes.find((mesh) => mesh.name === 'AquaticSchoolFishBodies');

  assert.ok(fish);
  assert.equal(fish.geometry.attributes.color, undefined);
  assert.equal(fish.material.vertexColors, false);
  assert.equal(fish.material.metalness, 0);
  assert.ok(fish.material.roughness >= 0.68);
  assert.ok(fish.material.envMapIntensity <= 0.15);
  assert.equal(typeof fish.material.onBeforeCompile, 'function');
  environment.dispose();
});
