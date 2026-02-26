/**
 * Phase 45 E2E Regression Tests — Node Resize System
 *
 * Tests end-to-end workflows involving node resizing across various store
 * operations. Does NOT duplicate tests from phase44-integration.test.ts
 * (which covers resize+port positions, resize+AABB, resize+connections,
 * resize+serialization, resize+groups, resize+undo/redo).
 *
 * Focus: compound workflows, cross-feature interactions, edge cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  MIN_NODE_WIDTH, MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT, MAX_NODE_HEIGHT,
} from '../store/slices/nodeSlice';
import { getMinNodeDepth } from '../utils/nodeDepth';
import { getPortWorldPos } from '../utils/portPositions';
import { buildNodeAABBs, buildPortPositionCache, findConnectionsInRect } from '../utils/nodeBounds';
import { executeGraph } from '../utils/executionOrchestration';

enableMapSet();

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
    s.validationErrors = {};
    s.executionStats = { executionCount: 0, totalDuration: 0, errorCount: 0, timeoutCount: 0, totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null };
    s.diffHighlightIds = new Map();
  });
}

function getState() { return useEditorStore.getState(); }

// ============================================================================
// 1. Full workflow: create -> connect -> resize -> execute -> verify results
// ============================================================================

describe('Phase 45 E2E: resize does not alter execution results', () => {
  beforeEach(resetStore);

  it('resizing nodes does not change execution output values', () => {
    // Build: source(value=10) -> math(add, operand=5) -> output
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 10);
    const mathId = getState().addNode('math', [4, 0, 0]);
    getState().updateNodeData(mathId, 'operation', 'add');
    getState().updateNodeData(mathId, 'operand', 5);
    const outId = getState().addNode('output', [8, 0, 0]);

    getState().addConnection(srcId, 0, mathId, 0);
    getState().addConnection(mathId, 0, outId, 0);

    const state1 = getState();
    const result1 = executeGraph(state1.nodes, state1.connections);

    // Resize all nodes to various dimensions
    getState().resizeNode(srcId, 3.0, 1.5);
    getState().resizeNode(mathId, 4.0, 2.0);
    getState().resizeNode(outId, 2.5, 1.0);

    const state2 = getState();
    const result2 = executeGraph(state2.nodes, state2.connections);

    // Execution results should be identical regardless of resize
    expect(result2.errors.size).toBe(result1.errors.size);
    for (const [nodeId, nodeResult] of result1.results) {
      const r2 = result2.results.get(nodeId);
      expect(r2).toBeDefined();
      expect(r2!.outputs).toEqual(nodeResult.outputs);
    }
  });
});

// ============================================================================
// 2. Resize -> duplicateSelected -> clone gets same dimensions
// ============================================================================

describe('Phase 45 E2E: resize + duplicateSelected', () => {
  beforeEach(resetStore);

  it('duplicated node inherits the same custom width/height', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    getState().resizeNode(id, 3.5, 2.0);

    // Select and duplicate
    useEditorStore.setState(s => { s.selectedIds = new Set([id]); });
    const idMap = getState().duplicateSelected();
    expect(idMap).not.toBeNull();

    const cloneId = idMap!.get(id)!;
    expect(cloneId).toBeDefined();

    const clone = getState().nodes[cloneId];
    expect(clone.width).toBeCloseTo(3.5, 5);
    expect(clone.height).toBeCloseTo(2.0, 5);
  });
});

// ============================================================================
// 3. Resize -> copy/paste -> pasted node gets same dimensions
// ============================================================================

describe('Phase 45 E2E: resize + copy/paste', () => {
  beforeEach(resetStore);

  it('pasted node preserves width/height from the resized original', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 1.8);

    // Copy
    useEditorStore.setState(s => { s.selectedIds = new Set([id]); });
    getState().copySelected();

    // Paste
    getState().paste();

    // Find the pasted node (the newly selected one that is not the original)
    const allNodes = Object.values(getState().nodes);
    const pasted = allNodes.find(n => n.id !== id && n.type === 'source');
    expect(pasted).toBeDefined();
    expect(pasted!.width).toBeCloseTo(4.0, 5);
    expect(pasted!.height).toBeCloseTo(1.8, 5);
  });
});

// ============================================================================
// 4. Resize -> delete -> undo -> verify dimensions restored
// ============================================================================

describe('Phase 45 E2E: resize + delete + undo restores dimensions', () => {
  beforeEach(resetStore);

  it('undoing a deletion of a resized node restores its dimensions', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    getState().resizeNode(id, 5.0, 3.0);
    expect(getState().nodes[id].width).toBeCloseTo(5.0, 5);

    // Select and delete
    useEditorStore.setState(s => { s.selectedIds = new Set([id]); });
    getState().deleteSelected();
    expect(getState().nodes[id]).toBeUndefined();

    // Undo the deletion
    getState().undo();
    const restored = getState().nodes[id];
    expect(restored).toBeDefined();
    expect(restored.width).toBeCloseTo(5.0, 5);
    expect(restored.height).toBeCloseTo(3.0, 5);
  });
});

// ============================================================================
// 5. Resize multiple nodes -> undo -> all restored to original
// ============================================================================

describe('Phase 45 E2E: resize multiple nodes + undo restores all', () => {
  beforeEach(resetStore);

  it('undoing individual resizes restores each node', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [4, 0, 0]);
    const id3 = getState().addNode('output', [8, 0, 0]);

    // Resize each (3 separate undo entries)
    getState().resizeNode(id1, 2.0, 1.0);
    getState().resizeNode(id2, 3.0, 1.5);
    getState().resizeNode(id3, 4.0, 2.0);

    expect(getState().nodes[id1].width).toBeCloseTo(2.0, 5);
    expect(getState().nodes[id2].width).toBeCloseTo(3.0, 5);
    expect(getState().nodes[id3].width).toBeCloseTo(4.0, 5);

    // Undo all 3 resizes
    getState().undo(); // undo id3 resize
    expect(getState().nodes[id3].width).toBeUndefined();
    expect(getState().nodes[id2].width).toBeCloseTo(3.0, 5);

    getState().undo(); // undo id2 resize
    expect(getState().nodes[id2].width).toBeUndefined();
    expect(getState().nodes[id1].width).toBeCloseTo(2.0, 5);

    getState().undo(); // undo id1 resize
    expect(getState().nodes[id1].width).toBeUndefined();
    expect(getState().nodes[id1].height).toBe(getMinNodeDepth('source', 0, 2));
    expect(getState().nodes[id2].height).toBe(getMinNodeDepth('math', 2, 1));
    expect(getState().nodes[id3].height).toBe(getMinNodeDepth('output', 2, 0));
  });
});

// ============================================================================
// 6. Resize -> move node -> dimensions stay, position changes
// ============================================================================

describe('Phase 45 E2E: resize + move node', () => {
  beforeEach(resetStore);

  it('moving a resized node changes position but preserves dimensions', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    getState().resizeNode(id, 3.5, 1.5);

    // Move the node
    getState().updateNodePosition(id, [10, 0, -5]);

    const node = getState().nodes[id];
    expect(node.position).toEqual([10, 0, -5]);
    expect(node.width).toBeCloseTo(3.5, 5);
    expect(node.height).toBeCloseTo(1.5, 5);
  });
});

// ============================================================================
// 7. Resize -> update node data -> both dimensions and data persist
// ============================================================================

describe('Phase 45 E2E: resize + updateNodeData', () => {
  beforeEach(resetStore);

  it('updating node data does not affect dimensions and vice versa', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 2.5);
    getState().updateNodeData(id, 'operation', 'multiply');
    getState().updateNodeData(id, 'operand', 42);

    const node = getState().nodes[id];
    expect(node.width).toBeCloseTo(4.0, 5);
    expect(node.height).toBeCloseTo(2.5, 5);
    expect(node.data.operation).toBe('multiply');
    expect(node.data.operand).toBe(42);
  });
});

// ============================================================================
// 8. Resize -> create template -> instantiate -> dimensions carry over
// ============================================================================

describe('Phase 45 E2E: resize + template roundtrip', () => {
  beforeEach(resetStore);

  it('template instantiation preserves resized node dimensions', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const mathId = getState().addNode('math', [4, 0, 0]);
    getState().resizeNode(srcId, 3.0, 1.2);
    getState().resizeNode(mathId, 5.0, 2.5);
    getState().addConnection(srcId, 0, mathId, 0);

    // Save as template
    useEditorStore.setState(s => { s.selectedIds = new Set([srcId, mathId]); });
    const tmplId = getState().saveSelectionAsTemplate('Resized Template', 'Test');
    expect(tmplId).not.toBeNull();

    // Instantiate the template
    getState().instantiateTemplate(tmplId!, [20, 0, 0]);

    // Find instantiated nodes (newly selected, different IDs from originals)
    const allNodes = Object.values(getState().nodes);
    const instantiated = allNodes.filter(n => n.id !== srcId && n.id !== mathId);
    expect(instantiated.length).toBe(2);

    const instSrc = instantiated.find(n => n.type === 'source');
    const instMath = instantiated.find(n => n.type === 'math');
    expect(instSrc).toBeDefined();
    expect(instMath).toBeDefined();

    expect(instSrc!.width).toBeCloseTo(3.0, 5);
    expect(instSrc!.height).toBeCloseTo(1.2, 5);
    expect(instMath!.width).toBeCloseTo(5.0, 5);
    expect(instMath!.height).toBeCloseTo(2.5, 5);
  });
});

// ============================================================================
// 9. Resize -> exportAllGraphs -> importAllGraphs -> dimensions survive
// ============================================================================

describe('Phase 45 E2E: resize + full export/import roundtrip', () => {
  beforeEach(resetStore);

  it('all resized node dimensions survive export and re-import', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [4, 0, 0]);
    const id3 = getState().addNode('output', [8, 0, 0]);

    getState().resizeNode(id1, 2.5, 1.0);
    getState().resizeNode(id2, 4.5, 3.0);
    // id3 stays at default size

    getState().addConnection(id1, 0, id2, 0);
    getState().addConnection(id2, 0, id3, 0);

    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);

    const importedNodes = Object.values(getState().nodes);
    const impSrc = importedNodes.find(n => n.type === 'source');
    const impMath = importedNodes.find(n => n.type === 'math');
    const impOut = importedNodes.find(n => n.type === 'output');

    expect(impSrc).toBeDefined();
    expect(impSrc!.width).toBeCloseTo(2.5, 5);
    expect(impSrc!.height).toBeCloseTo(1.0, 5);

    expect(impMath).toBeDefined();
    expect(impMath!.width).toBeCloseTo(4.5, 5);
    expect(impMath!.height).toBeCloseTo(3.0, 5);

    // Default-size node should not have explicit dimensions
    expect(impOut).toBeDefined();
    expect(impOut!.width).toBeUndefined();
    expect(impOut!.height).toBe(getMinNodeDepth('output', 2, 0));

    // Connections survived
    const conns = Object.values(getState().connections);
    expect(conns.length).toBe(2);
  });
});

// ============================================================================
// 10. Multi-graph: resize in graph A, switch to B, switch back -> preserved
// ============================================================================

describe('Phase 45 E2E: resize + multi-graph switching', () => {
  beforeEach(resetStore);

  it('resized dimensions survive graph switch round-trip', () => {
    // Resize a node in the default graph
    const id = getState().addNode('math', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 2.0);
    expect(getState().nodes[id].width).toBeCloseTo(4.0, 5);

    // Create and switch to a second graph
    const graph2Id = getState().createGraph('Graph 2');
    expect(getState().activeGraphId).toBe(graph2Id);
    expect(Object.keys(getState().nodes).length).toBe(0);

    // Switch back to the default graph
    getState().switchGraph('default');
    expect(getState().activeGraphId).toBe('default');

    const restored = getState().nodes[id];
    expect(restored).toBeDefined();
    expect(restored.width).toBeCloseTo(4.0, 5);
    expect(restored.height).toBeCloseTo(2.0, 5);
  });
});

// ============================================================================
// 11. Resize -> undo -> add connection -> redo is discarded
// ============================================================================

describe('Phase 45 E2E: resize undo + new action clears redo', () => {
  beforeEach(resetStore);

  it('adding a node after undo-resize discards the redo stack', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);

    // Resize the source
    getState().resizeNode(srcId, 3.0, 1.0);
    expect(getState().nodes[srcId].width).toBeCloseTo(3.0, 5);

    // Undo the resize
    getState().undo();
    expect(getState().nodes[srcId].width).toBeUndefined();

    // Add a new node (pushes undo, which clears the redo stack)
    const newId = getState().addNode('math', [4, 0, 0]);

    // Redo should have no effect (redo stack was cleared by addNode)
    getState().redo();

    // The resize should NOT have been re-applied
    expect(getState().nodes[srcId].width).toBeUndefined();
    // The new node should still exist
    expect(getState().nodes[newId]).toBeDefined();
  });
});

// ============================================================================
// 12. Chain: create -> connect -> resize source -> check port cache ->
//     resize target -> recheck cache consistency
// ============================================================================

describe('Phase 45 E2E: chained resize with port cache consistency', () => {
  beforeEach(resetStore);

  it('port cache stays consistent through sequential resizes of source and target', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const mathId = getState().addNode('math', [6, 0, 0]);
    getState().addConnection(srcId, 0, mathId, 0);

    // Resize source
    getState().resizeNode(srcId, 3.0, 1.0);

    let cache = buildPortPositionCache(getState().nodes);
    let srcNode = getState().nodes[srcId];
    let mathNode = getState().nodes[mathId];

    // Verify source output port in cache matches direct computation
    let cachedSrcOut = cache.get(srcId, 'output', 0)!;
    let directSrcOut = getPortWorldPos(srcNode.position, 'output', 0, srcNode.outputs.length, srcNode.width!, srcNode.height!);
    expect(cachedSrcOut[0]).toBeCloseTo(directSrcOut[0], 10);
    expect(cachedSrcOut[2]).toBeCloseTo(directSrcOut[2], 10);

    // Target still at default size
    let cachedMathIn = cache.get(mathId, 'input', 0)!;
    let directMathIn = getPortWorldPos(mathNode.position, 'input', 0, mathNode.inputs.length);
    expect(cachedMathIn[0]).toBeCloseTo(directMathIn[0], 10);

    // Now resize target
    getState().resizeNode(mathId, 5.0, 2.0);

    cache = buildPortPositionCache(getState().nodes);
    mathNode = getState().nodes[mathId];

    cachedMathIn = cache.get(mathId, 'input', 0)!;
    directMathIn = getPortWorldPos(mathNode.position, 'input', 0, mathNode.inputs.length, mathNode.width!, mathNode.height!);
    expect(cachedMathIn[0]).toBeCloseTo(directMathIn[0], 10);
    expect(cachedMathIn[2]).toBeCloseTo(directMathIn[2], 10);

    // Source cache entry should still be valid (not affected by target resize)
    cachedSrcOut = cache.get(srcId, 'output', 0)!;
    srcNode = getState().nodes[srcId];
    directSrcOut = getPortWorldPos(srcNode.position, 'output', 0, srcNode.outputs.length, srcNode.width!, srcNode.height!);
    expect(cachedSrcOut[0]).toBeCloseTo(directSrcOut[0], 10);
  });
});

// ============================================================================
// 13. Resize -> clearGraph -> verify fresh graph has no resized nodes
// ============================================================================

describe('Phase 45 E2E: resize + clearGraph', () => {
  beforeEach(resetStore);

  it('clearGraph removes all nodes including resized ones', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [4, 0, 0]);
    getState().resizeNode(id1, 3.0, 1.5);
    getState().resizeNode(id2, 5.0, 3.0);

    expect(Object.keys(getState().nodes).length).toBe(2);

    getState().clearGraph();

    expect(Object.keys(getState().nodes).length).toBe(0);
    expect(Object.keys(getState().connections).length).toBe(0);
  });
});

// ============================================================================
// 14. Batch resize via setNodeSizes -> single resizeNode (undo) -> undo
//     restores all to pre-batch state
// ============================================================================

describe('Phase 45 E2E: setNodeSizes + resizeNode + undo', () => {
  beforeEach(resetStore);

  it('setNodeSizes (no undo) then resizeNode (undo) -> undo restores to batch state', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [4, 0, 0]);

    // Batch set sizes (no undo pushed)
    getState().setNodeSizes({
      [id1]: { width: 2.5, height: 1.0 },
      [id2]: { width: 3.5, height: 1.5 },
    });

    expect(getState().nodes[id1].width).toBeCloseTo(2.5, 5);
    expect(getState().nodes[id2].width).toBeCloseTo(3.5, 5);

    // Now use resizeNode on id1 (pushes undo with current state as snapshot)
    getState().resizeNode(id1, 5.0, 2.0);
    expect(getState().nodes[id1].width).toBeCloseTo(5.0, 5);

    // Undo should restore id1 to the batch state (2.5), id2 unchanged (3.5)
    getState().undo();
    expect(getState().nodes[id1].width).toBeCloseTo(2.5, 5);
    expect(getState().nodes[id1].height).toBeCloseTo(1.0, 5);
    expect(getState().nodes[id2].width).toBeCloseTo(3.5, 5);
    expect(getState().nodes[id2].height).toBeCloseTo(1.5, 5);
  });
});

// ============================================================================
// 15. Resize with connections: resize does not break existing connections
// ============================================================================

describe('Phase 45 E2E: resize does not break connections', () => {
  beforeEach(resetStore);

  it('existing connections remain valid after resizing both endpoints', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const mathId = getState().addNode('math', [5, 0, 0]);
    const outId = getState().addNode('output', [10, 0, 0]);

    const conn1 = getState().addConnection(srcId, 0, mathId, 0);
    const conn2 = getState().addConnection(mathId, 0, outId, 0);
    expect(conn1).not.toBeNull();
    expect(conn2).not.toBeNull();

    // Resize all nodes
    getState().resizeNode(srcId, MAX_NODE_WIDTH, MAX_NODE_HEIGHT);
    getState().resizeNode(mathId, 2.0, MIN_NODE_HEIGHT);
    getState().resizeNode(outId, 3.0, 1.5);

    // Connections should still exist and reference valid nodes
    const conns = getState().connections;
    expect(conns[conn1!]).toBeDefined();
    expect(conns[conn1!].sourceNodeId).toBe(srcId);
    expect(conns[conn1!].targetNodeId).toBe(mathId);
    expect(conns[conn2!]).toBeDefined();
    expect(conns[conn2!].sourceNodeId).toBe(mathId);
    expect(conns[conn2!].targetNodeId).toBe(outId);

    // Source and target nodes still exist
    expect(getState().nodes[srcId]).toBeDefined();
    expect(getState().nodes[mathId]).toBeDefined();
    expect(getState().nodes[outId]).toBeDefined();
  });
});

// ============================================================================
// 16. Resize node then lock it -> cannot resize further
// ============================================================================

describe('Phase 45 E2E: resize + lock prevents further resize', () => {
  beforeEach(resetStore);

  it('locked node cannot be resized', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    getState().resizeNode(id, 3.0, 1.5);
    expect(getState().nodes[id].width).toBeCloseTo(3.0, 5);

    // Lock the node
    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);

    // Attempt to resize further — should be a no-op
    getState().resizeNode(id, 5.0, 3.0);
    expect(getState().nodes[id].width).toBeCloseTo(3.0, 5);
    expect(getState().nodes[id].height).toBeCloseTo(1.5, 5);
  });
});

// ============================================================================
// 17. Stress: resize 50 nodes via setNodeSizes -> verify all get correct dims
// ============================================================================

describe('Phase 45 E2E: stress test — 50 node batch resize', () => {
  beforeEach(resetStore);

  it('setNodeSizes correctly sets dimensions for 50 nodes', () => {
    const nodeIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = getState().addNode('math', [i * 3, 0, 0]);
      nodeIds.push(id);
    }

    // Build batch sizes with varying dimensions
    const sizes: Record<string, { width: number; height: number }> = {};
    for (let i = 0; i < 50; i++) {
      const w = MIN_NODE_WIDTH + (i / 49) * (MAX_NODE_WIDTH - MIN_NODE_WIDTH);
      const h = MIN_NODE_HEIGHT + (i / 49) * (MAX_NODE_HEIGHT - MIN_NODE_HEIGHT);
      sizes[nodeIds[i]] = { width: w, height: h };
    }

    getState().setNodeSizes(sizes);

    // Verify all 50 nodes
    for (let i = 0; i < 50; i++) {
      const expectedW = MIN_NODE_WIDTH + (i / 49) * (MAX_NODE_WIDTH - MIN_NODE_WIDTH);
      const expectedH = MIN_NODE_HEIGHT + (i / 49) * (MAX_NODE_HEIGHT - MIN_NODE_HEIGHT);
      const node = getState().nodes[nodeIds[i]];
      expect(node.width).toBeCloseTo(expectedW, 5);
      expect(node.height).toBeCloseTo(expectedH, 5);
    }

    // Verify AABBs are consistent
    const aabbs = buildNodeAABBs(getState().nodes);
    expect(aabbs.size).toBe(50);
    for (let i = 0; i < 50; i++) {
      const aabb = aabbs.get(nodeIds[i])!;
      const node = getState().nodes[nodeIds[i]];
      expect(aabb.width).toBeCloseTo(node.width!, 5);
      expect(aabb.depth).toBeCloseTo(node.height!, 5);
    }
  });
});

// ============================================================================
// 18. Resize -> invalidateDownstream -> execution cache cleared
// ============================================================================

describe('Phase 45 E2E: resize + execution cache invalidation', () => {
  beforeEach(resetStore);

  it('resizing a node does not corrupt downstream results on re-execute', () => {
    // Build: source(5) -> math(multiply) <- source(3), math -> output
    // Math processor reads inputs[0] and inputs[1], so both inputs must be connected
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 5);
    const src2Id = getState().addNode('source', [0, 0, -2]);
    getState().updateNodeData(src2Id, 'value', 3);
    const mathId = getState().addNode('math', [4, 0, 0]);
    getState().updateNodeData(mathId, 'operation', 'multiply');
    const outId = getState().addNode('output', [8, 0, 0]);

    getState().addConnection(srcId, 0, mathId, 0);
    getState().addConnection(src2Id, 0, mathId, 1);
    getState().addConnection(mathId, 0, outId, 0);

    // First execution
    const state1 = getState();
    const result1 = executeGraph(state1.nodes, state1.connections);
    const mathOutput1 = result1.results.get(mathId);
    expect(mathOutput1).toBeDefined();
    expect(mathOutput1!.outputs[0]).toBe(15); // 5 * 3

    // Resize the source node
    getState().resizeNode(srcId, 5.0, 2.0);

    // Re-execute with a fresh cache (simulating cache invalidation)
    const state2 = getState();
    const result2 = executeGraph(state2.nodes, state2.connections);
    const mathOutput2 = result2.results.get(mathId);
    expect(mathOutput2).toBeDefined();
    expect(mathOutput2!.outputs[0]).toBe(15); // Same: 5 * 3

    // Results identical
    expect(result1.results.get(outId)?.outputs).toEqual(result2.results.get(outId)?.outputs);
  });
});

// ============================================================================
// 19. findConnectionsInRect accuracy after both source and target resized
// ============================================================================

describe('Phase 45 E2E: findConnectionsInRect with resized endpoints', () => {
  beforeEach(resetStore);

  it('finds connections accurately when both endpoints are resized', () => {
    // Place nodes far apart to make midpoint calculation clear
    const srcId = getState().addNode('source', [-10, 0, 0]);
    const mathId = getState().addNode('math', [10, 0, 0]);
    const connId = getState().addConnection(srcId, 0, mathId, 0);
    expect(connId).not.toBeNull();

    // Resize both
    getState().resizeNode(srcId, 4.0, 1.0);
    getState().resizeNode(mathId, 4.0, 1.0);

    const { connections, nodes } = getState();
    const srcNode = nodes[srcId];
    const mathNode = nodes[mathId];

    // Compute actual port positions after resize
    const srcOut = getPortWorldPos(srcNode.position, 'output', 0, srcNode.outputs.length, srcNode.width!, srcNode.height!);
    const mathIn = getPortWorldPos(mathNode.position, 'input', 0, mathNode.inputs.length, mathNode.width!, mathNode.height!);

    // A rect covering the midpoint of the connection should find it
    const midX = (srcOut[0] + mathIn[0]) / 2;
    const midZ = (srcOut[2] + mathIn[2]) / 2;
    const found = findConnectionsInRect(connections, nodes, midX - 0.5, midZ - 0.5, midX + 0.5, midZ + 0.5);
    expect(found).toContain(connId);

    // A rect around the source output port should also find it
    const foundSrc = findConnectionsInRect(connections, nodes, srcOut[0] - 0.1, srcOut[2] - 0.1, srcOut[0] + 0.1, srcOut[2] + 0.1);
    expect(foundSrc).toContain(connId);

    // A rect around the target input port should also find it
    const foundTgt = findConnectionsInRect(connections, nodes, mathIn[0] - 0.1, mathIn[2] - 0.1, mathIn[0] + 0.1, mathIn[2] + 0.1);
    expect(foundTgt).toContain(connId);

    // A rect far away from the connection should NOT find it
    const foundFar = findConnectionsInRect(connections, nodes, 50, 50, 60, 60);
    expect(foundFar).not.toContain(connId);
  });
});

// ============================================================================
// 20. Resize + group collapse: group boundary accounts for resized members
// ============================================================================

describe('Phase 45 E2E: resize + group collapse boundary', () => {
  beforeEach(resetStore);

  it('group bounding box updates after member node is resized', () => {
    const id1 = getState().addNode('source', [-3, 0, 0]);
    const id2 = getState().addNode('math', [3, 0, 0]);

    // Create group first
    useEditorStore.setState(s => { s.selectedIds = new Set([id1, id2]); });
    const groupId = getState().createGroup('Test Group');
    expect(groupId).not.toBeNull();

    // Compute initial group bounding box (via AABBs)
    const aabbsBefore = buildNodeAABBs(getState().nodes);
    const a1Before = aabbsBefore.get(id1)!;
    const a2Before = aabbsBefore.get(id2)!;
    const groupMaxXBefore = Math.max(a1Before.maxX, a2Before.maxX);
    const groupMaxZBefore = Math.max(a1Before.maxZ, a2Before.maxZ);

    // Resize math node to be much larger
    getState().resizeNode(id2, MAX_NODE_WIDTH, MAX_NODE_HEIGHT);

    // Recompute bounding box
    const aabbsAfter = buildNodeAABBs(getState().nodes);
    const a2After = aabbsAfter.get(id2)!;
    const groupMaxXAfter = Math.max(aabbsAfter.get(id1)!.maxX, a2After.maxX);
    const groupMaxZAfter = Math.max(aabbsAfter.get(id1)!.maxZ, a2After.maxZ);

    // Group boundary should be larger after resize
    expect(groupMaxXAfter).toBeGreaterThan(groupMaxXBefore);
    expect(groupMaxZAfter).toBeGreaterThan(groupMaxZBefore);

    // Verify the resized node AABB is at max constraints
    expect(a2After.width).toBeCloseTo(MAX_NODE_WIDTH, 5);
    expect(a2After.depth).toBeCloseTo(MAX_NODE_HEIGHT, 5);

    // Collapse the group
    getState().toggleGroupCollapse(groupId!);
    expect(getState().groups[groupId!].collapsed).toBe(true);

    // Node dimensions should still be preserved even when group is collapsed
    const collapsedNode = getState().nodes[id2];
    expect(collapsedNode.width).toBeCloseTo(MAX_NODE_WIDTH, 5);
    expect(collapsedNode.height).toBeCloseTo(MAX_NODE_HEIGHT, 5);
  });
});
