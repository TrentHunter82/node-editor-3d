/**
 * Tests for the migration utility functions in src/utils/migration.ts.
 *
 * Covers:
 * - CURRENT_SCHEMA_VERSION constant
 * - migrateGraphData framework behaviour (no migrations registered)
 * - normalizeNode validation and repair logic
 * - normalizeConnection strict validation
 * - validateGraphData graph-level cleanup
 */
import { describe, it, expect } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  migrateGraphData,
  normalizeNode,
  normalizeConnection,
  validateGraphData,
} from '../utils/migration';
import type { MigratableGraphData } from '../utils/migration';
import type { EditorNode, Connection, NodeGroup } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid node as a plain object (for normalizeNode which takes Record<string, unknown>). */
function makeRawNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'n1',
    type: 'math',
    position: [1, 2, 3],
    title: 'Math',
    data: { value: 42 },
    inputs: [{ id: 'p1', label: 'A', portType: 'number' }],
    outputs: [{ id: 'p2', label: 'Out', portType: 'number' }],
    ...overrides,
  };
}

/** Minimal valid connection as a plain object. */
function makeRawConnection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c1',
    sourceNodeId: 'n1',
    sourcePortIndex: 0,
    targetNodeId: 'n2',
    targetPortIndex: 0,
    ...overrides,
  };
}

/** Build a MigratableGraphData structure from typed helpers. */
function makeGraphData(
  nodes: Record<string, EditorNode> = {},
  connections: Record<string, Connection> = {},
  groups: Record<string, NodeGroup> = {},
): MigratableGraphData {
  return { nodes, connections, groups, customNodeDefs: {} };
}

/** Shorthand typed node for validateGraphData tests. */
function makeNode(id: string, opts: Partial<EditorNode> = {}): EditorNode {
  return {
    id,
    type: 'math',
    position: [0, 0, 0],
    title: 'Math',
    data: {},
    inputs: [{ id: 'p-in', label: 'A', portType: 'number' }],
    outputs: [{ id: 'p-out', label: 'Out', portType: 'number' }],
    ...opts,
  };
}

/** Shorthand typed connection. */
function makeConnection(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  sourcePortIndex = 0,
  targetPortIndex = 0,
): Connection {
  return { id, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('migrateGraphData', () => {
  it('returns same version when no migrations apply', () => {
    const gd = makeGraphData();
    const result = migrateGraphData(gd, 1);
    expect(result).toBe(1);
  });

  it('does not mutate data when no migrations apply', () => {
    const node = makeNode('n1');
    const gd = makeGraphData({ n1: node });
    const snapshot = JSON.parse(JSON.stringify(gd));
    migrateGraphData(gd, 1);
    expect(gd).toEqual(snapshot);
  });

  it('works with version 0 (no migrations exist from 0)', () => {
    const gd = makeGraphData();
    const result = migrateGraphData(gd, 0);
    // No migration registered for fromVersion 0, so version stays 0
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('normalizeNode', () => {
  it('returns true for a valid node', () => {
    const node = makeRawNode();
    expect(normalizeNode(node)).toBe(true);
  });

  it('returns false when id is missing', () => {
    const node = makeRawNode();
    delete node.id;
    expect(normalizeNode(node)).toBe(false);
  });

  it('returns false when id is empty string', () => {
    expect(normalizeNode(makeRawNode({ id: '' }))).toBe(false);
  });

  it('returns false when id is not a string', () => {
    expect(normalizeNode(makeRawNode({ id: 123 }))).toBe(false);
  });

  it('returns false when type is missing', () => {
    const node = makeRawNode();
    delete node.type;
    expect(normalizeNode(node)).toBe(false);
  });

  it('repairs missing position to [0,0,0]', () => {
    const node = makeRawNode();
    delete node.position;
    expect(normalizeNode(node)).toBe(true);
    expect(node.position).toEqual([0, 0, 0]);
  });

  it('repairs wrong-length position to [0,0,0]', () => {
    const node = makeRawNode({ position: [1, 2] });
    expect(normalizeNode(node)).toBe(true);
    expect(node.position).toEqual([0, 0, 0]);
  });

  it('repairs non-finite position elements (NaN, Infinity)', () => {
    const node = makeRawNode({ position: [NaN, Infinity, -Infinity] });
    expect(normalizeNode(node)).toBe(true);
    expect(node.position).toEqual([0, 0, 0]);
  });

  it('repairs non-string title to String(type)', () => {
    const node = makeRawNode({ title: 42, type: 'filter' });
    expect(normalizeNode(node)).toBe(true);
    expect(node.title).toBe('filter');
  });

  it('repairs null data to {}', () => {
    const node = makeRawNode({ data: null });
    expect(normalizeNode(node)).toBe(true);
    expect(node.data).toEqual({});
  });

  it('repairs array data to {}', () => {
    const node = makeRawNode({ data: [1, 2, 3] });
    expect(normalizeNode(node)).toBe(true);
    expect(node.data).toEqual({});
  });

  it('repairs non-array inputs to []', () => {
    const node = makeRawNode({ inputs: 'bad' });
    expect(normalizeNode(node)).toBe(true);
    expect(node.inputs).toEqual([]);
  });

  it('repairs non-array outputs to []', () => {
    const node = makeRawNode({ outputs: 99 });
    expect(normalizeNode(node)).toBe(true);
    expect(node.outputs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('normalizeConnection', () => {
  it('returns true for a valid connection', () => {
    expect(normalizeConnection(makeRawConnection())).toBe(true);
  });

  it('returns false when id is empty', () => {
    expect(normalizeConnection(makeRawConnection({ id: '' }))).toBe(false);
  });

  it('returns false when sourceNodeId is missing', () => {
    const conn = makeRawConnection();
    delete conn.sourceNodeId;
    expect(normalizeConnection(conn)).toBe(false);
  });

  it('returns false when sourcePortIndex is negative', () => {
    expect(normalizeConnection(makeRawConnection({ sourcePortIndex: -1 }))).toBe(false);
  });

  it('returns false when sourcePortIndex is non-integer (1.5)', () => {
    expect(normalizeConnection(makeRawConnection({ sourcePortIndex: 1.5 }))).toBe(false);
  });

  it('returns false when targetPortIndex is missing', () => {
    const conn = makeRawConnection();
    delete conn.targetPortIndex;
    expect(normalizeConnection(conn)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('validateGraphData', () => {
  it('removes nodes that fail normalizeNode', () => {
    const badNode = makeNode('bad');
    // Force the node type to a non-string to trigger normalizeNode failure
    (badNode as unknown as Record<string, unknown>).type = 123;
    const goodNode = makeNode('good');
    const gd = makeGraphData({ bad: badNode, good: goodNode });

    validateGraphData(gd);

    expect(gd.nodes['bad']).toBeUndefined();
    expect(gd.nodes['good']).toBeDefined();
  });

  it('removes connections with dangling node references', () => {
    const n1 = makeNode('n1');
    const conn = makeConnection('c1', 'n1', 'n-missing', 0, 0);
    const gd = makeGraphData({ n1 }, { c1: conn });

    validateGraphData(gd);

    expect(gd.connections['c1']).toBeUndefined();
  });

  it('removes connections with out-of-bounds port indices', () => {
    // n1 has 1 output (index 0 valid), n2 has 1 input (index 0 valid)
    const n1 = makeNode('n1');
    const n2 = makeNode('n2');
    // sourcePortIndex=5 is out of bounds (only index 0 exists)
    const conn = makeConnection('c1', 'n1', 'n2', 5, 0);
    const gd = makeGraphData({ n1, n2 }, { c1: conn });

    validateGraphData(gd);

    expect(gd.connections['c1']).toBeUndefined();
  });

  it('removes groups without a string id', () => {
    const n1 = makeNode('n1');
    const goodGroup: NodeGroup = { id: 'g1', label: 'Good', collapsed: false };
    const badGroup = { id: 999, label: 'Bad', collapsed: false } as unknown as NodeGroup;
    const gd = makeGraphData({ n1 }, {}, { g1: goodGroup, g2: badGroup });

    validateGraphData(gd);

    expect(gd.groups['g1']).toBeDefined();
    expect(gd.groups['g2']).toBeUndefined();
  });

  it('clears groupId on nodes when the referenced group was removed', () => {
    const n1 = makeNode('n1', { groupId: 'g-deleted' });
    const n2 = makeNode('n2', { groupId: 'g-kept' });
    const keptGroup: NodeGroup = { id: 'g-kept', label: 'Kept', collapsed: false };
    const gd = makeGraphData({ n1, n2 }, {}, { 'g-kept': keptGroup });

    validateGraphData(gd);

    expect(gd.nodes['n1'].groupId).toBeUndefined();
    expect(gd.nodes['n2'].groupId).toBe('g-kept');
  });
});
