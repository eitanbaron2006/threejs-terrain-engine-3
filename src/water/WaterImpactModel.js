import * as THREE from 'three';

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function computeProjectileWaterImpact({
  radius = 0.16,
  mass = 2.4,
  velocity = new THREE.Vector3(),
  normal = new THREE.Vector3(0, 1, 0),
} = {}) {
  const safeRadius = Math.max(0.02, finite(radius, 0.16));
  const safeMass = Math.max(0.01, finite(mass, 2.4));
  const safeNormal = normal.clone().normalize();
  const normalSpeed = Math.max(0, -velocity.dot(safeNormal));
  const normalMomentum = safeMass * normalSpeed;

  return {
    normalSpeed,
    rippleRadius: THREE.MathUtils.clamp(
      safeRadius * 2.5 + Math.sqrt(normalMomentum) * 0.01,
      0.3,
      0.75,
    ),
    rippleStrength: THREE.MathUtils.clamp(normalMomentum * 0.00006, 0.00035, 0.008),
    foamRadius: THREE.MathUtils.clamp(safeRadius * 3.2 + normalSpeed * 0.008, 0.34, 0.9),
    foamLifetime: THREE.MathUtils.clamp(0.45 + normalSpeed * 0.012, 0.45, 1.05),
    dropletCount: Math.round(THREE.MathUtils.clamp(4 + normalSpeed / 6, 4, 12)),
  };
}
