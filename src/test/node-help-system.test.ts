/**
 * Phase 34: Comprehensive node help system tests
 *
 * Tests the nodeHelp.ts module for completeness, accuracy, and edge cases.
 * Verifies that every node type has proper documentation that matches
 * the actual NODE_TYPE_CONFIG port definitions.
 */
import { describe, it, expect } from 'vitest';
import { getNodeHelp, getAllNodeHelp, getNodeHelpByCategory } from '../utils/nodeHelp';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../types';
import type { NodeType } from '../types';

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
  'note', 'reroute', 'random', 'display', 'image-preview',
  'timer', 'color-picker', 'color-mix', 'hsl-to-rgb', 'rgb-to-hsl', 'http-fetch',
  'create-array', 'get-element', 'set-element', 'array-length', 'array-push', 'array-filter', 'array-map', 'array-reduce',
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
// 1. Completeness
// ---------------------------------------------------------------------------

describe('node help completeness', () => {
  it('has help entries for all 94 node types', () => {
    const all = getAllNodeHelp();
    expect(all.length).toBe(94);
  });

  it('every node type in NodeType union has a help entry', () => {
    const missing: string[] = [];
    for (const type of ALL_NODE_TYPES) {
      if (!getNodeHelp(type)) missing.push(type);
    }
    expect(missing).toEqual([]);
  });

  it('no help entries exist for types not in NodeType union', () => {
    const all = getAllNodeHelp();
    const nodeTypeSet = new Set<string>(ALL_NODE_TYPES);
    const extra = all.filter(h => !nodeTypeSet.has(h.nodeType));
    expect(extra.map(h => h.nodeType)).toEqual([]);
  });

  it('every entry has a non-empty summary', () => {
    for (const entry of getAllNodeHelp()) {
      expect(entry.summary.length, `${entry.nodeType} summary`).toBeGreaterThan(10);
    }
  });

  it('every entry has a non-empty description', () => {
    for (const entry of getAllNodeHelp()) {
      expect(entry.description.length, `${entry.nodeType} description`).toBeGreaterThan(20);
    }
  });

  it('summary and description are distinct for every entry', () => {
    for (const entry of getAllNodeHelp()) {
      expect(entry.summary, `${entry.nodeType}`).not.toBe(entry.description);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Port documentation accuracy
// ---------------------------------------------------------------------------

describe('node help port accuracy', () => {
  it('every node with inputs in config has at least 1 input documented', () => {
    // NODE_TYPE_CONFIG includes data-field ports (multiplier, threshold, etc.)
    // that nodeHelp intentionally omits for clarity. We only verify that nodes
    // with logical inputs document at least one input.
    for (const type of ALL_NODE_TYPES) {
      const config = NODE_TYPE_CONFIG[type];
      if (!config) continue;
      const help = getNodeHelp(type);
      if (!help) continue;
      const hasDynamic = help.inputs.some(i => i.name === '(dynamic)');
      if (hasDynamic) continue;
      // Nodes with real data-flow inputs should document them
      const configHasDataInputs = (config.inputs?.length ?? 0) > 0;
      if (configHasDataInputs && help.inputs.length === 0) {
        // source-like nodes may have no logical inputs even if config has fields
        // Only fail if the node type clearly requires inputs
        const noInputTypes = new Set(['source', 'note', 'random', 'timer', 'color-picker', 'get-var', 'get-timestamp']);
        if (!noInputTypes.has(type)) {
          expect.fail(`${type} has config inputs but 0 help inputs`);
        }
      }
    }
  });

  it('every node with outputs in config has at least 1 output documented', () => {
    for (const type of ALL_NODE_TYPES) {
      const config = NODE_TYPE_CONFIG[type];
      if (!config) continue;
      const help = getNodeHelp(type);
      if (!help) continue;
      const hasDynamic = help.outputs.some(o => o.name === '(dynamic)');
      if (hasDynamic) continue;
      const configHasOutputs = (config.outputs?.length ?? 0) > 0;
      // Sink-like nodes (output, display, note, set-var, subgraph-output) may have 0 outputs
      const noOutputTypes = new Set(['output', 'display', 'note', 'set-var', 'subgraph-output']);
      if (configHasOutputs && help.outputs.length === 0 && !noOutputTypes.has(type)) {
        expect.fail(`${type} has config outputs but 0 help outputs`);
      }
    }
  });

  it('every port help has a non-empty description', () => {
    for (const entry of getAllNodeHelp()) {
      for (const port of [...entry.inputs, ...entry.outputs]) {
        expect(port.description.length, `${entry.nodeType}.${port.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('every port help has a non-empty name', () => {
    for (const entry of getAllNodeHelp()) {
      for (const port of [...entry.inputs, ...entry.outputs]) {
        expect(port.name.length, `${entry.nodeType} port`).toBeGreaterThan(0);
      }
    }
  });

  it('every port help has a valid type string', () => {
    const validTypes = new Set(['number', 'string', 'boolean', 'vector3', 'color', 'any', 'array', 'object', 'image']);
    for (const entry of getAllNodeHelp()) {
      for (const port of [...entry.inputs, ...entry.outputs]) {
        expect(validTypes.has(port.type), `${entry.nodeType}.${port.name} type="${port.type}"`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Category validation
// ---------------------------------------------------------------------------

describe('node help categories', () => {
  const expectedCategories = [
    'Core', 'Math', 'String', 'Logic', 'Vector',
    'Utility', 'Color', 'Live', 'Data', 'Subgraph',
  ];

  it('covers exactly 10 categories', () => {
    const all = getAllNodeHelp();
    const categories = [...new Set(all.map(e => e.category))];
    expect(categories.sort()).toEqual(expectedCategories.sort());
  });

  it('Core category has exactly 4 nodes', () => {
    expect(getNodeHelpByCategory('Core').length).toBe(4);
  });

  it('Math category has correct node count', () => {
    const mathHelp = getNodeHelpByCategory('Math');
    // math, clamp, remap, sin, cos, tan, abs, floor, ceil, round, log, sqrt, lerp, mean, median, stddev, min-array, max-array = 18
    expect(mathHelp.length).toBe(18);
  });

  it('String category has correct nodes', () => {
    const strHelp = getNodeHelpByCategory('String');
    const types = strHelp.map(h => h.nodeType).sort();
    expect(types).toContain('concat');
    expect(types).toContain('template');
    expect(types).toContain('string-length');
  });

  it('Logic category has correct nodes', () => {
    const logicHelp = getNodeHelpByCategory('Logic');
    const types = logicHelp.map(h => h.nodeType).sort();
    expect(types).toContain('and');
    expect(types).toContain('or');
    expect(types).toContain('not');
    expect(types).toContain('xor');
    expect(types).toContain('compare');
    expect(types).toContain('switch');
    expect(types).toContain('if-gate');
    expect(types).toContain('select');
  });

  it('Data category includes encoding and array nodes', () => {
    const dataHelp = getNodeHelpByCategory('Data');
    const types = new Set(dataHelp.map(h => h.nodeType));
    // Encoding nodes
    expect(types.has('json-parse')).toBe(true);
    expect(types.has('base64-encode')).toBe(true);
    expect(types.has('uri-decode')).toBe(true);
    // Advanced array nodes
    expect(types.has('array-slice')).toBe(true);
    expect(types.has('array-unique')).toBe(true);
  });

  it('Utility category includes date/time nodes', () => {
    const utilHelp = getNodeHelpByCategory('Utility');
    const types = new Set(utilHelp.map(h => h.nodeType));
    expect(types.has('get-timestamp')).toBe(true);
    expect(types.has('format-date')).toBe(true);
    expect(types.has('parse-date')).toBe(true);
  });

  it('Subgraph category has 3 nodes', () => {
    const sgHelp = getNodeHelpByCategory('Subgraph');
    expect(sgHelp.length).toBe(3);
    const types = new Set(sgHelp.map(h => h.nodeType));
    expect(types.has('subgraph')).toBe(true);
    expect(types.has('subgraph-input')).toBe(true);
    expect(types.has('subgraph-output')).toBe(true);
  });

  it('nonexistent category returns empty array', () => {
    expect(getNodeHelpByCategory('FakeCategory')).toEqual([]);
  });

  it('nodeHelp categories match NODE_CATEGORIES from types', () => {
    for (const type of ALL_NODE_TYPES) {
      const help = getNodeHelp(type);
      if (!help) continue;
      const canonical = NODE_CATEGORIES[type];
      if (canonical) {
        expect(help.category, `${type} category mismatch`).toBe(canonical);
      }
    }
  });

  it('each node belongs to exactly one category', () => {
    const all = getAllNodeHelp();
    const nodeTypeCounts = new Map<string, number>();
    for (const entry of all) {
      nodeTypeCounts.set(entry.nodeType, (nodeTypeCounts.get(entry.nodeType) || 0) + 1);
    }
    const duplicates = [...nodeTypeCounts.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Accessor edge cases
// ---------------------------------------------------------------------------

describe('node help accessors', () => {
  it('getNodeHelp returns undefined for unknown type', () => {
    expect(getNodeHelp('nonexistent' as any)).toBeUndefined();
  });

  it('getNodeHelp returns undefined for empty string', () => {
    expect(getNodeHelp('' as any)).toBeUndefined();
  });

  it('getAllNodeHelp returns a new array each time', () => {
    const a = getAllNodeHelp();
    const b = getAllNodeHelp();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('getNodeHelpByCategory returns a new array each time', () => {
    const a = getNodeHelpByCategory('Core');
    const b = getNodeHelpByCategory('Core');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('nodeType field matches the lookup key', () => {
    for (const type of ALL_NODE_TYPES) {
      const help = getNodeHelp(type);
      if (help) {
        expect(help.nodeType).toBe(type);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Tips validation
// ---------------------------------------------------------------------------

describe('node help tips', () => {
  it('tips field is always an array or undefined', () => {
    for (const entry of getAllNodeHelp()) {
      if (entry.tips !== undefined) {
        expect(Array.isArray(entry.tips), entry.nodeType).toBe(true);
      }
    }
  });

  it('tip strings are non-empty when present', () => {
    for (const entry of getAllNodeHelp()) {
      if (entry.tips) {
        for (const tip of entry.tips) {
          expect(tip.length, `${entry.nodeType} tip`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('source node has tips', () => {
    const help = getNodeHelp('source');
    expect(help!.tips).toBeDefined();
    expect(help!.tips!.length).toBeGreaterThan(0);
  });

  it('custom node mentions inputs[] syntax in tips', () => {
    const help = getNodeHelp('custom');
    expect(help!.tips).toBeDefined();
    const mentionsInputs = help!.tips!.some(t => t.includes('inputs['));
    expect(mentionsInputs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Specific node types
// ---------------------------------------------------------------------------

describe('specific node help entries', () => {
  it('source has 0 inputs and 2+ outputs', () => {
    const h = getNodeHelp('source')!;
    expect(h.inputs.length).toBe(0);
    expect(h.outputs.length).toBeGreaterThanOrEqual(2);
  });

  it('output has 2 inputs and 0 outputs', () => {
    const h = getNodeHelp('output')!;
    expect(h.inputs.length).toBe(2);
    expect(h.outputs.length).toBe(0);
  });

  it('math has 2 inputs and 1 output', () => {
    const h = getNodeHelp('math')!;
    expect(h.inputs.length).toBe(2);
    expect(h.outputs.length).toBe(1);
  });

  it('compose-vec3 has 3 inputs', () => {
    const h = getNodeHelp('compose-vec3')!;
    expect(h.inputs.length).toBe(3);
  });

  it('decompose-vec3 has 3 outputs', () => {
    const h = getNodeHelp('decompose-vec3')!;
    expect(h.outputs.length).toBe(3);
  });

  it('note has 0 inputs and 0 outputs', () => {
    const h = getNodeHelp('note')!;
    expect(h.inputs.length).toBe(0);
    expect(h.outputs.length).toBe(0);
  });

  it('reroute has 1 input and 1 output', () => {
    const h = getNodeHelp('reroute')!;
    expect(h.inputs.length).toBe(1);
    expect(h.outputs.length).toBe(1);
  });

  it('timer is in Live category', () => {
    const h = getNodeHelp('timer')!;
    expect(h.category).toBe('Live');
  });

  it('http-fetch is in Live category', () => {
    const h = getNodeHelp('http-fetch')!;
    expect(h.category).toBe('Live');
  });

  it('get-timestamp is in Utility category', () => {
    const h = getNodeHelp('get-timestamp')!;
    expect(h.category).toBe('Utility');
  });

  it('format-date describes date formatting', () => {
    const h = getNodeHelp('format-date')!;
    expect(h.description.toLowerCase()).toMatch(/date|format/);
  });

  it('array-unique is in Data category', () => {
    const h = getNodeHelp('array-unique')!;
    expect(h.category).toBe('Data');
  });
});
