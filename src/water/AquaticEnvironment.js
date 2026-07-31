import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { AquaticAssetLibrary } from './AquaticAssetLibrary.js';
import { createAquaticHabitatGeometryKit } from './AquaticHabitatGeometry.js';
import { createAquaticHabitatLayout } from './AquaticHabitatLayout.js';
import { HabitatStream } from './AquaticHabitatStream.js';
import { computeSchoolVelocity } from './AquaticSchooling.js';

const HERO_SPECIES = [
  {
    id: 'reef-fish-a',
    url: '/assets/aquatic/fish/fish-1.fbx',
    license: 'CC0-1.0',
    scale: 0.0018,
    tint: '#d6a85f',
    swimClip: 'Armature|Swim',
    habitats: ['reef', 'grass-bed'],
  },
  {
    id: 'reef-fish-b',
    url: '/assets/aquatic/fish/fish-2.fbx',
    license: 'CC0-1.0',
    scale: 0.0015,
    tint: '#68a6ad',
    swimClip: 'Armature|Swim.001',
    habitats: ['reef'],
  },
  {
    id: 'reef-fish-c',
    url: '/assets/aquatic/fish/fish-3.fbx',
    license: 'CC0-1.0',
    scale: 0.002,
    tint: '#b96f5d',
    swimClip: 'Armature|Swim',
    habitats: ['reef', 'grass-bed'],
  },
  {
    id: 'manta',
    url: '/assets/aquatic/fish/manta-ray.fbx',
    license: 'CC0-1.0',
    scale: 0.003,
    tint: '#637f8a',
    swimClip: 'Armature|Swim',
    habitats: ['deep-school'],
  },
  {
    id: 'shark',
    url: '/assets/aquatic/fish/shark.fbx',
    license: 'CC0-1.0',
    scale: 0.0025,
    tint: '#71838a',
    swimClip: 'Armature|Swim',
    habitats: ['deep-school', 'reef'],
  },
];

const QUALITY = {
  low: {
    activationRadius: 170,
    releaseRadius: 220,
    fishLimit: 54,
    vegetationLimit: 480,
    heroLimit: 4,
  },
  medium: {
    activationRadius: 230,
    releaseRadius: 300,
    fishLimit: 100,
    vegetationLimit: 1100,
    heroLimit: 8,
  },
  high: {
    activationRadius: 300,
    releaseRadius: 380,
    fishLimit: 180,
    vegetationLimit: 2000,
    heroLimit: 12,
  },
};

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createRandom(seed) {
  let state = (Math.trunc(Number(seed) || 1) >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createFishTailGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    -1.18, 0.82, 0,
    -1.18, -0.82, 0,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

function qualitySettings(settings) {
  return QUALITY[settings.habitatQuality] ?? QUALITY.high;
}

function paletteFor(item) {
  if (item.id.includes('grass')) return ['#3d9869', '#52aa74', '#6b9b61', '#849653'];
  if (item.id.includes('kelp')) return ['#7f944e', '#9aa45a', '#698844'];
  if (item.id.includes('coral')) return ['#e58a78', '#ed9a78', '#d8a16f', '#c6819c', '#d8b176'];
  if (item.id.includes('sponge')) return ['#e29a45', '#eead54', '#d18950', '#dda93f'];
  return ['#68766e', '#7c8178', '#596860'];
}

function configureUnderwaterInstanceMaterial(material, colorFill = 0.12) {
  material.envMapIntensity = 0.08;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       totalEmissiveRadiance += diffuseColor.rgb * ${colorFill.toFixed(3)};`,
    );
  };
  material.customProgramCacheKey = () => `aquatic-instance-color-v2-${colorFill}`;
  return material;
}

export class AquaticEnvironment {
  constructor({
    scene,
    spatialModel,
    settings = {},
    loadAsset = null,
  }) {
    this.scene = scene;
    this.spatialModel = spatialModel;
    this.settings = { ...settings };
    this.elapsed = 0;
    this.streamAccumulator = 0;
    this.disposed = false;
    this.group = new THREE.Group();
    this.group.name = 'AquaticEnvironment';
    this.scene.add(this.group);
    this.batchGroup = new THREE.Group();
    this.batchGroup.name = 'AquaticHabitatBatches';
    this.heroGroup = new THREE.Group();
    this.heroGroup.name = 'AquaticHeroFish';
    this.group.add(this.batchGroup, this.heroGroup);
    this.geometryKit = createAquaticHabitatGeometryKit();
    this.batchMeshes = [];
    this.ownedResources = new Set();
    this.fishRecords = [];
    this.heroRecords = [];
    this.heroTemplates = new Map();
    this.dummy = new THREE.Object3D();
    const loader = new FBXLoader();
    this.assetLibrary = new AquaticAssetLibrary({
      load: loadAsset ?? ((entry) => loader.loadAsync(entry.url)),
      fallbackFactory: () => null,
    });
    this.rebuild(spatialModel, this.settings);
    this.#loadHeroSpecies();
  }

  #registerBatch(mesh, ownsResources = false) {
    this.batchGroup.add(mesh);
    this.batchMeshes.push(mesh);
    if (ownsResources) {
      this.ownedResources.add(mesh.geometry);
      if (Array.isArray(mesh.material)) mesh.material.forEach((item) => this.ownedResources.add(item));
      else this.ownedResources.add(mesh.material);
    }
    return mesh;
  }

  #clearBatches() {
    for (const mesh of this.batchMeshes) this.batchGroup.remove(mesh);
    this.batchMeshes = [];
    for (const resource of this.ownedResources) resource.dispose?.();
    this.ownedResources.clear();
    this.fishRecords = [];
    this.fishBodyMesh = null;
    this.fishTailMesh = null;
    this.vegetationCount = 0;
  }

  #clearHeroes() {
    for (const record of this.heroRecords) {
      record.mixer.stopAllAction();
      this.heroGroup.remove(record.root);
    }
    this.heroRecords = [];
  }

  #configureStream() {
    const quality = qualitySettings(this.settings);
    this.stream = new HabitatStream({
      activationRadius: quality.activationRadius,
      releaseRadius: quality.releaseRadius,
    });
    this.stream.setLayout(this.layout);
    if (this.layout.demoZone) this.stream.activate(this.layout.demoZone.id);
  }

  rebuild(spatialModel = this.spatialModel, settings = this.settings) {
    this.spatialModel = spatialModel;
    this.settings = { ...settings };
    this.#clearBatches();
    this.#clearHeroes();
    this.layout = createAquaticHabitatLayout(spatialModel, {
      habitatDensity: finite(settings.habitatDensity, 1),
      fishSchoolCount: Math.max(1, Math.ceil(Number(settings.fishCount ?? 30) / 10)),
      grassPatchCount: Math.max(0, Math.ceil(Number(settings.seagrassCount ?? 120) / 9)),
      coralClusterCount: Math.max(0, Number(settings.coralCount ?? 18)),
    });
    this.#configureStream();
    this.#rebuildActiveBatches();
    this.group.visible = settings.aquaticLifeEnabled !== false;
  }

  async #loadHeroSpecies() {
    const loaded = await Promise.all(HERO_SPECIES.map(async (entry) => {
      const object = await this.assetLibrary.loadSpecies(entry);
      return { entry, object };
    }));
    if (this.disposed) return;
    for (const { entry, object } of loaded) {
      if (!object) continue;
      object.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = true;
        if (child.material?.clone) {
          child.material = child.material.clone();
          if ('roughness' in child.material) child.material.roughness = 0.76;
          if ('metalness' in child.material) child.material.metalness = 0;
          if ('envMapIntensity' in child.material) child.material.envMapIntensity = 0.08;
          if ('clearcoat' in child.material) child.material.clearcoat = 0.02;
          if (child.material.color) {
            child.material.color.lerp(new THREE.Color(entry.tint), 0.34);
          }
          if (child.material.emissive) {
            child.material.emissive.copy(new THREE.Color(entry.tint)).multiplyScalar(0.1);
            child.material.emissiveIntensity = 0.24;
          }
        }
      });
      this.heroTemplates.set(entry.id, { entry, object });
    }
    this.#rebuildHeroFish();
  }

  #activeZones() {
    return this.layout.zones.filter((zone) => this.stream.active.has(zone.id));
  }

  #rebuildActiveBatches() {
    this.#clearBatches();
    const zones = this.#activeZones();
    if (!zones.length) {
      this.#clearHeroes();
      return;
    }
    this.#createSchoolFish(zones);
    this.#createHabitatInstances(zones);
    this.#rebuildHeroFish();
  }

  #createSchoolFish(zones) {
    if (this.settings.fishEnabled === false || Number(this.settings.fishCount ?? 30) <= 0) return;
    const quality = qualitySettings(this.settings);
    const density = clamp(finite(this.settings.fishSchoolDensity, 1), 0.1, 2)
      * clamp(finite(this.settings.fishCount, 30) / 30, 0, 1.6);
    const requested = Math.min(
      quality.fishLimit,
      Math.max(0, Math.round(zones.reduce((sum, zone) => sum + zone.fishTarget, 0) * density)),
    );
    if (!requested) return;

    const random = createRandom(this.spatialModel.seed + 2203 + zones.length * 97);
    const bodyGeometry = new THREE.SphereGeometry(1, 14, 9);
    const tailGeometry = createFishTailGeometry();
    const bodyMaterial = configureUnderwaterInstanceMaterial(new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      emissive: '#152d2c',
      emissiveIntensity: 0.28,
      roughness: 0.72,
      metalness: 0,
      clearcoat: 0.02,
      vertexColors: false,
    }), 0.14);
    const tailMaterial = configureUnderwaterInstanceMaterial(new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#102524',
      emissiveIntensity: 0.24,
      roughness: 0.78,
      metalness: 0,
      vertexColors: false,
      side: THREE.DoubleSide,
    }), 0.12);
    this.fishBodyMesh = this.#registerBatch(
      new THREE.InstancedMesh(bodyGeometry, bodyMaterial, requested),
      true,
    );
    this.fishTailMesh = this.#registerBatch(
      new THREE.InstancedMesh(tailGeometry, tailMaterial, requested),
      true,
    );
    this.fishBodyMesh.name = 'AquaticSchoolFishBodies';
    this.fishTailMesh.name = 'AquaticSchoolFishTails';
    this.fishBodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fishTailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const colors = ['#9cc9b8', '#83afc4', '#d6bd72', '#8fa784', '#c98269', '#a5bd91'];

    for (let index = 0; index < requested; index += 1) {
      const zone = zones[index % zones.length];
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * zone.radius * 0.65;
      const x = zone.x + Math.cos(angle) * radius;
      const z = zone.z + Math.sin(angle) * radius;
      const floorY = this.spatialModel.sampleFloor(x, z);
      const upperY = this.spatialModel.waterLevel - 1.4;
      const y = Math.min(
        upperY,
        floorY + 2.2 + random() * Math.max(1, Math.min(zone.depth * 0.52, 10)),
      );
      const heading = random() * Math.PI * 2;
      const speed = 1.2 + random() * 1.6;
      this.fishRecords.push({
        zone,
        position: new THREE.Vector3(x, y, z),
        velocity: new THREE.Vector3(Math.cos(heading) * speed, 0, Math.sin(heading) * speed),
        phase: random() * Math.PI * 2,
        scale: 0.38 + random() * 0.5,
        maximumSpeed: 2.2 + random() * 1.7,
      });
      const color = new THREE.Color(colors[Math.floor(random() * colors.length)]);
      this.fishBodyMesh.setColorAt(index, color);
      this.fishTailMesh.setColorAt(index, color.clone().multiplyScalar(0.7));
    }
    this.fishBodyMesh.instanceColor.needsUpdate = true;
    this.fishTailMesh.instanceColor.needsUpdate = true;
  }

  #createHabitatInstances(zones) {
    const quality = qualitySettings(this.settings);
    const density = clamp(finite(this.settings.vegetationDensity, 1), 0.1, 2);
    const baseTotal = Math.min(
      quality.vegetationLimit,
      Math.max(0, Math.round(
        zones.reduce((sum, zone) => sum + zone.vegetationTarget, 0) * density,
      )),
    );
    if (!baseTotal) return;

    const families = [
      {
        id: 'plants', descriptors: this.geometryKit.plants, enabled: this.settings.plantsEnabled !== false,
        amount: finite(this.settings.seagrassCount, 120), baseline: 120, share: 0.56,
      },
      {
        id: 'corals', descriptors: this.geometryKit.corals, enabled: this.settings.coralsEnabled !== false,
        amount: finite(this.settings.coralCount, 18), baseline: 18, share: 0.2,
      },
      {
        id: 'sponges', descriptors: this.geometryKit.sponges, enabled: this.settings.spongesEnabled !== false,
        amount: finite(this.settings.spongeCount, 12), baseline: 12, share: 0.1,
      },
      {
        id: 'rocks', descriptors: this.geometryKit.rocks, enabled: this.settings.rocksEnabled !== false,
        amount: finite(this.settings.underwaterRockCount, 24), baseline: 24, share: 0.14,
      },
    ];
    const activeFamilies = families.filter((family) => family.enabled && family.amount > 0);
    if (!activeFamilies.length) return;
    const desiredByFamily = new Map(activeFamilies.map((family) => [
      family.id,
      Math.max(1, Math.round(baseTotal * family.share * (family.amount / family.baseline))),
    ]));
    const desiredTotal = [...desiredByFamily.values()].reduce((sum, count) => sum + count, 0);
    const budgetScale = Math.min(1, quality.vegetationLimit / Math.max(1, desiredTotal));
    const descriptors = activeFamilies.flatMap((family) => family.descriptors);
    const counts = new Map(descriptors.map((item) => [item.id, 0]));
    for (const family of activeFamilies) {
      const familyTotal = Math.max(1, Math.round(desiredByFamily.get(family.id) * budgetScale));
      for (let index = 0; index < familyTotal; index += 1) {
        const item = family.descriptors[index % family.descriptors.length];
        counts.set(item.id, counts.get(item.id) + 1);
      }
    }

    const random = createRandom(this.spatialModel.seed + 3701 + zones.length * 151);
    for (const item of descriptors) {
      const count = counts.get(item.id);
      if (!count) continue;
      const mesh = this.#registerBatch(new THREE.InstancedMesh(
        item.geometry,
        item.material,
        count,
      ));
      mesh.name = `AquaticHabitat:${item.id}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const palette = paletteFor(item);

      for (let index = 0; index < count; index += 1) {
        const compatible = zones.filter((zone) => (
          zone.habitatClass === 'reef'
          || (zone.habitatClass === 'grass-bed'
            && (item.id.includes('grass') || item.id.includes('kelp') || item.id.includes('rock')))
          || (zone.habitatClass === 'deep-school' && item.id.includes('rock'))
        ));
        const zone = compatible[index % compatible.length] ?? zones[index % zones.length];
        const angle = random() * Math.PI * 2;
        const isDemoShowcase = zone.id === this.layout.demoZone?.id && index < Math.min(count, 7);
        const radius = isDemoShowcase
          ? 4.5 + index * 2.1 + random() * 1.6
          : Math.sqrt(random()) * zone.radius;
        const x = zone.x + Math.cos(angle) * radius;
        const z = zone.z + Math.sin(angle) * radius;
        const floorY = this.spatialModel.sampleFloor(x, z);
        const baseScale = item.id.includes('grass') ? 0.65 : item.id.includes('coral') ? 0.9 : 0.72;
        const showcaseScale = isDemoShowcase ? 1.28 : 1;
        const scale = baseScale * (0.58 + random() * 1.05) * zone.density * showcaseScale;
        this.dummy.position.set(x, floorY + 0.04, z);
        this.dummy.rotation.set(
          (random() - 0.5) * 0.08,
          random() * Math.PI * 2,
          (random() - 0.5) * (item.sway ? 0.22 : 0.08),
        );
        this.dummy.scale.set(
          scale * (0.8 + random() * 0.4),
          scale * (0.75 + random() * 0.65),
          scale * (0.8 + random() * 0.4),
        );
        this.dummy.updateMatrix();
        mesh.setMatrixAt(index, this.dummy.matrix);
        const color = new THREE.Color(palette[Math.floor(random() * palette.length)]);
        color.offsetHSL((random() - 0.5) * 0.025, (random() - 0.5) * 0.06, (random() - 0.5) * 0.06);
        mesh.setColorAt(index, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    this.vegetationCount = [...counts.values()].reduce((sum, count) => sum + count, 0);
  }

  #rebuildHeroFish() {
    this.#clearHeroes();
    const zones = this.#activeZones();
    if (
      !zones.length
      || !this.heroTemplates.size
      || this.settings.fishEnabled === false
      || Number(this.settings.fishCount ?? 30) <= 0
    ) return;
    const limit = Math.round(
      qualitySettings(this.settings).heroLimit
      * clamp(finite(this.settings.fishCount, 30) / 30, 0, 1.6),
    );
    const random = createRandom(this.spatialModel.seed + 9929 + zones.length * 211);
    const compatible = [];
    for (const zone of zones) {
      for (const template of this.heroTemplates.values()) {
        if (template.entry.habitats.includes(zone.habitatClass)) compatible.push({ zone, template });
      }
    }

    for (let index = 0; index < Math.min(limit, compatible.length * 2); index += 1) {
      const { zone, template } = compatible[index % compatible.length];
      const root = cloneSkeleton(template.object);
      const scale = template.entry.scale * (0.78 + random() * 0.34);
      root.scale.setScalar(scale);
      const angle = random() * Math.PI * 2;
      const radius = 5 + random() * zone.radius * 0.45;
      const x = zone.x + Math.cos(angle) * radius;
      const z = zone.z + Math.sin(angle) * radius;
      const floorY = this.spatialModel.sampleFloor(x, z);
      const y = Math.min(
        this.spatialModel.waterLevel - 1.8,
        floorY + 3 + random() * Math.max(1, Math.min(zone.depth * 0.42, 8)),
      );
      root.position.set(x, y, z);
      root.rotation.y = angle;
      this.heroGroup.add(root);
      const mixer = new THREE.AnimationMixer(root);
      const clip = root.animations?.find((item) => item.name === template.entry.swimClip)
        ?? root.animations?.[0]
        ?? template.object.animations?.find((item) => item.name === template.entry.swimClip)
        ?? template.object.animations?.[0];
      if (clip) {
        const action = mixer.clipAction(clip);
        action.timeScale = 0.72 + random() * 0.42;
        action.play();
      }
      this.heroRecords.push({
        root,
        mixer,
        zone,
        phase: random() * Math.PI * 2,
        velocity: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
          .multiplyScalar(1.1 + random() * 1.2),
        maximumSpeed: template.entry.id === 'shark' ? 3.6 : 2.8,
      });
    }
  }

  #updateSchoolFish(delta) {
    if (!this.fishBodyMesh || !this.fishTailMesh) return;
    for (let index = 0; index < this.fishRecords.length; index += 1) {
      const fish = this.fishRecords[index];
      const floorY = this.spatialModel.sampleFloor(fish.position.x, fish.position.z);
      const centerY = Math.min(
        this.spatialModel.waterLevel - 2,
        fish.zone.floorY + Math.min(7, fish.zone.depth * 0.45),
      );
      const next = computeSchoolVelocity({
        position: fish.position,
        velocity: fish.velocity,
        neighbours: [],
        center: { x: fish.zone.x, y: centerY, z: fish.zone.z },
        floorY,
        surfaceY: this.spatialModel.waterLevel,
        seedPhase: fish.phase,
        elapsed: this.elapsed,
        maximumSpeed: fish.maximumSpeed,
      }, delta);
      fish.velocity.set(next.x, next.y, next.z);
      fish.position.addScaledVector(fish.velocity, delta);
      const yaw = Math.atan2(fish.velocity.z, fish.velocity.x);
      const swim = Math.sin(this.elapsed * 8 + fish.phase);

      this.dummy.position.copy(fish.position);
      this.dummy.rotation.set(0, -yaw, swim * 0.025);
      this.dummy.scale.set(1.55 * fish.scale, 0.5 * fish.scale, 0.68 * fish.scale);
      this.dummy.updateMatrix();
      this.fishBodyMesh.setMatrixAt(index, this.dummy.matrix);

      this.dummy.position.copy(fish.position).addScaledVector(fish.velocity, -0.42 * fish.scale);
      this.dummy.rotation.set(0, -yaw + swim * 0.26, 0);
      this.dummy.scale.setScalar(fish.scale);
      this.dummy.updateMatrix();
      this.fishTailMesh.setMatrixAt(index, this.dummy.matrix);
    }
    this.fishBodyMesh.instanceMatrix.needsUpdate = true;
    this.fishTailMesh.instanceMatrix.needsUpdate = true;
    this.fishBodyMesh.computeBoundingSphere();
    this.fishTailMesh.computeBoundingSphere();
  }

  #updateHeroFish(delta) {
    for (const record of this.heroRecords) {
      const floorY = this.spatialModel.sampleFloor(record.root.position.x, record.root.position.z);
      const centerY = Math.min(
        this.spatialModel.waterLevel - 2.2,
        record.zone.floorY + Math.min(7, record.zone.depth * 0.42),
      );
      const next = computeSchoolVelocity({
        position: record.root.position,
        velocity: record.velocity,
        neighbours: [],
        center: { x: record.zone.x, y: centerY, z: record.zone.z },
        floorY,
        surfaceY: this.spatialModel.waterLevel,
        seedPhase: record.phase,
        elapsed: this.elapsed,
        maximumSpeed: record.maximumSpeed,
      }, delta);
      record.velocity.set(next.x, next.y, next.z);
      record.root.position.addScaledVector(record.velocity, delta);
      record.root.rotation.y = Math.atan2(record.velocity.x, record.velocity.z);
      record.root.rotation.z = Math.sin(this.elapsed * 1.2 + record.phase) * 0.035;
      record.mixer.update(delta);
    }
  }

  applySettings(settings) {
    const requiresRebuild = (
      settings.fishCount !== this.settings.fishCount
      || settings.seagrassCount !== this.settings.seagrassCount
      || settings.coralCount !== this.settings.coralCount
      || settings.habitatDensity !== this.settings.habitatDensity
      || settings.fishSchoolDensity !== this.settings.fishSchoolDensity
      || settings.vegetationDensity !== this.settings.vegetationDensity
      || settings.habitatQuality !== this.settings.habitatQuality
      || settings.fishEnabled !== this.settings.fishEnabled
      || settings.plantsEnabled !== this.settings.plantsEnabled
      || settings.coralsEnabled !== this.settings.coralsEnabled
      || settings.spongesEnabled !== this.settings.spongesEnabled
      || settings.rocksEnabled !== this.settings.rocksEnabled
      || settings.spongeCount !== this.settings.spongeCount
      || settings.underwaterRockCount !== this.settings.underwaterRockCount
    );
    this.settings = { ...settings };
    this.group.visible = this.settings.aquaticLifeEnabled !== false;
    if (requiresRebuild) this.rebuild(this.spatialModel, this.settings);
  }

  update(deltaSeconds, focus = null) {
    if (!this.group.visible) return;
    const delta = Math.min(Math.max(Number(deltaSeconds) || 0, 0), 0.05);
    this.elapsed += delta;
    this.geometryKit.update(this.elapsed);
    this.streamAccumulator += delta;
    if (focus && this.streamAccumulator >= 0.2) {
      const changes = this.stream.update(focus);
      if (changes.activated.length || changes.released.length) this.#rebuildActiveBatches();
      this.streamAccumulator = 0;
    }
    this.#updateSchoolFish(delta);
    this.#updateHeroFish(delta);
  }

  getDemoView() {
    const id = this.layout.demoZone?.id;
    if (id && !this.stream.active.has(id) && this.stream.activate(id)) {
      this.#rebuildActiveBatches();
    }
    return this.layout?.demoView ?? null;
  }

  get activeZoneCount() {
    return this.stream?.active.size ?? 0;
  }

  get heroFishCount() {
    return this.heroRecords.length;
  }

  getDiagnostics() {
    return {
      activeHabitats: this.activeZoneCount,
      fish: this.fishRecords.length + this.heroRecords.length,
      schoolFish: this.fishRecords.length,
      heroFish: this.heroRecords.length,
      vegetation: this.vegetationCount ?? 0,
      coralMorphologies: this.geometryKit.corals.length,
      seagrass: this.batchMeshes
        .filter((mesh) => mesh.name.includes('grass') || mesh.name.includes('kelp'))
        .reduce((sum, mesh) => sum + mesh.count, 0),
      coralBranches: this.batchMeshes
        .filter((mesh) => mesh.name.includes('coral'))
        .reduce((sum, mesh) => sum + mesh.count, 0),
    };
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    this.#clearBatches();
    this.#clearHeroes();
    for (const template of this.heroTemplates.values()) {
      template.object.traverse((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
        else child.material?.dispose?.();
      });
    }
    this.heroTemplates.clear();
    this.assetLibrary.clear();
    this.geometryKit.dispose();
  }
}
