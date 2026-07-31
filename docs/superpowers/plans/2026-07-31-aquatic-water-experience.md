# Aquatic Water Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bathymetry-aware floating spheres, aquatic life, underwater optics and an accessible dive workflow to the terrain engine.

**Architecture:** Pure spatial and buoyancy functions remain testable without WebGL. Three focused runtime classes own floating objects, aquatic geometry and the conditional underwater post-process; `AdvancedWaterSystem` coordinates them through its existing update, resize, render, settings and disposal lifecycle.

**Tech Stack:** JavaScript ES modules, Three.js r185, GLSL3, Node test runner, existing GPU water simulation.

---

### Task 1: Spatial And Buoyancy Core

**Files:**
- Create: `src/water/WaterSpatialModel.js`
- Create: `src/water/WaterInteractionPhysics.js`
- Create: `tests/WaterInteractionPhysics.test.js`

- [ ] Write failing tests for exact sphere submerged volume at dry, half and full immersion.
- [ ] Run `node --test tests/WaterInteractionPhysics.test.js` and verify missing exports fail.
- [ ] Implement `sphereSubmergedFraction(centerY, radius, surfaceY)` using the spherical-cap volume formula.
- [ ] Add failing tests for finite buoyancy integration, quadratic drag and seabed collision.
- [ ] Implement `integrateBuoyantBody(body, environment, deltaSeconds)`.
- [ ] Add failing seeded placement tests requiring requested depth bounds and deterministic output.
- [ ] Implement `WaterSpatialModel` with `sampleHeight`, `sampleDepth`, `isUnderwater` and `findPositions`.
- [ ] Run focused tests and commit the core.

### Task 2: Floating White Spheres

**Files:**
- Create: `src/water/WaterInteractionSystem.js`
- Modify: `src/water/AdvancedWaterSystem.js`
- Test: `tests/WaterInteractionPhysics.test.js`

- [ ] Add failing lifecycle tests for sphere count, disabled visibility and spatial rebuild.
- [ ] Create twelve high-quality white physical-material spheres with cast/receive shadows.
- [ ] Seed valid sea and lake positions from `WaterSpatialModel`.
- [ ] Update bodies with local procedural wave height, submerged volume, drag and seabed collision.
- [ ] Integrate settings, update, generator rebuild, diagnostics and dispose into `AdvancedWaterSystem`.
- [ ] Run focused tests and commit.

### Task 3: Aquatic Habitat

**Files:**
- Create: `src/water/AquaticEnvironment.js`
- Create: `tests/AquaticEnvironment.test.js`
- Modify: `src/water/AdvancedWaterSystem.js`

- [ ] Add failing tests for deterministic habitat placement and species depth bands.
- [ ] Build fish body, tail and fin geometry with school metadata and bounded animation.
- [ ] Build instanced seagrass with vertex sway and seeded seabed orientation.
- [ ] Build branching coral clusters with restrained natural color variation.
- [ ] Add shared underwater-aware standard-material shader augmentation.
- [ ] Integrate rebuild, update, visibility, diagnostics and disposal.
- [ ] Run focused tests and commit.

### Task 4: Underwater Post-Process

**Files:**
- Create: `src/water/UnderwaterPostProcess.js`
- Create: `tests/UnderwaterPostProcess.test.js`
- Modify: `src/water/AdvancedWaterSystem.js`

- [ ] Add failing tests for underwater hysteresis around the surface and disabled behavior.
- [ ] Create a resize-aware color/depth render target and fullscreen GLSL3 pass.
- [ ] Reconstruct world position and apply absorption, scattering, depth fog and caustics.
- [ ] Route only underwater final frames through the post target.
- [ ] Preserve renderer target, shadow state, color space and disposal behavior.
- [ ] Run focused tests and commit.

### Task 5: Swimming And Demo View

**Files:**
- Modify: `src/player/FpsPlayerController.js`
- Modify: `src/app/TerrainEditorApp.js`
- Create: `tests/FpsSwimming.test.js`

- [ ] Add failing tests for underwater movement, ascent, descent and seabed clamping.
- [ ] Add swimming state and Control key handling without changing land movement.
- [ ] Expose the best generated habitat viewpoint from the water system.
- [ ] Implement the editor demo-view command by positioning camera and OrbitControls target.
- [ ] Run focused tests and commit.

### Task 6: User Controls And Persistence

**Files:**
- Modify: `src/terrain/TerrainConfig.js`
- Modify: `src/ui/EditorUI.js`
- Modify: `src/app/TerrainEditorApp.js`
- Modify: `tests/terrain.test.js`

- [ ] Add failing tests for defaults and the five water-panel controls.
- [ ] Add additive default settings for spheres, life, optics, density and counts.
- [ ] Add three toggles, density slider and `Underwater Demo View` command.
- [ ] Wire UI emission, settings sync and project import/export behavior.
- [ ] Update diagnostics labels without adding explanatory UI copy.
- [ ] Run focused tests and commit.

### Task 7: End-To-End Verification

**Files:**
- Modify: `index.html`

- [ ] Bump cache-busting query strings.
- [ ] Run `npm test` and require zero failures.
- [ ] Run `npm run check` and require resolved imports.
- [ ] Start the local server on a free port.
- [ ] Verify above-water spheres and reflections in Chrome.
- [ ] Use `Underwater Demo View` and verify fish, coral, seagrass, fog and caustics.
- [ ] Toggle each feature and verify full visibility recovery.
- [ ] Inspect console errors and capture desktop screenshots.
- [ ] Merge the verified feature branch into `main`.
