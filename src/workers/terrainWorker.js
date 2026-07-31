import { generateTerrainChunkData } from '../terrain/TerrainGenerationService.js';

export function handleTerrainWorkerMessage(data) {
  const {
    id,
    type,
    descriptor,
    config,
    settings,
    materialSelector,
  } = data;
  if (type !== 'generate-chunk') return null;
  try {
    const generation = generateTerrainChunkData(
      descriptor,
      config,
      settings,
      materialSelector,
    );
    const {
      resolution,
      minHeight,
      maxHeight,
      heights,
      heightTextureData,
      heightTextureResolution,
      control,
    } = generation;

    const message = {
      id,
      type: 'chunk-result',
      descriptor,
      resolution,
      minHeight,
      maxHeight,
      heights: heights.buffer,
      heightTextureData: heightTextureData.buffer,
      heightTextureResolution,
      control: control.buffer,
    };
    return {
      message,
      transfer: [message.heights, message.heightTextureData, message.control],
    };
  } catch (error) {
    return {
      message: { id, type: 'error', message: error.message, stack: error.stack },
      transfer: [],
    };
  }
}

const workerScope = (
  typeof self !== 'undefined'
  && typeof WorkerGlobalScope !== 'undefined'
  && self instanceof WorkerGlobalScope
) ? self : null;

workerScope?.addEventListener('message', (event) => {
  const result = handleTerrainWorkerMessage(event.data);
  if (result) workerScope.postMessage(result.message, result.transfer);
});
