import * as THREE from 'three';
import { DEFAULT_FPS_SETTINGS } from '../terrain/TerrainConfig.js';

const UP = new THREE.Vector3(0, 1, 0);

export class FpsPlayerController {
  constructor({ canvas, camera, world, eventBus, settings = DEFAULT_FPS_SETTINGS }) {
    this.canvas = canvas;
    this.camera = camera;
    this.world = world;
    this.eventBus = eventBus;
    this.settings = { ...DEFAULT_FPS_SETTINGS, ...settings };
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.enabled = false;
    this.grounded = false;
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
    this.onCanvasClick = () => {
      if (this.enabled && document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock?.();
    };

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('click', this.onCanvasClick);
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
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space'].includes(code)) {
      event.preventDefault();
      this.keys.add(code);
    }
    if (code === 'Space' && this.grounded) {
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

    this.#syncCamera();
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.eventBus.emit('fps:status', {
      position: this.position,
      grounded: this.grounded,
      running,
    });
  }

  dispose() {
    this.stop();
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('click', this.onCanvasClick);
  }
}
