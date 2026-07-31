import { valueNoise2D } from './noise.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function analyzeTerrainSurface({
  center,
  left,
  right,
  down,
  up,
  step,
  worldX,
  worldZ,
  seed,
  waterLevel,
}) {
  const numericSeed = Number(seed);
  const normalizedSeed = Number.isFinite(numericSeed) ? numericSeed : 0;
  const numericStep = Number(step);
  const normalizedStep = Number.isFinite(numericStep) ? numericStep : 0;
  const dx = (right - left) / Math.max(normalizedStep * 2, 0.0001);
  const dz = (up - down) / Math.max(normalizedStep * 2, 0.0001);
  const slopeRadians = Math.atan(Math.hypot(dx, dz));
  const slope = slopeRadians * 180 / Math.PI;
  const broadVariation = valueNoise2D(worldX * 0.00145, worldZ * 0.00145, normalizedSeed + 557) * 0.5 + 0.5;
  const detailVariation = valueNoise2D(worldX * 0.0075, worldZ * 0.0075, normalizedSeed + 991) * 0.5 + 0.5;
  const variation = broadVariation * 0.72 + detailVariation * 0.28;
  const averageNeighbor = (left + right + down + up) * 0.25;
  const curvature = clamp((averageNeighbor - center) / Math.max(normalizedStep * 1.8, 1.0), -1, 1);
  const concavity = Math.max(0, curvature);
  const convexity = Math.max(0, -curvature);
  const slopeLength = Math.max(Math.hypot(dx, dz), 0.0001);
  const northness = clamp(0.5 + (-dz / slopeLength) * 0.5, 0, 1);
  const exposure = clamp(northness * 0.62 + convexity * 0.38, 0, 1);
  const moistureNoise = valueNoise2D(worldX * 0.00085, worldZ * 0.00085, normalizedSeed + 1709) * 0.5 + 0.5;
  const moisture = clamp(moistureNoise * 0.58 + concavity * 0.48 - convexity * 0.22 - exposure * 0.12, 0, 1);
  const coast = clamp(1 - Math.abs(center - waterLevel) / 18, 0, 1);
  const erosion = clamp(detailVariation * 0.48 + concavity * 0.34 + Math.min(1, slope / 58) * 0.18, 0, 1);

  return {
    height: center,
    slope,
    slopeRadians,
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
    waterLevel,
  };
}

export function normalizeSurfaceAnalysis(analysis) {
  return {
    ...analysis,
    slopeNormalized: clamp(analysis.slopeDegrees / 90, 0, 1),
    variation: clamp(analysis.variation, 0, 1),
    curvature: clamp(analysis.curvature, -1, 1),
    moisture: clamp(analysis.moisture, 0, 1),
    exposure: clamp(analysis.exposure, 0, 1),
    coast: clamp(analysis.coast, 0, 1),
    erosion: clamp(analysis.erosion, 0, 1),
  };
}
