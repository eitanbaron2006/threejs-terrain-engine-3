import {
  TERRAIN_GRAPH_VERSION,
  TERRAIN_NODE_DEFINITIONS,
  cloneTerrainGraph,
  validateTerrainGraph,
} from '../terrain/TerrainGraphModel.js';

const CATEGORY_COLORS = Object.freeze({
  Sources: ['#263a43', '#4aa8c7'],
  Noise: ['#273b31', '#57bd7c'],
  Transform: ['#3c3527', '#d3a54d'],
  Combine: ['#352f45', '#9b7fc7'],
  Shape: ['#49342c', '#d9825b'],
  Output: ['#263d3a', '#4fd4bd'],
});

const PROPERTY_STEPS = Object.freeze({
  seed: 1,
  octaves: 1,
  steps: 1,
  frequency: 0.00001,
  persistence: 0.01,
  lacunarity: 0.01,
  gain: 0.01,
  bias: 0.01,
  strength: 0.01,
  value: 0.01,
  scale: 0.01,
  coastIrregularity: 0.01,
});

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function rebuildTerrainGraphModel(liteGraph, view = { scale: 1, offset: [0, 0] }) {
  const nodes = (liteGraph?._nodes ?? []).map((node) => ({
    id: node.id,
    type: node.type,
    role: node._terrainRole ?? null,
    position: [Number(node.pos?.[0] ?? 0), Number(node.pos?.[1] ?? 0)],
    properties: clone(node.properties ?? {}),
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const links = Object.values(liteGraph?.links ?? {}).filter(Boolean).map((link) => {
    const origin = nodesById.get(link.origin_id);
    const target = nodesById.get(link.target_id);
    const originDefinition = TERRAIN_NODE_DEFINITIONS[origin?.type];
    const targetDefinition = TERRAIN_NODE_DEFINITIONS[target?.type];
    return {
      id: Number(link.id),
      fromNode: link.origin_id,
      fromSocket: originDefinition?.outputs?.[link.origin_slot]?.name,
      toNode: link.target_id,
      toSocket: targetDefinition?.inputs?.[link.target_slot]?.name,
    };
  });
  const nodeIds = nodes.map((node) => Number(node.id)).filter(Number.isFinite);
  const linkIds = links.map((link) => Number(link.id)).filter(Number.isFinite);
  return {
    version: TERRAIN_GRAPH_VERSION,
    nextNodeId: Math.max(0, ...nodeIds) + 1,
    nextLinkId: Math.max(0, ...linkIds) + 1,
    nodes,
    links,
    view: {
      scale: Number(view?.scale ?? 1),
      offset: [Number(view?.offset?.[0] ?? 0), Number(view?.offset?.[1] ?? 0)],
    },
  };
}

export function registerTerrainNodeTypes(LiteGraph) {
  if (LiteGraph.__terrainNodeTypesRegistered) return;
  for (const [type, definition] of Object.entries(TERRAIN_NODE_DEFINITIONS)) {
    function TerrainGraphNode() {
      this.properties = clone(definition.defaults);
      for (const input of definition.inputs) this.addInput(input.label, input.type);
      for (const socket of definition.outputs) this.addOutput(socket.label, socket.type);
      for (const [name, defaultValue] of Object.entries(definition.defaults)) {
        if (typeof defaultValue === 'boolean') {
          this.addWidget('toggle', name, defaultValue, (value) => {
            this.properties[name] = Boolean(value);
            this.graph?._terrainEditor?._scheduleCommit();
          });
          continue;
        }
        if (typeof defaultValue === 'number') {
          this.addWidget('number', name, defaultValue, (value) => {
            this.properties[name] = Number(value);
            this.graph?._terrainEditor?._scheduleCommit();
          }, {
            step: PROPERTY_STEPS[name] ?? (Math.abs(defaultValue) < 0.01 ? 0.00001 : 0.1),
            precision: Math.abs(defaultValue) < 0.01 ? 5 : 3,
          });
        }
      }
      const [background, accent] = CATEGORY_COLORS[definition.category] ?? CATEGORY_COLORS.Transform;
      this.color = background;
      this.bgcolor = '#151b1f';
      this.boxcolor = accent;
      this.size = this.computeSize();
    }
    TerrainGraphNode.title = definition.title;
    TerrainGraphNode.desc = `${definition.category} terrain node`;
    TerrainGraphNode.prototype.onPropertyChanged = function onPropertyChanged(name, value) {
      this.properties[name] = value;
      const widget = this.widgets?.find((candidate) => candidate.name === name);
      if (widget) widget.value = value;
      this.graph?._terrainEditor?._scheduleCommit();
    };
    LiteGraph.registerNodeType(type, TerrainGraphNode);
  }
  LiteGraph.link_type_colors ??= {};
  LiteGraph.link_type_colors.coordinate = '#4aa8c7';
  LiteGraph.link_type_colors.field = '#66c784';
  LiteGraph.link_type_colors.terrain = '#4fd4bd';
  LiteGraph.__terrainNodeTypesRegistered = true;
}

export function installReadableNodeRendering(graphCanvas, qualityScale = 0.601) {
  if (!graphCanvas || graphCanvas.__terrainReadableZoomInstalled) return;
  const drawNode = graphCanvas.drawNode;
  graphCanvas.drawNode = function drawReadableTerrainNode(...args) {
    const actualScale = this.ds.scale;
    if (actualScale >= qualityScale) return drawNode.apply(this, args);
    this.ds.scale = qualityScale;
    try {
      return drawNode.apply(this, args);
    } finally {
      this.ds.scale = actualScale;
    }
  };
  graphCanvas.__terrainReadableZoomInstalled = true;
}

export function installPointerCenteredZoom(graphCanvas) {
  if (!graphCanvas?.canvas || graphCanvas.__terrainPointerZoomInstalled) return;
  const canvas = graphCanvas.canvas;
  const previousHandler = graphCanvas._mousewheel_callback;
  canvas.removeEventListener('mousewheel', previousHandler);
  canvas.removeEventListener('DOMMouseScroll', previousHandler);

  const pointerZoomHandler = (event) => {
    if (!graphCanvas.graph || !graphCanvas.allow_dragcanvas) return;
    const delta = event.wheelDeltaY ?? (-event.deltaY || event.detail * -60);
    if (!delta) return;
    const rect = canvas.getBoundingClientRect();
    const center = [
      event.clientX - rect.left,
      event.clientY - rect.top,
    ];
    const scale = graphCanvas.ds.scale * (delta > 0 ? 1.1 : 1 / 1.1);
    graphCanvas.ds.changeScale(scale, center);
    graphCanvas.graph.change();
    event.preventDefault();
    event.stopPropagation?.();
  };

  graphCanvas._mousewheel_callback = pointerZoomHandler;
  canvas.addEventListener('mousewheel', pointerZoomHandler, false);
  canvas.addEventListener('DOMMouseScroll', pointerZoomHandler, false);
  graphCanvas.__terrainPointerZoomInstalled = true;
}

export function installTerrainNumberPrompt(graphCanvas) {
  if (!graphCanvas?.prompt || graphCanvas.__terrainNumberPromptInstalled) return;
  const originalPrompt = graphCanvas.prompt;
  graphCanvas.prompt = function terrainPrompt(title, value, callback, event, multiline) {
    const dialog = originalPrompt.call(this, title, value, callback, event, multiline);
    const input = dialog?.querySelector?.('.value');
    const numericValue = Number(value);
    if (multiline || !input || !Number.isFinite(numericValue)) return dialog;

    const widgetStep = Number(this.node_widget?.[1]?.options?.step);
    const inferredStep = Number.isInteger(numericValue)
      ? 1
      : Math.abs(numericValue) < 0.01 ? 0.00001 : 0.01;
    input.type = 'number';
    input.step = String(Number.isFinite(widgetStep) && widgetStep > 0 ? widgetStep : inferredStep);
    input.inputMode = 'decimal';
    dialog.classList.add('terrain-number-dialog');
    dialog.style.transform = 'none';

    const keepInsideCanvas = () => {
      const parent = dialog.parentElement;
      if (!parent) return;
      const padding = 8;
      const left = Number.parseFloat(dialog.style.left) || padding;
      const top = Number.parseFloat(dialog.style.top) || padding;
      const width = dialog.offsetWidth || 236;
      const height = dialog.offsetHeight || 96;
      dialog.style.left = `${Math.max(padding, Math.min(left, parent.clientWidth - width - padding))}px`;
      dialog.style.top = `${Math.max(padding, Math.min(top, parent.clientHeight - height - padding))}px`;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(keepInsideCanvas);
    else keepInsideCanvas();
    return dialog;
  };
  graphCanvas.__terrainNumberPromptInstalled = true;
}

export function calculateTerrainSideSplit(pointerY, paneTop, paneHeight, minimumPanelHeight = 96, handleHeight = 7) {
  const maximumSelectedHeight = Math.max(
    minimumPanelHeight,
    Number(paneHeight) - minimumPanelHeight - handleHeight,
  );
  return Math.round(Math.max(
    minimumPanelHeight,
    Math.min(Number(pointerY) - Number(paneTop), maximumSelectedHeight),
  ));
}

export function calculateTerrainInspectorWidth(
  pointerX,
  bodyLeft,
  bodyWidth,
  paletteWidth = 176,
  minimumWidth = 220,
  minimumCanvasWidth = 320,
  handleWidth = 7,
) {
  const maximumWidth = Math.max(
    minimumWidth,
    Number(bodyWidth) - paletteWidth - minimumCanvasWidth - handleWidth,
  );
  return Math.round(Math.max(
    minimumWidth,
    Math.min(Number(bodyLeft) + Number(bodyWidth) - Number(pointerX), maximumWidth),
  ));
}

export function setTerrainSidePanelVisibility(root, {
  previewEnabled = true,
  inspectorEnabled = true,
} = {}) {
  if (!root) return;
  root.classList.toggle('preview-disabled', !previewEnabled);
  root.classList.toggle('inspector-disabled', !inspectorEnabled);
  root.classList.toggle('side-tools-disabled', !previewEnabled && !inspectorEnabled);
  const previewPane = root.querySelector?.('.terrain-preview-pane');
  const inspectorPane = root.querySelector?.('.terrain-selected-node-pane');
  const resizeHandle = root.querySelector?.('[data-terrain-side-resize]');
  const widthResizeHandle = root.querySelector?.('[data-terrain-inspector-resize]');
  if (previewPane) previewPane.hidden = !previewEnabled;
  if (inspectorPane) inspectorPane.hidden = !inspectorEnabled;
  if (resizeHandle) resizeHandle.hidden = !previewEnabled || !inspectorEnabled;
  if (widthResizeHandle) widthResizeHandle.hidden = !previewEnabled && !inspectorEnabled;
}

export function buildTerrainNodeInspectorModel(node) {
  const definition = TERRAIN_NODE_DEFINITIONS[node?.type];
  if (!node || !definition) return null;
  return {
    id: node.id,
    title: definition.title,
    category: definition.category,
    accent: (CATEGORY_COLORS[definition.category] ?? CATEGORY_COLORS.Transform)[1],
    fields: Object.entries(node.properties ?? {}).map(([name, value]) => ({
      name,
      label: name
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (character) => character.toUpperCase()),
      value,
      type: typeof value === 'boolean' ? 'boolean' : typeof value,
      step: typeof value === 'number'
        ? PROPERTY_STEPS[name] ?? (Math.abs(value) < 0.01 ? 0.00001 : 0.1)
        : null,
    })),
  };
}

export function applyTerrainNodeProperty(node, name, rawValue) {
  if (!node?.properties || !Object.hasOwn(node.properties, name)) return undefined;
  const previousValue = node.properties[name];
  let value = rawValue;
  if (typeof previousValue === 'boolean') value = Boolean(rawValue);
  if (typeof previousValue === 'number') {
    value = Number(rawValue);
    if (!Number.isFinite(value)) return previousValue;
    if (PROPERTY_STEPS[name] === 1) value = Math.round(value);
  }
  if (typeof node.onPropertyChanged === 'function') node.onPropertyChanged(name, value);
  else node.properties[name] = value;
  const widget = node.widgets?.find((candidate) => candidate.name === name);
  if (widget) widget.value = value;
  return value;
}

export class TerrainGraphEditor {
  constructor({
    root,
    graph,
    onGraphChange = () => {},
    onBuild = () => {},
    onPreviewToggle = () => {},
    onStatus = () => {},
  }) {
    this.root = root;
    this.model = cloneTerrainGraph(graph);
    this.onGraphChange = onGraphChange;
    this.onBuild = onBuild;
    this.onPreviewToggle = onPreviewToggle;
    this.onStatus = onStatus;
    this.history = [cloneTerrainGraph(graph)];
    this.historyIndex = 0;
    this.suppressChanges = false;
    this.commitQueued = false;
    this.LiteGraph = globalThis.LiteGraph;
    const LGraph = globalThis.LGraph;
    const LGraphCanvas = globalThis.LGraphCanvas;
    if (!this.LiteGraph || !LGraph || !LGraphCanvas) throw new Error('LiteGraph.js failed to load.');

    registerTerrainNodeTypes(this.LiteGraph);
    this.canvasElement = root.querySelector('canvas');
    this.graph = new LGraph();
    this.graph._terrainEditor = this;
    this.canvas = new LGraphCanvas(this.canvasElement, this.graph);
    this.canvas.background_image = null;
    this.canvas.render_canvas_border = false;
    this.canvas.connections_width = 3;
    this.canvas.default_link_color = '#6a7e89';
    this.canvas.highquality_render = true;
    this.canvas.ds.min_scale = 0.22;
    installReadableNodeRendering(this.canvas);
    installPointerCenteredZoom(this.canvas);
    installTerrainNumberPrompt(this.canvas);
    this.inspectorElement = this.root.querySelector('[data-selected-node-inspector]');
    this.selectedNode = null;
    this.sidePanelResizeCleanup = null;
    this.inspectorWidthResizeCleanup = null;
    this.#bindGraphEvents();
    this.#bindControls();
    this.setGraph(graph, { recordHistory: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvasElement.parentElement);
    this.resize();
  }

  #bindGraphEvents() {
    this.graph.onNodeAdded = () => this._scheduleCommit();
    this.graph.onNodeRemoved = (node) => {
      if (this.selectedNode === node) this.#renderSelectedNode(null);
      this._scheduleCommit();
    };
    this.graph.onConnectionChange = () => this._scheduleCommit();
    this.graph.onAfterChange = () => this._scheduleCommit();
    this.canvas.onNodeMoved = () => this._scheduleCommit();
    this.canvas.onSelectionChange = (selectedNodes) => {
      const nodes = Object.values(selectedNodes ?? {});
      this.#renderSelectedNode(nodes.at(-1) ?? null);
    };
  }

  #bindControls() {
    this.root.querySelectorAll('[data-node-type]').forEach((element) => {
      element.draggable = true;
      element.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('application/x-terrain-node', element.dataset.nodeType);
        event.dataTransfer.effectAllowed = 'copy';
      });
      element.addEventListener('click', () => this.addNode(element.dataset.nodeType));
    });
    this.canvasElement.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    this.canvasElement.addEventListener('drop', (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/x-terrain-node');
      if (!TERRAIN_NODE_DEFINITIONS[type]) return;
      const position = this.canvas.convertEventToCanvasOffset(event);
      this.addNode(type, position);
    });
    this.root.querySelector('[data-graph-action="undo"]')?.addEventListener('click', () => this.undo());
    this.root.querySelector('[data-graph-action="redo"]')?.addEventListener('click', () => this.redo());
    this.root.querySelector('[data-graph-action="fit"]')?.addEventListener('click', () => this.fitView());
    this.root.querySelector('[data-graph-action="build"]')?.addEventListener('click', () => this.onBuild(this.getGraph()));
    const previewToggle = this.root.querySelector('[data-graph-action="preview"]');
    const inspectorToggle = this.root.querySelector('[data-graph-action="inspector"]');
    const updateSidePanels = () => {
      setTerrainSidePanelVisibility(this.root, {
        previewEnabled: previewToggle?.checked ?? true,
        inspectorEnabled: inspectorToggle?.checked ?? true,
      });
      queueMicrotask(() => this.resize());
    };
    updateSidePanels();
    previewToggle?.addEventListener('change', (event) => {
      updateSidePanels();
      this.onPreviewToggle(event.target.checked);
    });
    inspectorToggle?.addEventListener('change', updateSidePanels);
    this.#bindSidePanelResizer();
    this.#bindInspectorWidthResizer();
    this.inspectorElement?.addEventListener('change', (event) => {
      const input = event.target.closest?.('[data-node-property]');
      if (!input || !this.selectedNode) return;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      applyTerrainNodeProperty(this.selectedNode, input.dataset.nodeProperty, value);
      this.canvas.setDirty(true, true);
      this.#renderSelectedNode(this.selectedNode);
    });
    this.root.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.redo();
      }
    });
  }

  #bindSidePanelResizer() {
    const handle = this.root.querySelector('[data-terrain-side-resize]');
    const sidePane = this.root.querySelector('.terrain-inspector-pane');
    const selectedPane = this.root.querySelector('.terrain-selected-node-pane');
    if (!handle || !sidePane || !selectedPane) return;
    const view = this.root.ownerDocument?.defaultView ?? globalThis.window;
    let dragging = false;

    const applySplit = (clientY) => {
      const rect = sidePane.getBoundingClientRect();
      const selectedHeight = calculateTerrainSideSplit(clientY, rect.top, rect.height);
      sidePane.style.setProperty('--terrain-selected-height', `${selectedHeight}px`);
      handle.setAttribute('aria-valuenow', String(selectedHeight));
    };
    const stopDragging = () => {
      if (!dragging) return;
      dragging = false;
      this.root.classList.remove('resizing-side-panels');
      view?.removeEventListener('pointermove', onPointerMove);
      view?.removeEventListener('pointerup', stopDragging);
      view?.removeEventListener('pointercancel', stopDragging);
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      event.preventDefault();
      applySplit(event.clientY);
    };
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      this.root.classList.add('resizing-side-panels');
      view?.addEventListener('pointermove', onPointerMove);
      view?.addEventListener('pointerup', stopDragging);
      view?.addEventListener('pointercancel', stopDragging);
      event.preventDefault();
    };
    const onKeyDown = (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const rect = sidePane.getBoundingClientRect();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      applySplit(rect.top + selectedPane.getBoundingClientRect().height + direction * 16);
      event.preventDefault();
    };
    const resetSplit = () => {
      sidePane.style.setProperty('--terrain-selected-height', '52%');
      handle.removeAttribute('aria-valuenow');
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('keydown', onKeyDown);
    handle.addEventListener('dblclick', resetSplit);
    this.sidePanelResizeCleanup = () => {
      stopDragging();
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('keydown', onKeyDown);
      handle.removeEventListener('dblclick', resetSplit);
    };
  }

  #bindInspectorWidthResizer() {
    const handle = this.root.querySelector('[data-terrain-inspector-resize]');
    const graphBody = this.root.querySelector('.terrain-graph-body');
    const sidePane = this.root.querySelector('.terrain-inspector-pane');
    if (!handle || !graphBody || !sidePane) return;
    const view = this.root.ownerDocument?.defaultView ?? globalThis.window;
    let dragging = false;

    const applyWidth = (clientX) => {
      const rect = graphBody.getBoundingClientRect();
      const width = calculateTerrainInspectorWidth(clientX, rect.left, rect.width);
      this.root.style.setProperty('--terrain-inspector-width', `${width}px`);
      handle.setAttribute('aria-valuenow', String(width));
      queueMicrotask(() => this.resize());
    };
    const stopDragging = () => {
      if (!dragging) return;
      dragging = false;
      this.root.classList.remove('resizing-inspector-width');
      view?.removeEventListener('pointermove', onPointerMove);
      view?.removeEventListener('pointerup', stopDragging);
      view?.removeEventListener('pointercancel', stopDragging);
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      event.preventDefault();
      applyWidth(event.clientX);
    };
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      this.root.classList.add('resizing-inspector-width');
      view?.addEventListener('pointermove', onPointerMove);
      view?.addEventListener('pointerup', stopDragging);
      view?.addEventListener('pointercancel', stopDragging);
      event.preventDefault();
    };
    const onKeyDown = (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const bodyRect = graphBody.getBoundingClientRect();
      const currentWidth = sidePane.getBoundingClientRect().width;
      const direction = event.key === 'ArrowLeft' ? 1 : -1;
      applyWidth(bodyRect.right - currentWidth - direction * 16);
      event.preventDefault();
    };
    const resetWidth = () => {
      this.root.style.setProperty('--terrain-inspector-width', '272px');
      handle.removeAttribute('aria-valuenow');
      queueMicrotask(() => this.resize());
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('keydown', onKeyDown);
    handle.addEventListener('dblclick', resetWidth);
    this.inspectorWidthResizeCleanup = () => {
      stopDragging();
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('keydown', onKeyDown);
      handle.removeEventListener('dblclick', resetWidth);
    };
  }

  _scheduleCommit() {
    if (this.suppressChanges || this.commitQueued) return;
    this.commitQueued = true;
    queueMicrotask(() => {
      this.commitQueued = false;
      this.#commitCanvasState();
    });
  }

  #commitCanvasState() {
    if (this.suppressChanges) return;
    const next = rebuildTerrainGraphModel(this.graph, {
      scale: this.canvas.ds.scale,
      offset: this.canvas.ds.offset,
    });
    const validation = validateTerrainGraph(next);
    const structuralErrors = validation.errors.filter((error) => !error.includes(' is missing its '));
    if (structuralErrors.length) {
      this.onStatus(structuralErrors[0], 'error');
      this.setGraph(this.model, { recordHistory: false });
      return;
    }
    if (JSON.stringify(next) === JSON.stringify(this.model)) return;
    this.model = next;
    this.history.splice(this.historyIndex + 1);
    this.history.push(cloneTerrainGraph(next));
    if (this.history.length > 100) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.#updateHistoryButtons();
    this.onGraphChange(cloneTerrainGraph(next));
  }

  setGraph(graph, { recordHistory = false } = {}) {
    const selectedNodeId = this.selectedNode?.id ?? null;
    this.suppressChanges = true;
    this.graph.clear();
    for (const modelNode of graph.nodes) {
      const node = this.LiteGraph.createNode(modelNode.type);
      node.id = modelNode.id;
      node.pos = [...modelNode.position];
      node.properties = clone(modelNode.properties);
      node._terrainRole = modelNode.role ?? null;
      for (const widget of node.widgets ?? []) {
        if (Object.hasOwn(node.properties, widget.name)) widget.value = node.properties[widget.name];
      }
      node.size = node.computeSize();
      this.graph.add(node, true);
    }
    for (const link of graph.links) {
      const origin = this.graph.getNodeById(link.fromNode);
      const target = this.graph.getNodeById(link.toNode);
      const originDefinition = TERRAIN_NODE_DEFINITIONS[origin?.type];
      const targetDefinition = TERRAIN_NODE_DEFINITIONS[target?.type];
      const outputIndex = originDefinition?.outputs?.findIndex((socket) => socket.name === link.fromSocket);
      const inputIndex = targetDefinition?.inputs?.findIndex((socket) => socket.name === link.toSocket);
      if (origin && target && outputIndex >= 0 && inputIndex >= 0) origin.connect(outputIndex, target, inputIndex);
    }
    this.graph.updateExecutionOrder();
    this.model = cloneTerrainGraph(graph);
    this.canvas.ds.scale = Number(graph.view?.scale ?? 0.82);
    this.canvas.ds.offset = [...(graph.view?.offset ?? [30, 40])];
    this.suppressChanges = false;
    const restoredSelection = selectedNodeId == null ? null : this.graph.getNodeById(selectedNodeId);
    if (restoredSelection) this.canvas.selectNode(restoredSelection);
    else this.#renderSelectedNode(null);
    if (recordHistory) {
      this.history.splice(this.historyIndex + 1);
      this.history.push(cloneTerrainGraph(graph));
      this.historyIndex = this.history.length - 1;
    }
    this.#updateHistoryButtons();
    this.canvas.setDirty(true, true);
  }

  getGraph() {
    return cloneTerrainGraph(this.model);
  }

  addNode(type, position = null) {
    if (!TERRAIN_NODE_DEFINITIONS[type]) return;
    const node = this.LiteGraph.createNode(type);
    node.pos = position
      ? [Number(position[0]), Number(position[1])]
      : [
        this.canvasElement.width / this.canvas.ds.scale * 0.5 - this.canvas.ds.offset[0] - node.size[0] * 0.5,
        this.canvasElement.height / this.canvas.ds.scale * 0.5 - this.canvas.ds.offset[1] - node.size[1] * 0.5,
      ];
    this.graph.add(node);
    this.canvas.selectNode(node);
  }

  #renderSelectedNode(node) {
    this.selectedNode = node;
    if (!this.inspectorElement) return;
    const model = buildTerrainNodeInspectorModel(node);
    if (!model) {
      this.inspectorElement.style.removeProperty('--node-accent');
      this.inspectorElement.innerHTML = '<div class="terrain-node-inspector-empty">No node selected</div>';
      return;
    }
    this.inspectorElement.style.setProperty('--node-accent', model.accent);
    const fields = model.fields.length
      ? model.fields.map((field) => {
        if (field.type === 'boolean') {
          return `<label class="terrain-node-inspector-toggle"><span>${field.label}</span><input type="checkbox" data-node-property="${field.name}"${field.value ? ' checked' : ''}></label>`;
        }
        return `<label class="terrain-node-inspector-field"><span>${field.label}</span><input type="number" data-node-property="${field.name}" value="${field.value}" step="${field.step}"></label>`;
      }).join('')
      : '<div class="terrain-node-inspector-empty">No editable parameters</div>';
    this.inspectorElement.innerHTML = `
      <header><span>${model.category}</span><b>${model.title}</b></header>
      <div class="terrain-node-inspector-fields">${fields}</div>`;
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.setGraph(this.history[this.historyIndex], { recordHistory: false });
    this.onGraphChange(this.getGraph());
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.setGraph(this.history[this.historyIndex], { recordHistory: false });
    this.onGraphChange(this.getGraph());
  }

  #updateHistoryButtons() {
    const undo = this.root.querySelector('[data-graph-action="undo"]');
    const redo = this.root.querySelector('[data-graph-action="redo"]');
    if (undo) undo.disabled = this.historyIndex <= 0;
    if (redo) redo.disabled = this.historyIndex >= this.history.length - 1;
  }

  fitView() {
    if (!this.graph._nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.graph._nodes) {
      minX = Math.min(minX, node.pos[0]);
      minY = Math.min(minY, node.pos[1]);
      maxX = Math.max(maxX, node.pos[0] + node.size[0]);
      maxY = Math.max(maxY, node.pos[1] + node.size[1]);
    }
    const padding = 48;
    const scale = Math.max(0.28, Math.min(1.2,
      Math.min(
        (this.canvasElement.width - padding * 2) / Math.max(1, maxX - minX),
        (this.canvasElement.height - padding * 2) / Math.max(1, maxY - minY),
      )));
    this.canvas.ds.scale = scale;
    this.canvas.ds.offset = [
      -minX + padding / scale,
      -minY + padding / scale,
    ];
    this.canvas.setDirty(true, true);
    this._scheduleCommit();
  }

  setBuildBusy(active) {
    const button = this.root.querySelector('[data-graph-action="build"]');
    if (button) {
      button.disabled = active;
      button.textContent = active ? 'Building...' : 'Build Terrain';
    }
  }

  resize() {
    const parent = this.canvasElement.parentElement;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.canvas.resize(width, height);
    this.canvas.setDirty(true, true);
  }

  dispose() {
    this.sidePanelResizeCleanup?.();
    this.inspectorWidthResizeCleanup?.();
    this.resizeObserver?.disconnect();
    this.canvas?.close?.();
    this.graph?.clear();
  }
}
