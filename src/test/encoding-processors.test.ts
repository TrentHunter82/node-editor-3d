/**
 * Unit tests for encoding / data conversion processor functions.
 * Covers: json-parse, json-stringify, base64-encode, base64-decode, uri-encode, uri-decode
 * ~30 tests total (5 per processor).
 */
import { describe, it, expect } from 'vitest';
import { enableMapSet } from 'immer';
import { executeGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helper: build a minimal source → processor graph and execute, returning
// the processor node's output map.
// ---------------------------------------------------------------------------
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
      id: `in-${i}`,
      portType: 'any' as const,
      label: `in${i}`,
    })),
    outputs: [
      { id: 'out-0', portType: 'any' as const, label: 'out0' },
      { id: 'out-1', portType: 'any' as const, label: 'out1' },
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
    connections[`c-${portIdx}`] = {
      id: `c-${portIdx}`,
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

// Helper: execute a standalone processor node with NO connected inputs
// (all inputs will be undefined / disconnected).
function execDisconnected(
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
): { outputs: Record<number, unknown>; error?: string } {
  const node: EditorNode = {
    id: 'n1',
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: [{ id: 'in-0', portType: 'any' as const, label: 'in0' }],
    outputs: [{ id: 'out-0', portType: 'any' as const, label: 'out0' }],
  };
  const result = executeGraph({ n1: node }, {});
  return {
    outputs: result.results.get('n1')?.outputs ?? {},
    error: result.errors.get('n1'),
  };
}

// Helper: execute and expect an error on the processor node.
function execExpectError(
  type: EditorNode['type'],
  inputs: Record<number, unknown>,
): string | undefined {
  const node: EditorNode = {
    id: 'n1',
    type,
    position: [0, 0, 0],
    title: type,
    data: {},
    inputs: Object.keys(inputs).map((_, i) => ({
      id: `in-${i}`,
      portType: 'any' as const,
      label: `in${i}`,
    })),
    outputs: [{ id: 'out-0', portType: 'any' as const, label: 'out0' }],
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
    connections[`c-${portIdx}`] = {
      id: `c-${portIdx}`,
      sourceNodeId: srcId,
      sourcePortIndex: 0,
      targetNodeId: 'n1',
      targetPortIndex: portIdx,
    };
  }

  const result = executeGraph(nodes, connections);
  return result.errors.get('n1');
}

// ============================= json-parse ==============================

describe('json-parse processor', () => {
  it('parses a valid JSON object string to an object', () => {
    const out = execSingle('json-parse', { 0: '{"name":"Alice","age":30}' });
    expect(out[0]).toEqual({ name: 'Alice', age: 30 });
  });

  it('parses a valid JSON array string', () => {
    const out = execSingle('json-parse', { 0: '[10,20,30]' });
    expect(out[0]).toEqual([10, 20, 30]);
  });

  it('returns an error for invalid JSON input', () => {
    const err = execExpectError('json-parse', { 0: '{not valid json}' });
    expect(err).toBeDefined();
    expect(err).toContain('Invalid JSON');
  });

  it('returns null for an empty string input', () => {
    const out = execSingle('json-parse', { 0: '' });
    expect(out[0]).toBeNull();
  });

  it('returns null when input is disconnected (undefined coerced to empty)', () => {
    // The processor converts non-string inputs to '' which returns null
    const { outputs } = execDisconnected('json-parse');
    expect(outputs[0]).toBeNull();
  });
});

// =========================== json-stringify =============================

describe('json-stringify processor', () => {
  it('stringifies an object to compact JSON', () => {
    const out = execSingle('json-stringify', { 0: { x: 1, y: 2 } });
    expect(out[0]).toBe('{"x":1,"y":2}');
  });

  it('stringifies an array to JSON', () => {
    const out = execSingle('json-stringify', { 0: ['a', 'b', 'c'] });
    expect(out[0]).toBe('["a","b","c"]');
  });

  it('stringifies primitive values (number, boolean, string)', () => {
    const numOut = execSingle('json-stringify', { 0: 42 });
    expect(numOut[0]).toBe('42');

    const boolOut = execSingle('json-stringify', { 0: true });
    expect(boolOut[0]).toBe('true');

    const strOut = execSingle('json-stringify', { 0: 'hello' });
    expect(strOut[0]).toBe('"hello"');
  });

  it('stringifies null when input is disconnected', () => {
    const { outputs } = execDisconnected('json-stringify');
    expect(outputs[0]).toBe('null');
  });

  it('pretty-prints with indentation when second input is truthy', () => {
    const out = execSingle('json-stringify', { 0: { a: 1, b: 2 }, 1: true });
    expect(out[0]).toContain('\n');
    expect(out[0]).toContain('  ');
    // Verify it is still valid JSON
    expect(JSON.parse(out[0] as string)).toEqual({ a: 1, b: 2 });
  });
});

// ============================ base64-encode =============================

describe('base64-encode processor', () => {
  it('encodes a basic ASCII string', () => {
    const out = execSingle('base64-encode', { 0: 'Hello World' });
    expect(out[0]).toBe(btoa('Hello World'));
  });

  it('encodes a Unicode string correctly', () => {
    // The processor uses btoa(unescape(encodeURIComponent(text)))
    const out = execSingle('base64-encode', { 0: 'Cafe\u0301' });
    expect(typeof out[0]).toBe('string');
    expect((out[0] as string).length).toBeGreaterThan(0);
    // Verify roundtrip: decode should yield original
    const decoded = decodeURIComponent(escape(atob(out[0] as string)));
    expect(decoded).toBe('Cafe\u0301');
  });

  it('handles empty string input', () => {
    const out = execSingle('base64-encode', { 0: '' });
    expect(out[0]).toBe('');
  });

  it('encodes special characters (newlines, tabs, symbols)', () => {
    const input = 'line1\nline2\ttab!@#$%';
    const out = execSingle('base64-encode', { 0: input });
    // Verify the encode-then-decode roundtrip
    const decoded = decodeURIComponent(escape(atob(out[0] as string)));
    expect(decoded).toBe(input);
  });

  it('handles number input by coercing to string via String()', () => {
    const out = execSingle('base64-encode', { 0: 12345 });
    // The processor does String(inputs[0] ?? '') for non-string inputs
    const decoded = atob(out[0] as string);
    expect(decoded).toBe('12345');
  });
});

// ============================ base64-decode =============================

describe('base64-decode processor', () => {
  it('decodes a valid base64 string', () => {
    const out = execSingle('base64-decode', { 0: btoa('Hello World') });
    expect(out[0]).toBe('Hello World');
  });

  it('returns an error for invalid base64 input', () => {
    // Invalid base64 characters should cause atob to throw
    const err = execExpectError('base64-decode', { 0: '!!!invalid-base64!!!' });
    expect(err).toBeDefined();
    expect(err).toContain('Base64 decode error');
  });

  it('handles empty string input by returning empty string', () => {
    const out = execSingle('base64-decode', { 0: '' });
    expect(out[0]).toBe('');
  });

  it('decodes a Unicode string that was base64-encoded', () => {
    // Encode a Unicode string the same way the processor does
    const original = '\u00e9\u00e8\u00ea\u2603'; // accented chars + snowman
    const encoded = btoa(unescape(encodeURIComponent(original)));
    const out = execSingle('base64-decode', { 0: encoded });
    expect(out[0]).toBe(original);
  });

  it('handles padding variations (standard base64 padding)', () => {
    // "a" encodes to "YQ==" (2 pad chars), "ab" to "YWI=" (1 pad char), "abc" to "YWJj" (no pad)
    const out1 = execSingle('base64-decode', { 0: 'YQ==' });
    expect(out1[0]).toBe('a');

    const out2 = execSingle('base64-decode', { 0: 'YWI=' });
    expect(out2[0]).toBe('ab');

    const out3 = execSingle('base64-decode', { 0: 'YWJj' });
    expect(out3[0]).toBe('abc');
  });
});

// ============================== uri-encode ==============================

describe('uri-encode processor', () => {
  it('encodes special URL characters', () => {
    const out = execSingle('uri-encode', { 0: 'key=value&other=test' });
    expect(out[0]).toBe('key%3Dvalue%26other%3Dtest');
  });

  it('preserves alphanumeric characters unchanged', () => {
    const out = execSingle('uri-encode', { 0: 'abcXYZ123' });
    expect(out[0]).toBe('abcXYZ123');
  });

  it('handles empty string input', () => {
    const out = execSingle('uri-encode', { 0: '' });
    expect(out[0]).toBe('');
  });

  it('encodes spaces as %20', () => {
    const out = execSingle('uri-encode', { 0: 'hello world' });
    expect(out[0]).toBe('hello%20world');
  });

  it('encodes Unicode characters', () => {
    const out = execSingle('uri-encode', { 0: 'caf\u00e9' });
    expect(out[0]).toBe(encodeURIComponent('caf\u00e9'));
  });
});

// ============================== uri-decode ==============================

describe('uri-decode processor', () => {
  it('decodes percent-encoded characters', () => {
    const out = execSingle('uri-decode', { 0: 'hello%20world%26foo%3Dbar' });
    expect(out[0]).toBe('hello world&foo=bar');
  });

  it('handles an already-decoded string (passthrough)', () => {
    const out = execSingle('uri-decode', { 0: 'plain-text' });
    expect(out[0]).toBe('plain-text');
  });

  it('returns an error for malformed percent-encoded sequences', () => {
    const err = execExpectError('uri-decode', { 0: '%ZZbadsequence' });
    expect(err).toBeDefined();
    expect(err).toContain('URI decode error');
  });

  it('handles empty string input by returning empty string', () => {
    const out = execSingle('uri-decode', { 0: '' });
    expect(out[0]).toBe('');
  });

  it('decodes a complex URL query string', () => {
    const encoded = 'name%3DJohn%20Doe%26city%3DSan%20Francisco%26q%3D%E2%98%83';
    const out = execSingle('uri-decode', { 0: encoded });
    expect(out[0]).toBe('name=John Doe&city=San Francisco&q=\u2603');
  });
});
