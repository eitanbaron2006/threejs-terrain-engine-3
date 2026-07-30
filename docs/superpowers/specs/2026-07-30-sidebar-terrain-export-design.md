# Sidebar Collapse And Terrain Export Design

## Goal

Give the terrain graph the full editor width on demand and export the generated
terrain as portable, baked 3D geometry for DCC tools and game engines.

## Sidebar

The main settings sidebar receives a persistent edge button with an accessible
expanded state. Collapsing it removes the sidebar from layout, leaves a compact
restore button, and triggers the existing viewport and graph resize observers.
The control remains available outside FPS mode and does not discard any settings.

## Export Workflow

Project JSON remains separate from model export. The diagnostics panel receives
a Model Export section with:

- Format: GLB, FBX, OBJ, binary STL, or binary PLY.
- Geometry detail: Draft (16), Standard (32), or High (64) segments per chunk.
- Target preset for FBX: Blender, Unity, Unreal, or Three.js.
- Vertex colors toggle.
- Export button and progress/status feedback.

Export waits for the full editor world to settle. It samples each loaded chunk's
CPU height data into real BufferGeometry, so shader displacement is never lost.
Chunk geometry is combined into one indexed terrain mesh with normals, UVs, and
optional control-map-derived vertex colors. A portable MeshStandardMaterial
replaces the runtime ShaderMaterial.

## Format Strategy

GLB, OBJ, STL, and PLY use the official Three.js addon exporters. FBX uses
`@comfyorg/fbx-exporter-three`, because Three.js ships an FBX loader but no FBX
exporter. GLB is the default for Three.js and modern engines. FBX presets declare
the correct axes and units for the selected target.

## Reliability

Invalid format/detail options are normalized to safe defaults. Export rejects an
empty or incomplete terrain with a clear UI error. Temporary geometry and
materials are disposed after serialization. Large exports expose progress and
run only after the current world is ready.

## Verification

Unit tests cover option normalization, geometry counts, sampled heights, UVs,
vertex colors, and download metadata. UI source tests cover sidebar controls and
all model export controls. Browser verification covers sidebar collapse/restore,
graph expansion, model-export controls, and one generated GLB download.
