export const TERRAIN_GRAPH_VERSION = 1;

const fieldInput = (name, label, required = true) => ({ name, label, type: 'field', required });
const coordinateInput = (name = 'coordinate', label = 'Coordinates') => ({ name, label, type: 'coordinate', required: true });
const output = (name, label, type) => ({ name, label, type });

export const TERRAIN_NODE_DEFINITIONS = Object.freeze({
  'world/coordinates': {
    title: 'World Coordinates',
    category: 'Sources',
    inputs: [],
    outputs: [output('coordinate', 'Coordinates', 'coordinate')],
    defaults: { scale: 1, offsetX: 0, offsetZ: 0 },
  },
  'input/constant': {
    title: 'Constant',
    category: 'Sources',
    inputs: [],
    outputs: [output('field', 'Value', 'field')],
    defaults: { value: 1 },
  },
  'noise/fbm': {
    title: 'FBM Noise',
    category: 'Noise',
    inputs: [coordinateInput()],
    outputs: [output('field', 'Field', 'field')],
    defaults: { seed: 1337, frequency: 0.00185, octaves: 6, persistence: 0.51, lacunarity: 2.04, gain: 1, bias: 0 },
  },
  'noise/ridged': {
    title: 'Ridged Noise',
    category: 'Noise',
    inputs: [coordinateInput()],
    outputs: [output('field', 'Field', 'field')],
    defaults: { seed: 2328, frequency: 0.001295, octaves: 6, persistence: 0.51, lacunarity: 2.04, gain: 0.52, bias: -0.26 },
  },
  'noise/continental': {
    title: 'Continental Noise',
    category: 'Noise',
    inputs: [coordinateInput()],
    outputs: [output('field', 'Field', 'field')],
    defaults: { seed: 6388, frequency: 0.00034, octaves: 4, persistence: 0.54, lacunarity: 2, gain: 0.78, bias: 0 },
  },
  'transform/domainWarp': {
    title: 'Domain Warp',
    category: 'Transform',
    inputs: [coordinateInput()],
    outputs: [output('coordinate', 'Warped', 'coordinate')],
    defaults: { seed: 1337, frequency: 0.000777, strength: 92, octaves: 3, persistence: 0.55, lacunarity: 2 },
  },
  'transform/terrace': {
    title: 'Terrace',
    category: 'Transform',
    inputs: [fieldInput('field', 'Field')],
    outputs: [output('field', 'Field', 'field')],
    defaults: { steps: 11, strength: 0 },
  },
  'transform/remap': {
    title: 'Remap',
    category: 'Transform',
    inputs: [fieldInput('field', 'Field')],
    outputs: [output('field', 'Field', 'field')],
    defaults: { inputMin: -1, inputMax: 1, outputMin: 0, outputMax: 1, clamp: false },
  },
  'transform/clamp': {
    title: 'Clamp',
    category: 'Transform',
    inputs: [fieldInput('field', 'Field')],
    outputs: [output('field', 'Field', 'field')],
    defaults: { min: -1, max: 1 },
  },
  'combine/add': {
    title: 'Add',
    category: 'Combine',
    inputs: [fieldInput('a', 'A'), fieldInput('b', 'B')],
    outputs: [output('field', 'Result', 'field')],
    defaults: {},
  },
  'combine/multiply': {
    title: 'Multiply',
    category: 'Combine',
    inputs: [fieldInput('a', 'A'), fieldInput('b', 'B')],
    outputs: [output('field', 'Result', 'field')],
    defaults: {},
  },
  'combine/blend': {
    title: 'Blend',
    category: 'Combine',
    inputs: [fieldInput('a', 'A'), fieldInput('b', 'B'), fieldInput('factor', 'Factor')],
    outputs: [output('field', 'Result', 'field')],
    defaults: {},
  },
  'shape/islandCoast': {
    title: 'Island / Coast',
    category: 'Shape',
    inputs: [fieldInput('field', 'Height Field'), coordinateInput()],
    outputs: [output('terrain', 'Terrain', 'terrain')],
    defaults: {
      seed: 1337,
      baseHeight: 8,
      amplitude: 82,
      worldRadius: 4000,
      waterLevel: -3,
      landRadius: 3040,
      coastWidth: 720,
      coastIrregularity: 0.18,
      oceanDepth: 52,
    },
  },
  'terrain/output': {
    title: 'Terrain Output',
    category: 'Output',
    inputs: [{ name: 'terrain', label: 'Terrain', type: 'terrain', required: true }],
    outputs: [],
    defaults: {},
  },
});

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function cloneTerrainGraph(graph) {
  return clone(graph);
}

function createNode(id, type, position, properties = {}, role = null) {
  const definition = TERRAIN_NODE_DEFINITIONS[type];
  if (!definition) throw new Error(`Unknown terrain node type: ${type}`);
  return {
    id,
    type,
    role,
    position: [Number(position?.[0] ?? 0), Number(position?.[1] ?? 0)],
    properties: { ...clone(definition.defaults), ...clone(properties) },
  };
}

function appendNode(graph, type, position, properties = {}, role = null) {
  const node = createNode(graph.nextNodeId, type, position, properties, role);
  graph.nextNodeId += 1;
  graph.nodes.push(node);
  return node;
}

function appendLink(graph, fromNode, fromSocket, toNode, toSocket) {
  graph.links.push({
    id: graph.nextLinkId,
    fromNode,
    fromSocket,
    toNode,
    toSocket,
  });
  graph.nextLinkId += 1;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildDefaultProperties(settings = {}) {
  const seed = finite(settings.seed, 1337);
  const frequency = finite(settings.frequency, 0.00185);
  const amplitude = finite(settings.amplitude, 82);
  const ridgeStrength = finite(settings.ridgeStrength, 0.52);
  const worldRadius = finite(settings.worldRadius, 4000);
  return {
    seed,
    frequency,
    amplitude,
    ridgeStrength,
    persistence: finite(settings.persistence, 0.51),
    lacunarity: finite(settings.lacunarity, 2.04),
    octaves: Math.max(1, Math.round(finite(settings.octaves, 6))),
    warpStrength: finite(settings.warpStrength, 92),
    continentalScale: finite(settings.continentalScale, 0.00034),
    continentalStrength: finite(settings.continentalStrength, 64),
    terraceStrength: finite(settings.terraceStrength, 0),
    baseHeight: finite(settings.baseHeight, 8),
    worldRadius,
    waterLevel: finite(settings.waterLevel, -3),
    landRadius: finite(settings.landRadius, worldRadius * 0.76),
    coastWidth: finite(settings.coastWidth, worldRadius * 0.18),
    coastIrregularity: finite(settings.coastIrregularity, 0.18),
    oceanDepth: finite(settings.oceanDepth, 52),
  };
}

export function createDefaultTerrainGraph(settings = {}) {
  const values = buildDefaultProperties(settings);
  const graph = {
    version: TERRAIN_GRAPH_VERSION,
    nextNodeId: 1,
    nextLinkId: 1,
    nodes: [],
    links: [],
    view: { scale: 0.82, offset: [30, 40] },
  };

  const coordinates = appendNode(graph, 'world/coordinates', [40, 230], {}, 'coordinates');
  const warp = appendNode(graph, 'transform/domainWarp', [260, 210], {
    seed: values.seed,
    frequency: values.frequency * 0.42,
    strength: values.warpStrength,
  }, 'warp');
  const broad = appendNode(graph, 'noise/fbm', [500, 40], {
    seed: values.seed,
    frequency: values.frequency,
    octaves: values.octaves,
    persistence: values.persistence,
    lacunarity: values.lacunarity,
    gain: 0.69,
  }, 'broad');
  const detail = appendNode(graph, 'noise/fbm', [500, 190], {
    seed: values.seed + 211,
    frequency: values.frequency * 3.35,
    octaves: Math.max(2, values.octaves - 2),
    persistence: values.persistence,
    lacunarity: values.lacunarity,
    gain: 0.17,
  }, 'detail');
  const ridges = appendNode(graph, 'noise/ridged', [500, 340], {
    seed: values.seed + 991,
    frequency: values.frequency * 0.7,
    octaves: values.octaves,
    persistence: values.persistence,
    lacunarity: values.lacunarity,
    gain: values.ridgeStrength,
    bias: -0.5 * values.ridgeStrength,
  }, 'ridges');
  const continental = appendNode(graph, 'noise/continental', [500, 500], {
    seed: values.seed + 5051,
    frequency: values.continentalScale,
    gain: values.continentalStrength / Math.max(values.amplitude, 1),
  }, 'continental');
  const addBase = appendNode(graph, 'combine/add', [760, 125], {}, 'addBase');
  const addRelief = appendNode(graph, 'combine/add', [760, 410], {}, 'addRelief');
  const addAll = appendNode(graph, 'combine/add', [980, 250], {}, 'addAll');
  const terrace = appendNode(graph, 'transform/terrace', [1190, 250], {
    steps: 11,
    strength: values.terraceStrength,
  }, 'terrace');
  const island = appendNode(graph, 'shape/islandCoast', [1410, 230], {
    seed: values.seed,
    baseHeight: values.baseHeight,
    amplitude: values.amplitude,
    worldRadius: values.worldRadius,
    waterLevel: values.waterLevel,
    landRadius: values.landRadius,
    coastWidth: values.coastWidth,
    coastIrregularity: values.coastIrregularity,
    oceanDepth: values.oceanDepth,
  }, 'island');
  const terrainOutput = appendNode(graph, 'terrain/output', [1660, 250], {}, 'output');

  appendLink(graph, coordinates.id, 'coordinate', warp.id, 'coordinate');
  appendLink(graph, warp.id, 'coordinate', broad.id, 'coordinate');
  appendLink(graph, warp.id, 'coordinate', detail.id, 'coordinate');
  appendLink(graph, warp.id, 'coordinate', ridges.id, 'coordinate');
  appendLink(graph, coordinates.id, 'coordinate', continental.id, 'coordinate');
  appendLink(graph, broad.id, 'field', addBase.id, 'a');
  appendLink(graph, detail.id, 'field', addBase.id, 'b');
  appendLink(graph, ridges.id, 'field', addRelief.id, 'a');
  appendLink(graph, continental.id, 'field', addRelief.id, 'b');
  appendLink(graph, addBase.id, 'field', addAll.id, 'a');
  appendLink(graph, addRelief.id, 'field', addAll.id, 'b');
  appendLink(graph, addAll.id, 'field', terrace.id, 'field');
  appendLink(graph, terrace.id, 'field', island.id, 'field');
  appendLink(graph, coordinates.id, 'coordinate', island.id, 'coordinate');
  appendLink(graph, island.id, 'terrain', terrainOutput.id, 'terrain');
  return graph;
}

export function addTerrainGraphNode(graph, type, position, properties = {}) {
  const next = cloneTerrainGraph(graph);
  const node = appendNode(next, type, position, properties);
  return { graph: next, node: clone(node) };
}

export function removeTerrainGraphNode(graph, nodeId) {
  const next = cloneTerrainGraph(graph);
  next.nodes = next.nodes.filter((node) => node.id !== nodeId);
  next.links = next.links.filter((link) => link.fromNode !== nodeId && link.toNode !== nodeId);
  return next;
}

function findSocket(definition, direction, name) {
  return definition?.[direction]?.find((socket) => socket.name === name) ?? null;
}

function graphHasCycle(graph) {
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  const incomingCount = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const link of graph.links) {
    outgoing.get(link.fromNode)?.push(link.toNode);
    incomingCount.set(link.toNode, (incomingCount.get(link.toNode) ?? 0) + 1);
  }
  const queue = [...incomingCount.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const count = incomingCount.get(target) - 1;
      incomingCount.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  return visited !== graph.nodes.length;
}

export function connectTerrainGraphNodes(graph, connection) {
  const next = cloneTerrainGraph(graph);
  const from = next.nodes.find((node) => node.id === connection.fromNode);
  const to = next.nodes.find((node) => node.id === connection.toNode);
  if (!from || !to) throw new Error('Cannot connect missing terrain graph nodes.');
  const fromSocket = findSocket(TERRAIN_NODE_DEFINITIONS[from.type], 'outputs', connection.fromSocket);
  const toSocket = findSocket(TERRAIN_NODE_DEFINITIONS[to.type], 'inputs', connection.toSocket);
  if (!fromSocket || !toSocket) throw new Error('Cannot connect unknown terrain graph sockets.');
  if (fromSocket.type !== toSocket.type) {
    throw new Error(`Terrain graph socket types do not match: ${fromSocket.type} to ${toSocket.type}.`);
  }
  if (next.links.some((link) => link.toNode === to.id && link.toSocket === toSocket.name)) {
    throw new Error(`Input ${toSocket.name} is already connected.`);
  }
  appendLink(next, from.id, fromSocket.name, to.id, toSocket.name);
  if (graphHasCycle(next)) throw new Error('Terrain graph connections cannot create a cycle.');
  return { graph: next, link: clone(next.links.at(-1)) };
}

export function disconnectTerrainGraphLink(graph, linkId) {
  const next = cloneTerrainGraph(graph);
  next.links = next.links.filter((link) => link.id !== linkId);
  return next;
}

export function validateTerrainGraph(graph) {
  const errors = [];
  if (!graph || graph.version !== TERRAIN_GRAPH_VERSION || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    return { valid: false, errors: ['Terrain graph format is invalid.'] };
  }
  const ids = new Set();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate terrain node id ${node.id}.`);
    ids.add(node.id);
    if (!TERRAIN_NODE_DEFINITIONS[node.type]) errors.push(`Unknown terrain node type ${node.type}.`);
  }
  const outputs = graph.nodes.filter((node) => node.type === 'terrain/output');
  if (outputs.length !== 1) errors.push('Terrain graph must contain exactly one Terrain Output node.');

  const occupiedInputs = new Set();
  for (const link of graph.links) {
    const from = graph.nodes.find((node) => node.id === link.fromNode);
    const to = graph.nodes.find((node) => node.id === link.toNode);
    const fromSocket = findSocket(TERRAIN_NODE_DEFINITIONS[from?.type], 'outputs', link.fromSocket);
    const toSocket = findSocket(TERRAIN_NODE_DEFINITIONS[to?.type], 'inputs', link.toSocket);
    if (!from || !to || !fromSocket || !toSocket) {
      errors.push(`Terrain link ${link.id} references a missing node or socket.`);
      continue;
    }
    if (fromSocket.type !== toSocket.type) errors.push(`Terrain link ${link.id} has incompatible socket types.`);
    const inputKey = `${to.id}:${toSocket.name}`;
    if (occupiedInputs.has(inputKey)) errors.push(`Terrain input ${inputKey} has more than one connection.`);
    occupiedInputs.add(inputKey);
  }
  if (graphHasCycle(graph)) errors.push('Terrain graph contains a cycle.');

  const requiredNodeIds = new Set(outputs.map((node) => node.id));
  const sourceNodesByTarget = new Map();
  for (const link of graph.links) {
    if (!sourceNodesByTarget.has(link.toNode)) sourceNodesByTarget.set(link.toNode, []);
    sourceNodesByTarget.get(link.toNode).push(link.fromNode);
  }
  const pendingRequired = [...requiredNodeIds];
  while (pendingRequired.length) {
    const nodeId = pendingRequired.pop();
    for (const sourceId of sourceNodesByTarget.get(nodeId) ?? []) {
      if (requiredNodeIds.has(sourceId)) continue;
      requiredNodeIds.add(sourceId);
      pendingRequired.push(sourceId);
    }
  }
  for (const node of graph.nodes) {
    if (!requiredNodeIds.has(node.id)) continue;
    const definition = TERRAIN_NODE_DEFINITIONS[node.type];
    for (const input of definition?.inputs ?? []) {
      if (input.required && !occupiedInputs.has(`${node.id}:${input.name}`)) {
        errors.push(`${definition.title} is missing its ${input.label} input.`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function updateRole(next, role, properties) {
  const node = next.nodes.find((candidate) => candidate.role === role);
  if (node) node.properties = { ...node.properties, ...properties };
}

export function syncSettingsToTerrainGraph(graph, settings = {}) {
  const next = cloneTerrainGraph(graph);
  const current = deriveSettingsFromTerrainGraph(next, settings);
  const values = buildDefaultProperties({ ...current, ...settings });
  updateRole(next, 'warp', {
    seed: values.seed,
    frequency: values.frequency * 0.42,
    strength: values.warpStrength,
  });
  updateRole(next, 'broad', {
    seed: values.seed,
    frequency: values.frequency,
    octaves: values.octaves,
    persistence: values.persistence,
    lacunarity: values.lacunarity,
  });
  updateRole(next, 'detail', {
    seed: values.seed + 211,
    frequency: values.frequency * 3.35,
    octaves: Math.max(2, values.octaves - 2),
    persistence: values.persistence,
    lacunarity: values.lacunarity,
  });
  updateRole(next, 'ridges', {
    seed: values.seed + 991,
    frequency: values.frequency * 0.7,
    octaves: values.octaves,
    persistence: values.persistence,
    lacunarity: values.lacunarity,
    gain: values.ridgeStrength,
    bias: -0.5 * values.ridgeStrength,
  });
  updateRole(next, 'continental', {
    seed: values.seed + 5051,
    frequency: values.continentalScale,
    gain: values.continentalStrength / Math.max(values.amplitude, 1),
  });
  updateRole(next, 'terrace', { strength: values.terraceStrength });
  updateRole(next, 'island', {
    seed: values.seed,
    baseHeight: values.baseHeight,
    amplitude: values.amplitude,
    worldRadius: values.worldRadius,
    waterLevel: values.waterLevel,
    landRadius: values.landRadius,
    coastWidth: values.coastWidth,
    coastIrregularity: values.coastIrregularity,
    oceanDepth: values.oceanDepth,
  });
  return next;
}

export function deriveSettingsFromTerrainGraph(graph, fallbackSettings = {}) {
  const { terrainProgram: _staleTerrainProgram, ...result } = fallbackSettings ?? {};
  const node = (role) => graph?.nodes?.find((candidate) => candidate.role === role)?.properties ?? {};
  const broad = node('broad');
  const warp = node('warp');
  const ridges = node('ridges');
  const continental = node('continental');
  const terrace = node('terrace');
  const island = node('island');
  const amplitude = finite(island.amplitude, finite(result.amplitude, 82));

  return {
    ...result,
    seed: finite(broad.seed, finite(island.seed, finite(result.seed, 1337))),
    frequency: finite(broad.frequency, finite(result.frequency, 0.00185)),
    octaves: Math.max(1, Math.round(finite(broad.octaves, finite(result.octaves, 6)))),
    persistence: finite(broad.persistence, finite(result.persistence, 0.51)),
    lacunarity: finite(broad.lacunarity, finite(result.lacunarity, 2.04)),
    amplitude,
    ridgeStrength: finite(ridges.gain, finite(result.ridgeStrength, 0.52)),
    continentalScale: finite(continental.frequency, finite(result.continentalScale, 0.00034)),
    continentalStrength: finite(continental.gain, 0.78) * Math.max(amplitude, 1),
    terraceStrength: finite(terrace.strength, finite(result.terraceStrength, 0)),
    warpStrength: finite(warp.strength, finite(result.warpStrength, 92)),
    baseHeight: finite(island.baseHeight, finite(result.baseHeight, 8)),
    worldRadius: finite(island.worldRadius, finite(result.worldRadius, 4000)),
    waterLevel: finite(island.waterLevel, finite(result.waterLevel, -3)),
    landRadius: finite(island.landRadius, finite(result.landRadius, 3040)),
    coastWidth: finite(island.coastWidth, finite(result.coastWidth, 720)),
    coastIrregularity: finite(island.coastIrregularity, finite(result.coastIrregularity, 0.18)),
    oceanDepth: finite(island.oceanDepth, finite(result.oceanDepth, 52)),
  };
}
