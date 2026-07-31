import test from 'node:test';
import assert from 'node:assert/strict';
import { HabitatStream } from '../src/water/AquaticHabitatStream.js';

test('habitat stream activates nearby zones and releases distant zones', () => {
  const stream = new HabitatStream({ activationRadius: 180, releaseRadius: 230 });
  stream.setLayout({ zones: [
    { id: 'near', x: 40, z: 0 },
    { id: 'far', x: 600, z: 0 },
  ] });

  assert.deepEqual(stream.update({ x: 0, z: 0 }), {
    activated: ['near'],
    released: [],
    active: ['near'],
  });
  assert.deepEqual(stream.update({ x: 650, z: 0 }), {
    activated: ['far'],
    released: ['near'],
    active: ['far'],
  });
});

test('habitat stream hysteresis prevents boundary thrashing', () => {
  const stream = new HabitatStream({ activationRadius: 100, releaseRadius: 140 });
  stream.setLayout({ zones: [{ id: 'reef', x: 0, z: 0 }] });

  stream.update({ x: 90, z: 0 });
  const boundary = stream.update({ x: 120, z: 0 });

  assert.deepEqual(boundary.activated, []);
  assert.deepEqual(boundary.released, []);
  assert.deepEqual(boundary.active, ['reef']);
});

test('habitat stream can force the demo zone active before camera movement', () => {
  const stream = new HabitatStream({ activationRadius: 100, releaseRadius: 140 });
  stream.setLayout({ zones: [{ id: 'reef', x: 900, z: 900 }] });

  assert.equal(stream.activate('reef'), true);
  assert.deepEqual(stream.activeIds, ['reef']);
});
