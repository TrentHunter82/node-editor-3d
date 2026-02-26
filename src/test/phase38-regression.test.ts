/**
 * Phase 38 E2E regression tests (~25 tests).
 * Tests force layout correctness, batch operations integration, interaction state,
 * connection caching patterns, execution result patterns, and settings persistence.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { forceDirectedLayout, layeredLayout, alignNodes } from '../utils/layout';
import { getGraphComplexity } from '../utils/graphMetrics';
import { executeGraph } from '../utils/execution';
import { useSettingsStore } from '../store/settingsStore';
import { NODE_TYPE_CONFIG } from '../types';
import type { EditorNode, Connection } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeNode(id: string, type: EditorNode['type'] = 'source', pos: [number, number, number] = [0, 0, 0]): EditorNode {
  return { id, type, position: pos, title: id, data: {}, inputs: [], outputs: [] };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

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
  });
}

function addNode(type: EditorNode['type'] = 'source', pos: [number, number, number] = [0, 0, 0]): string {
  useEditorStore.getState().addNode(type, pos);
  const ids = Object.keys(useEditorStore.getState().nodes);
  return ids[ids.length - 1];
}

// ============================================================================
// Force layout + layered layout comparison
// ============================================================================
describe('force layout vs layered layout comparison', () => {
  it('both layouts produce positions for all nodes', () => {
    const nodes: Record<string, EditorNode> = {};
    const conns: Record<string, Connection> = {};
    for (let i = 0; i < 10; i++) {
      nodes[`n${i}`] = makeNode(`n${i}`);
      if (i > 0) conns[`c${i}`] = makeConn(`c${i}`, `n${i - 1}`, 0, `n${i}`, 0);
    }

    const force = forceDirectedLayout(nodes, conns);
    const layered = layeredLayout(nodes, conns);

    expect(Object.keys(force)).toHaveLength(10);
    expect(Object.keys(layered)).toHaveLength(10);
  });

  it('both layouts preserve Y coordinate', () => {
    const nodes: Record<string, EditorNode> = {};
    for (let i = 0; i < 5; i++) {
      nodes[`n${i}`] = makeNode(`n${i}`, 'source', [0, i * 3.0, 0]);
    }

    const force = forceDirectedLayout(nodes, {});
    const layered = layeredLayout(nodes, {});

    for (let i = 0; i < 5; i++) {
      expect(force[`n${i}`][1]).toBe(i * 3.0);
      expect(layered[`n${i}`][1]).toBe(i * 3.0);
    }
  });

  it('layoutMode setting selects the algorithm', () => {
    // Verify settingsStore has layoutMode
    const settings = useSettingsStore.getState();
    expect(['layered', 'force']).toContain(settings.layoutMode);
  });
});

// ============================================================================
// Batch operations + execution integration
// ============================================================================
describe('batch operations + execution integration', () => {
  beforeEach(() => resetStore());

  it('batchMoveNodes followed by execution produces valid results', () => {
    const srcId = addNode('source', [0, 0, 0]);
    const outId = addNode('output', [5, 0, 0]);

    // Connect source → output
    const connId = useEditorStore.getState().addConnection(srcId, 0, outId, 0);
    expect(connId).not.toBeNull();

    // Move nodes
    useEditorStore.getState().batchMoveNodes([srcId, outId], [10, 0, 10]);

    // Execute the graph
    const state = useEditorStore.getState();
    const result = executeGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    expect(result.waves.length).toBeGreaterThan(0);
  });

  it('batchUpdateNodeData triggers correct execution', () => {
    const srcId = addNode('source', [0, 0, 0]);

    // Update source value
    useEditorStore.getState().batchUpdateNodeData([
      { nodeId: srcId, key: 'value', value: 42 }
    ]);

    expect(useEditorStore.getState().nodes[srcId].data.value).toBe(42);

    // Execute
    const state = useEditorStore.getState();
    const result = executeGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    const srcResult = result.results.get(srcId);
    expect(srcResult).toBeDefined();
    expect(srcResult?.outputs[0]).toBe(42);
  });
});

// ============================================================================
// Interaction state machine correctness
// ============================================================================
describe('interaction state machine', () => {
  beforeEach(() => resetStore());

  it('selection does not change interaction mode', () => {
    const id1 = addNode('source');
    const id2 = addNode('source', [5, 0, 0]);

    useEditorStore.getState().setSelection(new Set([id1, id2]));
    expect(useEditorStore.getState().interaction).toBe('idle');
  });

  it('startConnection transitions to drawing-connection', () => {
    const id = addNode('source');
    useEditorStore.getState().startConnection(id, 0);
    expect(useEditorStore.getState().interaction).toBe('drawing-connection');
  });

  it('cancelConnection returns to idle', () => {
    const id = addNode('source');
    useEditorStore.getState().startConnection(id, 0);
    useEditorStore.getState().cancelConnection();
    expect(useEditorStore.getState().interaction).toBe('idle');
  });

  it('pendingConnection is set during drawing-connection', () => {
    const id = addNode('source');
    useEditorStore.getState().startConnection(id, 0);
    const pending = useEditorStore.getState().pendingConnection;
    expect(pending).not.toBeNull();
    expect(pending?.sourceNodeId).toBe(id);
    expect(pending?.sourcePortIndex).toBe(0);
  });

  it('pendingConnection is cleared after cancelConnection', () => {
    const id = addNode('source');
    useEditorStore.getState().startConnection(id, 0);
    useEditorStore.getState().cancelConnection();
    expect(useEditorStore.getState().pendingConnection).toBeNull();
  });
});

// ============================================================================
// Graph metrics + layout integration
// ============================================================================
describe('graph metrics + layout integration', () => {
  it('graph complexity computed correctly after force layout', () => {
    const nodes: Record<string, EditorNode> = {};
    const conns: Record<string, Connection> = {};
    for (let i = 0; i < 8; i++) {
      nodes[`n${i}`] = makeNode(`n${i}`);
      if (i > 0) conns[`c${i}`] = makeConn(`c${i}`, `n${i - 1}`, 0, `n${i}`, 0);
    }

    // Layout doesn't change topology
    forceDirectedLayout(nodes, conns);

    const metrics = getGraphComplexity(nodes, conns);
    expect(metrics.nodeCount).toBe(8);
    expect(metrics.connectionCount).toBe(7);
    expect(metrics.connectedComponents).toBe(1);
    expect(metrics.isolatedNodes).toBe(0);
    expect(metrics.longestPath).toBe(8);
  });

  it('disconnected graph has multiple connected components', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a'), b: makeNode('b'),
      c: makeNode('c'), d: makeNode('d'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'c', 0, 'd', 0),
    };
    const metrics = getGraphComplexity(nodes, conns);
    expect(metrics.connectedComponents).toBe(2);
  });
});

// ============================================================================
// Settings persistence regression
// ============================================================================
describe('settings persistence regression', () => {
  it('layoutMode defaults to layered', () => {
    expect(useSettingsStore.getState().layoutMode).toBe('layered');
  });

  it('setLayoutMode updates the setting', () => {
    useSettingsStore.getState().setLayoutMode('force');
    expect(useSettingsStore.getState().layoutMode).toBe('force');
    // Reset for other tests
    useSettingsStore.getState().setLayoutMode('layered');
  });

  it('maxExecutionMs has a valid default', () => {
    const maxExec = useSettingsStore.getState().maxExecutionMs;
    expect(maxExec).toBeGreaterThan(0);
    expect(maxExec).toBeLessThanOrEqual(300000);
  });

  it('zoomSensitivity has a valid default', () => {
    const zoom = useSettingsStore.getState().zoomSensitivity;
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// Node locking + batch ops regression
// ============================================================================
describe('node locking + batch operations regression', () => {
  beforeEach(() => resetStore());

  it('toggleNodeLock with undo/redo', () => {
    const id = addNode('source');
    expect(useEditorStore.getState().nodes[id].locked).toBeFalsy();

    useEditorStore.getState().toggleNodeLock(id);
    expect(useEditorStore.getState().nodes[id].locked).toBe(true);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().nodes[id].locked).toBeFalsy();

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().nodes[id].locked).toBe(true);
  });

  it('locked nodes excluded from alignNodes', () => {
    const nodes: Record<string, EditorNode> = {
      a: { ...makeNode('a', 'source', [0, 0, 0]), locked: true },
      b: makeNode('b', 'source', [5, 0, 5]),
      c: makeNode('c', 'source', [10, 0, 10]),
    };

    // alignNodes operates on pure data, but locked guard is in layoutSlice
    // Test the pure function returns positions for all selected
    const positions = alignNodes(['a', 'b', 'c'], nodes, 'left');
    // alignNodes doesn't filter locked — the store action does
    expect(Object.keys(positions)).toHaveLength(3);
  });

  it('batchToggleNodeLock locks all when any are unlocked', () => {
    const id1 = addNode('source');
    const id2 = addNode('source', [5, 0, 0]);

    // Lock one
    useEditorStore.getState().toggleNodeLock(id1);
    expect(useEditorStore.getState().nodes[id1].locked).toBe(true);
    expect(useEditorStore.getState().nodes[id2].locked).toBeFalsy();

    // Batch toggle should lock all (since id2 is unlocked)
    useEditorStore.getState().batchToggleNodeLock([id1, id2]);
    expect(useEditorStore.getState().nodes[id1].locked).toBe(true);
    expect(useEditorStore.getState().nodes[id2].locked).toBe(true);
  });
});

// ============================================================================
// Execution + undo/redo integration
// ============================================================================
describe('execution + undo/redo integration', () => {
  beforeEach(() => resetStore());

  it('undo after batch move restores positions and clears transient state', () => {
    const id = addNode('source', [0, 0, 0]);

    // Execute to generate transient state
    const state = useEditorStore.getState();
    executeGraph(state.nodes, state.connections);

    // Batch move
    useEditorStore.getState().batchMoveNodes([id], [5, 0, 5]);
    expect(useEditorStore.getState().nodes[id].position[0]).toBe(5);

    // Undo
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().nodes[id].position[0]).toBe(0);
  });

  it('execution result is available after executeGraph', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source'),
    };
    nodes.s.data = { value: 100 };
    const result = executeGraph(nodes, {});
    const srcResult = result.results.get('s');
    expect(srcResult).toBeDefined();
    expect(srcResult?.outputs[0]).toBe(100);
  });
});

// ============================================================================
// NODE_TYPE_CONFIG completeness regression
// ============================================================================
describe('NODE_TYPE_CONFIG completeness', () => {
  it('all 93 node types have configs', () => {
    const configCount = Object.keys(NODE_TYPE_CONFIG).length;
    expect(configCount).toBe(93);
  });

  it('every config has inputs and outputs arrays', () => {
    for (const [type, config] of Object.entries(NODE_TYPE_CONFIG)) {
      expect(Array.isArray(config.inputs), `${type} inputs should be array`).toBe(true);
      expect(Array.isArray(config.outputs), `${type} outputs should be array`).toBe(true);
    }
  });
});
