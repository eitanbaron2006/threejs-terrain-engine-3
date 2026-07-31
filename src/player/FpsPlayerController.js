import * as THREE from 'three';
import { DEFAULT_FPS_SETTINGS } from '../terrain/TerrainConfig.js';

const UP = new THREE.Vector3(0, 1, 0);

export class FpsPlayerController {
  constructor({
    canvas,
    camera,
    world,
    waterSystem = null,
    projectileSystem = null,
    eventBus,
    settings = DEFAULT_FPS_SETTINGS,
  }) {
    this.canvas = canvas;
    this.camera = camera;
    this.world = world;
    this.waterSystem = waterSystem;
    this.projectileSystem = projectileSystem;
    this.eventBus = eventBus;
    this.settings = { ...DEFAULT_FPS_SETTINGS, ...settings };
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.enabled = false;
    this.grounded = false;
    this.swimming = false;
    this.yaw = 0;
    this.pitch = 0;
    this.normal = new THREE.Vector3();
    this.moveVector = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();

    this.onMouseMove = (event) => this.#handleMouseMove(event);
    this.onKeyDown = (event) => this.#handleKeyDown(event);
    this.onKeyUp = (event) => this.#handleKeyUp(event);
    this.onPointerLockChange = () => this.#handlePointerLockChange();
    this.onCanvasPointerDown = (event) => {
      if (!this.enabled || event.button !== 0) return;
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock?.();
        return;
      }
      this.projectileSystem?.fire({
        fpsEnabled: this.enabled,
        pointerLocked: true,
      });
    };

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
  }

  start(spawnPoint) {
    this.enabled = true;
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    this.position.set(spawnPoint.x, this.world.sampleHeight(spawnPoint.x, spawnPoint.z), spawnPoint.z);
    this.world.clampToBounds(this.position, 0.8);
    this.position.y = this.world.sampleHeight(this.position.x, this.position.z);
    this.grounded = true;
    this.yaw = 0;
    this.pitch = -0.08;
    this.#syncCamera();
    this.canvas.requestPointerLock?.();
    this.eventBus.emit('fps:started', { position: this.position.clone() });
  }

  stop() {
    if (!this.enabled) return;
    this.enabled = false;
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.eventBus.emit('fps:stopped');
  }

  #handlePointerLockChange() {
    if (!this.enabled) return;
    const locked = document.pointerLockElement === this.canvas;
    this.eventBus.emit('fps:pointer-lock', { locked });
    if (!locked) this.eventBus.emit('fps:request-exit');
  }

  #handleMouseMove(event) {
    if (!this.enabled || document.pointerLockElement !== this.canvas) return;
    this.yaw -= event.movementX * this.settings.mouseSensitivity;
    this.pitch -= event.movementY * this.settings.mouseSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.49, Math.PI * 0.49);
  }

  #handleKeyDown(event) {
    if (!this.enabled) return;
    const code = event.code;
    if ([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ShiftLeft',
      'ShiftRight',
      'Space',
      'ControlLeft',
      'ControlRight',
    ].includes(code)) {
      event.preventDefault();
      this.keys.add(code);
    }
    if (code === 'Space' && this.grounded && !this.swimming) {
      this.velocity.y = this.settings.jumpSpeed;
      this.grounded = false;
    }
  }

  #handleKeyUp(event) {
    if (!this.enabled) return;
    this.keys.delete(event.code);
  }

  #canMoveTo(x, z, currentGround) {
    const targetGround = this.world.sampleHeight(x, z);
    const rise = targetGround - currentGround;
    this.world.getNormalAt(x, z, this.normal);
    const slopeDegrees = Math.acos(THREE.MathUtils.clamp(this.normal.dot(UP), -1, 1)) * THREE.MathUtils.RAD2DEG;
    return rise <= this.settings.maxStepHeight && (slopeDegrees <= this.settings.maxSlopeDegrees || targetGround <= currentGround);
  }

  #moveHorizontal(delta) {
    this.moveVector.set(0, 0, 0);
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.keys.has('KeyW')) this.moveVector.add(this.forward);
    if (this.keys.has('KeyS')) this.moveVector.sub(this.forward);
    if (this.keys.has('KeyD')) this.moveVector.add(this.right);
    if (this.keys.has('KeyA')) this.moveVector.sub(this.right);
    if (this.moveVector.lengthSq() === 0) return;

    this.moveVector.normalize();
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = running ? this.settings.runSpeed : this.settings.walkSpeed;
    const dx = this.moveVector.x * speed * delta;
    const dz = this.moveVector.z * speed * delta;
    const currentGround = this.world.sampleHeight(this.position.x, this.position.z);

    const targetX = this.position.x + dx;
    const targetZ = this.position.z + dz;
    if (this.#canMoveTo(targetX, targetZ, currentGround)) {
      this.position.x = targetX;
      this.position.z = targetZ;
    } else {
      if (this.#canMoveTo(targetX, this.position.z, currentGround)) this.position.x = targetX;
      if (this.#canMoveTo(this.position.x, targetZ, currentGround)) this.position.z = targetZ;
    }
    this.world.clampToBounds(this.position, 0.8);
  }

  #updateSwimming(delta) {
    this.moveVector.set(0, 0, 0);
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (this.keys.has('KeyW')) this.moveVector.add(this.forward);
    if (this.keys.has('KeyS')) this.moveVector.sub(this.forward);
    if (this.keys.has('KeyD')) this.moveVector.add(this.right);
    if (this.keys.has('KeyA')) this.moveVector.sub(this.right);
    if (this.keys.has('Space')) this.moveVector.y += 1;
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) this.moveVector.y -= 1;
    if (this.moveVector.lengthSq() > 0) this.moveVector.normalize();

    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = fast ? this.settings.swimFastSpeed : this.settings.swimSpeed;
    const response = 1 - Math.exp(-this.settings.swimAcceleration * delta);
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, this.moveVector.x * speed, response);
    this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, this.moveVector.y * speed, response);
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, this.moveVector.z * speed, response);
    this.position.addScaledVector(this.velocity, delta);
    this.world.clampToBounds(this.position, 0.8);

    const floorHeight = this.world.sampleHeight(this.position.x, this.position.z);
    this.position.y = Math.max(this.position.y, floorHeight + this.settings.swimFloorClearance);
    const surfaceHeight = this.waterSystem.getSurfaceHeight(this.position.x, this.position.z);
    const headHeight = this.position.y + this.settings.eyeHeight;
    if (headHeight > surfaceHeight + 0.42 && this.moveVector.y >= 0) {
      this.position.y = Math.min(this.position.y, surfaceHeight + 0.42 - this.settings.eyeHeight);
      this.velocity.y = Math.min(this.velocity.y, 0.8);
    }
    this.grounded = this.position.y <= floorHeight + this.settings.swimFloorClearance + 0.01;
  }

  #syncCamera() {
    this.camera.position.set(
      this.position.x,
      this.position.y + this.settings.eyeHeight,
      this.position.z,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(deltaSeconds) {
    if (!this.enabled) return;
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.05);
    const substeps = Math.max(1, Math.ceil(delta / 0.016));
    const step = delta / substeps;

    for (let i = 0; i < substeps; i += 1) {
      const surfaceHeight = this.waterSystem?.getSurfaceHeight(this.position.x, this.position.z) ?? -Infinity;
      const eyeHeight = this.position.y + this.settings.eyeHeight;
      this.swimming = Boolean(
        this.waterSystem?.isSwimmable(this.position.x, this.position.z, this.settings.swimMinimumDepth)
        && eyeHeight < surfaceHeight + 0.18,
      );
      if (this.swimming) {
        this.#updateSwimming(step);
      } else {
        this.#moveHorizontal(step);
        this.velocity.y -= this.settings.gravity * step;
        this.position.y += this.velocity.y * step;
        const groundHeight = this.world.sampleHeight(this.position.x, this.position.z);
        if (this.position.y <= groundHeight) {
          this.position.y = groundHeight;
          this.velocity.y = 0;
          this.grounded = true;
        } else {
          this.grounded = false;
        }
      }
    }

    this.#syncCamera();
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.eventBus.emit('fps:status', {
      position: this.position,
      grounded: this.grounded,
      running,
      swimming: this.swimming,
    });
  }

  dispose() {
    this.stop();
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
  }
}
