import * as THREE from 'three';

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function sweptSphereHit(start, end, projectileRadius, center, targetRadius) {
  const motion = new THREE.Vector3().subVectors(end, start);
  const offset = new THREE.Vector3().subVectors(start, center);
  const radius = Math.max(0, finite(projectileRadius, 0))
    + Math.max(0, finite(targetRadius, 0));
  const a = motion.lengthSq();
  const c = offset.lengthSq() - radius * radius;
  if (c <= 0) {
    const normal = offset.lengthSq() > 1e-12
      ? offset.normalize()
      : motion.clone().normalize().negate();
    return { time: 0, point: start.clone(), normal };
  }
  if (a <= 1e-12) return null;
  const b = 2 * offset.dot(motion);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const time = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (time < 0 || time > 1) return null;
  const point = start.clone().addScaledVector(motion, time);
  const normal = point.clone().sub(center).normalize();
  return { time, point, normal };
}

export function integrateProjectile(body, environment = {}, deltaSeconds = 0) {
  const delta = Math.min(Math.max(finite(deltaSeconds, 0), 0), 0.05);
  const gravity = Math.max(0, finite(environment.gravity, 9.81));
  const surfaceY = finite(environment.surfaceY, -Infinity);
  const floorY = finite(environment.floorY, -Infinity);
  const waterDrag = Math.max(0, finite(environment.waterDrag, 0.085));
  const wasInWater = Boolean(body.inWater || body.position.y <= surfaceY);

  body.previousPosition.copy(body.position);
  body.velocity.y -= gravity * (wasInWater ? 0.22 : 1) * delta;
  if (wasInWater && waterDrag > 0) {
    const speed = body.velocity.length();
    const damping = 1 / (1 + waterDrag * speed * delta * 1.5);
    body.velocity.multiplyScalar(damping);
  }
  body.position.addScaledVector(body.velocity, delta);
  body.age = Math.max(0, finite(body.age, 0)) + delta;

  const nowInWater = body.position.y <= surfaceY;
  const enteredWater = !wasInWater && nowInWater;
  let waterEntryPoint = null;
  if (enteredWater) {
    const verticalTravel = body.previousPosition.y - body.position.y;
    const time = Math.abs(verticalTravel) > 1e-8
      ? THREE.MathUtils.clamp((body.previousPosition.y - surfaceY) / verticalTravel, 0, 1)
      : 1;
    waterEntryPoint = body.previousPosition.clone().lerp(body.position, time);
    waterEntryPoint.y = surfaceY;
  }
  body.inWater = nowInWater;
  const hitFloor = body.position.y - Math.max(0, finite(body.radius, 0)) <= floorY;
  const expired = body.age >= Math.max(0.01, finite(body.lifetime, 4));

  return {
    enteredWater,
    waterEntryPoint,
    hitFloor,
    expired,
  };
}
