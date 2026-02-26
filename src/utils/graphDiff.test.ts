import { describe, it, expect } from 'vitest';
import { compareGraphs } from './graphDiff';
import type { EditorNode, Connection, NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, overrides?: Partial<EditorNode>): EditorNode {
  return {
    id,
    type: 'source' as NodeType,
    position: [0, 0, 0] as [number, number, number],
    title: `Node ${id}`,
    data: { value: 0 },
    inputs: [],
    outputs: [{ id: 'out0', label: 'out', portType: 'number' as const }],
    ...overrides,
  };
}

function makeConn(
  id: string,
  src: string,
  tgt: string,
  overrides?: Partial<Connection>,
): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: 0,
    targetNodeId: tgt,
    targetPortIndex: 0,
    ...overrides,
  };
}

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  const r: Record<string, T> = {};
  for (const item of items) r[item.id] = item;
  return r;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compareGraphs', () => {
  // ---- Empty graphs -------------------------------------------------------

  describe('empty graphs', () => {
    it('returns isEmpty true when both graphs are empty', () => {
      const diff = compareGraphs({}, {}, {}, {});
      expect(diff.isEmpty).toBe(true);
      expect(diff.nodeChanges).toHaveLength(0);
      expect(diff.connectionChanges).toHaveLength(0);
      expect(diff.summary).toEqual({
        nodesAdded: 0,
        nodesRemoved: 0,
        nodesModified: 0,
        connectionsAdded: 0,
        connectionsRemoved: 0,
        connectionsModified: 0,
      });
    });
  });

  // ---- Identical graphs ---------------------------------------------------

  describe('identical graphs', () => {
    it('returns isEmpty true for identical single-node graphs', () => {
      const nodes = toRecord([makeNode('n1')]);
      const conns = {};
      const diff = compareGraphs(nodes, conns, nodes, conns);
      expect(diff.isEmpty).toBe(true);
      expect(diff.nodeChanges).toHaveLength(0);
    });

    it('returns isEmpty true for identical multi-node graphs with connections', () => {
      const nodes = toRecord([makeNode('n1'), makeNode('n2')]);
      const conns = toRecord([makeConn('c1', 'n1', 'n2')]);
      const diff = compareGraphs(nodes, conns, nodes, conns);
      expect(diff.isEmpty).toBe(true);
      expect(diff.connectionChanges).toHaveLength(0);
    });
  });

  // ---- Node additions -----------------------------------------------------

  describe('node additions', () => {
    it('detects a single added node', () => {
      const nodesA = {};
      const nodesB = toRecord([makeNode('n1')]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.isEmpty).toBe(false);
      expect(diff.nodeChanges).toHaveLength(1);
      expect(diff.nodeChanges[0].type).toBe('added');
      expect(diff.nodeChanges[0].nodeId).toBe('n1');
      expect(diff.nodeChanges[0].after).toEqual(nodesB['n1']);
      expect(diff.nodeChanges[0].before).toBeUndefined();
      expect(diff.summary.nodesAdded).toBe(1);
    });

    it('detects multiple added nodes', () => {
      const nodesB = toRecord([makeNode('n1'), makeNode('n2'), makeNode('n3')]);
      const diff = compareGraphs({}, {}, nodesB, {});
      expect(diff.summary.nodesAdded).toBe(3);
      expect(diff.nodeChanges.every((c) => c.type === 'added')).toBe(true);
    });
  });

  // ---- Node removals ------------------------------------------------------

  describe('node removals', () => {
    it('detects a single removed node', () => {
      const nodesA = toRecord([makeNode('n1')]);
      const diff = compareGraphs(nodesA, {}, {}, {});
      expect(diff.isEmpty).toBe(false);
      expect(diff.nodeChanges).toHaveLength(1);
      expect(diff.nodeChanges[0].type).toBe('removed');
      expect(diff.nodeChanges[0].nodeId).toBe('n1');
      expect(diff.nodeChanges[0].before).toEqual(nodesA['n1']);
      expect(diff.nodeChanges[0].after).toBeUndefined();
      expect(diff.summary.nodesRemoved).toBe(1);
    });

    it('detects multiple removed nodes', () => {
      const nodesA = toRecord([makeNode('n1'), makeNode('n2')]);
      const diff = compareGraphs(nodesA, {}, {}, {});
      expect(diff.summary.nodesRemoved).toBe(2);
    });
  });

  // ---- Node modifications -------------------------------------------------

  describe('node modifications', () => {
    it('detects title change', () => {
      const nodesA = toRecord([makeNode('n1', { title: 'Old' })]);
      const nodesB = toRecord([makeNode('n1', { title: 'New' })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.summary.nodesModified).toBe(1);
      const change = diff.nodeChanges[0];
      expect(change.type).toBe('modified');
      expect(change.changedFields).toContain('title');
      expect(change.before!.title).toBe('Old');
      expect(change.after!.title).toBe('New');
    });

    it('detects position change', () => {
      const nodesA = toRecord([makeNode('n1', { position: [0, 0, 0] })]);
      const nodesB = toRecord([makeNode('n1', { position: [1, 2, 3] })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('position');
    });

    it('detects position change in single axis', () => {
      const nodesA = toRecord([makeNode('n1', { position: [1, 2, 3] })]);
      const nodesB = toRecord([makeNode('n1', { position: [1, 2, 4] })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toEqual(['position']);
    });

    it('detects data change', () => {
      const nodesA = toRecord([makeNode('n1', { data: { value: 1 } })]);
      const nodesB = toRecord([makeNode('n1', { data: { value: 2 } })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('data');
    });

    it('detects data change with nested objects', () => {
      const nodesA = toRecord([makeNode('n1', { data: { nested: { a: 1 } } })]);
      const nodesB = toRecord([makeNode('n1', { data: { nested: { a: 2 } } })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('data');
    });

    it('detects comment change', () => {
      const nodesA = toRecord([makeNode('n1', { comment: 'old' })]);
      const nodesB = toRecord([makeNode('n1', { comment: 'new' })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('comment');
    });

    it('detects locked change', () => {
      const nodesA = toRecord([makeNode('n1', { locked: false })]);
      const nodesB = toRecord([makeNode('n1', { locked: true })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('locked');
    });

    it('detects collapsed change', () => {
      const nodesA = toRecord([makeNode('n1', { collapsed: false })]);
      const nodesB = toRecord([makeNode('n1', { collapsed: true })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('collapsed');
    });

    it('detects groupId change', () => {
      const nodesA = toRecord([makeNode('n1', { groupId: 'g1' })]);
      const nodesB = toRecord([makeNode('n1', { groupId: 'g2' })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('groupId');
    });

    it('detects autoInserted change', () => {
      const nodesA = toRecord([makeNode('n1', { autoInserted: false })]);
      const nodesB = toRecord([makeNode('n1', { autoInserted: true })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('autoInserted');
    });

    it('detects type change', () => {
      const nodesA = toRecord([makeNode('n1', { type: 'source' })]);
      const nodesB = toRecord([makeNode('n1', { type: 'math' })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('type');
    });

    it('detects inputs change', () => {
      const nodesA = toRecord([makeNode('n1', { inputs: [] })]);
      const nodesB = toRecord([
        makeNode('n1', {
          inputs: [{ id: 'in0', label: 'x', portType: 'number' }],
        }),
      ]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('inputs');
    });

    it('detects outputs change', () => {
      const nodesA = toRecord([
        makeNode('n1', {
          outputs: [{ id: 'out0', label: 'out', portType: 'number' }],
        }),
      ]);
      const nodesB = toRecord([
        makeNode('n1', {
          outputs: [{ id: 'out0', label: 'result', portType: 'string' }],
        }),
      ]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('outputs');
    });

    it('reports multiple changed fields on a single node', () => {
      const nodesA = toRecord([
        makeNode('n1', { title: 'A', position: [0, 0, 0], locked: false }),
      ]);
      const nodesB = toRecord([
        makeNode('n1', { title: 'B', position: [5, 5, 5], locked: true }),
      ]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      const fields = diff.nodeChanges[0].changedFields!;
      expect(fields).toContain('title');
      expect(fields).toContain('position');
      expect(fields).toContain('locked');
      expect(fields).toHaveLength(3);
    });

    it('does not flag identical data as modified (deep equality)', () => {
      const nodesA = toRecord([makeNode('n1', { data: { arr: [1, 2, 3] } })]);
      const nodesB = toRecord([makeNode('n1', { data: { arr: [1, 2, 3] } })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.isEmpty).toBe(true);
    });
  });

  // ---- Connection additions -----------------------------------------------

  describe('connection additions', () => {
    it('detects a single added connection', () => {
      const connsB = toRecord([makeConn('c1', 'n1', 'n2')]);
      const diff = compareGraphs({}, {}, {}, connsB);
      expect(diff.isEmpty).toBe(false);
      expect(diff.connectionChanges).toHaveLength(1);
      expect(diff.connectionChanges[0].type).toBe('added');
      expect(diff.connectionChanges[0].connectionId).toBe('c1');
      expect(diff.connectionChanges[0].after).toEqual(connsB['c1']);
      expect(diff.connectionChanges[0].before).toBeUndefined();
      expect(diff.summary.connectionsAdded).toBe(1);
    });
  });

  // ---- Connection removals ------------------------------------------------

  describe('connection removals', () => {
    it('detects a single removed connection', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n2')]);
      const diff = compareGraphs({}, connsA, {}, {});
      expect(diff.connectionChanges).toHaveLength(1);
      expect(diff.connectionChanges[0].type).toBe('removed');
      expect(diff.connectionChanges[0].before).toEqual(connsA['c1']);
      expect(diff.connectionChanges[0].after).toBeUndefined();
      expect(diff.summary.connectionsRemoved).toBe(1);
    });
  });

  // ---- Connection modifications -------------------------------------------

  describe('connection modifications', () => {
    it('detects label change', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n2', { label: 'old' })]);
      const connsB = toRecord([makeConn('c1', 'n1', 'n2', { label: 'new' })]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      expect(diff.connectionChanges).toHaveLength(1);
      expect(diff.connectionChanges[0].type).toBe('modified');
      expect(diff.connectionChanges[0].changedFields).toContain('label');
      expect(diff.summary.connectionsModified).toBe(1);
    });

    it('detects colorOverride change', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n2', { colorOverride: '#ff0000' })]);
      const connsB = toRecord([makeConn('c1', 'n1', 'n2', { colorOverride: '#00ff00' })]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      expect(diff.connectionChanges[0].changedFields).toContain('colorOverride');
    });

    it('detects styleOverride change', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n2', { styleOverride: 'bezier' })]);
      const connsB = toRecord([makeConn('c1', 'n1', 'n2', { styleOverride: 'straight' })]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      expect(diff.connectionChanges[0].changedFields).toContain('styleOverride');
    });

    it('detects sourceNodeId change', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n3')]);
      const connsB = toRecord([makeConn('c1', 'n2', 'n3')]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      expect(diff.connectionChanges[0].changedFields).toContain('sourceNodeId');
    });

    it('detects sourcePortIndex change', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n2', { sourcePortIndex: 0 })]);
      const connsB = toRecord([makeConn('c1', 'n1', 'n2', { sourcePortIndex: 1 })]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      expect(diff.connectionChanges[0].changedFields).toContain('sourcePortIndex');
    });

    it('detects targetNodeId change', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n2')]);
      const connsB = toRecord([makeConn('c1', 'n1', 'n3')]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      expect(diff.connectionChanges[0].changedFields).toContain('targetNodeId');
    });

    it('detects targetPortIndex change', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n2', { targetPortIndex: 0 })]);
      const connsB = toRecord([makeConn('c1', 'n1', 'n2', { targetPortIndex: 2 })]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      expect(diff.connectionChanges[0].changedFields).toContain('targetPortIndex');
    });

    it('reports multiple changed fields on a single connection', () => {
      const connsA = toRecord([
        makeConn('c1', 'n1', 'n2', { label: 'a', colorOverride: '#000' }),
      ]);
      const connsB = toRecord([
        makeConn('c1', 'n1', 'n2', { label: 'b', colorOverride: '#fff' }),
      ]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      const fields = diff.connectionChanges[0].changedFields!;
      expect(fields).toContain('label');
      expect(fields).toContain('colorOverride');
      expect(fields).toHaveLength(2);
    });

    it('does not flag identical connections as modified', () => {
      const conns = toRecord([makeConn('c1', 'n1', 'n2', { label: 'same' })]);
      const diff = compareGraphs({}, conns, {}, conns);
      expect(diff.isEmpty).toBe(true);
    });
  });

  // ---- Mixed changes ------------------------------------------------------

  describe('mixed changes', () => {
    it('detects node adds + removes + modifications together', () => {
      const nodesA = toRecord([
        makeNode('n1', { title: 'Original' }),
        makeNode('n2'),
      ]);
      const nodesB = toRecord([
        makeNode('n1', { title: 'Changed' }),
        makeNode('n3'),
      ]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.summary.nodesAdded).toBe(1); // n3
      expect(diff.summary.nodesRemoved).toBe(1); // n2
      expect(diff.summary.nodesModified).toBe(1); // n1
      expect(diff.isEmpty).toBe(false);
    });

    it('detects node and connection changes simultaneously', () => {
      const nodesA = toRecord([makeNode('n1')]);
      const nodesB = toRecord([makeNode('n1'), makeNode('n2')]);
      const connsA = toRecord([makeConn('c1', 'n1', 'n2')]);
      const connsB = {};
      const diff = compareGraphs(nodesA, connsA, nodesB, connsB);
      expect(diff.summary.nodesAdded).toBe(1);
      expect(diff.summary.connectionsRemoved).toBe(1);
      expect(diff.isEmpty).toBe(false);
    });

    it('computes correct summary counts for complex diff', () => {
      const nodesA = toRecord([
        makeNode('n1'),
        makeNode('n2'),
        makeNode('n3', { title: 'Before' }),
      ]);
      const nodesB = toRecord([
        makeNode('n1'),
        makeNode('n3', { title: 'After' }),
        makeNode('n4'),
        makeNode('n5'),
      ]);
      const connsA = toRecord([
        makeConn('c1', 'n1', 'n2'),
        makeConn('c2', 'n2', 'n3', { label: 'x' }),
      ]);
      const connsB = toRecord([
        makeConn('c2', 'n2', 'n3', { label: 'y' }),
        makeConn('c3', 'n1', 'n4'),
      ]);
      const diff = compareGraphs(nodesA, connsA, nodesB, connsB);
      expect(diff.summary).toEqual({
        nodesAdded: 2,    // n4, n5
        nodesRemoved: 1,  // n2
        nodesModified: 1, // n3 title changed
        connectionsAdded: 1,    // c3
        connectionsRemoved: 1,  // c1
        connectionsModified: 1, // c2 label changed
      });
      expect(diff.isEmpty).toBe(false);
    });
  });

  // ---- before/after references --------------------------------------------

  describe('before/after references', () => {
    it('added node has after but no before', () => {
      const node = makeNode('n1');
      const diff = compareGraphs({}, {}, toRecord([node]), {});
      const change = diff.nodeChanges[0];
      expect(change.after).toEqual(node);
      expect(change.before).toBeUndefined();
    });

    it('removed node has before but no after', () => {
      const node = makeNode('n1');
      const diff = compareGraphs(toRecord([node]), {}, {}, {});
      const change = diff.nodeChanges[0];
      expect(change.before).toEqual(node);
      expect(change.after).toBeUndefined();
    });

    it('modified node has both before and after', () => {
      const nodeA = makeNode('n1', { title: 'A' });
      const nodeB = makeNode('n1', { title: 'B' });
      const diff = compareGraphs(toRecord([nodeA]), {}, toRecord([nodeB]), {});
      const change = diff.nodeChanges[0];
      expect(change.before).toEqual(nodeA);
      expect(change.after).toEqual(nodeB);
    });

    it('added connection has after but no before', () => {
      const conn = makeConn('c1', 'n1', 'n2');
      const diff = compareGraphs({}, {}, {}, toRecord([conn]));
      const change = diff.connectionChanges[0];
      expect(change.after).toEqual(conn);
      expect(change.before).toBeUndefined();
    });

    it('removed connection has before but no after', () => {
      const conn = makeConn('c1', 'n1', 'n2');
      const diff = compareGraphs({}, toRecord([conn]), {}, {});
      const change = diff.connectionChanges[0];
      expect(change.before).toEqual(conn);
      expect(change.after).toBeUndefined();
    });

    it('modified connection has both before and after', () => {
      const connA = makeConn('c1', 'n1', 'n2', { label: 'old' });
      const connB = makeConn('c1', 'n1', 'n2', { label: 'new' });
      const diff = compareGraphs({}, toRecord([connA]), {}, toRecord([connB]));
      const change = diff.connectionChanges[0];
      expect(change.before).toEqual(connA);
      expect(change.after).toEqual(connB);
    });
  });

  // ---- Edge cases ---------------------------------------------------------

  describe('edge cases', () => {
    it('handles undefined vs defined optional fields on nodes', () => {
      const nodesA = toRecord([makeNode('n1')]); // comment is undefined
      const nodesB = toRecord([makeNode('n1', { comment: 'hello' })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.nodeChanges[0].changedFields).toContain('comment');
    });

    it('handles undefined vs defined optional fields on connections', () => {
      const connsA = toRecord([makeConn('c1', 'n1', 'n2')]); // label undefined
      const connsB = toRecord([makeConn('c1', 'n1', 'n2', { label: 'x' })]);
      const diff = compareGraphs({}, connsA, {}, connsB);
      expect(diff.connectionChanges[0].changedFields).toContain('label');
    });

    it('treats same position values as equal', () => {
      const nodesA = toRecord([makeNode('n1', { position: [3, 4, 5] })]);
      const nodesB = toRecord([makeNode('n1', { position: [3, 4, 5] })]);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.isEmpty).toBe(true);
    });

    it('handles large number of nodes efficiently', () => {
      const nodes: EditorNode[] = [];
      for (let i = 0; i < 100; i++) {
        nodes.push(makeNode(`n${i}`));
      }
      const nodesA = toRecord(nodes);
      // Modify one, add one, remove one
      const modifiedNodes = nodes
        .filter((n) => n.id !== 'n99')
        .map((n) => (n.id === 'n0' ? { ...n, title: 'Modified' } : n));
      modifiedNodes.push(makeNode('n100'));
      const nodesB = toRecord(modifiedNodes);
      const diff = compareGraphs(nodesA, {}, nodesB, {});
      expect(diff.summary.nodesAdded).toBe(1);
      expect(diff.summary.nodesRemoved).toBe(1);
      expect(diff.summary.nodesModified).toBe(1);
    });
  });
});
