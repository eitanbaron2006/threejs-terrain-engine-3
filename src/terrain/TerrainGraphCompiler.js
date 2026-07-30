import { TERRAIN_GRAPH_VERSION, TERRAIN_NODE_DEFINITIONS, validateTerrainGraph } from './TerrainGraphModel.js';

const OP_BY_TYPE = Object.freeze({
  'world/coordinates': 'worldCoordinates',
  'input/constant': 'constant',
  'noise/fbm': 'fbm',
  'noise/ridged': 'ridged',
  'noise/continental': 'continental',
  'transform/domainWarp': 'domainWarp',
  'transform/terrace': 'terrace',
  'transform/remap': 'remap',
  'transform/clamp': 'clamp',
  'combine/add': 'add',
  'combine/multiply': 'multiply',
  'combine/blend': 'blend',
  'shape/islandCoast': 'islandCoast',
  'terrain/output': 'terrainOutput',
});

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function topologicalNodeIds(graph) {
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const link of graph.links) {
    outgoing.get(link.fromNode).push(link.toNode);
    incoming.set(link.toNode, incoming.get(link.toNode) + 1);
  }
  const queue = graph.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    for (const target of outgoing.get(id)) {
      const count = incoming.get(target) - 1;
      incoming.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  if (ordered.length !== graph.nodes.length) throw new Error('Terrain graph contains a cycle.');
  return ordered;
}

export function compileTerrainGraph(graph) {
  const validation = validateTerrainGraph(graph);
  if (!validation.valid) throw new Error(validation.errors.join(' '));

  const orderedIds = topologicalNodeIds(graph);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const slotsByNode = new Map(orderedIds.map((id, index) => [id, index]));
  const linksByTarget = new Map();
  for (const link of graph.links) {
    if (!linksByTarget.has(link.toNode)) linksByTarget.set(link.toNode, []);
    linksByTarget.get(link.toNode).push(link);
  }

  const instructions = orderedIds.map((nodeId) => {
    const node = nodesById.get(nodeId);
    const inputs = {};
    for (const link of linksByTarget.get(nodeId) ?? []) {
      inputs[link.toSocket] = slotsByNode.get(link.fromNode);
    }
    return {
      nodeId,
      title: TERRAIN_NODE_DEFINITIONS[node.type].title,
      op: OP_BY_TYPE[node.type],
      slot: slotsByNode.get(nodeId),
      inputs,
      properties: clone(node.properties ?? {}),
    };
  });
  const outputNode = graph.nodes.find((node) => node.type === 'terrain/output');
  return {
    version: TERRAIN_GRAPH_VERSION,
    slotCount: instructions.length,
    outputSlot: slotsByNode.get(outputNode.id),
    instructions,
  };
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothRange(min, max, value) {
  const t = clamp((value - min) / Math.max(max - min, 0.0001), 0, 1);
  return t * t * (3 - 2 * t);
}

function prepareInstruction(instruction) {
  const properties = instruction.properties ?? {};
  if (instruction.op === 'domainWarp') {
    return {
      ...instruction,
      warpXOptions: {
        seed: number(properties.seed, 1337) + 701,
        octaves: number(properties.octaves, 3),
        persistence: number(properties.persistence, 0.55),
        lacunarity: number(properties.lacunarity, 2),
      },
      warpZOptions: {
        seed: number(properties.seed, 1337) + 1301,
        octaves: number(properties.octaves, 3),
        persistence: number(properties.persistence, 0.55),
        lacunarity: number(properties.lacunarity, 2),
      },
    };
  }
  if (instruction.op === 'fbm' || instruction.op === 'ridged' || instruction.op === 'continental') {
    return {
      ...instruction,
      noiseOptions: {
        seed: number(properties.seed, 0),
        octaves: Math.max(1, Math.round(number(properties.octaves, 5))),
        persistence: number(properties.persistence, 0.5),
        lacunarity: number(properties.lacunarity, 2),
      },
    };
  }
  if (instruction.op === 'islandCoast') {
    const seed = number(properties.seed, 1337);
    return {
      ...instruction,
      coastOptions: { seed: seed + 7123, octaves: 4, persistence: 0.54, lacunarity: 2.03 },
      seaFloorOptions: { seed: seed + 4301, octaves: 3, persistence: 0.52, lacunarity: 2 },
    };
  }
  return instruction;
}

export function createTerrainProgramEvaluator(program, runtime) {
  if (!program || !Array.isArray(program.instructions) || !Number.isInteger(program.slotCount)) {
    throw new Error('Terrain program is invalid.');
  }
  if (typeof runtime?.fbm2D !== 'function' || typeof runtime?.valueNoise2D !== 'function') {
    throw new Error('Terrain program runtime must provide fbm2D and valueNoise2D.');
  }
  const instructions = program.instructions.map(prepareInstruction);
  const scalar = new Float64Array(program.slotCount);
  const coordinateX = new Float64Array(program.slotCount);
  const coordinateZ = new Float64Array(program.slotCount);

  return (worldX, worldZ) => {
    for (const instruction of instructions) {
      const { op, slot, inputs, properties: p } = instruction;
      switch (op) {
        case 'worldCoordinates': {
          const scale = number(p.scale, 1);
          coordinateX[slot] = worldX * scale + number(p.offsetX, 0);
          coordinateZ[slot] = worldZ * scale + number(p.offsetZ, 0);
          break;
        }
        case 'constant':
          scalar[slot] = number(p.value, 0);
          break;
        case 'domainWarp': {
          const source = inputs.coordinate;
          const x = coordinateX[source];
          const z = coordinateZ[source];
          const frequency = number(p.frequency, 0.000777);
          const strength = number(p.strength, 92);
          coordinateX[slot] = x + runtime.fbm2D(x * frequency, z * frequency, instruction.warpXOptions) * strength;
          coordinateZ[slot] = z + runtime.fbm2D(x * frequency, z * frequency, instruction.warpZOptions) * strength;
          break;
        }
        case 'fbm':
        case 'continental': {
          const source = inputs.coordinate;
          const frequency = number(p.frequency, 0.001);
          const noise = runtime.fbm2D(
            coordinateX[source] * frequency,
            coordinateZ[source] * frequency,
            instruction.noiseOptions,
          );
          scalar[slot] = noise * number(p.gain, 1) + number(p.bias, 0);
          break;
        }
        case 'ridged': {
          const source = inputs.coordinate;
          const frequency = number(p.frequency, 0.001);
          const noise = runtime.fbm2D(
            coordinateX[source] * frequency,
            coordinateZ[source] * frequency,
            instruction.noiseOptions,
          );
          const ridge = 1 - Math.abs(noise);
          scalar[slot] = ridge * ridge * number(p.gain, 1) + number(p.bias, 0);
          break;
        }
        case 'add':
          scalar[slot] = scalar[inputs.a] + scalar[inputs.b];
          break;
        case 'multiply':
          scalar[slot] = scalar[inputs.a] * scalar[inputs.b];
          break;
        case 'blend': {
          const factor = clamp(scalar[inputs.factor], 0, 1);
          scalar[slot] = scalar[inputs.a] + (scalar[inputs.b] - scalar[inputs.a]) * factor;
          break;
        }
        case 'terrace': {
          const value = scalar[inputs.field];
          const steps = Math.max(1, Math.round(number(p.steps, 11)));
          const strength = clamp(number(p.strength, 0), 0, 1);
          const terraced = Math.round(value * steps) / steps;
          scalar[slot] = value + (terraced - value) * strength;
          break;
        }
        case 'remap': {
          const inputMin = number(p.inputMin, -1);
          const inputMax = number(p.inputMax, 1);
          let t = (scalar[inputs.field] - inputMin) / Math.max(inputMax - inputMin, 0.000001);
          if (p.clamp) t = clamp(t, 0, 1);
          scalar[slot] = number(p.outputMin, 0) + (number(p.outputMax, 1) - number(p.outputMin, 0)) * t;
          break;
        }
        case 'clamp':
          scalar[slot] = clamp(scalar[inputs.field], number(p.min, -1), number(p.max, 1));
          break;
        case 'islandCoast': {
          const coordinateSlot = inputs.coordinate;
          const x = coordinateX[coordinateSlot];
          const z = coordinateZ[coordinateSlot];
          const seed = number(p.seed, 1337);
          const worldRadius = number(p.worldRadius, 4000);
          const waterLevel = number(p.waterLevel, -3);
          const landRadius = Math.min(number(p.landRadius, worldRadius * 0.76), worldRadius * 0.88);
          const coastWidth = Math.max(120, number(p.coastWidth, worldRadius * 0.18));
          const irregularity = clamp(number(p.coastIrregularity, 0.18), 0, 0.42);
          const oceanDepth = Math.max(8, number(p.oceanDepth, 52));
          const rawHeight = number(p.baseHeight, 8) + scalar[inputs.field] * number(p.amplitude, 82);
          const axisNoise = runtime.valueNoise2D(x * 0.00019, z * 0.00019, seed + 9107);
          const coastNoise = runtime.fbm2D(x * 0.00043, z * 0.00043, instruction.coastOptions);
          const angle = Math.atan2(z, x);
          const directionalShape = Math.sin(angle * 2 + seed * 0.013) * 0.055
            + Math.sin(angle * 5 - seed * 0.007) * 0.025;
          const effectiveRadius = landRadius * (1 + coastNoise * irregularity + axisNoise * 0.035 + directionalShape);
          const distance = Math.hypot(x, z);
          const coastStart = effectiveRadius - coastWidth * 0.58;
          const coastEnd = effectiveRadius + coastWidth * 0.42;
          const landBlend = 1 - smoothRange(coastStart, coastEnd, distance);
          const seaVariation = runtime.fbm2D(x * 0.0007, z * 0.0007, instruction.seaFloorOptions);
          const deepOceanFactor = smoothRange(effectiveRadius, worldRadius * 1.5, distance);
          const seaFloor = waterLevel - oceanDepth - deepOceanFactor * 140 + seaVariation * 7.5;
          scalar[slot] = seaFloor + (rawHeight - seaFloor) * landBlend;
          break;
        }
        case 'terrainOutput':
          scalar[slot] = scalar[inputs.terrain];
          break;
        default:
          throw new Error(`Unsupported terrain program operation: ${op}`);
      }
    }
    return scalar[program.outputSlot];
  };
}
