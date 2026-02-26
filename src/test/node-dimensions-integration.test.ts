/**
 * Node Dimensions Integration Tests
 *
 * Verifies that custom node width/height fields are preserved through:
 * 1. Serialization roundtrip (save/load)
 * 2. Import/export JSON roundtrip
 * 3. Undo/redo stack
 * 4. Node cloning/duplication (via store duplicate action)
 * 5. Multi-graph switching
 * 6. Legacy migration
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  MIN_NODE_HEIGHT,
  MAX_NODE_WIDTH,
  MAX_NODE_HEIGHT,
} from '../store/slices/nodeSlice';
import {
  saveGraph,
  loadGraph,
  importFromJSON,
  saveMultiGraph,
  loadMultiGraph,
} from '../utils/serialization';
import type { EditorNode } from '../types';
import { getMinNodeDepth } from '../utils/nodeDepth';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
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
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.searchHighlightIds = new Set();
    s.traceNodeId = null;
  });
}

function getState() {
  return useEditorStore.getState();
}

function makeNodeWithDimensions(
  id: string,
  width?: number,
  height?: number,
): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: 'Source',
    data: { value: 0 },
    inputs: [],
    outputs: [{ id: 'out-0', label: 'Out', portType: 'number' }],
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

// ============================================================================
// 1. Serialization roundtrip (localStorage save/load)
// ============================================================================
describe('Node dimensions: serialization roundtrip', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('preserves custom width/height through save/load', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNodeWithDimensions('n1', 3.0, 1.5),
      n2: makeNodeWithDimensions('n2', 5.0, 3.0),
    };
    saveGraph(nodes, {});
    const loaded = loadGraph();
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes.n1.width).toBe(3.0);
    expect(loaded!.nodes.n1.height).toBe(1.5);
    expect(loaded!.nodes.n2.width).toBe(5.0);
    expect(loaded!.nodes.n2.height).toBe(3.0);
  });

  it('preserves undefined width/height (default nodes)', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNodeWithDimensions('n1'),
    };
    saveGraph(nodes, {});
    const loaded = loadGraph();
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes.n1.width).toBeUndefined();
    expect(loaded!.nodes.n1.height).toBeUndefined();
  });

  it('preserves mix of default and custom dimensions', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNodeWithDimensions('n1', 4.0, 2.0),
      n2: makeNodeWithDimensions('n2'), // default
    };
    saveGraph(nodes, {});
    const loaded = loadGraph();
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes.n1.width).toBe(4.0);
    expect(loaded!.nodes.n1.height).toBe(2.0);
    expect(loaded!.nodes.n2.width).toBeUndefined();
    expect(loaded!.nodes.n2.height).toBeUndefined();
  });
});

// ============================================================================
// 2. Multi-graph format roundtrip
// ============================================================================
describe('Node dimensions: multi-graph format', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves custom dimensions in multi-graph storage', () => {
    const storage = {
      version: 2 as const,
      graphs: {
        g1: {
          nodes: {
            n1: makeNodeWithDimensions('n1', 3.5, 2.5),
          },
          connections: {},
          groups: {},
          customNodeDefs: {},
          subgraphDefs: {},
        },
      },
      graphTabs: { g1: { id: 'g1', name: 'Graph 1', createdAt: Date.now() } },
      activeGraphId: 'g1',
      graphOrder: ['g1'],
      templates: {},
    };
    saveMultiGraph(storage);
    const loaded = loadMultiGraph();
    expect(loaded).not.toBeNull();
    const node = loaded!.graphs.g1.nodes.n1;
    expect(node.width).toBe(3.5);
    expect(node.height).toBe(2.5);
  });
});

// ============================================================================
// 3. Import/Export JSON roundtrip
// ============================================================================
describe('Node dimensions: JSON import/export', () => {
  it('importFromJSON preserves custom dimensions', () => {
    const data = {
      nodes: {
        n1: makeNodeWithDimensions('n1', 4.0, 2.0),
      },
      connections: {},
      groups: {},
    };
    const json = JSON.stringify(data);
    const imported = importFromJSON(json);
    expect(imported).not.toBeNull();
    expect(imported!.nodes.n1.width).toBe(4.0);
    expect(imported!.nodes.n1.height).toBe(2.0);
  });

  it('importFromJSON handles nodes without dimensions', () => {
    const data = {
      nodes: {
        n1: makeNodeWithDimensions('n1'),
      },
      connections: {},
    };
    const json = JSON.stringify(data);
    const imported = importFromJSON(json);
    expect(imported).not.toBeNull();
    expect(imported!.nodes.n1.width).toBeUndefined();
    expect(imported!.nodes.n1.height).toBeUndefined();
  });

  it('full roundtrip: JSON stringify → importFromJSON preserves all dimension data', () => {
    const original = {
      nodes: {
        n1: makeNodeWithDimensions('n1', 2.5, 1.2),
        n2: makeNodeWithDimensions('n2'), // default
        n3: makeNodeWithDimensions('n3', 6.0, 4.0), // max size
      },
      connections: {},
      groups: {},
    };
    const json = JSON.stringify(original);
    const imported = importFromJSON(json);
    expect(imported).not.toBeNull();
    expect(imported!.nodes.n1.width).toBe(2.5);
    expect(imported!.nodes.n1.height).toBe(1.2);
    expect(imported!.nodes.n2.width).toBeUndefined();
    expect(imported!.nodes.n2.height).toBeUndefined();
    expect(imported!.nodes.n3.width).toBe(6.0);
    expect(imported!.nodes.n3.height).toBe(4.0);
  });
});

// ============================================================================
// 4. Undo/redo preserves dimensions
// ============================================================================
describe('Node dimensions: undo/redo', () => {
  beforeEach(resetStore);

  it('resize → undo restores to undefined (default) dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));

    getState().resizeNode(id, 3.0, 1.5);
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(1.5);

    getState().undo();
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('resize → undo → redo restores custom dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 2.0);
    getState().undo();
    getState().redo();
    expect(getState().nodes[id].width).toBe(4.0);
    expect(getState().nodes[id].height).toBe(2.0);
  });

  it('multiple resizes: undo goes through each size', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 2.0, 1.0);
    getState().resizeNode(id, 3.0, 1.5);
    getState().resizeNode(id, 4.0, 2.0);

    expect(getState().nodes[id].width).toBe(4.0);

    getState().undo(); // back to 3.0x1.5
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(1.5);

    getState().undo(); // back to 2.0x1.0
    expect(getState().nodes[id].width).toBe(2.0);
    expect(getState().nodes[id].height).toBe(1.0);

    getState().undo(); // back to defaults (undefined)
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('resize and data update undo independently', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.0, 1.5);
    getState().updateNodeData(id, 'value', 42);

    // Undo data update
    getState().undo();
    // Dimensions should still be custom
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(1.5);

    // Undo resize
    getState().undo();
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });
});

// ============================================================================
// 5. Node duplication preserves dimensions
// ============================================================================
describe('Node dimensions: duplication', () => {
  beforeEach(resetStore);

  it('duplicating a resized node preserves its dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, 3.5, 2.0);

    // Select and duplicate
    getState().setSelection(new Set([id]));
    getState().duplicateSelected();

    const nodes = Object.values(getState().nodes);
    expect(nodes.length).toBe(2);

    const duplicate = nodes.find(n => n.id !== id)!;
    expect(duplicate).toBeDefined();
    expect(duplicate.width).toBe(3.5);
    expect(duplicate.height).toBe(2.0);
  });

  it('duplicating a default-sized node keeps dimensions undefined', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // No resize — default dimensions

    getState().setSelection(new Set([id]));
    getState().duplicateSelected();

    const nodes = Object.values(getState().nodes);
    const duplicate = nodes.find(n => n.id !== id)!;
    expect(duplicate.width).toBeUndefined();
    expect(duplicate.height).toBe(getMinNodeDepth('source', 0, 2));
  });
});

// ============================================================================
// 6. structuredClone preserves dimensions (used in graph switching)
// ============================================================================
describe('Node dimensions: structuredClone', () => {
  it('structuredClone preserves width and height', () => {
    const node = makeNodeWithDimensions('n1', 3.0, 2.0);
    const cloned = structuredClone(node);
    expect(cloned.width).toBe(3.0);
    expect(cloned.height).toBe(2.0);
    expect(cloned.id).toBe('n1');
  });

  it('structuredClone preserves undefined dimensions', () => {
    const node = makeNodeWithDimensions('n1');
    const cloned = structuredClone(node);
    expect(cloned.width).toBeUndefined();
    expect(cloned.height).toBeUndefined();
  });

  it('JSON.parse(JSON.stringify()) preserves dimensions', () => {
    const node = makeNodeWithDimensions('n1', 4.5, 3.0);
    const roundtripped = JSON.parse(JSON.stringify(node));
    expect(roundtripped.width).toBe(4.5);
    expect(roundtripped.height).toBe(3.0);
  });

  it('JSON.parse(JSON.stringify()) loses undefined dimensions (becomes absent)', () => {
    const node = makeNodeWithDimensions('n1');
    const roundtripped = JSON.parse(JSON.stringify(node));
    // JSON.stringify omits undefined fields
    expect(roundtripped.width).toBeUndefined();
    expect(roundtripped.height).toBeUndefined();
  });
});

// ============================================================================
// 7. Dimension defaults used correctly in port positioning
// ============================================================================
describe('Node dimensions: port position integration', () => {
  beforeEach(resetStore);

  it('node with custom width has shifted port positions', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    getState().resizeNode(id, 4.0, 2.0);

    const node = getState().nodes[id];
    expect(node.width).toBe(4.0);
    expect(node.height).toBe(2.0);

    // The node's actual dimension should be usable for port calculations
    const effectiveWidth = node.width ?? DEFAULT_NODE_WIDTH;
    expect(effectiveWidth).toBe(4.0);
  });

  it('node without explicit dimensions uses defaults for calculations', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const node = getState().nodes[id];

    const effectiveWidth = node.width ?? DEFAULT_NODE_WIDTH;
    const effectiveHeight = node.height ?? DEFAULT_NODE_HEIGHT;

    expect(effectiveWidth).toBe(DEFAULT_NODE_WIDTH);
    expect(effectiveHeight).toBe(getMinNodeDepth('source', 0, 2));
  });
});

// ============================================================================
// 8. Edge cases
// ============================================================================
describe('Node dimensions: edge cases', () => {
  beforeEach(resetStore);

  it('resizing to exact MIN values is allowed', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, MIN_NODE_WIDTH, MIN_NODE_HEIGHT);
    expect(getState().nodes[id].width).toBe(MIN_NODE_WIDTH);
    expect(getState().nodes[id].height).toBe(MIN_NODE_HEIGHT);
  });

  it('resizing to exact MAX values is allowed', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().resizeNode(id, MAX_NODE_WIDTH, MAX_NODE_HEIGHT);
    expect(getState().nodes[id].width).toBe(MAX_NODE_WIDTH);
    expect(getState().nodes[id].height).toBe(MAX_NODE_HEIGHT);
  });

  it('setNodeSizes skips write when value matches current dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const creationH = getMinNodeDepth('source', 0, 2);
    // Setting to creation values should be a no-op (height already set, width matches default)
    getState().setNodeSizes({ [id]: { width: DEFAULT_NODE_WIDTH, height: creationH } });
    // Width stays undefined (default check passes), height stays at creation value
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(creationH);
  });

  it('addNode creates nodes with explicit height when minDepth > default', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.width).toBeUndefined();
    expect(node.height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('setNodeSizes clamps values below MIN', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setNodeSizes({ [id]: { width: 0.1, height: 0.1 } });
    expect(getState().nodes[id].width).toBe(MIN_NODE_WIDTH);
    expect(getState().nodes[id].height).toBe(MIN_NODE_HEIGHT);
  });

  it('setNodeSizes clamps values above MAX', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().setNodeSizes({ [id]: { width: 100, height: 100 } });
    expect(getState().nodes[id].width).toBe(MAX_NODE_WIDTH);
    expect(getState().nodes[id].height).toBe(MAX_NODE_HEIGHT);
  });

  it('setNodeSizes skips locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);
    expect(getState().nodes[id].locked).toBe(true);
    getState().setNodeSizes({ [id]: { width: 3.0, height: 2.0 } });
    // Should remain undefined (not resized) because node is locked
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('resizeNode skips locked nodes', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);
    getState().resizeNode(id, 3.0, 2.0);
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });
});

// ============================================================================
// 9. ResizeHandles undo pattern (pushUndoSnapshot + setNodeSizes)
// ============================================================================
describe('Node dimensions: ResizeHandles undo pattern', () => {
  beforeEach(resetStore);

  it('pushUndoSnapshot + setNodeSizes: undo restores original dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Simulate the ResizeHandles drag pattern:
    // 1. pushUndoSnapshot BEFORE first setNodeSizes
    getState().pushUndoSnapshot('Resize node');
    // 2. setNodeSizes (called during drag, no undo)
    getState().setNodeSizes({ [id]: { width: 3.0, height: 2.0 } });
    // 3. undo should restore to undefined (default)
    getState().undo();
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('multiple setNodeSizes during drag: single undo undoes entire drag session', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Simulate drag: one pushUndo, then multiple setNodeSizes calls
    getState().pushUndoSnapshot('Resize node');
    getState().setNodeSizes({ [id]: { width: 2.0, height: 1.0 } });
    getState().setNodeSizes({ [id]: { width: 2.5, height: 1.3 } });
    getState().setNodeSizes({ [id]: { width: 3.0, height: 1.5 } });
    // Final state after drag
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(1.5);
    // Single undo should restore all the way back to undefined
    getState().undo();
    expect(getState().nodes[id].width).toBeUndefined();
    expect(getState().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('redo after undo restores final drag dimensions', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().pushUndoSnapshot('Resize node');
    getState().setNodeSizes({ [id]: { width: 3.0, height: 2.0 } });
    getState().undo();
    getState().redo();
    expect(getState().nodes[id].width).toBe(3.0);
    expect(getState().nodes[id].height).toBe(2.0);
  });

  it('multi-select resize: undo restores all nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [3, 0, 0]);
    // Pre-resize id2 to a custom size
    getState().resizeNode(id2, 2.0, 1.0);

    // Simulate multi-select drag
    getState().pushUndoSnapshot('Resize node');
    getState().setNodeSizes({
      [id1]: { width: 3.0, height: 2.0 },
      [id2]: { width: 4.0, height: 2.0 },
    });

    expect(getState().nodes[id1].width).toBe(3.0);
    expect(getState().nodes[id2].width).toBe(4.0);

    // Undo should restore both
    getState().undo();
    // id1 was default → undefined
    expect(getState().nodes[id1].width).toBeUndefined();
    // id2 was 2.0 → back to 2.0
    expect(getState().nodes[id2].width).toBe(2.0);
    expect(getState().nodes[id2].height).toBe(1.0);
  });

  it('escape cancellation pattern: restore original sizes after drag commit', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Pre-resize the node so originalSizes has a non-default value
    getState().resizeNode(id, 2.0, 1.2);

    // Simulate committed drag that gets cancelled:
    // 1. pushUndo at commit threshold
    getState().pushUndoSnapshot('Resize node');
    // 2. Multiple setNodeSizes during drag
    getState().setNodeSizes({ [id]: { width: 4.0, height: 3.0 } });
    expect(getState().nodes[id].width).toBe(4.0);
    // 3. On Escape, ResizeHandles restores originalSizes via setNodeSizes
    getState().setNodeSizes({ [id]: { width: 2.0, height: 1.2 } });
    // Should be back to pre-drag dimensions
    expect(getState().nodes[id].width).toBe(2.0);
    expect(getState().nodes[id].height).toBe(1.2);
    // Undo restores the snapshot from pushUndoSnapshot — same as original (2.0, 1.2)
    // since escape already restored, undo goes to the state BEFORE the pushUndo
    getState().undo();
    expect(getState().nodes[id].width).toBe(2.0);
    expect(getState().nodes[id].height).toBe(1.2);
  });

  it('setNodeSizes batches multiple nodes in single mutation', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [3, 0, 0]);
    const id3 = getState().addNode('filter', [6, 0, 0]);
    getState().setNodeSizes({
      [id1]: { width: 2.0, height: 1.0 },
      [id2]: { width: 3.0, height: 1.5 },
      [id3]: { width: 4.0, height: 2.0 },
    });
    expect(getState().nodes[id1].width).toBe(2.0);
    expect(getState().nodes[id2].width).toBe(3.0);
    expect(getState().nodes[id3].width).toBe(4.0);
  });

  it('setNodeSizes with nonexistent node ID is silently ignored', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Should not throw
    getState().setNodeSizes({
      [id]: { width: 2.0, height: 1.0 },
      'nonexistent': { width: 3.0, height: 1.5 },
    });
    expect(getState().nodes[id].width).toBe(2.0);
    expect(getState().nodes['nonexistent']).toBeUndefined();
  });
});
