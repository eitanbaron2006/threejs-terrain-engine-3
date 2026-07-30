import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTerrainExportMesh,
  createTerrainExportFilename,
  getTerrainExportDescriptor,
  normalizeTerrainExportOptions,
  serializeTerrainMesh,
} from '../src/terrain/TerrainModelExporter.js';

function createChunk(chunkX, channel) {
  const resolution = 3;
  const controlData = new Uint8Array(resolution * resolution * 4);
  for (let index = 0; index < resolution * resolution; index += 1) {
    controlData[index * 4 + channel] = 255;
  }
  return {
    chunkX,
    chunkZ: 0,
    key: `${chunkX},0`,
    resolution,
    originX: chunkX * 2 - 1,
    originZ: -1,
    config: { chunkSize: 2 },
    controlData,
    sampleHeight(worldX, worldZ) {
      return worldX * 2 + worldZ * 3;
    },
  };
}

function createWorld() {
  const chunks = [createChunk(0, 0), createChunk(1, 3)];
  return {
    chunks: new Map(chunks.map((chunk) => [chunk.key, chunk])),
    sampleHeight(worldX, worldZ) {
      return worldX * 2 + worldZ * 3;
    },
  };
}

test('terrain export options normalize format, detail, target and colors', () => {
  assert.deepEqual(normalizeTerrainExportOptions({
    format: 'FBX',
    detail: 'high',
    fbxPreset: 'UNREAL',
    vertexColors: false,
  }), {
    format: 'fbx',
    detail: 'high',
    segmentsPerChunk: 64,
    fbxPreset: 'unreal',
    vertexColors: false,
  });
  assert.deepEqual(normalizeTerrainExportOptions({
    format: 'unknown',
    detail: 'unknown',
    fbxPreset: 'unknown',
  }), {
    format: 'glb',
    detail: 'standard',
    segmentsPerChunk: 32,
    fbxPreset: 'blender',
    vertexColors: true,
  });
});

test('baked terrain mesh contains real heights, normals, UVs, indices and layer colors', () => {
  const mesh = buildTerrainExportMesh(createWorld(), {
    detail: 'draft',
    segmentsPerChunk: 2,
    vertexColors: true,
  });
  const { geometry } = mesh;
  assert.equal(geometry.getAttribute('position').count, 18);
  assert.equal(geometry.getAttribute('normal').count, 18);
  assert.equal(geometry.getAttribute('uv').count, 18);
  assert.equal(geometry.getAttribute('color').count, 18);
  assert.equal(geometry.index.count, 48);

  const positions = geometry.getAttribute('position');
  assert.deepEqual(
    [positions.getX(0), positions.getY(0), positions.getZ(0)],
    [-1, -5, -1],
  );
  assert.ok(Math.abs(geometry.getAttribute('normal').getY(0) - (1 / Math.sqrt(14))) < 1e-6);

  const colors = geometry.getAttribute('color');
  assert.notDeepEqual(
    [colors.getX(0), colors.getY(0), colors.getZ(0)],
    [colors.getX(9), colors.getY(9), colors.getZ(9)],
  );
  assert.equal(mesh.material.vertexColors, true);
  assert.equal(mesh.name, 'Terrain');
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('terrain export rejects an empty world', () => {
  assert.throws(
    () => buildTerrainExportMesh({ chunks: new Map(), sampleHeight: () => 0 }),
    /no loaded terrain chunks/i,
  );
});

test('terrain export descriptors use interoperable extensions and MIME types', () => {
  assert.deepEqual(getTerrainExportDescriptor('glb'), {
    extension: 'glb',
    mimeType: 'model/gltf-binary',
    binary: true,
  });
  assert.deepEqual(getTerrainExportDescriptor('obj'), {
    extension: 'obj',
    mimeType: 'text/plain',
    binary: false,
  });
  assert.equal(getTerrainExportDescriptor('fbx').extension, 'fbx');
  assert.equal(getTerrainExportDescriptor('stl').binary, true);
  assert.equal(getTerrainExportDescriptor('ply').binary, true);
});

test('terrain export filename is safe and uses the selected extension', () => {
  assert.equal(
    createTerrainExportFilename('My Terrain / Island', 'fbx', 1234),
    'my-terrain-island-1234.fbx',
  );
});

test('terrain mesh serializes to every supported portable format', async () => {
  if (!globalThis.FileReader) {
    globalThis.FileReader = class FileReader {
      readAsArrayBuffer(blob) {
        blob.arrayBuffer().then((result) => {
          this.result = result;
          this.onloadend?.();
        });
      }
    };
  }

  const formats = ['glb', 'fbx', 'obj', 'stl', 'ply'];
  for (const format of formats) {
    const mesh = buildTerrainExportMesh(createWorld(), {
      segmentsPerChunk: 1,
      format,
    });
    const result = await serializeTerrainMesh(mesh, { format, fbxPreset: 'blender' });
    assert.equal(result.extension, format);
    assert.ok(result.data.byteLength ?? result.data.length > 0);
    if (format === 'glb') {
      assert.equal(new DataView(result.data).getUint32(0, true), 0x46546c67);
    } else if (format === 'fbx') {
      assert.match(new TextDecoder().decode(result.data.subarray(0, 18)), /Kaydara FBX Binary/);
    } else if (format === 'obj') {
      assert.match(result.data, /^o Terrain/m);
      assert.match(result.data, /^v /m);
      assert.match(result.data, /^f /m);
    }
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});
