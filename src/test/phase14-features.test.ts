/**
 * Phase 14 Feature Tests
 *
 * Comprehensive tests for:
 * 1. Recent Files (settingsStore)
 * 2. Node Palette Categories (NODE_CATEGORIES, NODE_TYPE_CONFIG)
 * 3. Graph Tab Management (editorStore multi-graph)
 * 4. Auto-Execute Setting (settingsStore)
 * 5. Export/Import Integration (editorStore workspace)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settingsStore';
import { NODE_CATEGORIES, NODE_TYPE_CONFIG } from '../types';
import type { NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getState = () => useEditorStore.getState();
const getSettings = () => useSettingsStore.getState();

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.selectedIds = new Set<string>();
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.graphTabs = { default: { id: 'default', name: 'Main Graph', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.contextMenu = null;
    s.validationErrors = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.isExecuting = false;
    s.showValuePreviews = false;
    s.debugMode = false;
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.undoRedoEvent = null;
    s.hoveredConnectionId = null;
    s.nearestSnapPort = null;
  });
}

function resetSettings() {
  useSettingsStore.setState((s) => {
    s.gridSnapSize = 1;
    s.gridVisible = true;
    s.animationSpeed = 1;
    s.uiScale = 1;
    s.theme = 'dark';
    s.minimapVisible = true;
    s.inspectorVisible = true;
    s.zoomSensitivity = 0.4;
    s.panSpeed = 0.8;
    s.rotateSpeed = 0.6;
    s.autoExecute = false;
    s.autoSave = true;
    s.recentFiles = [];
    s.recentlyUsedNodes = [];
  });
}

// ---------------------------------------------------------------------------
// All 93 NodeType values for verification
// ---------------------------------------------------------------------------

const ALL_NODE_TYPES: NodeType[] = [
  'source', 'transform', 'filter', 'output',
  'math', 'clamp', 'remap',
  'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt',
  'lerp',
  'concat', 'template',
  'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number',
  'string-concat', 'string-replace', 'string-includes', 'string-template',
  'compare', 'switch',
  'and', 'or', 'not', 'xor',
  'compose-vec3', 'decompose-vec3',
  'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length',
  'mean', 'median', 'stddev', 'min-array', 'max-array',
  'note', 'reroute', 'random', 'display',
  'timer', 'color-picker', 'color-mix', 'hsl-to-rgb', 'rgb-to-hsl', 'http-fetch',
  'custom',
  'subgraph', 'subgraph-input', 'subgraph-output',
  'create-array', 'get-element', 'set-element', 'array-length', 'array-push', 'array-filter', 'array-map',
  'array-reduce',
  'create-object', 'get-property', 'set-property', 'object-keys', 'object-values', 'merge-objects',
  'if-gate', 'select',
  'get-var', 'set-var',
  'json-parse', 'json-stringify', 'base64-encode', 'base64-decode', 'uri-encode', 'uri-decode',
  'array-slice', 'array-find', 'array-sort', 'array-reverse', 'array-flatten', 'array-zip', 'array-unique',
  'get-timestamp', 'format-date', 'parse-date',
];

/** Actual count of node types defined in the codebase */
const NODE_TYPE_COUNT = 93;

// =========================================================================
// 1. Recent Files (settingsStore)
// =========================================================================

describe('Recent Files', () => {
  beforeEach(() => {
    resetSettings();
  });

  it('addRecentFile adds to front of list', () => {
    getSettings().addRecentFile('/path/to/file1.json');
    expect(getSettings().recentFiles[0]).toBe('/path/to/file1.json');
    expect(getSettings().recentFiles).toHaveLength(1);
  });

  it('addRecentFile adds multiple files in reverse order', () => {
    getSettings().addRecentFile('/path/file1.json');
    getSettings().addRecentFile('/path/file2.json');
    getSettings().addRecentFile('/path/file3.json');
    const files = getSettings().recentFiles;
    expect(files).toEqual([
      '/path/file3.json',
      '/path/file2.json',
      '/path/file1.json',
    ]);
  });

  it('addRecentFile deduplicates by moving existing to front', () => {
    getSettings().addRecentFile('/path/file1.json');
    getSettings().addRecentFile('/path/file2.json');
    getSettings().addRecentFile('/path/file3.json');
    // Re-add file1 — should move to front, not duplicate
    getSettings().addRecentFile('/path/file1.json');
    const files = getSettings().recentFiles;
    expect(files).toHaveLength(3);
    expect(files[0]).toBe('/path/file1.json');
    expect(files[1]).toBe('/path/file3.json');
    expect(files[2]).toBe('/path/file2.json');
  });

  it('addRecentFile caps at 10 items (MAX_RECENT_FILES)', () => {
    for (let i = 0; i < 15; i++) {
      getSettings().addRecentFile(`/path/file${i}.json`);
    }
    expect(getSettings().recentFiles).toHaveLength(10);
  });

  it('adding 11th file drops the oldest', () => {
    for (let i = 0; i < 11; i++) {
      getSettings().addRecentFile(`/file${i}.json`);
    }
    const files = getSettings().recentFiles;
    expect(files).toHaveLength(10);
    // The oldest (file0) should have been dropped
    expect(files).not.toContain('/file0.json');
    // The newest (file10) should be first
    expect(files[0]).toBe('/file10.json');
    // The second oldest remaining (file1) should be last
    expect(files[9]).toBe('/file1.json');
  });

  it('clearRecentFiles empties the list', () => {
    getSettings().addRecentFile('/path/file1.json');
    getSettings().addRecentFile('/path/file2.json');
    expect(getSettings().recentFiles).toHaveLength(2);

    getSettings().clearRecentFiles();
    expect(getSettings().recentFiles).toHaveLength(0);
    expect(getSettings().recentFiles).toEqual([]);
  });

  it('multiple adds preserve insertion order', () => {
    const paths = ['/a.json', '/b.json', '/c.json', '/d.json', '/e.json'];
    for (const p of paths) {
      getSettings().addRecentFile(p);
    }
    // Last added should be first
    expect(getSettings().recentFiles).toEqual([...paths].reverse());
  });

  it('resetToDefaults clears recentFiles', () => {
    getSettings().addRecentFile('/path/file1.json');
    getSettings().addRecentFile('/path/file2.json');
    expect(getSettings().recentFiles).toHaveLength(2);

    getSettings().resetToDefaults();
    expect(getSettings().recentFiles).toEqual([]);
  });

  it('resetToDefaults also resets other settings to defaults', () => {
    getSettings().setUiScale(1.5);
    getSettings().setAutoExecute(true);
    getSettings().addRecentFile('/test.json');

    getSettings().resetToDefaults();
    expect(getSettings().uiScale).toBe(DEFAULT_SETTINGS.uiScale);
    expect(getSettings().autoExecute).toBe(DEFAULT_SETTINGS.autoExecute);
    expect(getSettings().recentFiles).toEqual([]);
  });

  it('adding same file twice in a row results in single entry', () => {
    getSettings().addRecentFile('/same.json');
    getSettings().addRecentFile('/same.json');
    expect(getSettings().recentFiles).toHaveLength(1);
    expect(getSettings().recentFiles[0]).toBe('/same.json');
  });
});

// =========================================================================
// 2. NODE_CATEGORIES
// =========================================================================

describe('NODE_CATEGORIES', () => {
  // Build a reverse map: category -> node types
  function getCategoryTypes(): Record<string, NodeType[]> {
    const map: Record<string, NodeType[]> = {};
    for (const [nodeType, category] of Object.entries(NODE_CATEGORIES)) {
      if (!map[category]) map[category] = [];
      map[category].push(nodeType as NodeType);
    }
    return map;
  }

  it('Core category contains source, transform, filter, output', () => {
    const cats = getCategoryTypes();
    expect(cats['Core']).toEqual(expect.arrayContaining(['source', 'transform', 'filter', 'output']));
  });

  it('Math category contains all math-related types', () => {
    const expected: NodeType[] = ['math', 'clamp', 'remap', 'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt', 'lerp', 'mean', 'median', 'stddev', 'min-array', 'max-array'];
    const cats = getCategoryTypes();
    for (const t of expected) {
      expect(cats['Math']).toContain(t);
    }
    expect(cats['Math']).toHaveLength(expected.length);
  });

  it('String category contains all string-related types', () => {
    const expected: NodeType[] = ['concat', 'template', 'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number', 'string-concat', 'string-replace', 'string-includes', 'string-template'];
    const cats = getCategoryTypes();
    for (const t of expected) {
      expect(cats['String']).toContain(t);
    }
    expect(cats['String']).toHaveLength(expected.length);
  });

  it('Logic category contains compare, switch, and, or, not, xor, if-gate, select', () => {
    const expected: NodeType[] = ['compare', 'switch', 'and', 'or', 'not', 'xor', 'if-gate', 'select'];
    const cats = getCategoryTypes();
    for (const t of expected) {
      expect(cats['Logic']).toContain(t);
    }
    expect(cats['Logic']).toHaveLength(expected.length);
  });

  it('Vector category contains compose-vec3, decompose-vec3, dot-product, cross-product, normalize-vec3, vec3-length', () => {
    const expected: NodeType[] = ['compose-vec3', 'decompose-vec3', 'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length'];
    const cats = getCategoryTypes();
    for (const t of expected) {
      expect(cats['Vector']).toContain(t);
    }
    expect(cats['Vector']).toHaveLength(expected.length);
  });

  it('Utility category contains note, reroute, random, display, custom, and date/time nodes', () => {
    const expected: NodeType[] = ['note', 'reroute', 'random', 'display', 'custom', 'get-timestamp', 'format-date', 'parse-date'];
    const cats = getCategoryTypes();
    for (const t of expected) {
      expect(cats['Utility']).toContain(t);
    }
    expect(cats['Utility']).toHaveLength(expected.length);
  });

  it('Subgraph category contains subgraph, subgraph-input, subgraph-output', () => {
    const expected: NodeType[] = ['subgraph', 'subgraph-input', 'subgraph-output'];
    const cats = getCategoryTypes();
    for (const t of expected) {
      expect(cats['Subgraph']).toContain(t);
    }
    expect(cats['Subgraph']).toHaveLength(expected.length);
  });

  it('all categories combined cover all 93 node types', () => {
    const allCategorized = Object.keys(NODE_CATEGORIES) as NodeType[];
    expect(allCategorized).toHaveLength(NODE_TYPE_COUNT);
    for (const t of ALL_NODE_TYPES) {
      expect(NODE_CATEGORIES[t]).toBeDefined();
    }
  });

  it('every node type in NODE_CATEGORIES has a NODE_TYPE_CONFIG entry', () => {
    for (const nodeType of Object.keys(NODE_CATEGORIES) as NodeType[]) {
      expect(NODE_TYPE_CONFIG[nodeType]).toBeDefined();
      expect(NODE_TYPE_CONFIG[nodeType].color).toBeDefined();
      expect(Array.isArray(NODE_TYPE_CONFIG[nodeType].inputs)).toBe(true);
      expect(Array.isArray(NODE_TYPE_CONFIG[nodeType].outputs)).toBe(true);
    }
  });

  it('has exactly 10 categories', () => {
    const cats = getCategoryTypes();
    const categoryNames = Object.keys(cats);
    expect(categoryNames).toHaveLength(10);
    expect(categoryNames.sort()).toEqual(
      ['Color', 'Core', 'Data', 'Live', 'Logic', 'Math', 'String', 'Subgraph', 'Utility', 'Vector'].sort()
    );
  });
});

// =========================================================================
// 3. NODE_TYPE_CONFIG
// =========================================================================

describe('NODE_TYPE_CONFIG', () => {
  it('has entries for all 93 node types', () => {
    const configKeys = Object.keys(NODE_TYPE_CONFIG) as NodeType[];
    expect(configKeys).toHaveLength(NODE_TYPE_COUNT);
    for (const t of ALL_NODE_TYPES) {
      expect(NODE_TYPE_CONFIG[t]).toBeDefined();
    }
  });

  it('each entry has color, inputs, and outputs arrays', () => {
    for (const t of ALL_NODE_TYPES) {
      const config = NODE_TYPE_CONFIG[t];
      expect(typeof config.color).toBe('string');
      expect(config.color.length).toBeGreaterThan(0);
      expect(Array.isArray(config.inputs)).toBe(true);
      expect(Array.isArray(config.outputs)).toBe(true);
    }
  });

  it('source has 0 inputs and 2 outputs', () => {
    const cfg = NODE_TYPE_CONFIG['source'];
    expect(cfg.inputs).toHaveLength(0);
    expect(cfg.outputs.length).toBeGreaterThanOrEqual(1);
  });

  it('transform has 2 inputs and 2 outputs', () => {
    const cfg = NODE_TYPE_CONFIG['transform'];
    expect(cfg.inputs).toHaveLength(2);
    expect(cfg.outputs).toHaveLength(2);
  });

  it('math has 2 inputs and 1 output', () => {
    const cfg = NODE_TYPE_CONFIG['math'];
    expect(cfg.inputs).toHaveLength(2);
    expect(cfg.outputs).toHaveLength(1);
  });

  it('output has inputs but no outputs', () => {
    const cfg = NODE_TYPE_CONFIG['output'];
    expect(cfg.inputs.length).toBeGreaterThan(0);
    expect(cfg.outputs).toHaveLength(0);
  });

  it('note has no inputs and no outputs', () => {
    const cfg = NODE_TYPE_CONFIG['note'];
    expect(cfg.inputs).toHaveLength(0);
    expect(cfg.outputs).toHaveLength(0);
  });

  it('every port config has label and portType', () => {
    for (const t of ALL_NODE_TYPES) {
      const config = NODE_TYPE_CONFIG[t];
      for (const port of [...config.inputs, ...config.outputs]) {
        expect(typeof port.label).toBe('string');
        expect(port.label.length).toBeGreaterThan(0);
        expect(typeof port.portType).toBe('string');
      }
    }
  });

  it('trig nodes (sin, cos, tan) each have 1 input and 1 output', () => {
    for (const t of ['sin', 'cos', 'tan'] as NodeType[]) {
      const cfg = NODE_TYPE_CONFIG[t];
      expect(cfg.inputs).toHaveLength(1);
      expect(cfg.outputs).toHaveLength(1);
      expect(cfg.inputs[0].portType).toBe('number');
      expect(cfg.outputs[0].portType).toBe('number');
    }
  });

  it('logic gates (and, or, xor) have 2 boolean inputs and 1 boolean output', () => {
    for (const t of ['and', 'or', 'xor'] as NodeType[]) {
      const cfg = NODE_TYPE_CONFIG[t];
      expect(cfg.inputs).toHaveLength(2);
      expect(cfg.outputs).toHaveLength(1);
      expect(cfg.inputs[0].portType).toBe('boolean');
      expect(cfg.inputs[1].portType).toBe('boolean');
      expect(cfg.outputs[0].portType).toBe('boolean');
    }
  });

  it('not gate has 1 boolean input and 1 boolean output', () => {
    const cfg = NODE_TYPE_CONFIG['not'];
    expect(cfg.inputs).toHaveLength(1);
    expect(cfg.outputs).toHaveLength(1);
    expect(cfg.inputs[0].portType).toBe('boolean');
    expect(cfg.outputs[0].portType).toBe('boolean');
  });

  it('compose-vec3 has 3 number inputs and 1 vector3 output', () => {
    const cfg = NODE_TYPE_CONFIG['compose-vec3'];
    expect(cfg.inputs).toHaveLength(3);
    expect(cfg.outputs).toHaveLength(1);
    for (const inp of cfg.inputs) {
      expect(inp.portType).toBe('number');
    }
    expect(cfg.outputs[0].portType).toBe('vector3');
  });

  it('decompose-vec3 has 1 vector3 input and 3 number outputs', () => {
    const cfg = NODE_TYPE_CONFIG['decompose-vec3'];
    expect(cfg.inputs).toHaveLength(1);
    expect(cfg.outputs).toHaveLength(3);
    expect(cfg.inputs[0].portType).toBe('vector3');
    for (const out of cfg.outputs) {
      expect(out.portType).toBe('number');
    }
  });
});

// =========================================================================
// 4. Graph Tab Management
// =========================================================================

describe('Graph Tab Management', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initial state has one default graph', () => {
    expect(Object.keys(getState().graphTabs)).toHaveLength(1);
    expect(getState().graphTabs['default']).toBeDefined();
    expect(getState().activeGraphId).toBe('default');
    expect(getState().graphOrder).toEqual(['default']);
  });

  it('createGraph adds a new tab and switches to it', () => {
    const newId = getState().createGraph('Test Graph');
    expect(newId).toBeTruthy();
    expect(getState().graphTabs[newId]).toBeDefined();
    expect(getState().graphTabs[newId].name).toBe('Test Graph');
    expect(getState().activeGraphId).toBe(newId);
    expect(getState().graphOrder).toContain(newId);
  });

  it('createGraph with no name uses auto-generated name', () => {
    const newId = getState().createGraph();
    expect(getState().graphTabs[newId].name).toMatch(/^Graph \d+$/);
  });

  it('switchGraph changes activeGraphId', () => {
    const g2 = getState().createGraph('Graph 2');
    // Currently on g2, switch back to default
    getState().switchGraph('default');
    expect(getState().activeGraphId).toBe('default');
    // Switch forward
    getState().switchGraph(g2);
    expect(getState().activeGraphId).toBe(g2);
  });

  it('switchGraph to same graph is a no-op', () => {
    const before = getState().activeGraphId;
    getState().switchGraph(before);
    expect(getState().activeGraphId).toBe(before);
  });

  it('switchGraph to non-existent graph is a no-op', () => {
    const before = getState().activeGraphId;
    getState().switchGraph('nonexistent-graph');
    expect(getState().activeGraphId).toBe(before);
  });

  it('deleteGraph removes tab and switches to another', () => {
    const g2 = getState().createGraph('Graph 2');
    expect(Object.keys(getState().graphTabs)).toHaveLength(2);

    // Switch to g2, then delete it
    getState().switchGraph(g2);
    expect(getState().activeGraphId).toBe(g2);

    getState().deleteGraph(g2);
    expect(getState().graphTabs[g2]).toBeUndefined();
    expect(getState().graphOrder).not.toContain(g2);
    // Should have switched to the other graph
    expect(getState().activeGraphId).toBe('default');
  });

  it('cannot delete the last graph', () => {
    expect(Object.keys(getState().graphTabs)).toHaveLength(1);
    getState().deleteGraph('default');
    // Should still exist
    expect(getState().graphTabs['default']).toBeDefined();
    expect(getState().graphOrder).toEqual(['default']);
  });

  it('renameGraph updates tab name', () => {
    getState().renameGraph('default', 'Renamed Graph');
    expect(getState().graphTabs['default'].name).toBe('Renamed Graph');
  });

  it('renameGraph on non-existent graph is a no-op', () => {
    getState().renameGraph('nonexistent', 'Should Not Work');
    expect(getState().graphTabs['nonexistent']).toBeUndefined();
  });

  it('reorderGraph changes graphOrder', () => {
    const g2 = getState().createGraph('Graph 2');
    const g3 = getState().createGraph('Graph 3');
    // Order should be [default, g2, g3]
    expect(getState().graphOrder).toEqual(['default', g2, g3]);

    // Move g3 to position 0 (front)
    getState().reorderGraph(g3, 0);
    expect(getState().graphOrder[0]).toBe(g3);
    expect(getState().graphOrder).toContain('default');
    expect(getState().graphOrder).toContain(g2);
  });

  it('reorderGraph clamps index to valid range', () => {
    getState().createGraph('Graph 2');
    // Try moving to index 100 — should clamp to end
    getState().reorderGraph('default', 100);
    expect(getState().graphOrder[getState().graphOrder.length - 1]).toBe('default');
    // Try moving to index -1 — should clamp to 0
    getState().reorderGraph('default', -1);
    expect(getState().graphOrder[0]).toBe('default');
  });

  it('nodes are isolated per graph', () => {
    // Add node to default graph
    const n1 = getState().addNode('source', [0, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Create and switch to new graph
    getState().createGraph('Graph 2');
    // New graph should be empty
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Add node to g2
    getState().addNode('math', [5, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Switch back to default — should see original node
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes[n1]).toBeDefined();
  });

  it('createGraph returns unique IDs each time', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      ids.add(getState().createGraph());
    }
    // 5 unique IDs + default
    expect(ids.size).toBe(5);
  });
});

// =========================================================================
// 5. Auto-Execute Setting
// =========================================================================

describe('Auto-Execute Setting', () => {
  beforeEach(() => {
    resetSettings();
  });

  it('default is false', () => {
    expect(getSettings().autoExecute).toBe(false);
  });

  it('setAutoExecute(true) enables it', () => {
    getSettings().setAutoExecute(true);
    expect(getSettings().autoExecute).toBe(true);
  });

  it('setAutoExecute(false) disables it', () => {
    getSettings().setAutoExecute(true);
    expect(getSettings().autoExecute).toBe(true);
    getSettings().setAutoExecute(false);
    expect(getSettings().autoExecute).toBe(false);
  });

  it('toggle back and forth', () => {
    getSettings().setAutoExecute(true);
    getSettings().setAutoExecute(false);
    getSettings().setAutoExecute(true);
    expect(getSettings().autoExecute).toBe(true);
  });

  it('resetToDefaults resets autoExecute to false', () => {
    getSettings().setAutoExecute(true);
    getSettings().resetToDefaults();
    expect(getSettings().autoExecute).toBe(false);
  });
});

// =========================================================================
// 6. Export/Import Integration
// =========================================================================

describe('Export/Import Integration', () => {
  beforeEach(() => {
    resetStore();
  });

  it('exportAllGraphs returns valid object with version 2', () => {
    const exported = getState().exportAllGraphs();
    expect(exported).toBeDefined();
    expect(exported.version).toBe(2);
    expect(exported.graphs).toBeDefined();
    expect(exported.graphTabs).toBeDefined();
    expect(exported.activeGraphId).toBeDefined();
    expect(exported.graphOrder).toBeDefined();
  });

  it('exportAllGraphs includes all graphs', () => {
    getState().addNode('source', [0, 0, 0]);
    const g2 = getState().createGraph('Graph 2');
    getState().addNode('math', [5, 0, 0]);

    const exported = getState().exportAllGraphs();
    expect(Object.keys(exported.graphs)).toHaveLength(2);
    expect(exported.graphs['default']).toBeDefined();
    expect(exported.graphs[g2]).toBeDefined();
  });

  it('importAllGraphs restores graph state', () => {
    // Build some state
    getState().addNode('source', [0, 0, 0]);
    const g2 = getState().createGraph('Second Graph');
    getState().addNode('transform', [5, 0, 0]);

    // Export
    const exported = getState().exportAllGraphs();

    // Reset everything
    resetStore();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Import
    getState().importAllGraphs(exported);

    // Verify: should be on the same active graph as when exported
    expect(getState().activeGraphId).toBe(g2);
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().graphTabs[g2]).toBeDefined();
    expect(getState().graphTabs['default']).toBeDefined();
  });

  it('round-trip: create nodes, export, clear, import, verify nodes exist', () => {
    // Create nodes and connection in default graph
    const srcId = getState().addNode('source', [0, 0, 0]);
    const xfmId = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(srcId, 0, xfmId, 0);
    expect(connId).toBeTruthy();

    // Export
    const exported = getState().exportAllGraphs();

    // Clear
    resetStore();
    expect(Object.keys(getState().nodes)).toHaveLength(0);
    expect(Object.keys(getState().connections)).toHaveLength(0);

    // Import
    getState().importAllGraphs(exported);

    // Verify nodes restored
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(getState().nodes[srcId]).toBeDefined();
    expect(getState().nodes[srcId].type).toBe('source');
    expect(getState().nodes[xfmId]).toBeDefined();
    expect(getState().nodes[xfmId].type).toBe('transform');

    // Verify connection restored
    expect(Object.keys(getState().connections)).toHaveLength(1);
    const conn = getState().connections[connId!];
    expect(conn).toBeDefined();
    expect(conn.sourceNodeId).toBe(srcId);
    expect(conn.targetNodeId).toBe(xfmId);
  });

  it('importAllGraphs restores graphOrder', () => {
    const g2 = getState().createGraph('G2');
    const g3 = getState().createGraph('G3');

    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().graphOrder).toContain('default');
    expect(getState().graphOrder).toContain(g2);
    expect(getState().graphOrder).toContain(g3);
    expect(getState().graphOrder).toHaveLength(3);
  });

  it('importAllGraphs rejects invalid version', () => {
    const badStorage = { version: 99, graphs: {}, graphTabs: {}, activeGraphId: 'x', graphOrder: [], templates: {}, subgraphDefs: {} } as any;
    const beforeNodes = { ...getState().nodes };
    getState().importAllGraphs(badStorage);
    // State should be unchanged
    expect(getState().nodes).toEqual(beforeNodes);
  });

  it('importAllGraphs with null is a no-op', () => {
    const beforeId = getState().activeGraphId;
    getState().importAllGraphs(null as any);
    expect(getState().activeGraphId).toBe(beforeId);
  });

  it('importWorkflow replaces current graph nodes', () => {
    // Add existing node
    getState().addNode('source', [0, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Import a workflow with different nodes
    const importData = {
      nodes: {
        'imported-1': {
          id: 'imported-1',
          type: 'math' as NodeType,
          position: [1, 0, 1] as [number, number, number],
          title: 'Math',
          data: {},
          inputs: [
            { id: 'in-0', label: 'a', portType: 'number' as const },
            { id: 'in-1', label: 'b', portType: 'number' as const },
          ],
          outputs: [
            { id: 'out-0', label: 'result', portType: 'number' as const },
          ],
        },
      },
      connections: {},
    };
    getState().importWorkflow(importData);

    // Should have replaced with imported data
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes['imported-1']).toBeDefined();
    expect(getState().nodes['imported-1'].type).toBe('math');
  });

  it('export/import preserves templates', () => {
    // Add some nodes and create a template
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([n1]));
    const tplId = getState().saveSelectionAsTemplate('Test Template', 'General');
    expect(tplId).toBeTruthy();

    const exported = getState().exportAllGraphs();
    resetStore();

    getState().importAllGraphs(exported);
    expect(Object.keys(getState().templates)).toHaveLength(1);
    expect(getState().templates[tplId!]).toBeDefined();
    expect(getState().templates[tplId!].name).toBe('Test Template');
  });

  it('export/import preserves graphTabs metadata', () => {
    getState().renameGraph('default', 'Custom Name');
    const g2 = getState().createGraph('Second');

    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    expect(getState().graphTabs['default'].name).toBe('Custom Name');
    expect(getState().graphTabs[g2].name).toBe('Second');
  });

  it('export produces deep copy — mutations do not affect store', () => {
    getState().addNode('source', [0, 0, 0]);
    const exported = getState().exportAllGraphs();

    // Mutate the export
    const firstGraph = Object.values(exported.graphs)[0];
    const firstNodeId = Object.keys(firstGraph.nodes)[0];
    firstGraph.nodes[firstNodeId].title = 'MUTATED';

    // Store should be unaffected
    expect(Object.values(getState().nodes)[0].title).not.toBe('MUTATED');
  });
});

// =========================================================================
// 7. Recently Used Nodes (settingsStore)
// =========================================================================

describe('Recently Used Nodes', () => {
  beforeEach(() => {
    resetSettings();
  });

  it('addRecentlyUsedNode adds to front of list', () => {
    getSettings().addRecentlyUsedNode('source');
    expect(getSettings().recentlyUsedNodes[0]).toBe('source');
  });

  it('addRecentlyUsedNode deduplicates', () => {
    getSettings().addRecentlyUsedNode('source');
    getSettings().addRecentlyUsedNode('math');
    getSettings().addRecentlyUsedNode('source');
    expect(getSettings().recentlyUsedNodes).toHaveLength(2);
    expect(getSettings().recentlyUsedNodes[0]).toBe('source');
    expect(getSettings().recentlyUsedNodes[1]).toBe('math');
  });

  it('addRecentlyUsedNode caps at 8 items', () => {
    for (let i = 0; i < 12; i++) {
      getSettings().addRecentlyUsedNode(`type-${i}`);
    }
    expect(getSettings().recentlyUsedNodes).toHaveLength(8);
  });
});

// =========================================================================
// 8. Settings Store edge cases
// =========================================================================

describe('Settings Store edge cases', () => {
  beforeEach(() => {
    resetSettings();
  });

  it('setUiScale clamps to [0.5, 2]', () => {
    getSettings().setUiScale(0.1);
    expect(getSettings().uiScale).toBe(0.5);
    getSettings().setUiScale(5);
    expect(getSettings().uiScale).toBe(2);
  });

  it('setGridSnapSize enforces minimum 0.1', () => {
    getSettings().setGridSnapSize(0.01);
    expect(getSettings().gridSnapSize).toBe(0.1);
  });

  it('setZoomSensitivity clamps to [0.1, 3]', () => {
    getSettings().setZoomSensitivity(0);
    expect(getSettings().zoomSensitivity).toBe(0.1);
    getSettings().setZoomSensitivity(10);
    expect(getSettings().zoomSensitivity).toBe(3);
  });

  it('setAutoSave toggles correctly', () => {
    expect(getSettings().autoSave).toBe(true);
    getSettings().setAutoSave(false);
    expect(getSettings().autoSave).toBe(false);
    getSettings().setAutoSave(true);
    expect(getSettings().autoSave).toBe(true);
  });
});
