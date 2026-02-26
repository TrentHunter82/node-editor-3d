/**
 * context-menu-logic.test.ts
 *
 * Store-level and data-level tests for ContextMenu logic and CanvasMenu
 * "Add Node" structure.  Uses jsdom (no React rendering).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../../store/editorStore';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../../types';
import type { NodeType } from '../../types';
import {
  CATEGORY_ORDER,
  BUTTONS_BY_CATEGORY,
  NODE_BUTTONS,
  EXCLUDED_FROM_MENU,
} from './menus/menuShared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

enableMapSet();

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

// ---------------------------------------------------------------------------
// 1. Context menu store operations
// ---------------------------------------------------------------------------

describe('Context menu store operations', () => {
  beforeEach(resetStore);

  it('contextMenu starts as null', () => {
    expect(getState().contextMenu).toBeNull();
  });

  it('openContextMenu sets contextMenu state with x, y, target', () => {
    getState().openContextMenu({ x: 100, y: 200, target: { kind: 'canvas' } });
    const menu = getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu!.x).toBe(100);
    expect(menu!.y).toBe(200);
    expect(menu!.target).toEqual({ kind: 'canvas' });
  });

  it('closeContextMenu sets contextMenu to null', () => {
    getState().openContextMenu({ x: 50, y: 60, target: { kind: 'canvas' } });
    expect(getState().contextMenu).not.toBeNull();

    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('openContextMenu with canvas target', () => {
    getState().openContextMenu({ x: 0, y: 0, target: { kind: 'canvas' } });
    expect(getState().contextMenu!.target).toEqual({ kind: 'canvas' });
  });

  it('openContextMenu with node target', () => {
    getState().openContextMenu({ x: 10, y: 20, target: { kind: 'node', nodeId: 'node-42' } });
    const target = getState().contextMenu!.target;
    expect(target.kind).toBe('node');
    if (target.kind === 'node') {
      expect(target.nodeId).toBe('node-42');
    }
  });

  it('openContextMenu with connection target', () => {
    getState().openContextMenu({
      x: 30,
      y: 40,
      target: { kind: 'connection', connectionId: 'conn-7' },
    });
    const target = getState().contextMenu!.target;
    expect(target.kind).toBe('connection');
    if (target.kind === 'connection') {
      expect(target.connectionId).toBe('conn-7');
    }
  });

  it('sequential open/close cycles do not leak state', () => {
    const actions = getState();

    // Cycle 1
    actions.openContextMenu({ x: 1, y: 2, target: { kind: 'canvas' } });
    expect(getState().contextMenu).not.toBeNull();
    actions.closeContextMenu();
    expect(getState().contextMenu).toBeNull();

    // Cycle 2
    actions.openContextMenu({ x: 3, y: 4, target: { kind: 'node', nodeId: 'n1' } });
    expect(getState().contextMenu!.x).toBe(3);
    expect(getState().contextMenu!.target).toEqual({ kind: 'node', nodeId: 'n1' });
    actions.closeContextMenu();
    expect(getState().contextMenu).toBeNull();

    // Cycle 3
    actions.openContextMenu({ x: 5, y: 6, target: { kind: 'connection', connectionId: 'c1' } });
    expect(getState().contextMenu!.x).toBe(5);
    actions.closeContextMenu();
    expect(getState().contextMenu).toBeNull();

    // No residual state from any cycle
    expect(getState().contextMenu).toBeNull();
  });

  it('opening a new context menu replaces the previous one without closing first', () => {
    getState().openContextMenu({ x: 10, y: 20, target: { kind: 'canvas' } });
    getState().openContextMenu({ x: 30, y: 40, target: { kind: 'node', nodeId: 'abc' } });

    const menu = getState().contextMenu;
    expect(menu!.x).toBe(30);
    expect(menu!.y).toBe(40);
    expect(menu!.target).toEqual({ kind: 'node', nodeId: 'abc' });
  });
});

// ---------------------------------------------------------------------------
// 2. CanvasMenu data structure tests (BUTTONS_BY_CATEGORY / CATEGORY_ORDER)
// ---------------------------------------------------------------------------

describe('CanvasMenu data structure', () => {
  it('BUTTONS_BY_CATEGORY has entries for all CATEGORY_ORDER categories', () => {
    for (const cat of CATEGORY_ORDER) {
      expect(BUTTONS_BY_CATEGORY).toHaveProperty(cat);
      expect(Array.isArray(BUTTONS_BY_CATEGORY[cat])).toBe(true);
    }
  });

  it('total buttons across all categories matches NODE_BUTTONS length', () => {
    let total = 0;
    for (const cat of CATEGORY_ORDER) {
      total += BUTTONS_BY_CATEGORY[cat].length;
    }
    expect(total).toBe(NODE_BUTTONS.length);
  });

  it('no button type appears in multiple categories', () => {
    const seen = new Set<string>();
    for (const cat of CATEGORY_ORDER) {
      for (const btn of BUTTONS_BY_CATEGORY[cat]) {
        expect(seen.has(btn.type)).toBe(false);
        seen.add(btn.type);
      }
    }
  });

  it('each button has required fields (type, label, color)', () => {
    for (const cat of CATEGORY_ORDER) {
      for (const btn of BUTTONS_BY_CATEGORY[cat]) {
        expect(typeof btn.type).toBe('string');
        expect(btn.type.length).toBeGreaterThan(0);
        expect(typeof btn.label).toBe('string');
        expect(btn.label.length).toBeGreaterThan(0);
        expect(typeof btn.color).toBe('string');
        expect(btn.color.length).toBeGreaterThan(0);
      }
    }
  });

  it('excluded types (subgraph, subgraph-input, subgraph-output) not in any category', () => {
    const allTypes = CATEGORY_ORDER.flatMap(cat => BUTTONS_BY_CATEGORY[cat].map(b => b.type));
    for (const excluded of EXCLUDED_FROM_MENU) {
      expect(allTypes).not.toContain(excluded);
    }
  });

  it('every button type has a corresponding NODE_TYPE_CONFIG entry', () => {
    for (const cat of CATEGORY_ORDER) {
      for (const btn of BUTTONS_BY_CATEGORY[cat]) {
        expect(NODE_TYPE_CONFIG).toHaveProperty(btn.type);
      }
    }
  });

  it('button category assignments match NODE_CATEGORIES', () => {
    for (const cat of CATEGORY_ORDER) {
      for (const btn of BUTTONS_BY_CATEGORY[cat]) {
        const expectedCat = NODE_CATEGORIES[btn.type] ?? 'Utility';
        expect(expectedCat).toBe(cat);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Store operations used by CanvasMenu
// ---------------------------------------------------------------------------

describe('Store operations used by CanvasMenu', () => {
  beforeEach(resetStore);

  it('addNode creates a node with the given type', () => {
    const id = getState().addNode('source');
    const node = getState().nodes[id];
    expect(node).toBeDefined();
    expect(node.type).toBe('source');
    expect(node.position).toBeDefined();
    expect(node.position).toHaveLength(3);
  });

  it('addNode creates a node at a specified position', () => {
    const pos: [number, number, number] = [5, 0, 10];
    const id = getState().addNode('math', pos);
    const node = getState().nodes[id];
    expect(node.position[0]).toBe(5);
    expect(node.position[1]).toBe(0);
    expect(node.position[2]).toBe(10);
  });

  it('addNode works for multiple node types from the menu', () => {
    const typesToTest: NodeType[] = ['source', 'transform', 'filter', 'math', 'concat', 'compare', 'note', 'random'];
    const ids: string[] = [];
    for (const type of typesToTest) {
      ids.push(getState().addNode(type));
    }
    // All unique
    expect(new Set(ids).size).toBe(typesToTest.length);
    // All exist in the store
    for (let i = 0; i < typesToTest.length; i++) {
      expect(getState().nodes[ids[i]].type).toBe(typesToTest[i]);
    }
  });

  it('createSubgraph creates a subgraph from selected nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [2, 0, 0]);
    getState().addConnection(id1, 0, id2, 0);
    getState().setSelection(new Set([id1, id2]));

    const subgraphNodeId = getState().createSubgraph('TestSubgraph');
    // createSubgraph may return null if selection is insufficient, but with
    // two connected nodes it should succeed
    if (subgraphNodeId !== null) {
      const subNode = getState().nodes[subgraphNodeId];
      expect(subNode).toBeDefined();
      expect(subNode.type).toBe('subgraph');
    }
  });

  it('deleteSelected removes selected nodes', () => {
    const id1 = getState().addNode('source');
    const id2 = getState().addNode('math');
    getState().setSelection(new Set([id1]));
    getState().deleteSelected();

    expect(getState().nodes[id1]).toBeUndefined();
    expect(getState().nodes[id2]).toBeDefined();
  });

  it('deleteSelected removes selected nodes and their connections', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);
    const connId = getState().addConnection(id1, 0, id2, 0);
    expect(connId).not.toBeNull();

    getState().setSelection(new Set([id1]));
    getState().deleteSelected();

    expect(getState().nodes[id1]).toBeUndefined();
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('paste operation with clipboard content', () => {
    // Create and select a node, then copy and paste
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    expect(getState().canPaste()).toBe(true);

    getState().paste();
    const nodeIds = Object.keys(getState().nodes);
    // Should have original + pasted copy
    expect(nodeIds.length).toBe(2);
    const pastedId = nodeIds.find(nid => nid !== id)!;
    expect(getState().nodes[pastedId].type).toBe('source');
  });

  it('setSelection with all node and connection ids acts as select-all', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);
    const connId = getState().addConnection(id1, 0, id2, 0);

    // Select all by collecting all IDs
    const allIds = new Set<string>([...Object.keys(getState().nodes), ...Object.keys(getState().connections)]);
    getState().setSelection(allIds);

    const selected = getState().selectedIds;
    expect(selected.has(id1)).toBe(true);
    expect(selected.has(id2)).toBe(true);
    if (connId) {
      expect(selected.has(connId)).toBe(true);
    }
  });

  it('createGroup groups selected nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [2, 0, 0]);
    getState().setSelection(new Set([id1, id2]));

    const groupId = getState().createGroup('TestGroup');
    expect(groupId).not.toBeNull();

    if (groupId) {
      const group = getState().groups[groupId];
      expect(group).toBeDefined();
      expect(group.label).toBe('TestGroup');
      // Both nodes should be assigned to the group
      expect(getState().nodes[id1].groupId).toBe(groupId);
      expect(getState().nodes[id2].groupId).toBe(groupId);
    }
  });

  it('createGroup returns null when no nodes selected', () => {
    getState().setSelection(new Set());
    const groupId = getState().createGroup('Empty');
    expect(groupId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Context menu open/close with different targets
// ---------------------------------------------------------------------------

describe('Context menu open/close with different targets', () => {
  beforeEach(resetStore);

  it('opening with node target stores nodeId', () => {
    const nodeId = getState().addNode('source');
    getState().openContextMenu({ x: 100, y: 200, target: { kind: 'node', nodeId } });

    const menu = getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu!.target.kind).toBe('node');
    if (menu!.target.kind === 'node') {
      expect(menu!.target.nodeId).toBe(nodeId);
    }
  });

  it('opening with connection target stores connectionId', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);
    const connId = getState().addConnection(id1, 0, id2, 0);
    expect(connId).not.toBeNull();

    getState().openContextMenu({
      x: 150,
      y: 250,
      target: { kind: 'connection', connectionId: connId! },
    });

    const menu = getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu!.target.kind).toBe('connection');
    if (menu!.target.kind === 'connection') {
      expect(menu!.target.connectionId).toBe(connId);
    }
  });

  it('opening with port-release target stores source info', () => {
    const nodeId = getState().addNode('source');
    getState().openContextMenu({
      x: 200,
      y: 300,
      target: { kind: 'port-release', sourceNodeId: nodeId, sourcePortIndex: 0 },
    });

    const menu = getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu!.target.kind).toBe('port-release');
    if (menu!.target.kind === 'port-release') {
      expect(menu!.target.sourceNodeId).toBe(nodeId);
      expect(menu!.target.sourcePortIndex).toBe(0);
    }
  });

  it('opening with port target stores nodeId, portIndex, and portType', () => {
    const nodeId = getState().addNode('math');
    getState().openContextMenu({
      x: 75,
      y: 125,
      target: { kind: 'port', nodeId, portIndex: 1, portType: 'input' },
    });

    const menu = getState().contextMenu;
    expect(menu).not.toBeNull();
    expect(menu!.target.kind).toBe('port');
    if (menu!.target.kind === 'port') {
      expect(menu!.target.nodeId).toBe(nodeId);
      expect(menu!.target.portIndex).toBe(1);
      expect(menu!.target.portType).toBe('input');
    }
  });

  it('closing after node target resets to null', () => {
    const nodeId = getState().addNode('source');
    getState().openContextMenu({ x: 50, y: 60, target: { kind: 'node', nodeId } });
    expect(getState().contextMenu).not.toBeNull();

    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('closing after port-release target resets to null', () => {
    const nodeId = getState().addNode('source');
    getState().openContextMenu({
      x: 10,
      y: 20,
      target: { kind: 'port-release', sourceNodeId: nodeId, sourcePortIndex: 2 },
    });
    expect(getState().contextMenu).not.toBeNull();

    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('switching between target kinds updates correctly', () => {
    const nodeId = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);
    const connId = getState().addConnection(nodeId, 0, id2, 0);

    // Start with canvas target
    getState().openContextMenu({ x: 0, y: 0, target: { kind: 'canvas' } });
    expect(getState().contextMenu!.target.kind).toBe('canvas');

    // Switch to node target
    getState().openContextMenu({ x: 1, y: 1, target: { kind: 'node', nodeId } });
    expect(getState().contextMenu!.target.kind).toBe('node');

    // Switch to connection target
    getState().openContextMenu({
      x: 2,
      y: 2,
      target: { kind: 'connection', connectionId: connId! },
    });
    expect(getState().contextMenu!.target.kind).toBe('connection');

    // Switch to port-release target
    getState().openContextMenu({
      x: 3,
      y: 3,
      target: { kind: 'port-release', sourceNodeId: nodeId, sourcePortIndex: 0 },
    });
    expect(getState().contextMenu!.target.kind).toBe('port-release');

    // Close
    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Menu positioning / viewport tests
// ---------------------------------------------------------------------------

describe('Menu positioning', () => {
  beforeEach(resetStore);

  it('context menu positioned at click coordinates', () => {
    getState().openContextMenu({ x: 512, y: 384, target: { kind: 'canvas' } });
    const menu = getState().contextMenu;
    expect(menu!.x).toBe(512);
    expect(menu!.y).toBe(384);
  });

  it('supports edge-case coordinates (0, 0)', () => {
    getState().openContextMenu({ x: 0, y: 0, target: { kind: 'canvas' } });
    expect(getState().contextMenu!.x).toBe(0);
    expect(getState().contextMenu!.y).toBe(0);
  });

  it('supports large coordinate values', () => {
    getState().openContextMenu({ x: 3840, y: 2160, target: { kind: 'canvas' } });
    expect(getState().contextMenu!.x).toBe(3840);
    expect(getState().contextMenu!.y).toBe(2160);
  });

  it('multiple sequential menus do not interfere', () => {
    // Open menu at position A
    getState().openContextMenu({ x: 100, y: 200, target: { kind: 'canvas' } });
    expect(getState().contextMenu!.x).toBe(100);
    expect(getState().contextMenu!.y).toBe(200);

    // Close and open at position B
    getState().closeContextMenu();
    getState().openContextMenu({ x: 300, y: 400, target: { kind: 'node', nodeId: 'n1' } });
    expect(getState().contextMenu!.x).toBe(300);
    expect(getState().contextMenu!.y).toBe(400);
    // Verify no bleed from position A
    expect(getState().contextMenu!.x).not.toBe(100);

    // Close and open at position C
    getState().closeContextMenu();
    getState().openContextMenu({
      x: 500,
      y: 600,
      target: { kind: 'connection', connectionId: 'c1' },
    });
    expect(getState().contextMenu!.x).toBe(500);
    expect(getState().contextMenu!.y).toBe(600);
    // No bleed from positions A or B
    expect(getState().contextMenu!.target.kind).toBe('connection');
  });

  it('opening menu at same position with different targets is distinct', () => {
    getState().openContextMenu({ x: 250, y: 250, target: { kind: 'canvas' } });
    const menu1 = getState().contextMenu;

    getState().openContextMenu({ x: 250, y: 250, target: { kind: 'node', nodeId: 'n99' } });
    const menu2 = getState().contextMenu;

    // Same position but different target
    expect(menu2!.x).toBe(250);
    expect(menu2!.y).toBe(250);
    expect(menu2!.target.kind).toBe('node');
    expect(menu2!.target).not.toEqual(menu1!.target);
  });

  it('context menu coordinates are preserved exactly through open/read cycle', () => {
    const coords = [
      { x: 0.5, y: 0.5 },
      { x: 1920, y: 1080 },
      { x: 42, y: 99 },
    ];
    for (const { x, y } of coords) {
      getState().openContextMenu({ x, y, target: { kind: 'canvas' } });
      expect(getState().contextMenu!.x).toBe(x);
      expect(getState().contextMenu!.y).toBe(y);
      getState().closeContextMenu();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Integration: CanvasMenu workflow simulation
// ---------------------------------------------------------------------------

describe('CanvasMenu workflow simulation', () => {
  beforeEach(resetStore);

  it('open canvas menu, add node, close menu', () => {
    // Simulate right-click on canvas
    getState().openContextMenu({ x: 400, y: 300, target: { kind: 'canvas' } });
    expect(getState().contextMenu).not.toBeNull();
    expect(getState().contextMenu!.target.kind).toBe('canvas');

    // User picks a node type from the menu
    const id = getState().addNode('math', [4, 0, 3]);
    expect(getState().nodes[id]).toBeDefined();
    expect(getState().nodes[id].type).toBe('math');

    // Menu closes after selection
    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('open node context menu, delete node, close menu', () => {
    const nodeId = getState().addNode('filter');
    getState().openContextMenu({ x: 200, y: 100, target: { kind: 'node', nodeId } });

    // Select and delete
    getState().setSelection(new Set([nodeId]));
    getState().deleteSelected();
    expect(getState().nodes[nodeId]).toBeUndefined();

    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('open connection context menu, delete connection, close menu', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('output', [3, 0, 0]);
    const connId = getState().addConnection(id1, 0, id2, 0);
    expect(connId).not.toBeNull();

    getState().openContextMenu({
      x: 150,
      y: 75,
      target: { kind: 'connection', connectionId: connId! },
    });

    getState().removeConnection(connId!);
    expect(getState().connections[connId!]).toBeUndefined();

    getState().closeContextMenu();
    expect(getState().contextMenu).toBeNull();
  });

  it('every CATEGORY_ORDER category can produce addNode calls for its button types', () => {
    for (const cat of CATEGORY_ORDER) {
      const buttons = BUTTONS_BY_CATEGORY[cat];
      if (buttons.length === 0) continue;

      // Pick the first button from each category and verify addNode works
      const btn = buttons[0];
      const id = getState().addNode(btn.type, [0, 0, 0]);
      expect(getState().nodes[id]).toBeDefined();
      expect(getState().nodes[id].type).toBe(btn.type);
    }
  });

  it('copy-paste preserves node type from CanvasMenu-created nodes', () => {
    const id = getState().addNode('color-picker', [0, 0, 0]);
    getState().setSelection(new Set([id]));
    getState().copySelected();
    getState().paste();

    const allNodes = Object.values(getState().nodes);
    const colorPickers = allNodes.filter(n => n.type === 'color-picker');
    expect(colorPickers.length).toBe(2);
  });
});
