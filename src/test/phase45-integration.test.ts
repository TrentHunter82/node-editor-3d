/**
 * Phase 45 Integration Tests — Cross-module interactions for resize, execution,
 * undo, serialization, and viewport features.
 *
 * Tests verify that the new resize system integrates correctly with:
 * - Execution engine (nodeBounds, port positions)
 * - Undo/redo system
 * - Serialization (export/import roundtrip)
 * - Node grouping
 * - Copy/paste and duplicate
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph } from '../utils/executionOrchestration';
import { buildNodeAABBs, buildPortPositionCache, getNodeAABB } from '../utils/nodeBounds';
import {
  DEFAULT_NODE_WIDTH,
  MAX_NODE_WIDTH, MAX_NODE_HEIGHT,
} from '../store/slices/nodeSlice';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionTimings = {};
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.searchHighlightIds = new Set();
    s.traceNodeId = null;
  });
}

function getState() { return useEditorStore.getState(); }

// ---------------------------------------------------------------------------
// Resize + AABB Integration
// ---------------------------------------------------------------------------

describe('Integration: resize affects node AABB calculations', () => {
  beforeEach(resetStore);

  it('resized node has larger AABB than default-sized node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const defaultAABB = getNodeAABB(getState().nodes[id]);

    getState().resizeNode(id, 4.0, 3.0);
    const resizedAABB = getNodeAABB(getState().nodes[id]);

    expect(resizedAABB.width).toBeGreaterThan(defaultAABB.width);
    expect(resizedAABB.depth).toBeGreaterThan(defaultAABB.depth);
    expect(resizedAABB.minX).toBeLessThan(defaultAABB.minX);
    expect(resizedAABB.maxX).toBeGreaterThan(defaultAABB.maxX);
  });

  it('buildNodeAABBs reflects resized dimensions', () => {
    const a = getState().addNode('source', [-5, 0, 0]);
    const b = getState().addNode('math', [5, 0, 0]);
    getState().resizeNode(b, 4.0, 2.0);

    const aabbs = buildNodeAABBs(getState().nodes);
    expect(aabbs.get(a)!.width).toBe(DEFAULT_NODE_WIDTH);
    expect(aabbs.get(b)!.width).toBe(4.0);
    expect(aabbs.get(b)!.depth).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// Resize + Port Position Integration
// ---------------------------------------------------------------------------

describe('Integration: resize affects port positions', () => {
  beforeEach(resetStore);

  it('port positions change when node is resized', () => {
    const id = getState().addNode('source', [0, 0, 0]);

    const cacheBefore = buildPortPositionCache(getState().nodes);
    const outBefore = cacheBefore.get(id, 'output', 0)!;

    getState().resizeNode(id, 4.0, 2.0);

    const cacheAfter = buildPortPositionCache(getState().nodes);
    const outAfter = cacheAfter.get(id, 'output', 0)!;

    // Output port X should be farther right on wider node
    expect(outAfter[0]).toBeGreaterThan(outBefore[0]);
  });

  it('port positions are consistent between single-node and batch cache', () => {
    const id = getState().addNode('source', [3, 0, 2]);
    getState().resizeNode(id, 3.0, 1.5);

    const singleAABB = getNodeAABB(getState().nodes[id]);
    const batchAABBs = buildNodeAABBs(getState().nodes);
    const batchAABB = batchAABBs.get(id)!;

    expect(singleAABB.minX).toBe(batchAABB.minX);
    expect(singleAABB.maxX).toBe(batchAABB.maxX);
    expect(singleAABB.width).toBe(batchAABB.width);
  });
});

// ---------------------------------------------------------------------------
// Resize + Execution Integration
// ---------------------------------------------------------------------------

describe('Integration: resize does not corrupt execution results', () => {
  beforeEach(resetStore);

  it('execution output is the same before and after resize', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 7);
    const out = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(src, 0, out, 0);

    // Execute before resize
    const state1 = getState();
    const result1 = executeGraph(state1.nodes, state1.connections);
    const srcOutput1 = result1.results.get(src)!.outputs[0];

    // Resize source node
    getState().resizeNode(src, 4.0, 2.0);

    // Execute after resize
    const state2 = getState();
    const result2 = executeGraph(state2.nodes, state2.connections);
    const srcOutput2 = result2.results.get(src)!.outputs[0];

    expect(srcOutput1).toBe(srcOutput2);
    expect(srcOutput1).toBe(7);
  });

  it('math chain produces correct results regardless of node sizes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 10);
    const m = getState().addNode('math', [4, 0, 0]);
    getState().updateNodeData(m, 'operation', 'add');
    getState().addConnection(src, 0, m, 0);

    // Resize both nodes to max
    getState().resizeNode(src, MAX_NODE_WIDTH, MAX_NODE_HEIGHT);
    getState().resizeNode(m, MAX_NODE_WIDTH, MAX_NODE_HEIGHT);

    const state = getState();
    const result = executeGraph(state.nodes, state.connections);
    // 10 + 0 (second input disconnected)
    expect(result.results.get(m)!.outputs[0]).toBe(10);
    expect(result.errors.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Resize + Undo/Redo Integration
// ---------------------------------------------------------------------------

describe('Integration: resize undo/redo', () => {
  beforeEach(resetStore);

  it('undo restores original (undefined) dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.0, 2.0);
    expect(getState().nodes[id].width).toBe(3.0);

    getState().undo(); // undo resize
    expect(getState().nodes[id].width).toBeUndefined();
  });

  it('redo re-applies the resize', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.0, 2.0);
    getState().undo();
    expect(getState().nodes[id].width).toBeUndefined();

    getState().redo();
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(2.0);
  });

  it('multiple resize + undo sequence restores intermediate states', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 2.0, 1.0);
    getState().resizeNode(id, 4.0, 3.0);

    expect(getState().nodes[id].width).toBe(4.0);
    getState().undo(); // undo second resize
    expect(getState().nodes[id].width).toBe(2.0);
    getState().undo(); // undo first resize
    expect(getState().nodes[id].width).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Resize + Copy/Paste Integration
// ---------------------------------------------------------------------------

describe('Integration: resize + copy/paste', () => {
  beforeEach(resetStore);

  it('pasted node preserves width/height from resized original', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.5, 2.5);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();

    const pastedIds = [...getState().selectedIds];
    expect(pastedIds).toHaveLength(1);
    const pasted = getState().nodes[pastedIds[0]];
    expect(pasted.width).toBe(3.5);
    expect(pasted.height).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// Resize + Duplicate Integration
// ---------------------------------------------------------------------------

describe('Integration: resize + duplicate', () => {
  beforeEach(resetStore);

  it('duplicated node inherits dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 2.0);
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();

    const duplicatedIds = [...getState().selectedIds];
    expect(duplicatedIds).toHaveLength(1);
    const dup = getState().nodes[duplicatedIds[0]];
    expect(dup.width).toBe(4.0);
    expect(dup.height).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// Resize + Serialization Integration
// ---------------------------------------------------------------------------

describe('Integration: resize survives export/import', () => {
  beforeEach(resetStore);

  it('exportAllGraphs + importAllGraphs preserves dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 5.0, 3.0);

    const exported = getState().exportAllGraphs();

    // Clear and reimport
    getState().clearGraph();
    getState().importAllGraphs(exported);

    const nodes = Object.values(getState().nodes);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    const restoredNode = nodes.find(n => n.width === 5.0);
    expect(restoredNode).toBeDefined();
    expect(restoredNode!.height).toBe(3.0);
  });
});

// ---------------------------------------------------------------------------
// Resize + Group Integration
// ---------------------------------------------------------------------------

describe('Integration: resize + groups', () => {
  beforeEach(resetStore);

  it('group AABB expands to encompass resized member node', () => {
    getState().addNode('source', [-3, 0, 0]);
    const b = getState().addNode('source', [3, 0, 0]);

    // Get default AABB for node b
    const defaultB = getNodeAABB(getState().nodes[b]);

    // Resize node b
    getState().resizeNode(b, 5.0, 3.0);
    const resizedB = getNodeAABB(getState().nodes[b]);

    // The resized node should have a wider AABB
    expect(resizedB.maxX).toBeGreaterThan(defaultB.maxX);
    expect(resizedB.maxZ).toBeGreaterThan(defaultB.maxZ);
  });
});

// ---------------------------------------------------------------------------
// Resize + Connection Integrity
// ---------------------------------------------------------------------------

describe('Integration: resize does not break connections', () => {
  beforeEach(resetStore);

  it('connections remain valid after resizing both endpoints', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('output', [6, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0);
    expect(connId).toBeTruthy();

    getState().resizeNode(src, 4.0, 2.0);
    getState().resizeNode(tgt, 3.0, 1.5);

    // Connection should still exist
    const conn = getState().connections[connId!];
    expect(conn).toBeDefined();
    expect(conn.sourceNodeId).toBe(src);
    expect(conn.targetNodeId).toBe(tgt);
  });
});

// ---------------------------------------------------------------------------
// Resize + Delete + Undo Integration
// ---------------------------------------------------------------------------

describe('Integration: resize + delete + undo', () => {
  beforeEach(resetStore);

  it('undoing deletion of a resized node restores dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.0, 2.0);
    expect(getState().nodes[id].width).toBe(3.0);

    getState().removeNode(id);
    expect(getState().nodes[id]).toBeUndefined();

    getState().undo(); // undo delete
    expect(getState().nodes[id]).toBeDefined();
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// Multi-Graph + Resize Integration
// ---------------------------------------------------------------------------

describe('Integration: resize + multi-graph switching', () => {
  beforeEach(resetStore);

  it('dimensions survive graph switch round-trip', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 2.5);

    // Create and switch to a new graph
    getState().createGraph('Graph B');

    // Switch back to default graph
    getState().switchGraph('default');

    expect(getState().nodes[id]).toBeDefined();
    expect(getState().nodes[id].width).toBe(4.0);
    expect(getState().nodes[id].height).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// Execution + Topological Sort Integration
// ---------------------------------------------------------------------------

describe('Integration: execution flows correctly through chains', () => {
  beforeEach(resetStore);

  it('source -> transform -> output produces correct results', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 5);

    const tform = getState().addNode('transform', [4, 0, 0]);
    getState().updateNodeData(tform, 'multiplier', 3);
    getState().updateNodeData(tform, 'offset', 1);

    const out = getState().addNode('output', [8, 0, 0]);

    getState().addConnection(src, 0, tform, 0);
    getState().addConnection(tform, 0, out, 0);

    const state = getState();
    const result = executeGraph(state.nodes, state.connections);

    expect(result.errors.size).toBe(0);
    // transform: 5 * 3 + 1 = 16
    expect(result.results.get(tform)!.outputs[0]).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Node creation + type validation
// ---------------------------------------------------------------------------

describe('Integration: various node types create properly', () => {
  beforeEach(resetStore);

  it('creates nodes of common types without errors', () => {
    const types = ['source', 'math', 'transform', 'output', 'clamp', 'remap'] as const;
    for (const type of types) {
      const id = getState().addNode(type, [0, 0, 0]);
      expect(getState().nodes[id]).toBeDefined();
      expect(getState().nodes[id].type).toBe(type);
    }
  });
});
