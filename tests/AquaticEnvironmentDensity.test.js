import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AquaticEnvironment } from '../src/water/AquaticEnvironment.js';
import { WaterSpatialModel } from '../src/water/WaterSpatialModel.js';

function createEnvironment() {
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
