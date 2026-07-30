import { createTerrainProgramEvaluator } from './TerrainGraphCompiler.js';

function fade(value) {
  return value * value * (3 - 2 * value);
}

// Fast deterministic integer hash. Avoids Math.sin() in the hottest terrain loop.
function hash2D(x, z, seed) {
  let value = Math.imul(x | 0, 374761393)
    ^ Math.imul(z | 0, 668265263)
    ^ Math.imul(seed | 0, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  value ^= value >>> 16;
  return ((value >>> 0) / 4294967295) * 2 - 1;
}

export function valueNoise2D(x, z, seed = 0) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const a = hash2D(x0, z0, seed);
  const b = hash2D(x0 + 1, z0, seed);
  const c = hash2D(x0, z0 + 1, seed);
  const d = hash2D(x0 + 1, z0 + 1, seed);
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * tz;
}

function fbm2DFast(x, z, seed, octaves, persistence, lacunarity) {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2D(x * frequency, z * frequency, seed + octave * 101) * amplitude;
    normalization += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return normalization > 0 ? total / normalization : 0;
}

export function fbm2D(x, z, options = {}) {
  return fbm2DFast(
    x,
    z,
    Number(options.seed ?? 0),
    Number(options.octaves ?? 5),
    Number(options.persistence ?? 0.5),
    Number(options.lacunarity ?? 2),
  );
}

export function ridgedNoise2D(x, z, options = {}) {
  const ridge = 1 - Math.abs(fbm2D(x, z, options));
  return ridge * ridge;
}

function legacyTerrainHeightAt(worldX, worldZ, settings = {}) {
  const frequency = Number(settings.frequency ?? 0.00185);
  const seed = Number(settings.seed ?? 1337);
  const warpStrength = Number(settings.warpStrength ?? 92);
  const warpFrequency = frequency * 0.42;
  const persistence = Number(settings.persistence ?? 0.51);
  const lacunarity = Number(settings.lacunarity ?? 2.04);
  const octaves = Number(settings.octaves ?? 6);

  const warpX = fbm2DFast(worldX * warpFrequency, worldZ * warpFrequency, seed + 701, 3, 0.55, 2);
  const warpZ = fbm2DFast(worldX * warpFrequency, worldZ * warpFrequency, seed + 1301, 3, 0.55, 2);
  const warpedX = worldX + warpX * warpStrength;
  const warpedZ = worldZ + warpZ * warpStrength;

  const broad = fbm2DFast(warpedX * frequency, warpedZ * frequency, seed, octaves, persistence, lacunarity);
  const detail = fbm2DFast(
    warpedX * frequency * 3.35,
    warpedZ * frequency * 3.35,
    seed + 211,
    Math.max(2, octaves - 2),
    persistence,
    lacunarity,
  );
  const ridgeNoise = fbm2DFast(
    warpedX * frequency * 0.7,
    warpedZ * frequency * 0.7,
    seed + 991,
    octaves,
    persistence,
    lacunarity,
  );
  const ridge = 1 - Math.abs(ridgeNoise);
  const ridges = ridge * ridge;
  const continental = fbm2DFast(
    worldX * Number(settings.continentalScale ?? 0.00034),
    worldZ * Number(settings.continentalScale ?? 0.00034),
    seed + 5051,
    4,
    0.54,
    2,
  );

  const amplitude = Number(settings.amplitude ?? 82);
  let shaped = broad * 0.69 + detail * 0.17 + (ridges - 0.5) * Number(settings.ridgeStrength ?? 0.52);
  shaped += continental * Number(settings.continentalStrength ?? 64) / Math.max(amplitude, 1);

  const terraceStrength = Number(settings.terraceStrength ?? 0);
  if (terraceStrength > 0) {
    const terraces = Math.round(shaped * 11) / 11;
    shaped += (terraces - shaped) * terraceStrength;
  }

  const rawHeight = Number(settings.baseHeight ?? 8) + shaped * amplitude;

  // A world must finish as a complete landmass, never as a square heightfield cut.
  // The irregular radial continent mask pushes the outer band below sea level before
  // the circular streaming boundary is reached. Low-frequency world-space noise keeps
  // the coast organic while remaining perfectly deterministic across chunk borders.
  const worldRadius = Number(settings.worldRadius ?? 4000);
  const waterLevel = Number(settings.waterLevel ?? -3);
  const landRadius = Math.min(Number(settings.landRadius ?? worldRadius * 0.76), worldRadius * 0.88);
  const coastWidth = Math.max(120, Number(settings.coastWidth ?? worldRadius * 0.18));
  const coastIrregularity = Math.max(0, Math.min(0.42, Number(settings.coastIrregularity ?? 0.18)));
  const oceanDepth = Math.max(8, Number(settings.oceanDepth ?? 52));

  const axisNoise = valueNoise2D(worldX * 0.00019, worldZ * 0.00019, seed + 9107);
  const coastNoise = fbm2DFast(worldX * 0.00043, worldZ * 0.00043, seed + 7123, 4, 0.54, 2.03);
  const angle = Math.atan2(worldZ, worldX);
  const directionalShape = Math.sin(angle * 2.0 + seed * 0.013) * 0.055
    + Math.sin(angle * 5.0 - seed * 0.007) * 0.025;
  const effectiveRadius = landRadius * (1.0 + coastNoise * coastIrregularity + axisNoise * 0.035 + directionalShape);
  const radialDistance = Math.hypot(worldX, worldZ);
  const coastStart = effectiveRadius - coastWidth * 0.58;
  const coastEnd = effectiveRadius + coastWidth * 0.42;
  const landBlend = 1 - smoothRange(coastStart, coastEnd, radialDistance);
  const seaFloorVariation = fbm2DFast(worldX * 0.0007, worldZ * 0.0007, seed + 4301, 3, 0.52, 2.0);
  
  // Progressive ocean deepening beyond the coastal drop-off
  const deepOceanFactor = smoothRange(effectiveRadius, worldRadius * 1.5, radialDistance);
  const extraOceanDepth = deepOceanFactor * 140.0;
  const seaFloor = waterLevel - oceanDepth - extraOceanDepth + seaFloorVariation * 7.5;

  return seaFloor + (rawHeight - seaFloor) * landBlend;
}

const terrainSamplerCache = new WeakMap();

export function createTerrainHeightSampler(settings = {}) {
  if (!settings.terrainProgram) {
    return (worldX, worldZ) => legacyTerrainHeightAt(worldX, worldZ, settings);
  }
  const evaluate = createTerrainProgramEvaluator(settings.terrainProgram, { fbm2D, valueNoise2D });
  return (worldX, worldZ) => evaluate(worldX, worldZ);
}

export function terrainHeightAt(worldX, worldZ, settings = {}) {
  if (!settings.terrainProgram) return legacyTerrainHeightAt(worldX, worldZ, settings);
  if (!settings || typeof settings !== 'object') return createTerrainHeightSampler(settings)(worldX, worldZ);
  const cached = terrainSamplerCache.get(settings);
  if (cached?.program === settings.terrainProgram) return cached.sample(worldX, worldZ);
  const sample = createTerrainHeightSampler(settings);
  terrainSamplerCache.set(settings, { program: settings.terrainProgram, sample });
  return sample(worldX, worldZ);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothRange(min, max, value) {
  const t = clamp01((value - min) / Math.max(max - min, 0.0001));
  return t * t * (3 - 2 * t);
}

function normalizeWeights(target, offset, scale) {
  const total = target[offset] + target[offset + 1] + target[offset + 2] + target[offset + 3];
  if (total <= 0.000001) {
    target[offset] = 0;
    target[offset + 1] = scale;
    target[offset + 2] = 0;
    target[offset + 3] = 0;
    return target;
  }
  const multiplier = scale / total;
  target[offset] *= multiplier;
  target[offset + 1] *= multiplier;
  target[offset + 2] *= multiplier;
  target[offset + 3] *= multiplier;
  return target;
}

/**
 * Geological material distribution. The optional context is deliberately based on
 * world-space measurements so adjacent chunks produce the same masks.
 * curvature: -1 convex ridge, +1 concave basin
 * moisture/exposure/coast/erosion: 0..1
 */
function customRangeWeight(value, minimum, maximum, blend) {
  const safeBlend = Math.max(0.001, Number(blend ?? 1));
  const enter = smoothRange(Number(minimum ?? -1e6) - safeBlend, Number(minimum ?? -1e6) + safeBlend, value);
  const exit = 1 - smoothRange(Number(maximum ?? 1e6) - safeBlend, Number(maximum ?? 1e6) + safeBlend, value);
  return clamp01(enter * exit);
}

function calculateCustomPackWeights(height, slopeDegrees, variation, pack, target, offset, scale, context = {}) {
  const curvature = Math.max(-1, Math.min(1, Number(context.curvature ?? 0)));
  const moisture = clamp01(Number(context.moisture ?? variation));
  const coast = clamp01(Number(context.coast ?? 0));
  const erosion = clamp01(Number(context.erosion ?? variation));
  const transitionNoise = clamp01(Number(pack.transitionNoise ?? 0.2));
  const globalBlend = Math.max(0.1, Number(pack.globalBlend ?? 1));
  const layers = Array.isArray(pack.layers) ? pack.layers.slice(0, 4) : [];

  for (let channel = 0; channel < 4; channel += 1) {
    const layer = layers[channel] ?? {};
    const d = layer.distribution ?? {};
    const heightWeight = customRangeWeight(height, d.minHeight ?? -48, d.maxHeight ?? 220, (d.heightBlend ?? 18) * globalBlend);
    const slopeWeight = customRangeWeight(slopeDegrees, d.minSlope ?? 0, d.maxSlope ?? 72, (d.slopeBlend ?? 12) * globalBlend);
    const curvatureAffinity = Math.max(-1, Math.min(1, Number(d.curvatureBias ?? 0)));
    const curvatureSignal = curvatureAffinity >= 0 ? Math.max(0, -curvature) : Math.max(0, curvature);
    const moistureAffinity = Math.max(-1, Math.min(1, Number(d.moistureAffinity ?? 0)));
    const coastAffinity = Math.max(-1, Math.min(1, Number(d.coastAffinity ?? 0)));
    const erosionAffinity = Math.max(-1, Math.min(1, Number(d.erosionAffinity ?? 0)));
    const moistureFactor = 1 + moistureAffinity * (moisture * 2 - 1) * 0.75;
    const coastFactor = 1 + coastAffinity * (coast * 2 - 1) * 0.85;
    const erosionFactor = 1 + erosionAffinity * (erosion * 2 - 1) * 0.65;
    const curvatureFactor = 1 + Math.abs(curvatureAffinity) * curvatureSignal * 1.15;
    const noiseFactor = 1 + (variation - 0.5) * transitionNoise * 0.9;
    const priority = Math.max(0.01, Number(d.priority ?? 1));
    target[offset + channel] = Math.max(0.0015, heightWeight * slopeWeight * moistureFactor * coastFactor * erosionFactor * curvatureFactor * noiseFactor * priority);
  }
  return normalizeWeights(target, offset, scale);
}

function calculateAutoWeights(height, slopeDegrees, variation, presetId, target, offset, scale, context = {}) {
  if (presetId && typeof presetId === 'object' && Array.isArray(presetId.layers)) {
    return calculateCustomPackWeights(height, slopeDegrees, variation, presetId, target, offset, scale, context);
  }

  const waterLevel = Number(context.waterLevel ?? 0);
  const curvature = Math.max(-1, Math.min(1, Number(context.curvature ?? 0)));
  const concavity = Math.max(0, curvature);
  const convexity = Math.max(0, -curvature);
  const moisture = clamp01(Number(context.moisture ?? variation));
  const exposure = clamp01(Number(context.exposure ?? 0.5));
  const erosion = clamp01(Number(context.erosion ?? variation));
  const coast = clamp01(Number(context.coast ?? (1 - smoothRange(waterLevel + 1.5, waterLevel + 14, height))));

  const flat = 1 - smoothRange(16, 48, slopeDegrees);
  const rolling = smoothRange(8, 30, slopeDegrees) * (1 - smoothRange(42, 64, slopeDegrees));
  const steep = smoothRange(24, 58, slopeDegrees);
  const cliff = smoothRange(42, 72, slopeDegrees);
  const lowland = 1 - smoothRange(waterLevel + 24, waterLevel + 105, height);
  const highland = smoothRange(waterLevel + 46, waterLevel + 155, height);
  const broadNoise = 0.72 + variation * 0.56;

  let layer0;
  let layer1;
  let layer2;
  let layer3;

  if (presetId === 'alpine') {
    const snowLine = smoothRange(waterLevel + 82, waterLevel + 168, height);
    layer0 = snowLine * (0.52 + flat * 0.46) * (0.74 + (1 - exposure) * 0.32);
    layer1 = lowland * flat * (0.55 + moisture * 0.88) * (1 - snowLine * 0.84);
    layer2 = (rolling * 0.62 + concavity * 0.74 + erosion * 0.24) * (1 - cliff * 0.76);
    layer3 = steep * (0.74 + convexity * 0.72 + highland * 0.35) + cliff * 0.48;
  } else if (presetId === 'desert') {
    layer0 = flat * (0.9 + (1 - moisture) * 0.48) * (1 - cliff * 0.65);
    layer1 = rolling * (0.38 + erosion * 0.58) + flat * 0.22;
    layer2 = (concavity * 0.78 + (1 - moisture) * 0.38 + highland * 0.18) * (1 - cliff * 0.55);
    layer3 = steep * (0.72 + convexity * 0.65) + cliff * 0.52;
  } else if (presetId === 'volcanic') {
    layer0 = flat * (0.36 + (1 - moisture) * 0.38) + concavity * 0.18;
    layer1 = rolling * (0.52 + erosion * 0.38) + flat * 0.18;
    layer2 = highland * (0.28 + convexity * 0.46) + erosion * 0.24;
    layer3 = steep * (0.88 + convexity * 0.72) + cliff * 0.62;
  } else {
    // Mediterranean masks stay broad, but exposed inland uplands should resolve as
    // vegetation/rock instead of one dominant soil plate.
    const inland = 1 - coast;
    const vegetation = lowland * flat * (0.58 + moisture * 0.95) * (1 - coast * 0.64) * (1 - convexity * 0.28);
    const uplandGrass = rolling * (0.38 + moisture * 0.48) * inland * (1 - highland * 0.44) * (1 - convexity * 0.22);
    const depositionalSoil = (concavity * 0.64 + erosion * 0.18 + rolling * (1 - moisture) * 0.17 + flat * (1 - moisture) * 0.08)
      * inland * (1 - highland * 0.62) * (1 - steep * 0.58) * (1 - convexity * 0.35);
    const exposedRock = steep * (0.84 + convexity * 0.85 + exposure * 0.28)
      + cliff * 0.62
      + highland * (0.38 + exposure * 0.42 + convexity * 0.46)
      + rolling * highland * (0.3 + exposure * 0.28);
    layer0 = coast * flat * (0.82 + (1 - moisture) * 0.24) + coast * rolling * 0.16;
    layer1 = vegetation + uplandGrass;
    layer2 = depositionalSoil * (1 - coast * 0.44);
    layer3 = exposedRock;
  }

  // Keep a small shared substrate in every material. This prevents islands with
  // cut-out borders and gives height blending enough overlap to form natural seams.
  const substrate = 0.018;
  target[offset] = Math.max(substrate, layer0 * broadNoise);
  target[offset + 1] = Math.max(substrate, layer1 * (0.86 + moisture * 0.26));
  target[offset + 2] = Math.max(substrate, layer2 * (0.86 + (1 - variation) * 0.24));
  target[offset + 3] = Math.max(substrate, layer3 * (0.9 + variation * 0.18));
  return normalizeWeights(target, offset, scale);
}

export function writeAutoWeights(target, offset, height, slopeDegrees, variation, presetId = 'mediterranean', scale = 255, context = {}) {
  calculateAutoWeights(height, slopeDegrees, variation, presetId, target, offset, scale, context);
  if (target instanceof Uint8Array || target instanceof Uint8ClampedArray) {
    target[offset] = Math.round(target[offset]);
    target[offset + 1] = Math.round(target[offset + 1]);
    target[offset + 2] = Math.round(target[offset + 2]);
    target[offset + 3] = Math.round(target[offset + 3]);
  }
  return target;
}

export function computeAutoWeights(height, slopeDegrees, variation, presetId = 'mediterranean', context = {}) {
  const output = [0, 0, 0, 0];
  calculateAutoWeights(height, slopeDegrees, variation, presetId, output, 0, 1, context);
  return output;
}

export function smoothControlWeights(source, resolution, passes = 5) {
  const count = resolution * resolution * 4;
  let read = source instanceof Float32Array ? source : Float32Array.from(source, (value) => value / 255);
  let write = new Float32Array(count);
  const kernel = [1, 2, 1];
  const sample = (x, z, channel) => {
    const safeX = Math.max(0, Math.min(resolution - 1, x));
    const safeZ = Math.max(0, Math.min(resolution - 1, z));
    return read[(safeZ * resolution + safeX) * 4 + channel];
  };

  for (let pass = 0; pass < passes; pass += 1) {
    for (let z = 0; z < resolution; z += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const offset = (z * resolution + x) * 4;
        let sum = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          let value = 0;
          let weightSum = 0;
          for (let dz = -1; dz <= 1; dz += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const weight = kernel[dx + 1] * kernel[dz + 1];
              value += sample(x + dx, z + dz, channel) * weight;
              weightSum += weight;
            }
          }
          write[offset + channel] = value / weightSum;
          sum += write[offset + channel];
        }
        const inv = sum > 0.000001 ? 1 / sum : 0;
        if (inv === 0) {
          write[offset] = 0; write[offset + 1] = 1; write[offset + 2] = 0; write[offset + 3] = 0;
        } else {
          write[offset] *= inv; write[offset + 1] *= inv; write[offset + 2] *= inv; write[offset + 3] *= inv;
        }
      }
    }
    const temporary = read;
    read = write;
    write = temporary instanceof Float32Array && temporary.length === count ? temporary : new Float32Array(count);
  }
  return read;
}

export function packControlWeights(source, output = new Uint8Array(source.length)) {
  for (let offset = 0; offset < source.length; offset += 4) {
    let a = Math.max(0, source[offset]);
    let b = Math.max(0, source[offset + 1]);
    let c = Math.max(0, source[offset + 2]);
    let d = Math.max(0, source[offset + 3]);
    const sum = a + b + c + d || 1;
    a /= sum; b /= sum; c /= sum; d /= sum;
    output[offset] = Math.round(a * 255);
    output[offset + 1] = Math.round(b * 255);
    output[offset + 2] = Math.round(c * 255);
    output[offset + 3] = Math.max(0, 255 - output[offset] - output[offset + 1] - output[offset + 2]);
  }
  return output;
}
