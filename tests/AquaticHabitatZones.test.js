import test from 'node:test';
import assert from 'node:assert/strict';
import { createAquaticHabitatLayout } from '../src/water/AquaticHabitatLayout.js';
import { WaterSpatialModel } from '../src/water/WaterSpatialModel.js';

function createModel(seed = 1337) {
  return new WaterSpatialModel({
    worldSize: 1800,
    waterLevel: 3,
    seed,
    sampleHeight: (x, z) => -18 + Math.sin(x * 0.008) * 5 + Math.cos(z * 0.011) * 3,
  });
}

test('aquatic zones are deterministic and expose a dense demo habitat', () => {
  const first = createAquaticHabitatLayout(createModel(), { habitatDensity: 1 });
  const second = createAquaticHabitatLayout(createModel(), { habitatDensity: 1 });

  assert.deepEqual(first.zones, second.zones);
  assert.ok(first.zones.length >= 6);
  assert.ok(first.demoZone);
  assert.ok(first.demoZone.fishTarget >= 36);
  assert.ok(first.demoZone.vegetationTarget >= 180);
  assert.notEqual(first.demoZone.habitatClass, 'deep-school');
});

test('aquatic zone density scales habitat count without invalid depths', () => {
  const sparse = createAquaticHabitatLayout(createModel(71), { habitatDensity: 0.5 });
  const dense = createAquaticHabitatLayout(createModel(71), { habitatDensity: 1.5 });

  assert.ok(dense.zones.length > sparse.zones.length);
  for (const zone of dense.zones) {
    assert.ok(zone.depth >= 5);
    assert.ok(zone.floorY < 3);
    assert.ok(['reef', 'grass-bed', 'deep-school'].includes(zone.habitatClass));
  }
});

test('aquatic zones degrade cleanly when the world has no water', () => {
  const dry = new WaterSpatialModel({
    worldSize: 500,
    waterLevel: 0,
    seed: 8,
    sampleHeight: () => 12,
  });
  const layout = createAquaticHabitatLayout(dry, { habitatDensity: 1 });

  assert.deepEqual(layout.zones, []);
  assert.equal(layout.demoZone, null);
});

test('large worlds receive streamable habitat coverage instead of a handful of isolated zones', () => {
  const ocean = new WaterSpatialModel({
    worldSize: 8000,
    waterLevel: 0,
    seed: 1337,
    sampleHeight: () => -24,
  });
  const layout = createAquaticHabitatLayout(ocean, { habitatDensity: 1 });

  assert.ok(layout.zones.length >= 900);
  const centerDistance = Math.min(...layout.zones.map((zone) => Math.hypot(zone.x, zone.z)));
  assert.ok(centerDistance < 180);
});
