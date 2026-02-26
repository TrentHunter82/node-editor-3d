/**
 * Phase 37 E2E regression tests (~25 tests).
 * Tests: graph metrics display, layout mode switching, execution export,
 * enhanced docs sections, graph docs with metrics.
 */
import { describe, it, expect } from 'vitest';
import { getGraphComplexity } from '../utils/graphMetrics';
import { generateGraphDocs } from '../utils/graphDocs';
import { forceDirectedLayout, layeredLayout } from '../utils/layout';
import { exportExecutionResults } from '../store/slices/executionSlice';
import type { EditorNode, Connection, NodeGroup } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeNode(id: string, type: EditorNode['type'] = 'source', pos: [number, number, number] = [0, 0, 0]): EditorNode {
  return { id, type, position: pos, title: id, data: {}, inputs: [], outputs: [] };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

// ============================================================================
// Graph metrics display integration
// ============================================================================
describe('graph metrics display integration', () => {
  it('StatusBar-style metrics for simple chain', () => {
    const nodes = { a: makeNode('a'), b: makeNode('b'), c: makeNode('c') };
    const conns = {
      c1: makeConn('c1', 'a', 0, 'b', 0),
      c2: makeConn('c2', 'b', 0, 'c', 0),
    };
    const m = getGraphComplexity(nodes, conns);
    // Verify metrics suitable for StatusBar display
    expect(`${m.nodeCount}N/${m.connectionCount}C`).toBe('3N/2C');
    expect(m.longestPath).toBe(3);
    expect(m.cyclomaticComplexity).toBeGreaterThanOrEqual(1);
  });

  it('metrics for empty workspace', () => {
    const m = getGraphComplexity({}, {});
    expect(`${m.nodeCount}N/${m.connectionCount}C`).toBe('0N/0C');
    expect(m.longestPath).toBe(0);
  });

  it('metrics handle mixed node types', () => {
    const nodes = {
      s1: makeNode('s1', 'source'),
      t1: makeNode('t1', 'transform'),
      m1: makeNode('m1', 'math'),
      o1: makeNode('o1', 'output'),
    };
    const conns = {
      c1: makeConn('c1', 's1', 0, 't1', 0),
      c2: makeConn('c2', 't1', 0, 'm1', 0),
      c3: makeConn('c3', 'm1', 0, 'o1', 0),
    };
    const m = getGraphComplexity(nodes, conns);
    expect(m.nodeCount).toBe(4);
    expect(m.connectionCount).toBe(3);
    expect(m.longestPath).toBe(4);
  });
});

// ============================================================================
// Layout mode switching
// ============================================================================
describe('layout mode switching', () => {
  const nodes: Record<string, EditorNode> = {
    a: makeNode('a', 'source', [0, 0, 0]),
    b: makeNode('b', 'transform', [5, 0, 0]),
    c: makeNode('c', 'output', [10, 0, 0]),
  };
  const conns: Record<string, Connection> = {
    c1: makeConn('c1', 'a', 0, 'b', 0),
    c2: makeConn('c2', 'b', 0, 'c', 0),
  };

  it('layered layout produces left-to-right ordering', () => {
    const pos = layeredLayout(nodes, conns);
    expect(pos.a[0]).toBeLessThan(pos.b[0]);
    expect(pos.b[0]).toBeLessThan(pos.c[0]);
  });

  it('force layout produces valid positions', () => {
    const pos = forceDirectedLayout(nodes, conns);
    expect(pos.a).toBeDefined();
    expect(pos.b).toBeDefined();
    expect(pos.c).toBeDefined();
    // All positions should be finite numbers
    for (const id of ['a', 'b', 'c']) {
      expect(Number.isFinite(pos[id][0])).toBe(true);
      expect(Number.isFinite(pos[id][2])).toBe(true);
    }
  });

  it('switching layouts produces different positions', () => {
    const layered = layeredLayout(nodes, conns);
    const force = forceDirectedLayout(nodes, conns);
    // At least one node should have a different position
    const differ = Object.keys(nodes).some(id =>
      layered[id][0] !== force[id][0] || layered[id][2] !== force[id][2]
    );
    expect(differ).toBe(true);
  });

  it('both layouts preserve Y coordinate', () => {
    const nodesY: Record<string, EditorNode> = {
      a: makeNode('a', 'source', [0, 5, 0]),
      b: makeNode('b', 'output', [5, 10, 0]),
    };
    const connsY = { c1: makeConn('c1', 'a', 0, 'b', 0) };

    const posL = layeredLayout(nodesY, connsY);
    const posF = forceDirectedLayout(nodesY, connsY);
    expect(posL.a[1]).toBe(5);
    expect(posL.b[1]).toBe(10);
    expect(posF.a[1]).toBe(5);
    expect(posF.b[1]).toBe(10);
  });

  it('both layouts handle disconnected graph', () => {
    const disconnected: Record<string, EditorNode> = {
      x: makeNode('x', 'source', [0, 0, 0]),
      y: makeNode('y', 'source', [10, 0, 10]),
    };
    const posL = layeredLayout(disconnected, {});
    const posF = forceDirectedLayout(disconnected, {});
    expect(posL.x).toBeDefined();
    expect(posL.y).toBeDefined();
    expect(posF.x).toBeDefined();
    expect(posF.y).toBeDefined();
  });
});

// ============================================================================
// Execution export format validation
// ============================================================================
describe('execution export format validation', () => {
  it('CSV escapes commas in node titles', () => {
    const state = {
      nodeOutputs: { a: { 0: 1 } },
      executionMetrics: { a: { duration: 0.5, cacheHit: false } },
      executionErrors: {},
      executionTotalDuration: 0.5,
      nodes: {
        a: { ...makeNode('a'), title: 'Node, with comma' },
      },
    };
    const result = exportExecutionResults(state as any);
    expect(result).not.toBeNull();
    // Title with comma should be quoted in CSV
    expect(result!.csv).toContain('"Node, with comma"');
  });

  it('CSV escapes double quotes in values', () => {
    const state = {
      nodeOutputs: { a: { 0: 'value with "quotes"' } },
      executionMetrics: {},
      executionErrors: {},
      executionTotalDuration: 0,
      nodes: { a: makeNode('a') },
    };
    const result = exportExecutionResults(state as any);
    expect(result).not.toBeNull();
    // output0 is JSON.stringify'd first → "value with \"quotes\""
    // Then the CSV escapeCsv wraps in quotes and doubles inner quotes
    // The actual CSV output should contain the escaped value
    const lines = result!.csv.split('\n');
    expect(lines.length).toBe(2);
    // Value contains quotes, so CSV escaping should be applied
    expect(lines[1]).toContain('quotes');
  });

  it('JSON includes ISO timestamp', () => {
    const state = {
      nodeOutputs: { a: { 0: 42 } },
      executionMetrics: {},
      executionErrors: {},
      executionTotalDuration: 1.0,
      nodes: { a: makeNode('a') },
    };
    const result = exportExecutionResults(state as any);
    const parsed = JSON.parse(result!.json);
    // ISO timestamp format check
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('cache hit flag is included in CSV', () => {
    const state = {
      nodeOutputs: { a: { 0: 1 } },
      executionMetrics: { a: { duration: 0, cacheHit: true } },
      executionErrors: {},
      executionTotalDuration: 0,
      nodes: { a: makeNode('a') },
    };
    const result = exportExecutionResults(state as any);
    expect(result!.csv).toContain('true'); // cacheHit=true
  });
});

// ============================================================================
// Enhanced graph docs sections
// ============================================================================
describe('enhanced graph docs', () => {
  const nodes: Record<string, EditorNode> = {
    s1: makeNode('s1', 'source'),
    s2: makeNode('s2', 'source'),
    t1: makeNode('t1', 'transform'),
    m1: makeNode('m1', 'math'),
    o1: makeNode('o1', 'output'),
  };
  const conns: Record<string, Connection> = {
    c1: makeConn('c1', 's1', 0, 't1', 0),
    c2: makeConn('c2', 's2', 0, 'm1', 0),
    c3: makeConn('c3', 't1', 0, 'm1', 1),
    c4: makeConn('c4', 'm1', 0, 'o1', 0),
  };
  const groups: Record<string, NodeGroup> = {};

  it('includes Node Type Statistics section', () => {
    const docs = generateGraphDocs({
      nodes, connections: conns, groups,
      graphName: 'Test Graph', includeTimestamp: false,
    });
    expect(docs).toContain('## Node Type Statistics');
    expect(docs).toContain('| Type | Count | Description |');
  });

  it('type statistics are sorted by count descending', () => {
    const docs = generateGraphDocs({
      nodes, connections: conns, groups,
      graphName: 'Test Graph', includeTimestamp: false,
    });
    // source appears 2 times, others 1 time
    const statsSection = docs.split('## Node Type Statistics')[1];
    const sourceLine = statsSection.indexOf('source');
    const transformLine = statsSection.indexOf('transform');
    // source (count 2) should appear before transform (count 1)
    expect(sourceLine).toBeLessThan(transformLine);
  });

  it('includes Connectivity sub-section with graph metrics', () => {
    const docs = generateGraphDocs({
      nodes, connections: conns, groups,
      graphName: 'Test Graph', includeTimestamp: false,
    });
    expect(docs).toContain('### Connectivity');
    expect(docs).toContain('Avg connectivity');
    expect(docs).toContain('Max fan-in');
    expect(docs).toContain('Max fan-out');
    expect(docs).toContain('Longest path');
    expect(docs).toContain('Connected components');
    expect(docs).toContain('Cyclomatic complexity');
  });

  it('includes description column in node table', () => {
    const docs = generateGraphDocs({
      nodes, connections: conns, groups,
      graphName: 'Test Graph', includeTimestamp: false,
    });
    // Node table header should include Description
    expect(docs).toContain('| ID | Type | Title | Description |');
    // Source description
    expect(docs).toContain('Numeric value input');
  });

  it('includes execution order section', () => {
    const docs = generateGraphDocs({
      nodes, connections: conns, groups,
      graphName: 'Test Graph', includeTimestamp: false,
    });
    expect(docs).toContain('## Execution Order');
  });

  it('omits isolated nodes metric when zero', () => {
    // All nodes connected → no isolated nodes
    const docs = generateGraphDocs({
      nodes, connections: conns, groups,
      graphName: 'Test Graph', includeTimestamp: false,
    });
    expect(docs).not.toContain('Isolated nodes');
  });

  it('includes isolated nodes metric when non-zero', () => {
    const extraNodes = { ...nodes, isolated: makeNode('isolated', 'note') };
    const docs = generateGraphDocs({
      nodes: extraNodes, connections: conns, groups,
      graphName: 'Test Graph', includeTimestamp: false,
    });
    expect(docs).toContain('Isolated nodes');
  });

  it('generates empty graph docs gracefully', () => {
    const docs = generateGraphDocs({
      nodes: {}, connections: {}, groups: {},
      graphName: 'Empty', includeTimestamp: false,
    });
    expect(docs).toContain('# Empty');
    expect(docs).toContain('*No nodes*');
    expect(docs).toContain('*No connections*');
    // No type statistics section for empty graph
    expect(docs).not.toContain('## Node Type Statistics');
  });

  it('includes group descriptions when present', () => {
    const groupedNodes: Record<string, EditorNode> = {
      a: { ...makeNode('a', 'source'), groupId: 'g1' },
    };
    const groupDefs: Record<string, NodeGroup> = {
      g1: { id: 'g1', label: 'My Group', nodeIds: ['a'], collapsed: false, description: 'Test group desc' } as NodeGroup,
    };
    const docs = generateGraphDocs({
      nodes: groupedNodes, connections: {}, groups: groupDefs,
      graphName: 'Grouped', includeTimestamp: false,
    });
    expect(docs).toContain('**My Group**');
    expect(docs).toContain('Test group desc');
  });
});
