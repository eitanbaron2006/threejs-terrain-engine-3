import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('advanced water uses a local non-repeating simulation window', async () => {
  const [source, simulation] = await Promise.all([
    readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/water/GpuWaterSimulation.js', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /uSimulationOrigin/);
  assert.match(source, /uSimulationWindowMask/);
  assert.match(source, /waterRadiusToSimulationUv/);
  assert.match(simulation, /ClampToEdgeWrapping/);
  assert.doesNotMatch(simulation, /min\(delta, 1\.0 - delta\)/);
});

test('floating bodies displace the GPU water and projectile entries spawn foam', async () => {
  const source = await readFile(new URL('../src/water/AdvancedWaterSystem.js', import.meta.url), 'utf8');
  const simulation = await readFile(new URL('../src/water/GpuWaterSimulation.js', import.meta.url), 'utf8');

  assert.match(source, /consumeDisplacements/);
  assert.match(source, /simulation\.moveSphere/);
  assert.match(source, /impactEffects\.spawn/);
  assert.match(simulation, /moveSphere\(/);
});
