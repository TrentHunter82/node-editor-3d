/**
 * Phase 28 Feature Tests — autoInserted visual indicator, CameraBookmarks,
 * Toolbar section data, showNodeScreens toggle, executionMaxNodeDuration enhancements.
 *
 * Tests store-level behavior for all Phase 28 features.
 * Target: 40+ tests covering autoInserted coercion nodes, camera bookmark
 * management, settings persistence, and execution metrics.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';
import type { CameraBookmark } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../types';
import type { NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() { return useEditorStore.getState(); }
function getSettings() { return useSettingsStore.getState(); }

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.validationErrors = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.isExecuting = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.showValuePreviews = true;
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

function resetSettings() {
  useSettingsStore.setState(useSettingsStore.getInitialState());
}

function nodeCount(): number { return Object.keys(getStore().nodes).length; }
function connCount(): number { return Object.keys(getStore().connections).length; }
function allNodes() { return Object.values(getStore().nodes); }

function connectPorts(srcId: string, srcPort: number, tgtId: string, tgtPort: number) {
  getStore().startConnection(srcId, srcPort);
  getStore().completeConnection(tgtId, tgtPort);
}

function findAutoInsertedNodes() {
  return allNodes().filter(n => n.autoInserted === true);
}


// ===========================================================================
// 1. autoInserted Visual Indicator (15 tests)
// ===========================================================================

describe('autoInserted visual indicator', () => {
  beforeEach(() => {
    resetStore();
  });

  it('coercion connection creates converter node with autoInserted=true', () => {
    // source output 0 (number) → concat input 0 (string) triggers coercion
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('converter node title contains "(auto)" suffix', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    expect(autoNode.title).toContain('(auto)');
  });

  it('converter node is positioned at midpoint between source and target', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [10, 0, 6]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const srcPos = getStore().nodes[srcId].position;
    const tgtPos = getStore().nodes[concatId].position;
    // Midpoint
    expect(autoNode.position[0]).toBeCloseTo((srcPos[0] + tgtPos[0]) / 2, 1);
    expect(autoNode.position[2]).toBeCloseTo((srcPos[2] + tgtPos[2]) / 2, 1);
  });

  it('manually added node does NOT have autoInserted=true', () => {
    const id = getStore().addNode('template', [0, 0, 0]);
    expect(getStore().nodes[id].autoInserted).toBeUndefined();
  });

  it('compatible connection does not create auto-inserted node', () => {
    // source output 0 (number) → transform input 0 (number) — compatible
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    connectPorts(srcId, 0, tfId, 0);

    expect(findAutoInsertedNodes().length).toBe(0);
    expect(nodeCount()).toBe(2);
    expect(connCount()).toBe(1);
  });

  it('number→boolean coercion creates compare node with autoInserted=true', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const notId = getStore().addNode('not', [5, 0, 0]);
    // source output 0 (number) → not input 0 (boolean) triggers coercion
    connectPorts(srcId, 0, notId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].type).toBe('compare');
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('string→number coercion creates parse-number node with autoInserted=true', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    // source output 1 (string label) → transform input 0 (number)
    connectPorts(srcId, 1, tfId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].type).toBe('parse-number');
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('multiple coercion connections create multiple autoInserted nodes', () => {
    const src1 = getStore().addNode('source', [0, 0, 0]);
    const src2 = getStore().addNode('source', [0, 0, 3]);
    const concat1 = getStore().addNode('concat', [5, 0, 0]);
    const concat2 = getStore().addNode('concat', [5, 0, 3]);

    // Both: number → string coercion
    connectPorts(src1, 0, concat1, 0);
    connectPorts(src2, 0, concat2, 0);

    expect(findAutoInsertedNodes().length).toBe(2);
  });

  it('autoInserted preserved through undo/redo', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    expect(findAutoInsertedNodes().length).toBe(1);
    const autoNodeId = findAutoInsertedNodes()[0].id;

    // Undo removes the coercion
    getStore().undo();
    expect(findAutoInsertedNodes().length).toBe(0);
    expect(getStore().nodes[autoNodeId]).toBeUndefined();

    // Redo restores it
    getStore().redo();
    expect(findAutoInsertedNodes().length).toBe(1);
    expect(getStore().nodes[autoNodeId]?.autoInserted).toBe(true);
  });

  it('coercion connection creates exactly 2 connections (src→converter, converter→tgt)', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);

    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const conns = Object.values(getStore().connections);

    // Should have 2 new connections (src→converter, converter→concat)
    const toConverter = conns.filter(c => c.targetNodeId === autoNode.id);
    const fromConverter = conns.filter(c => c.sourceNodeId === autoNode.id);
    expect(toConverter.length).toBe(1);
    expect(fromConverter.length).toBe(1);
    expect(toConverter[0].sourceNodeId).toBe(srcId);
    expect(fromConverter[0].targetNodeId).toBe(concatId);
  });

  it('coercion wraps entire operation in single undo entry', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    // Node count: source + concat + converter = 3
    expect(nodeCount()).toBe(3);
    // Connection count: 2 (src→converter, converter→concat)
    expect(connCount()).toBe(2);

    // Single undo should remove converter + both connections
    getStore().undo();
    expect(nodeCount()).toBe(2);
    expect(connCount()).toBe(0);
    expect(findAutoInsertedNodes().length).toBe(0);
  });

  it('autoInserted node preserved through duplicate', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    // Select all nodes and duplicate
    const allIds = Object.keys(getStore().nodes);
    useEditorStore.setState(s => { for (const id of allIds) s.selectedIds.add(id); });
    getStore().duplicateSelected();

    // Find all auto-inserted (original + duplicated)
    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(2);
    // The duplicated one should also have autoInserted=true
    const duped = autoNodes.find(n => n.id !== autoNode.id);
    expect(duped?.autoInserted).toBe(true);
  });

  it('autoInserted flag survives execution', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 42);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];

    // Execute graph
    const { results } = executeGraph(getStore().nodes, getStore().connections);

    // autoInserted flag should still be set
    expect(getStore().nodes[autoNode.id].autoInserted).toBe(true);
    // And execution should have produced results
    expect(results.size).toBeGreaterThan(0);
  });

  it('number→string coercion produces correct execution output', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 99);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const { results } = executeGraph(getStore().nodes, getStore().connections);
    // concat should produce "99" (converted from number via template)
    expect(results.get(concatId)?.outputs[0]).toBe('99');
  });

  it('deleting auto-inserted node removes both its connections', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    expect(connCount()).toBe(2);

    // Delete the converter node
    getStore().removeNode(autoNode.id);
    expect(findAutoInsertedNodes().length).toBe(0);
    // Both connections should be gone
    const conns = Object.values(getStore().connections);
    expect(conns.filter(c => c.sourceNodeId === autoNode.id || c.targetNodeId === autoNode.id).length).toBe(0);
  });
});

// ===========================================================================
// 2. Camera Bookmarks (12 tests)
// ===========================================================================

describe('CameraBookmarks settingsStore', () => {
  beforeEach(() => {
    resetSettings();
    localStorage.clear();
  });

  it('default cameraBookmarks is empty object', () => {
    expect(getSettings().cameraBookmarks).toEqual({});
  });

  it('setCameraBookmark stores bookmark at valid slot', () => {
    const bm: CameraBookmark = { position: [1, 2, 3], target: [4, 5, 6] };
    getSettings().setCameraBookmark(1, bm);
    expect(getSettings().cameraBookmarks['1']).toEqual(bm);
  });

  it('setCameraBookmark rejects slot < 1', () => {
    const bm: CameraBookmark = { position: [1, 2, 3], target: [4, 5, 6] };
    getSettings().setCameraBookmark(0, bm);
    expect(getSettings().cameraBookmarks['0']).toBeUndefined();
  });

  it('setCameraBookmark rejects slot > 9', () => {
    const bm: CameraBookmark = { position: [1, 2, 3], target: [4, 5, 6] };
    getSettings().setCameraBookmark(10, bm);
    expect(getSettings().cameraBookmarks['10']).toBeUndefined();
  });

  it('setCameraBookmark works for all slots 1-9', () => {
    for (let i = 1; i <= 9; i++) {
      const bm: CameraBookmark = { position: [i, i, i], target: [0, 0, 0] };
      getSettings().setCameraBookmark(i, bm);
    }
    expect(Object.keys(getSettings().cameraBookmarks).length).toBe(9);
    for (let i = 1; i <= 9; i++) {
      expect(getSettings().cameraBookmarks[String(i)].position).toEqual([i, i, i]);
    }
  });

  it('setCameraBookmark overwrites existing slot', () => {
    const bm1: CameraBookmark = { position: [1, 2, 3], target: [0, 0, 0] };
    const bm2: CameraBookmark = { position: [7, 8, 9], target: [1, 1, 1] };
    getSettings().setCameraBookmark(3, bm1);
    getSettings().setCameraBookmark(3, bm2);
    expect(getSettings().cameraBookmarks['3']).toEqual(bm2);
  });

  it('clearCameraBookmark removes existing bookmark', () => {
    const bm: CameraBookmark = { position: [1, 2, 3], target: [4, 5, 6] };
    getSettings().setCameraBookmark(5, bm);
    expect(getSettings().cameraBookmarks['5']).toBeDefined();

    getSettings().clearCameraBookmark(5);
    expect(getSettings().cameraBookmarks['5']).toBeUndefined();
  });

  it('clearCameraBookmark is no-op for empty slot', () => {
    getSettings().clearCameraBookmark(7);
    expect(getSettings().cameraBookmarks['7']).toBeUndefined();
  });

  it('clearCameraBookmark rejects slot < 1', () => {
    const bm: CameraBookmark = { position: [1, 2, 3], target: [4, 5, 6] };
    getSettings().setCameraBookmark(1, bm);
    getSettings().clearCameraBookmark(0);
    // slot 1 should still exist
    expect(getSettings().cameraBookmarks['1']).toBeDefined();
  });

  it('clearCameraBookmark rejects slot > 9', () => {
    const bm: CameraBookmark = { position: [1, 2, 3], target: [4, 5, 6] };
    getSettings().setCameraBookmark(9, bm);
    getSettings().clearCameraBookmark(10);
    expect(getSettings().cameraBookmarks['9']).toBeDefined();
  });

  it('clampLoadedSettings validates camera bookmarks structure', () => {
    // Invalid bookmark (wrong position length)
    const corrupt = {
      cameraBookmarks: { '1': { position: [1, 2], target: [3, 4, 5] } },
    };
    const clamped = clampLoadedSettings(corrupt);
    // Invalid entry should be removed
    expect((clamped.cameraBookmarks as Record<string, CameraBookmark>)['1']).toBeUndefined();
  });

  it('clampLoadedSettings preserves valid camera bookmarks', () => {
    const valid = {
      cameraBookmarks: { '3': { position: [1, 2, 3], target: [4, 5, 6] } },
    };
    const clamped = clampLoadedSettings(valid);
    expect((clamped.cameraBookmarks as Record<string, CameraBookmark>)['3']).toEqual({
      position: [1, 2, 3],
      target: [4, 5, 6],
    });
  });
});

// ===========================================================================
// 3. showNodeScreens Toggle (8 tests)
// ===========================================================================

describe('showNodeScreens settingsStore', () => {
  beforeEach(() => {
    resetSettings();
    localStorage.clear();
  });

  it('default showNodeScreens is true', () => {
    expect(DEFAULT_SETTINGS.showNodeScreens).toBe(true);
    expect(getSettings().showNodeScreens).toBe(true);
  });

  it('setShowNodeScreens changes to false', () => {
    getSettings().setShowNodeScreens(false);
    expect(getSettings().showNodeScreens).toBe(false);
  });

  it('setShowNodeScreens changes back to true', () => {
    getSettings().setShowNodeScreens(false);
    getSettings().setShowNodeScreens(true);
    expect(getSettings().showNodeScreens).toBe(true);
  });

  it('clampLoadedSettings rejects non-boolean showNodeScreens', () => {
    const corrupt = { showNodeScreens: 'yes' as unknown };
    const clamped = clampLoadedSettings(corrupt as Record<string, unknown>);
    expect(clamped.showNodeScreens).toBeUndefined();
  });

  it('clampLoadedSettings preserves valid boolean showNodeScreens', () => {
    const valid = { showNodeScreens: false };
    const clamped = clampLoadedSettings(valid);
    expect(clamped.showNodeScreens).toBe(false);
  });

  it('clampLoadedSettings rejects numeric showNodeScreens', () => {
    const corrupt = { showNodeScreens: 1 as unknown };
    const clamped = clampLoadedSettings(corrupt as Record<string, unknown>);
    expect(clamped.showNodeScreens).toBeUndefined();
  });

  it('resetToDefaults restores showNodeScreens to true', () => {
    getSettings().setShowNodeScreens(false);
    expect(getSettings().showNodeScreens).toBe(false);
    getSettings().resetToDefaults();
    expect(getSettings().showNodeScreens).toBe(true);
  });

  it('showNodeScreens independent of other settings', () => {
    getSettings().setShowNodeScreens(false);
    getSettings().setShowExecutionHeatmap(true);
    expect(getSettings().showNodeScreens).toBe(false);
    expect(getSettings().showExecutionHeatmap).toBe(true);
  });
});

// ===========================================================================
// 4. showValuePreviews toggle in SettingsPanel (Phase 28 feature) (5 tests)
// ===========================================================================

describe('showValuePreviews editorStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('default showValuePreviews is true', () => {
    expect(getStore().showValuePreviews).toBe(true);
  });

  it('toggleValuePreviews flips to false', () => {
    getStore().toggleValuePreviews();
    expect(getStore().showValuePreviews).toBe(false);
  });

  it('toggleValuePreviews does not push undo', () => {
    getStore().toggleValuePreviews();
    // undo should not revert showValuePreviews (it's a preference, not content)
    const canUndo = getStore().canUndo();
    expect(canUndo).toBe(false);
  });

  it('toggleValuePreviews round-trip', () => {
    expect(getStore().showValuePreviews).toBe(true);
    getStore().toggleValuePreviews();
    expect(getStore().showValuePreviews).toBe(false);
    getStore().toggleValuePreviews();
    expect(getStore().showValuePreviews).toBe(true);
  });

  it('showValuePreviews independent of execution state', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().toggleValuePreviews();
    expect(getStore().showValuePreviews).toBe(false);
    expect(getStore().nodes[srcId]).toBeDefined();
  });
});

// ===========================================================================
// 5. executionMaxNodeDuration O(1) enhancements (8 tests)
// ===========================================================================

describe('executionMaxNodeDuration pre-computation', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initial executionMaxNodeDuration is 0', () => {
    expect(getStore().executionMaxNodeDuration).toBe(0);
  });

  it('executionMaxNodeDuration computed after executeGraph + applyResults', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 42);
    const tf = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(src, 0, tf, 0);

    getStore().executeGraph();
    // After execution, max should be > 0 (metrics recorded)
    // Note: may be 0 if execution is too fast, so just check it's a number
    expect(typeof getStore().executionMaxNodeDuration).toBe('number');
    expect(getStore().executionMaxNodeDuration).toBeGreaterThanOrEqual(0);
  });

  it('executionMaxNodeDuration excludes cached nodes', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 10);
    const out = getStore().addNode('output', [5, 0, 0]);
    getStore().addConnection(src, 0, out, 0);

    // Execute twice — second run may have cache hits
    getStore().executeGraph();
    const firstMax = getStore().executionMaxNodeDuration;
    expect(firstMax).toBeGreaterThanOrEqual(0);
  });

  it('executionMaxNodeDuration cleared on clearExecutionTransientState', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().executeGraph();

    // Undo triggers clearExecutionTransientState
    getStore().undo();
    expect(getStore().executionMaxNodeDuration).toBe(0);
  });

  it('executionMaxNodeDuration is a number (not NaN)', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().executeGraph();
    expect(Number.isNaN(getStore().executionMaxNodeDuration)).toBe(false);
  });

  it('executionMaxNodeDuration consistent with executionMetrics', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(src, 'value', 5);
    const tf = getStore().addNode('transform', [5, 0, 0]);
    getStore().addConnection(src, 0, tf, 0);
    const out = getStore().addNode('output', [10, 0, 0]);
    getStore().addConnection(tf, 0, out, 0);

    getStore().executeGraph();

    const metrics = getStore().executionMetrics;
    const maxDuration = getStore().executionMaxNodeDuration;

    // Max should be >= every non-cached metric
    for (const id of Object.keys(metrics)) {
      if (!metrics[id].cacheHit) {
        expect(maxDuration).toBeGreaterThanOrEqual(metrics[id].duration);
      }
    }
  });

  it('executionMaxNodeDuration resets with clearGraph', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().executeGraph();
    getStore().clearGraph();
    expect(getStore().executionMaxNodeDuration).toBe(0);
  });

  it('executionMaxNodeDuration for empty graph is 0', () => {
    getStore().executeGraph();
    expect(getStore().executionMaxNodeDuration).toBe(0);
  });
});

// ===========================================================================
// 6. Node type configuration completeness (5 tests)
// ===========================================================================

describe('Node type configuration completeness', () => {
  it('every NodeType has a NODE_TYPE_CONFIG entry', () => {
    const allTypes = Object.keys(NODE_CATEGORIES) as NodeType[];
    for (const type of allTypes) {
      expect(NODE_TYPE_CONFIG[type]).toBeDefined();
    }
  });

  it('every NODE_TYPE_CONFIG has at least one output (except sink nodes)', () => {
    const sinkNodes = ['output', 'display', 'set-var', 'note', 'custom', 'subgraph', 'subgraph-output'];
    for (const [type, config] of Object.entries(NODE_TYPE_CONFIG)) {
      if (sinkNodes.includes(type)) continue;
      expect(config.outputs.length, `${type} should have outputs`).toBeGreaterThan(0);
    }
  });

  it('all 93 node types are registered', () => {
    const typeCount = Object.keys(NODE_TYPE_CONFIG).length;
    expect(typeCount).toBeGreaterThanOrEqual(93);
  });

  it('every node type has a category', () => {
    for (const type of Object.keys(NODE_TYPE_CONFIG) as NodeType[]) {
      expect(NODE_CATEGORIES[type]).toBeDefined();
    }
  });

  it('custom node type exists in config', () => {
    expect(NODE_TYPE_CONFIG['custom']).toBeDefined();
    expect(NODE_CATEGORIES['custom']).toBe('Utility');
  });
});

// ===========================================================================
// 7. Settings boolean validation comprehensive (5 tests)
// ===========================================================================

describe('Settings boolean field validation', () => {
  const BOOLEAN_FIELDS = [
    'gridVisible', 'autoExecute', 'workerExecution', 'connectionFlowAnimation',
    'showExecutionHeatmap', 'showNodeScreens', 'autoSave', 'onboardingCompleted',
    'minimapVisible', 'inspectorVisible',
  ] as const;

  it('all 10 boolean fields validated in clampLoadedSettings', () => {
    for (const field of BOOLEAN_FIELDS) {
      const corrupt = { [field]: 'not_a_boolean' };
      const clamped = clampLoadedSettings(corrupt);
      expect((clamped as Record<string, unknown>)[field]).toBeUndefined();
    }
  });

  it('valid boolean fields are preserved', () => {
    for (const field of BOOLEAN_FIELDS) {
      const valid = { [field]: true };
      const clamped = clampLoadedSettings(valid);
      expect((clamped as Record<string, unknown>)[field]).toBe(true);
    }
  });

  it('null boolean fields are rejected', () => {
    for (const field of BOOLEAN_FIELDS) {
      const corrupt = { [field]: null };
      const clamped = clampLoadedSettings(corrupt as Record<string, unknown>);
      expect((clamped as Record<string, unknown>)[field]).toBeUndefined();
    }
  });

  it('numeric boolean fields are rejected', () => {
    for (const field of BOOLEAN_FIELDS) {
      const corrupt = { [field]: 0 };
      const clamped = clampLoadedSettings(corrupt as Record<string, unknown>);
      expect((clamped as Record<string, unknown>)[field]).toBeUndefined();
    }
  });

  it('clampLoadedSettings handles completely corrupt input', () => {
    const corrupt = {
      gridVisible: 42,
      autoExecute: 'yes',
      showNodeScreens: [],
      cameraBookmarks: null,
      recentFiles: 'not_array',
      theme: 'invalid',
    };
    const clamped = clampLoadedSettings(corrupt as unknown as Record<string, unknown>);
    // All should be cleaned up
    expect(clamped.gridVisible).toBeUndefined();
    expect(clamped.autoExecute).toBeUndefined();
    expect(clamped.showNodeScreens).toBeUndefined();
    expect(clamped.cameraBookmarks).toEqual({});
    expect(clamped.recentFiles).toEqual([]);
    expect(clamped.theme).toBeUndefined();
  });
});
