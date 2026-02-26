import { describe, it, expect } from 'vitest';
import { executeGraph } from './execution';
import type { EditorNode, Connection, NodeType } from '../types';
import { NODE_TYPE_CONFIG } from '../types';
import type { NodeResult } from './execution';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: NodeType,
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {},
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
    ...overrides,
  };
}

/**
 * Create a custom node that will throw when executed.
 * Custom nodes need explicit inputs/outputs arrays since NODE_TYPE_CONFIG has empty arrays for custom.
 */
function makeErrorNode(
  id: string,
  expression = 'undefined.toString()',
  inputCount = 1,
  outputCount = 1,
): EditorNode {
  return {
    id,
    type: 'custom',
    position: [0, 0, 0],
    title: 'Error Node',
    data: { expression, inputCount, outputCount },
    inputs: Array.from({ length: inputCount }, (_, i) => ({
      id: `in-${i}`,
      label: `in ${i}`,
      portType: 'any' as const,
    })),
    outputs: Array.from({ length: outputCount }, (_, i) => ({
      id: `out-${i}`,
      label: `out ${i}`,
      portType: 'any' as const,
    })),
  };
}

/**
 * Create a valid custom node that returns a value.
 */
function makeCustomNode(
  id: string,
  expression: string,
  inputCount = 1,
  outputCount = 1,
): EditorNode {
  return {
    id,
    type: 'custom',
    position: [0, 0, 0],
    title: 'Custom Node',
    data: { expression, inputCount, outputCount },
    inputs: Array.from({ length: inputCount }, (_, i) => ({
      id: `in-${i}`,
      label: `in ${i}`,
      portType: 'any' as const,
    })),
    outputs: Array.from({ length: outputCount }, (_, i) => ({
      id: `out-${i}`,
      label: `out ${i}`,
      portType: 'any' as const,
    })),
  };
}

function makeConn(
  id: string,
  src: string,
  srcPort: number,
  tgt: string,
  tgtPort: number,
): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ===========================================================================
// Error Strategy Tests
// ===========================================================================

describe('executeGraph error strategies', () => {

  // -------------------------------------------------------------------------
  // Default behavior (fail-fast)
  // -------------------------------------------------------------------------
  describe('default behavior (fail-fast)', () => {

    it('returns empty errors map when no errors occur', () => {
      const nodes: Record<string, EditorNode> = {
        s: makeNode('s', 'source', { value: 10 }),
        t: makeNode('t', 'transform', { multiplier: 2, offset: 0 }),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 's', 0, 't', 0),
      };

      const result = executeGraph(nodes, conns);
      expect(result.errors.size).toBe(0);
      expect(result.results.get('s')).toBeDefined();
      expect(result.results.get('t')).toBeDefined();
    });

    it('captures error for a single erroring node', () => {
      const nodes: Record<string, EditorNode> = {
        err: makeErrorNode('err'),
      };

      const result = executeGraph(nodes, {});
      expect(result.errors.size).toBe(1);
      expect(result.errors.has('err')).toBe(true);
      expect(result.errors.get('err')).toContain('Custom expression error');
      // Errored node should have empty outputs in results
      const errResult = result.results.get('err');
      expect(errResult).toBeDefined();
      expect(errResult!.outputs).toEqual({});
    });

    it('stops execution in a chain A->B->C when B errors', () => {
      // A (source) -> B (error custom) -> C (transform)
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 5 }),
        b: makeErrorNode('b'),
        c: makeNode('c', 'transform', { multiplier: 2 }),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'c', 0),
      };

      const result = executeGraph(nodes, conns);

      // A should have executed successfully (wave 1)
      expect(result.results.get('a')).toBeDefined();
      expect(result.results.get('a')!.outputs[0]).toBe(5);

      // B should have error
      expect(result.errors.has('b')).toBe(true);

      // C should NOT have a result (fail-fast stopped before wave 3)
      // OR C may have an empty-outputs result if it was set before return
      // Looking at the code: fail-fast returns immediately, so C has no result entry
      expect(result.results.has('c')).toBe(false);
    });

    it('uses fail-fast as default when errorStrategy is not specified', () => {
      // Chain: A -> B (error) -> C
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 1 }),
        b: makeErrorNode('b'),
        c: makeNode('c', 'transform'),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'c', 0),
      };

      // Call without errorStrategy argument
      const result = executeGraph(nodes, conns);

      // Behaves as fail-fast: C should not execute
      expect(result.errors.size).toBe(1);
      expect(result.results.has('c')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // fail-fast strategy (explicit)
  // -------------------------------------------------------------------------
  describe('fail-fast strategy', () => {

    it('error in first wave stops execution immediately', () => {
      // Two independent nodes in the same wave (both are sources/no deps)
      // One errors. With fail-fast, after the error the function returns.
      // Note: wave order within a wave depends on key order.
      const nodes: Record<string, EditorNode> = {
        err: makeErrorNode('err', 'undefined.toString()', 0, 1),
        ok: makeNode('ok', 'source', { value: 42 }),
      };

      const result = executeGraph(nodes, {}, undefined, undefined, undefined, 'fail-fast');

      // At least one error
      expect(result.errors.size).toBe(1);
      expect(result.errors.has('err')).toBe(true);

      // The function returned early, so whether 'ok' ran depends on iteration order.
      // The important assertion: execution stopped — we have exactly 1 error and early return.
      expect(result.errors.size).toBe(1);
    });

    it('error in second wave: first wave executed, third wave not reached', () => {
      // Wave 1: A (source)
      // Wave 2: B (error custom, depends on A)
      // Wave 3: C (transform, depends on B)
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 10 }),
        b: makeErrorNode('b'),
        c: makeNode('c', 'transform', { multiplier: 3 }),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'c', 0),
      };

      const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'fail-fast');

      // Wave 1 (A) executed successfully
      expect(result.results.get('a')).toBeDefined();
      expect(result.results.get('a')!.outputs[0]).toBe(10);

      // Wave 2 (B) errored
      expect(result.errors.has('b')).toBe(true);

      // Wave 3 (C) was never reached
      expect(result.results.has('c')).toBe(false);
    });

    it('multiple potential errors: only first one causes stop', () => {
      // Wave 1: A (source)
      // Wave 2: B (error), C (error) — both depend on A
      // With fail-fast, after B errors, the function returns immediately.
      // C may or may not have been processed depending on iteration order,
      // but the critical assertion: at most the nodes processed before the early return.
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 1 }),
        b: makeErrorNode('b', 'undefined.toString()'),
        c: makeErrorNode('c', 'null.toString()'),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'a', 0, 'c', 0),
      };

      const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'fail-fast');

      // fail-fast returns on first error in the wave, so we expect exactly 1 error
      expect(result.errors.size).toBe(1);
    });

    it('collects metrics for executed nodes including the errored one', () => {
      // A (source) -> B (error)
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 5 }),
        b: makeErrorNode('b'),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
      };

      const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'fail-fast');

      // A should have metrics
      expect(result.metrics.has('a')).toBe(true);
      expect(result.metrics.get('a')!.cacheHit).toBe(false);

      // B (errored) should also have metrics
      expect(result.metrics.has('b')).toBe(true);
      expect(result.metrics.get('b')!.cacheHit).toBe(false);
      expect(result.metrics.get('b')!.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // continue strategy
  // -------------------------------------------------------------------------
  describe('continue strategy', () => {

    it('error in chain A->B->C: B errors, C still executes', () => {
      // A (source, value=5) -> B (error custom) -> C (transform)
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 5 }),
        b: makeErrorNode('b'),
        c: makeNode('c', 'transform', { multiplier: 2 }),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'c', 0),
      };

      const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'continue');

      // A executed
      expect(result.results.get('a')!.outputs[0]).toBe(5);

      // B errored
      expect(result.errors.has('b')).toBe(true);
      expect(result.results.get('b')!.outputs).toEqual({});

      // C still executed (with empty/undefined input from B)
      expect(result.results.has('c')).toBe(true);
      const cResult = result.results.get('c')!;
      // C's input port 0 gets undefined from B's empty outputs,
      // transform processor treats non-number as 0: 0 * 2 + 0 = 0
      expect(cResult.outputs[0]).toBe(0);
    });

    it('multiple errors: all collected in errors map', () => {
      // Two independent error nodes
      const nodes: Record<string, EditorNode> = {
        err1: makeErrorNode('err1', 'undefined.toString()', 0, 1),
        err2: makeErrorNode('err2', 'null.toString()', 0, 1),
      };

      const result = executeGraph(nodes, {}, undefined, undefined, undefined, 'continue');

      expect(result.errors.size).toBe(2);
      expect(result.errors.has('err1')).toBe(true);
      expect(result.errors.has('err2')).toBe(true);
      // Both should contain 'Custom expression error'
      expect(result.errors.get('err1')).toContain('Custom expression error');
      expect(result.errors.get('err2')).toContain('Custom expression error');
    });

    it('all nodes processed despite errors', () => {
      // A (source) -> B (error) -> C (transform) -> D (output)
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 10 }),
        b: makeErrorNode('b'),
        c: makeNode('c', 'transform', { multiplier: 1 }),
        d: makeNode('d', 'output'),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'c', 0),
        c3: makeConn('c3', 'c', 0, 'd', 0),
      };

      const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'continue');

      // All 4 nodes should have results
      expect(result.results.has('a')).toBe(true);
      expect(result.results.has('b')).toBe(true);
      expect(result.results.has('c')).toBe(true);
      expect(result.results.has('d')).toBe(true);

      // Only B should have an error
      expect(result.errors.size).toBe(1);
      expect(result.errors.has('b')).toBe(true);
    });

    it('downstream nodes get empty/undefined inputs from errored upstream', () => {
      // A (source, value=100) -> B (error) -> C (custom that returns in0)
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 100 }),
        b: makeErrorNode('b'),
        c: makeCustomNode('c', 'in0'),  // just passes through input
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
        c2: makeConn('c2', 'b', 0, 'c', 0),
      };

      const result = executeGraph(nodes, conns, undefined, undefined, undefined, 'continue');

      // B errored -> B has empty outputs {}
      expect(result.results.get('b')!.outputs).toEqual({});

      // C's input port 0 reads from B's output port 0 which is undefined (empty outputs)
      // The custom processor receives inputs[0] = undefined, in0 = 0 (default for undefined)
      // Expression 'in0' returns 0
      const cResult = result.results.get('c')!;
      expect(cResult.outputs[0]).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Metrics & profiling
  // -------------------------------------------------------------------------
  describe('metrics and profiling', () => {

    it('both strategies collect metrics for executed nodes', () => {
      const nodes: Record<string, EditorNode> = {
        a: makeNode('a', 'source', { value: 1 }),
        b: makeNode('b', 'transform', { multiplier: 2 }),
      };
      const conns: Record<string, Connection> = {
        c1: makeConn('c1', 'a', 0, 'b', 0),
      };

      const failFastResult = executeGraph(nodes, conns, undefined, undefined, undefined, 'fail-fast');
      expect(failFastResult.metrics.has('a')).toBe(true);
      expect(failFastResult.metrics.has('b')).toBe(true);

      const continueResult = executeGraph(nodes, conns, undefined, undefined, undefined, 'continue');
      expect(continueResult.metrics.has('a')).toBe(true);
      expect(continueResult.metrics.has('b')).toBe(true);
    });

    it('errored nodes have cacheHit: false in metrics', () => {
      const nodes: Record<string, EditorNode> = {
        err: makeErrorNode('err', 'undefined.toString()', 0, 1),
      };

      const resultFF = executeGraph(nodes, {}, undefined, undefined, undefined, 'fail-fast');
      expect(resultFF.metrics.get('err')!.cacheHit).toBe(false);

      const resultCont = executeGraph(nodes, {}, undefined, undefined, undefined, 'continue');
      expect(resultCont.metrics.get('err')!.cacheHit).toBe(false);
    });

    it('totalDuration is >= 0', () => {
      const nodes: Record<string, EditorNode> = {
        s: makeNode('s', 'source', { value: 1 }),
      };

      const result = executeGraph(nodes, {});
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);

      const resultErr = executeGraph(
        { err: makeErrorNode('err', 'undefined.toString()', 0, 1) },
        {},
        undefined, undefined, undefined,
        'fail-fast',
      );
      expect(resultErr.totalDuration).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {

    it('empty graph returns empty results', () => {
      const result = executeGraph({}, {});

      expect(result.results.size).toBe(0);
      expect(result.waves.length).toBe(0);
      expect(result.errors.size).toBe(0);
      expect(result.metrics.size).toBe(0);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('graph with only source nodes produces no errors', () => {
      const nodes: Record<string, EditorNode> = {
        s1: makeNode('s1', 'source', { value: 10 }),
        s2: makeNode('s2', 'source', { value: 20 }),
        s3: makeNode('s3', 'source', { value: 30 }),
      };

      const result = executeGraph(nodes, {}, undefined, undefined, undefined, 'fail-fast');

      expect(result.errors.size).toBe(0);
      expect(result.results.size).toBe(3);
      expect(result.results.get('s1')!.outputs[0]).toBe(10);
      expect(result.results.get('s2')!.outputs[0]).toBe(20);
      expect(result.results.get('s3')!.outputs[0]).toBe(30);
    });

    it('cached results bypass execution and do not error', () => {
      // A custom node that would error, but its result is already cached with a matching inputHash.
      const errNode = makeErrorNode('err', 'undefined.toString()', 0, 1);
      const nodes: Record<string, EditorNode> = {
        err: errNode,
      };

      // Pre-populate cache with a valid result for the error node.
      // gatherInputs for a node with no connections returns {}, hashInputs({}) = '{}'.
      const preCache = new Map<string, NodeResult>();
      const inputHash = JSON.stringify({});  // matches what hashInputs({}) produces
      preCache.set('err', {
        outputs: { 0: 'cached-value' },
        inputHash,
      });

      const result = executeGraph(nodes, {}, preCache, undefined, undefined, 'fail-fast');

      // No error because the cache was used (input hash matched)
      expect(result.errors.size).toBe(0);
      // The cached result is preserved
      expect(result.results.get('err')!.outputs[0]).toBe('cached-value');
      // Metrics should show cache hit
      expect(result.metrics.get('err')!.cacheHit).toBe(true);
    });

    it('cache miss still triggers error in fail-fast', () => {
      // Same error node but cache has a different inputHash, so it re-executes and errors
      const errNode = makeErrorNode('err', 'undefined.toString()', 0, 1);
      const nodes: Record<string, EditorNode> = {
        err: errNode,
      };

      const preCache = new Map<string, NodeResult>();
      preCache.set('err', {
        outputs: { 0: 'stale-value' },
        inputHash: 'different-hash',  // won't match the actual input hash
      });

      const result = executeGraph(nodes, {}, preCache, undefined, undefined, 'fail-fast');

      // Cache miss -> re-executes -> errors
      expect(result.errors.size).toBe(1);
      expect(result.errors.has('err')).toBe(true);
    });
  });
});
