import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainMaterialPackManager } from '../src/terrain/TerrainMaterialPackManager.js';

function createHarness({ builder } = {}) {
  const calls = [];
  const materialLibrary = {
    renderer: { capabilities: { maxTextureSize: 4096 } },
    getSettings: () => ({ qualityTier: 'high' }),
    applyImportedMaterialArrays(payload) {
      calls.push(['arrays', payload]);
      return { actualResolution: payload.resolution };
    },
    applyMaterialPackLayerSettings(layers) {
      calls.push(['layers', layers]);
      return { qualityTier: 'high' };
    },
  };
  const world = {
    applyMaterialPackDistribution(pack, materialProgram) {
      calls.push(['world', pack.id, materialProgram]);
    },
  };
  const manager = new TerrainMaterialPackManager({
    materialLibrary,
    world,
    packBuilders: {
      polyhaven: builder ?? (async () => ({
        arrays: {
          baseColor: new Uint8Array(16),
          normal: new Uint8Array(16),
          orm: new Uint8Array(16),
          height: new Uint8Array(16),
        },
        resolution: 1,
        sourceLabel: '1k',
        sources: [],
        warnings: [],
      })),
    },
  });
  return { manager, calls };
}

test('preparePack caches decoded provider assets without applying world state', async () => {
  let builds = 0;
  const { manager, calls } = createHarness({
    builder: async () => {
      builds += 1;
      return {
        arrays: {
          baseColor: new Uint8Array(16),
          normal: new Uint8Array(16),
          orm: new Uint8Array(16),
          height: new Uint8Array(16),
        },
        resolution: 1,
        sourceLabel: '1k',
        sources: [],
        warnings: [],
      };
    },
  });

  const first = await manager.preparePack('mediterranean');
  const second = await manager.preparePack('mediterranean');

  assert.equal(builds, 1);
  assert.equal(first, second);
  assert.deepEqual(calls, []);
  assert.equal(manager.activePackId, 'mediterranean');
});

test('failed preparation removes the rejected cache entry and preserves active state', async () => {
  let attempts = 0;
  const { manager, calls } = createHarness({
    builder: async () => {
      attempts += 1;
      throw new Error('provider offline');
    },
  });
  manager.activePackId = 'alpine';

  await assert.rejects(manager.preparePack('mediterranean'), /provider offline/);
  await assert.rejects(manager.preparePack('mediterranean'), /provider offline/);

  assert.equal(attempts, 2);
  assert.equal(manager.activePackId, 'alpine');
  assert.deepEqual(calls, []);
});

test('commitPreparedPack applies textures, layer settings and graph material program together', async () => {
  const { manager, calls } = createHarness();
  const prepared = await manager.preparePack('mediterranean');
  const materialProgram = {
    version: 1,
    packId: 'mediterranean',
    splatPreset: 'mediterranean',
    globalBlend: 1,
    transitionNoise: 0.2,
    masks: [],
    distributionRules: [],
    biomeBlends: [],
  };

  const result = manager.commitPreparedPack(prepared, { materialProgram });

  assert.equal(manager.activePackId, 'mediterranean');
  assert.equal(result.pack.id, 'mediterranean');
  assert.deepEqual(calls.map(([type]) => type), ['arrays', 'layers', 'world']);
  assert.equal(calls[2][2], materialProgram);
});
