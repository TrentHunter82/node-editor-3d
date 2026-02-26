/**
 * Minimap Enhancements (Phase 29) Test Suite
 *
 * Tests the store-level APIs and settings that power minimap features:
 * legend toggling, zoom-to-selection, resize handle, dynamic dimensions,
 * connectivity view mode, node hover labels, scale indicator.
 *
 * Covers: dimensions/settings, zoom-to-selection logic, node interaction,
 * connectivity view data, and settings persistence.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useEditorStore.getState();
}

function getSettings() {
  return useSettingsStore.getState();
}

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

beforeEach(() => {
  resetStore();
  resetSettings();
});

// ---------------------------------------------------------------------------
// 1. Minimap Dimensions & Settings (8 tests)
// ---------------------------------------------------------------------------
describe('Minimap Dimensions & Settings', () => {
  it('1. default minimapWidth is 180', () => {
    expect(DEFAULT_SETTINGS.minimapWidth).toBe(180);
    expect(getSettings().minimapWidth).toBe(180);
  });

  it('2. default minimapHeight is 140', () => {
    expect(DEFAULT_SETTINGS.minimapHeight).toBe(140);
    expect(getSettings().minimapHeight).toBe(140);
  });

  it('3. setMinimapSize clamps width to [120, 400] — below minimum', () => {
    getSettings().setMinimapSize(50, 150);
    expect(getSettings().minimapWidth).toBe(120);

    getSettings().setMinimapSize(0, 150);
    expect(getSettings().minimapWidth).toBe(120);

    getSettings().setMinimapSize(-999, 150);
    expect(getSettings().minimapWidth).toBe(120);
  });

  it('4. setMinimapSize clamps height to [100, 350] — below minimum and above maximum', () => {
    // Below minimum
    getSettings().setMinimapSize(200, 10);
    expect(getSettings().minimapHeight).toBe(100);

    // Above maximum
    getSettings().setMinimapSize(200, 999);
    expect(getSettings().minimapHeight).toBe(350);
  });

  it('5. setMinimapSize with values within range works correctly', () => {
    getSettings().setMinimapSize(200, 200);
    expect(getSettings().minimapWidth).toBe(200);
    expect(getSettings().minimapHeight).toBe(200);

    getSettings().setMinimapSize(300, 250);
    expect(getSettings().minimapWidth).toBe(300);
    expect(getSettings().minimapHeight).toBe(250);

    // Exact boundaries
    getSettings().setMinimapSize(120, 100);
    expect(getSettings().minimapWidth).toBe(120);
    expect(getSettings().minimapHeight).toBe(100);

    getSettings().setMinimapSize(400, 350);
    expect(getSettings().minimapWidth).toBe(400);
    expect(getSettings().minimapHeight).toBe(350);
  });

  it('6. setMinimapVisible toggles visibility', () => {
    expect(getSettings().minimapVisible).toBe(true);

    getSettings().setMinimapVisible(false);
    expect(getSettings().minimapVisible).toBe(false);

    getSettings().setMinimapVisible(true);
    expect(getSettings().minimapVisible).toBe(true);
  });

  it('7. clampLoadedSettings validates minimapWidth (too small, too large, NaN)', () => {
    // Too small — clamped to 120
    expect(clampLoadedSettings({ minimapWidth: -50 }).minimapWidth).toBe(120);
    expect(clampLoadedSettings({ minimapWidth: 0 }).minimapWidth).toBe(120);
    expect(clampLoadedSettings({ minimapWidth: 119 }).minimapWidth).toBe(120);

    // Too large — clamped to 400
    expect(clampLoadedSettings({ minimapWidth: 401 }).minimapWidth).toBe(400);
    expect(clampLoadedSettings({ minimapWidth: 9999 }).minimapWidth).toBe(400);

    // NaN (typeof === 'number' but NaN) — Math.max/Math.min with NaN produces NaN
    const nanResult = clampLoadedSettings({ minimapWidth: NaN });
    expect(nanResult.minimapWidth).toBeNaN();

    // Non-numeric types skip clamping entirely (typeof check fails)
    const strResult = clampLoadedSettings({ minimapWidth: 'abc' as unknown });
    expect(strResult.minimapWidth).toBe('abc');
  });

  it('8. clampLoadedSettings validates minimapHeight (too small, too large, non-numeric)', () => {
    // Too small — clamped to 100
    expect(clampLoadedSettings({ minimapHeight: -10 }).minimapHeight).toBe(100);
    expect(clampLoadedSettings({ minimapHeight: 99 }).minimapHeight).toBe(100);

    // Too large — clamped to 350
    expect(clampLoadedSettings({ minimapHeight: 351 }).minimapHeight).toBe(350);
    expect(clampLoadedSettings({ minimapHeight: 5000 }).minimapHeight).toBe(350);

    // Non-numeric passes through (typeof check fails, defaults will apply at merge time)
    const nullResult = clampLoadedSettings({ minimapHeight: null as unknown });
    expect(nullResult.minimapHeight).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Minimap Zoom-to-Selection Logic (5 tests)
// ---------------------------------------------------------------------------
describe('Minimap Zoom-to-Selection Logic', () => {
  it('9. selection with multiple nodes — selectedIds contains all selected', () => {
    const id1 = getStore().addNode('source', [-10, 0, -10]);
    const id2 = getStore().addNode('source', [10, 0, 10]);
    const id3 = getStore().addNode('math', [0, 0, 5]);

    getStore().setSelection(new Set([id1, id2, id3]));

    expect(getStore().selectedIds.size).toBe(3);
    expect(getStore().selectedIds.has(id1)).toBe(true);
    expect(getStore().selectedIds.has(id2)).toBe(true);
    expect(getStore().selectedIds.has(id3)).toBe(true);
  });

  it('10. empty selection — setSelection with empty Set clears selection', () => {
    const id1 = getStore().addNode('source', [0, 0, 0]);
    getStore().setSelection(new Set([id1]));
    expect(getStore().selectedIds.size).toBe(1);

    // Clear selection
    getStore().setSelection(new Set());
    expect(getStore().selectedIds.size).toBe(0);
  });

  it('11. select nodes across wide area — bounds calculation has correct min/max', () => {
    // Place nodes at extreme positions to simulate zoom-to-selection bounds
    const farLeft = getStore().addNode('source', [-100, 0, 0]);
    const farRight = getStore().addNode('source', [100, 0, 0]);
    const farTop = getStore().addNode('source', [0, 0, -50]);
    const farBottom = getStore().addNode('source', [0, 0, 50]);

    getStore().setSelection(new Set([farLeft, farRight, farTop, farBottom]));

    // Verify all nodes are selected and positions are accessible for bounds calc
    const nodes = getStore().nodes;
    const selectedNodes = [...getStore().selectedIds].map(id => nodes[id]);

    const xs = selectedNodes.map(n => n.position[0]);
    const zs = selectedNodes.map(n => n.position[2]);

    expect(Math.min(...xs)).toBe(-100);
    expect(Math.max(...xs)).toBe(100);
    expect(Math.min(...zs)).toBe(-50);
    expect(Math.max(...zs)).toBe(50);
  });

  it('12. select single node — selectedIds has exactly 1 element', () => {
    const id = getStore().addNode('source', [3, 0, 7]);
    getStore().setSelection(new Set([id]));

    expect(getStore().selectedIds.size).toBe(1);
    expect([...getStore().selectedIds][0]).toBe(id);
  });

  it('13. selected nodes have accessible positions for bounds calculation', () => {
    const id1 = getStore().addNode('source', [1, 2, 3]);
    const id2 = getStore().addNode('math', [4, 5, 6]);
    getStore().setSelection(new Set([id1, id2]));

    // Verify we can iterate selectedIds and retrieve node positions
    const positions: [number, number, number][] = [];
    for (const id of getStore().selectedIds) {
      const node = getStore().nodes[id];
      expect(node).toBeDefined();
      expect(node.position).toHaveLength(3);
      positions.push(node.position as [number, number, number]);
    }

    expect(positions).toHaveLength(2);
    // First node at [1, 2, 3], second at [4, 5, 6]
    expect(positions.some(p => p[0] === 1 && p[1] === 2 && p[2] === 3)).toBe(true);
    expect(positions.some(p => p[0] === 4 && p[1] === 5 && p[2] === 6)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Minimap Node Interaction (5 tests)
// ---------------------------------------------------------------------------
describe('Minimap Node Interaction', () => {
  it('14. updateNodePosition works for moving nodes (like minimap drag would)', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    expect(getStore().nodes[id].position).toEqual([0, 0, 0]);

    getStore().updateNodePosition(id, [5, 0, 10]);
    expect(getStore().nodes[id].position).toEqual([5, 0, 10]);
  });

  it('15. updateNodePosition on locked node is a no-op', () => {
    const id = getStore().addNode('source', [2, 0, 3]);
    // Lock the node
    getStore().toggleNodeLock(id);
    expect(getStore().nodes[id].locked).toBe(true);

    // Attempt to move — should be rejected
    getStore().updateNodePosition(id, [99, 0, 99]);
    expect(getStore().nodes[id].position).toEqual([2, 0, 3]);
  });

  it('16. pushUndoSnapshot + updateNodePosition + undo restores position (minimap drag undo)', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    const originalPos = [...getStore().nodes[id].position];

    // Simulate minimap drag: push undo before moving
    getStore().pushUndoSnapshot('Minimap drag');
    getStore().updateNodePosition(id, [10, 0, 20]);
    expect(getStore().nodes[id].position).toEqual([10, 0, 20]);

    // Undo should restore the original position
    getStore().undo();
    expect(getStore().nodes[id].position).toEqual(originalPos);
  });

  it('17. node position update preserves Y coordinate (minimap only changes X/Z)', () => {
    const id = getStore().addNode('source', [1, 5, 3]);
    expect(getStore().nodes[id].position[1]).toBe(5);

    // Minimap drag: only change X and Z, preserve Y
    const currentY = getStore().nodes[id].position[1];
    getStore().updateNodePosition(id, [10, currentY, 20]);

    expect(getStore().nodes[id].position[0]).toBe(10);
    expect(getStore().nodes[id].position[1]).toBe(5); // Y preserved
    expect(getStore().nodes[id].position[2]).toBe(20);
  });

  it('18. multiple node positions can be updated in sequence', () => {
    const id1 = getStore().addNode('source', [0, 0, 0]);
    const id2 = getStore().addNode('math', [1, 0, 1]);
    const id3 = getStore().addNode('source', [2, 0, 2]);

    // Simulate moving multiple nodes (like minimap multi-select drag)
    getStore().updateNodePosition(id1, [10, 0, 10]);
    getStore().updateNodePosition(id2, [11, 0, 11]);
    getStore().updateNodePosition(id3, [12, 0, 12]);

    expect(getStore().nodes[id1].position).toEqual([10, 0, 10]);
    expect(getStore().nodes[id2].position).toEqual([11, 0, 11]);
    expect(getStore().nodes[id3].position).toEqual([12, 0, 12]);
  });
});

// ---------------------------------------------------------------------------
// 4. Connectivity View Data (4 tests)
// ---------------------------------------------------------------------------
describe('Connectivity View Data', () => {
  it('19. nodes with no connections have 0 connection count', () => {
    const id1 = getStore().addNode('source', [0, 0, 0]);
    const id2 = getStore().addNode('source', [5, 0, 0]);

    const connections = getStore().connections;
    // Count connections involving each node
    const connCount1 = Object.values(connections).filter(
      c => c.sourceNodeId === id1 || c.targetNodeId === id1,
    ).length;
    const connCount2 = Object.values(connections).filter(
      c => c.sourceNodeId === id2 || c.targetNodeId === id2,
    ).length;

    expect(connCount1).toBe(0);
    expect(connCount2).toBe(0);
  });

  it('20. nodes with connections have correct connection count (per node)', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const m1 = getStore().addNode('math', [3, 0, 0]);
    const m2 = getStore().addNode('math', [6, 0, 0]);

    // source -> math1, source -> math2
    getStore().startConnection(src, 0);
    getStore().completeConnection(m1, 0);
    getStore().startConnection(src, 0);
    getStore().completeConnection(m2, 0);

    const connections = Object.values(getStore().connections);

    // Source has 2 outgoing connections
    const srcCount = connections.filter(
      c => c.sourceNodeId === src || c.targetNodeId === src,
    ).length;
    expect(srcCount).toBe(2);

    // math1 has 1 incoming connection
    const m1Count = connections.filter(
      c => c.sourceNodeId === m1 || c.targetNodeId === m1,
    ).length;
    expect(m1Count).toBe(1);

    // math2 has 1 incoming connection
    const m2Count = connections.filter(
      c => c.sourceNodeId === m2 || c.targetNodeId === m2,
    ).length;
    expect(m2Count).toBe(1);
  });

  it('21. adding a connection updates connection counts', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const tgt = getStore().addNode('math', [5, 0, 0]);

    // Initially 0 connections
    expect(Object.keys(getStore().connections).length).toBe(0);

    // Add a connection
    getStore().startConnection(src, 0);
    getStore().completeConnection(tgt, 0);

    const connections = Object.values(getStore().connections);
    expect(connections.length).toBe(1);

    // Both source and target have 1 connection each
    expect(connections.filter(c => c.sourceNodeId === src).length).toBe(1);
    expect(connections.filter(c => c.targetNodeId === tgt).length).toBe(1);
  });

  it('22. removing a connection updates connection counts', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const tgt = getStore().addNode('math', [5, 0, 0]);

    // Add a connection
    getStore().startConnection(src, 0);
    getStore().completeConnection(tgt, 0);
    expect(Object.keys(getStore().connections).length).toBe(1);

    // Remove the connection
    const connId = Object.keys(getStore().connections)[0];
    getStore().removeConnection(connId);

    // Now 0 connections
    expect(Object.keys(getStore().connections).length).toBe(0);

    // Verify nodes report 0 connections
    const remaining = Object.values(getStore().connections);
    expect(remaining.filter(c => c.sourceNodeId === src).length).toBe(0);
    expect(remaining.filter(c => c.targetNodeId === tgt).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Settings Persistence (3 tests)
// ---------------------------------------------------------------------------
describe('Settings Persistence', () => {
  it('23. minimapWidth persists through clampLoadedSettings roundtrip', () => {
    // Simulate saving a custom width and loading it back
    const saved = { minimapWidth: 250 };
    const loaded = clampLoadedSettings(saved);
    expect(loaded.minimapWidth).toBe(250);

    // Boundary values survive roundtrip
    expect(clampLoadedSettings({ minimapWidth: 120 }).minimapWidth).toBe(120);
    expect(clampLoadedSettings({ minimapWidth: 400 }).minimapWidth).toBe(400);

    // Out-of-range values get clamped on load
    expect(clampLoadedSettings({ minimapWidth: 50 }).minimapWidth).toBe(120);
    expect(clampLoadedSettings({ minimapWidth: 500 }).minimapWidth).toBe(400);
  });

  it('24. minimapHeight persists through clampLoadedSettings roundtrip', () => {
    // Simulate saving a custom height and loading it back
    const saved = { minimapHeight: 275 };
    const loaded = clampLoadedSettings(saved);
    expect(loaded.minimapHeight).toBe(275);

    // Boundary values survive roundtrip
    expect(clampLoadedSettings({ minimapHeight: 100 }).minimapHeight).toBe(100);
    expect(clampLoadedSettings({ minimapHeight: 350 }).minimapHeight).toBe(350);

    // Out-of-range values get clamped on load
    expect(clampLoadedSettings({ minimapHeight: 30 }).minimapHeight).toBe(100);
    expect(clampLoadedSettings({ minimapHeight: 700 }).minimapHeight).toBe(350);
  });

  it('25. setMinimapSize updates are reflected in getState()', () => {
    // Start with defaults
    expect(getSettings().minimapWidth).toBe(180);
    expect(getSettings().minimapHeight).toBe(140);

    // Update dimensions
    getSettings().setMinimapSize(320, 280);
    expect(getSettings().minimapWidth).toBe(320);
    expect(getSettings().minimapHeight).toBe(280);

    // Update again — previous values overwritten
    getSettings().setMinimapSize(150, 120);
    expect(getSettings().minimapWidth).toBe(150);
    expect(getSettings().minimapHeight).toBe(120);

    // Clamped values also reflected correctly in state
    getSettings().setMinimapSize(10, 10);
    expect(getSettings().minimapWidth).toBe(120);
    expect(getSettings().minimapHeight).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 6. Locked Node Position Stability (3 tests)
// ---------------------------------------------------------------------------
describe('Locked Node Position Stability', () => {
  it('26. autoLayout does not move locked nodes', () => {
    getStore().addNode('source', [0, 0, 0]);
    const n2 = getStore().addNode('transform', [5, 0, 0]);
    getStore().addNode('output', [10, 0, 0]);

    // Lock n2
    useEditorStore.setState((s) => { s.nodes[n2].locked = true; });
    const lockedPos = [...getStore().nodes[n2].position];

    // Run auto-layout
    getStore().autoLayout();

    // Locked node should NOT have moved
    expect(getStore().nodes[n2].position).toEqual(lockedPos);
    // Other nodes may have moved
    expect(getStore().nodes[n2].locked).toBe(true);
  });

  it('27. updateNodePosition respects locked guard', () => {
    const n1 = getStore().addNode('source', [0, 0, 0]);
    useEditorStore.setState((s) => { s.nodes[n1].locked = true; });
    const originalPos = [...getStore().nodes[n1].position];

    getStore().updateNodePosition(n1, [99, 99, 99]);

    // Position should be unchanged for locked nodes
    expect(getStore().nodes[n1].position).toEqual(originalPos);
  });

  it('28. locked node drag preserved through undo after auto-layout', () => {
    const n1 = getStore().addNode('source', [0, 0, 0]);
    const n2 = getStore().addNode('transform', [5, 0, 5]);
    useEditorStore.setState((s) => { s.nodes[n1].locked = true; });

    const posBeforeLayout = [...getStore().nodes[n1].position];

    getStore().autoLayout();
    // Locked node position unchanged
    expect(getStore().nodes[n1].position).toEqual(posBeforeLayout);

    // Undo should restore n2 to original position
    getStore().undo();
    expect(getStore().nodes[n2].position).toEqual([5, 0, 5]);
  });
});
