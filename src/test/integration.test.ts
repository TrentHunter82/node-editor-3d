import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/editorStore';
import { saveGraph, clearGraph } from '../utils/serialization';
import { getPortWorldPos } from '../utils/portPositions';
import { NODE_TYPE_CONFIG } from '../types';
import type { NodeType, Connection } from '../types';

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
  });
}

function getState() {
  return useEditorStore.getState();
}

describe('Integration: Store + Serialization', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('full workflow: create graph, save, reload, verify integrity', () => {
    // Build a graph: source -> transform -> output
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);

    const c1 = getState().addConnection(src, 0, xfm, 0);
    const c2 = getState().addConnection(xfm, 0, out, 0);
    expect(c1).toBeTruthy();
    expect(c2).toBeTruthy();

    // Save
    saveGraph(getState().nodes, getState().connections);

    // Reset and reload
    resetStore();
    const loaded = getState().loadFromStorage();
    expect(loaded).toBe(true);

    // Verify all 3 nodes restored
    const nodeIds = Object.keys(getState().nodes);
    expect(nodeIds).toHaveLength(3);
    expect(nodeIds).toContain(src);
    expect(nodeIds).toContain(xfm);
    expect(nodeIds).toContain(out);

    // Verify 2 connections restored
    const connIds = Object.keys(getState().connections);
    expect(connIds).toHaveLength(2);

    // Verify connection data integrity
    const conn1 = getState().connections[c1!];
    expect(conn1.sourceNodeId).toBe(src);
    expect(conn1.targetNodeId).toBe(xfm);
  });

  it('new nodes get unique IDs even after loading saved graph', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    saveGraph(getState().nodes, getState().connections);

    resetStore();
    getState().loadFromStorage();

    // Adding a new node after load should not conflict with existing IDs
    const id2 = getState().addNode('source', [5, 0, 0]);
    expect(id2).not.toBe(id1);
    expect(Object.keys(getState().nodes)).toHaveLength(2);
  });
});

describe('Integration: Store + Port Positions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('port positions are consistent with node type config', () => {
    const nodeTypes: NodeType[] = ['source', 'transform', 'filter', 'output'];

    for (const type of nodeTypes) {
      const id = getState().addNode(type, [0, 0, 0]);
      const node = getState().nodes[id];
      const config = NODE_TYPE_CONFIG[type];

      // Verify input port count matches config
      expect(node.inputs).toHaveLength(config.inputs.length);
      // Verify output port count matches config
      expect(node.outputs).toHaveLength(config.outputs.length);

      // Verify port positions can be computed without error
      for (let i = 0; i < config.inputs.length; i++) {
        const pos = getPortWorldPos(node.position, 'input', i, config.inputs.length);
        expect(pos).toHaveLength(3);
        expect(pos.every((v: number) => isFinite(v))).toBe(true);
      }
      for (let i = 0; i < config.outputs.length; i++) {
        const pos = getPortWorldPos(node.position, 'output', i, config.outputs.length);
        expect(pos).toHaveLength(3);
        expect(pos.every((v: number) => isFinite(v))).toBe(true);
      }
    }
  });
});

describe('Integration: Connection Drawing + Store State', () => {
  beforeEach(() => {
    resetStore();
  });

  it('complete connection workflow updates all relevant state', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);

    // Initial state
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(0);

    // Start
    getState().startConnection(src, 0);
    expect(getState().interaction).toBe('drawing-connection');

    // Set snap target
    getState().setNearestSnapPort({ nodeId: tgt, portIndex: 0 });
    expect(getState().nearestSnapPort).toEqual({ nodeId: tgt, portIndex: 0 });

    // Complete
    getState().completeConnection(tgt, 0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().nearestSnapPort).toBeNull();
    expect(Object.keys(getState().connections)).toHaveLength(1);
  });

  it('disconnectAndReroute preserves source info for reconnection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt1 = getState().addNode('transform', [5, 0, 0]);
    const tgt2 = getState().addNode('filter', [10, 0, 0]);

    const connId = getState().addConnection(src, 0, tgt1, 0)!;
    getState().disconnectAndReroute(connId);

    // Now in drawing mode from original source
    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().pendingConnection!.sourceNodeId).toBe(src);

    // Complete to new target
    getState().completeConnection(tgt2, 0);
    expect(getState().interaction).toBe('idle');

    const conns = Object.values(getState().connections) as Connection[];
    expect(conns).toHaveLength(1);
    expect(conns[0].sourceNodeId).toBe(src);
    expect(conns[0].targetNodeId).toBe(tgt2);
  });
});

describe('Integration: Interaction Mode Transitions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('setInteraction to dragging-node disables OrbitControls before drag threshold', () => {
    // Regression test for BUG-node-drag-broken:
    // OrbitControls must be disabled IMMEDIATELY when a node mousedown occurs,
    // NOT after the 4px drag threshold. The hook sets interaction='dragging-node'
    // in startDrag() before the threshold check. This test verifies the store
    // contract that SceneSetup relies on: enabled={interaction === 'idle'}.

    expect(getState().interaction).toBe('idle');

    // Simulate: user clicks a node -> hook calls setInteraction('dragging-node')
    getState().setInteraction('dragging-node');
    expect(getState().interaction).toBe('dragging-node');
    // OrbitControls check: interaction !== 'idle' means controls are disabled
    expect(getState().interaction === 'idle').toBe(false);

    // Simulate: user releases without exceeding threshold (no actual drag)
    // -> hook calls setInteraction('idle')
    getState().setInteraction('idle');
    expect(getState().interaction).toBe('idle');
  });

  it('drawing-connection and dragging-node both disable OrbitControls', () => {
    // Both interaction modes must make interaction !== 'idle'
    // so SceneSetup's enabled={interaction === 'idle'} disables OrbitControls

    getState().setInteraction('dragging-node');
    expect(getState().interaction !== 'idle').toBe(true);

    getState().setInteraction('idle');

    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().interaction !== 'idle').toBe(true);
  });
});

describe('Integration: Selection + Node/Connection Deletion', () => {
  beforeEach(() => {
    resetStore();
  });

  it('deleting selected nodes cleans up connections and selection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0)!;

    // Select both node and connection
    getState().setSelection(new Set([src, connId]));
    expect(getState().selectedIds.size).toBe(2);

    // Delete the source node
    getState().removeNode(src);

    // Node, its connection, and selection references should all be gone
    expect(getState().nodes[src]).toBeUndefined();
    expect(getState().connections[connId]).toBeUndefined();
    expect(getState().selectedIds.has(src)).toBe(false);
    // connId was removed because the node was removed (cascading)
  });

  it('multiple nodes can be selected and individually removed', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    const n3 = getState().addNode('filter', [10, 0, 0]);

    getState().setSelection(new Set([n1, n2, n3]));
    expect(getState().selectedIds.size).toBe(3);

    getState().removeNode(n2);
    expect(getState().selectedIds.size).toBe(2);
    expect(getState().selectedIds.has(n2)).toBe(false);
    expect(getState().selectedIds.has(n1)).toBe(true);
    expect(getState().selectedIds.has(n3)).toBe(true);
  });
});

describe('Integration: Store + Serialization Edge Cases', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('clearGraph then loadFromStorage returns false', () => {
    getState().addNode('source', [0, 0, 0]);
    saveGraph(getState().nodes, getState().connections);
    clearGraph();
    resetStore();

    expect(getState().loadFromStorage()).toBe(false);
  });

  it('handles saving large graphs', () => {
    // Create 50 nodes
    const nodeIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      nodeIds.push(getState().addNode('transform', [i * 2, 0, 0]));
    }
    // Create 49 connections (chain)
    for (let i = 0; i < 49; i++) {
      getState().addConnection(nodeIds[i], 0, nodeIds[i + 1], 0);
    }

    saveGraph(getState().nodes, getState().connections);
    resetStore();

    const loaded = getState().loadFromStorage();
    expect(loaded).toBe(true);
    expect(Object.keys(getState().nodes)).toHaveLength(50);
    expect(Object.keys(getState().connections)).toHaveLength(49);
  });
});
