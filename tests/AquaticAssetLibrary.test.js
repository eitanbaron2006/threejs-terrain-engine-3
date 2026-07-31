import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AquaticAssetLibrary,
  validateAquaticManifest,
} from '../src/water/AquaticAssetLibrary.js';

test('accepts local CC0 aquatic species entries', () => {
  const result = validateAquaticManifest({
    species: [{
      id: 'reef-fish-a',
      url: '/assets/aquatic/fish/fish-1.fbx',
      license: 'CC0-1.0',
      swimClip: 'Armature|Swim',
    }],
  });

  assert.equal(result.species[0].id, 'reef-fish-a');
});

test('rejects remote or unlicensed aquatic species entries', () => {
  assert.throws(() => validateAquaticManifest({
    species: [{ id: 'bad', url: 'https://example.com/fish.fbx' }],
  }), /local CC0 asset/i);
});

test('caches successful species loads and falls back after failure', async () => {
  let loads = 0;
  const library = new AquaticAssetLibrary({
    load: async (entry) => {
      loads += 1;
      if (entry.id === 'missing') throw new Error('missing');
      return { id: entry.id };
    },
    fallbackFactory: (entry) => ({ id: entry.id, fallback: true }),
  });

  const entry = {
    id: 'reef-fish-a',
    url: '/assets/aquatic/fish/fish-1.fbx',
    license: 'CC0-1.0',
  };
  const first = await library.loadSpecies(entry);
  const second = await library.loadSpecies(entry);
  const fallback = await library.loadSpecies({ ...entry, id: 'missing' });

  assert.equal(loads, 2);
  assert.equal(first, second);
  assert.equal(fallback.fallback, true);
});
