/**
 * Phase 32 E2E Regression Tests
 *
 * Covers Phase 31-32 bug fixes and features (~25 tests):
 * 1. Locked node guards in layout operations (autoLayout, alignSelected,
 *    distributeSelected, createGroup, deleteSelected)
 * 2. Overview mode (settingsStore toggle/set/persistence)
 * 3. Breakpoint features (toggle, conditions, clear)
 * 4. Node pinning/favorites (pin, unpin, max 10, clampLoadedSettings)
 * 5. Execution statistics (initial state, accumulation, reset on import)
 * 6. Graph merge import (tab suffix, workspace preservation, single undo)
 * 7. autoInserted metadata (manual addNode, duplicate, paste)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings } from '../store/settingsStore';
import { NODE_TYPE_CONFIG } from '../types';
import type { MultiGraphStorage } from '../utils/serialization';
import type { EditorNode, Connection } from '../types';

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
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.executionStats = {
      executionCount: 0,
      totalDuration: 0,
      errorCount: 0,
      totalCacheHits: 0,
      totalNodesExecuted: 0,
      lastExecutedAt: null,
      timeoutCount: 0,
    };
  });
}

function resetSettings() {
  useSettingsStore.setState(useSettingsStore.getInitialState());
}

/**
 * Allow subsequent executeGraph() calls within the same test.
 * After applyResults sets isExecuting=true, we flip it back so the next
 * call can proceed without waiting for the setTimeout to clear it.
 */
function allowNextExecution(): void {
  useEditorStore.setState(s => { s.isExecuting = false; });
}

/** Create a minimal EditorNode for a given type. */
function makeNode(id: string, type: keyof typeof NODE_TYPE_CONFIG): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data: {},
    inputs: config.inputs.map((p, i) => ({ id: `${id}-in-${i}`, label: p.label, portType: p.portType })),
    outputs: config.outputs.map((p, i) => ({ id: `${id}-out-${i}`, label: p.label, portType: p.portType })),
  };
}

/** Create a minimal Connection. */
function _makeConn(
  id: string,
  sourceNodeId: string,
  sourcePortIndex: number,
  targetNodeId: string,
  targetPortIndex: number,
): Connection {
  return { id, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex };
}
void _makeConn; // suppress unused warning — kept as test helper

/** Build a minimal MultiGraphStorage fixture. */
function makeStorage(
  graphs: Record<string, { nodes: Record<string, EditorNode>; connections: Record<string, Connection> }>,
  graphTabs?: Record<string, { id: string; name: string; createdAt: number }>,
): MultiGraphStorage {
  const storage: MultiGraphStorage = {
    version: 2,
    graphs: {},
    graphTabs: graphTabs ?? {},
    activeGraphId: Object.keys(graphs)[0] ?? 'g1',
    graphOrder: Object.keys(graphs),
    templates: {},
  };
  for (const [gid, g] of Object.entries(graphs)) {
    storage.graphs[gid] = {
      nodes: g.nodes,
      connections: g.connections,
      groups: {},
      customNodeDefs: {},
    };
    if (!storage.graphTabs[gid]) {
      storage.graphTabs[gid] = { id: gid, name: `Graph ${gid}`, createdAt: Date.now() };
    }
  }
  return storage;
}

beforeEach(() => {
  resetStore();
  resetSettings();
});

// ===========================================================================
// 1. Locked Node Guards in Layout Operations (5 tests)
// ===========================================================================

describe('Locked node guards in layout operations', () => {
  it('1. autoLayout does NOT move locked nodes', () => {
    const s = getStore();
    const a = s.addNode('source', [10, 0, 5]);
    const b = s.addNode('transform', [0, 0, 0]);

    // Lock node a
    useEditorStore.setState((st) => { st.nodes[a].locked = true; });
    const lockedPosBefore: [number, number, number] = [...getStore().nodes[a].position] as [number, number, number];

    // Connect them so layout has something to rearrange
    s.addConnection(a, 0, b, 0);

    s.autoLayout();

    // Locked node a must NOT have moved
    const lockedPosAfter = getStore().nodes[a].position;
    expect(lockedPosAfter[0]).toBe(lockedPosBefore[0]);
    expect(lockedPosAfter[1]).toBe(lockedPosBefore[1]);
    expect(lockedPosAfter[2]).toBe(lockedPosBefore[2]);
  });

  it('2. alignSelected skips locked nodes', () => {
    const s = getStore();
    const a = s.addNode('source', [0, 0, 0]);
    const b = s.addNode('source', [5, 0, 0]);
    const c = s.addNode('source', [10, 0, 0]);

    // Lock node b at its original position
    useEditorStore.setState((st) => { st.nodes[b].locked = true; });
    const lockedPosBefore: [number, number, number] = [...getStore().nodes[b].position] as [number, number, number];

    // Select all three
    s.setSelection(new Set([a, b, c]));
    s.alignSelected('center-x');

    // Locked node b must NOT have moved
    const lockedPosAfter = getStore().nodes[b].position;
    expect(lockedPosAfter[0]).toBe(lockedPosBefore[0]);
    expect(lockedPosAfter[1]).toBe(lockedPosBefore[1]);
    expect(lockedPosAfter[2]).toBe(lockedPosBefore[2]);
  });

  it('3. distributeSelected skips locked nodes', () => {
    const s = getStore();
    const a = s.addNode('source', [0, 0, 0]);
    const b = s.addNode('source', [3, 0, 0]);
    const c = s.addNode('source', [6, 0, 0]);
    const d = s.addNode('source', [12, 0, 0]);

    // Lock node b
    useEditorStore.setState((st) => { st.nodes[b].locked = true; });
    const lockedPosBefore: [number, number, number] = [...getStore().nodes[b].position] as [number, number, number];

    // Select all four (distributeSelected requires >= 3)
    s.setSelection(new Set([a, b, c, d]));
    s.distributeSelected('horizontal');

    // Locked node b must NOT have moved
    const lockedPosAfter = getStore().nodes[b].position;
    expect(lockedPosAfter[0]).toBe(lockedPosBefore[0]);
    expect(lockedPosAfter[1]).toBe(lockedPosBefore[1]);
    expect(lockedPosAfter[2]).toBe(lockedPosBefore[2]);
  });

  it('4. createGroup excludes locked nodes from group membership', () => {
    const s = getStore();
    const a = s.addNode('source', [0, 0, 0]);
    const b = s.addNode('source', [3, 0, 0]);
    const c = s.addNode('source', [6, 0, 0]);

    // Lock node c
    useEditorStore.setState((st) => { st.nodes[c].locked = true; });

    // Select all three and create group
    s.setSelection(new Set([a, b, c]));
    const groupId = s.createGroup('Test Group');
    expect(groupId).not.toBeNull();

    // The group should only contain the two unlocked nodes
    const groupedNodes = Object.values(getStore().nodes).filter(n => n.groupId === groupId);
    expect(groupedNodes.length).toBe(2);

    // Locked node c should NOT be in the group
    expect(getStore().nodes[c].groupId).toBeUndefined();
    // Unlocked nodes should be in the group
    expect(getStore().nodes[a].groupId).toBe(groupId);
    expect(getStore().nodes[b].groupId).toBe(groupId);
  });

  it('5. locked nodes cannot be removed via deleteSelected', () => {
    const s = getStore();
    const a = s.addNode('source', [0, 0, 0]);
    const b = s.addNode('source', [3, 0, 0]);
    const c = s.addNode('source', [6, 0, 0]);

    // Lock node b
    s.toggleNodeLock(b);
    expect(getStore().nodes[b].locked).toBe(true);

    // Select all three and delete
    s.setSelection(new Set([a, b, c]));
    s.deleteSelected();

    // Only the locked node should survive
    expect(getStore().nodes[a]).toBeUndefined();
    expect(getStore().nodes[b]).toBeDefined();
    expect(getStore().nodes[c]).toBeUndefined();
  });
});

// ===========================================================================
// 2. Overview Mode (4 tests)
// ===========================================================================

describe('Overview mode', () => {
  it('6. overviewMode defaults to false in settingsStore', () => {
    expect(getSettings().overviewMode).toBe(false);
  });

  it('7. toggleOverviewMode flips the value', () => {
    expect(getSettings().overviewMode).toBe(false);

    getSettings().toggleOverviewMode();
    expect(getSettings().overviewMode).toBe(true);

    getSettings().toggleOverviewMode();
    expect(getSettings().overviewMode).toBe(false);
  });

  it('8. setOverviewMode(true/false) sets explicitly', () => {
    getSettings().setOverviewMode(true);
    expect(getSettings().overviewMode).toBe(true);

    getSettings().setOverviewMode(false);
    expect(getSettings().overviewMode).toBe(false);

    // Idempotent — setting to same value is a no-op
    getSettings().setOverviewMode(true);
    getSettings().setOverviewMode(true);
    expect(getSettings().overviewMode).toBe(true);
  });

  it('9. overviewMode persists through clampLoadedSettings', () => {
    // Valid boolean value passes through
    const result1 = clampLoadedSettings({ overviewMode: true } as any);
    expect(result1.overviewMode).toBe(true);

    const result2 = clampLoadedSettings({ overviewMode: false } as any);
    expect(result2.overviewMode).toBe(false);
  });
});

// ===========================================================================
// 3. Breakpoint Features (4 tests)
// ===========================================================================

describe('Breakpoint features', () => {
  it('10. toggleBreakpoint sets and clears', () => {
    const s = getStore();
    const id = s.addNode('source', [0, 0, 0]);

    // Toggle ON
    s.toggleBreakpoint(id);
    expect(getStore().breakpoints[id]).toBe(true);

    // Toggle OFF
    s.toggleBreakpoint(id);
    expect(getStore().breakpoints[id]).toBeUndefined();
  });

  it('11. setBreakpointCondition auto-creates breakpoint', () => {
    const s = getStore();
    const id = s.addNode('source', [0, 0, 0]);

    // No breakpoint initially
    expect(getStore().breakpoints[id]).toBeUndefined();

    s.setBreakpointCondition(id, 'out0 > 5');

    // Breakpoint should be auto-created
    expect(getStore().breakpoints[id]).toBe(true);
    expect(getStore().breakpointConditions[id]).toBe('out0 > 5');
  });

  it('12. clearBreakpointCondition removes only condition, keeps breakpoint', () => {
    const s = getStore();
    const id = s.addNode('source', [0, 0, 0]);

    // Set breakpoint and condition
    s.toggleBreakpoint(id);
    s.setBreakpointCondition(id, 'out0 > 10');
    expect(getStore().breakpointConditions[id]).toBe('out0 > 10');
    expect(getStore().breakpoints[id]).toBe(true);

    // Clear only the condition
    s.clearBreakpointCondition(id);

    // Condition removed but breakpoint still present
    expect(getStore().breakpointConditions[id]).toBeUndefined();
    expect(getStore().breakpoints[id]).toBe(true);
  });

  it('13. clearAllBreakpoints removes all breakpoints and conditions', () => {
    const s = getStore();
    const id1 = s.addNode('source', [0, 0, 0]);
    const id2 = s.addNode('transform', [5, 0, 0]);

    s.toggleBreakpoint(id1);
    s.setBreakpointCondition(id2, 'out0 !== null');

    expect(Object.keys(getStore().breakpoints).length).toBeGreaterThan(0);
    expect(Object.keys(getStore().breakpointConditions).length).toBeGreaterThan(0);

    s.clearAllBreakpoints();

    expect(getStore().breakpoints).toEqual({});
    expect(getStore().breakpointConditions).toEqual({});
  });
});

// ===========================================================================
// 4. Node Pinning/Favorites (3 tests)
// ===========================================================================

describe('Node pinning/favorites', () => {
  it('14. pinNodeType adds type, max 10 enforced', () => {
    getSettings().pinNodeType('source');
    getSettings().pinNodeType('transform');
    expect(getSettings().pinnedNodeTypes).toContain('source');
    expect(getSettings().pinnedNodeTypes).toContain('transform');
    expect(getSettings().pinnedNodeTypes.length).toBe(2);

    // Fill up to 10
    const types = ['filter', 'output', 'merge', 'split', 'delay', 'math', 'compare', 'switch'];
    for (const t of types) {
      getSettings().pinNodeType(t);
    }
    expect(getSettings().pinnedNodeTypes.length).toBe(10);

    // 11th type should be a no-op
    getSettings().pinNodeType('custom');
    expect(getSettings().pinnedNodeTypes.length).toBe(10);
    expect(getSettings().pinnedNodeTypes).not.toContain('custom');
  });

  it('15. unpinNodeType removes type', () => {
    getSettings().pinNodeType('source');
    getSettings().pinNodeType('transform');
    getSettings().pinNodeType('math');
    expect(getSettings().pinnedNodeTypes.length).toBe(3);

    getSettings().unpinNodeType('transform');

    expect(getSettings().pinnedNodeTypes).not.toContain('transform');
    expect(getSettings().pinnedNodeTypes).toContain('source');
    expect(getSettings().pinnedNodeTypes).toContain('math');
    expect(getSettings().pinnedNodeTypes.length).toBe(2);
  });

  it('16. pinnedNodeTypes persists through clampLoadedSettings', () => {
    // Non-array becomes empty
    const result1 = clampLoadedSettings({ pinnedNodeTypes: 'not-an-array' } as any);
    expect(result1.pinnedNodeTypes).toEqual([]);

    // Non-string elements reset to empty
    const result2 = clampLoadedSettings({ pinnedNodeTypes: [1, 2, 3] } as any);
    expect(result2.pinnedNodeTypes).toEqual([]);

    // Valid array exceeding 10 entries is sliced to 10
    const longList = Array.from({ length: 15 }, (_, i) => `type-${i}`);
    const result3 = clampLoadedSettings({ pinnedNodeTypes: longList } as any);
    expect(result3.pinnedNodeTypes).toHaveLength(10);
    expect(result3.pinnedNodeTypes).toEqual(longList.slice(0, 10));

    // Valid short array is preserved as-is
    const result4 = clampLoadedSettings({ pinnedNodeTypes: ['source', 'filter'] } as any);
    expect(result4.pinnedNodeTypes).toEqual(['source', 'filter']);
  });
});

// ===========================================================================
// 5. Execution Statistics (3 tests)
// ===========================================================================

describe('Execution statistics', () => {
  it('17. executionStats initial state is zeroed', () => {
    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });

  it('18. executionStats accumulates after executeGraph', () => {
    const s = getStore();
    const src = s.addNode('source', [0, 0, 0]);
    s.updateNodeData(src, 'value', 42);
    const disp = s.addNode('display', [5, 0, 0]);
    s.startConnection(src, 0);
    s.completeConnection(disp, 0);

    s.executeGraph();
    const statsAfterFirst = getStore().executionStats;
    expect(statsAfterFirst.executionCount).toBe(1);
    expect(statsAfterFirst.lastExecutedAt).not.toBeNull();
    expect(statsAfterFirst.totalNodesExecuted).toBeGreaterThan(0);

    // Second execution
    allowNextExecution();
    s.executeGraph();
    const statsAfterSecond = getStore().executionStats;
    expect(statsAfterSecond.executionCount).toBe(2);
    expect(statsAfterSecond.totalNodesExecuted).toBeGreaterThan(statsAfterFirst.totalNodesExecuted);
  });

  it('19. executionStats cleared on importWorkflow', () => {
    const s = getStore();
    const src = s.addNode('source', [0, 0, 0]);
    s.updateNodeData(src, 'value', 10);
    s.executeGraph();
    expect(getStore().executionStats.executionCount).toBe(1);

    // Import a fresh workflow
    const srcConf = NODE_TYPE_CONFIG.source;
    s.importWorkflow({
      nodes: {
        n1: {
          id: 'n1',
          type: 'source',
          position: [0, 0, 0],
          title: 'Imported',
          data: { value: 1 },
          inputs: srcConf.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
          outputs: srcConf.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
        },
      },
      connections: {},
    });

    const stats = getStore().executionStats;
    expect(stats.executionCount).toBe(0);
    expect(stats.totalDuration).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.totalCacheHits).toBe(0);
    expect(stats.totalNodesExecuted).toBe(0);
    expect(stats.lastExecutedAt).toBeNull();
  });
});

// ===========================================================================
// 6. Graph Merge Import (3 tests)
// ===========================================================================

describe('Graph merge import', () => {
  it('20. mergeImportedGraphs adds new graph tabs with "(imported)" suffix', () => {
    const s = getStore();
    const beforeTabCount = Object.keys(getStore().graphTabs).length;

    const storage = makeStorage(
      {
        g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
        g2: { nodes: { n2: makeNode('n2', 'math') }, connections: {} },
      },
      {
        g1: { id: 'g1', name: 'Scene A', createdAt: 1000 },
        g2: { id: 'g2', name: 'Scene B', createdAt: 2000 },
      },
    );
    s.mergeImportedGraphs(storage);

    // Two new tabs should have been added
    expect(Object.keys(getStore().graphTabs).length).toBe(beforeTabCount + 2);

    // Both imported tabs should have "(imported)" suffix
    const allTabs = Object.values(getStore().graphTabs);
    const importedTabs = allTabs.filter(t => t.name.endsWith('(imported)'));
    expect(importedTabs).toHaveLength(2);

    const names = importedTabs.map(t => t.name);
    expect(names).toContain('Scene A (imported)');
    expect(names).toContain('Scene B (imported)');
  });

  it('21. mergeImportedGraphs preserves active workspace (does not switch graphs)', () => {
    const s = getStore();
    // Add a node so the active workspace has content
    const existingNode = s.addNode('source', [1, 2, 3]);
    expect(getStore().activeGraphId).toBe('default');

    const storage = makeStorage({
      imported1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    // Active graph must still be 'default'
    expect(getStore().activeGraphId).toBe('default');
    // Existing node must still be present in the active graph
    expect(getStore().nodes[existingNode]).toBeDefined();
  });

  it('22. mergeImportedGraphs creates a single undo entry', () => {
    const s = getStore();
    expect(s.canUndo()).toBe(false);

    const storage = makeStorage({
      g1: { nodes: { n1: makeNode('n1', 'source') }, connections: {} },
      g2: { nodes: { n2: makeNode('n2', 'math') }, connections: {} },
    });
    s.mergeImportedGraphs(storage);

    // Should have exactly one undo entry
    expect(getStore().canUndo()).toBe(true);
    getStore().undo();
    // After one undo, no more undo entries
    expect(getStore().canUndo()).toBe(false);
  });
});

// ===========================================================================
// 7. autoInserted Metadata (3 tests)
// ===========================================================================

describe('autoInserted metadata', () => {
  it('23. Manual addNode does NOT set autoInserted', () => {
    const s = getStore();
    const id1 = s.addNode('source', [0, 0, 0]);
    const id2 = s.addNode('transform', [3, 0, 0]);
    const id3 = s.addNode('math', [6, 0, 0]);

    expect(getStore().nodes[id1].autoInserted).toBeUndefined();
    expect(getStore().nodes[id2].autoInserted).toBeUndefined();
    expect(getStore().nodes[id3].autoInserted).toBeUndefined();
  });

  it('24. autoInserted preserved in duplicate', () => {
    const s = getStore();
    // Create a coercion that produces an autoInserted converter node
    // source output 0 (number) -> concat input 0 (string) triggers coercion
    const srcId = s.addNode('source', [0, 0, 0]);
    const concatId = s.addNode('concat', [5, 0, 0]);
    s.startConnection(srcId, 0);
    s.completeConnection(concatId, 0);

    // Find the auto-inserted converter node
    const autoNodes = Object.values(getStore().nodes).filter(n => n.autoInserted === true);
    expect(autoNodes.length).toBe(1);
    const autoNodeId = autoNodes[0].id;

    // Select the converter node and duplicate it
    useEditorStore.setState(st => { st.selectedIds = new Set([autoNodeId]); });
    s.duplicateSelected();

    // Should now have 2 auto-inserted nodes (original + duplicate)
    const autoNodesAfter = Object.values(getStore().nodes).filter(n => n.autoInserted === true);
    expect(autoNodesAfter.length).toBe(2);
    const duped = autoNodesAfter.find(n => n.id !== autoNodeId);
    expect(duped).toBeDefined();
    expect(duped!.autoInserted).toBe(true);
  });

  it('25. autoInserted preserved in paste', () => {
    const s = getStore();
    // Create a coercion that produces an autoInserted converter node
    const srcId = s.addNode('source', [0, 0, 0]);
    const concatId = s.addNode('concat', [5, 0, 0]);
    s.startConnection(srcId, 0);
    s.completeConnection(concatId, 0);

    // Find the auto-inserted converter node
    const autoNodes = Object.values(getStore().nodes).filter(n => n.autoInserted === true);
    expect(autoNodes.length).toBe(1);
    const autoNodeId = autoNodes[0].id;

    // Copy the converter and paste
    useEditorStore.setState(st => { st.selectedIds = new Set([autoNodeId]); });
    s.copySelected();
    s.paste();

    // Should now have 2 auto-inserted nodes
    const autoNodesAfter = Object.values(getStore().nodes).filter(n => n.autoInserted === true);
    expect(autoNodesAfter.length).toBe(2);
    const pasted = autoNodesAfter.find(n => n.id !== autoNodeId);
    expect(pasted).toBeDefined();
    expect(pasted!.autoInserted).toBe(true);
  });
});
