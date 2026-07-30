const DEFAULT_DISTRIBUTION = Object.freeze({
  minHeight: -48,
  maxHeight: 220,
  heightBlend: 18,
  minSlope: 0,
  maxSlope: 72,
  slopeBlend: 12,
  curvatureBias: 0,
  moistureAffinity: 0,
  coastAffinity: 0,
  erosionAffinity: 0,
  priority: 1,
});

function cloneLayer(layer = {}, index = 0) {
  const meters = Number(layer.meters ?? (index === 3 ? 5.5 : 4));
  return {
    id: String(layer.id ?? ['sand', 'grass', 'soil', 'rock'][index] ?? `layer-${index + 1}`),
    label: String(layer.label ?? `Layer ${index + 1}`),
    provider: layer.provider === 'ambientcg' ? 'ambientcg' : 'polyhaven',
    assetId: String(layer.assetId ?? ''),
    thumbnail: String(layer.thumbnail ?? ''),
    meters,
    scale: Number(layer.scale ?? 1 / Math.max(meters, 0.1)),
    strength: Number(layer.strength ?? (index === 3 ? 0.45 : 0.12)),
    displacementEnabled: layer.displacementEnabled ?? index === 3,
    displacementCenter: Number(layer.displacementCenter ?? 0.5),
    roughness: Number(layer.roughness ?? 0.9),
    metalness: Number(layer.metalness ?? 0),
    distribution: { ...DEFAULT_DISTRIBUTION, ...(layer.distribution ?? {}) },
  };
}

export function createMaterialPackDraft(pack = null) {
  const sourceLayers = pack?.layers ?? [];
  return {
    id: String(pack?.source === 'custom' ? pack.id : ''),
    name: String(pack?.name ? `${pack.name}${pack.source === 'custom' ? '' : ' · Custom'}` : 'Terrain Material Pack חדש'),
    description: String(pack?.description ?? 'חבילת Terrain מותאמת אישית.'),
    source: 'custom',
    provider: 'Mixed',
    derivedFrom: pack?.id ?? null,
    splatPreset: 'custom',
    transitionNoise: Number(pack?.transitionNoise ?? 0.22),
    globalBlend: Number(pack?.globalBlend ?? 1),
    layers: Array.from({ length: 4 }, (_, index) => cloneLayer(sourceLayers[index], index)),
  };
}

export class TerrainMaterialPackStudio {
  constructor(container) {
    this.container = container;
    this.callbacks = new Map();
    this.activeLayer = 0;
    this.draft = createMaterialPackDraft();
    this.#render();
    this.#bind();
    this.#syncAll();
  }

  on(name, callback) {
    const set = this.callbacks.get(name) ?? new Set();
    set.add(callback);
    this.callbacks.set(name, set);
  }

  emit(name, payload) {
    for (const callback of this.callbacks.get(name) ?? []) callback(payload);
  }

  setDraft(pack) {
    this.draft = createMaterialPackDraft(pack);
    this.activeLayer = 0;
    this.#syncAll();
  }

  getDraft() {
    this.#readPackFields();
    this.#readLayerFields();
    return structuredClone(this.draft);
  }

  setSearchResults(items = []) {
    const results = this.container.querySelector('[data-studio-results]');
    if (!items.length) {
      results.innerHTML = '<p class="hint">לא נמצאו חומרים.</p>';
      return;
    }
    results.innerHTML = items.map((item) => `
      <button type="button" class="studio-asset-result" data-provider="${this.#escape(item.provider)}" data-id="${this.#escape(item.id)}" data-label="${this.#escape(item.label ?? item.id)}" data-preview="${this.#escape(item.preview ?? '')}">
        ${item.preview ? `<img src="${this.#escape(item.preview)}" alt="" loading="lazy">` : '<span class="asset-placeholder">PBR</span>'}
        <span><b>${this.#escape(item.label ?? item.id)}</b><small>${this.#escape(item.provider)} · ${this.#escape(item.id)}</small></span>
      </button>`).join('');
  }

  setStatus(message, state = 'idle') {
    const status = this.container.querySelector('[data-studio-status]');
    status.dataset.state = state;
    status.textContent = message;
  }

  #render() {
    this.container.innerHTML = `
      <div class="material-studio-head">
        <b>Terrain Material Pack Studio</b>
        <button type="button" class="ghost" data-studio-action="new">חבילה חדשה</button>
      </div>
      <label class="field"><span>שם החבילה</span><input data-pack-field="name" type="text"></label>
      <label class="field"><span>תיאור</span><textarea data-pack-field="description" rows="2"></textarea></label>
      <div class="coordinate-grid">
        <label class="field"><span>עוצמת Blend כללית</span><input data-pack-field="globalBlend" type="number" min="0.1" max="3" step="0.05"></label>
        <label class="field"><span>רעש מעבר</span><input data-pack-field="transitionNoise" type="number" min="0" max="1" step="0.01"></label>
      </div>
      <label class="field"><span>שכבה לעריכה</span><select data-studio-layer>${[0,1,2,3].map((i) => `<option value="${i}">שכבה ${i + 1}</option>`).join('')}</select></label>
      <div class="studio-layer-card">
        <div class="coordinate-grid">
          <label class="field"><span>שם שכבה</span><input data-layer-field="label" type="text"></label>
          <label class="field"><span>ספק</span><select data-layer-field="provider"><option value="ambientcg">ambientCG</option><option value="polyhaven">Poly Haven</option></select></label>
        </div>
        <label class="field"><span>Asset ID</span><input data-layer-field="assetId" type="text" placeholder="Ground054 / rocky_terrain"></label>
        <label class="toggle"><input data-layer-field="displacementEnabled" type="checkbox"><span>השכבה מזיזה גיאומטריה אמיתית</span></label>
        <div class="coordinate-grid">
          <label class="field"><span>גודל פיזי במטרים</span><input data-layer-field="meters" type="number" min="0.2" max="200" step="0.1"></label>
          <label class="field"><span>True Displacement במטרים</span><input data-layer-field="strength" type="number" min="0" max="2.5" step="0.01"></label>
          <label class="field"><span>Height Center / Zero</span><input data-layer-field="displacementCenter" type="number" min="0" max="1" step="0.01"></label>
          <label class="field"><span>Roughness</span><input data-layer-field="roughness" type="number" min="0" max="1" step="0.01"></label>
          <label class="field"><span>Metalness</span><input data-layer-field="metalness" type="number" min="0" max="1" step="0.01"></label>
        </div>
        <h4>פיזור טופוגרפי</h4>
        <div class="coordinate-grid studio-distribution-grid">
          ${this.#numberField('minHeight', 'גובה מינימלי', -48, 1)}
          ${this.#numberField('maxHeight', 'גובה מקסימלי', 220, 1)}
          ${this.#numberField('heightBlend', 'רוחב Blend בגובה', 18, 1)}
          ${this.#numberField('minSlope', 'שיפוע מינימלי', 0, 1)}
          ${this.#numberField('maxSlope', 'שיפוע מקסימלי', 72, 1)}
          ${this.#numberField('slopeBlend', 'רוחב Blend בשיפוע', 12, 1)}
          ${this.#numberField('curvatureBias', 'קימור: שקע ← → רכס', 0, 0.05, -1, 1)}
          ${this.#numberField('moistureAffinity', 'זיקה ללחות', 0, 0.05, -1, 1)}
          ${this.#numberField('coastAffinity', 'זיקה לחוף', 0, 0.05, -1, 1)}
          ${this.#numberField('erosionAffinity', 'זיקה לשחיקה', 0, 0.05, -1, 1)}
          ${this.#numberField('priority', 'עדיפות שכבה', 1, 0.05, 0.05, 4)}
        </div>
      </div>
      <div class="studio-search">
        <div class="coordinate-grid">
          <label class="field"><span>חיפוש חומר</span><input data-studio-search type="search" placeholder="grass, rock, sand..."></label>
          <label class="field"><span>ספק חיפוש</span><select data-studio-provider><option value="ambientcg">ambientCG</option><option value="polyhaven">Poly Haven</option></select></label>
        </div>
        <button type="button" class="secondary full" data-studio-action="search">חפש בחומרים המקושרים</button>
        <div class="studio-search-results" data-studio-results><p class="hint">חפש חומר ובחר אותו לשכבה הפעילה.</p></div>
      </div>
      <div class="action-row">
        <button type="button" class="secondary" data-studio-action="save">שמור חבילה</button>
        <button type="button" class="primary" data-studio-action="save-apply">שמור והחל</button>
      </div>
      <div class="ktx2-validation" data-studio-status data-state="idle">עריכת חבילה אינה משנה את העולם עד לשמירה והחלה.</div>`;
  }

  #numberField(name, label, value, step = 1, min = -500, max = 500) {
    return `<label class="field"><span>${label}</span><input data-distribution-field="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  }

  #bind() {
    this.container.querySelector('[data-studio-layer]').addEventListener('change', (event) => {
      this.#readLayerFields();
      this.activeLayer = Number(event.target.value);
      this.#syncLayer();
    });
    this.container.addEventListener('click', (event) => {
      const action = event.target.closest('[data-studio-action]')?.dataset.studioAction;
      if (action === 'new') this.setDraft(null);
      else if (action === 'search') this.emit('search', {
        provider: this.container.querySelector('[data-studio-provider]').value,
        query: this.container.querySelector('[data-studio-search]').value.trim(),
      });
      else if (action === 'save') this.emit('save', this.getDraft());
      else if (action === 'save-apply') this.emit('save-apply', this.getDraft());

      const result = event.target.closest('.studio-asset-result');
      if (result) {
        const layer = this.draft.layers[this.activeLayer];
        layer.provider = result.dataset.provider;
        layer.assetId = result.dataset.id;
        layer.label = result.dataset.label;
        layer.thumbnail = result.dataset.preview;
        this.#syncLayer();
        this.setStatus(`${layer.label} נבחר לשכבה ${this.activeLayer + 1}.`, 'success');
      }
    });
  }

  #readPackFields() {
    this.draft.name = this.container.querySelector('[data-pack-field="name"]').value.trim() || 'Terrain Material Pack';
    this.draft.description = this.container.querySelector('[data-pack-field="description"]').value.trim();
    this.draft.globalBlend = Number(this.container.querySelector('[data-pack-field="globalBlend"]').value || 1);
    this.draft.transitionNoise = Number(this.container.querySelector('[data-pack-field="transitionNoise"]').value || 0);
  }

  #readLayerFields() {
    const layer = this.draft.layers[this.activeLayer];
    if (!layer) return;
    for (const field of this.container.querySelectorAll('[data-layer-field]')) {
      const key = field.dataset.layerField;
      layer[key] = field.type === 'number' ? Number(field.value) : field.type === 'checkbox' ? field.checked : field.value;
    }
    layer.meters = Math.max(0.1, Number(layer.meters || 1));
    layer.scale = 1 / layer.meters;
    for (const field of this.container.querySelectorAll('[data-distribution-field]')) {
      layer.distribution[field.dataset.distributionField] = Number(field.value);
    }
  }

  #syncAll() {
    this.container.querySelector('[data-pack-field="name"]').value = this.draft.name;
    this.container.querySelector('[data-pack-field="description"]').value = this.draft.description;
    this.container.querySelector('[data-pack-field="globalBlend"]').value = this.draft.globalBlend;
    this.container.querySelector('[data-pack-field="transitionNoise"]').value = this.draft.transitionNoise;
    this.container.querySelector('[data-studio-layer]').value = String(this.activeLayer);
    this.#syncLayer();
  }

  #syncLayer() {
    const layer = this.draft.layers[this.activeLayer];
    for (const field of this.container.querySelectorAll('[data-layer-field]')) {
      const value = layer[field.dataset.layerField];
      if (field.type === 'checkbox') field.checked = Boolean(value);
      else field.value = value ?? '';
    }
    for (const field of this.container.querySelectorAll('[data-distribution-field]')) {
      field.value = layer.distribution[field.dataset.distributionField] ?? 0;
    }
  }

  #escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
}
