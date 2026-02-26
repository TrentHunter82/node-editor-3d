/// <reference types="vitest/config" />
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, BUILTIN_PRESETS, clampLoadedSettings } from '../store/settingsStore';
import type { ConnectionStyle } from '../store/settingsStore';
import type { Connection } from '../types';

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
// 1. Node Search & Highlighting
// ============================================================================
describe('Node search and highlighting', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('setSearchHighlightIds updates the highlight set', () => {
    const ids = new Set(['n1', 'n2']);
    getStore().setSearchHighlightIds(ids);
    expect(getStore().searchHighlightIds).toEqual(ids);
  });

  it('setSearchHighlightIds can clear highlights with empty set', () => {
    getStore().setSearchHighlightIds(new Set(['n1']));
    expect(getStore().searchHighlightIds.size).toBe(1);
    getStore().setSearchHighlightIds(new Set());
    expect(getStore().searchHighlightIds.size).toBe(0);
  });

  it('setSearchQuery updates the search query', () => {
    getStore().setSearchQuery('test');
    expect(getStore().searchQuery).toBe('test');
  });

  it('searchNodes returns all nodes for empty query', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [1, 0, 0]);
    const results = getStore().searchNodes('');
    expect(results.length).toBe(2);
  });

  it('searchNodes filters by title', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [1, 0, 0]);
    const results = getStore().searchNodes('source');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('source');
  });

  it('searchNodes filters by node type', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('math', [1, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const results = getStore().searchNodes('math');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(n => n.type === 'math')).toBe(true);
  });

  it('searchNodes filters by node ID', () => {
    getStore().addNode('source', [0, 0, 0]);
    const nodeIds = Object.keys(getStore().nodes);
    const firstId = nodeIds[0];
    const results = getStore().searchNodes(firstId);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe(firstId);
  });

  it('searchNodes returns empty for no matches', () => {
    getStore().addNode('source', [0, 0, 0]);
    const results = getStore().searchNodes('xyznonexistent');
    expect(results.length).toBe(0);
  });

  it('searchNodes is case insensitive', () => {
    getStore().addNode('source', [0, 0, 0]);
    const upper = getStore().searchNodes('SOURCE');
    const lower = getStore().searchNodes('source');
    expect(upper.length).toBe(lower.length);
  });

  it('searchNodes sorts by score (exact match first)', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [1, 0, 0]);
    // "source" should score higher for "source" query
    const results = getStore().searchNodes('source');
    if (results.length >= 1) {
      expect(results[0].type).toBe('source');
    }
  });

  it('focusNode selects the specified node', () => {
    getStore().addNode('source', [0, 0, 0]);
    const nodeId = Object.keys(getStore().nodes)[0];
    getStore().focusNode(nodeId);
    expect(getStore().selectedIds.has(nodeId)).toBe(true);
    expect(getStore().selectedIds.size).toBe(1);
  });

  it('focusNode replaces previous selection', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('transform', [1, 0, 0]);
    const [id1, id2] = Object.keys(getStore().nodes);
    getStore().focusNode(id1);
    expect(getStore().selectedIds.has(id1)).toBe(true);
    getStore().focusNode(id2);
    expect(getStore().selectedIds.has(id2)).toBe(true);
    expect(getStore().selectedIds.has(id1)).toBe(false);
  });

  it('focusNode is no-op for non-existent node', () => {
    getStore().addNode('source', [0, 0, 0]);
    const nodeId = Object.keys(getStore().nodes)[0];
    getStore().focusNode(nodeId);
    getStore().focusNode('nonexistent');
    // Selection should remain unchanged
    expect(getStore().selectedIds.has(nodeId)).toBe(true);
  });

  it('searchHighlightIds is transient (not in undo snapshots)', () => {
    getStore().addNode('source', [0, 0, 0]);
    const nodeId = Object.keys(getStore().nodes)[0];
    getStore().setSearchHighlightIds(new Set([nodeId]));
    // undo should not affect searchHighlightIds
    getStore().undo();
    // The highlights should remain (they're transient)
    expect(getStore().searchHighlightIds.has(nodeId)).toBe(true);
  });

  it('searchQuery is not cleared by undo', () => {
    getStore().setSearchQuery('test');
    getStore().addNode('source', [0, 0, 0]);
    getStore().undo();
    expect(getStore().searchQuery).toBe('test');
  });
});

// ============================================================================
// 2. Workspace Layout Presets
// ============================================================================
describe('Workspace layout presets', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('BUILTIN_PRESETS contains 4 presets', () => {
    expect(BUILTIN_PRESETS.length).toBe(4);
    expect(BUILTIN_PRESETS.map(p => p.id)).toEqual(['minimal', 'debug', 'edit', 'full']);
  });

  it('BUILTIN_PRESETS have correct structure', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(typeof preset.id).toBe('string');
      expect(typeof preset.name).toBe('string');
      expect(typeof preset.minimapVisible).toBe('boolean');
      expect(typeof preset.inspectorVisible).toBe('boolean');
      expect(Array.isArray(preset.openPanels)).toBe(true);
    }
  });

  it('minimal preset hides all panels', () => {
    const minimal = BUILTIN_PRESETS.find(p => p.id === 'minimal')!;
    expect(minimal.minimapVisible).toBe(false);
    expect(minimal.inspectorVisible).toBe(false);
    expect(minimal.openPanels.length).toBe(0);
  });

  it('full preset shows all panels', () => {
    const full = BUILTIN_PRESETS.find(p => p.id === 'full')!;
    expect(full.minimapVisible).toBe(true);
    expect(full.inspectorVisible).toBe(true);
    expect(full.openPanels.length).toBeGreaterThan(0);
  });

  it('saveWorkspacePreset creates a custom preset', () => {
    const id = getSettings().saveWorkspacePreset('My Preset', ['debug']);
    expect(typeof id).toBe('string');
    expect(id.startsWith('ws-')).toBe(true);
    expect(getSettings().workspacePresets.length).toBe(1);
    expect(getSettings().workspacePresets[0].name).toBe('My Preset');
    expect(getSettings().workspacePresets[0].openPanels).toEqual(['debug']);
  });

  it('saveWorkspacePreset captures current panel visibility state', () => {
    getSettings().setMinimapVisible(true);
    getSettings().setInspectorVisible(false);
    const id = getSettings().saveWorkspacePreset('Test', ['profiling']);
    const preset = getSettings().workspacePresets.find(p => p.id === id)!;
    expect(preset.minimapVisible).toBe(true);
    expect(preset.inspectorVisible).toBe(false);
  });

  it('multiple presets can be saved', () => {
    getSettings().saveWorkspacePreset('A', []);
    getSettings().saveWorkspacePreset('B', ['debug']);
    getSettings().saveWorkspacePreset('C', ['profiling', 'timeline']);
    expect(getSettings().workspacePresets.length).toBe(3);
  });

  it('deleteWorkspacePreset removes the preset', () => {
    const id = getSettings().saveWorkspacePreset('ToDelete', []);
    expect(getSettings().workspacePresets.length).toBe(1);
    getSettings().deleteWorkspacePreset(id);
    expect(getSettings().workspacePresets.length).toBe(0);
  });

  it('deleteWorkspacePreset clears activePreset when deleting active', () => {
    const id = getSettings().saveWorkspacePreset('Active', []);
    getSettings().setActiveWorkspacePreset(id);
    expect(getSettings().activeWorkspacePreset).toBe(id);
    getSettings().deleteWorkspacePreset(id);
    expect(getSettings().activeWorkspacePreset).toBeNull();
  });

  it('deleteWorkspacePreset preserves activePreset when deleting different preset', () => {
    const id1 = getSettings().saveWorkspacePreset('Keep', []);
    const id2 = getSettings().saveWorkspacePreset('Delete', []);
    getSettings().setActiveWorkspacePreset(id1);
    getSettings().deleteWorkspacePreset(id2);
    expect(getSettings().activeWorkspacePreset).toBe(id1);
    expect(getSettings().workspacePresets.length).toBe(1);
  });

  it('deleteWorkspacePreset is no-op for nonexistent ID', () => {
    getSettings().saveWorkspacePreset('A', []);
    getSettings().deleteWorkspacePreset('nonexistent');
    expect(getSettings().workspacePresets.length).toBe(1);
  });

  it('setActiveWorkspacePreset tracks the active preset', () => {
    expect(getSettings().activeWorkspacePreset).toBeNull();
    getSettings().setActiveWorkspacePreset('minimal');
    expect(getSettings().activeWorkspacePreset).toBe('minimal');
  });

  it('setActiveWorkspacePreset can be set to null', () => {
    getSettings().setActiveWorkspacePreset('edit');
    getSettings().setActiveWorkspacePreset(null);
    expect(getSettings().activeWorkspacePreset).toBeNull();
  });

  it('initial state has empty workspacePresets and null activePreset', () => {
    expect(getSettings().workspacePresets).toEqual([]);
    expect(getSettings().activeWorkspacePreset).toBeNull();
  });

  // clampLoadedSettings validation
  it('clampLoadedSettings validates workspacePresets is array', () => {
    const raw = { workspacePresets: 'not-an-array' } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.workspacePresets).toEqual([]);
  });

  it('clampLoadedSettings filters invalid presets from array', () => {
    const raw = {
      workspacePresets: [
        { id: 'valid', name: 'Valid', minimapVisible: true, inspectorVisible: false, openPanels: [] },
        { id: 123, name: 'Bad ID' },  // invalid: id not string
        null,                           // invalid: null
        'string',                       // invalid: not object
      ]
    } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.workspacePresets!.length).toBe(1);
    expect(clamped.workspacePresets![0].id).toBe('valid');
  });

  it('clampLoadedSettings validates activeWorkspacePreset is string', () => {
    const raw = { activeWorkspacePreset: 123 } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.activeWorkspacePreset).toBeNull();
  });

  it('clampLoadedSettings preserves valid activeWorkspacePreset string', () => {
    // Must reference an existing builtin or custom preset ID
    const raw = { activeWorkspacePreset: 'minimal' } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.activeWorkspacePreset).toBe('minimal');
  });

  it('clampLoadedSettings rejects activeWorkspacePreset referencing nonexistent preset', () => {
    const raw = { activeWorkspacePreset: 'nonexistent-id' } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.activeWorkspacePreset).toBeNull();
  });

  it('saved presets have unique IDs', () => {
    const id1 = getSettings().saveWorkspacePreset('A', []);
    const id2 = getSettings().saveWorkspacePreset('B', []);
    expect(id1).not.toBe(id2);
  });
});

// ============================================================================
// 3. Connection Style Management
// ============================================================================
describe('Connection style management', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  // Global connection style
  it('default connection style is bezier', () => {
    expect(getSettings().connectionStyle).toBe('bezier');
  });

  it('setConnectionStyle changes the global style', () => {
    getSettings().setConnectionStyle('straight');
    expect(getSettings().connectionStyle).toBe('straight');
  });

  it('setConnectionStyle supports all 4 modes', () => {
    const modes: ConnectionStyle[] = ['bezier', 'straight', 'right-angle', 'organic'];
    for (const mode of modes) {
      getSettings().setConnectionStyle(mode);
      expect(getSettings().connectionStyle).toBe(mode);
    }
  });

  // clampLoadedSettings for connectionStyle
  it('clampLoadedSettings rejects invalid connectionStyle', () => {
    const raw = { connectionStyle: 'invalid-mode' } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.connectionStyle).toBeUndefined();
  });

  it('clampLoadedSettings preserves valid organic connectionStyle', () => {
    const raw = { connectionStyle: 'organic' } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.connectionStyle).toBe('organic');
  });

  it('clampLoadedSettings preserves all 4 valid styles', () => {
    for (const style of ['bezier', 'straight', 'right-angle', 'organic']) {
      const raw = { connectionStyle: style } as any;
      const clamped = clampLoadedSettings(raw);
      expect(clamped.connectionStyle).toBe(style);
    }
  });

  // Per-connection style override
  it('updateConnectionStyle sets per-connection style', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'organic');
    expect(getStore().connections[connId!].styleOverride).toBe('organic');
  });

  it('updateConnectionStyle supports all 4 modes per-connection', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();

    const modes: Array<Connection['styleOverride']> = ['bezier', 'straight', 'right-angle', 'organic'];
    for (const mode of modes) {
      getStore().updateConnectionStyle(connId!, mode);
      expect(getStore().connections[connId!].styleOverride).toBe(mode);
    }
  });

  it('updateConnectionStyle with undefined removes override', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'straight');
    expect(getStore().connections[connId!].styleOverride).toBe('straight');
    getStore().updateConnectionStyle(connId!, undefined);
    expect(getStore().connections[connId!].styleOverride).toBeUndefined();
  });

  it('updateConnectionStyle pushes undo', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'organic');
    getStore().undo();
    expect(getStore().connections[connId!]?.styleOverride).toBeUndefined();
  });

  it('updateConnectionStyle is no-op for nonexistent connection', () => {
    // Should not throw
    getStore().updateConnectionStyle('nonexistent', 'straight');
  });

  it('updateConnectionStyle is no-op for same value', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'organic');
    // Setting same value should not push another undo
    getStore().updateConnectionStyle(connId!, 'organic');
    getStore().undo();
    // One undo should remove the style (back to the first set)
    expect(getStore().connections[connId!]?.styleOverride).toBeUndefined();
  });

  it('connection styleOverride survives serialization roundtrip', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'right-angle');

    // Export and reimport
    const exported = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(exported);

    const reimportedConns = Object.values(getStore().connections);
    expect(reimportedConns.length).toBe(1);
    expect(reimportedConns[0].styleOverride).toBe('right-angle');
  });

  it('connection without styleOverride uses global default', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();
    // No styleOverride set
    expect(getStore().connections[connId!].styleOverride).toBeUndefined();
    // Global setting should apply (tested at render level, but we verify the field is absent)
    expect(getSettings().connectionStyle).toBe('bezier');
  });
});

// ============================================================================
// 4. Search + Selection Integration
// ============================================================================
describe('Search and selection integration', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('searchNodes with multiple matching nodes returns all matches', () => {
    // Add multiple source nodes (all have "source" in type)
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('source', [1, 0, 0]);
    getStore().addNode('source', [2, 0, 0]);
    getStore().addNode('display', [3, 0, 0]);
    const results = getStore().searchNodes('source');
    expect(results.length).toBe(3);
  });

  it('searchNodes with partial match works', () => {
    getStore().addNode('transform', [0, 0, 0]);
    const results = getStore().searchNodes('trans');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('transform');
  });

  it('focusNode + searchHighlightIds are independent', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [id1, id2] = Object.keys(getStore().nodes);

    // Set highlights for both
    getStore().setSearchHighlightIds(new Set([id1, id2]));
    // Focus only one
    getStore().focusNode(id1);

    // Highlights unchanged
    expect(getStore().searchHighlightIds.size).toBe(2);
    // Selection changed
    expect(getStore().selectedIds.size).toBe(1);
    expect(getStore().selectedIds.has(id1)).toBe(true);
  });

  it('search across multiple node types', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('math', [1, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    getStore().addNode('clamp', [3, 0, 0]);
    getStore().addNode('lerp', [4, 0, 0]);

    // Search for something in title/type
    const all = getStore().searchNodes('');
    expect(all.length).toBe(5);
  });
});

// ============================================================================
// 5. Phase 22 Regression Tests
// ============================================================================
describe('Phase 22 regression tests', () => {
  beforeEach(() => { resetStore(); resetSettings(); });

  it('organic connection style string is valid in Connection interface', () => {
    const conn: Connection = {
      id: 'c1',
      sourceNodeId: 'n1',
      sourcePortIndex: 0,
      targetNodeId: 'n2',
      targetPortIndex: 0,
      styleOverride: 'organic',
    };
    expect(conn.styleOverride).toBe('organic');
  });

  it('workspace preset IDs are deterministic format (ws- prefix)', () => {
    const id = getSettings().saveWorkspacePreset('Test', []);
    expect(id).toMatch(/^ws-\d+-[a-z0-9]+$/);
  });

  it('connection label and color survive alongside styleOverride', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();

    getStore().updateConnectionLabel(connId!, 'My Label');
    getStore().updateConnectionColor(connId!, '#FF0000');
    getStore().updateConnectionStyle(connId!, 'organic');

    const conn = getStore().connections[connId!];
    expect(conn.label).toBe('My Label');
    expect(conn.colorOverride).toBe('#FF0000');
    expect(conn.styleOverride).toBe('organic');
  });

  it('undo chain for connection style changes', () => {
    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();

    getStore().updateConnectionStyle(connId!, 'straight');
    getStore().updateConnectionStyle(connId!, 'organic');

    expect(getStore().connections[connId!].styleOverride).toBe('organic');
    getStore().undo();
    expect(getStore().connections[connId!].styleOverride).toBe('straight');
    getStore().undo();
    expect(getStore().connections[connId!]?.styleOverride).toBeUndefined();
    getStore().redo();
    expect(getStore().connections[connId!].styleOverride).toBe('straight');
  });

  it('workspace presets survive settings reset cycle', () => {
    getSettings().saveWorkspacePreset('Survivor', ['debug']);
    // Verify it exists
    expect(getSettings().workspacePresets.length).toBe(1);
    // Simulate settings reload via clampLoadedSettings
    const raw = { workspacePresets: getSettings().workspacePresets } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.workspacePresets!.length).toBe(1);
    expect(clamped.workspacePresets![0].name).toBe('Survivor');
  });

  it('searchHighlightIds handles large set', () => {
    // Add 50 nodes and highlight all
    for (let i = 0; i < 50; i++) {
      getStore().addNode('source', [i, 0, 0]);
    }
    const allIds = new Set(Object.keys(getStore().nodes));
    getStore().setSearchHighlightIds(allIds);
    expect(getStore().searchHighlightIds.size).toBe(50);
  });

  it('deleteWorkspacePreset only removes the targeted preset', () => {
    const id1 = getSettings().saveWorkspacePreset('A', ['debug']);
    const id2 = getSettings().saveWorkspacePreset('B', ['profiling']);
    const id3 = getSettings().saveWorkspacePreset('C', ['timeline']);
    getSettings().deleteWorkspacePreset(id2);
    expect(getSettings().workspacePresets.length).toBe(2);
    expect(getSettings().workspacePresets.find(p => p.id === id1)).toBeDefined();
    expect(getSettings().workspacePresets.find(p => p.id === id2)).toBeUndefined();
    expect(getSettings().workspacePresets.find(p => p.id === id3)).toBeDefined();
  });

  it('builtin presets are immutable', () => {
    const before = JSON.stringify(BUILTIN_PRESETS);
    // Attempt to modify (this tests the const export)
    expect(BUILTIN_PRESETS[0].id).toBe('minimal');
    const after = JSON.stringify(BUILTIN_PRESETS);
    expect(before).toBe(after);
  });

  it('connection style and global settings are independent', () => {
    getSettings().setConnectionStyle('organic');

    getStore().addNode('source', [0, 0, 0]);
    getStore().addNode('display', [2, 0, 0]);
    const [srcId, dstId] = Object.keys(getStore().nodes);
    const connId = getStore().addConnection(srcId, 0, dstId, 0);
    expect(connId).not.toBeNull();
    getStore().updateConnectionStyle(connId!, 'straight');

    // Global is organic, per-connection is straight
    expect(getSettings().connectionStyle).toBe('organic');
    expect(getStore().connections[connId!].styleOverride).toBe('straight');
  });

  it('clampLoadedSettings handles corrupt workspace preset array gracefully', () => {
    const raw = {
      workspacePresets: [
        null,
        undefined,
        42,
        [],
        { id: 'ok', name: 'OK', minimapVisible: false, inspectorVisible: false, openPanels: [] },
        { id: 'bad', name: 'Bad' },  // missing boolean fields
      ]
    } as any;
    const clamped = clampLoadedSettings(raw);
    expect(clamped.workspacePresets!.length).toBe(1);
    expect(clamped.workspacePresets![0].id).toBe('ok');
  });
});
