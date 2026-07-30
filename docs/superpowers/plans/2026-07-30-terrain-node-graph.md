# Terrain Node Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-grade, Gaea-style node graph that becomes the source of truth for terrain generation while preserving and synchronizing the existing controls.

**Architecture:** A framework-independent graph model owns nodes, typed links, defaults, validation, and persistence. The model compiles to a compact topologically sorted terrain program consumed by both the synchronous sampler and terrain workers. LiteGraph.js provides only the editing canvas; a dedicated preview worker evaluates the same compiled program at low resolution, while the explicit Build Terrain action regenerates the full world.

**Tech Stack:** Vanilla ES modules, Three.js, LiteGraph.js 0.7.18, Web Workers, Node's built-in test runner, existing project serializer and terrain workers.

---

## Task 1: Install The Graph Canvas And Establish Tests

- [x] Add LiteGraph.js and the test command.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`

**Steps:**
1. Run `npm install litegraph.js@0.7.18`.
2. Add `"test": "node --test tests/**/*.test.js"` to `package.json`.
3. Load `node_modules/litegraph.js/css/litegraph.css` and `node_modules/litegraph.js/build/litegraph.js` before `src/main.js`.
4. Run `npm test` and confirm the command succeeds with no tests.

## Task 2: Build The Framework-Independent Graph Model

- [x] Create catalog, default graph, mutations, typed connection validation, cycle detection, and slider synchronization.

**Files:**
- Create: `src/terrain/TerrainGraphModel.js`
- Create: `tests/TerrainGraphModel.test.js`

**Test first:**
1. Verify the default graph contains exactly one `terrain/output` node and validates.
2. Verify scalar-to-scalar and coordinate-to-coordinate connections are accepted.
3. Verify mismatched socket types, duplicate output connections, and cycles are rejected.
4. Verify generator settings update semantic graph nodes and can be derived back from the graph.
5. Verify removing a node removes its links.

**Public API:**
```js
export const TERRAIN_GRAPH_VERSION = 1;
export const TERRAIN_NODE_DEFINITIONS = Object.freeze({});
export function createDefaultTerrainGraph(settings = {}) {}
export function cloneTerrainGraph(graph) {}
export function addTerrainGraphNode(graph, type, position, properties = {}) {}
export function removeTerrainGraphNode(graph, nodeId) {}
export function connectTerrainGraphNodes(graph, connection) {}
export function disconnectTerrainGraphLink(graph, linkId) {}
export function validateTerrainGraph(graph) {}
export function syncSettingsToTerrainGraph(graph, settings) {}
export function deriveSettingsFromTerrainGraph(graph, fallbackSettings) {}
```

**Implementation requirements:**
- Use normalized data: `{ version, nextNodeId, nextLinkId, nodes, links, view }`.
- Give every node stable input/output socket names and types: `coordinate`, `field`, or `terrain`.
- Use semantic `role` properties on default nodes so existing generator settings map without relying on node IDs.
- Use immutable return values for graph mutations so preview revisions and undo history are reliable.

## Task 3: Compile And Evaluate Real Terrain Programs

- [x] Compile graph topology to compact instructions and evaluate every initial node type.

**Files:**
- Create: `src/terrain/TerrainGraphCompiler.js`
- Modify: `src/terrain/noise.js`
- Create: `tests/TerrainGraphCompiler.test.js`

**Test first:**
1. Compile the default graph and assert output instructions are topologically ordered.
2. Assert deterministic output for the same seed and coordinates.
3. Assert changing FBM seed or frequency changes output.
4. Assert `add`, `multiply`, `blend`, `terrace`, `remap`, and `clamp` produce expected numeric values.
5. Assert a disconnected required input and invalid graph throw actionable errors.
6. Assert the default graph remains within expected island/ocean height bounds.

**Public API:**
```js
export function compileTerrainGraph(graph) {}
export function createTerrainProgramEvaluator(program, runtime) {}
```

**Instruction operations:**
- `worldCoordinates`
- `constant`
- `fbm`
- `ridged`
- `continental`
- `domainWarp`
- `terrace`
- `remap`
- `clamp`
- `add`
- `multiply`
- `blend`
- `islandCoast`
- `terrainOutput`

**Runtime integration:**
```js
export function createTerrainHeightSampler(settings = {}) {
  if (settings.terrainProgram) {
    const evaluate = createTerrainProgramEvaluator(settings.terrainProgram, {
      fbm2D,
      valueNoise2D,
    });
    return (worldX, worldZ) => evaluate(worldX, worldZ);
  }
  return (worldX, worldZ) => legacyTerrainHeightAt(worldX, worldZ, settings);
}
```

Keep `terrainHeightAt()` as a compatibility wrapper around a cached sampler.

## Task 4: Feed The Program Through All Terrain Sampling Paths

- [x] Make full generation, synchronous fallback, live height queries, and bathymetry use the graph program.

**Files:**
- Modify: `src/workers/terrainWorker.js`
- Modify: `src/terrain/TerrainGenerationService.js`
- Modify: `src/terrain/TerrainWorld.js`
- Modify: `src/water/AdvancedWaterSystem.js`

**Steps:**
1. Create one sampler per worker job, not one evaluator per terrain vertex.
2. Create one sampler per synchronous generation job.
3. Preserve `terrainProgram` when world settings are copied.
4. Use a single sampler for each bathymetry texture generation loop.
5. Run compiler/model tests after each integration point.

## Task 5: Add The Dedicated Preview Worker

- [x] Render a fast 256x256 height preview from the same compiled graph.

**Files:**
- Create: `src/workers/terrainGraphWorker.js`
- Create: `src/terrain/TerrainGraphPreview.js`
- Create: `tests/TerrainGraphPreview.test.js`

**Behavior:**
- Debounce edits by 180 ms.
- Compile on the main thread so graph errors can identify nodes immediately.
- Send `{ revision, program, settings, width, height }`.
- Ignore stale worker responses.
- Convert heights to a shaded hypsometric image with ocean, beach, lowland, rock, and snow bands.
- Expose `request(graph, settings)`, `cancel()`, and `dispose()`.
- Display compile/runtime errors in the dock status without blocking graph edits.

## Task 6: Build The LiteGraph Editor Adapter

- [x] Register the real terrain nodes and keep LiteGraph synchronized with the model.

**Files:**
- Create: `src/ui/TerrainGraphEditor.js`
- Create: `tests/TerrainGraphEditor.test.js`

**Behavior:**
- Register one LiteGraph node class for every catalog entry.
- Give node categories distinct restrained colors and typed socket colors.
- Rebuild the normalized model after node move, property edit, add, remove, connect, or disconnect.
- Reject invalid connections and restore the last valid graph.
- Add undo/redo history capped at 100 revisions.
- Support Delete, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, mouse-wheel zoom, pan, fit view, and selection.
- HTML palette items use drag-and-drop; bottom quick-add buttons insert at the visible canvas center.
- Emit `graphchange`, `build`, and `previewtoggle` callbacks.

## Task 7: Add The Bottom Dock Without Replacing Existing Controls

- [x] Add a resizable and collapsible graph workspace inside the viewport area.

**Files:**
- Modify: `src/ui/EditorUI.js`
- Modify: `src/styles.css`

**Markup:**
```html
<main class="viewport-wrap">
  <section class="viewport-stage">
    <div id="viewport"></div>
    <!-- existing viewport overlays -->
  </section>
  <section id="terrain-graph-dock" class="terrain-graph-dock">
    <header class="terrain-graph-toolbar"></header>
    <div class="terrain-graph-body">
      <aside class="terrain-node-palette"></aside>
      <div class="terrain-graph-canvas-wrap"><canvas></canvas></div>
      <aside class="terrain-preview-pane"></aside>
    </div>
    <footer class="terrain-quick-add"></footer>
  </section>
</main>
```

**Responsive requirements:**
- Open height defaults to 38% with a draggable top resize handle.
- Collapsed height is 42px.
- Minimum 3D viewport height is 280px on desktop and 220px on mobile.
- Use LTR only inside the graph workspace while preserving the Hebrew RTL application.
- Under 900px, hide the dedicated preview pane and allow the palette to collapse.
- Hide the graph dock automatically in FPS mode and restore its previous state on exit.
- Keep controls compact, use 8px or smaller radii, and prevent toolbar text overlap.

## Task 8: Make The Graph The Source Of Truth

- [x] Wire graph editing, previews, builds, and legacy sliders through `TerrainEditorApp`.

**Files:**
- Modify: `src/app/TerrainEditorApp.js`
- Modify: `src/ui/EditorUI.js`

**Flow:**
1. Create the default graph from current generator settings during app startup.
2. Instantiate `TerrainGraphEditor` and `TerrainGraphPreview`.
3. On graph change, derive legacy settings, refresh slider values, and request a preview.
4. On a legacy slider edit, update the semantic graph nodes and request a preview.
5. On Build Terrain, validate and compile the graph, store `terrainProgram` in generation settings, then call the existing full terrain generation path.
6. Disable Build while full generation runs and report success or graph errors in the dock.
7. Keep existing Generate Terrain buttons working by routing them to the same graph build method.

## Task 9: Persist And Restore Graph Projects

- [x] Store the graph as an optional project v3 field and migrate older projects.

**Files:**
- Modify: `src/terrain/TerrainSerializer.js`
- Modify: `src/app/TerrainEditorApp.js`
- Create: `tests/TerrainSerializerGraph.test.js`

**Test first:**
1. Assert graph data round-trips without shared references.
2. Assert a v3 project without `terrainGraph` remains valid.
3. Assert loading an older project creates a default graph from saved generator settings.
4. Assert malformed graph data falls back safely and reports a warning.

## Task 10: Verify The Complete Workflow

- [x] Run automated and browser verification.

**Commands:**
1. `npm test`
2. `node --check src/terrain/TerrainGraphModel.js`
3. `node --check src/terrain/TerrainGraphCompiler.js`
4. `node --check src/ui/TerrainGraphEditor.js`
5. `npm run check`
6. Start the existing development server from `START_WINDOWS.bat` or the package script.

**Browser checks:**
- Open the app at desktop and mobile widths.
- Drag each node category into the graph.
- Connect a complete coordinates-to-output graph.
- Confirm an invalid typed link is rejected.
- Confirm preview changes after a property edit.
- Confirm Build Terrain changes the actual Three.js terrain.
- Confirm legacy sliders update graph properties and graph edits update sliders.
- Confirm dock resize, collapse, undo, redo, fit, and FPS visibility.
- Save, reload, and verify graph topology and properties persist.
- Inspect console for errors and capture desktop/mobile screenshots.

**Repository note:** This workspace has no `.git` directory, so commit checkpoints cannot be created. Verification checkpoints replace commit steps until the project is placed in a Git worktree.
