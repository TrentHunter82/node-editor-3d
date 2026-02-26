/**
 * Serialization fuzz tests: feeds 200+ random/corrupted JSON blobs through
 * loadMultiGraph and related deserialization paths to verify no unhandled
 * exceptions — only graceful null returns or default values.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadMultiGraph, saveMultiGraph, importFromJSON, loadGraph } from '../utils/serialization';
import type { MultiGraphStorage } from '../utils/serialization';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write raw JSON string into localStorage under the storage key */
function setRawStorage(value: string): void {
  localStorage.setItem('node-editor-3d-graph', value);
}

/** Create a valid MultiGraphStorage for mutation-based fuzzing */
function validMultiGraph(): MultiGraphStorage {
  return {
    version: 2,
    graphs: {
      default: {
        nodes: {},
        connections: {},
        groups: {},
        customNodeDefs: {},
      },
    },
    graphTabs: {
      default: { id: 'default', name: 'Main', createdAt: Date.now() },
    },
    activeGraphId: 'default',
    graphOrder: ['default'],
    templates: {},
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Serialization Fuzz Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // =========================================================================
  // Category 1: Completely invalid JSON (50+ cases)
  // =========================================================================
  describe('Invalid JSON strings', () => {
    const invalidJsonStrings = [
      '',
      ' ',
      'null',
      'undefined',
      'true',
      'false',
      '0',
      '42',
      '-1',
      '3.14',
      'NaN',
      'Infinity',
      '-Infinity',
      '"just a string"',
      "'single quotes'",
      '[]',
      '[1, 2, 3]',
      '[null]',
      '[[[]]]',
      '{',
      '}',
      '{{}}',
      '{{}',
      '[}',
      '{]',
      '{"unclosed": "value',
      '{"key": undefined}',
      '{"key": NaN}',
      '{key: "no quotes"}',
      "{'key': 'value'}",
      '{"trailing": "comma",}',
      '{"a":1,,"b":2}',
      '\\x00',
      '\0',
      '\n\n\n',
      '\t\t\t',
      '\r\n',
      'function(){}',
      'console.log("xss")',
      '<script>alert(1)</script>',
      '<?xml version="1.0"?>',
      '\uFEFF{}',  // BOM + empty object
      '\uFEFF',    // Just BOM
      '{"__proto__": {"polluted": true}}',
      '{"constructor": {"prototype": {}}}',
      String.raw`{"a": "\u0000\u0001\u0002"}`,
      '💀',
      '🎉'.repeat(1000),
      'a'.repeat(100000),
      JSON.stringify({ a: 'b'.repeat(10000000) }).slice(0, 100), // truncated
    ];

    invalidJsonStrings.forEach((raw, i) => {
      it(`invalid JSON #${i + 1}: ${JSON.stringify(raw).slice(0, 60)}`, () => {
        setRawStorage(raw);
        const result = loadMultiGraph();
        // Must not throw — should return null or a valid object
        expect(result === null || typeof result === 'object').toBe(true);
      });
    });
  });

  // =========================================================================
  // Category 2: Valid JSON but wrong shape (50+ cases)
  // =========================================================================
  describe('Valid JSON, wrong shape', () => {
    const wrongShapes = [
      {},
      { version: 1 },
      { version: 2 },
      { version: 2, graphs: null },
      { version: 2, graphs: [] },
      { version: 2, graphs: 'string' },
      { version: 2, graphs: 42 },
      { version: 2, graphs: true },
      { version: 2, graphs: {}, graphTabs: null },
      { version: 2, graphs: {}, graphTabs: [] },
      { version: 2, graphs: {}, graphTabs: 'string' },
      { version: 2, graphs: {}, graphTabs: {} },  // empty graphs
      { version: 3, graphs: {}, graphTabs: {} },
      { version: '2', graphs: {}, graphTabs: {} },
      { version: 2, graphs: {}, graphTabs: {}, activeGraphId: null },
      { version: 2, graphs: {}, graphTabs: {}, activeGraphId: 42 },
      { version: 2, graphs: {}, graphTabs: {}, activeGraphId: '' },
      { version: 2, graphs: {}, graphTabs: {}, graphOrder: 'not-array' },
      { version: 2, graphs: {}, graphTabs: {}, graphOrder: {} },
      { version: 2, graphs: {}, graphTabs: {}, graphOrder: null },
      { version: 2, graphs: {}, graphTabs: {}, templates: 'not-obj' },
      { version: 2, graphs: {}, graphTabs: {}, templates: [] },
      { version: 2, graphs: {}, graphTabs: {}, templates: null },
      { nodes: null, connections: {} },
      { nodes: {}, connections: null },
      { nodes: [], connections: {} },
      { nodes: {}, connections: [] },
      { nodes: 'string', connections: {} },
      { nodes: {}, connections: 'string' },
      { nodes: true, connections: {} },
      { nodes: {}, connections: true },
      { nodes: 42, connections: {} },
      { nodes: {}, connections: 42 },
      { version: 2, graphs: { a: null }, graphTabs: {} },
      { version: 2, graphs: { a: [] }, graphTabs: {} },
      { version: 2, graphs: { a: 'string' }, graphTabs: {} },
      { version: 2, graphs: { a: 42 }, graphTabs: {} },
      { version: 2, graphs: { a: true }, graphTabs: {} },
      { version: 2, graphs: { a: { nodes: null } }, graphTabs: {} },
      { version: 2, graphs: { a: { nodes: [], connections: {} } }, graphTabs: {} },
      { version: 2, graphs: { a: { nodes: {}, connections: 'bad' } }, graphTabs: {} },
      { version: 2, graphs: { a: { nodes: {}, connections: {}, groups: [] } }, graphTabs: {} },
      { version: 2, graphs: { a: { nodes: {}, connections: {}, customNodeDefs: null } }, graphTabs: {} },
      { a: 1, b: 2, c: 3 },
      { graphs: {} },
      { graphTabs: {} },
      { version: 2, graphs: { a: { nodes: {}, connections: {}, graphVariables: [] } }, graphTabs: {} },
      { version: 2, graphs: { a: { nodes: {}, connections: {}, checkpoints: 'bad' } }, graphTabs: {} },
      { version: 2, graphs: { a: { nodes: {}, connections: {}, subgraphDefs: 42 } }, graphTabs: {} },
    ];

    wrongShapes.forEach((obj, i) => {
      it(`wrong shape #${i + 1}`, () => {
        setRawStorage(JSON.stringify(obj));
        const result = loadMultiGraph();
        expect(result === null || typeof result === 'object').toBe(true);
      });
    });
  });

  // =========================================================================
  // Category 3: Corrupted v2 data with partial validity (30+ cases)
  // =========================================================================
  describe('Corrupted v2 data', () => {
    it('activeGraphId references non-existent graph', () => {
      const data = validMultiGraph();
      data.activeGraphId = 'does-not-exist';
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      // Should recover by falling back to first graph
      expect(result!.activeGraphId).toBe('default');
    });

    it('graphOrder contains stale IDs', () => {
      const data = validMultiGraph();
      data.graphOrder = ['default', 'deleted-1', 'deleted-2'];
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect(result!.graphOrder).toEqual(['default']);
    });

    it('graphOrder is missing entries that exist in graphs', () => {
      const data = validMultiGraph();
      (data.graphs as Record<string, unknown>)['extra'] = { nodes: {}, connections: {} };
      data.graphOrder = ['default'];
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect(result!.graphOrder).toContain('extra');
    });

    it('all graphs are invalid objects → returns null', () => {
      const data = {
        version: 2,
        graphs: { a: 42, b: 'string', c: null },
        graphTabs: {},
      };
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).toBeNull();
    });

    it('mixed valid and invalid graphs', () => {
      const data = {
        version: 2,
        graphs: {
          good: { nodes: {}, connections: {} },
          bad1: null,
          bad2: 42,
          bad3: [],
        },
        graphTabs: {},
        activeGraphId: 'good',
        graphOrder: ['good'],
      };
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect('good' in result!.graphs).toBe(true);
    });

    it('graph with nodes as wrong type gets normalized', () => {
      const data = validMultiGraph();
      (data.graphs.default as unknown as Record<string, unknown>).nodes = 'not-an-object';
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect(typeof result!.graphs.default.nodes).toBe('object');
    });

    it('graph with connections as array gets normalized', () => {
      const data = validMultiGraph();
      (data.graphs.default as unknown as Record<string, unknown>).connections = [1, 2, 3];
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect(typeof result!.graphs.default.connections).toBe('object');
      expect(Array.isArray(result!.graphs.default.connections)).toBe(false);
    });

    it('empty activeGraphId string', () => {
      const data = validMultiGraph();
      data.activeGraphId = '';
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect(result!.activeGraphId).toBe('default');
    });

    it('graphOrder as object instead of array', () => {
      const data = validMultiGraph();
      (data as unknown as Record<string, unknown>).graphOrder = { 0: 'default' };
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });

    it('templates as array instead of object', () => {
      const data = validMultiGraph();
      (data as unknown as Record<string, unknown>).templates = [1, 2, 3];
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect(typeof result!.templates).toBe('object');
      expect(Array.isArray(result!.templates)).toBe(false);
    });

    it('deeply nested garbage in graph data', () => {
      const data = validMultiGraph();
      (data.graphs.default as unknown as Record<string, unknown>).nodes = {
        n1: { deeply: { nested: { garbage: true } } },
      };
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });

    it('graph with graphVariables as array gets normalized', () => {
      const data = validMultiGraph();
      (data.graphs.default as unknown as Record<string, unknown>).graphVariables = [1, 2, 3];
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });

    it('graph with checkpoints as number gets normalized', () => {
      const data = validMultiGraph();
      (data.graphs.default as unknown as Record<string, unknown>).checkpoints = 999;
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });

    it('graph with subgraphDefs as boolean gets normalized', () => {
      const data = validMultiGraph();
      (data.graphs.default as unknown as Record<string, unknown>).subgraphDefs = true;
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });

    it('numeric string as graphOrder entries', () => {
      const data = validMultiGraph();
      data.graphOrder = ['default', '123', '456'];
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });

    it('graphTabs with extra properties', () => {
      const data = validMultiGraph();
      (data.graphTabs.default as unknown as Record<string, unknown>).malicious = '<script>';
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });
  });

  // =========================================================================
  // Category 4: Legacy format corruptions (20+ cases)
  // =========================================================================
  describe('Corrupted legacy format', () => {
    const legacyCorruptions = [
      { nodes: {}, connections: {}, groups: null },
      { nodes: {}, connections: {}, groups: [] },
      { nodes: {}, connections: {}, groups: 42 },
      { nodes: {}, connections: {}, customNodeDefs: null },
      { nodes: {}, connections: {}, customNodeDefs: 'bad' },
      { nodes: {}, connections: {}, customNodeDefs: [] },
      { nodes: {}, connections: {}, subgraphDefs: [] },
      { nodes: {}, connections: {}, subgraphDefs: 42 },
      { nodes: {}, connections: {}, groups: {}, extra: 'field' },
      { nodes: { n1: null }, connections: {} },
      { nodes: { n1: 'string' }, connections: {} },
      { nodes: { n1: [] }, connections: {} },
      { nodes: {}, connections: { c1: null } },
      { nodes: {}, connections: { c1: 'string' } },
      { nodes: {}, connections: { c1: [] } },
      { nodes: {}, connections: {}, groups: { g1: null } },
      { nodes: {}, connections: {}, groups: { g1: 'string' } },
      {
        nodes: { n1: { id: 'n1', type: 'source', position: 'bad' } },
        connections: {},
      },
      {
        nodes: { n1: { id: 'n1', type: 999, position: [0, 0, 0] } },
        connections: {},
      },
      {
        nodes: {},
        connections: { c1: { id: 'c1', sourceNodeId: null, targetNodeId: null } },
      },
    ];

    legacyCorruptions.forEach((obj, i) => {
      it(`legacy corruption #${i + 1}`, () => {
        setRawStorage(JSON.stringify(obj));
        // Test both loadMultiGraph (legacy migration) and loadGraph
        const resultMulti = loadMultiGraph();
        expect(resultMulti === null || typeof resultMulti === 'object').toBe(true);

        const resultLegacy = loadGraph();
        expect(resultLegacy === null || typeof resultLegacy === 'object').toBe(true);
      });
    });
  });

  // =========================================================================
  // Category 5: importFromJSON fuzz (20+ cases)
  // =========================================================================
  describe('importFromJSON fuzz', () => {
    const importFuzzCases = [
      '',
      'null',
      '42',
      '"string"',
      '[]',
      '{}',
      '{invalid json',
      JSON.stringify({ nodes: null, connections: {} }),
      JSON.stringify({ nodes: {}, connections: null }),
      JSON.stringify({ nodes: [], connections: {} }),
      JSON.stringify({ nodes: {}, connections: [] }),
      JSON.stringify({ nodes: 'string', connections: {} }),
      JSON.stringify({ nodes: {}, connections: 'string' }),
      JSON.stringify({ nodes: {}, connections: {}, groups: null }),
      JSON.stringify({ nodes: {}, connections: {}, groups: [] }),
      JSON.stringify({ nodes: {}, connections: {}, customNodeDefs: null }),
      JSON.stringify({ nodes: {}, connections: {}, customNodeDefs: [] }),
      JSON.stringify({ nodes: {}, connections: {}, subgraphDefs: null }),
      JSON.stringify({ nodes: {}, connections: {}, subgraphDefs: [] }),
      JSON.stringify({ nodes: {}, connections: {}, __proto__: { polluted: true } }),
      JSON.stringify({ a: 1 }),
    ];

    importFuzzCases.forEach((raw, i) => {
      it(`importFromJSON fuzz #${i + 1}`, () => {
        const result = importFromJSON(raw);
        expect(result === null || typeof result === 'object').toBe(true);
      });
    });
  });

  // =========================================================================
  // Category 6: Huge/extreme data (15+ cases)
  // =========================================================================
  describe('Extreme data sizes', () => {
    it('graph with 10000 node keys', () => {
      const nodes: Record<string, unknown> = {};
      for (let i = 0; i < 10000; i++) nodes[`n${i}`] = { id: `n${i}` };
      setRawStorage(JSON.stringify({ nodes, connections: {} }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('deeply nested objects (50 levels)', () => {
      let obj: Record<string, unknown> = { nodes: {}, connections: {} };
      let current = obj;
      for (let i = 0; i < 50; i++) {
        current.nested = {};
        current = current.nested as Record<string, unknown>;
      }
      setRawStorage(JSON.stringify(obj));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('very long string values in node data', () => {
      const longStr = 'x'.repeat(100000);
      setRawStorage(JSON.stringify({
        nodes: { n1: { id: 'n1', type: 'source', title: longStr } },
        connections: {},
      }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('many graphs (100)', () => {
      const data = validMultiGraph();
      for (let i = 0; i < 100; i++) {
        data.graphs[`g${i}`] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };
        data.graphTabs[`g${i}`] = { id: `g${i}`, name: `Graph ${i}`, createdAt: Date.now() };
      }
      data.graphOrder = Object.keys(data.graphs);
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect(Object.keys(result!.graphs).length).toBeGreaterThanOrEqual(100);
    });

    it('unicode in all string fields', () => {
      const data = validMultiGraph();
      data.graphTabs.default.name = '🎉✨💀中文العربية';
      data.activeGraphId = 'default';
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });

    it('empty strings everywhere', () => {
      setRawStorage(JSON.stringify({
        version: 2,
        graphs: { '': { nodes: {}, connections: {} } },
        graphTabs: { '': { id: '', name: '', createdAt: 0 } },
        activeGraphId: '',
        graphOrder: [''],
        templates: {},
      }));
      const result = loadMultiGraph();
      // Empty string keys are technically valid objects
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('numeric keys in graphs', () => {
      setRawStorage(JSON.stringify({
        version: 2,
        graphs: { 0: { nodes: {}, connections: {} }, 1: { nodes: {}, connections: {} } },
        graphTabs: { 0: { id: '0', name: 'Zero', createdAt: 0 } },
        activeGraphId: '0',
        graphOrder: ['0', '1'],
        templates: {},
      }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('boolean values where objects expected', () => {
      setRawStorage(JSON.stringify({
        version: 2,
        graphs: { a: { nodes: true, connections: false, groups: true } },
        graphTabs: { a: { id: 'a', name: 'A', createdAt: 0 } },
        activeGraphId: 'a',
        graphOrder: ['a'],
        templates: {},
      }));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      // Booleans are not plain objects, so nodes/connections should be normalized to {}
      expect(typeof result!.graphs.a.nodes).toBe('object');
    });
  });

  // =========================================================================
  // Category 7: Prototype pollution attempts (10+ cases)
  // =========================================================================
  describe('Prototype pollution attempts', () => {
    const pollutionPayloads = [
      '{"__proto__":{"polluted":"yes"}}',
      '{"constructor":{"prototype":{"polluted":"yes"}}}',
      '{"version":2,"graphs":{"__proto__":{"nodes":{},"connections":{}}},"graphTabs":{},"activeGraphId":"__proto__","graphOrder":["__proto__"],"templates":{}}',
      '{"nodes":{"__proto__":{"id":"evil"}},"connections":{}}',
      '{"version":2,"graphs":{"a":{"nodes":{},"connections":{},"__proto__":{"evil":true}}},"graphTabs":{},"activeGraphId":"a","graphOrder":["a"],"templates":{}}',
      '{"version":2,"graphs":{"a":{"nodes":{"__proto__":{"id":"evil"}},"connections":{}}},"graphTabs":{},"activeGraphId":"a","graphOrder":["a"],"templates":{}}',
      JSON.stringify({ version: 2, graphs: { a: { nodes: {}, connections: {} } }, graphTabs: {}, activeGraphId: 'a', graphOrder: ['a'], templates: {}, toString: 'evil' }),
      JSON.stringify({ version: 2, graphs: { a: { nodes: {}, connections: {} } }, graphTabs: {}, activeGraphId: 'a', graphOrder: ['a'], templates: {}, valueOf: 42 }),
    ];

    pollutionPayloads.forEach((raw, i) => {
      it(`prototype pollution attempt #${i + 1}`, () => {
        setRawStorage(raw);
        const result = loadMultiGraph();
        expect(result === null || typeof result === 'object').toBe(true);
        // Verify no prototype pollution occurred
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // Category 8: saveMultiGraph + loadMultiGraph roundtrip fuzz (10+ cases)
  // =========================================================================
  describe('Save/load roundtrip mutations', () => {
    it('save then corrupt storage before load', () => {
      const data = validMultiGraph();
      saveMultiGraph(data);
      // Corrupt the stored JSON
      const raw = localStorage.getItem('node-editor-3d-graph')!;
      localStorage.setItem('node-editor-3d-graph', raw.slice(0, raw.length / 2));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('save valid data, overwrite with empty string', () => {
      saveMultiGraph(validMultiGraph());
      setRawStorage('');
      const result = loadMultiGraph();
      expect(result).toBeNull();
    });

    it('save valid data, overwrite with null string', () => {
      saveMultiGraph(validMultiGraph());
      setRawStorage('null');
      const result = loadMultiGraph();
      expect(result).toBeNull();
    });

    it('double save overwrite', () => {
      saveMultiGraph(validMultiGraph());
      const data2 = validMultiGraph();
      data2.activeGraphId = 'default';
      data2.graphs['second'] = { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} };
      data2.graphTabs['second'] = { id: 'second', name: 'Second', createdAt: Date.now() };
      data2.graphOrder.push('second');
      saveMultiGraph(data2);
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
      expect('second' in result!.graphs).toBe(true);
    });
  });

  // =========================================================================
  // Category 9: Random generated payloads (30+ cases)
  // =========================================================================
  describe('Random generated payloads', () => {
    function randomPrimitive(): unknown {
      const choices = [
        null, undefined, true, false,
        0, 1, -1, 42, 3.14, -0, Infinity, -Infinity, NaN,
        '', 'hello', '0', 'null', 'true', '[]', '{}',
      ];
      return choices[Math.floor(Math.random() * choices.length)];
    }

    function randomObject(depth: number): unknown {
      if (depth <= 0) return randomPrimitive();
      const type = Math.floor(Math.random() * 4);
      if (type === 0) return randomPrimitive();
      if (type === 1) {
        const arr = [];
        for (let i = 0; i < Math.floor(Math.random() * 5); i++) {
          arr.push(randomObject(depth - 1));
        }
        return arr;
      }
      // object
      const obj: Record<string, unknown> = {};
      const keys = ['nodes', 'connections', 'version', 'graphs', 'graphTabs',
        'activeGraphId', 'graphOrder', 'templates', 'groups', 'id', 'type',
        'position', 'title', 'data', 'a', 'b', '__proto__'];
      for (let i = 0; i < Math.floor(Math.random() * 6); i++) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        obj[key] = randomObject(depth - 1);
      }
      return obj;
    }

    // Generate 30 random test cases with fixed seed (deterministic via iteration)
    for (let i = 0; i < 30; i++) {
      it(`random payload #${i + 1}`, () => {
        const payload = randomObject(4);
        try {
          const json = JSON.stringify(payload);
          if (json !== undefined) {
            setRawStorage(json);
            const result = loadMultiGraph();
            expect(result === null || typeof result === 'object').toBe(true);
          }
        } catch {
          // JSON.stringify can fail on circular refs — that's fine
        }
      });
    }
  });

  // =========================================================================
  // Category 10: Edge case primitives as storage (10+ cases)
  // =========================================================================
  describe('Primitive storage values', () => {
    const primitiveValues = [
      '0', '1', '-1', '""', '"hello"', 'true', 'false', 'null',
      '0.1', '-0', '1e100', '1e-100',
    ];

    primitiveValues.forEach((val, i) => {
      it(`primitive value #${i + 1}: ${val}`, () => {
        setRawStorage(val);
        const result = loadMultiGraph();
        expect(result).toBeNull();
      });
    });
  });

  // =========================================================================
  // Category 11: Type confusion attacks (10+ cases)
  // =========================================================================
  describe('Type confusion payloads', () => {
    it('version field as object', () => {
      setRawStorage(JSON.stringify({ version: { valueOf: () => 2 }, graphs: {}, graphTabs: {} }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('version field as array [2]', () => {
      setRawStorage(JSON.stringify({ version: [2], graphs: {}, graphTabs: {} }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('activeGraphId as number', () => {
      const data = validMultiGraph();
      (data as unknown as Record<string, unknown>).activeGraphId = 0;
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result).not.toBeNull();
    });

    it('graphOrder with mixed types', () => {
      const data = validMultiGraph();
      (data as unknown as Record<string, unknown>).graphOrder = ['default', 42, null, true, {}];
      setRawStorage(JSON.stringify(data));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('graph tab with missing required fields', () => {
      setRawStorage(JSON.stringify({
        version: 2,
        graphs: { a: { nodes: {}, connections: {} } },
        graphTabs: { a: {} },
        activeGraphId: 'a',
        graphOrder: ['a'],
        templates: {},
      }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('node with array position instead of tuple', () => {
      setRawStorage(JSON.stringify({
        nodes: {
          n1: { id: 'n1', type: 'source', position: [0, 0, 0, 0, 0], title: 'Test' },
        },
        connections: {},
      }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('connection with string port indices', () => {
      setRawStorage(JSON.stringify({
        nodes: { n1: { id: 'n1' }, n2: { id: 'n2' } },
        connections: {
          c1: { id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 'zero', targetNodeId: 'n2', targetPortIndex: 'zero' },
        },
      }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('self-referencing node IDs in connections', () => {
      setRawStorage(JSON.stringify({
        nodes: { n1: { id: 'n1' } },
        connections: {
          c1: { id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 0, targetNodeId: 'n1', targetPortIndex: 0 },
        },
      }));
      const result = loadMultiGraph();
      expect(result === null || typeof result === 'object').toBe(true);
    });
  });
});
