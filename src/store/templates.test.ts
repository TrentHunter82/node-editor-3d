import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    templates: {},
  });
}

// ===========================================================================
// saveSelectionAsTemplate
// ===========================================================================
describe('saveSelectionAsTemplate', () => {
  beforeEach(() => { resetStore(); });

  it('captures selected nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([src, xfm]));

    const tmplId = getState().saveSelectionAsTemplate('Two Nodes', 'Test');
    expect(tmplId).not.toBeNull();

    const tmpl = getState().templates[tmplId!];
    expect(tmpl).toBeDefined();
    expect(tmpl.name).toBe('Two Nodes');
    expect(tmpl.category).toBe('Test');
    expect(tmpl.nodes).toHaveLength(2);
  });

  it('captures internal connections between selected nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().setSelection(new Set([src, xfm]));

    const tmplId = getState().saveSelectionAsTemplate('Connected', 'Test');
    const tmpl = getState().templates[tmplId!];
    expect(tmpl.connections).toHaveLength(1);
    expect(tmpl.connections[0].sourceNodeId).toBe(src);
    expect(tmpl.connections[0].targetNodeId).toBe(xfm);
  });

  it('excludes external connections (only one end selected)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().addConnection(xfm, 0, out, 0);

    // Only select src + xfm, not out
    getState().setSelection(new Set([src, xfm]));
    const tmplId = getState().saveSelectionAsTemplate('Partial', 'Test');
    const tmpl = getState().templates[tmplId!];

    // Should only have the internal connection (src → xfm), not xfm → out
    expect(tmpl.connections).toHaveLength(1);
    expect(tmpl.connections[0].sourceNodeId).toBe(src);
    expect(tmpl.connections[0].targetNodeId).toBe(xfm);
  });

  it('returns null when selection is empty', () => {
    getState().setSelection(new Set());
    const tmplId = getState().saveSelectionAsTemplate('Empty', 'Test');
    expect(tmplId).toBeNull();
    expect(Object.keys(getState().templates)).toHaveLength(0);
  });

  it('returns null when selection only contains non-existent IDs', () => {
    getState().setSelection(new Set(['fake-1', 'fake-2']));
    const tmplId = getState().saveSelectionAsTemplate('Ghost', 'Test');
    expect(tmplId).toBeNull();
  });

  it('defaults category to "User" when not provided', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('No Category');
    const tmpl = getState().templates[tmplId!];
    expect(tmpl.category).toBe('User');
  });

  it('deep-copies node data (mutation-safe)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 42);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Copy Test', 'Test');

    // Mutate the original node after template creation
    getState().updateNodeData(src, 'value', 999);

    // Template should still have the original value
    const tmpl = getState().templates[tmplId!];
    expect(tmpl.nodes[0].data.value).toBe(42);
  });

  it('stores createdAt timestamp', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const before = Date.now();
    const tmplId = getState().saveSelectionAsTemplate('Timestamp', 'Test');
    const after = Date.now();

    const tmpl = getState().templates[tmplId!];
    expect(tmpl.createdAt).toBeGreaterThanOrEqual(before);
    expect(tmpl.createdAt).toBeLessThanOrEqual(after);
  });
});

// ===========================================================================
// instantiateTemplate
// ===========================================================================
describe('instantiateTemplate', () => {
  beforeEach(() => { resetStore(); });

  it('creates nodes with new unique IDs', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([src, xfm]));
    const tmplId = getState().saveSelectionAsTemplate('Pair', 'Test');

    // Clear graph
    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();

    // Instantiate
    getState().instantiateTemplate(tmplId!, [0, 0, 0]);
    const nodeIds = Object.keys(getState().nodes);
    expect(nodeIds).toHaveLength(2);

    // New IDs should differ from originals
    expect(nodeIds).not.toContain(src);
    expect(nodeIds).not.toContain(xfm);
  });

  it('preserves internal connections with remapped IDs', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);
    getState().setSelection(new Set([src, xfm]));
    const tmplId = getState().saveSelectionAsTemplate('Connected Pair', 'Test');

    // Clear and instantiate
    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();
    getState().instantiateTemplate(tmplId!, [0, 0, 0]);

    const connections = Object.values(getState().connections);
    expect(connections).toHaveLength(1);

    // Both source and target should be in the new node set
    const nodeIds = new Set(Object.keys(getState().nodes));
    expect(nodeIds.has(connections[0].sourceNodeId)).toBe(true);
    expect(nodeIds.has(connections[0].targetNodeId)).toBe(true);

    // Connection should not reference original IDs
    expect(connections[0].sourceNodeId).not.toBe(src);
    expect(connections[0].targetNodeId).not.toBe(xfm);
  });

  it('positions nodes offset correctly at target position', () => {
    // Two nodes: one at [0,0,0], one at [4,0,0]  → center = [2,0,0]
    const n1 = getState().addNode('source', [0, 0, 0]);
    const n2 = getState().addNode('transform', [4, 0, 0]);
    getState().setSelection(new Set([n1, n2]));
    const tmplId = getState().saveSelectionAsTemplate('Positioned', 'Test');

    // Clear and instantiate at [10, 0, 10]
    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();
    getState().instantiateTemplate(tmplId!, [10, 0, 10]);

    const nodes = Object.values(getState().nodes);
    expect(nodes).toHaveLength(2);

    // Original center was [2, 0, 0], target is [10, 0, 10]
    // Offset X = 10 - 2 = 8, offset Z = 10 - 0 = 10
    // Node positions: [0+8, 0, 0+10] = [8, 0, 10] and [4+8, 0, 0+10] = [12, 0, 10]
    const positions = nodes.map(n => n.position).sort((a, b) => a[0] - b[0]);
    expect(positions[0][0]).toBeCloseTo(8, 5);
    expect(positions[0][2]).toBeCloseTo(10, 5);
    expect(positions[1][0]).toBeCloseTo(12, 5);
    expect(positions[1][2]).toBeCloseTo(10, 5);
  });

  it('selects newly instantiated nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Single', 'Test');

    getState().setSelection(new Set());
    getState().instantiateTemplate(tmplId!, [5, 0, 5]);

    // The instantiated nodes should be selected
    expect(getState().selectedIds.size).toBe(1);
    // And should not include the original
    expect(getState().selectedIds.has(src)).toBe(false);
  });

  it('no-ops for non-existent template', () => {
    const nodesBefore = Object.keys(getState().nodes).length;
    getState().instantiateTemplate('non-existent', [0, 0, 0]);
    expect(Object.keys(getState().nodes).length).toBe(nodesBefore);
  });

  it('preserves node data values', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(src, 'value', 123);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Data', 'Test');

    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();
    getState().instantiateTemplate(tmplId!, [0, 0, 0]);

    const node = Object.values(getState().nodes)[0];
    expect(node.data.value).toBe(123);
    expect(node.type).toBe('source');
  });

  it('can be undone', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Undoable', 'Test');

    const nodeCountBefore = Object.keys(getState().nodes).length;
    getState().instantiateTemplate(tmplId!, [5, 0, 5]);
    expect(Object.keys(getState().nodes).length).toBe(nodeCountBefore + 1);

    getState().undo();
    expect(Object.keys(getState().nodes).length).toBe(nodeCountBefore);
  });

  it('instantiates multiple times independently', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('Multi', 'Test');

    getState().instantiateTemplate(tmplId!, [5, 0, 0]);
    getState().instantiateTemplate(tmplId!, [10, 0, 0]);

    // Original + 2 instances
    expect(Object.keys(getState().nodes)).toHaveLength(3);

    // All IDs should be unique
    const ids = Object.keys(getState().nodes);
    expect(new Set(ids).size).toBe(3);
  });
});

// ===========================================================================
// deleteTemplate
// ===========================================================================
describe('deleteTemplate', () => {
  beforeEach(() => { resetStore(); });

  it('removes template from store', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    const tmplId = getState().saveSelectionAsTemplate('ToDelete', 'Test');
    expect(getState().templates[tmplId!]).toBeDefined();

    getState().deleteTemplate(tmplId!);
    expect(getState().templates[tmplId!]).toBeUndefined();
    expect(Object.keys(getState().templates)).toHaveLength(0);
  });

  it('no-ops for non-existent template', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('Keep', 'Test');

    const countBefore = Object.keys(getState().templates).length;
    getState().deleteTemplate('non-existent');
    expect(Object.keys(getState().templates).length).toBe(countBefore);
  });
});

// ===========================================================================
// importTemplates / exportTemplates roundtrip
// ===========================================================================
describe('importTemplates / exportTemplates', () => {
  beforeEach(() => { resetStore(); });

  it('exports and imports templates roundtrip', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    getState().addConnection(src, 0, xfm, 0);

    getState().setSelection(new Set([src, xfm]));
    getState().saveSelectionAsTemplate('Exported', 'Test');

    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('Another', 'Other');

    const exported = getState().exportTemplates();
    expect(Object.keys(exported)).toHaveLength(2);

    // Clear templates
    for (const id of Object.keys(getState().templates)) {
      getState().deleteTemplate(id);
    }
    expect(Object.keys(getState().templates)).toHaveLength(0);

    // Re-import
    getState().importTemplates(exported);
    expect(Object.keys(getState().templates)).toHaveLength(2);

    // Verify data preserved
    const templates = Object.values(getState().templates);
    const names = templates.map(t => t.name).sort();
    expect(names).toEqual(['Another', 'Exported']);
  });

  it('exportTemplates returns deep copy', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('Mutable?', 'Test');

    const exported = getState().exportTemplates();
    // Mutate exported
    const firstKey = Object.keys(exported)[0];
    exported[firstKey].name = 'MUTATED';

    // Original should not be affected
    const original = getState().templates[firstKey];
    expect(original.name).toBe('Mutable?');
  });

  it('importTemplates merges with existing templates', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().setSelection(new Set([src]));
    getState().saveSelectionAsTemplate('Existing', 'Test');
    expect(Object.keys(getState().templates)).toHaveLength(1);

    // Import additional template
    getState().importTemplates({
      'imported-1': {
        id: 'imported-1',
        name: 'Imported',
        category: 'External',
        nodes: [],
        connections: [],
        createdAt: Date.now(),
      },
    });

    expect(Object.keys(getState().templates)).toHaveLength(2);
  });
});

// ===========================================================================
// Template with custom nodes
// ===========================================================================
describe('Template with custom nodes', () => {
  beforeEach(() => { resetStore(); });

  it('preserves custom node expression and port config', () => {
    // Create a custom node def
    const defId = getState().addCustomNodeDef({
      name: 'Double It',
      color: '#FF6B35',
      category: 'Custom',
      expression: 'inputs[0] * 2',
      inputs: [{ label: 'in', portType: 'number' }],
      outputs: [{ label: 'out', portType: 'number' }],
    });

    // Add a custom node
    const customId = getState().addCustomNode(defId, [0, 0, 0]);
    expect(customId).not.toBeNull();

    // Select and save as template
    getState().setSelection(new Set([customId!]));
    const tmplId = getState().saveSelectionAsTemplate('Custom Template', 'Custom');

    const tmpl = getState().templates[tmplId!];
    expect(tmpl.nodes).toHaveLength(1);
    expect(tmpl.nodes[0].type).toBe('custom');
    expect(tmpl.nodes[0].data.customDefId).toBe(defId);
    expect(tmpl.nodes[0].data.expression).toBe('inputs[0] * 2');
  });

  it('instantiate custom node template preserves data', () => {
    const defId = getState().addCustomNodeDef({
      name: 'Add Ten',
      color: '#FF6B35',
      category: 'Custom',
      expression: 'inputs[0] + 10',
      inputs: [{ label: 'x', portType: 'number' }],
      outputs: [{ label: 'result', portType: 'number' }],
    });

    const customId = getState().addCustomNode(defId, [0, 0, 0]);
    getState().setSelection(new Set([customId!]));
    const tmplId = getState().saveSelectionAsTemplate('Custom Inst', 'Custom');

    // Clear original and instantiate
    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();
    getState().instantiateTemplate(tmplId!, [5, 0, 5]);

    const nodes = Object.values(getState().nodes);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('custom');
    expect(nodes[0].data.expression).toBe('inputs[0] + 10');
    expect(nodes[0].data.customDefId).toBe(defId);
    // New ID
    expect(nodes[0].id).not.toBe(customId);
  });
});

// ===========================================================================
// Template with connected chain (complex scenario)
// ===========================================================================
describe('Template with connected chain', () => {
  beforeEach(() => { resetStore(); });

  it('preserves multi-node chain with correct port indices', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const math = getState().addNode('math', [3, 0, 0]);
    const out = getState().addNode('output', [6, 0, 0]);

    // source:0 → math:0, math:0 → output:0
    getState().addConnection(src, 0, math, 0);
    getState().addConnection(math, 0, out, 0);

    getState().setSelection(new Set([src, math, out]));
    const tmplId = getState().saveSelectionAsTemplate('Chain', 'Test');
    const tmpl = getState().templates[tmplId!];

    expect(tmpl.nodes).toHaveLength(3);
    expect(tmpl.connections).toHaveLength(2);

    // Verify port indices are preserved
    const srcConn = tmpl.connections.find(c => c.sourceNodeId === src)!;
    expect(srcConn.sourcePortIndex).toBe(0);
    expect(srcConn.targetPortIndex).toBe(0);
  });

  it('instantiate chain creates 2 connections', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const math = getState().addNode('math', [3, 0, 0]);
    const out = getState().addNode('output', [6, 0, 0]);
    getState().addConnection(src, 0, math, 0);
    getState().addConnection(math, 0, out, 0);

    getState().setSelection(new Set([src, math, out]));
    const tmplId = getState().saveSelectionAsTemplate('Full Chain', 'Test');

    // Clear
    getState().setSelection(new Set(Object.keys(getState().nodes)));
    getState().deleteSelected();

    getState().instantiateTemplate(tmplId!, [0, 0, 0]);
    expect(Object.keys(getState().nodes)).toHaveLength(3);
    expect(Object.keys(getState().connections)).toHaveLength(2);
  });
});
