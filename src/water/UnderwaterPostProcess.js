import * as THREE from 'three';

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function updateUnderwaterState(previous, cameraY, surfaceY, {
  enabled = true,
  enterOffset = 0.1,
  exitOffset = 0.22,
} = {}) {
  if (!enabled || !Number.isFinite(Number(cameraY)) || !Number.isFinite(Number(surfaceY))) return false;
  const cameraHeight = Number(cameraY);
  const surfaceHeight = Number(surfaceY);
  return previous
    ? cameraHeight < surfaceHeight + Math.max(0, finite(exitOffset, 0.22))
    : cameraHeight < surfaceHeight - Math.max(0, finite(enterOffset, 0.1));
}

const vertexShader = /* glsl */ `
  precision highp float;

  in vec3 position;
  in vec2 uv;
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  layout(location = 0) out highp vec4 underwaterFragmentColor;

  uniform sampler2D uSceneColor;
  uniform sampler2D uSceneDepth;
  uniform mat4 uInverseProjectionMatrix;
  uniform mat4 uInverseViewMatrix;
  uniform vec3 uCameraPosition;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uWaterLevel;
  uniform float uTime;
  uniform float uOpticalDensity;
  in vec2 vUv;

  vec3 worldPositionFromDepth(vec2 screenUv, float depth) {
    vec4 clipPosition = vec4(screenUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 viewPosition = uInverseProjectionMatrix * clipPosition;
    viewPosition /= max(abs(viewPosition.w), 0.000001);
    return (uInverseViewMatrix * vec4(viewPosition.xyz, 1.0)).xyz;
  }

  float causticPattern(vec2 point, float time) {
    vec2 first = sin(point * mat2(0.83, -0.56, 0.56, 0.83) * 0.46 + vec2(time * 0.72, -time * 0.51));
    vec2 second = sin(point * mat2(0.62, 0.78, -0.78, 0.62) * 0.71 + vec2(-time * 0.43, time * 0.66));
    float crossing = abs(first.x + first.y + second.x + second.y) * 0.25;
    return pow(clamp(1.0 - crossing, 0.0, 1.0), 7.0);
  }

  float softNoise(vec2 point) {
    return fract(sin(dot(floor(point), vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    float depth = texture(uSceneDepth, vUv).r;
    vec3 sourceColor = texture(uSceneColor, vUv).rgb;
    vec3 worldPosition = worldPositionFromDepth(vUv, min(depth, 0.999999));
    vec3 viewVector = worldPosition - uCameraPosition;
    float viewDistance = min(length(viewVector), uCameraFar);
    vec3 viewDirection = normalize(viewVector);
    float cameraDepth = max(uWaterLevel - uCameraPosition.y, 0.0);
    float density = max(0.35, uOpticalDensity);

    vec3 absorption = vec3(0.036, 0.015, 0.008) * density;
    vec3 transmittance = exp(-absorption * min(viewDistance, 180.0));
    float scatterAmount = 1.0 - exp(-viewDistance * 0.018 * density);
    float deepMix = smoothstep(3.0, 34.0, cameraDepth);
    vec3 volumeColor = mix(uShallowColor * 0.82, uDeepColor * 0.72, deepMix);
    vec3 color = sourceColor * transmittance + volumeColor * scatterAmount * (1.0 - transmittance * 0.28);

    if (depth < 0.99999 && worldPosition.y < uWaterLevel) {
      vec3 normal = normalize(cross(dFdx(worldPosition), dFdy(worldPosition)));
      if (normal.y < 0.0) normal *= -1.0;
      float floorFacing = smoothstep(0.04, 0.72, dot(normal, normalize(uSunDirection)));
      float objectDepth = max(uWaterLevel - worldPosition.y, 0.0);
      float depthFade = exp(-objectDepth * 0.052 * density);
      float caustic = causticPattern(worldPosition.xz, uTime);
      caustic += causticPattern(worldPosition.xz * 1.73 + 17.0, uTime * 0.83) * 0.38;
      color += uSunColor * caustic * floorFacing * depthFade * 0.42;
    }

    float shaftAlignment = pow(max(dot(viewDirection, normalize(uSunDirection)), 0.0), 20.0);
    float shaftNoise = mix(0.72, 1.0, softNoise(vUv * vec2(120.0, 72.0) + uTime * 0.35));
    float shaftDepthFade = exp(-cameraDepth * 0.07) * scatterAmount;
    color += uSunColor * shaftAlignment * shaftNoise * shaftDepthFade * 0.14;

    float surfaceGlow = exp(-cameraDepth * 0.16) * max(viewDirection.y, 0.0);
    color += mix(uShallowColor, uSunColor, 0.52) * surfaceGlow * 0.09;
    underwaterFragmentColor = vec4(max(color, vec3(0.0)), 1.0);
    #include <colorspace_fragment>
  }
`;

export class UnderwaterPostProcess {
  constructor({ renderer, camera, waterLevel, settings = {} }) {
    this.renderer = renderer;
    this.camera = camera;
    this.waterLevel = finite(waterLevel, 0);
    this.settings = { ...settings };
    this.active = false;
    this.scene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      name: 'UnderwaterVolumePostProcess',
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSceneColor: { value: null },
        uSceneDepth: { value: null },
        uInverseProjectionMatrix: { value: camera.projectionMatrixInverse.clone() },
        uInverseViewMatrix: { value: camera.matrixWorld.clone() },
        uCameraPosition: { value: camera.position.clone() },
        uSunDirection: { value: new THREE.Vector3(0.48, 1, 0.31).normalize() },
        uSunColor: { value: new THREE.Color('#fff1cf') },
        uShallowColor: { value: new THREE.Color(settings.shallowColor ?? '#2faaa3') },
        uDeepColor: { value: new THREE.Color(settings.deepColor ?? '#07385f') },
        uCameraNear: { value: camera.near },
        uCameraFar: { value: camera.far },
        uWaterLevel: { value: this.waterLevel },
        uTime: { value: 0 },
        uOpticalDensity: { value: finite(settings.underwaterOpticalDensity, 1) },
      },
      vertexShader,
      fragmentShader,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.#createTarget(2, 2);
  }

  #createTarget(width, height) {
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target.texture.name = 'UnderwaterSceneColor';
    this.target.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    this.target.depthTexture.format = THREE.DepthFormat;
    this.target.depthTexture.minFilter = THREE.NearestFilter;
    this.target.depthTexture.magFilter = THREE.NearestFilter;
    this.material.uniforms.uSceneColor.value = this.target.texture;
    this.material.uniforms.uSceneDepth.value = this.target.depthTexture;
  }

  resize(width, height, pixelRatio = 1) {
    const targetWidth = Math.max(2, Math.min(2560, Math.round(width * pixelRatio)));
    const targetHeight = Math.max(2, Math.min(1440, Math.round(height * pixelRatio)));
    if (this.target.width !== targetWidth || this.target.height !== targetHeight) {
      this.#createTarget(targetWidth, targetHeight);
    }
  }

  applySettings(settings) {
    this.settings = { ...settings };
    this.material.uniforms.uShallowColor.value.set(settings.shallowColor ?? '#2faaa3');
    this.material.uniforms.uDeepColor.value.set(settings.deepColor ?? '#07385f');
    this.material.uniforms.uOpticalDensity.value = finite(settings.underwaterOpticalDensity, 1);
    if (settings.underwaterOpticsEnabled === false) this.active = false;
  }

  update({ time, surfaceY, sunDirection, sunColor }) {
    this.active = updateUnderwaterState(
      this.active,
      this.camera.position.y,
      finite(surfaceY, this.waterLevel),
      { enabled: this.settings.underwaterOpticsEnabled !== false },
    );
    const uniforms = this.material.uniforms;
    uniforms.uTime.value = finite(time, 0);
    uniforms.uCameraNear.value = this.camera.near;
    uniforms.uCameraFar.value = this.camera.far;
    uniforms.uInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
    uniforms.uInverseViewMatrix.value.copy(this.camera.matrixWorld);
    uniforms.uCameraPosition.value.copy(this.camera.position);
    if (sunDirection) uniforms.uSunDirection.value.copy(sunDirection);
    if (sunColor) uniforms.uSunColor.value.copy(sunColor);
  }

  render(outputTarget = null) {
    this.renderer.setRenderTarget(outputTarget);
    this.renderer.render(this.scene, this.postCamera);
  }

  dispose() {
    this.target.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
