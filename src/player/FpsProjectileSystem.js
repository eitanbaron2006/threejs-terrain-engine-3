import * as THREE from 'three';
import { integrateProjectile } from './ProjectilePhysics.js';

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export class FpsProjectileSystem {
  constructor({
    scene,
    camera,
    world,
    waterSystem = null,
    settings = {},
    capacity = 48,
    lifetime = 4,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.waterSystem = waterSystem;
    this.settings = { ...settings };
    this.capacity = Math.max(1, Math.round(finite(capacity, 48)));
    this.lifetime = Math.max(0.05, finite(lifetime, 4));
    this.cooldownRemaining = 0;
    this.direction = new THREE.Vector3();
    this.contactNormal = new THREE.Vector3();
    this.contactTangent = new THREE.Vector3();
    this.dummy = new THREE.Object3D();
    this.geometry = new THREE.SphereGeometry(0.16, 12, 8);
    this.material = new THREE.MeshPhysicalMaterial({
      color: '#f4d18a',
      emissive: '#7a4d12',
      emissiveIntensity: 0.32,
      roughness: 0.24,
      metalness: 0.42,
      clearcoat: 0.28,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.name = 'FpsPhysicalProjectiles';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);
    this.projectiles = Array.from({ length: this.capacity }, () => ({
      active: false,
      position: new THREE.Vector3(),
      previousPosition: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      radius: 0.16,
      mass: 2.4,
      age: 0,
      lifetime: this.lifetime,
      inWater: false,
      sleeping: false,
    }));
    this.createdProjectileCount = this.projectiles.length;
    this.#syncAllMatrices();
  }

  #syncMatrix(projectile, index) {
    if (projectile.active) {
      this.dummy.position.copy(projectile.position);
      this.dummy.scale.setScalar(1);
    } else {
      this.dummy.position.set(0, -100000, 0);
      this.dummy.scale.setScalar(0.0001);
    }
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(index, this.dummy.matrix);
  }

  #syncAllMatrices() {
    this.projectiles.forEach((projectile, index) => this.#syncMatrix(projectile, index));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  #release(projectile) {
    projectile.active = false;
    projectile.velocity.set(0, 0, 0);
    projectile.age = 0;
    projectile.inWater = false;
    projectile.sleeping = false;
  }

  fire({ fpsEnabled = false, pointerLocked = false } = {}) {
    if (
      this.settings.fpsProjectilesEnabled === false
      || !fpsEnabled
      || !pointerLocked
      || this.cooldownRemaining > 0
    ) return false;
    const projectile = this.projectiles.find((item) => !item.active);
    if (!projectile) return false;

    this.camera.getWorldDirection(this.direction).normalize();
    projectile.position.copy(this.camera.position).addScaledVector(this.direction, 0.85);
    projectile.previousPosition.copy(projectile.position);
    projectile.velocity.copy(this.direction).multiplyScalar(
      Math.max(1, finite(this.settings.projectileSpeed, 70)),
    );
    projectile.mass = Math.max(0.05, finite(this.settings.projectileMass, 2.4));
    projectile.age = 0;
    projectile.lifetime = this.lifetime;
    projectile.inWater = false;
    projectile.sleeping = false;
    projectile.active = true;
    this.cooldownRemaining = 1 / Math.max(
      0.5,
      finite(this.settings.projectileFireRate, 5),
    );
    this.#syncAllMatrices();
    return true;
  }

  #stepProjectile(projectile, delta) {
    if (projectile.sleeping) {
      projectile.age += delta;
      if (projectile.age >= projectile.lifetime) this.#release(projectile);
      return;
    }
    const surfaceY = this.waterSystem?.getSurfaceHeight(
      projectile.position.x,
      projectile.position.z,
    ) ?? -Infinity;
    const floorY = this.world.sampleHeight(
      projectile.position.x,
      projectile.position.z,
    );
    const result = integrateProjectile(projectile, {
      gravity: 9.81,
      surfaceY,
      floorY,
      waterDrag: 0.085,
    }, delta);

    if (result.enteredWater) {
      const entry = result.waterEntryPoint ?? projectile.position;
      if (typeof this.waterSystem?.addProjectileWaterImpact === 'function') {
        this.waterSystem.addProjectileWaterImpact({
          x: entry.x,
          z: entry.z,
          velocity: projectile.velocity.clone(),
          radius: projectile.radius,
          mass: projectile.mass,
        });
      } else {
        this.waterSystem?.addProjectileRipple(entry.x, entry.z, -0.006, 0.48);
      }
    }
    const impact = this.waterSystem?.traceProjectile({
      start: projectile.previousPosition,
      end: projectile.position,
      velocity: projectile.velocity,
      radius: projectile.radius,
      mass: projectile.mass,
    });
    if (impact?.hit) {
      projectile.position.copy(impact.point).addScaledVector(impact.normal, 0.012);
      projectile.velocity.addScaledVector(
        impact.normal,
        impact.impulse / Math.max(projectile.mass, 0.05),
      );
      return;
    }
    if (result.hitFloor) {
      const floorAtContact = this.world.sampleHeight(
        projectile.position.x,
        projectile.position.z,
      );
      projectile.position.y = floorAtContact + projectile.radius + 0.004;
      if (typeof this.world.getNormalAt === 'function') {
        this.world.getNormalAt(
          projectile.position.x,
          projectile.position.z,
          this.contactNormal,
        );
      } else {
        this.contactNormal.set(0, 1, 0);
      }
      this.contactNormal.normalize();
      const inwardSpeed = projectile.velocity.dot(this.contactNormal);
      if (inwardSpeed < 0) {
        projectile.velocity.addScaledVector(this.contactNormal, -1.34 * inwardSpeed);
      }
      this.contactTangent.copy(projectile.velocity).addScaledVector(
        this.contactNormal,
        -projectile.velocity.dot(this.contactNormal),
      );
      projectile.velocity.addScaledVector(this.contactTangent, -0.34);
      if (projectile.velocity.lengthSq() < 1.1 * 1.1) {
        projectile.velocity.set(0, 0, 0);
        projectile.sleeping = true;
      }
    }
    if (result.expired) this.#release(projectile);
  }

  update(deltaSeconds) {
    const total = Math.min(Math.max(finite(deltaSeconds, 0), 0), 0.2);
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - total);
    const substeps = Math.max(1, Math.ceil(total / 0.016));
    const step = substeps > 0 ? total / substeps : 0;
    for (let substep = 0; substep < substeps; substep += 1) {
      for (const projectile of this.projectiles) {
        if (projectile.active) this.#stepProjectile(projectile, step);
      }
    }
    this.#syncAllMatrices();
  }

  applySettings(settings) {
    Object.assign(this.settings, settings);
    if (this.settings.fpsProjectilesEnabled === false) this.clear();
  }

  clear() {
    this.projectiles.forEach((projectile) => this.#release(projectile));
    this.#syncAllMatrices();
  }

  get activeCount() {
    return this.projectiles.reduce((count, projectile) => (
      count + (projectile.active ? 1 : 0)
    ), 0);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.projectiles = [];
  }
}
