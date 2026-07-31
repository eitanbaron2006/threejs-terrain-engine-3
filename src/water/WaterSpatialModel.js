function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function createRandom(seed) {
  let state = (Math.trunc(finite(seed, 1)) >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class WaterSpatialModel {
  constructor({ worldSize, waterLevel, seed = 1, sampleHeight }) {
    this.worldSize = Math.max(1, finite(worldSize, 8000));
    this.waterLevel = finite(waterLevel, 0);
    this.seed = Math.trunc(finite(seed, 1));
    this.sampleHeight = typeof sampleHeight === 'function' ? sampleHeight : () => this.waterLevel;
  }

  sampleFloor(x, z) {
    return finite(this.sampleHeight(finite(x, 0), finite(z, 0)), this.waterLevel);
  }

  sampleDepth(x, z) {
    return Math.max(0, this.waterLevel - this.sampleFloor(x, z));
  }

  isUnderwater(x, y, z, clearance = 0) {
    const floorY = this.sampleFloor(x, z);
    return y < this.waterLevel - Math.max(0, finite(clearance, 0)) && y >= floorY;
  }

  findPositions({
    count = 1,
    minDepth = 1,
    maxDepth = Infinity,
    minSpacing = 0,
    margin = 0,
    seedOffset = 0,
    maxAttempts,
  } = {}) {
    const requested = Math.max(0, Math.round(finite(count, 1)));
    if (requested === 0) return [];
    const minimumDepth = Math.max(0, finite(minDepth, 1));
    const maximumDepth = Math.max(minimumDepth, finite(maxDepth, this.worldSize));
    const spacing = Math.max(0, finite(minSpacing, 0));
    const edgeMargin = Math.min(
      this.worldSize * 0.49,
      Math.max(0, finite(margin, 0)),
    );
    const extent = Math.max(1, this.worldSize * 0.5 - edgeMargin);
    const random = createRandom(this.seed + Math.trunc(finite(seedOffset, 0)) * 1013);
    const attempts = Math.max(
      requested,
      Math.round(finite(maxAttempts, requested * 700)),
    );
    const positions = [];
    const spacingSq = spacing * spacing;

    for (let attempt = 0; attempt < attempts && positions.length < requested; attempt += 1) {
      const x = (random() * 2 - 1) * extent;
      const z = (random() * 2 - 1) * extent;
      const floorY = this.sampleFloor(x, z);
      const depth = Math.max(0, this.waterLevel - floorY);
      if (depth < minimumDepth || depth > maximumDepth) continue;
      if (spacingSq > 0 && positions.some((item) => {
        const dx = item.x - x;
        const dz = item.z - z;
        return dx * dx + dz * dz < spacingSq;
      })) continue;
      positions.push({ x, z, floorY, depth });
    }

    return positions;
  }
}
