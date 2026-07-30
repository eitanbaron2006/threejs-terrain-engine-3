# Terrain Graph Material Pipeline Design

## Goal

Extend the terrain node graph from a height-only generator into a complete terrain and material pipeline. The graph must control terrain shape, the active four-layer PBR material pack, geological layer distribution, reusable terrain-analysis masks, biome blending, and the final terrain output. The Preview must expose Height, Materials, Slope, Moisture, and Erosion views derived from the same calculations used by generated chunks.

## Product Principles

- The graph is the source of truth for every built terrain pipeline.
- Preview and world generation use the same compiled height and material programs.
- Editing updates Auto Preview, while the main world changes only after an explicit Build.
- Build is atomic: compilation and PBR pack resolution must succeed before the existing world is replaced.
- Existing version 1 projects remain loadable and produce the same result as before.
- The first material-graph version targets the existing four-layer shader. It does not blend two independent eight-texture packs.

## Architecture

The graph compiler produces two declarative programs from one graph:

```js
{
  terrainProgram,
  materialProgram: {
    version: 1,
    packId,
    splatPreset,
    masks,
    distributionRules,
    biomeBlends
  }
}
```

`terrainProgram` keeps the existing coordinate and height evaluator. `materialProgram` describes a four-channel PBR stack and operations over terrain-analysis signals. Both programs are structured-cloneable and can be sent to preview and chunk workers.

The material evaluator receives a shared per-sample context:

```js
{
  height,
  slope,
  variation,
  curvature,
  moisture,
  exposure,
  coast,
  erosion,
  waterLevel
}
```

It first computes the selected pack's base four-channel weights, applies layer distribution overrides, evaluates reusable masks, applies biome blends, and normalizes the final weights.

## Graph Types And Nodes

Add `material` and `mask` socket types.

### Material Pack

Source node that selects a built-in, imported, or custom PBR pack.

Properties:

- `packId`
- `globalBlend`
- `transitionNoise`

The pack selector is a real dropdown in the node and Selected Node Inspector. The inspector also provides an Edit Pack command that opens the selected pack in Material Pack Studio.

### Layer Distribution

Accepts and returns `material`. Each node modifies one selected layer among Sand, Grass, Soil, or Rock.

Properties:

- `layer`
- `minHeight`, `maxHeight`, `heightBlend`
- `minSlope`, `maxSlope`, `slopeBlend`
- `moistureAffinity`
- `coastAffinity`
- `erosionAffinity`
- `curvatureBias`
- `priority`

Multiple nodes may be chained, allowing each layer to have an independent rule.

### Height / Slope Mask

Produces a reusable `mask`.

Properties:

- `minHeight`, `maxHeight`, `heightBlend`
- `minSlope`, `maxSlope`, `slopeBlend`
- `invert`

### Moisture / Erosion Mask

Produces a reusable `mask`.

Properties:

- `minMoisture`, `maxMoisture`, `moistureBlend`
- `minErosion`, `maxErosion`, `erosionBlend`
- `invert`

### Biome Blend

Accepts `material` and `mask`, then returns `material`.

Properties:

- `fromLayer`
- `toLayer`
- `strength`

The operation transfers normalized weight between two channels under the mask. It blends layers from the selected four-layer pack and never silently introduces textures from a second pack.

### Material Output

Terminal node with required `terrain` and `material` inputs. It is the preferred output for version 2 graphs.

The existing Terrain Output remains a valid legacy terminal. A graph may contain exactly one effective terminal: either Terrain Output or Material Output.

## Graph Versioning

Increase the normalized graph format to version 2.

- Version 1 graphs migrate without changing their height branch.
- Legacy graphs without a material branch retain the project's active material pack and existing splat behavior.
- New default graphs include a Material Pack and Material Output branch.
- A missing referenced pack is preserved as a missing dependency. The application reports the missing `packId` and does not silently substitute another pack.
- Project serialization stores the graph and custom pack definition. Compiled programs remain rebuildable artifacts rather than independent sources of truth.

## Build Flow

`Build Terrain` executes these stages:

1. Validate graph structure and socket types.
2. Compile the terrain program.
3. Compile the material program.
4. Resolve the selected material pack from built-ins, imported packs, or custom packs.
5. Download missing PBR assets or reuse the existing cache.
6. Prepare the material library and graph material distribution.
7. Generate chunks with both compiled programs.
8. Commit the new world and active material state.

Pack download or validation failure leaves the current world unchanged. Status text identifies the failed stage and supports a retry through the same Build command.

## Preview Views

The Preview header contains a compact five-option segmented view control.

### Height

Displays actual terrain height with a neutral grayscale ramp, blue water, subtle contour lines, and min/max height. It deliberately avoids green vegetation coloring.

### Materials

Displays the exact normalized four-channel weights produced by `materialProgram`. Each channel uses a representative color sampled from the active PBR layer's albedo texture. The legend shows the real layer name and swatch.

### Slope

Displays slope from flat dark values to steep light values and reports the degree range.

### Moisture

Displays dry terrain with a warm color and wet terrain with a blue-teal color.

### Erosion

Displays stable terrain dark and highly eroded terrain in orange-yellow.

The preview worker caches the latest height, analysis signals, masks, and material weights by graph revision. Switching view mode recolors cached data without recompiling or resampling terrain.

## Material Pack Integration

The graph does not duplicate Material Pack Studio. Material Pack remains the reusable asset and texture authoring unit; graph nodes select a pack and override its distribution procedurally.

- Built-in and imported catalogs populate Material Pack node dropdowns.
- Saving a custom pack refreshes graph node options and Preview.
- `Build Terrain` automatically applies the graph-selected pack.
- Cached textures are reused without another download.
- The active pack remains visible and editable in Real PBR Terrain Materials.

## Error Handling

- Unknown node or socket: graph validation error.
- Missing required material connection: node-specific validation error.
- Missing pack: dependency error naming the `packId`.
- PBR download failure: retain current world and report provider/file failure.
- Invalid mask range: reject compilation with the node title and property.
- Unsupported cross-pack Biome Blend: reject explicitly.
- Worker failure: retain current world and expose the failed stage.

No failure path reports a successful Build or substitutes a different material pack silently.

## Testing

Automated tests cover:

- material and mask socket validation;
- version 1 migration and version 2 serialization;
- deterministic material compilation;
- mask range, inversion, and biome weight transfer;
- four-channel normalization;
- identical material weights in preview, synchronous generation, and terrain workers;
- pack resolution, cache reuse, and atomic failure behavior;
- all five Preview modes and their legends;
- missing-pack and invalid-graph errors.

Browser verification covers:

- adding and connecting all material node types;
- editing enum, number, and boolean properties in nodes and the inspector;
- switching Preview modes without graph resampling;
- applying a cached and an uncached PBR pack through Build;
- loading all 845 editor chunks;
- visually matching Preview Materials distribution to the central world;
- loading a version 1 project without regression.

## Out Of Scope

- More than four simultaneously rendered PBR layers.
- Blending two unrelated material packs into an eight-layer shader.
- Runtime material downloads during FPS play.
- Replacing Material Pack Studio with graph-only texture authoring.
