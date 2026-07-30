import { compileTerrainGraph } from './TerrainGraphCompiler.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function mixColor(a, b, factor) {
  const t = clamp01(factor);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function terrainColor(height, waterLevel) {
  if (height < waterLevel) {
    const depth = clamp01((waterLevel - height) / 150);
    return mixColor([43, 154, 166], [6, 38, 74], Math.pow(depth, 0.62));
  }
  const relative = height - waterLevel;
  if (relative < 7) return mixColor([196, 183, 137], [111, 138, 83], relative / 7);
  if (relative < 72) return mixColor([86, 126, 68], [119, 104, 72], (relative - 7) / 65);
  if (relative < 145) return mixColor([119, 104, 72], [126, 125, 119], (relative - 72) / 73);
  return mixColor([126, 125, 119], [230, 234, 236], (relative - 145) / 90);
}

export function renderTerrainPreviewPixels({
  width,
  height,
  worldSize,
  waterLevel,
  sample,
}) {
  const safeWidth = Math.max(2, Math.round(width));
  const safeHeight = Math.max(2, Math.round(height));
  const heights = new Float32Array(safeWidth * safeHeight);
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let z = 0; z < safeHeight; z += 1) {
    const worldZ = (z / (safeHeight - 1) - 0.5) * worldSize;
    for (let x = 0; x < safeWidth; x += 1) {
      const worldX = (x / (safeWidth - 1) - 0.5) * worldSize;
      const value = sample(worldX, worldZ);
      heights[z * safeWidth + x] = value;
      minHeight = Math.min(minHeight, value);
      maxHeight = Math.max(maxHeight, value);
    }
  }

  const pixels = new Uint8ClampedArray(safeWidth * safeHeight * 4);
  const lightX = -0.45;
  const lightY = 0.82;
  const lightZ = -0.35;
  const sampleHeight = (x, z) => heights[
    Math.max(0, Math.min(safeHeight - 1, z)) * safeWidth
    + Math.max(0, Math.min(safeWidth - 1, x))
  ];
  const worldStepX = worldSize / (safeWidth - 1);
  const worldStepZ = worldSize / (safeHeight - 1);

  for (let z = 0; z < safeHeight; z += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const index = z * safeWidth + x;
      const dx = (sampleHeight(x + 1, z) - sampleHeight(x - 1, z)) / Math.max(worldStepX * 2, 0.001);
      const dz = (sampleHeight(x, z + 1) - sampleHeight(x, z - 1)) / Math.max(worldStepZ * 2, 0.001);
      const inverseLength = 1 / Math.hypot(dx, 1, dz);
      const lighting = clamp01((-dx * lightX + lightY - dz * lightZ) * inverseLength);
      const ambient = 0.48 + lighting * 0.62;
      const color = terrainColor(heights[index], waterLevel);
      const offset = index * 4;
      pixels[offset] = Math.round(color[0] * ambient);
      pixels[offset + 1] = Math.round(color[1] * ambient);
      pixels[offset + 2] = Math.round(color[2] * ambient);
      pixels[offset + 3] = 255;
    }
  }
  return { pixels, minHeight, maxHeight };
}

export class TerrainGraphPreview {
  constructor({ canvas, statusElement = null, debounceMs = 180 } = {}) {
    this.canvas = canvas;
    this.statusElement = statusElement;
    this.debounceMs = debounceMs;
    this.revision = 0;
    this.timer = null;
    this.auto = true;
    this.disposed = false;
    this.worker = typeof Worker === 'function'
      ? new Worker(new URL('../workers/terrainGraphWorker.js', import.meta.url), { type: 'module' })
      : null;
    this.worker?.addEventListener('message', (event) => this.#handleResult(event.data));
    this.worker?.addEventListener('error', (event) => this.#setStatus(event.message || 'Preview worker failed.', 'error'));
  }

  setAuto(enabled) {
    this.auto = Boolean(enabled);
    if (this.canvas?.dataset) this.canvas.dataset.previewEnabled = String(this.auto);
    if (!this.auto) {
      this.cancel();
      this.canvas?.getContext?.('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.#setStatus('Preview paused', 'idle');
    } else {
      this.#setStatus('Preview ready', 'idle');
    }
  }

  request(graph, settings = {}, { immediate = false } = {}) {
    if (this.disposed || !this.auto) return;
    clearTimeout(this.timer);
    const run = () => {
      try {
        const program = compileTerrainGraph(graph);
        const revision = ++this.revision;
        const payload = {
          type: 'render',
          revision,
          program,
          settings,
          width: 256,
          height: 256,
          worldSize: Number(settings.worldRadius ?? 4000) * 2,
          waterLevel: Number(settings.waterLevel ?? -3),
        };
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
    this.#setStatus(
      `${result.minHeight.toFixed(1)}m to ${result.maxHeight.toFixed(1)}m`,
      'success',
    );
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
