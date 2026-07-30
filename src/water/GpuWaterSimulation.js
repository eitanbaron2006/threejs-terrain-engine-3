import * as THREE from 'three';

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const stepFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tInput;
  uniform vec2 uTexel;
  uniform float uWaveSpeed;
  uniform float uDamping;
  varying vec2 vUv;

  void main() {
    vec4 info = texture2D(tInput, vUv);
    float left = texture2D(tInput, vUv - vec2(uTexel.x, 0.0)).r;
    float right = texture2D(tInput, vUv + vec2(uTexel.x, 0.0)).r;
    float down = texture2D(tInput, vUv - vec2(0.0, uTexel.y)).r;
    float up = texture2D(tInput, vUv + vec2(0.0, uTexel.y)).r;
    float laplacian = left + right + down + up - 4.0 * info.r;
    float velocity = (info.g + laplacian * uWaveSpeed) * uDamping;
    float height = (info.r + velocity) * 0.9997;
    gl_FragColor = vec4(height, velocity, info.ba);
  }
`;

const dropFragment = /* glsl */ `
  precision highp float;
  const float PI = 3.141592653589793;
  uniform sampler2D tInput;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uStrength;
  varying vec2 vUv;

  void main() {
    vec4 info = texture2D(tInput, vUv);
    vec2 delta = abs(vUv - uCenter);
    delta = min(delta, 1.0 - delta);
    float drop = max(0.0, 1.0 - length(delta) / max(uRadius, 0.0001));
    drop = 0.5 - 0.5 * cos(drop * PI);
    info.r += drop * uStrength;
    gl_FragColor = info;
  }
`;

const normalFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D tInput;
  uniform vec2 uTexel;
  uniform float uNormalScale;
  varying vec2 vUv;

  void main() {
    vec4 info = texture2D(tInput, vUv);
    float left = texture2D(tInput, vUv - vec2(uTexel.x, 0.0)).r;
    float right = texture2D(tInput, vUv + vec2(uTexel.x, 0.0)).r;
    float down = texture2D(tInput, vUv - vec2(0.0, uTexel.y)).r;
    float up = texture2D(tInput, vUv + vec2(0.0, uTexel.y)).r;
    vec3 normal = normalize(vec3((left - right) * uNormalScale, 2.0, (down - up) * uNormalScale));
    info.ba = normal.xz;
    gl_FragColor = info;
  }
`;

function createTarget(size, type) {
  const target = new THREE.WebGLRenderTarget(size, size, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.wrapS = THREE.RepeatWrapping;
  target.texture.wrapT = THREE.RepeatWrapping;
  target.texture.generateMipmaps = false;
  return target;
}

export class GpuWaterSimulation {
  constructor(renderer, { size = 256, waveSpeed = 0.24, damping = 0.994, normalScale = 22 } = {}) {
    this.renderer = renderer;
    this.size = size;
    this.fixedStep = 1 / 60;
    this.accumulator = 0;
    this.maxSteps = 3;
    this.randomState = 0x53a9f13;

    const supportsFloat = renderer.capabilities.isWebGL2
      && renderer.extensions.has('EXT_color_buffer_float');
    const type = supportsFloat ? THREE.FloatType : THREE.HalfFloatType;
    this.targetA = createTarget(size, type);
    this.targetB = createTarget(size, type);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.stepMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: stepFragment,
      uniforms: {
        tInput: { value: null },
        uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
        uWaveSpeed: { value: waveSpeed },
        uDamping: { value: damping },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.dropMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: dropFragment,
      uniforms: {
        tInput: { value: null },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uRadius: { value: 0.035 },
        uStrength: { value: 0.015 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.normalMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: normalFragment,
      uniforms: {
        tInput: { value: null },
        uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
        uNormalScale: { value: normalScale },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(this.geometry, this.stepMaterial);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.#clear();
    this.#seed();
  }

  get texture() {
    return this.targetA.texture;
  }

  #random() {
    let value = this.randomState += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  #clear() {
    const previousTarget = this.renderer.getRenderTarget();
    const previousColor = new THREE.Color();
    this.renderer.getClearColor(previousColor);
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const target of [this.targetA, this.targetB]) {
      this.renderer.setRenderTarget(target);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousColor, previousAlpha);
  }

  #seed() {
    for (let index = 0; index < 18; index += 1) {
      this.addDrop(this.#random(), this.#random(), 0.018 + this.#random() * 0.045, (this.#random() - 0.5) * 0.025);
    }
    for (let index = 0; index < 12; index += 1) this.#step();
    this.#updateNormals();
  }

  #renderPass(material) {
    const previousTarget = this.renderer.getRenderTarget();
    this.quad.material = material;
    this.renderer.setRenderTarget(this.targetB);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previousTarget);
    const temporary = this.targetA;
    this.targetA = this.targetB;
    this.targetB = temporary;
  }

  #step() {
    this.stepMaterial.uniforms.tInput.value = this.targetA.texture;
    this.#renderPass(this.stepMaterial);
  }

  #updateNormals() {
    this.normalMaterial.uniforms.tInput.value = this.targetA.texture;
    this.#renderPass(this.normalMaterial);
  }

  addDrop(u, v, radius = 0.035, strength = 0.012) {
    this.dropMaterial.uniforms.tInput.value = this.targetA.texture;
    this.dropMaterial.uniforms.uCenter.value.set(THREE.MathUtils.euclideanModulo(u, 1), THREE.MathUtils.euclideanModulo(v, 1));
    this.dropMaterial.uniforms.uRadius.value = radius;
    this.dropMaterial.uniforms.uStrength.value = strength;
    this.#renderPass(this.dropMaterial);
  }

  update(deltaSeconds) {
    this.accumulator += Math.min(deltaSeconds, 0.05);
    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxSteps) {
      this.#step();
      this.accumulator -= this.fixedStep;
      steps += 1;
    }
    if (steps > 0) this.#updateNormals();
  }

  dispose() {
    this.targetA.dispose();
    this.targetB.dispose();
    this.geometry.dispose();
    this.stepMaterial.dispose();
    this.dropMaterial.dispose();
    this.normalMaterial.dispose();
  }
}
