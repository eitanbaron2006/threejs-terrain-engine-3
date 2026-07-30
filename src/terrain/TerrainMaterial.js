import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DEFAULT_MATERIAL_SETTINGS, QUALITY_TIERS, cloneMaterialSettings } from './TerrainConfig.js';
import { BUILTIN_TERRAIN_MATERIAL_PACKS } from './TerrainMaterialPacks.js';

const LAYER_COUNT = 4;
const PROCEDURAL_RESOLUTION = 256;

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hash2D(x, y, seed) {
  let value = Math.imul(x + seed * 374761393, 668265263) ^ Math.imul(y + seed * 1274126177, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smooth01(value) {
  return value * value * (3 - 2 * value);
}

function periodicValueNoise(x, y, period, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth01(x - x0);
  const ty = smooth01(y - y0);
  const wrap = (value) => ((value % period) + period) % period;
  const v00 = hash2D(wrap(x0), wrap(y0), seed);
  const v10 = hash2D(wrap(x0 + 1), wrap(y0), seed);
  const v01 = hash2D(wrap(x0), wrap(y0 + 1), seed);
  const v11 = hash2D(wrap(x0 + 1), wrap(y0 + 1), seed);
  const a = THREE.MathUtils.lerp(v00, v10, tx);
  const b = THREE.MathUtils.lerp(v01, v11, tx);
  return THREE.MathUtils.lerp(a, b, ty);
}

function periodicFbm(x, y, period, seed, octaves = 5) {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const octavePeriod = Math.max(2, Math.floor(period * frequency));
    sum += periodicValueNoise(x * frequency, y * frequency, octavePeriod, seed + octave * 1013) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / Math.max(normalization, 0.0001);
}

function proceduralHeight(x, y, size, seed, profile) {
  const nx = x / size;
  const ny = y / size;
  const broad = periodicFbm(nx * 8, ny * 8, 8, seed, 4);
  const detail = periodicFbm(nx * 32, ny * 32, 32, seed + 37, 4);
  const micro = periodicFbm(nx * 96, ny * 96, 96, seed + 79, 3);
  let value = broad * 0.55 + detail * 0.32 + micro * 0.13;
  if (profile === 'sand' || profile === 'snow' || profile === 'ash') value = 0.46 + (value - 0.5) * 0.34;
  else if (profile === 'grass' || profile === 'dry') value = 0.47 + (value - 0.5) * 0.48;
  else if (profile === 'soil' || profile === 'clay' || profile === 'scorched' || profile === 'lava') value = 0.45 + (value - 0.5) * 0.62;
  else value = 0.40 + Math.pow(value, 1.25) * 0.54;
  return THREE.MathUtils.clamp(value, 0, 1);
}

function createProceduralArrays(size = PROCEDURAL_RESOLUTION, paletteOverride = null) {
  const depth = LAYER_COUNT;
  const pixelCount = size * size;
  const baseColor = new Uint8Array(pixelCount * depth * 4);
  const normal = new Uint8Array(pixelCount * depth * 4);
  const orm = new Uint8Array(pixelCount * depth * 4);
  const height = new Uint8Array(pixelCount * depth * 4);
  const palette = paletteOverride ?? [
    ['#c9ac70', '#ead7a4', 'sand'],
    ['#3f6738', '#7fa35a', 'grass'],
    ['#62452f', '#9a704d', 'soil'],
    ['#505258', '#99968e', 'rock'],
  ];

  for (let layer = 0; layer < depth; layer += 1) {
    const [darkHex, lightHex, profile] = palette[layer];
    const dark = hexToRgb(darkHex);
    const light = hexToRgb(lightHex);
    const random = mulberry32(9001 + layer * 337);
    const heights = new Float32Array(pixelCount);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = y * size + x;
        const noise = (random() - 0.5) * 0.025;
        heights[index] = THREE.MathUtils.clamp(proceduralHeight(x, y, size, layer * 19 + 3, profile) + noise, 0, 1);
      }
    }

    const getHeight = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const pixel = y * size + x;
        const offset = (layer * pixelCount + pixel) * 4;
        const h = getHeight(x, y);
        const colorMix = THREE.MathUtils.clamp(h * 0.72 + 0.15 + (random() - 0.5) * 0.1, 0, 1);
        baseColor[offset] = clampByte(THREE.MathUtils.lerp(dark[0], light[0], colorMix));
        baseColor[offset + 1] = clampByte(THREE.MathUtils.lerp(dark[1], light[1], colorMix));
        baseColor[offset + 2] = clampByte(THREE.MathUtils.lerp(dark[2], light[2], colorMix));
        baseColor[offset + 3] = 255;

        const dx = getHeight(x + 1, y) - getHeight(x - 1, y);
        const dy = getHeight(x, y + 1) - getHeight(x, y - 1);
        const nx = -dx * (profile === 'rock' ? 4.4 : 2.8);
        const ny = -dy * (profile === 'rock' ? 4.4 : 2.8);
        const invLength = 1 / Math.hypot(nx, ny, 1);
        normal[offset] = clampByte((nx * invLength * 0.5 + 0.5) * 255);
        normal[offset + 1] = clampByte((ny * invLength * 0.5 + 0.5) * 255);
        normal[offset + 2] = clampByte((invLength * 0.5 + 0.5) * 255);
        normal[offset + 3] = 255;

        const roughness = [0.88, 0.93, 0.84, 0.73][layer];
        const metalness = [0, 0, 0, 0.02][layer];
        orm[offset] = clampByte((0.68 + h * 0.3) * 255);
        orm[offset + 1] = clampByte(roughness * 255);
        orm[offset + 2] = clampByte(metalness * 255);
        orm[offset + 3] = 255;

        const heightByte = clampByte(h * 255);
        height[offset] = heightByte;
        height[offset + 1] = heightByte;
        height[offset + 2] = heightByte;
        height[offset + 3] = 255;
      }
    }
  }

  return { size, depth, baseColor, normal, orm, height };
}

function configureArrayTexture(texture, { color = false, anisotropy = 4 } = {}) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = anisotropy;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createDataArrayTexture(data, width, height, depth, options) {
  return configureArrayTexture(new THREE.DataArrayTexture(data, width, height, depth), options);
}

function createMacroTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const nx = x / size;
      const ny = y / size;
      const broad = periodicFbm(nx * 5, ny * 5, 5, 44121, 4);
      const medium = periodicFbm(nx * 17, ny * 17, 17, 77119, 3);
      const value = THREE.MathUtils.clamp(0.25 + broad * 0.52 + medium * 0.23, 0, 1);
      data[index] = data[index + 1] = data[index + 2] = clampByte(value * 255);
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}


const EXPECTED_LAYER_IDS = Object.freeze(['sand', 'grass', 'soil', 'rock']);
const REQUIRED_MANIFEST_TEXTURES = Object.freeze([
  ['baseColorArray', 'Base Color'],
  ['normalArray', 'Normal'],
  ['ormArray', 'ORM'],
  ['heightArray', 'Height'],
]);

function normalizeManifest(manifest, manifestUrl) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('KTX2 manifest חייב להיות אובייקט JSON.');
  }
  for (const [key, label] of REQUIRED_MANIFEST_TEXTURES) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) {
      throw new Error(`חסר נתיב ${label} בשדה ${key}.`);
    }
  }
  const layers = Array.isArray(manifest.layers) ? manifest.layers.map(String) : EXPECTED_LAYER_IDS.slice();
  if (layers.length !== LAYER_COUNT) throw new Error(`ה־manifest חייב להגדיר בדיוק ${LAYER_COUNT} שכבות.`);
  const warnings = [];
  if (layers.some((layer, index) => layer !== EXPECTED_LAYER_IDS[index])) {
    warnings.push(`סדר השכבות הוא ${layers.join(' / ')}; ממשק הצביעה מצפה ל־${EXPECTED_LAYER_IDS.join(' / ')}.`);
  }
  const baseUrl = new URL('.', new URL(manifestUrl, window.location.href));
  return {
    ...manifest,
    name: String(manifest.name ?? 'Terrain KTX2 Array Set'),
    layers,
    resolution: Number(manifest.resolution ?? 0),
    warnings,
    resolvedUrls: Object.fromEntries(REQUIRED_MANIFEST_TEXTURES.map(([key]) => [key, new URL(manifest[key], baseUrl).href])),
  };
}

function inspectArrayTexture(texture, label) {
  const image = texture?.image ?? {};
  const firstMipmap = texture?.mipmaps?.[0] ?? {};
  const width = Number(image.width ?? firstMipmap.width ?? 0);
  const height = Number(image.height ?? firstMipmap.height ?? 0);
  const depth = Number(image.depth ?? image.layers ?? texture?.depth ?? 0);
  const mipLevels = Math.max(1, Number(texture?.mipmaps?.length ?? image.mipmaps?.length ?? 1));
  return {
    label,
    width,
    height,
    depth,
    mipLevels,
    expectedMipLevels: width > 0 && height > 0 ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 0,
    compressed: Boolean(texture?.isCompressedArrayTexture),
    arrayTexture: Boolean(texture?.isCompressedArrayTexture || texture?.isDataArrayTexture),
  };
}

function validateTextureSet(manifest, textures) {
  const entries = textures.map((texture, index) => inspectArrayTexture(texture, REQUIRED_MANIFEST_TEXTURES[index][1]));
  const errors = [];
  const warnings = [...manifest.warnings];
  for (const info of entries) {
    if (!info.arrayTexture) errors.push(`${info.label}: הקובץ אינו 2D Array Texture.`);
    if (info.depth !== LAYER_COUNT) errors.push(`${info.label}: נמצאו ${info.depth || 0} שכבות במקום ${LAYER_COUNT}.`);
    if (info.width <= 0 || info.height <= 0) errors.push(`${info.label}: לא ניתן לקרוא רזולוציה.`);
    if (info.width !== info.height) warnings.push(`${info.label}: הטקסטורה אינה ריבועית (${info.width}×${info.height}).`);
    if (info.expectedMipLevels > 1 && info.mipLevels < info.expectedMipLevels) {
      warnings.push(`${info.label}: נמצאו ${info.mipLevels} Mipmaps מתוך ${info.expectedMipLevels} מומלצים.`);
    }
  }
  const [first] = entries;
  for (const info of entries.slice(1)) {
    if (info.width !== first.width || info.height !== first.height || info.depth !== first.depth) {
      errors.push(`${info.label}: המידות או מספר השכבות אינם תואמים ל־Base Color.`);
    }
  }
  if (manifest.resolution > 0 && first.width > 0 && manifest.resolution !== first.width) {
    warnings.push(`ה־manifest מצהיר ${manifest.resolution}px אך הקובץ נטען בגודל ${first.width}px.`);
  }
  if (errors.length) throw new Error(`KTX2 validation נכשל:\n${errors.join('\n')}`);
  return {
    valid: true,
    manifestName: manifest.name,
    manifestUrl: manifest.manifestUrl,
    layers: manifest.layers,
    resolution: first.width,
    depth: first.depth,
    mipLevels: Math.min(...entries.map((entry) => entry.mipLevels)),
    expectedMipLevels: Math.min(...entries.map((entry) => entry.expectedMipLevels || 1)),
    textures: entries,
    warnings: [...new Set(warnings)],
  };
}

const vertexShader = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  precision highp sampler2DArray;

  uniform sampler2D uHeightMap;
  uniform sampler2D uControlMap;
  uniform sampler2DArray uMaterialHeight;
  uniform vec4 uLayerScales;
  uniform vec4 uDisplacementStrengths;
  uniform vec4 uDisplacementLayerMask;
  uniform vec4 uDisplacementCenters;
  uniform float uDisplacementMode;
  uniform float uDisplacementWeightThreshold;
  uniform float uChunkSize;
  uniform float uHeightTexel;
  uniform float uHeightCoreResolution;
  uniform float uSkirtDepth;
  uniform vec4 uNeighborCoarseSteps;
  uniform float uEdgeMorphWidth;
  uniform float uDisplacementEnabled;
  uniform float uDisplacementNear;
  uniform float uDisplacementFar;
  uniform float uLodDisplacement;

  in float aSkirt;
  out vec2 vChunkUv;
  out vec3 vWorldPosition;
  out vec3 vWorldNormal;
  out vec4 vWeights;
  out float vDistanceFade;

  float terrainHeight(vec2 coordinates) {
    ivec2 dimensions = textureSize(uHeightMap, 0);
    float coreMax = max(uHeightCoreResolution - 1.0, 1.0);
    vec2 grid = coordinates * coreMax + vec2(1.0);
    grid = clamp(grid, vec2(0.0), vec2(dimensions - ivec2(1)));
    ivec2 cell = ivec2(floor(grid));
    ivec2 nextCell = min(cell + ivec2(1), dimensions - ivec2(1));
    vec2 fraction = fract(grid);
    float h00 = texelFetch(uHeightMap, cell, 0).r;
    float h10 = texelFetch(uHeightMap, ivec2(nextCell.x, cell.y), 0).r;
    float h01 = texelFetch(uHeightMap, ivec2(cell.x, nextCell.y), 0).r;
    float h11 = texelFetch(uHeightMap, nextCell, 0).r;
    return mix(mix(h00, h10, fraction.x), mix(h01, h11, fraction.x), fraction.y);
  }

  float coarseTerrainHeight(vec2 coordinates, float coarseStep) {
    vec2 coarseGrid = coordinates / coarseStep;
    vec2 coarseCell = floor(coarseGrid);
    vec2 fraction = fract(coarseGrid);
    vec2 uv00 = coarseCell * coarseStep;
    vec2 uv10 = (coarseCell + vec2(1.0, 0.0)) * coarseStep;
    vec2 uv01 = (coarseCell + vec2(0.0, 1.0)) * coarseStep;
    vec2 uv11 = (coarseCell + vec2(1.0, 1.0)) * coarseStep;
    float h00 = terrainHeight(uv00);
    float h10 = terrainHeight(uv10);
    float h01 = terrainHeight(uv01);
    float h11 = terrainHeight(uv11);
    return mix(mix(h00, h10, fraction.x), mix(h01, h11, fraction.x), fraction.y);
  }

  float edgeMorphWeight(vec2 coordinates, out float coarseStep) {
    float bestWeight = 0.0;
    coarseStep = 0.0;
    float width = max(uEdgeMorphWidth, 0.0001);

    if (uNeighborCoarseSteps.x > 0.0) {
      float weight = 1.0 - smoothstep(0.0, width, coordinates.x);
      if (weight > bestWeight) { bestWeight = weight; coarseStep = uNeighborCoarseSteps.x; }
    }
    if (uNeighborCoarseSteps.y > 0.0) {
      float weight = 1.0 - smoothstep(0.0, width, 1.0 - coordinates.x);
      if (weight > bestWeight) { bestWeight = weight; coarseStep = uNeighborCoarseSteps.y; }
    }
    if (uNeighborCoarseSteps.z > 0.0) {
      float weight = 1.0 - smoothstep(0.0, width, coordinates.y);
      if (weight > bestWeight) { bestWeight = weight; coarseStep = uNeighborCoarseSteps.z; }
    }
    if (uNeighborCoarseSteps.w > 0.0) {
      float weight = 1.0 - smoothstep(0.0, width, 1.0 - coordinates.y);
      if (weight > bestWeight) { bestWeight = weight; coarseStep = uNeighborCoarseSteps.w; }
    }
    return bestWeight;
  }

  float morphedTerrainHeight(vec2 coordinates) {
    float coarseStep;
    float morph = edgeMorphWeight(coordinates, coarseStep);
    float fineHeight = terrainHeight(coordinates);
    if (coarseStep <= 0.0 || morph <= 0.0) return fineHeight;
    return mix(fineHeight, coarseTerrainHeight(coordinates, coarseStep), morph);
  }

  vec3 displacementAxisWeights(vec3 normal) {
    vec3 weights = pow(abs(normal), vec3(5.0));
    return weights / max(weights.x + weights.y + weights.z, 0.0001);
  }

  float materialHeight(float layer, vec3 worldPosition, vec3 surfaceNormal, float scale) {
    vec3 blend = displacementAxisWeights(surfaceNormal);
    float xSample = texture(uMaterialHeight, vec3(worldPosition.zy * scale, layer)).r;
    float ySample = texture(uMaterialHeight, vec3(worldPosition.xz * scale, layer)).r;
    float zSample = texture(uMaterialHeight, vec3(worldPosition.xy * scale, layer)).r;
    return xSample * blend.x + ySample * blend.y + zSample * blend.z;
  }

  float signedMaterialHeight(float value, float center) {
    float positiveRange = max(1.0 - center, 0.001);
    float negativeRange = max(center, 0.001);
    return value >= center
      ? (value - center) / positiveRange
      : (value - center) / negativeRange;
  }

  void main() {
    vChunkUv = uv;
    vec4 baseWorld = modelMatrix * vec4(position, 1.0);
    vec2 worldXZ = baseWorld.xz;
    float height = morphedTerrainHeight(uv);

    float leftHeight = morphedTerrainHeight(uv - vec2(uHeightTexel, 0.0));
    float rightHeight = morphedTerrainHeight(uv + vec2(uHeightTexel, 0.0));
    float downHeight = morphedTerrainHeight(uv - vec2(0.0, uHeightTexel));
    float upHeight = morphedTerrainHeight(uv + vec2(0.0, uHeightTexel));
    float worldStep = uChunkSize * uHeightTexel;
    vec3 localNormal = normalize(vec3(leftHeight - rightHeight, max(worldStep * 2.0, 0.0001), downHeight - upHeight));

    vec4 weights = texture(uControlMap, uv);
    weights /= max(dot(weights, vec4(1.0)), 0.0001);
    vWeights = weights;

    float cameraDistance = distance(cameraPosition, vec3(worldXZ.x, height, worldXZ.y));
    float distanceFade = 1.0 - smoothstep(uDisplacementNear, uDisplacementFar, cameraDistance);
    vDistanceFade = distanceFade;
    vec3 heightSamplePosition = vec3(worldXZ.x, height, worldXZ.y);
    vec4 rawMaterialHeights = vec4(
      materialHeight(0.0, heightSamplePosition, localNormal, uLayerScales.x),
      materialHeight(1.0, heightSamplePosition, localNormal, uLayerScales.y),
      materialHeight(2.0, heightSamplePosition, localNormal, uLayerScales.z),
      materialHeight(3.0, heightSamplePosition, localNormal, uLayerScales.w)
    );
    vec4 materialHeights = vec4(
      signedMaterialHeight(rawMaterialHeights.x, uDisplacementCenters.x),
      signedMaterialHeight(rawMaterialHeights.y, uDisplacementCenters.y),
      signedMaterialHeight(rawMaterialHeights.z, uDisplacementCenters.z),
      signedMaterialHeight(rawMaterialHeights.w, uDisplacementCenters.w)
    );
    vec4 activeWeights = weights * uDisplacementLayerMask;
    activeWeights *= smoothstep(vec4(uDisplacementWeightThreshold), vec4(min(1.0, uDisplacementWeightThreshold + 0.18)), weights);
    float activeWeightSum = dot(activeWeights, vec4(1.0));
    if (activeWeightSum > 0.0001) activeWeights /= activeWeightSum;
    float microDisplacement = dot(materialHeights * uDisplacementStrengths, activeWeights);
    microDisplacement *= uDisplacementEnabled * uLodDisplacement * distanceFade * min(activeWeightSum, 1.0);

    // Chunk borders must remain coincident. Fading displacement to zero near every
    // border created visible trenches, while normal-direction displacement pulled
    // neighboring meshes sideways. Keep the shared world-space height value, but
    // transition the displacement direction to vertical inside a narrow seam band.
    float distanceToEdge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float seamBandWidth = max(uHeightTexel * 3.0, 0.004);
    float interiorWeight = smoothstep(0.0, seamBandWidth, distanceToEdge);
    vec3 requestedDirection = normalize(mix(vec3(0.0, 1.0, 0.0), localNormal, uDisplacementMode));
    vec3 displacementDirection = normalize(mix(vec3(0.0, 1.0, 0.0), requestedDirection, interiorWeight));

    vec3 localPosition = vec3(position.x, height, position.z);
    localPosition += displacementDirection * microDisplacement;
    localPosition.y -= aSkirt * uSkirtDepth;
    vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  precision highp sampler2DArray;

  layout(location = 0) out highp vec4 terrainFragmentColor;
  #define gl_FragColor terrainFragmentColor

  uniform sampler2D uControlMap;
  uniform sampler2DArray uBaseColorArray;
  uniform sampler2DArray uNormalArray;
  uniform sampler2DArray uOrmArray;
  uniform sampler2DArray uMaterialHeight;
  uniform sampler2D uMacroMap;
  uniform vec4 uLayerScales;
  uniform vec4 uLayerRoughness;
  uniform vec4 uLayerMetalness;
  uniform float uHeightBlendSharpness;
  uniform float uMacroVariation;
  uniform float uDetailNormalStrength;
  uniform float uParallaxEnabled;
  uniform float uParallaxScale;
  uniform float uLodDetail;
  uniform float uSelected;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uFogDensity;
  uniform vec3 uFogColor;

  in vec2 vChunkUv;
  in vec3 vWorldPosition;
  in vec3 vWorldNormal;
  in vec4 vWeights;
  in float vDistanceFade;

  float hash12(vec2 point) {
    vec3 p3 = fract(vec3(point.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float smoothNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 fraction = fract(point);
    fraction = fraction * fraction * (3.0 - 2.0 * fraction);
    float a = hash12(cell);
    float b = hash12(cell + vec2(1.0, 0.0));
    float c = hash12(cell + vec2(0.0, 1.0));
    float d = hash12(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
  }

  vec3 axisWeights(vec3 normal) {
    vec3 weights = pow(abs(normal), vec3(4.0));
    return weights / max(weights.x + weights.y + weights.z, 0.0001);
  }

  vec2 layerOffset(float layer, float variant) {
    return vec2(
      hash12(vec2(layer * 19.31 + variant * 7.17, 11.83)),
      hash12(vec2(layer * 31.79 + variant * 13.47, 29.11))
    ) * 37.0;
  }

  // Two decorrelated samples at irrationally related scales. The blend varies only
  // at a broad world-space frequency, so there are no cell borders or checker tiles.
  vec4 sampleStochastic2D(sampler2DArray map, vec2 uv, float layer, vec2 worldXZ) {
    vec2 offsetA = layerOffset(layer, 0.0);
    vec2 offsetB = layerOffset(layer, 1.0);
    vec4 firstSample = texture(map, vec3(uv + offsetA, layer));
    vec4 secondSample = texture(map, vec3(uv * 1.071 + offsetB, layer));
    float blend = smoothNoise(worldXZ * 0.0037 + vec2(layer * 8.7, layer * 13.1));
    blend = smoothstep(0.18, 0.82, blend);
    return mix(firstSample, secondSample, blend);
  }

  // Horizontal surfaces use world XZ projection. Only steep surfaces fade into the
  // two side projections. This avoids the fabric-like look caused by full triplanar
  // mapping on every pixel while retaining stretch-free cliffs.
  vec4 sampleHybrid(sampler2DArray map, float layer, vec3 position, vec3 normal, float scale) {
    vec4 top = sampleStochastic2D(map, position.xz * scale, layer, position.xz);
    float sideBlend = smoothstep(0.32, 0.72, 1.0 - abs(normal.y));
    if (sideBlend <= 0.001) return top;
    vec3 weights = axisWeights(normal);
    float sideTotal = max(weights.x + weights.z, 0.0001);
    vec4 sideX = sampleStochastic2D(map, position.zy * scale, layer, position.xz);
    vec4 sideZ = sampleStochastic2D(map, position.xy * scale, layer, position.xz);
    vec4 sides = (sideX * weights.x + sideZ * weights.z) / sideTotal;
    return mix(top, sides, sideBlend);
  }

  vec4 sampleHybridBasic(sampler2DArray map, float layer, vec3 position, vec3 normal, float scale) {
    vec4 top = texture(map, vec3(position.xz * scale + layerOffset(layer, 0.0), layer));
    float sideBlend = smoothstep(0.32, 0.72, 1.0 - abs(normal.y));
    if (sideBlend <= 0.001) return top;
    vec3 weights = axisWeights(normal);
    float sideTotal = max(weights.x + weights.z, 0.0001);
    vec4 sideX = texture(map, vec3(position.zy * scale + layerOffset(layer, 0.0), layer));
    vec4 sideZ = texture(map, vec3(position.xy * scale + layerOffset(layer, 0.0), layer));
    return mix(top, (sideX * weights.x + sideZ * weights.z) / sideTotal, sideBlend);
  }

  vec3 projectedNormal(float layer, vec3 position, vec3 geometricNormal, float scale) {
    vec3 topNormal = texture(uNormalArray, vec3(position.xz * scale + layerOffset(layer, 0.0), layer)).xyz * 2.0 - 1.0;
    vec3 topWorld = normalize(vec3(topNormal.x, topNormal.z, topNormal.y));
    float sideBlend = smoothstep(0.32, 0.72, 1.0 - abs(geometricNormal.y));
    if (sideBlend <= 0.001) return topWorld;

    vec3 weights = axisWeights(geometricNormal);
    float sideTotal = max(weights.x + weights.z, 0.0001);
    vec3 xNormal = texture(uNormalArray, vec3(position.zy * scale + layerOffset(layer, 0.0), layer)).xyz * 2.0 - 1.0;
    vec3 zNormal = texture(uNormalArray, vec3(position.xy * scale + layerOffset(layer, 0.0), layer)).xyz * 2.0 - 1.0;
    vec3 worldX = normalize(vec3(xNormal.z, xNormal.y, xNormal.x));
    vec3 worldZ = normalize(vec3(zNormal.x, zNormal.y, zNormal.z));
    vec3 sides = normalize((worldX * weights.x + worldZ * weights.z) / sideTotal);
    return normalize(mix(topWorld, sides, sideBlend));
  }

  vec4 normalizedFourWayWeights(vec4 rawWeights, vec4 materialHeights) {
    // A sub-linear power widens transition zones. Height information then nudges the
    // probabilities without cutting weaker layers out of the blend.
    vec4 weights = pow(max(rawWeights, vec4(0.0001)), vec4(0.72));
    weights /= max(dot(weights, vec4(1.0)), 0.0001);
    float heightInfluence = uHeightBlendSharpness * 0.48;
    weights *= mix(vec4(1.0), vec4(0.62) + materialHeights * 0.76, heightInfluence);
    weights += vec4(0.0025);
    return weights / max(dot(weights, vec4(1.0)), 0.0001);
  }

  float componentAt(vec4 value, float index) {
    if (index < 0.5) return value.x;
    if (index < 1.5) return value.y;
    if (index < 2.5) return value.z;
    return value.w;
  }

  void accumulateLayer(
    inout vec3 colorAccumulator,
    inout vec4 ormAccumulator,
    inout vec3 normalAccumulator,
    inout float roughnessAccumulator,
    inout float metalnessAccumulator,
    inout float sampledWeight,
    float layer,
    float weight,
    float minimumWeight,
    vec3 samplePosition,
    vec3 geometricNormal,
    float scale
  ) {
    if (weight <= minimumWeight) return;
    colorAccumulator += sampleHybrid(uBaseColorArray, layer, samplePosition, geometricNormal, scale).rgb * weight;
    ormAccumulator += sampleHybridBasic(uOrmArray, layer, samplePosition, geometricNormal, scale) * weight;
    normalAccumulator += projectedNormal(layer, samplePosition, geometricNormal, scale) * weight;
    roughnessAccumulator += componentAt(uLayerRoughness, layer) * weight;
    metalnessAccumulator += componentAt(uLayerMetalness, layer) * weight;
    sampledWeight += weight;
  }

  void main() {
    vec3 geometricNormal = normalize(vWorldNormal);
    vec4 controlWeights = texture(uControlMap, vChunkUv);
    controlWeights /= max(dot(controlWeights, vec4(1.0)), 0.0001);

    vec4 materialHeights = vec4(
      sampleStochastic2D(uMaterialHeight, vWorldPosition.xz * uLayerScales.x, 0.0, vWorldPosition.xz).r,
      sampleStochastic2D(uMaterialHeight, vWorldPosition.xz * uLayerScales.y, 1.0, vWorldPosition.xz).r,
      sampleStochastic2D(uMaterialHeight, vWorldPosition.xz * uLayerScales.z, 2.0, vWorldPosition.xz).r,
      sampleStochastic2D(uMaterialHeight, vWorldPosition.xz * uLayerScales.w, 3.0, vWorldPosition.xz).r
    );
    vec4 weights = normalizedFourWayWeights(controlWeights, materialHeights);

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float blendedHeight = dot(materialHeights, weights);
    vec3 tangentView = viewDirection - geometricNormal * dot(viewDirection, geometricNormal);
    float tangentLength = length(tangentView);
    if (tangentLength > 0.0001) tangentView /= tangentLength;
    float grazing = 1.0 - abs(dot(viewDirection, geometricNormal));
    vec3 samplePosition = vWorldPosition - tangentView * ((blendedHeight - 0.5) * uParallaxScale * uParallaxEnabled * grazing);

    vec3 color = vec3(0.0);
    vec4 orm = vec4(0.0);
    vec3 detailNormal = vec3(0.0);
    float baseRoughness = 0.0;
    float baseMetalness = 0.0;
    float viewDistance = length(cameraPosition - vWorldPosition);
    float minimumWeight = mix(0.006, 0.045, smoothstep(360.0, 1800.0, viewDistance));
    float sampledWeight = 0.0;
    accumulateLayer(color, orm, detailNormal, baseRoughness, baseMetalness, sampledWeight, 0.0, weights.x, minimumWeight, samplePosition, geometricNormal, uLayerScales.x);
    accumulateLayer(color, orm, detailNormal, baseRoughness, baseMetalness, sampledWeight, 1.0, weights.y, minimumWeight, samplePosition, geometricNormal, uLayerScales.y);
    accumulateLayer(color, orm, detailNormal, baseRoughness, baseMetalness, sampledWeight, 2.0, weights.z, minimumWeight, samplePosition, geometricNormal, uLayerScales.z);
    accumulateLayer(color, orm, detailNormal, baseRoughness, baseMetalness, sampledWeight, 3.0, weights.w, minimumWeight, samplePosition, geometricNormal, uLayerScales.w);
    float sampledWeightInv = 1.0 / max(sampledWeight, 0.0001);
    color *= sampledWeightInv;
    orm *= sampledWeightInv;
    detailNormal *= sampledWeightInv;
    baseRoughness *= sampledWeightInv;
    baseMetalness *= sampledWeightInv;

    float detailFade = 1.0 - smoothstep(160.0, 1550.0, viewDistance) * 0.82;
    detailNormal = normalize(detailNormal);
    vec3 normal = normalize(mix(geometricNormal, detailNormal, uDetailNormalStrength * detailFade));
    float roughness = clamp(baseRoughness * orm.g, 0.08, 1.0);
    float metalness = clamp(baseMetalness + orm.b, 0.0, 1.0);
    float ao = mix(1.0, orm.r, 0.58);

    float macro = texture(uMacroMap, vWorldPosition.xz * 0.00062).r - 0.5;
    float mid = texture(uMacroMap, vWorldPosition.xz * 0.0031 + vec2(0.37, 0.61)).g - 0.5;
    color *= 1.0 + macro * uMacroVariation * 0.78 + mid * uMacroVariation * 0.26;

    vec3 lightDirection = normalize(uSunDirection);
    float nDotL = max(dot(normal, lightDirection), 0.0);
    float hemisphere = normal.y * 0.5 + 0.5;
    vec3 ambient = mix(uGroundColor, uSkyColor, hemisphere) * (0.62 + ao * 0.38);
    vec3 halfVector = normalize(viewDirection + lightDirection);
    float specularPower = mix(8.0, 96.0, 1.0 - roughness);
    float specular = pow(max(dot(normal, halfVector), 0.0), specularPower);
    vec3 f0 = mix(vec3(0.035), color, metalness);
    vec3 lit = color * (ambient + uSunColor * nDotL) + f0 * specular * uSunColor * (1.0 - roughness * 0.75);
    lit = mix(lit, lit * vec3(1.07, 1.12, 1.05), uSelected * 0.12);

    if (uFogDensity > 0.0) {
      float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * viewDistance * viewDistance);
      lit = mix(lit, uFogColor, clamp(fogFactor, 0.0, 1.0));
    }
    gl_FragColor = vec4(lit, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
export class TerrainMaterialLibrary {
  constructor(renderer, config, settings = DEFAULT_MATERIAL_SETTINGS) {
    this.renderer = renderer;
    this.config = config;
    this.settings = cloneMaterialSettings(settings);
    this.materials = new Set();
    this.ktx2Loader = null;
    this.textureSource = 'procedural';
    this.lastKtx2Report = null;
    this.#createFallbackTextures();
  }

  #createFallbackTextures() {
    const tier = QUALITY_TIERS[this.settings.qualityTier] ?? QUALITY_TIERS.high;
    const procedural = createProceduralArrays(PROCEDURAL_RESOLUTION);
    this.baseColorArray = createDataArrayTexture(procedural.baseColor, procedural.size, procedural.size, procedural.depth, {
      color: true,
      anisotropy: Math.min(tier.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
    });
    this.normalArray = createDataArrayTexture(procedural.normal, procedural.size, procedural.size, procedural.depth, {
      anisotropy: Math.min(tier.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
    });
    this.ormArray = createDataArrayTexture(procedural.orm, procedural.size, procedural.size, procedural.depth, {
      anisotropy: Math.min(tier.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
    });
    this.heightArray = createDataArrayTexture(procedural.height, procedural.size, procedural.size, procedural.depth, {
      anisotropy: Math.min(tier.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
    });
    this.macroMap = createMacroTexture();
    this.actualResolution = PROCEDURAL_RESOLUTION;
  }

  createChunkMaterial({ heightMap, controlMap, lodIndex = 0, heightResolution = this.config.sourceResolution, neighborCoarseSteps = null }) {
    const level = this.config.lodLevels[lodIndex] ?? this.config.lodLevels.at(-1);
    const material = new THREE.ShaderMaterial({
      name: 'TerrainPbrArrayMaterial',
      glslVersion: THREE.GLSL3,
      uniforms: {
        uHeightMap: { value: heightMap },
        uControlMap: { value: controlMap },
        uBaseColorArray: { value: this.baseColorArray },
        uNormalArray: { value: this.normalArray },
        uOrmArray: { value: this.ormArray },
        uMaterialHeight: { value: this.heightArray },
        uMacroMap: { value: this.macroMap },
        uLayerScales: { value: new THREE.Vector4(...this.settings.layers.map((layer) => layer.scale)) },
        uDisplacementStrengths: { value: new THREE.Vector4(...this.settings.layers.map((layer) => layer.strength)) },
        uDisplacementLayerMask: { value: new THREE.Vector4(...this.settings.layers.map((layer) => layer.displacementEnabled ? 1 : 0)) },
        uDisplacementCenters: { value: new THREE.Vector4(...this.settings.layers.map((layer) => Number(layer.displacementCenter ?? 0.5))) },
        uDisplacementMode: { value: this.settings.displacementMode === 'vertical' ? 0 : 1 },
        uDisplacementWeightThreshold: { value: this.settings.displacementWeightThreshold },
        uLayerRoughness: { value: new THREE.Vector4(...this.settings.layers.map((layer) => layer.roughness)) },
        uLayerMetalness: { value: new THREE.Vector4(...this.settings.layers.map((layer) => layer.metalness)) },
        uChunkSize: { value: this.config.chunkSize },
        uHeightTexel: { value: 1 / Math.max(heightResolution - 1, 1) },
        uHeightCoreResolution: { value: heightResolution },
        uSkirtDepth: { value: 18 },
        uNeighborCoarseSteps: { value: this.#edgeStepVector(neighborCoarseSteps, lodIndex) },
        uEdgeMorphWidth: { value: 0.12 },
        uDisplacementEnabled: { value: this.settings.displacementEnabled ? 1 : 0 },
        uDisplacementNear: { value: this.settings.displacementNear },
        uDisplacementFar: { value: this.settings.displacementFar },
        uLodDisplacement: { value: level.displacement },
        uLodDetail: { value: level.detail },
        uHeightBlendSharpness: { value: this.settings.heightBlendSharpness },
        uMacroVariation: { value: this.settings.macroVariation },
        uDetailNormalStrength: { value: this.settings.detailNormalStrength },
        uParallaxEnabled: { value: this.settings.parallaxEnabled ? 1 : 0 },
        uParallaxScale: { value: this.settings.parallaxScale },
        uSelected: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.48, 1, 0.31).normalize() },
        uSunColor: { value: new THREE.Color('#fff0cf').multiplyScalar(1.36) },
        uSkyColor: { value: new THREE.Color('#b6d5ee').multiplyScalar(0.72) },
        uGroundColor: { value: new THREE.Color('#514639').multiplyScalar(0.42) },
        uFogDensity: { value: 0 },
        uFogColor: { value: new THREE.Color('#9fb2bd') },
      },
      vertexShader,
      fragmentShader,
      side: THREE.FrontSide,
    });
    material.extensions.derivatives = true;
    this.materials.add(material);
    return material;
  }

  updateChunkMaterial(material, { heightMap, controlMap, lodIndex, heightResolution = this.config.sourceResolution, neighborCoarseSteps = null }) {
    const level = this.config.lodLevels[lodIndex] ?? this.config.lodLevels.at(-1);
    material.uniforms.uHeightMap.value = heightMap;
    material.uniforms.uControlMap.value = controlMap;
    material.uniforms.uHeightTexel.value = 1 / Math.max(heightResolution - 1, 1);
    material.uniforms.uHeightCoreResolution.value = heightResolution;
    material.uniforms.uLodDisplacement.value = level.displacement;
    material.uniforms.uLodDetail.value = level.detail;
    material.uniforms.uNeighborCoarseSteps.value.copy(this.#edgeStepVector(neighborCoarseSteps, lodIndex));
  }

  #edgeStepVector(neighborCoarseSteps = null, lodIndex = 0) {
    const currentLevel = this.config.lodLevels[lodIndex] ?? this.config.lodLevels.at(-1);
    const currentStep = 1 / Math.max(1, Number(currentLevel.segments ?? 1));
    const vector = new THREE.Vector4(0, 0, 0, 0);
    if (!neighborCoarseSteps) return vector;
    const values = [neighborCoarseSteps.left, neighborCoarseSteps.right, neighborCoarseSteps.down, neighborCoarseSteps.up];
    values.forEach((value, index) => {
      const step = Number(value ?? 0);
      vector.setComponent(index, step > currentStep + 1e-9 ? step : 0);
    });
    return vector;
  }

  setEnvironmentLighting({ sunDirection, sunColor, skyColor, groundColor, fogColor, fogDensity } = {}) {
    for (const material of this.materials) {
      const uniforms = material.uniforms;
      if (sunDirection && uniforms.uSunDirection) uniforms.uSunDirection.value.copy(sunDirection).normalize();
      if (sunColor && uniforms.uSunColor) uniforms.uSunColor.value.copy(sunColor);
      if (skyColor && uniforms.uSkyColor) uniforms.uSkyColor.value.copy(skyColor);
      if (groundColor && uniforms.uGroundColor) uniforms.uGroundColor.value.copy(groundColor);
      if (fogColor && uniforms.uFogColor) uniforms.uFogColor.value.copy(fogColor);
      if (Number.isFinite(fogDensity) && uniforms.uFogDensity) uniforms.uFogDensity.value = Math.max(0, fogDensity);
    }
  }

  setPresentationMode() {
    // Presentation mode no longer mutates terrain visibility. The same physically lit
    // terrain is rendered in Editor and FPS; only streaming behavior changes.
  }

  getSettings() {
    return cloneMaterialSettings(this.settings);
  }

  getDiagnostics() {
    return {
      source: this.textureSource,
      actualResolution: this.actualResolution,
      requestedResolution: QUALITY_TIERS[this.settings.qualityTier]?.materialResolution ?? 2048,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
      ktx2: this.lastKtx2Report,
    };
  }

  applySettings(nextSettings) {
    this.settings = cloneMaterialSettings({ ...this.settings, ...nextSettings });
    for (const material of this.materials) {
      material.uniforms.uLayerScales.value.set(...this.settings.layers.map((layer) => layer.scale));
      material.uniforms.uDisplacementStrengths.value.set(...this.settings.layers.map((layer) => layer.strength));
      material.uniforms.uDisplacementLayerMask.value.set(...this.settings.layers.map((layer) => layer.displacementEnabled ? 1 : 0));
      material.uniforms.uDisplacementCenters.value.set(...this.settings.layers.map((layer) => Number(layer.displacementCenter ?? 0.5)));
      material.uniforms.uDisplacementMode.value = this.settings.displacementMode === 'vertical' ? 0 : 1;
      material.uniforms.uDisplacementWeightThreshold.value = this.settings.displacementWeightThreshold;
      material.uniforms.uLayerRoughness.value.set(...this.settings.layers.map((layer) => layer.roughness));
      material.uniforms.uLayerMetalness.value.set(...this.settings.layers.map((layer) => layer.metalness));
      material.uniforms.uDisplacementEnabled.value = this.settings.displacementEnabled ? 1 : 0;
      material.uniforms.uParallaxEnabled.value = this.settings.parallaxEnabled ? 1 : 0;
      material.uniforms.uParallaxScale.value = this.settings.parallaxScale;
      material.uniforms.uDisplacementNear.value = this.settings.displacementNear;
      material.uniforms.uDisplacementFar.value = this.settings.displacementFar;
      material.uniforms.uHeightBlendSharpness.value = this.settings.heightBlendSharpness;
      material.uniforms.uMacroVariation.value = this.settings.macroVariation;
      material.uniforms.uDetailNormalStrength.value = this.settings.detailNormalStrength;
    }
  }

  setLayerStrength(layerIndex, strength) {
    const layers = this.settings.layers.map((layer, index) => index === layerIndex
      ? { ...layer, strength: Number(strength) }
      : { ...layer });
    this.applySettings({ layers });
  }

  setQualityTier(qualityTier) {
    if (!QUALITY_TIERS[qualityTier]) return;
    this.settings.qualityTier = qualityTier;
    const requested = QUALITY_TIERS[qualityTier].materialResolution;
    if (requested > this.renderer.capabilities.maxTextureSize) {
      throw new Error(`כרטיס המסך מדווח על MAX_TEXTURE_SIZE=${this.renderer.capabilities.maxTextureSize}.`);
    }
    const anisotropy = Math.min(
      QUALITY_TIERS[qualityTier].anisotropy,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    for (const texture of [this.baseColorArray, this.normalArray, this.ormArray, this.heightArray]) {
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    }
  }

  async loadKtx2MaterialSet(manifestUrl) {
    const absoluteManifestUrl = new URL(manifestUrl, window.location.href).href;
    const response = await fetch(absoluteManifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`לא ניתן לטעון manifest: HTTP ${response.status}`);
    const parsedManifest = await response.json();
    const manifest = normalizeManifest(parsedManifest, absoluteManifestUrl);
    manifest.manifestUrl = absoluteManifestUrl;

    this.ktx2Loader ??= new KTX2Loader()
      .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/')
      .setWorkerLimit(Math.max(1, Math.min(4, Math.floor(Number(navigator.hardwareConcurrency ?? 8) / 2))))
      .detectSupport(this.renderer);

    const load = (url) => this.ktx2Loader.loadAsync(url);
    let textures = [];
    try {
      textures = await Promise.all(REQUIRED_MANIFEST_TEXTURES.map(([key]) => load(manifest.resolvedUrls[key])));
      const report = validateTextureSet(manifest, textures);
      const tier = QUALITY_TIERS[this.settings.qualityTier] ?? QUALITY_TIERS.high;
      const anisotropy = Math.min(tier.anisotropy, this.renderer.capabilities.getMaxAnisotropy());

      for (const texture of textures) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.wrapR = THREE.ClampToEdgeWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = report.mipLevels > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
      }
      const [baseColor, normal, orm, height] = textures;
      baseColor.colorSpace = THREE.SRGBColorSpace;
      normal.colorSpace = THREE.NoColorSpace;
      orm.colorSpace = THREE.NoColorSpace;
      height.colorSpace = THREE.NoColorSpace;
      for (const texture of textures) texture.needsUpdate = true;

      const previous = [this.baseColorArray, this.normalArray, this.ormArray, this.heightArray];
      [this.baseColorArray, this.normalArray, this.ormArray, this.heightArray] = textures;
      for (const material of this.materials) {
        material.uniforms.uBaseColorArray.value = baseColor;
        material.uniforms.uNormalArray.value = normal;
        material.uniforms.uOrmArray.value = orm;
        material.uniforms.uMaterialHeight.value = height;
      }
      for (const texture of previous) texture.dispose();
      this.textureSource = 'ktx2-array';
      this.actualResolution = report.resolution;
      this.lastKtx2Report = report;
      return this.getDiagnostics();
    } catch (error) {
      for (const texture of textures) texture?.dispose?.();
      this.lastKtx2Report = {
        valid: false,
        manifestUrl: absoluteManifestUrl,
        error: error.message,
      };
      throw error;
    }
  }

  #installArrayTextures({ baseColor, normal, orm, height, resolution, source, report = null }) {
    const previous = [this.baseColorArray, this.normalArray, this.ormArray, this.heightArray];
    this.baseColorArray = baseColor;
    this.normalArray = normal;
    this.ormArray = orm;
    this.heightArray = height;
    for (const material of this.materials) {
      material.uniforms.uBaseColorArray.value = baseColor;
      material.uniforms.uNormalArray.value = normal;
      material.uniforms.uOrmArray.value = orm;
      material.uniforms.uMaterialHeight.value = height;
    }
    for (const texture of previous) texture?.dispose?.();
    this.textureSource = source;
    this.actualResolution = resolution;
    this.lastKtx2Report = report;
    return this.getDiagnostics();
  }

  applyBuiltInMaterialPack(packId) {
    const pack = BUILTIN_TERRAIN_MATERIAL_PACKS[packId] ?? BUILTIN_TERRAIN_MATERIAL_PACKS.mediterranean;
    const tier = QUALITY_TIERS[this.settings.qualityTier] ?? QUALITY_TIERS.high;
    const requested = Math.min(tier.materialResolution, this.renderer.capabilities.maxTextureSize, 512);
    const resolution = Math.max(PROCEDURAL_RESOLUTION, requested);
    const procedural = createProceduralArrays(resolution, pack.palette);
    const anisotropy = Math.min(tier.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    const baseColor = createDataArrayTexture(procedural.baseColor, resolution, resolution, LAYER_COUNT, { color: true, anisotropy });
    const normal = createDataArrayTexture(procedural.normal, resolution, resolution, LAYER_COUNT, { anisotropy });
    const orm = createDataArrayTexture(procedural.orm, resolution, resolution, LAYER_COUNT, { anisotropy });
    const height = createDataArrayTexture(procedural.height, resolution, resolution, LAYER_COUNT, { anisotropy });
    return this.#installArrayTextures({ baseColor, normal, orm, height, resolution, source: `builtin-pack:${pack.id}` });
  }

  applyImportedMaterialArrays({ baseColorData, normalData, ormData, heightData, resolution, packId = 'imported' }) {
    const tier = QUALITY_TIERS[this.settings.qualityTier] ?? QUALITY_TIERS.high;
    const anisotropy = Math.min(tier.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    const baseColor = createDataArrayTexture(baseColorData, resolution, resolution, LAYER_COUNT, { color: true, anisotropy });
    const normal = createDataArrayTexture(normalData, resolution, resolution, LAYER_COUNT, { anisotropy });
    const orm = createDataArrayTexture(ormData, resolution, resolution, LAYER_COUNT, { anisotropy });
    const height = createDataArrayTexture(heightData, resolution, resolution, LAYER_COUNT, { anisotropy });
    return this.#installArrayTextures({ baseColor, normal, orm, height, resolution, source: `material-pack:${packId}` });
  }

  applyMaterialPackLayerSettings(packLayers = []) {
    if (!Array.isArray(packLayers) || packLayers.length !== LAYER_COUNT) return this.getSettings();
    const layers = this.settings.layers.map((current, index) => {
      const source = packLayers[index] ?? {};
      return {
        ...current,
        id: source.id ?? current.id,
        label: source.label ?? current.label,
        scale: Number(source.scale ?? current.scale),
        strength: Number(source.strength ?? current.strength),
        displacementEnabled: source.displacementEnabled ?? current.displacementEnabled ?? false,
        displacementCenter: Number(source.displacementCenter ?? current.displacementCenter ?? 0.5),
        roughness: Number(source.roughness ?? current.roughness),
        metalness: Number(source.metalness ?? current.metalness),
      };
    });
    this.applySettings({
      layers,
      // Height maps remain available for parallax and optional true vertex displacement.
      // Applying a material pack must not silently disable the user's geometry settings.
      displacementEnabled: this.settings.displacementEnabled,
      parallaxEnabled: true,
      parallaxScale: Math.min(Number(this.settings.parallaxScale ?? 0.025), 0.025),
      heightBlendSharpness: Math.min(Number(this.settings.heightBlendSharpness ?? 0.22), 0.22),
      detailNormalStrength: Math.min(Number(this.settings.detailNormalStrength ?? 0.38), 0.38),
    });
    return this.getSettings();
  }

  setWireframe(enabled) {
    for (const material of this.materials) material.wireframe = enabled;
  }

  disposeMaterial(material) {
    this.materials.delete(material);
    material.dispose();
  }

  dispose() {
    for (const material of this.materials) material.dispose();
    this.materials.clear();
    for (const texture of [this.baseColorArray, this.normalArray, this.ormArray, this.heightArray, this.macroMap]) {
      texture?.dispose?.();
    }
    this.ktx2Loader?.dispose();
  }
}
