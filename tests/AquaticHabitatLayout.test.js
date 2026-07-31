import test from 'node:test';
import assert from 'node:assert/strict';
import { createAquaticHabitatLayout } from '../src/water/AquaticHabitatLayout.js';
import { WaterSpatialModel } from '../src/water/WaterSpatialModel.js';

function createModel(seed = 1337) {
  return new WaterSpatialModel({
    worldSize: 1200,
    waterLevel: 4,
    seed,
    sampleHeight: (x, z) => -14 + Math.sin(x * 0.012) * 4 + Math.cos(z * 0.009) * 3,
  });
}

test('aquatic habitat layout is deterministic and respects depth constraints', () => {
  const options = {
    fishSchoolCount: 3,
    grassPatchCount: 8,
    coralClusterCount: 5,
  };
  const first = createAquaticHabitatLayout(createModel(), options);
  const second = createAquaticHabitatLayout(createModel(), options);

  assert.deepEqual(first, second);
  assert.equal(first.fishSchools.length, options.fishSchoolCount);
  assert.equal(first.grassPatches.length, options.grassPatchCount);
  assert.equal(first.coralClusters.length, options.coralClusterCount);

  for (const school of first.fishSchools) {
    assert.ok(school.y > school.floorY + 1);
    assert.ok(school.y < 4 - 1);
  }
  for (const item of [...first.grassPatches, ...first.coralClusters]) {
    assert.equal(item.y, item.floorY);
    assert.ok(item.depth >= 6);
  }
});

test('aquatic habitat layout degrades cleanly when the world has no water', () => {
  const model = new WaterSpatialModel({
    worldSize: 100,
    waterLevel: 0,
    sampleHeight: () => 10,
  });
  const layout = createAquaticHabitatLayout(model);

  assert.deepEqual(layout.fishSchools, []);
  assert.deepEqual(layout.grassPatches, []);
  assert.deepEqual(layout.coralClusters, []);
  assert.equal(layout.demoView, null);
});

test('aquatic habitat layout exposes a submerged demo view near visible habitat', () => {
  const model = createModel(27);
  const layout = createAquaticHabitatLayout(model, {
    fishSchoolCount: 2,
    grassPatchCount: 4,
    coralClusterCount: 3,
  });

  assert.ok(layout.demoView);
  assert.ok(model.isUnderwater(
    layout.demoView.position.x,
    layout.demoView.position.y,
    layout.demoView.position.z,
    0.5,
  ));
  assert.ok(layout.demoView.target.y < model.waterLevel);
});
