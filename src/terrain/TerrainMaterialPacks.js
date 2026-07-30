const polyThumb = (id) => `/api/polyhaven/file?url=${encodeURIComponent(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=220&height=220`)}`;
const ambientThumb = (id) => `/api/ambientcg/thumbnail/${encodeURIComponent(id)}`;

function layer({ id, label, assetId, meters, strength, roughness = 1, metalness = 0, provider = 'polyhaven', fallbackAssetId = null, displacementEnabled = id === 'rock', displacementCenter = 0.5 }) {
  return Object.freeze({
    id,
    label,
    assetId,
    provider,
    fallbackAssetId,
    thumbnail: provider === 'ambientcg' ? ambientThumb(assetId) : polyThumb(assetId),
    meters,
    scale: 1 / meters,
    strength,
    displacementEnabled,
    displacementCenter,
    roughness,
    metalness,
  });
}

/**
 * Built-in packs use real CC0 PBR assets. Poly Haven maps are resolved through
 * its file API with flexible map-name aliases. ambientCG packs are downloaded
 * as official JPG ZIP archives and unpacked automatically in the browser.
 */
export const BUILTIN_TERRAIN_MATERIAL_PACKS = Object.freeze({
  mediterranean: Object.freeze({
    id: 'mediterranean',
    name: 'Mediterranean · Poly Haven',
    splatPreset: 'mediterranean',
    source: 'polyhaven',
    provider: 'Poly Haven',
    description: 'חבילת PBR אמיתית: חול חוף, דשא דליל, אדמה טבעית וקרקע סלעית.',
    layers: Object.freeze([
      layer({ id: 'sand', label: 'Aerial Beach 01', assetId: 'aerial_beach_01', fallbackAssetId: 'Ground054', meters: 30, strength: 0.035, roughness: 0.95 }),
      layer({ id: 'grass', label: 'Sparse Grass', assetId: 'sparse_grass', fallbackAssetId: 'Grass001', meters: 3.2, strength: 0.025, roughness: 0.98 }),
      layer({ id: 'soil', label: 'Dirt', assetId: 'dirt', fallbackAssetId: 'Ground081', meters: 3.5, strength: 0.045, roughness: 0.92 }),
      layer({ id: 'rock', label: 'Rock Ground', assetId: 'rock_ground', fallbackAssetId: 'Rock026', meters: 4.5, strength: 0.10, roughness: 0.88 }),
    ]),
  }),

  alpine: Object.freeze({
    id: 'alpine',
    name: 'Alpine · Poly Haven',
    splatPreset: 'alpine',
    source: 'polyhaven',
    provider: 'Poly Haven',
    description: 'שלג אבקתי, דשא עם עלים, בוץ יבש וקרקע הררית רחבת־קנה־מידה.',
    layers: Object.freeze([
      layer({ id: 'sand', label: 'Snow 02', assetId: 'snow_02', fallbackAssetId: 'Snow003', meters: 4, strength: 0.025, roughness: 0.9 }),
      layer({ id: 'grass', label: 'Leafy Grass', assetId: 'leafy_grass', fallbackAssetId: 'Grass008', meters: 3.2, strength: 0.025, roughness: 0.98 }),
      layer({ id: 'soil', label: 'Brown Mud Dry', assetId: 'brown_mud_dry', fallbackAssetId: 'Ground086', meters: 3.5, strength: 0.045, roughness: 0.94 }),
      layer({ id: 'rock', label: 'Rocky Terrain', assetId: 'rocky_terrain', fallbackAssetId: 'Rock035', meters: 90, strength: 0.10, roughness: 0.9 }),
    ]),
  }),

  desert: Object.freeze({
    id: 'desert',
    name: 'Desert · Poly Haven',
    splatPreset: 'desert',
    source: 'polyhaven',
    provider: 'Poly Haven',
    description: 'חול רחב־קנה־מידה, אדמה חרושה, חרסית אדומה ושביל סלעי.',
    layers: Object.freeze([
      layer({ id: 'sand', label: 'Aerial Beach 01', assetId: 'aerial_beach_01', fallbackAssetId: 'Ground054', meters: 30, strength: 0.035, roughness: 0.96 }),
      layer({ id: 'grass', label: 'Raked Dirt', assetId: 'raked_dirt', fallbackAssetId: 'Ground002', meters: 5, strength: 0.035, roughness: 0.96 }),
      layer({ id: 'soil', label: 'Red Mud Stones', assetId: 'red_mud_stones', fallbackAssetId: 'Ground081', meters: 5, strength: 0.05, roughness: 0.93 }),
      layer({ id: 'rock', label: 'Rocky Trail', assetId: 'rocky_trail', fallbackAssetId: 'Rock035', meters: 6, strength: 0.10, roughness: 0.9 }),
    ]),
  }),

  volcanic: Object.freeze({
    id: 'volcanic',
    name: 'Volcanic · Poly Haven',
    splatPreset: 'volcanic',
    source: 'polyhaven',
    provider: 'Poly Haven',
    description: 'אדמה שרופה, חול חופי כהה, חצץ כהה וסלע וולקני מחוספס.',
    layers: Object.freeze([
      layer({ id: 'sand', label: 'Burned Ground 01', assetId: 'burned_ground_01', fallbackAssetId: 'Ground002', meters: 4, strength: 0.04, roughness: 0.96 }),
      layer({ id: 'grass', label: 'Sand 02', assetId: 'sand_02', fallbackAssetId: 'Ground054', meters: 6, strength: 0.035, roughness: 0.94 }),
      layer({ id: 'soil', label: 'Gravel', assetId: 'gravel', fallbackAssetId: 'Ground086', meters: 5, strength: 0.05, roughness: 0.93 }),
      layer({ id: 'rock', label: 'Volcanic Rock Tiles', assetId: 'volcanic_rock_tiles', fallbackAssetId: 'Rock035', meters: 6, strength: 0.10, roughness: 0.88 }),
    ]),
  }),

  ambientMediterranean: Object.freeze({
    id: 'ambientMediterranean',
    name: 'Mediterranean · ambientCG',
    splatPreset: 'mediterranean',
    source: 'ambientcg',
    provider: 'ambientCG',
    description: 'חלופה מלאה מ־ambientCG: חול/בוץ חופי, דשא, קרקע סלעית וסלע מצולם.',
    layers: Object.freeze([
      layer({ id: 'sand', label: 'Ground 054 · Beach Sand', assetId: 'Ground054', provider: 'ambientcg', meters: 6.5, strength: 0.035, roughness: 0.95 }),
      layer({ id: 'grass', label: 'Grass 001', assetId: 'Grass001', provider: 'ambientcg', meters: 3.2, strength: 0.025, roughness: 0.98 }),
      layer({ id: 'soil', label: 'Ground 081', assetId: 'Ground081', provider: 'ambientcg', meters: 4.5, strength: 0.045, roughness: 0.94 }),
      layer({ id: 'rock', label: 'Rock 026', assetId: 'Rock026', provider: 'ambientcg', meters: 5.5, strength: 0.10, roughness: 0.88 }),
    ]),
  }),

  ambientNatural: Object.freeze({
    id: 'ambientNatural',
    name: 'Natural Ground · ambientCG',
    splatPreset: 'mediterranean',
    source: 'ambientcg',
    provider: 'ambientCG',
    description: 'סט טבעי מ־ambientCG עם חצץ, דשא, שביל יער סלעי וסלע כהה.',
    layers: Object.freeze([
      layer({ id: 'sand', label: 'Ground 002', assetId: 'Ground002', provider: 'ambientcg', meters: 4.5, strength: 0.035, roughness: 0.94 }),
      layer({ id: 'grass', label: 'Grass 008', assetId: 'Grass008', provider: 'ambientcg', meters: 3.2, strength: 0.025, roughness: 0.98 }),
      layer({ id: 'soil', label: 'Ground 086', assetId: 'Ground086', provider: 'ambientcg', meters: 4.5, strength: 0.045, roughness: 0.94 }),
      layer({ id: 'rock', label: 'Rock 035', assetId: 'Rock035', provider: 'ambientcg', meters: 5.5, strength: 0.10, roughness: 0.88 }),
    ]),
  }),
});

export function materialPackThumbnailUrl(assetId, provider = 'polyhaven') {
  return provider === 'ambientcg' ? ambientThumb(assetId) : polyThumb(assetId);
}
