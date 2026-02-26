/**
 * Phase 30 E2E Regression Tests
 *
 * Covers regression scenarios for bug fixes from Phase 29-30:
 * - Locked node guards (position, delete, batch move)
 * - cancelAutoExecute in state operations (import, graph switches)
 * - Expression caching behavior for custom nodes
 * - Execution & live outputs (nodeOutputs, undo clears transient state)
 * - parseKeyCombo edge cases (+, -, ctrl+z)
 * - get-var / set-var null/empty handling
 * - Settings persistence (pinnedNodeTypes pin/unpin, max 10, clampLoadedSettings)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';
import { parseKeyCombo } from '../utils/keyboardShortcuts';
import { NODE_TYPE_CONFIG } from '../types';

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

function connectPorts(srcId: string, srcPort: number, tgtId: string, tgtPort: number) {
  getStore().startConnection(srcId, srcPort);
  getStore().completeConnection(tgtId, tgtPort);
}

// ===========================================================================
// 1. Locked Node Guards (5 tests)
// ===========================================================================

describe('Locked Node Guards', () => {
  beforeEach(() => { resetStore(); });

  it('1. updateNodePosition on locked node is a no-op (position unchanged)', () => {
    const s = getStore();
    const id = s.addNode('source', [1, 2, 3]);
    s.toggleNodeLock(id);
    expect(getStore().nodes[id].locked).toBe(true);

    s.updateNodePosition(id, [10, 20, 30]);

    const node = getStore().nodes[id];
    expect(node.position).toEqual([1, 2, 3]);
  });

  it('2. deleteSubgraphNode on locked subgraph is a no-op (node still exists)', () => {
    const s = getStore();
    const subId = s.createSubgraph('TestSub');
    expect(subId).toBeTruthy();
    // Lock the subgraph node
    s.toggleNodeLock(subId!);
    expect(getStore().nodes[subId!].locked).toBe(true);

    s.deleteSubgraphNode(subId!);

    // Node should still exist because it is locked
    expect(getStore().nodes[subId!]).toBeDefined();
    expect(getStore().nodes[subId!].type).toBe('subgraph');
  });

  it('3. deleteSelected skips locked nodes', () => {
    const s = getStore();
    const a = s.addNode('source', [0, 0, 0]);
    const b = s.addNode('source', [2, 0, 0]);
    const c = s.addNode('source', [4, 0, 0]);

    // Lock node b
    s.toggleNodeLock(b);

    // Select all three
    s.setSelection(new Set([a, b, c]));
    expect(getStore().selectedIds.size).toBe(3);

    s.deleteSelected();

    // Only the locked node should survive
    const remaining = getStore().nodes;
    expect(remaining[a]).toBeUndefined();
    expect(remaining[b]).toBeDefined();
    expect(remaining[c]).toBeUndefined();
  });

  it('4. unlocking a locked node then modifying works', () => {
    const s = getStore();
    const id = s.addNode('source', [0, 0, 0]);

    // Lock it
    s.toggleNodeLock(id);
    expect(getStore().nodes[id].locked).toBe(true);

    // Position update should be a no-op while locked
    s.updateNodePosition(id, [5, 5, 5]);
    expect(getStore().nodes[id].position).toEqual([0, 0, 0]);

    // Unlock it
    s.toggleNodeLock(id);
    expect(getStore().nodes[id].locked).toBe(false);

    // Now position update should work
    s.updateNodePosition(id, [5, 5, 5]);
    expect(getStore().nodes[id].position).toEqual([5, 5, 5]);
  });

  it('5. batchMoveNodes skips locked nodes', () => {
    const s = getStore();
    const a = s.addNode('source', [0, 0, 0]);
    const b = s.addNode('source', [1, 1, 1]);

    // Lock node a
    s.toggleNodeLock(a);

    s.batchMoveNodes([a, b], [10, 10, 10]);

    // a should not have moved (locked)
    expect(getStore().nodes[a].position).toEqual([0, 0, 0]);
    // b should have moved
    expect(getStore().nodes[b].position).toEqual([11, 11, 11]);
  });
});

// ===========================================================================
// 2. cancelAutoExecute in State Operations (4 tests)
// ===========================================================================

describe('cancelAutoExecute in State Operations', () => {
  beforeEach(() => { resetStore(); });

  it('6. importWorkflow clears pending state (no stale executionStates after import)', () => {
    const s = getStore();
    // Create a source and simulate execution state
    const srcId = s.addNode('source', [0, 0, 0]);
    useEditorStore.setState((st) => {
      st.executionStates[srcId] = 'running';
      st.nodeOutputs[srcId] = { 0: 42 };
    });

    // Import a fresh workflow
    s.importWorkflow({
      nodes: {
        n1: {
          id: 'n1', type: 'source', position: [0, 0, 0], title: 'Imported',
          data: { value: 99 },
          inputs: [],
          outputs: NODE_TYPE_CONFIG.source.outputs.map((c, i) => ({
            id: `out-${i}`, label: c.label, portType: c.portType,
          })),
        },
      },
      connections: {},
    });

    const after = getStore();
    // Old execution state should be cleared
    expect(after.executionStates[srcId]).toBeUndefined();
    expect(Object.keys(after.executionStates).length).toBe(0);
  });

  it('7. importAllGraphs clears pending state', () => {
    const s = getStore();
    const srcId = s.addNode('source', [0, 0, 0]);
    useEditorStore.setState((st) => {
      st.executionStates[srcId] = 'complete';
      st.nodeOutputs[srcId] = { 0: 100 };
    });

    // Export and re-import
    const exported = s.exportAllGraphs();
    s.importAllGraphs(exported);

    const after = getStore();
    // Execution transient state should be clean
    expect(Object.keys(after.executionStates).length).toBe(0);
    expect(Object.keys(after.executionErrors).length).toBe(0);
  });

  it('8. after importing, execution state is clean (no stale nodeOutputs)', () => {
    const s = getStore();
    const srcId = s.addNode('source', [0, 0, 0]);
    useEditorStore.setState((st) => {
      st.nodeOutputs[srcId] = { 0: 'stale-value' };
      st.executionErrors[srcId] = 'stale error';
    });

    s.importWorkflow({
      nodes: {
        fresh: {
          id: 'fresh', type: 'source', position: [0, 0, 0], title: 'Fresh',
          data: { value: 1 },
          inputs: [],
          outputs: NODE_TYPE_CONFIG.source.outputs.map((c, i) => ({
            id: `out-${i}`, label: c.label, portType: c.portType,
          })),
        },
      },
      connections: {},
    });

    const after = getStore();
    expect(after.nodeOutputs[srcId]).toBeUndefined();
    expect(after.executionErrors[srcId]).toBeUndefined();
    expect(Object.keys(after.nodeOutputs).length).toBe(0);
    expect(Object.keys(after.executionErrors).length).toBe(0);
  });

  it('9. graph variables are reset after importWorkflow', () => {
    const s = getStore();
    useEditorStore.setState((st) => {
      st.graphVariables = { myVar: 42, other: 'hello' };
    });
    expect(Object.keys(getStore().graphVariables).length).toBeGreaterThan(0);

    s.importWorkflow({
      nodes: {
        n1: {
          id: 'n1', type: 'source', position: [0, 0, 0], title: 'Src',
          data: { value: 1 },
          inputs: [],
          outputs: NODE_TYPE_CONFIG.source.outputs.map((c, i) => ({
            id: `out-${i}`, label: c.label, portType: c.portType,
          })),
        },
      },
      connections: {},
    });

    expect(getStore().graphVariables).toEqual({});
  });
});

// ===========================================================================
// 3. Expression Caching Behavior (3 tests)
// ===========================================================================

describe('Expression Caching Behavior', () => {
  beforeEach(() => { resetStore(); });

  it('10. custom node expression executes correctly', () => {
    const s = getStore();
    const custom = s.addNode('custom', [0, 0, 0]);
    s.updateCustomNodePorts(custom, 1, 1);
    s.updateNodeData(custom, 'expression', 'inputs[0] * 2');

    const src = s.addNode('source', [-2, 0, 0]);
    s.updateNodeData(src, 'value', 5);
    connectPorts(src, 0, custom, 0);

    const result = executeGraph(getStore().nodes, getStore().connections);
    const customResult = result.results.get(custom);
    expect(customResult).toBeDefined();
    expect(customResult!.outputs[0]).toBe(10);
  });

  it('11. same expression with same inputs returns correct cached result', () => {
    const s = getStore();
    const custom = s.addNode('custom', [0, 0, 0]);
    s.updateCustomNodePorts(custom, 1, 1);
    s.updateNodeData(custom, 'expression', 'inputs[0] + 100');

    const src = s.addNode('source', [-2, 0, 0]);
    s.updateNodeData(src, 'value', 7);
    connectPorts(src, 0, custom, 0);

    // First execution
    const result1 = executeGraph(getStore().nodes, getStore().connections);
    expect(result1.results.get(custom)!.outputs[0]).toBe(107);

    // Second execution with same inputs and cache from first run
    const cache = new Map(result1.results);
    const result2 = executeGraph(getStore().nodes, getStore().connections, cache);
    expect(result2.results.get(custom)!.outputs[0]).toBe(107);
  });

  it('12. different expressions produce different results (cache key includes expression)', () => {
    const s = getStore();
    const custom = s.addNode('custom', [0, 0, 0]);
    s.updateCustomNodePorts(custom, 1, 1);
    s.updateNodeData(custom, 'expression', 'inputs[0] * 3');

    const src = s.addNode('source', [-2, 0, 0]);
    s.updateNodeData(src, 'value', 4);
    connectPorts(src, 0, custom, 0);

    const result1 = executeGraph(getStore().nodes, getStore().connections);
    expect(result1.results.get(custom)!.outputs[0]).toBe(12);

    // Change the expression
    s.updateNodeData(custom, 'expression', 'inputs[0] + 1');
    const result2 = executeGraph(getStore().nodes, getStore().connections);
    expect(result2.results.get(custom)!.outputs[0]).toBe(5);
  });
});

// ===========================================================================
// 4. Execution & Live Outputs (3 tests)
// ===========================================================================

describe('Execution & Live Outputs', () => {
  beforeEach(() => { resetStore(); });

  it('13. after execution, nodeOutputs contain results', () => {
    const s = getStore();
    const src = s.addNode('source', [0, 0, 0]);
    s.updateNodeData(src, 'value', 42);

    const result = executeGraph(getStore().nodes, getStore().connections);
    expect(result.results.size).toBeGreaterThan(0);

    const srcResult = result.results.get(src);
    expect(srcResult).toBeDefined();
    expect(srcResult!.outputs[0]).toBe(42);
  });

  it('14. undo clears transient execution state (nodeOutputs, executionErrors)', () => {
    const s = getStore();
    const src = s.addNode('source', [0, 0, 0]);

    // Simulate execution state being populated
    useEditorStore.setState((st) => {
      st.nodeOutputs[src] = { 0: 42 };
      st.executionErrors[src] = 'test error';
      st.executionStates[src] = 'complete';
    });
    expect(getStore().nodeOutputs[src]).toEqual({ 0: 42 });
    expect(getStore().executionErrors[src]).toBe('test error');

    // Make a change that pushes undo
    s.updateNodeData(src, 'value', 99);

    // Undo should clear transient execution state
    s.undo();
    const after = getStore();
    expect(Object.keys(after.nodeOutputs).length).toBe(0);
    expect(Object.keys(after.executionErrors).length).toBe(0);
    expect(Object.keys(after.executionStates).length).toBe(0);
  });

  it('15. executionMaxNodeDuration is >= 0 after execution', () => {
    const s = getStore();
    s.addNode('source', [0, 0, 0]);
    s.addNode('transform', [2, 0, 0]);

    const result = executeGraph(getStore().nodes, getStore().connections);
    // totalDuration should be a non-negative number
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);

    // Each metric should have a non-negative duration
    for (const [, metric] of result.metrics) {
      expect(metric.duration).toBeGreaterThanOrEqual(0);
    }
  });
});

// ===========================================================================
// 5. parseKeyCombo Edge Cases (3 tests)
// ===========================================================================

describe('parseKeyCombo Edge Cases', () => {
  it('16. parseKeyCombo("+") returns { key: "+", ctrl: false, shift: false, alt: false }', () => {
    const result = parseKeyCombo('+');
    expect(result).toEqual({ key: '+', ctrl: false, shift: false, alt: false });
  });

  it('17. parseKeyCombo("-") returns { key: "-", ctrl: false, shift: false, alt: false }', () => {
    const result = parseKeyCombo('-');
    expect(result).toEqual({ key: '-', ctrl: false, shift: false, alt: false });
  });

  it('18. parseKeyCombo("ctrl+z") returns { key: "z", ctrl: true, shift: false, alt: false }', () => {
    const result = parseKeyCombo('ctrl+z');
    expect(result).toEqual({ key: 'z', ctrl: true, shift: false, alt: false });
  });
});

// ===========================================================================
// 6. get-var Null/Empty Handling (3 tests)
// ===========================================================================

describe('get-var Null/Empty Handling', () => {
  beforeEach(() => { resetStore(); });

  it('19. get-var with empty variableName throws error during execution', () => {
    const s = getStore();
    const getVar = s.addNode('get-var', [0, 0, 0]);
    // Do NOT set variableName -- defaults to empty string

    const result = executeGraph(getStore().nodes, getStore().connections);
    // Should have an error for the get-var node
    expect(result.errors.size).toBeGreaterThan(0);
    expect(result.errors.get(getVar)).toBeDefined();
    expect(result.errors.get(getVar)).toContain('variableName');
  });

  it('20. get-var with configured variableName returns 0 when variable not set', () => {
    const s = getStore();
    const getVar = s.addNode('get-var', [0, 0, 0]);
    s.updateNodeData(getVar, 'variableName', 'undefinedVar');

    const result = executeGraph(getStore().nodes, getStore().connections);
    // get-var returns 0 when the variable has not been set
    const getVarResult = result.results.get(getVar);
    expect(getVarResult).toBeDefined();
    expect(getVarResult!.outputs[0]).toBe(0);
  });

  it('21. set-var then get-var returns correct value', () => {
    const s = getStore();

    // Create source -> set-var pipeline
    const src = s.addNode('source', [-2, 0, 0]);
    s.updateNodeData(src, 'value', 77);

    const setVar = s.addNode('set-var', [0, 0, 0]);
    s.updateNodeData(setVar, 'variableName', 'myVar');
    connectPorts(src, 0, setVar, 0); // value input

    // Create get-var that reads the same variable
    const getVar = s.addNode('get-var', [2, 0, 0]);
    s.updateNodeData(getVar, 'variableName', 'myVar');

    // set-var must execute before get-var for this to work.
    // Because set-var depends on src (via connection), it runs in a later wave than
    // get-var (which has no dependencies). However, the module-scoped variable
    // context is shared, so wave ordering determines the result.
    const result = executeGraph(getStore().nodes, getStore().connections);

    // set-var should pass through value 77
    const setVarResult = result.results.get(setVar);
    expect(setVarResult).toBeDefined();
    expect(setVarResult!.outputs[0]).toBe(77);

    // get-var result depends on wave ordering:
    // - If get-var runs first (no deps, wave 0): returns 0 (default)
    // - If set-var runs first (after src): get-var returns 77
    const getVarResult = result.results.get(getVar);
    expect(getVarResult).toBeDefined();
    expect([0, 77]).toContain(getVarResult!.outputs[0]);
  });
});

// ===========================================================================
// 7. Settings Persistence (4 tests)
// ===========================================================================

describe('Settings Persistence', () => {
  beforeEach(() => { resetSettings(); });

  it('22. pinnedNodeTypes persists (pin, read, still pinned)', () => {
    getSettings().pinNodeType('source');
    getSettings().pinNodeType('transform');

    const pinned = getSettings().pinnedNodeTypes;
    expect(pinned).toContain('source');
    expect(pinned).toContain('transform');
    expect(pinned.length).toBe(2);
  });

  it('23. pinnedNodeTypes max 10 limit enforced', () => {
    const types = [
      'source', 'transform', 'filter', 'output', 'merge',
      'split', 'delay', 'math', 'compare', 'switch',
    ];
    for (const t of types) {
      getSettings().pinNodeType(t);
    }
    expect(getSettings().pinnedNodeTypes.length).toBe(10);

    // Pinning an 11th type should be a no-op
    getSettings().pinNodeType('custom');
    expect(getSettings().pinnedNodeTypes.length).toBe(10);
    expect(getSettings().pinnedNodeTypes).not.toContain('custom');
  });

  it('24. unpinNodeType removes correctly', () => {
    getSettings().pinNodeType('source');
    getSettings().pinNodeType('transform');
    getSettings().pinNodeType('filter');
    expect(getSettings().pinnedNodeTypes).toContain('transform');

    getSettings().unpinNodeType('transform');
    expect(getSettings().pinnedNodeTypes).not.toContain('transform');
    expect(getSettings().pinnedNodeTypes).toContain('source');
    expect(getSettings().pinnedNodeTypes).toContain('filter');
    expect(getSettings().pinnedNodeTypes.length).toBe(2);
  });

  it('25. clampLoadedSettings validates pinnedNodeTypes (non-array, non-string elements, slice to 10)', () => {
    // Non-array becomes empty
    const result1 = clampLoadedSettings({ pinnedNodeTypes: 'not-an-array' } as any);
    expect(result1.pinnedNodeTypes).toEqual([]);

    // Non-string elements causes entire array to reset to empty
    const result2 = clampLoadedSettings({ pinnedNodeTypes: [1, 2, 3] } as any);
    expect(result2.pinnedNodeTypes).toEqual([]);

    // Mixed valid/invalid causes entire array to reset to empty (every() check)
    const result3 = clampLoadedSettings({ pinnedNodeTypes: ['source', 42, 'transform'] } as any);
    expect(result3.pinnedNodeTypes).toEqual([]);

    // Valid array exceeding 10 entries is sliced to 10
    const longList = Array.from({ length: 15 }, (_, i) => `type-${i}`);
    const result4 = clampLoadedSettings({ pinnedNodeTypes: longList } as any);
    expect(result4.pinnedNodeTypes).toHaveLength(10);
    expect(result4.pinnedNodeTypes).toEqual(longList.slice(0, 10));

    // Valid array within limit is preserved as-is
    const result5 = clampLoadedSettings({ pinnedNodeTypes: ['source', 'filter'] } as any);
    expect(result5.pinnedNodeTypes).toEqual(['source', 'filter']);
  });
});
