# Aquatic Ecosystem And FPS Projectiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build dense, discoverable aquatic habitats with optimized animated fish and add visible FPS projectiles that physically interact with floating water objects.

**Architecture:** Seeded habitat zones replace sparse world-wide placement. A camera-focused streaming layer activates hero fish, instanced schools and instanced reef vegetation near the viewer. A pooled projectile system owns fixed-step motion and delegates swept collision impulses to a narrow water-interaction API.

**Tech Stack:** JavaScript ES modules, Three.js 0.185.1, GLTFLoader, InstancedMesh, AnimationMixer, Node test runner, existing terrain/water samplers.

**Version Control:** Per the user's instruction, do not create commits, push, or change Git history while executing this plan.

---

## File Map

- Create `src/water/AquaticSchooling.js`: deterministic school steering helpers.
- Create `src/water/AquaticHabitatGeometry.js`: reusable fish, plant, coral, sponge and rock geometry/material factories.
- Create `src/water/AquaticAssetLibrary.js`: local GLB loading, validation, caching and procedural fallback.
- Modify `src/water/AquaticHabitatLayout.js`: generate habitat zones and guaranteed demo reef.
- Modify `src/water/AquaticEnvironment.js`: stream zones around the camera and render the three quality tiers.
- Create `src/player/ProjectilePhysics.js`: pure projectile integration and swept-sphere collision math.
- Create `src/player/FpsProjectileSystem.js`: projectile pooling, rendering, input and collision orchestration.
- Modify `src/water/WaterInteractionPhysics.js`: mass and contact-impulse helpers.
- Modify `src/water/WaterInteractionSystem.js`: public projectile impact API and angular body response.
- Modify `src/water/AdvancedWaterSystem.js`: focus-aware habitat update, ripples and projectile-facing API.
- Modify `src/player/FpsPlayerController.js`: primary-fire input gating and projectile-system lifecycle.
- Modify `src/app/TerrainEditorApp.js`: construct and update the projectile system.
- Modify `src/terrain/TerrainConfig.js`: backwards-compatible aquatic and projectile defaults.
- Modify `src/ui/EditorUI.js`: quality, density, projectile and reset controls.
- Create `public/assets/aquatic/manifest.json`: local asset metadata and species mapping.
- Create `public/assets/aquatic/LICENSES.md`: source and CC0 records.
- Add focused tests under `tests/`.

## Task 1: Habitat Zones And School Steering

**Files:**
- Modify: `src/water/AquaticHabitatLayout.js`
- Create: `src/water/AquaticSchooling.js`
- Test: `tests/AquaticHabitatZones.test.js`
- Test: `tests/AquaticSchooling.test.js`

- [ ] **Step 1: Write failing habitat-zone tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAquaticHabitatLayout } from '../src/water/AquaticHabitatLayout.js';

test('creates a deterministic dense demo habitat', () => {
  const spatial = createSpatialFixture({ seed: 1337, waterLevel: -3 });
  const first = createAquaticHabitatLayout(spatial, { habitatDensity: 1 });
  const second = createAquaticHabitatLayout(spatial, { habitatDensity: 1 });
  assert.deepEqual(first.zones, second.zones);
  assert.ok(first.demoZone);
  assert.ok(first.demoZone.fishTarget >= 36);
  assert.ok(first.demoZone.vegetationTarget >= 180);
});

test('does not place coral in inland habitat classes', () => {
  const spatial = createSpatialFixture({ inlandOnly: true });
  const layout = createAquaticHabitatLayout(spatial, { habitatDensity: 1 });
  assert.ok(layout.zones.every((zone) => zone.habitatClass !== 'reef'));
});
```

- [ ] **Step 2: Run the zone tests and verify the missing-zone failure**

Run: `node --test tests/AquaticHabitatZones.test.js`

Expected: FAIL because `zones` and `demoZone` do not exist.

- [ ] **Step 3: Implement seeded habitat-zone records**

```js
export function createAquaticHabitatLayout(spatialModel, options = {}) {
  const density = clampFinite(options.habitatDensity, 0.25, 2, 1);
  const zoneCount = Math.round(10 * density);
  const candidates = spatialModel.findPositions({
    count: zoneCount * 3,
    minDepth: 4,
    maxDepth: 52,
    minSpacing: 110,
    margin: spatialModel.worldSize * 0.06,
    seedOffset: 0x51f15e,
  });
  const zones = candidates.slice(0, zoneCount).map((position, index) => {
    const habitatClass = classifyHabitat(spatialModel, position);
    return {
      id: `aquatic-zone-${index}`,
      seed: spatialModel.seed + index * 7919,
      x: position.x,
      z: position.z,
      floorY: position.floorY,
      depth: position.depth,
      radius: habitatClass === 'reef' ? 58 : 42,
      habitatClass,
      fishTarget: habitatClass === 'reef' ? 54 : 30,
      vegetationTarget: habitatClass === 'deep-school' ? 24 : 240,
    };
  });
  const demoZone = selectDemoZone(zones);
  return { zones, demoZone, demoView: createDemoView(demoZone, spatialModel) };
}
```

- [ ] **Step 4: Run the habitat tests and verify they pass**

Run: `node --test tests/AquaticHabitatZones.test.js`

Expected: PASS.

- [ ] **Step 5: Write failing bounded-steering tests**

```js
test('steers fish away from the seabed and surface', () => {
  const velocity = computeSchoolVelocity({
    position: { x: 0, y: -11.8, z: 0 },
    velocity: { x: 1, y: -2, z: 0 },
    neighbours: [],
    center: { x: 0, y: -8, z: 0 },
    floorY: -12,
    surfaceY: -3,
    seedPhase: 0.3,
  }, 0.1);
  assert.ok(velocity.y > -2);
  assert.ok(Math.hypot(velocity.x, velocity.y, velocity.z) <= 4.5);
});
```

- [ ] **Step 6: Run the steering test and verify the missing-export failure**

Run: `node --test tests/AquaticSchooling.test.js`

Expected: FAIL because `computeSchoolVelocity` is not exported.

- [ ] **Step 7: Implement deterministic school steering**

```js
export function computeSchoolVelocity(state, deltaSeconds) {
  const separation = accumulateSeparation(state.position, state.neighbours, 3.5);
  const alignment = averageHeading(state.neighbours, state.velocity);
  const cohesion = directionTo(state.position, state.center);
  const vertical = verticalAvoidance(
    state.position.y,
    state.floorY + 1.2,
    state.surfaceY - 1.1,
  );
  const wander = seededWander(state.seedPhase, state.elapsed ?? 0);
  return clampLength(addWeighted(
    state.velocity,
    separation, 1.8,
    alignment, 0.65,
    cohesion, 0.42,
    vertical, 2.2,
    wander, 0.28,
    deltaSeconds,
  ), 4.5);
}
```

- [ ] **Step 8: Run both focused suites**

Run: `node --test tests/AquaticHabitatZones.test.js tests/AquaticSchooling.test.js`

Expected: PASS.

## Task 2: Aquatic Assets And Natural Geometry Kit

**Files:**
- Create: `src/water/AquaticAssetLibrary.js`
- Create: `src/water/AquaticHabitatGeometry.js`
- Create: `public/assets/aquatic/manifest.json`
- Create: `public/assets/aquatic/LICENSES.md`
- Add: optimized `.glb` and texture files under `public/assets/aquatic/`
- Test: `tests/AquaticAssetLibrary.test.js`
- Test: `tests/AquaticHabitatGeometry.test.js`

- [ ] **Step 1: Write failing manifest validation tests**

```js
test('accepts only locally redistributable aquatic assets', () => {
  const result = validateAquaticManifest({
    species: [{ id: 'clownfish', url: '/assets/aquatic/fish/clownfish.glb', license: 'CC0-1.0' }],
  });
  assert.equal(result.species[0].id, 'clownfish');
});

test('rejects remote or unlicensed asset entries', () => {
  assert.throws(() => validateAquaticManifest({
    species: [{ id: 'bad', url: 'https://example.com/fish.glb' }],
  }), /local CC0 asset/i);
});
```

- [ ] **Step 2: Run the asset tests and verify the missing-export failure**

Run: `node --test tests/AquaticAssetLibrary.test.js`

Expected: FAIL because the asset library does not exist.

- [ ] **Step 3: Implement manifest validation and cached loading**

```js
export function validateAquaticManifest(manifest) {
  const species = (manifest?.species ?? []).map((entry) => {
    if (!entry?.id || !entry.url?.startsWith('/assets/aquatic/')
      || entry.license !== 'CC0-1.0') {
      throw new Error('Aquatic manifest entries must reference a local CC0 asset');
    }
    return { ...entry };
  });
  return { species };
}

export class AquaticAssetLibrary {
  constructor({ loader, fallbackFactory }) {
    this.loader = loader;
    this.fallbackFactory = fallbackFactory;
    this.cache = new Map();
  }

  async loadSpecies(entry) {
    if (!this.cache.has(entry.id)) {
      this.cache.set(entry.id, this.loader.loadAsync(entry.url)
        .catch(() => this.fallbackFactory(entry)));
    }
    return this.cache.get(entry.id);
  }
}
```

- [ ] **Step 4: Acquire and optimize the approved CC0 fish subset**

Use the official Quaternius Animated Fish pack source. Select a small,
biologically varied subset, convert to GLB if necessary, remove unused clips and
textures, and record source URL, author, license and conversion command in
`public/assets/aquatic/LICENSES.md`.

The manifest shape is:

```json
{
  "species": [
    {
      "id": "clownfish",
      "url": "/assets/aquatic/fish/clownfish.glb",
      "license": "CC0-1.0",
      "scale": 0.55,
      "swimClip": "Swim",
      "habitats": ["reef"]
    }
  ]
}
```

- [ ] **Step 5: Write failing geometry-family tests**

```js
test('provides distinct natural habitat silhouettes', () => {
  const kit = createAquaticHabitatGeometryKit();
  assert.ok(kit.plants.length >= 3);
  assert.ok(kit.corals.length >= 3);
  assert.ok(kit.sponges.length >= 2);
  assert.ok(kit.rocks.length >= 2);
  assert.notEqual(kit.corals[0].geometry.uuid, kit.corals[1].geometry.uuid);
});
```

- [ ] **Step 6: Implement reusable shape families and PBR materials**

```js
export function createAquaticHabitatGeometryKit() {
  return {
    plants: [
      createRibbonGrass(),
      createBladeGrass(),
      createKelpFrond(),
    ],
    corals: [
      createBranchingCoral(),
      createMassiveCoral(),
      createPlateCoral(),
    ],
    sponges: [createBarrelSponge(), createTubeSponge()],
    rocks: [createLowRock(), createRubbleRock()],
    dispose() {
      disposeFamilies(this);
    },
  };
}
```

- [ ] **Step 7: Run asset and geometry tests**

Run: `node --test tests/AquaticAssetLibrary.test.js tests/AquaticHabitatGeometry.test.js`

Expected: PASS.

## Task 3: Focus-Aware Habitat Streaming

**Files:**
- Modify: `src/water/AquaticEnvironment.js`
- Modify: `src/water/AdvancedWaterSystem.js`
- Test: `tests/AquaticHabitatStreaming.test.js`

- [ ] **Step 1: Write failing active-zone selection tests**

```js
test('activates nearby zones and releases distant zones', () => {
  const stream = new HabitatStream({ activationRadius: 180, releaseRadius: 230 });
  stream.setLayout({ zones: [
    { id: 'near', x: 40, z: 0 },
    { id: 'far', x: 600, z: 0 },
  ] });
  assert.deepEqual(stream.update({ x: 0, z: 0 }).activated, ['near']);
  assert.deepEqual(stream.update({ x: 650, z: 0 }).released, ['near']);
});
```

- [ ] **Step 2: Run the streaming test and verify the missing-class failure**

Run: `node --test tests/AquaticHabitatStreaming.test.js`

Expected: FAIL because `HabitatStream` does not exist.

- [ ] **Step 3: Implement hysteresis-based zone streaming**

```js
export class HabitatStream {
  constructor({ activationRadius, releaseRadius }) {
    this.activationRadius = activationRadius;
    this.releaseRadius = Math.max(releaseRadius, activationRadius);
    this.active = new Set();
    this.zones = [];
  }

  update(focus) {
    const activated = [];
    const released = [];
    for (const zone of this.zones) {
      const distance = Math.hypot(zone.x - focus.x, zone.z - focus.z);
      if (!this.active.has(zone.id) && distance <= this.activationRadius) {
        this.active.add(zone.id);
        activated.push(zone.id);
      } else if (this.active.has(zone.id) && distance > this.releaseRadius) {
        this.active.delete(zone.id);
        released.push(zone.id);
      }
    }
    return { activated, released };
  }
}
```

- [ ] **Step 4: Refactor `AquaticEnvironment` into streamed zone batches**

```js
update(deltaSeconds, focus) {
  if (!this.group.visible) return;
  this.streamAccumulator += deltaSeconds;
  if (this.streamAccumulator >= 0.2) {
    this.#applyStreamChanges(this.stream.update(focus));
    this.streamAccumulator = 0;
  }
  this.#updateHeroFish(deltaSeconds);
  this.#updateSchoolInstances(deltaSeconds);
  this.#updatePlantSway(deltaSeconds);
}
```

Create one `InstancedMesh` per active geometry/material family, set
`DynamicDrawUsage` only for moving fish/plants, and recompute bounds after
instance updates. Hero `AnimationMixer` count is capped by quality settings.

- [ ] **Step 5: Pass the camera target into the habitat update**

```js
this.aquaticEnvironment.update(deltaSeconds, {
  x: target.x,
  y: target.y ?? this.camera.position.y,
  z: target.z,
});
```

- [ ] **Step 6: Run the streaming and existing aquatic suites**

Run: `node --test tests/AquaticHabitatStreaming.test.js tests/AquaticHabitatLayout.test.js tests/AquaticWaterIntegration.test.js`

Expected: PASS.

## Task 4: Projectile And Contact Physics

**Files:**
- Create: `src/player/ProjectilePhysics.js`
- Modify: `src/water/WaterInteractionPhysics.js`
- Test: `tests/ProjectilePhysics.test.js`
- Test: `tests/WaterImpactPhysics.test.js`

- [ ] **Step 1: Write failing projectile integration tests**

```js
test('water drag rapidly reduces projectile speed', () => {
  const body = projectile({ velocity: { x: 0, y: 0, z: -60 } });
  integrateProjectile(body, {
    gravity: 9.81,
    surfaceY: 1,
    waterDrag: 0.085,
    floorY: -20,
  }, 0.1);
  assert.ok(Math.abs(body.velocity.z) < 45);
  assert.equal(body.inWater, true);
});

test('swept sphere catches a fast crossing projectile', () => {
  const hit = sweptSphereHit(
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    0.15,
    { x: 0, y: 0, z: 0 },
    3,
  );
  assert.ok(hit);
  assert.ok(hit.time >= 0 && hit.time <= 1);
});
```

- [ ] **Step 2: Verify projectile tests fail**

Run: `node --test tests/ProjectilePhysics.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement fixed-step projectile integration and swept collision**

```js
export function sweptSphereHit(start, end, projectileRadius, center, targetRadius) {
  const motion = subtract(end, start);
  const offset = subtract(start, center);
  const radius = projectileRadius + targetRadius;
  const a = dot(motion, motion);
  const b = 2 * dot(offset, motion);
  const c = dot(offset, offset) - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (a <= 1e-12 || discriminant < 0) return null;
  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (time < 0 || time > 1) return null;
  const point = add(start, scale(motion, time));
  return { time, point, normal: normalize(subtract(point, center)) };
}
```

`integrateProjectile` applies gravity, detects surface crossing, applies
velocity-dependent underwater drag, updates previous/current position and
returns `{ enteredWater, hitFloor, expired }`.

- [ ] **Step 4: Write failing mass-based impulse tests**

```js
test('faster and heavier projectiles transfer more momentum', () => {
  const targetA = floatingBody({ mass: 80 });
  const targetB = floatingBody({ mass: 80 });
  applySphereImpact(targetA, impact({ projectileMass: 0.1, speed: 30 }));
  applySphereImpact(targetB, impact({ projectileMass: 0.2, speed: 60 }));
  assert.ok(targetB.velocity.length() > targetA.velocity.length() * 2);
});

test('off-center impact adds angular velocity', () => {
  const target = floatingBody({ mass: 80, radius: 3 });
  applySphereImpact(target, impact({ contactOffset: { x: 0, y: 2, z: 0 } }));
  assert.ok(target.angularVelocity.lengthSq() > 0);
});
```

- [ ] **Step 5: Implement sphere mass and impulse helpers**

```js
export function sphereMass(radius, density, referenceDensity = 1000) {
  return 4 / 3 * Math.PI * radius ** 3 * density * referenceDensity;
}

export function applySphereImpact(body, impact) {
  const normalSpeed = dot(impact.relativeVelocity, impact.normal);
  if (normalSpeed >= 0) return 0;
  const inverseMass = 1 / body.mass + 1 / impact.projectileMass;
  const impulseMagnitude = -(1 + impact.restitution) * normalSpeed / inverseMass;
  const impulse = scale(impact.normal, impulseMagnitude);
  addScaled(body.velocity, impulse, 1 / body.mass);
  addAngularImpulse(body, cross(impact.contactOffset, impulse));
  return impulseMagnitude;
}
```

- [ ] **Step 6: Run both physics suites**

Run: `node --test tests/ProjectilePhysics.test.js tests/WaterImpactPhysics.test.js`

Expected: PASS.

## Task 5: Floating-Object Impact API

**Files:**
- Modify: `src/water/WaterInteractionSystem.js`
- Modify: `src/water/AdvancedWaterSystem.js`
- Test: `tests/WaterProjectileInteraction.test.js`

- [ ] **Step 1: Write a failing public-API interaction test**

```js
test('projectile sweep applies an impulse through the water API', () => {
  const system = createInteractionFixture();
  const before = system.bodies[0].velocity.clone();
  const result = system.traceProjectile({
    start: system.bodies[0].position.clone().add({ x: -10, y: 0, z: 0 }),
    end: system.bodies[0].position.clone().add({ x: 10, y: 0, z: 0 }),
    velocity: new Vector3(60, 0, 0),
    radius: 0.15,
    mass: 0.16,
  });
  assert.equal(result.hit, true);
  assert.ok(system.bodies[0].velocity.distanceTo(before) > 0);
});
```

- [ ] **Step 2: Verify the test fails because `traceProjectile` is missing**

Run: `node --test tests/WaterProjectileInteraction.test.js`

Expected: FAIL.

- [ ] **Step 3: Add body mass, angular state and public tracing**

```js
traceProjectile(projectile) {
  const nearest = findNearestSweptBody(projectile, this.bodies);
  if (!nearest) return { hit: false };
  applySphereImpact(nearest.body, {
    projectileMass: projectile.mass,
    relativeVelocity: projectile.velocity.clone().sub(nearest.body.velocity),
    normal: nearest.normal,
    contactOffset: nearest.point.clone().sub(nearest.body.position),
    restitution: 0.34,
  });
  return { hit: true, ...nearest };
}
```

Update rotation from `angularVelocity`, apply submerged angular damping, and add
`reset()` to restore seeded positions and zero both velocity vectors.

- [ ] **Step 4: Add narrow delegates to `AdvancedWaterSystem`**

```js
traceProjectile(projectile) {
  return this.interactions.traceProjectile(projectile);
}

resetFloatingObjects() {
  this.interactions.reset();
}

addProjectileRipple(x, z, strength) {
  const uv = this.#worldToSimulationUv(x, z);
  if (uv) this.simulation.addDrop(uv.x, uv.y, 0.012, strength);
}
```

- [ ] **Step 5: Run focused and existing buoyancy suites**

Run: `node --test tests/WaterProjectileInteraction.test.js tests/WaterInteractionPhysics.test.js`

Expected: PASS.

## Task 6: Pooled FPS Projectile System

**Files:**
- Create: `src/player/FpsProjectileSystem.js`
- Modify: `src/player/FpsPlayerController.js`
- Modify: `src/app/TerrainEditorApp.js`
- Test: `tests/FpsProjectileSystem.test.js`
- Test: `tests/FpsProjectileIntegration.test.js`

- [ ] **Step 1: Write failing pool and input-gating tests**

```js
test('fires only when FPS and pointer lock are active', () => {
  const system = createProjectileSystem();
  assert.equal(system.fire({ fpsEnabled: true, pointerLocked: false }), false);
  assert.equal(system.activeCount, 0);
  assert.equal(system.fire({ fpsEnabled: true, pointerLocked: true }), true);
  assert.equal(system.activeCount, 1);
});

test('reuses expired projectile slots', () => {
  const system = createProjectileSystem({ capacity: 2, lifetime: 0.1 });
  system.fire(activeFireContext());
  system.update(0.2);
  system.fire(activeFireContext());
  assert.equal(system.createdMeshCount, 2);
  assert.equal(system.activeCount, 1);
});
```

- [ ] **Step 2: Verify the projectile-system tests fail**

Run: `node --test tests/FpsProjectileSystem.test.js`

Expected: FAIL because `FpsProjectileSystem` does not exist.

- [ ] **Step 3: Implement the bounded projectile pool**

```js
export class FpsProjectileSystem {
  constructor({ scene, camera, world, waterSystem, settings }) {
    this.capacity = 48;
    this.cooldownRemaining = 0;
    this.projectiles = createProjectilePool(scene, this.capacity);
  }

  fire({ fpsEnabled, pointerLocked }) {
    if (!fpsEnabled || !pointerLocked || this.cooldownRemaining > 0) return false;
    const projectile = this.#claimProjectile();
    if (!projectile) return false;
    this.camera.getWorldDirection(projectile.velocity);
    projectile.velocity.multiplyScalar(this.settings.projectileSpeed);
    projectile.position.copy(this.camera.position)
      .addScaledVector(projectile.velocity, 0.035);
    projectile.previousPosition.copy(projectile.position);
    projectile.mass = this.settings.projectileMass;
    projectile.active = true;
    projectile.mesh.visible = true;
    this.cooldownRemaining = 1 / this.settings.projectileFireRate;
    return true;
  }
}
```

`update()` uses bounded substeps, terrain sampling, local water surface, swept
floating-body tests, ripple dispatch and pool release.

- [ ] **Step 4: Wire primary fire through the existing controller**

```js
this.onCanvasPointerDown = (event) => {
  if (event.button !== 0 || !this.enabled) return;
  if (document.pointerLockElement !== this.canvas) {
    this.canvas.requestPointerLock?.();
    return;
  }
  this.projectileSystem?.fire({
    fpsEnabled: this.enabled,
    pointerLocked: true,
  });
};
```

Remove the old click listener in favour of the pointer-down handler, and dispose
the new listener with the controller.

- [ ] **Step 5: Construct and update the projectile system in the app**

```js
this.projectiles = new FpsProjectileSystem({
  scene: this.scene,
  camera: this.camera,
  world: this.world,
  waterSystem: this.water,
  settings: this.settings.water,
});
```

Update after FPS movement and before final rendering. Dispose it before the water
system.

- [ ] **Step 6: Run projectile system and integration suites**

Run: `node --test tests/FpsProjectileSystem.test.js tests/FpsProjectileIntegration.test.js`

Expected: PASS.

## Task 7: Settings, Controls And Diagnostics

**Files:**
- Modify: `src/terrain/TerrainConfig.js`
- Modify: `src/ui/EditorUI.js`
- Modify: `src/water/AdvancedWaterSystem.js`
- Modify: `src/app/TerrainEditorApp.js`
- Test: `tests/AquaticProjectileSettings.test.js`
- Test: `tests/EditorUIWaterControls.test.js`

- [ ] **Step 1: Write failing default and merge tests**

```js
test('provides backwards-compatible ecosystem and projectile defaults', () => {
  assert.equal(DEFAULT_WATER_SETTINGS.habitatQuality, 'high');
  assert.equal(DEFAULT_WATER_SETTINGS.habitatDensity, 1);
  assert.equal(DEFAULT_WATER_SETTINGS.fpsProjectilesEnabled, true);
  assert.ok(DEFAULT_WATER_SETTINGS.projectileSpeed > 0);
  assert.ok(DEFAULT_WATER_SETTINGS.projectileMass > 0);
});
```

- [ ] **Step 2: Verify the defaults test fails**

Run: `node --test tests/AquaticProjectileSettings.test.js`

Expected: FAIL because the new defaults are absent.

- [ ] **Step 3: Add clamped additive settings**

```js
export const DEFAULT_WATER_SETTINGS = {
  ...existingWaterDefaults,
  habitatQuality: 'high',
  habitatDensity: 1,
  fishSchoolDensity: 1,
  vegetationDensity: 1,
  fpsProjectilesEnabled: true,
  projectileSpeed: 62,
  projectileMass: 0.16,
  projectileFireRate: 5,
};
```

- [ ] **Step 4: Add compact water-panel controls**

Add quality menu, density sliders, projectile toggle, speed/mass sliders and a
`Reset Floating Objects` command. Reuse existing control builders and event bus
patterns; do not create a second nested card.

```js
button.addEventListener('click', () => {
  this.eventBus.emit('water:reset-floating-objects');
});
```

- [ ] **Step 5: Extend diagnostics**

```js
getDiagnostics() {
  return {
    ...existing,
    activeHabitats: this.aquaticEnvironment.activeZoneCount,
    heroFish: this.aquaticEnvironment.heroFishCount,
    activeProjectiles: this.projectileSystem?.activeCount ?? 0,
  };
}
```

- [ ] **Step 6: Run settings and UI tests**

Run: `node --test tests/AquaticProjectileSettings.test.js tests/EditorUIWaterControls.test.js`

Expected: PASS.

## Task 8: Full Verification And Browser Validation

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run project validation**

Run: `npm run check`

Expected: exit code 0 with no missing imports or static shader errors.

- [ ] **Step 3: Start or reuse the local server**

Run: `npm start`

Expected: a local terrain editor URL, using a free port if `3000` is occupied.

- [ ] **Step 4: Verify the underwater ecosystem in Chrome**

At desktop and mobile-sized viewports:

- open the underwater demo;
- confirm several visible fish species and a dense but non-uniform reef;
- confirm fish remain between seabed and surface;
- confirm plants sway and caustics affect habitat objects;
- inspect console for shader, GLB and texture errors;
- record a screenshot and active-instance diagnostics.

- [ ] **Step 5: Verify FPS projectiles**

- enter FPS mode and acquire pointer lock;
- fire visible projectiles in air and underwater;
- shoot floating spheres centrally and off-center;
- confirm translation, rotation, temporary submersion and buoyant settling;
- confirm water-entry ripples and terrain cleanup;
- hold fire long enough to confirm the pool remains bounded;
- inspect console and diagnostics for invalid states.

- [ ] **Step 6: Re-run final verification after any browser fixes**

Run: `npm test && npm run check`

Expected: both commands exit 0.

- [ ] **Step 7: Inspect the final working tree without committing**

Run: `git status --short` and `git diff --check`

Expected: only intended source, asset, test and documentation changes; no
whitespace errors and no commit created.
