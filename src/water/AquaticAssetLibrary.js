export function validateAquaticManifest(manifest) {
  const species = (manifest?.species ?? []).map((entry) => {
    if (
      !entry?.id
      || !entry.url?.startsWith('/assets/aquatic/')
      || entry.license !== 'CC0-1.0'
    ) {
      throw new Error('Aquatic manifest entries must reference a local CC0 asset');
    }
    return { ...entry };
  });
  return { species };
}

export class AquaticAssetLibrary {
  constructor({ load, fallbackFactory }) {
    if (typeof load !== 'function') throw new TypeError('Aquatic asset load function is required');
    this.load = load;
    this.fallbackFactory = typeof fallbackFactory === 'function'
      ? fallbackFactory
      : (entry) => ({ entry, fallback: true });
    this.cache = new Map();
  }

  loadSpecies(entry) {
    if (!this.cache.has(entry.id)) {
      const pending = Promise.resolve()
        .then(() => this.load(entry))
        .catch(() => this.fallbackFactory(entry));
      this.cache.set(entry.id, pending);
    }
    return this.cache.get(entry.id);
  }

  clear() {
    this.cache.clear();
  }
}
