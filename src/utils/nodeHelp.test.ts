import { describe, it, expect } from 'vitest';
import {
  getNodeHelp,
  getAllNodeHelp,
  getNodeHelpByCategory,
} from './nodeHelp';
import type { NodeType } from '../types';

// All 93 node types from types/index.ts
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

const EXPECTED_CATEGORIES = [
  'Core', 'Math', 'String', 'Logic', 'Vector', 'Utility', 'Color', 'Live', 'Data', 'Subgraph',
];

describe('nodeHelp', () => {
  // -------------------------------------------------------------------------
  // getAllNodeHelp
  // -------------------------------------------------------------------------
  describe('getAllNodeHelp', () => {
    it('returns a non-empty array of entries', () => {
      const all = getAllNodeHelp();
      expect(Array.isArray(all)).toBe(true);
      expect(all.length).toBeGreaterThan(0);
    });

    it('returns at least 90 entries (93 node types, all have help)', () => {
      const all = getAllNodeHelp();
      expect(all.length).toBeGreaterThanOrEqual(90);
    });
  });

  // -------------------------------------------------------------------------
  // Coverage: every NodeType has a help entry
  // -------------------------------------------------------------------------
  describe('coverage', () => {
    it('every NodeType has a corresponding help entry', () => {
      const missing: string[] = [];
      for (const nodeType of ALL_NODE_TYPES) {
        if (!getNodeHelp(nodeType)) {
          missing.push(nodeType);
        }
      }
      expect(missing).toEqual([]);
    });

    it('each entry nodeType matches its key in the lookup', () => {
      for (const nodeType of ALL_NODE_TYPES) {
        const entry = getNodeHelp(nodeType);
        if (entry) {
          expect(entry.nodeType).toBe(nodeType);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Required fields on each entry
  // -------------------------------------------------------------------------
  describe('entry structure', () => {
    it('each entry has all required fields (nodeType, category, summary, description, inputs, outputs)', () => {
      const all = getAllNodeHelp();
      for (const entry of all) {
        expect(entry).toHaveProperty('nodeType');
        expect(entry).toHaveProperty('category');
        expect(entry).toHaveProperty('summary');
        expect(entry).toHaveProperty('description');
        expect(entry).toHaveProperty('inputs');
        expect(entry).toHaveProperty('outputs');
      }
    });

    it('summary is a non-empty string on every entry', () => {
      const all = getAllNodeHelp();
      for (const entry of all) {
        expect(typeof entry.summary).toBe('string');
        expect(entry.summary.length).toBeGreaterThan(0);
      }
    });

    it('description is a non-empty string on every entry', () => {
      const all = getAllNodeHelp();
      for (const entry of all) {
        expect(typeof entry.description).toBe('string');
        expect(entry.description.length).toBeGreaterThan(0);
      }
    });

    it('inputs and outputs are arrays on every entry', () => {
      const all = getAllNodeHelp();
      for (const entry of all) {
        expect(Array.isArray(entry.inputs)).toBe(true);
        expect(Array.isArray(entry.outputs)).toBe(true);
      }
    });

    it('each PortHelp in inputs has name, type, and description strings', () => {
      const all = getAllNodeHelp();
      for (const entry of all) {
        for (const port of entry.inputs) {
          expect(typeof port.name).toBe('string');
          expect(port.name.length).toBeGreaterThan(0);
          expect(typeof port.type).toBe('string');
          expect(port.type.length).toBeGreaterThan(0);
          expect(typeof port.description).toBe('string');
          expect(port.description.length).toBeGreaterThan(0);
        }
      }
    });

    it('each PortHelp in outputs has name, type, and description strings', () => {
      const all = getAllNodeHelp();
      for (const entry of all) {
        for (const port of entry.outputs) {
          expect(typeof port.name).toBe('string');
          expect(port.name.length).toBeGreaterThan(0);
          expect(typeof port.type).toBe('string');
          expect(port.type.length).toBeGreaterThan(0);
          expect(typeof port.description).toBe('string');
          expect(port.description.length).toBeGreaterThan(0);
        }
      }
    });

    it('tips is either undefined or a non-empty array of strings', () => {
      const all = getAllNodeHelp();
      for (const entry of all) {
        if (entry.tips !== undefined) {
          expect(Array.isArray(entry.tips)).toBe(true);
          expect(entry.tips!.length).toBeGreaterThan(0);
          for (const tip of entry.tips!) {
            expect(typeof tip).toBe('string');
            expect(tip.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // getNodeHelp - specific lookups
  // -------------------------------------------------------------------------
  describe('getNodeHelp', () => {
    it('returns correct entry for "source"', () => {
      const entry = getNodeHelp('source');
      expect(entry).toBeDefined();
      expect(entry!.nodeType).toBe('source');
      expect(entry!.category).toBe('Core');
      expect(entry!.summary).toContain('constant numeric value');
      expect(entry!.inputs).toHaveLength(0);
      expect(entry!.outputs.length).toBeGreaterThan(0);
    });

    it('returns correct entry for "math"', () => {
      const entry = getNodeHelp('math');
      expect(entry).toBeDefined();
      expect(entry!.nodeType).toBe('math');
      expect(entry!.category).toBe('Math');
      expect(entry!.inputs.length).toBe(2);
      expect(entry!.outputs.length).toBe(1);
    });

    it('returns undefined for a completely unknown type', () => {
      const entry = getNodeHelp('nonexistent-node-type' as NodeType);
      expect(entry).toBeUndefined();
    });

    it('returns undefined for an empty string', () => {
      const entry = getNodeHelp('' as NodeType);
      expect(entry).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getNodeHelpByCategory
  // -------------------------------------------------------------------------
  describe('getNodeHelpByCategory', () => {
    it('returns only Math entries for category "Math"', () => {
      const mathEntries = getNodeHelpByCategory('Math');
      expect(mathEntries.length).toBeGreaterThan(0);
      for (const entry of mathEntries) {
        expect(entry.category).toBe('Math');
      }
    });

    it('returns an empty array for a nonexistent category', () => {
      const entries = getNodeHelpByCategory('nonexistent');
      expect(entries).toEqual([]);
    });

    it('category filtering is case-sensitive', () => {
      const lower = getNodeHelpByCategory('math');
      expect(lower).toEqual([]);

      const correct = getNodeHelpByCategory('Math');
      expect(correct.length).toBeGreaterThan(0);
    });

    it('all expected categories have at least one entry', () => {
      for (const cat of EXPECTED_CATEGORIES) {
        const entries = getNodeHelpByCategory(cat);
        expect(entries.length, `category "${cat}" should have at least 1 entry`).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // No duplicates
  // -------------------------------------------------------------------------
  describe('uniqueness', () => {
    it('no duplicate nodeType values across all entries', () => {
      const all = getAllNodeHelp();
      const types = all.map(e => e.nodeType);
      const unique = new Set(types);
      expect(types.length).toBe(unique.size);
    });
  });

  // -------------------------------------------------------------------------
  // Category-specific spot checks
  // -------------------------------------------------------------------------
  describe('category spot checks', () => {
    it('Core category contains source, transform, filter, output', () => {
      const coreTypes = getNodeHelpByCategory('Core').map(e => e.nodeType);
      expect(coreTypes).toContain('source');
      expect(coreTypes).toContain('transform');
      expect(coreTypes).toContain('filter');
      expect(coreTypes).toContain('output');
    });

    it('Vector category contains compose-vec3 and decompose-vec3', () => {
      const vecTypes = getNodeHelpByCategory('Vector').map(e => e.nodeType);
      expect(vecTypes).toContain('compose-vec3');
      expect(vecTypes).toContain('decompose-vec3');
    });

    it('Subgraph category contains subgraph, subgraph-input, subgraph-output', () => {
      const sgTypes = getNodeHelpByCategory('Subgraph').map(e => e.nodeType);
      expect(sgTypes).toContain('subgraph');
      expect(sgTypes).toContain('subgraph-input');
      expect(sgTypes).toContain('subgraph-output');
    });
  });
});
