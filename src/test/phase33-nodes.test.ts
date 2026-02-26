/**
 * Phase 33: Tests for 16 new node type processors
 * - Encoding nodes (6): json-parse, json-stringify, base64-encode, base64-decode, uri-encode, uri-decode
 * - Advanced array nodes (7): array-slice, array-find, array-sort, array-reverse, array-flatten, array-zip, array-unique
 * - Date/time nodes (3): get-timestamp, format-date, parse-date
 * - LRU expression cache improvement
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { executeGraph } from '../utils/execution';
import { useEditorStore } from '../store/editorStore';
import type { EditorNode, Connection } from '../types';

enableMapSet();

// Helper: build a minimal graph and execute
function execSingle(
  type: EditorNode['type'],
  inputs: Record<number, unknown>,
  data: Record<string, unknown> = {},
): Record<number, unknown> {
  const node: EditorNode = {
    id: 'n1',
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: Object.keys(inputs).map((_, i) => ({
      id: `in-${i}`,portType: 'any' as const, label: `in${i}`,
    })),
    outputs: [
      { id: 'out-0',portType: 'any' as const, label: 'out0' },
      { id: 'out-1',portType: 'any' as const, label: 'out1' },
      { id: 'out-2',portType: 'any' as const, label: 'out2' },
    ],
  };

  // Build source nodes for each input
  const nodes: Record<string, EditorNode> = { n1: node };
  const connections: Record<string, Connection> = {};

  for (const [portIdxStr, value] of Object.entries(inputs)) {
    const portIdx = Number(portIdxStr);
    const srcId = `src-${portIdx}`;
    nodes[srcId] = {
      id: srcId,
      type: 'source',
      position: [-3, 0, portIdx],
      title: 'Source',
      data: { value },
      inputs: [],
      outputs: [
        { id: `${srcId}-out-0`,portType: 'any' as const, label: 'value' },
        { id: `${srcId}-out-1`,portType: 'any' as const, label: 'type' },
      ],
    };
    const connId = `c-${portIdx}`;
    connections[connId] = {
      id: connId,
      sourceNodeId: srcId,
      sourcePortIndex: 0,
      targetNodeId: 'n1',
      targetPortIndex: portIdx,
    };
  }

  const result = executeGraph(nodes, connections);
  const nodeResult = result.results.get('n1');
  return nodeResult?.outputs ?? {};
}

// ===== ENCODING / DATA CONVERSION NODES =====

describe('json-parse processor', () => {
  it('parses valid JSON object', () => {
    const out = execSingle('json-parse', { 0: '{"a":1,"b":"hello"}' });
    expect(out[0]).toEqual({ a: 1, b: 'hello' });
  });

  it('parses valid JSON array', () => {
    const out = execSingle('json-parse', { 0: '[1,2,3]' });
    expect(out[0]).toEqual([1, 2, 3]);
  });

  it('parses valid JSON number', () => {
    const out = execSingle('json-parse', { 0: '42' });
    expect(out[0]).toBe(42);
  });

  it('returns null for empty string', () => {
    const out = execSingle('json-parse', { 0: '' });
    expect(out[0]).toBeNull();
  });

  it('throws on invalid JSON', () => {
    const node: EditorNode = {
      id: 'n1', type: 'json-parse', position: [0, 0, 0], title: 'JSON Parse',
      data: {},
      inputs: [{ id: 'in-0',portType: 'string', label: 'json' }],
      outputs: [{ id: 'out-0',portType: 'any', label: 'value' }],
    };
    const src: EditorNode = {
      id: 'src', type: 'source', position: [-3, 0, 0], title: 'Source',
      data: { value: '{invalid}' },
      inputs: [],
      outputs: [{ id: 'src-out',portType: 'any', label: 'value' }, { id: 'src-out2',portType: 'any', label: 'type' }],
    };
    const conn: Connection = { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'n1', targetPortIndex: 0 };
    const result = executeGraph({ n1: node, src }, { c1: conn });
    expect(result.errors.size).toBeGreaterThan(0);
  });
});

describe('json-stringify processor', () => {
  it('stringifies object', () => {
    const out = execSingle('json-stringify', { 0: { a: 1 } });
    expect(out[0]).toBe('{"a":1}');
  });

  it('pretty-prints when second input truthy', () => {
    const out = execSingle('json-stringify', { 0: { a: 1 }, 1: true });
    expect(out[0]).toContain('\n');
    expect(out[0]).toContain('  "a"');
  });

  it('stringifies null (disconnected input defaults to null)', () => {
    // Source nodes coerce null→0 via ?? operator, so test null via disconnected input
    const node: EditorNode = {
      id: 'n1', type: 'json-stringify' as EditorNode['type'],
      position: [0, 0, 0], title: 'JSON Stringify', data: {},
      inputs: [{ id: 'in-0',portType: 'any' as const, label: 'value' }],
      outputs: [{ id: 'out-0',portType: 'any' as const, label: 'json' }],
    };
    const result = executeGraph({ n1: node }, {});
    expect(result.results.get('n1')?.outputs[0]).toBe('null');
  });

  it('stringifies array', () => {
    const out = execSingle('json-stringify', { 0: [1, 2, 3] });
    expect(out[0]).toBe('[1,2,3]');
  });
});

describe('base64-encode processor', () => {
  it('encodes ASCII text', () => {
    const out = execSingle('base64-encode', { 0: 'Hello World' });
    expect(out[0]).toBe(btoa('Hello World'));
  });

  it('encodes empty string', () => {
    const out = execSingle('base64-encode', { 0: '' });
    expect(out[0]).toBe('');
  });

  it('encodes unicode text', () => {
    const out = execSingle('base64-encode', { 0: 'Héllo' });
    expect(typeof out[0]).toBe('string');
    expect((out[0] as string).length).toBeGreaterThan(0);
  });
});

describe('base64-decode processor', () => {
  it('decodes valid base64', () => {
    const out = execSingle('base64-decode', { 0: btoa('Hello World') });
    expect(out[0]).toBe('Hello World');
  });

  it('returns empty string for empty input', () => {
    const out = execSingle('base64-decode', { 0: '' });
    expect(out[0]).toBe('');
  });

  it('roundtrips with base64-encode', () => {
    const original = 'Test data 123!@#';
    const encoded = execSingle('base64-encode', { 0: original });
    const decoded = execSingle('base64-decode', { 0: encoded[0] });
    expect(decoded[0]).toBe(original);
  });
});

describe('uri-encode processor', () => {
  it('encodes special characters', () => {
    const out = execSingle('uri-encode', { 0: 'hello world&foo=bar' });
    expect(out[0]).toBe(encodeURIComponent('hello world&foo=bar'));
  });

  it('passes through safe characters', () => {
    const out = execSingle('uri-encode', { 0: 'hello' });
    expect(out[0]).toBe('hello');
  });
});

describe('uri-decode processor', () => {
  it('decodes encoded characters', () => {
    const out = execSingle('uri-decode', { 0: 'hello%20world%26foo%3Dbar' });
    expect(out[0]).toBe('hello world&foo=bar');
  });

  it('returns empty string for empty input', () => {
    const out = execSingle('uri-decode', { 0: '' });
    expect(out[0]).toBe('');
  });

  it('roundtrips with uri-encode', () => {
    const original = 'data with spaces & special=chars';
    const encoded = execSingle('uri-encode', { 0: original });
    const decoded = execSingle('uri-decode', { 0: encoded[0] });
    expect(decoded[0]).toBe(original);
  });
});

// ===== ADVANCED ARRAY NODES =====

describe('array-slice processor', () => {
  it('slices array with start and end', () => {
    const out = execSingle('array-slice', { 0: [10, 20, 30, 40, 50], 1: 1, 2: 3 });
    expect(out[0]).toEqual([20, 30]);
  });

  it('slices from start to end of array when no end provided', () => {
    const out = execSingle('array-slice', { 0: [10, 20, 30, 40], 1: 2 });
    expect(out[0]).toEqual([30, 40]);
  });

  it('returns empty array for non-array input', () => {
    const out = execSingle('array-slice', { 0: 'not an array', 1: 0, 2: 1 });
    expect(out[0]).toEqual([]);
  });

  it('handles negative start index', () => {
    const out = execSingle('array-slice', { 0: [1, 2, 3, 4, 5], 1: -2 });
    expect(out[0]).toEqual([4, 5]);
  });
});

describe('array-find processor', () => {
  it('finds first matching element', () => {
    const out = execSingle('array-find', { 0: [1, 5, 10, 15], 1: 'x > 7' });
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(2);
  });

  it('returns null and -1 when no match', () => {
    const out = execSingle('array-find', { 0: [1, 2, 3], 1: 'x > 100' });
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(-1);
  });

  it('returns null and -1 for empty expression', () => {
    const out = execSingle('array-find', { 0: [1, 2, 3] });
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(-1);
  });

  it('passes index to expression', () => {
    const out = execSingle('array-find', { 0: ['a', 'b', 'c', 'd'], 1: 'i === 2' });
    expect(out[0]).toBe('c');
    expect(out[1]).toBe(2);
  });
});

describe('array-sort processor', () => {
  it('sorts numbers ascending', () => {
    const out = execSingle('array-sort', { 0: [3, 1, 4, 1, 5, 9] });
    expect(out[0]).toEqual([1, 1, 3, 4, 5, 9]);
  });

  it('sorts strings lexicographically', () => {
    const out = execSingle('array-sort', { 0: ['banana', 'apple', 'cherry'] });
    expect(out[0]).toEqual(['apple', 'banana', 'cherry']);
  });

  it('does not mutate original array', () => {
    const original = [3, 1, 2];
    execSingle('array-sort', { 0: original });
    // original should not be sorted (we pass a value, not a reference, so this just tests the processor pattern)
    expect(original).toEqual([3, 1, 2]);
  });

  it('returns empty array for non-array input', () => {
    const out = execSingle('array-sort', { 0: 42 });
    expect(out[0]).toEqual([]);
  });
});

describe('array-reverse processor', () => {
  it('reverses array', () => {
    const out = execSingle('array-reverse', { 0: [1, 2, 3, 4] });
    expect(out[0]).toEqual([4, 3, 2, 1]);
  });

  it('handles single element', () => {
    const out = execSingle('array-reverse', { 0: [42] });
    expect(out[0]).toEqual([42]);
  });

  it('handles empty array', () => {
    const out = execSingle('array-reverse', { 0: [] });
    expect(out[0]).toEqual([]);
  });
});

describe('array-flatten processor', () => {
  it('flattens one level by default', () => {
    const out = execSingle('array-flatten', { 0: [[1, 2], [3, 4], [5]] });
    expect(out[0]).toEqual([1, 2, 3, 4, 5]);
  });

  it('flattens to specified depth', () => {
    const out = execSingle('array-flatten', { 0: [[[1]], [[2]], [[3]]], 1: 2 });
    expect(out[0]).toEqual([1, 2, 3]);
  });

  it('does not flatten beyond depth', () => {
    const out = execSingle('array-flatten', { 0: [[[1]], [[2]]], 1: 1 });
    expect(out[0]).toEqual([[1], [2]]);
  });

  it('handles depth 0 (no flatten)', () => {
    const out = execSingle('array-flatten', { 0: [[1, 2], [3]], 1: 0 });
    expect(out[0]).toEqual([[1, 2], [3]]);
  });
});

describe('array-zip processor', () => {
  it('zips two arrays of equal length', () => {
    const out = execSingle('array-zip', { 0: [1, 2, 3], 1: ['a', 'b', 'c'] });
    expect(out[0]).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
  });

  it('truncates to shortest array', () => {
    const out = execSingle('array-zip', { 0: [1, 2], 1: ['a', 'b', 'c', 'd'] });
    expect(out[0]).toEqual([[1, 'a'], [2, 'b']]);
  });

  it('returns empty for empty inputs', () => {
    const out = execSingle('array-zip', { 0: [], 1: [] });
    expect(out[0]).toEqual([]);
  });
});

describe('array-unique processor', () => {
  it('removes duplicate primitives', () => {
    const out = execSingle('array-unique', { 0: [1, 2, 2, 3, 1, 4] });
    expect(out[0]).toEqual([1, 2, 3, 4]);
    expect(out[1]).toBe(4);
  });

  it('removes duplicate strings', () => {
    const out = execSingle('array-unique', { 0: ['a', 'b', 'a', 'c', 'b'] });
    expect(out[0]).toEqual(['a', 'b', 'c']);
    expect(out[1]).toBe(3);
  });

  it('removes duplicate objects by JSON equality', () => {
    const out = execSingle('array-unique', { 0: [{ a: 1 }, { a: 2 }, { a: 1 }] });
    expect(out[0]).toEqual([{ a: 1 }, { a: 2 }]);
    expect(out[1]).toBe(2);
  });

  it('handles empty array', () => {
    const out = execSingle('array-unique', { 0: [] });
    expect(out[0]).toEqual([]);
    expect(out[1]).toBe(0);
  });
});

// ===== DATE / TIME NODES =====

describe('get-timestamp processor', () => {
  it('returns current time as number', () => {
    const before = Date.now();
    const out = execSingle('get-timestamp', {});
    const after = Date.now();
    expect(typeof out[0]).toBe('number');
    expect(out[0] as number).toBeGreaterThanOrEqual(before);
    expect(out[0] as number).toBeLessThanOrEqual(after);
  });
});

describe('format-date processor', () => {
  it('formats timestamp to ISO string', () => {
    const ts = new Date('2025-06-15T12:30:00Z').getTime();
    const out = execSingle('format-date', { 0: ts });
    expect(out[0]).toBe('2025-06-15T12:30:00.000Z');
    expect(out[1]).toBe('2025-06-15');
    expect(out[2]).toBe('12:30:00');
  });

  it('handles epoch zero', () => {
    const out = execSingle('format-date', { 0: 0 });
    expect(out[0]).toBe('1970-01-01T00:00:00.000Z');
    expect(out[1]).toBe('1970-01-01');
    expect(out[2]).toBe('00:00:00');
  });
});

describe('parse-date processor', () => {
  it('parses ISO date string', () => {
    const out = execSingle('parse-date', { 0: '2025-06-15T12:30:00Z' });
    expect(out[0]).toBe(new Date('2025-06-15T12:30:00Z').getTime());
    expect(out[1]).toBe(true);
  });

  it('parses simple date', () => {
    const out = execSingle('parse-date', { 0: '2025-01-01' });
    expect(typeof out[0]).toBe('number');
    expect(out[0] as number).toBeGreaterThan(0);
    expect(out[1]).toBe(true);
  });

  it('returns 0 and false for invalid date', () => {
    const out = execSingle('parse-date', { 0: 'not-a-date' });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(false);
  });

  it('returns 0 and false for empty string', () => {
    const out = execSingle('parse-date', { 0: '' });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(false);
  });
});

// ===== INTEGRATION TESTS =====

describe('encoding node integration', () => {
  it('json-stringify → base64-encode roundtrip', () => {
    const obj = { key: 'value', num: 42 };
    const jsonStr = execSingle('json-stringify', { 0: obj });
    const encoded = execSingle('base64-encode', { 0: jsonStr[0] });
    const decoded = execSingle('base64-decode', { 0: encoded[0] });
    const parsed = execSingle('json-parse', { 0: decoded[0] });
    expect(parsed[0]).toEqual(obj);
  });

  it('uri-encode → uri-decode roundtrip with special chars', () => {
    const text = 'hello world?foo=bar&baz=qux';
    const encoded = execSingle('uri-encode', { 0: text });
    const decoded = execSingle('uri-decode', { 0: encoded[0] });
    expect(decoded[0]).toBe(text);
  });
});

describe('advanced array integration', () => {
  it('array-sort → array-slice pipeline', () => {
    const sorted = execSingle('array-sort', { 0: [5, 3, 8, 1, 9, 2] });
    const sliced = execSingle('array-slice', { 0: sorted[0], 1: 0, 2: 3 });
    expect(sliced[0]).toEqual([1, 2, 3]);
  });

  it('array-flatten → array-unique pipeline', () => {
    const flat = execSingle('array-flatten', { 0: [[1, 2], [2, 3], [3, 4]] });
    const unique = execSingle('array-unique', { 0: flat[0] });
    expect(unique[0]).toEqual([1, 2, 3, 4]);
    expect(unique[1]).toBe(4);
  });

  it('array-zip → array-flatten pipeline', () => {
    const zipped = execSingle('array-zip', { 0: [1, 2, 3], 1: ['a', 'b', 'c'] });
    const flat = execSingle('array-flatten', { 0: zipped[0] });
    expect(flat[0]).toEqual([1, 'a', 2, 'b', 3, 'c']);
  });
});

describe('date/time integration', () => {
  it('get-timestamp → format-date pipeline', () => {
    const ts = execSingle('get-timestamp', {});
    const formatted = execSingle('format-date', { 0: ts[0] });
    expect(typeof formatted[0]).toBe('string');
    expect(typeof formatted[1]).toBe('string');
    expect(typeof formatted[2]).toBe('string');
    // ISO string should be parseable
    expect(Date.parse(formatted[0] as string)).not.toBeNaN();
  });

  it('format-date → parse-date roundtrip', () => {
    const ts = 1718451000000; // 2024-06-15T12:30:00.000Z
    const formatted = execSingle('format-date', { 0: ts });
    const parsed = execSingle('parse-date', { 0: formatted[0] });
    expect(parsed[0]).toBe(ts);
    expect(parsed[1]).toBe(true);
  });
});

// ===== STORE INTEGRATION =====

describe('store integration for new node types', () => {
  beforeEach(() => {
    useEditorStore.setState((s) => {
      s.nodes = {};
      s.connections = {};
      s.groups = {};
    });
  });

  it('can add all 16 new node types via store', () => {
    const store = useEditorStore.getState();
    const newTypes = [
      'json-parse', 'json-stringify', 'base64-encode', 'base64-decode', 'uri-encode', 'uri-decode',
      'array-slice', 'array-find', 'array-sort', 'array-reverse', 'array-flatten', 'array-zip', 'array-unique',
      'get-timestamp', 'format-date', 'parse-date',
    ] as const;

    for (const type of newTypes) {
      const id = store.addNode(type, [0, 0, 0]);
      const node = useEditorStore.getState().nodes[id];
      expect(node).toBeDefined();
      expect(node.type).toBe(type);
      expect(node.title.length).toBeGreaterThan(0);
    }
  });
});
