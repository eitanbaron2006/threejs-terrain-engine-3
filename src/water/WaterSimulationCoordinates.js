export function worldToWaterSimulationUv(x, z, simulationWorldSize, origin = null) {
  const size = Number(simulationWorldSize);
  if (!Number.isFinite(size) || size <= 0) return null;
  const worldX = Number(x);
  const worldZ = Number(z);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;
  if (!origin) return { u: worldX / size, v: worldZ / size };
  const originX = Number(origin.x);
  const originZ = Number(origin.z);
  if (!Number.isFinite(originX) || !Number.isFinite(originZ)) return null;
  return {
    u: (worldX - originX) / size + 0.5,
    v: (worldZ - originZ) / size + 0.5,
  };
}

export function waterRadiusToSimulationUv(radius, simulationWorldSize, resolution) {
  const size = Number(simulationWorldSize);
  const pixels = Number(resolution);
  const worldRadius = Number(radius);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(pixels) || pixels <= 0) return null;
  if (!Number.isFinite(worldRadius) || worldRadius <= 0) return null;
  return Math.max(worldRadius / size, 1.15 / pixels);
}
