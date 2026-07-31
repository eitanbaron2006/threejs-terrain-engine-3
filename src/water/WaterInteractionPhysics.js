function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function sphereSubmergedFraction(centerY, radius, surfaceY) {
  const safeRadius = Math.max(0.0001, finite(radius, 1));
  const capHeight = finite(surfaceY, 0) - (finite(centerY, 0) - safeRadius);
  if (capHeight <= 0) return 0;
  if (capHeight >= safeRadius * 2) return 1;
  if (Math.abs(capHeight - safeRadius) <= Number.EPSILON * safeRadius * 4) return 0.5;
  const capVolume = Math.PI * capHeight * capHeight * (safeRadius - capHeight / 3);
  const sphereVolume = 4 / 3 * Math.PI * safeRadius ** 3;
  return capVolume / sphereVolume;
}

export function sphereSimulationMass(radius, density) {
  const safeRadius = Math.max(0.01, finite(radius, 1));
  const safeDensity = Math.max(0.05, finite(density, 0.65));
  const volume = 4 / 3 * Math.PI * safeRadius ** 3;
  return volume * safeDensity * 2;
}

export function applySphereImpact(body, impact = {}) {
  const projectileMass = Math.max(0.001, finite(impact.projectileMass, 1));
  const bodyMass = Math.max(0.001, finite(body.mass, 1));
  const restitution = Math.min(Math.max(finite(impact.restitution, 0.25), 0), 1);
  const normalSpeed = impact.relativeVelocity.dot(impact.normal);
  if (normalSpeed >= 0) return 0;

  const impulseMagnitude = -(1 + restitution) * normalSpeed
    / (1 / projectileMass + 1 / bodyMass);
  const targetImpulse = impact.normal.clone().multiplyScalar(-impulseMagnitude);
  body.velocity.addScaledVector(targetImpulse, 1 / bodyMass);

  if (body.angularVelocity && impact.contactOffset) {
    const angularImpulse = impact.contactOffset.clone().cross(targetImpulse);
    const radius = Math.max(0.01, finite(body.radius, 1));
    const inertia = 2 / 5 * bodyMass * radius * radius;
    body.angularVelocity.addScaledVector(angularImpulse, 1 / inertia);
  }
  return impulseMagnitude;
}

export function integrateBuoyantBody(body, environment = {}, deltaSeconds = 0) {
  const delta = Math.min(Math.max(finite(deltaSeconds, 0), 0), 0.05);
  const radius = Math.max(0.01, finite(body.radius, 1));
  const density = Math.max(0.05, finite(body.density, 0.65));
  const surfaceY = finite(environment.surfaceY, 0);
  const floorY = finite(environment.floorY, surfaceY - 100);
  const gravity = Math.max(0, finite(environment.gravity, 9.81));
  const dragCoefficient = Math.max(0, finite(environment.dragCoefficient, 1.15));
  const restitution = Math.min(Math.max(finite(environment.restitution, 0.16), 0), 1);
  const submergedFraction = sphereSubmergedFraction(body.position.y, radius, surfaceY);

  body.velocity.y += gravity * (submergedFraction / density - 1) * delta;

  const speed = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z);
  if (speed > 0 && submergedFraction > 0 && dragCoefficient > 0) {
    const damping = 1 / (1 + dragCoefficient * submergedFraction * speed * delta);
    body.velocity.x *= damping;
    body.velocity.y *= damping;
    body.velocity.z *= damping;
  }

  body.position.x += body.velocity.x * delta;
  body.position.y += body.velocity.y * delta;
  body.position.z += body.velocity.z * delta;

  const minimumCenterY = floorY + radius;
  let hitFloor = false;
  if (body.position.y < minimumCenterY) {
    body.position.y = minimumCenterY;
    body.velocity.y = Math.abs(body.velocity.y) * restitution;
    hitFloor = true;
  }

  return { submergedFraction, hitFloor };
}
