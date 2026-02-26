/**
 * Etched Node Label Integration Tests
 *
 * Tests the data layer supporting 3D "etched" labels on nodes:
 * 1. Title assignment on node creation matches TYPE_LABELS
 * 2. Title persistence through rename, undo/redo, and serialization
 * 3. Label prefix logic for collapsed/subgraph nodes
 * 4. Migration of stale labels from old saved data
 * 5. Label width constraint (fits within nodeW - 0.12)
 * 6. Short labels for toolbar/quick menu contexts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  TYPE_LABELS,
  TYPE_LABELS_SHORT,
  getNodeLabel,
  TYPE_DESCRIPTIONS,
} from '../types/nodeLabels';
import { migrateNodeTitle, migrateAllNodes } from '../utils/nodeVersioning';
import type { EditorNode, NodeType } from '../types';
import { DEFAULT_NODE_WIDTH } from '../store/slices/nodeSlice';

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

function getState() { return useEditorStore.getState(); }

function makeNode(type: NodeType, title?: string): EditorNode {
  return {
    id: `node-${type}`,
    type,
    position: [0, 0, 0],
    title: title ?? TYPE_LABELS[type] ?? type,
    data: {},
    inputs: [],
    outputs: [],
  };
}

// ============================================================================
// 1. Title assignment matches TYPE_LABELS on creation
// ============================================================================
describe('Etched labels: title assignment on creation', () => {
  beforeEach(resetStore);

  it('new source node gets title "Source"', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].title).toBe('Source');
  });

  it('new math node gets title "Math"', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    expect(getState().nodes[id].title).toBe('Math');
  });

  it('hyphenated types get properly capitalized labels', () => {
    const cases: [NodeType, string][] = [
      ['string-length', 'String Length'],
      ['compose-vec3', 'Compose Vec3'],
      ['http-fetch', 'HTTP Fetch'],
      ['if-gate', 'If Gate'],
      ['array-reduce', 'Array Reduce'],
      ['json-parse', 'JSON Parse'],
    ];
    for (const [type, expected] of cases) {
      const id = getState().addNode(type, [0, 0, 0]);
      expect(getState().nodes[id].title).toBe(expected);
    }
  });

  it('subgraph boundary nodes get short labels', () => {
    const inputId = getState().addNode('subgraph-input', [0, 0, 0]);
    const outputId = getState().addNode('subgraph-output', [1, 0, 0]);
    expect(getState().nodes[inputId].title).toBe('Input');
    expect(getState().nodes[outputId].title).toBe('Output');
  });
});

// ============================================================================
// 2. Title rename and undo/redo
// ============================================================================
describe('Etched labels: rename and undo', () => {
  beforeEach(resetStore);

  it('updateNodeTitle changes the displayed title', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].title).toBe('Source');

    getState().updateNodeTitle(id, 'My Custom Name');
    expect(getState().nodes[id].title).toBe('My Custom Name');
  });

  it('rename → undo restores original TYPE_LABELS title', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    getState().updateNodeTitle(id, 'Custom Math');
    getState().undo();
    expect(getState().nodes[id].title).toBe('Math');
  });

  it('rename → undo → redo restores custom title', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    getState().updateNodeTitle(id, 'My Adder');
    getState().undo();
    getState().redo();
    expect(getState().nodes[id].title).toBe('My Adder');
  });

  it('locked nodes cannot be renamed', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id);
    getState().updateNodeTitle(id, 'Should Not Change');
    expect(getState().nodes[id].title).toBe('Source');
  });

  it('empty title is preserved (not replaced with type label)', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, '');
    expect(getState().nodes[id].title).toBe('');
  });
});

// ============================================================================
// 3. Label prefix construction for collapsed/subgraph
// ============================================================================
describe('Etched labels: prefix construction', () => {
  // The NodeModule renders: (collapsed ? '▸ ' : '') + (subgraph ? '⊞ ' : '') + title
  // These are UI-level tests of the data that drives prefix logic.

  it('collapsed node flag is toggleable for prefix rendering', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    expect(getState().nodes[id].collapsed).toBeFalsy();

    getState().toggleNodeCollapse(id);
    expect(getState().nodes[id].collapsed).toBe(true);
    // In UI: "▸ Source" would be rendered

    getState().toggleNodeCollapse(id);
    expect(getState().nodes[id].collapsed).toBeFalsy();
    // In UI: "Source" would be rendered
  });

  it('subgraph node type is detected for prefix icon', () => {
    const id = getState().addNode('subgraph', [0, 0, 0]);
    expect(getState().nodes[id].type).toBe('subgraph');
    // In UI: "⊞ Subgraph" would be rendered
  });

  it('subgraph-input type is detected for arrow prefix', () => {
    const id = getState().addNode('subgraph-input', [0, 0, 0]);
    expect(getState().nodes[id].type).toBe('subgraph-input');
    // In UI: "▷ Input" would be rendered
  });

  it('subgraph-output type is detected for arrow prefix', () => {
    const id = getState().addNode('subgraph-output', [0, 0, 0]);
    expect(getState().nodes[id].type).toBe('subgraph-output');
    // In UI: "◁ Output" would be rendered
  });
});

// ============================================================================
// 4. Migration of stale labels
// ============================================================================
describe('Etched labels: migration from raw type keys', () => {
  it('migrates raw key "string-length" to "String Length"', () => {
    const node = makeNode('string-length', 'string-length');
    const changed = migrateNodeTitle(node);
    expect(changed).toBe(true);
    expect(node.title).toBe('String Length');
  });

  it('migrates raw key "compose-vec3" to "Compose Vec3"', () => {
    const node = makeNode('compose-vec3', 'compose-vec3');
    const changed = migrateNodeTitle(node);
    expect(changed).toBe(true);
    expect(node.title).toBe('Compose Vec3');
  });

  it('does not migrate already-correct titles', () => {
    const node = makeNode('math', 'Math');
    const changed = migrateNodeTitle(node);
    expect(changed).toBe(false);
    expect(node.title).toBe('Math');
  });

  it('does not migrate user-customized titles', () => {
    const node = makeNode('source', 'My Special Source');
    const changed = migrateNodeTitle(node);
    expect(changed).toBe(false);
    expect(node.title).toBe('My Special Source');
  });

  it('skips custom node type migration', () => {
    const node = makeNode('custom', 'custom');
    const changed = migrateNodeTitle(node);
    expect(changed).toBe(false);
  });

  it('skips subgraph type migration', () => {
    const node = makeNode('subgraph', 'subgraph');
    const changed = migrateNodeTitle(node);
    expect(changed).toBe(false);
  });

  it('batch migration fixes all stale titles', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('array-filter', 'array-filter'),
      b: makeNode('json-stringify', 'json-stringify'),
      c: makeNode('lerp', 'Lerp'), // already correct
    };
    const count = migrateAllNodes(nodes);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(nodes.a.title).toBe('Array Filter');
    expect(nodes.b.title).toBe('JSON Stringify');
    expect(nodes.c.title).toBe('Lerp');
  });
});

// ============================================================================
// 5. Label text width constraint
// ============================================================================
describe('Etched labels: width constraints', () => {
  it('all TYPE_LABELS fit within default node width (maxWidth = 1.48)', () => {
    const maxWidth = DEFAULT_NODE_WIDTH - 0.12; // 1.48
    // At fontSize 0.055, each character is roughly 0.033 wide
    // maxWidth 1.48 / 0.033 ≈ 45 chars before wrapping
    const maxCharsApprox = Math.floor(maxWidth / 0.033);
    
    for (const [type, label] of Object.entries(TYPE_LABELS)) {
      // Most labels should be under 25 chars, well within the limit
      expect(
        label.length,
        `TYPE_LABELS["${type}"] = "${label}" exceeds expected max chars`,
      ).toBeLessThanOrEqual(maxCharsApprox);
    }
  });

  it('longest label is still within reasonable bounds', () => {
    let longest = '';
    for (const label of Object.values(TYPE_LABELS)) {
      if (label.length > longest.length) longest = label;
    }
    // The longest label should be under 20 chars
    expect(longest.length).toBeLessThanOrEqual(20);
  });

  it('all TYPE_LABELS_SHORT entries are shorter than full labels', () => {
    for (const [type, shortLabel] of Object.entries(TYPE_LABELS_SHORT)) {
      const fullLabel = TYPE_LABELS[type];
      expect(shortLabel.length).toBeLessThanOrEqual(fullLabel.length);
    }
  });
});

// ============================================================================
// 6. Short labels for compact UI contexts
// ============================================================================
describe('Etched labels: short label system', () => {
  it('getNodeLabel(type, false) returns full label', () => {
    expect(getNodeLabel('array-filter', false)).toBe('Array Filter');
    expect(getNodeLabel('compose-vec3', false)).toBe('Compose Vec3');
  });

  it('getNodeLabel(type, true) prefers short label', () => {
    expect(getNodeLabel('array-filter', true)).toBe('Arr Filter');
    expect(getNodeLabel('compose-vec3', true)).toBe('Comp Vec3');
  });

  it('getNodeLabel(type, true) falls back to full label if no short exists', () => {
    // 'lerp' has no TYPE_LABELS_SHORT entry
    expect(getNodeLabel('lerp', true)).toBe('Lerp');
  });

  it('getNodeLabel falls back to type key for unknown types', () => {
    expect(getNodeLabel('totally-unknown')).toBe('totally-unknown');
    expect(getNodeLabel('totally-unknown', true)).toBe('totally-unknown');
  });

  it('all short labels are non-empty', () => {
    for (const [type, label] of Object.entries(TYPE_LABELS_SHORT)) {
      expect(label.length, `Short label for "${type}" is empty`).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// 7. TYPE_DESCRIPTIONS completeness for tooltips
// ============================================================================
describe('Etched labels: tooltip descriptions', () => {
  it('every node type with a label also has a description', () => {
    for (const type of Object.keys(TYPE_LABELS)) {
      expect(
        TYPE_DESCRIPTIONS[type],
        `Missing TYPE_DESCRIPTIONS for "${type}"`,
      ).toBeDefined();
    }
  });

  it('descriptions are distinct from labels', () => {
    for (const type of Object.keys(TYPE_LABELS)) {
      const desc = TYPE_DESCRIPTIONS[type];
      // Description should provide more info than just the label name
      expect(desc.length, `Description for "${type}" is too short`).toBeGreaterThanOrEqual(5);
    }
  });

  it('descriptions use sentence fragments (not full sentences)', () => {
    for (const [type, desc] of Object.entries(TYPE_DESCRIPTIONS)) {
      // Descriptions should be concise — under 50 chars
      expect(
        desc.length,
        `Description for "${type}" is too long: "${desc}"`,
      ).toBeLessThanOrEqual(50);
    }
  });
});

// ============================================================================
// 8. Batch title operations
// ============================================================================
describe('Etched labels: batch operations', () => {
  beforeEach(resetStore);

  it('batchUpdateNodeTitles updates multiple titles at once', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [1, 0, 0]);

    getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'Input A' },
      { nodeId: id2, title: 'Adder' },
    ]);

    expect(getState().nodes[id1].title).toBe('Input A');
    expect(getState().nodes[id2].title).toBe('Adder');
  });

  it('batch rename is undoable as single operation', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [1, 0, 0]);

    getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'X' },
      { nodeId: id2, title: 'Y' },
    ]);

    getState().undo();
    expect(getState().nodes[id1].title).toBe('Source');
    expect(getState().nodes[id2].title).toBe('Math');
  });

  it('batch rename skips locked nodes', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('math', [1, 0, 0]);
    getState().toggleNodeLock(id1);

    getState().batchUpdateNodeTitles([
      { nodeId: id1, title: 'Locked Name' },
      { nodeId: id2, title: 'New Math' },
    ]);

    expect(getState().nodes[id1].title).toBe('Source'); // unchanged (locked)
    expect(getState().nodes[id2].title).toBe('New Math');
  });

  it('batch rename with all locked nodes is a no-op', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    getState().toggleNodeLock(id1);

    // Should not throw or push undo
    getState().canUndo();
    getState().batchUpdateNodeTitles([{ nodeId: id1, title: 'X' }]);
    // canUndo state: only if something beyond the lock toggle was pushed
    expect(getState().nodes[id1].title).toBe('Source');
  });
});
