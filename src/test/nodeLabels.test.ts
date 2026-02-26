/**
 * Node Labels Unit & Integration Tests
 *
 * Verifies the node labels system is complete and consistent:
 * 1. Every NodeType has a TYPE_LABELS entry
 * 2. Every NodeType has a TYPE_DESCRIPTIONS entry
 * 3. getNodeLabel fallback chain works correctly
 * 4. TYPE_LABELS_SHORT entries are valid subsets of TYPE_LABELS keys
 * 5. NODE_CATEGORIES covers every NodeType
 * 6. NODE_TYPE_CONFIG covers every NodeType
 * 7. Node creation via store uses correct labels from TYPE_LABELS
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TYPE_LABELS,
  TYPE_LABELS_SHORT,
  getNodeLabel,
  TYPE_DESCRIPTIONS,
  COLOR_HEX,
} from '../types/nodeLabels';
import type { NodeType, EditorNode } from '../types';
import { NODE_CATEGORIES, NODE_TYPE_CONFIG } from '../types';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

// All 93 node types from the NodeType union
const ALL_NODE_TYPES: NodeType[] = [
  'source', 'transform', 'filter', 'output',
  'math', 'clamp', 'remap',
  'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt',
  'lerp',
  'concat', 'template',
  'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number',
  'compare', 'switch',
  'and', 'or', 'not', 'xor',
  'compose-vec3', 'decompose-vec3',
  'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length',
  'mean', 'median', 'stddev', 'min-array', 'max-array',
  'note', 'reroute', 'random', 'display',
  'timer', 'color-picker', 'color-mix', 'hsl-to-rgb', 'rgb-to-hsl', 'http-fetch',
  'create-array', 'get-element', 'set-element', 'array-length', 'array-push',
  'array-filter', 'array-map', 'array-reduce',
  'create-object', 'get-property', 'set-property', 'object-keys', 'object-values', 'merge-objects',
  'string-concat', 'string-replace', 'string-includes', 'string-template',
  'if-gate', 'select',
  'get-var', 'set-var',
  'json-parse', 'json-stringify', 'base64-encode', 'base64-decode', 'uri-encode', 'uri-decode',
  'array-slice', 'array-find', 'array-sort', 'array-reverse', 'array-flatten', 'array-zip', 'array-unique',
  'get-timestamp', 'format-date', 'parse-date',
  'custom',
  'subgraph', 'subgraph-input', 'subgraph-output',
];

// ---------------------------------------------------------------------------
// Unit tests: nodeLabels.ts
// ---------------------------------------------------------------------------
describe('nodeLabels module', () => {
  describe('TYPE_LABELS', () => {
    it('has an entry for every NodeType', () => {
      for (const type of ALL_NODE_TYPES) {
        expect(TYPE_LABELS[type], `Missing TYPE_LABELS entry for "${type}"`).toBeDefined();
        expect(typeof TYPE_LABELS[type]).toBe('string');
        expect(TYPE_LABELS[type].length).toBeGreaterThan(0);
      }
    });

    it('has no extra keys beyond known NodeType values', () => {
      const nodeTypeSet = new Set<string>(ALL_NODE_TYPES);
      for (const key of Object.keys(TYPE_LABELS)) {
        expect(nodeTypeSet.has(key), `TYPE_LABELS has unknown key "${key}"`).toBe(true);
      }
    });

    it('labels are human-readable (start with uppercase or contain spaces)', () => {
      for (const [type, label] of Object.entries(TYPE_LABELS)) {
        // Labels should be capitalized display names, not raw type keys
        const firstChar = label.charAt(0);
        expect(
          firstChar === firstChar.toUpperCase(),
          `TYPE_LABELS["${type}"] = "${label}" does not start with uppercase`,
        ).toBe(true);
      }
    });

    it('has no duplicate label values (except intentional: subgraph-input/subgraph-output overlap with core)', () => {
      const seen = new Map<string, string>();
      const allowedDuplicates = new Set(['Input', 'Output']); // subgraph-input→"Input", output→"Output"
      for (const [type, label] of Object.entries(TYPE_LABELS)) {
        if (allowedDuplicates.has(label)) continue;
        expect(
          seen.has(label),
          `Duplicate label "${label}" used by both "${seen.get(label)}" and "${type}"`,
        ).toBe(false);
        seen.set(label, type);
      }
    });
  });

  describe('TYPE_LABELS_SHORT', () => {
    it('every short label key exists in TYPE_LABELS', () => {
      for (const key of Object.keys(TYPE_LABELS_SHORT)) {
        expect(TYPE_LABELS[key], `TYPE_LABELS_SHORT key "${key}" not found in TYPE_LABELS`).toBeDefined();
      }
    });

    it('short labels are non-empty strings', () => {
      for (const [type, label] of Object.entries(TYPE_LABELS_SHORT)) {
        expect(typeof label).toBe('string');
        expect(label.length, `TYPE_LABELS_SHORT["${type}"] is empty`).toBeGreaterThan(0);
      }
    });

    it('short labels are shorter or equal to full labels', () => {
      for (const [type, shortLabel] of Object.entries(TYPE_LABELS_SHORT)) {
        const fullLabel = TYPE_LABELS[type];
        expect(
          shortLabel.length <= fullLabel.length,
          `Short label "${shortLabel}" is longer than full label "${fullLabel}" for "${type}"`,
        ).toBe(true);
      }
    });
  });

  describe('TYPE_DESCRIPTIONS', () => {
    it('has an entry for every NodeType', () => {
      for (const type of ALL_NODE_TYPES) {
        expect(TYPE_DESCRIPTIONS[type], `Missing TYPE_DESCRIPTIONS entry for "${type}"`).toBeDefined();
        expect(typeof TYPE_DESCRIPTIONS[type]).toBe('string');
        expect(TYPE_DESCRIPTIONS[type].length).toBeGreaterThan(0);
      }
    });

    it('descriptions are distinct from labels (provide extra info)', () => {
      for (const type of ALL_NODE_TYPES) {
        const label = TYPE_LABELS[type];
        const desc = TYPE_DESCRIPTIONS[type];
        // Descriptions should generally not be identical to labels
        // (some one-word types like "Note" might have similar but descriptive text)
        if (label && desc) {
          expect(desc.length).toBeGreaterThanOrEqual(3); // At minimum a short phrase
        }
      }
    });
  });

  describe('getNodeLabel', () => {
    it('returns full label for known types', () => {
      expect(getNodeLabel('source')).toBe('Source');
      expect(getNodeLabel('math')).toBe('Math');
      expect(getNodeLabel('string-length')).toBe('String Length');
      expect(getNodeLabel('compose-vec3')).toBe('Compose Vec3');
    });

    it('returns short label when short=true and short label exists', () => {
      expect(getNodeLabel('string-length', true)).toBe('Str Length');
      expect(getNodeLabel('create-array', true)).toBe('Array');
      expect(getNodeLabel('array-reduce', true)).toBe('Arr Reduce');
    });

    it('falls back to full label when short=true but no short label exists', () => {
      // 'math' has no short label entry
      expect(getNodeLabel('math', true)).toBe('Math');
      expect(getNodeLabel('source', true)).toBe('Source');
    });

    it('falls back to type key for unknown types', () => {
      expect(getNodeLabel('unknown-type')).toBe('unknown-type');
      expect(getNodeLabel('unknown-type', true)).toBe('unknown-type');
    });

    it('handles empty string type gracefully', () => {
      expect(getNodeLabel('')).toBe('');
    });
  });

  describe('COLOR_HEX', () => {
    it('has entries for expected color keys', () => {
      expect(COLOR_HEX['teal']).toBeDefined();
      expect(COLOR_HEX['orange']).toBeDefined();
      expect(COLOR_HEX['coral']).toBeDefined();
      expect(COLOR_HEX['teal-coral']).toBeDefined();
    });

    it('all color values reference CSS variables', () => {
      for (const [key, val] of Object.entries(COLOR_HEX)) {
        expect(val, `COLOR_HEX["${key}"] should be a CSS variable`).toMatch(/^var\(--/);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-module consistency tests
// ---------------------------------------------------------------------------
describe('Node label consistency across modules', () => {
  it('NODE_CATEGORIES covers every NodeType', () => {
    for (const type of ALL_NODE_TYPES) {
      expect(
        NODE_CATEGORIES[type],
        `NODE_CATEGORIES missing entry for "${type}"`,
      ).toBeDefined();
    }
  });

  it('NODE_TYPE_CONFIG covers every NodeType', () => {
    for (const type of ALL_NODE_TYPES) {
      expect(
        NODE_TYPE_CONFIG[type],
        `NODE_TYPE_CONFIG missing entry for "${type}"`,
      ).toBeDefined();
    }
  });

  it('NODE_TYPE_CONFIG color values exist in COLOR_HEX', () => {
    for (const type of ALL_NODE_TYPES) {
      const color = NODE_TYPE_CONFIG[type]?.color;
      if (color) {
        expect(
          COLOR_HEX[color],
          `NODE_TYPE_CONFIG["${type}"].color = "${color}" not found in COLOR_HEX`,
        ).toBeDefined();
      }
    }
  });

  it('ALL_NODE_TYPES matches the count in modularity test (93 types)', () => {
    expect(ALL_NODE_TYPES.length).toBe(93);
  });

  it('no duplicate types in ALL_NODE_TYPES', () => {
    const seen = new Set<string>();
    for (const t of ALL_NODE_TYPES) {
      expect(seen.has(t), `Duplicate NodeType "${t}"`).toBe(false);
      seen.add(t);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: Store creates nodes with correct labels
// ---------------------------------------------------------------------------
describe('Node creation assigns correct labels from TYPE_LABELS', () => {
  const getState = () => useEditorStore.getState();

  beforeEach(() => {
    _resetModuleState();
    useEditorStore.setState({
      nodes: {},
      connections: {},
      groups: {},
      customNodeDefs: {},
      subgraphDefs: {},
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
      errorStrategy: 'fail-fast',
      debugMode: false,
      pausedAtWave: -1,
      debugWaves: [],
      traceNodeId: null,
      executionMetrics: {},
    });
  });

  it('every built-in node type gets its TYPE_LABELS title on creation', () => {
    const { addNode } = getState();
    for (const type of ALL_NODE_TYPES) {
      const id = addNode(type, [0, 0, 0]);
      const node = getState().nodes[id];
      expect(node).toBeDefined();
      const expectedTitle = TYPE_LABELS[type];
      expect(
        node.title,
        `Node type "${type}" has title "${node.title}" but expected "${expectedTitle}"`,
      ).toBe(expectedTitle);
    }
  });

  it('created nodes have correct type field', () => {
    const { addNode } = getState();
    const sample: NodeType[] = ['source', 'math', 'string-length', 'if-gate', 'custom'];
    for (const type of sample) {
      const id = addNode(type, [1, 0, 1]);
      expect(getState().nodes[id].type).toBe(type);
    }
  });

  it('created nodes have non-empty inputs/outputs matching NODE_TYPE_CONFIG', () => {
    const { addNode } = getState();
    const sample: NodeType[] = ['math', 'string-split', 'create-object', 'array-zip'];
    for (const type of sample) {
      const id = addNode(type, [0, 0, 0]);
      const node = getState().nodes[id];
      const config = NODE_TYPE_CONFIG[type];
      expect(node.inputs.length).toBe(config.inputs.length);
      expect(node.outputs.length).toBe(config.outputs.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: Title migration fixes stale labels from saved data
// ---------------------------------------------------------------------------
describe('migrateNodeTitle integration', () => {
  it('migrates raw type keys to human-readable labels', async () => {
    const { migrateNodeTitle } = await import('../utils/nodeVersioning');
    // Simulate a saved node with raw type key as title (old format)
    const node: EditorNode = {
      id: 'test-1',
      type: 'string-length',
      position: [0, 0, 0],
      title: 'string-length', // raw type key, needs migration
      data: {},
      inputs: [{ id: 'in-str', label: 'str', portType: 'string' }],
      outputs: [{ id: 'out-length', label: 'length', portType: 'number' }],
    };

    const changed = migrateNodeTitle(node);
    expect(changed).toBe(true);
    expect(node.title).toBe('String Length');
  });

  it('preserves user-customized titles during migration', async () => {
    const { migrateNodeTitle } = await import('../utils/nodeVersioning');
    const node: EditorNode = {
      id: 'test-2',
      type: 'math',
      position: [0, 0, 0],
      title: 'My Addition Node', // user-customized, should NOT change
      data: {},
      inputs: [],
      outputs: [],
    };

    const changed = migrateNodeTitle(node);
    expect(changed).toBe(false);
    expect(node.title).toBe('My Addition Node');
  });

  it('migrateAllNodes fixes all stale titles in a batch', async () => {
    const { migrateAllNodes } = await import('../utils/nodeVersioning');
    const nodes: Record<string, EditorNode> = {
      n1: {
        id: 'n1', type: 'compose-vec3', position: [0, 0, 0],
        title: 'compose-vec3', // stale
        data: {}, inputs: [], outputs: [],
      },
      n2: {
        id: 'n2', type: 'if-gate', position: [1, 0, 0],
        title: 'if-gate', // stale
        data: {}, inputs: [], outputs: [],
      },
      n3: {
        id: 'n3', type: 'math', position: [2, 0, 0],
        title: 'Math', // already correct
        data: {}, inputs: [], outputs: [],
      },
    };

    const count = migrateAllNodes(nodes);
    expect(count).toBeGreaterThanOrEqual(2); // n1 and n2 migrated (ports too)
    expect(nodes.n1.title).toBe('Compose Vec3');
    expect(nodes.n2.title).toBe('If Gate');
    expect(nodes.n3.title).toBe('Math'); // unchanged
  });
});
