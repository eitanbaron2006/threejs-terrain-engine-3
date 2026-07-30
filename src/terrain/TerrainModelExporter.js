import * as THREE from 'three';

const DETAIL_SEGMENTS = Object.freeze({
  draft: 16,
  standard: 32,
  high: 64,
});

const EXPORT_DESCRIPTORS = Object.freeze({
  glb: Object.freeze({ extension: 'glb', mimeType: 'model/gltf-binary', binary: true }),
  fbx: Object.freeze({ extension: 'fbx', mimeType: 'application/octet-stream', binary: true }),
  obj: Object.freeze({ extension: 'obj', mimeType: 'text/plain', binary: false }),
  stl: Object.freeze({ extension: 'stl', mimeType: 'model/stl', binary: true }),
  ply: Object.freeze({ extension: 'ply', mimeType: 'application/octet-stream', binary: true }),
});

const FBX_PRESETS = new Set(['blender', 'unity', 'unreal', 'threejs']);
const DEFAULT_LAYER_COLORS = Object.freeze([
  '#c3aa72',
  '#49683b',
  '#765039',
  '#777a78',
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeTerrainExportOptions(options = {}) {
  const requestedFormat = String(options.format ?? '').toLowerCase();
  const requestedDetail = String(options.detail ?? '').toLowerCase();
  const requestedPreset = String(options.fbxPreset ?? '').toLowerCase();
  const format = Object.hasOwn(EXPORT_DESCRIPTORS, requestedFormat) ? requestedFormat : 'glb';
  const detail = Object.hasOwn(DETAIL_SEGMENTS, requestedDetail) ? requestedDetail : 'standard';
  return {
    format,
    detail,
    segmentsPerChunk: DETAIL_SEGMENTS[detail],
    fbxPreset: FBX_PRESETS.has(requestedPreset) ? requestedPreset : 'blender',
    vertexColors: options.vertexColors !== false,
  };
}

export function getTerrainExportDescriptor(format) {
  const normalized = String(format ?? '').toLowerCase();
  return { ...(EXPORT_DESCRIPTORS[normalized] ?? EXPORT_DESCRIPTORS.glb) };
}

function sampleControlWeights(chunk, worldX, worldZ) {
  const resolution = Number(chunk.resolution);
  const control = chunk.controlData;
  if (!control || !Number.isInteger(resolution) || resolution < 2) return [0.25, 0.25, 0.25, 0.25];

  const chunkSize = Number(chunk.config?.chunkSize ?? 1);
  const gridX = clamp(((worldX - chunk.originX) / chunkSize) * (resolution - 1), 0, resolution - 1);
  const gridZ = clamp(((worldZ - chunk.originZ) / chunkSize) * (resolution - 1), 0, resolution - 1);
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(x0 + 1, resolution - 1);
  const z1 = Math.min(z0 + 1, resolution - 1);
  const tx = gridX - x0;
  const tz = gridZ - z0;
  const weights = [0, 0, 0, 0];

  for (let channel = 0; channel < 4; channel += 1) {
    const at = (x, z) => control[(z * resolution + x) * 4 + channel] / 255;
    const top = THREE.MathUtils.lerp(at(x0, z0), at(x1, z0), tx);
    const bottom = THREE.MathUtils.lerp(at(x0, z1), at(x1, z1), tx);
    weights[channel] = THREE.MathUtils.lerp(top, bottom, tz);
  }

  const sum = weights.reduce((total, value) => total + value, 0);
  if (sum <= 1e-6) return [0.25, 0.25, 0.25, 0.25];
  return weights.map((value) => value / sum);
}

function createLayerPalette(layerColors = DEFAULT_LAYER_COLORS) {
  return Array.from({ length: 4 }, (_, index) => new THREE.Color(
    layerColors[index] ?? DEFAULT_LAYER_COLORS[index],
  ));
}

export function buildTerrainExportMesh(world, options = {}) {
  const chunks = [...(world?.chunks?.values?.() ?? [])]
    .filter((chunk) => chunk && Number.isFinite(chunk.originX) && Number.isFinite(chunk.originZ))
    .sort((a, b) => a.chunkZ - b.chunkZ || a.chunkX - b.chunkX);
  if (!chunks.length) throw new Error('No loaded terrain chunks are available for export.');

  const normalized = normalizeTerrainExportOptions(options);
  const requestedSegments = Number(options.segmentsPerChunk);
  const segments = Number.isInteger(requestedSegments) && requestedSegments >= 1 && requestedSegments <= 128
    ? requestedSegments
    : normalized.segmentsPerChunk;
  const verticesPerChunk = (segments + 1) ** 2;
  const vertexCount = chunks.length * verticesPerChunk;
  const indexCount = chunks.length * segments * segments * 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = normalized.vertexColors ? new Float32Array(vertexCount * 3) : null;
  const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const palette = createLayerPalette(options.layerColors);
  const normal = new THREE.Vector3();

  const minX = Math.min(...chunks.map((chunk) => chunk.originX));
  const minZ = Math.min(...chunks.map((chunk) => chunk.originZ));
  const maxX = Math.max(...chunks.map((chunk) => chunk.originX + Number(chunk.config.chunkSize)));
  const maxZ = Math.max(...chunks.map((chunk) => chunk.originZ + Number(chunk.config.chunkSize)));
  const worldWidth = Math.max(maxX - minX, 1);
  const worldDepth = Math.max(maxZ - minZ, 1);
  let vertexOffset = 0;
  let indexOffset = 0;

  chunks.forEach((chunk, chunkIndex) => {
    const chunkSize = Number(chunk.config.chunkSize);
    const step = chunkSize / segments;
    for (let z = 0; z <= segments; z += 1) {
      const worldZ = chunk.originZ + z * step;
      for (let x = 0; x <= segments; x += 1) {
        const worldX = chunk.originX + x * step;
        const vertexIndex = vertexOffset + z * (segments + 1) + x;
        const positionOffset = vertexIndex * 3;
        const height = chunk.sampleHeight(worldX, worldZ);
        positions[positionOffset] = worldX;
        positions[positionOffset + 1] = height;
        positions[positionOffset + 2] = worldZ;

        normal.set(
          world.sampleHeight(worldX - step, worldZ) - world.sampleHeight(worldX + step, worldZ),
          step * 2,
          world.sampleHeight(worldX, worldZ - step) - world.sampleHeight(worldX, worldZ + step),
        ).normalize();
        normals[positionOffset] = normal.x;
        normals[positionOffset + 1] = normal.y;
        normals[positionOffset + 2] = normal.z;

        const uvOffset = vertexIndex * 2;
        uvs[uvOffset] = (worldX - minX) / worldWidth;
        uvs[uvOffset + 1] = (worldZ - minZ) / worldDepth;

        if (colors) {
          const weights = sampleControlWeights(chunk, worldX, worldZ);
          colors[positionOffset] = weights.reduce((value, weight, index) => value + palette[index].r * weight, 0);
          colors[positionOffset + 1] = weights.reduce((value, weight, index) => value + palette[index].g * weight, 0);
          colors[positionOffset + 2] = weights.reduce((value, weight, index) => value + palette[index].b * weight, 0);
        }
      }
    }

    for (let z = 0; z < segments; z += 1) {
      for (let x = 0; x < segments; x += 1) {
        const topLeft = vertexOffset + z * (segments + 1) + x;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + segments + 1;
        const bottomRight = bottomLeft + 1;
        indices[indexOffset++] = topLeft;
        indices[indexOffset++] = bottomLeft;
        indices[indexOffset++] = topRight;
        indices[indexOffset++] = topRight;
        indices[indexOffset++] = bottomLeft;
        indices[indexOffset++] = bottomRight;
      }
    }

    vertexOffset += verticesPerChunk;
    options.onProgress?.({
      phase: 'geometry',
      completed: chunkIndex + 1,
      total: chunks.length,
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.terrainExport = {
    chunkCount: chunks.length,
    segmentsPerChunk: segments,
    vertexCount,
    triangleCount: indexCount / 3,
  };

  const material = new THREE.MeshStandardMaterial({
    name: 'TerrainExportMaterial',
    color: normalized.vertexColors ? 0xffffff : 0x70765e,
    vertexColors: normalized.vertexColors,
    roughness: 0.88,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Terrain';
  mesh.userData.units = 'metres';
  return mesh;
}

export function createTerrainExportFilename(name = 'terrain', format = 'glb', timestamp = Date.now()) {
  const descriptor = getTerrainExportDescriptor(format);
  const safeName = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'terrain';
  return `${safeName}-${Math.max(0, Math.floor(Number(timestamp) || 0))}.${descriptor.extension}`;
}

export async function serializeTerrainMesh(mesh, options = {}) {
  if (!mesh?.isMesh || !mesh.geometry?.getAttribute?.('position')) {
    throw new Error('A baked terrain mesh is required for model export.');
  }
  const normalized = normalizeTerrainExportOptions(options);
  const descriptor = getTerrainExportDescriptor(normalized.format);
  let data;

  if (normalized.format === 'glb') {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    data = await new GLTFExporter().parseAsync(mesh, {
      binary: true,
      onlyVisible: true,
      trs: false,
    });
  } else if (normalized.format === 'fbx') {
    const { FBXExporter } = await import('@comfyorg/fbx-exporter-three');
    data = new FBXExporter().parseSync(mesh, {
      preset: normalized.fbxPreset,
      embedTextures: false,
      includeAnimations: false,
      onlyVisible: true,
      creator: 'Terrain Engine 3.11.6',
    });
  } else if (normalized.format === 'obj') {
    const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
    data = new OBJExporter().parse(mesh);
  } else if (normalized.format === 'stl') {
    const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
    data = new STLExporter().parse(mesh, { binary: true });
  } else {
    const { PLYExporter } = await import('three/addons/exporters/PLYExporter.js');
    data = new PLYExporter().parse(mesh, null, {
      binary: true,
      littleEndian: true,
    });
  }

  return { data, ...descriptor };
}

export function downloadTerrainExport(result, filename) {
  if (!result?.data) throw new Error('Terrain export data is empty.');
  const blob = new Blob([result.data], { type: result.mimeType ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.hidden = true;
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function disposeTerrainExportMesh(mesh) {
  mesh?.geometry?.dispose?.();
  if (Array.isArray(mesh?.material)) {
    for (const material of mesh.material) material?.dispose?.();
  } else {
    mesh?.material?.dispose?.();
  }
}
