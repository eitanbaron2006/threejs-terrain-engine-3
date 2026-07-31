import test from 'node:test';
import assert from 'node:assert/strict';
import { valueNoise2D } from '../src/terrain/noise.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

test('flat samples preserve the legacy zero slope and curvature signals', async () => {
  const { analyzeTerrainSurface } = await import('../src/terrain/TerrainSurfaceAnalysis.js');
  const result = analyzeTerrainSurface({
    center: 20,
    left: 20,
    right: 20,
    down: 20,
    up: 20,
    step: 2,
    worldX: 10,
    worldZ: 12,
    seed: 1337,
    waterLevel: -3,
  });

  assert.equal(result.slope, 0);
  assert.equal(result.slopeDegrees, 0);
  assert.equal(result.curvature, 0);
  assert.equal(result.coast, 0);
});

test('surface analysis preserves every legacy generation formula exactly', async () => {
  const { analyzeTerrainSurface } = await import('../src/terrain/TerrainSurfaceAnalysis.js');
  const sample = {
    center: 4,
    left: 2,
    right: 8,
    down: 3,
    up: 7,
    step: 2,
    worldX: 10,
    worldZ: 12,
    seed: 1337,
    waterLevel: -3,
  };
  const dx = (sample.right - sample.left) / Math.max(sample.step * 2, 0.0001);
  const dz = (sample.up - sample.down) / Math.max(sample.step * 2, 0.0001);
  const slope = Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI;
  const broadVariation = valueNoise2D(sample.worldX * 0.00145, sample.worldZ * 0.00145, sample.seed + 557) * 0.5 + 0.5;
  const detailVariation = valueNoise2D(sample.worldX * 0.0075, sample.worldZ * 0.0075, sample.seed + 991) * 0.5 + 0.5;
  const variation = broadVariation * 0.72 + detailVariation * 0.28;
  const averageNeighbor = (sample.left + sample.right + sample.down + sample.up) * 0.25;
  const curvature = clamp((averageNeighbor - sample.center) / Math.max(sample.step * 1.8, 1.0), -1, 1);
  const concavity = Math.max(0, curvature);
  const convexity = Math.max(0, -curvature);
  const slopeLength = Math.max(Math.hypot(dx, dz), 0.0001);
  const northness = clamp(0.5 + (-dz / slopeLength) * 0.5, 0, 1);
  const exposure = clamp(northness * 0.62 + convexity * 0.38, 0, 1);
  const moistureNoise = valueNoise2D(sample.worldX * 0.00085, sample.worldZ * 0.00085, sample.seed + 1709) * 0.5 + 0.5;
  const moisture = clamp(moistureNoise * 0.58 + concavity * 0.48 - convexity * 0.22 - exposure * 0.12, 0, 1);
  const coast = clamp(1 - Math.abs(sample.center - sample.waterLevel) / 18, 0, 1);
  const erosion = clamp(detailVariation * 0.48 + concavity * 0.34 + Math.min(1, slope / 58) * 0.18, 0, 1);

  assert.deepEqual(analyzeTerrainSurface(sample), {
    height: sample.center,
    slope,
    slopeRadians: Math.atan(Math.hypot(dx, dz)),
    slopeDegrees: slope,
    broadVariation,
    detailVariation,
    variation,
    curvature,
    concavity,
    convexity,
    northness,
    exposure,
    moistureNoise,
    moisture,
    coast,
    erosion,
    waterLevel: sample.waterLevel,
  });
});

test('numeric string and numeric seeds produce identical surface signals', async () => {
  const { analyzeTerrainSurface } = await import('../src/terrain/TerrainSurfaceAnalysis.js');
  const input = {
    center: 4,
    left: 2,
    right: 8,
    down: 3,
    up: 7,
    step: 2,
    worldX: 10,
    worldZ: 12,
    waterLevel: -3,
  };

  assert.deepEqual(
    analyzeTerrainSurface({ ...input, seed: '1337' }),
    analyzeTerrainSurface({ ...input, seed: 1337 }),
  );
});

test('zero and non-finite steps produce finite signals with the zero-step fallback', async () => {
  const { analyzeTerrainSurface } = await import('../src/terrain/TerrainSurfaceAnalysis.js');
  const input = {
    center: 4,
    left: 2,
    right: 8,
    down: 3,
    up: 7,
    worldX: 10,
    worldZ: 12,
    seed: 1337,
    waterLevel: -3,
  };
  const zeroStep = analyzeTerrainSurface({ ...input, step: 0 });

  for (const step of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined]) {
    const result = analyzeTerrainSurface({ ...input, step });
    assert.deepEqual(result, zeroStep);
    assert.ok(Object.values(result).every(Number.isFinite));
  }
});

test('normalized analysis preserves slope degrees and exposes a separate normalized slope', async () => {
  const {
    analyzeTerrainSurface,
    normalizeSurfaceAnalysis,
  } = await import('../src/terrain/TerrainSurfaceAnalysis.js');
  const analysis = analyzeTerrainSurface({
    center: 4,
    left: 2,
    right: 8,
    down: 3,
    up: 7,
    step: 2,
    worldX: 10,
    worldZ: 12,
    seed: 1337,
    waterLevel: -3,
  });
  const normalized = normalizeSurfaceAnalysis(analysis);

  assert.equal(normalized.slope, analysis.slope);
  assert.equal(normalized.slopeDegrees, analysis.slopeDegrees);
  assert.equal(normalized.slopeNormalized, clamp(analysis.slopeDegrees / 90, 0, 1));
});

test('normalized surface analysis is deterministic and bounded for material evaluation', async () => {
  const {
    analyzeTerrainSurface,
    normalizeSurfaceAnalysis,
  } = await import('../src/terrain/TerrainSurfaceAnalysis.js');
  const input = {
    center: 4,
    left: 2,
    right: 8,
    down: 3,
    up: 7,
    step: 2,
    worldX: 10,
    worldZ: 12,
    seed: 1337,
    waterLevel: -3,
  };

  const first = normalizeSurfaceAnalysis(analyzeTerrainSurface(input));
  const second = normalizeSurfaceAnalysis(analyzeTerrainSurface(input));

  assert.deepEqual(first, second);
  for (const key of ['slopeNormalized', 'variation', 'moisture', 'exposure', 'coast', 'erosion']) {
    assert.ok(first[key] >= 0 && first[key] <= 1, key);
  }
});
