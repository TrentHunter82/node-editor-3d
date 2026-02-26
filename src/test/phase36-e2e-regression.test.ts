/**
 * Phase 36 E2E Regression Tests (25 tests)
 *
 * Covers gaps identified in Phase 36 test coverage:
 * 1. getSnapshotSummary store action (5 tests)
 * 2. EnrichedGraphDiff metadata from diffUndoSnapshots (5 tests)
 * 3. graphDiff edge cases — port changes, autoInserted, simultaneous (5 tests)
 * 4. formatValueDetailed / formatNumberPrecision edge cases (5 tests)
 * 5. Transform processor factor edge cases (5 tests)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';

enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { compareGraphs } from '../utils/graphDiff';
import {
  formatValueDetailed,
  formatNumberPrecision,
  formatObjectTree,
} from '../utils/valueFormat';
import { executeGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

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
    s.executionTimings = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionStats = {
      executionCount: 0, totalDuration: 0, errorCount: 0,
      totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null,
      timeoutCount: 0,
    };
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.traceNodeId = null;
  });
}

function makeNode(id: string, overrides: Partial<EditorNode> = {}): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: 'Test',
    data: {},
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

function makeConnection(id: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    sourceNodeId: 'n1',
    sourcePortIndex: 0,
    targetNodeId: 'n2',
    targetPortIndex: 0,
    ...overrides,
  };
}

// ===========================================================================
// 1. getSnapshotSummary store action
// ===========================================================================

describe('getSnapshotSummary', () => {
  beforeEach(() => resetStore());

  it('returns current state summary for index -1', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xform = getState().addNode('transform', [4, 0, 0]);
    getState().addConnection(src, 0, xform, 0);

    const summary = getState().getSnapshotSummary(-1);
    expect(summary).not.toBeNull();
    expect(summary!.label).toBe('Current');
    expect(summary!.nodeCount).toBe(2);
    expect(summary!.connectionCount).toBe(1);
    expect(summary!.index).toBe(-1);
  });

  it('returns undo entry metadata for valid index', () => {
    getState().addNode('source', [0, 0, 0]); // pushes undo
    getState().addNode('transform', [4, 0, 0]); // pushes undo

    const history = getState().getUndoHistory();
    expect(history.undo.length).toBeGreaterThanOrEqual(2);

    const summary = getState().getSnapshotSummary(0);
    expect(summary).not.toBeNull();
    expect(typeof summary!.label).toBe('string');
    expect(typeof summary!.timestamp).toBe('number');
    expect(summary!.index).toBe(0);
  });

  it('returns null for out-of-range positive index', () => {
    const summary = getState().getSnapshotSummary(999);
    expect(summary).toBeNull();
  });

  it('returns null for out-of-range negative index (other than -1)', () => {
    const summary = getState().getSnapshotSummary(-2);
    expect(summary).toBeNull();
  });

  it('nodeCount reflects actual state at that snapshot', () => {
    getState().addNode('source', [0, 0, 0]); // undo[0]: 0 nodes → 1 node
    getState().addNode('transform', [4, 0, 0]); // undo[1]: 1 node → 2 nodes

    // Snapshot at index 0 should have 0 nodes (state before first addNode)
    const snap0 = getState().getSnapshotSummary(0);
    expect(snap0).not.toBeNull();
    expect(snap0!.nodeCount).toBe(0);

    // Snapshot at index 1 should have 1 node
    const snap1 = getState().getSnapshotSummary(1);
    expect(snap1).not.toBeNull();
    expect(snap1!.nodeCount).toBe(1);

    // Current (-1) should have 2 nodes
    const current = getState().getSnapshotSummary(-1);
    expect(current!.nodeCount).toBe(2);
  });
});

// ===========================================================================
// 2. EnrichedGraphDiff metadata from diffUndoSnapshots
// ===========================================================================

describe('diffUndoSnapshots — enriched metadata', () => {
  beforeEach(() => resetStore());

  it('returns null for out-of-range indices', () => {
    const result = getState().diffUndoSnapshots(999, -1);
    expect(result).toBeNull();
  });

  it('includes snapshotA and snapshotB metadata', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [4, 0, 0]);

    const diff = getState().diffUndoSnapshots(0, -1);
    expect(diff).not.toBeNull();
    expect(diff!.snapshotA).toBeDefined();
    expect(diff!.snapshotB).toBeDefined();
    expect(diff!.snapshotA.index).toBe(0);
    expect(diff!.snapshotB.index).toBe(-1);
  });

  it('calculates correct nodeCountDelta', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [4, 0, 0]);

    // Diff between state before any nodes (index 0) and current (-1 = 2 nodes)
    const diff = getState().diffUndoSnapshots(0, -1);
    expect(diff).not.toBeNull();
    expect(diff!.nodeCountDelta).toBe(2); // 0 → 2
    expect(diff!.snapshotA.nodeCount).toBe(0);
    expect(diff!.snapshotB.nodeCount).toBe(2);
  });

  it('calculates correct connectionCountDelta', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xform = getState().addNode('transform', [4, 0, 0]);
    getState().addConnection(src, 0, xform, 0);

    // After addConnection, undo stack has 3 entries (2 addNode + 1 addConnection)
    // Diff between entry 1 (after first addNode) and current
    const diff = getState().diffUndoSnapshots(1, -1);
    expect(diff).not.toBeNull();
    expect(diff!.connectionCountDelta).toBe(1); // 0 connections → 1 connection
  });

  it('shows negative delta when nodes are removed', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [4, 0, 0]);
    // Select and delete
    getState().toggleSelection(src);
    getState().deleteSelected();

    const history = getState().getUndoHistory();
    // Find the undo entry just before deletion
    const lastIdx = history.undo.length - 1;
    const diff = getState().diffUndoSnapshots(lastIdx, -1);
    expect(diff).not.toBeNull();
    expect(diff!.nodeCountDelta).toBeLessThan(0);
  });
});

// ===========================================================================
// 3. graphDiff edge cases — port changes, autoInserted, simultaneous
// ===========================================================================

describe('graphDiff — additional edge cases', () => {
  it('detects inputs port array changes', () => {
    const nodeA = makeNode('n1', {
      inputs: [{ id: 'a', label: 'a', portType: 'number' }],
    });
    const nodeB = makeNode('n1', {
      inputs: [{ id: 'a', label: 'a', portType: 'number' }, { id: 'b', label: 'b', portType: 'string' }],
    });

    const diff = compareGraphs(
      { n1: nodeA }, {},
      { n1: nodeB }, {},
    );
    expect(diff.isEmpty).toBe(false);
    expect(diff.nodeChanges[0].changedFields).toContain('inputs');
  });

  it('detects outputs port array changes', () => {
    const nodeA = makeNode('n1', {
      outputs: [{ id: 'out', label: 'out', portType: 'number' }],
    });
    const nodeB = makeNode('n1', {
      outputs: [], // removed outputs
    });

    const diff = compareGraphs(
      { n1: nodeA }, {},
      { n1: nodeB }, {},
    );
    expect(diff.isEmpty).toBe(false);
    expect(diff.nodeChanges[0].changedFields).toContain('outputs');
  });

  it('detects autoInserted field change', () => {
    const nodeA = makeNode('n1', { autoInserted: undefined });
    const nodeB = makeNode('n1', { autoInserted: true } as Partial<EditorNode>);

    const diff = compareGraphs(
      { n1: nodeA }, {},
      { n1: nodeB as EditorNode }, {},
    );
    expect(diff.isEmpty).toBe(false);
    expect(diff.nodeChanges[0].changedFields).toContain('autoInserted');
  });

  it('detects simultaneous node and connection changes', () => {
    const nodeA = makeNode('n1');
    const connA = makeConnection('c1');

    // State B adds a new node AND modifies the connection
    const nodeA2 = makeNode('n1');
    const nodeB2 = makeNode('n2', { title: 'New Node' });
    const connB = makeConnection('c1', { label: 'annotated' });

    const diff = compareGraphs(
      { n1: nodeA }, { c1: connA },
      { n1: nodeA2, n2: nodeB2 }, { c1: connB },
    );

    expect(diff.isEmpty).toBe(false);
    expect(diff.summary.nodesAdded).toBe(1);
    expect(diff.summary.connectionsModified).toBe(1);
  });

  it('summary counts are correct for mixed operations', () => {
    const diff = compareGraphs(
      { n1: makeNode('n1'), n2: makeNode('n2'), n3: makeNode('n3') },
      { c1: makeConnection('c1'), c2: makeConnection('c2') },
      // Remove n2, add n4, modify n1 title
      { n1: makeNode('n1', { title: 'Changed' }), n3: makeNode('n3'), n4: makeNode('n4') },
      { c1: makeConnection('c1') }, // removed c2
    );

    expect(diff.summary.nodesAdded).toBe(1);   // n4
    expect(diff.summary.nodesRemoved).toBe(1);  // n2
    expect(diff.summary.nodesModified).toBe(1); // n1 title changed
    expect(diff.summary.connectionsRemoved).toBe(1); // c2
    expect(diff.isEmpty).toBe(false);
  });
});

// ===========================================================================
// 4. formatValueDetailed / formatNumberPrecision edge cases
// ===========================================================================

describe('value formatter — edge cases', () => {
  it('formatValueDetailed handles undefined', () => {
    expect(formatValueDetailed(undefined)).toBe('undefined');
  });

  it('formatValueDetailed handles large arrays (> 20 items)', () => {
    const arr = Array.from({ length: 30 }, (_, i) => i);
    const result = formatValueDetailed(arr);
    // Should show preview of first 10 with truncation indicator
    expect(result).toContain('[0]:');
    expect(result).toContain('+20 more');
  });

  it('formatValueDetailed handles long strings (> 200 chars)', () => {
    const longStr = 'x'.repeat(250);
    const result = formatValueDetailed(longStr);
    // Should be truncated with ellipsis
    expect(result.length).toBeLessThan(250);
    expect(result).toContain('\u2026'); // ellipsis
  });

  it('formatNumberPrecision with locale uses locale separators', () => {
    // Use value < 1e6 to avoid scientific notation path
    const result = formatNumberPrecision(12345, 'en-US');
    // Should contain comma separators
    expect(result).toContain(',');
    expect(result).toBe('12,345');
  });

  it('formatObjectTree truncates when keys exceed maxKeys', () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) obj[`key${i}`] = i;
    // Default maxKeys is 6
    const result = formatObjectTree(obj);
    expect(result).toContain('+4 more'); // 10 - 6 = 4
  });
});

// ===========================================================================
// 5. Transform processor factor edge cases
// ===========================================================================

describe('transform processor — factor edge cases', () => {
  beforeEach(() => resetStore());

  it('factor = 0 produces output of offset only', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    const xform = getState().addNode('transform', [4, 0, 0]);
    getState().updateNodeData(xform, 'multiplier', 0);
    getState().updateNodeData(xform, 'offset', 5);
    getState().addConnection(src, 0, xform, 0);

    const result = executeGraph(getState().nodes, getState().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 42 * 0 + 5 = 5
    expect(xformResult!.outputs[0]).toBe(5);
  });

  it('negative factor negates input', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const xform = getState().addNode('transform', [4, 0, 0]);
    getState().updateNodeData(xform, 'multiplier', -1);
    getState().addConnection(src, 0, xform, 0);

    const result = executeGraph(getState().nodes, getState().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 10 * (-1) + 0 = -10
    expect(xformResult!.outputs[0]).toBe(-10);
  });

  it('default factor is 1 when not set', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 7);
    const xform = getState().addNode('transform', [4, 0, 0]);
    // Don't set multiplier — should default to 1
    getState().addConnection(src, 0, xform, 0);

    const result = executeGraph(getState().nodes, getState().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 7 * 1 + 0 = 7
    expect(xformResult!.outputs[0]).toBe(7);
  });

  it('connected factor input overrides data.multiplier', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const factorSrc = getState().addNode('source', [0, 0, 2]);
    getState().updateNodeData(factorSrc, 'value', 3);
    const xform = getState().addNode('transform', [4, 0, 0]);
    getState().updateNodeData(xform, 'multiplier', 100); // should be ignored
    // Connect main input
    getState().addConnection(src, 0, xform, 0);
    // Connect factor input (port 1)
    getState().addConnection(factorSrc, 0, xform, 1);

    const result = executeGraph(getState().nodes, getState().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 10 * 3 + 0 = 30, NOT 10 * 100
    expect(xformResult!.outputs[0]).toBe(30);
  });

  it('very large factor produces correct result', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 2);
    const xform = getState().addNode('transform', [4, 0, 0]);
    getState().updateNodeData(xform, 'multiplier', 1e6);
    getState().addConnection(src, 0, xform, 0);

    const result = executeGraph(getState().nodes, getState().connections);
    const xformResult = result.results.get(xform);
    expect(xformResult).toBeDefined();
    // 2 * 1e6 = 2000000
    expect(xformResult!.outputs[0]).toBe(2000000);
  });
});
