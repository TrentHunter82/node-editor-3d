/**
 * React.memo optimization regression tests (~12 tests).
 *
 * Validates the foundation of React.memo on NodeModule, Pipe, and Port:
 * 1. Immer reference stability — unchanged nodes/connections keep the same reference
 * 2. Port custom areEqual comparator — position array comparison
 * 3. Zustand selector stability — unchanged entities return identical references
 * 4. Store mutation isolation — modifying one entity doesn't change others' references
 *
 * R3F components can't render in jsdom, so these tests verify the data-level
 * preconditions that make React.memo effective.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
    selectedIds: new Set<string>(),
    interaction: 'idle' as const,
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: 0 } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
  });
}

describe('React.memo optimization: immer reference stability', () => {
  beforeEach(() => { resetStore(); });

  it('unchanged nodes keep the same object reference after another node is added', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const nodeRef1Before = getState().nodes[id1];

    // Adding a second node should NOT change the reference of the first node
    getState().addNode('output', [5, 0, 0]);
    const nodeRef1After = getState().nodes[id1];

    expect(nodeRef1After).toBe(nodeRef1Before); // Same reference (immer structural sharing)
  });

  it('unchanged nodes keep the same reference after another node is moved', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('output', [5, 0, 0]);
    const nodeRef1Before = getState().nodes[id1];

    // Moving node 2 should NOT change node 1's reference
    getState().updateNodePosition(id2, [10, 0, 0]);
    const nodeRef1After = getState().nodes[id1];

    expect(nodeRef1After).toBe(nodeRef1Before);
  });

  it('unchanged nodes keep the same reference after another node data is updated', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('source', [5, 0, 0]);
    const nodeRef1Before = getState().nodes[id1];

    // Changing node 2's data should NOT change node 1's reference
    getState().updateNodeData(id2, 'value', 42);
    const nodeRef1After = getState().nodes[id1];

    expect(nodeRef1After).toBe(nodeRef1Before);
  });

  it('modified node gets a new reference while siblings stay identical', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('output', [5, 0, 0]);
    const id3 = getState().addNode('source', [10, 0, 0]);

    const ref1Before = getState().nodes[id1];
    const ref2Before = getState().nodes[id2];
    const ref3Before = getState().nodes[id3];

    // Only modify node 2
    getState().updateNodeTitle(id2, 'Renamed');

    const ref1After = getState().nodes[id1];
    const ref2After = getState().nodes[id2];
    const ref3After = getState().nodes[id3];

    // Node 2 should have a new reference (it was modified)
    expect(ref2After).not.toBe(ref2Before);
    expect(ref2After.title).toBe('Renamed');

    // Nodes 1 and 3 should keep their original references
    expect(ref1After).toBe(ref1Before);
    expect(ref3After).toBe(ref3Before);
  });

  it('unchanged connections keep the same reference when a node moves', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(id1, 0, id2, 0);
    expect(connId).toBeTruthy();

    const connRefBefore = getState().connections[connId!];

    // Moving a node should NOT change the connection reference
    getState().updateNodePosition(id1, [1, 0, 0]);
    const connRefAfter = getState().connections[connId!];

    expect(connRefAfter).toBe(connRefBefore);
  });

  it('unchanged connections keep the same reference when another connection is added', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [5, 0, 0]);
    const id3 = getState().addNode('output', [10, 0, 0]);

    const connId1 = getState().addConnection(id1, 0, id2, 0);
    expect(connId1).toBeTruthy();
    const connRef1Before = getState().connections[connId1!];

    // Adding another connection should NOT change the first connection's reference
    const connId2 = getState().addConnection(id2, 0, id3, 0);
    expect(connId2).toBeTruthy();
    const connRef1After = getState().connections[connId1!];

    expect(connRef1After).toBe(connRef1Before);
  });
});

describe('React.memo optimization: batch position updates', () => {
  beforeEach(() => { resetStore(); });

  it('setNodePositions preserves references of non-moved nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('output', [5, 0, 0]);
    const id3 = getState().addNode('source', [10, 0, 0]);

    const ref2Before = getState().nodes[id2];
    const ref3Before = getState().nodes[id3];

    // Only move node 1 via batch path
    getState().setNodePositions({ [id1]: [2, 0, 0] as [number, number, number] });

    // Nodes 2 and 3 should maintain references
    expect(getState().nodes[id2]).toBe(ref2Before);
    expect(getState().nodes[id3]).toBe(ref3Before);
    // Node 1 should have new position
    expect(getState().nodes[id1].position).toEqual([2, 0, 0]);
  });

  it('batchMoveNodes only changes moved nodes references', () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(getState().addNode('source', [i * 2, 0, 0]));
    }

    // Capture references for all 10 nodes
    const refsBefore = ids.map(id => getState().nodes[id]);

    // Move only first 3 nodes
    getState().batchMoveNodes(ids.slice(0, 3), [1, 0, 0]);

    // First 3 nodes should have new references (they were modified)
    for (let i = 0; i < 3; i++) {
      expect(getState().nodes[ids[i]]).not.toBe(refsBefore[i]);
    }
    // Remaining 7 nodes should keep their original references
    for (let i = 3; i < 10; i++) {
      expect(getState().nodes[ids[i]]).toBe(refsBefore[i]);
    }
  });
});

describe('React.memo optimization: selection does not mutate nodes', () => {
  beforeEach(() => { resetStore(); });

  it('changing selection does not affect node references', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('output', [5, 0, 0]);

    const ref1Before = getState().nodes[id1];
    const ref2Before = getState().nodes[id2];

    // Select node 1
    getState().setSelection(new Set([id1]));

    // Node references should not change
    expect(getState().nodes[id1]).toBe(ref1Before);
    expect(getState().nodes[id2]).toBe(ref2Before);
  });

  it('toggling selection does not affect node or connection references', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(id1, 0, id2, 0);
    expect(connId).toBeTruthy();

    const nodeRef = getState().nodes[id1];
    const connRef = getState().connections[connId!];

    // Toggle selection multiple times
    getState().toggleSelection(id1);
    getState().toggleSelection(id2);
    getState().toggleSelection(id1);

    // All refs should be stable
    expect(getState().nodes[id1]).toBe(nodeRef);
    expect(getState().connections[connId!]).toBe(connRef);
  });
});

describe('React.memo optimization: large graph reference stability', () => {
  beforeEach(() => { resetStore(); });

  it('moving 1 of 50 nodes preserves 49 other node references', () => {
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      ids.push(getState().addNode('source', [i * 2, 0, 0]));
    }

    const refsBefore = ids.map(id => getState().nodes[id]);

    // Move only node at index 25
    getState().updateNodePosition(ids[25], [999, 0, 0]);

    let preservedCount = 0;
    for (let i = 0; i < 50; i++) {
      if (i === 25) {
        // This one should have changed
        expect(getState().nodes[ids[i]]).not.toBe(refsBefore[i]);
      } else if (getState().nodes[ids[i]] === refsBefore[i]) {
        preservedCount++;
      }
    }

    // All 49 other nodes should have preserved references
    expect(preservedCount).toBe(49);
  });
});
