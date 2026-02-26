/**
 * Phase 16 Regression Tests
 *
 * Comprehensive regression tests for bugs found and fixed in Phases 15-16:
 *
 * 1. NaN Propagation in Statistics Nodes (mean, median, stddev, min-array, max-array)
 * 2. Min/Max Array Stack Overflow on Large Arrays (loop-based instead of Math.min/max spread)
 * 3. Execution History on Graph Switch / Enter/Exit Subgraph / Clear / Import
 * 4. Back-to-Live Restore (scrubExecutionHistory to live index restores liveOutputsSnapshot)
 * 5. jumpToUndo Meta Alignment (redo meta stack length matches redo stack length)
 * 6. Execution Timeline Correctness (scrubbing shows per-node outputs from historical run)
 * 7. Statistics Nodes Edge Cases (empty array, single element, identical values)
 * 8. Vector Math Regression (non-array inputs, short arrays, zero vectors)
 * 9. typeof NaN === 'number' Regression (mixed-type arrays filter NaN properly)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph } from '../utils/execution';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection } from '../types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.searchQuery = '';
    s.contextMenu = null;
    s.validationErrors = {};
    s.breadcrumbStack = [];
    s.activeGraphId = 'default';
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.graphOrder = ['default'];
    s.templates = {};
    s.errorStrategy = 'fail-fast';
    s.executionMetrics = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
  localStorage.clear();
}

/**
 * Build a node directly (bypassing store addNode) for use with executeGraph utility.
 * This allows testing processors in isolation without port-type compatibility constraints.
 */
function makeNode(
  id: string,
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {},
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${id}-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${id}-${i}`, label: c.label, portType: c.portType })),
    ...overrides,
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

/** Run executeGraph over a simple nodes+connections map. */
function exec(nodes: Record<string, EditorNode>, connections: Record<string, Connection> = {}) {
  return executeGraph(nodes, connections);
}

/** Build a source node that outputs an array value. */
function srcArray(id: string, value: unknown[]): EditorNode {
  return makeNode(id, 'source', { value });
}

// ===========================================================================
// 1. NaN Propagation in Statistics Nodes
// ===========================================================================

describe('Phase 16 Regression — NaN Propagation in Statistics Nodes', () => {

  it('1. mean node filters NaN from input array', () => {
    const nodes = {
      src: srcArray('src', [1, 2, NaN, 4]),
      mean: makeNode('mean', 'mean'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
    const r = exec(nodes, conns);
    const result = r.results.get('mean')!.outputs[0] as number;
    // (1 + 2 + 4) / 3 = 2.333...
    expect(result).toBeCloseTo(7 / 3, 10);
  });

  it('2. median node filters NaN', () => {
    const nodes = {
      src: srcArray('src', [5, NaN, 1, NaN, 3]),
      median: makeNode('median', 'median'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'median', 0) };
    const r = exec(nodes, conns);
    // Filtered: [1, 3, 5] → median = 3
    expect(r.results.get('median')!.outputs[0]).toBe(3);
  });

  it('3. stddev node filters NaN', () => {
    const nodes = {
      src: srcArray('src', [2, NaN, 4, 6]),
      stddev: makeNode('stddev', 'stddev'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'stddev', 0) };
    const r = exec(nodes, conns);
    // Filtered: [2, 4, 6] → mean = 4, variance = ((2-4)^2 + (4-4)^2 + (6-4)^2)/3 = 8/3
    // stddev = sqrt(8/3) ≈ 1.6329931618...
    const result = r.results.get('stddev')!.outputs[0] as number;
    expect(result).toBeCloseTo(Math.sqrt(8 / 3), 10);
    expect(Number.isNaN(result)).toBe(false);
  });

  it('4. min-array filters NaN', () => {
    const nodes = {
      src: srcArray('src', [3, NaN, 1, NaN, 5]),
      min: makeNode('min', 'min-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'min', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('min')!.outputs[0]).toBe(1);
  });

  it('5. max-array filters NaN', () => {
    const nodes = {
      src: srcArray('src', [NaN, 3, NaN, 7, 2]),
      max: makeNode('max', 'max-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'max', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('max')!.outputs[0]).toBe(7);
  });

  it('6. all NaN array returns 0 for mean, median, stddev', () => {
    const allNaN = [NaN, NaN, NaN];

    // mean
    const meanNodes = {
      src: srcArray('src', allNaN),
      mean: makeNode('mean', 'mean'),
    };
    const meanConns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
    const meanResult = exec(meanNodes, meanConns);
    expect(meanResult.results.get('mean')!.outputs[0]).toBe(0);

    // median
    const medianNodes = {
      src: srcArray('src', allNaN),
      median: makeNode('median', 'median'),
    };
    const medianConns = { c1: makeConn('c1', 'src', 0, 'median', 0) };
    const medianResult = exec(medianNodes, medianConns);
    expect(medianResult.results.get('median')!.outputs[0]).toBe(0);

    // stddev
    const stddevNodes = {
      src: srcArray('src', allNaN),
      stddev: makeNode('stddev', 'stddev'),
    };
    const stddevConns = { c1: makeConn('c1', 'src', 0, 'stddev', 0) };
    const stddevResult = exec(stddevNodes, stddevConns);
    expect(stddevResult.results.get('stddev')!.outputs[0]).toBe(0);
  });
});

// ===========================================================================
// 2. Min/Max Array Stack Overflow on Large Arrays
// ===========================================================================

describe('Phase 16 Regression — Min/Max Array Stack Overflow on Large Arrays', () => {

  it('7. min-array handles 100000-element array without stack overflow', () => {
    const largeArr = Array.from({ length: 100000 }, (_, i) => i);
    const nodes = {
      src: srcArray('src', largeArr),
      min: makeNode('min', 'min-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'min', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('min')!.outputs[0]).toBe(0);
    expect(r.errors.size).toBe(0);
  });

  it('8. max-array handles 100000-element array without stack overflow', () => {
    const largeArr = Array.from({ length: 100000 }, (_, i) => i);
    const nodes = {
      src: srcArray('src', largeArr),
      max: makeNode('max', 'max-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'max', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('max')!.outputs[0]).toBe(99999);
    expect(r.errors.size).toBe(0);
  });

  it('9. min-array with negative large array returns correct min', () => {
    const largeArr = Array.from({ length: 100000 }, (_, i) => -i);
    const nodes = {
      src: srcArray('src', largeArr),
      min: makeNode('min', 'min-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'min', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('min')!.outputs[0]).toBe(-99999);
  });
});

// ===========================================================================
// 3. Execution History on Graph Switch
// ===========================================================================

describe('Phase 16 Regression — Execution History on Graph Switch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('10. executionHistory cleared on switchGraph', () => {
    // Create a source node, execute to populate history
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    getState().executeGraph();
    expect(getState().executionHistory.length).toBeGreaterThan(0);

    // Create a new graph and switch to it
    const graphB = getState().createGraph('Graph B');
    expect(getState().activeGraphId).toBe(graphB);

    // Execution history should be cleared in the new graph context
    expect(getState().executionHistory).toHaveLength(0);
  });

  it('11. executionHistory cleared on enterSubgraph', () => {
    // Create subgraph node
    const subId = getState().createSubgraph('TestSub');
    expect(subId).toBeTruthy();

    // Execute outer graph to populate history
    getState().executeGraph();
    expect(getState().executionHistory.length).toBeGreaterThan(0);

    // Enter subgraph
    getState().enterSubgraph(subId!);

    // Execution history should be cleared
    expect(getState().executionHistory).toHaveLength(0);
  });

  it('12. executionHistory cleared on exitSubgraph', () => {
    // Create subgraph and enter it
    const subId = getState().createSubgraph('TestSub');
    expect(subId).toBeTruthy();
    getState().enterSubgraph(subId!);

    // Add a node in the inner graph and execute
    const innerSrc = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(innerSrc, 'value', 10);
    getState().executeGraph();
    expect(getState().executionHistory.length).toBeGreaterThan(0);

    // Exit subgraph
    getState().exitSubgraph();

    // Execution history should be cleared
    expect(getState().executionHistory).toHaveLength(0);
  });

  it('13. executionHistory cleared on clearGraph', () => {
    // Create nodes and execute
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 5);
    getState().executeGraph();
    expect(getState().executionHistory.length).toBeGreaterThan(0);

    // Clear graph
    getState().clearGraph();

    // Execution history should be empty
    expect(getState().executionHistory).toHaveLength(0);
  });

  it('14. executionHistory cleared on importWorkflow', () => {
    // Create nodes and execute
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 5);
    getState().executeGraph();
    expect(getState().executionHistory.length).toBeGreaterThan(0);

    // Import a workflow (replaces current graph)
    const importData = {
      nodes: {
        n1: {
          id: 'n1',
          type: 'source' as const,
          position: [0, 0, 0] as [number, number, number],
          title: 'Source',
          data: { value: 99 },
          inputs: [],
          outputs: [{ id: 'out-n1-0', label: 'value', portType: 'number' as const }],
        },
      },
      connections: {},
    };
    getState().importWorkflow(importData);

    // Execution history should be empty
    expect(getState().executionHistory).toHaveLength(0);
  });

  it('15. executionHistory NOT cleared on undo/redo (persists across undo/redo)', () => {
    // Create node, execute to build history
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    getState().executeGraph();

    const historyLengthAfterExec = getState().executionHistory.length;
    expect(historyLengthAfterExec).toBeGreaterThan(0);

    // Add another node (pushes undo)
    getState().addNode('math', [3, 0, 0]);

    // Undo the addNode
    getState().undo();

    // executionHistory should be preserved (clearExecutionTransientState does NOT clear it)
    expect(getState().executionHistory.length).toBe(historyLengthAfterExec);

    // Redo should also preserve execution history
    getState().redo();
    expect(getState().executionHistory.length).toBe(historyLengthAfterExec);
  });
});

// ===========================================================================
// 4. Back-to-Live Restore
// ===========================================================================

describe('Phase 16 Regression — Back-to-Live Restore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('16. scrubExecutionHistory to past run, then back to live restores current outputs', () => {
    // Create source -> output, execute with value 10
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const out = getState().addNode('output', [3, 0, 0]);
    getState().addConnection(src, 0, out, 0);

    getState().executeGraph();
    expect(getState().executionHistory).toHaveLength(1);

    // Advance timers to let isExecuting become false (animation complete)
    vi.advanceTimersByTime(5000);

    // Change value and execute again
    getState().updateNodeData(src, 'value', 20);
    getState().executeGraph();
    expect(getState().executionHistory).toHaveLength(2);

    // Record current (live) outputs
    const liveOutputSrc = getState().nodeOutputs[src]?.[0];
    expect(liveOutputSrc).toBe(20);

    // Scrub to first run (index 0)
    getState().scrubExecutionHistory(0);
    expect(getState().executionHistoryIndex).toBe(0);
    // nodeOutputs should now reflect the first run
    expect(getState().nodeOutputs[src]?.[0]).toBe(10);

    // Scrub back to live (index -1)
    getState().scrubExecutionHistory(-1);
    expect(getState().executionHistoryIndex).toBe(-1);
    // nodeOutputs should be restored to the latest live values
    expect(getState().nodeOutputs[src]?.[0]).toBe(20);
  });

  it('17. scrubbing to live index correctly restores liveOutputsSnapshot', () => {
    // Create source, execute twice with different values
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 100);
    getState().executeGraph();

    // Advance timers to let isExecuting become false
    vi.advanceTimersByTime(5000);

    getState().updateNodeData(src, 'value', 200);
    getState().executeGraph();
    expect(getState().executionHistory).toHaveLength(2);

    // nodeOutputs are live (latest execution)
    expect(getState().nodeOutputs[src]?.[0]).toBe(200);

    // Scrub to historical entry
    getState().scrubExecutionHistory(0);
    // Should show historical outputs
    expect(getState().nodeOutputs[src]?.[0]).toBe(100);

    // Return to live
    getState().scrubExecutionHistory(-1);
    // Must be restored to actual current outputs (200)
    expect(getState().nodeOutputs[src]?.[0]).toBe(200);
    expect(getState().executionHistoryIndex).toBe(-1);
  });
});

// ===========================================================================
// 5. jumpToUndo Meta Alignment
// ===========================================================================

describe('Phase 16 Regression — jumpToUndo Meta Alignment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('18. jumpToUndo(0) restores to earliest undo state', () => {
    // Create 5 nodes (5 undo entries)
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(getState().addNode('source', [i * 3, 0, 0]));
    }
    expect(Object.keys(getState().nodes)).toHaveLength(5);

    const undoHistory = getState().getUndoHistory();
    expect(undoHistory.undo.length).toBe(5);

    // Jump to index 0 (earliest undo snapshot — state after first node creation)
    getState().jumpToUndo(0);

    // Should be back to 1 node (the state captured after the first addNode)
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().nodes[ids[0]]).toBeDefined();
  });

  it('19. jumpToUndo does not push extra meta to redo stack', () => {
    // Create 3 nodes (3 undo entries)
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('math', [3, 0, 0]);
    getState().addNode('output', [6, 0, 0]);

    const undoHistory = getState().getUndoHistory();
    expect(undoHistory.undo.length).toBe(3);
    expect(undoHistory.redo.length).toBe(0);

    // Jump to index 0
    getState().jumpToUndo(0);

    // Check that redo meta and redo stack lengths match
    const historyAfterJump = getState().getUndoHistory();
    // The redo stack should have entries corresponding to the states we skipped over
    // undo stack had 3 entries, we jumped to 0, consuming index 0 and pushing 2 intermediates + current to redo
    // The exact count depends on implementation, but meta and stack must be aligned
    expect(historyAfterJump.redo.length).toBeGreaterThan(0);
    // Now redo back to verify alignment: each redo should succeed
    let redoCount = 0;
    while (getState().canRedo()) {
      getState().redo();
      redoCount++;
    }
    // After all redo, we should be back to 3 nodes
    expect(Object.keys(getState().nodes)).toHaveLength(3);
    // redo count should match the redo meta length
    expect(redoCount).toBe(historyAfterJump.redo.length);
  });

  it('20. jumpToUndo then redo produces same state as before jump', () => {
    // Create 3 nodes A, B, C
    const a = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(a, 'value', 10);
    const b = getState().addNode('math', [3, 0, 0]);
    const c = getState().addNode('output', [6, 0, 0]);

    // Record the current state (4 undo entries: addNode A, updateData, addNode B, addNode C)
    const nodeCountBefore = Object.keys(getState().nodes).length;
    expect(nodeCountBefore).toBe(3);

    // Jump to index 0 (earliest state — after first addNode)
    getState().jumpToUndo(0);
    expect(Object.keys(getState().nodes)).toHaveLength(1);

    // Redo everything back
    while (getState().canRedo()) {
      getState().redo();
    }

    // All 3 nodes should exist with correct data
    expect(Object.keys(getState().nodes)).toHaveLength(3);
    expect(getState().nodes[a]).toBeDefined();
    expect(getState().nodes[b]).toBeDefined();
    expect(getState().nodes[c]).toBeDefined();
    expect(getState().nodes[a].data.value).toBe(10);
  });
});

// ===========================================================================
// 6. Execution Timeline Correctness
// ===========================================================================

describe('Phase 16 Regression — Execution Timeline Correctness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('21. scrubExecutionHistory shows per-node outputs from historical run', () => {
    // Create source -> transform chain
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const xfm = getState().addNode('transform', [3, 0, 0]);
    // transform: inputValue * multiplier + offset
    // default multiplier = 1, offset = 0, so output = input
    getState().addConnection(src, 0, xfm, 0);

    // Execute: source=10, transform=10*1+0=10
    getState().executeGraph();
    expect(getState().executionHistory).toHaveLength(1);
    expect(getState().nodeOutputs[src]?.[0]).toBe(10);
    expect(getState().nodeOutputs[xfm]?.[0]).toBe(10);

    // Advance timers to let isExecuting become false (animation complete)
    vi.advanceTimersByTime(5000);

    // Change source to 20 and re-execute
    getState().updateNodeData(src, 'value', 20);
    getState().executeGraph();
    expect(getState().executionHistory).toHaveLength(2);
    expect(getState().nodeOutputs[src]?.[0]).toBe(20);
    expect(getState().nodeOutputs[xfm]?.[0]).toBe(20);

    // Scrub to first run (index 0)
    getState().scrubExecutionHistory(0);

    // nodeOutputs should reflect the first run values
    expect(getState().nodeOutputs[src]?.[0]).toBe(10);
    expect(getState().nodeOutputs[xfm]?.[0]).toBe(10);

    // Return to live
    getState().scrubExecutionHistory(-1);
    expect(getState().nodeOutputs[src]?.[0]).toBe(20);
    expect(getState().nodeOutputs[xfm]?.[0]).toBe(20);
  });
});

// ===========================================================================
// 7. Statistics Nodes Edge Cases
// ===========================================================================

describe('Phase 16 Regression — Statistics Nodes Edge Cases', () => {

  it('22. mean of empty array returns 0', () => {
    const nodes = {
      src: srcArray('src', []),
      mean: makeNode('mean', 'mean'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('mean')!.outputs[0]).toBe(0);
  });

  it('23. median of single element returns that element', () => {
    const nodes = {
      src: srcArray('src', [42]),
      median: makeNode('median', 'median'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'median', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('median')!.outputs[0]).toBe(42);
  });

  it('24. stddev of identical values returns 0', () => {
    const nodes = {
      src: srcArray('src', [5, 5, 5, 5]),
      stddev: makeNode('stddev', 'stddev'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'stddev', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('stddev')!.outputs[0]).toBe(0);
  });

  it('25. min-array of single element returns that element', () => {
    const nodes = {
      src: srcArray('src', [7]),
      min: makeNode('min', 'min-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'min', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('min')!.outputs[0]).toBe(7);
  });

  it('26. max-array of empty array returns 0', () => {
    const nodes = {
      src: srcArray('src', []),
      max: makeNode('max', 'max-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'max', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('max')!.outputs[0]).toBe(0);
  });
});

// ===========================================================================
// 8. Vector Math Regression
// ===========================================================================

describe('Phase 16 Regression — Vector Math Regression', () => {

  it('27. dot-product with non-array inputs defaults gracefully', () => {
    // Feed numbers instead of arrays to dot-product
    const srcA = makeNode('srcA', 'source', { value: 5 });
    const srcB = makeNode('srcB', 'source', { value: 3 });
    const dot = makeNode('dot', 'dot-product');

    const nodes = { srcA, srcB, dot };
    const conns = {
      c1: makeConn('c1', 'srcA', 0, 'dot', 0),
      c2: makeConn('c2', 'srcB', 0, 'dot', 1),
    };

    // Should not crash — non-array inputs should default to [0, 0, 0]
    const r = exec(nodes, conns);
    expect(r.errors.size).toBe(0);
    const result = r.results.get('dot')!.outputs[0];
    expect(typeof result).toBe('number');
    // Both default to [0,0,0] so dot product = 0
    expect(result).toBe(0);
  });

  it('28. cross-product with 2-element arrays handles gracefully', () => {
    // Feed [1, 2] instead of [1, 2, 3]
    const srcA = srcArray('srcA', [1, 2]);
    const srcB = srcArray('srcB', [4, 5]);
    const cross = makeNode('cross', 'cross-product');

    const nodes = { srcA, srcB, cross };
    const conns = {
      c1: makeConn('c1', 'srcA', 0, 'cross', 0),
      c2: makeConn('c2', 'srcB', 0, 'cross', 1),
    };

    // Should not crash — missing z treated as 0 (typeof undefined !== 'number')
    const r = exec(nodes, conns);
    expect(r.errors.size).toBe(0);
    const result = r.results.get('cross')!.outputs[0] as number[];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    // a = [1, 2, 0], b = [4, 5, 0]
    // cross = [2*0 - 0*5, 0*4 - 1*0, 1*5 - 2*4] = [0, 0, -3]
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(-3);
  });

  it('29. normalize-vec3 with zero vector returns [0, 0, 0]', () => {
    const srcVec = srcArray('srcVec', [0, 0, 0]);
    const norm = makeNode('norm', 'normalize-vec3');

    const nodes = { srcVec, norm };
    const conns = { c1: makeConn('c1', 'srcVec', 0, 'norm', 0) };

    const r = exec(nodes, conns);
    expect(r.errors.size).toBe(0);
    const result = r.results.get('norm')!.outputs[0] as number[];
    expect(Array.isArray(result)).toBe(true);
    // Should return [0, 0, 0] instead of NaN values
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    // Explicitly check no NaN
    expect(Number.isNaN(result[0])).toBe(false);
    expect(Number.isNaN(result[1])).toBe(false);
    expect(Number.isNaN(result[2])).toBe(false);
  });

  it('30. vec3-length of zero vector returns 0', () => {
    const srcVec = srcArray('srcVec', [0, 0, 0]);
    const len = makeNode('len', 'vec3-length');

    const nodes = { srcVec, len };
    const conns = { c1: makeConn('c1', 'srcVec', 0, 'len', 0) };

    const r = exec(nodes, conns);
    expect(r.errors.size).toBe(0);
    expect(r.results.get('len')!.outputs[0]).toBe(0);
  });
});

// ===========================================================================
// 9. typeof NaN === 'number' Regression
// ===========================================================================

describe('Phase 16 Regression — typeof NaN === number Regression', () => {

  it('31. statistics nodes properly exclude NaN even though typeof NaN === number', () => {
    // Mixed-type array with NaN, strings, booleans, null, undefined
    // typeof NaN === 'number' is true, but Number.isNaN(NaN) catches it
    const mixedArray = [1, NaN, 'hello', true, null, undefined, 3];

    const nodes = {
      src: srcArray('src', mixedArray),
      mean: makeNode('mean', 'mean'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
    const r = exec(nodes, conns);

    // Only valid numbers are [1, 3] (NaN filtered by isNaN, others filtered by typeof !== 'number')
    // mean = (1 + 3) / 2 = 2
    expect(r.results.get('mean')!.outputs[0]).toBe(2);
  });
});

// ===========================================================================
// Additional Regression — Min/Max with NaN-only, stats with single NaN
// ===========================================================================

describe('Phase 16 Regression — Additional Edge Cases', () => {

  it('min-array of all NaN returns 0', () => {
    const nodes = {
      src: srcArray('src', [NaN, NaN]),
      min: makeNode('min', 'min-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'min', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('min')!.outputs[0]).toBe(0);
  });

  it('max-array of all NaN returns 0', () => {
    const nodes = {
      src: srcArray('src', [NaN, NaN]),
      max: makeNode('max', 'max-array'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'max', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('max')!.outputs[0]).toBe(0);
  });

  it('median of even-length filtered array computes average of two middle elements', () => {
    // [1, NaN, 2, NaN, 3, 4] -> filtered [1, 2, 3, 4] -> median = (2 + 3) / 2 = 2.5
    const nodes = {
      src: srcArray('src', [1, NaN, 2, NaN, 3, 4]),
      median: makeNode('median', 'median'),
    };
    const conns = { c1: makeConn('c1', 'src', 0, 'median', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('median')!.outputs[0]).toBe(2.5);
  });

  it('vec3-length of unit vector returns 1', () => {
    const srcVec = srcArray('srcVec', [1, 0, 0]);
    const len = makeNode('len', 'vec3-length');
    const nodes = { srcVec, len };
    const conns = { c1: makeConn('c1', 'srcVec', 0, 'len', 0) };
    const r = exec(nodes, conns);
    expect(r.results.get('len')!.outputs[0]).toBe(1);
  });

  it('normalize-vec3 of unit axis vector returns itself', () => {
    const srcVec = srcArray('srcVec', [0, 0, 1]);
    const norm = makeNode('norm', 'normalize-vec3');
    const nodes = { srcVec, norm };
    const conns = { c1: makeConn('c1', 'srcVec', 0, 'norm', 0) };
    const r = exec(nodes, conns);
    const result = r.results.get('norm')!.outputs[0] as number[];
    expect(result[0]).toBeCloseTo(0, 10);
    expect(result[1]).toBeCloseTo(0, 10);
    expect(result[2]).toBeCloseTo(1, 10);
  });

  it('dot-product of orthogonal vectors returns 0', () => {
    const srcA = srcArray('srcA', [1, 0, 0]);
    const srcB = srcArray('srcB', [0, 1, 0]);
    const dot = makeNode('dot', 'dot-product');
    const nodes = { srcA, srcB, dot };
    const conns = {
      c1: makeConn('c1', 'srcA', 0, 'dot', 0),
      c2: makeConn('c2', 'srcB', 0, 'dot', 1),
    };
    const r = exec(nodes, conns);
    expect(r.results.get('dot')!.outputs[0]).toBe(0);
  });
});
