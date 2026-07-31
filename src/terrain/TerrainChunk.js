import * as THREE from 'three';
import { packControlWeights, smoothControlWeights, writeAutoWeights } from './noise.js';
import { analyzeTerrainSurface } from './TerrainSurfaceAnalysis.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rayBoxRange(ray, box) {
  let tMin = -Infinity;
  let tMax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];
    const min = box.min[axis];
    const max = box.max[axis];
    if (Math.abs(direction) < 1e-8) {
      if (origin < min || origin > max) return null;
      continue;
    }
    let t1 = (min - origin) / direction;
    let t2 = (max - origin) / direction;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  return [Math.max(0, tMin), tMax];
}

class TerrainChunkMesh extends THREE.Mesh {
  constructor(chunk, geometry, material) {
    super(geometry, material);
    this.chunk = chunk;
    this.userData.terrainChunk = chunk;
  }

  raycast(raycaster, intersections) {
    const chunk = this.chunk;
    const box = chunk.worldBounds;
    const range = rayBoxRange(raycaster.ray, box);
    if (!range) return;
    const [start, end] = range;
    const length = end - start;
    const steps = Math.max(24, Math.ceil(length / Math.max(chunk.step * 1.4, 1)));
    const point = new THREE.Vector3();
    let previousT = start;
    raycaster.ray.at(previousT, point);
    let previousDelta = point.y - chunk.sampleHeight(point.x, point.z);

    for (let step = 1; step <= steps; step += 1) {
      const t = start + (length * step) / steps;
      raycaster.ray.at(t, point);
      const delta = point.y - chunk.sampleHeight(point.x, point.z);
      if (previousDelta >= 0 && delta <= 0) {
        let low = previousT;
        let high = t;
        for (let iteration = 0; iteration < 10; iteration += 1) {
          const middle = (low + high) * 0.5;
          raycaster.ray.at(middle, point);
          const middleDelta = point.y - chunk.sampleHeight(point.x, point.z);
          if (middleDelta > 0) low = middle;
          else high = middle;
        }
        const hitT = (low + high) * 0.5;
        raycaster.ray.at(hitT, point);
        const distance = raycaster.ray.origin.distanceTo(point);
        if (distance < raycaster.near || distance > raycaster.far) return;
        intersections.push({
          distance,
          point: point.clone(),
          object: this,
          uv: chunk.worldToUv(point.x, point.z, new THREE.Vector2()),
          face: null,
          faceIndex: null,
        });
        return;
      }
      previousDelta = delta;
      previousT = t;
    }
  }
}

export class TerrainChunk {
  constructor({ descriptor, config, geometry, materialLibrary, generation }) {
    this.chunkX = descriptor.chunkX;
    this.chunkZ = descriptor.chunkZ;
    this.key = descriptor.key;
    this.config = config;
    this.resolution = Number(generation.resolution ?? Math.round(Math.sqrt(generation.heights.length)) ?? config.sourceResolution);
    this.vertexCount = this.resolution * this.resolution;
    this.step = config.chunkSize / (this.resolution - 1);
    this.originX = this.chunkX * config.chunkSize - config.chunkSize / 2;
    this.originZ = this.chunkZ * config.chunkSize - config.chunkSize / 2;
    this.heights = generation.heights;
    this.heightTextureData = generation.heightTextureData ?? this.#buildPaddedHeightTextureData(this.heights);
    this.heightTextureResolution = Number(generation.heightTextureResolution ?? this.resolution + 2);
    this.autoControlData = generation.control.slice();
    this.controlData = generation.control.slice();
    this.manualWeights = new Uint8Array(this.vertexCount * 4);
    this.manualMask = new Uint8Array(this.vertexCount);
    this.modified = false;
    this.lastNeededAt = performance.now();
    this.lodIndex = descriptor.lodIndex;
    this.minHeight = generation.minHeight;
    this.maxHeight = generation.maxHeight;
    this.neighborCoarseSteps = { left: 0, right: 0, down: 0, up: 0 };

    this.heightMap = new THREE.DataTexture(
      this.heightTextureData,
      this.heightTextureResolution,
      this.heightTextureResolution,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.heightMap.flipY = false;
    this.heightMap.minFilter = THREE.NearestFilter;
    this.heightMap.magFilter = THREE.NearestFilter;
    this.heightMap.generateMipmaps = false;
    this.heightMap.needsUpdate = true;

    this.controlMap = new THREE.DataTexture(
      this.controlData,
      this.resolution,
      this.resolution,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.controlMap.flipY = false;
    // Control maps are per chunk; mipmaps average each tile into a square material blotch in overview shots.
    this.controlMap.minFilter = THREE.LinearFilter;
    this.controlMap.magFilter = THREE.LinearFilter;
    this.controlMap.generateMipmaps = false;
    this.controlMap.needsUpdate = true;

    this.material = materialLibrary.createChunkMaterial({
      heightMap: this.heightMap,
      controlMap: this.controlMap,
      lodIndex: this.lodIndex,
      heightResolution: this.resolution,
      neighborCoarseSteps: this.neighborCoarseSteps,
    });
    this.materialLibrary = materialLibrary;
    this.mesh = new TerrainChunkMesh(this, geometry, this.material);
    this.mesh.name = `TerrainChunk(${this.key})`;
    this.mesh.position.set(this.chunkX * config.chunkSize, 0, this.chunkZ * config.chunkSize);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.updateBounds();
  }

  #buildPaddedHeightTextureData(sourceHeights) {
    const paddedResolution = this.resolution + 2;
    const padded = new Float32Array(paddedResolution * paddedResolution);
    for (let z = -1; z <= this.resolution; z += 1) {
      for (let x = -1; x <= this.resolution; x += 1) {
        const safeX = clamp(x, 0, this.resolution - 1);
        const safeZ = clamp(z, 0, this.resolution - 1);
        padded[(z + 1) * paddedResolution + (x + 1)] = sourceHeights[safeZ * this.resolution + safeX];
      }
    }
    return padded;
  }

  #syncCoreIntoPaddedHeightTexture() {
    const paddedResolution = this.heightTextureResolution;
    for (let z = 0; z < this.resolution; z += 1) {
      const sourceOffset = z * this.resolution;
      const targetOffset = (z + 1) * paddedResolution + 1;
      this.heightTextureData.set(this.heights.subarray(sourceOffset, sourceOffset + this.resolution), targetOffset);
    }
  }

  index(x, z) {
    return z * this.resolution + x;
  }

  worldToUv(worldX, worldZ, target = { x: 0, y: 0 }) {
    target.x = clamp((worldX - this.originX) / this.config.chunkSize, 0, 1);
    target.y = clamp((worldZ - this.originZ) / this.config.chunkSize, 0, 1);
    return target;
  }

  sampleWorldPosition(x, z) {
    return { x: this.originX + x * this.step, z: this.originZ + z * this.step };
  }

  getHeightAtGrid(x, z) {
    const safeX = clamp(x, 0, this.resolution - 1);
    const safeZ = clamp(z, 0, this.resolution - 1);
    return this.heights[this.index(safeX, safeZ)];
  }

  #getControlHeightAtGrid(x, z) {
    if (this.heightTextureData && this.heightTextureResolution >= this.resolution + 2) {
      const safeX = clamp(x + 1, 0, this.heightTextureResolution - 1);
      const safeZ = clamp(z + 1, 0, this.heightTextureResolution - 1);
      return this.heightTextureData[safeZ * this.heightTextureResolution + safeX];
    }
    return this.getHeightAtGrid(x, z);
  }

  sampleHeight(worldX, worldZ) {
    const gridX = clamp((worldX - this.originX) / this.step, 0, this.resolution - 1);
    const gridZ = clamp((worldZ - this.originZ) / this.step, 0, this.resolution - 1);
    const x0 = Math.floor(gridX);
    const z0 = Math.floor(gridZ);
    const x1 = Math.min(x0 + 1, this.resolution - 1);
    const z1 = Math.min(z0 + 1, this.resolution - 1);
    const tx = gridX - x0;
    const tz = gridZ - z0;
    const a = THREE.MathUtils.lerp(this.getHeightAtGrid(x0, z0), this.getHeightAtGrid(x1, z0), tx);
    const b = THREE.MathUtils.lerp(this.getHeightAtGrid(x0, z1), this.getHeightAtGrid(x1, z1), tx);
    return THREE.MathUtils.lerp(a, b, tz);
  }

  setLod(lodIndex, geometry) {
    if (lodIndex === this.lodIndex && this.mesh.geometry === geometry) return false;
    this.lodIndex = lodIndex;
    this.mesh.geometry = geometry;
    this.materialLibrary.updateChunkMaterial(this.material, {
      heightMap: this.heightMap,
      controlMap: this.controlMap,
      lodIndex,
      heightResolution: this.resolution,
      neighborCoarseSteps: this.neighborCoarseSteps,
    });
    return true;
  }

  refreshHeightHalo(sampleHeight) {
    if (typeof sampleHeight !== 'function') return;
    const paddedResolution = this.heightTextureResolution;
    const lastCore = this.resolution - 1;
    const write = (paddedX, paddedZ, worldX, worldZ) => {
      this.heightTextureData[paddedZ * paddedResolution + paddedX] = sampleHeight(worldX, worldZ);
    };

    for (let x = -1; x <= this.resolution; x += 1) {
      const worldX = this.originX + x * this.step;
      write(x + 1, 0, worldX, this.originZ - this.step);
      write(x + 1, paddedResolution - 1, worldX, this.originZ + (lastCore + 1) * this.step);
    }
    for (let z = 0; z < this.resolution; z += 1) {
      const worldZ = this.originZ + z * this.step;
      write(0, z + 1, this.originX - this.step, worldZ);
      write(paddedResolution - 1, z + 1, this.originX + (lastCore + 1) * this.step, worldZ);
    }
    this.heightMap.needsUpdate = true;
  }

  setNeighborCoarseSteps(edgeSteps = {}) {
    const next = {
      left: Number(edgeSteps.left ?? 0),
      right: Number(edgeSteps.right ?? 0),
      down: Number(edgeSteps.down ?? 0),
      up: Number(edgeSteps.up ?? 0),
    };
    const current = this.neighborCoarseSteps;
    if (current.left === next.left && current.right === next.right && current.down === next.down && current.up === next.up) return false;
    this.neighborCoarseSteps = next;
    this.materialLibrary.updateChunkMaterial(this.material, {
      heightMap: this.heightMap,
      controlMap: this.controlMap,
      lodIndex: this.lodIndex,
      heightResolution: this.resolution,
      neighborCoarseSteps: this.neighborCoarseSteps,
    });
    return true;
  }

  calculateAutoControlData(materialSelector, generatorSettings = {}) {
    const seed = Number.isFinite(Number(generatorSettings.seed)) ? Number(generatorSettings.seed) : 0;
    const rawControl = new Float32Array(this.vertexCount * 4);
    for (let z = 0; z < this.resolution; z += 1) {
      for (let x = 0; x < this.resolution; x += 1) {
        const index = this.index(x, z);
        const center = this.#getControlHeightAtGrid(x, z);
        const left = this.#getControlHeightAtGrid(x - 1, z);
        const right = this.#getControlHeightAtGrid(x + 1, z);
        const down = this.#getControlHeightAtGrid(x, z - 1);
        const up = this.#getControlHeightAtGrid(x, z + 1);
        const world = this.sampleWorldPosition(x, z);
        const surface = analyzeTerrainSurface({
          center,
          left,
          right,
          down,
          up,
          step: this.step,
          worldX: world.x,
          worldZ: world.z,
          seed,
          waterLevel: this.config.waterLevel,
        });
        writeAutoWeights(
          rawControl,
          index * 4,
          center,
          surface.slopeDegrees,
          surface.variation,
          materialSelector,
          1,
          surface,
        );
      }
    }
    const smoothed = smoothControlWeights(rawControl, this.resolution, 2);
    return packControlWeights(smoothed);
  }

  applyAutoControlData(data) {
    if (!(data instanceof Uint8Array) || data.length !== this.autoControlData.length) {
      throw new TypeError('Automatic terrain control data must be a matching Uint8Array.');
    }
    this.autoControlData.set(data);
    for (let index = 0; index < this.vertexCount; index += 1) this.updateControlAt(index);
    this.controlMap.needsUpdate = true;
  }

  recalculateControl(materialSelector, generatorSettings = {}) {
    const data = this.calculateAutoControlData(materialSelector, generatorSettings);
    this.applyAutoControlData(data);
  }



  updateControlAt(index) {
    const offset = index * 4;
    const manual = this.manualMask[index] / 255;
    let sum = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const automatic = this.autoControlData[offset + channel] / 255;
      const painted = this.manualWeights[offset + channel] / 255;
      const value = Math.round(THREE.MathUtils.lerp(automatic, painted, manual) * 255);
      this.controlData[offset + channel] = value;
      sum += value;
    }
    if (sum === 0) this.controlData[offset + 1] = 255;
  }

  paintMaterial(index, layer, amount) {
    const offset = index * 4;
    if (this.manualMask[index] === 0) this.manualWeights.set(this.controlData.subarray(offset, offset + 4), offset);
    const values = Array.from(this.manualWeights.subarray(offset, offset + 4), (value) => value / 255);
    for (let channel = 0; channel < 4; channel += 1) {
      values[channel] = THREE.MathUtils.lerp(values[channel], channel === layer ? 1 : 0, amount);
    }
    const sum = values.reduce((total, value) => total + value, 0) || 1;
    for (let channel = 0; channel < 4; channel += 1) this.manualWeights[offset + channel] = Math.round(values[channel] / sum * 255);
    this.manualMask[index] = Math.min(255, this.manualMask[index] + Math.round(amount * 150));
    this.updateControlAt(index);
  }

  eraseManualMaterial(index, amount) {
    this.manualMask[index] = Math.max(0, this.manualMask[index] - Math.round(amount * 180));
    this.updateControlAt(index);
  }

  commitHeightChanges(materialSelector, generatorSettings = {}) {
    this.minHeight = Infinity;
    this.maxHeight = -Infinity;
    for (const height of this.heights) {
      this.minHeight = Math.min(this.minHeight, height);
      this.maxHeight = Math.max(this.maxHeight, height);
    }
    this.#syncCoreIntoPaddedHeightTexture();
    this.heightMap.needsUpdate = true;
    this.recalculateControl(materialSelector, generatorSettings);
    this.modified = true;
    this.updateBounds();
  }

  commitMaterialChanges() {
    this.controlMap.needsUpdate = true;
    this.modified = true;
  }

  updateBounds() {
    const half = this.config.chunkSize / 2;
    this.worldBounds = new THREE.Box3(
      new THREE.Vector3(this.mesh.position.x - half, this.minHeight - 20, this.mesh.position.z - half),
      new THREE.Vector3(this.mesh.position.x + half, this.maxHeight + 20, this.mesh.position.z + half),
    );
  }

  setSelected(selected) {
    this.material.uniforms.uSelected.value = selected ? 1 : 0;
  }

  captureState() {
    return {
      key: this.key,
      chunkX: this.chunkX,
      resolution: this.resolution,
      chunkZ: this.chunkZ,
      heights: this.heights.slice(),
      controlData: this.controlData.slice(),
      autoControlData: this.autoControlData.slice(),
      manualWeights: this.manualWeights.slice(),
      manualMask: this.manualMask.slice(),
      minHeight: this.minHeight,
      maxHeight: this.maxHeight,
    };
  }

  restoreState(state, materialSelector, generatorSettings = {}) {
    this.heights.set(state.heights);
    this.#syncCoreIntoPaddedHeightTexture();
    this.controlData.set(state.controlData ?? this.controlData);
    if (state.autoControlData) this.autoControlData.set(state.autoControlData);
    this.manualWeights.set(state.manualWeights ?? this.manualWeights);
    this.manualMask.set(state.manualMask ?? this.manualMask);
    this.minHeight = state.minHeight ?? Math.min(...this.heights);
    this.maxHeight = state.maxHeight ?? Math.max(...this.heights);
    this.heightMap.needsUpdate = true;
    this.controlMap.needsUpdate = true;
    this.recalculateControl(materialSelector, generatorSettings);
    this.modified = true;
    this.updateBounds();
  }

  dispose() {
    this.materialLibrary.disposeMaterial(this.material);
    this.heightMap.dispose();
    this.controlMap.dispose();
  }
}
