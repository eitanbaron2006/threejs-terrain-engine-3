import { createTerrainHeightSampler, packControlWeights, smoothControlWeights, writeAutoWeights } from './noise.js';
import { analyzeTerrainSurface } from './TerrainSurfaceAnalysis.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function generateTerrainChunkData(descriptor, config, settings, materialSelector) {
  const resolution = Number(descriptor.dataResolution ?? config.sourceResolution);
  const step = config.chunkSize / (resolution - 1);
  const originX = descriptor.chunkX * config.chunkSize - config.chunkSize / 2;
  const originZ = descriptor.chunkZ * config.chunkSize - config.chunkSize / 2;
  const terrainSettings = {
    ...settings,
    worldRadius: config.worldSizeKm * 500,
    waterLevel: config.waterLevel,
  };
  const sampleTerrainHeight = createTerrainHeightSampler(terrainSettings);
  const heights = new Float32Array(resolution * resolution);
  const paddedResolution = resolution + 2;
  const heightTextureData = new Float32Array(paddedResolution * paddedResolution);
  const rawControl = new Float32Array(resolution * resolution * 4);
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let paddedZ = 0; paddedZ < paddedResolution; paddedZ += 1) {
    const sourceZ = paddedZ - 1;
    const worldZ = originZ + sourceZ * step;
    for (let paddedX = 0; paddedX < paddedResolution; paddedX += 1) {
      const sourceX = paddedX - 1;
      const height = sampleTerrainHeight(originX + sourceX * step, worldZ);
      heightTextureData[paddedZ * paddedResolution + paddedX] = height;
      if (sourceX >= 0 && sourceX < resolution && sourceZ >= 0 && sourceZ < resolution) {
        const index = sourceZ * resolution + sourceX;
        heights[index] = height;
        if (height < minHeight) minHeight = height;
        if (height > maxHeight) maxHeight = height;
      }
    }
  }

  const get = (x, z) => heightTextureData[(z + 1) * paddedResolution + (x + 1)];
  for (let z = 0; z < resolution; z += 1) {
    const worldZ = originZ + z * step;
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const worldX = originX + x * step;
      const center = heights[index];
      const surface = analyzeTerrainSurface({
        center,
        left: get(x - 1, z),
        right: get(x + 1, z),
        down: get(x, z - 1),
        up: get(x, z + 1),
        step,
        worldX,
        worldZ,
        seed: settings.seed,
        waterLevel: config.waterLevel,
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
  const control = packControlWeights(smoothControlWeights(rawControl, resolution, 2));
  return {
    descriptor,
    resolution,
    heights,
    heightTextureData,
    heightTextureResolution: paddedResolution,
    control,
    minHeight,
    maxHeight,
  };
}

export class TerrainGenerationService {
  #workers = [];
  #workerFactory;
  #requestId = 0;
  #pending = new Map();
  #queue = [];
  #disposed = false;

  constructor(workerCount = null, { workerFactory = null } = {}) {
    const hardwareThreads = Number(globalThis.navigator?.hardwareConcurrency ?? 8);
    this.concurrency = clamp(Number(workerCount ?? hardwareThreads - 2), 2, 8);
    this.#workerFactory = workerFactory ?? (() => (
      new Worker(new URL('../workers/terrainWorker.js', import.meta.url), { type: 'module' })
    ));

    try {
      for (let index = 0; index < this.concurrency; index += 1) this.#createWorker(index);
    } catch (error) {
      console.warn('Terrain Worker Pool unavailable; synchronous generation is enabled.', error);
      this.#terminateWorkers();
      this.concurrency = 1;
    }
  }

  #createWorker(index) {
    const worker = this.#workerFactory(index);
    const slot = {
      index,
      worker,
      busy: false,
      requestId: null,
      job: null,
    };
    try {
      worker.addEventListener('message', (event) => this.#onMessage(slot, event));
      worker.addEventListener('error', (event) => this.#onWorkerError(slot, event));
      this.#workers.push(slot);
      return slot;
    } catch (error) {
      worker.terminate?.();
      throw error;
    }
  }

  generateChunk(descriptor, config, settings, materialSelector) {
    if (this.#disposed) return Promise.reject(new Error('Terrain generation service disposed.'));
    if (!this.#workers.length) {
      return Promise.resolve(generateTerrainChunkData(
        descriptor,
        config,
        settings,
        materialSelector,
      ));
    }

    const id = ++this.#requestId;
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#queue.push({ id, descriptor, config, settings, materialSelector });
      this.#dispatch();
    });
    return promise;
  }

  #dispatch() {
    if (this.#disposed) return;
    for (const slot of this.#workers) {
      if (slot.busy || !this.#queue.length) continue;
      const job = this.#queue.shift();
      slot.busy = true;
      slot.requestId = job.id;
      slot.job = job;
      slot.worker.postMessage({ id: job.id, type: 'generate-chunk', ...job });
    }
  }

  #onMessage(slot, event) {
    if (!this.#workers.includes(slot)) return;
    const { id, type } = event.data;
    const pending = this.#pending.get(id);
    slot.busy = false;
    slot.requestId = null;
    slot.job = null;
    if (!pending) {
      this.#dispatch();
      return;
    }
    this.#pending.delete(id);
    if (type === 'error') pending.reject(new Error(event.data.message));
    else {
      pending.resolve({
        descriptor: event.data.descriptor,
        resolution: event.data.resolution,
        heights: new Float32Array(event.data.heights),
        heightTextureData: new Float32Array(event.data.heightTextureData),
        heightTextureResolution: event.data.heightTextureResolution,
        control: new Uint8Array(event.data.control),
        minHeight: event.data.minHeight,
        maxHeight: event.data.maxHeight,
      });
    }
    this.#dispatch();
  }

  #onWorkerError(slot, event) {
    if (!this.#workers.includes(slot)) return;
    console.error(`Terrain worker ${slot.index} failed.`, event);
    const failedJob = slot.job;
    const slotIndex = this.#workers.indexOf(slot);
    this.#workers.splice(slotIndex, 1);
    slot.worker.terminate();

    try {
      this.#createWorker(slot.index);
      if (failedJob && this.#pending.has(failedJob.id)) this.#queue.unshift(failedJob);
      this.#dispatch();
    } catch (replacementError) {
      console.warn(
        'Terrain worker replacement unavailable; draining generation synchronously.',
        replacementError,
      );
      this.#drainSynchronously(failedJob);
    }
  }

  #drainSynchronously(failedJob) {
    const jobs = new Map();
    if (failedJob) jobs.set(failedJob.id, failedJob);
    for (const slot of this.#workers) {
      if (slot.job) jobs.set(slot.job.id, slot.job);
    }
    for (const job of this.#queue) jobs.set(job.id, job);

    this.#queue.length = 0;
    this.#terminateWorkers();
    this.concurrency = 1;

    for (const [id, job] of jobs) {
      const pending = this.#pending.get(id);
      if (!pending) continue;
      try {
        pending.resolve(generateTerrainChunkData(
          job.descriptor,
          job.config,
          job.settings,
          job.materialSelector,
        ));
      } catch (error) {
        pending.reject(error);
      }
      this.#pending.delete(id);
    }

    for (const [id, pending] of this.#pending) {
      pending.reject(new Error(`Terrain generation request ${id} was lost during worker recovery.`));
    }
    this.#pending.clear();
  }

  getDiagnostics() {
    return {
      concurrency: this.#workers.length || 1,
      queued: this.#queue.length,
      busy: this.#workers.filter((slot) => slot.busy).length,
    };
  }

  #terminateWorkers() {
    for (const slot of this.#workers) slot.worker.terminate();
    this.#workers.length = 0;
  }

  dispose() {
    this.#disposed = true;
    this.#terminateWorkers();
    for (const pending of this.#pending.values()) pending.reject(new Error('Terrain generation service disposed.'));
    this.#pending.clear();
    this.#queue.length = 0;
  }
}
