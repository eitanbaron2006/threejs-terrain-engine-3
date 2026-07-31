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

function enrichPositions(positions, random, type) {
  return positions.map((position, index) => ({
    ...position,
    id: `${type}-${index}`,
    heading: random() * Math.PI * 2,
    scale: 0.78 + random() * 0.48,
    phase: random() * Math.PI * 2,
    hue: random(),
  }));
}

export function createAquaticHabitatLayout(spatialModel, options = {}) {
  const fishSchoolCount = Math.max(0, Math.round(finite(options.fishSchoolCount, 3)));
  const grassPatchCount = Math.max(0, Math.round(finite(options.grassPatchCount, 14)));
  const coralClusterCount = Math.max(0, Math.round(finite(options.coralClusterCount, 8)));
  const random = createRandom(spatialModel.seed + 0x51f15e);

  const fishPositions = spatialModel.findPositions({
    count: fishSchoolCount,
    minDepth: 7,
    maxDepth: 48,
    minSpacing: 85,
    margin: spatialModel.worldSize * 0.08,
    seedOffset: 31,
  });
  const grassPositions = spatialModel.findPositions({
    count: grassPatchCount,
    minDepth: 6,
    maxDepth: 32,
    minSpacing: 26,
    margin: spatialModel.worldSize * 0.07,
    seedOffset: 47,
  });
  const coralPositions = spatialModel.findPositions({
    count: coralClusterCount,
    minDepth: 6,
    maxDepth: 38,
    minSpacing: 42,
    margin: spatialModel.worldSize * 0.07,
    seedOffset: 71,
  });

  const fishSchools = enrichPositions(fishPositions, random, 'school').map((position) => ({
    ...position,
    y: Math.min(
      spatialModel.waterLevel - 1.5,
      position.floorY + Math.max(2.5, Math.min(position.depth * 0.58, 12)),
    ),
    fishCount: 8 + Math.floor(random() * 5),
    radius: 9 + random() * 8,
    speed: 1.6 + random() * 1.2,
  }));
  const grassPatches = enrichPositions(grassPositions, random, 'grass').map((position) => ({
    ...position,
    y: position.floorY,
    bladeCount: 7 + Math.floor(random() * 7),
    radius: 3.5 + random() * 4,
  }));
  const coralClusters = enrichPositions(coralPositions, random, 'coral').map((position) => ({
    ...position,
    y: position.floorY,
    branchCount: 5 + Math.floor(random() * 4),
    radius: 2.2 + random() * 2.3,
  }));

  const habitatAnchor = coralClusters[0] ?? grassPatches[0] ?? fishSchools[0] ?? null;
  if (habitatAnchor && fishSchools[0]) {
    fishSchools[0].x = habitatAnchor.x;
    fishSchools[0].z = habitatAnchor.z;
    fishSchools[0].floorY = habitatAnchor.floorY;
    fishSchools[0].depth = habitatAnchor.depth;
    fishSchools[0].y = Math.min(
      spatialModel.waterLevel - 1.5,
      habitatAnchor.floorY + Math.max(3.5, Math.min(habitatAnchor.depth * 0.58, 9)),
    );
    fishSchools[0].radius = Math.min(fishSchools[0].radius, 11);
  }
  if (habitatAnchor && grassPatches[0]) {
    grassPatches[0].x = habitatAnchor.x + 3.5;
    grassPatches[0].z = habitatAnchor.z + 2.5;
    grassPatches[0].floorY = spatialModel.sampleFloor(grassPatches[0].x, grassPatches[0].z);
    grassPatches[0].depth = Math.max(0, spatialModel.waterLevel - grassPatches[0].floorY);
    grassPatches[0].y = grassPatches[0].floorY;
    grassPatches[0].radius = 5.5;
  }

  const focus = habitatAnchor;
  const demoView = focus ? {
    position: {
      x: focus.x + 14,
      y: Math.min(spatialModel.waterLevel - 2.5, focus.floorY + Math.min(5.5, focus.depth * 0.42)),
      z: focus.z + 15,
    },
    target: {
      x: focus.x,
      y: Math.min(spatialModel.waterLevel - 3, focus.floorY + 3.2),
      z: focus.z,
    },
  } : null;

  return {
    fishSchools,
    grassPatches,
    coralClusters,
    demoView,
  };
}
