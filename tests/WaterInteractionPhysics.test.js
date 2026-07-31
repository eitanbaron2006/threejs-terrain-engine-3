import test from 'node:test';
import assert from 'node:assert/strict';
import {
  integrateBuoyantBody,
  sphereSubmergedFraction,
} from '../src/water/WaterInteractionPhysics.js';
import { WaterSpatialModel } from '../src/water/WaterSpatialModel.js';

test('sphere submerged fraction uses exact spherical-cap volume', () => {
  assert.equal(sphereSubmergedFraction(2, 1, 0.9), 0);
  assert.equal(sphereSubmergedFraction(0, 1, 0), 0.5);
  assert.equal(sphereSubmergedFraction(-2, 1, 0), 1);
  assert.ok(Math.abs(sphereSubmergedFraction(0.5, 1, 0) - 0.15625) < 1e-9);
});

test('buoyancy lifts a light submerged sphere and water drag removes energy', () => {
  const body = {
    position: { x: 0, y: -1.5, z: 0 },
    velocity: { x: 4, y: -1, z: 0 },
    radius: 1,
    density: 0.55,
  };
  const initialSpeedSq = body.velocity.x ** 2 + body.velocity.y ** 2;

  const state = integrateBuoyantBody(body, {
    surfaceY: 0,
    floorY: -20,
    gravity: 9.81,
    dragCoefficient: 1.2,
  }, 0.1);

  assert.ok(state.submergedFraction > 0.9);
  assert.ok(body.velocity.y > -1);
  assert.ok(body.velocity.x ** 2 + body.velocity.y ** 2 < initialSpeedSq);
  assert.ok(Number.isFinite(body.position.y));
});

test('buoyant integration clamps against the seabed with damped restitution', () => {
  const body = {
    position: { x: 0, y: -9.7, z: 0 },
    velocity: { x: 0, y: -8, z: 0 },
    radius: 0.5,
    density: 2,
  };

  const state = integrateBuoyantBody(body, {
    surfaceY: 0,
    floorY: -10,
    gravity: 9.81,
    dragCoefficient: 0,
    restitution: 0.18,
  }, 0.1);

  assert.equal(body.position.y, -9.5);
  assert.equal(state.hitFloor, true);
  assert.ok(body.velocity.y >= 0);
});

test('spatial model returns deterministic positions inside the requested water depths', () => {
  const sampleHeight = (x, z) => -4 - Math.sin(x * 0.01) * 2 - Math.cos(z * 0.01) * 2;
  const model = new WaterSpatialModel({
    worldSize: 1000,
    waterLevel: 0,
    seed: 1337,
    sampleHeight,
  });
  const options = {
    count: 12,
    minDepth: 3,
    maxDepth: 8,
    minSpacing: 30,
    margin: 40,
  };

  const first = model.findPositions(options);
  const second = model.findPositions(options);

  assert.deepEqual(first, second);
  assert.equal(first.length, 12);
  for (const position of first) {
    assert.ok(position.depth >= options.minDepth);
    assert.ok(position.depth <= options.maxDepth);
    assert.equal(position.floorY, sampleHeight(position.x, position.z));
  }
});

test('spatial model returns an empty placement set when no requested water exists', () => {
  const model = new WaterSpatialModel({
    worldSize: 100,
    waterLevel: 0,
    seed: 3,
    sampleHeight: () => 12,
  });

  assert.deepEqual(model.findPositions({ count: 5, minDepth: 2, maxDepth: 10 }), []);
  assert.equal(model.isUnderwater(0, -1, 0), false);
});
