import { unzipSync, strFromU8 } from 'fflate';
import { BUILTIN_TERRAIN_MATERIAL_PACKS } from './TerrainMaterialPacks.js';
import { QUALITY_TIERS } from './TerrainConfig.js';
import { PBR_MAP_ALIASES, findAmbientMapEntry } from './PbrMapResolver.js';

const DB_NAME = 'terrain-engine-material-packs';
const STORE_NAME = 'packs';
const DB_VERSION = 1;
const REQUIRED_CHANNELS = ['baseColor', 'normal', 'orm', 'height'];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function sanitizeId(value) {
  return String(value ?? 'custom-pack').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-pack';
}

function normalizePath(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '');
}

function findEntry(entries, requestedPath) {
  const normalized = normalizePath(requestedPath);
  if (entries[normalized]) return entries[normalized];
  const suffix = `/${normalized}`;
  const key = Object.keys(entries).find((candidate) => normalizePath(candidate).endsWith(suffix));
  return key ? entries[key] : null;
}

function parsePackArchive(bytes) {
  const entries = unzipSync(bytes);
  const manifestKey = Object.keys(entries).find((path) => /(^|\/)terrain-material-pack\.json$/i.test(path))
    ?? Object.keys(entries).find((path) => /(^|\/)manifest\.json$/i.test(path));
  if (!manifestKey) throw new Error('חבילת החומרים חייבת לכלול terrain-material-pack.json.');
  const manifest = JSON.parse(strFromU8(entries[manifestKey]));
  if (!Array.isArray(manifest.layers) || manifest.layers.length !== 4) {
    throw new Error('חבילת Terrain Materials חייבת להכיל בדיוק ארבע שכבות.');
  }
  for (const [index, layer] of manifest.layers.entries()) {
    for (const channel of REQUIRED_CHANNELS) {
      if (!layer[channel] || !findEntry(entries, layer[channel])) {
        throw new Error(`חסרה מפת ${channel} בשכבה ${index + 1}.`);
      }
    }
  }
  const id = sanitizeId(manifest.id ?? manifest.name);
  return {
    entries,
    manifest: {
      ...manifest,
      id,
      name: String(manifest.name ?? id),
      description: String(manifest.description ?? 'חבילת חומרים מיובאת'),
      splatPreset: String(manifest.splatPreset ?? 'mediterranean'),
      colors: Array.isArray(manifest.colors) ? manifest.colors.slice(0, 4) : ['#c8ae76', '#557846', '#75523a', '#777777'],
      source: 'imported',
    },
  };
}

async function imageBytesToPixels(bytes, mimeType, resolution) {
  const blob = new Blob([bytes], { type: mimeType });
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(resolution, resolution)
    : Object.assign(document.createElement('canvas'), { width: resolution, height: resolution });
  const context = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
  context.clearRect(0, 0, resolution, resolution);
  context.drawImage(bitmap, 0, 0, resolution, resolution);
  bitmap.close?.();
  return context.getImageData(0, 0, resolution, resolution).data;
}

async function imageUrlToPixels(url, resolution) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    let details = '';
    try { details = (await response.json()).error ?? ''; } catch { details = await response.text(); }
    throw new Error(`טעינת מפת PBR נכשלה (${response.status})${details ? `: ${details}` : ''}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(resolution, resolution)
    : Object.assign(document.createElement('canvas'), { width: resolution, height: resolution });
  const context = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
  context.clearRect(0, 0, resolution, resolution);
  context.drawImage(bitmap, 0, 0, resolution, resolution);
  bitmap.close?.();
  return context.getImageData(0, 0, resolution, resolution).data;
}

function solidPixels(resolution, rgba) {
  const output = new Uint8Array(resolution * resolution * 4);
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = rgba[0];
    output[offset + 1] = rgba[1];
    output[offset + 2] = rgba[2];
    output[offset + 3] = rgba[3] ?? 255;
  }
  return output;
}

function samplePreparedLayerColors(pack, arrays, resolution) {
  const baseColor = arrays?.baseColor;
  const pixelsPerLayer = Number(resolution) * Number(resolution);
  if (!(baseColor instanceof Uint8Array) || !Number.isFinite(pixelsPerLayer) || pixelsPerLayer < 1) {
    return [];
  }
  const stride = pixelsPerLayer * 4;
  const sampleCount = Math.min(256, pixelsPerLayer);
  const sampleStep = Math.max(1, Math.floor(pixelsPerLayer / sampleCount));
  return Array.from({ length: 4 }, (_, layerIndex) => {
    const sums = [0, 0, 0];
    let count = 0;
    for (let pixel = 0; pixel < pixelsPerLayer && count < sampleCount; pixel += sampleStep) {
      const offset = layerIndex * stride + pixel * 4;
      sums[0] += baseColor[offset];
      sums[1] += baseColor[offset + 1];
      sums[2] += baseColor[offset + 2];
      count += 1;
    }
    const layer = pack.layers?.[layerIndex] ?? {};
    return {
      id: layer.id ?? ['sand', 'grass', 'soil', 'rock'][layerIndex],
      label: layer.label ?? `Layer ${layerIndex + 1}`,
      color: sums.map((sum) => Math.round(sum / Math.max(1, count))),
    };
  });
}

async function descriptorToPixels(descriptor, resolution, fallback) {
  if (!descriptor || descriptor.kind === 'generated') {
    return solidPixels(resolution, descriptor?.value ?? fallback);
  }
  if (descriptor.kind === 'url' || descriptor.url) return imageUrlToPixels(descriptor.url, resolution);
  throw new Error('תיאור מפת PBR אינו תקין.');
}

async function ormDescriptorToPixels(descriptor, resolution) {
  if (descriptor?.kind !== 'components') {
    return descriptorToPixels(descriptor, resolution, [255, 230, 0, 255]);
  }
  const [ao, roughness, metalness] = await Promise.all([
    descriptorToPixels(descriptor.ao, resolution, [255, 255, 255, 255]),
    descriptorToPixels(descriptor.roughness, resolution, [230, 230, 230, 255]),
    descriptorToPixels(descriptor.metalness, resolution, [0, 0, 0, 255]),
  ]);
  const output = new Uint8Array(resolution * resolution * 4);
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = ao[offset];
    output[offset + 1] = roughness[offset];
    output[offset + 2] = metalness[offset];
    output[offset + 3] = 255;
  }
  return output;
}

function ambientResolutionLabel(sourceLabel) {
  return String(sourceLabel ?? '1k').toUpperCase();
}

function ambientMime(path) {
  return mimeForPath(path);
}

async function buildAmbientCgLayer(entries, resolution, layerLabel) {
  const baseColorEntry = findAmbientMapEntry(entries, PBR_MAP_ALIASES.baseColor, { exclude: ['normal', 'rough', 'displacement', 'height', 'ambientocclusion', 'metal'] });
  if (!baseColorEntry) throw new Error(`${layerLabel}: לא נמצאה מפת Color בחבילת ambientCG.`);
  const normalEntry = findAmbientMapEntry(entries, ['normalgl', 'normal_gl'], { exclude: ['normaldx'] })
    ?? findAmbientMapEntry(entries, PBR_MAP_ALIASES.normal, { exclude: ['normaldx'] });
  const packedOrmEntry = findAmbientMapEntry(entries, PBR_MAP_ALIASES.orm);
  const aoEntry = findAmbientMapEntry(entries, PBR_MAP_ALIASES.ao);
  const roughnessEntry = findAmbientMapEntry(entries, PBR_MAP_ALIASES.roughness);
  const metalnessEntry = findAmbientMapEntry(entries, PBR_MAP_ALIASES.metalness);
  const heightEntry = findAmbientMapEntry(entries, PBR_MAP_ALIASES.height);

  const baseColor = await imageBytesToPixels(baseColorEntry.bytes, ambientMime(baseColorEntry.path), resolution);
  const normal = normalEntry
    ? await imageBytesToPixels(normalEntry.bytes, ambientMime(normalEntry.path), resolution)
    : solidPixels(resolution, [128, 128, 255, 255]);
  const height = heightEntry
    ? await imageBytesToPixels(heightEntry.bytes, ambientMime(heightEntry.path), resolution)
    : solidPixels(resolution, [128, 128, 128, 255]);

  let orm;
  if (packedOrmEntry) {
    orm = await imageBytesToPixels(packedOrmEntry.bytes, ambientMime(packedOrmEntry.path), resolution);
  } else {
    const ao = aoEntry ? await imageBytesToPixels(aoEntry.bytes, ambientMime(aoEntry.path), resolution) : solidPixels(resolution, [255, 255, 255, 255]);
    const roughness = roughnessEntry ? await imageBytesToPixels(roughnessEntry.bytes, ambientMime(roughnessEntry.path), resolution) : solidPixels(resolution, [230, 230, 230, 255]);
    const metalness = metalnessEntry ? await imageBytesToPixels(metalnessEntry.bytes, ambientMime(metalnessEntry.path), resolution) : solidPixels(resolution, [0, 0, 0, 255]);
    orm = new Uint8Array(resolution * resolution * 4);
    for (let offset = 0; offset < orm.length; offset += 4) {
      orm[offset] = ao[offset];
      orm[offset + 1] = roughness[offset];
      orm[offset + 2] = metalness[offset];
      orm[offset + 3] = 255;
    }
  }

  return {
    baseColor, normal, orm, height,
    warnings: [
      !normalEntry ? 'Normal GL fallback' : null,
      !heightEntry ? 'Height fallback' : null,
      !packedOrmEntry && !aoEntry ? 'AO fallback' : null,
      !packedOrmEntry && !roughnessEntry ? 'Roughness fallback' : null,
      !packedOrmEntry && !metalnessEntry ? 'Metalness fallback' : null,
    ].filter(Boolean),
    files: {
      baseColor: baseColorEntry.path,
      normal: normalEntry?.path ?? 'generated',
      orm: packedOrmEntry?.path ?? 'composed',
      height: heightEntry?.path ?? 'generated',
    },
  };
}

async function fetchAndBuildAmbientCgLayer(assetId, resolution, sourceLabel, layerLabel) {
  const response = await fetch(`/api/ambientcg/archive/${encodeURIComponent(assetId)}?resolution=${ambientResolutionLabel(sourceLabel)}`, { cache: 'force-cache' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`${layerLabel}: ${payload.error ?? `ambientCG ${response.status}`}`);
  }
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  return buildAmbientCgLayer(entries, resolution, layerLabel);
}

async function buildAmbientCgArrayData(pack, tier, progress = () => {}) {
  const { target: resolution, sourceLabel } = materialResolutionForTier(tier);
  const pixelStride = resolution * resolution * 4;
  const arrays = Object.fromEntries(REQUIRED_CHANNELS.map((channel) => [channel, new Uint8Array(pixelStride * 4)]));
  const sources = [];
  const warnings = [];
  let completed = 0;
  const total = pack.layers.length * 2;
  for (let layerIndex = 0; layerIndex < pack.layers.length; layerIndex += 1) {
    const layer = pack.layers[layerIndex];
    progress({ completed, total, label: `${layer.label} · מוריד ambientCG ${ambientResolutionLabel(sourceLabel)}` });
    const built = await fetchAndBuildAmbientCgLayer(layer.assetId, resolution, sourceLabel, layer.label);
    completed += 1;
    progress({ completed, total, label: `${layer.label} · מפענח מפות` });
    for (const channel of REQUIRED_CHANNELS) arrays[channel].set(built[channel], layerIndex * pixelStride);
    sources.push({ id: layer.assetId, provider: 'ambientCG', files: built.files });
    warnings.push(...built.warnings.map((warning) => `${layer.label}: ${warning}`));
    completed += 1;
    progress({ completed, total, label: `${layer.label} · מוכן` });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { arrays, resolution, sourceLabel, sources, warnings };
}

function materialResolutionForTier(tier) {
  const target = Math.max(512, Math.min(Number(tier?.materialResolution ?? 1024), 4096));
  return {
    target,
    sourceLabel: target <= 1024 ? '1k' : target <= 2048 ? '2k' : '4k',
  };
}

async function buildPolyHavenArrayData(pack, tier, progress = () => {}) {
  const { target: resolution, sourceLabel } = materialResolutionForTier(tier);
  const pixelStride = resolution * resolution * 4;
  const arrays = Object.fromEntries(REQUIRED_CHANNELS.map((channel) => [channel, new Uint8Array(pixelStride * 4)]));
  const sources = [];
  const warnings = [];
  let completed = 0;
  const total = pack.layers.length * (REQUIRED_CHANNELS.length + 1);

  for (let layerIndex = 0; layerIndex < pack.layers.length; layerIndex += 1) {
    const layer = pack.layers[layerIndex];
    try {
      progress({ completed, total, label: `${layer.label} · מאתר מפות Poly Haven` });
      const metadataResponse = await fetch(`/api/polyhaven/material/${encodeURIComponent(layer.assetId)}?resolution=${sourceLabel}`, { cache: 'no-store' });
      if (!metadataResponse.ok) {
        const payload = await metadataResponse.json().catch(() => ({}));
        throw new Error(payload.error ?? `Poly Haven API ${metadataResponse.status}`);
      }
      const metadata = await metadataResponse.json();
      sources.push(metadata);
      completed += 1;
      progress({ completed, total, label: `${layer.label} · metadata` });

      for (const channel of REQUIRED_CHANNELS) {
        const map = metadata.maps?.[channel];
        const pixels = channel === 'orm'
          ? await ormDescriptorToPixels(map, resolution)
          : await descriptorToPixels(map, resolution, channel === 'normal'
            ? [128, 128, 255, 255]
            : channel === 'height'
              ? [128, 128, 128, 255]
              : [127, 127, 127, 255]);
        arrays[channel].set(pixels, layerIndex * pixelStride);
        completed += 1;
        progress({ completed, total, label: `${layer.label} · ${channel}` });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      warnings.push(...(metadata.warnings ?? []).map((warning) => `${layer.label}: ${warning}`));
    } catch (error) {
      if (!layer.fallbackAssetId) throw new Error(`${layer.label}: ${error.message}`);
      progress({ completed, total, label: `${layer.label} · Poly Haven נכשל, עובר ל־ambientCG ${layer.fallbackAssetId}` });
      const built = await fetchAndBuildAmbientCgLayer(layer.fallbackAssetId, resolution, sourceLabel, layer.label);
      for (const channel of REQUIRED_CHANNELS) arrays[channel].set(built[channel], layerIndex * pixelStride);
      sources.push({ id: layer.fallbackAssetId, provider: 'ambientCG fallback', files: built.files });
      warnings.push(`${layer.label}: Poly Haven נכשל (${error.message}); נטען fallback מ־ambientCG ${layer.fallbackAssetId}.`);
      warnings.push(...built.warnings.map((warning) => `${layer.label}: ${warning}`));
      completed = Math.min(total, completed + REQUIRED_CHANNELS.length + 1);
      progress({ completed, total, label: `${layer.label} · fallback מוכן` });
    }
  }

  return { arrays, resolution, sourceLabel, sources, warnings };
}

async function buildMixedProviderArrayData(pack, tier, progress = () => {}) {
  const { target: resolution, sourceLabel } = materialResolutionForTier(tier);
  const pixelStride = resolution * resolution * 4;
  const arrays = Object.fromEntries(REQUIRED_CHANNELS.map((channel) => [channel, new Uint8Array(pixelStride * 4)]));
  const sources = [];
  const warnings = [];
  const total = pack.layers.length * 5;
  let completed = 0;

  for (let layerIndex = 0; layerIndex < pack.layers.length; layerIndex += 1) {
    const layer = pack.layers[layerIndex];
    if (!layer.assetId) throw new Error(`${layer.label ?? `Layer ${layerIndex + 1}`}: לא נבחר Asset.`);
    if (layer.provider === 'ambientcg') {
      progress({ completed, total, label: `${layer.label} · מוריד ambientCG` });
      const built = await fetchAndBuildAmbientCgLayer(layer.assetId, resolution, sourceLabel, layer.label);
      for (const channel of REQUIRED_CHANNELS) arrays[channel].set(built[channel], layerIndex * pixelStride);
      sources.push({ id: layer.assetId, provider: 'ambientCG', files: built.files });
      warnings.push(...built.warnings.map((warning) => `${layer.label}: ${warning}`));
      completed += 5;
      progress({ completed, total, label: `${layer.label} · מוכן` });
      continue;
    }

    progress({ completed, total, label: `${layer.label} · מאתר Poly Haven` });
    const metadataResponse = await fetch(`/api/polyhaven/material/${encodeURIComponent(layer.assetId)}?resolution=${sourceLabel}`, { cache: 'no-store' });
    if (!metadataResponse.ok) {
      const payload = await metadataResponse.json().catch(() => ({}));
      throw new Error(`${layer.label}: ${payload.error ?? `Poly Haven ${metadataResponse.status}`}`);
    }
    const metadata = await metadataResponse.json();
    completed += 1;
    for (const channel of REQUIRED_CHANNELS) {
      const map = metadata.maps?.[channel];
      const pixels = channel === 'orm'
        ? await ormDescriptorToPixels(map, resolution)
        : await descriptorToPixels(map, resolution, channel === 'normal'
          ? [128, 128, 255, 255]
          : channel === 'height'
            ? [128, 128, 128, 255]
            : [127, 127, 127, 255]);
      arrays[channel].set(pixels, layerIndex * pixelStride);
      completed += 1;
      progress({ completed, total, label: `${layer.label} · ${channel}` });
    }
    sources.push(metadata);
    warnings.push(...(metadata.warnings ?? []).map((warning) => `${layer.label}: ${warning}`));
  }
  return { arrays, resolution, sourceLabel, sources, warnings };
}

function mimeForPath(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

async function buildArrayData(entries, manifest, resolution, progress = () => {}) {
  const pixelStride = resolution * resolution * 4;
  const arrays = Object.fromEntries(REQUIRED_CHANNELS.map((channel) => [channel, new Uint8Array(pixelStride * 4)]));
  let completed = 0;
  const total = 16;
  for (let layerIndex = 0; layerIndex < 4; layerIndex += 1) {
    const layer = manifest.layers[layerIndex];
    for (const channel of REQUIRED_CHANNELS) {
      const path = layer[channel];
      const bytes = findEntry(entries, path);
      const pixels = await imageBytesToPixels(bytes, mimeForPath(path), resolution);
      arrays[channel].set(pixels, layerIndex * pixelStride);
      completed += 1;
      progress({ completed, total, label: `${layer.label ?? layer.id ?? layerIndex + 1} · ${channel}` });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return arrays;
}

export class TerrainMaterialPackManager {
  constructor({ materialLibrary, world, packBuilders = {} }) {
    this.materialLibrary = materialLibrary;
    this.world = world;
    this.db = null;
    this.imported = new Map();
    this.activePackId = 'mediterranean';
    this.activeMaterialLayers = [];
    this.preparedPackCache = new Map();
    this.packBuilders = {
      ambientcg: buildAmbientCgArrayData,
      polyhaven: buildPolyHavenArrayData,
      custom: buildMixedProviderArrayData,
      ...packBuilders,
    };
  }

  async initialize() {
    try {
      this.db = await openDatabase();
      const transaction = this.db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      const records = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
      for (const record of records) this.imported.set(record.id, record.manifest);
    } catch (error) {
      console.warn('[Terrain Materials] IndexedDB cache unavailable.', error);
    }
    return this.getCatalog();
  }

  getCatalog() {
    return [
      ...Object.values(BUILTIN_TERRAIN_MATERIAL_PACKS),
      ...[...this.imported.values()].map((manifest) => ({ ...manifest, source: manifest.source ?? 'imported' })),
    ];
  }

  getPack(id) {
    return BUILTIN_TERRAIN_MATERIAL_PACKS[id] ?? this.imported.get(id) ?? null;
  }

  async saveCustomPack(input) {
    const baseId = sanitizeId(input.id || input.name || 'custom-pack');
    const id = input.id ? baseId : `${baseId}-${Date.now().toString(36)}`;
    const manifest = {
      ...input,
      id,
      source: 'custom',
      provider: 'Mixed',
      splatPreset: 'custom',
      layers: (input.layers ?? []).slice(0, 4).map((layer, index) => ({
        ...layer,
        id: layer.id ?? ['sand', 'grass', 'soil', 'rock'][index],
        provider: layer.provider === 'ambientcg' ? 'ambientcg' : 'polyhaven',
        meters: Math.max(0.1, Number(layer.meters ?? 4)),
        scale: 1 / Math.max(0.1, Number(layer.meters ?? 4)),
        distribution: { ...(layer.distribution ?? {}) },
      })),
    };
    if (manifest.layers.length !== 4) throw new Error('חבילה מותאמת חייבת להכיל ארבע שכבות.');
    if (this.db) {
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ id, manifest, bytes: null });
      await transactionPromise(transaction);
    }
    this.imported.set(id, manifest);
    this.#invalidatePreparedPack(id);
    return manifest;
  }

  async importZip(file, progress) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { manifest } = parsePackArchive(bytes);
    if (this.db) {
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ id: manifest.id, manifest, bytes });
      await transactionPromise(transaction);
    }
    this.imported.set(manifest.id, manifest);
    this.#invalidatePreparedPack(manifest.id);
    await this.applyPack(manifest.id, { bytes, progress });
    return manifest;
  }

  async removeImportedPack(id) {
    if (!this.imported.has(id)) return false;
    this.imported.delete(id);
    this.#invalidatePreparedPack(id);
    if (this.db) {
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      await transactionPromise(transaction);
    }
    return true;
  }

  async #readCachedRecord(id) {
    if (!this.db) throw new Error('החבילה אינה זמינה בזיכרון המקומי. יש לייבא אותה מחדש.');
    const transaction = this.db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(id);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  #preparedPackKey(pack) {
    const qualityTier = this.materialLibrary.getSettings().qualityTier;
    const tier = QUALITY_TIERS[qualityTier] ?? QUALITY_TIERS.high;
    const fingerprint = JSON.stringify({
      id: pack.id,
      source: pack.source,
      resolution: tier.materialResolution,
      globalBlend: pack.globalBlend,
      transitionNoise: pack.transitionNoise,
      layers: pack.layers?.map((layer) => ({
        id: layer.id,
        assetId: layer.assetId,
        provider: layer.provider,
        meters: layer.meters,
        strength: layer.strength,
        roughness: layer.roughness,
        metalness: layer.metalness,
        distribution: layer.distribution,
      })),
    });
    return `${pack.id}:${qualityTier}:${fingerprint}`;
  }

  #invalidatePreparedPack(id) {
    for (const key of this.preparedPackCache.keys()) {
      if (key.startsWith(`${id}:`)) this.preparedPackCache.delete(key);
    }
  }

  async #prepareProviderPack(pack, progress) {
    const tier = QUALITY_TIERS[this.materialLibrary.getSettings().qualityTier] ?? QUALITY_TIERS.high;
    const builder = this.packBuilders[pack.source];
    if (typeof builder !== 'function') {
      throw new Error(`אין בונה חבילת PBR עבור המקור ${pack.source}.`);
    }
    const built = await builder(pack, tier, progress);
    return {
      pack,
      ...built,
      materialLayers: samplePreparedLayerColors(pack, built.arrays, built.resolution),
    };
  }

  async #prepareArchivePack(id, bytes, progress) {
    let archiveBytes = bytes;
    if (!archiveBytes) {
      const record = await this.#readCachedRecord(id);
      if (!record?.bytes) throw new Error('לא נמצאה חבילת החומרים שנשמרה.');
      archiveBytes = record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes);
    }
    const { entries, manifest } = parsePackArchive(archiveBytes);
    const tier = QUALITY_TIERS[this.materialLibrary.getSettings().qualityTier] ?? QUALITY_TIERS.high;
    const declared = Number(manifest.resolution ?? tier.materialResolution);
    const resolution = Math.max(256, Math.min(
      declared || tier.materialResolution,
      tier.materialResolution,
      this.materialLibrary.renderer.capabilities.maxTextureSize,
      4096,
    ));
    const arrays = await buildArrayData(entries, manifest, resolution, progress);
    return {
      pack: manifest,
      arrays,
      resolution,
      sourceLabel: null,
      sources: [],
      warnings: [],
      materialLayers: samplePreparedLayerColors(manifest, arrays, resolution),
    };
  }

  async preparePack(id, { bytes = null, progress = () => {} } = {}) {
    const builtIn = BUILTIN_TERRAIN_MATERIAL_PACKS[id];
    const catalogPack = builtIn ?? this.imported.get(id);
    if (!catalogPack) throw new Error(`חבילת החומרים "${id}" אינה קיימת.`);
    const cacheKey = this.#preparedPackKey(catalogPack);
    if (this.preparedPackCache.has(cacheKey)) return this.preparedPackCache.get(cacheKey);

    const preparation = (
      catalogPack.source === 'polyhaven'
      || catalogPack.source === 'ambientcg'
      || catalogPack.source === 'custom'
        ? this.#prepareProviderPack(catalogPack, progress)
        : this.#prepareArchivePack(id, bytes, progress)
    ).catch((error) => {
      this.preparedPackCache.delete(cacheKey);
      throw error;
    });
    this.preparedPackCache.set(cacheKey, preparation);
    return preparation;
  }

  commitPreparedPack(prepared, { materialProgram = null } = {}) {
    if (!prepared?.pack || !prepared?.arrays || !Number.isFinite(prepared.resolution)) {
      throw new Error('חבילת החומרים המוכנה אינה תקינה.');
    }
    const {
      pack,
      arrays,
      resolution,
      sourceLabel,
      sources = [],
      warnings = [],
      materialLayers = [],
    } = prepared;
    const diagnostics = this.materialLibrary.applyImportedMaterialArrays({
      baseColorData: arrays.baseColor,
      normalData: arrays.normal,
      ormData: arrays.orm,
      heightData: arrays.height,
      resolution,
      packId: pack.id,
    });
    const materialSettings = Array.isArray(pack.layers)
      ? this.materialLibrary.applyMaterialPackLayerSettings(pack.layers)
      : null;
    this.world.applyMaterialPackDistribution(pack, materialProgram);
    this.activePackId = pack.id;
    this.activeMaterialLayers = materialLayers.map((layer) => ({
      ...layer,
      color: [...layer.color],
    }));
    return {
      pack,
      diagnostics,
      materialSettings,
      sourceLabel,
      sources,
      warnings,
      materialLayers,
    };
  }

  async applyPack(id, { bytes = null, progress = () => {}, materialProgram = null } = {}) {
    const prepared = await this.preparePack(id, { bytes, progress });
    const result = this.commitPreparedPack(prepared, { materialProgram });
    const total = result.pack.layers?.length * 5;
    if (Number.isFinite(total)) {
      progress({
        completed: total,
        total,
        label: `חבילת ${result.pack.provider ?? 'PBR'} הוחלה.`,
      });
    }
    return result;
  }

  getActiveMaterialLayers() {
    return this.activeMaterialLayers.map((layer) => ({
      ...layer,
      color: [...layer.color],
    }));
  }

  dispose() {
    this.db?.close?.();
    this.imported.clear();
    this.preparedPackCache.clear();
    this.activeMaterialLayers = [];
  }
}
