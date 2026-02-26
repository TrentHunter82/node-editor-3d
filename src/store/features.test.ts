import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    contextMenu: null,
    searchQuery: '',
    executionStates: {},
    isExecuting: false,
    nodeOutputs: {},
    executionErrors: {},
  });
}

function drainUndoRedo() {
  while (getState().canUndo()) getState().undo();
  while (getState().canRedo()) getState().redo();
  while (getState().canUndo()) getState().undo();
}

function getState() {
  return useEditorStore.getState();
}

// ─── Search/Filter ───────────────────────────────────────────

describe('Search/Filter', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
  });

  describe('setSearchQuery', () => {
    it('sets the search query', () => {
      getState().setSearchQuery('hello');
      expect(getState().searchQuery).toBe('hello');
    });

    it('can be cleared', () => {
      getState().setSearchQuery('test');
      getState().setSearchQuery('');
      expect(getState().searchQuery).toBe('');
    });
  });

  describe('searchNodes', () => {
    it('returns all nodes when query is empty', () => {
      getState().addNode('source');
      getState().addNode('transform');
      getState().addNode('filter');

      const results = getState().searchNodes('');
      expect(results).toHaveLength(3);
    });

    it('returns all nodes when query is whitespace only', () => {
      getState().addNode('source');
      getState().addNode('transform');
      const results = getState().searchNodes('   ');
      expect(results).toHaveLength(2);
    });

    it('matches by title (case-insensitive)', () => {
      getState().addNode('source');
      getState().addNode('transform');
      getState().addNode('filter');

      const results = getState().searchNodes('Source');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Source');
    });

    it('matches by title case-insensitively', () => {
      getState().addNode('source');
      const results = getState().searchNodes('source');
      expect(results).toHaveLength(1);
    });

    it('matches by type', () => {
      getState().addNode('source');
      getState().addNode('transform');

      const results = getState().searchNodes('transform');
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('transform');
    });

    it('matches by node id', () => {
      const id = getState().addNode('source');
      getState().addNode('transform');

      const results = getState().searchNodes(id);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(id);
    });

    it('matches partial strings', () => {
      const id = getState().addNode('source');
      getState().updateNodeTitle(id, 'My Custom Source Node');

      const results = getState().searchNodes('Custom');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(id);
    });

    it('returns empty for no matches', () => {
      getState().addNode('source');
      const results = getState().searchNodes('nonexistent');
      expect(results).toHaveLength(0);
    });

    it('returns multiple matches', () => {
      const s1 = getState().addNode('source');
      const s2 = getState().addNode('source');
      getState().addNode('transform');

      const results = getState().searchNodes('Source');
      expect(results).toHaveLength(2);
      const ids = results.map(r => r.id);
      expect(ids).toContain(s1);
      expect(ids).toContain(s2);
    });

    it('matches renamed nodes', () => {
      const id = getState().addNode('source');
      getState().updateNodeTitle(id, 'Data Input');

      const results = getState().searchNodes('Data');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(id);
    });
  });

  describe('focusNode', () => {
    it('selects the target node', () => {
      const n1 = getState().addNode('source');
      const n2 = getState().addNode('transform');

      getState().focusNode(n2);
      expect(getState().selectedIds.size).toBe(1);
      expect(getState().selectedIds.has(n2)).toBe(true);
      expect(getState().selectedIds.has(n1)).toBe(false);
    });

    it('replaces current selection', () => {
      const n1 = getState().addNode('source');
      const n2 = getState().addNode('transform');

      getState().setSelection(new Set([n1]));
      getState().focusNode(n2);

      expect(getState().selectedIds.size).toBe(1);
      expect(getState().selectedIds.has(n2)).toBe(true);
    });

    it('does nothing for non-existent node', () => {
      const n1 = getState().addNode('source');
      getState().setSelection(new Set([n1]));

      getState().focusNode('nonexistent');
      // Selection unchanged
      expect(getState().selectedIds.has(n1)).toBe(true);
    });
  });
});

// ─── Context Menu ─────────────────────────────────────────────

describe('Context Menu', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
  });

  describe('openContextMenu', () => {
    it('opens a canvas context menu', () => {
      getState().openContextMenu({
        x: 100,
        y: 200,
        target: { kind: 'canvas' },
      });

      const menu = getState().contextMenu;
      expect(menu).not.toBeNull();
      expect(menu!.x).toBe(100);
      expect(menu!.y).toBe(200);
      expect(menu!.target.kind).toBe('canvas');
    });

    it('opens a node context menu', () => {
      const id = getState().addNode('source');
      getState().openContextMenu({
        x: 50,
        y: 75,
        target: { kind: 'node', nodeId: id },
      });

      const menu = getState().contextMenu;
      expect(menu).not.toBeNull();
      expect(menu!.target.kind).toBe('node');
      expect((menu!.target as { kind: 'node'; nodeId: string }).nodeId).toBe(id);
    });

    it('opens a connection context menu', () => {
      const src = getState().addNode('source');
      const tgt = getState().addNode('transform');
      const connId = getState().addConnection(src, 0, tgt, 0)!;

      getState().openContextMenu({
        x: 300,
        y: 150,
        target: { kind: 'connection', connectionId: connId },
      });

      const menu = getState().contextMenu;
      expect(menu).not.toBeNull();
      expect(menu!.target.kind).toBe('connection');
      expect((menu!.target as { kind: 'connection'; connectionId: string }).connectionId).toBe(connId);
    });

    it('replaces existing context menu', () => {
      getState().openContextMenu({
        x: 100,
        y: 200,
        target: { kind: 'canvas' },
      });

      getState().openContextMenu({
        x: 300,
        y: 400,
        target: { kind: 'canvas' },
      });

      expect(getState().contextMenu!.x).toBe(300);
      expect(getState().contextMenu!.y).toBe(400);
    });
  });

  describe('closeContextMenu', () => {
    it('closes an open context menu', () => {
      getState().openContextMenu({
        x: 100,
        y: 200,
        target: { kind: 'canvas' },
      });
      expect(getState().contextMenu).not.toBeNull();

      getState().closeContextMenu();
      expect(getState().contextMenu).toBeNull();
    });

    it('is a no-op when no menu is open', () => {
      getState().closeContextMenu();
      expect(getState().contextMenu).toBeNull();
    });
  });
});

// ─── Node Data ─────────────────────────────────────────────────

describe('updateNodeData', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
  });

  it('sets a data field on a node', () => {
    const id = getState().addNode('source');
    getState().updateNodeData(id, 'value', 42);
    expect(getState().nodes[id].data.value).toBe(42);
  });

  it('sets a string data field', () => {
    const id = getState().addNode('source');
    getState().updateNodeData(id, 'label', 'hello');
    expect(getState().nodes[id].data.label).toBe('hello');
  });

  it('sets multiple data fields', () => {
    const id = getState().addNode('transform');
    getState().updateNodeData(id, 'multiplier', 2.5);
    getState().updateNodeData(id, 'offset', 10);
    expect(getState().nodes[id].data.multiplier).toBe(2.5);
    expect(getState().nodes[id].data.offset).toBe(10);
  });

  it('overwrites existing data field', () => {
    const id = getState().addNode('source');
    getState().updateNodeData(id, 'value', 1);
    getState().updateNodeData(id, 'value', 2);
    expect(getState().nodes[id].data.value).toBe(2);
  });

  it('does nothing for non-existent node', () => {
    getState().updateNodeData('nonexistent', 'key', 'val');
    // Should not throw
    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('is undoable', () => {
    const id = getState().addNode('source');
    getState().updateNodeData(id, 'value', 42);
    expect(getState().nodes[id].data.value).toBe(42);

    getState().undo();
    expect(getState().nodes[id].data.value).toBeUndefined();
  });

  it('supports complex values', () => {
    const id = getState().addNode('filter');
    getState().updateNodeData(id, 'threshold', 0.5);
    getState().updateNodeData(id, 'mode', 'greater_than');
    getState().updateNodeData(id, 'active', true);

    const data = getState().nodes[id].data;
    expect(data.threshold).toBe(0.5);
    expect(data.mode).toBe('greater_than');
    expect(data.active).toBe(true);
  });

  it('supports null and undefined values', () => {
    const id = getState().addNode('source');
    getState().updateNodeData(id, 'value', null);
    expect(getState().nodes[id].data.value).toBeNull();
  });

  it('supports color values', () => {
    const id = getState().addNode('output');
    getState().updateNodeData(id, 'color', '#ff5500');
    expect(getState().nodes[id].data.color).toBe('#ff5500');
  });
});

// ─── Context Menu + Store Integration ──────────────────────────

describe('Integration: Context Menu + Store Actions', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
  });

  it('node context menu -> delete node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().openContextMenu({
      x: 100, y: 100,
      target: { kind: 'node', nodeId: id },
    });

    // Simulate: user selects "Delete" from context menu
    getState().closeContextMenu();
    getState().setSelection(new Set([id]));
    getState().deleteSelected();

    expect(getState().nodes[id]).toBeUndefined();
    expect(getState().contextMenu).toBeNull();
  });

  it('node context menu -> duplicate node', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().openContextMenu({
      x: 100, y: 100,
      target: { kind: 'node', nodeId: id },
    });

    getState().closeContextMenu();
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();

    expect(Object.keys(getState().nodes)).toHaveLength(2);
    expect(getState().contextMenu).toBeNull();
  });

  it('connection context menu -> delete connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    const connId = getState().addConnection(src, 0, tgt, 0)!;

    getState().openContextMenu({
      x: 200, y: 150,
      target: { kind: 'connection', connectionId: connId },
    });

    getState().closeContextMenu();
    getState().removeConnection(connId);

    expect(getState().connections[connId]).toBeUndefined();
    expect(getState().contextMenu).toBeNull();
  });

  it('canvas context menu -> add node', () => {
    getState().openContextMenu({
      x: 500, y: 300,
      target: { kind: 'canvas' },
    });

    getState().closeContextMenu();
    const id = getState().addNode('source', [5, 0, 3]);

    expect(getState().nodes[id]).toBeDefined();
    expect(getState().contextMenu).toBeNull();
  });

  it('canvas context menu -> select all', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);

    getState().openContextMenu({
      x: 0, y: 0,
      target: { kind: 'canvas' },
    });

    getState().closeContextMenu();
    getState().setSelection(new Set([n1, n2]));

    expect(getState().selectedIds.size).toBe(2);
  });

  it('canvas context menu -> clear graph', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    getState().openContextMenu({
      x: 0, y: 0,
      target: { kind: 'canvas' },
    });

    getState().closeContextMenu();
    getState().clearGraph();

    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });
});

// ─── Context Menu: Phase 38 Additions ────────────────────────────

describe('Context Menu: Phase 38 additions', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
  });

  it('canvas context menu -> group selected', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([n1, n2]));

    getState().createGroup();

    const groups = Object.values(getState().groups);
    expect(groups).toHaveLength(1);
    expect(getState().nodes[n1].groupId).toBe(groups[0].id);
    expect(getState().nodes[n2].groupId).toBe(groups[0].id);
  });

  it('canvas context menu -> align selected left', () => {
    const n1 = getState().addNode('source', [2, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 3]);
    getState().setSelection(new Set([n1, n2]));

    getState().alignSelected('left');

    expect(getState().nodes[n1].position[0]).toBe(2);
    expect(getState().nodes[n2].position[0]).toBe(2);
    // Z should be preserved
    expect(getState().nodes[n2].position[2]).toBe(3);
  });

  it('canvas context menu -> align selected right', () => {
    const n1 = getState().addNode('source', [2, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 3]);
    getState().setSelection(new Set([n1, n2]));

    getState().alignSelected('right');

    expect(getState().nodes[n1].position[0]).toBe(5);
    expect(getState().nodes[n2].position[0]).toBe(5);
  });

  it('canvas context menu -> delete selected via canvas menu', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([n1, n2]));

    getState().deleteSelected();

    expect(Object.keys(getState().nodes)).toHaveLength(0);
  });

  it('node context menu -> select downstream', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    const n3 = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);
    getState().addConnection(n2, 0, n3, 0);

    // Simulate: right-click n1, select downstream
    getState().setSelection(new Set([n1]));
    getState().selectConnected('downstream');

    expect(getState().selectedIds.has(n1)).toBe(true);
    expect(getState().selectedIds.has(n2)).toBe(true);
    expect(getState().selectedIds.has(n3)).toBe(true);
  });

  it('node context menu -> select upstream', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    const n3 = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);
    getState().addConnection(n2, 0, n3, 0);

    getState().setSelection(new Set([n3]));
    getState().selectConnected('upstream');

    expect(getState().selectedIds.has(n1)).toBe(true);
    expect(getState().selectedIds.has(n2)).toBe(true);
    expect(getState().selectedIds.has(n3)).toBe(true);
  });

  it('node context menu -> disconnect all connections', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [3, 0, 0]);
    const n3 = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(n1, 0, n2, 0);
    getState().addConnection(n2, 0, n3, 0);

    // Disconnect all connections from n2 (has 2: one in, one out)
    const connections = Object.values(getState().connections);
    const n2Connections = connections.filter(c =>
      c.sourceNodeId === n2 || c.targetNodeId === n2
    );
    expect(n2Connections).toHaveLength(2);

    for (const conn of n2Connections) {
      getState().removeConnection(conn.id);
    }

    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('addNode with explicit position places at that position', () => {
    const id = getState().addNode('source', [10, 0, -5]);
    expect(getState().nodes[id].position).toEqual([10, 0, -5]);
  });

  it('addNode without position places at random position', () => {
    const id = getState().addNode('source');
    const pos = getState().nodes[id].position;
    // Random position in [-3, 3] range
    expect(pos[0]).toBeGreaterThanOrEqual(-3);
    expect(pos[0]).toBeLessThanOrEqual(3);
    expect(pos[1]).toBe(0);
    expect(pos[2]).toBeGreaterThanOrEqual(-3);
    expect(pos[2]).toBeLessThanOrEqual(3);
  });
});

// ─── Phase 39: Port-Release & Context Menu Integration ─────────

describe('Phase 39: Port-Release Context Menu', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
  });

  it('openContextMenu with port-release target stores menu state', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().openContextMenu({
      x: 100,
      y: 200,
      target: { kind: 'port-release', sourceNodeId: n1, sourcePortIndex: 0 },
    });
    const menu = getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu!.target.kind).toBe('port-release');
    if (menu!.target.kind === 'port-release') {
      expect(menu!.target.sourceNodeId).toBe(n1);
      expect(menu!.target.sourcePortIndex).toBe(0);
    }
    expect(menu!.x).toBe(100);
    expect(menu!.y).toBe(200);
  });

  it('closeContextMenu clears port-release menu', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().openContextMenu({
      x: 100,
      y: 200,
      target: { kind: 'port-release', sourceNodeId: n1, sourcePortIndex: 0 },
    });
    expect(getState().contextMenu).not.toBeNull();
    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('getCompatibleNodeTypes returns nodes with compatible inputs for output source', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const compatible = getState().getCompatibleNodeTypes(n1, 0, true);
    // Source output is 'number' type — should return nodes with number-compatible inputs
    expect(compatible.length).toBeGreaterThan(0);
    // transform should be compatible (has number input)
    expect(compatible.some(c => c.type === 'transform')).toBe(true);
  });

  it('addNodeAndConnect creates node and connection atomically', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    const nodesBefore = Object.keys(getState().nodes).length;
    const connsBefore = Object.keys(getState().connections).length;

    getState().addNodeAndConnect('transform', [5, 0, 0], n1, 0, true);

    expect(Object.keys(getState().nodes).length).toBe(nodesBefore + 1);
    expect(Object.keys(getState().connections).length).toBe(connsBefore + 1);
  });

  it('addNodeAndConnect is undoable as single operation', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().addNodeAndConnect('transform', [5, 0, 0], n1, 0, true);

    expect(Object.keys(getState().nodes).length).toBe(2);
    expect(Object.keys(getState().connections).length).toBe(1);

    getState().undo();

    expect(Object.keys(getState().nodes).length).toBe(1);
    expect(Object.keys(getState().connections).length).toBe(0);
  });

  it('cancelConnection clears pendingConnection and resets interaction', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(n1, 0);
    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().pendingConnection).not.toBeNull();

    getState().cancelConnection();
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('toggleNodeLock locks and unlocks a node', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[n1].locked).toBeFalsy();

    getState().toggleNodeLock(n1);
    expect(getState().nodes[n1].locked).toBe(true);

    getState().toggleNodeLock(n1);
    expect(getState().nodes[n1].locked).toBeFalsy();
  });

  it('toggleNodeCollapse collapses and expands a node', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[n1].collapsed).toBeFalsy();

    getState().toggleNodeCollapse(n1);
    expect(getState().nodes[n1].collapsed).toBe(true);

    getState().toggleNodeCollapse(n1);
    expect(getState().nodes[n1].collapsed).toBeFalsy();
  });

  it('duplicateSelected from single selection creates a copy', () => {
    const n1 = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([n1]));
    const map = getState().duplicateSelected();
    expect(map).not.toBeNull();
    expect(map!.size).toBe(1);
    // Should now have 2 nodes
    expect(Object.keys(getState().nodes).length).toBe(2);
  });
});

// ─── Search + Focus Integration ────────────────────────────────

describe('Integration: Search + Focus', () => {
  beforeEach(() => {
    drainUndoRedo();
    resetStore();
  });

  it('search for node then focus it', () => {
    const id = getState().addNode('source');
    getState().updateNodeTitle(id, 'Data Source');
    getState().addNode('transform');

    const results = getState().searchNodes('Data');
    expect(results).toHaveLength(1);

    getState().focusNode(results[0].id);
    expect(getState().selectedIds.has(id)).toBe(true);
  });

  it('search across multiple node types', () => {
    const s = getState().addNode('source');
    getState().updateNodeTitle(s, 'Input Source');
    const t = getState().addNode('transform');
    getState().updateNodeTitle(t, 'Input Transform');

    const results = getState().searchNodes('Input');
    expect(results).toHaveLength(2);
  });

  it('search by type shows all of that type', () => {
    getState().addNode('source');
    getState().addNode('source');
    getState().addNode('transform');

    const results = getState().searchNodes('source');
    expect(results).toHaveLength(2);
    expect(results.every(r => r.type === 'source')).toBe(true);
  });
});
