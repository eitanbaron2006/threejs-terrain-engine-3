import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('FPS controller fires physical projectiles only from primary pointer input', async () => {
  const source = await readFile(
    new URL('../src/player/FpsPlayerController.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /projectileSystem/);
  assert.match(source, /event\.button !== 0/);
  assert.match(source, /pointerLocked:\s*true/);
  assert.match(source, /projectileSystem\?\.fire/);
});

test('terrain app constructs, updates, configures and disposes FPS projectiles', async () => {
  const source = await readFile(
    new URL('../src/app/TerrainEditorApp.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /new FpsProjectileSystem/);
  assert.match(source, /this\.projectileSystem\.update\(delta\)/);
  assert.match(source, /this\.projectileSystem\.applySettings/);
  assert.match(source, /resetFloatingObjects/);
  assert.match(source, /this\.projectileSystem\?\.dispose/);
});

test('water panel exposes ecosystem quality and projectile controls', async () => {
  const source = await readFile(
    new URL('../src/ui/EditorUI.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /water-habitat-quality/);
  assert.match(source, /water-habitat-density/);
  assert.match(source, /water-fish-school-density/);
  assert.match(source, /water-vegetation-density/);
  assert.match(source, /water-fps-projectiles/);
  assert.match(source, /water-projectile-speed/);
  assert.match(source, /water-projectile-mass/);
  assert.match(source, /reset-floating-objects/);
});
