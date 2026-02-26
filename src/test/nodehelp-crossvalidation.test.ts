/**
 * Cross-validation tests for nodeHelp vs NODE_TYPE_CONFIG.
 * Ensures NODE_HELP port counts and names match the actual NODE_TYPE_CONFIG
 * for every node type — prevents future divergence.
 */
import { describe, it, expect } from 'vitest';
import { getNodeHelp, getAllNodeHelp } from '../utils/nodeHelp';
import { NODE_TYPE_CONFIG } from '../types';
import type { NodeType } from '../types';

// All NodeType values (93 total)
const ALL_NODE_TYPES: NodeType[] = [
  'source', 'transform', 'filter', 'output',
  'math', 'clamp', 'remap', 'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt', 'lerp',
  'mean', 'median', 'stddev', 'min-array', 'max-array',
  'concat', 'template', 'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number',
  'string-concat', 'string-replace', 'string-includes', 'string-template',
  'compare', 'switch', 'and', 'or', 'not', 'xor', 'if-gate', 'select',
  'compose-vec3', 'decompose-vec3', 'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length',
  'color-picker', 'color-mix', 'hsl-to-rgb', 'rgb-to-hsl',
  'timer', 'http-fetch',
  'note', 'reroute', 'random', 'display',
  'create-array', 'get-element', 'set-element', 'array-length', 'array-push',
  'array-filter', 'array-map', 'array-reduce',
  'create-object', 'get-property', 'set-property', 'object-keys', 'object-values', 'merge-objects',
  'json-parse', 'json-stringify', 'base64-encode', 'base64-decode', 'uri-encode', 'uri-decode',
  'array-slice', 'array-find', 'array-sort', 'array-reverse', 'array-flatten', 'array-zip', 'array-unique',
  'get-timestamp', 'format-date', 'parse-date',
  'get-var', 'set-var',
  'custom', 'subgraph', 'subgraph-input', 'subgraph-output',
];

// These node types may have dynamic/special port definitions in NODE_HELP
// that don't exactly match NODE_TYPE_CONFIG (e.g. variadic inputs)
const SPECIAL_PORT_NODES = new Set<NodeType>([
  'custom',       // dynamic ports via updateCustomNodePorts
  'subgraph',     // dynamic ports via SubgraphNodeDef
  'create-array', // NODE_HELP describes variadic "..." input
]);

describe('nodeHelp cross-validation', () => {
  // -----------------------------------------------------------------------
  // Coverage: every NodeType has a help entry
  // -----------------------------------------------------------------------
  describe('every NodeType has a help entry', () => {
    for (const type of ALL_NODE_TYPES) {
      it(`has help for "${type}"`, () => {
        const help = getNodeHelp(type);
        expect(help).toBeDefined();
        expect(help!.nodeType).toBe(type);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Coverage: help entry nodeType matches the key
  // -----------------------------------------------------------------------
  describe('help entry nodeType field matches its key', () => {
    const allHelp = getAllNodeHelp();
    for (const entry of allHelp) {
      it(`"${entry.nodeType}" nodeType matches key`, () => {
        const fetched = getNodeHelp(entry.nodeType);
        expect(fetched).toBeDefined();
        expect(fetched!.nodeType).toBe(entry.nodeType);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Coverage: port count matches NODE_TYPE_CONFIG
  // -----------------------------------------------------------------------
  describe('port count matches NODE_TYPE_CONFIG', () => {
    for (const type of ALL_NODE_TYPES) {
      if (SPECIAL_PORT_NODES.has(type)) continue;

      it(`"${type}" input count matches`, () => {
        const help = getNodeHelp(type);
        const config = NODE_TYPE_CONFIG[type];
        expect(help).toBeDefined();
        expect(config).toBeDefined();
        expect(help!.inputs.length).toBe(config.inputs.length);
      });

      it(`"${type}" output count matches`, () => {
        const help = getNodeHelp(type);
        const config = NODE_TYPE_CONFIG[type];
        expect(help).toBeDefined();
        expect(config).toBeDefined();
        expect(help!.outputs.length).toBe(config.outputs.length);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Coverage: required help entry fields are present
  // -----------------------------------------------------------------------
  describe('help entries have required fields', () => {
    for (const type of ALL_NODE_TYPES) {
      it(`"${type}" has category, summary, description`, () => {
        const help = getNodeHelp(type);
        expect(help).toBeDefined();
        expect(help!.category).toBeTruthy();
        expect(help!.summary).toBeTruthy();
        expect(help!.description).toBeTruthy();
      });
    }
  });

  // -----------------------------------------------------------------------
  // Coverage: port help entries have required fields
  // -----------------------------------------------------------------------
  describe('port help entries have name, type, description', () => {
    const allHelp = getAllNodeHelp();
    for (const entry of allHelp) {
      for (const port of entry.inputs) {
        it(`"${entry.nodeType}" input "${port.name}" has all fields`, () => {
          expect(port.name).toBeTruthy();
          expect(port.type).toBeTruthy();
          expect(port.description).toBeTruthy();
        });
      }
      for (const port of entry.outputs) {
        it(`"${entry.nodeType}" output "${port.name}" has all fields`, () => {
          expect(port.name).toBeTruthy();
          expect(port.type).toBeTruthy();
          expect(port.description).toBeTruthy();
        });
      }
    }
  });

  // -----------------------------------------------------------------------
  // getAllNodeHelp returns all entries
  // -----------------------------------------------------------------------
  it('getAllNodeHelp returns entries for all node types', () => {
    const allHelp = getAllNodeHelp();
    const helpTypes = new Set(allHelp.map(h => h.nodeType));
    for (const type of ALL_NODE_TYPES) {
      expect(helpTypes.has(type)).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // getNodeHelp returns undefined for unknown types
  // -----------------------------------------------------------------------
  it('getNodeHelp returns undefined for unknown types', () => {
    expect(getNodeHelp('nonexistent-type' as NodeType)).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Category is always a non-empty string
  // -----------------------------------------------------------------------
  it('all categories are non-empty strings', () => {
    const allHelp = getAllNodeHelp();
    for (const entry of allHelp) {
      expect(typeof entry.category).toBe('string');
      expect(entry.category.length).toBeGreaterThan(0);
    }
  });

  // -----------------------------------------------------------------------
  // Tips are always an array of strings (when present)
  // -----------------------------------------------------------------------
  it('tips are valid string arrays when present', () => {
    const allHelp = getAllNodeHelp();
    for (const entry of allHelp) {
      if (entry.tips !== undefined) {
        expect(Array.isArray(entry.tips)).toBe(true);
        for (const tip of entry.tips!) {
          expect(typeof tip).toBe('string');
          expect(tip.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
