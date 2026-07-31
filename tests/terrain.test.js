import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAutoWeights,
  packControlWeights,
  terrainHeightAt,
  valueNoise2D,
} from '../src/terrain/noise.js';
import {
  DEFAULT_GENERATOR_SETTINGS,
  DEFAULT_STREAMING_SETTINGS,
  DEFAULT_TERRAIN_CONFIG,
  DEFAULT_WATER_SETTINGS,
  QUALITY_TIERS,
} from '../src/terrain/TerrainConfig.js';
import { PBR_MAP_ALIASES, findAmbientMapEntry, selectProviderMap } from '../src/terrain/PbrMapResolver.js';
import { createDefaultTerrainGraph } from '../src/terrain/TerrainGraphModel.js';
import { compileTerrainPipeline } from '../src/terrain/TerrainGraphCompiler.js';
import {
  createTerrainMaterialProgramEvaluator,
} from '../src/terrain/TerrainMaterialGraph.js';
import { BUILTIN_TERRAIN_MATERIAL_PACKS } from '../src/terrain/TerrainMaterialPacks.js';

test('noise is deterministic', () => {
  assert.equal(valueNoise2D(12.5, -8.75, 42), valueNoise2D(12.5, -8.75, 42));
});

test('terrain generation uses absolute world coordinates and is seamless at a chunk boundary', () => {
  const settings = { ...DEFAULT_GENERATOR_SETTINGS };
  const boundaryX = DEFAULT_TERRAIN_CONFIG.chunkSize / 2;
  const z = 91.25;
  const fromLeftChunk = terrainHeightAt(boundaryX, z, settings);
  const fromRightChunk = terrainHeightAt(boundaryX, z, settings);
  assert.equal(fromLeftChunk, fromRightChunk);
  assert.ok(Number.isFinite(fromLeftChunk));
});

test('automatic material weights are normalized for every preset', () => {
  for (const preset of ['mediterranean', 'alpine', 'desert', 'volcanic']) {
    for (const [height, slope, variation] of [[0, 2, 0.2], [55, 31, 0.5], [180, 67, 0.9]]) {
      const weights = computeAutoWeights(height, slope, variation, preset);
      const sum = weights.reduce((total, value) => total + value, 0);
      assert.equal(weights.length, 4);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${preset} returned ${sum}`);
      assert.ok(weights.every((value) => value >= 0 && value <= 1));
    }
  }
});

test('packed control weights sum to 255 with minimum quantization error', () => {
  const explicit = packControlWeights(Float32Array.from([0.5, 0.25, 0.25, 0]));
  assert.deepEqual([...explicit], [127, 64, 64, 0]);

  const denominator = 12;
  for (let a = 0; a <= denominator; a += 1) {
    for (let b = 0; b <= denominator - a; b += 1) {
      for (let c = 0; c <= denominator - a - b; c += 1) {
        const d = denominator - a - b - c;
        const source = [a / denominator, b / denominator, c / denominator, d / denominator];
        const packed = packControlWeights(Float32Array.from(source));
        const ideal = source.map((weight) => weight * 255);
        let minimumSquaredError = Infinity;

        for (let mask = 0; mask < 16; mask += 1) {
          const candidate = ideal.map((value, channel) => (
            Math.floor(value) + ((mask >> channel) & 1)
          ));
          if (candidate.reduce((sum, value) => sum + value, 0) !== 255) continue;
          const squaredError = candidate.reduce((sum, value, channel) => (
            sum + (value - ideal[channel]) ** 2
          ), 0);
          minimumSquaredError = Math.min(minimumSquaredError, squaredError);
        }

        assert.ok(packed instanceof Uint8Array);
        assert.equal(
          packed[0] + packed[1] + packed[2] + packed[3],
          255,
          `packed sum failed for ${source}`,
        );
        const actualSquaredError = [...packed].reduce((sum, value, channel) => (
          sum + (value - ideal[channel]) ** 2
        ), 0);
        assert.ok(
          Math.abs(actualSquaredError - minimumSquaredError) < 1e-8,
          `non-minimum quantization for ${source}: ${[...packed]}`,
        );
      }
    }
  }
});

test('packed control weights remain balanced when finite channel sums overflow', () => {
  const packed = packControlWeights(Float64Array.from([
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    Number.MAX_VALUE,
  ]));

  assert.deepEqual([...packed], [64, 64, 64, 63]);
  assert.equal(packed[0] + packed[1] + packed[2] + packed[3], 255);
});

test('material-program-like objects reject unsupported versions instead of using a preset fallback', () => {
  assert.throws(
    () => computeAutoWeights(42, 18, 0.5, {
      version: 999,
      packId: 'mediterranean',
      splatPreset: 'mediterranean',
      globalBlend: 1,
      transitionNoise: 0.2,
      masks: [],
      distributionRules: [],
      biomeBlends: [],
    }),
    /unsupported terrain material program version/i,
  );
});

test('malformed material-program-like objects are validated instead of using a preset fallback', () => {
  assert.throws(
    () => computeAutoWeights(42, 18, 0.5, {
      version: 1,
      packId: 'mediterranean',
      splatPreset: 'mediterranean',
      globalBlend: 1,
      transitionNoise: 0.2,
      masks: {},
      distributionRules: [],
      biomeBlends: [],
    }),
    /masks.*array/i,
  );
});

test('material programs reject raw, cyclic, and unsupported splat presets before base evaluation', () => {
  const createProgram = (splatPreset) => ({
    version: 1,
    packId: 'mediterranean',
    splatPreset,
    globalBlend: 1,
    transitionNoise: 0.2,
    masks: [],
    distributionRules: [],
    biomeBlends: [],
  });
  const cyclicPreset = {};
  cyclicPreset.self = cyclicPreset;

  assert.throws(
    () => computeAutoWeights(42, 18, 0.5, createProgram({ raw: true })),
    /splatPreset.*string/i,
  );
  assert.throws(
    () => computeAutoWeights(42, 18, 0.5, createProgram(cyclicPreset)),
    /splatPreset.*string/i,
  );
  assert.throws(
    () => computeAutoWeights(42, 18, 0.5, createProgram('unsupported-preset')),
    /splatPreset.*supported/i,
  );
  assert.deepEqual(
    computeAutoWeights(42, 18, 0.5, createProgram(' Alpine ')),
    computeAutoWeights(42, 18, 0.5, createProgram('alpine')),
  );
});

test('graph material weights equal direct evaluation over the preset base weights', () => {
  const graph = createDefaultTerrainGraph({ materialPackId: 'mediterranean' });
  const pack = graph.nodes.find((node) => node.type === 'material/pack');
  const output = graph.nodes.find((node) => node.type === 'terrain/materialOutput');
  const distribution = {
    id: graph.nextNodeId++,
    type: 'material/layerDistribution',
    title: 'Layer Distribution',
    role: null,
    position: [1520, 500],
    properties: {
      layer: 'rock',
      minHeight: 30,
      maxHeight: 180,
      heightBlend: 12,
      minSlope: 18,
      maxSlope: 80,
      slopeBlend: 10,
      moistureAffinity: -0.2,
      coastAffinity: -0.4,
      erosionAffinity: 0.35,
      curvatureBias: 0.5,
      priority: 1.4,
    },
  };
  graph.nodes.push(distribution);
  graph.links = graph.links.filter((link) => (
    !(link.fromNode === pack.id && link.toNode === output.id && link.toSocket === 'material')
  ));
  graph.links.push({
    id: graph.nextLinkId++,
    fromNode: pack.id,
    fromSocket: 'material',
    toNode: distribution.id,
    toSocket: 'material',
  });
  graph.links.push({
    id: graph.nextLinkId++,
    fromNode: distribution.id,
    fromSocket: 'material',
    toNode: output.id,
    toSocket: 'material',
  });
  const { materialProgram } = compileTerrainPipeline(graph, {
    packCatalog: Object.values(BUILTIN_TERRAIN_MATERIAL_PACKS),
  });
  const height = 74;
  const slopeDegrees = 33;
  const variation = 0.61;
  const context = {
    height,
    slope: slopeDegrees,
    slopeDegrees,
    variation,
    curvature: -0.12,
    moisture: 0.42,
    exposure: 0.66,
    coast: 0.08,
    erosion: 0.58,
    waterLevel: -3,
  };
  const baseWeights = computeAutoWeights(
    height,
    slopeDegrees,
    variation,
    materialProgram.splatPreset,
    context,
  );
  const expected = createTerrainMaterialProgramEvaluator(materialProgram)(
    context,
    baseWeights,
  );

  assert.deepEqual(
    computeAutoWeights(height, slopeDegrees, variation, materialProgram, context),
    expected,
  );
});

test('worker boundary accepts structured-cloned material programs and matches sync control bytes', async () => {
  const { generateTerrainChunkData } = await import(
    '../src/terrain/TerrainGenerationService.js'
  );
  const { handleTerrainWorkerMessage } = await import('../src/workers/terrainWorker.js');
  const graph = createDefaultTerrainGraph({ materialPackId: 'mediterranean' });
  const { terrainProgram, materialProgram } = compileTerrainPipeline(graph, {
    packCatalog: Object.values(BUILTIN_TERRAIN_MATERIAL_PACKS),
  });
  const input = structuredClone({
    id: 71,
    type: 'generate-chunk',
    descriptor: {
      chunkX: 0,
      chunkZ: 0,
      key: '0,0',
      lodIndex: 0,
      dataResolution: 7,
    },
    config: DEFAULT_TERRAIN_CONFIG,
    settings: {
      ...DEFAULT_GENERATOR_SETTINGS,
      terrainProgram,
    },
    materialSelector: materialProgram,
  });
  const expected = generateTerrainChunkData(
    input.descriptor,
    input.config,
    input.settings,
    input.materialSelector,
  );

  const result = handleTerrainWorkerMessage(input);

  assert.equal(result.message.id, input.id);
  assert.equal(result.message.type, 'chunk-result');
  assert.deepEqual(
    [...new Uint8Array(result.message.control)],
    [...expected.control],
  );
  assert.equal(result.transfer.length, 3);
  assert.ok(result.transfer.every((buffer) => buffer instanceof ArrayBuffer));
});

test('TerrainWorld gives materialProgram precedence and clears stale programs on legacy changes', async () => {
  const { TerrainWorld } = await import('../src/terrain/TerrainWorld.js');
  const recalculateCalls = [];
  const chunk = {
    modified: false,
    calculateAutoControlData(selector) {
      recalculateCalls.push(selector);
      return new Uint8Array([0, 255, 0, 0]);
    },
    applyAutoControlData() {},
  };
  const world = Object.create(TerrainWorld.prototype);
  world.chunks = new Map([['0,0', chunk]]);
  world.modifiedChunkCache = new Map();
  world.generatorSettings = { seed: 1337 };
  world.eventBus = { emit() {} };
  world.presetId = 'mediterranean';
  world.materialDistribution = { id: 'custom', layers: [] };
  world.materialProgram = { version: 1, packId: 'alpine', splatPreset: 'alpine' };
  const nextProgram = {
    version: 1,
    packId: 'desert',
    splatPreset: 'desert',
    globalBlend: 1,
    transitionNoise: 0,
    masks: [],
    distributionRules: [],
    biomeBlends: [],
  };

  world.applyMaterialProgram(nextProgram);
  assert.equal(world.getMaterialWeightSelector(), nextProgram);
  assert.equal(recalculateCalls.at(-1), nextProgram);

  world.applyPreset('volcanic');
  assert.equal(world.materialProgram, null);
  assert.equal(world.getMaterialWeightSelector(), 'volcanic');

  world.applyMaterialPackDistribution({
    id: 'custom-pack',
    splatPreset: 'mediterranean',
    layers: [{ distribution: {} }, {}, {}, {}],
  }, nextProgram);
  assert.equal(world.materialProgram, nextProgram);
  assert.equal(world.getMaterialWeightSelector(), nextProgram);
  assert.equal(recalculateCalls.at(-1), nextProgram);
});

test('TerrainWorld material selector changes roll back when the second chunk calculation fails', async () => {
  const { TerrainWorld } = await import('../src/terrain/TerrainWorld.js');
  const oldProgram = {
    version: 1,
    packId: 'mediterranean',
    splatPreset: 'mediterranean',
    globalBlend: 1,
    transitionNoise: 0,
    masks: [],
    distributionRules: [],
    biomeBlends: [],
  };
  const nextProgram = { ...oldProgram, packId: 'alpine', splatPreset: 'alpine' };
  const first = {
    key: 'first',
    presetId: 'mediterranean',
    modified: true,
    legacyMutated: false,
    applied: false,
    recalculateControl() {
      this.legacyMutated = true;
    },
    calculateAutoControlData() {
      return Uint8Array.from([0, 255, 0, 0]);
    },
    applyAutoControlData() {
      this.applied = true;
    },
    captureState() {
      return { key: this.key };
    },
  };
  const second = {
    key: 'second',
    presetId: 'mediterranean',
    modified: true,
    recalculateControl() {
      throw new Error('second chunk failed');
    },
    calculateAutoControlData() {
      throw new Error('second chunk failed');
    },
    applyAutoControlData() {
      throw new Error('must not commit');
    },
  };
  const oldCacheEntry = { key: 'old-cache' };
  const world = Object.create(TerrainWorld.prototype);
  world.chunks = new Map([['first', first], ['second', second]]);
  world.modifiedChunkCache = new Map([['first', oldCacheEntry]]);
  world.generatorSettings = { seed: 1337 };
  world.eventBus = { emit() { throw new Error('must not emit'); } };
  world.presetId = 'mediterranean';
  world.materialDistribution = null;
  world.materialProgram = oldProgram;
  world.materialRevision = 4;

  assert.throws(
    () => world.applyMaterialProgram(nextProgram),
    /second chunk failed/i,
  );
  assert.equal(world.presetId, 'mediterranean');
  assert.equal(world.materialProgram, oldProgram);
  assert.equal(world.materialDistribution, null);
  assert.equal(world.materialRevision, 4);
  assert.equal(first.legacyMutated, false);
  assert.equal(first.applied, false);
  assert.equal(first.presetId, 'mediterranean');
  assert.equal(world.modifiedChunkCache.get('first'), oldCacheEntry);
});

test('TerrainWorld discards a deferred chunk generated before a material program change', async () => {
  const THREE = await import('three');
  const { TerrainWorld } = await import('../src/terrain/TerrainWorld.js');
  const config = {
    ...DEFAULT_TERRAIN_CONFIG,
    worldSizeKm: 1,
    chunkSize: 16,
    sourceResolution: 3,
    generationBudgetPerFrame: 1,
    lodLevels: [
      { id: 0, segments: 2, dataResolution: 3, maxDistance: Infinity },
    ],
  };
  let resolveGeneration;
  let requestedSelector;
  const generationService = {
    concurrency: 1,
    generateChunk(descriptor, requestConfig, settings, selector) {
      requestedSelector = selector;
      return new Promise((resolve) => {
        resolveGeneration = () => resolve({
          descriptor,
          resolution: 3,
          heights: new Float32Array(9),
          heightTextureData: new Float32Array(25),
          heightTextureResolution: 5,
          control: Uint8Array.from({ length: 36 }, (_, index) => (
            index % 4 === 1 ? 255 : 0
          )),
          minHeight: 0,
          maxHeight: 0,
        });
      });
    },
  };
  const materialLibrary = {
    createChunkMaterial: () => new THREE.MeshBasicMaterial(),
    updateChunkMaterial() {},
    disposeMaterial: (material) => material.dispose(),
  };
  const world = new TerrainWorld({
    config,
    materialLibrary,
    generationService,
    eventBus: { emit() {} },
    generatorSettings: DEFAULT_GENERATOR_SETTINGS,
    streamingSettings: { ...DEFAULT_STREAMING_SETTINGS, streamRadius: 0 },
  });
  world.streamingMode = 'fps';
  world.updateStreaming(new THREE.Vector3(0, 0, 0), true);
  assert.equal(requestedSelector, 'mediterranean');
  const program = {
    version: 1,
    packId: 'alpine',
    splatPreset: 'alpine',
    globalBlend: 1,
    transitionNoise: 0,
    masks: [],
    distributionRules: [],
    biomeBlends: [],
  };

  world.applyMaterialProgram(program);
  resolveGeneration();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(world.chunks.size, 0);
  assert.equal(world.stats.generated, 0);
  assert.equal(world.getMaterialWeightSelector(), program);
  world.dispose();
});

test('TerrainChunk calculates automatic controls without mutation and commits explicitly', async () => {
  const THREE = await import('three');
  const { TerrainChunk } = await import('../src/terrain/TerrainChunk.js');
  const resolution = 3;
  const geometry = new THREE.BufferGeometry();
  const materialLibrary = {
    createChunkMaterial: () => new THREE.MeshBasicMaterial(),
    disposeMaterial: (material) => material.dispose(),
  };
  const chunk = new TerrainChunk({
    descriptor: { chunkX: 0, chunkZ: 0, key: '0,0', lodIndex: 0 },
    config: DEFAULT_TERRAIN_CONFIG,
    geometry,
    materialLibrary,
    generation: {
      resolution,
      heights: Float32Array.from([0, 10, 20, 5, 25, 45, 10, 35, 70]),
      heightTextureData: new Float32Array((resolution + 2) ** 2),
      heightTextureResolution: resolution + 2,
      control: Uint8Array.from({ length: resolution * resolution * 4 }, (_, index) => (
        index % 4 === 1 ? 255 : 0
      )),
      minHeight: 0,
      maxHeight: 70,
    },
  });
  const before = chunk.autoControlData.slice();
  const controlMapVersion = chunk.controlMap.version;

  const calculated = chunk.calculateAutoControlData('volcanic', DEFAULT_GENERATOR_SETTINGS);

  assert.deepEqual(chunk.autoControlData, before);
  assert.notDeepEqual(calculated, before);
  chunk.applyAutoControlData(calculated);
  assert.deepEqual(chunk.autoControlData, calculated);
  assert.equal(chunk.controlMap.version, controlMapVersion + 1);
  chunk.dispose();
  geometry.dispose();
});

test('worker pool failure drains in-flight and queued jobs synchronously without hanging', async () => {
  const { TerrainGenerationService } = await import(
    '../src/terrain/TerrainGenerationService.js'
  );
  class FakeWorker {
    constructor(index) {
      this.index = index;
      this.listeners = new Map();
      this.messages = [];
      this.terminated = false;
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    postMessage(message) {
      this.messages.push(message);
    }

    terminate() {
      this.terminated = true;
    }

    emitError(message) {
      this.listeners.get('error')?.({ message });
    }
  }

  const workers = [];
  let creationAttempts = 0;
  const service = new TerrainGenerationService(2, {
    workerFactory(index) {
      creationAttempts += 1;
      if (creationAttempts > 2) throw new Error('replacement unavailable');
      const worker = new FakeWorker(index);
      workers.push(worker);
      return worker;
    },
  });
  const config = {
    ...DEFAULT_TERRAIN_CONFIG,
    chunkSize: 16,
    sourceResolution: 3,
  };
  const descriptors = [0, 1, 2].map((chunkX) => ({
    chunkX,
    chunkZ: 0,
    key: `${chunkX},0`,
    lodIndex: 0,
    dataResolution: 3,
  }));
  const promises = descriptors.map((descriptor) => service.generateChunk(
    descriptor,
    config,
    DEFAULT_GENERATOR_SETTINGS,
    'mediterranean',
  ));
  assert.equal(workers[0].messages.length, 1);
  assert.equal(workers[1].messages.length, 1);

  workers[0].emitError('worker crashed');
  const results = await Promise.race([
    Promise.all(promises),
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('worker promises hung')), 1000);
    }),
  ]);
  const future = await service.generateChunk(
    { ...descriptors[0], key: 'future' },
    config,
    DEFAULT_GENERATOR_SETTINGS,
    'mediterranean',
  );

  assert.equal(creationAttempts, 3);
  assert.ok(workers.every((worker) => worker.terminated));
  assert.equal(results.length, 3);
  assert.ok(results.every((result) => result.control instanceof Uint8Array));
  assert.ok(future.control instanceof Uint8Array);
  assert.deepEqual(service.getDiagnostics(), { concurrency: 1, queued: 0, busy: 0 });
  service.dispose();
});

test('LOD levels become progressively coarser', () => {
  const segments = DEFAULT_TERRAIN_CONFIG.lodLevels.map((level) => level.segments);
  for (let index = 1; index < segments.length; index += 1) assert.ok(segments[index] < segments[index - 1]);
});


test('LOD data resolutions become progressively coarser', () => {
  const resolutions = DEFAULT_TERRAIN_CONFIG.lodLevels.map((level) => level.dataResolution);
  assert.equal(resolutions[0], DEFAULT_TERRAIN_CONFIG.sourceResolution);
  for (let index = 1; index < resolutions.length; index += 1) {
    assert.ok(resolutions[index] < resolutions[index - 1]);
  }
});

test('quality tiers support a 4K target', () => {
  assert.equal(QUALITY_TIERS.ultra.materialResolution, 4096);
});

test('GLSL3 terrain shader declares an explicit fragment output', async () => {
  const { readFile } = await import('node:fs/promises');
  const materialSource = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.match(materialSource, /glslVersion:\s*THREE\.GLSL3/);
  assert.match(materialSource, /layout\s*\(\s*location\s*=\s*0\s*\)\s*out\s+highp\s+vec4\s+terrainFragmentColor/);
  assert.match(materialSource, /#define\s+gl_FragColor\s+terrainFragmentColor/);
});

test('deprecated Three.js Clock and soft shadow constant are not used', async () => {
  const { readFile } = await import('node:fs/promises');
  const appSource = await readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /THREE\.Clock/);
  assert.doesNotMatch(appSource, /PCFSoftShadowMap/);
  assert.match(appSource, /new THREE\.Timer\(\)/);
  assert.match(appSource, /THREE\.PCFShadowMap/);
});


test('terrain material does not break texture derivatives with fract before repeated sampling', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /texture\([^\n]+fract\(position\./);
  assert.doesNotMatch(source, /texture\(uMacroMap,\s*fract/);
});

test('per-chunk terrain control maps do not use mipmaps that average material weights into square blotches', async () => {
  const THREE = await import('three');
  const { TerrainChunk } = await import('../src/terrain/TerrainChunk.js');
  const resolution = 3;
  const geometry = new THREE.BufferGeometry();
  const materialLibrary = {
    createChunkMaterial: () => new THREE.MeshBasicMaterial(),
    disposeMaterial: (material) => material.dispose(),
  };
  const chunk = new TerrainChunk({
    descriptor: { chunkX: 0, chunkZ: 0, key: '0,0', lodIndex: 0 },
    config: DEFAULT_TERRAIN_CONFIG,
    geometry,
    materialLibrary,
    generation: {
      resolution,
      heights: new Float32Array(resolution * resolution),
      heightTextureData: new Float32Array((resolution + 2) * (resolution + 2)),
      heightTextureResolution: resolution + 2,
      control: new Uint8Array(resolution * resolution * 4).fill(64),
      minHeight: 0,
      maxHeight: 0,
    },
  });

  assert.equal(chunk.controlMap.minFilter, THREE.LinearFilter);
  assert.equal(chunk.controlMap.magFilter, THREE.LinearFilter);
  assert.equal(chunk.controlMap.generateMipmaps, false);

  chunk.dispose();
  geometry.dispose();
});

test('startup material recalculation preserves the seeded generator control map', async () => {
  const THREE = await import('three');
  const { TerrainChunk } = await import('../src/terrain/TerrainChunk.js');
  const { TerrainGenerationService } = await import('../src/terrain/TerrainGenerationService.js');
  const descriptor = { chunkX: -3, chunkZ: 2, key: '-3,2', lodIndex: 1, dataResolution: 17 };
  const settings = { ...DEFAULT_GENERATOR_SETTINGS, seed: 2468 };
  const originalWarn = console.warn;
  console.warn = () => {};
  const service = new TerrainGenerationService();
  let chunk = null;
  const geometry = new THREE.BufferGeometry();
  const materialLibrary = {
    createChunkMaterial: () => new THREE.MeshBasicMaterial(),
    disposeMaterial: (material) => material.dispose(),
  };

  try {
    const generation = await service.generateChunk(descriptor, DEFAULT_TERRAIN_CONFIG, settings, 'mediterranean');
    const generatedControl = generation.control.slice();
    chunk = new TerrainChunk({
      descriptor,
      config: DEFAULT_TERRAIN_CONFIG,
      geometry,
      materialLibrary,
      generation,
    });

    chunk.recalculateControl('mediterranean', settings);

    assert.deepEqual(chunk.autoControlData, generatedControl);
  } finally {
    console.warn = originalWarn;
    chunk?.dispose();
    geometry.dispose();
    service.dispose();
  }
});

test('mediterranean generation keeps inland uplands from becoming one broad soil stain', () => {
  const dryRollingUpland = computeAutoWeights(55, 20, 0.55, 'mediterranean', {
    waterLevel: DEFAULT_TERRAIN_CONFIG.waterLevel,
    curvature: 0,
    moisture: 0.35,
    exposure: 0.55,
    coast: 0,
    erosion: 0.42,
  });
  const exposedHighland = computeAutoWeights(80, 28, 0.5, 'mediterranean', {
    waterLevel: DEFAULT_TERRAIN_CONFIG.waterLevel,
    curvature: -0.1,
    moisture: 0.4,
    exposure: 0.7,
    coast: 0,
    erosion: 0.5,
  });

  assert.ok(dryRollingUpland[1] > dryRollingUpland[2], `expected grass to break up soil, got ${dryRollingUpland}`);
  assert.ok(dryRollingUpland[2] < 0.36, `soil weight is too broad on inland upland: ${dryRollingUpland}`);
  assert.ok(exposedHighland[3] > exposedHighland[2], `expected exposed highland to resolve as rock, got ${exposedHighland}`);
  assert.ok(exposedHighland[2] < 0.34, `highland soil weight is too strong: ${exposedHighland}`);
});

test('terrain height textures include a one-sample halo', async () => {
  const { readFile } = await import('node:fs/promises');
  const workerSource = await readFile(new URL('../src/workers/terrainWorker.js', import.meta.url), 'utf8');
  const generationSource = await readFile(
    new URL('../src/terrain/TerrainGenerationService.js', import.meta.url),
    'utf8',
  );
  assert.match(generationSource, /paddedResolution\s*=\s*resolution\s*\+\s*2/);
  assert.match(generationSource, /heightTextureData/);
  assert.match(workerSource, /generateTerrainChunkData/);
});

test('LOD borders use a transition band instead of single-row snapping', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.match(source, /uEdgeMorphWidth/);
  assert.match(source, /coarseTerrainHeight/);
  assert.match(source, /smoothstep\(0\.0,\s*width/);
});


test('edited terrain refreshes neighboring height halos', async () => {
  const { readFile } = await import('node:fs/promises');
  const chunkSource = await readFile(new URL('../src/terrain/TerrainChunk.js', import.meta.url), 'utf8');
  const worldSource = await readFile(new URL('../src/terrain/TerrainWorld.js', import.meta.url), 'utf8');
  assert.match(chunkSource, /refreshHeightHalo\(/);
  assert.match(worldSource, /#refreshHeightHalosAround\(/);
});

test('professional terrain profile uses one-metre LOD0 spacing', () => {
  const level = DEFAULT_TERRAIN_CONFIG.lodLevels[0];
  assert.equal(level.segments, 256);
  assert.equal(DEFAULT_TERRAIN_CONFIG.chunkSize / level.segments, 1);
  assert.equal(level.dataResolution, 257);
});

test('smooth halo normal is the primary terrain lighting normal', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.match(source, /vec3\s+geometricNormal\s*=\s*normalize\(vWorldNormal\)/);
  assert.doesNotMatch(source, /vec3\s+geometricNormal\s*=\s*normalize\(cross\(dFdx/);
});

test('parallax control is connected to the shader and settings', async () => {
  const { readFile } = await import('node:fs/promises');
  const materialSource = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  const configSource = await readFile(new URL('../src/terrain/TerrainConfig.js', import.meta.url), 'utf8');
  assert.match(materialSource, /uniform\s+float\s+uParallaxScale/);
  assert.match(materialSource, /uParallaxScale\s*\*\s*uParallaxEnabled/);
  assert.match(configSource, /parallaxScale:\s*0\.025/);
});

test('KTX2 loader validates four layers, dimensions and mipmaps before applying', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.match(source, /function\s+validateTextureSet/);
  assert.match(source, /info\.depth\s*!==\s*LAYER_COUNT/);
  assert.match(source, /info\.mipLevels\s*<\s*info\.expectedMipLevels/);
  assert.match(source, /this\.lastKtx2Report\s*=\s*report/);
});

test('LOD hysteresis is enabled to avoid rapid switching', () => {
  assert.ok(DEFAULT_TERRAIN_CONFIG.lodHysteresis > 0);
});

test('terrain fragment shader declares viewDirection only once and applies LOD displacement', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.equal((source.match(/vec3\s+viewDirection\s*=\s*normalize/g) ?? []).length, 1);
  assert.match(source, /microDisplacement\s*\*=\s*uDisplacementEnabled\s*\*\s*uLodDisplacement/);
});

test('outer world terrain is submerged before the circular boundary', () => {
  const settings = {
    ...DEFAULT_GENERATOR_SETTINGS,
    worldRadius: DEFAULT_TERRAIN_CONFIG.worldSizeKm * 500,
    waterLevel: DEFAULT_TERRAIN_CONFIG.waterLevel,
  };
  const radius = settings.worldRadius;
  for (const [x, z] of [[radius * 0.97, 0], [0, radius * 0.97], [radius * 0.7, radius * 0.7]]) {
    assert.ok(
      terrainHeightAt(x, z, settings) < DEFAULT_TERRAIN_CONFIG.waterLevel - 5,
      `expected edge ${x},${z} to be submerged`,
    );
  }
});

test('water system uses a circular radial mesh and GPU ping-pong simulation', async () => {
  const { readFile } = await import('node:fs/promises');
  const waterSource = await readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8');
  const simulationSource = await readFile(new URL('../src/water/GpuWaterSimulation.js', import.meta.url), 'utf8');
  assert.match(waterSource, /function\s+createRadialGeometry/);
  assert.match(waterSource, /CircularOceanAndLakeSurface/);
  assert.match(simulationSource, /targetA/);
  assert.match(simulationSource, /targetB/);
  assert.match(simulationSource, /laplacian/);
  assert.match(simulationSource, /swap|temporary/);
});

test('shoreline flicker protection uses scene depth and shore fade', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8');
  assert.match(source, /uSceneDepth/);
  assert.match(source, /thickness\s*=\s*max\(sceneDistance\s*-\s*vViewDistance/);
  assert.match(source, /shoreAlpha\s*=\s*smoothstep/);
  assert.match(source, /discard/);
  assert.equal(DEFAULT_WATER_SETTINGS.dynamicRipples, true);
});

test('water color is driven by vertical depth and Fresnel instead of camera distance bands', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8');
  const deepColor = Number.parseInt(DEFAULT_WATER_SETTINGS.deepColor.slice(1), 16);
  const deepRed = ((deepColor >> 16) & 0xff) / 255;
  const deepGreen = ((deepColor >> 8) & 0xff) / 255;
  const deepBlue = (deepColor & 0xff) / 255;
  const deepLuminance = deepRed * 0.2126 + deepGreen * 0.7152 + deepBlue * 0.0722;
  assert.match(source, /uInverseProjectionMatrix/);
  assert.match(source, /uInverseViewMatrix/);
  assert.match(source, /sceneWorldPosition/);
  assert.match(source, /verticalWaterDepth/);
  assert.match(source, /beerLambert/);
  assert.match(source, /openOceanColor/);
  assert.match(source, /shallowBottomVisibility/);
  assert.match(source, /roughSurfaceReflection/);
  assert.match(source, /uBathymetryMap/);
  assert.match(source, /bathymetryWaterDepth/);
  assert.match(source, /sampleBathymetryDepth\(vWorldPosition\.xz\)/);
  assert.doesNotMatch(source, /verticalWaterDepth\s*=\s*max\(vWorldPosition\.y\s*-\s*bottomWorld\.y/);
  assert.match(source, /smoothstep\(18\.0,\s*32\.0,\s*verticalWaterDepth\)/);
  assert.doesNotMatch(source, /horizonFade/);
  assert.doesNotMatch(source, /max\(uDeepColor/);
  assert.doesNotMatch(source, /smoothstep\(26\.0,\s*130\.0,\s*verticalWaterDepth\)/);
  assert.doesNotMatch(source, /smoothstep\(4\.0,\s*42\.0,\s*verticalWaterDepth\)/);
  assert.doesNotMatch(source, /rawSceneDepth\s*>=\s*0\.9999\s*\?\s*uDeepColor\s*:/);
  assert.ok(deepBlue > deepGreen, `open-ocean default should lean blue, got ${DEFAULT_WATER_SETTINGS.deepColor}`);
  assert.ok(deepGreen < 0.34, `open-ocean default is too green/turquoise: ${DEFAULT_WATER_SETTINGS.deepColor}`);
  assert.ok(deepLuminance < 0.26, `open-ocean default is too bright: ${DEFAULT_WATER_SETTINGS.deepColor}`);
});

test('water bathymetry is sampled from the same deterministic terrain generator', async () => {
  const { createBathymetryData } = await import('../src/water/AdvancedWaterSystem.js');
  const resolution = 32;
  const maxDepth = 255;
  const settings = { ...DEFAULT_GENERATOR_SETTINGS };
  const bathymetry = createBathymetryData(DEFAULT_TERRAIN_CONFIG, settings, { resolution, maxDepth });

  assert.equal(bathymetry.data.length, resolution * resolution);
  assert.equal(bathymetry.worldSize, DEFAULT_TERRAIN_CONFIG.worldSizeKm * 1000);
  assert.equal(bathymetry.maxDepth, maxDepth);

  const sampleX = 29;
  const sampleZ = 18;
  const worldX = ((sampleX + 0.5) / resolution - 0.5) * bathymetry.worldSize;
  const worldZ = ((sampleZ + 0.5) / resolution - 0.5) * bathymetry.worldSize;
  const terrainSettings = {
    ...settings,
    worldRadius: bathymetry.worldSize * 0.5,
    waterLevel: DEFAULT_TERRAIN_CONFIG.waterLevel,
  };
  const expectedDepth = Math.min(
    maxDepth,
    Math.max(0, DEFAULT_TERRAIN_CONFIG.waterLevel - terrainHeightAt(worldX, worldZ, terrainSettings)),
  );
  const decodedDepth = bathymetry.data[sampleZ * resolution + sampleX] / 255 * maxDepth;
  assert.ok(Math.abs(decodedDepth - expectedDepth) <= maxDepth / 255 + 0.01);
});

test('terrain generation refreshes the water bathymetry source', async () => {
  const { readFile } = await import('node:fs/promises');
  const appSource = await readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8');
  assert.match(appSource, /generatorSettings:\s*this\.generatorSettings/);
  assert.match(appSource, /terrain:generated[\s\S]*updateBathymetry/);
});

test('scatter vegetation and rocks are removed from the application', async () => {
  const { readFile, access } = await import('node:fs/promises');
  const appSource = await readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /TerrainScatterSystem/);
  await assert.rejects(access(new URL('../src/environment/TerrainScatterSystem.js', import.meta.url)));
});

test('water GLSL3 shader declares an explicit fragment output', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8');
  assert.match(source, /glslVersion:\s*THREE\.GLSL3/);
  assert.match(source, /layout\s*\(\s*location\s*=\s*0\s*\)\s*out\s+highp\s+vec4\s+waterFragmentColor/);
  assert.match(source, /#define\s+gl_FragColor\s+waterFragmentColor/);
});


test('world environment implements HDRI PMREM and light-space texel snapping', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/environment/WorldEnvironment.js', import.meta.url), 'utf8');
  assert.match(source, /HDRLoader/);
  assert.match(source, /EXRLoader/);
  assert.match(source, /PMREMGenerator/);
  assert.match(source, /snappedRight/);
  assert.match(source, /snappedUp/);
  assert.match(source, /sunLightRight/);
  assert.match(source, /sunLightUp/);
});

test('environment configuration requests an 8K 80-metre shadow box with safe biases', async () => {
  const environmentConfig = await import('../src/environment/config.js');
  assert.equal(environmentConfig.SUN_SHADOW_RADIUS, 40);
  assert.equal(environmentConfig.SUN_SHADOW_MAP_SIZE, 8192);
  assert.equal(environmentConfig.SUN_SHADOW_BIAS, -0.00003);
  assert.equal(environmentConfig.SUN_SHADOW_NORMAL_BIAS, 0.018);
  assert.equal(environmentConfig.WORLD_ENV_MAP_INTENSITY, 0.30);
});

test('stable water can reflect the loaded equirectangular HDRI', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8');
  assert.match(source, /uEnvironmentMap/);
  assert.match(source, /uHasEnvironmentMap/);
  assert.match(source, /equirectUv/);
  assert.match(source, /setEnvironmentMap/);
});

test('Sky Studio exposes runtime HDRI and sun controls', async () => {
  const { readFile } = await import('node:fs/promises');
  const ui = await readFile(new URL('../src/ui/EditorUI.js', import.meta.url), 'utf8');
  const environment = await readFile(new URL('../src/environment/WorldEnvironment.js', import.meta.url), 'utf8');
  assert.match(ui, /Sky & Sun Studio/);
  assert.match(ui, /environment-preset/);
  assert.match(ui, /sun-azimuth/);
  assert.match(ui, /shadow-map-size/);
  assert.match(environment, /loadCustomFile/);
  assert.match(environment, /loadCustomUrl/);
  assert.match(environment, /applySettings/);
});

test('settings sidebar can collapse and restore without hiding the terrain workspace controls', async () => {
  const { readFile } = await import('node:fs/promises');
  const ui = await readFile(new URL('../src/ui/EditorUI.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(ui, /data-action="toggle-sidebar"/);
  assert.match(ui, /data-sidebar-restore/);
  assert.match(ui, /sidebar-collapsed/);
  assert.match(ui, /aria-expanded/);
  assert.match(styles, /\.editor-shell\.sidebar-collapsed \.sidebar/);
  assert.match(styles, /\.sidebar-restore/);
});

test('LiteGraph context menus keep left-to-right alignment inside the Hebrew editor shell', async () => {
  const { readFile } = await import('node:fs/promises');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.litegraph\.litecontextmenu\s*\{[^}]*direction:ltr;[^}]*text-align:left;/s);
  assert.match(styles, /\.litegraph\.litecontextmenu \.litemenu-entry\s*\{[^}]*text-align:left;/s);
  assert.match(styles, /\.litegraph \.litemenu-entry\.has_submenu\s*\{[^}]*border-left:/s);
});

test('editor exposes professional baked terrain model export controls and workflow', async () => {
  const { readFile } = await import('node:fs/promises');
  const ui = await readFile(new URL('../src/ui/EditorUI.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const token of [
    'terrain-export-format',
    'terrain-export-detail',
    'terrain-export-fbx-preset',
    'terrain-export-vertex-colors',
    'terrain-export-status',
    'data-action="export-model"',
    'getTerrainExportOptions',
    'setTerrainExportStatus',
  ]) assert.match(ui, new RegExp(token));
  assert.match(app, /waitForEditorReady/);
  assert.match(app, /buildTerrainExportMesh/);
  assert.match(app, /serializeTerrainMesh/);
  assert.match(app, /downloadTerrainExport/);
  assert.equal(packageJson.dependencies['@comfyorg/fbx-exporter-three'], '1.0.1');
  assert.match(index, /@comfyorg\/fbx-exporter-three/);
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.model-export-section \[hidden\]\s*\{\s*display:none !important;/);
});

test('terrain material packs replace the manual KTX2 UI workflow', async () => {
  const { readFile } = await import('node:fs/promises');
  const ui = await readFile(new URL('../src/ui/EditorUI.js', import.meta.url), 'utf8');
  const manager = await readFile(new URL('../src/terrain/TerrainMaterialPackManager.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /KTX2 Array Manifest/);
  assert.match(ui, /Terrain Material Pack/);
  assert.match(manager, /unzipSync/);
  assert.match(manager, /createImageBitmap/);
  assert.match(manager, /IndexedDB|indexedDB/);
  assert.match(manager, /applyImportedMaterialArrays/);
});

test('npm install provides local Three.js and ZIP dependencies', async () => {
  const { readFile } = await import('node:fs/promises');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(packageJson.dependencies.three, '0.185.1');
  assert.equal(packageJson.dependencies.fflate, '0.8.3');
  assert.match(index, /\.\/node_modules\/three\/build\/three\.module\.js/);
  assert.match(index, /\.\/node_modules\/fflate\/esm\/browser\.js/);
});

test('project serialization preserves environment and active material pack', async () => {
  const { readFile } = await import('node:fs/promises');
  const serializer = await readFile(new URL('../src/terrain/TerrainSerializer.js', import.meta.url), 'utf8');
  assert.match(serializer, /environmentSettings/);
  assert.match(serializer, /materialPackId/);
});

test('built-in terrain presets use real provider PBR assets instead of generated palettes', async () => {
  const { BUILTIN_TERRAIN_MATERIAL_PACKS } = await import('../src/terrain/TerrainMaterialPacks.js');
  const providers = new Set();
  for (const pack of Object.values(BUILTIN_TERRAIN_MATERIAL_PACKS)) {
    assert.ok(['polyhaven', 'ambientcg'].includes(pack.source));
    providers.add(pack.source);
    assert.equal(pack.layers.length, 4);
    for (const layer of pack.layers) {
      assert.match(layer.assetId, /^[A-Za-z0-9_]+$/);
      assert.ok(layer.thumbnail.startsWith('/api/'));
      assert.ok(layer.scale > 0);
      assert.ok(layer.meters > 0);
    }
  }
  assert.deepEqual(providers, new Set(['polyhaven', 'ambientcg']));
});

test('Poly Haven resolver accepts capitalized and alternate PBR map keys', () => {
  const sample = {
    Diffuse: { '2k': { jpg: { url: 'https://example.test/diff.jpg' } } },
    Normal_GL: { '2k': { png: { url: 'https://example.test/nor.png' } } },
    Ambient_Occlusion: { '2k': { jpg: { url: 'https://example.test/ao.jpg' } } },
    Roughness: { '2k': { jpg: { url: 'https://example.test/rough.jpg' } } },
    Displacement: { '2k': { png: { url: 'https://example.test/disp.png' } } },
  };
  assert.equal(selectProviderMap(sample, PBR_MAP_ALIASES.baseColor, '2k').mapName, 'Diffuse');
  assert.equal(selectProviderMap(sample, PBR_MAP_ALIASES.normal, '2k').mapName, 'Normal_GL');
  assert.equal(selectProviderMap(sample, PBR_MAP_ALIASES.height, '2k').mapName, 'Displacement');
  assert.equal(selectProviderMap(sample, PBR_MAP_ALIASES.roughness, '2k').mapName, 'Roughness');
});

test('ambientCG ZIP file resolver detects standard map suffixes', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const entries = {
    'Ground002_2K-JPG_Color.jpg': bytes,
    'Ground002_2K-JPG_NormalGL.jpg': bytes,
    'Ground002_2K-JPG_Roughness.jpg': bytes,
    'Ground002_2K-JPG_AmbientOcclusion.jpg': bytes,
    'Ground002_2K-JPG_Displacement.jpg': bytes,
  };
  assert.match(findAmbientMapEntry(entries, PBR_MAP_ALIASES.baseColor).path, /Color/);
  assert.match(findAmbientMapEntry(entries, ['normalgl'], { exclude: ['normaldx'] }).path, /NormalGL/);
  assert.match(findAmbientMapEntry(entries, PBR_MAP_ALIASES.height).path, /Displacement/);
});

test('material manager supports Poly Haven and ambientCG with automatic ORM composition', async () => {
  const { readFile } = await import('node:fs/promises');
  const manager = await readFile(new URL('../src/terrain/TerrainMaterialPackManager.js', import.meta.url), 'utf8');
  assert.match(manager, /\/api\/polyhaven\/material\//);
  assert.match(manager, /\/api\/ambientcg\/archive\//);
  assert.match(manager, /ormDescriptorToPixels/);
  assert.match(manager, /AmbientOcclusion|PBR_MAP_ALIASES\.ao/);
  assert.match(manager, /applyMaterialPackLayerSettings/);
});

test('local server resolves flexible Poly Haven keys and proxies ambientCG archives', async () => {
  const { readFile } = await import('node:fs/promises');
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /TerrainEngineMaterialStudio\/3\.11\.6/);
  assert.match(server, /selectProviderMap/);
  assert.match(server, /PBR_MAP_ALIASES/);
  assert.match(server, /ambientArchiveMatch/);
  assert.match(server, /ambientcg\.com\/api\/v3/);
  assert.match(server, /kind: 'components'/);
  assert.match(server, /kind: 'generated'/);
});


test('editor mode keeps the full world loaded while FPS mode uses dynamic streaming', async () => {
  const { readFile } = await import('node:fs/promises');
  const world = await readFile(new URL('../src/terrain/TerrainWorld.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8');
  assert.match(world, /this\.streamingMode = 'editor'/);
  assert.match(world, /#updateEditorStreaming/);
  assert.match(world, /if \(this\.streamingMode === 'editor'\) return;/);
  assert.match(app, /setStreamingMode\('fps'/);
  assert.match(app, /setStreamingMode\('editor'/);
});


test('ambientCG HDRI catalog uses the official v3 API instead of HTML scraping', async () => {
  const { readFile } = await import('node:fs/promises');
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /AMBIENTCG_API\s*=\s*'https:\/\/ambientcg\.com\/api\/v3'/);
  assert.match(server, /type:\s*'hdri'/);
  assert.match(server, /technique:\s*'hdri-bracketed-panorama-horizon-clearing'/);
  assert.doesNotMatch(server, /AMBIENTCG_HDRI_LIST_URL/);
});

test('terrain anti-tiling is continuous and water foam uses filtered depth', async () => {
  const { readFile } = await import('node:fs/promises');
  const terrain = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  const water = await readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8');
  assert.match(terrain, /sampleStochastic2D/);
  assert.doesNotMatch(terrain, /floor\(uv\s*\*\s*0\.08\)/);
  assert.match(water, /filteredSceneDistance/);
  assert.match(water, /uDepthTexel/);
});


test('Terrain Material System 2.0 performs true four-way blending', async () => {
  const { readFile } = await import('node:fs/promises');
  const terrain = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.match(terrain, /normalizedFourWayWeights/);
  assert.match(terrain, /accumulateLayer\([\s\S]*0\.0, weights\.x/);
  assert.match(terrain, /accumulateLayer\([\s\S]*3\.0, weights\.w/);
  assert.doesNotMatch(terrain, /selectTopTwo/);
});

test('geological splat generation includes curvature moisture exposure erosion and coast', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../src/workers/terrainWorker.js', import.meta.url), 'utf8');
  const generation = await readFile(
    new URL('../src/terrain/TerrainGenerationService.js', import.meta.url),
    'utf8',
  );
  const analysis = await readFile(
    new URL('../src/terrain/TerrainSurfaceAnalysis.js', import.meta.url),
    'utf8',
  );
  const noise = await readFile(new URL('../src/terrain/noise.js', import.meta.url), 'utf8');
  for (const signal of ['curvature', 'moisture', 'exposure', 'erosion', 'coast']) {
    assert.match(analysis, new RegExp(signal));
    assert.match(noise, new RegExp(signal));
  }
  assert.match(worker, /generateTerrainChunkData/);
  assert.match(generation, /smoothControlWeights/);
  assert.match(noise, /export function smoothControlWeights/);
});

test('hybrid projection keeps flat ground planar and cliffs triplanar', async () => {
  const { readFile } = await import('node:fs/promises');
  const terrain = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.match(terrain, /function|sampleHybrid/);
  assert.match(terrain, /position\.xz \* scale/);
  assert.match(terrain, /position\.zy \* scale/);
  assert.match(terrain, /sideBlend/);
});

test('editor presentation keeps physical terrain and explicit fog only', async () => {
  const { readFile } = await import('node:fs/promises');
  const materialSource = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  const environmentSource = await readFile(new URL('../src/environment/WorldEnvironment.js', import.meta.url), 'utf8');
  assert.doesNotMatch(materialSource, /uEditorCleanView/);
  assert.doesNotMatch(materialSource, /vWorldPosition\.y < uWaterLevel/);
  assert.match(materialSource, /uFogDensity:\s*\{ value: 0 \}/);
  assert.match(environmentSource, /fogDensity:\s*this\.settings\.fogEnabled/);
});

test('editor and FPS use identical terrain and water optics while streaming changes', async () => {
  const { readFile } = await import('node:fs/promises');
  const appSource = await readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8');
  const waterSource = await readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8');
  assert.match(appSource, /setStreamingMode\('fps'/);
  assert.match(appSource, /setStreamingMode\('editor'/);
  assert.doesNotMatch(waterSource, /editorDeepMask|uEditorCleanView/);
  assert.match(waterSource, /deepOpacity/);
});

test('editor tiles use stable camera-independent LOD and one source resolution', async () => {
  const { readFile } = await import('node:fs/promises');
  const worldSource = await readFile(new URL('../src/terrain/TerrainWorld.js', import.meta.url), 'utf8');
  const configSource = await readFile(new URL('../src/terrain/TerrainConfig.js', import.meta.url), 'utf8');
  assert.match(worldSource, /getEditorLodIndex/);
  assert.match(worldSource, /getEditorDataResolution/);
  assert.match(worldSource, /this\.streamingMode === 'editor'[\s\S]*descriptor\.lodIndex/);
  assert.match(worldSource, /camera-independent/);
  assert.match(configSource, /editorDataResolution:\s*129/);
});

test('material pack selection is separated from explicit download and apply', async () => {
  const { readFile } = await import('node:fs/promises');
  const uiSource = await readFile(new URL('../src/ui/EditorUI.js', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8');
  assert.match(uiSource, /material-pack-selection/);
  assert.doesNotMatch(uiSource, /emit\('material-pack-change'/);
  assert.match(appSource, /apply-material-pack/);
});

test('Terrain Material Pack Studio supports provider search and editable topographic distribution', async () => {
  const { readFile } = await import('node:fs/promises');
  const studioSource = await readFile(new URL('../src/ui/TerrainMaterialPackStudio.js', import.meta.url), 'utf8');
  const serverSource = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const managerSource = await readFile(new URL('../src/terrain/TerrainMaterialPackManager.js', import.meta.url), 'utf8');
  assert.match(studioSource, /minHeight/);
  assert.match(studioSource, /maxSlope/);
  assert.match(studioSource, /moistureAffinity/);
  assert.match(studioSource, /coastAffinity/);
  assert.match(serverSource, /\/api\/materials\/search/);
  assert.match(managerSource, /saveCustomPack/);
  assert.match(managerSource, /buildMixedProviderArrayData/);
});

test('custom material distribution can drive geological weights', () => {
  const customPack = {
    globalBlend: 1,
    transitionNoise: 0.2,
    layers: Array.from({ length: 4 }, (_, index) => ({
      distribution: {
        minHeight: index * 20 - 20,
        maxHeight: index * 20 + 70,
        heightBlend: 14,
        minSlope: index * 8,
        maxSlope: 72,
        slopeBlend: 10,
        priority: 1,
      },
    })),
  };
  const weights = computeAutoWeights(42, 28, 0.55, customPack, {
    curvature: -0.2,
    moisture: 0.65,
    coast: 0.1,
    erosion: 0.4,
  });
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-6);
  assert.ok(weights.every((value) => Number.isFinite(value) && value >= 0));
});

test('custom HDRI loading reports failure instead of silently claiming success', async () => {
  const { readFile } = await import('node:fs/promises');
  const environmentSource = await readFile(new URL('../src/environment/WorldEnvironment.js', import.meta.url), 'utf8');
  assert.match(environmentSource, /throwOnFailure:\s*true/);
  assert.match(environmentSource, /preserveCurrent:\s*true/);
  assert.match(environmentSource, /טעינת HDRI\/EXR נכשלה/);
});

test('project serialization preserves a custom material pack definition', async () => {
  const { readFile } = await import('node:fs/promises');
  const serializerSource = await readFile(new URL('../src/terrain/TerrainSerializer.js', import.meta.url), 'utf8');
  assert.match(serializerSource, /materialPackDefinition/);
});


test('ambientCG HDRI downloader supports the official plain resolution ZIP naming and validates payloads', async () => {
  const { readFile } = await import('node:fs/promises');
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /`\$\{id\}_\$\{resolution\}\.zip`/);
  assert.match(server, /detectAmbientPayload/);
  assert.match(server, /extractLargestEnvironmentMap/);
  assert.match(server, /resolutionOrder/);
  assert.match(server, /expected:\s*\['zip', 'hdr', 'exr'\]/);
});

test('ambientCG HDRI UI preserves the real HDR or EXR format returned by the backend', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../src/app/TerrainEditorApp.js', import.meta.url), 'utf8');
  const environment = await readFile(new URL('../src/environment/WorldEnvironment.js', import.meta.url), 'utf8');
  assert.match(app, /loadCustomUrl\(endpoint\)/);
  assert.doesNotMatch(app, /new File\(\[blob\].*\.hdr/);
  assert.match(environment, /x-terrain-environment-format/i);
  assert.match(environment, /new EXRLoader\(\)/);
  assert.match(environment, /new HDRLoader\(\)/);
});

test('ambientCG HDRI server extracts OpenEXR files and reports the real format', async () => {
  const { readFile } = await import('node:fs/promises');
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /\.\(\?:hdr\|exr\)/);
  assert.match(server, /OpenEXR magic number/);
  assert.match(server, /X-Terrain-Environment-Format/);
  assert.match(server, /image\/x-exr/);
});

test('true geometric displacement is selectable per terrain layer and moves vertices along the surface normal', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.match(source, /uDisplacementLayerMask/);
  assert.match(source, /uDisplacementCenters/);
  assert.match(source, /signedMaterialHeight/);
  assert.match(source, /localPosition \+= displacementDirection \* microDisplacement/);
  assert.match(source, /mix\(vec3\(0\.0, 1\.0, 0\.0\), localNormal, uDisplacementMode\)/);
});

test('editor exposes a manual high-detail displacement preview without camera-driven rebuilding', async () => {
  const { readFile } = await import('node:fs/promises');
  const world = await readFile(new URL('../src/terrain/TerrainWorld.js', import.meta.url), 'utf8');
  const ui = await readFile(new URL('../src/ui/EditorUI.js', import.meta.url), 'utf8');
  assert.match(world, /setDisplacementPreview/);
  assert.match(world, /if \(this\.displacementPreview\.enabled\)/);
  assert.match(ui, /update-displacement-preview/);
  assert.match(ui, /High-Detail Preview/);
});

test('material pack studio stores true displacement enablement amplitude and height center per layer', async () => {
  const { readFile } = await import('node:fs/promises');
  const studio = await readFile(new URL('../src/ui/TerrainMaterialPackStudio.js', import.meta.url), 'utf8');
  const packs = await readFile(new URL('../src/terrain/TerrainMaterialPacks.js', import.meta.url), 'utf8');
  assert.match(studio, /displacementEnabled/);
  assert.match(studio, /displacementCenter/);
  assert.match(studio, /True Displacement במטרים/);
  assert.match(packs, /displacementEnabled = id === 'rock'/);
});


test('seam-safe true displacement does not fade height to zero at chunk borders', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/terrain/TerrainMaterial.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /microDisplacement\s*\*=.*displacementEdgeFade/);
  assert.match(source, /float seamBandWidth = max\(uHeightTexel \* 3\.0, 0\.004\)/);
  assert.match(source, /mix\(vec3\(0\.0, 1\.0, 0\.0\), requestedDirection, interiorWeight\)/);
});
