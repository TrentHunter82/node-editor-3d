import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, snapToGrid } from './editorStore';
import { layeredLayout, alignNodes } from '../utils/layout';
import { validateGraph } from '../utils/validation';
import { importFromJSON, loadMultiGraph, saveMultiGraph } from '../utils/serialization';
import type { EditorNode, Connection } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    showValuePreviews: false,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
  });
}

function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  if (getState().canRedo()) {
    getState().pushUndoSnapshot();
    getState().undo();
  }
}

function getState() {
  return useEditorStore.getState();
}

// ===========================================================================
// Store Action Edge Cases
// ===========================================================================

describe('Store Actions - Edge Cases', () => {
  beforeEach(() => { drainUndoRedo(); resetStore(); });

  // -----------------------------------------------------------------------
  // selectConnected edge cases
  // -----------------------------------------------------------------------
  describe('selectConnected', () => {
    it('does nothing when no nodes are selected', () => {
      getState().addNode('source');
      getState().setSelection(new Set());
      getState().selectConnected('downstream');
      expect(getState().selectedIds.size).toBe(0);
    });

    it('handles diamond graph topology without duplicates', () => {
      //   S
      //  / \
      // A   B
      //  \ /
      //   D
      const s = getState().addNode('source', [0, 0, 0]);
      const a = getState().addNode('transform', [2, 0, -1]);
      const b = getState().addNode('transform', [2, 0, 1]);
      const d = getState().addNode('math', [4, 0, 0]);

      getState().addConnection(s, 0, a, 0);
      getState().addConnection(s, 0, b, 0);
      getState().addConnection(a, 0, d, 0);
      getState().addConnection(b, 0, d, 1);

      getState().setSelection(new Set([s]));
      getState().selectConnected('downstream');
      expect(getState().selectedIds.size).toBe(4);
      expect(getState().selectedIds.has(s)).toBe(true);
      expect(getState().selectedIds.has(a)).toBe(true);
      expect(getState().selectedIds.has(b)).toBe(true);
      expect(getState().selectedIds.has(d)).toBe(true);
    });

    it('upstream selection stops at source nodes', () => {
      const s = getState().addNode('source', [0, 0, 0]);
      const t = getState().addNode('transform', [2, 0, 0]);
      const o = getState().addNode('output', [4, 0, 0]);

      getState().addConnection(s, 0, t, 0);
      getState().addConnection(t, 0, o, 0);

      getState().setSelection(new Set([o]));
      getState().selectConnected('upstream');
      expect(getState().selectedIds.size).toBe(3);
      expect(getState().selectedIds.has(s)).toBe(true);
      expect(getState().selectedIds.has(t)).toBe(true);
      expect(getState().selectedIds.has(o)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // boxSelect edge cases
  // -----------------------------------------------------------------------
  describe('boxSelect', () => {
    it('degenerate box (zero width) selects no nodes', () => {
      getState().addNode('source', [0, 0, 0]);
      // boxSelect(minX, minZ, maxX, maxZ, additive)
      getState().boxSelect(5, 5, 5, 5, false);
      expect(getState().selectedIds.size).toBe(0);
    });

    it('box covering all nodes selects all', () => {
      const a = getState().addNode('source', [0, 0, 0]);
      const b = getState().addNode('transform', [2, 0, 2]);
      getState().boxSelect(-10, -10, 10, 10, false);
      expect(getState().selectedIds.has(a)).toBe(true);
      expect(getState().selectedIds.has(b)).toBe(true);
    });

    it('additive mode preserves existing selection', () => {
      const a = getState().addNode('source', [0, 0, 0]);
      const b = getState().addNode('transform', [5, 0, 5]);
      getState().setSelection(new Set([a]));
      // Select box only around b, but additive
      getState().boxSelect(4, 4, 6, 6, true);
      expect(getState().selectedIds.has(a)).toBe(true);
      expect(getState().selectedIds.has(b)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // alignSelected edge cases
  // -----------------------------------------------------------------------
  describe('alignSelected', () => {
    it('single node selected: alignment is no-op', () => {
      const a = getState().addNode('source', [5, 0, 5]);
      getState().setSelection(new Set([a]));
      getState().alignSelected('left');
      expect(getState().nodes[a].position).toEqual([5, 0, 5]);
    });

    it('aligns multiple nodes left', () => {
      const a = getState().addNode('source', [1, 0, 0]);
      const b = getState().addNode('source', [5, 0, 0]);
      const c = getState().addNode('source', [3, 0, 0]);
      getState().setSelection(new Set([a, b, c]));
      getState().alignSelected('left');
      expect(getState().nodes[a].position[0]).toBe(1);
      expect(getState().nodes[b].position[0]).toBe(1);
      expect(getState().nodes[c].position[0]).toBe(1);
    });

    it('aligns multiple nodes right', () => {
      const a = getState().addNode('source', [1, 0, 0]);
      const b = getState().addNode('source', [5, 0, 0]);
      getState().setSelection(new Set([a, b]));
      getState().alignSelected('right');
      expect(getState().nodes[a].position[0]).toBe(5);
      expect(getState().nodes[b].position[0]).toBe(5);
    });

    it('aligns center-x', () => {
      const a = getState().addNode('source', [0, 0, 0]);
      const b = getState().addNode('source', [10, 0, 0]);
      getState().setSelection(new Set([a, b]));
      getState().alignSelected('center-x');
      expect(getState().nodes[a].position[0]).toBe(5);
      expect(getState().nodes[b].position[0]).toBe(5);
    });

    it('aligns center-z', () => {
      const a = getState().addNode('source', [0, 0, 2]);
      const b = getState().addNode('source', [0, 0, 8]);
      getState().setSelection(new Set([a, b]));
      getState().alignSelected('center-z');
      expect(getState().nodes[a].position[2]).toBe(5);
      expect(getState().nodes[b].position[2]).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // autoLayout edge cases
  // -----------------------------------------------------------------------
  describe('autoLayout', () => {
    it('handles disconnected subgraphs', () => {
      const a = getState().addNode('source', [0, 0, 0]);
      const b = getState().addNode('transform', [0, 0, 0]);
      getState().addNode('source', [0, 0, 0]); // disconnected
      getState().addConnection(a, 0, b, 0);

      getState().autoLayout();

      // All nodes should have been laid out (positions changed)
      const positions = Object.values(getState().nodes).map(n => n.position);
      // No two nodes should overlap at exactly the same position
      const posStrings = positions.map(p => p.join(','));
      expect(new Set(posStrings).size).toBe(positions.length);
    });
  });

  // -----------------------------------------------------------------------
  // importWorkflow edge cases
  // -----------------------------------------------------------------------
  describe('importWorkflow', () => {
    it('rejects invalid JSON', () => {
      const result = importFromJSON('not valid json');
      expect(result).toBeNull();
    });

    it('rejects data with nodes as array', () => {
      const result = importFromJSON(JSON.stringify({ nodes: [], connections: {} }));
      expect(result).toBeNull();
    });

    it('accepts minimal valid data', () => {
      const result = importFromJSON(JSON.stringify({ nodes: {}, connections: {} }));
      expect(result).not.toBeNull();
      expect(result!.nodes).toEqual({});
    });

    it('rejects data with non-object groups', () => {
      const result = importFromJSON(JSON.stringify({ nodes: {}, connections: {}, groups: 'bad' }));
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // loadMultiGraph edge cases
  // -----------------------------------------------------------------------
  describe('loadMultiGraph', () => {
    afterEach(() => { localStorage.clear(); });

    it('returns null for empty localStorage', () => {
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      localStorage.setItem('node-editor-3d-graph', 'invalid{json');
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for array', () => {
      localStorage.setItem('node-editor-3d-graph', '[1,2,3]');
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for null stored', () => {
      localStorage.setItem('node-editor-3d-graph', 'null');
      expect(loadMultiGraph()).toBeNull();
    });

    it('migrates legacy single-graph format', () => {
      const legacy = {
        nodes: { 'n-1': { id: 'n-1', type: 'source', position: [0, 0, 0], title: 'Source', data: {}, inputs: [], outputs: [] } },
        connections: {},
      };
      localStorage.setItem('node-editor-3d-graph', JSON.stringify(legacy));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect(result!.version).toBe(2);
      expect(result!.graphs.default.nodes['n-1']).toBeDefined();
    });

    it('roundtrip: saveMultiGraph then loadMultiGraph', () => {
      const storage = {
        version: 2 as const,
        graphs: {
          g1: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        },
        graphTabs: {
          g1: { id: 'g1', name: 'Test', createdAt: 1000 },
        },
        activeGraphId: 'g1',
        graphOrder: ['g1'],
        templates: {},
      };
      saveMultiGraph(storage);
      const loaded = loadMultiGraph();
      expect(loaded).not.toBeNull();
      expect(loaded!.activeGraphId).toBe('g1');
      expect(loaded!.graphTabs.g1.name).toBe('Test');
    });
  });

  // -----------------------------------------------------------------------
  // disconnectAndReroute edge cases
  // -----------------------------------------------------------------------
  describe('disconnectAndReroute', () => {
    it('handles non-existent connection gracefully', () => {
      getState().addNode('source', [0, 0, 0]);
      // Should not throw for non-existent connection
      getState().disconnectAndReroute('non-existent-conn');
      expect(Object.keys(getState().connections).length).toBe(0);
    });

    it('removes specified connection and starts new pending connection from source', () => {
      const a = getState().addNode('source', [0, 0, 0]);
      const b = getState().addNode('output', [2, 0, 0]);

      getState().addConnection(a, 0, b, 0);
      const connId = Object.keys(getState().connections)[0];

      getState().disconnectAndReroute(connId);

      // Connection should be removed
      expect(getState().connections[connId]).toBeUndefined();
      // Should have a pending connection from the source
      expect(getState().pendingConnection).not.toBeNull();
      expect(getState().pendingConnection!.sourceNodeId).toBe(a);
    });
  });

  // -----------------------------------------------------------------------
  // Undo/redo + transient state clearing
  // -----------------------------------------------------------------------
  describe('undo/redo clears transient state', () => {
    it('undo clears executionStates, nodeOutputs, executionErrors', () => {
      const id = getState().addNode('source');
      getState().pushUndoSnapshot();
      getState().addNode('transform');

      // Simulate execution state
      useEditorStore.setState({
        executionStates: { [id]: 'running' },
        nodeOutputs: { [id]: { 0: 42 } },
        executionErrors: { [id]: 'test error' },
      });

      getState().undo();
      expect(getState().executionStates).toEqual({});
      expect(getState().nodeOutputs).toEqual({});
      expect(getState().executionErrors).toEqual({});
    });

    it('redo clears transient state', () => {
      const id = getState().addNode('source');
      getState().pushUndoSnapshot();
      getState().addNode('transform');
      getState().undo();

      // Add some transient state
      useEditorStore.setState({
        executionStates: { [id]: 'complete' },
      });

      getState().redo();
      expect(getState().executionStates).toEqual({});
    });

    it('undo clears contextMenu and pendingConnection', () => {
      getState().addNode('source');
      getState().pushUndoSnapshot();
      getState().addNode('transform');

      useEditorStore.setState({
        contextMenu: { x: 100, y: 200, target: { kind: 'canvas' } },
        pendingConnection: { sourceNodeId: 'fake', sourcePortIndex: 0, cursorPos: [0, 0, 0] },
        interaction: 'drawing-connection',
      });

      getState().undo();
      expect(getState().contextMenu).toBeNull();
      expect(getState().pendingConnection).toBeNull();
      expect(getState().interaction).toBe('idle');
    });
  });

  // -----------------------------------------------------------------------
  // clearGraph clears transient state
  // -----------------------------------------------------------------------
  describe('clearGraph', () => {
    it('clears all transient execution state', () => {
      const id = getState().addNode('source');
      useEditorStore.setState({
        executionStates: { [id]: 'running' },
        nodeOutputs: { [id]: { 0: 42 } },
        executionErrors: { [id]: 'err' },
        isExecuting: true,
      });

      getState().clearGraph();

      expect(getState().executionStates).toEqual({});
      expect(getState().nodeOutputs).toEqual({});
      expect(getState().executionErrors).toEqual({});
      expect(getState().isExecuting).toBe(false);
      expect(Object.keys(getState().nodes).length).toBe(0);
    });

    it('clears context menu', () => {
      getState().addNode('source');
      useEditorStore.setState({
        contextMenu: { x: 0, y: 0, target: { kind: 'canvas' } },
      });
      getState().clearGraph();
      expect(getState().contextMenu).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // updateNodeData invalidates execution cache
  // -----------------------------------------------------------------------
  describe('updateNodeData', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('pushing undo after data change', () => {
      const id = getState().addNode('source');
      getState().updateNodeData(id, 'value', 42);
      expect(getState().nodes[id].data.value).toBe(42);
      expect(getState().canUndo()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Node collapse system
  // -----------------------------------------------------------------------
  describe('node collapse', () => {
    it('toggleNodeCollapse toggles collapsed state', () => {
      const id = getState().addNode('source');
      expect(getState().nodes[id].collapsed).toBeUndefined();
      getState().toggleNodeCollapse(id);
      expect(getState().nodes[id].collapsed).toBe(true);
      getState().toggleNodeCollapse(id);
      expect(getState().nodes[id].collapsed).toBe(false);
    });

    it('collapseSelected collapses all selected nodes', () => {
      const a = getState().addNode('source');
      const b = getState().addNode('transform');
      getState().setSelection(new Set([a, b]));
      getState().collapseSelected();
      expect(getState().nodes[a].collapsed).toBe(true);
      expect(getState().nodes[b].collapsed).toBe(true);
    });

    it('expandSelected expands all selected nodes', () => {
      const a = getState().addNode('source');
      const b = getState().addNode('transform');
      getState().toggleNodeCollapse(a);
      getState().toggleNodeCollapse(b);
      getState().setSelection(new Set([a, b]));
      getState().expandSelected();
      expect(getState().nodes[a].collapsed).toBe(false);
      expect(getState().nodes[b].collapsed).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Graph validation
  // -----------------------------------------------------------------------
  describe('graph validation', () => {
    it('validateGraph detects disconnected inputs', () => {
      const id = getState().addNode('transform');
      const issues = validateGraph(getState().nodes, getState().connections);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].nodeId).toBe(id);
      expect(issues[0].type).toBe('disconnected-input');
    });

    it('no issues when all inputs connected', () => {
      const s = getState().addNode('source');
      const t = getState().addNode('transform');
      getState().addConnection(s, 0, t, 0);
      // transform has 2 inputs (in, factor) — only first is connected
      const issues = validateGraph(getState().nodes, getState().connections);
      // Should have 1 disconnected-input issue for the unconnected 'factor' input
      const transformDisconnected = issues.filter(i => i.nodeId === t && i.type === 'disconnected-input');
      expect(transformDisconnected.length).toBe(1);
      expect(transformDisconnected[0].portIndex).toBe(1);
    });

    it('note nodes are skipped in validation', () => {
      getState().addNode('note');
      const issues = validateGraph(getState().nodes, getState().connections);
      expect(issues.length).toBe(0);
    });

    it('source nodes with no inputs produce no disconnected-input issues', () => {
      getState().addNode('source');
      const issues = validateGraph(getState().nodes, getState().connections);
      expect(issues.filter(i => i.type === 'disconnected-input').length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getCompatibleNodeTypes
  // -----------------------------------------------------------------------
  describe('getCompatibleNodeTypes', () => {
    it('returns node types compatible with source port', () => {
      const s = getState().addNode('source');
      const types = getState().getCompatibleNodeTypes(s, 0, true);
      // Source port 0 is 'number' type — should include transform, math, etc.
      expect(types.length).toBeGreaterThan(0);
      expect(types.some(t => t.type === 'transform')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // addNodeAndConnect
  // -----------------------------------------------------------------------
  describe('addNodeAndConnect', () => {
    it('creates node and connection in one action', () => {
      const s = getState().addNode('source');
      const newId = getState().addNodeAndConnect('transform', [2, 0, 0], s, 0, true);
      expect(newId).not.toBeNull();
      expect(getState().nodes[newId!]).toBeDefined();
      const conns = Object.values(getState().connections);
      expect(conns.some(c => c.sourceNodeId === s && c.targetNodeId === newId)).toBe(true);
    });

    it('creates single undo entry', () => {
      const s = getState().addNode('source');
      getState().addNodeAndConnect('transform', [2, 0, 0], s, 0, true);
      getState().undo();
      // Both the node and connection should be undone
      expect(Object.keys(getState().nodes).length).toBe(1); // only source remains
      expect(Object.keys(getState().connections).length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-graph: per-graph undo isolation
  // -----------------------------------------------------------------------
  describe('multi-graph undo isolation', () => {
    it('undo in graph A does not affect graph B', () => {
      // Default graph
      const a = getState().addNode('source', [0, 0, 0]);
      getState().pushUndoSnapshot();
      getState().updateNodeData(a, 'value', 42);

      // Create and switch to new graph
      getState().createGraph('Graph B');
      const b = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(b, 'value', 99);

      // Undo in graph B should only affect B
      getState().undo();
      expect(getState().nodes[b]).toBeDefined(); // node still exists after undo

      // Switch back to default graph
      getState().switchGraph('default');
      expect(getState().nodes[a].data.value).toBe(42); // untouched
    });
  });

  // -----------------------------------------------------------------------
  // Custom node definitions are per-graph
  // -----------------------------------------------------------------------
  describe('custom node defs per-graph', () => {
    it('custom node def in graph A is not visible in graph B', () => {
      getState().addCustomNodeDef({
        name: 'My Custom',
        color: '#FF0000',
        category: 'custom',
        inputs: [{ label: 'in', portType: 'number' }],
        outputs: [{ label: 'out', portType: 'number' }],
        expression: 'in0 * 2',
      });
      expect(Object.keys(getState().customNodeDefs).length).toBe(1);

      getState().createGraph('Graph B');
      expect(Object.keys(getState().customNodeDefs).length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Templates are workspace-global
  // -----------------------------------------------------------------------
  describe('templates are global', () => {
    it('template created in graph A is available in graph B', () => {
      const a = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([a]));
      getState().saveSelectionAsTemplate('My Template', 'test');

      getState().createGraph('Graph B');
      const templates = getState().templates;
      expect(Object.keys(templates).length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Copy/paste across graphs
  // -----------------------------------------------------------------------
  describe('clipboard shared across graphs', () => {
    it('copy in graph A, paste in graph B', () => {
      const a = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(a, 'value', 777);
      getState().setSelection(new Set([a]));
      getState().copySelected();

      getState().createGraph('Graph B');
      getState().paste();

      const pastedNodes = Object.values(getState().nodes);
      expect(pastedNodes.length).toBe(1);
      expect(pastedNodes[0].data.value).toBe(777);
    });
  });

  // -----------------------------------------------------------------------
  // snapToGrid
  // -----------------------------------------------------------------------
  describe('snapToGrid', () => {
    it('snaps to nearest 0.5', () => {
      expect(snapToGrid(0.3)).toBe(0.5);
      expect(snapToGrid(0.7)).toBe(0.5);
      expect(snapToGrid(1.0)).toBe(1.0);
      expect(snapToGrid(1.3)).toBe(1.5);
    });

    it('handles negative values', () => {
      expect(snapToGrid(-0.3)).toBeCloseTo(-.5);
      expect(snapToGrid(-1.1)).toBeCloseTo(-1);
    });

    it('handles zero', () => {
      expect(snapToGrid(0)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // searchQuery state
  // -----------------------------------------------------------------------
  describe('searchQuery', () => {
    it('setSearchQuery updates query', () => {
      getState().setSearchQuery('transform');
      expect(getState().searchQuery).toBe('transform');
    });

    it('setSearchQuery can clear query', () => {
      getState().setSearchQuery('test');
      getState().setSearchQuery('');
      expect(getState().searchQuery).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // showValuePreviews toggle
  // -----------------------------------------------------------------------
  describe('showValuePreviews', () => {
    it('toggleValuePreviews flips the state', () => {
      expect(getState().showValuePreviews).toBe(false);
      getState().toggleValuePreviews();
      expect(getState().showValuePreviews).toBe(true);
      getState().toggleValuePreviews();
      expect(getState().showValuePreviews).toBe(false);
    });
  });
});

// ===========================================================================
// Layout Utility Tests
// ===========================================================================

describe('Layout Utilities', () => {
  function makeNode(id: string, pos: [number, number, number] = [0, 0, 0]): EditorNode {
    return {
      id, type: 'source', position: pos, title: 'node',
      data: {}, inputs: [], outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
    };
  }

  function makeConn(id: string, src: string, tgt: string): Connection {
    return { id, sourceNodeId: src, sourcePortIndex: 0, targetNodeId: tgt, targetPortIndex: 0 };
  }

  describe('layeredLayout', () => {
    it('empty graph returns empty', () => {
      expect(layeredLayout({}, {})).toEqual({});
    });

    it('single node returns position', () => {
      const positions = layeredLayout({ a: makeNode('a') }, {});
      expect(positions.a).toBeDefined();
      expect(positions.a.length).toBe(3);
    });

    it('linear chain assigns increasing X', () => {
      const nodes = {
        a: makeNode('a'),
        b: { ...makeNode('b'), type: 'transform' as const, inputs: [{ id: 'in-0', label: 'in', portType: 'number' as const }] },
      };
      const conns = { c1: makeConn('c1', 'a', 'b') };
      const positions = layeredLayout(nodes, conns);
      expect(positions.a[0]).toBeLessThan(positions.b[0]);
    });

    it('handles cycle by falling back to single layer', () => {
      const nodes = {
        a: { ...makeNode('a'), inputs: [{ id: 'in-0', label: 'in', portType: 'any' as const }] },
        b: { ...makeNode('b'), inputs: [{ id: 'in-0', label: 'in', portType: 'any' as const }] },
      };
      const conns = {
        c1: makeConn('c1', 'a', 'b'),
        c2: makeConn('c2', 'b', 'a'),
      };
      // Should not throw (cycle detected, falls back)
      const positions = layeredLayout(nodes, conns);
      expect(Object.keys(positions).length).toBe(2);
    });

    it('preserves Y positions', () => {
      const nodes = { a: makeNode('a', [0, 5, 0]) };
      const positions = layeredLayout(nodes, {});
      expect(positions.a[1]).toBe(5);
    });
  });

  describe('alignNodes', () => {
    it('returns empty for less than 2 nodes', () => {
      const nodes = { a: makeNode('a', [5, 0, 5]) };
      expect(alignNodes(['a'], nodes, 'left')).toEqual({});
    });

    it('aligns left to minimum X', () => {
      const nodes = {
        a: makeNode('a', [1, 0, 0]),
        b: makeNode('b', [5, 0, 0]),
      };
      const result = alignNodes(['a', 'b'], nodes, 'left');
      expect(result.a[0]).toBe(1);
      expect(result.b[0]).toBe(1);
    });

    it('aligns right to maximum X', () => {
      const nodes = {
        a: makeNode('a', [1, 0, 0]),
        b: makeNode('b', [5, 0, 0]),
      };
      const result = alignNodes(['a', 'b'], nodes, 'right');
      expect(result.a[0]).toBe(5);
      expect(result.b[0]).toBe(5);
    });

    it('aligns top to minimum Z', () => {
      const nodes = {
        a: makeNode('a', [0, 0, 2]),
        b: makeNode('b', [0, 0, 8]),
      };
      const result = alignNodes(['a', 'b'], nodes, 'top');
      expect(result.a[2]).toBe(2);
      expect(result.b[2]).toBe(2);
    });

    it('aligns bottom to maximum Z', () => {
      const nodes = {
        a: makeNode('a', [0, 0, 2]),
        b: makeNode('b', [0, 0, 8]),
      };
      const result = alignNodes(['a', 'b'], nodes, 'bottom');
      expect(result.a[2]).toBe(8);
      expect(result.b[2]).toBe(8);
    });

    it('center-x averages X positions', () => {
      const nodes = {
        a: makeNode('a', [0, 0, 0]),
        b: makeNode('b', [10, 0, 0]),
      };
      const result = alignNodes(['a', 'b'], nodes, 'center-x');
      expect(result.a[0]).toBe(5);
      expect(result.b[0]).toBe(5);
    });

    it('center-z averages Z positions', () => {
      const nodes = {
        a: makeNode('a', [0, 0, 4]),
        b: makeNode('b', [0, 0, 6]),
      };
      const result = alignNodes(['a', 'b'], nodes, 'center-z');
      expect(result.a[2]).toBe(5);
      expect(result.b[2]).toBe(5);
    });

    it('preserves Y positions during alignment', () => {
      const nodes = {
        a: makeNode('a', [0, 3, 0]),
        b: makeNode('b', [5, 7, 0]),
      };
      const result = alignNodes(['a', 'b'], nodes, 'left');
      expect(result.a[1]).toBe(3);
      expect(result.b[1]).toBe(7);
    });

    it('filters out non-existent node IDs', () => {
      const nodes = {
        a: makeNode('a', [0, 0, 0]),
        b: makeNode('b', [5, 0, 0]),
      };
      // 'c' doesn't exist
      const result = alignNodes(['a', 'b', 'c'], nodes, 'left');
      expect(result.a[0]).toBe(0);
      expect(result.b[0]).toBe(0);
    });
  });
});

// ===========================================================================
// Validation Utility Tests
// ===========================================================================

describe('Validation Utility', () => {
  function makeNode(id: string, type: EditorNode['type']): EditorNode {
    const config = NODE_TYPE_CONFIG[type];
    return {
      id, type, position: [0, 0, 0], title: type,
      data: {},
      inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
      outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
    };
  }

  it('empty graph has no issues', () => {
    expect(validateGraph({}, {})).toEqual([]);
  });

  it('source-only graph has no disconnected-input issues', () => {
    const nodes = { s: makeNode('s', 'source') };
    const issues = validateGraph(nodes, {});
    expect(issues.filter(i => i.type === 'disconnected-input')).toEqual([]);
    // Source with no connections gets a no-connections warning
    expect(issues.some(i => i.type === 'no-connections')).toBe(true);
  });

  it('transform with no connections has 2 disconnected inputs', () => {
    const nodes = { t: makeNode('t', 'transform') };
    const issues = validateGraph(nodes, {});
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    expect(disconnected.length).toBe(2);
    expect(disconnected[0].portIndex).toBe(0);
    expect(disconnected[1].portIndex).toBe(1);
  });

  it('fully connected transform has no disconnected-input issues', () => {
    const nodes = {
      s1: makeNode('s1', 'source'),
      s2: makeNode('s2', 'source'),
      t: makeNode('t', 'transform'),
    };
    const conns = {
      c1: { id: 'c1', sourceNodeId: 's1', sourcePortIndex: 0, targetNodeId: 't', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 's2', sourcePortIndex: 0, targetNodeId: 't', targetPortIndex: 1 },
    };
    expect(validateGraph(nodes, conns).filter(i => i.type === 'disconnected-input')).toEqual([]);
    // Transform outputs not connected → disconnected-output warning
    expect(validateGraph(nodes, conns).some(i => i.type === 'disconnected-output')).toBe(true);
  });

  it('output node with no data connection has 2 disconnected inputs', () => {
    const nodes = { o: makeNode('o', 'output') };
    const issues = validateGraph(nodes, {});
    expect(issues.filter(i => i.type === 'disconnected-input').length).toBe(2);
  });

  it('mixed graph: unconnected inputs flagged', () => {
    const nodes = {
      s: makeNode('s', 'source'),
      t: makeNode('t', 'transform'),
      o: makeNode('o', 'output'),
    };
    const conns = {
      c1: { id: 'c1', sourceNodeId: 's', sourcePortIndex: 0, targetNodeId: 't', targetPortIndex: 0 },
      c2: { id: 'c2', sourceNodeId: 't', sourcePortIndex: 0, targetNodeId: 'o', targetPortIndex: 0 },
    };
    const issues = validateGraph(nodes, conns);
    // transform port 1 (factor) and output port 1 (label) are unconnected
    expect(issues.filter(i => i.type === 'disconnected-input').length).toBe(2);
  });
});
