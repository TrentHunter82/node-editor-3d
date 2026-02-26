/**
 * Unit tests for extracted store slices:
 * - graphSlice (sanitizeGraphOrder, graphInitialState, createGraphActions)
 * - groupSlice (createGroupActions)
 *
 * These test the slice logic directly, separate from the full editorStore.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeGraphOrder, graphInitialState, DEFAULT_GRAPH_ID, createGraphActions, type GraphSliceState } from './graphSlice';
import { createGroupActions, type GroupActions } from './groupSlice';
import type { GraphTab, NodeGroup, EditorNode } from '../../types';

// ==========================================================================
// sanitizeGraphOrder
// ==========================================================================
describe('sanitizeGraphOrder', () => {
  it('keeps order when graphOrder matches graphTabs', () => {
    const tabs: Record<string, GraphTab> = {
      a: { id: 'a', name: 'A', createdAt: 0 },
      b: { id: 'b', name: 'B', createdAt: 0 },
      c: { id: 'c', name: 'C', createdAt: 0 },
    };
    const result = sanitizeGraphOrder(tabs, ['a', 'b', 'c']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('removes extra entries not in graphTabs', () => {
    const tabs: Record<string, GraphTab> = {
      a: { id: 'a', name: 'A', createdAt: 0 },
      b: { id: 'b', name: 'B', createdAt: 0 },
    };
    const result = sanitizeGraphOrder(tabs, ['a', 'deleted', 'b', 'also-deleted']);
    expect(result).toEqual(['a', 'b']);
  });

  it('appends missing graphTabs to the end', () => {
    const tabs: Record<string, GraphTab> = {
      a: { id: 'a', name: 'A', createdAt: 0 },
      b: { id: 'b', name: 'B', createdAt: 0 },
      c: { id: 'c', name: 'C', createdAt: 0 },
    };
    const result = sanitizeGraphOrder(tabs, ['a']);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('handles empty graphOrder', () => {
    const tabs: Record<string, GraphTab> = {
      x: { id: 'x', name: 'X', createdAt: 0 },
    };
    const result = sanitizeGraphOrder(tabs, []);
    expect(result).toEqual(['x']);
  });

  it('handles empty graphTabs', () => {
    const result = sanitizeGraphOrder({}, ['a', 'b']);
    expect(result).toEqual([]);
  });

  it('handles null/undefined graphOrder gracefully', () => {
    const tabs: Record<string, GraphTab> = {
      a: { id: 'a', name: 'A', createdAt: 0 },
    };
    const result = sanitizeGraphOrder(tabs, undefined as unknown as string[]);
    expect(result).toEqual(['a']);
  });
});

// ==========================================================================
// graphInitialState
// ==========================================================================
describe('graphInitialState', () => {
  it('has default graph tab', () => {
    expect(graphInitialState.graphTabs[DEFAULT_GRAPH_ID]).toBeDefined();
    expect(graphInitialState.graphTabs[DEFAULT_GRAPH_ID].name).toBe('Main');
  });

  it('has default as active graph', () => {
    expect(graphInitialState.activeGraphId).toBe(DEFAULT_GRAPH_ID);
  });

  it('has default in graph order', () => {
    expect(graphInitialState.graphOrder).toEqual([DEFAULT_GRAPH_ID]);
  });

  it('has empty breadcrumb stack', () => {
    expect(graphInitialState.breadcrumbStack).toEqual([]);
  });
});

// ==========================================================================
// createGraphActions
// ==========================================================================
describe('createGraphActions', () => {
  let state: GraphSliceState;
  let actions: ReturnType<typeof createGraphActions>;

  beforeEach(() => {
    state = {
      graphTabs: {
        a: { id: 'a', name: 'Graph A', createdAt: 0 },
        b: { id: 'b', name: 'Graph B', createdAt: 0 },
        c: { id: 'c', name: 'Graph C', createdAt: 0 },
      },
      activeGraphId: 'a',
      graphOrder: ['a', 'b', 'c'],
      breadcrumbStack: [],
    };

    const set = (fn: (s: GraphSliceState) => void) => { fn(state); };
    const get = () => state;
    actions = createGraphActions(set, get);
  });

  describe('renameGraph', () => {
    it('renames a graph tab', () => {
      actions.renameGraph('a', 'Renamed A');
      expect(state.graphTabs.a.name).toBe('Renamed A');
    });

    it('ignores rename for nonexistent graph', () => {
      actions.renameGraph('nonexistent', 'Nope');
      expect(state.graphTabs.nonexistent).toBeUndefined();
    });
  });

  describe('reorderGraph', () => {
    it('moves graph to new position', () => {
      actions.reorderGraph('a', 2);
      expect(state.graphOrder).toEqual(['b', 'c', 'a']);
    });

    it('moves graph to the front', () => {
      actions.reorderGraph('c', 0);
      expect(state.graphOrder).toEqual(['c', 'a', 'b']);
    });

    it('clamps to valid range', () => {
      actions.reorderGraph('a', 100);
      expect(state.graphOrder).toEqual(['b', 'c', 'a']);

      actions.reorderGraph('a', -5);
      expect(state.graphOrder).toEqual(['a', 'b', 'c']);
    });

    it('no-ops when position is unchanged', () => {
      const before = [...state.graphOrder];
      actions.reorderGraph('a', 0);
      expect(state.graphOrder).toEqual(before);
    });

    it('ignores reorder for nonexistent graph', () => {
      const before = [...state.graphOrder];
      actions.reorderGraph('nonexistent', 1);
      expect(state.graphOrder).toEqual(before);
    });
  });

  describe('updateGraphMetadata', () => {
    it('sets description on a graph tab', () => {
      actions.updateGraphMetadata('a', { description: 'A cool graph' });
      expect(state.graphTabs.a.description).toBe('A cool graph');
    });

    it('sets author on a graph tab', () => {
      actions.updateGraphMetadata('b', { author: 'Alice' });
      expect(state.graphTabs.b.author).toBe('Alice');
    });

    it('sets tags on a graph tab', () => {
      actions.updateGraphMetadata('a', { tags: ['physics', 'demo'] });
      expect(state.graphTabs.a.tags).toEqual(['physics', 'demo']);
    });

    it('clears description when empty string', () => {
      actions.updateGraphMetadata('a', { description: 'Temp' });
      expect(state.graphTabs.a.description).toBe('Temp');
      actions.updateGraphMetadata('a', { description: '' });
      expect(state.graphTabs.a.description).toBeUndefined();
    });

    it('clears author when empty string', () => {
      actions.updateGraphMetadata('a', { author: 'Bob' });
      actions.updateGraphMetadata('a', { author: '' });
      expect(state.graphTabs.a.author).toBeUndefined();
    });

    it('clears tags when empty array', () => {
      actions.updateGraphMetadata('a', { tags: ['x'] });
      actions.updateGraphMetadata('a', { tags: [] });
      expect(state.graphTabs.a.tags).toBeUndefined();
    });

    it('sets multiple fields at once', () => {
      actions.updateGraphMetadata('c', { description: 'Test', author: 'Eve', tags: ['a', 'b'] });
      expect(state.graphTabs.c.description).toBe('Test');
      expect(state.graphTabs.c.author).toBe('Eve');
      expect(state.graphTabs.c.tags).toEqual(['a', 'b']);
    });

    it('ignores nonexistent graph', () => {
      actions.updateGraphMetadata('nonexistent', { description: 'Nope' });
      expect(state.graphTabs.nonexistent).toBeUndefined();
    });

    it('does not touch fields not in metadata', () => {
      actions.updateGraphMetadata('a', { description: 'Hello' });
      expect(state.graphTabs.a.name).toBe('Graph A');
      expect(state.graphTabs.a.author).toBeUndefined();
    });
  });
});

// ==========================================================================
// createGroupActions
// ==========================================================================
describe('createGroupActions', () => {
  let nodes: Record<string, EditorNode>;
  let groups: Record<string, NodeGroup>;
  let selectedIds: Set<string>;
  let undoPushed: number;
  let nextGroupId: number;
  let actions: GroupActions;

  function makeTestNode(id: string, groupId?: string): EditorNode {
    return {
      id,
      type: 'source',
      position: [0, 0, 0],
      title: `Node ${id}`,
      data: {},
      inputs: [],
      outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
      ...(groupId ? { groupId } : {}),
    };
  }

  beforeEach(() => {
    nodes = {
      n1: makeTestNode('n1'),
      n2: makeTestNode('n2'),
      n3: makeTestNode('n3'),
    };
    groups = {};
    selectedIds = new Set(['n1', 'n2']);
    undoPushed = 0;
    nextGroupId = 1;

    const state = { nodes, groups, selectedIds };
    const set = (fn: (s: typeof state) => void) => { fn(state); };
    const get = () => state;
    const pushUndo = () => { undoPushed++; };
    const genId = () => `group-${nextGroupId++}`;

    actions = createGroupActions(set, get, pushUndo, genId);
  });

  describe('createGroup', () => {
    it('creates a group with selected nodes', () => {
      const groupId = actions.createGroup('Test');
      expect(groupId).toBe('group-1');
      expect(groups['group-1']).toBeDefined();
      expect(groups['group-1'].label).toBe('Test');
      expect(nodes.n1.groupId).toBe('group-1');
      expect(nodes.n2.groupId).toBe('group-1');
    });

    it('pushes undo', () => {
      actions.createGroup('Test');
      expect(undoPushed).toBe(1);
    });

    it('defaults label to "Group"', () => {
      const groupId = actions.createGroup();
      expect(groups[groupId!].label).toBe('Group');
    });

    it('returns null if fewer than 2 nodes selected', () => {
      selectedIds.clear();
      selectedIds.add('n1');
      expect(actions.createGroup()).toBeNull();
    });

    it('returns null if all selected nodes are already in the same group', () => {
      nodes.n1.groupId = 'existing-group';
      nodes.n2.groupId = 'existing-group';
      expect(actions.createGroup()).toBeNull();
    });

    it('filters out non-existent node IDs from selection', () => {
      selectedIds.add('nonexistent');
      const groupId = actions.createGroup();
      expect(groupId).toBeTruthy();
      // Only real nodes should be in the group
      expect(nodes.n1.groupId).toBe(groupId);
      expect(nodes.n2.groupId).toBe(groupId);
    });
  });

  describe('ungroupNodes', () => {
    it('removes group and clears groupId from nodes', () => {
      const groupId = actions.createGroup('Test')!;
      undoPushed = 0;

      actions.ungroupNodes(groupId);

      expect(groups[groupId]).toBeUndefined();
      expect(nodes.n1.groupId).toBeUndefined();
      expect(nodes.n2.groupId).toBeUndefined();
      expect(undoPushed).toBe(1);
    });

    it('ignores nonexistent group', () => {
      undoPushed = 0;
      actions.ungroupNodes('fake-group');
      expect(undoPushed).toBe(0);
    });
  });

  describe('toggleGroupCollapse', () => {
    it('toggles collapsed state (no undo — view-state)', () => {
      const groupId = actions.createGroup()!;
      expect(groups[groupId].collapsed).toBe(false);
      undoPushed = 0;

      actions.toggleGroupCollapse(groupId);
      expect(groups[groupId].collapsed).toBe(true);
      expect(undoPushed).toBe(0); // view-state: no undo pushed

      actions.toggleGroupCollapse(groupId);
      expect(groups[groupId].collapsed).toBe(false);
    });

    it('ignores nonexistent group', () => {
      undoPushed = 0;
      actions.toggleGroupCollapse('fake');
      expect(undoPushed).toBe(0);
    });
  });

  describe('renameGroup', () => {
    it('renames a group', () => {
      const groupId = actions.createGroup('Old')!;
      undoPushed = 0;

      actions.renameGroup(groupId, 'New');
      expect(groups[groupId].label).toBe('New');
      expect(undoPushed).toBe(1);
    });

    it('ignores nonexistent group', () => {
      undoPushed = 0;
      actions.renameGroup('fake', 'Nope');
      expect(undoPushed).toBe(0);
    });
  });

  describe('setGroupColor', () => {
    it('sets a color on the group', () => {
      const groupId = actions.createGroup('Colored')!;
      undoPushed = 0;

      actions.setGroupColor(groupId, '#ff0000');
      expect(groups[groupId].color).toBe('#ff0000');
      expect(undoPushed).toBe(1);
    });

    it('clears color when undefined', () => {
      const groupId = actions.createGroup('Colored')!;
      actions.setGroupColor(groupId, '#00ff00');
      expect(groups[groupId].color).toBe('#00ff00');

      undoPushed = 0;
      actions.setGroupColor(groupId, undefined);
      expect(groups[groupId].color).toBeUndefined();
      expect(undoPushed).toBe(1);
    });

    it('ignores nonexistent group', () => {
      undoPushed = 0;
      actions.setGroupColor('fake', '#ff0000');
      expect(undoPushed).toBe(0);
    });
  });

  describe('setGroupDescription', () => {
    it('sets a description on the group', () => {
      const groupId = actions.createGroup('Described')!;
      undoPushed = 0;

      actions.setGroupDescription(groupId, 'A test group');
      expect(groups[groupId].description).toBe('A test group');
      expect(undoPushed).toBe(1);
    });

    it('clears description when empty string', () => {
      const groupId = actions.createGroup('Described')!;
      actions.setGroupDescription(groupId, 'Temporary');
      expect(groups[groupId].description).toBe('Temporary');

      undoPushed = 0;
      actions.setGroupDescription(groupId, '');
      expect(groups[groupId].description).toBeUndefined();
      expect(undoPushed).toBe(1);
    });

    it('ignores nonexistent group', () => {
      undoPushed = 0;
      actions.setGroupDescription('fake', 'Nope');
      expect(undoPushed).toBe(0);
    });
  });
});
