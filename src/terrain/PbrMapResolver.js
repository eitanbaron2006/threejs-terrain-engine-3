export const PBR_MAP_ALIASES = Object.freeze({
  baseColor: Object.freeze(['diffuse', 'diff', 'basecolor', 'base_color', 'albedo', 'color', 'col']),
  normal: Object.freeze(['nor_gl', 'normal_gl', 'normalgl', 'openglnormal', 'normal']),
  orm: Object.freeze(['arm', 'orm', 'occlusionroughnessmetallic', 'aorm']),
  ao: Object.freeze(['ambientocclusion', 'ambient_occlusion', 'occlusion', 'ao']),
  roughness: Object.freeze(['roughness', 'rough']),
  metalness: Object.freeze(['metalness', 'metallic', 'metal']),
  height: Object.freeze(['displacement16', 'displacement', 'disp16', 'disp', 'height', 'bump']),
});

export function normalizeMapToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function scoreMapName(name, aliases) {
  const normalized = normalizeMapToken(name);
  if (!normalized) return -1;
  let best = -1;
  for (const alias of aliases) {
    const target = normalizeMapToken(alias);
    if (normalized === target) best = Math.max(best, 100);
    else if (normalized.startsWith(target) || target.startsWith(normalized)) best = Math.max(best, 78);
    else if (normalized.includes(target)) best = Math.max(best, 56);
  }
  return best;
}

function resolutionNumber(value) {
  const text = String(value ?? '').toLowerCase();
  const match = text.match(/(?:^|[^0-9])(\d+(?:\.\d+)?)k(?:[^a-z0-9]|$)/);
  if (match) return Number(match[1]) * 1024;
  const pixels = text.match(/(?:^|[^0-9])(\d{3,5})(?:px)?(?:[^a-z0-9]|$)/);
  return pixels ? Number(pixels[1]) : 0;
}

function extensionFrom(value) {
  const clean = String(value ?? '').split('?')[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

function collectUrlLeaves(node, path = [], output = []) {
  if (!node || typeof node !== 'object') return output;
  if (typeof node.url === 'string') {
    output.push({
      ...node,
      path,
      resolution: path.map(resolutionNumber).find((value) => value > 0) ?? 0,
      format: extensionFrom(node.url) || normalizeMapToken(path.at(-1)),
    });
    return output;
  }
  for (const [key, value] of Object.entries(node)) collectUrlLeaves(value, [...path, key], output);
  return output;
}

function formatRank(format, preferences) {
  const normalized = normalizeMapToken(format);
  const index = preferences.findIndex((preference) => normalizeMapToken(preference) === normalized);
  return index < 0 ? preferences.length + 2 : index;
}

export function selectProviderMap(files, aliases, requestedResolution = '1k', formats = ['jpg', 'png', 'webp']) {
  if (!files || typeof files !== 'object') return null;
  const requestedPixels = resolutionNumber(requestedResolution) || 1024;
  const candidates = [];
  for (const [mapName, tree] of Object.entries(files)) {
    const nameScore = scoreMapName(mapName, aliases);
    if (nameScore < 0) continue;
    if (/dx|directx/.test(normalizeMapToken(mapName)) && aliases.some((alias) => normalizeMapToken(alias).includes('gl'))) continue;
    for (const leaf of collectUrlLeaves(tree)) {
      candidates.push({ mapName, nameScore, ...leaf });
    }
  }
  candidates.sort((a, b) => {
    if (a.nameScore !== b.nameScore) return b.nameScore - a.nameScore;
    const aDistance = a.resolution ? Math.abs(a.resolution - requestedPixels) : Number.MAX_SAFE_INTEGER;
    const bDistance = b.resolution ? Math.abs(b.resolution - requestedPixels) : Number.MAX_SAFE_INTEGER;
    if (aDistance !== bDistance) return aDistance - bDistance;
    return formatRank(a.format, formats) - formatRank(b.format, formats);
  });
  return candidates[0] ?? null;
}

export function findAmbientMapEntry(entries, aliases, { exclude = [] } = {}) {
  const exclusions = exclude.map(normalizeMapToken);
  const candidates = [];
  for (const [path, bytes] of Object.entries(entries ?? {})) {
    if (!bytes || /(?:^|\/)(?:preview|thumbnail|render)/i.test(path)) continue;
    if (!/\.(?:jpe?g|png|webp)$/i.test(path)) continue;
    const filename = path.split('/').at(-1) ?? path;
    const normalized = normalizeMapToken(filename.replace(/\.[^.]+$/, ''));
    if (exclusions.some((token) => normalized.includes(token))) continue;
    const score = scoreMapName(normalized, aliases);
    if (score >= 0) candidates.push({ path, bytes, score, normalized });
  }
  candidates.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return candidates[0] ?? null;
}
