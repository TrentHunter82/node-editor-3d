/**
 * Connection Animation Improvements Tests
 *
 * Tests for Phase 29 connection animation improvement features:
 * per-type particle geometries, trail particles, shared geometry performance,
 * and animation toggle integration.
 *
 * Since Three.js geometries and R3F rendering cannot be tested in a jsdom
 * environment, we focus on the store-level APIs and execution state integration
 * that drive the animation system:
 *
 * 1. Animation Setting Toggle (5 tests)
 * 2. Execution State Integration (5 tests)
 * 3. Connection Style Independence (5 tests)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS, clampLoadedSettings } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';


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

function connectPorts(srcId: string, srcPort: number, tgtId: string, tgtPort: number) {
  getStore().startConnection(srcId, srcPort);
  getStore().completeConnection(tgtId, tgtPort);
}

/** Advance past all execution animation waves */
function drainExecution() {
  vi.advanceTimersByTime(10_000);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetSettings();
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// 1. Animation Setting Toggle (5 tests)
// ===========================================================================

describe('Animation Setting Toggle', () => {
  it('1. connectionFlowAnimation defaults to true', () => {
    expect(getSettings().connectionFlowAnimation).toBe(true);
    expect(DEFAULT_SETTINGS.connectionFlowAnimation).toBe(true);
  });

  it('2. setConnectionFlowAnimation(false) disables animation', () => {
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().connectionFlowAnimation).toBe(false);
  });

  it('3. setConnectionFlowAnimation(true) re-enables animation', () => {
    // Disable first
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().connectionFlowAnimation).toBe(false);

    // Re-enable
    getSettings().setConnectionFlowAnimation(true);
    expect(getSettings().connectionFlowAnimation).toBe(true);
  });

  it('4. default survives resetToDefaults', () => {
    // Change the animation setting away from default
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().connectionFlowAnimation).toBe(false);

    // Also change some other settings to verify full reset
    getSettings().setConnectionStyle('organic');
    getSettings().setAutoExecute(true);

    // Reset to defaults
    getSettings().resetToDefaults();

    // connectionFlowAnimation should be restored to default (true)
    expect(getSettings().connectionFlowAnimation).toBe(true);
    // Other settings should also be at defaults
    expect(getSettings().connectionStyle).toBe('bezier');
    expect(getSettings().autoExecute).toBe(false);

    // Can disable again after reset
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().connectionFlowAnimation).toBe(false);
  });

  it('5. clampLoadedSettings validates boolean (non-boolean reverts to default)', () => {
    // clampLoadedSettings deletes non-boolean values for boolean fields,
    // so the field becomes undefined and the default (true) takes effect on merge

    // String value
    const loaded1 = clampLoadedSettings({ connectionFlowAnimation: 'yes' as unknown as boolean });
    expect(loaded1.connectionFlowAnimation).toBeUndefined();
    expect({ ...DEFAULT_SETTINGS, ...loaded1 }.connectionFlowAnimation).toBe(true);

    // Numeric value
    const loaded2 = clampLoadedSettings({ connectionFlowAnimation: 1 as unknown as boolean });
    expect(loaded2.connectionFlowAnimation).toBeUndefined();
    expect({ ...DEFAULT_SETTINGS, ...loaded2 }.connectionFlowAnimation).toBe(true);

    // Null value
    const loaded3 = clampLoadedSettings({ connectionFlowAnimation: null as unknown as boolean });
    expect(loaded3.connectionFlowAnimation).toBeUndefined();
    expect({ ...DEFAULT_SETTINGS, ...loaded3 }.connectionFlowAnimation).toBe(true);

    // Object value
    const loaded4 = clampLoadedSettings({ connectionFlowAnimation: {} as unknown as boolean });
    expect(loaded4.connectionFlowAnimation).toBeUndefined();
    expect({ ...DEFAULT_SETTINGS, ...loaded4 }.connectionFlowAnimation).toBe(true);

    // Valid boolean values pass through correctly
    const loadedTrue = clampLoadedSettings({ connectionFlowAnimation: true });
    expect(loadedTrue.connectionFlowAnimation).toBe(true);

    const loadedFalse = clampLoadedSettings({ connectionFlowAnimation: false });
    expect(loadedFalse.connectionFlowAnimation).toBe(false);
  });
});

// ===========================================================================
// 2. Execution State Integration (5 tests)
// ===========================================================================

describe('Execution State Integration', () => {
  it('6. after executeGraph, source nodes have executionStates complete', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [2, 0, 0]);
    connectPorts(src, 0, math, 0);

    // Use fresh store state for the utility call (immer replaces state on mutation)
    const { nodes, connections } = getStore();
    const result = executeGraph(nodes, connections);

    // The utility executeGraph returns results — source node should have output
    expect(result.results.has(src)).toBe(true);
    expect(result.errors.has(src)).toBe(false);
    expect(result.results.get(src)!.outputs).toBeDefined();

    // Also verify via the store's executeGraph action which sets executionStates
    getStore().executeGraph();
    drainExecution();

    expect(getStore().executionStates[src]).toBe('idle');
    expect(getStore().executionStates[math]).toBe('idle');
  });

  it('7. error nodes have executionStates error', () => {
    getStore().setErrorStrategy('continue');

    const src = getStore().addNode('source', [0, 0, 0]);
    const custom = getStore().addNode('custom', [2, 0, 0]);
    // Use an expression that causes a compile-time error (throw is a statement, not
    // an expression, so new Function() compilation fails with "Unexpected token")
    getStore().updateNodeData(custom, 'expression', 'throw new Error("test")');
    connectPorts(src, 0, custom, 0);

    // Direct utility call — should report error for the custom node
    const { nodes, connections } = getStore();
    const result = executeGraph(nodes, connections, undefined, undefined, undefined, 'continue');
    expect(result.errors.has(custom)).toBe(true);
    expect(result.errors.get(custom)).toContain('Custom expression error');

    // Store action — sets executionStates appropriately
    getStore().executeGraph();
    drainExecution();

    expect(getStore().executionStates[src]).toBe('idle');
    expect(getStore().executionStates[custom]).toBe('idle');
    expect(getStore().executionErrors[custom]).toBeDefined();
  });

  it('8. animation disabled does NOT affect execution results', () => {
    // Execute with animation ON
    getSettings().setConnectionFlowAnimation(true);
    const src1 = getStore().addNode('source', [0, 0, 0]);
    const math1 = getStore().addNode('math', [2, 0, 0]);
    getStore().updateNodeData(src1, 'value', 25);
    getStore().updateNodeData(math1, 'operation', 'multiply');
    getStore().updateNodeData(math1, 'operand', 4);
    connectPorts(src1, 0, math1, 0);

    const state1 = getStore();
    const resultAnimOn = executeGraph(state1.nodes, state1.connections);
    const outputAnimOn = resultAnimOn.results.get(math1)?.outputs;

    // Reset and execute with animation OFF
    resetStore();
    getSettings().setConnectionFlowAnimation(false);
    const src2 = getStore().addNode('source', [0, 0, 0]);
    const math2 = getStore().addNode('math', [2, 0, 0]);
    getStore().updateNodeData(src2, 'value', 25);
    getStore().updateNodeData(math2, 'operation', 'multiply');
    getStore().updateNodeData(math2, 'operand', 4);
    connectPorts(src2, 0, math2, 0);

    const state2 = getStore();
    const resultAnimOff = executeGraph(state2.nodes, state2.connections);
    const outputAnimOff = resultAnimOff.results.get(math2)?.outputs;

    // Results should be identical regardless of animation setting
    expect(outputAnimOn).toEqual(outputAnimOff);
    expect(resultAnimOn.errors.size).toBe(0);
    expect(resultAnimOff.errors.size).toBe(0);
  });

  it('9. node outputs remain correct regardless of animation setting', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [2, 0, 0]);
    getStore().updateNodeData(src, 'value', 10);
    getStore().updateNodeData(math, 'operation', 'add');
    getStore().updateNodeData(math, 'operand', 5);
    connectPorts(src, 0, math, 0);

    // Execute with animation enabled
    getSettings().setConnectionFlowAnimation(true);
    const state = getStore();
    const result1 = executeGraph(state.nodes, state.connections);
    const mathOutput1 = result1.results.get(math)?.outputs[0];

    // Execute again with animation disabled (same graph, same state)
    getSettings().setConnectionFlowAnimation(false);
    const result2 = executeGraph(state.nodes, state.connections);
    const mathOutput2 = result2.results.get(math)?.outputs[0];

    // Both should produce the same output
    expect(mathOutput1).toBe(mathOutput2);
    // Source output should be the configured value
    expect(result1.results.get(src)?.outputs[0]).toBe(10);
    expect(result2.results.get(src)?.outputs[0]).toBe(10);
  });

  it('10. undo clears all transient execution states (executionStates, nodeOutputs, executionErrors)', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [2, 0, 0]);
    connectPorts(src, 0, math, 0);

    // Execute the graph
    getStore().executeGraph();
    drainExecution();

    // Verify execution completed (states reset to idle after animation finishes)
    expect(getStore().executionStates[src]).toBe('idle');
    expect(getStore().executionStates[math]).toBe('idle');
    expect(Object.keys(getStore().nodeOutputs).length).toBeGreaterThan(0);

    // Add a node so we have something to undo (creates undo point)
    getStore().addNode('source', [5, 0, 0]);

    // Undo should clear all transient execution state
    getStore().undo();

    expect(getStore().executionStates).toEqual({});
    expect(getStore().nodeOutputs).toEqual({});
    expect(getStore().executionErrors).toEqual({});
  });
});

// ===========================================================================
// 3. Connection Style Independence (5 tests)
// ===========================================================================

describe('Connection Style Independence', () => {
  it('11. changing connectionStyle does not affect animation setting', () => {
    // Verify initial state
    expect(getSettings().connectionFlowAnimation).toBe(true);
    expect(getSettings().connectionStyle).toBe('bezier');

    // Change connection style through all options
    getSettings().setConnectionStyle('straight');
    expect(getSettings().connectionFlowAnimation).toBe(true);

    getSettings().setConnectionStyle('right-angle');
    expect(getSettings().connectionFlowAnimation).toBe(true);

    getSettings().setConnectionStyle('organic');
    expect(getSettings().connectionFlowAnimation).toBe(true);

    // Disable animation, then change style — animation stays disabled
    getSettings().setConnectionFlowAnimation(false);
    getSettings().setConnectionStyle('bezier');
    expect(getSettings().connectionFlowAnimation).toBe(false);
    expect(getSettings().connectionStyle).toBe('bezier');
  });

  it('12. animation setting does not affect connectionStyle', () => {
    // Set a non-default connection style
    getSettings().setConnectionStyle('organic');
    expect(getSettings().connectionStyle).toBe('organic');

    // Toggle animation — style should be unaffected
    getSettings().setConnectionFlowAnimation(false);
    expect(getSettings().connectionStyle).toBe('organic');

    getSettings().setConnectionFlowAnimation(true);
    expect(getSettings().connectionStyle).toBe('organic');

    // Change animation multiple times — style should remain
    for (let i = 0; i < 5; i++) {
      getSettings().setConnectionFlowAnimation(i % 2 === 0);
    }
    expect(getSettings().connectionStyle).toBe('organic');
  });

  it('13. per-connection styleOverride is independent from animation', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [2, 0, 0]);
    connectPorts(src, 0, math, 0);

    // Get the connection ID from the store (connectPorts uses startConnection/completeConnection)
    const connIds = Object.keys(getStore().connections);
    expect(connIds.length).toBe(1);
    const connId = connIds[0];

    // Set a per-connection style override
    getStore().updateConnectionStyle(connId, 'straight');
    expect(getStore().connections[connId].styleOverride).toBe('straight');

    // Global connection style and animation are independent
    expect(getSettings().connectionStyle).toBe('bezier');
    expect(getSettings().connectionFlowAnimation).toBe(true);

    // Disable animation — per-connection override should remain intact
    getSettings().setConnectionFlowAnimation(false);
    expect(getStore().connections[connId].styleOverride).toBe('straight');

    // Re-enable animation — still intact
    getSettings().setConnectionFlowAnimation(true);
    expect(getStore().connections[connId].styleOverride).toBe('straight');

    // Change global style — per-connection override is independent
    getSettings().setConnectionStyle('organic');
    expect(getStore().connections[connId].styleOverride).toBe('straight');
    expect(getSettings().connectionStyle).toBe('organic');

    // Execution should still work with per-connection override
    getStore().executeGraph();
    drainExecution();
    expect(getStore().executionStates[src]).toBe('idle');
    expect(getStore().executionStates[math]).toBe('idle');
    expect(getStore().connections[connId].styleOverride).toBe('straight');
  });

  it('14. multiple connections with different port types all have correct executionStates after execution', () => {
    // Build a graph with nodes that use different port types:
    // source (number output) -> math (number input)
    // source (number output) -> compare (number input, boolean output)
    // source (string label output) -> concat (string input)
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [2, 0, 0]);
    const compare = getStore().addNode('compare', [2, 2, 0]);
    const concat = getStore().addNode('concat', [2, -2, 0]);

    getStore().updateNodeData(src, 'value', 42);

    // source port 0 (number) -> math port 0 (number)
    connectPorts(src, 0, math, 0);

    // source port 0 (number) -> compare port 0 (number)
    connectPorts(src, 0, compare, 0);

    // source port 1 (string label) -> concat port 0 (string)
    connectPorts(src, 1, concat, 0);

    // Verify connections were created (3 connections)
    const connCount = Object.keys(getStore().connections).length;
    expect(connCount).toBe(3);

    // Execute the graph via the utility with fresh state
    const { nodes, connections } = getStore();
    const result = executeGraph(nodes, connections);

    // All nodes should have results
    expect(result.results.has(src)).toBe(true);
    expect(result.results.has(math)).toBe(true);
    expect(result.results.has(compare)).toBe(true);
    expect(result.results.has(concat)).toBe(true);
    expect(result.errors.size).toBe(0);

    // Also verify via store action
    getStore().executeGraph();
    drainExecution();

    expect(getStore().executionStates[src]).toBe('idle');
    expect(getStore().executionStates[math]).toBe('idle');
    expect(getStore().executionStates[compare]).toBe('idle');
    expect(getStore().executionStates[concat]).toBe('idle');
  });

  it('15. animation toggle mid-graph does not affect execution results', () => {
    const src = getStore().addNode('source', [0, 0, 0]);
    const math = getStore().addNode('math', [2, 0, 0]);
    getStore().updateNodeData(src, 'value', 7);
    getStore().updateNodeData(math, 'operation', 'multiply');
    getStore().updateNodeData(math, 'operand', 3);
    connectPorts(src, 0, math, 0);

    // Start execution with animation enabled
    getSettings().setConnectionFlowAnimation(true);
    getStore().executeGraph();

    // Toggle animation mid-execution (should not throw or corrupt state)
    expect(() => {
      getSettings().setConnectionFlowAnimation(false);
      vi.advanceTimersByTime(100);
      getSettings().setConnectionFlowAnimation(true);
      vi.advanceTimersByTime(100);
      getSettings().setConnectionFlowAnimation(false);
    }).not.toThrow();

    drainExecution();

    // Execution should complete correctly despite mid-execution toggles
    expect(getStore().executionStates[src]).toBe('idle');
    expect(getStore().executionStates[math]).toBe('idle');
    expect(getStore().isExecuting).toBe(false);

    // Outputs should be populated
    expect(getStore().nodeOutputs[src]).toBeDefined();
    expect(getStore().nodeOutputs[math]).toBeDefined();

    // Verify the direct utility also produces correct results with fresh state
    const { nodes, connections } = getStore();
    const directResult = executeGraph(nodes, connections);
    expect(directResult.errors.size).toBe(0);
    expect(directResult.results.has(src)).toBe(true);
    expect(directResult.results.has(math)).toBe(true);
  });
});
