import { compileTerrainPipeline } from './TerrainGraphCompiler.js';
import { analyzeTerrainSurface } from './TerrainSurfaceAnalysis.js';
import { writeAutoWeights } from './noise.js';

export const TERRAIN_PREVIEW_MODES = Object.freeze([
  'height',
  'materials',
  'slope',
  'moisture',
  'erosion',
]);

const DEFAULT_LAYER_COLORS = Object.freeze([
  { id: 'sand', label: 'Sand', color: [190, 164, 111] },
  { id: 'grass', label: 'Grass', color: [72, 108, 63] },
  { id: 'soil', label: 'Soil', color: [108, 76, 52] },
  { id: 'rock', label: 'Rock', color: [115, 119, 123] },
]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function mixColor(a, b, factor) {
  const t = clamp01(factor);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function waterColor(height, waterLevel) {
  const depth = clamp01((waterLevel - height) / 150);
  return mixColor([32, 126, 153], [5, 31, 66], Math.pow(depth, 0.62));
}

function scalarColor(value, low, high) {
  return mixColor(low, high, clamp01(value));
}

function writePixel(pixels, index, color, lighting = 1) {
  const offset = index * 4;
  pixels[offset] = Math.round(clamp01(color[0] / 255 * lighting) * 255);
  pixels[offset + 1] = Math.round(clamp01(color[1] / 255 * lighting) * 255);
  pixels[offset + 2] = Math.round(clamp01(color[2] / 255 * lighting) * 255);
  pixels[offset + 3] = 255;
}

export function sampleTerrainPreviewData({
  width,
  height,
  worldSize,
  waterLevel,
  seed = 1337,
  sample,
  materialSelector = 'mediterranean',
}) {
  const safeWidth = Math.max(2, Math.round(width));
  const safeHeight = Math.max(2, Math.round(height));
  const haloWidth = safeWidth + 2;
  const haloHeight = safeHeight + 2;
  const worldStepX = worldSize / Math.max(1, safeWidth - 1);
  const worldStepZ = worldSize / Math.max(1, safeHeight - 1);
  const halo = new Float32Array(haloWidth * haloHeight);
  const heights = new Float32Array(safeWidth * safeHeight);
  const slope = new Float32Array(safeWidth * safeHeight);
  const slopeDegrees = new Float32Array(safeWidth * safeHeight);
  const moisture = new Float32Array(safeWidth * safeHeight);
  const erosion = new Float32Array(safeWidth * safeHeight);
  const lighting = new Float32Array(safeWidth * safeHeight);
  const materialWeights = new Float32Array(safeWidth * safeHeight * 4);
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let hz = 0; hz < haloHeight; hz += 1) {
    const z = hz - 1;
    const worldZ = (z / (safeHeight - 1) - 0.5) * worldSize;
    for (let hx = 0; hx < haloWidth; hx += 1) {
      const x = hx - 1;
      const worldX = (x / (safeWidth - 1) - 0.5) * worldSize;
      halo[hz * haloWidth + hx] = sample(worldX, worldZ);
    }
  }

  const getHalo = (x, z) => halo[(z + 1) * haloWidth + x + 1];
  for (let z = 0; z < safeHeight; z += 1) {
    const worldZ = (z / (safeHeight - 1) - 0.5) * worldSize;
    for (let x = 0; x < safeWidth; x += 1) {
      const index = z * safeWidth + x;
      const worldX = (x / (safeWidth - 1) - 0.5) * worldSize;
      const center = getHalo(x, z);
      const surface = analyzeTerrainSurface({
        center,
        left: getHalo(x - 1, z),
        right: getHalo(x + 1, z),
        down: getHalo(x, z - 1),
        up: getHalo(x, z + 1),
        step: (worldStepX + worldStepZ) * 0.5,
        worldX,
        worldZ,
        seed,
        waterLevel,
      });
      heights[index] = center;
      slope[index] = surface.slopeNormalized ?? clamp01(surface.slopeDegrees / 90);
      slopeDegrees[index] = surface.slopeDegrees;
      moisture[index] = surface.moisture;
      erosion[index] = surface.erosion;
      const dx = (getHalo(x + 1, z) - getHalo(x - 1, z)) / Math.max(worldStepX * 2, 0.001);
      const dz = (getHalo(x, z + 1) - getHalo(x, z - 1)) / Math.max(worldStepZ * 2, 0.001);
      const diffuse = (-dx * -0.45 + 0.82 - dz * -0.35) / Math.hypot(dx, 1, dz);
      lighting[index] = clamp01(0.68 + clamp01(diffuse) * 0.42);
      writeAutoWeights(
        materialWeights,
        index * 4,
        center,
        surface.slopeDegrees,
        surface.variation,
        materialSelector,
        1,
        surface,
      );
      minHeight = Math.min(minHeight, center);
      maxHeight = Math.max(maxHeight, center);
    }
  }

  return {
    width: safeWidth,
    height: safeHeight,
    waterLevel,
    minHeight,
    maxHeight,
    heights,
    slope,
    slopeDegrees,
    moisture,
    erosion,
    lighting,
    materialWeights,
  };
}

function modeLegend(mode, layers, cache) {
  if (mode === 'materials') {
    return layers.map((layer, index) => ({
      label: layer.label ?? layer.id ?? `Layer ${index + 1}`,
      color: layer.color,
    }));
  }
  if (mode === 'height') {
    return [
      { label: `${cache.minHeight.toFixed(1)} m`, color: [38, 63, 87] },
      { label: `${cache.maxHeight.toFixed(1)} m`, color: [235, 235, 235] },
    ];
  }
  if (mode === 'slope') {
    return [
      { label: '0° Flat', color: [20, 24, 29] },
      { label: '90° Steep', color: [239, 242, 244] },
    ];
  }
  if (mode === 'moisture') {
    return [
      { label: 'Dry', color: [180, 121, 63] },
      { label: 'Wet', color: [32, 151, 157] },
    ];
  }
  return [
    { label: 'Stable', color: [31, 35, 40] },
    { label: 'Eroded', color: [242, 163, 55] },
  ];
}

export function colorizeTerrainPreview(cache, mode = 'height', materialLayers = DEFAULT_LAYER_COLORS) {
  if (!TERRAIN_PREVIEW_MODES.includes(mode)) {
    throw new Error(`Unknown terrain preview mode "${mode}".`);
  }
  const layers = Array.from({ length: 4 }, (_, index) => {
    const source = materialLayers[index] ?? DEFAULT_LAYER_COLORS[index];
    return {
      id: source.id ?? DEFAULT_LAYER_COLORS[index].id,
      label: source.label ?? DEFAULT_LAYER_COLORS[index].label,
      color: Array.isArray(source.color) ? source.color.slice(0, 3) : DEFAULT_LAYER_COLORS[index].color,
    };
  });
  const pixels = new Uint8ClampedArray(cache.width * cache.height * 4);
  const landRange = Math.max(1, cache.maxHeight - Math.max(cache.waterLevel, cache.minHeight));

  for (let index = 0; index < cache.heights.length; index += 1) {
    const height = cache.heights[index];
    if (height < cache.waterLevel) {
      writePixel(pixels, index, waterColor(height, cache.waterLevel), mode === 'height' ? 1 : 0.82);
      continue;
    }

    let color;
    let light = mode === 'height' || mode === 'materials' ? cache.lighting[index] : 1;
    if (mode === 'materials') {
      color = [0, 0, 0];
      for (let channel = 0; channel < 4; channel += 1) {
        const weight = cache.materialWeights[index * 4 + channel];
        color[0] += layers[channel].color[0] * weight;
        color[1] += layers[channel].color[1] * weight;
        color[2] += layers[channel].color[2] * weight;
      }
    } else if (mode === 'slope') {
      color = scalarColor(cache.slope[index], [20, 24, 29], [239, 242, 244]);
    } else if (mode === 'moisture') {
      color = scalarColor(cache.moisture[index], [180, 121, 63], [32, 151, 157]);
    } else if (mode === 'erosion') {
      color = scalarColor(cache.erosion[index], [31, 35, 40], [242, 163, 55]);
    } else {
      const normalized = clamp01((height - Math.max(cache.waterLevel, cache.minHeight)) / landRange);
      const tone = 62 + normalized * 176;
      const contour = Math.abs((height / 20) - Math.round(height / 20)) < 0.045 ? 0.82 : 1;
      color = [tone * contour, tone * contour, tone * contour];
    }
    writePixel(pixels, index, color, light);
  }

  return {
    mode,
    pixels,
    minHeight: cache.minHeight,
    maxHeight: cache.maxHeight,
    legend: modeLegend(mode, layers, cache),
  };
}

export function renderTerrainPreviewPixels(options) {
  const cache = sampleTerrainPreviewData({
    ...options,
    materialSelector: options.materialSelector ?? 'mediterranean',
  });
  return colorizeTerrainPreview(cache, options.mode ?? 'height', options.materialLayers);
}

export class TerrainGraphPreview {
  constructor({
    canvas,
    statusElement = null,
    legendElement = null,
    debounceMs = 180,
    workerFactory = null,
  } = {}) {
    this.canvas = canvas;
    this.statusElement = statusElement;
    this.legendElement = legendElement;
    this.debounceMs = debounceMs;
    this.revision = 0;
    this.timer = null;
    this.auto = true;
    this.disposed = false;
    this.mode = 'height';
    this.lastRequest = null;
    const createWorker = workerFactory ?? (
      typeof Worker === 'function'
        ? () => new Worker(new URL('../workers/terrainGraphWorker.js', import.meta.url), { type: 'module' })
        : null
    );
    this.worker = createWorker ? createWorker() : null;
    this.worker?.addEventListener('message', (event) => this.#handleResult(event.data));
    this.worker?.addEventListener('error', (event) => this.#setStatus(event.message || 'Preview worker failed.', 'error'));
  }

  setAuto(enabled) {
    this.auto = Boolean(enabled);
    if (this.canvas?.dataset) this.canvas.dataset.previewEnabled = String(this.auto);
    if (!this.auto) {
      this.cancel();
      this.canvas?.getContext?.('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.legendElement) this.legendElement.replaceChildren();
      this.#setStatus('Preview paused', 'idle');
    } else {
      this.#setStatus('Preview ready', 'idle');
    }
  }

  setMode(mode) {
    if (!TERRAIN_PREVIEW_MODES.includes(mode)) return false;
    this.mode = mode;
    if (this.auto && this.worker && this.lastRequest) {
      this.worker.postMessage({
        type: 'recolor',
        revision: this.revision,
        mode,
        materialLayers: this.lastRequest.materialLayers,
      });
    }
    return true;
  }

  request(graph, settings = {}, {
    immediate = false,
    packCatalog = [],
    materialLayers = [],
  } = {}) {
    if (this.disposed || !this.auto) return;
    clearTimeout(this.timer);
    const run = () => {
      try {
        const { terrainProgram, materialProgram } = compileTerrainPipeline(graph, { packCatalog });
        const revision = ++this.revision;
        const payload = {
          type: 'render',
          revision,
          terrainProgram,
          materialProgram,
          settings,
          mode: this.mode,
          materialLayers,
          width: 256,
          height: 256,
          worldSize: Number(settings.worldRadius ?? 4000) * 2,
          waterLevel: Number(settings.waterLevel ?? -3),
        };
        this.lastRequest = payload;
        this.#setStatus('Rendering preview...', 'loading');
        if (this.worker) this.worker.postMessage(payload);
      } catch (error) {
        this.#setStatus(error.message, 'error');
      }
    };
    if (immediate) run();
    else this.timer = setTimeout(run, this.debounceMs);
  }

  #handleResult(result) {
    if (result.revision !== this.revision || result.type !== 'preview-result') return;
    if (result.error) {
      this.#setStatus(result.error, 'error');
      return;
    }
    const context = this.canvas?.getContext?.('2d');
    if (context) {
      this.canvas.width = result.width;
      this.canvas.height = result.height;
      const pixels = new Uint8ClampedArray(result.pixels);
      context.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
    }
    this.#renderLegend(result.legend ?? []);
    this.#setStatus(
      `${result.minHeight.toFixed(1)}m to ${result.maxHeight.toFixed(1)}m`,
      'success',
    );
  }

  #renderLegend(legend) {
    if (!this.legendElement) return;
    this.legendElement.replaceChildren(...legend.map((entry) => {
      const item = this.legendElement.ownerDocument.createElement('span');
      const swatch = this.legendElement.ownerDocument.createElement('i');
      swatch.style.backgroundColor = `rgb(${entry.color.join(',')})`;
      item.append(swatch, entry.label);
      return item;
    }));
  }

  #setStatus(message, state) {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.dataset.state = state;
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    this.revision += 1;
  }

  dispose() {
    this.cancel();
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
  }
}
