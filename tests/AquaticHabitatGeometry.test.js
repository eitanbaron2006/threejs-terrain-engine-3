import test from 'node:test';
import assert from 'node:assert/strict';
import { createAquaticHabitatGeometryKit } from '../src/water/AquaticHabitatGeometry.js';

test('habitat geometry kit provides distinct natural shape families', () => {
  const kit = createAquaticHabitatGeometryKit();

  assert.ok(kit.plants.length >= 3);
  assert.ok(kit.corals.length >= 3);
  assert.ok(kit.sponges.length >= 2);
  assert.ok(kit.rocks.length >= 2);
  assert.notEqual(kit.corals[0].geometry.uuid, kit.corals[1].geometry.uuid);

  kit.dispose();
});

test('habitat geometry kit uses physically lit double-sided plant materials', () => {
  const kit = createAquaticHabitatGeometryKit();
  const plant = kit.plants[0];

  assert.equal(plant.material.isMeshStandardMaterial, true);
  assert.equal(plant.material.side, 2);
  assert.ok(plant.geometry.attributes.position.count > 4);
  assert.equal(typeof plant.material.onBeforeCompile, 'function');

  kit.update(3.5);
  assert.equal(kit.plantTimeUniform.value, 3.5);

  kit.dispose();
});

test('procedural coral and sponge morphologies are clustered organic meshes', () => {
  const kit = createAquaticHabitatGeometryKit();
  const massive = kit.corals.find((item) => item.id === 'massive-coral');
  const barrel = kit.sponges.find((item) => item.id === 'barrel-sponge');

  assert.ok(massive.geometry.attributes.position.count > 250);
  assert.ok(barrel.geometry.attributes.position.count > 300);
  assert.equal(massive.material.color.getHex(), 0xffffff);

  kit.dispose();
});
