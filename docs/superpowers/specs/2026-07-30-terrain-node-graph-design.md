# Terrain Node Graph Design

## Goal

Add a functional node-based terrain generation workflow to the existing Terrain Engine editor without removing the current procedural controls. The graph becomes the source of truth for terrain generation. Legacy sliders remain available and synchronize with matching nodes.

## User Experience

The 3D viewport keeps its current primary role. A resizable bottom dock opens inside the viewport area and contains:

- A compact header with Terrain Graph, collapse, fit, auto-preview, undo, redo, and Build Terrain controls.
- A categorized object palette on the left.
- A quick-add strip along the bottom.
- A central node canvas with pan, zoom, selection, drag, connection, deletion, and multi-select.
- A preview pane that renders the current output as a low-resolution heightmap.
- A status area for graph validity, preview time, and build state.

The dock opens at roughly 38 percent of the viewport height, can be resized vertically, and can collapse to its header. It is hidden during FPS mode.

## Technology Choice

Use LiteGraph.js for canvas interaction, custom node rendering, connections, graph navigation, and serialization.

Alternatives considered:

- Custom DOM/SVG editor: best visual control but too much fragile interaction code.
- Rete.js: strong dataflow architecture but requires a larger plugin and renderer integration for this vanilla application.
- LiteGraph.js: mature Canvas2D editor, custom nodes, widgets, connections, execution hooks, and JSON serialization with minimal integration overhead.

Terrain evaluation remains application-owned. LiteGraph is the editor, not the terrain engine.

## Graph Model

The persisted graph is plain structured data:

- `version`
- `nodes`: stable ID, type, position, title, properties
- `links`: source node/socket and target node/socket
- `outputNodeId`
- editor viewport state

Socket types:

- `coordinate`: world-space X/Z pair
- `field`: scalar procedural value
- `terrain`: final height in metres

Cycles, missing required inputs, incompatible sockets, multiple output nodes, and disconnected output graphs are rejected before preview or build.

## Initial Node Catalog

### Inputs

- World Coordinates
- Constant

### Generators

- FBM Noise
- Ridged Noise
- Continental Noise

### Coordinate Modifiers

- Domain Warp

### Field Modifiers

- Terrace
- Remap
- Clamp

### Combiners

- Add
- Multiply
- Blend

### World

- Island / Coast
- Terrain Output

The default graph reproduces the current generator structure: coordinates feed domain warp and the noise sources; broad noise, detail, ridges, and continental form are combined; terrace modifies the field; island/coast converts it into a bounded landmass with a submerged ocean floor; Terrain Output emits metres.

Hydraulic erosion is deliberately excluded from the first version. It will be added as a real simulation node later rather than as a cosmetic placeholder.

## Evaluation Architecture

The visual graph is compiled into a compact, topologically sorted instruction program. Each instruction reads typed slots and writes a typed slot. The program is structured-clone compatible and is sent with terrain generation jobs.

`terrainWorker.js` compiles or validates the program once per chunk job, then evaluates the instruction array for every terrain sample. The synchronous generation fallback uses the same compiler and evaluator. `TerrainWorld.sampleHeight` and global scans use the same graph program so streaming, collision, water bathymetry, spawn selection, and generated meshes agree.

Legacy `terrainHeightAt` remains the compatibility entry point. When a valid terrain graph is present in settings it evaluates the compiled graph; otherwise it uses the current procedural formula.

## Preview

Graph edits trigger a debounced preview request. A dedicated preview worker evaluates a 256 by 256 heightmap over the world extent and returns:

- Normalized height pixels
- Minimum and maximum height
- Evaluation duration
- Graph validation errors

The preview never rebuilds full terrain. Build Terrain validates the graph, writes the graph and derived compatibility settings into application state, clears generated chunks, regenerates the world, and refreshes water bathymetry.

## Legacy Control Synchronization

The default graph assigns stable semantic IDs to nodes that correspond to current controls.

- Slider changes update matching node properties.
- Node property changes update matching legacy controls.
- Graph structures that cannot be represented by legacy sliders leave those sliders visible but mark them as partial compatibility controls.
- Existing Generate becomes an alias of Build Terrain while the graph feature is enabled.

## Persistence

Project JSON keeps format version 3 and adds an optional `terrainGraph` field. Older projects without it create a default graph from `generatorSettings`. Graph projects still export derived `generatorSettings` for backward compatibility.

Imported graph data is validated before it can replace the active graph. Invalid graph data leaves the current graph untouched and reports a visible error.

## Components

- `TerrainGraphModel`: graph schema, defaults, cloning, validation, and migration.
- `TerrainGraphCompiler`: topological sorting, typed socket checks, instruction generation, and evaluation.
- `TerrainGraphEditor`: LiteGraph integration, custom node registration, palettes, dock state, property synchronization, and UI events.
- `TerrainGraphPreview`: preview worker lifecycle, debouncing, cancellation, and heightmap display.
- `terrainGraphWorker.js`: off-main-thread preview evaluation.
- Existing terrain worker and synchronous service: execute the compiled terrain program.
- `TerrainEditorApp`: owns active graph, coordinates builds, and bridges graph events with legacy settings.
- `TerrainSerializer`: persists and restores the graph.

## Error Handling

- Graph validation runs before preview and build.
- Preview requests carry revision IDs; stale responses are ignored.
- Build is disabled while the graph is invalid.
- Worker failures show a graph-specific error and preserve the last valid terrain.
- Unknown node types in imported projects are reported with their IDs.
- Deleting the output node immediately marks the graph invalid but does not destroy the current terrain.

## Testing

- Unit tests for graph validation, cycle detection, socket typing, compilation, deterministic evaluation, and legacy fallback.
- Equivalence tests proving the default graph matches the current generator within a small numeric tolerance.
- Worker and synchronous evaluator parity tests.
- Serialization round-trip and legacy-project migration tests.
- UI source tests for the dock, palettes, toolbar, Build event, and FPS hiding.
- Browser verification for drag, connect, delete, zoom, resize, preview update, build, project reload, desktop layout, and narrow viewport layout.

## Success Criteria

- Users can drag nodes from the left or bottom palettes, connect them, edit properties, and create a valid end-to-end terrain graph.
- The graph changes the generated terrain, not only the interface.
- Editing remains responsive because full terrain regeneration is explicit.
- Existing controls and projects remain usable.
- Generated terrain, sampled heights, water bathymetry, and collision use the same graph output.
- The graph dock does not cover controls incoherently or remain visible in FPS mode.
