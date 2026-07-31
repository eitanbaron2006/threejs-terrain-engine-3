import * as THREE from 'three';

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export class WaterImpactEffects {
  constructor({ scene, capacity = 16, dropletCapacity = 96 } = {}) {
    this.scene = scene;
    this.capacity = Math.max(1, Math.round(finite(capacity, 16)));
    this.dropletCapacity = Math.max(1, Math.round(finite(dropletCapacity, 96)));
    this.randomState = 0x7f4a7c15;
    this.dummy = new THREE.Object3D();
    this.group = new THREE.Group();
    this.group.name = 'WaterImpactEffects';
    this.scene?.add(this.group);

    this.ringGeometry = new THREE.RingGeometry(0.72, 1, 40);
    this.rings = Array.from({ length: this.capacity }, () => {
      const material = new THREE.MeshBasicMaterial({
        color: '#d9f2f3',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.ringGeometry, material);
      mesh.rotation.x = -Math.PI * 0.5;
      mesh.renderOrder = 104;
      mesh.visible = false;
      this.group.add(mesh);
      return {
        mesh,
        active: false,
        age: 0,
        lifetime: 0.8,
        maximumRadius: 0.72,
      };
    });

    this.dropletGeometry = new THREE.SphereGeometry(0.035, 7, 5);
    this.dropletMaterial = new THREE.MeshPhysicalMaterial({
      color: '#e8fbff',
      roughness: 0.08,
      transmission: 0.18,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    this.dropletMesh = new THREE.InstancedMesh(
      this.dropletGeometry,
      this.dropletMaterial,
      this.dropletCapacity,
    );
    this.dropletMesh.name = 'WaterImpactDroplets';
    this.dropletMesh.frustumCulled = false;
    this.dropletMesh.renderOrder = 105;
    this.group.add(this.dropletMesh);
    this.droplets = Array.from({ length: this.dropletCapacity }, () => ({
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      age: 0,
      lifetime: 0.7,
      scale: 1,
      surfaceY: 0,
    }));
    this.#syncDroplets();
  }

  #random() {
    let value = this.randomState += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  #syncDroplets() {
    this.droplets.forEach((droplet, index) => {
      if (droplet.active) {
        this.dummy.position.copy(droplet.position);
        this.dummy.scale.setScalar(droplet.scale);
      } else {
        this.dummy.position.set(0, -100000, 0);
        this.dummy.scale.setScalar(0.0001);
      }
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.dropletMesh.setMatrixAt(index, this.dummy.matrix);
    });
    this.dropletMesh.instanceMatrix.needsUpdate = true;
  }

  spawn({
    x = 0,
    y = 0,
    z = 0,
    foamRadius = 0.62,
    foamLifetime = 0.8,
    dropletCount = 6,
    normalSpeed = 12,
  } = {}) {
    const ring = this.rings.find((item) => !item.active)
      ?? this.rings.reduce((oldest, item) => (item.age > oldest.age ? item : oldest));
    ring.active = true;
    ring.age = 0;
    ring.lifetime = THREE.MathUtils.clamp(finite(foamLifetime, 0.8), 0.25, 1.2);
    ring.maximumRadius = THREE.MathUtils.clamp(finite(foamRadius, 0.62), 0.22, 0.9);
    ring.mesh.position.set(x, y + 0.025, z);
    ring.mesh.scale.setScalar(0.16 * ring.maximumRadius);
    ring.mesh.material.opacity = 0.44;
    ring.mesh.visible = true;

    const count = THREE.MathUtils.clamp(
      Math.round(finite(dropletCount, 6)),
      0,
      Math.min(12, this.dropletCapacity),
    );
    const upwardSpeed = THREE.MathUtils.clamp(finite(normalSpeed, 12) * 0.085, 0.65, 2.8);
    for (let index = 0; index < count; index += 1) {
      const droplet = this.droplets.find((item) => !item.active);
      if (!droplet) break;
      const angle = index / Math.max(count, 1) * Math.PI * 2 + this.#random() * 0.55;
      const radialSpeed = 0.28 + this.#random() * 0.72;
      droplet.active = true;
      droplet.position.set(x, y + 0.04, z);
      droplet.velocity.set(
        Math.cos(angle) * radialSpeed,
        upwardSpeed * (0.72 + this.#random() * 0.38),
        Math.sin(angle) * radialSpeed,
      );
      droplet.age = 0;
      droplet.lifetime = THREE.MathUtils.clamp(0.35 + upwardSpeed * 0.17, 0.42, 0.82);
      droplet.scale = 0.65 + this.#random() * 0.55;
      droplet.surfaceY = y;
    }
    this.#syncDroplets();
  }

  update(deltaSeconds) {
    const delta = THREE.MathUtils.clamp(finite(deltaSeconds, 0), 0, 2);
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += delta;
      const progress = ring.age / ring.lifetime;
      if (progress >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        ring.mesh.material.opacity = 0;
        continue;
      }
      const radius = THREE.MathUtils.lerp(ring.maximumRadius * 0.16, ring.maximumRadius, progress);
      ring.mesh.scale.setScalar(radius);
      ring.mesh.material.opacity = 0.44 * (1 - progress) * (1 - progress);
    }

    for (const droplet of this.droplets) {
      if (!droplet.active) continue;
      droplet.age += delta;
      droplet.velocity.y -= 9.81 * delta;
      droplet.position.addScaledVector(droplet.velocity, delta);
      const expired = droplet.age >= droplet.lifetime
        || (droplet.velocity.y < 0 && droplet.position.y <= droplet.surfaceY);
      if (expired) {
        droplet.active = false;
        continue;
      }
      droplet.scale = Math.max(0.16, droplet.scale * (1 - delta * 0.8));
    }
    this.#syncDroplets();
  }

  get activeRingCount() {
    return this.rings.reduce((count, ring) => count + (ring.active ? 1 : 0), 0);
  }

  get activeDropletCount() {
    return this.droplets.reduce((count, droplet) => count + (droplet.active ? 1 : 0), 0);
  }

  dispose() {
    this.scene?.remove(this.group);
    for (const ring of this.rings) ring.mesh.material.dispose();
    this.ringGeometry.dispose();
    this.dropletGeometry.dispose();
    this.dropletMaterial.dispose();
  }
}
