# Terrain Graph Material Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the terrain graph into the source of truth for both terrain geometry and the four-layer PBR material distribution, with matching Height, Materials, Slope, Moisture, and Erosion previews.

**Architecture:** One graph compiles into a height `terrainProgram` and a declarative `materialProgram`. A shared surface-analysis module calculates the physical signals used by synchronous generation, chunk workers, and Preview; a shared material evaluator converts those signals into normalized four-channel weights. Build resolves and prepares the selected PBR pack before committing graph settings to the world.

**Tech Stack:** JavaScript ES modules, Three.js, LiteGraph, Web Workers, Node test runner, Canvas 2D, existing Terrain Material Pack Manager and Material Pack Studio.

**Repository note:** This workspace is not a Git repository, so the commit checkpoints below are verification checkpoints only. Do not initialize Git or rewrite unrelated user files.

---

## File Map

- Create `src/terrain/TerrainSurfaceAnalysis.js`: canonical slope, variation, curvature, moisture, coast, exposure, and erosion calculations.
- Create `src/terrain/TerrainMaterialGraph.js`: material graph compiler, mask evaluator, layer-rule evaluator, and normalized four-channel weight evaluator.
- Modify `src/terrain/TerrainGraphModel.js`: graph version 2, material/mask node schemas, migration, default material branch, and socket validation.
- Modify `src/terrain/TerrainGraphCompiler.js`: compile one graph into `{ terrainProgram, materialProgram }`.
- Modify `src/terrain/noise.js`: route graph-driven weight calculation through the shared material evaluator.
- Modify `src/terrain/TerrainGenerationService.js`, `src/workers/terrainWorker.js`, and `src/terrain/TerrainChunk.js`: use the canonical surface-analysis context and material program.
- Modify `src/terrain/TerrainWorld.js`: retain and distribute the compiled material program during generation.
- Modify `src/terrain/TerrainMaterialPackManager.js`: prepare/cache pack assets separately from committing them.
- Modify `src/terrain/TerrainGraphPreview.js` and `src/workers/terrainGraphWorker.js`: cache analysis buffers and recolor five preview modes.
- Modify `src/ui/TerrainGraphEditor.js`: render material nodes, typed sockets, pack/layer dropdowns, and inspector commands.
- Modify `src/ui/EditorUI.js`, `src/ui/styles.css`, and `src/app/TerrainEditorApp.js`: preview mode controls, legends, pack-catalog wiring, staged Build, and user-facing errors.
- Modify project serialization/import code reached from `src/app/TerrainEditorApp.js`: preserve version 2 graphs and custom pack dependencies.
- Add and extend tests in `tests/TerrainGraphModel.test.js`, `tests/TerrainGraphCompiler.test.js`, `tests/TerrainGraphPreview.test.js`, `tests/TerrainMaterialGraph.test.js`, and `tests/terrain.test.js`.

### Task 1: Canonical Surface Analysis

**Files:**
- Create: `src/terrain/TerrainSurfaceAnalysis.js`
- Create: `tests/TerrainSurfaceAnalysis.test.js`
- Modify: `src/terrain/TerrainGenerationService.js`
- Modify: `src/workers/terrainWorker.js`
- Modify: `src/terrain/TerrainChunk.js`

- [ ] **Step 1: Write deterministic analysis tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeTerrainSurface,
  normalizeSurfaceAnalysis,
} from '../src/terrain/TerrainSurfaceAnalysis.js';

test('flat samples produce zero slope and curvature', () => {
  const result = analyzeTerrainSurface({
    center: 20, left: 20, right: 20, down: 20, up: 20,
    step: 2, worldX: 10, worldZ: 12, seed: 1337, waterLevel: -3,
  });
  assert.equal(result.slope, 0);
  assert.equal(result.curvature, 0);
  assert.equal(result.coast, 0);
});

test('analysis is deterministic and normalized for material evaluation', () => {
  const input = {
    center: 4, left: 2, right: 8, down: 3, up: 7,
    step: 2, worldX: 10, worldZ: 12, seed: 1337, waterLevel: -3,
  };
  const first = normalizeSurfaceAnalysis(analyzeTerrainSurface(input));
  const second = normalizeSurfaceAnalysis(analyzeTerrainSurface(input));
  assert.deepEqual(first, second);
  for (const key of ['slope', 'variation', 'moisture', 'exposure', 'coast', 'erosion']) {
    assert.ok(first[key] >= 0 && first[key] <= 1, key);
  }
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `node --test tests/TerrainSurfaceAnalysis.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `TerrainSurfaceAnalysis.js`.

- [ ] **Step 3: Implement one shared analysis function**

```js
const clamp01 = (value) => Math.min(1, Math.max(0, value));

export function analyzeTerrainSurface(sample) {
  const step = Math.max(0.0001, Number(sample.step) || 1);
  const dx = (sample.right - sample.left) / (2 * step);
  const dz = (sample.up - sample.down) / (2 * step);
  const slopeRadians = Math.atan(Math.hypot(dx, dz));
  const curvature =
    sample.left + sample.right + sample.down + sample.up - 4 * sample.center;
  const variation = Math.max(
    Math.abs(sample.center - sample.left),
    Math.abs(sample.center - sample.right),
    Math.abs(sample.center - sample.down),
    Math.abs(sample.center - sample.up),
  );
  const coast = 1 - clamp01(Math.abs(sample.center - sample.waterLevel) / 12);
  const exposure = clamp01(0.5 + curvature * 0.04);
  const moisture = clamp01(
    coast * 0.65 + (1 - exposure) * 0.25 + deterministicNoise(sample) * 0.1,
  );
  const erosion = clamp01(
    Math.sin(slopeRadians) * 0.55 + clamp01(variation / 18) * 0.3
      + clamp01(Math.abs(curvature) / 20) * 0.15,
  );
  return {
    height: sample.center,
    slopeRadians,
    slopeDegrees: slopeRadians * 180 / Math.PI,
    variation,
    curvature,
    moisture,
    exposure,
    coast,
    erosion,
    waterLevel: sample.waterLevel,
  };
}

export function normalizeSurfaceAnalysis(analysis) {
  return {
    ...analysis,
    slope: clamp01(analysis.slopeDegrees / 90),
    variation: clamp01(analysis.variation / 24),
    curvature: Math.max(-1, Math.min(1, analysis.curvature / 20)),
    moisture: clamp01(analysis.moisture),
    exposure: clamp01(analysis.exposure),
    coast: clamp01(analysis.coast),
    erosion: clamp01(analysis.erosion),
  };
}
```

The private `deterministicNoise` must use the existing coordinate hash formula copied exactly from the three generation call sites, so this extraction changes ownership but not current terrain output.

- [ ] **Step 4: Replace duplicated analysis blocks**

Import `analyzeTerrainSurface` and `normalizeSurfaceAnalysis` in the synchronous generator, worker generator, and chunk updater. Pass the returned object into `writeAutoWeights` without changing geometry calculations.

- [ ] **Step 5: Run focused and regression tests**

Run: `node --test tests/TerrainSurfaceAnalysis.test.js tests/terrain.test.js`

Expected: PASS with unchanged legacy splat-weight assertions.

- [ ] **Step 6: Verification checkpoint**

Run: `node --test`

Expected: all existing tests and the new surface-analysis tests pass.

### Task 2: Material Program Compiler And Evaluator

**Files:**
- Create: `src/terrain/TerrainMaterialGraph.js`
- Create: `tests/TerrainMaterialGraph.test.js`

- [ ] **Step 1: Write compiler and evaluator tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileTerrainMaterialGraph,
  evaluateTerrainMaterialProgram,
  evaluateRangeMask,
} from '../src/terrain/TerrainMaterialGraph.js';

test('range masks blend at boundaries and support inversion', () => {
  assert.equal(evaluateRangeMask(0.5, 0.25, 0.75, 0.1, false), 1);
  assert.equal(evaluateRangeMask(0.2, 0.25, 0.75, 0.1, false), 0.5);
  assert.equal(evaluateRangeMask(0.2, 0.25, 0.75, 0.1, true), 0.5);
  assert.equal(evaluateRangeMask(0, 0.25, 0.75, 0.1, true), 1);
});

test('biome blend transfers weight and keeps four channels normalized', () => {
  const program = {
    version: 1,
    packId: 'mediterranean',
    globalBlend: 1,
    transitionNoise: 0,
    masks: [{ id: 'wet', type: 'moistureErosion', minMoisture: 0.5,
      maxMoisture: 1, moistureBlend: 0, minErosion: 0, maxErosion: 1,
      erosionBlend: 0, invert: false }],
    distributionRules: [],
    biomeBlends: [{ maskId: 'wet', fromLayer: 2, toLayer: 1, strength: 0.5 }],
  };
  const weights = evaluateTerrainMaterialProgram(
    program,
    { moisture: 1, erosion: 0, height: 10, slope: 0, curvature: 0, coast: 0 },
    [0.1, 0.1, 0.8, 0],
  );
  assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-8);
  assert.deepEqual(weights.map((value) => Number(value.toFixed(3))), [0.1, 0.5, 0.4, 0]);
});

test('compiler rejects a missing pack dependency', () => {
  assert.throws(
    () => compileTerrainMaterialGraph(materialGraph('missing-pack'), {
      packCatalog: [{ id: 'mediterranean' }],
    }),
    /missing-pack/,
  );
});
```

Define `materialGraph(packId)` in the test as a minimal `Material Pack -> Material Output` graph with a connected terrain input.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/TerrainMaterialGraph.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement declarative material compilation**

```js
export function compileTerrainMaterialGraph(graph, { packCatalog = [] } = {}) {
  const terminal = findMaterialOutput(graph);
  if (!terminal) return null;
  const nodes = indexNodes(graph.nodes);
  const materialChain = traceInput(nodes, graph.links, terminal.id, 'material');
  const packNode = materialChain.find((node) => node.type === 'material/pack');
  if (!packNode) throw graphError(terminal, 'Material input requires a Material Pack');
  const packId = String(packNode.properties.packId || '');
  if (!packCatalog.some((pack) => pack.id === packId)) {
    throw graphError(packNode, `Missing material pack "${packId}"`);
  }
  return {
    version: 1,
    packId,
    globalBlend: finite(packNode.properties.globalBlend, 1),
    transitionNoise: finite(packNode.properties.transitionNoise, 0.08),
    masks: compileMasks(nodes, graph.links, materialChain),
    distributionRules: compileDistributionRules(materialChain),
    biomeBlends: compileBiomeBlends(materialChain, graph.links),
  };
}
```

Every compiler helper must validate numeric ranges and include the offending node title in thrown errors. Layer values compile to channel indexes: Sand `0`, Grass `1`, Soil `2`, Rock `3`.

- [ ] **Step 4: Implement deterministic mask and weight evaluation**

```js
export function evaluateRangeMask(value, min, max, blend, invert = false) {
  if (min > max) throw new Error(`Invalid range: ${min} is greater than ${max}`);
  const width = Math.max(0, blend);
  const lower = width === 0 ? Number(value >= min) : smoothstep(min - width, min + width, value);
  const upper = width === 0 ? Number(value <= max) : 1 - smoothstep(max - width, max + width, value);
  const result = clamp01(lower * upper);
  return invert ? 1 - result : result;
}

export function evaluateTerrainMaterialProgram(program, context, baseWeights) {
  const weights = normalizeWeights(baseWeights);
  const masks = evaluateMasks(program.masks, context);
  applyDistributionRules(weights, program.distributionRules, context);
  applyBiomeBlends(weights, program.biomeBlends, masks);
  return normalizeWeights(weights);
}
```

- [ ] **Step 5: Run material graph tests**

Run: `node --test tests/TerrainMaterialGraph.test.js`

Expected: PASS for mask boundaries, inversion, missing packs, deterministic compile, biome transfer, and normalization.

- [ ] **Step 6: Verification checkpoint**

Run: `node --test tests/TerrainMaterialGraph.test.js tests/terrain.test.js`

Expected: PASS.

### Task 3: Graph Version 2 And Node Schemas

**Files:**
- Modify: `src/terrain/TerrainGraphModel.js`
- Modify: `tests/TerrainGraphModel.test.js`

- [ ] **Step 1: Add failing migration, schema, and validation tests**

```js
test('version 1 graphs migrate without changing the height branch', () => {
  const legacy = createDefaultTerrainGraph();
  legacy.version = 1;
  legacy.nodes = legacy.nodes.filter((node) => !node.type.startsWith('material/'));
  const normalized = normalizeTerrainGraph(legacy);
  assert.equal(normalized.version, 2);
  assert.ok(normalized.nodes.some((node) => node.type === 'terrain/output'));
});

test('new graphs expose typed material and mask nodes', () => {
  assert.equal(TERRAIN_GRAPH_VERSION, 2);
  assert.equal(TERRAIN_NODE_DEFINITIONS['material/pack'].outputs[0].type, 'material');
  assert.equal(TERRAIN_NODE_DEFINITIONS['mask/heightSlope'].outputs[0].type, 'mask');
  assert.equal(TERRAIN_NODE_DEFINITIONS['terrain/materialOutput'].inputs[1].type, 'material');
});

test('a graph cannot contain two effective terminals', () => {
  const graph = createDefaultTerrainGraph();
  graph.nodes.push(makeNode('terrain/output', 999));
  assert.throws(() => validateTerrainGraph(graph), /one effective output/i);
});
```

- [ ] **Step 2: Run tests and verify schema failures**

Run: `node --test tests/TerrainGraphModel.test.js`

Expected: FAIL because the version is `1` and material node definitions do not exist.

- [ ] **Step 3: Add complete property metadata**

Each property descriptor must include UI metadata rather than relying on value inference:

```js
packId: { default: 'mediterranean', widget: 'combo', optionsSource: 'materialPacks' },
layer: { default: 'sand', widget: 'combo', options: ['sand', 'grass', 'soil', 'rock'] },
invert: { default: false, widget: 'toggle' },
minSlope: { default: 0, widget: 'number', min: 0, max: 90, step: 1 },
maxSlope: { default: 90, widget: 'number', min: 0, max: 90, step: 1 },
```

Add definitions for `material/pack`, `material/layerDistribution`, `mask/heightSlope`, `mask/moistureErosion`, `material/biomeBlend`, and `terrain/materialOutput`.

- [ ] **Step 4: Implement explicit version migration**

```js
export function normalizeTerrainGraph(input, fallbackSettings = {}) {
  const sourceVersion = Number(input?.version || 1);
  const normalized = normalizeGraphShape(input, fallbackSettings);
  if (sourceVersion === 1) return migrateVersion1Graph(normalized);
  if (sourceVersion !== TERRAIN_GRAPH_VERSION) {
    throw new Error(`Unsupported terrain graph version ${sourceVersion}`);
  }
  return normalized;
}
```

Migration keeps the legacy `terrain/output` and active project material behavior. A newly created graph includes `Material Pack -> Material Output` and connects the island terrain to its terrain socket.

- [ ] **Step 5: Validate effective terminals and typed links**

Reject unknown nodes, links between incompatible socket types, unconnected required inputs, and any graph containing both a legacy Terrain Output and Material Output.

- [ ] **Step 6: Run model tests**

Run: `node --test tests/TerrainGraphModel.test.js`

Expected: PASS, including the prior stale `terrainProgram` regression test.

- [ ] **Step 7: Verification checkpoint**

Run: `node --test tests/TerrainGraphModel.test.js tests/TerrainGraphCompiler.test.js`

Expected: PASS.

### Task 4: Dual Pipeline Compilation And World Weight Parity

**Files:**
- Modify: `src/terrain/TerrainGraphCompiler.js`
- Modify: `src/terrain/noise.js`
- Modify: `src/terrain/TerrainGenerationService.js`
- Modify: `src/workers/terrainWorker.js`
- Modify: `src/terrain/TerrainChunk.js`
- Modify: `src/terrain/TerrainWorld.js`
- Modify: `tests/TerrainGraphCompiler.test.js`
- Modify: `tests/terrain.test.js`

- [ ] **Step 1: Write failing dual-compiler and parity tests**

```js
test('compileTerrainPipeline returns height and material programs', () => {
  const graph = createDefaultTerrainGraph();
  const result = compileTerrainPipeline(graph, {
    packCatalog: [{ id: 'mediterranean' }],
  });
  assert.equal(result.terrainProgram.version, 1);
  assert.equal(result.materialProgram.packId, 'mediterranean');
});

test('graph material weights match preview and generation evaluation', () => {
  const context = normalizedFixtureSurface();
  const program = fixtureMaterialProgram();
  const generated = computeAutoWeights(20, 0.3, 1337, program, context);
  const shared = evaluateTerrainMaterialProgram(
    program,
    context,
    computeLegacyBaseWeights(20, 0.3, 1337, program.splatPreset, context),
  );
  assert.deepEqual(generated.map(round6), shared.map(round6));
});
```

- [ ] **Step 2: Run tests and verify missing API failures**

Run: `node --test tests/TerrainGraphCompiler.test.js tests/terrain.test.js`

Expected: FAIL because `compileTerrainPipeline` and graph-driven weight routing do not exist.

- [ ] **Step 3: Add the dual compiler**

```js
export function compileTerrainPipeline(graph, options = {}) {
  validateTerrainGraph(graph);
  return {
    terrainProgram: compileTerrainGraph(graph),
    materialProgram: compileTerrainMaterialGraph(graph, options),
  };
}
```

Keep `compileTerrainGraph` exported for legacy callers and focused height tests.

- [ ] **Step 4: Route weight calculation through `materialProgram`**

`computeAutoWeights` first computes the existing pack/preset base weights. When its distribution argument is a compiled material program, call `evaluateTerrainMaterialProgram(program, context, baseWeights)`. Keep all legacy preset and custom distribution paths unchanged.

- [ ] **Step 5: Propagate `materialProgram` to every generation path**

Add `materialProgram` to `TerrainWorld`, worker messages, synchronous generation options, and chunk regeneration options. The object must remain structured-cloneable. `writeAutoWeights` receives `materialProgram ?? materialDistribution ?? presetId`.

- [ ] **Step 6: Run compiler and terrain parity tests**

Run: `node --test tests/TerrainGraphCompiler.test.js tests/TerrainMaterialGraph.test.js tests/terrain.test.js`

Expected: PASS with byte-equivalent normalized graph weights across direct and generation paths.

- [ ] **Step 7: Verification checkpoint**

Run: `node --test`

Expected: all tests pass.

### Task 5: Prepared Material Pack Cache And Atomic Build

**Files:**
- Modify: `src/terrain/TerrainMaterialPackManager.js`
- Modify: `src/terrain/TerrainWorld.js`
- Modify: `src/app/TerrainEditorApp.js`
- Create: `tests/TerrainMaterialPackManager.test.js`

- [ ] **Step 1: Write cache and failure tests with injected fakes**

```js
test('preparePack reuses a prepared pack without downloading twice', async () => {
  let builds = 0;
  const manager = createManager({
    buildPackArrays: async () => { builds += 1; return fixtureArrays(); },
  });
  const first = await manager.preparePack('mediterranean');
  const second = await manager.preparePack('mediterranean');
  assert.equal(builds, 1);
  assert.equal(first, second);
});

test('failed preparation does not change the active pack', async () => {
  const manager = createManager({
    activePackId: 'alpine',
    buildPackArrays: async () => { throw new Error('network failed'); },
  });
  await assert.rejects(manager.preparePack('mediterranean'), /network failed/);
  assert.equal(manager.activePackId, 'alpine');
});
```

- [ ] **Step 2: Run tests and verify missing method failure**

Run: `node --test tests/TerrainMaterialPackManager.test.js`

Expected: FAIL because `preparePack` is not defined.

- [ ] **Step 3: Split preparation from commit**

```js
async preparePack(id) {
  const pack = this.getPack(id);
  if (!pack) throw new Error(`Missing material pack "${id}"`);
  const cacheKey = this.#getPreparedCacheKey(pack);
  if (!this.preparedPackCache.has(cacheKey)) {
    this.preparedPackCache.set(cacheKey, this.#buildPreparedPack(pack)
      .catch((error) => {
        this.preparedPackCache.delete(cacheKey);
        throw error;
      }));
  }
  return this.preparedPackCache.get(cacheKey);
}

commitPreparedPack(prepared, materialProgram = null) {
  this.materialLibrary.applyImportedMaterialArrays(prepared.arrays);
  this.materialLibrary.applyMaterialPackLayerSettings(prepared.pack);
  this.world.applyMaterialPackDistribution(prepared.pack);
  this.world.materialProgram = materialProgram;
  this.activePackId = prepared.pack.id;
}
```

`applyPack(id)` remains compatible by calling `preparePack` then `commitPreparedPack`.

- [ ] **Step 4: Stage Build in `TerrainEditorApp`**

Compile both programs, resolve and prepare the pack, then commit UI/world state and call world generation:

```js
const pipeline = compileTerrainPipeline(graph, { packCatalog: manager.getCatalog() });
const prepared = pipeline.materialProgram
  ? await manager.preparePack(pipeline.materialProgram.packId)
  : null;
const nextSettings = deriveSettingsFromTerrainGraph(graph, currentSettings);
if (prepared) manager.commitPreparedPack(prepared, pipeline.materialProgram);
world.terrainProgram = pipeline.terrainProgram;
world.materialProgram = pipeline.materialProgram;
await world.generate(nextSettings);
```

On compile or preparation failure, do not mutate active pack, settings, material library, or world program. Show the failing stage in the graph status.

- [ ] **Step 5: Run manager and app-adjacent tests**

Run: `node --test tests/TerrainMaterialPackManager.test.js tests/TerrainGraphCompiler.test.js tests/terrain.test.js`

Expected: PASS.

- [ ] **Step 6: Verification checkpoint**

Run: `node --test`

Expected: all tests pass.

### Task 6: Cached Five-Mode Preview

**Files:**
- Modify: `src/terrain/TerrainGraphPreview.js`
- Modify: `src/workers/terrainGraphWorker.js`
- Modify: `tests/TerrainGraphPreview.test.js`

- [ ] **Step 1: Write failing mode and cache tests**

```js
for (const mode of ['height', 'materials', 'slope', 'moisture', 'erosion']) {
  test(`renders ${mode} preview with a legend`, () => {
    const result = renderTerrainPreview({
      ...previewFixture(),
      mode,
      materialProgram: fixtureMaterialProgram(),
      materialLayers: fixtureLayerColors(),
    });
    assert.equal(result.pixels.length, result.width * result.height * 4);
    assert.equal(result.mode, mode);
    assert.ok(result.legend.length > 0);
  });
}

test('recoloring cached preview data does not resample terrain', () => {
  let samples = 0;
  const cache = sampleTerrainPreviewData({
    ...previewFixture(),
    sampleHeight: (...args) => { samples += 1; return fixtureHeight(...args); },
  });
  const count = samples;
  colorizeTerrainPreview(cache, 'height');
  colorizeTerrainPreview(cache, 'materials');
  assert.equal(samples, count);
});
```

- [ ] **Step 2: Run tests and verify missing API failures**

Run: `node --test tests/TerrainGraphPreview.test.js`

Expected: FAIL because sampling and colorization are not separate APIs.

- [ ] **Step 3: Separate sampling from colorization**

`sampleTerrainPreviewData` creates transferable `Float32Array` buffers for height, normalized slope, moisture, erosion, and four material weights per pixel. It records min/max statistics and a graph revision key.

- [ ] **Step 4: Implement professional color ramps**

```js
const PREVIEW_MODES = Object.freeze(['height', 'materials', 'slope', 'moisture', 'erosion']);

export function colorizeTerrainPreview(cache, mode, layerColors = []) {
  if (!PREVIEW_MODES.includes(mode)) throw new Error(`Unknown preview mode "${mode}"`);
  if (mode === 'materials') return colorizeMaterialWeights(cache, layerColors);
  if (mode === 'height') return colorizeHeight(cache);
  if (mode === 'slope') return colorizeScalar(cache.slope, SLOPE_RAMP);
  if (mode === 'moisture') return colorizeScalar(cache.moisture, MOISTURE_RAMP);
  return colorizeScalar(cache.erosion, EROSION_RAMP);
}
```

Height uses neutral grayscale terrain, blue water, and subtle contour lines. Materials mixes actual four-channel weights with representative pack colors. Legends include units and real layer labels.

- [ ] **Step 5: Cache worker analysis by revision**

The worker message accepts `{ revision, mode }`. If revision and dimensions match the cached sample, mode changes only call `colorizeTerrainPreview`; graph/settings changes resample once. Return `{ mode, legend, stats, pixels }`.

- [ ] **Step 6: Run preview tests**

Run: `node --test tests/TerrainGraphPreview.test.js tests/TerrainMaterialGraph.test.js`

Expected: PASS for all modes, truthful legends, and no resampling during mode switches.

- [ ] **Step 7: Verification checkpoint**

Run: `node --test`

Expected: all tests pass.

### Task 7: Material Nodes And Inspector UX

**Files:**
- Modify: `src/ui/TerrainGraphEditor.js`
- Modify: `src/ui/styles.css`
- Modify: `src/app/TerrainEditorApp.js`

- [ ] **Step 1: Extend graph editor widget tests or DOM harness**

Add assertions to the existing graph editor test harness that:

```js
assert.deepEqual(editor.getComboValues('material/pack', 'packId'), [
  ['mediterranean', 'Mediterranean'],
  ['alpine', 'Alpine'],
]);
assert.deepEqual(editor.getComboValues('material/layerDistribution', 'layer'), [
  ['sand', 'Sand'], ['grass', 'Grass'], ['soil', 'Soil'], ['rock', 'Rock'],
]);
```

Also assert material sockets reject field links and that Edit Pack invokes the callback with the selected `packId`.

- [ ] **Step 2: Run the graph editor harness and verify failures**

Run the repository's UI test command from `package.json`; if no DOM test script exists, run `node --test` and use browser verification in Task 10 for LiteGraph behavior.

Expected: new combo APIs or assertions fail before implementation.

- [ ] **Step 3: Render widgets from schema metadata**

Add support for `widget: 'combo'`, `widget: 'toggle'`, and constrained `widget: 'number'`. Dynamic `optionsSource: 'materialPacks'` reads a catalog supplied by:

```js
editor.setMaterialPackCatalog(catalog.map(({ id, name }) => ({ value: id, label: name })));
```

Both LiteGraph node widgets and Selected Node Inspector must use the same property descriptors.

- [ ] **Step 4: Add Edit Pack command**

When a Material Pack node is selected, the inspector shows an icon plus `Edit Pack` command. It invokes `onEditMaterialPack(packId)` and opens the existing Material Pack Studio without creating a second editor.

- [ ] **Step 5: Keep graph interactions stable**

Preserve cursor-centered zoom, graph panel resizers, LTR context menu, selected-node visibility toggle, Auto Preview toggle, and readable node text at low zoom.

- [ ] **Step 6: Run static and automated tests**

Run: `node --check src/ui/TerrainGraphEditor.js`

Run: `node --test`

Expected: syntax valid and all tests pass.

### Task 8: Preview Controls, Legends, And Catalog Wiring

**Files:**
- Modify: `src/ui/EditorUI.js`
- Modify: `src/ui/styles.css`
- Modify: `src/app/TerrainEditorApp.js`
- Modify: `index.html`

- [ ] **Step 1: Add a five-option segmented control**

Render icon/text tabs in the Preview header:

```html
<div class="terrain-preview-modes" role="tablist" aria-label="Preview mode">
  <button role="tab" data-preview-mode="height" aria-selected="true">Height</button>
  <button role="tab" data-preview-mode="materials">Materials</button>
  <button role="tab" data-preview-mode="slope">Slope</button>
  <button role="tab" data-preview-mode="moisture">Moisture</button>
  <button role="tab" data-preview-mode="erosion">Erosion</button>
</div>
```

The control remains hidden with the entire Preview panel when Auto Preview is unchecked.

- [ ] **Step 2: Add a compact adaptive legend**

Use fixed swatches for scalar modes and four real layer swatches for Materials. The legend updates from worker result metadata and does not overlap the preview canvas at narrow inspector widths.

- [ ] **Step 3: Wire mode changes without rebuilding**

`EditorUI` emits `onTerrainPreviewModeChange(mode)`. `TerrainEditorApp` stores the selected mode and asks `TerrainGraphPreview` to recolor its current revision. Do not call `world.generate` or compile a new graph for a mode-only change.

- [ ] **Step 4: Wire pack catalogs everywhere**

After `TerrainMaterialPackManager.initialize()` and after custom pack save/import/delete, call both existing material UI refresh and `TerrainGraphEditor.setMaterialPackCatalog`.

- [ ] **Step 5: Update cache-busting query strings**

Increment local CSS and main-module query values in `index.html` so the browser loads the new controls and behavior.

- [ ] **Step 6: Run syntax and unit tests**

Run: `node --check src/ui/EditorUI.js`

Run: `node --check src/app/TerrainEditorApp.js`

Run: `node --test`

Expected: syntax valid and all tests pass.

### Task 9: Project Compatibility And Dependency Errors

**Files:**
- Modify: `src/app/TerrainEditorApp.js`
- Modify: `src/terrain/TerrainGraphModel.js`
- Modify: `tests/TerrainGraphModel.test.js`

- [ ] **Step 1: Write serialization round-trip tests**

```js
test('version 2 graph preserves material nodes and pack dependency', () => {
  const source = createDefaultTerrainGraph();
  const pack = source.nodes.find((node) => node.type === 'material/pack');
  pack.properties.packId = 'custom-cliffs';
  const restored = normalizeTerrainGraph(JSON.parse(JSON.stringify(source)));
  assert.equal(restored.version, 2);
  assert.equal(
    restored.nodes.find((node) => node.type === 'material/pack').properties.packId,
    'custom-cliffs',
  );
});

test('compiled programs are not serialized into graph settings', () => {
  const settings = deriveSettingsFromTerrainGraph(createDefaultTerrainGraph(), {
    terrainProgram: { stale: true },
    materialProgram: { stale: true },
  });
  assert.equal('terrainProgram' in settings, false);
  assert.equal('materialProgram' in settings, false);
});
```

- [ ] **Step 2: Run tests and verify the material stale-program failure**

Run: `node --test tests/TerrainGraphModel.test.js`

Expected: FAIL until `materialProgram` is stripped alongside `terrainProgram`.

- [ ] **Step 3: Preserve source data and rebuild derived programs**

Project export stores normalized graph version 2 plus the active custom pack definition. Import registers the custom pack before compiling the graph. It never serializes `terrainProgram`, `materialProgram`, worker buffers, or prepared texture arrays.

- [ ] **Step 4: Surface missing dependencies**

If import contains an unavailable built-in/imported `packId`, preserve the node value and mark the graph invalid. Build status must name the missing pack and keep the current terrain unchanged.

- [ ] **Step 5: Run compatibility tests**

Run: `node --test tests/TerrainGraphModel.test.js tests/TerrainGraphCompiler.test.js tests/TerrainMaterialPackManager.test.js`

Expected: PASS for version 1 migration, version 2 round trips, and missing dependencies.

- [ ] **Step 6: Verification checkpoint**

Run: `node --test`

Expected: all tests pass.

### Task 10: End-To-End Browser Verification

**Files:**
- Modify only when verification reveals a concrete defect in files already listed above.

- [ ] **Step 1: Start the application**

Run the existing Windows launcher or package script on an unused local port. Keep the process running until browser checks complete.

Expected: the app opens without console errors and the editor world finishes generating.

- [ ] **Step 2: Verify graph authoring**

Using Chrome automation:

1. Open the Terrain Graph.
2. Add Material Pack, Layer Distribution, both mask nodes, Biome Blend, and Material Output.
3. Connect typed sockets and verify invalid field-to-material connections are refused.
4. Edit pack/layer dropdowns, numeric ranges, and invert toggles in both node widgets and Selected Node Inspector.
5. Open Edit Pack and verify the selected pack appears in Material Pack Studio.

- [ ] **Step 3: Verify Preview truthfulness**

Switch through Height, Materials, Slope, Moisture, and Erosion. Confirm:

- Height has no vegetation-green ramp.
- Materials legend uses the selected pack's four layer names/colors.
- Slope, Moisture, and Erosion legends match the visible ramps.
- Mode switching is immediate and does not trigger terrain resampling or world generation.
- Hiding Auto Preview removes the whole panel and restores graph width.

- [ ] **Step 4: Verify Build and cache**

Build with an uncached pack, wait for asset preparation and all editor chunks, then build again with the same pack. Confirm the second build reuses prepared assets. Change Layer Distribution and verify Preview Materials and the central world's sand/grass/soil/rock boundaries change consistently.

- [ ] **Step 5: Verify atomic failure**

Select a deliberately unavailable pack dependency in an imported graph and press Build. Confirm the existing world and active pack remain visible, and the graph status names the missing pack.

- [ ] **Step 6: Verify compatibility and layout**

Load a version 1 project, build it, resize the graph and right inspector, collapse the main sidebar, zoom around the cursor, and inspect nodes at low zoom. Check desktop and a narrow viewport for clipped controls, disappearing labels, or overlapping legends.

- [ ] **Step 7: Run final automated verification**

Run: `node --test`

Run: `node --check src/terrain/TerrainSurfaceAnalysis.js`

Run: `node --check src/terrain/TerrainMaterialGraph.js`

Run: `node --check src/terrain/TerrainGraphModel.js`

Run: `node --check src/terrain/TerrainGraphCompiler.js`

Run: `node --check src/terrain/TerrainGraphPreview.js`

Run: `node --check src/workers/terrainGraphWorker.js`

Run: `node --check src/ui/TerrainGraphEditor.js`

Run: `node --check src/ui/EditorUI.js`

Run: `node --check src/app/TerrainEditorApp.js`

Expected: all tests pass and every syntax check exits with code 0.
