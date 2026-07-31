function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
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

function classifyHabitat(depth) {
  if (depth >= 30) return 'deep-school';
  if (depth <= 11) return 'grass-bed';
  return 'reef';
}

function createHabitatZones(spatialModel, options, random) {
  const habitatDensity = clamp(finite(options.habitatDensity, 1), 0.25, 2);
  const margin = Math.min(220, spatialModel.worldSize * 0.045);
  const extent = Math.max(1, spatialModel.worldSize * 0.5 - margin);
  const usableSize = extent * 2;
  const targetCellSize = 220 / Math.sqrt(habitatDensity);
  const cellsPerAxis = Math.max(1, Math.ceil(usableSize / targetCellSize));
  const cellSize = usableSize / cellsPerAxis;
  const positions = [];

  for (let zIndex = 0; zIndex < cellsPerAxis; zIndex += 1) {
    for (let xIndex = 0; xIndex < cellsPerAxis; xIndex += 1) {
      const centerX = -extent + (xIndex + 0.5) * cellSize;
      const centerZ = -extent + (zIndex + 0.5) * cellSize;
      const jitterX = (random() - 0.5) * cellSize * 0.5;
      const jitterZ = (random() - 0.5) * cellSize * 0.5;
      const candidates = [
        [centerX + jitterX, centerZ + jitterZ],
        [centerX, centerZ],
        [centerX + cellSize * 0.24, centerZ - cellSize * 0.2],
        [centerX - cellSize * 0.22, centerZ + cellSize * 0.24],
      ];
      const position = candidates.map(([x, z]) => {
        const floorY = spatialModel.sampleFloor(x, z);
        return { x, z, floorY, depth: Math.max(0, spatialModel.waterLevel - floorY) };
      }).find((candidate) => candidate.depth >= 3 && candidate.depth <= 180);
      if (position) positions.push(position);
    }
  }

  return positions.map((position, index) => {
    const habitatClass = classifyHabitat(position.depth);
    const reef = habitatClass === 'reef';
    const grassBed = habitatClass === 'grass-bed';
    return {
      ...position,
      id: `aquatic-zone-${index}`,
      seed: spatialModel.seed + index * 7919 + 89,
      habitatClass,
      radius: (reef ? 0.45 : grassBed ? 0.42 : 0.48) * cellSize * (0.86 + random() * 0.22),
      fishTarget: reef ? 48 : grassBed ? 34 : 42,
      vegetationTarget: reef ? 260 : grassBed ? 320 : 30,
      heading: random() * Math.PI * 2,
      density: 0.82 + random() * 0.36,
    };
  });
}

function createDemoView(focus, spatialModel) {
  if (!focus) return null;
  return {
    position: {
      x: focus.x + 16,
      y: Math.min(
        spatialModel.waterLevel - 2.5,
        focus.floorY + Math.min(6.5, focus.depth * 0.42),
      ),
      z: focus.z + 18,
    },
    target: {
      x: focus.x,
      y: Math.min(spatialModel.waterLevel - 3, focus.floorY + 3.2),
      z: focus.z,
    },
  };
}

export function createAquaticHabitatLayout(spatialModel, options = {}) {
  const fishSchoolCount = Math.max(0, Math.round(finite(options.fishSchoolCount, 3)));
  const grassPatchCount = Math.max(0, Math.round(finite(options.grassPatchCount, 14)));
  const coralClusterCount = Math.max(0, Math.round(finite(options.coralClusterCount, 8)));
  const random = createRandom(spatialModel.seed + 0x51f15e);
  const zones = createHabitatZones(spatialModel, options, random);

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

  const demoZone = zones.find((zone) => zone.habitatClass === 'reef')
    ?? zones.find((zone) => zone.habitatClass === 'grass-bed')
    ?? zones[0]
    ?? null;
  const focus = demoZone ?? habitatAnchor;
  const demoView = createDemoView(focus, spatialModel);

  return {
    zones,
    demoZone,
    fishSchools,
    grassPatches,
    coralClusters,
    demoView,
  };
}
