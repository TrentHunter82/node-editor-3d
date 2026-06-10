/**
 * Phase 39 E2E regression tests (~20 tests).
 * Comprehensive regression tests covering node CRUD, batch operations,
 * connection workflow, undo/redo chains, multi-graph isolation,
 * execution integration, and feature interactions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES, isPortTypeCompatible } from '../types';
import type { EditorNode, Connection, NodeType } from '../types';
import { executeGraph } from '../utils/execution';
import { forceDirectedLayout, FORCE_LAYOUT_MAX_NODES } from '../utils/layout';

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
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
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
  });
}

function getState() {
  return useEditorStore.getState();
}

function makeNode(id: string, type: EditorNode['type'] = 'source', pos: [number, number, number] = [0, 0, 0]): EditorNode {
  return { id, type, position: pos, title: id, data: {}, inputs: [], outputs: [] };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ============================================================================
// 1. Node CRUD still works (3 tests)
// ============================================================================
describe('Node CRUD still works', () => {
  beforeEach(() => resetStore());

  it('addNode creates node with correct defaults', () => {
    const id = getState().addNode('source', [1, 0, 2]);
    const node = getState().nodes[id];
    expect(node).toBeDefined();
    expect(node.type).toBe('source');
    expect(node.position).toEqual([1, 0, 2]);
    expect(node.data).toEqual({});
    // Source has 0 inputs, 2 outputs (value: number, label: string)
    expect(node.inputs).toHaveLength(0);
    expect(node.outputs).toHaveLength(2);
    expect(node.outputs[0].portType).toBe('number');
    expect(node.outputs[1].portType).toBe('string');
  });

  it('removeNode removes node and its connections', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const outId = getState().addNode('output', [5, 0, 0]);
    const connId = getState().addConnection(srcId, 0, outId, 0);
    expect(connId).not.toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(1);

    getState().removeNode(srcId);
    expect(getState().nodes[srcId]).toBeUndefined();
    // Connection should also be removed
    expect(Object.keys(getState().connections)).toHaveLength(0);
    // Output node should still exist
    expect(getState().nodes[outId]).toBeDefined();
  });

  it('updateNodeData updates data field correctly', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(id, 'value', 42);
    expect(getState().nodes[id].data.value).toBe(42);
    getState().updateNodeData(id, 'label', 'hello');
    expect(getState().nodes[id].data.label).toBe('hello');
    expect(getState().nodes[id].data.value).toBe(42);
  });
});

// ============================================================================
// 2. Batch operations are still atomic (3 tests)
// ============================================================================
describe('Batch operations are still atomic', () => {
  beforeEach(() => resetStore());

  it('batchMoveNodes moves multiple nodes with single undo entry', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('source', [5, 0, 5]);

    getState().batchMoveNodes([id1, id2], [10, 0, 10]);
    expect(getState().nodes[id1].position).toEqual([10, 0, 10]);
    expect(getState().nodes[id2].position).toEqual([15, 0, 15]);

    // A single undo should revert both moves
    getState().undo();
    expect(getState().nodes[id1].position).toEqual([0, 0, 0]);
    expect(getState().nodes[id2].position).toEqual([5, 0, 5]);
  });

  it('batchUpdateNodeData updates data with single undo, respects locked nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('source', [5, 0, 0]);

    // Lock id2
    getState().toggleNodeLock(id2);
    expect(getState().nodes[id2].locked).toBe(true);

    getState().batchUpdateNodeData([
      { nodeId: id1, key: 'value', value: 100 },
      { nodeId: id2, key: 'value', value: 200 },
    ]);

    // id1 should be updated, id2 should be skipped (locked)
    expect(getState().nodes[id1].data.value).toBe(100);
    expect(getState().nodes[id2].data.value).toBeUndefined();

    // Single undo reverts the batch update on id1
    getState().undo();
    expect(getState().nodes[id1].data.value).toBeUndefined();
  });

  it('batchUpdateNodeTitles updates titles with single undo', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [5, 0, 0]);

    const originalTitle1 = getState().nodes[id1].title;
    const originalTitle2 = getState().nodes[id2].title;

    getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'Alpha' },
      { nodeId: id2, title: 'Beta' },
    ]);

    expect(getState().nodes[id1].title).toBe('Alpha');
    expect(getState().nodes[id2].title).toBe('Beta');

    // Single undo reverts both title changes
    getState().undo();
    expect(getState().nodes[id1].title).toBe(originalTitle1);
    expect(getState().nodes[id2].title).toBe(originalTitle2);
  });
});

// ============================================================================
// 3. Connection workflow (3 tests)
// ============================================================================
describe('Connection workflow', () => {
  beforeEach(() => resetStore());

  it('addConnection creates valid connection with type-compatible ports', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const mathId = getState().addNode('math', [5, 0, 0]);

    // Source output[0] is number, math input[0] is number — compatible
    const connId = getState().addConnection(srcId, 0, mathId, 0);
    expect(connId).not.toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(1);

    const conn = getState().connections[connId!];
    expect(conn.sourceNodeId).toBe(srcId);
    expect(conn.sourcePortIndex).toBe(0);
    expect(conn.targetNodeId).toBe(mathId);
    expect(conn.targetPortIndex).toBe(0);
  });

  it('addConnection rejects self-connection', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);

    const connId = getState().addConnection(srcId, 0, srcId, 0);
    expect(connId).toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('addConnection rejects incompatible port types (string output to number input without any)', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const mathId = getState().addNode('math', [5, 0, 0]);

    // Source output[1] is string, math input[0] is number — incompatible
    expect(isPortTypeCompatible('string', 'number')).toBe(false);
    const connId = getState().addConnection(srcId, 1, mathId, 0);
    expect(connId).toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });
});

// ============================================================================
// 4. Undo/redo chains (3 tests)
// ============================================================================
describe('Undo/redo chains', () => {
  beforeEach(() => resetStore());

  it('multiple undo/redo cycles do not corrupt state', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('source', [5, 0, 0]);
    getState().addNode('source', [10, 0, 0]);

    // Undo all three
    getState().undo(); // remove node 3
    getState().undo(); // remove node 2
    getState().undo(); // remove node 1
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Redo all three
    getState().redo();
    getState().redo();
    getState().redo();
    expect(Object.keys(getState().nodes)).toHaveLength(3);

    // Undo two, redo one — should still be consistent
    getState().undo();
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    getState().redo();
    expect(Object.keys(getState().nodes)).toHaveLength(2);

    // Verify node data integrity
    for (const node of Object.values(getState().nodes)) {
      expect(node.type).toBe('source');
      expect(node.outputs).toHaveLength(2);
    }
  });

  it('addNodeAndConnect undo removes both node and connection', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);

    // addNodeAndConnect creates a new node + connection as a compound action
    const newNodeId = getState().addNodeAndConnect('math', [5, 0, 0], srcId, 0, true);
    expect(newNodeId).not.toBeNull();
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(Object.keys(getState().connections)).toHaveLength(1);

    // Single undo should remove both the node and the connection
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(Object.keys(getState().connections)).toHaveLength(0);
    expect(getState().nodes[srcId]).toBeDefined();
  });

  it('redo after undo restores exact state', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 99);
    getState().updateNodeTitle(srcId, 'MySource');

    // Capture state before undo
    const titleBefore = getState().nodes[srcId].title;
    const dataBefore = getState().nodes[srcId].data.value;
    expect(titleBefore).toBe('MySource');
    expect(dataBefore).toBe(99);

    // Undo title change, then redo
    getState().undo();
    expect(getState().nodes[srcId].title).not.toBe('MySource');
    getState().redo();
    expect(getState().nodes[srcId].title).toBe('MySource');
    expect(getState().nodes[srcId].data.value).toBe(99);
  });
});

// ============================================================================
// 5. Multi-graph isolation (2 tests)
// ============================================================================
describe('Multi-graph isolation', () => {
  beforeEach(() => resetStore());

  it('nodes in graph A do not appear in graph B after switchGraph', () => {
    // Add nodes to default graph
    const srcId = getState().addNode('source', [0, 0, 0]);
    const mathId = getState().addNode('math', [5, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(2);

    // Create and switch to a new graph
    const graphBId = getState().createGraph('Graph B');
    getState().switchGraph(graphBId);
    expect(getState().activeGraphId).toBe(graphBId);

    // Graph B should have no nodes
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Switch back to default
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(getState().nodes[srcId]).toBeDefined();
    expect(getState().nodes[mathId]).toBeDefined();
  });

  it('execution state does not leak between graphs after switchGraph', () => {
    // Execute in default graph
    const srcId = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(srcId, 'value', 42);
    const stateA = getState();
    const resultA = executeGraph(stateA.nodes, stateA.connections);
    expect(resultA.errors.size).toBe(0);

    // Switch to new graph
    const graphBId = getState().createGraph('Graph B');
    getState().switchGraph(graphBId);

    // Execution in empty graph B should produce no results
    const stateB = getState();
    const resultB = executeGraph(stateB.nodes, stateB.connections);
    expect(resultB.results.size).toBe(0);
    expect(resultB.waves).toHaveLength(0);

    // Transient execution state should be cleared on switch
    expect(Object.keys(getState().executionStates)).toHaveLength(0);
    expect(Object.keys(getState().nodeOutputs)).toHaveLength(0);
    expect(Object.keys(getState().executionErrors)).toHaveLength(0);
  });
});

// ============================================================================
// 6. Execution integration (2 tests)
// ============================================================================
describe('Execution integration', () => {
  beforeEach(() => resetStore());

  it('source → transform chain executes correctly via executeGraph', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const xfId = getState().addNode('transform', [5, 0, 0]);
    const outId = getState().addNode('output', [10, 0, 0]);

    // Set source value
    getState().updateNodeData(srcId, 'value', 10);
    // Set transform multiplier (data key is 'multiplier', not 'factor') and offset
    getState().updateNodeData(xfId, 'multiplier', 3);
    getState().updateNodeData(xfId, 'offset', 5);

    // Connect source.value → transform.in
    const conn1 = getState().addConnection(srcId, 0, xfId, 0);
    expect(conn1).not.toBeNull();
    // Connect transform.result → output.data
    const conn2 = getState().addConnection(xfId, 0, outId, 0);
    expect(conn2).not.toBeNull();

    const state = getState();
    const result = executeGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    expect(result.waves.length).toBeGreaterThan(0);

    // Source outputs value 10
    const srcResult = result.results.get(srcId);
    expect(srcResult?.outputs[0]).toBe(10);

    // Transform: in(10) * multiplier(3) + offset(5) = 35
    const xfResult = result.results.get(xfId);
    expect(xfResult?.outputs[0]).toBe(35);
  });

  it('executeGraph with no connections still produces results for each node', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('source', [5, 0, 0]);
    getState().updateNodeData(id1, 'value', 7);
    getState().updateNodeData(id2, 'value', 13);

    const state = getState();
    const result = executeGraph(state.nodes, state.connections);

    expect(result.errors.size).toBe(0);
    // Both nodes should have results even without connections
    expect(result.results.has(id1)).toBe(true);
    expect(result.results.has(id2)).toBe(true);
    expect(result.results.get(id1)?.outputs[0]).toBe(7);
    expect(result.results.get(id2)?.outputs[0]).toBe(13);
  });
});

// ============================================================================
// 7. Force layout (2 tests)
// ============================================================================
describe('Force layout', () => {
  it('forceDirectedLayout converges for small graph (nodes do not stay at origin)', () => {
    const nodes: Record<string, EditorNode> = {};
    const conns: Record<string, Connection> = {};
    for (let i = 0; i < 6; i++) {
      nodes[`n${i}`] = makeNode(`n${i}`, 'source', [0, 0, 0]);
      if (i > 0) {
        conns[`c${i}`] = makeConn(`c${i}`, `n${i - 1}`, 0, `n${i}`, 0);
      }
    }

    const positions = forceDirectedLayout(nodes, conns);
    expect(Object.keys(positions)).toHaveLength(6);

    // At least some nodes should have moved away from origin after layout
    const nonOrigin = Object.values(positions).filter(
      pos => Math.abs(pos[0]) > 0.01 || Math.abs(pos[2]) > 0.01
    );
    expect(nonOrigin.length).toBeGreaterThan(0);
  });

  it('forceDirectedLayout respects max node guard (>150 nodes returns layered fallback)', () => {
    const nodes: Record<string, EditorNode> = {};
    const conns: Record<string, Connection> = {};
    const count = FORCE_LAYOUT_MAX_NODES + 1; // 151 nodes

    for (let i = 0; i < count; i++) {
      nodes[`n${i}`] = makeNode(`n${i}`, 'source', [0, 0, 0]);
      if (i > 0) {
        conns[`c${i}`] = makeConn(`c${i}`, `n${i - 1}`, 0, `n${i}`, 0);
      }
    }

    // Should still return positions (falls back to layered layout internally)
    const positions = forceDirectedLayout(nodes, conns);
    expect(Object.keys(positions)).toHaveLength(count);

    // Verify it returned valid positions (not all identical)
    const uniqueX = new Set(Object.values(positions).map(p => p[0]));
    expect(uniqueX.size).toBeGreaterThan(1);
  });
});

// ============================================================================
// 8. NODE_TYPE_CONFIG completeness (2 tests)
// ============================================================================
describe('NODE_TYPE_CONFIG completeness', () => {
  it('all 93 node types have valid inputs/outputs arrays', () => {
    const configCount = Object.keys(NODE_TYPE_CONFIG).length;
    expect(configCount).toBe(94);

    for (const [type, config] of Object.entries(NODE_TYPE_CONFIG)) {
      expect(Array.isArray(config.inputs), `${type} inputs should be an array`).toBe(true);
      expect(Array.isArray(config.outputs), `${type} outputs should be an array`).toBe(true);
      // Each port config should have a label and portType
      for (const port of config.inputs) {
        expect(port.label, `${type} input port missing label`).toBeTruthy();
        expect(port.portType, `${type} input port missing portType`).toBeTruthy();
      }
      for (const port of config.outputs) {
        expect(port.label, `${type} output port missing label`).toBeTruthy();
        expect(port.portType, `${type} output port missing portType`).toBeTruthy();
      }
    }
  });

  it('all node types have entries in NODE_CATEGORIES', () => {
    const configTypes = Object.keys(NODE_TYPE_CONFIG) as NodeType[];
    const categoryTypes = Object.keys(NODE_CATEGORIES) as NodeType[];

    // Every type in NODE_TYPE_CONFIG should have a category
    for (const type of configTypes) {
      expect(
        NODE_CATEGORIES[type],
        `${type} is missing from NODE_CATEGORIES`
      ).toBeDefined();
    }

    // Category count should match config count
    expect(categoryTypes.length).toBe(configTypes.length);
  });
});
