function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeTypedArray(array) {
  return bytesToBase64(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

function decodeFloat32(value) {
  const bytes = base64ToBytes(value);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function decodeUint8(value) {
  return base64ToBytes(value);
}

function encodeChunk(state) {
  return {
    key: state.key,
    chunkX: state.chunkX,
    chunkZ: state.chunkZ,
    resolution: state.resolution ?? Math.round(Math.sqrt(state.heights.length)),
    heights: encodeTypedArray(state.heights),
    controlData: encodeTypedArray(state.controlData),
    autoControlData: encodeTypedArray(state.autoControlData ?? state.controlData),
    manualWeights: encodeTypedArray(state.manualWeights),
    manualMask: encodeTypedArray(state.manualMask),
    minHeight: state.minHeight,
    maxHeight: state.maxHeight,
  };
}

function decodeChunk(item) {
  return {
    key: item.key,
    chunkX: item.chunkX,
    chunkZ: item.chunkZ,
    resolution: item.resolution ?? null,
    heights: decodeFloat32(item.heights),
    controlData: decodeUint8(item.controlData),
    autoControlData: decodeUint8(item.autoControlData ?? item.controlData),
    manualWeights: decodeUint8(item.manualWeights),
    manualMask: decodeUint8(item.manualMask),
    minHeight: item.minHeight,
    maxHeight: item.maxHeight,
  };
}

export class TerrainSerializer {
  static createProject({ world, config, generatorSettings, streamingSettings, spawnPoint, materialSettings, waterSettings, environmentSettings, materialPackId, materialPackDefinition = null, terrainGraph = null }) {
    const savedGeneratorSettings = { ...generatorSettings };
    delete savedGeneratorSettings.terrainProgram;
    delete savedGeneratorSettings.materialProgram;
    return {
      format: 'threejs-large-terrain-project',
      version: 3,
      createdAt: new Date().toISOString(),
      config: { ...config, lodLevels: config.lodLevels.map((level) => ({ ...level, maxDistance: Number.isFinite(level.maxDistance) ? level.maxDistance : null })) },
      generatorSettings: savedGeneratorSettings,
      terrainGraph: terrainGraph ? structuredClone(terrainGraph) : null,
      streamingSettings: { ...streamingSettings },
      presetId: world.presetId,
      spawnPoint: spawnPoint ? { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z } : null,
      materialSettings,
      waterSettings: waterSettings ? { ...waterSettings } : null,
      environmentSettings: environmentSettings ? { ...environmentSettings } : null,
      materialPackId: materialPackId ?? null,
      materialPackDefinition: materialPackDefinition ? structuredClone(materialPackDefinition) : null,
      modifiedChunks: world.getModifiedStates().map(encodeChunk),
    };
  }

  static applyProject(project, { world, config }) {
    if (project?.format !== 'threejs-large-terrain-project' || project.version !== 3) {
      throw new Error('קובץ הפרויקט אינו בפורמט Terrain Engine 3.');
    }
    if (project.config.chunkSize !== config.chunkSize || project.config.sourceResolution !== config.sourceResolution) {
      throw new Error('Chunk Size או Height Resolution שונים מהפרויקט הנוכחי.');
    }
    const nextGeneratorSettings = { ...world.generatorSettings, ...project.generatorSettings };
    if (typeof world.setGeneratorSettings === 'function') world.setGeneratorSettings(nextGeneratorSettings);
    else world.generatorSettings = nextGeneratorSettings;
    world.presetId = project.presetId ?? 'mediterranean';
    world.importModifiedStates((project.modifiedChunks ?? []).map(decodeChunk));
    return {
      generatorSettings: project.generatorSettings,
      terrainGraph: project.terrainGraph ? structuredClone(project.terrainGraph) : null,
      streamingSettings: project.streamingSettings,
      presetId: world.presetId,
      spawnPoint: project.spawnPoint,
      materialSettings: project.materialSettings,
      waterSettings: project.waterSettings,
      environmentSettings: project.environmentSettings,
      materialPackId: project.materialPackId,
      materialPackDefinition: project.materialPackDefinition ?? null,
    };
  }

  static download(project, filename = 'terrain-engine-3-project.json') {
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
