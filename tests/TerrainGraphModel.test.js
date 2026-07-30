import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TERRAIN_NODE_DEFINITIONS,
  addTerrainGraphNode,
  connectTerrainGraphNodes,
  createDefaultTerrainGraph,
  deriveSettingsFromTerrainGraph,
  removeTerrainGraphNode,
  syncSettingsToTerrainGraph,
  validateTerrainGraph,
} from '../src/terrain/TerrainGraphModel.js';

test('default terrain graph has one valid terrain output', () => {
  const graph = createDefaultTerrainGraph({ seed: 42 });
  const outputs = graph.nodes.filter((node) => node.type === 'terrain/output');

  assert.equal(outputs.length, 1);
  assert.deepEqual(validateTerrainGraph(graph), { valid: true, errors: [] });
});

test('typed graph connections accept matching sockets and reject mismatches', () => {
  let graph = createDefaultTerrainGraph();
  const coordinateResult = addTerrainGraphNode(graph, 'world/coordinates', [100, 100]);
  graph = coordinateResult.graph;
  const noiseResult = addTerrainGraphNode(graph, 'noise/fbm', [350, 100]);
  graph = noiseResult.graph;

  graph = connectTerrainGraphNodes(graph, {
    fromNode: coordinateResult.node.id,
    fromSocket: 'coordinate',
    toNode: noiseResult.node.id,
    toSocket: 'coordinate',
  }).graph;
  assert.ok(graph.links.some((link) => link.toNode === noiseResult.node.id));

  assert.throws(() => connectTerrainGraphNodes(graph, {
    fromNode: noiseResult.node.id,
    fromSocket: 'field',
    toNode: noiseResult.node.id,
    toSocket: 'coordinate',
  }), /socket types/i);
});

test('graph rejects cycles and more than one link per input socket', () => {
  let graph = createDefaultTerrainGraph();
  const first = addTerrainGraphNode(graph, 'combine/add', [0, 0]);
  graph = first.graph;
  const second = addTerrainGraphNode(graph, 'combine/add', [200, 0]);
  graph = second.graph;

  graph = connectTerrainGraphNodes(graph, {
    fromNode: first.node.id,
    fromSocket: 'field',
    toNode: second.node.id,
    toSocket: 'a',
  }).graph;

  assert.throws(() => connectTerrainGraphNodes(graph, {
    fromNode: first.node.id,
    fromSocket: 'field',
    toNode: second.node.id,
    toSocket: 'a',
  }), /already connected/i);

  assert.throws(() => connectTerrainGraphNodes(graph, {
    fromNode: second.node.id,
    fromSocket: 'field',
    toNode: first.node.id,
    toSocket: 'a',
  }), /cycle/i);
});

test('generator settings synchronize to semantic graph nodes and derive back', () => {
  const initial = createDefaultTerrainGraph();
  const graph = syncSettingsToTerrainGraph(initial, {
    seed: 991,
    frequency: 0.0025,
    amplitude: 113,
    ridgeStrength: 0.73,
    terraceStrength: 0.25,
    continentalScale: 0.0006,
    continentalStrength: 48,
    baseHeight: 11,
    warpStrength: 130,
  });
  const derived = deriveSettingsFromTerrainGraph(graph, {});

  assert.equal(derived.seed, 991);
  assert.equal(derived.frequency, 0.0025);
  assert.equal(derived.amplitude, 113);
  assert.equal(derived.ridgeStrength, 0.73);
  assert.equal(derived.terraceStrength, 0.25);
  assert.equal(derived.continentalScale, 0.0006);
  assert.equal(derived.continentalStrength, 48);
  assert.equal(derived.baseHeight, 11);
  assert.equal(derived.warpStrength, 130);
});

test('derived graph settings never restore a stale compiled terrain program', () => {
  const staleProgram = { version: 1, instructions: [{ op: 'islandCoast', properties: { amplitude: 82 } }] };
  const graph = createDefaultTerrainGraph({ amplitude: 160 });
  const derived = deriveSettingsFromTerrainGraph(graph, {
    amplitude: 82,
    terrainProgram: staleProgram,
  });

  assert.equal(derived.amplitude, 160);
  assert.equal(Object.hasOwn(derived, 'terrainProgram'), false);
});

test('removing a node also removes all of its links', () => {
  const graph = createDefaultTerrainGraph();
  const target = graph.nodes.find((node) => node.role === 'broad');
  const next = removeTerrainGraphNode(graph, target.id);

  assert.equal(next.nodes.some((node) => node.id === target.id), false);
  assert.equal(next.links.some((link) => link.fromNode === target.id || link.toNode === target.id), false);
});

test('unused nodes may remain disconnected without blocking a terrain build', () => {
  const graph = createDefaultTerrainGraph();
  const withUnusedNode = addTerrainGraphNode(graph, 'noise/fbm', [2000, 500]).graph;

  assert.deepEqual(validateTerrainGraph(withUnusedNode), { valid: true, errors: [] });
});

test('catalog exposes every node required by the first terrain pipeline', () => {
  assert.deepEqual(Object.keys(TERRAIN_NODE_DEFINITIONS).sort(), [
    'combine/add',
    'combine/blend',
    'combine/multiply',
    'input/constant',
    'noise/continental',
    'noise/fbm',
    'noise/ridged',
    'shape/islandCoast',
    'terrain/output',
    'transform/clamp',
    'transform/domainWarp',
    'transform/remap',
    'transform/terrace',
    'world/coordinates',
  ]);
});
