import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TERRAIN_GRAPH_VERSION,
  TERRAIN_NODE_DEFINITIONS,
  addTerrainGraphNode,
  connectTerrainGraphNodes,
  createDefaultTerrainGraph,
  deriveAquaticSettingsFromTerrainGraph,
  deriveSettingsFromTerrainGraph,
  normalizeTerrainGraph,
  removeTerrainGraphNode,
  syncSettingsToTerrainGraph,
  syncAquaticSettingsToTerrainGraph,
  validateTerrainGraph,
} from '../src/terrain/TerrainGraphModel.js';

const AQUATIC_NODE_PROPERTIES = [
  'enabled',
  'quality',
  'habitatDensity',
  'floatingSpheresEnabled',
  'floatingSphereCount',
  'floatingSphereRadius',
  'waterObjectDensity',
  'fishEnabled',
  'fishCount',
  'fishSchoolDensity',
  'plantsEnabled',
  'seagrassCount',
  'coralsEnabled',
  'coralCount',
  'spongesEnabled',
  'spongeCount',
  'rocksEnabled',
  'underwaterRockCount',
  'vegetationDensity',
];

const MATERIAL_NODE_TYPES = [
  'material/pack',
  'material/layerDistribution',
  'mask/heightSlope',
  'mask/moistureErosion',
  'material/biomeBlend',
  'terrain/materialOutput',
];

function createLegacyVersionOneGraph() {
  const graph = createDefaultTerrainGraph({ seed: 42 });
  const materialOutput = graph.nodes.find((node) => node.type === 'terrain/materialOutput');
  const legacyOutput = materialOutput
    ? {
      ...materialOutput,
      type: 'terrain/output',
      properties: {},
    }
    : graph.nodes.find((node) => node.type === 'terrain/output');
  const materialNodeIds = new Set(
    graph.nodes
      .filter((node) => MATERIAL_NODE_TYPES.includes(node.type))
      .map((node) => node.id),
  );
  if (materialOutput) materialNodeIds.delete(materialOutput.id);

  return {
    ...graph,
    version: 1,
    nodes: [
      ...graph.nodes.filter((node) => (
        !materialNodeIds.has(node.id)
        && node.id !== materialOutput?.id
        && node.type !== 'terrain/output'
      )),
      legacyOutput,
    ],
    links: graph.links.filter((link) => (
      !materialNodeIds.has(link.fromNode)
      && !materialNodeIds.has(link.toNode)
      && link.toSocket !== 'material'
    )),
  };
}

test('version 2 default graph has one valid Material Output terminal', () => {
  const graph = createDefaultTerrainGraph({ seed: 42 });
  const materialOutputs = graph.nodes.filter((node) => node.type === 'terrain/materialOutput');
  const legacyOutputs = graph.nodes.filter((node) => node.type === 'terrain/output');
  const pack = graph.nodes.find((node) => node.type === 'material/pack');
  const output = materialOutputs[0];

  assert.equal(TERRAIN_GRAPH_VERSION, 2);
  assert.equal(graph.version, 2);
  assert.equal(materialOutputs.length, 1);
  assert.equal(legacyOutputs.length, 0);
  assert.ok(graph.links.some((link) => (
    link.fromNode === pack.id
    && link.fromSocket === 'material'
    && link.toNode === output.id
    && link.toSocket === 'material'
  )));
  assert.deepEqual(validateTerrainGraph(graph), { valid: true, errors: [] });
});

test('default Material Pack uses an explicit project pack id or mediterranean', () => {
  const fromMaterialPack = createDefaultTerrainGraph({ materialPackId: 'alpine' });
  const fromPreset = createDefaultTerrainGraph({ presetId: 'volcanic' });
  const fallback = createDefaultTerrainGraph({ materialPackId: 17, presetId: null });
  const packId = (graph) => graph.nodes.find((node) => node.type === 'material/pack').properties.packId;

  assert.equal(packId(fromMaterialPack), 'alpine');
  assert.equal(packId(fromPreset), 'volcanic');
  assert.equal(packId(fallback), 'mediterranean');
});

test('default graph exposes one complete Aquatic Ecosystem control node', () => {
  const graph = createDefaultTerrainGraph();
  const nodes = graph.nodes.filter((node) => node.type === 'water/aquaticEcosystem');
  const definition = TERRAIN_NODE_DEFINITIONS['water/aquaticEcosystem'];

  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].role, 'aquaticEcosystem');
  assert.deepEqual(Object.keys(definition.properties), AQUATIC_NODE_PROPERTIES);
  assert.deepEqual(Object.keys(nodes[0].properties), AQUATIC_NODE_PROPERTIES);
  assert.deepEqual(definition.inputs, []);
  assert.deepEqual(definition.outputs, []);
  assert.deepEqual(validateTerrainGraph(graph), { valid: true, errors: [] });
});

test('aquatic ecosystem settings synchronize to the graph and derive back', () => {
  const initial = createDefaultTerrainGraph();
  const graph = syncAquaticSettingsToTerrainGraph(initial, {
    aquaticLifeEnabled: false,
    habitatQuality: 'medium',
    habitatDensity: 1.35,
    floatingSpheresEnabled: false,
    floatingSphereCount: 7,
    floatingSphereRadius: 2.4,
    waterObjectDensity: 0.72,
    fishEnabled: false,
    fishCount: 64,
    fishSchoolDensity: 1.4,
    plantsEnabled: true,
    seagrassCount: 180,
    coralsEnabled: false,
    coralCount: 9,
    spongesEnabled: true,
    spongeCount: 16,
    rocksEnabled: false,
    underwaterRockCount: 22,
    vegetationDensity: 1.25,
  });
  const derived = deriveAquaticSettingsFromTerrainGraph(graph, {});

  assert.deepEqual(derived, {
    aquaticLifeEnabled: false,
    habitatQuality: 'medium',
    habitatDensity: 1.35,
    floatingSpheresEnabled: false,
    floatingSphereCount: 7,
    floatingSphereRadius: 2.4,
    waterObjectDensity: 0.72,
    fishEnabled: false,
    fishCount: 64,
    fishSchoolDensity: 1.4,
    plantsEnabled: true,
    seagrassCount: 180,
    coralsEnabled: false,
    coralCount: 9,
    spongesEnabled: true,
    spongeCount: 16,
    rocksEnabled: false,
    underwaterRockCount: 22,
    vegetationDensity: 1.25,
  });
});

test('material and mask node schemas expose complete typed UI metadata', () => {
  const expectedProperties = {
    'material/pack': ['packId', 'globalBlend', 'transitionNoise'],
    'material/layerDistribution': [
      'layer',
      'minHeight',
      'maxHeight',
      'heightBlend',
      'minSlope',
      'maxSlope',
      'slopeBlend',
      'moistureAffinity',
      'coastAffinity',
      'erosionAffinity',
      'curvatureBias',
      'priority',
    ],
    'mask/heightSlope': [
      'minHeight',
      'maxHeight',
      'heightBlend',
      'minSlope',
      'maxSlope',
      'slopeBlend',
      'invert',
    ],
    'mask/moistureErosion': [
      'minMoisture',
      'maxMoisture',
      'moistureBlend',
      'minErosion',
      'maxErosion',
      'erosionBlend',
      'invert',
    ],
    'material/biomeBlend': ['fromLayer', 'toLayer', 'strength'],
    'terrain/materialOutput': [],
  };

  for (const [type, propertyNames] of Object.entries(expectedProperties)) {
    const definition = TERRAIN_NODE_DEFINITIONS[type];
    assert.ok(definition, `missing definition for ${type}`);
    assert.deepEqual(Object.keys(definition.properties), propertyNames);
    assert.deepEqual(Object.keys(definition.defaults), propertyNames);
    for (const [name, descriptor] of Object.entries(definition.properties)) {
      assert.equal(typeof descriptor.label, 'string', `${type}.${name} requires a label`);
      assert.ok(['combo', 'toggle', 'number'].includes(descriptor.widget));
      assert.ok(Object.hasOwn(descriptor, 'default'), `${type}.${name} requires a default`);
      if (descriptor.widget === 'number') {
        assert.equal(typeof descriptor.min, 'number', `${type}.${name} requires min`);
        assert.equal(typeof descriptor.max, 'number', `${type}.${name} requires max`);
        assert.equal(typeof descriptor.step, 'number', `${type}.${name} requires step`);
      }
      if (descriptor.widget === 'combo') {
        assert.ok(
          Array.isArray(descriptor.options) || typeof descriptor.optionsSource === 'string',
          `${type}.${name} requires options or optionsSource`,
        );
      }
    }
  }

  assert.deepEqual(
    TERRAIN_NODE_DEFINITIONS['material/pack'].outputs,
    [{ name: 'material', label: 'Material', type: 'material' }],
  );
  assert.equal(
    TERRAIN_NODE_DEFINITIONS['mask/heightSlope'].outputs[0].type,
    'mask',
  );
  assert.deepEqual(
    TERRAIN_NODE_DEFINITIONS['terrain/materialOutput'].inputs.map((input) => input.type),
    ['terrain', 'material'],
  );
  assert.equal(
    TERRAIN_NODE_DEFINITIONS['material/pack'].properties.packId.optionsSource,
    'materialPacks',
  );
  assert.deepEqual(
    TERRAIN_NODE_DEFINITIONS['material/layerDistribution'].properties.layer.options,
    ['sand', 'grass', 'soil', 'rock'],
  );
});

test('version 1 migration preserves every legacy height node and link', () => {
  const legacy = createLegacyVersionOneGraph();
  const originalNodes = structuredClone(legacy.nodes);
  const originalLinks = structuredClone(legacy.links);
  const normalized = normalizeTerrainGraph(legacy, { materialPackId: 'alpine' });

  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.nodes, originalNodes);
  assert.deepEqual(normalized.links, originalLinks);
  assert.equal(normalized.nodes.filter((node) => node.type === 'terrain/output').length, 1);
  assert.equal(normalized.nodes.some((node) => node.type === 'terrain/materialOutput'), false);
  assert.notEqual(normalized, legacy);
  assert.notEqual(normalized.nodes, legacy.nodes);
  assert.deepEqual(validateTerrainGraph(normalized), { valid: true, errors: [] });
});

test('normalization rejects unsupported future graph versions', () => {
  const graph = createDefaultTerrainGraph();
  graph.version = TERRAIN_GRAPH_VERSION + 1;

  assert.throws(() => normalizeTerrainGraph(graph), /unsupported terrain graph version 3/i);
});

test('normalization rebuilds stale counters before adding nodes and links', () => {
  const source = createDefaultTerrainGraph();
  source.nextNodeId = -40;
  source.nextLinkId = 1;
  let graph = normalizeTerrainGraph(source);
  const expectedNodeId = Math.max(...graph.nodes.map((node) => node.id)) + 1;
  const expectedLinkId = Math.max(...graph.links.map((link) => link.id)) + 1;

  assert.equal(graph.nextNodeId, expectedNodeId);
  assert.equal(graph.nextLinkId, expectedLinkId);

  const coordinate = addTerrainGraphNode(graph, 'world/coordinates', [1900, 100]);
  graph = coordinate.graph;
  const noise = addTerrainGraphNode(graph, 'noise/fbm', [2100, 100]);
  graph = noise.graph;
  graph = connectTerrainGraphNodes(graph, {
    fromNode: coordinate.node.id,
    fromSocket: 'coordinate',
    toNode: noise.node.id,
    toSocket: 'coordinate',
  }).graph;

  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
  assert.equal(new Set(graph.links.map((link) => link.id)).size, graph.links.length);
  assert.equal(graph.links.at(-1).id, expectedLinkId);
});

test('node allocation stops before nextNodeId would exceed MAX_SAFE_INTEGER', () => {
  const graph = createDefaultTerrainGraph();
  graph.nextNodeId = Number.MAX_SAFE_INTEGER - 1;

  const finalAllocation = addTerrainGraphNode(graph, 'input/constant', [1800, 80]);
  const stableGraph = finalAllocation.graph;
  const stableNodeCount = stableGraph.nodes.length;

  assert.equal(finalAllocation.node.id, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(stableGraph.nextNodeId, Number.MAX_SAFE_INTEGER);
  assert.throws(
    () => addTerrainGraphNode(stableGraph, 'input/constant', [2000, 80]),
    /nextNodeId.*below Number\.MAX_SAFE_INTEGER/i,
  );
  assert.equal(stableGraph.nextNodeId, Number.MAX_SAFE_INTEGER);
  assert.equal(stableGraph.nodes.length, stableNodeCount);
});

test('link allocation stops before nextLinkId would exceed MAX_SAFE_INTEGER', () => {
  let graph = createDefaultTerrainGraph();
  const coordinate = addTerrainGraphNode(graph, 'world/coordinates', [1800, 180]);
  graph = coordinate.graph;
  const firstNoise = addTerrainGraphNode(graph, 'noise/fbm', [2000, 180]);
  graph = firstNoise.graph;
  const secondNoise = addTerrainGraphNode(graph, 'noise/fbm', [2000, 360]);
  graph = secondNoise.graph;
  graph.nextLinkId = Number.MAX_SAFE_INTEGER - 1;

  const finalAllocation = connectTerrainGraphNodes(graph, {
    fromNode: coordinate.node.id,
    fromSocket: 'coordinate',
    toNode: firstNoise.node.id,
    toSocket: 'coordinate',
  });
  const stableGraph = finalAllocation.graph;
  const stableLinkCount = stableGraph.links.length;

  assert.equal(finalAllocation.link.id, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(stableGraph.nextLinkId, Number.MAX_SAFE_INTEGER);
  assert.throws(
    () => connectTerrainGraphNodes(stableGraph, {
      fromNode: coordinate.node.id,
      fromSocket: 'coordinate',
      toNode: secondNoise.node.id,
      toSocket: 'coordinate',
    }),
    /nextLinkId.*below Number\.MAX_SAFE_INTEGER/i,
  );
  assert.equal(stableGraph.nextLinkId, Number.MAX_SAFE_INTEGER);
  assert.equal(stableGraph.links.length, stableLinkCount);
});

test('validation rejects graph ids outside Number.isSafeInteger', () => {
  const graph = createDefaultTerrainGraph();
  const originalId = graph.nodes[0].id;
  const unsafeId = Number.MAX_SAFE_INTEGER + 1;
  graph.nodes[0].id = unsafeId;
  for (const link of graph.links) {
    if (link.fromNode === originalId) link.fromNode = unsafeId;
    if (link.toNode === originalId) link.toNode = unsafeId;
  }

  const validation = validateTerrainGraph(graph);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /node id.*Number\.isSafeInteger/i);
});

test('normalization reports exhausted node and link id spaces at MAX_SAFE_INTEGER', () => {
  const nodeExhausted = createDefaultTerrainGraph();
  const originalNodeId = nodeExhausted.nodes[0].id;
  nodeExhausted.nodes[0].id = Number.MAX_SAFE_INTEGER;
  for (const link of nodeExhausted.links) {
    if (link.fromNode === originalNodeId) link.fromNode = Number.MAX_SAFE_INTEGER;
    if (link.toNode === originalNodeId) link.toNode = Number.MAX_SAFE_INTEGER;
  }

  const linkExhausted = createDefaultTerrainGraph();
  linkExhausted.links[0].id = Number.MAX_SAFE_INTEGER;

  assert.throws(
    () => normalizeTerrainGraph(nodeExhausted),
    /node id space.*MAX_SAFE_INTEGER.*exhausted/i,
  );
  assert.throws(
    () => normalizeTerrainGraph(linkExhausted),
    /link id space.*MAX_SAFE_INTEGER.*exhausted/i,
  );
});

test('string and nonnumeric graph ids are rejected explicitly', () => {
  const graph = createDefaultTerrainGraph();
  graph.nodes[0].id = String(graph.nodes[0].id);
  graph.links[0].fromNode = graph.nodes[0].id;

  const normalized = normalizeTerrainGraph(graph);
  const validation = validateTerrainGraph(normalized);

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /node id.*non-negative integer/i);
  assert.match(validation.errors.join(' '), /fromNode.*non-negative integer/i);
});

test('validation returns structural errors for malformed nodes, links, and view without throwing', () => {
  const graph = createDefaultTerrainGraph();
  graph.nodes[0] = null;
  graph.nodes[1].position = ['left', Number.NaN];
  graph.nodes[2].properties = [];
  graph.links[0] = null;
  graph.links[1].id = -1;
  graph.links[2].toNode = '3';
  graph.view = { scale: 0, offset: [Number.NaN] };

  let validation;
  assert.doesNotThrow(() => {
    validation = validateTerrainGraph(graph);
  });
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /node at index 0.*object/i);
  assert.match(validation.errors.join(' '), /position/i);
  assert.match(validation.errors.join(' '), /properties/i);
  assert.match(validation.errors.join(' '), /link at index 0.*object/i);
  assert.match(validation.errors.join(' '), /link id.*non-negative integer/i);
  assert.match(validation.errors.join(' '), /toNode.*non-negative integer/i);
  assert.match(validation.errors.join(' '), /view/i);
});

test('exported terrain node definitions are deeply immutable', () => {
  const packDefinition = TERRAIN_NODE_DEFINITIONS['material/pack'];

  assert.equal(Object.isFrozen(TERRAIN_NODE_DEFINITIONS), true);
  assert.equal(Object.isFrozen(packDefinition), true);
  assert.equal(Object.isFrozen(packDefinition.outputs), true);
  assert.equal(Object.isFrozen(packDefinition.outputs[0]), true);
  assert.equal(Object.isFrozen(packDefinition.properties), true);
  assert.equal(Object.isFrozen(packDefinition.properties.packId), true);
  assert.equal(Object.isFrozen(
    TERRAIN_NODE_DEFINITIONS['material/layerDistribution'].properties.layer.options,
  ), true);
  assert.throws(() => {
    packDefinition.properties.packId.default = 'desert';
  }, TypeError);
});

test('project import normalizes terrain graphs before validation and compilation', async () => {
  const source = await readFile(
    new URL('../src/app/TerrainEditorApp.js', import.meta.url),
    'utf8',
  );
  const importStart = source.indexOf('async #importProject(file)');
  const importEnd = source.indexOf('\n  #animate()', importStart);
  const importSource = source.slice(importStart, importEnd);
  const normalizeIndex = importSource.indexOf('normalizeTerrainGraph(');
  const validateIndex = importSource.indexOf('validateTerrainGraph(');
  const compileIndex = importSource.indexOf('compileTerrainPipeline(');
  const catchIndex = importSource.indexOf('} catch (error)');

  assert.match(source, /normalizeTerrainGraph,\s*\n\s*syncSettingsToTerrainGraph/);
  assert.ok(normalizeIndex >= 0);
  assert.ok(normalizeIndex < validateIndex);
  assert.ok(validateIndex < compileIndex);
  assert.ok(compileIndex < catchIndex);
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

test('typed material connections reject material-to-mask mismatches', () => {
  let graph = createDefaultTerrainGraph();
  const mask = addTerrainGraphNode(graph, 'mask/heightSlope', [100, 100]);
  graph = mask.graph;
  const distribution = addTerrainGraphNode(graph, 'material/layerDistribution', [350, 100]);
  graph = distribution.graph;

  assert.throws(() => connectTerrainGraphNodes(graph, {
    fromNode: mask.node.id,
    fromSocket: 'mask',
    toNode: distribution.node.id,
    toSocket: 'material',
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

test('validation rejects dual effective terminals', () => {
  const graph = createDefaultTerrainGraph();
  const output = graph.nodes.find((node) => node.type === 'terrain/materialOutput');
  const islandLink = graph.links.find((link) => (
    link.toNode === output.id && link.toSocket === 'terrain'
  ));
  const legacyOutputId = graph.nextNodeId;
  graph.nextNodeId += 1;
  graph.nodes.push({
    id: legacyOutputId,
    type: 'terrain/output',
    role: null,
    position: [output.position[0], output.position[1] + 160],
    properties: {},
  });
  graph.links.push({
    id: graph.nextLinkId,
    fromNode: islandLink.fromNode,
    fromSocket: 'terrain',
    toNode: legacyOutputId,
    toSocket: 'terrain',
  });
  graph.nextLinkId += 1;

  const validation = validateTerrainGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /exactly one effective terminal/i);
});

test('validation rejects a missing Material Output material connection', () => {
  const graph = createDefaultTerrainGraph();
  const output = graph.nodes.find((node) => node.type === 'terrain/materialOutput');
  graph.links = graph.links.filter((link) => (
    link.toNode !== output.id || link.toSocket !== 'material'
  ));

  const validation = validateTerrainGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /Material Output.*missing.*Material/i);
});

test('validation detects incompatible serialized socket types and duplicate link ids', () => {
  const graph = createDefaultTerrainGraph();
  const output = graph.nodes.find((node) => node.type === 'terrain/materialOutput');
  const materialLink = graph.links.find((link) => (
    link.toNode === output.id && link.toSocket === 'material'
  ));
  materialLink.toSocket = 'terrain';
  graph.links.at(-1).id = graph.links[0].id;

  const validation = validateTerrainGraph(graph);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /incompatible socket types/i);
  assert.match(validation.errors.join(' '), /duplicate terrain link id/i);
});

test('required inputs are enforced only on terminal-reachable branches', () => {
  const graph = createDefaultTerrainGraph();
  const withUnusedMaterialRule = addTerrainGraphNode(
    graph,
    'material/layerDistribution',
    [2000, 600],
  ).graph;

  assert.deepEqual(validateTerrainGraph(withUnusedMaterialRule), { valid: true, errors: [] });
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

test('derived graph settings never restore stale compiled terrain or material programs', () => {
  const staleProgram = { version: 1, instructions: [{ op: 'islandCoast', properties: { amplitude: 82 } }] };
  const graph = createDefaultTerrainGraph({ amplitude: 160 });
  const derived = deriveSettingsFromTerrainGraph(graph, {
    amplitude: 82,
    terrainProgram: staleProgram,
    materialProgram: { version: 1, packId: 'stale-pack' },
  });

  assert.equal(derived.amplitude, 160);
  assert.equal(Object.hasOwn(derived, 'terrainProgram'), false);
  assert.equal(Object.hasOwn(derived, 'materialProgram'), false);
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

test('normalized graphs survive a JSON serialization round trip', () => {
  const graph = createDefaultTerrainGraph({ seed: 82, materialPackId: 'desert' });
  const serialized = JSON.stringify(graph);
  const normalized = normalizeTerrainGraph(JSON.parse(serialized));

  assert.deepEqual(normalized, graph);
  assert.deepEqual(validateTerrainGraph(normalized), { valid: true, errors: [] });
});

test('catalog exposes every node required by the terrain and material pipelines', () => {
  assert.deepEqual(Object.keys(TERRAIN_NODE_DEFINITIONS).sort(), [
    'combine/add',
    'combine/blend',
    'combine/multiply',
    'input/constant',
    'mask/heightSlope',
    'mask/moistureErosion',
    'material/biomeBlend',
    'material/layerDistribution',
    'material/pack',
    'noise/continental',
    'noise/fbm',
    'noise/ridged',
    'shape/islandCoast',
    'terrain/materialOutput',
    'terrain/output',
    'transform/clamp',
    'transform/domainWarp',
    'transform/remap',
    'transform/terrace',
    'water/aquaticEcosystem',
    'world/coordinates',
  ]);
});
