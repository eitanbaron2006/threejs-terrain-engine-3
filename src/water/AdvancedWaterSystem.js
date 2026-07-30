import * as THREE from 'three';
import { createTerrainHeightSampler } from '../terrain/noise.js';
import { GpuWaterSimulation } from './GpuWaterSimulation.js';

const BATHYMETRY_RESOLUTION = 384;
const BATHYMETRY_MAX_DEPTH = 255;

function createRadialGeometry(radius, rings = 96, segments = 256) {
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices = [];

  for (let ring = 1; ring <= rings; ring += 1) {
    const normalized = ring / rings;
    const radialDistance = radius * Math.pow(normalized, 1.62);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = segment / segments * Math.PI * 2;
      positions.push(Math.cos(angle) * radialDistance, 0, Math.sin(angle) * radialDistance);
      uvs.push(Math.cos(angle) * normalized * 0.5 + 0.5, Math.sin(angle) * normalized * 0.5 + 0.5);
    }
  }

  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(0, 1 + segment, 1 + ((segment + 1) % segments));
  }

  for (let ring = 1; ring < rings; ring += 1) {
    const previousStart = 1 + (ring - 1) * segments;
    const currentStart = 1 + ring * segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = previousStart + segment;
      const b = previousStart + next;
      const c = currentStart + segment;
      const d = currentStart + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createBathymetryData(config, generatorSettings = {}, {
  resolution = BATHYMETRY_RESOLUTION,
  maxDepth = BATHYMETRY_MAX_DEPTH,
} = {}) {
  const safeResolution = Math.max(2, Math.round(Number(resolution) || BATHYMETRY_RESOLUTION));
  const safeMaxDepth = Math.max(1, Number(maxDepth) || BATHYMETRY_MAX_DEPTH);
  const worldSize = Math.max(1, Number(config.worldSizeKm ?? 8) * 1000);
  const waterLevel = Number(config.waterLevel ?? -3);
  const terrainSettings = {
    ...generatorSettings,
    worldRadius: worldSize * 0.5,
    waterLevel,
  };
  const sampleTerrainHeight = createTerrainHeightSampler(terrainSettings);
  const data = new Uint8Array(safeResolution * safeResolution);

  for (let z = 0; z < safeResolution; z += 1) {
    const worldZ = ((z + 0.5) / safeResolution - 0.5) * worldSize;
    for (let x = 0; x < safeResolution; x += 1) {
      const worldX = ((x + 0.5) / safeResolution - 0.5) * worldSize;
      const terrainHeight = sampleTerrainHeight(worldX, worldZ);
      const waterDepth = Math.min(safeMaxDepth, Math.max(0, waterLevel - terrainHeight));
      data[z * safeResolution + x] = Math.round(waterDepth / safeMaxDepth * 255);
    }
  }

  return {
    data,
    resolution: safeResolution,
    worldSize,
    maxDepth: safeMaxDepth,
  };
}

function createBathymetryTexture(bathymetry) {
  const texture = new THREE.DataTexture(
    bathymetry.data,
    bathymetry.resolution,
    bathymetry.resolution,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'GeneratedTerrainBathymetry';
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const waterVertexShader = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  uniform sampler2D uSimulation;
  uniform float uTime;
  uniform float uWaterLevel;
  uniform float uOceanRadius;
  uniform float uSimulationWorldSize;
  uniform float uWaveAmplitude;
  uniform float uRippleAmplitude;
  uniform float uHorizonCurvature;

  out vec3 vWorldPosition;
  out float vViewDistance;
  out vec2 vSimulationUv;

  float directionalWave(vec2 p, vec2 direction, float frequency, float speed, float phase) {
    return sin(dot(p, direction) * frequency + uTime * speed + phase);
  }

  void main() {
    vec4 baseWorld = modelMatrix * vec4(position, 1.0);
    vec2 worldXZ = baseWorld.xz;
    vec2 simulationUv = worldXZ / uSimulationWorldSize;
    vec4 simulation = texture(uSimulation, simulationUv);

    float wave = directionalWave(worldXZ, normalize(vec2(0.82, 0.57)), 0.014, 0.78, 0.0) * 0.50;
    wave += directionalWave(worldXZ, normalize(vec2(-0.34, 0.94)), 0.026, -1.16, 1.7) * 0.28;
    wave += directionalWave(worldXZ, normalize(vec2(0.96, -0.28)), 0.051, 1.72, 4.1) * 0.14;

    float radial = clamp(length(position.xz) / uOceanRadius, 0.0, 1.0);
    float curvature = uHorizonCurvature * pow(radial, 2.35);
    baseWorld.y = uWaterLevel + wave * uWaveAmplitude + simulation.r * uRippleAmplitude - curvature;

    vec4 viewPosition = viewMatrix * baseWorld;
    vWorldPosition = baseWorld.xyz;
    vViewDistance = -viewPosition.z;
    vSimulationUv = simulationUv;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const waterFragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  layout(location = 0) out highp vec4 waterFragmentColor;
  #define gl_FragColor waterFragmentColor

  uniform sampler2D uSimulation;
  uniform sampler2D uSceneColor;
  uniform sampler2D uSceneDepth;
  uniform sampler2D uBathymetryMap;
  uniform vec2 uResolution;
  uniform vec2 uDepthTexel;
  uniform mat4 uInverseProjectionMatrix;
  uniform mat4 uInverseViewMatrix;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uBathymetryWorldSize;
  uniform float uBathymetryMaxDepth;
  uniform float uHasBathymetryMap;
  uniform float uTime;
  uniform float uWaterLevel;
  uniform float uSimulationNormalStrength;
  uniform float uRefractionStrength;
  uniform float uShoreFade;
  uniform float uFoamStrength;
  uniform float uOpacity;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform sampler2D uEnvironmentMap;
  uniform float uHasEnvironmentMap;

  in vec3 vWorldPosition;
  in float vViewDistance;
  in vec2 vSimulationUv;

  float perspectiveDepthToViewZ(float depth, float near, float far) {
    return (near * far) / ((far - near) * depth - far);
  }

  vec3 sceneWorldPosition(vec2 uv, float depth) {
    vec4 clipPosition = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 viewPosition = uInverseProjectionMatrix * clipPosition;
    float invW = 1.0 / (abs(viewPosition.w) > 0.000001 ? viewPosition.w : 0.000001);
    viewPosition.xyz *= invW;
    viewPosition.w = 1.0;
    return (uInverseViewMatrix * viewPosition).xyz;
  }

  vec3 proceduralOceanBottomPosition() {
    return vec3(vWorldPosition.x, uWaterLevel - 180.0, vWorldPosition.z);
  }

  float viewDistanceToWorld(vec3 worldPosition) {
    vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
    return max(0.1, -viewPosition.z);
  }

  float sceneDistanceAt(vec2 uv) {
    float depth = texture(uSceneDepth, clamp(uv, vec2(0.001), vec2(0.999))).r;
    if (depth >= 0.99999) {
      return viewDistanceToWorld(proceduralOceanBottomPosition());
    }
    return -perspectiveDepthToViewZ(depth, uCameraNear, uCameraFar);
  }

  float filteredSceneDistance(vec2 uv) {
    float center = sceneDistanceAt(uv);
    float weighted = center * 2.0;
    float totalWeight = 2.0;
    vec2 offsets[8] = vec2[8](
      vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
      vec2(1.0, 1.0), vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(-1.0, -1.0)
    );
    for (int index = 0; index < 8; index++) {
      float sampleDistance = sceneDistanceAt(uv + offsets[index] * uDepthTexel);
      float relativeDifference = abs(sampleDistance - center) / max(center, 1.0);
      float weight = exp(-relativeDifference * 48.0);
      weighted += sampleDistance * weight;
      totalWeight += weight;
    }
    return weighted / max(totalWeight, 0.0001);
  }

  float sampleBathymetryDepth(vec2 worldXZ) {
    vec2 uv = worldXZ / max(uBathymetryWorldSize, 1.0) + 0.5;
    float insideMap = step(0.0, uv.x) * step(uv.x, 1.0)
      * step(0.0, uv.y) * step(uv.y, 1.0);
    float generatedDepth = texture(uBathymetryMap, clamp(uv, vec2(0.0), vec2(1.0))).r
      * uBathymetryMaxDepth;
    return mix(180.0, generatedDepth, insideMap * uHasBathymetryMap);
  }

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float noise21(vec2 point) {
    vec2 cell = floor(point);
    vec2 f = fract(point);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm21(vec2 point) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += noise21(point) * amplitude;
      point = point * 2.03 + vec2(13.7, -9.2);
      amplitude *= 0.5;
    }
    return sum;
  }

  vec2 equirectUv(vec3 direction) {
    vec3 dir = normalize(direction);
    return vec2(atan(dir.z, dir.x) * 0.15915494309189535 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.3183098861837907 + 0.5);
  }

  vec3 proceduralSky(vec3 direction) {
    vec3 sky = vec3(0.0);
    if (uHasEnvironmentMap > 0.5) {
      sky = texture(uEnvironmentMap, equirectUv(direction)).rgb;
    } else {
      float elevation = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
      sky = mix(uHorizonColor, uZenithColor, pow(elevation, 0.55));
      float sun = pow(max(dot(direction, normalize(uSunDirection)), 0.0), 640.0);
      sky += uSunColor * sun * 2.1;
    }
    return sky;
  }

  vec3 roughSurfaceReflection(vec3 skyRadiance, vec3 normal, vec3 viewDirection) {
    vec3 clampedSky = min(max(skyRadiance, vec3(0.0)), vec3(2.4));
    float luminance = dot(clampedSky, vec3(0.2126, 0.7152, 0.0722));
    float facing = clamp(dot(viewDirection, normal), 0.0, 1.0);
    float grazing = 1.0 - facing;
    float roughness = clamp(length(normal.xz) * 0.55 + 0.18, 0.0, 0.72);
    vec3 desaturatedSky = mix(vec3(luminance), clampedSky, mix(0.46, 0.68, 1.0 - roughness));
    float reflectionEnergy = mix(0.24, 0.62, smoothstep(0.35, 0.98, grazing));
    return desaturatedSky * reflectionEnergy;
  }

  void main() {
    vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
    float sceneDistance = filteredSceneDistance(screenUv);
    float thickness = max(sceneDistance - vViewDistance, 0.0);

    float shoreAlpha = smoothstep(0.04, max(0.16, uShoreFade), thickness);
    if (shoreAlpha <= 0.005) discard;

    vec4 simulation = texture(uSimulation, vSimulationUv);
    vec3 simulationNormal = normalize(vec3(
      simulation.b * uSimulationNormalStrength,
      1.0,
      simulation.a * uSimulationNormalStrength
    ));

    vec3 geometryNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (geometryNormal.y < 0.0) geometryNormal *= -1.0;

    float microX = sin(vWorldPosition.x * 0.083 + uTime * 1.7) * 0.035
      + sin((vWorldPosition.x + vWorldPosition.z) * 0.19 - uTime * 2.3) * 0.018;
    float microZ = cos(vWorldPosition.z * 0.071 - uTime * 1.3) * 0.035
      + cos((vWorldPosition.x - vWorldPosition.z) * 0.17 + uTime * 2.0) * 0.018;
    vec3 microNormal = normalize(vec3(microX, 1.0, microZ));
    vec3 normal = normalize(mix(geometryNormal, simulationNormal, 0.56));
    normal = normalize(mix(normal, microNormal, 0.31));

    float viewDepthFactor = 1.0 - exp(-thickness * 0.048);
    vec2 distortion = normal.xz * uRefractionStrength * mix(0.15, 1.0, viewDepthFactor);
    vec2 refractedUv = clamp(screenUv + distortion, vec2(0.002), vec2(0.998));

    float rawSceneDepth = texture(uSceneDepth, clamp(refractedUv, vec2(0.001), vec2(0.999))).r;
    vec3 terrainSceneColor = texture(uSceneColor, refractedUv).rgb;

    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 reflectedDirection = reflect(-viewDirection, normal);
    vec3 reflectedSky = proceduralSky(reflectedDirection);
    vec3 reflection = roughSurfaceReflection(reflectedSky, normal, viewDirection);
    float fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - max(dot(viewDirection, normal), 0.0), 5.0);
    fresnel = clamp(fresnel, 0.025, 0.82);

    float hasSceneDepth = rawSceneDepth >= 0.9999 ? 0.0 : 1.0;
    vec3 screenBottomWorld = rawSceneDepth >= 0.9999
      ? proceduralOceanBottomPosition()
      : sceneWorldPosition(refractedUv, rawSceneDepth);
    float screenWaterDepth = max(vWorldPosition.y - screenBottomWorld.y, 0.0);
    float bathymetryWaterDepth = sampleBathymetryDepth(vWorldPosition.xz);
    float verticalWaterDepth = bathymetryWaterDepth;
    float waterDepthFactor = 1.0 - exp(-verticalWaterDepth * 0.026);
    vec3 openOceanColor = uDeepColor;
    vec3 shelfWaterColor = mix(uShallowColor, openOceanColor, 0.56);
    vec3 waterVolumeColor = mix(uShallowColor, shelfWaterColor, smoothstep(0.0, 8.0, verticalWaterDepth));
    waterVolumeColor = mix(waterVolumeColor, openOceanColor, smoothstep(18.0, 32.0, verticalWaterDepth));
    float opticalDepth = verticalWaterDepth / max(abs(dot(viewDirection, normal)), 0.28);
    vec3 beerLambert = exp(-vec3(0.085, 0.040, 0.020) * opticalDepth);
    float depthAgreement = 1.0 - smoothstep(1.5, 12.0, abs(screenWaterDepth - bathymetryWaterDepth));
    float shallowBottomVisibility = hasSceneDepth * depthAgreement
      * (1.0 - smoothstep(2.0, 16.0, verticalWaterDepth));
    float bottomVisibility = shallowBottomVisibility * clamp(dot(beerLambert, vec3(0.20, 0.35, 0.45)), 0.0, 1.0);
    vec3 absorbedScene = terrainSceneColor * beerLambert;
    vec3 openWaterScatter = waterVolumeColor * mix(0.46, 0.78, waterDepthFactor);
    vec3 refraction = mix(openWaterScatter, absorbedScene, bottomVisibility);

    float shoreBand = smoothstep(0.03, 0.22, thickness) * (1.0 - smoothstep(0.68, 2.4, thickness));
    vec2 foamUv = vWorldPosition.xz * 0.034 + vec2(uTime * 0.12, -uTime * 0.09);
    float foamNoise = fbm21(foamUv) * 0.68 + fbm21(foamUv * 2.15 + 8.3) * 0.32;
    float simulationFoam = smoothstep(0.002, 0.022, abs(simulation.r));
    float foamMask = smoothstep(0.54, 0.77, foamNoise + simulationFoam * 0.14);
    float foam = shoreBand * foamMask * uFoamStrength;

    vec3 color = mix(refraction, reflection, fresnel);
    color = mix(color, openOceanColor, waterDepthFactor * (1.0 - fresnel) * 0.12);
    color = mix(color, vec3(0.82, 0.90, 0.93), clamp(foam * 0.46, 0.0, 0.32));
    float deepOpacity = smoothstep(0.08, 0.74, waterDepthFactor);
    float alpha = max(shoreAlpha * mix(0.72, uOpacity, waterDepthFactor), deepOpacity * 0.985);

    waterFragmentColor = vec4(color, clamp(alpha, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class AdvancedWaterSystem {
  constructor({ renderer, scene, camera, config, settings, generatorSettings = {}, sun }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.config = config;
    this.sun = sun;
    this.settings = { ...settings };
    this.generatorSettings = { ...generatorSettings };
    this.elapsed = 0;
    this.dropTimer = 0;
    this.randomState = 0x9e3779b9;
    this.bathymetry = createBathymetryData(this.config, this.generatorSettings);
    this.bathymetryTexture = createBathymetryTexture(this.bathymetry);

    this.simulation = new GpuWaterSimulation(renderer, {
      size: this.settings.simulationResolution,
      waveSpeed: 0.235,
      damping: 0.9945,
      normalScale: 23,
    });

    // Massive 126,000m ocean radius so water reaches far past camera horizon
    this.oceanRadius = Math.max(this.settings.oceanRadius ?? 17000, camera.far * 3.5);
    this.geometry = createRadialGeometry(this.oceanRadius, 128, 384);
    this.material = new THREE.ShaderMaterial({
      name: 'AdvancedCircularWaterMaterial',
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uSimulation: { value: this.simulation.texture },
        uSceneColor: { value: null },
        uSceneDepth: { value: null },
        uBathymetryMap: { value: this.bathymetryTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uDepthTexel: { value: new THREE.Vector2(1, 1) },
        uInverseProjectionMatrix: { value: camera.projectionMatrixInverse.clone() },
        uInverseViewMatrix: { value: camera.matrixWorld.clone() },
        uCameraNear: { value: camera.near },
        uCameraFar: { value: camera.far },
        uBathymetryWorldSize: { value: this.bathymetry.worldSize },
        uBathymetryMaxDepth: { value: this.bathymetry.maxDepth },
        uHasBathymetryMap: { value: 1 },
        uTime: { value: 0 },
        uWaterLevel: { value: config.waterLevel },
        uOceanRadius: { value: this.oceanRadius },
        uSimulationWorldSize: { value: this.settings.simulationWorldSize },
        uWaveAmplitude: { value: this.settings.waveAmplitude },
        uRippleAmplitude: { value: this.settings.rippleAmplitude },
        uHorizonCurvature: { value: this.settings.horizonCurvature },
        uSimulationNormalStrength: { value: this.settings.normalStrength },
        uRefractionStrength: { value: this.settings.refractionStrength },
        uShoreFade: { value: this.settings.shoreFade },
        uFoamStrength: { value: this.settings.foamStrength },
        uOpacity: { value: this.settings.opacity },
        uShallowColor: { value: new THREE.Color(this.settings.shallowColor) },
        uDeepColor: { value: new THREE.Color(this.settings.deepColor) },
        uHorizonColor: { value: new THREE.Color('#9cc7d7') },
        uZenithColor: { value: new THREE.Color('#356b8f') },
        uSunDirection: { value: new THREE.Vector3(0.48, 1, 0.31).normalize() },
        uSunColor: { value: new THREE.Color('#fff1cf') },
        uEnvironmentMap: { value: null },
        uHasEnvironmentMap: { value: 0 },
      },
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
    });
    this.material.extensions.derivatives = true;
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'CircularOceanAndLakeSurface';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.scene.add(this.mesh);
    this.#createCaptureTarget(1, 1);
  }

  #random() {
    let value = this.randomState += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  #createCaptureTarget(width, height) {
    this.captureTarget?.dispose();
    const supportsHalfFloatTarget = this.renderer.capabilities.isWebGL2
      && this.renderer.extensions.has('EXT_color_buffer_float');
    this.captureTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: supportsHalfFloatTarget ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.captureTarget.texture.name = 'WaterRefractionSceneColor';
    this.captureTarget.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    this.captureTarget.depthTexture.format = THREE.DepthFormat;
    this.captureTarget.depthTexture.minFilter = THREE.NearestFilter;
    this.captureTarget.depthTexture.magFilter = THREE.NearestFilter;
    this.material.uniforms.uSceneColor.value = this.captureTarget.texture;
    this.material.uniforms.uSceneDepth.value = this.captureTarget.depthTexture;
    this.material.uniforms.uDepthTexel.value.set(1 / Math.max(width, 1), 1 / Math.max(height, 1));
  }

  setEnvironmentMap(texture) {
    this.material.uniforms.uEnvironmentMap.value = texture;
    this.material.uniforms.uHasEnvironmentMap.value = texture ? 1 : 0;
  }

  updateBathymetry(generatorSettings = {}) {
    this.generatorSettings = { ...generatorSettings };
    const nextBathymetry = createBathymetryData(this.config, this.generatorSettings);
    const nextTexture = createBathymetryTexture(nextBathymetry);
    const previousTexture = this.bathymetryTexture;
    this.bathymetry = nextBathymetry;
    this.bathymetryTexture = nextTexture;
    this.material.uniforms.uBathymetryMap.value = nextTexture;
    this.material.uniforms.uBathymetryWorldSize.value = nextBathymetry.worldSize;
    this.material.uniforms.uBathymetryMaxDepth.value = nextBathymetry.maxDepth;
    this.material.uniforms.uHasBathymetryMap.value = 1;
    previousTexture?.dispose();
  }

  resize(width, height, pixelRatio = 1) {
    const scale = this.settings.refractionResolutionScale;
    const screenWidth = Math.max(2, Math.round(width * pixelRatio));
    const screenHeight = Math.max(2, Math.round(height * pixelRatio));
    const targetWidth = Math.max(2, Math.min(2560, Math.round(screenWidth * scale)));
    const targetHeight = Math.max(2, Math.min(1440, Math.round(screenHeight * scale)));
    this.material.uniforms.uResolution.value.set(screenWidth, screenHeight);
    if (this.captureTarget.width !== targetWidth || this.captureTarget.height !== targetHeight) {
      this.#createCaptureTarget(targetWidth, targetHeight);
    }
  }

  setPresentationMode() {
    // Water optics are identical in Editor and FPS. Only terrain streaming changes.
  }

  applySettings(settings) {
    Object.assign(this.settings, settings);
    const uniforms = this.material.uniforms;
    uniforms.uSimulationWorldSize.value = this.settings.simulationWorldSize;
    uniforms.uWaveAmplitude.value = this.settings.waveAmplitude;
    uniforms.uRippleAmplitude.value = this.settings.rippleAmplitude;
    uniforms.uHorizonCurvature.value = this.settings.horizonCurvature;
    uniforms.uSimulationNormalStrength.value = this.settings.normalStrength;
    uniforms.uRefractionStrength.value = this.settings.refractionStrength;
    uniforms.uShoreFade.value = this.settings.shoreFade;
    uniforms.uFoamStrength.value = this.settings.foamStrength;
    uniforms.uOpacity.value = this.settings.opacity;
    uniforms.uShallowColor.value.set(this.settings.shallowColor);
    uniforms.uDeepColor.value.set(this.settings.deepColor);
  }

  update(deltaSeconds, target) {
    this.elapsed += deltaSeconds;
    this.dropTimer -= deltaSeconds;
    if (this.settings.dynamicRipples) {
      this.simulation.update(deltaSeconds);
      if (this.dropTimer <= 0) {
        this.simulation.addDrop(this.#random(), this.#random(), 0.012 + this.#random() * 0.024, (this.#random() - 0.5) * 0.012);
        this.dropTimer = 0.75 + this.#random() * 1.4;
      }
    }
    const snap = 32;
    this.mesh.position.x = Math.round(target.x / snap) * snap;
    this.mesh.position.z = Math.round(target.z / snap) * snap;
    this.material.uniforms.uSimulation.value = this.simulation.texture;
    this.material.uniforms.uTime.value = this.elapsed;
    this.material.uniforms.uOceanRadius.value = this.oceanRadius;
    this.material.uniforms.uCameraNear.value = this.camera.near;
    this.material.uniforms.uCameraFar.value = this.camera.far;
    this.material.uniforms.uInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
    this.material.uniforms.uInverseViewMatrix.value.copy(this.camera.matrixWorld);
    if (this.sun) {
      const direction = this.sun.position.clone().sub(this.sun.target.position).normalize();
      this.material.uniforms.uSunDirection.value.copy(direction);
      this.material.uniforms.uSunColor.value.copy(this.sun.color);
    }
  }

  render(scene, camera) {
    const previousTarget = this.renderer.getRenderTarget();
    const previousAutoUpdate = this.renderer.shadowMap.autoUpdate;
    this.mesh.visible = false;
    this.renderer.setRenderTarget(this.captureTarget);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(previousTarget);
    this.mesh.visible = true;

    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.render(scene, camera);
    this.renderer.shadowMap.autoUpdate = previousAutoUpdate;
  }

  getDiagnostics() {
    return {
      simulationResolution: this.simulation.size,
      refractionWidth: this.captureTarget.width,
      refractionHeight: this.captureTarget.height,
      oceanRadius: this.oceanRadius,
      bathymetryResolution: this.bathymetry.resolution,
    };
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.simulation.dispose();
    this.captureTarget.dispose();
    this.bathymetryTexture.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
