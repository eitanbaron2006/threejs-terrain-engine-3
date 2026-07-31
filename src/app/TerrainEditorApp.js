import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EventBus } from '../core/EventBus.js';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_FPS_SETTINGS,
  DEFAULT_GENERATOR_SETTINGS,
  DEFAULT_MATERIAL_SETTINGS,
  DEFAULT_STREAMING_SETTINGS,
  DEFAULT_TERRAIN_CONFIG,
  DEFAULT_WATER_SETTINGS,
  QUALITY_TIERS,
  cloneMaterialSettings,
} from '../terrain/TerrainConfig.js';
import { TerrainMaterialLibrary } from '../terrain/TerrainMaterial.js';
import { TerrainGenerationService } from '../terrain/TerrainGenerationService.js';
import { TerrainWorld } from '../terrain/TerrainWorld.js';
import { TerrainHistory } from '../terrain/TerrainHistory.js';
import { TerrainBrushController } from '../terrain/TerrainBrushController.js';
import { TerrainSerializer } from '../terrain/TerrainSerializer.js';
import {
  buildTerrainExportMesh,
  createTerrainExportFilename,
  disposeTerrainExportMesh,
  downloadTerrainExport,
  serializeTerrainMesh,
} from '../terrain/TerrainModelExporter.js';
import { FpsPlayerController } from '../player/FpsPlayerController.js';
import { FpsProjectileSystem } from '../player/FpsProjectileSystem.js';
import { AdvancedWaterSystem } from '../water/AdvancedWaterSystem.js';
import { WorldEnvironment } from '../environment/WorldEnvironment.js';
import { getEnvironmentPreset } from '../environment/EnvironmentPresets.js';
import { TerrainMaterialPackManager } from '../terrain/TerrainMaterialPackManager.js';
import {
  createDefaultTerrainGraph,
  deriveSettingsFromTerrainGraph,
  normalizeTerrainGraph,
  syncSettingsToTerrainGraph,
  validateTerrainGraph,
} from '../terrain/TerrainGraphModel.js';
import { compileTerrainGraph, compileTerrainPipeline } from '../terrain/TerrainGraphCompiler.js';
import { TerrainGraphPreview } from '../terrain/TerrainGraphPreview.js';
import { EditorUI } from '../ui/EditorUI.js';
import { TerrainGraphEditor } from '../ui/TerrainGraphEditor.js';

export class TerrainEditorApp {
  constructor(root) {
    this.root = root;
    this.config = {
      ...DEFAULT_TERRAIN_CONFIG,
      lodLevels: DEFAULT_TERRAIN_CONFIG.lodLevels.map((level) => ({ ...level })),
    };
    this.generatorSettings = { ...DEFAULT_GENERATOR_SETTINGS };
    this.terrainGraph = createDefaultTerrainGraph({
      ...this.generatorSettings,
      worldRadius: this.config.worldSizeKm * 500,
      waterLevel: this.config.waterLevel,
    });
    this.generatorSettings.terrainProgram = compileTerrainGraph(this.terrainGraph);
    this.brushSettings = { ...DEFAULT_BRUSH_SETTINGS };
    this.materialSettings = cloneMaterialSettings(DEFAULT_MATERIAL_SETTINGS);
    this.streamingSettings = { ...DEFAULT_STREAMING_SETTINGS };
    this.waterSettings = { ...DEFAULT_WATER_SETTINGS };
    this.environmentSettings = { ...getEnvironmentPreset('summer'), presetId: 'summer', shadowRadius: 40, shadowMapSize: 8192, shadowBias: -0.00003, shadowNormalBias: 0.018, birdsEnabled: true };
    this.activeMaterialPackId = 'mediterranean';
    this.eventBus = new EventBus();
    this.history = new TerrainHistory(12);
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.elapsed = 0;
    this.spawnPoint = new THREE.Vector3();
    this.fpsActive = false;
    this.selectingSpawn = false;
    this.frameSamples = [];
    this.lastStatusAt = 0;
    this.fpsFrames = 0;
    this.fpsWindowStart = performance.now();
    this.currentFps = 0;
  }

  async start() {
    this.ui = new EditorUI(this.root, {
      config: this.config,
      generatorSettings: this.generatorSettings,
      brushSettings: this.brushSettings,
      materialSettings: this.materialSettings,
      streamingSettings: this.streamingSettings,
      waterSettings: this.waterSettings,
      environmentSettings: this.environmentSettings,
      presetId: 'mediterranean',
    });
    this.#createRenderer();
    this.#createScene();
    this.#createTerrain();
    const packs = await this.materialPackManager.initialize();
    this.ui.setMaterialPacks(packs, this.activeMaterialPackId);
    this.#createTerrainGraphTools();
    await this.#loadAmbientHdriCatalog().catch(() => null);
    this.#createSpawnMarker();
    this.#createPlayer();
    this.#bindUI();
    this.#bindEvents();
    this.#bindKeyboard();
    this.#observeResize();
    this.renderer.setAnimationLoop(() => this.#animate());

    this.ui.setBusy(true, 'טוען ומסיים את עולם העריכה...');
    try {
      await this.world.generate(this.generatorSettings);
      await this.world.waitForEditorReady(60000);
      await this.#applyMaterialPack(this.activeMaterialPackId, false);
      this.world.group.visible = true;
      this.#setSpawnToHighest(false);
      this.#resetCamera();
      this.ui.toast('Terrain Engine 3.11.6 מוכן — recovery ממוקד על בסיס 3.11.1.');
    } finally {
      this.world.group.visible = true;
      this.ui.setBusy(false);
    }
  }

  #createRenderer() {
    const tier = QUALITY_TIERS[this.materialSettings.qualityTier];
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    if (!this.renderer.capabilities.isWebGL2) throw new Error('Terrain Engine 3.11.6 דורש WebGL2.');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.ui.viewport.appendChild(this.renderer.domElement);
  }

  #createTerrainGraphTools() {
    this.terrainGraphPreview = new TerrainGraphPreview({
      canvas: this.ui.terrainGraphPreviewCanvas,
      statusElement: this.ui.terrainGraphStatus,
      legendElement: this.ui.terrainGraphPreviewLegend,
    });
    this.terrainGraphEditor = new TerrainGraphEditor({
      root: this.ui.terrainGraphRoot,
      graph: this.terrainGraph,
      onGraphChange: (graph) => {
        this.terrainGraph = graph;
        const derived = deriveSettingsFromTerrainGraph(graph, this.generatorSettings);
        Object.assign(this.generatorSettings, derived);
        this.ui.syncGeneratorSettings(derived);
        this.terrainGraphPreview.request(graph, {
          ...this.generatorSettings,
          worldRadius: this.config.worldSizeKm * 500,
          waterLevel: this.config.waterLevel,
        }, this.#terrainPreviewRequestOptions());
      },
      onBuild: () => this.#buildTerrainFromGraph(),
      onPreviewToggle: (enabled) => {
        this.terrainGraphPreview.setAuto(enabled);
        if (enabled) {
          this.terrainGraphPreview.request(
            this.terrainGraph,
            this.generatorSettings,
            this.#terrainPreviewRequestOptions({ immediate: true }),
          );
        }
      },
      onStatus: (message, state) => this.ui.setTerrainGraphStatus(message, state),
      onEditMaterialPack: (packId) => {
        const pack = this.materialPackManager.getPack(packId);
        if (pack) this.ui.openMaterialPackStudio(pack);
      },
    });
    this.terrainGraphEditor.setMaterialPackCatalog(this.materialPackManager.getCatalog());
    this.terrainGraphPreview.request(this.terrainGraph, {
      ...this.generatorSettings,
      worldRadius: this.config.worldSizeKm * 500,
      waterLevel: this.config.waterLevel,
    }, this.#terrainPreviewRequestOptions({ immediate: true }));
  }

  #terrainPreviewRequestOptions(overrides = {}) {
    return {
      packCatalog: this.materialPackManager?.getCatalog?.() ?? [],
      materialLayers: this.materialPackManager?.getActiveMaterialLayers?.() ?? [],
      ...overrides,
    };
  }

  #createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#9fb2bd');

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.35, 36000);
    this.camera.position.set(0, 5200, 5400);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 12000;
    this.controls.maxPolarAngle = Math.PI * 0.493;
    this.controls.screenSpacePanning = false;
    this.controls.target.set(0, 0, 0);

    this.environmentSystem = new WorldEnvironment({
      scene: this.scene,
      renderer: this.renderer,
      getFollowPosition: () => (this.fpsActive && this.fpsController
        ? this.fpsController.position
        : this.controls.target),
      settings: this.environmentSettings,
    });
    this.sun = this.environmentSystem.sun;

    this.waterSystem = new AdvancedWaterSystem({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      config: this.config,
      settings: this.waterSettings,
      generatorSettings: this.generatorSettings,
      sun: this.sun,
    });
    this.environmentSystem.registerEnvironmentConsumer(this.waterSystem);
  }

  #createTerrain() {
    this.materialLibrary = new TerrainMaterialLibrary(this.renderer, this.config, this.materialSettings);
    this.generationService = new TerrainGenerationService();
    this.world = new TerrainWorld({
      config: this.config,
      materialLibrary: this.materialLibrary,
      generationService: this.generationService,
      eventBus: this.eventBus,
      generatorSettings: this.generatorSettings,
      streamingSettings: this.streamingSettings,
    });
    this.scene.add(this.world.group);
    this.world.group.visible = false;
    this.environmentSystem?.registerTerrainMaterialLibrary(this.materialLibrary);
    this.materialLibrary.setPresentationMode('editor');
    this.waterSystem?.setPresentationMode('editor');
    this.materialPackManager = new TerrainMaterialPackManager({ materialLibrary: this.materialLibrary, world: this.world });

    this.brushController = new TerrainBrushController({
      canvas: this.renderer.domElement,
      camera: this.camera,
      controls: this.controls,
      scene: this.scene,
      world: this.world,
      history: this.history,
      eventBus: this.eventBus,
      settings: this.brushSettings,
    });
  }

  #createSpawnMarker() {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.14, 10, 64),
      new THREE.MeshBasicMaterial({ color: '#63efa0', depthTest: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 1200;
    group.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 5, 10),
      new THREE.MeshBasicMaterial({ color: '#d9ffe7', transparent: true, opacity: 0.68, depthTest: false }),
    );
    beam.position.y = 2.55;
    beam.renderOrder = 1200;
    group.add(beam);
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.48, 1.0, 16),
      new THREE.MeshBasicMaterial({ color: '#63efa0', depthTest: false }),
    );
    arrow.position.y = 5.2;
    arrow.rotation.z = Math.PI;
    arrow.renderOrder = 1200;
    group.add(arrow);
    this.spawnMarker = group;
    this.scene.add(group);
  }

  #createPlayer() {
    this.projectileSystem = new FpsProjectileSystem({
      scene: this.scene,
      camera: this.camera,
      world: this.world,
      waterSystem: this.waterSystem,
      settings: this.waterSettings,
    });
    this.fpsController = new FpsPlayerController({
      canvas: this.renderer.domElement,
      camera: this.camera,
      world: this.world,
      waterSystem: this.waterSystem,
      projectileSystem: this.projectileSystem,
      eventBus: this.eventBus,
      settings: DEFAULT_FPS_SETTINGS,
    });
  }

  #bindUI() {
    this.ui.on('generate', () => this.#buildTerrainFromGraph());
    this.ui.on('terrain-preview-mode', (mode) => this.terrainGraphPreview.setMode(mode));
    this.ui.on('generator-settings', (settings) => {
      this.terrainGraph = syncSettingsToTerrainGraph(this.terrainGraph, {
        ...settings,
        worldRadius: this.config.worldSizeKm * 500,
        waterLevel: this.config.waterLevel,
      });
      this.terrainGraphEditor.setGraph(this.terrainGraph, { recordHistory: true });
      this.terrainGraphPreview.request(this.terrainGraph, {
        ...settings,
        worldRadius: this.config.worldSizeKm * 500,
        waterLevel: this.config.waterLevel,
      }, this.#terrainPreviewRequestOptions());
    });

    this.ui.on('apply-material-pack', () => this.#applyMaterialPack(this.ui.getSelectedMaterialPack(), true));
    this.ui.on('edit-material-pack', () => {
      const pack = this.materialPackManager.getPack(this.ui.getSelectedMaterialPack());
      this.ui.openMaterialPackStudio(pack);
    });
    this.ui.on('material-studio-search', async ({ provider, query }) => {
      this.ui.setMaterialStudioStatus('מחפש חומרים...', 'loading');
      try {
        const response = await fetch(`/api/materials/search?provider=${encodeURIComponent(provider)}&q=${encodeURIComponent(query)}&limit=40`, { cache: 'no-store' });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? `Material search ${response.status}`);
        }
        const payload = await response.json();
        this.ui.setMaterialStudioSearchResults(payload.items ?? []);
        this.ui.setMaterialStudioStatus(`${payload.count ?? 0} חומרים נמצאו.`, 'success');
      } catch (error) {
        this.ui.setMaterialStudioSearchResults([]);
        this.ui.setMaterialStudioStatus(error.message, 'error');
      }
    });
    this.ui.on('material-studio-save', async (draft) => {
      try {
        const manifest = await this.materialPackManager.saveCustomPack(draft);
        this.ui.setMaterialPacks(this.materialPackManager.getCatalog(), manifest.id);
        this.terrainGraphEditor.setMaterialPackCatalog(this.materialPackManager.getCatalog());
        this.ui.setMaterialStudioStatus(`${manifest.name} נשמרה. טרם הוחלה על העולם.`, 'success');
        this.ui.setMaterialPackStatus(`${manifest.name} נשמרה ונבחרה — לחץ “הורד והחל” כדי להחיל.`, 'idle');
      } catch (error) {
        this.ui.setMaterialStudioStatus(error.message, 'error');
      }
    });
    this.ui.on('material-studio-save-apply', async (draft) => {
      try {
        const manifest = await this.materialPackManager.saveCustomPack(draft);
        this.ui.setMaterialPacks(this.materialPackManager.getCatalog(), manifest.id);
        this.terrainGraphEditor.setMaterialPackCatalog(this.materialPackManager.getCatalog());
        await this.#applyMaterialPack(manifest.id, true);
        this.ui.setMaterialStudioStatus(`${manifest.name} נשמרה והוחלה.`, 'success');
      } catch (error) {
        this.ui.setMaterialStudioStatus(error.message, 'error');
      }
    });
    this.ui.on('material-pack-selection', () => {});
    this.ui.on('choose-material-pack', () => this.ui.chooseMaterialPackFile());
    this.ui.on('material-pack-file-selected', async (file) => {
      this.ui.setBusy(true, 'מייבא חבילת Terrain Materials ומייצר Texture Arrays...');
      this.ui.setMaterialPackStatus('קורא את קובץ ה־ZIP...', 'loading');
      try {
        const manifest = await this.materialPackManager.importZip(file, ({ completed, total, label }) => {
          this.ui.setMaterialPackStatus(`${label} · ${completed}/${total}`, 'loading');
        });
        this.activeMaterialPackId = manifest.id;
        this.ui.setMaterialPacks(this.materialPackManager.getCatalog(), manifest.id);
        this.terrainGraphEditor.setMaterialPackCatalog(this.materialPackManager.getCatalog());
        this.ui.setMaterialPackStatus(`${manifest.name} הוחלה ונשמרה מקומית.`, 'success');
        this.ui.toast(`חבילת ${manifest.name} יובאה והוחלה על הקרקע.`);
      } catch (error) {
        console.error(error);
        this.ui.setMaterialPackStatus(error.message, 'error');
        this.ui.toast(error.message, 'error');
      } finally {
        this.ui.setBusy(false);
      }
    });
    this.ui.on('remove-material-pack', async () => {
      const id = this.ui.getSelectedMaterialPack();
      const removed = await this.materialPackManager.removeImportedPack(id);
      if (!removed) {
        this.ui.toast('לא ניתן למחוק חבילה מובנית.', 'error');
        return;
      }
      this.activeMaterialPackId = 'mediterranean';
      this.ui.setMaterialPacks(this.materialPackManager.getCatalog(), this.activeMaterialPackId);
      this.terrainGraphEditor.setMaterialPackCatalog(this.materialPackManager.getCatalog());
      await this.#applyMaterialPack(this.activeMaterialPackId, true);
    });
    this.ui.on('streaming-settings', (settings) => {
      Object.assign(this.streamingSettings, settings);
      this.world.setStreamingSettings(settings);
    });
    this.ui.on('brush-change', ({ property, value }) => {
      if (property === 'radius') this.brushController.setRadius(value);
    });
    this.ui.on('material-settings', (settings) => {
      this.materialSettings = cloneMaterialSettings(settings);
      this.materialLibrary.applySettings(this.materialSettings);
    });
    this.ui.on('update-displacement-preview', () => {
      const settings = this.ui.getMaterialSettings();
      this.materialSettings = cloneMaterialSettings(settings);
      this.materialLibrary.applySettings(this.materialSettings);
      this.world.setDisplacementPreview({
        enabled: this.materialSettings.displacementEnabled && this.materialSettings.displacementPreviewEnabled,
        target: this.controls.target,
        radius: this.materialSettings.displacementPreviewRadius,
      });
      const activeLayers = this.materialSettings.layers.filter((layer) => layer.displacementEnabled).map((layer) => layer.label);
      this.ui.toast(activeLayers.length
        ? `True Displacement Preview עודכן: ${activeLayers.join(', ')}.`
        : 'לא נבחרה שכבה ל־True Displacement.');
    });
    this.ui.on('water-settings', (settings) => {
      Object.assign(this.waterSettings, settings);
      this.waterSystem.applySettings(this.waterSettings);
      this.projectileSystem.applySettings(this.waterSettings);
      this.#resize();
    });
    this.ui.on('reset-floating-objects', () => {
      this.projectileSystem.clear();
      this.waterSystem.resetFloatingObjects();
    });
    this.ui.on('floating-demo-view', () => this.#focusWaterDemo('floating'));
    this.ui.on('underwater-demo-view', () => this.#focusUnderwaterDemo());
    this.ui.on('quality-change', async (qualityTier) => {
      try {
        this.materialSettings.qualityTier = qualityTier;
        this.materialLibrary.setQualityTier(qualityTier);
        const tier = QUALITY_TIERS[qualityTier];
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.pixelRatio));
        this.#resize();
        await this.#applyMaterialPack(this.activeMaterialPackId, false);
        this.ui.toast(`${tier.label} הופעל וחבילת החומרים נבנתה מחדש אוטומטית.`);
      } catch (error) {
        this.ui.toast(error.message, 'error');
      }
    });
    this.ui.on('environment-settings', (settings) => {
      this.environmentSettings = { ...this.environmentSettings, ...settings };
      this.environmentSystem.applySettings(this.environmentSettings);
    });
    this.ui.on('load-environment-preset', async () => {
      const id = this.ui.getEnvironmentPreset();
      this.ui.setEnvironmentStatus('טוען HDRI ומייצר PMREM...', 'loading');
      this.ui.setBusy(true, 'טוען סביבת HDRI...');
      try {
        await this.environmentSystem.loadPreset(id);
        this.environmentSettings = this.environmentSystem.getSettings();
        this.ui.syncEnvironmentSettings(this.environmentSettings);
        this.ui.setEnvironmentStatus(`${id} נטען. Shadow ${this.environmentSystem.shadowMapSize}px.`, 'success');
        this.ui.toast('Preset השמיים נטען והוחל על התאורה וה־PBR.');
      } catch (error) {
        this.ui.setEnvironmentStatus(error.message, 'error');
        this.ui.toast(error.message, 'error');
      } finally { this.ui.setBusy(false); }
    });
    this.ui.on('choose-hdri-file', () => this.ui.chooseHdriFile());
    this.ui.on('hdri-file-selected', async (file) => {
      this.ui.setBusy(true, 'טוען HDR/EXR מקומי ומייצר PMREM...');
      try {
        await this.environmentSystem.loadCustomFile(file);
        this.environmentSettings = this.environmentSystem.getSettings();
        this.ui.setEnvironmentStatus(`${file.name} נטען.`, 'success');
        this.ui.toast('HDR/EXR מקומי הוחל על השמיים וה־PBR.');
      } catch (error) {
        this.ui.setEnvironmentStatus(error.message, 'error');
        this.ui.toast(error.message, 'error');
      } finally { this.ui.setBusy(false); }
    });
    this.ui.on('load-environment-url', async () => {
      this.ui.setBusy(true, 'טוען HDR מהכתובת...');
      try {
        await this.environmentSystem.loadCustomUrl(this.ui.getEnvironmentUrl());
        this.environmentSettings = this.environmentSystem.getSettings();
        this.ui.setEnvironmentStatus('HDR מהכתובת נטען.', 'success');
        this.ui.toast('HDRI חיצוני הוחל בהצלחה.');
      } catch (error) {
        this.ui.setEnvironmentStatus(error.message, 'error');
        this.ui.toast(error.message, 'error');
      } finally { this.ui.setBusy(false); }
    });
    this.ui.on('refresh-ambient-hdri', async () => {
      this.ui.setBusy(true, 'מרענן את רשימת השמיים מ־ambientCG...');
      try {
        await this.#loadAmbientHdriCatalog();
        this.ui.toast('רשימת השמיים מ־ambientCG עודכנה.');
      } catch (error) {
        this.ui.setEnvironmentStatus(error.message, 'error');
        this.ui.toast(error.message, 'error');
      } finally { this.ui.setBusy(false); }
    });
    this.ui.on('load-ambient-hdri', async () => {
      const id = this.ui.getSelectedAmbientHdri();
      if (!id) {
        this.ui.toast('בחר HDRI מרשימת ambientCG.', 'error');
        return;
      }
      this.ui.setBusy(true, 'טוען HDRI מ־ambientCG ומייצר PMREM...');
      this.ui.setEnvironmentStatus('טוען ' + id + '...', 'loading');
      try {
        const endpoint = '/api/ambientcg/hdri/' + encodeURIComponent(id) + '?resolution=2K';
        await this.environmentSystem.loadCustomUrl(endpoint);
        this.environmentSettings = this.environmentSystem.getSettings();
        this.ui.syncEnvironmentSettings(this.environmentSettings);
        this.ui.setEnvironmentStatus(id + ' נטען מ־ambientCG.', 'success');
        this.ui.toast('HDRI ' + id + ' הוחל בהצלחה.');
      } catch (error) {
        this.ui.setEnvironmentStatus(error.message, 'error');
        this.ui.toast(error.message, 'error');
      } finally { this.ui.setBusy(false); }
    });
    this.ui.on('spawn-highest', () => this.#setSpawnToHighest(true));
    this.ui.on('spawn-apply', () => this.#setSpawnPoint(this.ui.getSpawnInput(), 'Spawn עודכן.'));
    this.ui.on('spawn-select', () => this.#beginSpawnSelection());
    this.ui.on('fps-toggle', () => (this.fpsActive ? this.#exitFpsMode() : this.#enterFpsMode()));
    this.ui.on('undo', () => this.#undo());
    this.ui.on('redo', () => this.#redo());
    this.ui.on('wireframe', (enabled) => this.world.setWireframe(enabled));
    this.ui.on('reset-camera', () => this.#resetCamera());
    this.ui.on('export', () => this.#exportProject());
    this.ui.on('export-model', () => this.#exportTerrainModel());
    this.ui.on('import', () => this.ui.chooseProjectFile());
    this.ui.on('file-selected', (file) => this.#importProject(file));
  }

  async #buildTerrainFromGraph() {
    this.#exitFpsMode();
    this.#cancelSpawnSelection();
    this.ui.setBusy(true, 'בונה את תוכנית הגרף ומכין חומרי PBR...');
    this.terrainGraphEditor.setBuildBusy(true);
    this.ui.setTerrainGraphStatus('Compiling graph...', 'loading');
    try {
      const catalog = this.materialPackManager.getCatalog();
      const { terrainProgram, materialProgram } = compileTerrainPipeline(this.terrainGraph, {
        packCatalog: catalog,
      });
      const derived = deriveSettingsFromTerrainGraph(this.terrainGraph, this.generatorSettings);
      const nextSettings = {
        ...this.generatorSettings,
        ...derived,
        terrainProgram,
        worldRadius: this.config.worldSizeKm * 500,
        waterLevel: this.config.waterLevel,
      };
      let prepared = null;
      if (materialProgram) {
        this.ui.setTerrainGraphStatus(`Preparing PBR pack: ${materialProgram.packId}...`, 'loading');
        prepared = await this.materialPackManager.preparePack(materialProgram.packId, {
          progress: ({ completed, total, label }) => {
            this.ui.setTerrainGraphStatus(`${label} · ${completed}/${total}`, 'loading');
          },
        });
      }

      this.ui.setTerrainGraphStatus('Applying material pipeline...', 'loading');
      if (prepared) {
        const result = this.materialPackManager.commitPreparedPack(prepared, { materialProgram });
        this.activeMaterialPackId = result.pack.id;
        if (result.materialSettings) {
          this.materialSettings = cloneMaterialSettings(result.materialSettings);
          this.ui.syncMaterialSettings(this.materialSettings);
        }
        this.ui.setMaterialPacks(catalog, result.pack.id);
      } else {
        this.world.materialProgram = null;
      }
      Object.assign(this.generatorSettings, nextSettings);
      this.ui.syncGeneratorSettings(derived);
      this.ui.setTerrainGraphStatus('Generating terrain chunks...', 'loading');
      await this.world.generate(this.generatorSettings);
      this.history.clear();
      this.ui.setHistoryState(false, false);
      this.#setSpawnToHighest(false);
      this.terrainGraphPreview.request(
        this.terrainGraph,
        this.generatorSettings,
        this.#terrainPreviewRequestOptions({ immediate: true }),
      );
      this.ui.setTerrainGraphStatus('Terrain build complete', 'success');
      this.ui.toast('העולם נבנה מחדש מתוכנית הצמתים.');
    } catch (error) {
      console.error(error);
      this.ui.setTerrainGraphStatus(error.message, 'error');
      this.ui.toast(error.message, 'error');
    } finally {
      this.terrainGraphEditor.setBuildBusy(false);
      this.ui.setBusy(false);
    }
  }

  async #loadAmbientHdriCatalog() {
    try {
      const response = await fetch('/api/ambientcg/hdris', { cache: 'no-store' });
      if (!response.ok) {
        let details = '';
        try { details = (await response.json()).error ?? ''; } catch { details = await response.text(); }
        throw new Error(details || 'ambientCG HDRI list HTTP ' + response.status);
      }
      const payload = await response.json();
      this.ui.setAmbientHdriCatalog(payload.items ?? []);
      return payload;
    } catch (error) {
      this.ui.setAmbientHdriCatalog([]);
      this.ui.setEnvironmentStatus('ambientCG HDRI catalog: ' + error.message, 'error');
      throw error;
    }
  }

  async #applyMaterialPack(id, showBusy = true, materialProgram = null, throwOnError = false) {
    if (!id || !this.materialPackManager) return;
    if (showBusy) {
      this.ui.setBusy(true, 'מוריד ומחיל חומרי PBR אמיתיים...');
      this.ui.setMaterialPackStatus('מתחבר לספק החומרים ומכין Texture Arrays...', 'loading');
    }
    try {
      const result = await this.materialPackManager.applyPack(id, {
        progress: ({ completed, total, label }) => this.ui.setMaterialPackStatus(`${label} · ${completed}/${total}`, 'loading'),
        materialProgram,
      });
      this.activeMaterialPackId = result.pack.id;
      const packNode = this.terrainGraph.nodes.find((node) => node.type === 'material/pack');
      if (packNode && packNode.properties.packId !== result.pack.id) {
        packNode.properties.packId = result.pack.id;
        this.terrainGraphEditor.setGraph(this.terrainGraph, { recordHistory: true });
      }
      if (result.materialSettings) {
        this.materialSettings = cloneMaterialSettings(result.materialSettings);
        this.ui.syncMaterialSettings(this.materialSettings);
      }
      this.history.clear();
      this.ui.setHistoryState(false, false);
      const sourceLabel = result.pack.source === 'polyhaven' || result.pack.source === 'ambientcg'
        ? `${result.pack.provider} ${result.sourceLabel ?? ''} → ${result.diagnostics.actualResolution}px`
        : `${result.diagnostics.actualResolution}px`;
      const warningText = result.warnings?.length ? ` · ${result.warnings.length} fallback(s)` : '';
      this.ui.setMaterialPackStatus(`${result.pack.name} · ${sourceLabel}${warningText}`, result.warnings?.length ? 'warning' : 'success');
      if (result.warnings?.length) console.warn('[Terrain Materials] Applied with neutral fallbacks:', result.warnings);
      this.terrainGraphPreview?.request(
        this.terrainGraph,
        {
          ...this.generatorSettings,
          worldRadius: this.config.worldSizeKm * 500,
          waterLevel: this.config.waterLevel,
        },
        this.#terrainPreviewRequestOptions({ immediate: true }),
      );
      if (showBusy) this.ui.toast(`${result.pack.name} הוחלה עם מפות PBR אמיתיות על הקרקע הקיימת.`);
      return result;
    } catch (error) {
      console.error(error);
      this.ui.setMaterialPackStatus(error.message, 'error');
      if (showBusy) this.ui.toast(error.message, 'error');
      if (throwOnError) throw error;
      return null;
    } finally {
      if (showBusy) this.ui.setBusy(false);
    }
  }

  #bindEvents() {
    this.eventBus.on('history:changed', ({ canUndo, canRedo }) => this.ui.setHistoryState(canUndo, canRedo));
    this.eventBus.on('terrain:generated', ({ settings }) => this.waterSystem.updateBathymetry(settings));
    this.eventBus.on('terrain:edited', () => this.#refreshSpawnHeight());
    this.eventBus.on('terrain:restored', () => this.#refreshSpawnHeight());
    this.eventBus.on('fps:request-exit', () => this.#exitFpsMode());
    this.eventBus.on('streaming:error', ({ error }) => this.ui.toast(error.message, 'error'));
  }

  #bindKeyboard() {
    this.onKeyDown = (event) => {
      const target = event.target;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (this.fpsActive) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? this.#redo() : this.#undo();
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.#redo();
      } else if (event.key.toLowerCase() === 'f') this.#resetCamera();
      else if (event.key.toLowerCase() === 'c') this.#focusUnderwaterDemo();
      else if (event.key === 'Escape') this.#cancelSpawnSelection();
    };
    window.addEventListener('keydown', this.onKeyDown);
  }

  #observeResize() {
    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(this.ui.viewport);
    this.#resize();
  }

  #resize() {
    const width = Math.max(1, this.ui.viewport.clientWidth);
    const height = Math.max(1, this.ui.viewport.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.waterSystem?.resize(width, height, this.renderer.getPixelRatio());
  }

  #resetCamera() {
    if (this.fpsActive) return;
    this.camera.rotation.order = 'XYZ';
    this.camera.position.set(0, 5200, 5400);
    this.controls.target.set(0, 0, 0);
    this.controls.enabled = true;
    this.controls.update();
    this.world.updateStreaming(this.controls.target, true);
  }

  #focusUnderwaterDemo() {
    this.#focusWaterDemo('underwater');
  }

  #focusWaterDemo(mode) {
    if (this.fpsActive) this.#exitFpsMode();
    this.#cancelSpawnSelection();
    const view = mode === 'floating'
      ? this.waterSystem.getFloatingDemoView()
      : this.waterSystem.getUnderwaterDemoView();
    if (!view) {
      this.ui.toast(mode === 'floating'
        ? 'לא נמצאו כדורי ציפה בעולם הנוכחי.'
        : 'לא נמצא בית גידול תת־ימי בעולם הנוכחי.', 'error');
      return;
    }
    this.camera.position.set(view.position.x, view.position.y, view.position.z);
    this.controls.target.set(view.target.x, view.target.y, view.target.z);
    this.controls.enabled = true;
    this.controls.update();
    this.world.updateStreaming(this.controls.target, true);
    this.ui.toast(mode === 'floating'
      ? 'המצלמה הועברה לכדורי בדיקת הציפה.'
      : 'המצלמה הועברה לסביבת ההדגמה התת־ימית.');
  }

  #setSpawnPoint(point, message = null) {
    const next = new THREE.Vector3(Number(point.x), 0, Number(point.z));
    if (!Number.isFinite(next.x) || !Number.isFinite(next.z)) {
      this.ui.toast('ערכי Spawn אינם תקינים.', 'error');
      return false;
    }
    this.world.clampToBounds(next, 2);
    next.y = this.world.sampleHeight(next.x, next.z);
    this.spawnPoint.copy(next);
    this.spawnMarker.position.copy(next).add(new THREE.Vector3(0, 0.15, 0));
    this.spawnMarker.visible = !this.fpsActive;
    this.ui.setSpawnPoint(next);
    if (message) this.ui.toast(message);
    return true;
  }

  #refreshSpawnHeight() {
    this.#setSpawnPoint(this.spawnPoint);
  }

  #setSpawnToHighest(showMessage = true) {
    const highest = this.world.findHighestPointGlobal(160);
    this.#setSpawnPoint(highest, showMessage ? 'Spawn הוצב בפסגה המשוערת הגבוהה ביותר בכל העולם.' : null);
  }

  #beginSpawnSelection() {
    if (this.fpsActive) this.#exitFpsMode();
    this.#cancelSpawnSelection();
    this.selectingSpawn = true;
    this.brushController.setEnabled(false);
    this.controls.enabled = false;
    this.ui.setSpawnSelection(true);
    this.onSpawnPointerDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = this.renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, this.camera);
      const hit = raycaster.intersectObjects(this.world.getMeshes(), false)[0];
      if (hit) this.#setSpawnPoint(hit.point, 'Spawn נבחר על הקרקע.');
      else this.ui.toast('לא נמצאה אדמה בנקודה שנלחצה.', 'error');
      this.#cancelSpawnSelection();
    };
    this.renderer.domElement.addEventListener('pointerdown', this.onSpawnPointerDown, true);
  }

  #cancelSpawnSelection() {
    if (!this.selectingSpawn) return;
    this.selectingSpawn = false;
    this.renderer.domElement.removeEventListener('pointerdown', this.onSpawnPointerDown, true);
    this.onSpawnPointerDown = null;
    this.ui.setSpawnSelection(false);
    this.brushController.setEnabled(!this.fpsActive);
    this.controls.enabled = !this.fpsActive;
  }

  #enterFpsMode() {
    if (this.fpsActive) return;
    this.#cancelSpawnSelection();
    if (!this.#setSpawnPoint(this.ui.getSpawnInput())) return;
    this.editorCameraState = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      target: this.controls.target.clone(),
    };
    this.world.setStreamingMode('fps', this.spawnPoint);
    this.materialLibrary.setPresentationMode('fps');
    this.waterSystem.setPresentationMode('fps');
    this.fpsActive = true;
    this.controls.enabled = false;
    this.brushController.setEnabled(false);
    this.spawnMarker.visible = false;
    this.world.setSelectedChunk(null);
    this.ui.setFpsMode(true);
    this.fpsController.start(this.spawnPoint);
  }

  #exitFpsMode() {
    if (!this.fpsActive) return;
    this.fpsActive = false;
    this.fpsController.stop();
    this.projectileSystem.clear();
    this.ui.setFpsMode(false);
    this.spawnMarker.visible = true;
    this.brushController.setEnabled(true);
    this.controls.enabled = true;
    if (this.editorCameraState) {
      this.camera.rotation.order = 'XYZ';
      this.camera.position.copy(this.editorCameraState.position);
      this.camera.quaternion.copy(this.editorCameraState.quaternion);
      this.controls.target.copy(this.editorCameraState.target);
      this.controls.update();
    } else this.#resetCamera();
    this.world.setStreamingMode('editor', this.controls.target);
    this.materialLibrary.setPresentationMode('editor');
    this.waterSystem.setPresentationMode('editor');
  }

  #undo() {
    if (this.fpsActive || !this.history.undo(this.world)) return;
    this.ui.setHistoryState(this.history.canUndo, this.history.canRedo);
    this.#refreshSpawnHeight();
  }

  #redo() {
    if (this.fpsActive || !this.history.redo(this.world)) return;
    this.ui.setHistoryState(this.history.canUndo, this.history.canRedo);
    this.#refreshSpawnHeight();
  }

  #exportProject() {
    const project = TerrainSerializer.createProject({
      world: this.world,
      config: this.config,
      generatorSettings: this.generatorSettings,
      streamingSettings: this.streamingSettings,
      spawnPoint: this.spawnPoint,
      materialSettings: this.materialLibrary.getSettings(),
      waterSettings: this.waterSettings,
      environmentSettings: this.environmentSystem.getSettings(),
      materialPackId: this.activeMaterialPackId,
      materialPackDefinition: this.materialPackManager.getPack(this.activeMaterialPackId)?.source === 'custom'
        ? this.materialPackManager.getPack(this.activeMaterialPackId)
        : null,
      terrainGraph: this.terrainGraph,
    });
    TerrainSerializer.download(project, `terrain-engine-3.11.6-${Date.now()}.json`);
    this.ui.toast('הפרויקט יוצא. רק Chunks ששונו נשמרים בקובץ.');
  }

  async #exportTerrainModel() {
    this.#exitFpsMode();
    this.#cancelSpawnSelection();
    const options = this.ui.getTerrainExportOptions();
    const wasFrozen = Boolean(this.world.streamingSettings.freezeStreaming);
    let mesh = null;
    this.ui.setBusy(true, 'מכין את כל עולם האדמה לייצוא...');
    this.ui.setTerrainExportStatus('משלים טעינת Chunks...', 'loading');
    try {
      if (wasFrozen) this.world.setStreamingSettings({ freezeStreaming: false });
      this.world.setStreamingMode('editor', this.controls.target);
      const ready = await this.world.waitForEditorReady(120000);
      if (!ready) throw new Error('Terrain streaming did not finish before the export timeout.');

      this.ui.setBusy(true, 'אופה גבהים, Normals, UV וצבעי שכבות...');
      this.ui.setTerrainExportStatus('אופה גיאומטריה אמיתית...', 'loading');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      mesh = buildTerrainExportMesh(this.world, {
        ...options,
        onProgress: ({ completed, total }) => {
          if (completed === total || completed % 32 === 0) {
            this.ui.setTerrainExportStatus(`אופה Chunks · ${completed}/${total}`, 'loading');
          }
        },
      });

      const metrics = mesh.geometry.userData.terrainExport;
      this.ui.setBusy(true, `מייצר ${options.format.toUpperCase()}...`);
      this.ui.setTerrainExportStatus(
        `ממיר ${metrics.vertexCount.toLocaleString()} vertices ל־${options.format.toUpperCase()}...`,
        'loading',
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const result = await serializeTerrainMesh(mesh, options);
      const filename = createTerrainExportFilename('terrain-engine-world', result.extension);
      downloadTerrainExport(result, filename);
      const bytes = typeof result.data === 'string'
        ? new TextEncoder().encode(result.data).byteLength
        : result.data.byteLength;
      this.ui.setTerrainExportStatus(
        `${filename} · ${(bytes / 1048576).toFixed(1)} MB · ${metrics.triangleCount.toLocaleString()} triangles`,
        'success',
      );
      this.ui.toast(`מודל ${result.extension.toUpperCase()} אפוי הורד בהצלחה.`);
    } catch (error) {
      console.error('[Terrain Model Export]', error);
      this.ui.setTerrainExportStatus(error.message, 'error');
      this.ui.toast(`ייצוא המודל נכשל: ${error.message}`, 'error');
    } finally {
      disposeTerrainExportMesh(mesh);
      if (wasFrozen) this.world.setStreamingSettings({ freezeStreaming: true });
      this.ui.setBusy(false);
    }
  }

  async #importProject(file) {
    this.#exitFpsMode();
    this.#cancelSpawnSelection();
    this.ui.setBusy(true, 'טוען Large World Project...');
    try {
      const project = JSON.parse(await file.text());
      if (project.materialPackDefinition?.source === 'custom') {
        await this.materialPackManager.saveCustomPack(project.materialPackDefinition);
        const catalog = this.materialPackManager.getCatalog();
        this.ui.setMaterialPacks(catalog, project.materialPackDefinition.id);
        this.terrainGraphEditor.setMaterialPackCatalog(catalog);
      }
      const graphFallbackSettings = {
        ...(project.generatorSettings ?? this.generatorSettings),
        worldRadius: this.config.worldSizeKm * 500,
        waterLevel: this.config.waterLevel,
      };
      const importedGraph = normalizeTerrainGraph(
        project.terrainGraph ?? createDefaultTerrainGraph(graphFallbackSettings),
        graphFallbackSettings,
      );
      const graphValidation = validateTerrainGraph(importedGraph);
      if (!graphValidation.valid) {
        throw new Error(`Terrain graph in project is invalid: ${graphValidation.errors[0]}`);
      }
      project.terrainGraph = importedGraph;
      const importedPipeline = compileTerrainPipeline(importedGraph, {
        packCatalog: this.materialPackManager.getCatalog(),
      });
      project.generatorSettings = {
        ...(project.generatorSettings ?? {}),
        terrainProgram: importedPipeline.terrainProgram,
      };
      const result = TerrainSerializer.applyProject(project, { world: this.world, config: this.config });
      this.terrainGraph = result.terrainGraph ?? importedGraph;
      this.terrainGraphEditor.setGraph(this.terrainGraph, { recordHistory: true });
      this.terrainGraphPreview.request(this.terrainGraph, {
        ...this.generatorSettings,
        ...(result.generatorSettings ?? {}),
      }, this.#terrainPreviewRequestOptions({ immediate: true }));
      if (result.generatorSettings) {
        Object.assign(this.generatorSettings, result.generatorSettings);
        this.ui.syncGeneratorSettings(result.generatorSettings);
        this.waterSystem.updateBathymetry(this.generatorSettings);
      }
      if (result.streamingSettings) {
        Object.assign(this.streamingSettings, result.streamingSettings);
        this.world.setStreamingSettings(this.streamingSettings);
        this.ui.syncStreamingSettings(this.streamingSettings);
      }
      if (result.materialSettings) {
        this.materialSettings = cloneMaterialSettings(result.materialSettings);
        this.materialLibrary.applySettings(this.materialSettings);
        this.ui.syncMaterialSettings(this.materialSettings);
      }
      if (result.waterSettings) {
        Object.assign(this.waterSettings, result.waterSettings);
        this.waterSystem.applySettings(this.waterSettings);
        this.projectileSystem.applySettings(this.waterSettings);
        this.ui.syncWaterSettings(this.waterSettings);
      }
      if (result.environmentSettings) {
        this.environmentSettings = { ...this.environmentSettings, ...result.environmentSettings };
        await this.environmentSystem.applySettings(this.environmentSettings, { reloadEnvironment: true });
        this.ui.syncEnvironmentSettings(this.environmentSettings);
      }
      const graphPackId = importedPipeline.materialProgram?.packId ?? result.materialPackId;
      if (graphPackId) {
        const exists = this.materialPackManager.getCatalog().some((pack) => pack.id === graphPackId);
        if (exists) {
          this.ui.setMaterialPacks(this.materialPackManager.getCatalog(), graphPackId);
          this.terrainGraphEditor.setMaterialPackCatalog(this.materialPackManager.getCatalog());
          await this.#applyMaterialPack(
            graphPackId,
            false,
            importedPipeline.materialProgram,
            true,
          );
        }
      }
      this.ui.setPreset(result.presetId);
      if (result.spawnPoint) this.#setSpawnPoint(result.spawnPoint);
      else this.#setSpawnToHighest(false);
      this.history.clear();
      this.ui.setHistoryState(false, false);
      this.ui.toast('הפרויקט נטען. Chunks נערכים יוחזרו בזמן Streaming.');
    } catch (error) {
      console.error(error);
      this.ui.toast(error.message, 'error');
    } finally {
      this.ui.setBusy(false);
    }
  }

  #animate() {
    const frameStart = performance.now();
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.05);
    this.elapsed += delta;
    if (this.fpsActive) this.fpsController.update(delta);
    else this.controls.update();
    this.projectileSystem.update(delta);

    const streamingTarget = this.fpsActive ? this.fpsController.position : this.controls.target;
    this.world.updateStreaming(streamingTarget);
    this.environmentSystem.update(this.elapsed);
    this.waterSystem.update(delta, this.camera.position);
    this.spawnMarker.rotation.y += delta * 0.38;
    this.waterSystem.render(this.scene, this.camera);

    const frameMs = performance.now() - frameStart;
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length > 60) this.frameSamples.shift();
    this.fpsFrames += 1;
    const now = performance.now();
    if (now - this.fpsWindowStart >= 500) {
      this.currentFps = Math.round(this.fpsFrames * 1000 / (now - this.fpsWindowStart));
      this.fpsFrames = 0;
      this.fpsWindowStart = now;
    }
    if (now - this.lastStatusAt >= 500) {
      const averageFrame = this.frameSamples.reduce((sum, value) => sum + value, 0) / Math.max(this.frameSamples.length, 1);
      const position = this.fpsActive ? this.fpsController.position : this.controls.target;
      this.ui.updateStatus({
        fps: this.currentFps,
        frameMs: averageFrame,
        position,
        rendererInfo: this.renderer.info.render,
        terrain: this.world.getDiagnostics(),
        materials: this.materialLibrary.getDiagnostics(),
        water: this.waterSystem.getDiagnostics(),
        environment: this.environmentSystem.getDiagnostics(),
      });
      this.lastStatusAt = now;
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.#cancelSpawnSelection();
    this.resizeObserver?.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    this.fpsController?.dispose();
    this.projectileSystem?.dispose();
    this.brushController?.dispose();
    this.world?.dispose();
    this.generationService?.dispose();
    this.materialLibrary?.dispose();
    this.waterSystem?.dispose();
    this.materialPackManager?.dispose();
    this.environmentSystem?.dispose();
    this.spawnMarker?.traverse((object) => { object.geometry?.dispose?.(); object.material?.dispose?.(); });
    this.controls?.dispose();
    this.renderer?.dispose();
    this.timer?.disconnect();
    this.eventBus.clear();
  }
}
