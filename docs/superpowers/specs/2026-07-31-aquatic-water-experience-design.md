# Aquatic Water Experience Design

## Goal

Extend the existing open-world water renderer with a physically understandable
demonstration environment: white floating spheres, visible underwater fish,
plants and corals, and a proper underwater camera treatment. The feature must
work over the generated sea and inland lakes by using the same terrain sampler
and water level as the terrain and water shaders.

## Source Principles

The upstream `jeantimex/threejs-water` project separates water into four ideas:
GPU surface simulation, buoyant simulation objects, above/below-water optics,
and a caustics render pass. Its bounded pool ray tracer cannot be copied into an
8 km streamed terrain world. This project will preserve the physical principles
while replacing pool intersections with terrain bathymetry and screen-space
depth reconstruction.

## Architecture

### Water Spatial Model

`WaterSpatialModel` owns deterministic terrain sampling for water features. It
answers terrain height, water depth, whether a position is submerged, and finds
valid seeded positions for a requested depth range. It is rebuilt whenever the
terrain generator or graph changes.

### Buoyant Objects

`WaterInteractionSystem` owns twelve white test spheres. Each sphere stores
position, velocity, radius, density, phase and drift direction. Vertical force
uses submerged sphere volume rather than a binary water test. Quadratic drag
acts only on the submerged fraction, the seabed prevents tunnelling, and a
small wave sampler moves the local surface. Spheres remain normal Three.js
meshes so they participate in shadows, scene capture and refraction.

### Aquatic Environment

`AquaticEnvironment` creates a deterministic habitat with small fish schools,
seagrass and branching coral. Placement accepts only cells whose depth fits the
species. Fish animate around local school anchors and stay between the seabed
and surface. Plants and coral are fixed to the sampled seabed. Geometry is
procedural and instanced where useful, avoiding network assets and keeping the
demonstration reproducible.

### Underwater Rendering

`UnderwaterPostProcess` renders the final scene into a color/depth target only
while the camera is below the local water surface. A fullscreen pass reconstructs
world position from depth and applies Beer-Lambert absorption, depth fog,
blue-green in-scattering, animated caustics on upward-facing submerged
surfaces, and a restrained surface light shaft. The ordinary render path remains
unchanged above water.

The water surface remains double-sided and continues using the current
refraction capture. Underwater post-processing happens after the surface and
therefore affects terrain, spheres and habitat consistently.

## Camera And Controls

FPS mode gains swimming when the eye is under water. WASD moves horizontally,
Space ascends, Control descends, and Shift increases swim speed. Terrain
collision still prevents entering the seabed.

The water panel gains:

- `Floating Test Spheres`
- `Underwater Life`
- `Underwater Optics`
- `Water Density`
- `Underwater Demo View`

The demo-view command moves the editor camera to a generated habitat and aims
it across the seabed so the feature is inspectable without entering FPS mode.

## Settings And Compatibility

New settings are additive and default to enabled for the demonstration. Older
project files receive defaults through `DEFAULT_WATER_SETTINGS`; imported
values are merged normally. No generated habitat geometry is serialized because
it is deterministic from the terrain seed.

## Performance

The habitat is bounded: 12 spheres, up to 36 fish, 160 seagrass instances and
24 coral clusters. The underwater fullscreen pass runs only below water. No
additional full-scene reflection pass is introduced. All resources are disposed
with the existing water system.

## Failure Handling

If no valid habitat location exists, the subsystem keeps empty groups and
reports zero counts in diagnostics. Invalid or non-finite settings are clamped.
Terrain regeneration replaces placements atomically after a complete spatial
scan, so the old habitat remains visible if rebuilding fails.

## Verification

Unit tests cover submerged sphere volume, buoyancy/drag integration, seeded
water placement, depth constraints, underwater state transitions and settings
defaults. Existing shader/static tests verify GLSL3 output and render ordering.
Browser verification covers above-water spheres, the demo dive view, visible
fish/coral/seagrass, caustics on the seabed and recovery after returning above
water.
