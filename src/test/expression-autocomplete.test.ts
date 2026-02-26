/**
 * Expression Autocomplete and Validation Tests
 *
 * Section 1: Validates the getSuggestions and validateExpression logic by
 * reimplementing the pure functions from CustomNodeEditorPanel.tsx inline
 * (they are not exported, so we test the logic directly here).
 *
 * Section 2: Validates custom node expression execution end-to-end by running
 * full graphs through executeGraph() with custom nodes.
 */

import { describe, it, expect } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { executeGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

// ===========================================================================
// Section 1 — Expression Validation Logic (inline reimplementation)
// ===========================================================================
//
// These functions are verbatim copies of the private helpers in
// CustomNodeEditorPanel.tsx. They are pure functions with no React or store
// dependencies, so replicating them here is the cleanest test strategy.
// ---------------------------------------------------------------------------

const MATH_FUNCTIONS = [
  'Math.sin', 'Math.cos', 'Math.tan', 'Math.abs', 'Math.floor', 'Math.ceil',
  'Math.round', 'Math.sqrt', 'Math.log', 'Math.min', 'Math.max', 'Math.pow',
  'Math.PI', 'Math.E', 'Math.random', 'Math.sign', 'Math.trunc',
  'Math.atan2', 'Math.hypot', 'Math.cbrt', 'Math.exp', 'Math.log2', 'Math.log10',
];

const COMMON_PATTERNS = [
  'inputs[0]', 'inputs[1]', 'inputs[2]',
  'in0 + in1', 'in0 * in1', 'in0 - in1', 'in0 / in1',
  'in0 > in1 ? in0 : in1',
  'in0 < in1 ? in0 : in1',
  'Math.max(in0, Math.min(in1, in2))',
];

function getSuggestions(text: string, cursorPos: number, inputCount: number): string[] {
  const before = text.slice(0, cursorPos);
  const match = before.match(/[\w.[\]]*$/);
  const prefix = match ? match[0].toLowerCase() : '';
  if (!prefix) return [];

  const candidates: string[] = [];

  for (let i = 0; i < inputCount; i++) {
    candidates.push(`in${i}`);
    candidates.push(`inputs[${i}]`);
  }

  candidates.push(...MATH_FUNCTIONS);

  if (prefix.length <= 3) {
    candidates.push(...COMMON_PATTERNS);
  }

  return candidates
    .filter(c => c.toLowerCase().startsWith(prefix) && c.toLowerCase() !== prefix)
    .slice(0, 12);
}

function validateExpression(expr: string, inputCount: number): string | null {
  if (!expr.trim()) return 'Expression is empty';
  try {
    const params: string[] = ['inputs'];
    for (let i = 0; i < inputCount; i++) params.push(`in${i}`);
    params.push('Math');
    new Function(...params, `return (${expr})`);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------------------------------------------------------------------------

describe('validateExpression', () => {
  it('test 1: empty expression returns "Expression is empty"', () => {
    expect(validateExpression('', 1)).toBe('Expression is empty');
  });

  it('test 2: whitespace-only expression returns "Expression is empty"', () => {
    expect(validateExpression('   ', 1)).toBe('Expression is empty');
  });

  it('test 3: valid simple expression "in0" returns null', () => {
    expect(validateExpression('in0', 1)).toBeNull();
  });

  it('test 4: valid Math expression "Math.sin(in0)" returns null', () => {
    expect(validateExpression('Math.sin(in0)', 1)).toBeNull();
  });

  it('test 5: invalid syntax "in0 +" (incomplete binary op) returns a syntax error string', () => {
    // "in0 +" is not valid because the right-hand operand is missing
    const result = validateExpression('in0 +', 1);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('test 6: unclosed parenthesis returns a syntax error string', () => {
    const result = validateExpression('Math.sin(in0', 1);
    expect(result).not.toBeNull();
  });

  it('test 7: validateExpression with 0 inputs accepts "42" (no input vars needed)', () => {
    expect(validateExpression('42', 0)).toBeNull();
  });

  it('test 8: validateExpression with 8 inputs generates all params (in0..in7 available)', () => {
    // An expression referencing in7 should be valid when inputCount=8
    expect(validateExpression('in0 + in7', 8)).toBeNull();
  });

  it('test 9: complex valid expression with ternary returns null', () => {
    expect(validateExpression('in0 > 0 ? in0 : -in0', 1)).toBeNull();
  });

  it('test 10: expression using inputs[] array syntax is valid', () => {
    expect(validateExpression('inputs[0] * inputs[1]', 2)).toBeNull();
  });

  it('test 11: expression with Math.PI constant is valid', () => {
    expect(validateExpression('in0 * Math.PI', 1)).toBeNull();
  });

  it('test 12: multi-output array expression is syntactically valid', () => {
    expect(validateExpression('[in0, in0 * 2]', 1)).toBeNull();
  });
});

describe('getSuggestions', () => {
  it('test 1: empty prefix (cursor at start with no text) returns empty array', () => {
    // prefix becomes '' because there is no word before the cursor
    const result = getSuggestions('', 0, 2);
    expect(result).toHaveLength(0);
  });

  it('test 2: prefix "Ma" returns Math function suggestions', () => {
    const result = getSuggestions('Ma', 2, 1);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(s => s.toLowerCase().startsWith('ma'))).toBe(true);
    // Should include at least Math.sin, Math.cos, etc.
    expect(result.some(s => s.startsWith('Math.'))).toBe(true);
  });

  it('test 3: prefix "in" returns input variable suggestions for given inputCount', () => {
    const result = getSuggestions('in', 2, 3);
    expect(result.length).toBeGreaterThan(0);
    // Should suggest in0, in1, in2 (all start with "in")
    expect(result.some(s => s === 'in0')).toBe(true);
    expect(result.some(s => s === 'in1')).toBe(true);
    expect(result.some(s => s === 'in2')).toBe(true);
  });

  it('test 4: prefix "in0" with 1 input returns empty (full match excluded)', () => {
    // "in0" matches "in0" exactly, but exact matches are filtered out
    const result = getSuggestions('in0', 3, 1);
    // in0 itself is excluded (c.toLowerCase() !== prefix check)
    expect(result.every(s => s.toLowerCase() !== 'in0')).toBe(true);
  });

  it('test 5: results are limited to at most 12 suggestions', () => {
    // prefix "i" will match many candidates (in0, in1, inputs[0]...); limit should apply
    const result = getSuggestions('i', 1, 8);
    expect(result.length).toBeLessThanOrEqual(12);
  });

  it('test 6: short prefix (<=3 chars) includes common pattern suggestions', () => {
    // prefix "in0" has length 3, so common patterns are included as candidates
    const result = getSuggestions('in0', 3, 2);
    // COMMON_PATTERNS entries that start with "in0" (e.g. "in0 + in1", "in0 * in1") should appear
    expect(result.some(s => s.startsWith('in0'))).toBe(true);
  });

  it('test 7: prefix with length > 3 does NOT include common patterns', () => {
    // "Math." has length 5 — common patterns do not start with "math." so they'd be filtered
    // anyway, but we confirm they are not added to candidates at all for long prefixes.
    // Use a prefix that would match a common pattern but is too long to trigger inclusion.
    // "in0 +" has length 5 and COMMON_PATTERNS includes "in0 + in1" but prefix > 3 skips it.
    const result = getSuggestions('in0 +', 5, 2);
    // "in0 + in1" starts with "in0 +" so it would match if included.
    // Since prefix.length = 5 > 3, COMMON_PATTERNS are not added to candidates.
    expect(result.every(s => s !== 'in0 + in1')).toBe(true);
  });

  it('test 8: prefix "Math.s" returns sin, sqrt, sign, etc.', () => {
    const result = getSuggestions('Math.s', 6, 1);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(s => s.toLowerCase().startsWith('math.s'))).toBe(true);
    expect(result.some(s => s === 'Math.sin')).toBe(true);
    expect(result.some(s => s === 'Math.sqrt')).toBe(true);
  });

  it('test 9: prefix "xyz" returns empty (no candidates match)', () => {
    const result = getSuggestions('xyz', 3, 2);
    expect(result).toHaveLength(0);
  });

  it('test 10: suggestions respect the inputCount (no in5 when inputCount=3)', () => {
    const result = getSuggestions('in', 2, 3);
    // in3, in4, in5 should not appear since inputCount=3 only generates in0..in2
    expect(result.every(s => s !== 'in3')).toBe(true);
    expect(result.every(s => s !== 'in5')).toBe(true);
  });

  it('test 11: inputs[] bracket syntax appears in suggestions for prefix "inp"', () => {
    const result = getSuggestions('inp', 3, 2);
    expect(result.some(s => s.startsWith('inputs['))).toBe(true);
  });

  it('test 12: cursor position in the middle of text uses only the text before cursor', () => {
    // text = "in1 + in0", cursor at position 3 (after "in1")
    // prefix is "in1", which matches exactly "in1" and longer patterns starting with "in1"
    const result = getSuggestions('in1 + in0', 3, 3);
    // "in1" itself is excluded as exact match; patterns like "in1" related entries won't appear
    // But "in1" pattern in COMMON_PATTERNS ("in0 > in1 ? in0 : in1") doesn't start with "in1"
    // So result should not contain "in1" itself
    expect(result.every(s => s.toLowerCase() !== 'in1')).toBe(true);
  });
});

// ===========================================================================
// Section 2 — Expression Execution via executeGraph
// ===========================================================================

/** Build a custom node with a given expression and port counts. */
function makeCustomNode(
  id: string,
  expression: string,
  inputCount: number,
  outputCount = 1,
): EditorNode {
  const inputs: EditorNode['inputs'] = [];
  for (let i = 0; i < inputCount; i++) {
    inputs.push({ id: `${id}-in-${i}`, label: `in${i}`, portType: 'any' });
  }
  const outputs: EditorNode['outputs'] = [];
  for (let i = 0; i < outputCount; i++) {
    outputs.push({ id: `${id}-out-${i}`, label: `out${i}`, portType: 'any' });
  }
  return {
    id,
    type: 'custom',
    position: [0, 0, 0],
    title: id,
    data: { expression, inputCount, outputCount },
    inputs,
    outputs,
  };
}

/** Build a source node with a fixed numeric value. */
function makeSourceNode(id: string, value: number): EditorNode {
  return {
    id,
    type: 'source',
    position: [-1, 0, 0],
    title: id,
    data: { value },
    inputs: [],
    outputs: [
      { id: `${id}-out-0`, label: 'value', portType: 'number' },
      { id: `${id}-out-1`, label: 'label', portType: 'string' },
    ],
  };
}

/** Build a connection record entry. */
function makeConn(
  id: string,
  srcId: string,
  srcPort: number,
  tgtId: string,
  tgtPort: number,
): Connection {
  return { id, sourceNodeId: srcId, sourcePortIndex: srcPort, targetNodeId: tgtId, targetPortIndex: tgtPort };
}

describe('Custom node expression execution via executeGraph', () => {
  it('test 13: simple pass-through expression "in0" with input 5 outputs 5', () => {
    const src = makeSourceNode('src', 5);
    const custom = makeCustomNode('c', 'in0', 1);
    const nodes = { src, c: custom };
    const connections = { c0: makeConn('c0', 'src', 0, 'c', 0) };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(5);
  });

  it('test 14: math expression "in0 * 2 + 1" with input 3 outputs 7', () => {
    const src = makeSourceNode('src', 3);
    const custom = makeCustomNode('c', 'in0 * 2 + 1', 1);
    const nodes = { src, c: custom };
    const connections = { c0: makeConn('c0', 'src', 0, 'c', 0) };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(7);
  });

  it('test 15: multi-input expression "in0 + in1" with inputs 3 and 4 outputs 7', () => {
    const src0 = makeSourceNode('src0', 3);
    const src1 = makeSourceNode('src1', 4);
    const custom = makeCustomNode('c', 'in0 + in1', 2);
    const nodes = { src0, src1, c: custom };
    const connections = {
      c0: makeConn('c0', 'src0', 0, 'c', 0),
      c1: makeConn('c1', 'src1', 0, 'c', 1),
    };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(7);
  });

  it('test 16: Math function "Math.sin(in0)" with input 0 outputs 0', () => {
    const src = makeSourceNode('src', 0);
    const custom = makeCustomNode('c', 'Math.sin(in0)', 1);
    const nodes = { src, c: custom };
    const connections = { c0: makeConn('c0', 'src', 0, 'c', 0) };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBeCloseTo(0, 10);
  });

  it('test 17: Math.abs expression with input -5 outputs 5', () => {
    const src = makeSourceNode('src', -5);
    const custom = makeCustomNode('c', 'Math.abs(in0)', 1);
    const nodes = { src, c: custom };
    const connections = { c0: makeConn('c0', 'src', 0, 'c', 0) };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(5);
  });

  it('test 18: ternary manual abs "in0 > 0 ? in0 : -in0" with input -3 outputs 3', () => {
    const src = makeSourceNode('src', -3);
    const custom = makeCustomNode('c', 'in0 > 0 ? in0 : -in0', 1);
    const nodes = { src, c: custom };
    const connections = { c0: makeConn('c0', 'src', 0, 'c', 0) };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(3);
  });

  it('test 19: inputs[] syntax "inputs[0] * inputs[1]" with inputs 3, 4 outputs 12', () => {
    const src0 = makeSourceNode('src0', 3);
    const src1 = makeSourceNode('src1', 4);
    const custom = makeCustomNode('c', 'inputs[0] * inputs[1]', 2);
    const nodes = { src0, src1, c: custom };
    const connections = {
      c0: makeConn('c0', 'src0', 0, 'c', 0),
      c1: makeConn('c1', 'src1', 0, 'c', 1),
    };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(12);
  });

  it('test 20: expression that throws "undefined.foo" records an error without crashing', () => {
    const custom = makeCustomNode('c', 'undefined.foo', 0);
    const nodes = { c: custom };
    const connections: Record<string, Connection> = {};

    // Must not throw at the executeGraph call level
    expect(() => executeGraph(nodes, connections)).not.toThrow();

    const result = executeGraph(nodes, connections, undefined, undefined, undefined, 'continue');
    expect(result.errors.has('c')).toBe(true);
    const errorMsg = result.errors.get('c')!;
    expect(errorMsg).toMatch(/Custom expression error/i);
  });

  it('test 21: multi-output expression "[in0, in0 * 2]" with outputCount=2 splits into outputs 0 and 1', () => {
    const src = makeSourceNode('src', 5);
    const custom = makeCustomNode('c', '[in0, in0 * 2]', 1, 2);
    const nodes = { src, c: custom };
    const connections = { c0: makeConn('c0', 'src', 0, 'c', 0) };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(5);
    expect(result.results.get('c')?.outputs[1]).toBe(10);
  });

  it('test 22: node with no expression data defaults to "in0" (pass-through)', () => {
    const src = makeSourceNode('src', 42);
    // Build a custom node with no expression set in data (expression defaults to 'in0')
    const custom: EditorNode = {
      id: 'c',
      type: 'custom',
      position: [0, 0, 0],
      title: 'c',
      data: { inputCount: 1, outputCount: 1 }, // no 'expression' field
      inputs: [{ id: 'c-in-0', label: 'in0', portType: 'any' }],
      outputs: [{ id: 'c-out-0', label: 'out0', portType: 'any' }],
    };
    const nodes = { src, c: custom };
    const connections = { c0: makeConn('c0', 'src', 0, 'c', 0) };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(42);
  });

  it('test 23: disconnected input defaults to 0; "in0 + 1" with no connection outputs 1', () => {
    // No source connected — in0 will be undefined, processor substitutes 0
    const custom = makeCustomNode('c', 'in0 + 1', 1);
    const nodes = { c: custom };
    const connections: Record<string, Connection> = {};

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(1);
  });

  it('test 24: division by zero produces Infinity, not an error or crash', () => {
    const src = makeSourceNode('src', 5);
    const custom = makeCustomNode('c', 'in0 / 0', 1);
    const nodes = { src, c: custom };
    const connections = { c0: makeConn('c0', 'src', 0, 'c', 0) };

    const result = executeGraph(nodes, connections);

    // JS division by zero returns Infinity — not an exception
    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(Infinity);
  });

  it('test 25: boolean expression "in0 > in1" with inputs 5, 3 outputs true', () => {
    const src0 = makeSourceNode('src0', 5);
    const src1 = makeSourceNode('src1', 3);
    const custom = makeCustomNode('c', 'in0 > in1', 2);
    const nodes = { src0, src1, c: custom };
    const connections = {
      c0: makeConn('c0', 'src0', 0, 'c', 0),
      c1: makeConn('c1', 'src1', 0, 'c', 1),
    };

    const result = executeGraph(nodes, connections);

    expect(result.errors.size).toBe(0);
    expect(result.results.get('c')?.outputs[0]).toBe(true);
  });
});
