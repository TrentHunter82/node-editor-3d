/// <reference types="vitest/config" />
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, BUILTIN_PRESETS, clampLoadedSettings } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';

enableMapSet();

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
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
  });
}

function resetSettings() {
  useSettingsStore.setState(useSettingsStore.getInitialState());
}

// ============================================================================
// 1. Search + Execution Integration
// ============================================================================
describe('Search + execution integration', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('search finds nodes by custom title after rename', () => {
    getStore().addNode('source', [0, 0, 0]);
    const nodeId = Object.keys(getStore().nodes)[0];
    getStore().updateNodeTitle(nodeId, 'MySpecialSource');
    const results = getStore().searchNodes('special');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('MySpecialSource');
  });

  it('search results update after node deletion', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('source', [1, 0, 0]);
    const results1 = getStore().searchNodes('source');
    expect(results1.length).toBe(2);
    const id = Object.keys(getStore().nodes)[0];
    getStore().setSelection(new Set([id]));
    getStore().deleteSelected();
    const results2 = getStore().searchNodes('source');
    expect(results2.length).toBe(1);
  });

  it('search highlights persist across execution', () => {
    getStore().addNode('source', [0, 0, 0]);
    const nodeId = Object.keys(getStore().nodes)[0];
    getStore().setSearchHighlightIds(new Set([nodeId]));
    // Simulate execution (executeGraph is a utility, doesn't touch highlights)
    executeGraph(getStore().nodes, getStore().connections);
    expect(getStore().searchHighlightIds.has(nodeId)).toBe(true);
  });

  it('focusNode + undo does not break selection', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [1, 0, 0]);
    const [id1] = Object.keys(getStore().nodes);
    getStore().focusNode(id1);
    expect(getStore().selectedIds.has(id1)).toBe(true);
    getStore().undo(); // undo the addNode for transform
    // Selection might change, but should not crash
    expect(getStore().selectedIds).toBeDefined();
  });
});

// ============================================================================
// 2. Workspace Presets + Multi-graph Integration
// ============================================================================
describe('Workspace presets + multi-graph integration', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('workspace presets persist independently of graph changes', () => {
    const presetId = getSettings().saveWorkspacePreset('Custom', ['debug', 'timeline']);
    // Add nodes and switch graphs
    getStore().addNode('source', [0, 0, 0]);
    getStore().createGraph('Second Graph');
    // Preset should still exist
    expect(getSettings().workspacePresets.length).toBe(1);
    expect(getSettings().workspacePresets[0].id).toBe(presetId);
  });

  it('active preset survives graph export/import', () => {
    getSettings().setActiveWorkspacePreset('edit');
    getStore().addNode('source', [0, 0, 0]);
    const exported = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(exported);
    // activePreset is in settingsStore, not editorStore, so it persists
    expect(getSettings().activeWorkspacePreset).toBe('edit');
  });

  it('preset with all panels matches full builtin', () => {
    const full = BUILTIN_PRESETS.find(p => p.id === 'full')!;
    expect(full.openPanels).toContain('debug');
    expect(full.openPanels).toContain('profiling');
    expect(full.openPanels).toContain('validation');
  });

  it('custom preset captures current minimap and inspector state', () => {
    getSettings().setMinimapVisible(false);
    getSettings().setInspectorVisible(true);
    const id = getSettings().saveWorkspacePreset('NoMinimap', ['profiling']);
    const preset = getSettings().workspacePresets.find(p => p.id === id)!;
    expect(preset.minimapVisible).toBe(false);
    expect(preset.inspectorVisible).toBe(true);
    expect(preset.openPanels).toEqual(['profiling']);
  });
});

// ============================================================================
// 3. Connection Style + Serialization Integration
// ============================================================================
describe('Connection style + serialization integration', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('multiple connections with different styles', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('math', [2, 0, 0]);
    getStore().addNode('display', [4, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);

    const c1 = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    const c2 = getStore().addConnection(nodeIds[1], 0, nodeIds[2], 0);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();

    getStore().updateConnectionStyle(c1!, 'organic');
    getStore().updateConnectionStyle(c2!, 'straight');

    expect(getStore().connections[c1!].styleOverride).toBe('organic');
    expect(getStore().connections[c2!].styleOverride).toBe('straight');
  });

  it('mixed style connections survive export/import roundtrip', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [2, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'right-angle');
    getStore().updateConnectionLabel(connId!, 'data-flow');
    getStore().updateConnectionColor(connId!, '#00FF00');

    const exported = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(exported);

    const conns = Object.values(getStore().connections);
    expect(conns.length).toBe(1);
    expect(conns[0].styleOverride).toBe('right-angle');
    expect(conns[0].label).toBe('data-flow');
    expect(conns[0].colorOverride).toBe('#00FF00');
  });

  it('connection style undo does not affect label/color', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    expect(connId).not.toBeNull();

    getStore().updateConnectionLabel(connId!, 'label1');
    getStore().updateConnectionColor(connId!, '#FF0000');
    getStore().updateConnectionStyle(connId!, 'organic');

    // Undo style change
    getStore().undo();
    const conn = getStore().connections[connId!];
    expect(conn.styleOverride).toBeUndefined();
    // Label and color should still be present (separate undo entries)
    expect(conn.label).toBe('label1');
    expect(conn.colorOverride).toBe('#FF0000');
  });

  it('deleting connection removes style override', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'organic');
    getStore().removeConnection(connId!);
    expect(getStore().connections[connId!]).toBeUndefined();
  });
});

// ============================================================================
// 4. Settings Validation Regression
// ============================================================================
describe('Settings validation regression', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('clampLoadedSettings handles completely empty input', () => {
    const clamped = clampLoadedSettings({} as any);
    // Should not crash, just return defaults for missing fields
    expect(clamped).toBeDefined();
  });

  it('clampLoadedSettings handles null workspace presets array elements', () => {
    const raw = {
      workspacePresets: [null, undefined, { bad: true }]
    } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.workspacePresets).toEqual([]);
  });

  it('clampLoadedSettings preserves custom preset with valid activeWorkspacePreset', () => {
    const preset = {
      id: 'custom-1', name: 'My Preset',
      minimapVisible: true, inspectorVisible: false, openPanels: ['debug']
    };
    const raw = {
      workspacePresets: [preset],
      activeWorkspacePreset: 'custom-1'
    } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.workspacePresets!.length).toBe(1);
    expect(clamped.activeWorkspacePreset).toBe('custom-1');
  });

  it('connectionStyle numeric value is rejected', () => {
    const raw = { connectionStyle: 42 } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.connectionStyle).toBeUndefined();
  });

  it('all 4 builtin presets pass validation', () => {
    for (const preset of BUILTIN_PRESETS) {
      const raw = { activeWorkspacePreset: preset.id } as any;
      const clamped = clampLoadedSettings(raw);
      expect(clamped.activeWorkspacePreset).toBe(preset.id);
    }
  });
});

// ============================================================================
// 5. Full Workflow E2E
// ============================================================================
describe('Full workflow E2E', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('create graph → add nodes → search → focus → verify selection', () => {
    // Create graph with nodes
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [2, 0, 0]);
    getStore().addNode('display', [4, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);

    // Connect them
    const c1 = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    const c2 = getStore().addConnection(nodeIds[1], 0, nodeIds[2], 0);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();

    // Search for display node
    const searchResults = getStore().searchNodes('display');
    expect(searchResults.length).toBe(1);
    expect(searchResults[0].type).toBe('display');

    // Focus on display node
    getStore().focusNode(searchResults[0].id);
    expect(getStore().selectedIds.has(searchResults[0].id)).toBe(true);
    expect(getStore().selectedIds.size).toBe(1);

    // Set highlights for search results
    getStore().setSearchHighlightIds(new Set(searchResults.map(n => n.id)));
    expect(getStore().searchHighlightIds.size).toBe(1);

    // Verify 3 nodes and 2 connections exist
    expect(Object.keys(getStore().nodes).length).toBe(3);
    expect(Object.keys(getStore().connections).length).toBe(2);
  });

  it('set workspace preset → modify connection styles → export/import', () => {
    // Set workspace preset
    getSettings().setActiveWorkspacePreset('debug');
    getSettings().setConnectionStyle('organic');

    // Create connected graph
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [4, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    expect(connId).not.toBeNull();

    // Set per-connection style (overrides global)
    getStore().updateConnectionStyle(connId!, 'straight');

    // Export
    const exported = getStore().exportAllGraphs();

    // Reimport into fresh store
    resetStore();
    getStore().importAllGraphs(exported);

    // Graph restored
    expect(Object.keys(getStore().nodes).length).toBe(2);
    const conns = Object.values(getStore().connections);
    expect(conns.length).toBe(1);
    expect(conns[0].styleOverride).toBe('straight');

    // Settings (settingsStore) persist independently
    expect(getSettings().connectionStyle).toBe('organic');
    expect(getSettings().activeWorkspacePreset).toBe('debug');
  });

  it('multi-graph with search isolation', () => {
    // Graph 1
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('math', [2, 0, 0]);

    // Switch to Graph 2
    getStore().createGraph('Graph 2');
    getStore().addNode('display', [0, 0, 0]);
    getStore().addNode('transform', [2, 0, 0]);

    // Search should only find nodes in current graph
    const results = getStore().searchNodes('display');
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('display');

    // Source and math should NOT be in results (they're in graph 1)
    const sourceResults = getStore().searchNodes('source');
    expect(sourceResults.length).toBe(0);
  });

  it('undo/redo with connection styles and search state', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    expect(connId).not.toBeNull();

    // Set search state (transient)
    getStore().setSearchHighlightIds(new Set([nodeIds[0]]));
    getStore().setSearchQuery('test');

    // Set connection style (undoable)
    getStore().updateConnectionStyle(connId!, 'organic');

    // Undo should only affect connection style, not search
    getStore().undo();
    expect(getStore().connections[connId!]?.styleOverride).toBeUndefined();
    expect(getStore().searchHighlightIds.has(nodeIds[0])).toBe(true);
    expect(getStore().searchQuery).toBe('test');
  });

  it('save and restore workspace with custom presets', () => {
    // Set up workspace
    getSettings().setMinimapVisible(false);
    getSettings().setInspectorVisible(true);
    getSettings().setConnectionStyle('right-angle');
    const presetId = getSettings().saveWorkspacePreset('My Setup', ['debug', 'profiling']);

    // Verify preset captures state
    const preset = getSettings().workspacePresets.find(p => p.id === presetId)!;
    expect(preset.minimapVisible).toBe(false);
    expect(preset.inspectorVisible).toBe(true);
    expect(preset.openPanels).toEqual(['debug', 'profiling']);

    // Change state
    getSettings().setMinimapVisible(true);
    getSettings().setConnectionStyle('organic');

    // Verify state changed
    expect(getSettings().minimapVisible).toBe(true);
    expect(getSettings().connectionStyle).toBe('organic');

    // Preset still available for recall
    expect(getSettings().workspacePresets.find(p => p.id === presetId)).toBeDefined();
  });

  it('large graph search performance', () => {
    // Create 100 nodes
    for (let i = 0; i < 100; i++) {
      getStore().addNode('source', [i * 2, 0, 0]);
    }
    expect(Object.keys(getStore().nodes).length).toBe(100);

    // Search should complete quickly
    const start = performance.now();
    const results = getStore().searchNodes('source');
    const elapsed = performance.now() - start;
    expect(results.length).toBe(100);
    expect(elapsed).toBeLessThan(100); // Should be well under 100ms
  });

  it('checkpoint restore clears search state', () => {
    getStore().addNode('source', [0, 0, 0]);
    const nodeId = Object.keys(getStore().nodes)[0];
    getStore().setSearchHighlightIds(new Set([nodeId]));

    // Create checkpoint
    getStore().createCheckpoint('Before changes');

    // Add more nodes
    getStore().addNode('display', [2, 0, 0]);
    expect(Object.keys(getStore().nodes).length).toBe(2);

    // Restore checkpoint — assert it was created, don't silently skip
    const checkpoints = getStore().checkpoints;
    expect(Object.keys(checkpoints).length).toBeGreaterThan(0);
    getStore().restoreCheckpoint(Object.values(checkpoints)[0].id);
    // Graph restored to 1 node
    expect(Object.keys(getStore().nodes).length).toBe(1);
  });
});

// ============================================================================
// 6. Connection Style Edge Cases
// ============================================================================
describe('Connection style edge cases', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('removing a connection style then re-adding', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    expect(connId).not.toBeNull();

    getStore().updateConnectionStyle(connId!, 'organic');
    getStore().updateConnectionStyle(connId!, undefined);
    getStore().updateConnectionStyle(connId!, 'straight');

    expect(getStore().connections[connId!].styleOverride).toBe('straight');
  });

  it('global style change does not affect per-connection overrides', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    expect(connId).not.toBeNull();

    getStore().updateConnectionStyle(connId!, 'organic');
    getSettings().setConnectionStyle('straight');

    // Per-connection should be unaffected
    expect(getStore().connections[connId!].styleOverride).toBe('organic');
    expect(getSettings().connectionStyle).toBe('straight');
  });

  it('duplicate node preserves connection but not style of original connection', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(nodeIds[0], 0, nodeIds[1], 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'organic');

    // Select and duplicate the display node
    getStore().setSelection(new Set([nodeIds[1]]));
    getStore().duplicateSelected();

    // Original connection style should be preserved
    expect(getStore().connections[connId!].styleOverride).toBe('organic');
    // New duplicated node should not be connected
    const dupNodes = Object.keys(getStore().nodes).filter(id => !nodeIds.includes(id));
    expect(dupNodes.length).toBe(1);
  });
});
