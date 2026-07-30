# Sidebar Collapse And Terrain Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible settings sidebar and portable baked terrain export in GLB, FBX, OBJ, STL, and PLY.

**Architecture:** `TerrainModelExporter` owns geometry baking, exporter dispatch,
and downloads. `EditorUI` owns controls and layout state. `TerrainEditorApp`
coordinates world readiness, busy state, and errors.

**Tech Stack:** Three.js r185 addon exporters, `@comfyorg/fbx-exporter-three`,
Node test runner, browser import maps.

---

### Task 1: Sidebar Layout

**Files:**
- Modify: `src/ui/EditorUI.js`
- Modify: `src/styles.css`
- Test: `tests/terrain.test.js`

- [ ] Add a failing source-level UI test for a sidebar toggle with
  `aria-expanded`, a collapsed shell class, and a restore control.
- [ ] Run `node --test tests/terrain.test.js` and confirm the new assertion fails.
- [ ] Add the toggle markup and bind it to `editor-shell.sidebar-collapsed`.
- [ ] Add layout styles that remove the 370px column and keep a 32px restore tab.
- [ ] Run `node --test tests/terrain.test.js` and confirm the test passes.

### Task 2: Baked Terrain Geometry

**Files:**
- Create: `src/terrain/TerrainModelExporter.js`
- Create: `tests/TerrainModelExporter.test.js`

- [ ] Write failing tests for option normalization and a two-chunk baked mesh.
- [ ] Run `node --test tests/TerrainModelExporter.test.js` and confirm failure
  because the module is absent.
- [ ] Implement:

```js
export function normalizeTerrainExportOptions(options = {}) {}
export function buildTerrainExportMesh(world, options = {}) {}
```

- [ ] Sample `chunk.sampleHeight`, emit positions/normals/UVs/indices, and blend
  the four control-map channels into portable vertex colors.
- [ ] Run the focused test and confirm it passes.

### Task 3: Format Serialization

**Files:**
- Modify: `src/terrain/TerrainModelExporter.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`
- Test: `tests/TerrainModelExporter.test.js`

- [ ] Add failing tests for format metadata and download filenames.
- [ ] Install `@comfyorg/fbx-exporter-three`.
- [ ] Dispatch GLB, OBJ, binary STL, binary PLY, and FBX to their exporter APIs.
- [ ] Return `{ data, mimeType, extension }` and revoke object URLs after download.
- [ ] Run focused tests and confirm all format-independent tests pass.

### Task 4: Export UI And Application Wiring

**Files:**
- Modify: `src/ui/EditorUI.js`
- Modify: `src/app/TerrainEditorApp.js`
- Modify: `src/styles.css`
- Test: `tests/terrain.test.js`

- [ ] Add failing UI assertions for format, detail, target preset, vertex colors,
  status, and export button controls.
- [ ] Add `getTerrainExportOptions()` and `setTerrainExportStatus()`.
- [ ] Bind `export-model` in `TerrainEditorApp`, wait for editor readiness, export,
  download, dispose temporary resources, and report failures.
- [ ] Run focused tests and confirm they pass.

### Task 5: Full Verification

**Files:**
- Modify: `index.html` only if a cache-busting revision is required.

- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Reload `http://127.0.0.1:3000` and verify sidebar collapse/restore.
- [ ] Verify graph and renderer resize into the reclaimed width.
- [ ] Export a Draft GLB and confirm the browser download completes without a
  console error.
