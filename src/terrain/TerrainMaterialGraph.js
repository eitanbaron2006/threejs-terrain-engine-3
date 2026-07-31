const MATERIAL_PROGRAM_VERSION = 1;
const MATERIAL_LAYERS = Object.freeze(['sand', 'grass', 'soil', 'rock']);
const MATERIAL_SPLAT_PRESETS = new Set([
  'mediterranean',
  'alpine',
  'desert',
  'volcanic',
  'custom',
]);
const TERRAIN_PRODUCING_TYPES = new Set(['shape/islandCoast']);
const EPSILON_WEIGHT = 0.0015;
const EMPTY_CONTEXT = Object.freeze({});
const DEFAULT_BASE_WEIGHTS = Object.freeze([0.25, 0.25, 0.25, 0.25]);
const MATERIAL_EVALUATOR_CACHE = new WeakMap();

const DISTRIBUTION_DEFAULTS = Object.freeze({
  minHeight: -48,
  maxHeight: 220,
  heightBlend: 18,
  minSlope: 0,
  maxSlope: 72,
  slopeBlend: 12,
  curvatureBias: 0,
  moistureAffinity: 0,
  coastAffinity: 0,
  erosionAffinity: 0,
  priority: 1,
});

const HEIGHT_SLOPE_MASK_DEFAULTS = Object.freeze({
  minHeight: -48,
  maxHeight: 220,
  heightBlend: 18,
  minSlope: 0,
  maxSlope: 72,
  slopeBlend: 12,
  invert: false,
});

const MOISTURE_EROSION_MASK_DEFAULTS = Object.freeze({
  minMoisture: 0,
  maxMoisture: 1,
  moistureBlend: 0.1,
  minErosion: 0,
  maxErosion: 1,
  erosionBlend: 0.1,
  invert: false,
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function roundWeight(value) {
  return Math.round(value * 1e12) / 1e12;
}

function evaluateRangeMaskUnchecked(
  numericValue,
  numericMinimum,
  numericMaximum,
  numericBlend,
  invert = false,
) {
  let weight;
  if (numericBlend === 0) {
    weight = numericValue >= numericMinimum && numericValue <= numericMaximum ? 1 : 0;
  } else {
    const enter = smoothstep(
      numericMinimum - numericBlend,
      numericMinimum + numericBlend,
      numericValue,
    );
    const exit = 1 - smoothstep(
      numericMaximum - numericBlend,
      numericMaximum + numericBlend,
      numericValue,
    );
    weight = clamp(enter * exit);
  }
  return invert ? 1 - weight : weight;
}

export function evaluateRangeMask(value, minimum, maximum, blend = 0, invert = false) {
  const numericValue = Number(value);
  const numericMinimum = Number(minimum);
  const numericMaximum = Number(maximum);
  const numericBlend = Number(blend);
  if (![numericValue, numericMinimum, numericMaximum, numericBlend].every(Number.isFinite)) {
    throw new TypeError('Range mask values must be finite numbers.');
  }
  if (numericMinimum > numericMaximum) {
    throw new RangeError('Range mask minimum must not exceed maximum.');
  }
  if (numericBlend < 0) {
    throw new RangeError('Range mask blend must be zero or greater.');
  }
  return evaluateRangeMaskUnchecked(
    numericValue,
    numericMinimum,
    numericMaximum,
    numericBlend,
    invert,
  );
}

function normalizeMaterialWeightsInPlace(target) {
  let maximum = 0;
  for (let index = 0; index < 4; index += 1) {
    const value = Number(target[index]);
    target[index] = Number.isFinite(value) && value > 0 ? value : 0;
    maximum = Math.max(maximum, target[index]);
  }
  if (maximum <= 0) {
    target[0] = 0.25;
    target[1] = 0.25;
    target[2] = 0.25;
    target[3] = 0.25;
    return target;
  }

  const scaledTotal = (
    target[0] / maximum
    + target[1] / maximum
    + target[2] / maximum
    + target[3] / maximum
  );

  for (let index = 0; index < 4; index += 1) {
    target[index] = roundWeight((target[index] / maximum) / scaledTotal);
  }
  if (target[0] + target[1] + target[2] + target[3] === 1) return target;

  const prefix = target[0] + target[1] + target[2];
  if (prefix <= 1) {
    target[3] = 1 - prefix;
  } else {
    target[3] = 0;
    const pair = target[0] + target[1];
    if (pair <= 1) {
      target[2] = 1 - pair;
    } else {
      target[2] = 0;
      target[1] = Math.max(0, 1 - target[0]);
    }
  }
  return target;
}

export function normalizeMaterialWeights(weights) {
  const target = [
    weights?.[0],
    weights?.[1],
    weights?.[2],
    weights?.[3],
  ];
  return normalizeMaterialWeightsInPlace(target);
}

function nodeLabel(node) {
  const title = String(node?.title ?? node?.type ?? 'Unknown node');
  return `${title} (${String(node?.id ?? 'unknown')})`;
}

function graphError(node, message) {
  return new Error(`${nodeLabel(node)}: ${message}`);
}

function finiteProperty(node, name, fallback, { minimum = -Infinity, maximum = Infinity } = {}) {
  const value = Number(node?.properties?.[name] ?? fallback);
  if (!Number.isFinite(value)) {
    throw graphError(node, `"${name}" must be a finite number.`);
  }
  if (value < minimum || value > maximum) {
    throw graphError(node, `"${name}" must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function validateRange(node, minimumName, maximumName, blendName, defaults, limits = {}) {
  const minimum = finiteProperty(node, minimumName, defaults[minimumName], {
    minimum: limits.minimum ?? -Infinity,
    maximum: limits.maximum ?? Infinity,
  });
  const maximum = finiteProperty(node, maximumName, defaults[maximumName], {
    minimum: limits.minimum ?? -Infinity,
    maximum: limits.maximum ?? Infinity,
  });
  const blend = finiteProperty(node, blendName, defaults[blendName], {
    minimum: 0,
    maximum: limits.blendMaximum ?? Infinity,
  });
  if (minimum > maximum) {
    throw graphError(node, `"${minimumName}" must not exceed "${maximumName}".`);
  }
  return { [minimumName]: minimum, [maximumName]: maximum, [blendName]: blend };
}

function layerIndex(node, propertyName, fallback = 0) {
  const rawValue = node?.properties?.[propertyName] ?? fallback;
  if (typeof rawValue === 'string') {
    const namedIndex = MATERIAL_LAYERS.indexOf(rawValue.toLowerCase());
    if (namedIndex >= 0) return namedIndex;
    if (/^[0-3]$/.test(rawValue)) return Number(rawValue);
  }
  const numericValue = Number(rawValue);
  if (Number.isInteger(numericValue) && numericValue >= 0 && numericValue < 4) {
    return numericValue;
  }
  throw graphError(
    node,
    `"${propertyName}" must be sand, grass, soil, rock, or an index from 0 to 3.`,
  );
}

function catalogEntries(packCatalog) {
  if (packCatalog instanceof Map) return [...packCatalog.values()];
  if (Array.isArray(packCatalog)) return packCatalog;
  if (packCatalog && typeof packCatalog === 'object') return Object.values(packCatalog);
  return [];
}

function acceptsTerrainProducer(node, options) {
  if (typeof options.isTerrainProducer === 'function') {
    return Boolean(options.isTerrainProducer(node));
  }
  if (options.terrainProducerTypes != null) {
    const types = options.terrainProducerTypes instanceof Set
      ? options.terrainProducerTypes
      : new Set(options.terrainProducerTypes);
    return types.has(node.type);
  }
  return TERRAIN_PRODUCING_TYPES.has(node.type);
}

function compilePack(node, packCatalog) {
  const packId = String(node?.properties?.packId ?? '').trim();
  const pack = catalogEntries(packCatalog).find((candidate) => String(candidate?.id) === packId);
  if (!pack) {
    throw graphError(node, `material pack "${packId || '(empty)'}" is missing from the pack catalog.`);
  }
  if (
    !Array.isArray(pack.layers)
    || pack.layers.length !== 4
    || pack.layers.some((layer) => !layer || typeof layer !== 'object' || Array.isArray(layer))
  ) {
    throw graphError(
      node,
      `material pack "${packId}" must contain exactly four usable layers.`,
    );
  }
  const layerIds = pack.layers.map((layer) => String(layer.id ?? '').trim().toLowerCase());
  if (
    layerIds.some(Boolean)
    && layerIds.some((layerId, index) => layerId !== MATERIAL_LAYERS[index])
  ) {
    throw graphError(
      node,
      `material pack "${packId}" layer ids must follow sand, grass, soil, rock order.`,
    );
  }
  return {
    packId,
    splatPreset: String(pack.splatPreset ?? 'mediterranean'),
    globalBlend: finiteProperty(
      node,
      'globalBlend',
      pack.globalBlend ?? 1,
      { minimum: 0.1, maximum: 3 },
    ),
    transitionNoise: finiteProperty(
      node,
      'transitionNoise',
      pack.transitionNoise ?? 0.2,
      { minimum: 0, maximum: 1 },
    ),
  };
}

function compileDistributionRule(node) {
  return {
    nodeId: String(node.id),
    layer: layerIndex(node, 'layer'),
    ...validateRange(
      node,
      'minHeight',
      'maxHeight',
      'heightBlend',
      DISTRIBUTION_DEFAULTS,
    ),
    ...validateRange(
      node,
      'minSlope',
      'maxSlope',
      'slopeBlend',
      DISTRIBUTION_DEFAULTS,
      { minimum: 0, maximum: 90, blendMaximum: 90 },
    ),
    moistureAffinity: finiteProperty(
      node,
      'moistureAffinity',
      DISTRIBUTION_DEFAULTS.moistureAffinity,
      { minimum: -1, maximum: 1 },
    ),
    coastAffinity: finiteProperty(
      node,
      'coastAffinity',
      DISTRIBUTION_DEFAULTS.coastAffinity,
      { minimum: -1, maximum: 1 },
    ),
    erosionAffinity: finiteProperty(
      node,
      'erosionAffinity',
      DISTRIBUTION_DEFAULTS.erosionAffinity,
      { minimum: -1, maximum: 1 },
    ),
    curvatureBias: finiteProperty(
      node,
      'curvatureBias',
      DISTRIBUTION_DEFAULTS.curvatureBias,
      { minimum: -1, maximum: 1 },
    ),
    priority: finiteProperty(
      node,
      'priority',
      DISTRIBUTION_DEFAULTS.priority,
      { minimum: 0.01, maximum: 4 },
    ),
  };
}

function compileMaskNode(node) {
  if (node.type === 'mask/heightSlope') {
    return {
      id: String(node.id),
      type: 'heightSlope',
      ...validateRange(
        node,
        'minHeight',
        'maxHeight',
        'heightBlend',
        HEIGHT_SLOPE_MASK_DEFAULTS,
      ),
      ...validateRange(
        node,
        'minSlope',
        'maxSlope',
        'slopeBlend',
        HEIGHT_SLOPE_MASK_DEFAULTS,
        { minimum: 0, maximum: 90, blendMaximum: 90 },
      ),
      invert: Boolean(node.properties?.invert ?? HEIGHT_SLOPE_MASK_DEFAULTS.invert),
    };
  }
  if (node.type === 'mask/moistureErosion') {
    return {
      id: String(node.id),
      type: 'moistureErosion',
      ...validateRange(
        node,
        'minMoisture',
        'maxMoisture',
        'moistureBlend',
        MOISTURE_EROSION_MASK_DEFAULTS,
        { minimum: 0, maximum: 1, blendMaximum: 1 },
      ),
      ...validateRange(
        node,
        'minErosion',
        'maxErosion',
        'erosionBlend',
        MOISTURE_EROSION_MASK_DEFAULTS,
        { minimum: 0, maximum: 1, blendMaximum: 1 },
      ),
      invert: Boolean(node.properties?.invert ?? MOISTURE_EROSION_MASK_DEFAULTS.invert),
    };
  }
  throw graphError(node, 'cannot provide a mask output.');
}

function compileBiomeBlend(node, maskId) {
  const fromLayer = layerIndex(node, 'fromLayer');
  const toLayer = layerIndex(node, 'toLayer', 1);
  if (fromLayer === toLayer) {
    throw graphError(node, '"fromLayer" and "toLayer" must select different layers.');
  }
  return {
    nodeId: String(node.id),
    maskId,
    fromLayer,
    toLayer,
    strength: finiteProperty(node, 'strength', 1, { minimum: 0, maximum: 1 }),
  };
}

export function compileTerrainMaterialGraph(graph, options = {}) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    throw new TypeError('Terrain material graph must contain nodes and links arrays.');
  }

  const nodes = new Map();
  for (const graphNode of graph.nodes) {
    const id = String(graphNode?.id ?? '');
    if (!id) throw graphError(graphNode, 'node id is required.');
    if (nodes.has(id)) throw graphError(graphNode, `duplicate node id "${id}".`);
    nodes.set(id, graphNode);
  }

  const outputs = graph.nodes.filter((graphNode) => graphNode.type === 'terrain/materialOutput');
  if (outputs.length !== 1) {
    throw new Error(`Terrain material graph requires exactly one Material Output; found ${outputs.length}.`);
  }
  const output = outputs[0];
  const incoming = new Map();
  for (const graphLink of graph.links) {
    const key = `${String(graphLink?.toNode)}:${String(graphLink?.toSocket)}`;
    const existing = incoming.get(key) ?? [];
    existing.push(graphLink);
    incoming.set(key, existing);
  }

  const requireInput = (targetNode, socketName, expectedSourceSocket) => {
    const matches = incoming.get(`${String(targetNode.id)}:${socketName}`) ?? [];
    if (matches.length === 0) {
      throw graphError(targetNode, `required "${socketName}" input is missing.`);
    }
    if (matches.length > 1) {
      throw graphError(targetNode, `"${socketName}" input has more than one connection.`);
    }
    const graphLink = matches[0];
    const source = nodes.get(String(graphLink.fromNode));
    if (!source) {
      throw graphError(targetNode, `"${socketName}" input references missing node "${graphLink.fromNode}".`);
    }
    if (String(graphLink.fromSocket) !== expectedSourceSocket) {
      throw graphError(
        targetNode,
        `"${socketName}" input requires a named "${expectedSourceSocket}" output socket.`,
      );
    }
    return source;
  };

  const terrainSource = requireInput(output, 'terrain', 'terrain');
  if (!acceptsTerrainProducer(terrainSource, options)) {
    throw graphError(
      terrainSource,
      `cannot provide terrain to ${nodeLabel(output)}; expected type shape/islandCoast or a configured terrain producer.`,
    );
  }
  const terminalMaterialNode = requireInput(output, 'material', 'material');
  const masks = new Map();
  const distributionRules = [];
  const biomeBlends = [];
  const visiting = new Set();
  const visited = new Set();
  let packProgram = null;

  const compileMask = (maskNode) => {
    const id = String(maskNode.id);
    if (!masks.has(id)) masks.set(id, compileMaskNode(maskNode));
    return id;
  };

  const compileMaterialNode = (materialNode) => {
    const id = String(materialNode.id);
    if (visiting.has(id)) throw graphError(materialNode, 'material chain contains a cycle.');
    if (visited.has(id)) {
      throw graphError(materialNode, 'material chain branches or reconnects before Material Output.');
    }
    visiting.add(id);

    if (materialNode.type === 'material/pack') {
      packProgram = compilePack(materialNode, options.packCatalog);
    } else if (materialNode.type === 'material/layerDistribution') {
      compileMaterialNode(requireInput(materialNode, 'material', 'material'));
      distributionRules.push(compileDistributionRule(materialNode));
    } else if (materialNode.type === 'material/biomeBlend') {
      compileMaterialNode(requireInput(materialNode, 'material', 'material'));
      const maskNode = requireInput(materialNode, 'mask', 'mask');
      const maskId = compileMask(maskNode);
      biomeBlends.push(compileBiomeBlend(materialNode, maskId));
    } else {
      throw graphError(materialNode, 'cannot provide material flow to Material Output.');
    }

    visiting.delete(id);
    visited.add(id);
  };

  compileMaterialNode(terminalMaterialNode);
  if (!packProgram) {
    throw graphError(output, 'material chain does not contain a Material Pack node.');
  }

  return {
    version: MATERIAL_PROGRAM_VERSION,
    ...packProgram,
    masks: [...masks.values()].sort((left, right) => (
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )),
    distributionRules,
    biomeBlends,
  };
}

function evaluateCompiledMask(mask, context) {
  if (mask.type === 'heightSlope') {
    const heightWeight = evaluateRangeMaskUnchecked(
      Number(context.height ?? 0),
      mask.minHeight,
      mask.maxHeight,
      mask.heightBlend,
    );
    const slopeDegrees = Number(context.slopeDegrees ?? context.slope ?? 0);
    const slopeWeight = evaluateRangeMaskUnchecked(
      slopeDegrees,
      mask.minSlope,
      mask.maxSlope,
      mask.slopeBlend,
    );
    const combined = clamp(heightWeight * slopeWeight);
    return mask.invert ? 1 - combined : combined;
  }

  const moistureWeight = evaluateRangeMaskUnchecked(
    clamp(Number(context.moisture ?? 0)),
    mask.minMoisture,
    mask.maxMoisture,
    mask.moistureBlend,
  );
  const erosionWeight = evaluateRangeMaskUnchecked(
    clamp(Number(context.erosion ?? 0)),
    mask.minErosion,
    mask.maxErosion,
    mask.erosionBlend,
  );
  const combined = clamp(moistureWeight * erosionWeight);
  return mask.invert ? 1 - combined : combined;
}

function evaluateDistributionRuleScore(rule, program, context) {
  const height = Number(context.height ?? 0);
  const slopeDegrees = Number(context.slopeDegrees ?? context.slope ?? 0);
  const curvature = clamp(Number(context.curvature ?? 0), -1, 1);
  const moisture = clamp(Number(context.moisture ?? context.variation ?? 0.5));
  const coast = clamp(Number(context.coast ?? 0));
  const erosion = clamp(Number(context.erosion ?? context.variation ?? 0.5));
  const variation = clamp(Number(context.variation ?? 0.5));
  const globalBlend = clamp(Number(program.globalBlend ?? 1), 0.1, 3);
  const transitionNoise = clamp(Number(program.transitionNoise ?? 0.2));

  const heightWeight = evaluateRangeMaskUnchecked(
    height,
    rule.minHeight,
    rule.maxHeight,
    rule.heightBlend * globalBlend,
  );
  const slopeWeight = evaluateRangeMaskUnchecked(
    slopeDegrees,
    rule.minSlope,
    rule.maxSlope,
    rule.slopeBlend * globalBlend,
  );
  const curvatureSignal = rule.curvatureBias >= 0
    ? Math.max(0, -curvature)
    : Math.max(0, curvature);
  const moistureFactor = 1 + rule.moistureAffinity * (moisture * 2 - 1) * 0.75;
  const coastFactor = 1 + rule.coastAffinity * (coast * 2 - 1) * 0.85;
  const erosionFactor = 1 + rule.erosionAffinity * (erosion * 2 - 1) * 0.65;
  const curvatureFactor = 1 + Math.abs(rule.curvatureBias) * curvatureSignal * 1.15;
  const noiseFactor = 1 + (variation - 0.5) * transitionNoise * 0.9;
  const score = heightWeight
    * slopeWeight
    * moistureFactor
    * coastFactor
    * erosionFactor
    * curvatureFactor
    * noiseFactor
    * rule.priority;

  return Math.max(EPSILON_WEIGHT, score);
}

function isMaterialTarget(target) {
  return (
    Array.isArray(target)
    || target instanceof Float32Array
    || target instanceof Float64Array
  );
}

function materialProgramError(label, message) {
  return new Error(`Terrain material program ${label}: ${message}`);
}

export function normalizeMaterialSplatPreset(value) {
  if (typeof value !== 'string') {
    throw materialProgramError('pack', '"splatPreset" must be a string.');
  }
  const normalized = value.trim().toLowerCase();
  if (!MATERIAL_SPLAT_PRESETS.has(normalized)) {
    throw materialProgramError(
      'pack',
      `"splatPreset" must be a supported preset: ${[...MATERIAL_SPLAT_PRESETS].join(', ')}.`,
    );
  }
  return normalized;
}

function programEntryLabel(kind, entry, index) {
  const id = String(entry?.id ?? entry?.nodeId ?? `index ${index}`);
  return `${kind} "${id}"`;
}

function programNumber(entry, propertyName, label, minimum = -Infinity, maximum = Infinity) {
  const value = Number(entry?.[propertyName]);
  if (!Number.isFinite(value)) {
    throw materialProgramError(label, `"${propertyName}" must be a finite number.`);
  }
  if (value < minimum || value > maximum) {
    throw materialProgramError(
      label,
      `"${propertyName}" must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function programRange(
  entry,
  label,
  minimumName,
  maximumName,
  blendName,
  minimum = -Infinity,
  maximum = Infinity,
  blendMaximum = Infinity,
) {
  const rangeMinimum = programNumber(entry, minimumName, label, minimum, maximum);
  const rangeMaximum = programNumber(entry, maximumName, label, minimum, maximum);
  const blend = programNumber(entry, blendName, label, 0, blendMaximum);
  if (rangeMinimum > rangeMaximum) {
    throw materialProgramError(
      label,
      `"${minimumName}" must not exceed "${maximumName}".`,
    );
  }
  return [rangeMinimum, rangeMaximum, blend];
}

function programLayerIndex(entry, propertyName, label) {
  const value = Number(entry?.[propertyName]);
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw materialProgramError(label, `"${propertyName}" must be an index from 0 to 3.`);
  }
  return value;
}

function prepareMaterialProgram(program) {
  const version = Number(program?.version);
  if (!program || typeof program !== 'object' || version !== MATERIAL_PROGRAM_VERSION) {
    throw new Error(`Unsupported terrain material program version "${program?.version}".`);
  }
  for (const arrayName of ['masks', 'distributionRules', 'biomeBlends']) {
    if (!Array.isArray(program[arrayName])) {
      throw materialProgramError(arrayName, 'must be an array.');
    }
  }

  const packId = String(program.packId ?? '').trim();
  const splatPreset = normalizeMaterialSplatPreset(program.splatPreset);
  if (!packId) throw materialProgramError('pack', '"packId" is required.');
  const globalBlend = programNumber(program, 'globalBlend', 'pack', 0.1, 3);
  const transitionNoise = programNumber(program, 'transitionNoise', 'pack', 0, 1);

  const masks = new Array(program.masks.length);
  const maskIndexes = Object.create(null);
  for (let index = 0; index < program.masks.length; index += 1) {
    const source = program.masks[index];
    const label = programEntryLabel('mask', source, index);
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw materialProgramError(label, 'must be an object.');
    }
    const id = String(source.id ?? '').trim();
    if (!id) throw materialProgramError(label, '"id" is required.');
    if (Object.hasOwn(maskIndexes, id)) {
      throw materialProgramError(label, `duplicates mask id "${id}".`);
    }
    const type = String(source.type ?? '');
    if (typeof source.invert !== 'boolean') {
      throw materialProgramError(label, '"invert" must be boolean.');
    }

    if (type === 'heightSlope') {
      const [minHeight, maxHeight, heightBlend] = programRange(
        source,
        label,
        'minHeight',
        'maxHeight',
        'heightBlend',
      );
      const [minSlope, maxSlope, slopeBlend] = programRange(
        source,
        label,
        'minSlope',
        'maxSlope',
        'slopeBlend',
        0,
        90,
        90,
      );
      masks[index] = {
        id,
        type,
        minHeight,
        maxHeight,
        heightBlend,
        minSlope,
        maxSlope,
        slopeBlend,
        invert: source.invert,
      };
    } else if (type === 'moistureErosion') {
      const [minMoisture, maxMoisture, moistureBlend] = programRange(
        source,
        label,
        'minMoisture',
        'maxMoisture',
        'moistureBlend',
        0,
        1,
        1,
      );
      const [minErosion, maxErosion, erosionBlend] = programRange(
        source,
        label,
        'minErosion',
        'maxErosion',
        'erosionBlend',
        0,
        1,
        1,
      );
      masks[index] = {
        id,
        type,
        minMoisture,
        maxMoisture,
        moistureBlend,
        minErosion,
        maxErosion,
        erosionBlend,
        invert: source.invert,
      };
    } else {
      throw materialProgramError(label, `"type" "${type}" is not supported.`);
    }
    maskIndexes[id] = index;
  }

  const distributionRules = new Array(program.distributionRules.length);
  for (let index = 0; index < program.distributionRules.length; index += 1) {
    const source = program.distributionRules[index];
    const label = programEntryLabel('distribution rule', source, index);
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw materialProgramError(label, 'must be an object.');
    }
    const [minHeight, maxHeight, heightBlend] = programRange(
      source,
      label,
      'minHeight',
      'maxHeight',
      'heightBlend',
    );
    const [minSlope, maxSlope, slopeBlend] = programRange(
      source,
      label,
      'minSlope',
      'maxSlope',
      'slopeBlend',
      0,
      90,
      90,
    );
    distributionRules[index] = {
      nodeId: String(source.nodeId ?? `rule-${index}`),
      layer: programLayerIndex(source, 'layer', label),
      minHeight,
      maxHeight,
      heightBlend,
      minSlope,
      maxSlope,
      slopeBlend,
      moistureAffinity: programNumber(source, 'moistureAffinity', label, -1, 1),
      coastAffinity: programNumber(source, 'coastAffinity', label, -1, 1),
      erosionAffinity: programNumber(source, 'erosionAffinity', label, -1, 1),
      curvatureBias: programNumber(source, 'curvatureBias', label, -1, 1),
      priority: programNumber(source, 'priority', label, 0.01, 4),
    };
  }

  const biomeBlends = new Array(program.biomeBlends.length);
  for (let index = 0; index < program.biomeBlends.length; index += 1) {
    const source = program.biomeBlends[index];
    const label = programEntryLabel('biome blend', source, index);
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw materialProgramError(label, 'must be an object.');
    }
    const fromLayer = programLayerIndex(source, 'fromLayer', label);
    const toLayer = programLayerIndex(source, 'toLayer', label);
    if (fromLayer === toLayer) {
      throw materialProgramError(label, '"fromLayer" and "toLayer" must differ.');
    }
    const maskId = String(source.maskId ?? '').trim();
    if (!Object.hasOwn(maskIndexes, maskId)) {
      throw materialProgramError(label, `references missing mask "${maskId || '(empty)'}".`);
    }
    biomeBlends[index] = {
      nodeId: String(source.nodeId ?? `blend-${index}`),
      maskIndex: maskIndexes[maskId],
      fromLayer,
      toLayer,
      strength: programNumber(source, 'strength', label, 0, 1),
    };
  }

  return {
    version,
    packId,
    splatPreset,
    globalBlend,
    transitionNoise,
    masks,
    distributionRules,
    biomeBlends,
  };
}

export function createTerrainMaterialProgramEvaluator(program) {
  const preparedProgram = prepareMaterialProgram(program);
  const { masks, distributionRules, biomeBlends } = preparedProgram;
  const maskValues = new Float64Array(masks.length);

  return (
    context = EMPTY_CONTEXT,
    baseWeights = DEFAULT_BASE_WEIGHTS,
    target = null,
  ) => {
    const output = target ?? [0, 0, 0, 0];
    if (!isMaterialTarget(output) || output.length < 4) {
      throw new TypeError('Terrain material evaluator target must be an Array, Float32Array, or Float64Array with at least four entries.');
    }
    for (let index = 0; index < 4; index += 1) {
      const value = Number(baseWeights?.[index] ?? 0.25);
      output[index] = Number.isFinite(value) && value > 0 ? value : 0;
    }
    for (let index = 0; index < distributionRules.length; index += 1) {
      const rule = distributionRules[index];
      // A later rule for the same channel is an explicit override.
      output[rule.layer] = evaluateDistributionRuleScore(rule, preparedProgram, context);
    }
    normalizeMaterialWeightsInPlace(output);

    for (let index = 0; index < masks.length; index += 1) {
      maskValues[index] = evaluateCompiledMask(masks[index], context);
    }

    for (let index = 0; index < biomeBlends.length; index += 1) {
      const blend = biomeBlends[index];
      const maskWeight = maskValues[blend.maskIndex];
      const sourceWeight = Math.max(0, Number(output[blend.fromLayer] ?? 0));
      const transfer = Math.min(sourceWeight, sourceWeight * maskWeight * blend.strength);
      output[blend.fromLayer] = sourceWeight - transfer;
      output[blend.toLayer] = Math.max(0, Number(output[blend.toLayer] ?? 0)) + transfer;
    }

    return normalizeMaterialWeightsInPlace(output);
  };
}

export function evaluateTerrainMaterialProgram(program, context = {}, baseWeights = null) {
  if (!program || typeof program !== 'object') {
    return createTerrainMaterialProgramEvaluator(program)(
      context,
      baseWeights ?? DEFAULT_BASE_WEIGHTS,
    );
  }
  let evaluate = MATERIAL_EVALUATOR_CACHE.get(program);
  if (!evaluate) {
    evaluate = createTerrainMaterialProgramEvaluator(program);
    MATERIAL_EVALUATOR_CACHE.set(program, evaluate);
  }
  return evaluate(context, baseWeights ?? DEFAULT_BASE_WEIGHTS);
}
