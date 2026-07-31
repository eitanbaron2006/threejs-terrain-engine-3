function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function vector(value = {}) {
  return {
    x: finite(value.x),
    y: finite(value.y),
    z: finite(value.z),
  };
}

function addScaled(target, source, scale) {
  target.x += source.x * scale;
  target.y += source.y * scale;
  target.z += source.z * scale;
}

function direction(from, to) {
  const result = {
    x: finite(to?.x) - finite(from?.x),
    y: finite(to?.y) - finite(from?.y),
    z: finite(to?.z) - finite(from?.z),
  };
  const length = Math.hypot(result.x, result.y, result.z);
  if (length > 1e-6) {
    result.x /= length;
    result.y /= length;
    result.z /= length;
  }
  return result;
}

function separation(position, neighbours, radius = 3.5) {
  const result = { x: 0, y: 0, z: 0 };
  for (const neighbour of neighbours ?? []) {
    const offset = {
      x: finite(position.x) - finite(neighbour.position?.x),
      y: finite(position.y) - finite(neighbour.position?.y),
      z: finite(position.z) - finite(neighbour.position?.z),
    };
    const distance = Math.hypot(offset.x, offset.y, offset.z);
    if (distance <= 1e-6 || distance >= radius) continue;
    const weight = (radius - distance) / (radius * distance);
    addScaled(result, offset, weight);
  }
  return result;
}

function alignment(neighbours, fallback) {
  if (!neighbours?.length) return vector(fallback);
  const result = { x: 0, y: 0, z: 0 };
  for (const neighbour of neighbours) addScaled(result, vector(neighbour.velocity), 1);
  const inverseCount = 1 / neighbours.length;
  result.x *= inverseCount;
  result.y *= inverseCount;
  result.z *= inverseCount;
  return result;
}

function verticalAvoidance(y, floorLimit, surfaceLimit) {
  const result = { x: 0, y: 0, z: 0 };
  const floorBand = 3;
  const surfaceBand = 2.5;
  if (y < floorLimit + floorBand) {
    result.y += (floorLimit + floorBand - y) / floorBand;
  }
  if (y > surfaceLimit - surfaceBand) {
    result.y -= (y - (surfaceLimit - surfaceBand)) / surfaceBand;
  }
  return result;
}

function clampLength(value, maximum) {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length <= maximum || length <= 1e-9) return value;
  const scale = maximum / length;
  value.x *= scale;
  value.y *= scale;
  value.z *= scale;
  return value;
}

export function computeSchoolVelocity(state, deltaSeconds) {
  const delta = Math.min(Math.max(finite(deltaSeconds), 0), 0.2);
  const position = vector(state.position);
  const velocity = vector(state.velocity);
  const maximumSpeed = Math.max(0.1, finite(state.maximumSpeed, 4.5));
  const keepApart = separation(position, state.neighbours);
  const matchHeading = alignment(state.neighbours, velocity);
  const returnToCenter = direction(position, state.center);
  const vertical = verticalAvoidance(
    position.y,
    finite(state.floorY) + 1.1,
    finite(state.surfaceY) - 1,
  );
  const elapsed = finite(state.elapsed);
  const phase = finite(state.seedPhase);
  const wander = {
    x: Math.sin(elapsed * 0.71 + phase),
    y: Math.sin(elapsed * 0.43 + phase * 1.7) * 0.25,
    z: Math.cos(elapsed * 0.67 + phase),
  };

  addScaled(velocity, keepApart, 1.8 * delta);
  addScaled(velocity, matchHeading, 0.18 * delta);
  addScaled(velocity, returnToCenter, 0.7 * delta);
  addScaled(velocity, vertical, 8.5 * delta);
  addScaled(velocity, wander, 0.42 * delta);
  return clampLength(velocity, maximumSpeed);
}
