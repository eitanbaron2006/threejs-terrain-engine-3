export const TERRAIN_GRAPH_VERSION = 2;

const fieldInput = (name, label, required = true) => ({ name, label, type: 'field', required });
const coordinateInput = (name = 'coordinate', label = 'Coordinates') => ({ name, label, type: 'coordinate', required: true });
const materialInput = (name = 'material', label = 'Material') => ({ name, label, type: 'material', required: true });
const maskInput = (name = 'mask', label = 'Mask') => ({ name, label, type: 'mask', required: true });
const terrainInput = (name = 'terrain', label = 'Terrain') => ({ name, label, type: 'terrain', required: true });
const output = (name, label, type) => ({ name, label, type });

const numberProperty = (label, defaultValue, min, max, step) => ({
  label,
  default: defaultValue,
  widget: 'number',
  min,
  max,
  step,
});

const comboProperty = (label, defaultValue, options) => ({
  label,
  default: defaultValue,
  widget: 'combo',
  ...(Array.isArray(options) ? { options } : { optionsSource: options }),
});

const toggleProperty = (label, defaultValue = false) => ({
  label,
  default: defaultValue,
  widget: 'toggle',
});

function defaultsFromProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).map(([name, descriptor]) => [name, descriptor.default]),
  );
}

function materialNodeDefinition(definition, properties = {}) {
  return {
    ...definition,
    properties,
    defaults: defaultsFromProperties(properties),
  };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (
    value === null
    || (typeof value !== 'object' && typeof value !== 'function')
    || seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const nested of Reflect.ownKeys(value)) deepFreeze(value[nested], seen);
  return Object.freeze(value);
}

const MATERIAL_LAYERS = Object.freeze(['sand', 'grass', 'soil', 'rock']);
const HEIGHT_MIN = -1000;
const HEIGHT_MAX = 2000;

const MATERIAL_PACK_PROPERTIES = {
  packId: comboProperty('Material Pack', 'mediterranean', 'materialPacks'),
  globalBlend: numberProperty('Global Blend', 1, 0.1, 3, 0.05),
  transitionNoise: numberProperty('Transition Noise', 0.2, 0, 1, 0.01),
};

const LAYER_DISTRIBUTION_PROPERTIES = {
  layer: comboProperty('Layer', 'sand', MATERIAL_LAYERS),
  minHeight: numberProperty('Minimum Height', -48, HEIGHT_MIN, HEIGHT_MAX, 1),
  maxHeight: numberProperty('Maximum Height', 220, HEIGHT_MIN, HEIGHT_MAX, 1),
  heightBlend: numberProperty('Height Blend', 18, 0, 500, 1),
  minSlope: numberProperty('Minimum Slope', 0, 0, 90, 0.5),
  maxSlope: numberProperty('Maximum Slope', 72, 0, 90, 0.5),
  slopeBlend: numberProperty('Slope Blend', 12, 0, 90, 0.5),
  moistureAffinity: numberProperty('Moisture Affinity', 0, -1, 1, 0.01),
  coastAffinity: numberProperty('Coast Affinity', 0, -1, 1, 0.01),
  erosionAffinity: numberProperty('Erosion Affinity', 0, -1, 1, 0.01),
  curvatureBias: numberProperty('Curvature Bias', 0, -1, 1, 0.01),
  priority: numberProperty('Priority', 1, 0.01, 4, 0.01),
};

const HEIGHT_SLOPE_MASK_PROPERTIES = {
  minHeight: numberProperty('Minimum Height', -48, HEIGHT_MIN, HEIGHT_MAX, 1),
  maxHeight: numberProperty('Maximum Height', 220, HEIGHT_MIN, HEIGHT_MAX, 1),
  heightBlend: numberProperty('Height Blend', 18, 0, 500, 1),
  minSlope: numberProperty('Minimum Slope', 0, 0, 90, 0.5),
  maxSlope: numberProperty('Maximum Slope', 72, 0, 90, 0.5),
  slopeBlend: numberProperty('Slope Blend', 12, 0, 90, 0.5),
  invert: toggleProperty('Invert'),
};

const MOISTURE_EROSION_MASK_PROPERTIES = {
  minMoisture: numberProperty('Minimum Moisture', 0, 0, 1, 0.01),
  maxMoisture: numberProperty('Maximum Moisture', 1, 0, 1, 0.01),
  moistureBlend: numberProperty('Moisture Blend', 0.1, 0, 1, 0.01),
  minErosion: numberProperty('Minimum Erosion', 0, 0, 1, 0.01),
  maxErosion: numberProperty('Maximum Erosion', 1, 0, 1, 0.01),
  erosionBlend: numberProperty('Erosion Blend', 0.1, 0, 1, 0.01),
  invert: toggleProperty('Invert'),
};

const BIOME_BLEND_PROPERTIES = {
  fromLayer: comboProperty('From Layer', 'sand', MATERIAL_LAYERS),
  toLayer: comboProperty('To Layer', 'grass', MATERIAL_LAYERS),
  strength: numberProperty('Strength', 1, 0, 1, 0.01),
};

const AQUATIC_ECOSYSTEM_PROPERTIES = {
  enabled: toggleProperty('Show Ecosystem', true),
  quality: comboProperty('Habitat Quality', 'high', ['low', 'medium', 'high']),
  habitatDensity: numberProperty('Habitat Density', 1, 0.25, 2, 0.05),
  floatingSpheresEnabled: toggleProperty('Show Floating Spheres', true),
  floatingSphereCount: numberProperty('Floating Spheres', 12, 0, 24, 1),
  floatingSphereRadius: numberProperty('Sphere Radius', 3.2, 0.8, 8, 0.1),
  waterObjectDensity: numberProperty('Sphere Density', 0.58, 0.2, 1.4, 0.01),
  fishEnabled: toggleProperty('Show Fish', true),
  fishCount: numberProperty('Fish Amount', 30, 0, 48, 1),
  fishSchoolDensity: numberProperty('School Density', 1, 0.1, 2, 0.05),
  plantsEnabled: toggleProperty('Show Plants', true),
  seagrassCount: numberProperty('Plant Amount', 120, 0, 180, 5),
  coralsEnabled: toggleProperty('Show Corals', true),
  coralCount: numberProperty('Coral Amount', 18, 0, 24, 1),
  spongesEnabled: toggleProperty('Show Sponges', true),
  spongeCount: numberProperty('Sponge Amount', 12, 0, 24, 1),
  rocksEnabled: toggleProperty('Show Seabed Rocks', true),
  underwaterRockCount: numberProperty('Seabed Rock Amount', 24, 0, 48, 1),
  vegetationDensity: numberProperty('Seabed Model Density', 1, 0.1, 2, 0.05),
};

export const TERRAIN_NODE_DEFINITIONS = deepFreeze({
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
  'material/pack': materialNodeDefinition({
    title: 'Material Pack',
    category: 'Materials',
    inputs: [],
    outputs: [output('material', 'Material', 'material')],
  }, MATERIAL_PACK_PROPERTIES),
  'material/layerDistribution': materialNodeDefinition({
    title: 'Layer Distribution',
    category: 'Materials',
    inputs: [materialInput()],
    outputs: [output('material', 'Material', 'material')],
  }, LAYER_DISTRIBUTION_PROPERTIES),
  'mask/heightSlope': materialNodeDefinition({
    title: 'Height / Slope Mask',
    category: 'Masks',
    inputs: [],
    outputs: [output('mask', 'Mask', 'mask')],
  }, HEIGHT_SLOPE_MASK_PROPERTIES),
  'mask/moistureErosion': materialNodeDefinition({
    title: 'Moisture / Erosion Mask',
    category: 'Masks',
    inputs: [],
    outputs: [output('mask', 'Mask', 'mask')],
  }, MOISTURE_EROSION_MASK_PROPERTIES),
  'material/biomeBlend': materialNodeDefinition({
    title: 'Biome Blend',
    category: 'Materials',
    inputs: [materialInput(), maskInput()],
    outputs: [output('material', 'Material', 'material')],
  }, BIOME_BLEND_PROPERTIES),
  'water/aquaticEcosystem': materialNodeDefinition({
    title: 'Aquatic Ecosystem',
    category: 'Water',
    inputs: [],
    outputs: [],
  }, AQUATIC_ECOSYSTEM_PROPERTIES),
  'terrain/output': {
    title: 'Terrain Output',
    category: 'Output',
    inputs: [terrainInput()],
    outputs: [],
    defaults: {},
  },
  'terrain/materialOutput': materialNodeDefinition({
    title: 'Material Output',
    category: 'Output',
    inputs: [terrainInput(), materialInput()],
    outputs: [],
  }),
});

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function cloneTerrainGraph(graph) {
  return clone(graph);
}

export function normalizeTerrainGraph(input, fallbackSettings = {}) {
  if (input == null) return createDefaultTerrainGraph(fallbackSettings);
  if (
    typeof input !== 'object'
    || Array.isArray(input)
    || !Array.isArray(input.nodes)
    || !Array.isArray(input.links)
  ) {
    throw new Error('Terrain graph format is invalid.');
  }

  const sourceVersion = Number(input.version ?? 1);
  if (sourceVersion !== 1 && sourceVersion !== TERRAIN_GRAPH_VERSION) {
    throw new Error(`Unsupported terrain graph version ${String(input.version ?? sourceVersion)}.`);
  }

  const normalized = cloneTerrainGraph(input);
  normalized.version = TERRAIN_GRAPH_VERSION;
  normalized.nextNodeId = nextGraphId(normalized.nodes, 'node');
  normalized.nextLinkId = nextGraphId(normalized.links, 'link');
  normalized.view ??= { scale: 1, offset: [0, 0] };
  return normalized;
}

function isGraphId(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nextGraphId(entries, kind) {
  let maximum = 0;
  for (const entry of entries) {
    if (isGraphId(entry?.id)) maximum = Math.max(maximum, entry.id);
  }
  if (maximum === Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Terrain graph ${kind} id space reached Number.MAX_SAFE_INTEGER and is exhausted.`,
    );
  }
  return maximum + 1;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function assertIncrementableCounter(value, name) {
  if (!isGraphId(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new Error(
      `Terrain graph ${name} must be a non-negative safe integer below Number.MAX_SAFE_INTEGER.`,
    );
  }
}

function appendNode(graph, type, position, properties = {}, role = null) {
  assertIncrementableCounter(graph.nextNodeId, 'nextNodeId');
  const node = createNode(graph.nextNodeId, type, position, properties, role);
  graph.nextNodeId += 1;
  graph.nodes.push(node);
  return node;
}

function appendLink(graph, fromNode, fromSocket, toNode, toSocket) {
  assertIncrementableCounter(graph.nextLinkId, 'nextLinkId');
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

function packIdFromSettings(settings = {}) {
  for (const value of [settings.materialPackId, settings.presetId]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'mediterranean';
}

function aquaticPropertiesFromSettings(settings = {}) {
  const defaults = defaultsFromProperties(AQUATIC_ECOSYSTEM_PROPERTIES);
  return {
    enabled: settings.aquaticLifeEnabled ?? defaults.enabled,
    quality: ['low', 'medium', 'high'].includes(settings.habitatQuality)
      ? settings.habitatQuality
      : defaults.quality,
    habitatDensity: finite(settings.habitatDensity, defaults.habitatDensity),
    floatingSpheresEnabled: settings.floatingSpheresEnabled ?? defaults.floatingSpheresEnabled,
    floatingSphereCount: finite(settings.floatingSphereCount, defaults.floatingSphereCount),
    floatingSphereRadius: finite(settings.floatingSphereRadius, defaults.floatingSphereRadius),
    waterObjectDensity: finite(settings.waterObjectDensity, defaults.waterObjectDensity),
    fishEnabled: settings.fishEnabled ?? defaults.fishEnabled,
    fishCount: finite(settings.fishCount, defaults.fishCount),
    fishSchoolDensity: finite(settings.fishSchoolDensity, defaults.fishSchoolDensity),
    plantsEnabled: settings.plantsEnabled ?? defaults.plantsEnabled,
    seagrassCount: finite(settings.seagrassCount, defaults.seagrassCount),
    coralsEnabled: settings.coralsEnabled ?? defaults.coralsEnabled,
    coralCount: finite(settings.coralCount, defaults.coralCount),
    spongesEnabled: settings.spongesEnabled ?? defaults.spongesEnabled,
    spongeCount: finite(settings.spongeCount, defaults.spongeCount),
    rocksEnabled: settings.rocksEnabled ?? defaults.rocksEnabled,
    underwaterRockCount: finite(settings.underwaterRockCount, defaults.underwaterRockCount),
    vegetationDensity: finite(settings.vegetationDensity, defaults.vegetationDensity),
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
  const materialPack = appendNode(graph, 'material/pack', [1410, 500], {
    packId: packIdFromSettings(settings),
  }, 'materialPack');
  const materialOutput = appendNode(graph, 'terrain/materialOutput', [1660, 250], {}, 'output');
  appendNode(
    graph,
    'water/aquaticEcosystem',
    [1660, 500],
    aquaticPropertiesFromSettings(settings),
    'aquaticEcosystem',
  );

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
  appendLink(graph, island.id, 'terrain', materialOutput.id, 'terrain');
  appendLink(graph, materialPack.id, 'material', materialOutput.id, 'material');
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

function graphHasCycle(nodeIds, links) {
  const outgoing = new Map([...nodeIds].map((id) => [id, []]));
  const incomingCount = new Map([...nodeIds].map((id) => [id, 0]));
  for (const link of links) {
    if (!nodeIds.has(link.fromNode) || !nodeIds.has(link.toNode)) continue;
    outgoing.get(link.fromNode).push(link.toNode);
    incomingCount.set(link.toNode, incomingCount.get(link.toNode) + 1);
  }
  const queue = [...incomingCount.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const id = queue[queueIndex];
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const count = incomingCount.get(target) - 1;
      incomingCount.set(target, count);
      if (count === 0) queue.push(target);
    }
  }
  return visited !== nodeIds.size;
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
  const nodeIds = new Set(next.nodes.map((node) => node.id));
  if (graphHasCycle(nodeIds, next.links)) {
    throw new Error('Terrain graph connections cannot create a cycle.');
  }
  return { graph: next, link: clone(next.links.at(-1)) };
}

export function disconnectTerrainGraphLink(graph, linkId) {
  const next = cloneTerrainGraph(graph);
  next.links = next.links.filter((link) => link.id !== linkId);
  return next;
}

export function validateTerrainGraph(graph) {
  const errors = [];
  if (
    !isRecord(graph)
    || graph.version !== TERRAIN_GRAPH_VERSION
    || !Array.isArray(graph.nodes)
    || !Array.isArray(graph.links)
  ) {
    return { valid: false, errors: ['Terrain graph format is invalid.'] };
  }

  if (
    !isRecord(graph.view)
    || !Number.isFinite(graph.view.scale)
    || graph.view.scale <= 0
    || !Array.isArray(graph.view.offset)
    || graph.view.offset.length < 2
    || !Number.isFinite(graph.view.offset[0])
    || !Number.isFinite(graph.view.offset[1])
  ) {
    errors.push('Terrain graph view must contain a positive finite scale and two finite offset values.');
  }

  const nodeById = new Map();
  const validNodes = [];
  for (let index = 0; index < graph.nodes.length; index += 1) {
    const node = graph.nodes[index];
    if (!isRecord(node)) {
      errors.push(`Terrain node at index ${index} must be an object.`);
      continue;
    }
    if (!isGraphId(node.id)) {
      errors.push(
        `Terrain node id at index ${index} must be a non-negative integer accepted by Number.isSafeInteger.`,
      );
    } else if (nodeById.has(node.id)) {
      errors.push(`Duplicate terrain node id ${node.id}.`);
    } else {
      nodeById.set(node.id, node);
    }
    if (typeof node.type !== 'string' || !TERRAIN_NODE_DEFINITIONS[node.type]) {
      errors.push(`Unknown terrain node type ${String(node.type)}.`);
    }
    if (
      !Array.isArray(node.position)
      || node.position.length < 2
      || !Number.isFinite(node.position[0])
      || !Number.isFinite(node.position[1])
    ) {
      errors.push(`Terrain node ${String(node.id ?? `at index ${index}`)} position must contain two finite numbers.`);
    }
    if (!isRecord(node.properties)) {
      errors.push(`Terrain node ${String(node.id ?? `at index ${index}`)} properties must be an object.`);
    }
    if (isGraphId(node.id) && TERRAIN_NODE_DEFINITIONS[node.type]) validNodes.push(node);
  }

  const maximumNodeId = validNodes.reduce((maximum, node) => Math.max(maximum, node.id), 0);
  if (!isGraphId(graph.nextNodeId) || graph.nextNodeId <= maximumNodeId) {
    errors.push('Terrain graph nextNodeId must be an integer greater than every node id.');
  }

  const outputs = validNodes.filter((node) => (
    node.type === 'terrain/output' || node.type === 'terrain/materialOutput'
  ));
  if (outputs.length !== 1) {
    errors.push('Terrain graph must contain exactly one effective terminal: Terrain Output or Material Output.');
  }

  const occupiedInputs = new Set();
  const linkIds = new Set();
  const cycleLinks = [];
  const validTypedLinks = [];
  let maximumLinkId = 0;
  for (let index = 0; index < graph.links.length; index += 1) {
    const link = graph.links[index];
    if (!isRecord(link)) {
      errors.push(`Terrain link at index ${index} must be an object.`);
      continue;
    }
    if (!isGraphId(link.id)) {
      errors.push(
        `Terrain link id at index ${index} must be a non-negative integer accepted by Number.isSafeInteger.`,
      );
    } else {
      maximumLinkId = Math.max(maximumLinkId, link.id);
      if (linkIds.has(link.id)) errors.push(`Duplicate terrain link id ${link.id}.`);
      linkIds.add(link.id);
    }
    if (!isGraphId(link.fromNode)) {
      errors.push(
        `Terrain link ${String(link.id ?? `at index ${index}`)} fromNode must be a non-negative integer accepted by Number.isSafeInteger.`,
      );
    }
    if (!isGraphId(link.toNode)) {
      errors.push(
        `Terrain link ${String(link.id ?? `at index ${index}`)} toNode must be a non-negative integer accepted by Number.isSafeInteger.`,
      );
    }
    if (typeof link.fromSocket !== 'string' || !link.fromSocket) {
      errors.push(`Terrain link ${String(link.id ?? `at index ${index}`)} fromSocket must be a non-empty string.`);
    }
    if (typeof link.toSocket !== 'string' || !link.toSocket) {
      errors.push(`Terrain link ${String(link.id ?? `at index ${index}`)} toSocket must be a non-empty string.`);
    }

    const from = nodeById.get(link.fromNode);
    const to = nodeById.get(link.toNode);
    const fromSocket = findSocket(TERRAIN_NODE_DEFINITIONS[from?.type], 'outputs', link.fromSocket);
    const toSocket = findSocket(TERRAIN_NODE_DEFINITIONS[to?.type], 'inputs', link.toSocket);
    if (!from || !to || !fromSocket || !toSocket) {
      errors.push(`Terrain link ${String(link.id ?? `at index ${index}`)} references a missing node or socket.`);
      continue;
    }
    cycleLinks.push(link);
    if (fromSocket.type !== toSocket.type) {
      errors.push(`Terrain link ${link.id} has incompatible socket types.`);
      continue;
    }
    const inputKey = `${to.id}:${toSocket.name}`;
    if (occupiedInputs.has(inputKey)) errors.push(`Terrain input ${inputKey} has more than one connection.`);
    occupiedInputs.add(inputKey);
    validTypedLinks.push(link);
  }

  if (!isGraphId(graph.nextLinkId) || graph.nextLinkId <= maximumLinkId) {
    errors.push('Terrain graph nextLinkId must be an integer greater than every link id.');
  }
  if (graphHasCycle(new Set(nodeById.keys()), cycleLinks)) {
    errors.push('Terrain graph contains a cycle.');
  }

  const requiredNodeIds = new Set(outputs.map((node) => node.id));
  const sourceNodesByTarget = new Map();
  for (const link of validTypedLinks) {
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
  for (const node of validNodes) {
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

export function syncAquaticSettingsToTerrainGraph(graph, settings = {}) {
  const next = cloneTerrainGraph(graph);
  let aquatic = next.nodes.find((candidate) => (
    candidate.role === 'aquaticEcosystem' || candidate.type === 'water/aquaticEcosystem'
  ));
  if (!aquatic) {
    aquatic = appendNode(
      next,
      'water/aquaticEcosystem',
      [1660, 500],
      {},
      'aquaticEcosystem',
    );
  }
  aquatic.role = 'aquaticEcosystem';
  const current = deriveAquaticSettingsFromTerrainGraph(next, settings);
  aquatic.properties = aquaticPropertiesFromSettings({ ...current, ...settings });
  return next;
}

export function deriveAquaticSettingsFromTerrainGraph(graph, fallbackSettings = {}) {
  const aquatic = graph?.nodes?.find((candidate) => (
    candidate.role === 'aquaticEcosystem' || candidate.type === 'water/aquaticEcosystem'
  ))?.properties;
  const values = aquatic ?? aquaticPropertiesFromSettings(fallbackSettings);
  return {
    aquaticLifeEnabled: Boolean(values.enabled),
    habitatQuality: ['low', 'medium', 'high'].includes(values.quality) ? values.quality : 'high',
    habitatDensity: finite(values.habitatDensity, 1),
    floatingSpheresEnabled: Boolean(values.floatingSpheresEnabled),
    floatingSphereCount: Math.max(0, Math.round(finite(values.floatingSphereCount, 12))),
    floatingSphereRadius: finite(values.floatingSphereRadius, 3.2),
    waterObjectDensity: finite(values.waterObjectDensity, 0.58),
    fishEnabled: Boolean(values.fishEnabled),
    fishCount: Math.max(0, Math.round(finite(values.fishCount, 30))),
    fishSchoolDensity: finite(values.fishSchoolDensity, 1),
    plantsEnabled: Boolean(values.plantsEnabled),
    seagrassCount: Math.max(0, Math.round(finite(values.seagrassCount, 120))),
    coralsEnabled: Boolean(values.coralsEnabled),
    coralCount: Math.max(0, Math.round(finite(values.coralCount, 18))),
    spongesEnabled: Boolean(values.spongesEnabled),
    spongeCount: Math.max(0, Math.round(finite(values.spongeCount, 12))),
    rocksEnabled: Boolean(values.rocksEnabled),
    underwaterRockCount: Math.max(0, Math.round(finite(values.underwaterRockCount, 24))),
    vegetationDensity: finite(values.vegetationDensity, 1),
  };
}

export function deriveSettingsFromTerrainGraph(graph, fallbackSettings = {}) {
  const {
    terrainProgram: _staleTerrainProgram,
    materialProgram: _staleMaterialProgram,
    ...result
  } = fallbackSettings ?? {};
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
