import { createTerrainHeightSampler } from '../terrain/noise.js';
import { renderTerrainPreviewPixels } from '../terrain/TerrainGraphPreview.js';

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'render') return;
  const { revision, program, settings, width, height, worldSize, waterLevel } = event.data;
  try {
    const sample = createTerrainHeightSampler({ ...settings, terrainProgram: program });
    const preview = renderTerrainPreviewPixels({
      width,
      height,
      worldSize,
      waterLevel,
      sample,
    });
    self.postMessage({
      type: 'preview-result',
      revision,
      width,
      height,
      minHeight: preview.minHeight,
      maxHeight: preview.maxHeight,
      pixels: preview.pixels.buffer,
    }, [preview.pixels.buffer]);
  } catch (error) {
    self.postMessage({
      type: 'preview-result',
      revision,
      error: error.message,
    });
  }
});
