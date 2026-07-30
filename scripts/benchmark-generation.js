import { performance } from 'node:perf_hooks';
import { DEFAULT_GENERATOR_SETTINGS, DEFAULT_TERRAIN_CONFIG } from '../src/terrain/TerrainConfig.js';
import { terrainHeightAt, valueNoise2D, writeAutoWeights } from '../src/terrain/noise.js';

function generateChunk(resolution) {
  const config = DEFAULT_TERRAIN_CONFIG;
  const settings = DEFAULT_GENERATOR_SETTINGS;
  const step = config.chunkSize / (resolution - 1);
  const heights = new Float32Array(resolution * resolution);
  const control = new Uint8Array(resolution * resolution * 4);

  const heightStart = performance.now();
  for (let z = 0; z < resolution; z += 1) {
    const worldZ = z * step;
    for (let x = 0; x < resolution; x += 1) {
      heights[z * resolution + x] = terrainHeightAt(x * step, worldZ, settings);
    }
  }
  const heightMs = performance.now() - heightStart;

  const sample = (x, z) => {
    const safeX = Math.max(0, Math.min(resolution - 1, x));
    const safeZ = Math.max(0, Math.min(resolution - 1, z));
    return heights[safeZ * resolution + safeX];
  };

  const controlStart = performance.now();
  for (let z = 0; z < resolution; z += 1) {
    const worldZ = z * step;
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const gradient = Math.hypot(
        sample(x + 1, z) - sample(x - 1, z),
        sample(x, z + 1) - sample(x, z - 1),
      ) / Math.max(step * 2, 0.0001);
      const slope = Math.atan(gradient) * 180 / Math.PI;
      const worldX = x * step;
      const variation = valueNoise2D(worldX * 0.018, worldZ * 0.018, settings.seed + 557) * 0.5 + 0.5;
      writeAutoWeights(control, index * 4, heights[index], slope, variation, 'mediterranean', 255);
    }
  }
  const controlMs = performance.now() - controlStart;
  return { resolution, heightMs, controlMs, totalMs: heightMs + controlMs };
}

// Warm up the JIT compiler before reporting timings.
generateChunk(65);
generateChunk(65);

console.log('Terrain Engine 3.11.6 generation benchmark');
console.log(`Node ${process.version} · ${process.platform} ${process.arch}`);
console.table(DEFAULT_TERRAIN_CONFIG.lodLevels.map((level) => {
  const result = generateChunk(level.dataResolution);
  return {
    LOD: level.id,
    Resolution: `${result.resolution}x${result.resolution}`,
    HeightMs: result.heightMs.toFixed(2),
    SplatMs: result.controlMs.toFixed(2),
    TotalMs: result.totalMs.toFixed(2),
  };
}));
