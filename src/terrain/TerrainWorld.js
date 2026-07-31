import * as THREE from 'three';
import { TerrainChunk } from './TerrainChunk.js';
import { TerrainLodGeometryCache } from './TerrainLodGeometry.js';
import { createTerrainHeightSampler, valueNoise2D } from './noise.js';
import { createTerrainMaterialProgramEvaluator } from './TerrainMaterialGraph.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function validateMaterialProgram(program) {
  if (program === null) return;
  if (!program || typeof program !== 'object' || Array.isArray(program)) {
    throw new TypeError('Terrain material program must be an object.');
  }
  createTerrainMaterialProgramEvaluator(program);
}

function calculateMaterialControls(world, selector) {
  const calculations = [];
  for (const chunk of world.chunks.values()) {
    calculations.push({
      chunk,
      data: chunk.calculateAutoControlData(selector, world.generatorSettings),
      previousPresetId: chunk.presetId,
      previousData: chunk.autoControlData?.slice() ?? null,
    });
  }
  return calculations;
}

function commitMaterialChange(world, {
  presetId,
  materialDistribution,
  materialProgram,
  calculations,
  event,
}) {
  const previous = {
    presetId: world.presetId,
    materialDistribution: world.materialDistribution,
    materialProgram: world.materialProgram,
    materialRevision: world.materialRevision,
    cache: new Map(world.modifiedChunkCache),
  };
  const applied = [];
  try {
    world.materialRevision += 1;
    world.presetId = presetId;
    world.materialDistribution = materialDistribution;
    world.materialProgram = materialProgram;
    for (const calculation of calculations) {
      calculation.chunk.presetId = presetId;
      calculation.chunk.applyAutoControlData(calculation.data);
      applied.push(calculation);
    }
    for (const { chunk } of calculations) {
      if (chunk.modified) world.modifiedChunkCache.set(chunk.key, chunk.captureState());
    }
    world.eventBus.emit('terrain:preset', event);
  } catch (error) {
    world.presetId = previous.presetId;
    world.materialDistribution = previous.materialDistribution;
    world.materialProgram = previous.materialProgram;
    world.materialRevision = previous.materialRevision;
    world.modifiedChunkCache.clear();
    for (const [key, state] of previous.cache) world.modifiedChunkCache.set(key, state);
    for (const calculation of calculations) {
      calculation.chunk.presetId = calculation.previousPresetId;
    }
    for (const calculation of applied) {
      if (calculation.previousData) {
        calculation.chunk.applyAutoControlData(calculation.previousData);
      }
    }
    throw error;
  }
}

function materialDistributionFromPack(pack, presetId) {
  return {
    id: presetId,
    globalBlend: Number(pack.globalBlend ?? 1),
    transitionNoise: Number(pack.transitionNoise ?? 0.2),
    layers: pack.layers.map((layer) => ({
      distribution: { ...(layer.distribution ?? {}) },
    })),
  };
}

export class TerrainWorld {
  constructor({ config, materialLibrary, generationService, eventBus, generatorSettings, streamingSettings }) {
    this.config = config;
    this.materialLibrary = materialLibrary;
    this.generationService = generationService;
    this.eventBus = eventBus;
    this.generatorSettings = {
      ...generatorSettings,
      worldRadius: config.worldSizeKm * 500,
      waterLevel: config.waterLevel,
    };
    this.heightSampler = createTerrainHeightSampler(this.generatorSettings);
    this.streamingSettings = { ...streamingSettings };
    this.streamingMode = 'editor';
    this.editorWorldPrepared = false;
    this.displacementPreview = { enabled: false, centerChunk: { x: 0, z: 0 }, radius: 1 };
    this.group = new THREE.Group();
    this.group.name = 'LargeTerrainWorld';
    this.chunks = new Map();
    this.pending = new Map();
    this.queue = [];
    this.modifiedChunkCache = new Map();
    this.presetId = 'mediterranean';
    this.materialDistribution = null;
    this.materialProgram = null;
    this.materialRevision = 0;
    this.selectedChunk = null;
    this.activeRequests = 0;
    this.maxConcurrentRequests = Math.max(1, Number(generationService.concurrency ?? 1));
    this.centerChunk = { x: Number.NaN, z: Number.NaN };
    this.lastTarget = new THREE.Vector3();
    this.geometryCache = new TerrainLodGeometryCache(config.chunkSize, config.lodLevels);
    this.debugHelpers = new Map();
    this.epoch = 0;
    this.stats = {
      generated: 0,
      unloaded: 0,
      lodChanges: 0,
      queuePeak: 0,
      lastGenerationMs: 0,
    };
  }

  get worldHalfSize() {
    return this.config.worldSizeKm * 500;
  }

  async generate(settings = this.generatorSettings) {
    this.setGeneratorSettings(settings);
    this.clear({ clearModified: true });
    this.centerChunk = { x: Number.NaN, z: Number.NaN };
    this.updateStreaming(new THREE.Vector3(0, 0, 0), true);
    await this.waitForArea(0, 0, 0, 12000);
    this.eventBus.emit('terrain:generated', { settings: this.generatorSettings });
  }

  setGeneratorSettings(settings = this.generatorSettings) {
    this.generatorSettings = {
      ...settings,
      worldRadius: this.config.worldSizeKm * 500,
      waterLevel: this.config.waterLevel,
    };
    this.heightSampler = createTerrainHeightSampler(this.generatorSettings);
  }

  clear({ clearModified = false } = {}) {
    this.epoch += 1;
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh);
      this.#removeDebugHelper(chunk.key);
      chunk.dispose();
    }
    this.chunks.clear();
    this.queue.length = 0;
    this.pending.clear();
    this.editorWorldPrepared = false;
    if (clearModified) this.modifiedChunkCache.clear();
  }

  chunkKey(chunkX, chunkZ) {
    return `${chunkX},${chunkZ}`;
  }

  worldToChunk(worldX, worldZ) {
    return {
      x: Math.floor((worldX + this.config.chunkSize / 2) / this.config.chunkSize),
      z: Math.floor((worldZ + this.config.chunkSize / 2) / this.config.chunkSize),
    };
  }

  isChunkInsideWorld(chunkX, chunkZ) {
    const centerX = chunkX * this.config.chunkSize;
    const centerZ = chunkZ * this.config.chunkSize;
    const chunkRadius = Math.SQRT2 * this.config.chunkSize * 0.5;
    return Math.hypot(centerX, centerZ) - chunkRadius <= this.worldHalfSize;
  }

  getLodIndex(distance, currentLodIndex = null) {
    const levels = this.config.lodLevels;
    let desired = levels.length - 1;
    for (let index = 0; index < levels.length; index += 1) {
      if (distance <= levels[index].maxDistance) {
        desired = index;
        break;
      }
    }

    if (!Number.isInteger(currentLodIndex) || currentLodIndex < 0 || currentLodIndex >= levels.length) return desired;
    if (desired === currentLodIndex) return desired;

    const hysteresis = Math.max(0, Number(this.config.lodHysteresis ?? 0));
    if (desired > currentLodIndex) {
      const currentLimit = Number(levels[currentLodIndex].maxDistance);
      if (Number.isFinite(currentLimit) && distance < currentLimit + hysteresis) return currentLodIndex;
    } else {
      const desiredLimit = Number(levels[desired].maxDistance);
      if (Number.isFinite(desiredLimit) && distance > desiredLimit - hysteresis) return currentLodIndex;
    }
    return desired;
  }

  getEditorLodIndex(chunkX, chunkZ) {
    if (this.displacementPreview.enabled) {
      const dx = Math.abs(chunkX - this.displacementPreview.centerChunk.x);
      const dz = Math.abs(chunkZ - this.displacementPreview.centerChunk.z);
      if (Math.max(dx, dz) <= this.displacementPreview.radius) return 0;
    }
    return Number(this.config.editorLandLodIndex ?? 2);
  }

  getEditorDataResolution() {
    return Number(this.config.editorDataResolution ?? 129);
  }

  setDisplacementPreview({ enabled = true, target = this.lastTarget, radius = 1 } = {}) {
    const center = this.worldToChunk(Number(target?.x ?? 0), Number(target?.z ?? 0));
    this.displacementPreview = {
      enabled: Boolean(enabled),
      centerChunk: center,
      radius: clamp(Math.round(Number(radius ?? 1)), 0, 2),
    };
    if (this.streamingMode === 'editor') {
      this.editorWorldPrepared = false;
      this.updateStreaming(target, true);
    }
    this.eventBus.emit('terrain:displacement-preview', { ...this.displacementPreview });
  }

  setStreamingMode(mode, target = this.lastTarget) {
    const nextMode = mode === 'fps' ? 'fps' : 'editor';
    if (this.streamingMode === nextMode) {
      this.updateStreaming(target, true);
      return;
    }

    this.streamingMode = nextMode;
    this.centerChunk = { x: Number.NaN, z: Number.NaN };
    if (nextMode === 'editor') {
      this.editorWorldPrepared = false;
    } else {
      const radius = Number(this.streamingSettings.streamRadius ?? this.config.streamRadius);
      const maxDistance = (radius + 1.2) * this.config.chunkSize;
      this.queue = this.queue.filter((descriptor) => {
        const distance = Math.hypot(
          descriptor.chunkX * this.config.chunkSize - target.x,
          descriptor.chunkZ * this.config.chunkSize - target.z,
        );
        return distance <= maxDistance;
      });
      this.#trimChunksForFps(target);
    }
    this.updateStreaming(target, true);
    this.eventBus.emit('streaming:mode', { mode: this.streamingMode });
  }

  #updateEditorStreaming(target, force = false) {
    const center = this.worldToChunk(target.x, target.z);
    if (!force && this.editorWorldPrepared) {
      // Editor presentation is intentionally camera-independent. Moving or zooming the
      // editor camera must never rebuild terrain tiles or change their LOD beneath the user.
      this.#processQueue();
      return;
    }

    this.centerChunk = center;
    const half = this.worldHalfSize;
    const chunkSize = this.config.chunkSize;
    const minChunk = Math.floor(-half / chunkSize) - 1;
    const maxChunk = Math.ceil(half / chunkSize) + 1;
    const now = performance.now();

    for (let chunkZ = minChunk; chunkZ <= maxChunk; chunkZ += 1) {
      for (let chunkX = minChunk; chunkX <= maxChunk; chunkX += 1) {
        if (!this.isChunkInsideWorld(chunkX, chunkZ)) continue;
        const centerX = chunkX * chunkSize;
        const centerZ = chunkZ * chunkSize;
        const distance = Math.hypot(centerX, centerZ);
        const key = this.chunkKey(chunkX, chunkZ);
        const existing = this.chunks.get(key);
        const lodIndex = this.getEditorLodIndex(chunkX, chunkZ);
        const dataResolution = this.getEditorDataResolution();

        if (existing) {
          existing.lastNeededAt = now;
          if (existing.setLod(lodIndex, this.geometryCache.get(lodIndex))) this.stats.lodChanges += 1;
          // All unmodified editor chunks use one stable source resolution. This prevents
          // square material/control-map changes when the camera moves or zooms.
          if (!existing.modified && existing.resolution !== dataResolution
            && !this.pending.has(key) && !this.queue.some((item) => item.key === key)) {
            this.queue.push({ key, chunkX, chunkZ, lodIndex, dataResolution, distance, replace: true, mode: 'editor' });
          }
          this.#syncDebugHelper(existing);
          continue;
        }

        if (!this.pending.has(key) && !this.queue.some((item) => item.key === key)) {
          // Generate the final editor tile directly. Do not show a temporary 17x17 tile
          // and replace it later, because that looks like blocks being built by the camera.
          this.queue.push({
            key,
            chunkX,
            chunkZ,
            lodIndex,
            dataResolution,
            distance,
            replace: false,
            mode: 'editor',
          });
        }
      }
    }

    this.#sortQueue();
    this.stats.queuePeak = Math.max(this.stats.queuePeak, this.queue.length);
    this.editorWorldPrepared = true;
    this.#processQueue();
    this.#syncAllChunkMorphs();
    this.eventBus.emit('streaming:center', { center, queue: this.queue.length, mode: 'editor' });
  }

  #trimChunksForFps(target) {
    const radius = Number(this.streamingSettings.streamRadius ?? this.config.streamRadius);
    const maxDistance = (radius + 1.2) * this.config.chunkSize;
    for (const chunk of [...this.chunks.values()]) {
      const distance = Math.hypot(chunk.mesh.position.x - target.x, chunk.mesh.position.z - target.z);
      if (distance <= maxDistance) continue;
      if (chunk.modified) this.modifiedChunkCache.set(chunk.key, chunk.captureState());
      if (this.selectedChunk === chunk) this.setSelectedChunk(null);
      this.group.remove(chunk.mesh);
      this.#removeDebugHelper(chunk.key);
      this.chunks.delete(chunk.key);
      chunk.dispose();
      this.stats.unloaded += 1;
    }
    this.#syncAllChunkMorphs();
  }

  updateStreaming(target, force = false) {
    this.lastTarget.copy(target);
    if (!this.streamingSettings.enabled || this.streamingSettings.freezeStreaming) return;
    if (this.streamingMode === 'editor') {
      this.#updateEditorStreaming(target, force);
      return;
    }
    const center = this.worldToChunk(target.x, target.z);
    if (!force && center.x === this.centerChunk.x && center.z === this.centerChunk.z) {
      this.#updateLods(target);
      this.#syncAllChunkMorphs();
      this.#processQueue();
      this.#unloadExpired();
      return;
    }
    this.centerChunk = center;
    const radius = Number(this.streamingSettings.streamRadius ?? this.config.streamRadius);
    const neededKeys = new Set();
    const now = performance.now();

    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const chunkX = center.x + dx;
        const chunkZ = center.z + dz;
        if (!this.isChunkInsideWorld(chunkX, chunkZ)) continue;
        const centerX = chunkX * this.config.chunkSize;
        const centerZ = chunkZ * this.config.chunkSize;
        const distance = Math.hypot(centerX - target.x, centerZ - target.z);
        if (distance > (radius + 0.72) * this.config.chunkSize) continue;
        const key = this.chunkKey(chunkX, chunkZ);
        const existing = this.chunks.get(key);
        const lodIndex = this.getLodIndex(distance, existing?.lodIndex ?? null);
        const dataResolution = this.config.lodLevels[lodIndex]?.dataResolution ?? this.config.sourceResolution;
        neededKeys.add(key);
        if (existing) {
          existing.lastNeededAt = now;
          existing.setLod(lodIndex, this.geometryCache.get(lodIndex));
          this.#queueDetailUpgrade(existing, lodIndex, dataResolution, distance);
          this.#syncDebugHelper(existing);
          continue;
        }
        if (!this.pending.has(key) && !this.queue.some((item) => item.key === key)) {
          this.queue.push({ key, chunkX, chunkZ, lodIndex, dataResolution, distance, replace: false });
        }
      }
    }

    this.#sortQueue();
    this.stats.queuePeak = Math.max(this.stats.queuePeak, this.queue.length);
    for (const chunk of this.chunks.values()) {
      if (neededKeys.has(chunk.key)) chunk.lastNeededAt = now;
    }
    this.#processQueue();
    this.#syncAllChunkMorphs();
    this.#unloadExpired();
    this.eventBus.emit('streaming:center', { center, queue: this.queue.length });
  }

  #refreshHeightHalosAround(chunk) {
    if (!chunk) return;
    const chunks = [
      chunk,
      this.chunks.get(this.chunkKey(chunk.chunkX - 1, chunk.chunkZ)),
      this.chunks.get(this.chunkKey(chunk.chunkX + 1, chunk.chunkZ)),
      this.chunks.get(this.chunkKey(chunk.chunkX, chunk.chunkZ - 1)),
      this.chunks.get(this.chunkKey(chunk.chunkX, chunk.chunkZ + 1)),
    ];
    for (const item of chunks) item?.refreshHeightHalo((worldX, worldZ) => this.sampleHeight(worldX, worldZ));
  }

  #syncChunkNeighborMorph(chunk) {
    if (!chunk) return;
    if (this.streamingMode === 'editor') {
      // The editor uses a stable static LOD layout and skirts. Camera-dependent edge
      // morphing is disabled because it can appear as square bands moving over terrain.
      chunk.setNeighborCoarseSteps({ left: 0, right: 0, down: 0, up: 0 });
      return;
    }
    const neighbors = {
      left: this.chunks.get(this.chunkKey(chunk.chunkX - 1, chunk.chunkZ)),
      right: this.chunks.get(this.chunkKey(chunk.chunkX + 1, chunk.chunkZ)),
      down: this.chunks.get(this.chunkKey(chunk.chunkX, chunk.chunkZ - 1)),
      up: this.chunks.get(this.chunkKey(chunk.chunkX, chunk.chunkZ + 1)),
    };
    const edgeSteps = {};
    for (const [edge, neighbor] of Object.entries(neighbors)) {
      if (!neighbor || neighbor.lodIndex <= chunk.lodIndex) edgeSteps[edge] = 0;
      else edgeSteps[edge] = 1 / Math.max(1, this.config.lodLevels[neighbor.lodIndex]?.segments ?? 1);
    }
    chunk.setNeighborCoarseSteps(edgeSteps);
  }

  #syncMorphAround(chunk) {
    if (!chunk) return;
    this.#syncChunkNeighborMorph(chunk);
    this.#syncChunkNeighborMorph(this.chunks.get(this.chunkKey(chunk.chunkX - 1, chunk.chunkZ)));
    this.#syncChunkNeighborMorph(this.chunks.get(this.chunkKey(chunk.chunkX + 1, chunk.chunkZ)));
    this.#syncChunkNeighborMorph(this.chunks.get(this.chunkKey(chunk.chunkX, chunk.chunkZ - 1)));
    this.#syncChunkNeighborMorph(this.chunks.get(this.chunkKey(chunk.chunkX, chunk.chunkZ + 1)));
  }

  #syncAllChunkMorphs() {
    for (const chunk of this.chunks.values()) this.#syncChunkNeighborMorph(chunk);
  }

  #updateLods(target) {
    const now = performance.now();
    const keepDistance = (Number(this.streamingSettings.streamRadius) + 0.72) * this.config.chunkSize;
    for (const chunk of this.chunks.values()) {
      const distance = Math.hypot(chunk.mesh.position.x - target.x, chunk.mesh.position.z - target.z);
      if (this.streamingMode === 'editor' || distance <= keepDistance) chunk.lastNeededAt = now;
      const lodIndex = this.getLodIndex(distance, chunk.lodIndex);
      if (chunk.setLod(lodIndex, this.geometryCache.get(lodIndex))) {
        this.stats.lodChanges += 1;
        this.#syncMorphAround(chunk);
      }
      const dataResolution = this.config.lodLevels[lodIndex]?.dataResolution ?? this.config.sourceResolution;
      this.#queueDetailUpgrade(chunk, lodIndex, dataResolution, distance);
    }
  }

  #queueDetailUpgrade(chunk, lodIndex, dataResolution, distance) {
    if (chunk.modified || chunk.resolution >= dataResolution) return;
    if (this.pending.has(chunk.key) || this.queue.some((item) => item.key === chunk.key)) return;
    this.queue.push({
      key: chunk.key,
      chunkX: chunk.chunkX,
      chunkZ: chunk.chunkZ,
      lodIndex,
      dataResolution,
      distance,
      replace: true,
    });
    this.#sortQueue();
  }

  #sortQueue() {
    if (this.streamingMode === 'editor') {
      this.queue.sort((a, b) => Number(b.replace) - Number(a.replace) || a.distance - b.distance);
    } else {
      this.queue.sort((a, b) => Number(b.replace) - Number(a.replace) || a.distance - b.distance);
    }
  }

  #processQueue() {
    const budget = Math.max(1, Number(this.config.generationBudgetPerFrame ?? 2));
    let started = 0;
    while (this.queue.length && this.activeRequests < this.maxConcurrentRequests && started < budget) {
      const descriptor = this.queue.shift();
      if (this.pending.has(descriptor.key)) continue;
      if (!descriptor.replace && this.chunks.has(descriptor.key)) continue;
      if (descriptor.replace && !this.chunks.has(descriptor.key)) descriptor.replace = false;
      this.#requestChunk(descriptor);
      started += 1;
    }
  }

  async #requestChunk(descriptor) {
    this.activeRequests += 1;
    const requestEpoch = this.epoch;
    const requestMaterialRevision = this.materialRevision;
    const start = performance.now();
    const promise = this.modifiedChunkCache.has(descriptor.key)
      ? Promise.resolve(this.#generationFromState(descriptor, this.modifiedChunkCache.get(descriptor.key)))
      : this.generationService.generateChunk(
        descriptor,
        this.config,
        this.generatorSettings,
        this.getMaterialWeightSelector(),
      );
    this.pending.set(descriptor.key, promise);
    try {
      const generation = await promise;
      if (requestEpoch !== this.epoch) return;
      if (requestMaterialRevision !== this.materialRevision) return;
      if (!this.isChunkInsideWorld(descriptor.chunkX, descriptor.chunkZ)) return;
      const currentDistance = Math.hypot(
        descriptor.chunkX * this.config.chunkSize - this.lastTarget.x,
        descriptor.chunkZ * this.config.chunkSize - this.lastTarget.z,
      );
      const maxDistance = (Number(this.streamingSettings.streamRadius) + 1.2) * this.config.chunkSize;
      if (this.streamingMode === 'fps' && currentDistance > maxDistance) return;
      const lodIndex = this.streamingMode === 'editor'
        ? Number(descriptor.lodIndex ?? this.getEditorLodIndex(descriptor.chunkX, descriptor.chunkZ))
        : this.getLodIndex(currentDistance);
      const chunk = new TerrainChunk({
        descriptor: { ...descriptor, lodIndex },
        config: this.config,
        geometry: this.geometryCache.get(lodIndex),
        materialLibrary: this.materialLibrary,
        generation,
      });
      chunk.presetId = this.presetId;
      const cached = this.modifiedChunkCache.get(descriptor.key);
      if (cached) {
        chunk.restoreState(
          cached,
          this.getMaterialWeightSelector(),
          this.generatorSettings,
        );
      }

      const previous = this.chunks.get(chunk.key);
      if (previous?.modified) {
        chunk.dispose();
        return;
      }
      const wasSelected = previous && this.selectedChunk === previous;
      if (previous) {
        this.group.remove(previous.mesh);
        this.#removeDebugHelper(previous.key);
        previous.dispose();
      }
      this.chunks.set(chunk.key, chunk);
      this.group.add(chunk.mesh);
      if (wasSelected) this.setSelectedChunk(chunk);
      this.#syncMorphAround(chunk);
      this.#refreshHeightHalosAround(chunk);
      this.#syncDebugHelper(chunk);
      this.stats.generated += 1;
      this.stats.lastGenerationMs = performance.now() - start;
      this.eventBus.emit('streaming:chunk-loaded', { chunk });
    } catch (error) {
      console.error(`Failed to load chunk ${descriptor.key}`, error);
      this.eventBus.emit('streaming:error', { descriptor, error });
    } finally {
      this.pending.delete(descriptor.key);
      this.activeRequests -= 1;
      this.#processQueue();
    }
  }

  #generationFromState(descriptor, state) {
    return {
      descriptor,
      resolution: state.resolution ?? Math.round(Math.sqrt(state.heights.length)),
      heights: state.heights.slice(),
      control: (state.autoControlData ?? state.controlData).slice(),
      minHeight: state.minHeight,
      maxHeight: state.maxHeight,
    };
  }

  #unloadExpired() {
    if (this.streamingMode === 'editor') return;
    const now = performance.now();
    const delay = Number(this.config.unloadDelayMs ?? 1800);
    const hardLimit = Number(this.config.maxLoadedChunks ?? 121);
    const candidates = [...this.chunks.values()]
      .filter((chunk) => now - chunk.lastNeededAt > delay)
      .sort((a, b) => a.lastNeededAt - b.lastNeededAt);
    while (candidates.length && (this.chunks.size > hardLimit || now - candidates[0].lastNeededAt > delay)) {
      const chunk = candidates.shift();
      if (chunk.modified) this.modifiedChunkCache.set(chunk.key, chunk.captureState());
      if (this.selectedChunk === chunk) this.setSelectedChunk(null);
      this.group.remove(chunk.mesh);
      this.#removeDebugHelper(chunk.key);
      this.chunks.delete(chunk.key);
      this.#syncChunkNeighborMorph(this.chunks.get(this.chunkKey(chunk.chunkX - 1, chunk.chunkZ)));
      this.#syncChunkNeighborMorph(this.chunks.get(this.chunkKey(chunk.chunkX + 1, chunk.chunkZ)));
      this.#syncChunkNeighborMorph(this.chunks.get(this.chunkKey(chunk.chunkX, chunk.chunkZ - 1)));
      this.#syncChunkNeighborMorph(this.chunks.get(this.chunkKey(chunk.chunkX, chunk.chunkZ + 1)));
      chunk.dispose();
      this.stats.unloaded += 1;
      this.eventBus.emit('streaming:chunk-unloaded', { key: chunk.key });
    }
  }

  isEditorSettled() {
    return this.streamingMode === 'editor'
      && this.editorWorldPrepared
      && this.queue.length === 0
      && this.pending.size === 0
      && this.activeRequests === 0;
  }

  async waitForEditorReady(timeoutMs = 60000) {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (this.isEditorSettled()) return true;
      this.updateStreaming(this.lastTarget, false);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return this.isEditorSettled();
  }

  async waitForArea(worldX, worldZ, radius = 1, timeoutMs = 10000) {
    const center = this.worldToChunk(worldX, worldZ);
    const keys = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) keys.push(this.chunkKey(center.x + dx, center.z + dz));
    }
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (keys.every((key) => this.chunks.has(key))) return true;
      this.updateStreaming(new THREE.Vector3(worldX, 0, worldZ), this.streamingMode === 'fps');
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return false;
  }

  getMeshes() {
    return [...this.chunks.values()].map((chunk) => chunk.mesh);
  }

  getChunkAt(worldX, worldZ) {
    const coordinates = this.worldToChunk(worldX, worldZ);
    return this.chunks.get(this.chunkKey(coordinates.x, coordinates.z)) ?? null;
  }

  sampleHeight(worldX, worldZ) {
    const chunk = this.getChunkAt(worldX, worldZ);
    if (chunk) return chunk.sampleHeight(worldX, worldZ);
    return this.heightSampler(worldX, worldZ);
  }

  getNormalAt(worldX, worldZ, target = new THREE.Vector3()) {
    const step = Math.max(0.5, this.config.chunkSize / (this.config.sourceResolution - 1));
    const left = this.sampleHeight(worldX - step, worldZ);
    const right = this.sampleHeight(worldX + step, worldZ);
    const down = this.sampleHeight(worldX, worldZ - step);
    const up = this.sampleHeight(worldX, worldZ + step);
    return target.set(left - right, step * 2, down - up).normalize();
  }

  getBounds(margin = 0) {
    return {
      minX: -this.worldHalfSize + margin,
      maxX: this.worldHalfSize - margin,
      minZ: -this.worldHalfSize + margin,
      maxZ: this.worldHalfSize - margin,
    };
  }

  clampToBounds(point, margin = 0.6) {
    const bounds = this.getBounds(margin);
    point.x = clamp(point.x, bounds.minX, bounds.maxX);
    point.z = clamp(point.z, bounds.minZ, bounds.maxZ);
    return point;
  }

  findHighestPointLoaded(margin = 4) {
    const bounds = this.getBounds(margin);
    let highest = { x: 0, y: -Infinity, z: 0 };
    for (const chunk of this.chunks.values()) {
      for (let z = 0; z < chunk.resolution; z += 4) {
        for (let x = 0; x < chunk.resolution; x += 4) {
          const world = chunk.sampleWorldPosition(x, z);
          if (world.x < bounds.minX || world.x > bounds.maxX || world.z < bounds.minZ || world.z > bounds.maxZ) continue;
          const height = chunk.heights[chunk.index(x, z)];
          if (height > highest.y) highest = { x: world.x, y: height, z: world.z };
        }
      }
    }
    if (!Number.isFinite(highest.y)) highest.y = this.sampleHeight(0, 0);
    return highest;
  }

  findHighestPointGlobal(sampleSpacing = 128) {
    const half = this.worldHalfSize - 8;
    let highest = { x: 0, y: -Infinity, z: 0 };
    for (let z = -half; z <= half; z += sampleSpacing) {
      for (let x = -half; x <= half; x += sampleSpacing) {
        const height = this.heightSampler(x, z);
        if (height > highest.y) highest = { x, y: height, z };
      }
    }
    const refineSpacing = sampleSpacing / 8;
    const center = { ...highest };
    for (let z = center.z - sampleSpacing; z <= center.z + sampleSpacing; z += refineSpacing) {
      for (let x = center.x - sampleSpacing; x <= center.x + sampleSpacing; x += refineSpacing) {
        const height = this.heightSampler(x, z);
        if (height > highest.y) highest = { x, y: height, z };
      }
    }
    return highest;
  }

  setSelectedChunk(chunk) {
    if (this.selectedChunk === chunk) return;
    this.selectedChunk?.setSelected(false);
    this.selectedChunk = chunk;
    this.selectedChunk?.setSelected(true);
    this.eventBus.emit('terrain:selection', { chunk });
  }

  getMaterialWeightSelector() {
    return this.materialProgram ?? this.materialDistribution ?? this.presetId;
  }

  applyPreset(presetId, materialProgram = null) {
    validateMaterialProgram(materialProgram);
    const selector = materialProgram ?? presetId;
    const calculations = calculateMaterialControls(this, selector);
    commitMaterialChange(this, {
      presetId,
      materialDistribution: null,
      materialProgram,
      calculations,
      event: { presetId },
    });
  }

  applyMaterialPackDistribution(pack, materialProgram = null) {
    validateMaterialProgram(materialProgram);
    const hasCustomDistribution = Array.isArray(pack?.layers) && pack.layers.some((layer) => layer?.distribution);
    const presetId = hasCustomDistribution
      ? String(pack.id ?? 'custom')
      : String(pack?.splatPreset ?? 'mediterranean');
    const materialDistribution = hasCustomDistribution
      ? materialDistributionFromPack(pack, presetId)
      : null;
    const selector = materialProgram ?? materialDistribution ?? presetId;
    const calculations = calculateMaterialControls(this, selector);
    commitMaterialChange(this, {
      presetId,
      materialDistribution,
      materialProgram,
      calculations,
      event: { presetId, custom: hasCustomDistribution },
    });
  }

  applyMaterialProgram(program, pack = null) {
    validateMaterialProgram(program);
    if (pack) {
      this.applyMaterialPackDistribution(pack, program);
      return;
    }
    const presetId = String(program.packId ?? program.splatPreset ?? this.presetId);
    const calculations = calculateMaterialControls(this, program);
    commitMaterialChange(this, {
      presetId,
      materialDistribution: null,
      materialProgram: program,
      calculations,
      event: {
        presetId,
        materialProgram: true,
      },
    });
  }

  applyBrush(point, brush, context = {}) {
    const radius = Math.max(0.5, brush.radius);
    const entries = [];
    const affectedChunks = new Set();
    for (const chunk of this.chunks.values()) {
      if (point.x + radius < chunk.originX || point.x - radius > chunk.originX + this.config.chunkSize
        || point.z + radius < chunk.originZ || point.z - radius > chunk.originZ + this.config.chunkSize) continue;
      for (let z = 0; z < chunk.resolution; z += 1) {
        const worldZ = chunk.originZ + z * chunk.step;
        if (Math.abs(worldZ - point.z) > radius) continue;
        for (let x = 0; x < chunk.resolution; x += 1) {
          const worldX = chunk.originX + x * chunk.step;
          const distance = Math.hypot(worldX - point.x, worldZ - point.z);
          if (distance > radius) continue;
          const normalized = distance / radius;
          let falloff = 1;
          if (normalized > brush.hardness) {
            const edge = (normalized - brush.hardness) / Math.max(1 - brush.hardness, 0.0001);
            falloff = 1 - smoothstep(clamp(edge, 0, 1));
          }
          entries.push({ chunk, index: chunk.index(x, z), worldX, worldZ, x, z, falloff });
          affectedChunks.add(chunk);
        }
      }
    }
    if (!entries.length) return false;

    const smoothTargets = brush.tool === 'smooth'
      ? entries.map(({ worldX, worldZ, chunk }) => {
        const step = chunk.step;
        let sum = 0;
        let count = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            sum += this.sampleHeight(worldX + dx * step, worldZ + dz * step);
            count += 1;
          }
        }
        return sum / count;
      })
      : null;
    const heightTool = ['raise', 'lower', 'smooth', 'flatten', 'noise'].includes(brush.tool);

    entries.forEach((entry, index) => {
      const amount = clamp(brush.strength, 0.01, 2) * entry.falloff;
      const chunk = entry.chunk;
      switch (brush.tool) {
        case 'raise':
          chunk.heights[entry.index] = clamp(chunk.heights[entry.index] + amount * 0.72, this.config.minHeight, this.config.maxHeight);
          break;
        case 'lower':
          chunk.heights[entry.index] = clamp(chunk.heights[entry.index] - amount * 0.72, this.config.minHeight, this.config.maxHeight);
          break;
        case 'flatten':
          chunk.heights[entry.index] = THREE.MathUtils.lerp(chunk.heights[entry.index], context.flattenHeight ?? point.y, clamp(amount * 0.2, 0, 1));
          break;
        case 'smooth':
          chunk.heights[entry.index] = THREE.MathUtils.lerp(chunk.heights[entry.index], smoothTargets[index], clamp(amount * 0.18, 0, 1));
          break;
        case 'noise': {
          const noise = valueNoise2D(entry.worldX * 0.08, entry.worldZ * 0.08, context.strokeSeed ?? 1);
          chunk.heights[entry.index] = clamp(chunk.heights[entry.index] + noise * amount, this.config.minHeight, this.config.maxHeight);
          break;
        }
        case 'paint':
          chunk.paintMaterial(entry.index, brush.materialLayer, clamp(amount * 0.17, 0, 1));
          break;
        case 'erase-paint':
          chunk.eraseManualMaterial(entry.index, clamp(amount * 0.2, 0, 1));
          break;
        default:
          break;
      }
    });

    for (const chunk of affectedChunks) {
      chunk.presetId = this.presetId;
      context.changedChunkKeys?.add(chunk.key);
      if (heightTool) {
        context.heightChanged = true;
        chunk.heightMap.needsUpdate = true;
        chunk.modified = true;
        if (!context.deferCommit) {
          this.#refreshHeightHalosAround(chunk);
          chunk.commitHeightChanges(this.getMaterialWeightSelector(), this.generatorSettings);
        }
      } else {
        chunk.commitMaterialChanges();
      }
      if (!context.deferCommit) this.modifiedChunkCache.set(chunk.key, chunk.captureState());
    }
    this.eventBus.emit('terrain:edited', { point, tool: brush.tool, chunks: [...affectedChunks].map((chunk) => chunk.key) });
    return true;
  }

  finalizeBrush(context = {}) {
    const changedChunks = [...(context.changedChunkKeys ?? [])]
      .map((key) => this.chunks.get(key))
      .filter(Boolean);
    if (context.heightChanged) {
      for (const chunk of changedChunks) this.#refreshHeightHalosAround(chunk);
    }
    for (const chunk of changedChunks) {
      if (context.heightChanged) {
        chunk.commitHeightChanges(this.getMaterialWeightSelector(), this.generatorSettings);
      }
      else chunk.commitMaterialChanges();
      this.modifiedChunkCache.set(chunk.key, chunk.captureState());
      this.#syncDebugHelper(chunk);
    }
  }

  captureEditableState(point = null, radius = Infinity) {
    const chunks = [];
    for (const chunk of this.chunks.values()) {
      if (point) {
        const dx = Math.max(Math.abs(point.x - chunk.mesh.position.x) - this.config.chunkSize / 2, 0);
        const dz = Math.max(Math.abs(point.z - chunk.mesh.position.z) - this.config.chunkSize / 2, 0);
        if (Math.hypot(dx, dz) > radius) continue;
      }
      chunks.push(chunk.captureState());
    }
    return { presetId: this.presetId, chunks };
  }

  captureEditableStateForKeys(keys) {
    const chunks = [];
    for (const key of keys) {
      const chunk = this.chunks.get(key);
      if (chunk) chunks.push(chunk.captureState());
      else if (this.modifiedChunkCache.has(key)) chunks.push(this.modifiedChunkCache.get(key));
    }
    return { presetId: this.presetId, chunks };
  }

  restoreEditableState(state) {
    this.presetId = state.presetId ?? this.presetId;
    for (const item of state.chunks ?? []) {
      this.modifiedChunkCache.set(item.key, {
        ...item,
        heights: new Float32Array(item.heights),
        controlData: new Uint8Array(item.controlData),
        autoControlData: new Uint8Array(item.autoControlData ?? item.controlData),
        manualWeights: new Uint8Array(item.manualWeights),
        manualMask: new Uint8Array(item.manualMask),
      });
      const chunk = this.chunks.get(item.key);
      if (chunk) {
        chunk.restoreState(item, this.getMaterialWeightSelector(), this.generatorSettings);
        this.#refreshHeightHalosAround(chunk);
      }
    }
    this.eventBus.emit('terrain:restored');
  }

  getModifiedStates() {
    for (const chunk of this.chunks.values()) {
      if (chunk.modified) this.modifiedChunkCache.set(chunk.key, chunk.captureState());
    }
    return [...this.modifiedChunkCache.values()];
  }

  importModifiedStates(states = []) {
    this.modifiedChunkCache.clear();
    for (const state of states) {
      this.modifiedChunkCache.set(state.key, {
        ...state,
        heights: new Float32Array(state.heights),
        controlData: new Uint8Array(state.controlData),
        autoControlData: new Uint8Array(state.autoControlData ?? state.controlData),
        manualWeights: new Uint8Array(state.manualWeights),
        manualMask: new Uint8Array(state.manualMask),
      });
    }
    this.clear();
    this.centerChunk = { x: Number.NaN, z: Number.NaN };
    this.updateStreaming(this.lastTarget, true);
  }

  setWireframe(enabled) {
    this.materialLibrary.setWireframe(enabled);
  }

  setStreamingSettings(settings) {
    this.streamingSettings = { ...this.streamingSettings, ...settings };
    this.updateStreaming(this.lastTarget, true);
    for (const chunk of this.chunks.values()) this.#syncDebugHelper(chunk);
  }

  #syncDebugHelper(chunk) {
    if (!this.streamingSettings.showChunkBounds) {
      this.#removeDebugHelper(chunk.key);
      return;
    }
    let helper = this.debugHelpers.get(chunk.key);
    if (!helper) {
      helper = new THREE.Box3Helper(chunk.worldBounds, new THREE.Color('#64d8ff'));
      helper.renderOrder = 900;
      this.debugHelpers.set(chunk.key, helper);
      this.group.add(helper);
    }
    helper.box.copy(chunk.worldBounds);
  }

  #removeDebugHelper(key) {
    const helper = this.debugHelpers.get(key);
    if (!helper) return;
    this.group.remove(helper);
    helper.geometry.dispose();
    helper.material.dispose();
    this.debugHelpers.delete(key);
  }

  getDiagnostics() {
    const lodCounts = new Array(this.config.lodLevels.length).fill(0);
    for (const chunk of this.chunks.values()) lodCounts[chunk.lodIndex] += 1;
    let heightBytes = 0;
    let controlBytes = 0;
    for (const chunk of this.chunks.values()) {
      heightBytes += chunk.heights.byteLength;
      controlBytes += chunk.controlData.byteLength;
    }
    return {
      mode: this.streamingMode,
      loadedChunks: this.chunks.size,
      pendingChunks: this.pending.size,
      queuedChunks: this.queue.length,
      modifiedChunks: this.modifiedChunkCache.size,
      lodCounts,
      terrainDataMb: (heightBytes + controlBytes) / 1024 / 1024,
      workerPool: this.generationService.getDiagnostics?.() ?? null,
      ...this.stats,
    };
  }

  dispose() {
    this.clear();
    this.geometryCache.dispose();
    this.group.clear();
  }
}
