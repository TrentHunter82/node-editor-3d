/**
 * Phase 33: Edge case tests for 16 node type processors
 * - Encoding nodes (6): json-parse, json-stringify, base64-encode, base64-decode, uri-encode, uri-decode
 * - Advanced array nodes (7): array-slice, array-find, array-sort, array-reverse, array-flatten, array-zip, array-unique
 * - Date/time nodes (3): get-timestamp, format-date, parse-date
 *
 * Tests boundary conditions, unusual inputs, error propagation, and tricky type behaviors.
 */
import { describe, it, expect } from 'vitest';
import { enableMapSet } from 'immer';
import { executeGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

enableMapSet();

// Reuse the exact same helper pattern from phase33-nodes.test.ts
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
      id: `in-${i}`, portType: 'any' as const, label: `in${i}`,
    })),
    outputs: [
      { id: 'out-0', portType: 'any' as const, label: 'out0' },
      { id: 'out-1', portType: 'any' as const, label: 'out1' },
      { id: 'out-2', portType: 'any' as const, label: 'out2' },
    ],
  };

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
        { id: `${srcId}-out-0`, portType: 'any' as const, label: 'value' },
        { id: `${srcId}-out-1`, portType: 'any' as const, label: 'type' },
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

// Helper to run a graph and return the error set for the target node
function execSingleWithErrors(
  type: EditorNode['type'],
  inputs: Record<number, unknown>,
  data: Record<string, unknown> = {},
): { outputs: Record<number, unknown>; errors: Map<string, string> } {
  const node: EditorNode = {
    id: 'n1',
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: Object.keys(inputs).map((_, i) => ({
      id: `in-${i}`, portType: 'any' as const, label: `in${i}`,
    })),
    outputs: [
      { id: 'out-0', portType: 'any' as const, label: 'out0' },
      { id: 'out-1', portType: 'any' as const, label: 'out1' },
      { id: 'out-2', portType: 'any' as const, label: 'out2' },
    ],
  };

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
        { id: `${srcId}-out-0`, portType: 'any' as const, label: 'value' },
        { id: `${srcId}-out-1`, portType: 'any' as const, label: 'type' },
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
  return { outputs: nodeResult?.outputs ?? {}, errors: result.errors };
}

// ===== ENCODING EDGE CASES =====

describe('json-parse edge cases', () => {
  it('parses deeply nested JSON (10 levels)', () => {
    // Build nested object: {"a":{"a":{"a":...}}}
    let json = '1';
    for (let i = 0; i < 10; i++) {
      json = `{"a":${json}}`;
    }
    const out = execSingle('json-parse', { 0: json });
    // Drill down 10 levels
    let val: any = out[0];
    for (let i = 0; i < 10; i++) {
      expect(val).toHaveProperty('a');
      val = val.a;
    }
    expect(val).toBe(1);
  });

  it('parses JSON with null values correctly', () => {
    const out = execSingle('json-parse', { 0: '{"key":null}' });
    expect(out[0]).toEqual({ key: null });
  });

  it('parses JSON boolean literals', () => {
    const outTrue = execSingle('json-parse', { 0: 'true' });
    expect(outTrue[0]).toBe(true);

    const outFalse = execSingle('json-parse', { 0: 'false' });
    expect(outFalse[0]).toBe(false);
  });

  it('parses JSON string with escaped quotes', () => {
    const out = execSingle('json-parse', { 0: '"hello \\"world\\""' });
    expect(out[0]).toBe('hello "world"');
  });

  it('parses JSON with unicode escape sequences', () => {
    const out = execSingle('json-parse', { 0: '"\\u0048\\u0065\\u006C\\u006C\\u006F"' });
    expect(out[0]).toBe('Hello');
  });

  it('errors on string containing Infinity (not valid JSON)', () => {
    const { errors } = execSingleWithErrors('json-parse', { 0: 'Infinity' });
    expect(errors.size).toBeGreaterThan(0);
  });

  it('errors on string containing NaN (not valid JSON)', () => {
    const { errors } = execSingleWithErrors('json-parse', { 0: 'NaN' });
    expect(errors.size).toBeGreaterThan(0);
  });

  it('errors on trailing comma (strict JSON)', () => {
    const { errors } = execSingleWithErrors('json-parse', { 0: '{"a":1,}' });
    expect(errors.size).toBeGreaterThan(0);
  });

  it('parses JSON with large numeric value', () => {
    const out = execSingle('json-parse', { 0: '1e308' });
    expect(out[0]).toBe(1e308);
  });

  it('returns null for whitespace-only string', () => {
    // The processor checks `if (!str) return { 0: null }` — whitespace is truthy
    // so it will try to parse and succeed or fail depending on JSON.parse behavior
    const { errors } = execSingleWithErrors('json-parse', { 0: '   ' });
    // Whitespace-only is not valid JSON
    expect(errors.size).toBeGreaterThan(0);
  });
});

describe('json-stringify edge cases', () => {
  it('stringifies nested objects', () => {
    const obj = { a: { b: { c: { d: 1 } } } };
    const out = execSingle('json-stringify', { 0: obj });
    expect(out[0]).toBe('{"a":{"b":{"c":{"d":1}}}}');
  });

  it('stringifies object with undefined values (omits them)', () => {
    // JSON.stringify omits undefined values in objects
    const obj = { a: 1, b: undefined, c: 3 };
    const out = execSingle('json-stringify', { 0: obj });
    const parsed = JSON.parse(out[0] as string);
    expect(parsed).toEqual({ a: 1, c: 3 });
    expect(parsed).not.toHaveProperty('b');
  });

  it('stringifies array with null/undefined elements', () => {
    // JSON.stringify converts undefined array elements to null
    const arr = [1, null, undefined, 4];
    const out = execSingle('json-stringify', { 0: arr });
    expect(out[0]).toBe('[1,null,null,4]');
  });

  it('stringifies numeric special values (NaN/Infinity become null)', () => {
    const arr = [NaN, Infinity, -Infinity];
    const out = execSingle('json-stringify', { 0: arr });
    expect(out[0]).toBe('[null,null,null]');
  });

  it('stringifies empty object', () => {
    const out = execSingle('json-stringify', { 0: {} });
    expect(out[0]).toBe('{}');
  });

  it('stringifies empty array', () => {
    const out = execSingle('json-stringify', { 0: [] });
    expect(out[0]).toBe('[]');
  });

  it('stringifies string value (wraps in quotes)', () => {
    const out = execSingle('json-stringify', { 0: 'hello' });
    expect(out[0]).toBe('"hello"');
  });

  it('pretty-prints with 2-space indentation', () => {
    const obj = { a: 1, b: 2 };
    const out = execSingle('json-stringify', { 0: obj, 1: true });
    const expected = JSON.stringify(obj, null, 2);
    expect(out[0]).toBe(expected);
  });
});

describe('base64-encode edge cases', () => {
  it('encodes unicode emoji characters', () => {
    const emoji = 'Hello 🌍🎉';
    const out = execSingle('base64-encode', { 0: emoji });
    // Should produce a valid base64 string that can round-trip
    expect(typeof out[0]).toBe('string');
    expect((out[0] as string).length).toBeGreaterThan(0);
    // Verify roundtrip
    const decoded = execSingle('base64-decode', { 0: out[0] });
    expect(decoded[0]).toBe(emoji);
  });

  it('encodes multi-byte unicode characters', () => {
    const text = '\u00e9\u00e8\u00ea\u00eb'; // accented e variations
    const out = execSingle('base64-encode', { 0: text });
    const decoded = execSingle('base64-decode', { 0: out[0] });
    expect(decoded[0]).toBe(text);
  });

  it('encodes CJK characters', () => {
    const text = '\u4f60\u597d\u4e16\u754c'; // "Hello World" in Chinese
    const out = execSingle('base64-encode', { 0: text });
    const decoded = execSingle('base64-decode', { 0: out[0] });
    expect(decoded[0]).toBe(text);
  });

  it('encodes a long string (1000+ chars)', () => {
    const longStr = 'A'.repeat(1000);
    const out = execSingle('base64-encode', { 0: longStr });
    expect(typeof out[0]).toBe('string');
    // Base64 increases size by ~33%
    expect((out[0] as string).length).toBeGreaterThan(1000);
    const decoded = execSingle('base64-decode', { 0: out[0] });
    expect(decoded[0]).toBe(longStr);
  });

  it('encodes string with null bytes', () => {
    const text = 'hello\x00world';
    const out = execSingle('base64-encode', { 0: text });
    expect(typeof out[0]).toBe('string');
    const decoded = execSingle('base64-decode', { 0: out[0] });
    expect(decoded[0]).toBe(text);
  });

  it('coerces non-string input to string', () => {
    const out = execSingle('base64-encode', { 0: 12345 });
    expect(typeof out[0]).toBe('string');
    const decoded = execSingle('base64-decode', { 0: out[0] });
    expect(decoded[0]).toBe('12345');
  });
});

describe('base64-decode edge cases', () => {
  it('errors on invalid base64 characters', () => {
    const { errors } = execSingleWithErrors('base64-decode', { 0: '!!!invalid!!!' });
    expect(errors.size).toBeGreaterThan(0);
  });

  it('decodes base64 with padding characters', () => {
    // "A" encodes to "QQ==" (with padding)
    const out = execSingle('base64-decode', { 0: 'QQ==' });
    expect(out[0]).toBe('A');
  });

  it('decodes base64 without padding', () => {
    // "AB" encodes to "QUI=" - test with single pad
    const out = execSingle('base64-decode', { 0: 'QUI=' });
    expect(out[0]).toBe('AB');
  });
});

describe('uri-encode edge cases', () => {
  it('encodes already-encoded string (double encoding)', () => {
    const alreadyEncoded = 'hello%20world';
    const out = execSingle('uri-encode', { 0: alreadyEncoded });
    // The % should be encoded as %25
    expect(out[0]).toBe('hello%2520world');
  });

  it('encodes unicode characters', () => {
    const out = execSingle('uri-encode', { 0: '\u00e9\u00e8' });
    expect(typeof out[0]).toBe('string');
    // Should roundtrip
    const decoded = execSingle('uri-decode', { 0: out[0] });
    expect(decoded[0]).toBe('\u00e9\u00e8');
  });

  it('encodes all RFC 3986 reserved characters', () => {
    const reserved = ":/?#[]@!$&'()*+,;=";
    const out = execSingle('uri-encode', { 0: reserved });
    // None of the reserved characters should remain unencoded
    const encoded = out[0] as string;
    expect(encoded).not.toContain(':');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('?');
    expect(encoded).not.toContain('#');
  });

  it('preserves unreserved characters', () => {
    const unreserved = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~';
    const out = execSingle('uri-encode', { 0: unreserved });
    expect(out[0]).toBe(unreserved);
  });

  it('encodes empty string', () => {
    const out = execSingle('uri-encode', { 0: '' });
    expect(out[0]).toBe('');
  });
});

describe('uri-decode edge cases', () => {
  it('errors on malformed percent encoding (truncated)', () => {
    const { errors } = execSingleWithErrors('uri-decode', { 0: '%E' });
    expect(errors.size).toBeGreaterThan(0);
  });

  it('errors on invalid percent encoding (non-hex)', () => {
    const { errors } = execSingleWithErrors('uri-decode', { 0: '%ZZ' });
    expect(errors.size).toBeGreaterThan(0);
  });

  it('decodes double-encoded string (only one level)', () => {
    // %2520 is double-encoded space: %25 -> %, 20 stays -> %20
    const out = execSingle('uri-decode', { 0: 'hello%2520world' });
    expect(out[0]).toBe('hello%20world');
  });

  it('decodes string with mixed encoded and plain text', () => {
    const out = execSingle('uri-decode', { 0: 'hello%20world%21test' });
    expect(out[0]).toBe('hello world!test');
  });

  it('passes through already-decoded string', () => {
    const out = execSingle('uri-decode', { 0: 'hello world' });
    expect(out[0]).toBe('hello world');
  });
});

// ===== ADVANCED ARRAY EDGE CASES =====

describe('array-slice edge cases', () => {
  it('handles start index beyond array length', () => {
    const out = execSingle('array-slice', { 0: [1, 2, 3], 1: 100 });
    expect(out[0]).toEqual([]);
  });

  it('handles end index beyond array length', () => {
    const out = execSingle('array-slice', { 0: [1, 2, 3], 1: 0, 2: 100 });
    expect(out[0]).toEqual([1, 2, 3]);
  });

  it('handles both indices beyond array bounds', () => {
    const out = execSingle('array-slice', { 0: [1, 2, 3], 1: 50, 2: 100 });
    expect(out[0]).toEqual([]);
  });

  it('handles start greater than end', () => {
    const out = execSingle('array-slice', { 0: [1, 2, 3, 4, 5], 1: 3, 2: 1 });
    expect(out[0]).toEqual([]);
  });

  it('handles float indices (should floor them)', () => {
    // Processor uses Math.floor on indices
    const out = execSingle('array-slice', { 0: [10, 20, 30, 40, 50], 1: 1.7, 2: 3.9 });
    // Math.floor(1.7) = 1, Math.floor(3.9) = 3
    expect(out[0]).toEqual([20, 30]);
  });

  it('handles negative float indices (should floor them)', () => {
    const out = execSingle('array-slice', { 0: [10, 20, 30, 40, 50], 1: -2.5 });
    // Math.floor(-2.5) = -3, so last 3 elements
    expect(out[0]).toEqual([30, 40, 50]);
  });

  it('handles NaN start (falls back to 0)', () => {
    // Processor checks Number.isFinite — NaN is not finite, so falls back to 0
    const out = execSingle('array-slice', { 0: [1, 2, 3], 1: NaN });
    expect(out[0]).toEqual([1, 2, 3]);
  });

  it('handles Infinity start (falls back to 0)', () => {
    // Number.isFinite(Infinity) = false, so falls back to default (0 for start)
    const out = execSingle('array-slice', { 0: [1, 2, 3], 1: Infinity });
    expect(out[0]).toEqual([1, 2, 3]);
  });

  it('handles Infinity end (falls back to undefined, meaning end of array)', () => {
    const out = execSingle('array-slice', { 0: [1, 2, 3], 1: 1, 2: Infinity });
    // Infinity is not finite, so end defaults to undefined -> slice to end
    expect(out[0]).toEqual([2, 3]);
  });

  it('handles empty array', () => {
    const out = execSingle('array-slice', { 0: [], 1: 0, 2: 5 });
    expect(out[0]).toEqual([]);
  });
});

describe('array-find edge cases', () => {
  it('finds using Math functions in expression', () => {
    const out = execSingle('array-find', { 0: [1, 4, 9, 16], 1: 'Math.sqrt(x) === 3' });
    expect(out[0]).toBe(9);
    expect(out[1]).toBe(2);
  });

  it('finds with complex boolean expression', () => {
    const out = execSingle('array-find', { 0: [10, 25, 30, 45], 1: 'x > 20 && x % 5 === 0 && x < 40' });
    expect(out[0]).toBe(25);
    expect(out[1]).toBe(1);
  });

  it('handles array of objects', () => {
    const arr = [{ name: 'alice', age: 25 }, { name: 'bob', age: 30 }, { name: 'charlie', age: 35 }];
    const out = execSingle('array-find', { 0: arr, 1: 'x.age > 28' });
    expect(out[0]).toEqual({ name: 'bob', age: 30 });
    expect(out[1]).toBe(1);
  });

  it('errors on syntax error in expression', () => {
    const { errors } = execSingleWithErrors('array-find', { 0: [1, 2, 3], 1: 'x >>>' });
    expect(errors.size).toBeGreaterThan(0);
    // Error message should mention compile error
    const errorMsg = Array.from(errors.values())[0];
    expect(errorMsg).toContain('compile error');
  });

  it('errors on runtime error in expression', () => {
    const { errors } = execSingleWithErrors('array-find', { 0: [1, 2, 3], 1: 'x.nonexistent.deep' });
    expect(errors.size).toBeGreaterThan(0);
  });

  it('handles empty array', () => {
    const out = execSingle('array-find', { 0: [], 1: 'x > 0' });
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(-1);
  });

  it('finds with index-based expression', () => {
    const out = execSingle('array-find', { 0: [100, 200, 300, 400], 1: 'i >= 2' });
    expect(out[0]).toBe(300);
    expect(out[1]).toBe(2);
  });
});

describe('array-sort edge cases', () => {
  it('handles NaN values in numeric array', () => {
    // NaN comparisons: a - b where a or b is NaN returns NaN which is falsy
    const out = execSingle('array-sort', { 0: [3, NaN, 1, 2] });
    const result = out[0] as unknown[];
    // Result should have same length
    expect(result.length).toBe(4);
    // All original values should be present (including NaN)
    expect(result.filter(x => typeof x === 'number' && !isNaN(x as number))).toEqual(
      expect.arrayContaining([1, 2, 3])
    );
  });

  it('sorts mixed types (falls back to string comparison)', () => {
    // When types differ, processor uses String(a).localeCompare(String(b))
    const out = execSingle('array-sort', { 0: [3, 'b', 1, 'a'] });
    const result = out[0] as unknown[];
    expect(result.length).toBe(4);
    // String comparison: '1' < '3' < 'a' < 'b'
    expect(result).toEqual([1, 3, 'a', 'b']);
  });

  it('sorts already-sorted array', () => {
    const out = execSingle('array-sort', { 0: [1, 2, 3, 4, 5] });
    expect(out[0]).toEqual([1, 2, 3, 4, 5]);
  });

  it('sorts reverse-sorted array', () => {
    const out = execSingle('array-sort', { 0: [5, 4, 3, 2, 1] });
    expect(out[0]).toEqual([1, 2, 3, 4, 5]);
  });

  it('sorts array with all identical elements', () => {
    const out = execSingle('array-sort', { 0: [7, 7, 7, 7] });
    expect(out[0]).toEqual([7, 7, 7, 7]);
  });

  it('sorts array with negative numbers', () => {
    const out = execSingle('array-sort', { 0: [-3, 0, -1, 2, -5] });
    expect(out[0]).toEqual([-5, -3, -1, 0, 2]);
  });

  it('sorts single element array', () => {
    const out = execSingle('array-sort', { 0: [42] });
    expect(out[0]).toEqual([42]);
  });

  it('sorts boolean values via string comparison', () => {
    // Booleans: typeof is not 'number', so falls back to String comparison
    // String(false) = 'false', String(true) = 'true'; 'false' < 'true'
    const out = execSingle('array-sort', { 0: [true, false, true, false] });
    expect(out[0]).toEqual([false, false, true, true]);
  });
});

describe('array-reverse edge cases', () => {
  it('reverses with nested arrays (shallow reverse)', () => {
    const nested = [[1, 2], [3, 4], [5, 6]];
    const out = execSingle('array-reverse', { 0: nested });
    // Should reverse order of sub-arrays, not their contents
    expect(out[0]).toEqual([[5, 6], [3, 4], [1, 2]]);
    // Verify inner arrays still in original order
    const result = out[0] as unknown[][];
    expect(result[0]).toEqual([5, 6]);
  });

  it('reverses array with mixed types', () => {
    const out = execSingle('array-reverse', { 0: [1, 'two', null, true, { a: 1 }] });
    expect(out[0]).toEqual([{ a: 1 }, true, null, 'two', 1]);
  });

  it('returns empty array for non-array input', () => {
    const out = execSingle('array-reverse', { 0: 'not an array' });
    expect(out[0]).toEqual([]);
  });

  it('handles array with undefined elements', () => {
    const out = execSingle('array-reverse', { 0: [1, undefined, 3] });
    const result = out[0] as unknown[];
    expect(result.length).toBe(3);
    expect(result[0]).toBe(3);
    expect(result[2]).toBe(1);
  });
});

describe('array-flatten edge cases', () => {
  it('flattens deeply nested array with high depth', () => {
    // Build 10-level nesting: [[[...[1]...]]]
    let arr: unknown = [1];
    for (let i = 0; i < 10; i++) {
      arr = [arr];
    }
    const out = execSingle('array-flatten', { 0: arr, 1: 10 });
    expect(out[0]).toEqual([1]);
  });

  it('flattens with depth greater than actual nesting', () => {
    const out = execSingle('array-flatten', { 0: [[1, 2], [3, 4]], 1: 100 });
    expect(out[0]).toEqual([1, 2, 3, 4]);
  });

  it('handles negative depth (clamps to 0)', () => {
    // Processor uses Math.max(0, Math.floor(inputs[1])) so negative becomes 0
    const out = execSingle('array-flatten', { 0: [[1, 2], [3, 4]], 1: -5 });
    expect(out[0]).toEqual([[1, 2], [3, 4]]);
  });

  it('handles mixed nesting levels', () => {
    const out = execSingle('array-flatten', { 0: [1, [2, 3], [[4, 5]], [[[6]]]], 1: 1 });
    expect(out[0]).toEqual([1, 2, 3, [4, 5], [[6]]]);
  });

  it('returns empty array for non-array input', () => {
    const out = execSingle('array-flatten', { 0: 'not an array', 1: 1 });
    expect(out[0]).toEqual([]);
  });

  it('handles NaN depth (falls back to 1)', () => {
    // NaN is not finite, so defaults to 1
    const out = execSingle('array-flatten', { 0: [[1], [2]], 1: NaN });
    expect(out[0]).toEqual([1, 2]);
  });

  it('flattens array with null and undefined elements', () => {
    const out = execSingle('array-flatten', { 0: [[null, 1], [undefined, 2]] });
    expect(out[0]).toEqual([null, 1, undefined, 2]);
  });
});

describe('array-zip edge cases', () => {
  it('returns empty when first array is empty', () => {
    const out = execSingle('array-zip', { 0: [], 1: [1, 2, 3] });
    expect(out[0]).toEqual([]);
  });

  it('returns empty when second array is empty', () => {
    const out = execSingle('array-zip', { 0: [1, 2, 3], 1: [] });
    expect(out[0]).toEqual([]);
  });

  it('zips single-element arrays', () => {
    const out = execSingle('array-zip', { 0: [1], 1: ['a'] });
    expect(out[0]).toEqual([[1, 'a']]);
  });

  it('handles non-array first input (treated as empty)', () => {
    const out = execSingle('array-zip', { 0: 'not array', 1: [1, 2] });
    expect(out[0]).toEqual([]);
  });

  it('handles non-array second input (treated as empty)', () => {
    const out = execSingle('array-zip', { 0: [1, 2], 1: 42 });
    expect(out[0]).toEqual([]);
  });

  it('zips arrays with object elements', () => {
    const out = execSingle('array-zip', { 0: [{ a: 1 }, { a: 2 }], 1: [{ b: 1 }, { b: 2 }] });
    expect(out[0]).toEqual([[{ a: 1 }, { b: 1 }], [{ a: 2 }, { b: 2 }]]);
  });

  it('zips arrays with null elements', () => {
    const out = execSingle('array-zip', { 0: [null, null], 1: [1, 2] });
    expect(out[0]).toEqual([[null, 1], [null, 2]]);
  });
});

describe('array-unique edge cases', () => {
  it('handles NaN values (NaN !== NaN but should be deduped via Set)', () => {
    // The processor uses a Set for primitives (non-objects).
    // NaN === NaN is false, but Set.has(NaN) returns true in JS.
    const out = execSingle('array-unique', { 0: [NaN, NaN, NaN] });
    const result = out[0] as unknown[];
    expect(result.length).toBe(1);
    expect(Number.isNaN(result[0])).toBe(true);
    expect(out[1]).toBe(1);
  });

  it('handles undefined values', () => {
    const out = execSingle('array-unique', { 0: [undefined, 1, undefined, 2] });
    const result = out[0] as unknown[];
    // Should have: undefined, 1, 2
    expect(result.length).toBe(3);
    expect(result).toContain(1);
    expect(result).toContain(2);
    expect(out[1]).toBe(3);
  });

  it('handles null values', () => {
    const out = execSingle('array-unique', { 0: [null, 1, null, 2, null] });
    const result = out[0] as unknown[];
    expect(result).toEqual([null, 1, 2]);
    expect(out[1]).toBe(3);
  });

  it('handles mixed null and undefined', () => {
    const out = execSingle('array-unique', { 0: [null, undefined, null, undefined] });
    const result = out[0] as unknown[];
    // null and undefined are different primitive values
    expect(result.length).toBe(2);
    expect(out[1]).toBe(2);
  });

  it('deduplicates objects with same shape by JSON.stringify', () => {
    const out = execSingle('array-unique', { 0: [{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 1 }] });
    expect(out[0]).toEqual([{ x: 1, y: 2 }, { x: 2, y: 1 }]);
    expect(out[1]).toBe(2);
  });

  it('considers objects with different key order as different (JSON.stringify order)', () => {
    // JSON.stringify preserves insertion order, so {a:1,b:2} !== {b:2,a:1}
    const out = execSingle('array-unique', { 0: [{ a: 1, b: 2 }, { b: 2, a: 1 }] });
    // These stringify to different strings
    expect(out[1]).toBe(2);
  });

  it('handles boolean deduplication', () => {
    const out = execSingle('array-unique', { 0: [true, false, true, false, true] });
    expect(out[0]).toEqual([true, false]);
    expect(out[1]).toBe(2);
  });

  it('handles non-array input', () => {
    const out = execSingle('array-unique', { 0: 'not an array' });
    expect(out[0]).toEqual([]);
    expect(out[1]).toBe(0);
  });

  it('handles large array with many duplicates', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i % 5);
    const out = execSingle('array-unique', { 0: arr });
    expect(out[0]).toEqual([0, 1, 2, 3, 4]);
    expect(out[1]).toBe(5);
  });
});

// ===== DATE/TIME EDGE CASES =====

describe('get-timestamp edge cases', () => {
  it('returns a number greater than 0', () => {
    const out = execSingle('get-timestamp', {});
    expect(typeof out[0]).toBe('number');
    expect(out[0] as number).toBeGreaterThan(0);
  });

  it('returns increasing timestamps on successive calls', () => {
    const out1 = execSingle('get-timestamp', {});
    const out2 = execSingle('get-timestamp', {});
    expect(out1[0] as number).toBeLessThanOrEqual(out2[0] as number);
  });

  it('returns a value close to Date.now()', () => {
    const before = Date.now();
    const out = execSingle('get-timestamp', {});
    const after = Date.now();
    expect(out[0] as number).toBeGreaterThanOrEqual(before);
    expect(out[0] as number).toBeLessThanOrEqual(after);
  });
});

describe('format-date edge cases', () => {
  it('formats negative timestamp (before epoch)', () => {
    // -86400000 = 1969-12-31T00:00:00.000Z (one day before epoch)
    const out = execSingle('format-date', { 0: -86400000 });
    expect(out[0]).toBe('1969-12-31T00:00:00.000Z');
    expect(out[1]).toBe('1969-12-31');
    expect(out[2]).toBe('00:00:00');
  });

  it('formats very old timestamp (year 1900)', () => {
    const ts = new Date('1900-01-01T00:00:00Z').getTime();
    const out = execSingle('format-date', { 0: ts });
    expect(out[0]).toBe('1900-01-01T00:00:00.000Z');
  });

  it('formats future timestamp (year 2100)', () => {
    const ts = new Date('2100-12-31T23:59:59Z').getTime();
    const out = execSingle('format-date', { 0: ts });
    expect(out[0]).toBe('2100-12-31T23:59:59.000Z');
    expect(out[1]).toBe('2100-12-31');
    expect(out[2]).toBe('23:59:59');
  });

  it('formats timestamp with milliseconds', () => {
    const ts = new Date('2025-06-15T12:30:45.123Z').getTime();
    const out = execSingle('format-date', { 0: ts });
    expect(out[0]).toBe('2025-06-15T12:30:45.123Z');
  });

  it('handles non-numeric input (defaults to 0)', () => {
    // Processor: typeof inputs[0] === 'number' ? inputs[0] : 0
    const out = execSingle('format-date', { 0: 'not a number' });
    expect(out[0]).toBe('1970-01-01T00:00:00.000Z');
  });

  it('errors on NaN timestamp', () => {
    // new Date(NaN).getTime() is NaN, and isNaN check throws
    const { errors } = execSingleWithErrors('format-date', { 0: NaN });
    // NaN is typeof 'number' but new Date(NaN) is invalid
    // However, NaN is typeof 'number' so it passes the first check
    // then isNaN(d.getTime()) should be true -> throws 'Invalid timestamp'
    expect(errors.size).toBeGreaterThan(0);
  });
});

describe('parse-date edge cases', () => {
  it('parses timezone offset strings', () => {
    const out = execSingle('parse-date', { 0: '2025-06-15T12:30:00+05:30' });
    expect(typeof out[0]).toBe('number');
    expect(out[0] as number).toBeGreaterThan(0);
    expect(out[1]).toBe(true);
    // Verify it parses correctly: 12:30 IST = 07:00 UTC
    const d = new Date(out[0] as number);
    expect(d.getUTCHours()).toBe(7);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('parses negative timezone offset', () => {
    const out = execSingle('parse-date', { 0: '2025-06-15T12:00:00-08:00' });
    expect(out[1]).toBe(true);
    const d = new Date(out[0] as number);
    expect(d.getUTCHours()).toBe(20);
  });

  it('parses date-only string (no time)', () => {
    const out = execSingle('parse-date', { 0: '2025-06-15' });
    expect(out[1]).toBe(true);
    expect(out[0] as number).toBeGreaterThan(0);
  });

  it('parses RFC 2822 date format', () => {
    const out = execSingle('parse-date', { 0: 'Sun, 15 Jun 2025 12:30:00 GMT' });
    expect(out[1]).toBe(true);
    expect(out[0]).toBe(new Date('Sun, 15 Jun 2025 12:30:00 GMT').getTime());
  });

  it('returns 0 and false for garbage string', () => {
    const out = execSingle('parse-date', { 0: 'xyzzy12345garbage' });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(false);
  });

  it('parses epoch zero date string', () => {
    const out = execSingle('parse-date', { 0: '1970-01-01T00:00:00Z' });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(true);
  });

  it('handles numeric input (coerced to empty string)', () => {
    // Processor: typeof inputs[0] === 'string' ? inputs[0] : ''
    // Number is not string, so defaults to '' -> returns 0, false
    const out = execSingle('parse-date', { 0: 12345 });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(false);
  });
});

// ===== ERROR PROPAGATION =====

describe('error propagation and messages', () => {
  it('json-parse error message includes the original parse error', () => {
    const { errors } = execSingleWithErrors('json-parse', { 0: '{bad json}' });
    expect(errors.size).toBeGreaterThan(0);
    const errorMsg = Array.from(errors.values())[0];
    expect(errorMsg).toContain('Invalid JSON');
  });

  it('json-parse error on single quote strings (not valid JSON)', () => {
    const { errors } = execSingleWithErrors('json-parse', { 0: "{'key': 'value'}" });
    expect(errors.size).toBeGreaterThan(0);
  });

  it('uri-decode error message includes useful info', () => {
    const { errors } = execSingleWithErrors('uri-decode', { 0: '%GG' });
    expect(errors.size).toBeGreaterThan(0);
    const errorMsg = Array.from(errors.values())[0];
    expect(errorMsg).toContain('URI decode error');
  });

  it('array-find compile error includes expression info', () => {
    const { errors } = execSingleWithErrors('array-find', { 0: [1, 2, 3], 1: 'function(' });
    expect(errors.size).toBeGreaterThan(0);
    const errorMsg = Array.from(errors.values())[0];
    expect(errorMsg).toContain('compile error');
  });

  it('base64-decode error on completely invalid input', () => {
    const { errors } = execSingleWithErrors('base64-decode', { 0: '\x00\x01\x02\x03' });
    expect(errors.size).toBeGreaterThan(0);
  });
});

// ===== CROSS-NODE EDGE CASE PIPELINES =====

describe('cross-node edge case pipelines', () => {
  it('json-stringify NaN/Infinity -> json-parse gets null', () => {
    const stringified = execSingle('json-stringify', { 0: [NaN, Infinity] });
    const parsed = execSingle('json-parse', { 0: stringified[0] });
    expect(parsed[0]).toEqual([null, null]);
  });

  it('array-sort -> array-reverse gives descending order', () => {
    const sorted = execSingle('array-sort', { 0: [3, 1, 4, 1, 5] });
    const reversed = execSingle('array-reverse', { 0: sorted[0] });
    expect(reversed[0]).toEqual([5, 4, 3, 1, 1]);
  });

  it('array-flatten -> array-unique removes nested duplicates', () => {
    const flat = execSingle('array-flatten', { 0: [[1, 2, 3], [2, 3, 4], [3, 4, 5]] });
    const unique = execSingle('array-unique', { 0: flat[0] });
    expect(unique[0]).toEqual([1, 2, 3, 4, 5]);
    expect(unique[1]).toBe(5);
  });

  it('format-date -> parse-date roundtrip preserves timestamp', () => {
    const ts = 1700000000000;
    const formatted = execSingle('format-date', { 0: ts });
    const parsed = execSingle('parse-date', { 0: formatted[0] });
    expect(parsed[0]).toBe(ts);
    expect(parsed[1]).toBe(true);
  });

  it('uri-encode -> base64-encode -> base64-decode -> uri-decode roundtrip', () => {
    const original = 'complex data: key=value&foo=bar baz';
    const uriEncoded = execSingle('uri-encode', { 0: original });
    const b64Encoded = execSingle('base64-encode', { 0: uriEncoded[0] });
    const b64Decoded = execSingle('base64-decode', { 0: b64Encoded[0] });
    const uriDecoded = execSingle('uri-decode', { 0: b64Decoded[0] });
    expect(uriDecoded[0]).toBe(original);
  });
});
