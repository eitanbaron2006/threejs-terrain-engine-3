import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import {
  BIRD_COUNT,
  FILL_LIGHT_INTENSITY,
  HDRI_BACKGROUND_INTENSITY,
  HDRI_LOCAL_PATH,
  HDRI_REMOTE_FALLBACK,
  HEMI_LIGHT_INTENSITY_AFTER_HDRI,
  HEMI_LIGHT_INTENSITY_BEFORE_HDRI,
  SHADOW_CAMERA_FAR,
  SHADOW_CAMERA_NEAR,
  SUN_COLOR,
  SUN_INTENSITY,
  SUN_OFFSET,
  SUN_SHADOW_BIAS,
  SUN_SHADOW_MAP_SIZE,
  SUN_SHADOW_NORMAL_BIAS,
  SUN_SHADOW_RADIUS,
  WORLD_ENV_MAP_INTENSITY,
} from './config.js';
import { ENVIRONMENT_PRESETS, getEnvironmentPreset } from './EnvironmentPresets.js';

function createFallbackSky() {
  const geometry = new THREE.SphereGeometry(12000, 48, 24);
  const material = new THREE.ShaderMaterial({
    name: 'BalancedProceduralSkyFallback',
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
    uniforms: {
      uZenith: { value: new THREE.Color('#4f7ea0') },
      uHorizon: { value: new THREE.Color('#c6d4dc') },
      uGround: { value: new THREE.Color('#8f9ba0') },
      uSunDirection: { value: new THREE.Vector3(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDirection = normalize(world.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDirection;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSunDirection;
      void main() {
        float elevation = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 sky = mix(uHorizon, uZenith, smoothstep(0.48, 1.0, elevation));
        sky = mix(uGround, sky, smoothstep(0.42, 0.53, elevation));
        float sunGlow = pow(max(dot(normalize(vDirection), normalize(uSunDirection)), 0.0), 700.0);
        sky += vec3(1.0, 0.78, 0.5) * sunGlow * 0.65;
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'AtmosphericSkyFallback';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.userData.excludeFromWaterDepth = true;
  return mesh;
}

function createBird(scale = 1) {
  const group = new THREE.Group();
  group.name = 'AtmosphericBird';
  const material = new THREE.MeshBasicMaterial({
    color: 0x1d241c,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: true,
  });
  const wingGeometry = new THREE.BufferGeometry();
  wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    -0.45 * scale, 0.15 * scale, 0,
    -0.9 * scale, 0, 0,
  ], 3));
  const leftPivot = new THREE.Group();
  const rightPivot = new THREE.Group();
  const left = new THREE.Mesh(wingGeometry, material);
  const right = new THREE.Mesh(wingGeometry.clone(), material);
  right.scale.x = -1;
  leftPivot.add(left);
  rightPivot.add(right);
  group.add(leftPivot, rightPivot);
  group.userData.leftWing = leftPivot;
  group.userData.rightWing = rightPivot;
  return group;
}

export class WorldEnvironment {
  constructor({ scene, renderer, getFollowPosition = () => null, settings = {} }) {
    this.scene = scene;
    this.renderer = renderer;
    this.getFollowPosition = getFollowPosition;
    this.materialLibrary = null;
    this.environmentConsumers = new Set();
    this.hdriTexture = null;
    this.environmentTexture = null;
    this.disposed = false;
    this.settings = { ...getEnvironmentPreset(settings.presetId ?? 'summer'), ...settings };
    this.currentSource = null;

    this.hemiLight = new THREE.HemisphereLight(0xe9efff, 0x4c4a3f, this.settings.hemiIntensity ?? HEMI_LIGHT_INTENSITY_BEFORE_HDRI);
    this.scene.add(this.hemiLight);

    this.sunOffset = new THREE.Vector3(SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z);
    this.sun = new THREE.DirectionalLight(this.settings.sunColor ?? SUN_COLOR, this.settings.sunIntensity ?? SUN_INTENSITY);
    this.sun.name = 'TexelSnappedDirectionalSun';
    this.sun.castShadow = true;
    const initialShadowRadius = Number(this.settings.shadowRadius ?? SUN_SHADOW_RADIUS);
    this.sun.shadow.camera.left = -initialShadowRadius;
    this.sun.shadow.camera.right = initialShadowRadius;
    this.sun.shadow.camera.top = initialShadowRadius;
    this.sun.shadow.camera.bottom = -initialShadowRadius;
    this.sun.shadow.camera.near = SHADOW_CAMERA_NEAR;
    this.sun.shadow.camera.far = SHADOW_CAMERA_FAR;
    this.sun.shadow.bias = Number(this.settings.shadowBias ?? SUN_SHADOW_BIAS);
    this.sun.shadow.normalBias = Number(this.settings.shadowNormalBias ?? SUN_SHADOW_NORMAL_BIAS);
    const maxTextureSize = Number(this.renderer.capabilities.maxTextureSize ?? this.renderer.capabilities.getMaxTextureSize?.() ?? 4096);
    this.maxShadowMapSize = maxTextureSize;
    this.shadowMapSize = Math.min(Number(this.settings.shadowMapSize ?? SUN_SHADOW_MAP_SIZE), maxTextureSize);
    this.sun.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);

    this.fillLight = new THREE.DirectionalLight(0xbfd7ff, this.settings.fillIntensity ?? FILL_LIGHT_INTENSITY);
    this.fillLight.name = 'EnvironmentFillLight';
    this.fillLight.position.set(-18, 14, -10);
    this.fillLight.castShadow = false;
    this.scene.add(this.fillLight);

    this.#updateSunDirectionFromSettings();
    this.sunLightDir = this.sunOffset.clone().normalize();
    this.sunLightRight = new THREE.Vector3(0, 1, 0).cross(this.sunLightDir).normalize();
    this.sunLightUp = this.sunLightDir.clone().cross(this.sunLightRight).normalize();
    this.followTmp = new THREE.Vector3();
    this.lastFollow = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);

    this.fallbackSky = createFallbackSky();
    this.scene.add(this.fallbackSky);

    this.birds = [];
    this.birdAnchor = new THREE.Vector3();
    for (let index = 0; index < BIRD_COUNT; index += 1) {
      const bird = createBird(0.55 + Math.random() * 0.45);
      bird.userData.offset = new THREE.Vector3(
        -85 + Math.random() * 170,
        26 + Math.random() * 22,
        -70 + Math.random() * 135,
      );
      bird.userData.speed = 4.2 + index * 0.16 + Math.random() * 1.2;
      bird.userData.phase = Math.random() * Math.PI * 2;
      bird.userData.range = 190;
      this.birds.push(bird);
      this.scene.add(bird);
    }

    this.applySettings(this.settings, { reloadEnvironment: false });
    this.updateSunShadowFollow(true);
    this.loadPreset(this.settings.presetId ?? 'summer');
  }

  #updateSunDirectionFromSettings() {
    const azimuth = THREE.MathUtils.degToRad(Number(this.settings.sunAzimuth ?? 38));
    const elevation = THREE.MathUtils.degToRad(Number(this.settings.sunElevation ?? 48));
    const distance = Number(this.settings.sunDistance ?? 48);
    const horizontal = Math.cos(elevation) * distance;
    this.sunOffset.set(
      Math.sin(azimuth) * horizontal,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * horizontal,
    );
  }

  getSettings() {
    return { ...this.settings, shadowMapSize: this.shadowMapSize };
  }

  getPresets() {
    return Object.values(ENVIRONMENT_PRESETS);
  }

  async loadPreset(id) {
    const preset = getEnvironmentPreset(id);
    this.settings = { ...this.settings, ...preset, presetId: preset.id };
    this.applySettings(this.settings, { reloadEnvironment: false });
    if (!preset.hdri && !preset.remote) {
      this.hdriTexture?.dispose?.();
      this.environmentTexture?.dispose?.();
      this.hdriTexture = null;
      this.environmentTexture = null;
      this.scene.background = null;
      this.scene.environment = null;
      this.fallbackSky.visible = true;
      this.currentSource = 'procedural';
      for (const consumer of this.environmentConsumers) consumer.setEnvironmentMap?.(null);
      this.#syncCustomTerrainLighting();
      return true;
    }
    return this.loadEnvironmentHDRI(preset.hdri ?? null, preset.remote ?? null);
  }

  async loadCustomUrl(url) {
    if (!url) throw new Error('יש להזין כתובת HDR תקינה.');
    this.settings.presetId = 'custom-url';
    return this.loadEnvironmentHDRI(url, null, { throwOnFailure: true, preserveCurrent: true });
  }

  async loadCustomFile(file) {
    if (!file) throw new Error('לא נבחר קובץ HDR או EXR.');
    const url = URL.createObjectURL(file);
    try {
      this.settings.presetId = 'custom-file';
      const result = await this.loadEnvironmentHDRI(url, null, {
        throwOnFailure: true,
        preserveCurrent: true,
        formatHint: file.name,
      });
      this.currentSource = file.name;
      return result;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  applySettings(next = {}, { reloadEnvironment = false } = {}) {
    Object.assign(this.settings, next);
    this.#updateSunDirectionFromSettings();
    this.sunLightDir.copy(this.sunOffset).normalize();
    this.sunLightRight.set(0, 1, 0).cross(this.sunLightDir).normalize();
    if (this.sunLightRight.lengthSq() < 0.0001) this.sunLightRight.set(1, 0, 0);
    this.sunLightUp.copy(this.sunLightDir).cross(this.sunLightRight).normalize();
    this.sun.color.set(this.settings.sunColor ?? SUN_COLOR);
    this.sun.intensity = Number(this.settings.sunIntensity ?? SUN_INTENSITY);
    this.hemiLight.intensity = Number(this.settings.hemiIntensity ?? (this.hdriTexture ? HEMI_LIGHT_INTENSITY_AFTER_HDRI : HEMI_LIGHT_INTENSITY_BEFORE_HDRI));
    this.fillLight.intensity = Number(this.settings.fillIntensity ?? FILL_LIGHT_INTENSITY);
    this.renderer.toneMappingExposure = Number(this.settings.exposure ?? 1);

    const radius = Number(this.settings.shadowRadius ?? SUN_SHADOW_RADIUS);
    this.sun.shadow.camera.left = -radius;
    this.sun.shadow.camera.right = radius;
    this.sun.shadow.camera.top = radius;
    this.sun.shadow.camera.bottom = -radius;
    this.sun.shadow.camera.near = Number(this.settings.shadowNear ?? SHADOW_CAMERA_NEAR);
    this.sun.shadow.camera.far = Number(this.settings.shadowFar ?? SHADOW_CAMERA_FAR);
    this.sun.shadow.bias = Number(this.settings.shadowBias ?? SUN_SHADOW_BIAS);
    this.sun.shadow.normalBias = Number(this.settings.shadowNormalBias ?? SUN_SHADOW_NORMAL_BIAS);
    const requestedMapSize = Number(this.settings.shadowMapSize ?? SUN_SHADOW_MAP_SIZE);
    const nextMapSize = Math.min(requestedMapSize, this.maxShadowMapSize);
    if (nextMapSize !== this.shadowMapSize) {
      this.shadowMapSize = nextMapSize;
      this.sun.shadow.mapSize.set(nextMapSize, nextMapSize);
      this.sun.shadow.map?.dispose?.();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.camera.updateProjectionMatrix();
    this.fallbackSky.material.uniforms.uSunDirection.value.copy(this.sunLightDir);
    const birdsEnabled = this.settings.birdsEnabled ?? true;
    for (const bird of this.birds) bird.visible = birdsEnabled;
    this.#applyPbrEnvironmentIntensity();
    this.#syncCustomTerrainLighting();
    this.updateSunShadowFollow(true);
    if (reloadEnvironment && this.settings.presetId && ENVIRONMENT_PRESETS[this.settings.presetId]) return this.loadPreset(this.settings.presetId);
    return Promise.resolve(true);
  }

  registerEnvironmentConsumer(consumer) {
    if (!consumer) return;
    this.environmentConsumers.add(consumer);
    if (this.hdriTexture && consumer.setEnvironmentMap) consumer.setEnvironmentMap(this.hdriTexture);
  }

  registerTerrainMaterialLibrary(materialLibrary) {
    this.materialLibrary = materialLibrary;
    this.#syncCustomTerrainLighting();
  }

  #syncCustomTerrainLighting() {
    if (!this.materialLibrary?.setEnvironmentLighting) return;
    this.materialLibrary.setEnvironmentLighting({
      sunDirection: this.sunLightDir,
      sunColor: this.sun.color.clone().multiplyScalar(Math.max(0.2, this.sun.intensity * 0.4)),
      skyColor: new THREE.Color('#b8c9d4').multiplyScalar(this.hdriTexture ? Math.max(0.18, this.settings.environmentIntensity ?? 0.3) : 0.62),
      groundColor: new THREE.Color('#544b40').multiplyScalar(this.hdriTexture ? 0.22 : 0.38),
      fogColor: new THREE.Color(this.settings.fogColor ?? '#aebcc4'),
      fogDensity: this.settings.fogEnabled ? Number(this.settings.fogDensity ?? 0.0004) : 0,
    });
  }

  #applyPbrEnvironmentIntensity() {
    const envIntensity = Number(this.settings.environmentIntensity ?? WORLD_ENV_MAP_INTENSITY);
    if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = envIntensity;
    if ('backgroundIntensity' in this.scene) this.scene.backgroundIntensity = Number(this.settings.backgroundIntensity ?? HDRI_BACKGROUND_INTENSITY);
    if ('backgroundBlurriness' in this.scene) this.scene.backgroundBlurriness = Number(this.settings.backgroundBlurriness ?? 0.02);
    this.scene.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material?.isMeshStandardMaterial || material?.isMeshPhysicalMaterial) {
          material.envMapIntensity = envIntensity;
          material.needsUpdate = true;
        }
      }
    });
  }

  #environmentLoaderFor(formatHint = '') {
    return /(?:^|[.\/])exr(?:$|[?#])/i.test(String(formatHint)) || String(formatHint).toLowerCase() === 'exr'
      ? new EXRLoader()
      : new HDRLoader();
  }

  async #loadEnvironmentTexture(path, formatHint = '') {
    const isAmbientProxy = /^\/?api\/ambientcg\/hdri\//i.test(String(path))
      || /\/api\/ambientcg\/hdri\//i.test(String(path));
    if (!isAmbientProxy) {
      return this.#environmentLoaderFor(formatHint || path).loadAsync(path);
    }

    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) {
      let details = '';
      try { details = (await response.json()).error ?? ''; } catch { details = await response.text(); }
      throw new Error(details || `HDRI proxy HTTP ${response.status}`);
    }
    const serverFormat = response.headers.get('x-terrain-environment-format')
      || (response.headers.get('content-type')?.includes('exr') ? 'exr' : 'hdr');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await this.#environmentLoaderFor(serverFormat).loadAsync(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async loadEnvironmentHDRI(localPath = HDRI_LOCAL_PATH, remotePath = HDRI_REMOTE_FALLBACK, { throwOnFailure = false, preserveCurrent = false, formatHint = '' } = {}) {
    const candidates = [localPath, remotePath].filter(Boolean);
    let lastError = null;
    for (const path of candidates) {
      try {
        const hdrTexture = await this.#loadEnvironmentTexture(path, formatHint);
        if (this.disposed) {
          hdrTexture.dispose();
          return false;
        }
        hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
        hdrTexture.name = `TerrainEnvironment:${path}`;
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        pmrem.compileEquirectangularShader();
        const environmentTexture = pmrem.fromEquirectangular(hdrTexture).texture;
        environmentTexture.name = `TerrainPMREM:${path}`;
        pmrem.dispose();

        this.hdriTexture?.dispose();
        this.environmentTexture?.dispose();
        this.hdriTexture = hdrTexture;
        this.environmentTexture = environmentTexture;
        this.scene.background = hdrTexture;
        this.scene.environment = environmentTexture;
        for (const consumer of this.environmentConsumers) consumer.setEnvironmentMap?.(hdrTexture);
        this.hemiLight.intensity = Number(this.settings.hemiIntensity ?? HEMI_LIGHT_INTENSITY_AFTER_HDRI);
        this.currentSource = path;
        this.fallbackSky.visible = false;
        this.#applyPbrEnvironmentIntensity();
        this.#syncCustomTerrainLighting();
        console.info('[Terrain Environment] HDRI + PMREM active', { source: path, shadowMapSize: this.shadowMapSize });
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    if (!preserveCurrent || !this.hdriTexture) {
      this.scene.background = null;
      this.scene.environment = null;
      for (const consumer of this.environmentConsumers) consumer.setEnvironmentMap?.(null);
      this.fallbackSky.visible = true;
      this.hemiLight.intensity = Number(this.settings.hemiIntensity ?? HEMI_LIGHT_INTENSITY_BEFORE_HDRI);
      this.currentSource = 'procedural';
      this.#syncCustomTerrainLighting();
    }
    console.warn('[Terrain Environment] HDRI failed.', lastError);
    if (throwOnFailure) throw new Error(`טעינת HDRI/EXR נכשלה: ${lastError?.message ?? 'קובץ לא תקין או לא נגיש'}`);
    return false;
  }

  updateSunShadowFollow(force = false) {
    const follow = this.getFollowPosition?.();
    if (!follow) return;
    const p = follow.position ?? follow;
    if (!p?.isVector3 && !Number.isFinite(p?.x)) return;

    const shadowRadius = Number(this.settings.shadowRadius ?? SUN_SHADOW_RADIUS);
    const texel = (shadowRadius * 2) / Math.max(this.shadowMapSize, 1);
    const snappedRight = Math.round(p.dot(this.sunLightRight) / texel) * texel;
    const snappedUp = Math.round(p.dot(this.sunLightUp) / texel) * texel;
    const alongDir = p.dot(this.sunLightDir);
    this.followTmp.copy(this.sunLightRight).multiplyScalar(snappedRight)
      .addScaledVector(this.sunLightUp, snappedUp)
      .addScaledVector(this.sunLightDir, alongDir);

    if (!force && this.lastFollow.distanceToSquared(this.followTmp) < texel * texel * 0.1) return;
    this.lastFollow.copy(this.followTmp);
    this.sun.target.position.copy(this.followTmp);
    this.sun.position.copy(this.followTmp).add(this.sunOffset);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  updateSkyDetails(timeSeconds) {
    const follow = this.getFollowPosition?.();
    const p = follow?.position ?? follow;
    if (p && Number.isFinite(p.x)) this.birdAnchor.copy(p);
    this.fallbackSky.position.copy(this.birdAnchor);

    for (let index = 0; index < this.birds.length; index += 1) {
      const bird = this.birds[index];
      const offset = bird.userData.offset;
      offset.x += bird.userData.speed * (1 / 60);
      if (offset.x > bird.userData.range * 0.5) offset.x = -bird.userData.range * 0.5;
      bird.position.set(
        this.birdAnchor.x + offset.x,
        this.birdAnchor.y + offset.y + Math.sin(timeSeconds * 1.3 + bird.userData.phase) * 0.6,
        this.birdAnchor.z + offset.z,
      );
      bird.rotation.y = -0.08 + Math.sin(timeSeconds * 0.25 + index) * 0.06;
      const flap = Math.sin(timeSeconds * 5.2 + bird.userData.phase) * 0.32;
      bird.userData.leftWing.rotation.z = flap;
      bird.userData.rightWing.rotation.z = -flap;
    }
  }

  update(timeSeconds) {
    this.updateSunShadowFollow();
    this.updateSkyDetails(timeSeconds);
  }

  getDiagnostics() {
    return {
      hdriLoaded: Boolean(this.hdriTexture),
      shadowMapSize: this.shadowMapSize,
      shadowTexelMetres: (Number(this.settings.shadowRadius ?? SUN_SHADOW_RADIUS) * 2) / Math.max(this.shadowMapSize, 1),
      birds: this.birds.filter((bird) => bird.visible).length,
      envIntensity: Number(this.settings.environmentIntensity ?? WORLD_ENV_MAP_INTENSITY),
      presetId: this.settings.presetId,
      source: this.currentSource,
      sunAzimuth: this.settings.sunAzimuth,
      sunElevation: this.settings.sunElevation,
    };
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.hemiLight, this.sun, this.sun.target, this.fillLight, this.fallbackSky, ...this.birds);
    this.hdriTexture?.dispose();
    this.environmentTexture?.dispose();
    this.fallbackSky.geometry.dispose();
    this.fallbackSky.material.dispose();
    for (const bird of this.birds) {
      bird.traverse((object) => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    }
    this.sun.shadow.map?.dispose?.();
  }
}
