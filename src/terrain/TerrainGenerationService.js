import { createTerrainHeightSampler, packControlWeights, smoothControlWeights, valueNoise2D, writeAutoWeights } from './noise.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class TerrainGenerationService {
  #workers = [];
  #requestId = 0;
  #pending = new Map();
  #queue = [];
  #disposed = false;

  constructor(workerCount = null) {
    const hardwareThreads = Number(globalThis.navigator?.hardwareConcurrency ?? 8);
    this.concurrency = clamp(Number(workerCount ?? hardwareThreads - 2), 2, 8);

    try {
      for (let index = 0; index < this.concurrency; index += 1) this.#createWorker(index);
    } catch (error) {
      console.warn('Terrain Worker Pool unavailable; synchronous generation is enabled.', error);
      this.#terminateWorkers();
      this.concurrency = 1;
    }
  }

  #createWorker(index) {
    const worker = new Worker(new URL('../workers/terrainWorker.js', import.meta.url), { type: 'module' });
    const slot = { index, worker, busy: false, requestId: null };
    worker.addEventListener('message', (event) => this.#onMessage(slot, event));
    worker.addEventListener('error', (event) => this.#onWorkerError(slot, event));
    this.#workers.push(slot);
  }

  generateChunk(descriptor, config, settings, presetId) {
    if (this.#disposed) return Promise.reject(new Error('Terrain generation service disposed.'));
    if (!this.#workers.length) return Promise.resolve(this.#generateSync(descriptor, config, settings, presetId));

    const id = ++this.#requestId;
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#queue.push({ id, descriptor, config, settings, presetId });
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
      slot.worker.postMessage({ id: job.id, type: 'generate-chunk', ...job });
    }
  }

  #onMessage(slot, event) {
    const { id, type } = event.data;
    const pending = this.#pending.get(id);
    slot.busy = false;
    slot.requestId = null;
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
    console.error(`Terrain worker ${slot.index} failed.`, event);
    if (slot.requestId !== null) {
      const pending = this.#pending.get(slot.requestId);
      pending?.reject(new Error(event.message || 'Terrain worker failed.'));
      this.#pending.delete(slot.requestId);
    }
    slot.busy = false;
    slot.requestId = null;
    this.#dispatch();
  }

  #generateSync(descriptor, config, settings, presetId) {
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
        const left = get(x - 1, z);
        const right = get(x + 1, z);
        const down = get(x, z - 1);
        const up = get(x, z + 1);
        const dx = (right - left) / Math.max(step * 2, 0.0001);
        const dz = (up - down) / Math.max(step * 2, 0.0001);
        const slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
        const broadVariation = valueNoise2D(worldX * 0.00145, worldZ * 0.00145, settings.seed + 557) * 0.5 + 0.5;
        const detailVariation = valueNoise2D(worldX * 0.0075, worldZ * 0.0075, settings.seed + 991) * 0.5 + 0.5;
        const variation = broadVariation * 0.72 + detailVariation * 0.28;
        const averageNeighbor = (left + right + down + up) * 0.25;
        const curvature = clamp((averageNeighbor - center) / Math.max(step * 1.8, 1.0), -1, 1);
        const concavity = Math.max(0, curvature);
        const convexity = Math.max(0, -curvature);
        const slopeLength = Math.max(Math.hypot(dx, dz), 0.0001);
        const northness = clamp(0.5 + (-dz / slopeLength) * 0.5, 0, 1);
        const exposure = clamp(northness * 0.62 + convexity * 0.38, 0, 1);
        const moistureNoise = valueNoise2D(worldX * 0.00085, worldZ * 0.00085, settings.seed + 1709) * 0.5 + 0.5;
        const moisture = clamp(moistureNoise * 0.58 + concavity * 0.48 - convexity * 0.22 - exposure * 0.12, 0, 1);
        const coast = clamp(1 - Math.abs(center - config.waterLevel) / 18, 0, 1);
        const erosion = clamp(detailVariation * 0.48 + concavity * 0.34 + Math.min(1, slope / 58) * 0.18, 0, 1);
        writeAutoWeights(rawControl, index * 4, center, slope, variation, presetId, 1, {
          waterLevel: config.waterLevel,
          curvature,
          moisture,
          exposure,
          coast,
          erosion,
        });
      }
    }
    const control = packControlWeights(smoothControlWeights(rawControl, resolution, 2));
    return { descriptor, resolution, heights, heightTextureData, heightTextureResolution: paddedResolution, control, minHeight, maxHeight };
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
