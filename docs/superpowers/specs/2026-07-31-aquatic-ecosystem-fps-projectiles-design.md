# Aquatic Ecosystem And FPS Projectile Design

## Goal

Replace the sparse placeholder underwater life with a discoverable, credible
aquatic ecosystem while preserving performance across the streamed 8 km world.
Add visible physical FPS projectiles that transfer momentum to floating water
objects and react correctly when entering water or hitting terrain.

The result must remain deterministic for a terrain seed, work in the ocean and
inland lakes, and integrate with the existing buoyancy, bathymetry, underwater
post-processing and editor demo views.

## Current Problems

The current defaults spread about 30 procedural fish, 120 individual seagrass
blades and 18 coral clusters across the entire world. Fish schools and habitat
patches are therefore difficult to discover. The primitive sphere body,
triangle tail, single grass blade and cylinder coral shapes are useful
diagnostic geometry but do not form a convincing ecosystem.

FPS mode currently owns movement and pointer lock only. Floating bodies expose
linear velocity but there is no projectile lifecycle, swept collision test,
mass-based impact impulse, angular response or water-entry disturbance.

## Design Principles

- Concentrate life in ecologically plausible habitat zones instead of uniformly
  increasing global object counts.
- Spend geometry, animation and material detail close to the camera.
- Use instancing, pooling and distance tiers for large schools and vegetation.
- Keep gameplay physics deterministic and independent from render frame rate.
- Use permissively licensed assets stored locally with license metadata.
- Degrade to built-in geometry if an optional asset cannot be loaded.
- Keep all new controls additive and preserve existing project compatibility.

## Asset Policy

The near-camera fish tier will use a curated subset of the Quaternius Animated
Fish packs under CC0. Imported source files will be converted to optimized GLB
assets where necessary. Only a small species subset will be bundled, and each
asset will have source, author, license and conversion notes in an aquatic asset
manifest.

Coral-ground PBR source material may use the Poly Haven Coral Ground asset under
CC0. Runtime textures will be resized and packed for browser use. Corals,
sponges, rocks, kelp and seagrass will use a reusable optimized shape kit with
natural morphology and restrained palettes. This avoids coupling habitat
density to many heavy skinned models.

No asset with unclear redistribution rights will be committed.

## Habitat Architecture

### Seeded Habitat Zones

`AquaticHabitatLayout` will generate habitat zones rather than isolated global
positions. A zone contains:

- a stable id and seed;
- center, radius, floor height and water depth;
- habitat class such as reef, grass bed, sandy shelf or deep-water school;
- density, species profile and visual variation;
- a guaranteed inspection point for the underwater demo view.

Zones must satisfy bathymetry constraints. Reef and grass zones prefer shelves
with useful floor clearance; deep-water fish prefer greater depth. Inland lakes
receive smaller freshwater-compatible schools and vegetation without coral.

At least one dense demonstration reef is produced when a valid ocean position
exists. If no valid reef exists, the demo view targets the strongest available
grass or fish zone.

### Runtime Streaming

`AquaticEnvironment` will activate habitat cells around the current camera or
render target. Objects outside the active radius remain represented by layout
data only. Active cells are pooled and rebuilt only when the focus crosses a
cell boundary.

Three visual tiers are used:

1. Hero tier: a small number of animated GLB fish near the underwater camera.
2. School tier: rigid or shader-deformed instanced fish with per-instance
   species, size, color and swim phase.
3. Habitat tier: instanced coral, rock, kelp, seagrass and sponge meshes grouped
   by geometry and material.

Bounding volumes are recomputed after dynamic instance transforms. Frustum and
distance culling are applied per habitat batch. Asset loading and conversion are
cached, and all geometries, materials, textures and animation mixers are
disposed explicitly.

### Fish Behaviour

Fish movement uses lightweight schooling rather than simple circular orbits.
Each fish combines:

- attraction to its school center;
- alignment with the school heading;
- local separation;
- depth and seabed avoidance;
- surface avoidance;
- seeded wander and species speed;
- a camera avoidance response at close range.

The implementation uses spatial buckets inside each active school so neighbour
queries do not become quadratic. Hero fish follow the same school state while
playing their native swim animation. Instanced fish use body and tail transforms
or vertex deformation.

### Habitat Visuals

The shape kit provides several silhouettes for each category instead of one
repeated primitive:

- ribbon and blade seagrass;
- branching and plate-form kelp;
- branching, massive and plate coral;
- barrel and tube sponges;
- low seabed rocks and coral rubble.

Placement forms clumps with empty breathing areas. Scale, heading, color and
lean are seeded. Plants sway with a shared water-current phase plus per-instance
offset. Materials receive underwater lighting, fog and caustics consistently.

## FPS Projectile Architecture

### Input And Presentation

While FPS mode is active and the pointer is locked, primary mouse input fires a
visible projectile from slightly in front of the camera. The reticle remains
small and unobtrusive. Ammunition is unlimited for the simulation tool; a short
cooldown prevents unbounded object creation.

Projectiles are pooled meshes, not allocated per shot. Each projectile stores
position, previous position, velocity, radius, mass, age, maximum lifetime and
whether it has entered water.

### Integration

Projectile motion uses fixed-size substeps with:

- gravity in air;
- strong velocity-dependent drag and reduced gravity below the local water
  surface;
- terrain collision against the sampled terrain height;
- world-bounds and lifetime removal;
- a one-time water-entry event with a simulation ripple.

A swept-sphere segment test runs from previous to current position so a fast
projectile cannot tunnel through a floating sphere between frames.

### Floating-Body Impact

Each floating sphere receives explicit mass calculated from volume and density,
linear velocity and angular velocity. On contact:

- relative contact velocity is projected onto the collision normal;
- an impulse is calculated from both inverse masses and restitution;
- the equal and opposite impulse is applied to projectile and target;
- an off-center hit contributes angular impulse;
- penetration is corrected without injecting excessive energy.

The existing buoyancy integration continues after impact, so the sphere is
pushed under or across the surface, loses energy through water drag and returns
to its density-dependent equilibrium. Surface rotation uses angular velocity
with water damping.

The water system exposes a narrow interaction API. FPS code does not reach into
the floating body's internal arrays directly.

## User Controls

The existing water controls remain. Add:

- aquatic habitat density;
- fish school density;
- vegetation density;
- habitat quality tier;
- FPS projectiles enabled;
- projectile speed;
- projectile mass;
- reset floating test objects.

The underwater demo action targets a guaranteed active habitat and activates its
streaming cells before moving the camera. The floating-object demo remains
available for immediate projectile testing.

## Failure Handling

- Missing GLB or animation clips fall back to procedural school fish and report
  one concise diagnostic warning.
- A failed habitat batch does not remove other successfully built batches.
- Invalid counts, speeds, masses and distances are clamped to safe ranges.
- Projectiles are returned to the pool on invalid numeric state.
- Rebuilding terrain replaces habitat layout and floating bodies atomically.
- Disabling aquatic life or projectiles stops updates and hides pooled meshes.

## Performance Budgets

The default high-quality target is:

- no more than 16 independently animated hero fish;
- up to 180 visible instanced school fish near the camera;
- up to 2,000 visible vegetation and reef instances;
- a bounded pool of 48 projectiles;
- habitat updates at a lower fixed cadence than rendering;
- no new full-scene render pass.

Quality tiers reduce active radius, hero count and instance density together.
Diagnostics report active zones, visible fish, vegetation instances, loaded
hero assets and active projectiles.

## Testing

Unit tests cover:

- deterministic habitat zone generation and depth constraints;
- guaranteed dense demo habitat;
- school steering bounds and seabed/surface avoidance;
- habitat streaming activation and deactivation;
- projectile ballistic integration in air and water;
- swept-sphere time of impact;
- mass-based linear impulse and angular impulse;
- pool reuse, lifetime cleanup and invalid-state recovery;
- settings defaults and backwards-compatible merges.

Integration tests cover water-entry ripple coordinates, FPS input gating,
projectile-to-floating-body interaction and terrain regeneration.

Browser verification covers:

- a clearly visible, populated reef reached by the underwater demo action;
- fish species variation, schooling and natural plant motion;
- acceptable desktop FPS with the high-quality defaults;
- firing visible projectiles in FPS mode;
- air and underwater projectile trajectories;
- floating spheres reacting, submerging, rotating and settling after impacts;
- no new shader, asset-loading or disposal errors.

## Acceptance Criteria

1. The underwater demo view immediately shows multiple fish, several plant
   families and a dense reef composition.
2. Natural exploration encounters habitat zones without filling the entire
   world uniformly.
3. Close fish are recognizably modelled and animated; distant schools remain
   performant.
4. FPS primary fire produces visible finite-lifetime projectiles only while
   pointer lock is active.
5. Fast shots cannot pass through floating spheres at supported projectile
   speeds.
6. Impact response changes with projectile mass, speed and hit direction, then
   converges under buoyancy and drag.
7. Existing terrain generation, water rendering, editor controls and project
   loading continue to pass their current tests.
