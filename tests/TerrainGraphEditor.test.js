import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTerrainNodeProperty,
  buildTerrainNodeInspectorModel,
  calculateTerrainInspectorWidth,
  calculateTerrainSideSplit,
  installPointerCenteredZoom,
  installReadableNodeRendering,
  installTerrainNumberPrompt,
  rebuildTerrainGraphModel,
  registerTerrainNodeTypes,
  setTerrainSidePanelVisibility,
} from '../src/ui/TerrainGraphEditor.js';

test('LiteGraph state rebuilds into the normalized terrain graph format', () => {
  const liteGraph = {
    _nodes: [
      { id: 7, type: 'world/coordinates', pos: [10, 20], properties: { scale: 2 }, _terrainRole: 'coordinates' },
      { id: 9, type: 'noise/fbm', pos: [220, 20], properties: { frequency: 0.002 } },
    ],
    links: {
      14: { id: 14, origin_id: 7, origin_slot: 0, target_id: 9, target_slot: 0 },
    },
  };
  const model = rebuildTerrainGraphModel(liteGraph, { scale: 0.8, offset: [4, 5] });

  assert.equal(model.nextNodeId, 10);
  assert.equal(model.nextLinkId, 15);
  assert.deepEqual(model.nodes[0].position, [10, 20]);
  assert.equal(model.nodes[0].role, 'coordinates');
  assert.deepEqual(model.links[0], {
    id: 14,
    fromNode: 7,
    fromSocket: 'coordinate',
    toNode: 9,
    toSocket: 'coordinate',
  });
  assert.deepEqual(model.view, { scale: 0.8, offset: [4, 5] });
});

test('terrain node registration initializes missing LiteGraph link colors', () => {
  const liteGraph = {
    registerNodeType() {},
  };

  registerTerrainNodeTypes(liteGraph);

  assert.equal(liteGraph.link_type_colors.coordinate, '#4aa8c7');
  assert.equal(liteGraph.link_type_colors.field, '#66c784');
  assert.equal(liteGraph.link_type_colors.terrain, '#4fd4bd');
});

test('readable node rendering preserves text quality below LiteGraph zoom threshold', () => {
  const observedScales = [];
  const graphCanvas = {
    ds: { scale: 0.42 },
    drawNode() {
      observedScales.push(this.ds.scale);
    },
  };

  installReadableNodeRendering(graphCanvas);
  graphCanvas.drawNode({}, {});

  assert.ok(observedScales[0] > 0.6);
  assert.equal(graphCanvas.ds.scale, 0.42);
});

test('selected node property editing updates the node widget and graph state', () => {
  let propertyChange = null;
  const node = {
    properties: { frequency: 0.00185 },
    widgets: [{ name: 'frequency', value: 0.00185 }],
    onPropertyChanged(name, value) {
      propertyChange = { name, value };
      this.properties[name] = value;
    },
  };

  const value = applyTerrainNodeProperty(node, 'frequency', '0.0025');

  assert.equal(value, 0.0025);
  assert.equal(node.properties.frequency, 0.0025);
  assert.equal(node.widgets[0].value, 0.0025);
  assert.deepEqual(propertyChange, { name: 'frequency', value: 0.0025 });
});

test('selected node property editing preserves boolean value types', () => {
  const node = {
    properties: { clamp: false },
    widgets: [{ name: 'clamp', value: false }],
  };

  applyTerrainNodeProperty(node, 'clamp', true);

  assert.equal(node.properties.clamp, true);
  assert.equal(node.widgets[0].value, true);
});

test('selected node inspector exposes editable properties independently of graph zoom', () => {
  const model = buildTerrainNodeInspectorModel({
    id: 12,
    type: 'noise/fbm',
    properties: { frequency: 0.0025, octaves: 5 },
  });

  assert.equal(model.title, 'FBM Noise');
  assert.equal(model.category, 'Noise');
  assert.deepEqual(model.fields, [
    { name: 'frequency', label: 'Frequency', value: 0.0025, type: 'number', step: 0.00001 },
    { name: 'octaves', label: 'Octaves', value: 5, type: 'number', step: 1 },
  ]);
});

test('graph wheel zoom uses pointer coordinates local to the graph canvas', () => {
  const listeners = {};
  let zoom = null;
  let changed = false;
  let prevented = false;
  const canvas = {
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 240, top: 310, width: 900, height: 420 };
    },
  };
  const graphCanvas = {
    canvas,
    graph: { change: () => { changed = true; } },
    allow_dragcanvas: true,
    _mousewheel_callback() {},
    ds: {
      scale: 1,
      changeScale(scale, center) {
        this.scale = scale;
        zoom = { scale, center };
      },
    },
  };

  installPointerCenteredZoom(graphCanvas);
  listeners.mousewheel({
    clientX: 540,
    clientY: 430,
    wheelDeltaY: 120,
    preventDefault: () => { prevented = true; },
    stopPropagation() {},
  });

  assert.deepEqual(zoom, { scale: 1.1, center: [300, 120] });
  assert.equal(changed, true);
  assert.equal(prevented, true);
});

test('LiteGraph numeric prompt becomes a bounded native number input', () => {
  const classes = new Set();
  const input = { type: 'text', step: '', inputMode: '' };
  const dialog = {
    classList: { add: (name) => classes.add(name) },
    style: { transform: 'scale(1.8)' },
    querySelector: (selector) => selector === '.value' ? input : null,
  };
  const graphCanvas = {
    prompt: () => dialog,
  };

  installTerrainNumberPrompt(graphCanvas);
  const result = graphCanvas.prompt('Value', 82, () => {}, null, false);

  assert.equal(result, dialog);
  assert.equal(classes.has('terrain-number-dialog'), true);
  assert.equal(input.type, 'number');
  assert.equal(input.step, '1');
  assert.equal(input.inputMode, 'decimal');
  assert.equal(dialog.style.transform, 'none');
});

test('terrain side panel visibility supports preview and selected node independently', () => {
  const classes = new Set();
  const previewPane = {};
  const inspectorPane = {};
  const resizeHandle = {};
  const widthResizeHandle = {};
  const root = {
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    querySelector(selector) {
      return {
        '.terrain-preview-pane': previewPane,
        '.terrain-selected-node-pane': inspectorPane,
        '[data-terrain-side-resize]': resizeHandle,
        '[data-terrain-inspector-resize]': widthResizeHandle,
      }[selector] ?? null;
    },
  };

  setTerrainSidePanelVisibility(root, { previewEnabled: false, inspectorEnabled: true });
  assert.equal(classes.has('preview-disabled'), true);
  assert.equal(classes.has('inspector-disabled'), false);
  assert.equal(classes.has('side-tools-disabled'), false);
  assert.equal(previewPane.hidden, true);
  assert.equal(inspectorPane.hidden, false);
  assert.equal(resizeHandle.hidden, true);
  assert.equal(widthResizeHandle.hidden, false);

  setTerrainSidePanelVisibility(root, { previewEnabled: true, inspectorEnabled: false });
  assert.equal(classes.has('preview-disabled'), false);
  assert.equal(classes.has('inspector-disabled'), true);
  assert.equal(previewPane.hidden, false);
  assert.equal(inspectorPane.hidden, true);
  assert.equal(resizeHandle.hidden, true);
  assert.equal(widthResizeHandle.hidden, false);

  setTerrainSidePanelVisibility(root, { previewEnabled: false, inspectorEnabled: false });
  assert.equal(classes.has('side-tools-disabled'), true);
  assert.equal(widthResizeHandle.hidden, true);
});

test('terrain preview resizer preserves usable space for both side panels', () => {
  assert.equal(calculateTerrainSideSplit(260, 100, 400), 160);
  assert.equal(calculateTerrainSideSplit(110, 100, 400), 96);
  assert.equal(calculateTerrainSideSplit(495, 100, 400), 297);
});

test('terrain inspector width resizer preserves usable graph and panel widths', () => {
  assert.equal(calculateTerrainInspectorWidth(1200, 100, 1400), 300);
  assert.equal(calculateTerrainInspectorWidth(1450, 100, 1400), 220);
  assert.equal(calculateTerrainInspectorWidth(300, 100, 1400), 897);
});
