import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_WATER_SETTINGS } from '../src/terrain/TerrainConfig.js';
import { sampleWaterSurface } from '../src/water/WaterInteractionSystem.js';

test('aquatic water defaults enable bounded professional demo content', () => {
  assert.equal(DEFAULT_WATER_SETTINGS.floatingSpheresEnabled, true);
  assert.ok(DEFAULT_WATER_SETTINGS.floatingSphereCount > 0);
  assert.ok(DEFAULT_WATER_SETTINGS.floatingSphereCount <= 24);
  assert.equal(DEFAULT_WATER_SETTINGS.aquaticLifeEnabled, true);
  assert.ok(DEFAULT_WATER_SETTINGS.fishCount <= 48);
  assert.ok(DEFAULT_WATER_SETTINGS.seagrassCount <= 180);
  assert.ok(DEFAULT_WATER_SETTINGS.coralCount <= 24);
  assert.equal(DEFAULT_WATER_SETTINGS.underwaterOpticsEnabled, true);
});

test('floating objects sample the same directional wave family as the water surface', () => {
  const first = sampleWaterSurface(20, -30, 4.5, 0.34, -3);
  const second = sampleWaterSurface(20, -30, 4.5, 0.34, -3);
  const later = sampleWaterSurface(20, -30, 5.5, 0.34, -3);

  assert.equal(first, second);
  assert.ok(Number.isFinite(first));
  assert.notEqual(first, later);
  assert.ok(Math.abs(first + 3) < 0.34);
});

test('editor exposes aquatic controls, a demo view, and FPS diving controls', async () => {
  const [uiSource, appSource, fpsSource] = await Promise.all([
    readFile(new URL('../src/ui/EditorUI.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/player/FpsPlayerController.js', import.meta.url), 'utf8'),
  ]);

  assert.match(uiSource, /water-floating-spheres/);
  assert.match(uiSource, /water-aquatic-life/);
  assert.match(uiSource, /water-underwater-optics/);
  assert.match(uiSource, /floating-demo-view/);
  assert.match(uiSource, /underwater-demo-view/);
  assert.match(appSource, /getFloatingDemoView/);
  assert.match(appSource, /getUnderwaterDemoView/);
  assert.match(fpsSource, /ControlLeft/);
  assert.match(fpsSource, /swimming/);
});
