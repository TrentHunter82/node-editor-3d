import { describe, it, expect } from 'vitest';
import { traceDataFlow } from '../utils/graphTraversal';
import type { Connection } from '../types';

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

function toRecord(...conns: Connection[]): Record<string, Connection> {
  const record: Record<string, Connection> = {};
  for (const c of conns) {
    record[c.id] = c;
  }
  return record;
}

describe('traceDataFlow', () => {
  // 1. Empty connections: returns empty array for both directions
  it('returns empty array for empty connections (downstream)', () => {
    expect(traceDataFlow('A', 'downstream', {})).toEqual([]);
  });

  it('returns empty array for empty connections (upstream)', () => {
    expect(traceDataFlow('A', 'upstream', {})).toEqual([]);
  });

  // 2. Single connection downstream: A->B, trace from A downstream = [B]
  it('traces single connection downstream', () => {
    const conns = toRecord(makeConn('c1', 'A', 0, 'B', 0));
    expect(traceDataFlow('A', 'downstream', conns)).toEqual(['B']);
  });

  // 3. Single connection upstream: A->B, trace from B upstream = [A]
  it('traces single connection upstream', () => {
    const conns = toRecord(makeConn('c1', 'A', 0, 'B', 0));
    expect(traceDataFlow('B', 'upstream', conns)).toEqual(['A']);
  });

  // 4. Linear chain downstream: A->B->C->D, trace from A = [B, C, D]
  it('traces linear chain downstream', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
      makeConn('c3', 'C', 0, 'D', 0),
    );
    expect(traceDataFlow('A', 'downstream', conns)).toEqual(['B', 'C', 'D']);
  });

  // 5. Linear chain upstream: A->B->C->D, trace from D = [C, B, A]
  it('traces linear chain upstream', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
      makeConn('c3', 'C', 0, 'D', 0),
    );
    expect(traceDataFlow('D', 'upstream', conns)).toEqual(['C', 'B', 'A']);
  });

  // 6. Fan-out (branch): A->B, A->C, trace from A downstream = [B, C] (BFS order)
  it('traces fan-out (branch) downstream in BFS order', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 1, 'C', 0),
    );
    const result = traceDataFlow('A', 'downstream', conns);
    expect(result).toHaveLength(2);
    expect(result).toContain('B');
    expect(result).toContain('C');
  });

  // 7. Fan-in (merge): A->C, B->C, trace from C upstream = [A, B] (BFS order)
  it('traces fan-in (merge) upstream in BFS order', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'C', 0),
      makeConn('c2', 'B', 0, 'C', 1),
    );
    const result = traceDataFlow('C', 'upstream', conns);
    expect(result).toHaveLength(2);
    expect(result).toContain('A');
    expect(result).toContain('B');
  });

  // 8. Diamond pattern: A->B, A->C, B->D, C->D, trace from A downstream = [B, C, D]
  it('traces diamond pattern downstream', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 1, 'C', 0),
      makeConn('c3', 'B', 0, 'D', 0),
      makeConn('c4', 'C', 0, 'D', 1),
    );
    const result = traceDataFlow('A', 'downstream', conns);
    expect(result).toHaveLength(3);
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toContain('D');
    // D must come after both B and C (BFS: B and C are at depth 1, D at depth 2)
    expect(result.indexOf('D')).toBeGreaterThan(result.indexOf('B'));
    expect(result.indexOf('D')).toBeGreaterThan(result.indexOf('C'));
  });

  // 9. Diamond upstream: trace from D upstream = [B, C, A]
  it('traces diamond pattern upstream', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 1, 'C', 0),
      makeConn('c3', 'B', 0, 'D', 0),
      makeConn('c4', 'C', 0, 'D', 1),
    );
    const result = traceDataFlow('D', 'upstream', conns);
    expect(result).toHaveLength(3);
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toContain('A');
    // A must come after both B and C (BFS: B and C at depth 1, A at depth 2)
    expect(result.indexOf('A')).toBeGreaterThan(result.indexOf('B'));
    expect(result.indexOf('A')).toBeGreaterThan(result.indexOf('C'));
  });

  // 10. Disconnected node: no connections to/from nodeId, returns empty
  it('returns empty for disconnected node', () => {
    const conns = toRecord(
      makeConn('c1', 'X', 0, 'Y', 0),
    );
    expect(traceDataFlow('A', 'downstream', conns)).toEqual([]);
    expect(traceDataFlow('A', 'upstream', conns)).toEqual([]);
  });

  // 11. Node not in any connection: returns empty
  it('returns empty for node not in any connection', () => {
    const conns = toRecord(
      makeConn('c1', 'B', 0, 'C', 0),
      makeConn('c2', 'C', 0, 'D', 0),
    );
    expect(traceDataFlow('Z', 'downstream', conns)).toEqual([]);
    expect(traceDataFlow('Z', 'upstream', conns)).toEqual([]);
  });

  // 12. Cycle safety: A->B->C->A doesn't infinite loop
  it('handles cycles safely without infinite loop', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
      makeConn('c3', 'C', 0, 'A', 0),
    );
    const result = traceDataFlow('A', 'downstream', conns);
    expect(result).toEqual(['B', 'C']);
    // A should NOT reappear since it's the starting node
  });

  it('handles cycles safely upstream', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
      makeConn('c3', 'C', 0, 'A', 0),
    );
    const result = traceDataFlow('A', 'upstream', conns);
    expect(result).toEqual(['C', 'B']);
  });

  // 13. Multiple outputs from same node: A has outputs to B (port 0) and C (port 1)
  it('traces multiple outputs from same node on different ports', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 1, 'C', 0),
    );
    const result = traceDataFlow('A', 'downstream', conns);
    expect(result).toHaveLength(2);
    expect(result).toContain('B');
    expect(result).toContain('C');
  });

  // 14. Starting from middle of chain: A->B->C, trace from B downstream = [C], upstream = [A]
  it('traces from middle of chain downstream', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
    );
    expect(traceDataFlow('B', 'downstream', conns)).toEqual(['C']);
  });

  it('traces from middle of chain upstream', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
    );
    expect(traceDataFlow('B', 'upstream', conns)).toEqual(['A']);
  });

  // 15. Does not include starting node in results
  it('does not include starting node in downstream results', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
    );
    const result = traceDataFlow('A', 'downstream', conns);
    expect(result).not.toContain('A');
  });

  it('does not include starting node in upstream results', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'B', 0, 'C', 0),
    );
    const result = traceDataFlow('C', 'upstream', conns);
    expect(result).not.toContain('C');
  });

  // 16. Complex graph: 6+ nodes, multiple branches and merges
  it('traces complex graph with branches and merges downstream', () => {
    // Graph:
    //   A -> B -> D -> F
    //   A -> C -> D
    //   B -> E -> F
    //   C -> E
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 1, 'C', 0),
      makeConn('c3', 'B', 0, 'D', 0),
      makeConn('c4', 'C', 0, 'D', 1),
      makeConn('c5', 'B', 1, 'E', 0),
      makeConn('c6', 'C', 1, 'E', 1),
      makeConn('c7', 'D', 0, 'F', 0),
      makeConn('c8', 'E', 0, 'F', 1),
    );
    const result = traceDataFlow('A', 'downstream', conns);
    expect(result).toHaveLength(5);
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toContain('D');
    expect(result).toContain('E');
    expect(result).toContain('F');
    // BFS ordering: B, C at depth 1; D, E at depth 2; F at depth 3
    expect(result.indexOf('B')).toBeLessThan(result.indexOf('D'));
    expect(result.indexOf('B')).toBeLessThan(result.indexOf('E'));
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('D'));
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('E'));
    expect(result.indexOf('D')).toBeLessThan(result.indexOf('F'));
    expect(result.indexOf('E')).toBeLessThan(result.indexOf('F'));
  });

  it('traces complex graph upstream from leaf', () => {
    // Same graph as above, trace from F upstream
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 1, 'C', 0),
      makeConn('c3', 'B', 0, 'D', 0),
      makeConn('c4', 'C', 0, 'D', 1),
      makeConn('c5', 'B', 1, 'E', 0),
      makeConn('c6', 'C', 1, 'E', 1),
      makeConn('c7', 'D', 0, 'F', 0),
      makeConn('c8', 'E', 0, 'F', 1),
    );
    const result = traceDataFlow('F', 'upstream', conns);
    expect(result).toHaveLength(5);
    expect(result).toContain('D');
    expect(result).toContain('E');
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toContain('A');
    // BFS ordering: D, E at depth 1; B, C at depth 2; A at depth 3
    expect(result.indexOf('D')).toBeLessThan(result.indexOf('B'));
    expect(result.indexOf('D')).toBeLessThan(result.indexOf('C'));
    expect(result.indexOf('E')).toBeLessThan(result.indexOf('B'));
    expect(result.indexOf('E')).toBeLessThan(result.indexOf('C'));
    expect(result.indexOf('B')).toBeLessThan(result.indexOf('A'));
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('A'));
  });

  // 17. Self-referencing connection safety: connection with src=tgt
  it('handles self-referencing connection safely', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'A', 0),
    );
    // Starting node is in visited set immediately, so self-loop is skipped
    expect(traceDataFlow('A', 'downstream', conns)).toEqual([]);
    expect(traceDataFlow('A', 'upstream', conns)).toEqual([]);
  });

  it('handles self-referencing connection mixed with real connections', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'A', 0), // self-loop
      makeConn('c2', 'A', 0, 'B', 0), // real connection
    );
    expect(traceDataFlow('A', 'downstream', conns)).toEqual(['B']);
  });

  // 18. Multiple connections between same pair: A->B via port 0 and A->B via port 1 - B appears only once
  it('returns each node only once even with multiple connections between same pair', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 1, 'B', 1),
    );
    const result = traceDataFlow('A', 'downstream', conns);
    expect(result).toEqual(['B']);
  });

  it('returns each node only once upstream with multiple connections between same pair', () => {
    const conns = toRecord(
      makeConn('c1', 'A', 0, 'B', 0),
      makeConn('c2', 'A', 1, 'B', 1),
    );
    const result = traceDataFlow('B', 'upstream', conns);
    expect(result).toEqual(['A']);
  });
});
