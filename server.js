import http from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { PBR_MAP_ALIASES, selectProviderMap } from './src/terrain/PbrMapResolver.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const cacheRoot = join(root, '.cache', 'polyhaven');
const apiCacheRoot = join(cacheRoot, 'api');
const fileCacheRoot = join(cacheRoot, 'files');
const ambientCacheRoot = join(root, '.cache', 'ambientcg');
const ambientHdriCacheRoot = join(ambientCacheRoot, 'hdri');
const ambientApiCacheRoot = join(ambientCacheRoot, 'api');
const ambientFileCacheRoot = join(ambientCacheRoot, 'files');
mkdirSync(apiCacheRoot, { recursive: true });
mkdirSync(fileCacheRoot, { recursive: true });
mkdirSync(ambientCacheRoot, { recursive: true });
mkdirSync(ambientHdriCacheRoot, { recursive: true });
mkdirSync(ambientApiCacheRoot, { recursive: true });
mkdirSync(ambientFileCacheRoot, { recursive: true });

const POLYHAVEN_API = 'https://api.polyhaven.com';
const POLYHAVEN_USER_AGENT = 'TerrainEngineMaterialStudio/3.11.6 (local Three.js application)';
const AMBIENTCG_USER_AGENT = 'TerrainEngineMaterialStudio/3.11.6 (local Three.js application)';
const AMBIENTCG_API = 'https://ambientcg.com/api/v3';
const memoryJsonCache = new Map();
const activeDownloads = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream',
  '.exr': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.zip': 'application/zip',
};

function sendJson(response, status, value, cacheControl = 'no-cache') {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  response.end(JSON.stringify(value));
}

function sendText(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
  response.end(value);
}

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fetchPolyJson(pathname, maxAgeMs = 12 * 60 * 60 * 1000) {
  const key = pathname;
  const cachedMemory = memoryJsonCache.get(key);
  if (cachedMemory && Date.now() - cachedMemory.time < maxAgeMs) return cachedMemory.value;

  const cachePath = join(apiCacheRoot, `${hashValue(key)}.json`);
  if (existsSync(cachePath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs;
    if (age < maxAgeMs) {
      const value = JSON.parse(readFileSync(cachePath, 'utf8'));
      memoryJsonCache.set(key, { time: Date.now(), value });
      return value;
    }
  }

  const upstream = await fetch(`${POLYHAVEN_API}${pathname}`, {
    headers: {
      'User-Agent': POLYHAVEN_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!upstream.ok) throw new Error(`Poly Haven API ${upstream.status}: ${await upstream.text()}`);
  const value = await upstream.json();
  writeFileSync(cachePath, JSON.stringify(value));
  memoryJsonCache.set(key, { time: Date.now(), value });
  return value;
}

function proxyUrl(upstreamUrl) {
  return `/api/polyhaven/file?url=${encodeURIComponent(upstreamUrl)}`;
}

function generatedMap(kind, value) {
  return { kind: 'generated', value, source: 'fallback' };
}

function proxiedMap(value) {
  if (!value?.url) return null;
  return {
    kind: 'url',
    mapName: value.mapName,
    resolution: value.resolution ? `${Math.round(value.resolution / 1024)}k` : null,
    format: value.format,
    sourceUrl: value.url,
    url: proxyUrl(value.url),
  };
}

function normalizeToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function collectPolyLeaves(node, path = [], output = []) {
  if (!node || typeof node !== 'object') return output;
  if (typeof node.url === 'string') {
    output.push({ url: node.url, path, mapName: path[0] ?? '' });
    return output;
  }
  for (const [key, value] of Object.entries(node)) collectPolyLeaves(value, [...path, key], output);
  return output;
}

function fallbackPolyMap(files, { include = [], exclude = [] } = {}) {
  const includeTokens = include.map(normalizeToken);
  const excludeTokens = exclude.map(normalizeToken);
  const leaves = [];
  for (const [mapName, tree] of Object.entries(files ?? {})) {
    for (const leaf of collectPolyLeaves(tree, [mapName])) {
      const normalized = leaf.path.map(normalizeToken).join(' ');
      if (excludeTokens.some((token) => normalized.includes(token))) continue;
      if (includeTokens.length && !includeTokens.some((token) => normalized.includes(token))) continue;
      leaves.push(leaf);
    }
  }
  return leaves[0] ? { ...leaves[0], format: extname(new URL(leaves[0].url).pathname).slice(1) } : null;
}

async function resolvePolyMaterial(id, requestedResolution) {
  const files = await fetchPolyJson(`/files/${encodeURIComponent(id)}`);
  let baseColor = selectProviderMap(files, PBR_MAP_ALIASES.baseColor, requestedResolution, ['jpg', 'png', 'webp']);
  const normal = selectProviderMap(files, PBR_MAP_ALIASES.normal, requestedResolution, ['png', 'jpg', 'webp']);
  const packedOrm = selectProviderMap(files, PBR_MAP_ALIASES.orm, requestedResolution, ['jpg', 'png', 'webp']);
  const ao = selectProviderMap(files, PBR_MAP_ALIASES.ao, requestedResolution, ['jpg', 'png', 'webp']);
  const roughness = selectProviderMap(files, PBR_MAP_ALIASES.roughness, requestedResolution, ['jpg', 'png', 'webp']);
  const metalness = selectProviderMap(files, PBR_MAP_ALIASES.metalness, requestedResolution, ['jpg', 'png', 'webp']);
  const height = selectProviderMap(files, PBR_MAP_ALIASES.height, requestedResolution, ['png', 'jpg', 'webp']);

  if (!baseColor) {
    baseColor = fallbackPolyMap(files, {
      include: ['color', 'diff', 'albedo', 'base'],
      exclude: ['normal', 'rough', 'metal', 'disp', 'height', 'ao', 'arm', 'orm', 'preview'],
    }) ?? fallbackPolyMap(files, {
      exclude: ['normal', 'rough', 'metal', 'disp', 'height', 'ao', 'arm', 'orm', 'preview'],
    });
  }

  if (!baseColor) {
    const available = Object.keys(files ?? {}).join(', ');
    throw new Error(`${id}: לא נמצאה מפת Base Color. מפות זמינות: ${available || 'none'}`);
  }

  const warnings = [];
  if (!selectProviderMap(files, PBR_MAP_ALIASES.baseColor, requestedResolution, ['jpg', 'png', 'webp'])) {
    warnings.push('Base Color זוהתה דרך fallback גמיש של שמות קבצים.');
  }
  const maps = {
    baseColor: proxiedMap(baseColor),
    normal: normal ? proxiedMap(normal) : generatedMap('normal', [128, 128, 255, 255]),
    height: height ? proxiedMap(height) : generatedMap('height', [128, 128, 128, 255]),
  };
  if (!normal) warnings.push('Normal GL לא נמצאה — נעשה שימוש ב־normal שטוח.');
  if (!height) warnings.push('Displacement לא נמצאה — נעשה שימוש בגובה ניטרלי.');

  if (packedOrm) {
    maps.orm = proxiedMap(packedOrm);
  } else {
    maps.orm = {
      kind: 'components',
      ao: ao ? proxiedMap(ao) : generatedMap('ao', [255, 255, 255, 255]),
      roughness: roughness ? proxiedMap(roughness) : generatedMap('roughness', [230, 230, 230, 255]),
      metalness: metalness ? proxiedMap(metalness) : generatedMap('metalness', [0, 0, 0, 255]),
    };
    if (!ao) warnings.push('AO לא נמצאה — נעשה שימוש בערך 1.0.');
    if (!roughness) warnings.push('Roughness לא נמצאה — נעשה שימוש בערך 0.9.');
    if (!metalness) warnings.push('Metalness לא נמצאה — נעשה שימוש בערך 0.0.');
  }

  return {
    id,
    requestedResolution,
    actualResolution: maps.baseColor.resolution ?? requestedResolution,
    maps,
    warnings,
    discoveredMapNames: Object.keys(files ?? {}),
    credit: 'Poly Haven · CC0',
  };
}

async function downloadCachedFile(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/(^|\.)(polyhaven\.(com|org)|cdn\.polyhaven\.com)$/i.test(parsed.hostname)) {
    throw new Error('Only Poly Haven CDN URLs are allowed.');
  }
  const extension = extname(parsed.pathname).toLowerCase() || '.bin';
  const cachePath = join(fileCacheRoot, `${hashValue(url)}${extension}`);
  if (existsSync(cachePath) && statSync(cachePath).size > 0) return cachePath;

  if (!activeDownloads.has(url)) {
    activeDownloads.set(url, (async () => {
      const upstream = await fetch(url, { headers: { 'User-Agent': POLYHAVEN_USER_AGENT } });
      if (!upstream.ok) throw new Error(`Poly Haven file ${upstream.status}`);
      const bytes = Buffer.from(await upstream.arrayBuffer());
      writeFileSync(cachePath, bytes);
      return cachePath;
    })().finally(() => activeDownloads.delete(url)));
  }
  return activeDownloads.get(url);
}

function collectStringLeaves(node, path = [], output = []) {
  if (typeof node === 'string') {
    output.push({ value: node, path });
    return output;
  }
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectStringLeaves(value, [...path, String(index)], output));
    return output;
  }
  if (!node || typeof node !== 'object') return output;
  for (const [key, value] of Object.entries(node)) collectStringLeaves(value, [...path, key], output);
  return output;
}

function normalizeAmbientUrl(value) {
  try {
    const url = new URL(String(value ?? ''), 'https://ambientcg.com');
    return url.href;
  } catch {
    return null;
  }
}

function ambientUrlAllowed(value) {
  const normalized = normalizeAmbientUrl(value);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' && /(^|\.)(ambientcg\.com|struffelproductions\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

async function fetchAmbientJson(pathname, maxAgeMs = 12 * 60 * 60 * 1000) {
  const key = pathname;
  const cachedMemory = memoryJsonCache.get(`ambient:${key}`);
  if (cachedMemory && Date.now() - cachedMemory.time < maxAgeMs) return cachedMemory.value;

  const cachePath = join(ambientApiCacheRoot, `${hashValue(key)}.json`);
  if (existsSync(cachePath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs;
    if (age < maxAgeMs) {
      const value = JSON.parse(readFileSync(cachePath, 'utf8'));
      memoryJsonCache.set(`ambient:${key}`, { time: Date.now(), value });
      return value;
    }
  }

  const upstream = await fetch(`${AMBIENTCG_API}${pathname}`, {
    headers: {
      'User-Agent': AMBIENTCG_USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!upstream.ok) throw new Error(`ambientCG API ${upstream.status}: ${await upstream.text()}`);
  const value = await upstream.json();
  writeFileSync(cachePath, JSON.stringify(value));
  memoryJsonCache.set(`ambient:${key}`, { time: Date.now(), value });
  return value;
}

function ambientAssetQuery({ id = null, type = null, technique = null, sort = 'popular', limit = 100, offset = 0, include = [] } = {}) {
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  if (type) params.set('type', type);
  if (technique) params.set('technique', technique);
  if (sort) params.set('sort', sort);
  params.set('limit', String(Math.max(1, Math.min(500, Number(limit) || 100))));
  if (offset) params.set('offset', String(Math.max(0, Number(offset) || 0)));
  if (include.length) params.set('include', include.join(','));
  return `/assets?${params.toString()}`;
}

async function fetchAmbientAsset(id, include = ['title', 'downloads', 'thumbnails', 'maps', 'dimensions', 'type', 'technique']) {
  const payload = await fetchAmbientJson(ambientAssetQuery({ id, limit: 1, include }));
  const asset = payload?.assets?.[0];
  if (!asset) throw new Error(`ambientCG asset not found: ${id}`);
  return asset;
}

function scoreAmbientUrl(entry, { kind, resolution = '', format = '' } = {}) {
  const normalizedUrl = normalizeAmbientUrl(entry.value);
  if (!normalizedUrl || !ambientUrlAllowed(normalizedUrl)) return -1;
  const pathText = entry.path.join(' ').toLowerCase();
  const valueText = normalizedUrl.toLowerCase();
  const decodedText = decodeURIComponent(valueText);
  const combined = `${pathText} ${decodedText}`;
  let score = 0;
  if (kind === 'thumbnail') {
    if (!/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(decodedText)) return -1;
    if (/thumbnail|preview/.test(combined)) score += 120;
    if (/2048|1024/.test(combined)) score += 12;
    if (/webp/.test(combined)) score += 8;
  } else if (kind === 'archive') {
    const isZip = /\.zip(?:[?&#]|$)/i.test(decodedText);
    const isHdr = /\.hdr(?:[?&#]|$)/i.test(decodedText);
    if (!isZip && !isHdr) return -1;
    if (/download|rawlink|downloads|file/.test(combined)) score += 70;
    if (/rawlink/.test(combined)) score += 20;
    if (resolution && combined.includes(resolution.toLowerCase())) score += 55;
    if (format && combined.includes(format.toLowerCase())) score += 35;
    if (isHdr) score += 45;
    if (isZip) score += 20;
    if (format === 'HDR' && /tonemapped|usdz|preview|jpe?g|png/.test(combined)) score -= 100;
    if (format === 'JPG' && /hdr|exr|usdz/.test(combined)) score -= 35;
  }
  return score;
}

function selectAmbientUrls(asset, options) {
  const seen = new Set();
  return collectStringLeaves(asset)
    .map((entry) => ({ ...entry, value: normalizeAmbientUrl(entry.value), score: scoreAmbientUrl(entry, options) }))
    .filter((entry) => entry.value && entry.score >= 0 && !seen.has(entry.value) && seen.add(entry.value))
    .sort((a, b) => b.score - a.score || a.value.length - b.value.length)
    .map((entry) => entry.value);
}

function selectAmbientUrl(asset, options) {
  return selectAmbientUrls(asset, options)[0] ?? null;
}

function detectAmbientPayload(bytes) {
  if (!bytes || bytes.length < 4) return 'unknown';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return 'zip';
  const header = bytes.subarray(0, Math.min(bytes.length, 32)).toString('ascii');
  if (header.startsWith('#?RADIANCE') || header.startsWith('#?RGBE')) return 'hdr';
  // OpenEXR magic number 0x01312f76 stored little-endian.
  if (bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01) return 'exr';
  const text = bytes.subarray(0, Math.min(bytes.length, 160)).toString('utf8').trim().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html') || text.includes('bad gateway')) return 'html';
  return 'unknown';
}

async function downloadAmbientRemote(url, cacheGroup = 'asset', { expected = null, bypassCache = false } = {}) {
  const normalizedUrl = normalizeAmbientUrl(url);
  if (!normalizedUrl || !ambientUrlAllowed(normalizedUrl)) throw new Error('Blocked ambientCG URL.');
  const parsed = new URL(normalizedUrl);
  const queryFile = parsed.searchParams.get('file') ?? '';
  const extension = extname(queryFile || parsed.pathname).toLowerCase() || '.bin';
  const cachePath = join(ambientFileCacheRoot, `${cacheGroup}-${hashValue(normalizedUrl)}${extension}`);
  if (!bypassCache && existsSync(cachePath) && statSync(cachePath).size > 0) {
    const cachedBytes = readFileSync(cachePath);
    const detected = detectAmbientPayload(cachedBytes);
    if (!expected || expected.includes(detected)) return cachePath;
    try { unlinkSync(cachePath); } catch { }
  }

  const activeKey = `${normalizedUrl}|${expected ?? 'any'}`;
  if (!activeDownloads.has(activeKey)) {
    activeDownloads.set(activeKey, (async () => {
      const upstream = await fetch(normalizedUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': AMBIENTCG_USER_AGENT,
          Accept: expected?.includes('zip') ? 'application/zip,application/octet-stream;q=0.9,*/*;q=0.5' : '*/*',
        },
      });
      if (!upstream.ok) throw new Error(`ambientCG file ${upstream.status}: ${upstream.statusText}`);
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.length < 128) throw new Error('ambientCG returned an empty file.');
      const detected = detectAmbientPayload(bytes);
      if (expected && !expected.includes(detected)) {
        throw new Error(`ambientCG returned ${detected} instead of ${expected.join(' / ')}.`);
      }
      writeFileSync(cachePath, bytes);
      return cachePath;
    })().finally(() => activeDownloads.delete(activeKey)));
  }
  return activeDownloads.get(activeKey);
}

async function resolveAmbientArchive(id, resolution = '1K', format = 'JPG') {
  const safeResolution = /^(1K|2K|4K|8K|12K|16K)$/i.test(resolution) ? resolution.toUpperCase() : '1K';
  const safeFormat = /^(JPG|PNG)$/i.test(format) ? format.toUpperCase() : 'JPG';
  const asset = await fetchAmbientAsset(id, ['title', 'downloads', 'thumbnails', 'type', 'technique']);
  let url = selectAmbientUrl(asset, { kind: 'archive', resolution: safeResolution, format: safeFormat });
  if (!url) url = `https://ambientcg.com/get?file=${encodeURIComponent(`${id}_${safeResolution}-${safeFormat}.zip`)}`;
  return { asset, url, resolution: safeResolution, format: safeFormat };
}

async function downloadAmbientArchive(id, resolution = '1K') {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid ambientCG asset id.');
  const resolved = await resolveAmbientArchive(id, resolution, 'JPG');
  return downloadAmbientRemote(resolved.url, `${id}-${resolved.resolution}`);
}

async function downloadAmbientThumbnail(id) {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid ambientCG asset id.');
  const asset = await fetchAmbientAsset(id, ['title', 'thumbnails', 'previews', 'type']);
  const url = selectAmbientUrl(asset, { kind: 'thumbnail' })
    ?? `https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/2048-WEBP/${id}.webp`;
  return downloadAmbientRemote(url, `${id}-thumbnail`);
}

async function fetchAmbientHdriCatalog(maxAgeMs = 12 * 60 * 60 * 1000) {
  const cachePath = join(ambientCacheRoot, 'hdri-list-v3.json');
  if (existsSync(cachePath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs;
    if (age < maxAgeMs) return JSON.parse(readFileSync(cachePath, 'utf8'));
  }

  const payload = await fetchAmbientJson(ambientAssetQuery({
    type: 'hdri',
    technique: 'hdri-bracketed-panorama-horizon-clearing',
    sort: 'popular',
    limit: 500,
    include: ['title', 'thumbnails', 'downloads', 'type', 'technique', 'tags'],
  }), maxAgeMs);

  const items = (payload?.assets ?? []).map((asset) => ({
    id: asset.id,
    label: asset.title ?? asset.name ?? asset.id,
    provider: 'ambientCG',
    preview: `/api/ambientcg/thumbnail/${encodeURIComponent(asset.id)}`,
    pageUrl: `https://ambientcg.com/a/${encodeURIComponent(asset.id)}`,
  }));
  const result = {
    source: 'https://ambientcg.com/api/v3/assets',
    totalResults: Number(payload?.totalResults ?? items.length),
    count: items.length,
    items,
  };
  writeFileSync(cachePath, JSON.stringify(result));
  return result;
}

function ambientHdriFallbackUrls(id, resolution) {
  const names = [
    // Current ambientCG HDRI packages normally use this exact name.
    `${id}_${resolution}.zip`,
    `${id}_${resolution}-HDR.zip`,
    `${id}_${resolution}_HDR.zip`,
    `${id}_${resolution}.exr`,
    `${id}_${resolution}-HDR.exr`,
    `${id}_${resolution}.hdr`,
    `${id}_${resolution}-HDR.hdr`,
  ];
  return names.map((name) => `https://ambientcg.com/get?file=${encodeURIComponent(name)}`);
}

function extractLargestEnvironmentMap(bytes, id) {
  const entries = unzipSync(new Uint8Array(bytes));
  const candidates = Object.entries(entries)
    .filter(([name, value]) => /\.(?:hdr|exr)$/i.test(name) && value?.length > 128)
    .map(([name, value]) => ({
      name,
      value,
      format: /\.exr$/i.test(name) ? 'exr' : 'hdr',
    }))
    .sort((a, b) => b.value.length - a.value.length);
  if (!candidates.length) {
    const names = Object.keys(entries).slice(0, 24).join(', ');
    throw new Error(`${id}: הארכיון לא הכיל קובץ HDR או EXR. קבצים שנמצאו: ${names || 'none'}`);
  }
  const selected = candidates[0];
  return {
    bytes: Buffer.from(selected.value),
    format: selected.format,
    sourceName: selected.name,
  };
}

async function downloadAmbientHdri(id, resolution = '2K') {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid ambientCG HDRI id.');
  const requested = /^(1K|2K|4K|8K)$/i.test(resolution) ? resolution.toUpperCase() : '2K';
  const resolutionOrder = [...new Set([requested, requested === '1K' ? null : '1K'].filter(Boolean))];
  const errors = [];
  let asset = null;
  try {
    asset = await fetchAmbientAsset(id, ['title', 'downloads', 'thumbnails', 'type', 'technique']);
  } catch (error) {
    errors.push(`metadata: ${error.message}`);
  }

  for (const currentResolution of resolutionOrder) {
    for (const format of ['hdr', 'exr']) {
      const cachedPath = join(ambientHdriCacheRoot, `${id}_${currentResolution}.${format}`);
      if (!existsSync(cachedPath) || statSync(cachedPath).size <= 128) continue;
      const bytes = readFileSync(cachedPath);
      if (detectAmbientPayload(bytes) === format) return { path: cachedPath, format, resolution: currentResolution };
      try { unlinkSync(cachedPath); } catch { }
    }

    const exactUrls = ambientHdriFallbackUrls(id, currentResolution);
    const apiUrls = asset
      ? selectAmbientUrls(asset, { kind: 'archive', resolution: currentResolution, format: 'HDR' })
        .filter((candidate) => decodeURIComponent(candidate).toUpperCase().includes(`_${currentResolution}`))
      : [];
    // Prefer the deterministic ambientCG file name before any metadata links for other resolutions.
    const candidates = [...new Set([...exactUrls, ...apiUrls])];
    for (const candidateUrl of candidates) {
      try {
        const payloadPath = await downloadAmbientRemote(candidateUrl, `${id}-${currentResolution}-environment`, {
          expected: ['zip', 'hdr', 'exr'],
        });
        const payload = readFileSync(payloadPath);
        const detected = detectAmbientPayload(payload);
        let result;
        if (detected === 'hdr' || detected === 'exr') {
          result = { bytes: payload, format: detected, sourceName: candidateUrl };
        } else if (detected === 'zip') {
          result = extractLargestEnvironmentMap(payload, id);
        } else {
          throw new Error(`הקובץ שהתקבל הוא ${detected}, לא HDRI תקין.`);
        }
        if (detectAmbientPayload(result.bytes) !== result.format) {
          throw new Error(`הקובץ שחולץ אינו ${result.format.toUpperCase()} תקין.`);
        }
        const outputPath = join(ambientHdriCacheRoot, `${id}_${currentResolution}.${result.format}`);
        writeFileSync(outputPath, result.bytes);
        return {
          path: outputPath,
          format: result.format,
          resolution: currentResolution,
          sourceName: result.sourceName,
        };
      } catch (error) {
        errors.push(`${currentResolution} ${candidateUrl}: ${error.message}`);
      }
    }
  }

  throw new Error(`${id}: טעינת HDRI/EXR נכשלה. ${errors.slice(-8).join(' | ')}`);
}

async function searchMaterialAssets(provider, query = '', limit = 36) {
  const safeLimit = Math.max(4, Math.min(80, Number(limit) || 36));
  const needle = String(query ?? '').trim().toLowerCase();
  if (provider === 'ambientcg') {
    const payload = await fetchAmbientJson(ambientAssetQuery({
      type: 'material',
      sort: 'popular',
      limit: 300,
      include: ['title', 'thumbnails', 'tags', 'type', 'technique'],
    }), 60 * 60 * 1000);
    return (payload?.assets ?? [])
      .filter((asset) => {
        if (!needle) return true;
        const haystack = `${asset.id} ${asset.title ?? ''} ${(asset.tags ?? []).join?.(' ') ?? ''}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, safeLimit)
      .map((asset) => ({
        id: asset.id,
        label: asset.title ?? asset.id,
        provider: 'ambientcg',
        preview: `/api/ambientcg/thumbnail/${encodeURIComponent(asset.id)}`,
        pageUrl: `https://ambientcg.com/view?id=${encodeURIComponent(asset.id)}`,
      }));
  }

  const payload = await fetchPolyJson('/assets?t=textures', 60 * 60 * 1000);
  return Object.entries(payload ?? {})
    .filter(([id, asset]) => {
      if (!needle) return true;
      const haystack = `${id} ${asset?.name ?? ''} ${asset?.categories?.join?.(' ') ?? ''} ${asset?.tags?.join?.(' ') ?? ''}`.toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, safeLimit)
    .map(([id, asset]) => ({
      id,
      label: asset?.name ?? id.replaceAll('_', ' '),
      provider: 'polyhaven',
      preview: `/api/polyhaven/file?url=${encodeURIComponent(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=220&height=220`)}`,
      pageUrl: `https://polyhaven.com/a/${encodeURIComponent(id)}`,
    }));
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/polyhaven/health') {
    sendJson(response, 200, { ok: true, provider: 'Poly Haven', cache: cacheRoot });
    return true;
  }

  if (url.pathname === '/api/materials/search') {
    try {
      const provider = url.searchParams.get('provider') === 'polyhaven' ? 'polyhaven' : 'ambientcg';
      const items = await searchMaterialAssets(provider, url.searchParams.get('q') ?? '', url.searchParams.get('limit') ?? 36);
      sendJson(response, 200, { provider, count: items.length, items }, 'public, max-age=900');
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  const materialMatch = url.pathname.match(/^\/api\/polyhaven\/material\/([a-z0-9_]+)$/i);
  if (materialMatch) {
    try {
      const requested = /^(1k|2k|4k)$/i.test(url.searchParams.get('resolution') ?? '')
        ? url.searchParams.get('resolution').toLowerCase()
        : '1k';
      const result = await resolvePolyMaterial(materialMatch[1].toLowerCase(), requested);
      sendJson(response, 200, result, 'public, max-age=3600');
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/polyhaven/file') {
    const upstreamUrl = url.searchParams.get('url');
    if (!upstreamUrl) {
      sendJson(response, 400, { error: 'Missing url.' });
      return true;
    }
    try {
      const cachePath = await downloadCachedFile(upstreamUrl);
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(cachePath).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': statSync(cachePath).size,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      createReadStream(cachePath).pipe(response);
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  const ambientArchiveMatch = url.pathname.match(/^\/api\/ambientcg\/archive\/([A-Za-z0-9]+)$/);
  if (ambientArchiveMatch) {
    try {
      const resolution = /^(1K|2K|4K)$/i.test(url.searchParams.get('resolution') ?? '')
        ? url.searchParams.get('resolution').toUpperCase()
        : '1K';
      const cachePath = await downloadAmbientArchive(ambientArchiveMatch[1], resolution);
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': statSync(cachePath).size,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      createReadStream(cachePath).pipe(response);
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  const ambientThumbMatch = url.pathname.match(/^\/api\/ambientcg\/thumbnail\/([A-Za-z0-9]+)$/);
  if (ambientThumbMatch) {
    try {
      const cachePath = await downloadAmbientThumbnail(ambientThumbMatch[1]);
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(cachePath).toLowerCase()] ?? 'image/jpeg',
        'Content-Length': statSync(cachePath).size,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
      createReadStream(cachePath).pipe(response);
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  if (url.pathname === '/api/ambientcg/hdris') {
    try {
      const payload = await fetchAmbientHdriCatalog();
      sendJson(response, 200, payload, 'public, max-age=3600');
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  const ambientHdriMatch = url.pathname.match(/^\/api\/ambientcg\/hdri\/([A-Za-z0-9]+)$/);
  if (ambientHdriMatch) {
    try {
      const resolution = /^(1K|2K|4K|8K)$/i.test(url.searchParams.get('resolution') ?? '')
        ? url.searchParams.get('resolution').toUpperCase()
        : '2K';
      const result = await downloadAmbientHdri(ambientHdriMatch[1], resolution);
      response.writeHead(200, {
        'Content-Type': result.format === 'exr' ? 'image/x-exr' : 'image/vnd.radiance',
        'Content-Length': statSync(result.path).size,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Terrain-Environment-Format': result.format,
        'X-Terrain-Environment-Resolution': result.resolution,
      });
      createReadStream(result.path).pipe(response);
    } catch (error) {
      sendJson(response, 502, { error: error.message });
    }
    return true;
  }

  return false;
}

function serveStatic(response, requestPath) {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const safePath = normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, safePath);
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    sendText(response, 404, 'Not found');
    return;
  }
  if (statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(request, response, url);
      if (!handled) sendJson(response, 404, { error: 'Unknown API endpoint.' });
      return;
    }
    serveStatic(response, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: error.message });
    else response.end();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Terrain Engine 3.11.6 listening on http://127.0.0.1:${port}`);
});
