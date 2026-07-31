import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultTerrainGraph } from '../src/terrain/TerrainGraphModel.js';
import { TerrainSerializer } from '../src/terrain/TerrainSerializer.js';

function createWorld() {
  return {
    presetId: 'mediterranean',
    generatorSettings: {},
    getModifiedStates: () => [],
    importModifiedStates: () => {},
  };
}

const config = {
  chunkSize: 256,
  sourceResolution: 257,
  lodLevels: [{ segments: 64, maxDistance: Infinity }],
};

test('project serialization round-trips a detached terrain graph', () => {
  const world = createWorld();
  const terrainGraph = createDefaultTerrainGraph({ seed: 81 });
  const project = TerrainSerializer.createProject({
    world,
    config,
    generatorSettings: {
      seed: 81,
      terrainProgram: { instructions: ['transient'] },
      materialProgram: { packId: 'transient-pack' },
    },
    streamingSettings: {},
    terrainGraph,
  });

  assert.deepEqual(project.terrainGraph, terrainGraph);
  assert.notEqual(project.terrainGraph, terrainGraph);
  assert.equal('terrainProgram' in project.generatorSettings, false);
  assert.equal('materialProgram' in project.generatorSettings, false);

  terrainGraph.nodes[0].position[0] = 9999;
  const result = TerrainSerializer.applyProject(project, { world, config });
  assert.notEqual(result.terrainGraph.nodes[0].position[0], 9999);
  assert.notEqual(result.terrainGraph, project.terrainGraph);
});

test('version 3 projects without a terrain graph remain loadable', () => {
  const world = createWorld();
  const project = TerrainSerializer.createProject({
    world,
    config,
    generatorSettings: { seed: 12 },
    streamingSettings: {},
  });
  delete project.terrainGraph;

  const result = TerrainSerializer.applyProject(project, { world, config });
  assert.equal(result.terrainGraph, null);
  assert.equal(result.generatorSettings.seed, 12);
});
