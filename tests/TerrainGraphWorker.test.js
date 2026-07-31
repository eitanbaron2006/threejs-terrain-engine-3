import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTerrainPipeline } from '../src/terrain/TerrainGraphCompiler.js';
import { createDefaultTerrainGraph } from '../src/terrain/TerrainGraphModel.js';
import { BUILTIN_TERRAIN_MATERIAL_PACKS } from '../src/terrain/TerrainMaterialPacks.js';
import { handleTerrainGraphPreviewMessage } from '../src/workers/terrainGraphWorker.js';

const packCatalog = Object.values(BUILTIN_TERRAIN_MATERIAL_PACKS);
const materialLayers = ['#d8bf86', '#60834f', '#736b61', '#665249'];

test('preview worker recolors cached terrain data without rebuilding the sample', () => {
  const graph = createDefaultTerrainGraph({ seed: 91 });
  const pipeline = compileTerrainPipeline(graph, { packCatalog });
  const cache = { revision: -1, data: null };
  const baseMessage = {
    revision: 7,
    width: 12,
    height: 10,
    worldSize: 8000,
    waterLevel: 0,
    settings: { seed: 91 },
    terrainProgram: pipeline.terrainProgram,
    materialProgram: pipeline.materialProgram,
    materialLayers,
  };

  const heightResult = handleTerrainGraphPreviewMessage({
    ...baseMessage,
    type: 'render',
    mode: 'height',
  }, cache);
  const sampledData = cache.data;
  const materialResult = handleTerrainGraphPreviewMessage({
    ...baseMessage,
    type: 'recolor',
    mode: 'materials',
  }, cache);

  assert.equal(cache.data, sampledData);
  assert.equal(heightResult.mode, 'height');
  assert.equal(materialResult.mode, 'materials');
  assert.notDeepEqual(
    new Uint8ClampedArray(heightResult.pixels),
    new Uint8ClampedArray(materialResult.pixels),
  );
});

test('preview worker ignores recolor requests for stale revisions', () => {
  const cache = { revision: 4, data: { width: 1, height: 1 } };
  const result = handleTerrainGraphPreviewMessage({
    type: 'recolor',
    revision: 3,
    mode: 'slope',
  }, cache);

  assert.equal(result, null);
});
