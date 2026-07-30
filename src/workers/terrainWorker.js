import { createTerrainHeightSampler, packControlWeights, smoothControlWeights, valueNoise2D, writeAutoWeights } from '../terrain/noise.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

self.addEventListener('message', (event) => {
  const { id, type, descriptor, config, settings, presetId } = event.data;
  if (type !== 'generate-chunk') return;
  try {
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

    const samplePaddedHeight = (x, z) => heightTextureData[(z + 1) * paddedResolution + (x + 1)];

    for (let z = 0; z < resolution; z += 1) {
      const worldZ = originZ + z * step;
      for (let x = 0; x < resolution; x += 1) {
        const index = z * resolution + x;
        const worldX = originX + x * step;
        const center = heights[index];
        const left = samplePaddedHeight(x - 1, z);
        const right = samplePaddedHeight(x + 1, z);
        const down = samplePaddedHeight(x, z - 1);
        const up = samplePaddedHeight(x, z + 1);
        const dx = (right - left) / Math.max(step * 2, 0.0001);
        const dz = (up - down) / Math.max(step * 2, 0.0001);
        const slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
        const broadVariation = valueNoise2D(worldX * 0.00145, worldZ * 0.00145, settings.seed + 557) * 0.5 + 0.5;
        const detailVariation = valueNoise2D(worldX * 0.0075, worldZ * 0.0075, settings.seed + 991) * 0.5 + 0.5;
        const variation = broadVariation * 0.72 + detailVariation * 0.28;
        const averageNeighbor = (left + right + down + up) * 0.25;
        const curvature = Math.max(-1, Math.min(1, (averageNeighbor - center) / Math.max(step * 1.8, 1.0)));
        const concavity = Math.max(0, curvature);
        const convexity = Math.max(0, -curvature);
        const slopeLength = Math.max(Math.hypot(dx, dz), 0.0001);
        const northness = clamp01(0.5 + (-dz / slopeLength) * 0.5);
        const exposure = clamp01(northness * 0.62 + convexity * 0.38);
        const moistureNoise = valueNoise2D(worldX * 0.00085, worldZ * 0.00085, settings.seed + 1709) * 0.5 + 0.5;
        const moisture = clamp01(moistureNoise * 0.58 + concavity * 0.48 - convexity * 0.22 - exposure * 0.12);
        const coast = clamp01(1 - Math.abs(center - config.waterLevel) / 18);
        const erosion = clamp01(detailVariation * 0.48 + concavity * 0.34 + Math.min(1, slope / 58) * 0.18);
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

    self.postMessage({
      id,
      type: 'chunk-result',
      descriptor,
      resolution,
      minHeight,
      maxHeight,
      heights: heights.buffer,
      heightTextureData: heightTextureData.buffer,
      heightTextureResolution: paddedResolution,
      control: control.buffer,
    }, [heights.buffer, heightTextureData.buffer, control.buffer]);
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error.message, stack: error.stack });
  }
});
