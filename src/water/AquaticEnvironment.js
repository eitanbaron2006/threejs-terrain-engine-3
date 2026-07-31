import * as THREE from 'three';
import { createAquaticHabitatLayout } from './AquaticHabitatLayout.js';

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

function disposeMesh(mesh) {
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose?.());
  else mesh.material?.dispose?.();
}

function createBladeGeometry() {
  const geometry = new THREE.PlaneGeometry(0.3, 3.2, 1, 5);
  geometry.translate(0, 1.6, 0);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const y = positions.getY(index);
    positions.setX(index, positions.getX(index) + Math.pow(y / 3.2, 2) * 0.38);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createFishTailGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    -1.15, 0.78, 0,
    -1.15, -0.78, 0,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  return geometry;
}

export class AquaticEnvironment {
  constructor({ scene, spatialModel, settings = {} }) {
    this.scene = scene;
    this.spatialModel = spatialModel;
    this.settings = { ...settings };
    this.elapsed = 0;
    this.group = new THREE.Group();
    this.group.name = 'AquaticEnvironment';
    this.scene.add(this.group);
    this.fishRecords = [];
    this.meshes = [];
    this.dummy = new THREE.Object3D();
    this.rebuild(spatialModel, this.settings);
  }

  #addMesh(mesh) {
    this.group.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  rebuild(spatialModel = this.spatialModel, settings = this.settings) {
    this.spatialModel = spatialModel;
    this.settings = { ...settings };
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      disposeMesh(mesh);
    }
    this.meshes = [];
    this.fishRecords = [];
    this.layout = createAquaticHabitatLayout(spatialModel, {
      fishSchoolCount: Math.max(1, Math.ceil(Number(settings.fishCount ?? 30) / 10)),
      grassPatchCount: Math.max(0, Math.ceil(Number(settings.seagrassCount ?? 120) / 9)),
      coralClusterCount: Math.max(0, Number(settings.coralCount ?? 18)),
    });
    this.#createFish();
    this.#createSeagrass();
    this.#createCoral();
    this.group.visible = settings.aquaticLifeEnabled !== false;
  }

  #createFish() {
    const requested = Math.max(0, Math.min(48, Math.round(Number(this.settings.fishCount ?? 30))));
    if (!requested || !this.layout.fishSchools.length) return;
    const random = createRandom(this.spatialModel.seed + 2203);
    const bodyGeometry = new THREE.SphereGeometry(1, 14, 9);
    const tailGeometry = createFishTailGeometry();
    const bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: '#79a9a0',
      roughness: 0.52,
      metalness: 0.02,
      clearcoat: 0.12,
      vertexColors: true,
    });
    const tailMaterial = new THREE.MeshStandardMaterial({
      color: '#476f6d',
      roughness: 0.5,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.fishBodyMesh = this.#addMesh(new THREE.InstancedMesh(bodyGeometry, bodyMaterial, requested));
    this.fishTailMesh = this.#addMesh(new THREE.InstancedMesh(tailGeometry, tailMaterial, requested));
    this.fishBodyMesh.name = 'AquaticFishBodies';
    this.fishTailMesh.name = 'AquaticFishTails';
    this.fishBodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fishTailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const fishColors = ['#8ab8a7', '#6f91a4', '#c2a86d', '#758d72', '#a57c62'];

    for (let index = 0; index < requested; index += 1) {
      const school = this.layout.fishSchools[index % this.layout.fishSchools.length];
      const record = {
        school,
        orbit: random() * Math.PI * 2,
        orbitRadius: school.radius * (0.25 + random() * 0.72),
        verticalOffset: (random() - 0.5) * Math.min(5, school.depth * 0.22),
        speed: school.speed * (0.74 + random() * 0.52),
        phase: random() * Math.PI * 2,
        scale: 0.46 + random() * 0.38,
      };
      this.fishRecords.push(record);
      const color = new THREE.Color(fishColors[Math.floor(random() * fishColors.length)]);
      this.fishBodyMesh.setColorAt(index, color);
      this.fishTailMesh.setColorAt(index, color.clone().multiplyScalar(0.72));
    }
    this.fishBodyMesh.instanceColor.needsUpdate = true;
    this.fishTailMesh.instanceColor.needsUpdate = true;
    this.fishBodyMesh.castShadow = true;
  }

  #createSeagrass() {
    const requested = Math.max(0, Math.min(180, Math.round(Number(this.settings.seagrassCount ?? 120))));
    if (!requested || !this.layout.grassPatches.length) return;
    const random = createRandom(this.spatialModel.seed + 3701);
    const geometry = createBladeGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: '#2f6d51',
      roughness: 0.82,
      metalness: 0,
      emissive: '#123c2c',
      emissiveIntensity: 0.18,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    const mesh = this.#addMesh(new THREE.InstancedMesh(geometry, material, requested));
    mesh.name = 'AquaticSeagrass';
    const palette = ['#255943', '#34765a', '#5a7e55', '#38674d'];

    for (let index = 0; index < requested; index += 1) {
      const patch = this.layout.grassPatches[index % this.layout.grassPatches.length];
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * patch.radius;
      const x = patch.x + Math.cos(angle) * radius;
      const z = patch.z + Math.sin(angle) * radius;
      const floorY = this.spatialModel.sampleFloor(x, z);
      this.dummy.position.set(x, floorY + 0.08, z);
      this.dummy.rotation.set(0, random() * Math.PI * 2, (random() - 0.5) * 0.12);
      const scale = patch.scale * (0.56 + random() * 0.86);
      this.dummy.scale.set(scale, scale, scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
      mesh.setColorAt(index, new THREE.Color(palette[Math.floor(random() * palette.length)]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  #createCoral() {
    const requested = Math.max(0, Math.min(24, Math.round(Number(this.settings.coralCount ?? 18))));
    if (!requested || !this.layout.coralClusters.length) return;
    const random = createRandom(this.spatialModel.seed + 4903);
    const branchCount = requested * 7;
    const branchGeometry = new THREE.CylinderGeometry(0.22, 0.46, 1, 7, 1);
    branchGeometry.translate(0, 0.5, 0);
    const tipGeometry = new THREE.SphereGeometry(0.5, 10, 7);
    const coralMaterial = new THREE.MeshStandardMaterial({
      color: '#ad6f62',
      roughness: 0.68,
      metalness: 0,
      emissive: '#3d171b',
      emissiveIntensity: 0.12,
      vertexColors: true,
    });
    const branchMesh = this.#addMesh(new THREE.InstancedMesh(branchGeometry, coralMaterial, branchCount));
    const tipMesh = this.#addMesh(new THREE.InstancedMesh(tipGeometry, coralMaterial.clone(), branchCount));
    branchMesh.name = 'AquaticCoralBranches';
    tipMesh.name = 'AquaticCoralTips';
    const palette = ['#b56f64', '#cb8b72', '#9c6b84', '#d0a36f', '#8b7d65'];

    for (let index = 0; index < branchCount; index += 1) {
      const cluster = this.layout.coralClusters[Math.floor(index / 7) % this.layout.coralClusters.length];
      const localIndex = index % 7;
      const angle = localIndex / 7 * Math.PI * 2 + cluster.heading;
      const radial = localIndex === 0 ? 0 : cluster.radius * (0.28 + random() * 0.44);
      const x = cluster.x + Math.cos(angle) * radial;
      const z = cluster.z + Math.sin(angle) * radial;
      const floorY = this.spatialModel.sampleFloor(x, z);
      const height = cluster.scale * (1.4 + random() * 3.1);
      const lean = (random() - 0.5) * 0.38;
      const color = new THREE.Color(palette[Math.floor(random() * palette.length)]);

      this.dummy.position.set(x, floorY + 0.04, z);
      this.dummy.rotation.set(Math.cos(angle) * lean, angle, Math.sin(angle) * lean);
      this.dummy.scale.set(cluster.scale, height, cluster.scale);
      this.dummy.updateMatrix();
      branchMesh.setMatrixAt(index, this.dummy.matrix);
      branchMesh.setColorAt(index, color);

      this.dummy.position.set(
        x + Math.sin(angle) * lean * height * 0.45,
        floorY + height,
        z + Math.cos(angle) * lean * height * 0.45,
      );
      this.dummy.rotation.set(0, angle, 0);
      this.dummy.scale.setScalar(cluster.scale * (0.48 + random() * 0.3));
      this.dummy.updateMatrix();
      tipMesh.setMatrixAt(index, this.dummy.matrix);
      tipMesh.setColorAt(index, color.clone().offsetHSL(0, 0.03, 0.08));
    }
    branchMesh.instanceMatrix.needsUpdate = true;
    branchMesh.instanceColor.needsUpdate = true;
    tipMesh.instanceMatrix.needsUpdate = true;
    tipMesh.instanceColor.needsUpdate = true;
    branchMesh.castShadow = true;
    branchMesh.receiveShadow = true;
    tipMesh.castShadow = true;
  }

  applySettings(settings) {
    const requiresRebuild = (
      settings.fishCount !== this.settings.fishCount
      || settings.seagrassCount !== this.settings.seagrassCount
      || settings.coralCount !== this.settings.coralCount
    );
    this.settings = { ...settings };
    this.group.visible = this.settings.aquaticLifeEnabled !== false;
    if (requiresRebuild) this.rebuild(this.spatialModel, this.settings);
  }

  update(deltaSeconds) {
    if (!this.group.visible || !this.fishBodyMesh) return;
    this.elapsed += Math.min(Math.max(Number(deltaSeconds) || 0, 0), 0.05);
    for (let index = 0; index < this.fishRecords.length; index += 1) {
      const fish = this.fishRecords[index];
      const angle = fish.orbit + this.elapsed * fish.speed / Math.max(fish.orbitRadius, 1);
      const x = fish.school.x + Math.cos(angle) * fish.orbitRadius;
      const z = fish.school.z + Math.sin(angle) * fish.orbitRadius;
      const floorY = this.spatialModel.sampleFloor(x, z);
      const y = THREE.MathUtils.clamp(
        fish.school.y + fish.verticalOffset + Math.sin(this.elapsed * 1.3 + fish.phase) * 0.55,
        floorY + 1.2,
        this.spatialModel.waterLevel - 1.1,
      );
      const yaw = -angle + Math.PI * 0.5;
      const swim = Math.sin(this.elapsed * 7.5 + fish.phase);

      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(0, yaw, swim * 0.025);
      this.dummy.scale.set(1.55 * fish.scale, 0.5 * fish.scale, 0.68 * fish.scale);
      this.dummy.updateMatrix();
      this.fishBodyMesh.setMatrixAt(index, this.dummy.matrix);

      const backwardX = Math.cos(yaw + Math.PI) * 1.25 * fish.scale;
      const backwardZ = -Math.sin(yaw + Math.PI) * 1.25 * fish.scale;
      this.dummy.position.set(x + backwardX, y, z + backwardZ);
      this.dummy.rotation.set(0, yaw + swim * 0.24, 0);
      this.dummy.scale.setScalar(fish.scale);
      this.dummy.updateMatrix();
      this.fishTailMesh.setMatrixAt(index, this.dummy.matrix);
    }
    this.fishBodyMesh.instanceMatrix.needsUpdate = true;
    this.fishTailMesh.instanceMatrix.needsUpdate = true;
  }

  getDemoView() {
    return this.layout?.demoView ?? null;
  }

  getDiagnostics() {
    return {
      fish: this.fishRecords.length,
      seagrass: this.meshes.find((mesh) => mesh.name === 'AquaticSeagrass')?.count ?? 0,
      coralBranches: this.meshes.find((mesh) => mesh.name === 'AquaticCoralBranches')?.count ?? 0,
    };
  }

  dispose() {
    this.scene.remove(this.group);
    for (const mesh of this.meshes) disposeMesh(mesh);
    this.meshes = [];
    this.fishRecords = [];
  }
}
