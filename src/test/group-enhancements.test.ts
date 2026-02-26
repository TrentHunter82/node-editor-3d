/**
 * Group enhancements tests (20 tests).
 *
 * Covers Phase 29 node group enhancement features:
 * - setGroupColor: color customization, undo/redo integration
 * - setGroupDescription: description text, undo integration
 * - Serialization roundtrip (exportAllGraphs / importAllGraphs)
 * - Cross-feature interactions (rename, collapse, ungroup, multi-group)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.validationErrors = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.isExecuting = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.showValuePreviews = true;
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
}

beforeEach(() => {
  resetStore();
});

/** Create a group of 2 nodes and return { n1, n2, groupId }. */
function createSimpleGroup(label?: string) {
  const n1 = getStore().addNode('source', [0, 0, 0]);
  const n2 = getStore().addNode('transform', [5, 0, 0]);
  getStore().setSelection(new Set([n1, n2]));
  const groupId = getStore().createGroup(label)!;
  expect(groupId).toBeTruthy();
  return { n1, n2, groupId };
}

// ===========================================================================
// 1. Group Color (8 tests)
// ===========================================================================

describe('setGroupColor', () => {
  it('1. sets color on an existing group', () => {
    const { groupId } = createSimpleGroup('Colored');
    getStore().setGroupColor(groupId, '#ff0000');
    expect(getStore().groups[groupId].color).toBe('#ff0000');
  });

  it('2. clears color when passed undefined', () => {
    const { groupId } = createSimpleGroup('ClearColor');
    getStore().setGroupColor(groupId, '#00ff00');
    expect(getStore().groups[groupId].color).toBe('#00ff00');

    getStore().setGroupColor(groupId, undefined);
    expect(getStore().groups[groupId].color).toBeUndefined();
  });

  it('3. is no-op for non-existent groupId', () => {
    createSimpleGroup();
    const groupsBefore = structuredClone(getStore().groups);
    getStore().setGroupColor('nonexistent-id', '#123456');
    // Groups record should remain unchanged
    expect(getStore().groups).toEqual(groupsBefore);
  });

  it('4. pushes undo (canUndo after setGroupColor)', () => {
    const { groupId } = createSimpleGroup('UndoColor');
    // Undo all previous actions to isolate setGroupColor
    getStore().undo(); // undo createGroup
    getStore().undo(); // undo addNode (transform)
    getStore().undo(); // undo addNode (source)
    expect(getStore().canUndo()).toBe(false);

    // Redo to restore the group
    getStore().redo(); // redo addNode (source)
    getStore().redo(); // redo addNode (transform)
    getStore().redo(); // redo createGroup
    expect(getStore().groups[groupId]).toBeDefined();

    // Now setGroupColor should push a new undo entry
    getStore().setGroupColor(groupId, '#abcdef');
    expect(getStore().canUndo()).toBe(true);
  });

  it('5. undo restores previous color', () => {
    const { groupId } = createSimpleGroup('UndoRestore');
    expect(getStore().groups[groupId].color).toBeUndefined();

    getStore().setGroupColor(groupId, '#ff00ff');
    expect(getStore().groups[groupId].color).toBe('#ff00ff');

    getStore().undo(); // undo setGroupColor
    expect(getStore().groups[groupId].color).toBeUndefined();
  });

  it('6. redo re-applies color', () => {
    const { groupId } = createSimpleGroup('RedoColor');
    getStore().setGroupColor(groupId, '#42a5f5');
    expect(getStore().groups[groupId].color).toBe('#42a5f5');

    getStore().undo(); // undo setGroupColor
    expect(getStore().groups[groupId].color).toBeUndefined();

    getStore().redo(); // redo setGroupColor
    expect(getStore().groups[groupId].color).toBe('#42a5f5');
  });

  it('7. multiple groups have independent colors', () => {
    // Group A
    const n1 = getStore().addNode('source', [0, 0, 0]);
    const n2 = getStore().addNode('transform', [5, 0, 0]);
    getStore().setSelection(new Set([n1, n2]));
    const gA = getStore().createGroup('GroupA')!;
    expect(gA).toBeTruthy();

    // Group B
    const n3 = getStore().addNode('source', [10, 0, 0]);
    const n4 = getStore().addNode('transform', [15, 0, 0]);
    getStore().setSelection(new Set([n3, n4]));
    const gB = getStore().createGroup('GroupB')!;
    expect(gB).toBeTruthy();

    // Set different colors
    getStore().setGroupColor(gA, '#ff0000');
    getStore().setGroupColor(gB, '#0000ff');
    expect(getStore().groups[gA].color).toBe('#ff0000');
    expect(getStore().groups[gB].color).toBe('#0000ff');

    // Changing one does not affect the other
    getStore().setGroupColor(gA, '#00ff00');
    expect(getStore().groups[gA].color).toBe('#00ff00');
    expect(getStore().groups[gB].color).toBe('#0000ff');

    // Clearing one does not affect the other
    getStore().setGroupColor(gA, undefined);
    expect(getStore().groups[gA].color).toBeUndefined();
    expect(getStore().groups[gB].color).toBe('#0000ff');
  });

  it('8. color persists through group rename', () => {
    const { groupId } = createSimpleGroup('Original');
    getStore().setGroupColor(groupId, '#4caf50');
    expect(getStore().groups[groupId].color).toBe('#4caf50');

    getStore().renameGroup(groupId, 'Renamed');
    expect(getStore().groups[groupId].label).toBe('Renamed');
    expect(getStore().groups[groupId].color).toBe('#4caf50');
  });
});

// ===========================================================================
// 2. Group Description (6 tests)
// ===========================================================================

describe('setGroupDescription', () => {
  it('9. sets description text on an existing group', () => {
    const { groupId } = createSimpleGroup('Described');
    getStore().setGroupDescription(groupId, 'This group processes data');
    expect(getStore().groups[groupId].description).toBe('This group processes data');
  });

  it('10. clears description when passed empty string', () => {
    const { groupId } = createSimpleGroup('ClearDesc');
    getStore().setGroupDescription(groupId, 'Some description');
    expect(getStore().groups[groupId].description).toBe('Some description');

    getStore().setGroupDescription(groupId, '');
    expect(getStore().groups[groupId].description).toBeUndefined();
  });

  it('11. is no-op for non-existent groupId', () => {
    createSimpleGroup();
    const groupsBefore = structuredClone(getStore().groups);
    getStore().setGroupDescription('nonexistent-id', 'Should not appear');
    expect(getStore().groups).toEqual(groupsBefore);
  });

  it('12. pushes undo (canUndo after setGroupDescription)', () => {
    const { groupId } = createSimpleGroup('UndoDesc');
    // Undo all previous actions to isolate setGroupDescription
    getStore().undo(); // undo createGroup
    getStore().undo(); // undo addNode (transform)
    getStore().undo(); // undo addNode (source)
    expect(getStore().canUndo()).toBe(false);

    // Redo to restore the group
    getStore().redo();
    getStore().redo();
    getStore().redo();
    expect(getStore().groups[groupId]).toBeDefined();

    getStore().setGroupDescription(groupId, 'test description');
    expect(getStore().canUndo()).toBe(true);
  });

  it('13. undo restores previous description', () => {
    const { groupId } = createSimpleGroup('UndoDescRestore');
    expect(getStore().groups[groupId].description).toBeUndefined();

    getStore().setGroupDescription(groupId, 'Added description');
    expect(getStore().groups[groupId].description).toBe('Added description');

    getStore().undo(); // undo setGroupDescription
    expect(getStore().groups[groupId].description).toBeUndefined();
  });

  it('14. description persists through color change', () => {
    const { groupId } = createSimpleGroup('DescColor');
    getStore().setGroupDescription(groupId, 'My important notes');
    expect(getStore().groups[groupId].description).toBe('My important notes');

    getStore().setGroupColor(groupId, '#e91e63');
    expect(getStore().groups[groupId].color).toBe('#e91e63');
    // Description must still be intact after color change
    expect(getStore().groups[groupId].description).toBe('My important notes');
  });
});

// ===========================================================================
// 3. Serialization & Integration (6 tests)
// ===========================================================================

describe('Serialization & Integration', () => {
  it('15. color and description survive exportAllGraphs -> importAllGraphs roundtrip', () => {
    const { groupId } = createSimpleGroup('Roundtrip');
    getStore().setGroupColor(groupId, '#42a5f5');
    getStore().setGroupDescription(groupId, 'Survives serialization');

    const exported = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(exported);

    expect(getStore().groups[groupId]).toBeDefined();
    expect(getStore().groups[groupId].color).toBe('#42a5f5');
    expect(getStore().groups[groupId].description).toBe('Survives serialization');
    expect(getStore().groups[groupId].label).toBe('Roundtrip');
  });

  it('16. color survives undo -> redo cycle', () => {
    const { groupId } = createSimpleGroup('UndoRedoCycle');
    getStore().setGroupColor(groupId, '#9c27b0');
    expect(getStore().groups[groupId].color).toBe('#9c27b0');

    // Undo the color change
    getStore().undo();
    expect(getStore().groups[groupId].color).toBeUndefined();

    // Redo the color change
    getStore().redo();
    expect(getStore().groups[groupId].color).toBe('#9c27b0');

    // Undo again and redo again to confirm stability
    getStore().undo();
    expect(getStore().groups[groupId].color).toBeUndefined();
    getStore().redo();
    expect(getStore().groups[groupId].color).toBe('#9c27b0');
  });

  it('17. collapse/expand does not affect color or description', () => {
    const { groupId } = createSimpleGroup('CollapseTest');
    getStore().setGroupColor(groupId, '#ff5722');
    getStore().setGroupDescription(groupId, 'Survives collapse');

    // Collapse
    getStore().toggleGroupCollapse(groupId);
    expect(getStore().groups[groupId].collapsed).toBe(true);
    expect(getStore().groups[groupId].color).toBe('#ff5722');
    expect(getStore().groups[groupId].description).toBe('Survives collapse');

    // Expand
    getStore().toggleGroupCollapse(groupId);
    expect(getStore().groups[groupId].collapsed).toBe(false);
    expect(getStore().groups[groupId].color).toBe('#ff5722');
    expect(getStore().groups[groupId].description).toBe('Survives collapse');
  });

  it('18. ungroupNodes removes the group along with its color and description', () => {
    const { groupId, n1, n2 } = createSimpleGroup('DeleteMe');
    getStore().setGroupColor(groupId, '#607d8b');
    getStore().setGroupDescription(groupId, 'Will be deleted');

    // Verify they are set
    expect(getStore().groups[groupId].color).toBe('#607d8b');
    expect(getStore().groups[groupId].description).toBe('Will be deleted');

    // Ungroup
    getStore().ungroupNodes(groupId);

    // Group should be completely gone
    expect(getStore().groups[groupId]).toBeUndefined();
    // Nodes should still exist but without groupId
    expect(getStore().nodes[n1]).toBeDefined();
    expect(getStore().nodes[n1].groupId).toBeUndefined();
    expect(getStore().nodes[n2]).toBeDefined();
    expect(getStore().nodes[n2].groupId).toBeUndefined();
  });

  it('19. color + description both set -> undo once restores only the last change', () => {
    const { groupId } = createSimpleGroup('PartialUndo');
    getStore().setGroupColor(groupId, '#795548');
    getStore().setGroupDescription(groupId, 'After color was set');

    // Both are set
    expect(getStore().groups[groupId].color).toBe('#795548');
    expect(getStore().groups[groupId].description).toBe('After color was set');

    // Undo once should only undo the description (last action)
    getStore().undo();
    expect(getStore().groups[groupId].color).toBe('#795548'); // color unchanged
    expect(getStore().groups[groupId].description).toBeUndefined(); // description reverted

    // Undo again should undo the color
    getStore().undo();
    expect(getStore().groups[groupId].color).toBeUndefined(); // color reverted
  });

  it('20. creating a group has no color or description by default', () => {
    const { groupId } = createSimpleGroup('Fresh');
    const group = getStore().groups[groupId];
    expect(group.color).toBeUndefined();
    expect(group.description).toBeUndefined();
    expect(group.label).toBe('Fresh');
    expect(group.collapsed).toBe(false);
    expect(group.id).toBe(groupId);
  });
});

// ===========================================================================
// Phase 32: Locked Node Guards in Group Operations
// ===========================================================================
describe('Locked Node Exclusion', () => {
  it('21. createGroup excludes locked nodes from group membership', () => {
    const n1 = getStore().addNode('source', [0, 0, 0]);
    const n2 = getStore().addNode('transform', [5, 0, 0]);
    const n3 = getStore().addNode('output', [10, 0, 0]);

    // Lock n3
    useEditorStore.setState((s) => { s.nodes[n3].locked = true; });

    // Select all three
    getStore().setSelection(new Set([n1, n2, n3]));
    const groupId = getStore().createGroup('TestGroup');

    expect(groupId).toBeTruthy();
    // Only unlocked nodes should be in the group
    expect(getStore().nodes[n1].groupId).toBe(groupId);
    expect(getStore().nodes[n2].groupId).toBe(groupId);
    // Locked node should NOT be in the group
    expect(getStore().nodes[n3].groupId).toBeUndefined();
  });

  it('22. createGroup returns null when all selected nodes are locked', () => {
    const n1 = getStore().addNode('source', [0, 0, 0]);
    const n2 = getStore().addNode('transform', [5, 0, 0]);

    // Lock both nodes
    useEditorStore.setState((s) => {
      s.nodes[n1].locked = true;
      s.nodes[n2].locked = true;
    });

    getStore().setSelection(new Set([n1, n2]));
    const groupId = getStore().createGroup('AllLocked');

    // Cannot create group with only locked nodes
    expect(groupId).toBeNull();
  });

  it('23. createGroup returns null when only 1 unlocked node after filtering locked', () => {
    const n1 = getStore().addNode('source', [0, 0, 0]);
    const n2 = getStore().addNode('transform', [5, 0, 0]);

    // Lock one, leaving only 1 unlocked (need ≥2)
    useEditorStore.setState((s) => { s.nodes[n1].locked = true; });

    getStore().setSelection(new Set([n1, n2]));
    const groupId = getStore().createGroup('TooFew');

    // Need ≥2 ungrouped, unlocked nodes
    expect(groupId).toBeNull();
  });
});
