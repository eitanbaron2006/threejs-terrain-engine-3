import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileTerrainMaterialGraph,
  createTerrainMaterialProgramEvaluator,
  evaluateRangeMask,
  evaluateTerrainMaterialProgram,
  normalizeMaterialWeights,
} from '../src/terrain/TerrainMaterialGraph.js';

const packCatalog = [{
  id: 'mediterranean',
  name: 'Mediterranean',
  splatPreset: 'mediterranean',
  globalBlend: 1.15,
  transitionNoise: 0.2,
  layers: ['sand', 'grass', 'soil', 'rock'].map((id) => ({ id })),
}];

function node(id, type, properties = {}, title = type) {
  return { id, type, title, properties };
}

function link(fromNode, fromSocket, toNode, toSocket) {
  return { fromNode, fromSocket, toNode, toSocket };
}

function createMaterialGraph({ materialNodes = [], materialLinks = [], outputProperties = {} } = {}) {
  const pack = node('pack', 'material/pack', {
    packId: 'mediterranean',
    globalBlend: 1.25,
    transitionNoise: 0.3,
  }, 'Mediterranean Pack');
  const output = node('output', 'terrain/materialOutput', outputProperties, 'Material Output');
  const terminalMaterialNode = materialNodes.at(-1) ?? pack;

  return {
    version: 2,
    nodes: [
      node('terrain', 'shape/islandCoast', {}, 'Island / Coast'),
      pack,
      ...materialNodes,
      output,
    ],
    links: [
      link('terrain', 'terrain', 'output', 'terrain'),
      ...(materialNodes.length
        ? [link('pack', 'material', materialNodes[0].id, 'material'), ...materialLinks]
        : []),
      link(terminalMaterialNode.id, 'material', 'output', 'material'),
    ],
  };
}

function createMaterialProgram(overrides = {}) {
  return {
    version: 1,
    packId: 'mediterranean',
    splatPreset: 'mediterranean',
    globalBlend: 1,
    transitionNoise: 0,
    masks: [],
    distributionRules: [],
    biomeBlends: [],
    ...overrides,
  };
}

test('range masks use smooth blends around both edges and support inversion', () => {
  assert.equal(evaluateRangeMask(7.9, 10, 20, 2, false), 0);
  assert.equal(evaluateRangeMask(10, 10, 20, 2, false), 0.5);
  assert.equal(evaluateRangeMask(12, 10, 20, 2, false), 1);
  assert.equal(evaluateRangeMask(18, 10, 20, 2, false), 1);
  assert.equal(evaluateRangeMask(20, 10, 20, 2, false), 0.5);
  assert.equal(evaluateRangeMask(22.1, 10, 20, 2, false), 0);
  assert.equal(evaluateRangeMask(15, 10, 20, 2, true), 0);
  assert.equal(evaluateRangeMask(30, 10, 20, 2, true), 1);
  assert.equal(evaluateRangeMask(10, 10, 20, 0, false), 1);
});

test('normalization always returns four finite non-negative weights', () => {
  assert.deepEqual(normalizeMaterialWeights([2, 2, 0, 0]), [0.5, 0.5, 0, 0]);
  assert.deepEqual(normalizeMaterialWeights([0, 0, 0, 0]), [0.25, 0.25, 0.25, 0.25]);
  assert.deepEqual(normalizeMaterialWeights([-4, Number.NaN, 3]), [0, 0, 1, 0]);

  const result = normalizeMaterialWeights([0.2, 0.3, 0.4, 0.1, 99]);
  assert.equal(result.length, 4);
  assert.equal(result.reduce((sum, value) => sum + value, 0), 1);
  assert.ok(result.every((value) => Number.isFinite(value) && value >= 0));

  const largeValues = normalizeMaterialWeights([
    811535784440.4536,
    261881877720.9433,
    733836914919.3079,
    78661194517.41672,
  ]);
  assert.equal(largeValues.reduce((sum, value) => sum + value, 0), 1);

  assert.deepEqual(
    normalizeMaterialWeights([
      Number.MAX_VALUE,
      Number.MAX_VALUE,
      Number.MAX_VALUE,
      Number.MAX_VALUE,
    ]),
    [0.25, 0.25, 0.25, 0.25],
  );
});

test('compiler produces a structured-cloneable pack program', () => {
  const program = compileTerrainMaterialGraph(createMaterialGraph(), { packCatalog });

  assert.deepEqual(program, {
    version: 1,
    packId: 'mediterranean',
    splatPreset: 'mediterranean',
    globalBlend: 1.25,
    transitionNoise: 0.3,
    masks: [],
    distributionRules: [],
    biomeBlends: [],
  });
  assert.deepEqual(structuredClone(program), program);
});

test('compiler follows chained material flow independently of graph array order', () => {
  const heightMask = node('height-mask', 'mask/heightSlope', {
    minHeight: -10,
    maxHeight: 120,
    heightBlend: 12,
    minSlope: 0,
    maxSlope: 45,
    slopeBlend: 8,
    invert: false,
  }, 'Low Flat Mask');
  const grass = node('grass-rule', 'material/layerDistribution', {
    layer: 'grass',
    minHeight: -8,
    maxHeight: 100,
    heightBlend: 10,
    minSlope: 0,
    maxSlope: 35,
    slopeBlend: 7,
    moistureAffinity: 0.8,
    coastAffinity: 0.2,
    erosionAffinity: -0.1,
    curvatureBias: 0.3,
    priority: 1.4,
  }, 'Grass Distribution');
  const rock = node('rock-rule', 'material/layerDistribution', {
    layer: 3,
    minHeight: 20,
    maxHeight: 300,
    heightBlend: 20,
    minSlope: 28,
    maxSlope: 90,
    slopeBlend: 10,
    priority: 1.8,
  }, 'Rock Distribution');
  const biome = node('biome', 'material/biomeBlend', {
    fromLayer: 'soil',
    toLayer: 'grass',
    strength: 0.65,
  }, 'Wet Grass Blend');
  const graph = createMaterialGraph({
    materialNodes: [grass, rock, biome],
    materialLinks: [
      link('grass-rule', 'material', 'rock-rule', 'material'),
      link('rock-rule', 'material', 'biome', 'material'),
      link('height-mask', 'mask', 'biome', 'mask'),
    ],
  });
  graph.nodes.push(heightMask);

  const shuffled = structuredClone(graph);
  shuffled.nodes.reverse();
  shuffled.links.reverse();

  const first = compileTerrainMaterialGraph(graph, { packCatalog });
  const second = compileTerrainMaterialGraph(shuffled, { packCatalog });

  assert.deepEqual(second, first);
  assert.deepEqual(first.distributionRules.map((rule) => rule.layer), [1, 3]);
  assert.deepEqual(first.biomeBlends, [{
    nodeId: 'biome',
    maskId: 'height-mask',
    fromLayer: 2,
    toLayer: 1,
    strength: 0.65,
  }]);
  assert.equal(first.masks[0].type, 'heightSlope');
});

test('compiler sorts mask ids by code units instead of locale', () => {
  const firstMask = node('ä-mask', 'mask/heightSlope', {}, 'Unicode Mask');
  const secondMask = node('z-mask', 'mask/heightSlope', {}, 'ASCII Mask');
  const firstBlend = node('first-blend', 'material/biomeBlend', {
    fromLayer: 'sand',
    toLayer: 'grass',
    strength: 0.2,
  });
  const secondBlend = node('second-blend', 'material/biomeBlend', {
    fromLayer: 'soil',
    toLayer: 'rock',
    strength: 0.2,
  });
  const graph = createMaterialGraph({
    materialNodes: [firstBlend, secondBlend],
    materialLinks: [
      link('first-blend', 'material', 'second-blend', 'material'),
      link('ä-mask', 'mask', 'first-blend', 'mask'),
      link('z-mask', 'mask', 'second-blend', 'mask'),
    ],
  });
  graph.nodes.push(firstMask, secondMask);

  const program = compileTerrainMaterialGraph(graph, { packCatalog });

  assert.deepEqual(program.masks.map((mask) => mask.id), ['z-mask', 'ä-mask']);
});

test('height and slope masks combine both world-space ranges', () => {
  const program = {
    version: 1,
    packId: 'mediterranean',
    splatPreset: 'mediterranean',
    globalBlend: 1,
    transitionNoise: 0,
    distributionRules: [],
    masks: [{
      id: 'terrain-mask',
      type: 'heightSlope',
      minHeight: 0,
      maxHeight: 100,
      heightBlend: 0,
      minSlope: 0,
      maxSlope: 30,
      slopeBlend: 0,
      invert: false,
    }],
    biomeBlends: [{
      nodeId: 'blend',
      maskId: 'terrain-mask',
      fromLayer: 0,
      toLayer: 1,
      strength: 1,
    }],
  };

  assert.deepEqual(
    evaluateTerrainMaterialProgram(program, { height: 50, slopeDegrees: 15 }, [1, 0, 0, 0]),
    [0, 1, 0, 0],
  );
  assert.deepEqual(
    evaluateTerrainMaterialProgram(program, { height: 140, slopeDegrees: 15 }, [1, 0, 0, 0]),
    [1, 0, 0, 0],
  );
  assert.deepEqual(
    evaluateTerrainMaterialProgram(program, { height: 50, slopeDegrees: 50 }, [1, 0, 0, 0]),
    [1, 0, 0, 0],
  );
});

test('moisture and erosion masks combine normalized analysis signals', () => {
  const program = {
    version: 1,
    packId: 'mediterranean',
    splatPreset: 'mediterranean',
    globalBlend: 1,
    transitionNoise: 0,
    distributionRules: [],
    masks: [{
      id: 'wet-eroded',
      type: 'moistureErosion',
      minMoisture: 0.6,
      maxMoisture: 1,
      moistureBlend: 0,
      minErosion: 0.4,
      maxErosion: 0.8,
      erosionBlend: 0,
      invert: false,
    }],
    biomeBlends: [{
      nodeId: 'blend',
      maskId: 'wet-eroded',
      fromLayer: 2,
      toLayer: 1,
      strength: 1,
    }],
  };

  assert.deepEqual(
    evaluateTerrainMaterialProgram(program, { moisture: 0.8, erosion: 0.6 }, [0, 0, 1, 0]),
    [0, 1, 0, 0],
  );
  assert.deepEqual(
    evaluateTerrainMaterialProgram(program, { moisture: 0.2, erosion: 0.6 }, [0, 0, 1, 0]),
    [0, 0, 1, 0],
  );
});

test('distribution rules suppress out-of-range layers and apply affinity and priority', () => {
  const rule = {
    nodeId: 'grass',
    layer: 1,
    minHeight: 0,
    maxHeight: 100,
    heightBlend: 0,
    minSlope: 0,
    maxSlope: 30,
    slopeBlend: 0,
    moistureAffinity: 1,
    coastAffinity: 0,
    erosionAffinity: 0,
    curvatureBias: 0,
    priority: 2,
  };
  const program = {
    version: 1,
    packId: 'mediterranean',
    splatPreset: 'mediterranean',
    globalBlend: 1,
    transitionNoise: 0,
    masks: [],
    distributionRules: [rule],
    biomeBlends: [],
  };
  const base = [0.25, 0.25, 0.25, 0.25];
  const wet = evaluateTerrainMaterialProgram(program, {
    height: 50,
    slopeDegrees: 10,
    moisture: 1,
  }, base);
  const dry = evaluateTerrainMaterialProgram(program, {
    height: 50,
    slopeDegrees: 10,
    moisture: 0,
  }, base);
  const outside = evaluateTerrainMaterialProgram(program, {
    height: 150,
    slopeDegrees: 10,
    moisture: 1,
  }, base);

  assert.ok(wet[1] > dry[1]);
  assert.ok(wet[1] > base[1]);
  assert.ok(outside[1] < base[1]);
  assert.equal(wet.reduce((sum, value) => sum + value, 0), 1);
});

test('four equivalent per-layer distribution rules produce equal order-independent weights', () => {
  const shared = {
    minHeight: 0,
    maxHeight: 100,
    heightBlend: 0,
    minSlope: 0,
    maxSlope: 30,
    slopeBlend: 0,
    moistureAffinity: 0,
    coastAffinity: 0,
    erosionAffinity: 0,
    curvatureBias: 0,
    priority: 1,
  };
  const rules = [0, 1, 2, 3].map((layer) => ({
    nodeId: `layer-${layer}`,
    layer,
    ...shared,
  }));
  const context = { height: 50, slopeDegrees: 10, variation: 0.5 };
  const base = [0.7, 0.1, 0.1, 0.1];
  const forward = evaluateTerrainMaterialProgram(
    createMaterialProgram({ distributionRules: rules }),
    context,
    base,
  );
  const reversed = evaluateTerrainMaterialProgram(
    createMaterialProgram({ distributionRules: [...rules].reverse() }),
    context,
    base,
  );

  assert.deepEqual(forward, [0.25, 0.25, 0.25, 0.25]);
  assert.deepEqual(reversed, forward);
});

test('the last distribution rule for the same layer deterministically overrides earlier rules', () => {
  const makeRule = (nodeId, priority) => ({
    nodeId,
    layer: 1,
    minHeight: 0,
    maxHeight: 100,
    heightBlend: 0,
    minSlope: 0,
    maxSlope: 30,
    slopeBlend: 0,
    moistureAffinity: 0,
    coastAffinity: 0,
    erosionAffinity: 0,
    curvatureBias: 0,
    priority,
  });
  const low = makeRule('low-priority', 0.5);
  const high = makeRule('high-priority', 2);
  const context = { height: 50, slopeDegrees: 10, variation: 0.5 };
  const base = [0.25, 0.25, 0.25, 0.25];

  const lowThenHigh = evaluateTerrainMaterialProgram(
    createMaterialProgram({ distributionRules: [low, high] }),
    context,
    base,
  );
  const highOnly = evaluateTerrainMaterialProgram(
    createMaterialProgram({ distributionRules: [high] }),
    context,
    base,
  );
  const highThenLow = evaluateTerrainMaterialProgram(
    createMaterialProgram({ distributionRules: [high, low] }),
    context,
    base,
  );
  const lowOnly = evaluateTerrainMaterialProgram(
    createMaterialProgram({ distributionRules: [low] }),
    context,
    base,
  );

  assert.deepEqual(lowThenHigh, highOnly);
  assert.deepEqual(highThenLow, lowOnly);
});

test('biome blends transfer only available source weight and preserve normalization', () => {
  const program = {
    version: 1,
    packId: 'mediterranean',
    splatPreset: 'mediterranean',
    globalBlend: 1,
    transitionNoise: 0,
    masks: [{
      id: 'all',
      type: 'heightSlope',
      minHeight: -100,
      maxHeight: 100,
      heightBlend: 0,
      minSlope: 0,
      maxSlope: 90,
      slopeBlend: 0,
      invert: false,
    }],
    distributionRules: [],
    biomeBlends: [{
      nodeId: 'blend',
      maskId: 'all',
      fromLayer: 3,
      toLayer: 0,
      strength: 0.5,
    }],
  };
  const result = evaluateTerrainMaterialProgram(
    program,
    { height: 0, slopeDegrees: 20 },
    [0.1, 0.2, 0.3, 0.4],
  );

  assert.deepEqual(result, [0.3, 0.2, 0.3, 0.2]);
  assert.equal(result.reduce((sum, value) => sum + value, 0), 1);
  assert.ok(result.every((value) => value >= 0));
});

test('material program evaluator preserves caller target identity across repeated samples', () => {
  const evaluate = createTerrainMaterialProgramEvaluator(createMaterialProgram());
  const targets = [
    new Float32Array(4),
    new Float64Array(4),
    [0, 0, 0, 0],
  ];

  for (const target of targets) {
    for (let sample = 0; sample < 1000; sample += 1) {
      const result = evaluate(
        { height: sample, slopeDegrees: sample % 90 },
        [1, 2, 3, 4],
        target,
      );
      assert.equal(result, target);
    }
    const total = target[0] + target[1] + target[2] + target[3];
    assert.ok(Math.abs(total - 1) < 1e-6);
  }
});

test('material program evaluator validates and snapshots mask metadata before sampling', () => {
  let typeReads = 0;
  const mask = {
    id: 'sample-mask',
    minHeight: 0,
    maxHeight: 100,
    heightBlend: 5,
    minSlope: 0,
    maxSlope: 45,
    slopeBlend: 5,
    invert: false,
  };
  Object.defineProperty(mask, 'type', {
    enumerable: true,
    get() {
      typeReads += 1;
      return 'heightSlope';
    },
  });
  const program = createMaterialProgram({
    masks: [mask],
    biomeBlends: [{
      nodeId: 'sample-blend',
      maskId: 'sample-mask',
      fromLayer: 0,
      toLayer: 1,
      strength: 0.5,
    }],
  });

  const evaluate = createTerrainMaterialProgramEvaluator(program);
  const readsAfterCreation = typeReads;
  const target = new Float64Array(4);
  evaluate({ height: 50, slopeDegrees: 10 }, [1, 0, 0, 0], target);
  evaluate({ height: 60, slopeDegrees: 20 }, [1, 0, 0, 0], target);

  assert.ok(readsAfterCreation > 0);
  assert.equal(typeReads, readsAfterCreation);
});

test('material program evaluator rejects malformed masks, rules, blend indexes, and references', () => {
  const validHeightMask = {
    id: 'valid-mask',
    type: 'heightSlope',
    minHeight: 0,
    maxHeight: 100,
    heightBlend: 5,
    minSlope: 0,
    maxSlope: 45,
    slopeBlend: 5,
    invert: false,
  };
  const validRule = {
    nodeId: 'valid-rule',
    layer: 1,
    minHeight: 0,
    maxHeight: 100,
    heightBlend: 5,
    minSlope: 0,
    maxSlope: 45,
    slopeBlend: 5,
    moistureAffinity: 0,
    coastAffinity: 0,
    erosionAffinity: 0,
    curvatureBias: 0,
    priority: 1,
  };
  const invalidPrograms = [
    {
      program: createMaterialProgram({
        masks: [{ ...validHeightMask, id: 'unknown-mask', type: 'temperature' }],
      }),
      error: /unknown-mask.*type/i,
    },
    {
      program: createMaterialProgram({
        masks: [{ ...validHeightMask, id: 'bad-mask-range', minHeight: 120, maxHeight: 20 }],
      }),
      error: /bad-mask-range.*minHeight.*maxHeight/i,
    },
    {
      program: createMaterialProgram({
        distributionRules: [{ ...validRule, nodeId: 'bad-rule-range', minSlope: 60, maxSlope: 20 }],
      }),
      error: /bad-rule-range.*minSlope.*maxSlope/i,
    },
    {
      program: createMaterialProgram({
        masks: [validHeightMask],
        biomeBlends: [{
          nodeId: 'bad-index-blend',
          maskId: 'valid-mask',
          fromLayer: 4,
          toLayer: 1,
          strength: 0.5,
        }],
      }),
      error: /bad-index-blend.*fromLayer/i,
    },
    {
      program: createMaterialProgram({
        biomeBlends: [{
          nodeId: 'missing-mask-blend',
          maskId: 'not-present',
          fromLayer: 0,
          toLayer: 1,
          strength: 0.5,
        }],
      }),
      error: /missing-mask-blend.*not-present/i,
    },
  ];

  for (const { program, error } of invalidPrograms) {
    assert.throws(() => createTerrainMaterialProgramEvaluator(program), error);
  }
});

test('material program validation rejects non-string and unsupported splat presets', () => {
  const cyclicPreset = {};
  cyclicPreset.self = cyclicPreset;

  assert.throws(
    () => createTerrainMaterialProgramEvaluator(createMaterialProgram({
      splatPreset: { raw: true },
    })),
    /splatPreset.*string/i,
  );
  assert.throws(
    () => createTerrainMaterialProgramEvaluator(createMaterialProgram({
      splatPreset: cyclicPreset,
    })),
    /splatPreset.*string/i,
  );
  assert.throws(
    () => createTerrainMaterialProgramEvaluator(createMaterialProgram({
      splatPreset: 'unknown',
    })),
    /splatPreset.*supported/i,
  );
  assert.doesNotThrow(
    () => createTerrainMaterialProgramEvaluator(createMaterialProgram({
      splatPreset: ' Alpine ',
    })),
  );
});

test('evaluateTerrainMaterialProgram caches evaluator validation by program object', () => {
  const program = createMaterialProgram();
  let versionReads = 0;
  Object.defineProperty(program, 'version', {
    enumerable: true,
    get() {
      versionReads += 1;
      return 1;
    },
  });

  evaluateTerrainMaterialProgram(program, {}, [1, 1, 1, 1]);
  evaluateTerrainMaterialProgram(program, {}, [1, 1, 1, 1]);

  assert.equal(versionReads, 1);
});

test('compiler rejects invalid ranges and names the responsible node', () => {
  const invalid = node('bad-rule', 'material/layerDistribution', {
    layer: 'grass',
    minHeight: 120,
    maxHeight: 20,
    heightBlend: 5,
    minSlope: 0,
    maxSlope: 45,
    slopeBlend: 5,
    priority: 1,
  }, 'Broken Grass Rule');
  const graph = createMaterialGraph({ materialNodes: [invalid] });

  assert.throws(
    () => compileTerrainMaterialGraph(graph, { packCatalog }),
    /Broken Grass Rule.*bad-rule.*minHeight.*maxHeight/i,
  );
});

test('compiler rejects missing packs and names both the node and pack id', () => {
  const graph = createMaterialGraph();
  graph.nodes.find((item) => item.id === 'pack').properties.packId = 'missing-pack';

  assert.throws(
    () => compileTerrainMaterialGraph(graph, { packCatalog }),
    /Mediterranean Pack.*pack.*missing-pack/i,
  );
});

test('compiler rejects a selected pack that does not provide exactly four usable layers', () => {
  const graph = createMaterialGraph();
  graph.nodes.find((item) => item.id === 'pack').properties.packId = 'three-layer-pack';
  const invalidCatalog = [{
    id: 'three-layer-pack',
    name: 'Three Layer Pack',
    splatPreset: 'custom',
    layers: [{ id: 'sand' }, { id: 'grass' }, { id: 'soil' }],
  }];

  assert.throws(
    () => compileTerrainMaterialGraph(graph, { packCatalog: invalidCatalog }),
    /Mediterranean Pack.*pack.*three-layer-pack.*exactly four.*layers/i,
  );
});

test('compiler rejects duplicate or misplaced semantic layer ids in a four-layer pack', () => {
  const invalidCatalog = [{
    id: 'duplicate-layer-pack',
    name: 'Duplicate Layer Pack',
    splatPreset: 'custom',
    layers: [
      { id: 'sand' },
      { id: 'grass' },
      { id: 'grass' },
      { id: 'rock' },
    ],
  }];
  const graph = createMaterialGraph();
  graph.nodes.find((item) => item.id === 'pack').properties.packId = 'duplicate-layer-pack';

  assert.throws(
    () => compileTerrainMaterialGraph(graph, { packCatalog: invalidCatalog }),
    /Mediterranean Pack.*pack.*duplicate-layer-pack.*sand.*grass.*soil.*rock/i,
  );
});

test('compiler rejects invalid layer enums and indices', () => {
  const invalid = node('bad-layer', 'material/layerDistribution', {
    layer: 4,
    minHeight: 0,
    maxHeight: 100,
    heightBlend: 5,
    minSlope: 0,
    maxSlope: 45,
    slopeBlend: 5,
    priority: 1,
  }, 'Invalid Layer');
  const graph = createMaterialGraph({ materialNodes: [invalid] });

  assert.throws(
    () => compileTerrainMaterialGraph(graph, { packCatalog }),
    /Invalid Layer.*bad-layer.*layer/i,
  );
});

test('compiler rejects malformed material chains with the missing socket and node', () => {
  const distribution = node('orphan-rule', 'material/layerDistribution', {
    layer: 'soil',
    minHeight: 0,
    maxHeight: 100,
    heightBlend: 5,
    minSlope: 0,
    maxSlope: 45,
    slopeBlend: 5,
    priority: 1,
  }, 'Orphan Distribution');
  const graph = createMaterialGraph({ materialNodes: [distribution] });
  graph.links = graph.links.filter((item) => item.toNode !== 'orphan-rule');

  assert.throws(
    () => compileTerrainMaterialGraph(graph, { packCatalog }),
    /Orphan Distribution.*orphan-rule.*material.*missing/i,
  );
});

test('material output requires both terrain and material connections', () => {
  const graph = createMaterialGraph();
  graph.links = graph.links.filter((item) => item.toSocket !== 'terrain');

  assert.throws(
    () => compileTerrainMaterialGraph(graph, { packCatalog }),
    /Material Output.*output.*terrain.*missing/i,
  );
});

test('material output rejects a fabricated terrain socket from a non-terrain node type', () => {
  const graph = createMaterialGraph();
  const fabricatedTerrain = graph.nodes.find((item) => item.id === 'terrain');
  fabricatedTerrain.type = 'material/pack';
  fabricatedTerrain.title = 'Fabricated Terrain';

  assert.throws(
    () => compileTerrainMaterialGraph(graph, { packCatalog }),
    /Fabricated Terrain.*terrain.*shape\/islandCoast/i,
  );
});

test('compiler accepts caller-provided terrain producer types or predicates', () => {
  const graph = createMaterialGraph();
  const terrainSource = graph.nodes.find((item) => item.id === 'terrain');
  terrainSource.type = 'custom/terrain';
  terrainSource.title = 'Custom Terrain';

  const fromTypeSet = compileTerrainMaterialGraph(graph, {
    packCatalog,
    terrainProducerTypes: ['custom/terrain'],
  });
  const fromPredicate = compileTerrainMaterialGraph(graph, {
    packCatalog,
    isTerrainProducer: (source) => source.type === 'custom/terrain',
  });

  assert.equal(fromTypeSet.packId, 'mediterranean');
  assert.equal(fromPredicate.packId, 'mediterranean');
});
