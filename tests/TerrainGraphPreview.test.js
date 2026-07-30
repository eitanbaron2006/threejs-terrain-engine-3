import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTerrainPreviewPixels, TerrainGraphPreview } from '../src/terrain/TerrainGraphPreview.js';
import { createDefaultTerrainGraph } from '../src/terrain/TerrainGraphModel.js';

test('terrain preview renderer returns opaque shaded RGBA pixels', () => {
  const preview = renderTerrainPreviewPixels({
    width: 24,
    height: 16,
    worldSize: 8000,
    waterLevel: -3,
    sample: (x, z) => 75 - Math.hypot(x, z) * 0.04,
  });

  assert.equal(preview.pixels.length, 24 * 16 * 4);
  assert.ok(preview.minHeight < preview.maxHeight);
  assert.ok(preview.pixels.every((value, index) => index % 4 !== 3 || value === 255));
  assert.notDeepEqual(
    [...preview.pixels.slice(0, 4)],
    [...preview.pixels.slice((8 * 24 + 12) * 4, (8 * 24 + 12) * 4 + 4)],
  );
});

test('terrain preview distinguishes water from land', () => {
  const preview = renderTerrainPreviewPixels({
    width: 8,
    height: 8,
    worldSize: 100,
    waterLevel: 0,
    sample: (x) => x,
  });
  const left = [...preview.pixels.slice((4 * 8 + 1) * 4, (4 * 8 + 1) * 4 + 3)];
  const right = [...preview.pixels.slice((4 * 8 + 6) * 4, (4 * 8 + 6) * 4 + 3)];

  assert.ok(left[2] > left[0], 'water pixel should be blue-dominant');
  assert.ok(right[0] > right[2], 'land pixel should be warm-dominant');
});

test('disabling auto preview cancels pending work and clears the previous image', () => {
  const calls = [];
  const context = {
    clearRect: (...args) => calls.push(args),
  };
  const canvas = {
    width: 256,
    height: 256,
    dataset: {},
    getContext: () => context,
  };
  const statusElement = { textContent: '', dataset: {} };
  const preview = new TerrainGraphPreview({ canvas, statusElement });
  preview.timer = setTimeout(() => {}, 1000);
  const previousRevision = preview.revision;

  preview.setAuto(false);

  assert.equal(preview.auto, false);
  assert.equal(preview.timer, null);
  assert.equal(preview.revision, previousRevision + 1);
  assert.deepEqual(calls, [[0, 0, 256, 256]]);
  assert.equal(canvas.dataset.previewEnabled, 'false');
  assert.equal(statusElement.textContent, 'Preview paused');
  preview.dispose();
});

test('disabled auto preview also rejects immediate render requests', () => {
  const canvas = {
    width: 256,
    height: 256,
    dataset: {},
    getContext: () => ({ clearRect() {} }),
  };
  const statusElement = { textContent: '', dataset: {} };
  const preview = new TerrainGraphPreview({ canvas, statusElement });
  preview.setAuto(false);
  const pausedRevision = preview.revision;

  preview.request(createDefaultTerrainGraph(), {}, { immediate: true });

  assert.equal(preview.revision, pausedRevision);
  assert.equal(statusElement.textContent, 'Preview paused');
  preview.dispose();
});
