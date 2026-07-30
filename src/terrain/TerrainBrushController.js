import * as THREE from 'three';

export class TerrainBrushController {
  constructor({ canvas, camera, controls, scene, world, history, eventBus, settings }) {
    this.canvas = canvas;
    this.camera = camera;
    this.controls = controls;
    this.scene = scene;
    this.world = world;
    this.history = history;
    this.eventBus = eventBus;
    this.settings = settings;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.painting = false;
    this.enabled = true;
    this.beforeState = null;
    this.strokeContext = null;
    this.lastPaintPoint = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.lastPaintTime = 0;

    const geometry = new THREE.RingGeometry(0.88, 1, 64);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: '#ffd65a',
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.helper = new THREE.Mesh(geometry, material);
    this.helper.visible = false;
    this.helper.renderOrder = 1000;
    scene.add(this.helper);

    this.#bindEvents();
  }

  #bindEvents() {
    this.onPointerMove = (event) => this.#handlePointerMove(event);
    this.onPointerDown = (event) => this.#handlePointerDown(event);
    this.onPointerUp = (event) => this.#handlePointerUp(event);
    this.onPointerLeave = () => {
      if (!this.painting) this.helper.visible = false;
    };
    this.onContextMenu = (event) => event.preventDefault();

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  #setPointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  #raycast(event) {
    this.#setPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.world.getMeshes(), false)[0] ?? null;
  }

  #updateHelper(hit) {
    if (!hit) {
      this.helper.visible = false;
      return;
    }
    this.helper.visible = true;
    this.helper.position.copy(hit.point);
    this.helper.position.y += 0.18;
    this.helper.scale.setScalar(this.settings.radius);
    this.world.setSelectedChunk(hit.object.userData.terrainChunk ?? null);
    this.eventBus.emit('brush:hover', {
      point: hit.point,
      chunk: hit.object.userData.terrainChunk,
    });
  }

  #captureBefore(point) {
    const localState = this.world.captureEditableState(
      point,
      this.settings.radius + this.world.config.chunkSize * 0.1,
    );
    const known = new Set(this.beforeState.chunks.map((chunk) => chunk.key));
    for (const chunk of localState.chunks) {
      if (!known.has(chunk.key)) {
        this.beforeState.chunks.push(chunk);
        known.add(chunk.key);
      }
    }
  }

  #handlePointerMove(event) {
    if (!this.enabled) return;
    const hit = this.#raycast(event);
    this.#updateHelper(hit);
    if (!this.painting || !hit) return;

    const now = performance.now();
    const minimumDistance = Math.max(0.35, this.settings.radius * 0.035);
    if (hit.point.distanceTo(this.lastPaintPoint) < minimumDistance && now - this.lastPaintTime < 22) return;

    this.#captureBefore(hit.point);
    this.world.applyBrush(hit.point, this.settings, this.strokeContext);
    this.lastPaintPoint.copy(hit.point);
    this.lastPaintTime = now;
  }

  #handlePointerDown(event) {
    if (!this.enabled) return;
    if (event.button !== 0 || event.altKey) return;
    const hit = this.#raycast(event);
    if (!hit) return;

    event.preventDefault();
    this.painting = true;
    this.controls.enabled = false;
    this.beforeState = { presetId: this.world.presetId, chunks: [] };
    this.#captureBefore(hit.point);
    this.strokeContext = {
      flattenHeight: hit.point.y,
      strokeSeed: Math.floor(Math.random() * 1_000_000),
      deferCommit: true,
      changedChunkKeys: new Set(),
      heightChanged: false,
    };
    this.lastPaintPoint.copy(hit.point);
    this.lastPaintTime = performance.now();
    this.world.applyBrush(hit.point, this.settings, this.strokeContext);
    this.canvas.setPointerCapture?.(event.pointerId);
    this.eventBus.emit('brush:stroke-start', { point: hit.point, tool: this.settings.tool });
  }

  #handlePointerUp(event) {
    if (!this.painting) return;
    this.painting = false;
    this.controls.enabled = true;
    this.canvas.releasePointerCapture?.(event.pointerId);

    this.world.finalizeBrush(this.strokeContext);
    const afterState = this.world.captureEditableStateForKeys(this.strokeContext.changedChunkKeys);
    this.history.push({
      label: this.settings.tool,
      before: this.beforeState,
      after: afterState,
    });
    this.beforeState = null;
    this.strokeContext = null;
    this.eventBus.emit('history:changed', {
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
    this.eventBus.emit('brush:stroke-end');
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.painting = false;
      this.helper.visible = false;
      this.controls.enabled = false;
    }
  }

  setRadius(radius) {
    this.settings.radius = radius;
    this.helper.scale.setScalar(radius);
  }

  dispose() {
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.helper.geometry.dispose();
    this.helper.material.dispose();
    this.scene.remove(this.helper);
  }
}
