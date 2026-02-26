/**
 * Unit tests for templateSlice — node template management actions.
 *
 * Tests saveSelectionAsTemplate, instantiateTemplate, deleteTemplate,
 * importTemplates, and exportTemplates.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTemplateActions } from './templateSlice';
import type { EditorNode, Connection, NodeTemplate } from '../../types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTestNode(id: string, overrides?: Partial<EditorNode>): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: `Node ${id}`,
    data: { value: 42 },
    inputs: [],
    outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
    ...overrides,
  };
}

function makeConnection(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  overrides?: Partial<Connection>,
): Connection {
  return {
    id,
    sourceNodeId,
    sourcePortIndex: 0,
    targetNodeId,
    targetPortIndex: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('createTemplateActions', () => {
  let state: {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    selectedIds: Set<string>;
    templates: Record<string, NodeTemplate>;
  };
  let undoPushed: number;
  let nextId: number;
  let nextConnectionId: number;
  let nextTemplateId: number;
  let actions: ReturnType<typeof createTemplateActions>;

  beforeEach(() => {
    state = {
      nodes: {
        n1: makeTestNode('n1', { position: [1, 0, 1] }),
        n2: makeTestNode('n2', { position: [3, 0, 3] }),
        n3: makeTestNode('n3', { position: [5, 0, 5] }),
      },
      connections: {
        c1: makeConnection('c1', 'n1', 'n2'),
        c2: makeConnection('c2', 'n2', 'n3'),
        c3: makeConnection('c3', 'n1', 'n3'),
      },
      selectedIds: new Set(['n1', 'n2']),
      templates: {},
    };

    undoPushed = 0;
    nextId = 1;
    nextConnectionId = 1;
    nextTemplateId = 1;

    const set = (fn: (s: typeof state) => void) => { fn(state); };
    const get = () => state;
    const helpers = {
      pushUndo: () => { undoPushed++; },
      genId: () => `new-${nextId++}`,
      genConnectionId: () => `conn-${nextConnectionId++}`,
      genTemplateId: () => `tmpl-${nextTemplateId++}`,
    };

    actions = createTemplateActions(set, get, helpers);
  });

  // ========================================================================
  // saveSelectionAsTemplate
  // ========================================================================
  describe('saveSelectionAsTemplate', () => {
    it('saves selected nodes and internal connections as template', () => {
      const id = actions.saveSelectionAsTemplate('My Template');
      expect(id).toBe('tmpl-1');
      const tmpl = state.templates['tmpl-1'];
      expect(tmpl).toBeDefined();
      expect(tmpl.name).toBe('My Template');
      expect(tmpl.nodes).toHaveLength(2);
      expect(tmpl.nodes.map(n => n.id).sort()).toEqual(['n1', 'n2']);
      // Only c1 connects n1->n2, which are both selected
      expect(tmpl.connections).toHaveLength(1);
      expect(tmpl.connections[0].id).toBe('c1');
    });

    it('returns null when no nodes selected', () => {
      state.selectedIds = new Set();
      const id = actions.saveSelectionAsTemplate('Empty');
      expect(id).toBeNull();
      expect(Object.keys(state.templates)).toHaveLength(0);
    });

    it('defaults category to "User"', () => {
      const id = actions.saveSelectionAsTemplate('Test');
      expect(state.templates[id!].category).toBe('User');
    });

    it('uses provided category', () => {
      const id = actions.saveSelectionAsTemplate('Test', 'Math');
      expect(state.templates[id!].category).toBe('Math');
    });

    it('only includes connections between selected nodes', () => {
      // Select all three nodes
      state.selectedIds = new Set(['n1', 'n2', 'n3']);
      const id = actions.saveSelectionAsTemplate('All');
      const tmpl = state.templates[id!];
      // All three connections should be included (c1: n1->n2, c2: n2->n3, c3: n1->n3)
      expect(tmpl.connections).toHaveLength(3);

      // Now select only n1 and n3 (c3 connects them, but c1 and c2 do not)
      state.selectedIds = new Set(['n1', 'n3']);
      const id2 = actions.saveSelectionAsTemplate('Partial');
      const tmpl2 = state.templates[id2!];
      expect(tmpl2.connections).toHaveLength(1);
      expect(tmpl2.connections[0].sourceNodeId).toBe('n1');
      expect(tmpl2.connections[0].targetNodeId).toBe('n3');
    });

    it('filters out selected IDs that are not nodes', () => {
      state.selectedIds = new Set(['n1', 'nonexistent-id', 'n2']);
      const id = actions.saveSelectionAsTemplate('Filtered');
      const tmpl = state.templates[id!];
      // Only n1 and n2 are real nodes
      expect(tmpl.nodes).toHaveLength(2);
    });

    it('creates deep copies of nodes and connections', () => {
      const id = actions.saveSelectionAsTemplate('Deep');
      const tmpl = state.templates[id!];
      // Mutate original node data
      state.nodes.n1.data.value = 999;
      // Template should retain the original value
      const tmplNode = tmpl.nodes.find(n => n.id === 'n1')!;
      expect(tmplNode.data.value).toBe(42);
    });

    it('stores createdAt timestamp', () => {
      const before = Date.now();
      const id = actions.saveSelectionAsTemplate('Timed');
      const after = Date.now();
      const tmpl = state.templates[id!];
      expect(tmpl.createdAt).toBeGreaterThanOrEqual(before);
      expect(tmpl.createdAt).toBeLessThanOrEqual(after);
    });
  });

  // ========================================================================
  // instantiateTemplate
  // ========================================================================
  describe('instantiateTemplate', () => {
    let templateId: string;

    beforeEach(() => {
      templateId = actions.saveSelectionAsTemplate('TestTemplate')!;
      // Reset counters after template creation
      nextId = 100;
      nextConnectionId = 100;
      undoPushed = 0;
    });

    it('creates new nodes with new IDs at specified position', () => {
      actions.instantiateTemplate(templateId, [10, 0, 10]);
      // Two new nodes should have been created
      expect(state.nodes['new-100']).toBeDefined();
      expect(state.nodes['new-101']).toBeDefined();
    });

    it('remaps connection node IDs', () => {
      actions.instantiateTemplate(templateId, [0, 0, 0]);
      const newConn = state.connections['conn-100'];
      expect(newConn).toBeDefined();
      // The connection should point to the new node IDs, not the original ones
      expect(newConn.sourceNodeId).toMatch(/^new-/);
      expect(newConn.targetNodeId).toMatch(/^new-/);
      expect(newConn.sourceNodeId).not.toBe('n1');
      expect(newConn.targetNodeId).not.toBe('n2');
    });

    it('preserves node data (deep copy)', () => {
      actions.instantiateTemplate(templateId, [0, 0, 0]);
      const instantiatedNode = state.nodes['new-100'] ?? state.nodes['new-101'];
      expect(instantiatedNode).toBeDefined();
      expect(instantiatedNode.data.value).toBe(42);
      // Mutating the template node data should not affect the instantiated node
      const tmpl = state.templates[templateId];
      tmpl.nodes[0].data.value = 999;
      expect(instantiatedNode.data.value).toBe(42);
    });

    it('preserves connection metadata (label, colorOverride)', () => {
      // Create a template with connection metadata
      state.connections.c1.label = 'test-label';
      state.connections.c1.colorOverride = '#ff0000';
      state.connections.c1.styleOverride = 'bezier';
      state.selectedIds = new Set(['n1', 'n2']);
      const tmplId = actions.saveSelectionAsTemplate('WithMeta')!;
      nextId = 200;
      nextConnectionId = 200;
      actions.instantiateTemplate(tmplId, [0, 0, 0]);
      const newConn = state.connections['conn-200'];
      expect(newConn.label).toBe('test-label');
      expect(newConn.colorOverride).toBe('#ff0000');
      expect(newConn.styleOverride).toBe('bezier');
    });

    it('selects instantiated nodes', () => {
      actions.instantiateTemplate(templateId, [0, 0, 0]);
      expect(state.selectedIds.has('new-100')).toBe(true);
      expect(state.selectedIds.has('new-101')).toBe(true);
      expect(state.selectedIds.size).toBe(2);
    });

    it('no-ops for nonexistent template', () => {
      const nodeCountBefore = Object.keys(state.nodes).length;
      actions.instantiateTemplate('nonexistent');
      expect(Object.keys(state.nodes).length).toBe(nodeCountBefore);
      expect(undoPushed).toBe(0);
    });

    it('pushes undo', () => {
      actions.instantiateTemplate(templateId, [0, 0, 0]);
      expect(undoPushed).toBe(1);
    });

    it('offsets positions relative to template center', () => {
      // Original nodes: n1 at [1,0,1], n2 at [3,0,3]
      // Center: cx = 2, cz = 2
      // Target position [10, 0, 10] -> offset = [8, _, 8]
      actions.instantiateTemplate(templateId, [10, 0, 10]);
      const node1 = state.nodes['new-100'];
      const node2 = state.nodes['new-101'];
      // The nodes should be offset so the center is at [10, _, 10]
      const positions = [node1.position, node2.position];
      const xAvg = (positions[0][0] + positions[1][0]) / 2;
      const zAvg = (positions[0][2] + positions[1][2]) / 2;
      expect(xAvg).toBeCloseTo(10, 5);
      expect(zAvg).toBeCloseTo(10, 5);
    });

    it('preserves node type and title', () => {
      actions.instantiateTemplate(templateId, [0, 0, 0]);
      const newNode = state.nodes['new-100'];
      expect(newNode.type).toBe('source');
      expect(newNode.title).toMatch(/^Node n/);
    });

    it('does not preserve groupId', () => {
      state.nodes.n1.groupId = 'group-1';
      const tmplId = actions.saveSelectionAsTemplate('Grouped')!;
      nextId = 300;
      actions.instantiateTemplate(tmplId, [0, 0, 0]);
      expect(state.nodes['new-300'].groupId).toBeUndefined();
    });
  });

  // ========================================================================
  // deleteTemplate
  // ========================================================================
  describe('deleteTemplate', () => {
    it('removes template', () => {
      const id = actions.saveSelectionAsTemplate('ToDelete')!;
      expect(state.templates[id]).toBeDefined();
      actions.deleteTemplate(id);
      expect(state.templates[id]).toBeUndefined();
    });

    it('no-ops for nonexistent template', () => {
      const countBefore = Object.keys(state.templates).length;
      actions.deleteTemplate('nonexistent');
      expect(Object.keys(state.templates).length).toBe(countBefore);
    });
  });

  // ========================================================================
  // importTemplates
  // ========================================================================
  describe('importTemplates', () => {
    it('merges templates into state', () => {
      const imported: Record<string, NodeTemplate> = {
        ext1: {
          id: 'ext1',
          name: 'External 1',
          category: 'Imported',
          nodes: [makeTestNode('x1')],
          connections: [],
          createdAt: 1000,
        },
        ext2: {
          id: 'ext2',
          name: 'External 2',
          category: 'Imported',
          nodes: [makeTestNode('x2')],
          connections: [],
          createdAt: 2000,
        },
      };

      // Create an existing template first
      actions.saveSelectionAsTemplate('Existing');
      const countBefore = Object.keys(state.templates).length;

      actions.importTemplates(imported);
      expect(Object.keys(state.templates).length).toBe(countBefore + 2);
      expect(state.templates.ext1.name).toBe('External 1');
      expect(state.templates.ext2.name).toBe('External 2');
    });

    it('overwrites templates with same ID', () => {
      const id = actions.saveSelectionAsTemplate('Original')!;
      const replacement: Record<string, NodeTemplate> = {
        [id]: {
          id,
          name: 'Replaced',
          category: 'Test',
          nodes: [],
          connections: [],
          createdAt: 9999,
        },
      };
      actions.importTemplates(replacement);
      expect(state.templates[id].name).toBe('Replaced');
    });
  });

  // ========================================================================
  // exportTemplates
  // ========================================================================
  describe('exportTemplates', () => {
    it('returns deep copy of templates', () => {
      const id = actions.saveSelectionAsTemplate('Export')!;
      const exported = actions.exportTemplates();
      expect(exported[id]).toBeDefined();
      expect(exported[id].name).toBe('Export');

      // Mutate the export and verify it does not affect state
      exported[id].name = 'Mutated';
      expect(state.templates[id].name).toBe('Export');
    });

    it('returns empty object when no templates exist', () => {
      const exported = actions.exportTemplates();
      expect(exported).toEqual({});
    });
  });
});
