import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TERRAIN_GRAPH_VERSION,
  createDefaultTerrainGraph,
} from '../src/terrain/TerrainGraphModel.js';
import {
  compileTerrainGraph,
  compileTerrainPipeline,
  createTerrainProgramEvaluator,
} from '../src/terrain/TerrainGraphCompiler.js';
import { BUILTIN_TERRAIN_MATERIAL_PACKS } from '../src/terrain/TerrainMaterialPacks.js';
import { createTerrainHeightSampler, terrainHeightAt } from '../src/terrain/noise.js';

const runtime = {
  fbm2D(x, z, options = {}) {
    return Math.sin(x * 1.71 + z * 0.93 + Number(options.seed ?? 0) * 0.017) * 0.72;
  },
  valueNoise2D(x, z, seed = 0) {
    return Math.sin(x * 2.13 - z * 1.37 + seed * 0.011) * 0.65;
  },
};

test('compiler topologically orders the default terrain graph', () => {
  const graph = createDefaultTerrainGraph();
  const program = compileTerrainGraph(graph);
  const instructionIndex = new Map(program.instructions.map((instruction, index) => [instruction.nodeId, index]));

  for (const link of graph.links) {
    if (!instructionIndex.has(link.fromNode) || !instructionIndex.has(link.toNode)) continue;
    assert.ok(instructionIndex.get(link.fromNode) < instructionIndex.get(link.toNode));
  }
  assert.equal(program.instructions.at(-1).op, 'terrainOutput');
  assert.equal(program.version, TERRAIN_GRAPH_VERSION);
  assert.equal(
    program.instructions.some((instruction) => instruction.title === 'Material Pack'),
    false,
  );
});

test('terrain pipeline compiles the height and material branches from Material Output', () => {
  const graph = createDefaultTerrainGraph({ materialPackId: 'alpine' });
  const pipeline = compileTerrainPipeline(graph, {
    packCatalog: Object.values(BUILTIN_TERRAIN_MATERIAL_PACKS),
  });

  assert.deepEqual(pipeline.terrainProgram, compileTerrainGraph(graph));
  assert.equal(pipeline.materialProgram.packId, 'alpine');
  assert.equal(pipeline.materialProgram.splatPreset, 'alpine');
  assert.equal(
    pipeline.terrainProgram.instructions.some((instruction) => (
      instruction.title === 'Material Pack'
    )),
    false,
  );
});

test('terrain pipeline returns no material program for a legacy Terrain Output graph', () => {
  const graph = createDefaultTerrainGraph();
  const output = graph.nodes.find((node) => node.type === 'terrain/materialOutput');
  const materialPack = graph.nodes.find((node) => node.type === 'material/pack');
  output.type = 'terrain/output';
  output.title = 'Terrain Output';
  graph.nodes = graph.nodes.filter((node) => node.id !== materialPack.id);
  graph.links = graph.links.filter((link) => (
    link.fromNode !== materialPack.id
    && !(link.toNode === output.id && link.toSocket === 'material')
  ));

  const pipeline = compileTerrainPipeline(graph, { packCatalog: [] });

  assert.deepEqual(pipeline.terrainProgram, compileTerrainGraph(graph));
  assert.equal(pipeline.materialProgram, null);
});

test('compiled terrain program is deterministic and responds to seed changes', () => {
  const graph = createDefaultTerrainGraph({ seed: 44 });
  const evaluate = createTerrainProgramEvaluator(compileTerrainGraph(graph), runtime);
  const first = evaluate(250.5, -91.75);
  const second = evaluate(250.5, -91.75);
  const changed = createTerrainProgramEvaluator(
    compileTerrainGraph(createDefaultTerrainGraph({ seed: 45 })),
    runtime,
  )(250.5, -91.75);

  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test('field instructions perform numeric transforms and combinations', () => {
  const program = {
    version: TERRAIN_GRAPH_VERSION,
    slotCount: 11,
    outputSlot: 10,
    instructions: [
      { op: 'constant', slot: 0, properties: { value: 0.25 }, inputs: {} },
      { op: 'constant', slot: 1, properties: { value: 0.75 }, inputs: {} },
      { op: 'constant', slot: 2, properties: { value: 0.5 }, inputs: {} },
      { op: 'add', slot: 3, properties: {}, inputs: { a: 0, b: 1 } },
      { op: 'multiply', slot: 4, properties: {}, inputs: { a: 3, b: 2 } },
      { op: 'blend', slot: 5, properties: {}, inputs: { a: 0, b: 1, factor: 2 } },
      { op: 'remap', slot: 6, properties: { inputMin: 0, inputMax: 1, outputMin: -1, outputMax: 1, clamp: false }, inputs: { field: 5 } },
      { op: 'terrace', slot: 7, properties: { steps: 4, strength: 1 }, inputs: { field: 6 } },
      { op: 'constant', slot: 8, properties: { value: 0.3 }, inputs: {} },
      { op: 'add', slot: 9, properties: {}, inputs: { a: 7, b: 8 } },
      { op: 'clamp', slot: 10, properties: { min: -0.1, max: 0.2 }, inputs: { field: 9 } },
    ],
  };

  const evaluate = createTerrainProgramEvaluator(program, runtime);
  assert.equal(evaluate(0, 0), 0.2);
});

test('terrain program evaluator normalizes omitted instruction properties to an empty object', () => {
  const program = {
    version: TERRAIN_GRAPH_VERSION,
    slotCount: 2,
    outputSlot: 1,
    instructions: [
      { op: 'constant', slot: 0, inputs: {} },
      { op: 'terrainOutput', slot: 1, inputs: { terrain: 0 } },
    ],
  };

  const evaluate = createTerrainProgramEvaluator(program, runtime);

  assert.equal(evaluate(12, -8), 0);
});

test('terrain program evaluator rejects unsupported program versions before sampling', () => {
  const program = compileTerrainGraph(createDefaultTerrainGraph());
  program.version = TERRAIN_GRAPH_VERSION - 1;

  assert.throws(
    () => createTerrainProgramEvaluator(program, runtime),
    /unsupported terrain program version 1/i,
  );
});

test('terrain program evaluator rejects invalid slot counts and output slots', () => {
  const program = compileTerrainGraph(createDefaultTerrainGraph());

  assert.throws(
    () => createTerrainProgramEvaluator({ ...program, slotCount: -1 }, runtime),
    /slotCount.*positive integer/i,
  );
  assert.throws(
    () => createTerrainProgramEvaluator({ ...program, outputSlot: program.slotCount }, runtime),
    /outputSlot.*bounds/i,
  );
});

test('terrain program evaluator rejects duplicate, out-of-bounds, and missing input slots', () => {
  const program = compileTerrainGraph(createDefaultTerrainGraph());
  const duplicate = structuredClone(program);
  duplicate.instructions[1].slot = duplicate.instructions[0].slot;
  const outOfBounds = structuredClone(program);
  outOfBounds.instructions[0].slot = outOfBounds.slotCount;
  const missingInput = structuredClone(program);
  const target = missingInput.instructions.find((instruction) => (
    Object.keys(instruction.inputs).length > 0
  ));
  target.inputs[Object.keys(target.inputs)[0]] = missingInput.slotCount - 0.5;

  assert.throws(
    () => createTerrainProgramEvaluator(duplicate, runtime),
    /duplicate instruction slot/i,
  );
  assert.throws(
    () => createTerrainProgramEvaluator(outOfBounds, runtime),
    /instruction slot.*bounds/i,
  );
  assert.throws(
    () => createTerrainProgramEvaluator(missingInput, runtime),
    /input slot.*integer/i,
  );
});

test('terrain program evaluator rejects unknown ops and invalid input references', () => {
  const program = compileTerrainGraph(createDefaultTerrainGraph());
  const unknownOp = structuredClone(program);
  unknownOp.instructions[0].op = 'executeArbitraryCode';
  const futureReference = structuredClone(program);
  const targetIndex = futureReference.instructions.findIndex((instruction) => (
    Object.keys(instruction.inputs).length > 0
  ));
  const target = futureReference.instructions[targetIndex];
  target.inputs[Object.keys(target.inputs)[0]] = futureReference.instructions.at(-1).slot;

  assert.throws(
    () => createTerrainProgramEvaluator(unknownOp, runtime),
    /unsupported terrain program operation/i,
  );
  assert.throws(
    () => createTerrainProgramEvaluator(futureReference, runtime),
    /input slot.*earlier instruction/i,
  );
});

test('compiler reports a missing required connection with the node title', () => {
  const graph = createDefaultTerrainGraph();
  const output = graph.nodes.find((node) => node.type === 'terrain/materialOutput');
  graph.links = graph.links.filter((link) => (
    link.toNode !== output.id || link.toSocket !== 'terrain'
  ));

  assert.throws(() => compileTerrainGraph(graph), /Material Output.*missing.*Terrain/i);
});

test('default island program produces finite terrain and a deeper outer ocean', () => {
  const graph = createDefaultTerrainGraph({ worldRadius: 4000, waterLevel: -3 });
  const evaluate = createTerrainProgramEvaluator(compileTerrainGraph(graph), runtime);
  const center = evaluate(0, 0);
  const coast = evaluate(3000, 0);
  const outerOcean = evaluate(5600, 0);

  assert.ok(Number.isFinite(center));
  assert.ok(Number.isFinite(coast));
  assert.ok(Number.isFinite(outerOcean));
  assert.ok(outerOcean < coast);
  assert.ok(outerOcean < -40);
});

test('default compiled graph preserves the legacy terrain shape', () => {
  const settings = {
    seed: 2468,
    frequency: 0.00192,
    amplitude: 87,
    persistence: 0.49,
    lacunarity: 2.08,
    octaves: 6,
    warpStrength: 104,
    ridgeStrength: 0.58,
    continentalScale: 0.00031,
    continentalStrength: 59,
    terraceStrength: 0.12,
    baseHeight: 9,
    worldRadius: 4000,
    waterLevel: -3,
    landRadius: 3040,
    coastWidth: 720,
    coastIrregularity: 0.18,
    oceanDepth: 52,
  };
  const terrainProgram = compileTerrainGraph(createDefaultTerrainGraph(settings));
  const graphSampler = createTerrainHeightSampler({ ...settings, terrainProgram });

  for (const [x, z] of [[0, 0], [430, -918], [2700, 600], [4200, -300]]) {
    assert.ok(Math.abs(graphSampler(x, z) - terrainHeightAt(x, z, settings)) < 1e-9);
  }
});
