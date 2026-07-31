import test from 'node:test';
import assert from 'node:assert/strict';
import {
  colorizeTerrainPreview,
  renderTerrainPreviewPixels,
  sampleTerrainPreviewData,
  TerrainGraphPreview,
} from '../src/terrain/TerrainGraphPreview.js';
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
  assert.ok(Math.max(...right) - Math.min(...right) < 24, 'height land should use a neutral ramp');
});

test('preview sampling caches physical signals and material weights once', () => {
  let samples = 0;
  const cache = sampleTerrainPreviewData({
    width: 16,
    height: 12,
    worldSize: 1000,
    waterLevel: 0,
    seed: 42,
    materialSelector: 'mediterranean',
    sample: (x, z) => {
      samples += 1;
      return 40 - Math.hypot(x, z) * 0.08;
    },
  });
  const sampled = samples;

  colorizeTerrainPreview(cache, 'height');
  colorizeTerrainPreview(cache, 'materials');
  colorizeTerrainPreview(cache, 'slope');
  colorizeTerrainPreview(cache, 'moisture');
  colorizeTerrainPreview(cache, 'erosion');

  assert.equal(samples, sampled);
  assert.equal(cache.heights.length, 16 * 12);
  assert.equal(cache.materialWeights.length, 16 * 12 * 4);
  assert.equal(cache.slope.length, 16 * 12);
  assert.equal(cache.moisture.length, 16 * 12);
  assert.equal(cache.erosion.length, 16 * 12);
});

for (const mode of ['height', 'materials', 'slope', 'moisture', 'erosion']) {
  test(`${mode} preview returns opaque pixels, stats and a useful legend`, () => {
    const cache = sampleTerrainPreviewData({
      width: 12,
      height: 10,
      worldSize: 800,
      waterLevel: -3,
      seed: 1337,
      materialSelector: 'mediterranean',
      sample: (x, z) => 35 - Math.hypot(x, z) * 0.06,
    });
    const result = colorizeTerrainPreview(cache, mode, [
      { id: 'sand', label: 'Beach Sand', color: [194, 169, 113] },
      { id: 'grass', label: 'Grass', color: [73, 110, 64] },
      { id: 'soil', label: 'Soil', color: [109, 78, 53] },
      { id: 'rock', label: 'Rock', color: [116, 119, 122] },
    ]);

    assert.equal(result.mode, mode);
    assert.equal(result.pixels.length, 12 * 10 * 4);
    assert.ok(result.pixels.every((value, index) => index % 4 !== 3 || value === 255));
    assert.ok(result.legend.length >= 2);
    assert.ok(Number.isFinite(result.minHeight));
    assert.ok(Number.isFinite(result.maxHeight));
  });
}

test('materials preview mixes the exact four cached channel weights', () => {
  const cache = {
    width: 1,
    height: 1,
    waterLevel: -3,
    minHeight: 10,
    maxHeight: 10,
    heights: new Float32Array([10]),
    slope: new Float32Array([0]),
    slopeDegrees: new Float32Array([0]),
    moisture: new Float32Array([0]),
    erosion: new Float32Array([0]),
    lighting: new Float32Array([1]),
    materialWeights: new Float32Array([0.5, 0.25, 0.25, 0]),
  };
  const result = colorizeTerrainPreview(cache, 'materials', [
    { id: 'sand', label: 'Sand', color: [200, 100, 0] },
    { id: 'grass', label: 'Grass', color: [0, 200, 100] },
    { id: 'soil', label: 'Soil', color: [100, 0, 200] },
    { id: 'rock', label: 'Rock', color: [255, 255, 255] },
  ]);

  assert.deepEqual([...result.pixels.slice(0, 3)], [125, 100, 75]);
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
