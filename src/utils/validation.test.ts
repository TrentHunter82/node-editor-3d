import { describe, it, expect } from 'vitest';
import { validateGraph, validateNode, validateGraphVariables } from './validation';
import type { EditorNode, Connection } from '../types';

/** Helper to create a minimal EditorNode */
function makeNode(overrides: Partial<EditorNode> & { id: string; type: EditorNode['type'] }): EditorNode {
  return {
    position: [0, 0, 0],
    title: overrides.type,
    data: {},
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

/** Helper to create a Connection */
function makeConn(id: string, sourceNodeId: string, sourcePortIndex: number, targetNodeId: string, targetPortIndex: number): Connection {
  return { id, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex };
}

describe('validateGraph', () => {
  it('returns no issues for an empty graph', () => {
    expect(validateGraph({}, {})).toEqual([]);
  });

  it('returns no issues for source nodes (no inputs)', () => {
    const nodes: Record<string, EditorNode> = {
      s1: makeNode({ id: 's1', type: 'source', outputs: [{ id: 'o1', label: 'value', portType: 'number' }] }),
      r1: makeNode({ id: 'r1', type: 'random', outputs: [{ id: 'o2', label: 'value', portType: 'number' }] }),
    };
    // No connections → but they get "no-connections" warnings
    const issues = validateGraph(nodes, {});
    expect(issues.filter(i => i.type === 'disconnected-input')).toEqual([]);
  });

  it('returns no issues for note nodes (no ports)', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({ id: 'n1', type: 'note' }),
    };
    expect(validateGraph(nodes, {})).toEqual([]);
  });

  it('detects disconnected inputs on a node', () => {
    const nodes: Record<string, EditorNode> = {
      t1: makeNode({
        id: 't1',
        type: 'transform',
        inputs: [
          { id: 'i0', label: 'in', portType: 'number' },
          { id: 'i1', label: 'factor', portType: 'number' },
        ],
        outputs: [{ id: 'o0', label: 'result', portType: 'number' }],
      }),
    };
    const issues = validateGraph(nodes, {});
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    expect(disconnected).toHaveLength(2);
    expect(disconnected).toEqual([
      { nodeId: 't1', portIndex: 0, type: 'disconnected-input' },
      { nodeId: 't1', portIndex: 1, type: 'disconnected-input' },
    ]);
  });

  it('does not report connected inputs', () => {
    const nodes: Record<string, EditorNode> = {
      s1: makeNode({
        id: 's1',
        type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      t1: makeNode({
        id: 't1',
        type: 'transform',
        inputs: [
          { id: 'i0', label: 'in', portType: 'number' },
          { id: 'i1', label: 'factor', portType: 'number' },
        ],
        outputs: [{ id: 'o0', label: 'result', portType: 'number' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 's1', 0, 't1', 0),
    };
    const issues = validateGraph(nodes, connections);
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    // Only port 1 is disconnected
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]).toEqual({ nodeId: 't1', portIndex: 1, type: 'disconnected-input' });
  });

  it('reports no disconnected-input issues when all inputs are connected', () => {
    const nodes: Record<string, EditorNode> = {
      s1: makeNode({
        id: 's1',
        type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      s2: makeNode({
        id: 's2',
        type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      t1: makeNode({
        id: 't1',
        type: 'transform',
        inputs: [
          { id: 'i0', label: 'in', portType: 'number' },
          { id: 'i1', label: 'factor', portType: 'number' },
        ],
        outputs: [{ id: 'o0', label: 'result', portType: 'number' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 's1', 0, 't1', 0),
      c2: makeConn('c2', 's2', 0, 't1', 1),
    };
    expect(validateGraph(nodes, connections).filter(i => i.type === 'disconnected-input')).toEqual([]);
  });

  it('handles multiple nodes with mixed connection states', () => {
    const nodes: Record<string, EditorNode> = {
      s1: makeNode({
        id: 's1',
        type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      t1: makeNode({
        id: 't1',
        type: 'transform',
        inputs: [
          { id: 'i0', label: 'in', portType: 'number' },
          { id: 'i1', label: 'factor', portType: 'number' },
        ],
        outputs: [{ id: 'o0', label: 'result', portType: 'number' }],
      }),
      f1: makeNode({
        id: 'f1',
        type: 'filter',
        inputs: [{ id: 'i0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'any' }],
      }),
      n1: makeNode({ id: 'n1', type: 'note' }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 's1', 0, 't1', 0),
    };
    const issues = validateGraph(nodes, connections);
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    // t1 port 1 is disconnected, f1 port 0 is disconnected
    expect(disconnected).toHaveLength(2);
    const issueIds = disconnected.map(i => `${i.nodeId}:${i.portIndex}`);
    expect(issueIds).toContain('t1:1');
    expect(issueIds).toContain('f1:0');
  });

  it('correctly identifies connections by target node and port index', () => {
    // Edge case: two different nodes with same port index
    const nodes: Record<string, EditorNode> = {
      s1: makeNode({
        id: 's1',
        type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      t1: makeNode({
        id: 't1',
        type: 'filter',
        inputs: [{ id: 'i0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'any' }],
      }),
      t2: makeNode({
        id: 't2',
        type: 'filter',
        inputs: [{ id: 'i0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'any' }],
      }),
    };
    // Connect to t1 only - t2 should still show as disconnected
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 's1', 0, 't1', 0),
    };
    const issues = validateGraph(nodes, connections);
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0].nodeId).toBe('t2');
  });

  it('skips nodes with empty inputs array (source-like nodes)', () => {
    const nodes: Record<string, EditorNode> = {
      r1: makeNode({
        id: 'r1',
        type: 'random',
        inputs: [],
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      d1: makeNode({
        id: 'd1',
        type: 'display',
        inputs: [{ id: 'i0', label: 'value', portType: 'any' }],
        outputs: [],
      }),
    };
    const issues = validateGraph(nodes, {});
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    // Only display has a disconnected input
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0].nodeId).toBe('d1');
  });

  it('handles subgraph boundary nodes correctly', () => {
    const nodes: Record<string, EditorNode> = {
      si1: makeNode({
        id: 'si1',
        type: 'subgraph-input',
        inputs: [],
        outputs: [{ id: 'o0', label: 'value', portType: 'any' }],
      }),
      so1: makeNode({
        id: 'so1',
        type: 'subgraph-output',
        inputs: [{ id: 'i0', label: 'value', portType: 'any' }],
        outputs: [],
      }),
    };
    const issues = validateGraph(nodes, {});
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    // subgraph-input has no inputs, subgraph-output has one disconnected input
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0].nodeId).toBe('so1');
  });

  it('handles a chain of connected nodes with no disconnected-input issues', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode({ id: 's', type: 'source', outputs: [{ id: 'o0', label: 'value', portType: 'number' }] }),
      a: makeNode({ id: 'a', type: 'filter', inputs: [{ id: 'i0', label: 'in', portType: 'any' }], outputs: [{ id: 'o0', label: 'out', portType: 'any' }] }),
      b: makeNode({ id: 'b', type: 'filter', inputs: [{ id: 'i0', label: 'in', portType: 'any' }], outputs: [{ id: 'o0', label: 'out', portType: 'any' }] }),
      o: makeNode({ id: 'o', type: 'output', inputs: [{ id: 'i0', label: 'data', portType: 'any' }, { id: 'i1', label: 'label', portType: 'string' }], outputs: [] }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 's', 0, 'a', 0),
      c2: makeConn('c2', 'a', 0, 'b', 0),
      c3: makeConn('c3', 'b', 0, 'o', 0),
    };
    const issues = validateGraph(nodes, connections);
    const disconnected = issues.filter(i => i.type === 'disconnected-input');
    // Only output port 1 (label) is disconnected
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]).toEqual({ nodeId: 'o', portIndex: 1, type: 'disconnected-input' });
  });
});

// ============================================================================
// Type mismatch warnings
// ============================================================================

describe('validateGraph type-mismatch', () => {
  it('detects concrete type mismatch (number → string)', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src', type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      concat: makeNode({
        id: 'concat', type: 'concat',
        inputs: [{ id: 'i0', label: 'a', portType: 'string' }, { id: 'i1', label: 'b', portType: 'string' }],
        outputs: [{ id: 'o0', label: 'result', portType: 'string' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'concat', 0),
    };
    const issues = validateGraph(nodes, connections);
    const mismatches = issues.filter(i => i.type === 'type-mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].nodeId).toBe('concat');
    expect(mismatches[0].message).toContain('number');
    expect(mismatches[0].message).toContain('string');
  });

  it('does not warn for any-port connections', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src', type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      filter: makeNode({
        id: 'filter', type: 'filter',
        inputs: [{ id: 'i0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'any' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'filter', 0),
    };
    const issues = validateGraph(nodes, connections);
    expect(issues.filter(i => i.type === 'type-mismatch')).toHaveLength(0);
  });

  it('does not warn for same-type connections', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src', type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      math: makeNode({
        id: 'math', type: 'math',
        inputs: [{ id: 'i0', label: 'a', portType: 'number' }, { id: 'i1', label: 'b', portType: 'number' }],
        outputs: [{ id: 'o0', label: 'result', portType: 'number' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'math', 0),
    };
    const issues = validateGraph(nodes, connections);
    expect(issues.filter(i => i.type === 'type-mismatch')).toHaveLength(0);
  });

  it('does not warn when both sides are any', () => {
    const nodes: Record<string, EditorNode> = {
      r1: makeNode({
        id: 'r1', type: 'reroute',
        inputs: [{ id: 'i0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'any' }],
      }),
      r2: makeNode({
        id: 'r2', type: 'reroute',
        inputs: [{ id: 'i0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'any' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'r1', 0, 'r2', 0),
    };
    const issues = validateGraph(nodes, connections);
    expect(issues.filter(i => i.type === 'type-mismatch')).toHaveLength(0);
  });
});

// ============================================================================
// Disconnected output warnings
// ============================================================================

describe('validateGraph disconnected-output', () => {
  it('warns when a connected non-terminal node has no outgoing connections', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src', type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      xform: makeNode({
        id: 'xform', type: 'transform',
        inputs: [{ id: 'i0', label: 'value', portType: 'number' }, { id: 'i1', label: 'factor', portType: 'number' }],
        outputs: [{ id: 'o0', label: 'result', portType: 'number' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'xform', 0),
    };
    const issues = validateGraph(nodes, connections);
    const disconnectedOut = issues.filter(i => i.type === 'disconnected-output');
    expect(disconnectedOut).toHaveLength(1);
    expect(disconnectedOut[0].nodeId).toBe('xform');
  });

  it('does not warn for terminal nodes (output, display, subgraph-output)', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src', type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      out: makeNode({
        id: 'out', type: 'output',
        inputs: [{ id: 'i0', label: 'data', portType: 'any' }],
        outputs: [],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'out', 0),
    };
    const issues = validateGraph(nodes, connections);
    expect(issues.filter(i => i.type === 'disconnected-output')).toHaveLength(0);
  });

  it('does not warn for totally disconnected nodes (covered by no-connections)', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src', type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
    };
    const issues = validateGraph(nodes, {});
    expect(issues.filter(i => i.type === 'disconnected-output')).toHaveLength(0);
    expect(issues.filter(i => i.type === 'no-connections')).toHaveLength(1);
  });

  it('does not warn when output is connected', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src', type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      out: makeNode({
        id: 'out', type: 'output',
        inputs: [{ id: 'i0', label: 'data', portType: 'any' }],
        outputs: [],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'out', 0),
    };
    const issues = validateGraph(nodes, connections);
    expect(issues.filter(i => i.nodeId === 'src' && i.type === 'disconnected-output')).toHaveLength(0);
  });
});

// ============================================================================
// No-connections (isolated node) warnings
// ============================================================================

describe('validateGraph no-connections', () => {
  it('warns for an isolated node with ports', () => {
    const nodes: Record<string, EditorNode> = {
      xform: makeNode({
        id: 'xform', type: 'transform',
        inputs: [{ id: 'i0', label: 'value', portType: 'number' }],
        outputs: [{ id: 'o0', label: 'result', portType: 'number' }],
      }),
    };
    const issues = validateGraph(nodes, {});
    expect(issues.filter(i => i.type === 'no-connections')).toHaveLength(1);
    expect(issues.find(i => i.type === 'no-connections')!.nodeId).toBe('xform');
  });

  it('does not warn for note nodes', () => {
    const nodes: Record<string, EditorNode> = {
      n: makeNode({ id: 'n', type: 'note' }),
    };
    expect(validateGraph(nodes, {})).toHaveLength(0);
  });

  it('does not warn for connected nodes', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src', type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      out: makeNode({
        id: 'out', type: 'output',
        inputs: [{ id: 'i0', label: 'data', portType: 'any' }],
        outputs: [],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'out', 0),
    };
    const issues = validateGraph(nodes, connections);
    expect(issues.filter(i => i.type === 'no-connections')).toHaveLength(0);
  });
});

// ============================================================================
// validateNode
// ============================================================================

describe('validateNode', () => {
  // --- Port validation ---

  it('returns no issues for a well-formed node', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'transform',
        inputs: [{ id: 'i0', label: 'in', portType: 'number' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'number' }],
      }),
    };
    expect(validateNode('n1', nodes, {})).toEqual([]);
  });

  it('detects invalid port type', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'transform',
        inputs: [{ id: 'i0', label: 'in', portType: 'invalid-type' as any }],
        outputs: [{ id: 'o0', label: 'out', portType: 'number' }],
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message!.includes('invalid type'))).toBe(true);
  });

  it('detects missing port id', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'transform',
        inputs: [{ id: '', label: 'in', portType: 'number' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'number' }],
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message!.includes('missing id'))).toBe(true);
  });

  it('detects missing port type (empty string)', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'transform',
        inputs: [],
        outputs: [{ id: 'o0', label: 'out', portType: '' as any }],
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message!.includes('invalid type'))).toBe(true);
  });

  // --- Connection type mismatch ---

  it('detects type mismatch on incoming connections', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src',
        type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      tgt: makeNode({
        id: 'tgt',
        type: 'concat',
        inputs: [{ id: 'i0', label: 'a', portType: 'string' }],
        outputs: [{ id: 'o0', label: 'result', portType: 'string' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'tgt', 0),
    };
    const issues = validateNode('tgt', nodes, connections);
    const mismatches = issues.filter(i => i.type === 'type-mismatch');
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].message).toContain('number');
    expect(mismatches[0].message).toContain('string');
  });

  it('skips mismatch when either side is any', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src',
        type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      tgt: makeNode({
        id: 'tgt',
        type: 'filter',
        inputs: [{ id: 'i0', label: 'in', portType: 'any' }],
        outputs: [{ id: 'o0', label: 'out', portType: 'any' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'tgt', 0),
    };
    const issues = validateNode('tgt', nodes, connections);
    expect(issues.filter(i => i.type === 'type-mismatch')).toHaveLength(0);
  });

  it('no mismatch issues when types match', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeNode({
        id: 'src',
        type: 'source',
        outputs: [{ id: 'o0', label: 'value', portType: 'number' }],
      }),
      tgt: makeNode({
        id: 'tgt',
        type: 'math',
        inputs: [{ id: 'i0', label: 'a', portType: 'number' }],
        outputs: [{ id: 'o0', label: 'result', portType: 'number' }],
      }),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'tgt', 0),
    };
    const issues = validateNode('tgt', nodes, connections);
    expect(issues.filter(i => i.type === 'type-mismatch')).toHaveLength(0);
  });

  // --- Data shape ---

  it('detects non-object data (null)', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'transform',
        inputs: [],
        outputs: [],
        data: null as any,
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message === 'Node data is not a valid object')).toBe(true);
  });

  it('detects array data', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'transform',
        inputs: [],
        outputs: [],
        data: [] as any,
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message === 'Node data is not a valid object')).toBe(true);
  });

  it('returns early after invalid data (does not check expression)', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'custom',
        inputs: [],
        outputs: [],
        data: null as any,
      }),
    };
    const issues = validateNode('n1', nodes, {});
    // Should have the invalid-data issue but NOT invalid-expression
    expect(issues.some(i => i.type === 'invalid-data')).toBe(true);
    expect(issues.some(i => i.type === 'invalid-expression')).toBe(false);
  });

  it('accepts valid object data', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'transform',
        inputs: [],
        outputs: [],
        data: { someKey: 'someValue' },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.filter(i => i.message === 'Node data is not a valid object')).toHaveLength(0);
  });

  // --- Expression syntax ---

  it('accepts valid expression on custom node', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'custom',
        inputs: [],
        outputs: [],
        data: { expression: 'x + 1' },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.filter(i => i.type === 'invalid-expression')).toHaveLength(0);
  });

  it('detects syntax error in expression', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'custom',
        inputs: [],
        outputs: [],
        data: { expression: 'x +++ {{{' },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    const exprIssues = issues.filter(i => i.type === 'invalid-expression');
    expect(exprIssues).toHaveLength(1);
    expect(exprIssues[0].message).toContain('Expression syntax error');
  });

  it('skips expression check for non-expression node types', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'transform',
        inputs: [],
        outputs: [],
        data: { expression: 'x +++ {{{' },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.filter(i => i.type === 'invalid-expression')).toHaveLength(0);
  });

  it('reports "Expression must be a string" for non-string expression', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'custom',
        inputs: [],
        outputs: [],
        data: { expression: 42 },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    const exprIssues = issues.filter(i => i.type === 'invalid-expression');
    expect(exprIssues).toHaveLength(1);
    expect(exprIssues[0].message).toBe('Expression must be a string');
  });

  it('accepts empty/null expression (no error)', () => {
    const nodesNull: Record<string, EditorNode> = {
      n1: makeNode({ id: 'n1', type: 'custom', inputs: [], outputs: [], data: { expression: null } }),
    };
    const nodesUndef: Record<string, EditorNode> = {
      n1: makeNode({ id: 'n1', type: 'custom', inputs: [], outputs: [], data: {} }),
    };
    const nodesEmpty: Record<string, EditorNode> = {
      n1: makeNode({ id: 'n1', type: 'custom', inputs: [], outputs: [], data: { expression: '' } }),
    };
    expect(validateNode('n1', nodesNull, {}).filter(i => i.type === 'invalid-expression')).toHaveLength(0);
    expect(validateNode('n1', nodesUndef, {}).filter(i => i.type === 'invalid-expression')).toHaveLength(0);
    expect(validateNode('n1', nodesEmpty, {}).filter(i => i.type === 'invalid-expression')).toHaveLength(0);
  });

  it('validates expression on array-filter, array-map, array-reduce nodes', () => {
    for (const type of ['array-filter', 'array-map', 'array-reduce'] as const) {
      const nodesValid: Record<string, EditorNode> = {
        n1: makeNode({ id: 'n1', type, inputs: [], outputs: [], data: { expression: 'x * 2' } }),
      };
      expect(validateNode('n1', nodesValid, {}).filter(i => i.type === 'invalid-expression')).toHaveLength(0);

      const nodesInvalid: Record<string, EditorNode> = {
        n1: makeNode({ id: 'n1', type, inputs: [], outputs: [], data: { expression: '{{invalid' } }),
      };
      expect(validateNode('n1', nodesInvalid, {}).filter(i => i.type === 'invalid-expression')).toHaveLength(1);
    }
  });

  // --- Variable name validation ---

  it('detects missing variable name on set-var', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'set-var' as any,
        inputs: [{ id: 'i0', label: 'value', portType: 'any' }],
        outputs: [],
        data: {},
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message === 'Variable name is not configured')).toBe(true);
  });

  it('detects empty string variable name on get-var', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'get-var' as any,
        inputs: [],
        outputs: [{ id: 'o0', label: 'value', portType: 'any' }],
        data: { variableName: '' },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message === 'Variable name is not configured')).toBe(true);
  });

  it('detects whitespace-only variable name', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'set-var' as any,
        inputs: [{ id: 'i0', label: 'value', portType: 'any' }],
        outputs: [],
        data: { variableName: '   ' },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message === 'Variable name is not configured')).toBe(true);
  });

  it('accepts valid variable name', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'get-var' as any,
        inputs: [],
        outputs: [{ id: 'o0', label: 'value', portType: 'any' }],
        data: { variableName: 'myVariable' },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.filter(i => i.message === 'Variable name is not configured')).toHaveLength(0);
  });

  // --- Subgraph validation ---

  it('detects missing innerGraphId on subgraph node', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'subgraph' as any,
        inputs: [],
        outputs: [],
        data: {},
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.some(i => i.type === 'invalid-data' && i.message === 'Subgraph has no inner graph configured')).toBe(true);
  });

  it('accepts valid innerGraphId', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({
        id: 'n1',
        type: 'subgraph' as any,
        inputs: [],
        outputs: [],
        data: { innerGraphId: 'graph-123' },
      }),
    };
    const issues = validateNode('n1', nodes, {});
    expect(issues.filter(i => i.message === 'Subgraph has no inner graph configured')).toHaveLength(0);
  });

  // --- Non-existent node ---

  it('returns empty array for node id not in nodes', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode({ id: 'n1', type: 'source', outputs: [{ id: 'o0', label: 'value', portType: 'number' }] }),
    };
    expect(validateNode('non-existent', nodes, {})).toEqual([]);
  });
});

// ============================================================================
// validateGraphVariables
// ============================================================================

describe('validateGraphVariables', () => {
  // --- Root validation ---

  it('returns empty variables and issue for null input', () => {
    const result = validateGraphVariables(null);
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('plain object');
  });

  it('returns empty variables and issue for array input', () => {
    const result = validateGraphVariables([1, 2, 3]);
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('array');
  });

  it('returns empty variables and issue for string input', () => {
    const result = validateGraphVariables('hello');
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('string');
  });

  it('returns empty variables and issue for number input', () => {
    const result = validateGraphVariables(42);
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('number');
  });

  it('returns empty variables and issue for undefined input', () => {
    const result = validateGraphVariables(undefined);
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('undefined');
  });

  // --- Valid inputs ---

  it('passes through valid string/number/boolean/null variables', () => {
    const result = validateGraphVariables({
      name: 'Alice',
      age: 30,
      active: true,
      extra: null,
    });
    expect(result.variables).toEqual({ name: 'Alice', age: 30, active: true, extra: null });
    expect(result.issues).toHaveLength(0);
  });

  it('passes through nested objects and arrays', () => {
    const input = {
      config: { nested: { deep: true } },
      items: [1, 2, 3],
    };
    const result = validateGraphVariables(input);
    expect(result.variables).toEqual(input);
    expect(result.issues).toHaveLength(0);
  });

  it('returns empty issues for valid input', () => {
    const result = validateGraphVariables({ x: 1, y: 'two' });
    expect(result.issues).toEqual([]);
  });

  it('handles empty object', () => {
    const result = validateGraphVariables({});
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(0);
  });

  // --- Key validation ---

  it('skips variables with empty key', () => {
    const result = validateGraphVariables({ '': 'value' });
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('empty key');
  });

  it('skips variables with whitespace-only key', () => {
    const result = validateGraphVariables({ '   ': 'value' });
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('empty key');
  });

  // --- Value validation ---

  it('skips function values with issue', () => {
    const result = validateGraphVariables({ fn: () => {} });
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('function');
  });

  it('skips symbol values with issue', () => {
    const result = validateGraphVariables({ sym: Symbol('test') });
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('symbol');
  });

  it('skips undefined values with issue', () => {
    const result = validateGraphVariables({ undef: undefined });
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('undefined');
  });

  // --- Serialization ---

  it('skips non-serializable values (circular references)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = validateGraphVariables({ circ: circular });
    expect(result.variables).toEqual({});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('not serializable');
  });

  it('handles mixed valid and invalid entries', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = validateGraphVariables({
      good: 'hello',
      bad: () => {},
      alsoGood: 123,
      ugly: circular,
    });
    expect(result.variables).toEqual({ good: 'hello', alsoGood: 123 });
    expect(result.issues).toHaveLength(2); // function + circular
  });
});
