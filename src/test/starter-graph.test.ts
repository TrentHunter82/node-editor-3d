import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/editorStore';
import { seedStarterGraph } from '../utils/starterGraph';

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
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
  });
}

function getState() {
  return useEditorStore.getState();
}

describe('starter graph seed', () => {
  beforeEach(() => resetStore());

  it('seeds 5 nodes and 4 connections', () => {
    seedStarterGraph(getState());
    expect(Object.keys(getState().nodes).length).toBe(5);
    expect(Object.keys(getState().connections).length).toBe(4);
  });

  it('executes without errors and computes 5×2=10 through the chain', () => {
    seedStarterGraph(getState());
    const s = getState();
    expect(Object.keys(s.executionErrors).length).toBe(0);

    const transform = Object.values(s.nodes).find(n => n.type === 'transform')!;
    expect(s.nodeOutputs[transform.id][0]).toBe(10);

    const filter = Object.values(s.nodes).find(n => n.type === 'filter')!;
    expect(s.nodeOutputs[filter.id][0]).toBe(10); // 10 > 3 passes through
  });

  it('produces no error-level validation issues (warnings allowed)', () => {
    seedStarterGraph(getState());
    getState().validateGraph();
    const allMessages = Object.values(getState().validationErrors).flat();
    const errorLevel = allMessages.filter(m => !m.includes('(warning)'));
    expect(errorLevel).toEqual([]);
  });

  it('has every input port of every seeded node connected', () => {
    seedStarterGraph(getState());
    const s = getState();
    const connectedInputs = new Set(
      Object.values(s.connections).map(c => `${c.targetNodeId}:${c.targetPortIndex}`),
    );
    for (const node of Object.values(s.nodes)) {
      node.inputs.forEach((_, i) => {
        expect(connectedInputs.has(`${node.id}:${i}`), `${node.type} input ${i}`).toBe(true);
      });
    }
  });
});

describe('validation: unconnected inputs with defaults are warnings', () => {
  beforeEach(() => resetStore());

  it('transform with nothing wired gets warnings (has defaults), not errors', () => {
    const t = getState().addNode('transform', [0, 0, 0]);
    getState().validateGraph();
    const msgs = getState().validationErrors[t] ?? [];
    expect(msgs.length).toBeGreaterThan(0);
    // Both transform inputs have defaultValue → all messages are warnings
    expect(msgs.every(m => m.includes('(warning)'))).toBe(true);
  });

  it('default-less unconnected input is still an error', () => {
    // display's "value" input has no defaultValue
    const src = getState().addNode('source', [0, 0, 0]);
    const d = getState().addNode('display', [3, 0, 0]);
    // Wire source→display so the node isn't flagged as fully disconnected,
    // then remove to test: actually leave display unwired.
    void src;
    getState().validateGraph();
    const msgs = getState().validationErrors[d] ?? [];
    expect(msgs.some(m => m.includes('is not connected') && !m.includes('(warning)'))).toBe(true);
  });
});
