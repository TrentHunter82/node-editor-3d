/**
 * Comprehensive tests for array expression processor functions:
 * array-filter, array-find, array-slice, array-flatten
 *
 * These processors live in src/utils/executionProcessors.ts and are invoked
 * through executeGraph. Tests use the graph-level pattern: create source nodes,
 * connect to the processor, and verify outputs.
 */
import { describe, it, expect } from 'vitest';
import { executeGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

// ---------------------------------------------------------------------------
// Helpers (same pattern as array-flow-nodes.test.ts)
// ---------------------------------------------------------------------------

/** Build a minimal graph node and execute via executeGraph, returning outputs. */
function execSingle(
  type: EditorNode['type'],
  inputs: Record<number, unknown>,
  data: Record<string, unknown> = {},
) {
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
    connections[`c-${portIdx}`] = {
      id: `c-${portIdx}`,
      sourceNodeId: srcId,
      sourcePortIndex: 0,
      targetNodeId: 'n1',
      targetPortIndex: portIdx,
    };
  }

  const result = executeGraph(nodes, connections);
  return {
    outputs: result.results.get('n1')?.outputs ?? {},
    errors: result.errors,
  };
}

// ============================================================
// array-filter
// ============================================================
describe('array-filter processor', () => {
  it('filters array with simple expression (x > 2)', () => {
    const { outputs } = execSingle('array-filter', { 0: [1, 2, 3, 4, 5] }, { expression: 'x > 2' });
    expect(outputs[0]).toEqual([3, 4, 5]);
  });

  it('returns empty array when nothing matches', () => {
    const { outputs } = execSingle('array-filter', { 0: [1, 2, 3] }, { expression: 'x > 100' });
    expect(outputs[0]).toEqual([]);
  });

  it('handles empty input array', () => {
    const { outputs } = execSingle('array-filter', { 0: [] }, { expression: 'x > 0' });
    expect(outputs[0]).toEqual([]);
  });

  it('expression has access to Math object', () => {
    const { outputs } = execSingle(
      'array-filter',
      { 0: [1, 4, 9, 16, 25] },
      { expression: 'Math.sqrt(x) > 3' },
    );
    // sqrt(1)=1, sqrt(4)=2, sqrt(9)=3, sqrt(16)=4, sqrt(25)=5
    expect(outputs[0]).toEqual([16, 25]);
  });

  it('expression errors at specific index produce error', () => {
    // x.toString() will throw at runtime if x were somehow problematic,
    // but a simpler approach: use an expression that causes a runtime error
    const { errors } = execSingle(
      'array-filter',
      { 0: [1, 2, 3] },
      { expression: 'x.noSuchMethod()' },
    );
    expect(errors.has('n1')).toBe(true);
    expect(errors.get('n1')).toContain('Array filter expression error at index 0');
  });

  it('non-array input returns empty array (treated as [])', () => {
    const { outputs } = execSingle('array-filter', { 0: 'not an array' }, { expression: 'x > 0' });
    expect(outputs[0]).toEqual([]);
  });

  it('handles falsy values (0, empty string, false) in array', () => {
    const { outputs } = execSingle(
      'array-filter',
      { 0: [0, '', false, null, 1, 'hello', true] },
      // Default expression filters out null
      { expression: 'x !== null' },
    );
    expect(outputs[0]).toEqual([0, '', false, 1, 'hello', true]);
  });
});

// ============================================================
// array-find
// ============================================================
describe('array-find processor', () => {
  it('finds first matching element', () => {
    const { outputs } = execSingle('array-find', { 0: [10, 20, 30, 40], 1: 'x > 25' });
    expect(outputs[0]).toBe(30);
    expect(outputs[1]).toBe(2);
  });

  it('returns null and -1 when nothing matches', () => {
    const { outputs } = execSingle('array-find', { 0: [1, 2, 3], 1: 'x > 999' });
    expect(outputs[0]).toBeNull();
    expect(outputs[1]).toBe(-1);
  });

  it('handles empty array', () => {
    const { outputs } = execSingle('array-find', { 0: [], 1: 'x > 0' });
    expect(outputs[0]).toBeNull();
    expect(outputs[1]).toBe(-1);
  });

  it('expression has access to Math object', () => {
    const { outputs } = execSingle('array-find', { 0: [2, 8, 27, 64], 1: 'Math.cbrt(x) === 3' });
    expect(outputs[0]).toBe(27);
    expect(outputs[1]).toBe(2);
  });

  it('expression can use index (i) variable', () => {
    const { outputs } = execSingle('array-find', { 0: ['a', 'b', 'c', 'd'], 1: 'i === 3' });
    expect(outputs[0]).toBe('d');
    expect(outputs[1]).toBe(3);
  });

  it('non-array input returns null and -1 (treated as [])', () => {
    const { outputs } = execSingle('array-find', { 0: 42, 1: 'x > 0' });
    expect(outputs[0]).toBeNull();
    expect(outputs[1]).toBe(-1);
  });
});

// ============================================================
// array-slice
// ============================================================
describe('array-slice processor', () => {
  it('slices with start and end', () => {
    const { outputs } = execSingle('array-slice', { 0: [10, 20, 30, 40, 50], 1: 1, 2: 4 });
    expect(outputs[0]).toEqual([20, 30, 40]);
  });

  it('negative start index wraps around', () => {
    const { outputs } = execSingle('array-slice', { 0: [1, 2, 3, 4, 5], 1: -3 });
    expect(outputs[0]).toEqual([3, 4, 5]);
  });

  it('missing end parameter slices to end', () => {
    const { outputs } = execSingle('array-slice', { 0: [10, 20, 30, 40], 1: 2 });
    expect(outputs[0]).toEqual([30, 40]);
  });

  it('out-of-bounds indices handled gracefully', () => {
    // JavaScript slice handles out-of-bounds gracefully
    const { outputs } = execSingle('array-slice', { 0: [1, 2, 3], 1: 0, 2: 100 });
    expect(outputs[0]).toEqual([1, 2, 3]);
  });

  it('non-array input returns empty array', () => {
    const { outputs } = execSingle('array-slice', { 0: 'not an array', 1: 0, 2: 2 });
    expect(outputs[0]).toEqual([]);
  });

  it('empty array returns empty array', () => {
    const { outputs } = execSingle('array-slice', { 0: [], 1: 0, 2: 5 });
    expect(outputs[0]).toEqual([]);
  });
});

// ============================================================
// array-flatten
// ============================================================
describe('array-flatten processor', () => {
  it('flattens nested arrays', () => {
    const { outputs } = execSingle('array-flatten', { 0: [[1, 2], [3, [4, 5]]] });
    // Default depth 1: inner [4, 5] stays nested
    expect(outputs[0]).toEqual([1, 2, 3, [4, 5]]);
  });

  it('default depth of 1', () => {
    const { outputs } = execSingle('array-flatten', { 0: [[1], [2], [3]] });
    expect(outputs[0]).toEqual([1, 2, 3]);
  });

  it('custom depth parameter', () => {
    const { outputs } = execSingle('array-flatten', { 0: [[[1]], [[2]], [[3]]], 1: 2 });
    expect(outputs[0]).toEqual([1, 2, 3]);
  });

  it('already-flat array unchanged', () => {
    const { outputs } = execSingle('array-flatten', { 0: [1, 2, 3, 4] });
    expect(outputs[0]).toEqual([1, 2, 3, 4]);
  });

  it('handles non-array input', () => {
    const { outputs } = execSingle('array-flatten', { 0: 42 });
    expect(outputs[0]).toEqual([]);
  });

  it('empty array returns empty array', () => {
    const { outputs } = execSingle('array-flatten', { 0: [] });
    expect(outputs[0]).toEqual([]);
  });
});
