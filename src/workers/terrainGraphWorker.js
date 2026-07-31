import { createTerrainHeightSampler } from '../terrain/noise.js';
import {
  colorizeTerrainPreview,
  sampleTerrainPreviewData,
} from '../terrain/TerrainGraphPreview.js';

const workerCache = {
  revision: -1,
  data: null,
};

export function handleTerrainGraphPreviewMessage(data, cache = workerCache) {
  if (data?.type === 'render') {
    const sample = createTerrainHeightSampler({
      ...data.settings,
      terrainProgram: data.terrainProgram,
    });
    cache.data = sampleTerrainPreviewData({
      width: data.width,
      height: data.height,
      worldSize: data.worldSize,
      waterLevel: data.waterLevel,
      seed: data.settings?.seed,
      materialSelector: data.materialProgram ?? data.settings?.splatPreset ?? 'mediterranean',
      sample,
    });
    cache.revision = data.revision;
  } else if (data?.type !== 'recolor' || data.revision !== cache.revision || !cache.data) {
    return null;
  }

  const colored = colorizeTerrainPreview(
    cache.data,
    data.mode ?? 'height',
    data.materialLayers,
  );
  return {
    type: 'preview-result',
    revision: cache.revision,
    width: cache.data.width,
    height: cache.data.height,
    minHeight: colored.minHeight,
    maxHeight: colored.maxHeight,
    mode: colored.mode,
    legend: colored.legend,
    pixels: colored.pixels.buffer,
  };
}

globalThis.self?.addEventListener?.('message', (event) => {
  if (event.data?.type !== 'render' && event.data?.type !== 'recolor') return;
  try {
    const result = handleTerrainGraphPreviewMessage(event.data);
    if (result) globalThis.self.postMessage(result, [result.pixels]);
  } catch (error) {
    globalThis.self.postMessage({
      type: 'preview-result',
      revision: event.data?.revision,
      error: error.message,
    });
  }
});
