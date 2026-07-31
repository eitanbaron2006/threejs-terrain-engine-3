import * as THREE from 'three';
import { sweptSphereHit } from '../player/ProjectilePhysics.js';
import {
  applySphereImpact,
  integrateBuoyantBody,
  sphereSimulationMass,
} from './WaterInteractionPhysics.js';

export function sampleWaterSurface(x, z, time, waveAmplitude = 0.34, waterLevel = 0) {
  const first = Math.sin((x * 0.82 + z * 0.57) * 0.014 + time * 0.78) * 0.50;
  const second = Math.sin((x * -0.34 + z * 0.94) * 0.026 - time * 1.16 + 1.7) * 0.28;
  const third = Math.sin((x * 0.96 + z * -0.28) * 0.051 + time * 1.72 + 4.1) * 0.14;
  return waterLevel + (first + second + third) * waveAmplitude;
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
  });
}

export class WaterInteractionSystem {
  constructor({ scene, spatialModel, settings = {} }) {
    this.scene = scene;
    this.spatialModel = spatialModel;
    this.settings = { ...settings };
    this.elapsed = 0;
    this.group = new THREE.Group();
    this.group.name = 'FloatingWaterTestObjects';
    this.scene.add(this.group);
    this.bodies = [];
    this.displacements = [];
    this.rebuild(spatialModel, this.settings);
  }

  rebuild(spatialModel = this.spatialModel, settings = this.settings) {
    this.spatialModel = spatialModel;
    this.settings = { ...settings };
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }
    this.bodies = [];

    const count = Math.max(0, Math.min(24, Math.round(Number(settings.floatingSphereCount ?? 12))));
    const radius = Math.max(0.8, Number(settings.floatingSphereRadius ?? 3.2));
    const positions = spatialModel.findPositions({
      count,
      minDepth: radius * 2.2,
      maxDepth: 52,
      minSpacing: radius * 11,
      margin: spatialModel.worldSize * 0.08,
      seedOffset: 11,
    });
    const geometry = new THREE.SphereGeometry(radius, 32, 20);
    const material = new THREE.MeshPhysicalMaterial({
      color: '#f7f8f5',
      roughness: 0.16,
      metalness: 0.02,
      clearcoat: 0.38,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.15,
    });

    positions.forEach((position, index) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `FloatingSphere${index + 1}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(
        position.x,
        spatialModel.waterLevel + radius * (0.08 + (index % 3) * 0.08),
        position.z,
      );
      this.group.add(mesh);
      this.bodies.push({
        mesh,
        position: mesh.position,
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        radius,
        density: Math.max(0.1, Number(settings.waterObjectDensity ?? 0.58)),
        mass: sphereSimulationMass(
          radius,
          Math.max(0.1, Number(settings.waterObjectDensity ?? 0.58)),
        ),
        anchor: new THREE.Vector2(position.x, position.z),
        initialPosition: mesh.position.clone(),
        initialQuaternion: mesh.quaternion.clone(),
        phase: index * 1.731,
      });
    });
    this.group.visible = settings.floatingSpheresEnabled !== false;
  }

  applySettings(settings) {
    const requiresRebuild = (
      settings.floatingSphereCount !== this.settings.floatingSphereCount
      || settings.floatingSphereRadius !== this.settings.floatingSphereRadius
    );
    this.settings = { ...settings };
    this.group.visible = this.settings.floatingSpheresEnabled !== false;
    for (const body of this.bodies) {
      body.density = Math.max(0.1, Number(settings.waterObjectDensity ?? 0.58));
      body.mass = sphereSimulationMass(body.radius, body.density);
    }
    if (requiresRebuild) this.rebuild(this.spatialModel, this.settings);
  }

  update(deltaSeconds) {
    if (!this.group.visible) return;
    this.displacements.length = 0;
    const delta = Math.min(Math.max(Number(deltaSeconds) || 0, 0), 0.05);
    this.elapsed += delta;
    const substeps = Math.max(1, Math.ceil(delta / 0.012));
    const step = delta / substeps;

    for (const body of this.bodies) {
      const previous = body.position.clone();
      for (let index = 0; index < substeps; index += 1) {
        const surfaceY = sampleWaterSurface(
          body.position.x,
          body.position.z,
          this.elapsed + body.phase,
          Number(this.settings.waveAmplitude ?? 0.34),
          this.spatialModel.waterLevel,
        );
        const floorY = this.spatialModel.sampleFloor(body.position.x, body.position.z);
        const waveDrift = Math.sin(this.elapsed * 0.72 + body.phase) * 0.24;
        body.velocity.x += waveDrift * step;
        body.velocity.z += Math.cos(this.elapsed * 0.58 + body.phase) * 0.18 * step;
        const integration = integrateBuoyantBody(body, {
          surfaceY,
          floorY,
          gravity: 9.81,
          dragCoefficient: 1.28,
          restitution: 0.12,
        }, step);
        const angularDamping = 1 / (
          1 + (0.16 + integration.submergedFraction * 2.4) * step
        );
        body.angularVelocity.multiplyScalar(angularDamping);
      }

      const dx = body.position.x - body.anchor.x;
      const dz = body.position.z - body.anchor.y;
      const distance = Math.hypot(dx, dz);
      if (distance > body.radius * 10) {
        const pull = (distance - body.radius * 10) * delta * 0.12 / Math.max(distance, 0.001);
        body.velocity.x -= dx * pull;
        body.velocity.z -= dz * pull;
      }
      body.mesh.rotation.x += body.velocity.z * delta / body.radius;
      body.mesh.rotation.z -= body.velocity.x * delta / body.radius;
      const angularSpeed = body.angularVelocity.length();
      if (angularSpeed > 1e-6) {
        const axis = body.angularVelocity.clone().multiplyScalar(1 / angularSpeed);
        const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angularSpeed * delta);
        body.mesh.quaternion.premultiply(rotation);
      }
      this.displacements.push({
        previous,
        current: body.position.clone(),
        radius: body.radius,
      });
    }
  }

  consumeDisplacements() {
    return this.displacements.splice(0);
  }

  traceProjectile(projectile) {
    if (!this.group.visible) return { hit: false };
    let nearest = null;
    for (const body of this.bodies) {
      const hit = sweptSphereHit(
        projectile.start,
        projectile.end,
        projectile.radius,
        body.position,
        body.radius,
      );
      if (!hit || (nearest && nearest.time <= hit.time)) continue;
      nearest = { ...hit, body };
    }
    if (!nearest) return { hit: false };

    const relativeVelocity = projectile.velocity.clone().sub(nearest.body.velocity);
    const contactOffset = nearest.normal.clone().multiplyScalar(nearest.body.radius);
    const impulse = applySphereImpact(nearest.body, {
      projectileMass: projectile.mass,
      relativeVelocity,
      normal: nearest.normal,
      contactOffset,
      restitution: 0.28,
    });
    if (impulse <= 0) return { hit: false };
    return {
      hit: true,
      time: nearest.time,
      point: nearest.point,
      normal: nearest.normal,
      body: nearest.body,
      impulse,
    };
  }

  reset() {
    this.displacements.length = 0;
    for (const body of this.bodies) {
      body.position.copy(body.initialPosition);
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.mesh.quaternion.copy(body.initialQuaternion);
    }
  }

  get count() {
    return this.bodies.length;
  }

  getDemoView() {
    const body = this.bodies[0];
    if (!body) return null;
    const surfaceY = this.spatialModel.waterLevel;
    return {
      position: {
        x: body.position.x + 24,
        y: surfaceY + 10,
        z: body.position.z + 26,
      },
      target: {
        x: body.position.x,
        y: surfaceY,
        z: body.position.z,
      },
    };
  }

  dispose() {
    this.scene.remove(this.group);
    disposeObject(this.group);
    this.bodies = [];
  }
}
