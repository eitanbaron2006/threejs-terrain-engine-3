import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WATER_SETTINGS } from '../src/terrain/TerrainConfig.js';

test('water defaults enable the high-quality ecosystem and FPS projectiles', () => {
  assert.equal(DEFAULT_WATER_SETTINGS.habitatQuality, 'high');
  assert.equal(DEFAULT_WATER_SETTINGS.habitatDensity, 1);
  assert.equal(DEFAULT_WATER_SETTINGS.fishSchoolDensity, 1);
  assert.equal(DEFAULT_WATER_SETTINGS.vegetationDensity, 1);
  assert.equal(DEFAULT_WATER_SETTINGS.fpsProjectilesEnabled, true);
  assert.ok(DEFAULT_WATER_SETTINGS.projectileSpeed >= 60);
  assert.ok(DEFAULT_WATER_SETTINGS.projectileMass >= 1);
  assert.ok(DEFAULT_WATER_SETTINGS.projectileFireRate > 0);
});
