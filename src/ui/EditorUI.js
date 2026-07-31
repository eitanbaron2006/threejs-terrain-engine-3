import { QUALITY_TIERS } from '../terrain/TerrainConfig.js';
import { ENVIRONMENT_PRESETS } from '../environment/EnvironmentPresets.js';
import { BUILTIN_TERRAIN_MATERIAL_PACKS } from '../terrain/TerrainMaterialPacks.js';
import { TERRAIN_NODE_DEFINITIONS } from '../terrain/TerrainGraphModel.js';
import { TerrainMaterialPackStudio } from './TerrainMaterialPackStudio.js';

const TOOL_LABELS = {
  raise: 'הגבהה',
  lower: 'הנמכה',
  smooth: 'החלקה',
  flatten: 'יישור',
  noise: 'רעש',
  paint: 'צביעת חומר',
  'erase-paint': 'מחיקת צביעה',
};

export class EditorUI {
  constructor(root, { config, generatorSettings, brushSettings, materialSettings, streamingSettings, waterSettings, environmentSettings = {}, presetId }) {
    this.root = root;
    this.config = config;
    this.generatorSettings = generatorSettings;
    this.brushSettings = brushSettings;
    this.materialSettings = materialSettings;
    this.streamingSettings = streamingSettings;
    this.waterSettings = waterSettings;
    this.environmentSettings = { ...environmentSettings };
    this.materialPacks = Object.values(BUILTIN_TERRAIN_MATERIAL_PACKS);
    this.ambientHdriCatalog = [];
    this.callbacks = new Map();
    this.#render(presetId);
    this.#bind();
  }

  #render(presetId) {
    const presets = this.materialPacks
      .map((pack) => `<option value="${pack.id}" ${pack.id === presetId ? 'selected' : ''}>${pack.name}</option>`)
      .join('');
    const environmentOptions = Object.values(ENVIRONMENT_PRESETS)
      .map((preset) => `<option value="${preset.id}" ${preset.id === (this.environmentSettings.presetId ?? 'summer') ? 'selected' : ''}>${preset.name}</option>`)
      .join('');
    const qualityOptions = Object.entries(QUALITY_TIERS)
      .map(([id, tier]) => `<option value="${id}" ${id === this.materialSettings.qualityTier ? 'selected' : ''}>${tier.label}</option>`)
      .join('');
    const displacementControls = this.materialSettings.layers.map((layer, index) => `
      <div class="studio-layer-card true-displacement-layer">
        <label class="toggle"><input id="displacement-layer-${index}" type="checkbox" ${layer.displacementEnabled ? 'checked' : ''}><span>${layer.label} · Geometry</span></label>
        ${this.#range(`displacement-${index}`, 'עוצמה גיאומטרית במטרים', layer.strength, 0, index === 3 ? 2.5 : 1.25, 0.01)}
        ${this.#range(`displacement-center-${index}`, 'גובה אפס במפת Height', layer.displacementCenter ?? 0.5, 0, 1, 0.01)}
      </div>`).join('');
    const nodeCategories = [...new Set(Object.values(TERRAIN_NODE_DEFINITIONS).map((definition) => definition.category))];
    const nodePalette = nodeCategories.map((category) => `
      <section class="terrain-node-category">
        <h3>${category}</h3>
        ${Object.entries(TERRAIN_NODE_DEFINITIONS)
          .filter(([, definition]) => definition.category === category)
          .map(([type, definition]) => `<button type="button" class="terrain-node-item" data-node-type="${type}">${definition.title}</button>`)
          .join('')}
      </section>`).join('');
    const quickNodeTypes = [
      'world/coordinates',
      'noise/fbm',
      'transform/domainWarp',
      'transform/terrace',
      'combine/add',
      'shape/islandCoast',
      'terrain/output',
    ];

    this.root.innerHTML = `
      <div class="editor-shell">
        <aside id="settings-sidebar" class="sidebar">
          <header class="brand">
            <div class="brand-mark">TE</div>
            <div><h1>Terrain Engine 3.11.6</h1><p>Sky Studio · True Displacement · Material System 2.0 · WebGL2</p></div>
            <button type="button" class="sidebar-toggle" data-action="toggle-sidebar" aria-controls="settings-sidebar" aria-expanded="true" title="סגור סרגל הגדרות">›</button>
          </header>
          <div class="sidebar-scroll">
            <details class="panel" open>
              <summary>Large World & Streaming</summary>
              <div class="panel-content">
                <div class="metric-strip"><span>עולם</span><b>${this.config.worldSizeKm}×${this.config.worldSizeKm} ק״מ</b><span>Chunk</span><b>${this.config.chunkSize} מ׳</b></div>
                ${this.#range('stream-radius', 'רדיוס Streaming ב־FPS', this.streamingSettings.streamRadius, 2, 6, 1)}
                <label class="toggle"><input id="show-chunk-bounds" type="checkbox" ${this.streamingSettings.showChunkBounds ? 'checked' : ''}><span>הצג גבולות Chunks</span></label>
                <label class="toggle"><input id="freeze-streaming" type="checkbox" ${this.streamingSettings.freezeStreaming ? 'checked' : ''}><span>הקפא Streaming</span></label>
                <p class="hint">במצב Editor כל העולם נשאר מוצג עם LOD מדורג. במצב FPS נטען רק האזור שסביב השחקן.</p>
              </div>
            </details>

            <details class="panel" open>
              <summary>Sky & Sun Studio</summary>
              <div class="panel-content">
                <label class="field"><span>Preset שמיים</span><select id="environment-preset">${environmentOptions}</select></label>
                <p id="environment-description" class="hint"></p>
                <div class="action-row"><button class="secondary" data-action="load-environment-preset">טען Preset</button><button class="secondary" data-action="choose-hdri-file">טען HDR/EXR מקומי</button></div>
                <label class="field"><span>HDR URL</span><input id="environment-url" type="url" placeholder="https://.../sky.hdr"></label>
                <button class="ghost full" data-action="load-environment-url">טען HDR מהכתובת</button>
                <label class="field"><span>ambientCG HDRI</span><select id="ambient-hdri-select"><option value="">טוען רשימת שמיים...</option></select></label>
                <div class="action-row"><button class="ghost" data-action="refresh-ambient-hdri">רענן רשימת שמיים</button><button class="ghost" data-action="load-ambient-hdri">טען HDRI מ־ambientCG</button></div>
                ${this.#range('sun-azimuth', 'כיוון שמש', this.environmentSettings.sunAzimuth ?? 38, 0, 360, 1)}
                ${this.#range('sun-elevation', 'גובה שמש', this.environmentSettings.sunElevation ?? 48, 2, 88, 1)}
                ${this.#range('sun-intensity', 'עוצמת שמש', this.environmentSettings.sunIntensity ?? 2.9, 0, 6, 0.05)}
                <label class="field"><span>צבע שמש</span><input id="sun-color" type="color" value="${this.environmentSettings.sunColor ?? '#fff2cf'}"></label>
                ${this.#range('environment-exposure', 'Exposure', this.environmentSettings.exposure ?? 1, 0.35, 2, 0.01)}
                ${this.#range('environment-intensity', 'IBL / PBR', this.environmentSettings.environmentIntensity ?? 0.3, 0, 1.5, 0.01)}
                ${this.#range('background-intensity', 'עוצמת רקע HDRI', this.environmentSettings.backgroundIntensity ?? 0.68, 0, 1.5, 0.01)}
                ${this.#range('background-blur', 'טשטוש רקע', this.environmentSettings.backgroundBlurriness ?? 0.02, 0, 1, 0.01)}
                ${this.#range('hemi-intensity', 'Hemisphere Light', this.environmentSettings.hemiIntensity ?? 0.14, 0, 2, 0.01)}
                ${this.#range('fill-intensity', 'Fill Light', this.environmentSettings.fillIntensity ?? 0.04, 0, 0.5, 0.005)}
                ${this.#range('shadow-radius', 'רדיוס צל סביב השחקן', this.environmentSettings.shadowRadius ?? 40, 15, 150, 1)}
                <label class="field"><span>Shadow Map</span><select id="shadow-map-size"><option value="2048">2K</option><option value="4096">4K</option><option value="8192" selected>8K</option></select></label>
                ${this.#range('shadow-bias', 'Shadow Bias', this.environmentSettings.shadowBias ?? -0.00003, -0.001, 0.001, 0.00001)}
                ${this.#range('shadow-normal-bias', 'Normal Bias', this.environmentSettings.shadowNormalBias ?? 0.018, 0, 0.1, 0.001)}
                <label class="toggle"><input id="birds-enabled" type="checkbox" ${(this.environmentSettings.birdsEnabled ?? true) ? 'checked' : ''}><span>ציפורים בשמיים</span></label>
                <label class="toggle"><input id="fog-enabled" type="checkbox" ${this.environmentSettings.fogEnabled ? 'checked' : ''}><span>Atmospheric Fog</span></label>
                ${this.#range('fog-density', 'צפיפות ערפל', this.environmentSettings.fogDensity ?? 0.0004, 0.00005, 0.0015, 0.00001)}
                <div id="environment-status" class="ktx2-validation" data-state="idle"><b>Environment</b><span>מוכן.</span></div>
                <input id="hdri-file" type="file" accept=".hdr,.exr,image/vnd.radiance,image/x-exr,application/octet-stream" hidden>
              </div>
            </details>

            <details class="panel" open>
              <summary>מחולל פרוצדורלי</summary>
              <div class="panel-content">
                ${this.#number('seed', 'Seed', this.generatorSettings.seed, 1)}
                ${this.#range('amplitude', 'גובה הרים', this.generatorSettings.amplitude, 20, 170, 1)}
                ${this.#range('frequency', 'קנה מידה', this.generatorSettings.frequency, 0.0007, 0.006, 0.00005)}
                ${this.#range('octaves', 'Octaves', this.generatorSettings.octaves, 2, 8, 1)}
                ${this.#range('ridgeStrength', 'רכסים', this.generatorSettings.ridgeStrength, 0, 1.2, 0.01)}
                ${this.#range('warpStrength', 'Domain Warp', this.generatorSettings.warpStrength, 0, 220, 1)}
                ${this.#range('continentalStrength', 'Continental Form', this.generatorSettings.continentalStrength, 0, 130, 1)}
                ${this.#range('terraceStrength', 'Terracing', this.generatorSettings.terraceStrength, 0, 0.55, 0.01)}
                ${this.#range('landRadius', 'רדיוס היבשה', this.generatorSettings.landRadius, 2100, 3500, 25)}
                ${this.#range('coastWidth', 'רוחב רצועת החוף', this.generatorSettings.coastWidth, 220, 1200, 10)}
                ${this.#range('coastIrregularity', 'אי־סדירות קו החוף', this.generatorSettings.coastIrregularity, 0, 0.36, 0.01)}
                ${this.#range('oceanDepth', 'עומק קרקעית הים', this.generatorSettings.oceanDepth, 12, 100, 1)}
                <p class="hint">הגבול החיצוני תמיד יורד מתחת למים לפני סוף העולם, ולכן מתקבל אי או יבשת שלמה ללא חתך מרובע.</p>
                <button class="primary full" data-action="generate">צור עולם מחדש</button>
              </div>
            </details>

            <details class="panel" open>
              <summary>מים ואוקיינוס GPU</summary>
              <div class="panel-content">
                <div class="metric-strip"><span>משטח</span><b>עיגול עוקב מצלמה</b><span>Simulation</span><b>${this.waterSettings.simulationResolution}²</b></div>
                <label class="toggle"><input id="dynamic-ripples" type="checkbox" ${this.waterSettings.dynamicRipples ? 'checked' : ''}><span>GPU Dynamic Ripples</span></label>
                ${this.#range('water-wave-amplitude', 'גובה גלי אוקיינוס', this.waterSettings.waveAmplitude, 0, 0.9, 0.01)}
                ${this.#range('water-ripple-amplitude', 'עוצמת סימולציית גלים', this.waterSettings.rippleAmplitude, 0, 3.5, 0.05)}
                ${this.#range('water-normal-strength', 'חדות Normal של המים', this.waterSettings.normalStrength, 0.2, 5, 0.05)}
                ${this.#range('water-refraction', 'Refraction', this.waterSettings.refractionStrength, 0, 0.04, 0.001)}
                ${this.#range('water-shore-fade', 'Depth Fade בחוף', this.waterSettings.shoreFade, 0.2, 4, 0.05)}
                ${this.#range('water-foam', 'קצף חוף', this.waterSettings.foamStrength, 0, 1, 0.01)}
                ${this.#range('water-curvature', 'עקמומיות אופק', this.waterSettings.horizonCurvature, 0, 110, 1)}
                <label class="toggle"><input id="water-floating-spheres" type="checkbox" ${this.waterSettings.floatingSpheresEnabled ? 'checked' : ''}><span>כדורי בדיקת ציפה</span></label>
                ${this.#range('water-object-density', 'צפיפות אובייקטים צפים', this.waterSettings.waterObjectDensity, 0.2, 1.4, 0.01)}
                <label class="toggle"><input id="water-aquatic-life" type="checkbox" ${this.waterSettings.aquaticLifeEnabled ? 'checked' : ''}><span>דגים, עשב ים ואלמוגים</span></label>
                ${this.#range('water-fish-count', 'כמות דגים', this.waterSettings.fishCount, 0, 48, 2)}
                ${this.#range('water-seagrass-count', 'כמות עשב ים', this.waterSettings.seagrassCount, 0, 180, 10)}
                ${this.#range('water-coral-count', 'כמות אלמוגים', this.waterSettings.coralCount, 0, 24, 1)}
                <label class="toggle"><input id="water-underwater-optics" type="checkbox" ${this.waterSettings.underwaterOpticsEnabled ? 'checked' : ''}><span>אופטיקה תת־ימית</span></label>
                ${this.#range('water-optical-density', 'צפיפות אופטית במים', this.waterSettings.underwaterOpticalDensity, 0.45, 1.8, 0.05)}
                <button class="secondary full" data-action="underwater-demo-view">מעבר לסביבת ההדגמה התת־ימית</button>
                <p class="hint">המים משתמשים ב־ping-pong Render Targets, Fresnel, שבירה, עומק, קצף ו־shore fade. אותו משטח ממלא את הים והאגמים שמתחת לגובה המים.</p>
              </div>
            </details>

            <details class="panel" open>
              <summary>Real PBR Terrain Materials</summary>
              <div class="panel-content">
                <label class="field"><span>Quality Tier</span><select id="quality-tier">${qualityOptions}</select></label>
                <label class="field"><span>Terrain Material Pack</span><select id="preset-select">${presets}</select></label>
                <p id="preset-description" class="hint"></p>
                <div id="material-swatches" class="material-preview-grid"></div>
                <button class="primary full" data-action="apply-material-pack">הורד והחל חבילת PBR</button>
                <div class="action-row"><button class="secondary" data-action="edit-material-pack">צור / ערוך חבילה</button><button class="secondary" data-action="choose-material-pack">ייבא ZIP</button></div>
                <button class="ghost full" data-action="remove-material-pack">מחק חבילה מותאמת</button>
                <div id="material-pack-status" class="ktx2-validation" data-state="idle"><b>Terrain Materials</b><span>בחירת חבילה אינה מחילה אותה. לחץ על “הורד והחל” כדי לשנות את הקרקע.</span></div>
                <div id="material-pack-studio" class="material-pack-studio" hidden></div>
                <p class="provider-credit">Powered by Poly Haven + ambientCG · CC0</p><input id="material-pack-file" type="file" accept="application/zip,.zip" hidden>
                <label class="toggle"><input id="displacement-enabled" type="checkbox" ${this.materialSettings.displacementEnabled ? 'checked' : ''}><span>True Geometric Displacement</span></label>
                <label class="field"><span>כיוון Displacement</span><select id="displacement-mode"><option value="normal" ${this.materialSettings.displacementMode !== 'vertical' ? 'selected' : ''}>לאורך ה־Normal של הקרקע</option><option value="vertical" ${this.materialSettings.displacementMode === 'vertical' ? 'selected' : ''}>אנכי בלבד</option></select></label>
                ${this.#range('displacement-weight-threshold', 'סף משקל שכבה', this.materialSettings.displacementWeightThreshold ?? 0.08, 0, 0.6, 0.01)}
                ${this.#range('displacement-near', 'תחילת דעיכה במרחק', this.materialSettings.displacementNear ?? 0, 0, 500, 5)}
                ${this.#range('displacement-far', 'סיום Displacement במרחק', this.materialSettings.displacementFar ?? 420, 20, 1200, 10)}
                <label class="toggle"><input id="displacement-preview-enabled" type="checkbox" ${this.materialSettings.displacementPreviewEnabled ? 'checked' : ''}><span>High-Detail Preview בעורך</span></label>
                ${this.#range('displacement-preview-radius', 'רדיוס Preview ב־Chunks', this.materialSettings.displacementPreviewRadius ?? 1, 0, 2, 1)}
                <button class="ghost full" data-action="update-displacement-preview">עדכן Preview סביב נקודת המבט</button>
                <p class="hint">זהו שינוי vertices אמיתי. במצב Editor האזור האיכותי מתעדכן רק בלחיצה כדי למנוע בנייה מחדש בזמן תנועת המצלמה; ב־FPS הוא פועל אוטומטית לפי LOD.</p>
                <label class="toggle"><input id="parallax-enabled" type="checkbox" ${this.materialSettings.parallaxEnabled ? 'checked' : ''}><span>Parallax / Height Detail</span></label>
                ${this.#range('height-blend', 'Height Blend', this.materialSettings.heightBlendSharpness, 0, 0.75, 0.01)}
                ${this.#range('macro-variation', 'Macro Variation', this.materialSettings.macroVariation, 0, 0.5, 0.01)}
                ${this.#range('detail-normal', 'Detail Normal', this.materialSettings.detailNormalStrength, 0, 1, 0.01)}
                ${this.#range('parallax-scale', 'Parallax Depth', this.materialSettings.parallaxScale, 0, 0.2, 0.005)}
                ${displacementControls}
              </div>
            </details>

            <details class="panel">
              <summary>עריכת הקרקע</summary>
              <div class="panel-content">
                <div class="tool-grid">${Object.entries(TOOL_LABELS).map(([id, label]) => `<button class="tool-button ${id === this.brushSettings.tool ? 'active' : ''}" data-tool="${id}">${label}</button>`).join('')}</div>
                ${this.#range('brush-radius', 'רדיוס', this.brushSettings.radius, 4, 72, 1)}
                ${this.#range('brush-strength', 'עוצמה', this.brushSettings.strength, 0.05, 2, 0.05)}
                ${this.#range('brush-hardness', 'קשיחות', this.brushSettings.hardness, 0, 0.95, 0.05)}
                <label class="field"><span>שכבה לצביעה</span><select id="material-layer">${this.materialSettings.layers.map((layer, index) => `<option value="${index}">${layer.label}</option>`).join('')}</select></label>
                <div class="action-row"><button class="secondary" data-action="undo" disabled>בטל</button><button class="secondary" data-action="redo" disabled>בצע שוב</button></div>
                <p class="hint">גרור שמאל לעריכה. Alt + גרירה מסובב את מצלמת העורך.</p>
              </div>
            </details>

            <details class="panel fps-panel" open>
              <summary>FPS Mode & Spawn</summary>
              <div class="panel-content">
                <div class="coordinate-grid">${this.#number('spawn-x', 'Spawn X', 0, 0.1)}${this.#number('spawn-z', 'Spawn Z', 0, 0.1)}</div>
                <div class="action-row"><button class="secondary" data-action="spawn-highest">הפסגה בעולם</button><button class="secondary" data-action="spawn-apply">החל X / Z</button></div>
                <button class="ghost full" data-action="spawn-select">בחר על הקרקע</button>
                <div id="spawn-readout" class="spawn-readout">Spawn: —</div>
                <button class="fps-button full" data-action="fps-toggle">הפעל FPS MODE</button>
                <p class="hint">WASD · Shift · Space · עכבר · Esc. ה־Streaming עוקב אחרי השחקן.</p>
              </div>
            </details>

            <details class="panel" open>
              <summary>Project & Diagnostics</summary>
              <div class="panel-content">
                <div class="action-row"><button class="secondary" data-action="export">ייצא JSON</button><button class="secondary" data-action="import">טען JSON</button></div>
                <input id="project-file" type="file" accept="application/json,.json" hidden>
                <label class="toggle"><input id="wireframe" type="checkbox"><span>Wireframe</span></label>
                <button class="ghost full" data-action="reset-camera">אפס מצלמה</button>
                <section class="model-export-section">
                  <h3>Model Export</h3>
                  <label class="field"><span>Format</span><select id="terrain-export-format">
                    <option value="glb">GLB · Three.js / Engines</option>
                    <option value="fbx">FBX · DCC / Engines</option>
                    <option value="obj">OBJ · Geometry</option>
                    <option value="stl">STL · Binary</option>
                    <option value="ply">PLY · Binary + Colors</option>
                  </select></label>
                  <label class="field"><span>Geometry Detail</span><select id="terrain-export-detail">
                    <option value="draft">Draft · 16×16 / Chunk</option>
                    <option value="standard" selected>Standard · 32×32 / Chunk</option>
                    <option value="high">High · 64×64 / Chunk</option>
                  </select></label>
                  <label class="field" data-fbx-preset-field hidden><span>FBX Target</span><select id="terrain-export-fbx-preset">
                    <option value="blender" selected>Blender</option>
                    <option value="unity">Unity</option>
                    <option value="unreal">Unreal Engine</option>
                    <option value="threejs">Three.js</option>
                  </select></label>
                  <label class="toggle"><input id="terrain-export-vertex-colors" type="checkbox" checked><span>Baked Layer Vertex Colors</span></label>
                  <button class="primary full" data-action="export-model">ייצא מודל אפוי</button>
                  <div id="terrain-export-status" class="ktx2-validation terrain-export-status" data-state="idle"><b>Model Export</b><span>מוכן לייצוא.</span></div>
                </section>
                <div id="diagnostics" class="diagnostics"></div>
              </div>
            </details>
          </div>
        </aside>
        <button type="button" class="sidebar-restore" data-sidebar-restore aria-controls="settings-sidebar" aria-expanded="false" title="פתח סרגל הגדרות">‹</button>

        <main class="viewport-wrap">
          <section class="viewport-stage">
            <div id="viewport"></div>
            <div class="top-status">
              <span id="status-mode">EDITOR</span><span id="status-fps">FPS: —</span><span id="status-frame">Frame: —</span><span id="status-chunks">Chunks: —</span><span id="status-draws">Draws: —</span><span id="status-position">X — · Z —</span>
            </div>
            <div id="fps-crosshair" class="fps-crosshair"><i></i><b></b></div>
            <div id="fps-help" class="fps-help">WASD · SHIFT · SPACE · ESC</div>
            <div id="spawn-selection-banner" class="spawn-selection-banner">לחץ על הקרקע כדי לקבוע Spawn</div>
            <div id="busy" class="busy"><span class="spinner"></span><span>טוען...</span></div>
            <div id="toast" class="toast"></div>
          </section>
          <section id="terrain-graph-dock" class="terrain-graph-dock" tabindex="0" aria-label="Terrain graph workspace">
            <div class="terrain-graph-resize" title="Resize terrain graph"></div>
            <header class="terrain-graph-toolbar">
              <div class="terrain-graph-title"><b>Terrain Graph</b><span>LIVE PIPELINE</span></div>
              <div class="terrain-graph-actions">
                <button type="button" data-graph-action="undo" title="Undo graph change" disabled>↶</button>
                <button type="button" data-graph-action="redo" title="Redo graph change" disabled>↷</button>
                <button type="button" data-graph-action="fit" title="Fit all nodes">Fit</button>
                <label class="terrain-panel-toggle"><input type="checkbox" data-graph-action="inspector" checked><span>Selected Node</span></label>
                <label class="terrain-panel-toggle"><input type="checkbox" data-graph-action="preview" checked><span>Auto Preview</span></label>
                <button type="button" class="terrain-build-button" data-graph-action="build">Build Terrain</button>
                <button type="button" data-graph-collapse title="Collapse terrain graph" aria-expanded="true">⌄</button>
              </div>
            </header>
            <div class="terrain-graph-body">
              <aside class="terrain-node-palette" aria-label="Terrain nodes">${nodePalette}</aside>
              <div class="terrain-graph-canvas-wrap"><canvas></canvas></div>
              <div class="terrain-inspector-resize" data-terrain-inspector-resize role="separator" tabindex="0" aria-label="Resize selected node and preview width" aria-orientation="vertical" aria-valuemin="220"></div>
              <aside class="terrain-inspector-pane">
                <section class="terrain-selected-node-pane">
                  <div class="terrain-preview-heading"><b>Selected Node</b><span>INSPECTOR</span></div>
                  <div class="terrain-node-inspector" data-selected-node-inspector>
                    <div class="terrain-node-inspector-empty">No node selected</div>
                  </div>
                </section>
                <div class="terrain-side-resize" data-terrain-side-resize role="separator" tabindex="0" aria-label="Resize selected node and preview panels" aria-orientation="horizontal" aria-valuemin="96"></div>
                <section class="terrain-preview-pane">
                  <div class="terrain-preview-heading"><b>Preview</b><span id="terrain-graph-status" data-state="idle">Ready</span></div>
                  <div class="terrain-preview-modes" role="tablist" aria-label="Preview mode">
                    ${['height', 'materials', 'slope', 'moisture', 'erosion'].map((mode, index) => `<button type="button" role="tab" data-preview-mode="${mode}" aria-selected="${index === 0}">${mode[0].toUpperCase()}${mode.slice(1)}</button>`).join('')}
                  </div>
                  <div class="terrain-preview-canvas-wrap">
                    <canvas id="terrain-graph-preview" width="256" height="256" data-preview-enabled="true"></canvas>
                  </div>
                  <div class="terrain-preview-legend" data-terrain-preview-legend></div>
                </section>
              </aside>
            </div>
            <footer class="terrain-quick-add">
              <span>Quick Add</span>
              ${quickNodeTypes.map((type) => `<button type="button" data-node-type="${type}">${TERRAIN_NODE_DEFINITIONS[type].title}</button>`).join('')}
            </footer>
          </section>
        </main>
      </div>`;
    this.viewport = this.root.querySelector('#viewport');
    this.terrainGraphRoot = this.root.querySelector('#terrain-graph-dock');
    this.terrainGraphPreviewCanvas = this.root.querySelector('#terrain-graph-preview');
    this.terrainGraphStatus = this.root.querySelector('#terrain-graph-status');
    this.terrainGraphPreviewLegend = this.root.querySelector('[data-terrain-preview-legend]');
    this.root.querySelector('#shadow-map-size').value = String(this.environmentSettings.shadowMapSize ?? 8192);
    this.#updatePresetPresentation(presetId);
    this.#updateEnvironmentPresentation(this.environmentSettings.presetId ?? 'summer');
    const studioHost = this.root.querySelector('#material-pack-studio');
    this.materialStudio = new TerrainMaterialPackStudio(studioHost);
    this.materialStudio.on('search', (payload) => this.emit('material-studio-search', payload));
    this.materialStudio.on('save', (payload) => this.emit('material-studio-save', payload));
    this.materialStudio.on('save-apply', (payload) => this.emit('material-studio-save-apply', payload));
  }

  #number(id, label, value, step) {
    return `<label class="field"><span>${label}</span><input id="${id}" type="number" value="${value}" step="${step}"></label>`;
  }

  #range(id, label, value, min, max, step) {
    return `<label class="field range-field"><span>${label}<output data-output-for="${id}">${value}</output></span><input id="${id}" type="range" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  }

  #bind() {
    this.root.querySelectorAll('[data-action]:not([data-action="toggle-sidebar"])').forEach((button) => button.addEventListener('click', () => this.emit(button.dataset.action)));
    const shell = this.root.querySelector('.editor-shell');
    const sidebarToggle = this.root.querySelector('[data-action="toggle-sidebar"]');
    const sidebarRestore = this.root.querySelector('[data-sidebar-restore]');
    const setSidebarCollapsed = (collapsed) => {
      shell.classList.toggle('sidebar-collapsed', collapsed);
      sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
      sidebarRestore.setAttribute('aria-expanded', String(!collapsed));
      queueMicrotask(() => window.dispatchEvent(new Event('resize')));
    };
    sidebarToggle.addEventListener('click', () => setSidebarCollapsed(true));
    sidebarRestore.addEventListener('click', () => setSidebarCollapsed(false));
    this.root.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => {
      this.root.querySelectorAll('[data-tool]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      this.brushSettings.tool = button.dataset.tool;
      this.emit('tool-change', button.dataset.tool);
    }));

    for (const id of ['seed', 'amplitude', 'frequency', 'octaves', 'ridgeStrength', 'warpStrength', 'continentalStrength', 'terraceStrength', 'landRadius', 'coastWidth', 'coastIrregularity', 'oceanDepth']) {
      const input = this.root.querySelector(`#${id}`);
      input.addEventListener('input', () => {
        this.generatorSettings[id] = Number(input.value);
        this.#output(id, input.value);
        this.emit('generator-settings', { ...this.generatorSettings });
      });
    }
    const graphDock = this.root.querySelector('#terrain-graph-dock');
    graphDock.querySelectorAll('[data-preview-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        graphDock.querySelectorAll('[data-preview-mode]').forEach((item) => {
          item.setAttribute('aria-selected', String(item === button));
        });
        this.emit('terrain-preview-mode', button.dataset.previewMode);
      });
    });
    const collapseButton = graphDock.querySelector('[data-graph-collapse]');
    collapseButton.addEventListener('click', () => {
      const collapsed = graphDock.classList.toggle('collapsed');
      collapseButton.textContent = collapsed ? '⌃' : '⌄';
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
    });
    const resizeHandle = graphDock.querySelector('.terrain-graph-resize');
    resizeHandle.addEventListener('pointerdown', (event) => {
      if (graphDock.classList.contains('collapsed')) return;
      event.preventDefault();
      resizeHandle.setPointerCapture(event.pointerId);
      const startY = event.clientY;
      const startHeight = graphDock.getBoundingClientRect().height;
      const move = (moveEvent) => {
        const wrapHeight = graphDock.parentElement.clientHeight;
        const height = Math.max(280, Math.min(wrapHeight - 220, startHeight + startY - moveEvent.clientY));
        graphDock.style.setProperty('--terrain-graph-height', `${height}px`);
      };
      const finish = () => {
        resizeHandle.removeEventListener('pointermove', move);
        resizeHandle.removeEventListener('pointerup', finish);
        resizeHandle.removeEventListener('pointercancel', finish);
      };
      resizeHandle.addEventListener('pointermove', move);
      resizeHandle.addEventListener('pointerup', finish);
      resizeHandle.addEventListener('pointercancel', finish);
    });
    for (const [id, property] of [['brush-radius', 'radius'], ['brush-strength', 'strength'], ['brush-hardness', 'hardness']]) {
      const input = this.root.querySelector(`#${id}`);
      input.addEventListener('input', () => {
        this.brushSettings[property] = Number(input.value);
        this.#output(id, input.value);
        this.emit('brush-change', { property, value: this.brushSettings[property] });
      });
    }
    this.materialSettings.layers.forEach((layer, index) => {
      const strengthInput = this.root.querySelector(`#displacement-${index}`);
      const centerInput = this.root.querySelector(`#displacement-center-${index}`);
      const enabledInput = this.root.querySelector(`#displacement-layer-${index}`);
      strengthInput.addEventListener('input', () => {
        layer.strength = Number(strengthInput.value);
        this.#output(`displacement-${index}`, strengthInput.value);
        this.emit('material-settings', this.getMaterialSettings());
      });
      centerInput.addEventListener('input', () => {
        layer.displacementCenter = Number(centerInput.value);
        this.#output(`displacement-center-${index}`, centerInput.value);
        this.emit('material-settings', this.getMaterialSettings());
      });
      enabledInput.addEventListener('change', () => {
        layer.displacementEnabled = enabledInput.checked;
        this.emit('material-settings', this.getMaterialSettings());
      });
    });

    this.root.querySelector('#stream-radius').addEventListener('input', (event) => {
      this.streamingSettings.streamRadius = Number(event.target.value);
      this.#output('stream-radius', event.target.value);
      this.emit('streaming-settings', { ...this.streamingSettings });
    });
    this.root.querySelector('#show-chunk-bounds').addEventListener('change', (event) => {
      this.streamingSettings.showChunkBounds = event.target.checked;
      this.emit('streaming-settings', { ...this.streamingSettings });
    });
    this.root.querySelector('#freeze-streaming').addEventListener('change', (event) => {
      this.streamingSettings.freezeStreaming = event.target.checked;
      this.emit('streaming-settings', { ...this.streamingSettings });
    });
    this.root.querySelector('#quality-tier').addEventListener('change', (event) => this.emit('quality-change', event.target.value));
    this.root.querySelector('#environment-preset').addEventListener('change', (event) => { this.#updateEnvironmentPresentation(event.target.value); this.emit('load-environment-preset'); });
    for (const id of ['sun-azimuth','sun-elevation','sun-intensity','environment-exposure','environment-intensity','background-intensity','background-blur','hemi-intensity','fill-intensity','shadow-radius','shadow-bias','shadow-normal-bias','fog-density']) {
      this.root.querySelector(`#${id}`).addEventListener('input', (event) => {
        this.#output(id, event.target.value);
        this.emit('environment-settings', this.getEnvironmentSettings());
      });
    }
    this.root.querySelector('#sun-color').addEventListener('input', () => this.emit('environment-settings', this.getEnvironmentSettings()));
    this.root.querySelector('#shadow-map-size').addEventListener('change', () => this.emit('environment-settings', this.getEnvironmentSettings()));
    this.root.querySelector('#birds-enabled').addEventListener('change', () => this.emit('environment-settings', this.getEnvironmentSettings()));
    this.root.querySelector('#fog-enabled').addEventListener('change', () => this.emit('environment-settings', this.getEnvironmentSettings()));
    this.root.querySelector('#hdri-file').addEventListener('change', (event) => {
      const [file] = event.target.files;
      if (file) this.emit('hdri-file-selected', file);
      event.target.value = '';
    });
    this.root.querySelector('#material-pack-file').addEventListener('change', (event) => {
      const [file] = event.target.files;
      if (file) this.emit('material-pack-file-selected', file);
      event.target.value = '';
    });
    this.root.querySelector('#preset-select').addEventListener('change', (event) => {
      this.#updatePresetPresentation(event.target.value);
      this.setMaterialPackStatus('החבילה נבחרה לתצוגה בלבד — טרם הוחלה על הקרקע.', 'idle');
      this.emit('material-pack-selection', event.target.value);
    });
    this.root.querySelector('#displacement-enabled').addEventListener('change', () => this.emit('material-settings', this.getMaterialSettings()));
    this.root.querySelector('#displacement-mode').addEventListener('change', () => this.emit('material-settings', this.getMaterialSettings()));
    this.root.querySelector('#displacement-preview-enabled').addEventListener('change', () => this.emit('material-settings', this.getMaterialSettings()));
    this.root.querySelector('#parallax-enabled').addEventListener('change', () => this.emit('material-settings', this.getMaterialSettings()));
    for (const [id] of [['height-blend'], ['macro-variation'], ['detail-normal'], ['parallax-scale'], ['displacement-weight-threshold'], ['displacement-near'], ['displacement-far'], ['displacement-preview-radius']]) {
      this.root.querySelector(`#${id}`).addEventListener('input', (event) => {
        this.#output(id, event.target.value);
        this.emit('material-settings', this.getMaterialSettings());
      });
    }
    this.root.querySelector('#dynamic-ripples').addEventListener('change', () => this.emit('water-settings', this.getWaterSettings()));
    for (const id of ['water-floating-spheres', 'water-aquatic-life', 'water-underwater-optics']) {
      this.root.querySelector(`#${id}`).addEventListener('change', () => this.emit('water-settings', this.getWaterSettings()));
    }
    for (const id of [
      'water-wave-amplitude',
      'water-ripple-amplitude',
      'water-normal-strength',
      'water-refraction',
      'water-shore-fade',
      'water-foam',
      'water-curvature',
      'water-object-density',
      'water-fish-count',
      'water-seagrass-count',
      'water-coral-count',
      'water-optical-density',
    ]) {
      this.root.querySelector(`#${id}`).addEventListener('input', (event) => {
        this.#output(id, event.target.value);
        this.emit('water-settings', this.getWaterSettings());
      });
    }
    this.root.querySelector('[data-action="underwater-demo-view"]').addEventListener('click', () => this.emit('underwater-demo-view'));
    this.root.querySelector('#material-layer').addEventListener('change', (event) => { this.brushSettings.materialLayer = Number(event.target.value); });
    this.root.querySelector('#wireframe').addEventListener('change', (event) => this.emit('wireframe', event.target.checked));
    const exportFormat = this.root.querySelector('#terrain-export-format');
    const fbxPresetField = this.root.querySelector('[data-fbx-preset-field]');
    exportFormat.addEventListener('change', () => {
      fbxPresetField.hidden = exportFormat.value !== 'fbx';
    });
    this.root.querySelector('#project-file').addEventListener('change', (event) => {
      const [file] = event.target.files;
      if (file) this.emit('file-selected', file);
      event.target.value = '';
    });
  }

  #output(id, value) {
    const output = this.root.querySelector(`[data-output-for="${id}"]`);
    if (output) output.value = value;
  }

  #updatePresetPresentation(packId) {
    const pack = this.materialPacks.find((item) => item.id === packId) ?? BUILTIN_TERRAIN_MATERIAL_PACKS.mediterranean;
    this.root.querySelector('#preset-description').textContent = pack.description;
    const preview = this.root.querySelector('#material-swatches');
    if (Array.isArray(pack.layers) && pack.layers.length) {
      preview.innerHTML = pack.layers.map((layer, index) => `
        <article class="material-preview-card" title="${this.#escapeHtml(layer.label ?? layer.assetId ?? `Layer ${index + 1}`)}">
          <img src="${this.#escapeHtml(layer.thumbnail ?? '')}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">
          <div class="material-preview-placeholder" hidden><b>${this.#escapeHtml(layer.provider === 'ambientcg' ? 'ambientCG' : 'Poly Haven')}</b><small>${this.#escapeHtml(layer.assetId ?? '')}</small></div>
          <span>${this.#escapeHtml(layer.label ?? `Layer ${index + 1}`)}</span>
          <small>${this.#escapeHtml(layer.assetId ?? '')}${layer.meters ? ` · ${Number(layer.meters).toFixed(layer.meters < 10 ? 1 : 0)}m` : ''}</small>
          ${layer.assetId ? `<a href="${layer.provider === 'ambientcg' ? `https://ambientcg.com/view?id=${encodeURIComponent(layer.assetId)}` : `https://polyhaven.com/a/${encodeURIComponent(layer.assetId)}`}" target="_blank" rel="noopener">פתח ב־${layer.provider === 'ambientcg' ? 'ambientCG' : 'Poly Haven'}</a>` : ''}
        </article>`).join('');
      return;
    }
    preview.innerHTML = (pack.colors ?? []).map((color) => `<span class="material-color-fallback" style="--swatch:${color}"></span>`).join('');
  }

  #updateEnvironmentPresentation(id) {
    const preset = ENVIRONMENT_PRESETS[id] ?? ENVIRONMENT_PRESETS.summer;
    this.root.querySelector('#environment-description').textContent = preset.description;
  }

  getEnvironmentSettings() {
    return {
      ...this.environmentSettings,
      presetId: String(this.environmentSettings.presetId ?? '').startsWith('custom') ? this.environmentSettings.presetId : this.root.querySelector('#environment-preset').value,
      sunAzimuth: Number(this.root.querySelector('#sun-azimuth').value),
      sunElevation: Number(this.root.querySelector('#sun-elevation').value),
      sunIntensity: Number(this.root.querySelector('#sun-intensity').value),
      sunColor: this.root.querySelector('#sun-color').value,
      exposure: Number(this.root.querySelector('#environment-exposure').value),
      environmentIntensity: Number(this.root.querySelector('#environment-intensity').value),
      backgroundIntensity: Number(this.root.querySelector('#background-intensity').value),
      backgroundBlurriness: Number(this.root.querySelector('#background-blur').value),
      hemiIntensity: Number(this.root.querySelector('#hemi-intensity').value),
      fillIntensity: Number(this.root.querySelector('#fill-intensity').value),
      shadowRadius: Number(this.root.querySelector('#shadow-radius').value),
      shadowMapSize: Number(this.root.querySelector('#shadow-map-size').value),
      shadowBias: Number(this.root.querySelector('#shadow-bias').value),
      shadowNormalBias: Number(this.root.querySelector('#shadow-normal-bias').value),
      birdsEnabled: this.root.querySelector('#birds-enabled').checked,
      fogEnabled: this.root.querySelector('#fog-enabled').checked,
      fogDensity: Number(this.root.querySelector('#fog-density').value),
    };
  }

  getEnvironmentPreset() { return this.root.querySelector('#environment-preset').value; }
  getEnvironmentUrl() { return this.root.querySelector('#environment-url').value.trim(); }
  getSelectedAmbientHdri() { return this.root.querySelector('#ambient-hdri-select').value; }
  chooseHdriFile() { this.root.querySelector('#hdri-file').click(); }
  chooseMaterialPackFile() { this.root.querySelector('#material-pack-file').click(); }

  setAmbientHdriCatalog(items = []) {
    this.ambientHdriCatalog = Array.isArray(items) ? items.slice() : [];
    const select = this.root.querySelector('#ambient-hdri-select');
    if (!select) return;
    if (!this.ambientHdriCatalog.length) {
      select.innerHTML = '<option value="">לא נמצאו HDRI זמינים</option>';
      return;
    }
    select.innerHTML = this.ambientHdriCatalog.map((item) => '<option value="' + this.#escapeHtml(item.id) + '">' + this.#escapeHtml(item.label ?? item.id) + '</option>').join('');
  }

  openMaterialPackStudio(pack = null) {
    const host = this.root.querySelector('#material-pack-studio');
    host.hidden = false;
    this.materialStudio.setDraft(pack);
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  closeMaterialPackStudio() {
    this.root.querySelector('#material-pack-studio').hidden = true;
  }

  setMaterialStudioSearchResults(items) { this.materialStudio.setSearchResults(items); }
  setMaterialStudioStatus(message, state = 'idle') { this.materialStudio.setStatus(message, state); }

  setEnvironmentStatus(message, state = 'idle') {
    const element = this.root.querySelector('#environment-status');
    element.dataset.state = state;
    element.innerHTML = `<b>Environment</b><span>${this.#escapeHtml(message)}</span>`;
  }

  setMaterialPackStatus(message, state = 'idle') {
    const element = this.root.querySelector('#material-pack-status');
    element.dataset.state = state;
    element.innerHTML = `<b>Terrain Materials</b><span>${this.#escapeHtml(message)}</span>`;
  }

  setMaterialPacks(packs, selectedId = null) {
    this.materialPacks = packs.map((pack) => ({ ...pack }));
    const select = this.root.querySelector('#preset-select');
    select.innerHTML = this.materialPacks.map((pack) => `<option value="${this.#escapeHtml(pack.id)}">${this.#escapeHtml(pack.name)}${pack.source === 'imported' ? ' · Imported' : pack.source === 'custom' ? ' · Custom' : ''}</option>`).join('');
    if (selectedId && this.materialPacks.some((pack) => pack.id === selectedId)) select.value = selectedId;
    this.#updatePresetPresentation(select.value);
  }

  getMaterialSettings() {
    return {
      ...this.materialSettings,
      qualityTier: this.root.querySelector('#quality-tier').value,
      displacementEnabled: this.root.querySelector('#displacement-enabled').checked,
      displacementMode: this.root.querySelector('#displacement-mode').value,
      displacementWeightThreshold: Number(this.root.querySelector('#displacement-weight-threshold').value),
      displacementNear: Number(this.root.querySelector('#displacement-near').value),
      displacementFar: Number(this.root.querySelector('#displacement-far').value),
      displacementPreviewEnabled: this.root.querySelector('#displacement-preview-enabled').checked,
      displacementPreviewRadius: Number(this.root.querySelector('#displacement-preview-radius').value),
      parallaxEnabled: this.root.querySelector('#parallax-enabled').checked,
      heightBlendSharpness: Number(this.root.querySelector('#height-blend').value),
      macroVariation: Number(this.root.querySelector('#macro-variation').value),
      detailNormalStrength: Number(this.root.querySelector('#detail-normal').value),
      parallaxScale: Number(this.root.querySelector('#parallax-scale').value),
      layers: this.materialSettings.layers.map((layer) => ({ ...layer })),
    };
  }

  getWaterSettings() {
    return {
      ...this.waterSettings,
      dynamicRipples: this.root.querySelector('#dynamic-ripples').checked,
      waveAmplitude: Number(this.root.querySelector('#water-wave-amplitude').value),
      rippleAmplitude: Number(this.root.querySelector('#water-ripple-amplitude').value),
      normalStrength: Number(this.root.querySelector('#water-normal-strength').value),
      refractionStrength: Number(this.root.querySelector('#water-refraction').value),
      shoreFade: Number(this.root.querySelector('#water-shore-fade').value),
      foamStrength: Number(this.root.querySelector('#water-foam').value),
      horizonCurvature: Number(this.root.querySelector('#water-curvature').value),
      floatingSpheresEnabled: this.root.querySelector('#water-floating-spheres').checked,
      waterObjectDensity: Number(this.root.querySelector('#water-object-density').value),
      aquaticLifeEnabled: this.root.querySelector('#water-aquatic-life').checked,
      fishCount: Number(this.root.querySelector('#water-fish-count').value),
      seagrassCount: Number(this.root.querySelector('#water-seagrass-count').value),
      coralCount: Number(this.root.querySelector('#water-coral-count').value),
      underwaterOpticsEnabled: this.root.querySelector('#water-underwater-optics').checked,
      underwaterOpticalDensity: Number(this.root.querySelector('#water-optical-density').value),
    };
  }

  getPreset() { return this.root.querySelector('#preset-select').value; }
  getSelectedMaterialPack() { return this.root.querySelector('#preset-select').value; }
  getSpawnInput() { return { x: Number(this.root.querySelector('#spawn-x').value), z: Number(this.root.querySelector('#spawn-z').value) }; }
  getTerrainExportOptions() {
    return {
      format: this.root.querySelector('#terrain-export-format').value,
      detail: this.root.querySelector('#terrain-export-detail').value,
      fbxPreset: this.root.querySelector('#terrain-export-fbx-preset').value,
      vertexColors: this.root.querySelector('#terrain-export-vertex-colors').checked,
    };
  }
  on(name, callback) { const set = this.callbacks.get(name) ?? new Set(); set.add(callback); this.callbacks.set(name, set); }
  emit(name, payload) { for (const callback of this.callbacks.get(name) ?? []) callback(payload); }

  setSpawnPoint(point) {
    this.root.querySelector('#spawn-x').value = point.x.toFixed(2);
    this.root.querySelector('#spawn-z').value = point.z.toFixed(2);
    this.root.querySelector('#spawn-readout').textContent = `X ${point.x.toFixed(1)} · Y ${point.y.toFixed(1)} · Z ${point.z.toFixed(1)}`;
  }
  setSpawnSelection(active) {
    this.root.querySelector('#spawn-selection-banner').classList.toggle('visible', active);
    this.root.querySelector('[data-action="spawn-select"]').classList.toggle('active-selection', active);
  }
  setFpsMode(active) {
    this.root.querySelector('.editor-shell').classList.toggle('fps-active', active);
    this.root.querySelector('#fps-crosshair').classList.toggle('visible', active);
    this.root.querySelector('#fps-help').classList.toggle('visible', active);
    this.root.querySelector('#status-mode').textContent = active ? 'FPS MODE' : 'EDITOR';
    this.root.querySelector('[data-action="fps-toggle"]').textContent = active ? 'יציאה מ־FPS MODE' : 'הפעל FPS MODE';
  }
  setTerrainGraphStatus(message, state = 'idle') {
    if (!this.terrainGraphStatus) return;
    this.terrainGraphStatus.textContent = message;
    this.terrainGraphStatus.dataset.state = state;
  }
  setTerrainExportStatus(message, state = 'idle') {
    const status = this.root.querySelector('#terrain-export-status');
    if (!status) return;
    status.dataset.state = state;
    status.querySelector('span').textContent = message;
  }
  setBusy(active, label = 'טוען...') {
    const busy = this.root.querySelector('#busy');
    busy.querySelector('span:last-child').textContent = label;
    busy.classList.toggle('visible', active);
  }
  setHistoryState(canUndo, canRedo) {
    this.root.querySelector('[data-action="undo"]').disabled = !canUndo;
    this.root.querySelector('[data-action="redo"]').disabled = !canRedo;
  }
  setPreset(id) { this.root.querySelector('#preset-select').value = id; this.#updatePresetPresentation(id); }
  chooseProjectFile() { this.root.querySelector('#project-file').click(); }

  setKtx2Validation(report = null, state = 'idle') {
    const container = this.root.querySelector('#ktx2-validation');
    if (!container) return;
    container.dataset.state = state;
    if (state === 'loading') {
      container.innerHTML = '<b>KTX2 Validator</b><span>טוען ומאמת את ארבעת קובצי ה־Array...</span>';
      return;
    }
    if (state === 'error') {
      container.innerHTML = `<b>KTX2 validation נכשל</b><span>${this.#escapeHtml(report?.error ?? 'שגיאה לא ידועה')}</span>`;
      return;
    }
    if (!report?.valid) {
      container.innerHTML = '<b>KTX2 Validator</b><span>טרם נטענה חבילה.</span>';
      return;
    }
    const textureRows = report.textures.map((texture) => `<small>${this.#escapeHtml(texture.label)}: ${texture.width}×${texture.height} · ${texture.depth} layers · ${texture.mipLevels} mips</small>`).join('');
    const warnings = report.warnings?.length ? `<em>${report.warnings.map((warning) => this.#escapeHtml(warning)).join('<br>')}</em>` : '<i>כל הבדיקות עברו.</i>';
    container.innerHTML = `<b>${this.#escapeHtml(report.manifestName)}</b><span>${report.resolution}px · ${report.depth} layers · ${report.mipLevels}/${report.expectedMipLevels} mips</span>${textureRows}${warnings}`;
  }

  #escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  updateStatus({ fps, frameMs, position, rendererInfo, terrain, materials, water, environment }) {
    this.root.querySelector('#status-fps').textContent = `FPS: ${fps}`;
    this.root.querySelector('#status-frame').textContent = `Frame: ${frameMs.toFixed(1)} ms`;
    this.root.querySelector('#status-chunks').textContent = `Chunks: ${terrain.loadedChunks} / Q${terrain.queuedChunks}`;
    this.root.querySelector('#status-draws').textContent = `Draws: ${rendererInfo.calls} · Tri: ${(rendererInfo.triangles / 1000).toFixed(0)}K`;
    this.root.querySelector('#status-position').textContent = `X ${position.x.toFixed(0)} · Z ${position.z.toFixed(0)}`;
    this.root.querySelector('#diagnostics').innerHTML = `
      <div><span>Streaming Mode</span><b>${terrain.mode === 'editor' ? 'EDITOR · FULL WORLD' : 'FPS · DYNAMIC'}</b></div>
      <div><span>LOD</span><b>${terrain.lodCounts.join(' / ')}</b></div>
      <div><span>Terrain CPU</span><b>${terrain.terrainDataMb.toFixed(1)} MB</b></div>
      <div><span>Textures</span><b>${materials.source} · ${materials.actualResolution}px</b></div>
      <div><span>Material Pack</span><b>${this.#escapeHtml(materials.source)}</b></div>
      <div><span>Requested</span><b>${materials.requestedResolution}px</b></div>
      <div><span>MAX_TEXTURE_SIZE</span><b>${materials.maxTextureSize}</b></div>
      <div><span>Workers</span><b>${terrain.workerPool?.busy ?? 0}/${terrain.workerPool?.concurrency ?? 1} · Q${terrain.workerPool?.queued ?? 0}</b></div>
      <div><span>Last Chunk</span><b>${terrain.lastGenerationMs.toFixed(1)} ms</b></div>
      <div><span>Water RT</span><b>${water?.refractionWidth ?? 0}×${water?.refractionHeight ?? 0}</b></div>
      <div><span>Water Simulation</span><b>${water?.simulationResolution ?? 0}²</b></div>
      <div><span>Sky</span><b>${environment?.presetId ?? 'custom'} · ${environment?.hdriLoaded ? 'HDRI' : 'procedural'}</b></div>
      <div><span>Shadow</span><b>${environment?.shadowMapSize ?? 0}px · ${((environment?.shadowTexelMetres ?? 0) * 100).toFixed(2)}cm/texel</b></div>
      <div><span>Modified</span><b>${terrain.modifiedChunks}</b></div>`;
  }

  syncEnvironmentSettings(settings) {
    Object.assign(this.environmentSettings, settings);
    const preset = this.root.querySelector('#environment-preset');
    if (preset && ENVIRONMENT_PRESETS[settings.presetId]) preset.value = settings.presetId;
    const values = {
      'sun-azimuth': settings.sunAzimuth,
      'sun-elevation': settings.sunElevation,
      'sun-intensity': settings.sunIntensity,
      'environment-exposure': settings.exposure,
      'environment-intensity': settings.environmentIntensity,
      'background-intensity': settings.backgroundIntensity,
      'background-blur': settings.backgroundBlurriness,
      'hemi-intensity': settings.hemiIntensity,
      'fill-intensity': settings.fillIntensity,
      'shadow-radius': settings.shadowRadius,
      'shadow-bias': settings.shadowBias,
      'shadow-normal-bias': settings.shadowNormalBias,
      'fog-density': settings.fogDensity,
    };
    for (const [id, value] of Object.entries(values)) {
      const input = this.root.querySelector(`#${id}`);
      if (!input || value == null) continue;
      input.value = value;
      this.#output(id, value);
    }
    if (settings.sunColor) this.root.querySelector('#sun-color').value = settings.sunColor;
    if (settings.shadowMapSize) this.root.querySelector('#shadow-map-size').value = String(settings.shadowMapSize);
    this.root.querySelector('#birds-enabled').checked = settings.birdsEnabled ?? true;
    this.root.querySelector('#fog-enabled').checked = settings.fogEnabled ?? false;
    this.#updateEnvironmentPresentation(settings.presetId ?? 'summer');
  }

  syncGeneratorSettings(settings) {
    Object.assign(this.generatorSettings, settings);
    for (const [id, value] of Object.entries(settings)) {
      const input = this.root.querySelector(`#${id}`);
      if (!input) continue;
      input.value = value;
      this.#output(id, value);
    }
  }

  syncMaterialSettings(settings) {
    Object.assign(this.materialSettings, settings);
    this.root.querySelector('#quality-tier').value = settings.qualityTier;
    this.root.querySelector('#displacement-enabled').checked = settings.displacementEnabled;
    this.root.querySelector('#displacement-mode').value = settings.displacementMode ?? 'normal';
    this.root.querySelector('#displacement-preview-enabled').checked = settings.displacementPreviewEnabled ?? true;
    this.root.querySelector('#parallax-enabled').checked = settings.parallaxEnabled;
    for (const [id, value] of [['height-blend', settings.heightBlendSharpness], ['macro-variation', settings.macroVariation], ['detail-normal', settings.detailNormalStrength], ['parallax-scale', settings.parallaxScale], ['displacement-weight-threshold', settings.displacementWeightThreshold], ['displacement-near', settings.displacementNear], ['displacement-far', settings.displacementFar], ['displacement-preview-radius', settings.displacementPreviewRadius]]) {
      this.root.querySelector(`#${id}`).value = value;
      this.#output(id, value);
    }
    settings.layers?.forEach((layer, index) => {
      Object.assign(this.materialSettings.layers[index], layer);
      const input = this.root.querySelector(`#displacement-${index}`);
      input.value = layer.strength;
      this.#output(`displacement-${index}`, layer.strength);
      const enabledInput = this.root.querySelector(`#displacement-layer-${index}`);
      if (enabledInput) enabledInput.checked = layer.displacementEnabled ?? false;
      const centerInput = this.root.querySelector(`#displacement-center-${index}`);
      if (centerInput) {
        centerInput.value = layer.displacementCenter ?? 0.5;
        this.#output(`displacement-center-${index}`, layer.displacementCenter ?? 0.5);
      }
      const option = this.root.querySelector(`#material-layer option[value="${index}"]`);
      if (option) option.textContent = layer.label;
    });
  }

  syncWaterSettings(settings) {
    Object.assign(this.waterSettings, settings);
    this.root.querySelector('#dynamic-ripples').checked = settings.dynamicRipples;
    this.root.querySelector('#water-floating-spheres').checked = settings.floatingSpheresEnabled;
    this.root.querySelector('#water-aquatic-life').checked = settings.aquaticLifeEnabled;
    this.root.querySelector('#water-underwater-optics').checked = settings.underwaterOpticsEnabled;
    for (const [id, value] of [
      ['water-wave-amplitude', settings.waveAmplitude],
      ['water-ripple-amplitude', settings.rippleAmplitude],
      ['water-normal-strength', settings.normalStrength],
      ['water-refraction', settings.refractionStrength],
      ['water-shore-fade', settings.shoreFade],
      ['water-foam', settings.foamStrength],
      ['water-curvature', settings.horizonCurvature],
      ['water-object-density', settings.waterObjectDensity],
      ['water-fish-count', settings.fishCount],
      ['water-seagrass-count', settings.seagrassCount],
      ['water-coral-count', settings.coralCount],
      ['water-optical-density', settings.underwaterOpticalDensity],
    ]) {
      this.root.querySelector(`#${id}`).value = value;
      this.#output(id, value);
    }
  }

  syncStreamingSettings(settings) {
    Object.assign(this.streamingSettings, settings);
    this.root.querySelector('#stream-radius').value = settings.streamRadius;
    this.#output('stream-radius', settings.streamRadius);
    this.root.querySelector('#show-chunk-bounds').checked = settings.showChunkBounds;
    this.root.querySelector('#freeze-streaming').checked = settings.freezeStreaming;
  }

  toast(message, type = 'success') {
    const toast = this.root.querySelector('#toast');
    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }
}
