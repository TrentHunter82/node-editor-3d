import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState, snapToGrid, GRID_SNAP_SIZE } from './editorStore';
import { saveMultiGraph } from '../utils/serialization';
import type { EditorNode, Connection, GraphTab } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.contextMenu = null;
    s.customNodeDefs = {};
    s.searchQuery = '';
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.templates = {};
    s.breadcrumbStack = [];
    s.subgraphDefs = {};
    s.errorStrategy = 'fail-fast';
    s.validationErrors = {};
    s.executionMetrics = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

/** Create a minimal EditorNode for testing sanitize/import helpers */
function makeNode(id: string, type: 'source' | 'math' | 'transform' | 'output', position: [number, number, number] = [0, 0, 0]): EditorNode {
  const configs: Record<string, { inputs: { id: string; label: string; portType: 'number' | 'string' | 'any' }[]; outputs: { id: string; label: string; portType: 'number' | 'string' | 'any' }[] }> = {
    source: {
      inputs: [],
      outputs: [
        { id: 'out-0', label: 'value', portType: 'number' },
        { id: 'out-1', label: 'label', portType: 'string' },
      ],
    },
    math: {
      inputs: [
        { id: 'in-0', label: 'a', portType: 'number' },
        { id: 'in-1', label: 'b', portType: 'number' },
      ],
      outputs: [
        { id: 'out-0', label: 'result', portType: 'number' },
      ],
    },
    transform: {
      inputs: [
        { id: 'in-0', label: 'in', portType: 'number' },
        { id: 'in-1', label: 'factor', portType: 'number' },
      ],
      outputs: [
        { id: 'out-0', label: 'result', portType: 'number' },
        { id: 'out-1', label: 'debug', portType: 'string' },
      ],
    },
    output: {
      inputs: [
        { id: 'in-0', label: 'data', portType: 'any' },
        { id: 'in-1', label: 'label', portType: 'string' },
      ],
      outputs: [],
    },
  };
  const cfg = configs[type];
  return {
    id,
    type,
    position,
    title: type.charAt(0).toUpperCase() + type.slice(1),
    data: {},
    inputs: cfg.inputs,
    outputs: cfg.outputs,
  };
}

function makeConnection(id: string, srcId: string, srcPort: number, tgtId: string, tgtPort: number): Connection {
  return { id, sourceNodeId: srcId, sourcePortIndex: srcPort, targetNodeId: tgtId, targetPortIndex: tgtPort };
}

// ===========================================================================
// 1. wouldCreateCycle (tested via addConnection returning null)
// ===========================================================================
describe('wouldCreateCycle (via addConnection)', () => {
  beforeEach(() => { resetStore(); });

  it('prevents self-connections', () => {
    const a = getState().addNode('math');
    // math: 2 number inputs, 1 number output — connecting output 0 to input 0 on same node
    const result = getState().addConnection(a, 0, a, 0);
    expect(result).toBeNull();
  });

  it('prevents direct cycle A -> B -> A', () => {
    const a = getState().addNode('math');
    const b = getState().addNode('math');
    // A output 0 -> B input 0 (valid)
    const c1 = getState().addConnection(a, 0, b, 0);
    expect(c1).not.toBeNull();
    // B output 0 -> A input 0 would create cycle
    const c2 = getState().addConnection(b, 0, a, 0);
    expect(c2).toBeNull();
  });

  it('prevents multi-node cycle A -> B -> C -> A', () => {
    const a = getState().addNode('math');
    const b = getState().addNode('math');
    const c = getState().addNode('math');
    // A -> B
    expect(getState().addConnection(a, 0, b, 0)).not.toBeNull();
    // B -> C
    expect(getState().addConnection(b, 0, c, 0)).not.toBeNull();
    // C -> A would close the cycle
    const result = getState().addConnection(c, 0, a, 0);
    expect(result).toBeNull();
  });

  it('allows acyclic connection A -> B, B -> C, then A -> C', () => {
    const a = getState().addNode('math');
    const b = getState().addNode('math');
    const c = getState().addNode('math');
    // A -> B
    expect(getState().addConnection(a, 0, b, 0)).not.toBeNull();
    // B -> C
    expect(getState().addConnection(b, 0, c, 0)).not.toBeNull();
    // A -> C (skip connection, not a cycle since we go from upstream to downstream)
    const result = getState().addConnection(a, 0, c, 1);
    expect(result).not.toBeNull();
  });

  it('allows diamond graph (no cycle)', () => {
    // Diamond: A -> B, A -> C, B -> D, C -> D
    const a = getState().addNode('source');
    const b = getState().addNode('math');
    const c = getState().addNode('math');
    const d = getState().addNode('math');
    // A output 0 (number) -> B input 0
    expect(getState().addConnection(a, 0, b, 0)).not.toBeNull();
    // A output 0 (number) -> C input 0
    expect(getState().addConnection(a, 0, c, 0)).not.toBeNull();
    // B output 0 -> D input 0
    expect(getState().addConnection(b, 0, d, 0)).not.toBeNull();
    // C output 0 -> D input 1
    const result = getState().addConnection(c, 0, d, 1);
    expect(result).not.toBeNull();
  });

  it('prevents longer cycle with 4 nodes: A -> B -> C -> D -> A', () => {
    const a = getState().addNode('math');
    const b = getState().addNode('math');
    const c = getState().addNode('math');
    const d = getState().addNode('math');
    expect(getState().addConnection(a, 0, b, 0)).not.toBeNull();
    expect(getState().addConnection(b, 0, c, 0)).not.toBeNull();
    expect(getState().addConnection(c, 0, d, 0)).not.toBeNull();
    // D -> A would close the cycle
    const result = getState().addConnection(d, 0, a, 0);
    expect(result).toBeNull();
  });

  it('allows reverse direction (no cycle): A -> B, then C -> A', () => {
    const a = getState().addNode('math');
    const b = getState().addNode('math');
    const c = getState().addNode('math');
    // A -> B
    expect(getState().addConnection(a, 0, b, 0)).not.toBeNull();
    // C -> A is fine (C is upstream of A, not downstream)
    const result = getState().addConnection(c, 0, a, 0);
    expect(result).not.toBeNull();
  });
});

// ===========================================================================
// 2. sanitizeConnections (tested via importWorkflow)
// ===========================================================================
describe('sanitizeConnections (via importWorkflow)', () => {
  beforeEach(() => { resetStore(); });

  it('removes connections referencing missing source node', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', 'math'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'missing-node', 0, 'n1', 0),
    };
    getState().importWorkflow({ nodes, connections });
    expect(Object.keys(getState().connections)).toHaveLength(0);
    expect(getState().nodes.n1).toBeDefined();
  });

  it('removes connections referencing missing target node', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', 'source'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'n1', 0, 'missing-node', 0),
    };
    getState().importWorkflow({ nodes, connections });
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('removes connections with out-of-range source port index', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', 'source'),   // 2 outputs
      n2: makeNode('n2', 'math'),     // 2 inputs
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'n1', 99, 'n2', 0), // port 99 does not exist
    };
    getState().importWorkflow({ nodes, connections });
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('removes connections with out-of-range target port index', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', 'source'),
      n2: makeNode('n2', 'math'),  // 2 inputs (indices 0, 1)
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'n1', 0, 'n2', 5), // target port 5 does not exist
    };
    getState().importWorkflow({ nodes, connections });
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('removes connections with negative source port index', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', 'source'),
      n2: makeNode('n2', 'math'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'n1', -1, 'n2', 0),
    };
    getState().importWorkflow({ nodes, connections });
    expect(Object.keys(getState().connections)).toHaveLength(0);
  });

  it('keeps valid connections intact', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', 'source'),   // outputs: [number, string]
      n2: makeNode('n2', 'math'),     // inputs: [number, number]
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'n1', 0, 'n2', 0), // source output 0 (number) -> math input 0 (number)
    };
    getState().importWorkflow({ nodes, connections });
    expect(Object.keys(getState().connections)).toHaveLength(1);
    expect(getState().connections.c1).toBeDefined();
    expect(getState().connections.c1.sourceNodeId).toBe('n1');
    expect(getState().connections.c1.targetNodeId).toBe('n2');
  });

  it('keeps valid connections while removing invalid ones in same import', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', 'source'),
      n2: makeNode('n2', 'math'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConnection('c1', 'n1', 0, 'n2', 0),           // valid
      c2: makeConnection('c2', 'n1', 0, 'ghost', 0),         // invalid - missing target
      c3: makeConnection('c3', 'nonexistent', 0, 'n2', 0),   // invalid - missing source
    };
    getState().importWorkflow({ nodes, connections });
    expect(Object.keys(getState().connections)).toHaveLength(1);
    expect(getState().connections.c1).toBeDefined();
    expect(getState().connections.c2).toBeUndefined();
    expect(getState().connections.c3).toBeUndefined();
  });
});

// ===========================================================================
// 3. syncNextId (tested via importWorkflow then addNode)
// ===========================================================================
describe('syncNextId (via importWorkflow then addNode)', () => {
  beforeEach(() => { resetStore(); });

  it('new node IDs are higher than loaded node IDs', () => {
    const nodes: Record<string, EditorNode> = {
      'node-100': makeNode('node-100', 'source'),
    };
    getState().importWorkflow({ nodes, connections: {} });
    // After import, syncNextId should have set nextId > 100
    const newId = getState().addNode('math');
    const num = parseInt(newId.replace(/\D+/g, ''), 10);
    expect(num).toBeGreaterThan(100);
  });

  it('accounts for connection IDs when syncing', () => {
    const nodes: Record<string, EditorNode> = {
      'node-5': makeNode('node-5', 'source'),
      'node-6': makeNode('node-6', 'math'),
    };
    const connections: Record<string, Connection> = {
      'conn-200': makeConnection('conn-200', 'node-5', 0, 'node-6', 0),
    };
    getState().importWorkflow({ nodes, connections });
    const newId = getState().addNode('math');
    const num = parseInt(newId.replace(/\D+/g, ''), 10);
    expect(num).toBeGreaterThan(200);
  });

  it('accounts for group IDs when syncing', () => {
    const nodes: Record<string, EditorNode> = {
      'node-1': makeNode('node-1', 'source'),
    };
    const groups = {
      'group-500': { id: 'group-500', label: 'G', collapsed: false },
    };
    getState().importWorkflow({ nodes, connections: {}, groups });
    const newId = getState().addNode('math');
    const num = parseInt(newId.replace(/\D+/g, ''), 10);
    expect(num).toBeGreaterThan(500);
  });

  it('after reset, IDs start fresh from 1', () => {
    resetStore();
    const id = getState().addNode('source');
    const num = parseInt(id.replace(/\D+/g, ''), 10);
    expect(num).toBe(1);
  });

  it('handles mixed ID formats by extracting max numeric value', () => {
    const nodes: Record<string, EditorNode> = {
      'node-42': makeNode('node-42', 'source'),
      'node-7': makeNode('node-7', 'math'),
    };
    getState().importWorkflow({ nodes, connections: {} });
    const newId = getState().addNode('math');
    const num = parseInt(newId.replace(/\D+/g, ''), 10);
    // Should be > 42 (the max numeric ID)
    expect(num).toBeGreaterThan(42);
  });
});

// ===========================================================================
// 4. sanitizeGraphOrder (tested via loadFromStorage)
// ===========================================================================
describe('sanitizeGraphOrder (via loadFromStorage)', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('removes non-existent IDs from graphOrder', () => {
    const graphTabs: Record<string, GraphTab> = {
      default: { id: 'default', name: 'Main', createdAt: 1000 },
    };
    const storage = {
      version: 2 as const,
      graphs: {
        default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs,
      activeGraphId: 'default',
      graphOrder: ['default', 'nonexistent-1', 'nonexistent-2'],
      templates: {},
    };
    saveMultiGraph(storage);
    getState().loadFromStorage();
    // graphOrder should only contain 'default', the phantom IDs removed
    expect(getState().graphOrder).toEqual(['default']);
  });

  it('adds missing tab IDs that are not in graphOrder', () => {
    const graphTabs: Record<string, GraphTab> = {
      default: { id: 'default', name: 'Main', createdAt: 1000 },
      'graph-2': { id: 'graph-2', name: 'Second', createdAt: 2000 },
    };
    const storage = {
      version: 2 as const,
      graphs: {
        default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        'graph-2': { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs,
      activeGraphId: 'default',
      graphOrder: ['default'], // Missing 'graph-2'
      templates: {},
    };
    saveMultiGraph(storage);
    getState().loadFromStorage();
    expect(getState().graphOrder).toContain('default');
    expect(getState().graphOrder).toContain('graph-2');
    expect(getState().graphOrder).toHaveLength(2);
  });

  it('handles completely empty graphOrder by adding all tabs', () => {
    const graphTabs: Record<string, GraphTab> = {
      default: { id: 'default', name: 'Main', createdAt: 1000 },
      'graph-3': { id: 'graph-3', name: 'Third', createdAt: 3000 },
    };
    const storage = {
      version: 2 as const,
      graphs: {
        default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        'graph-3': { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs,
      activeGraphId: 'default',
      graphOrder: [], // Completely empty
      templates: {},
    };
    saveMultiGraph(storage);
    getState().loadFromStorage();
    expect(getState().graphOrder).toContain('default');
    expect(getState().graphOrder).toContain('graph-3');
    expect(getState().graphOrder).toHaveLength(2);
  });

  it('preserves order of valid entries while appending missing ones', () => {
    const graphTabs: Record<string, GraphTab> = {
      a: { id: 'a', name: 'A', createdAt: 1000 },
      b: { id: 'b', name: 'B', createdAt: 2000 },
      c: { id: 'c', name: 'C', createdAt: 3000 },
    };
    const storage = {
      version: 2 as const,
      graphs: {
        a: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        b: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
        c: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs,
      activeGraphId: 'a',
      graphOrder: ['b', 'a'], // c is missing, a and b are in custom order
      templates: {},
    };
    saveMultiGraph(storage);
    getState().loadFromStorage();
    const order = getState().graphOrder;
    // b and a should retain their original order, c appended at end
    expect(order[0]).toBe('b');
    expect(order[1]).toBe('a');
    expect(order[2]).toBe('c');
    expect(order).toHaveLength(3);
  });
});

// ===========================================================================
// 5. fuzzyScore (tested via searchNodes)
// ===========================================================================
describe('fuzzyScore (via searchNodes)', () => {
  beforeEach(() => { resetStore(); });

  it('exact match ranks highest', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(src, 'Alpha');
    const math = getState().addNode('math', [1, 0, 0]);
    getState().updateNodeTitle(math, 'AlphaOmega');

    const results = getState().searchNodes('Alpha');
    // Both should match, but "Alpha" (exact substring) should rank first
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].title).toBe('Alpha');
  });

  it('partial substring matches', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'Transform Data');

    const results = getState().searchNodes('form');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(n => n.title === 'Transform Data')).toBe(true);
  });

  it('word-start bonus: "td" matches "Transform Data" via word starts', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'Transform Data');

    // "td" matches T(ransform) D(ata) - word start bonus
    const results = getState().searchNodes('td');
    expect(results.some(n => n.title === 'Transform Data')).toBe(true);
  });

  it('consecutive characters score higher', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id1, 'abc');
    const id2 = getState().addNode('source', [1, 0, 0]);
    getState().updateNodeTitle(id2, 'axbxc');

    const results = getState().searchNodes('abc');
    // 'abc' should rank higher than 'axbxc' because characters are consecutive
    expect(results[0].title).toBe('abc');
  });

  it('no match returns empty results for that node', () => {
    getState().addNode('source', [0, 0, 0]);
    // "zzz" should not match 'Source' node
    const results = getState().searchNodes('zzz');
    expect(results).toHaveLength(0);
  });

  it('empty query returns all nodes', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('math', [1, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);
    const results = getState().searchNodes('');
    expect(results).toHaveLength(3);
  });

  it('search is case-insensitive', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeTitle(id, 'MySpecialNode');
    const results = getState().searchNodes('myspecialnode');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe('MySpecialNode');
  });

  it('searches across node title, type, and id', () => {
    const id = getState().addNode('math', [0, 0, 0]);
    // Search by type
    const byType = getState().searchNodes('math');
    expect(byType.some(n => n.id === id)).toBe(true);
    // Search by ID prefix
    const byId = getState().searchNodes('node-');
    expect(byId.some(n => n.id === id)).toBe(true);
  });
});

// ===========================================================================
// 6. snapToGrid (directly exported)
// ===========================================================================
describe('snapToGrid', () => {
  it('GRID_SNAP_SIZE is 0.5', () => {
    expect(GRID_SNAP_SIZE).toBe(0.5);
  });

  it('snaps exact multiples to themselves', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(0.5)).toBe(0.5);
    expect(snapToGrid(1.0)).toBe(1.0);
    expect(snapToGrid(1.5)).toBe(1.5);
    expect(snapToGrid(2.0)).toBe(2.0);
    expect(snapToGrid(3.5)).toBe(3.5);
  });

  it('rounds to nearest grid multiple', () => {
    expect(snapToGrid(0.3)).toBe(0.5);
    expect(snapToGrid(0.2)).toBe(0);
    expect(snapToGrid(0.7)).toBe(0.5);
    expect(snapToGrid(0.8)).toBe(1.0);
    expect(snapToGrid(1.3)).toBe(1.5);
    expect(snapToGrid(1.7)).toBe(1.5);
    expect(snapToGrid(1.8)).toBe(2.0);
  });

  it('handles negative values', () => {
    expect(snapToGrid(-0.5)).toBe(-0.5);
    expect(snapToGrid(-1.0)).toBe(-1.0);
    expect(snapToGrid(-1.5)).toBe(-1.5);
    expect(snapToGrid(-0.3)).toBeCloseTo(-0.5, 10);
    expect(snapToGrid(-0.7)).toBeCloseTo(-0.5, 10);
    expect(snapToGrid(-0.8)).toBeCloseTo(-1.0, 10);
    expect(snapToGrid(-1.3)).toBeCloseTo(-1.5, 10);
  });

  it('snaps zero correctly', () => {
    expect(snapToGrid(0)).toBe(0);
  });

  it('handles small negative values that snap to -0 (use toBeCloseTo)', () => {
    // snapToGrid(-0.1) = Math.round(-0.1 / 0.5) * 0.5 = Math.round(-0.2) * 0.5 = 0 * 0.5 = -0
    // -0 === 0 in JS, but toBe(0) fails for -0 in some matchers, so use toBeCloseTo
    expect(snapToGrid(-0.1)).toBeCloseTo(0, 10);
    expect(snapToGrid(-0.24)).toBeCloseTo(0, 10);
  });

  it('handles large values', () => {
    expect(snapToGrid(100.3)).toBe(100.5);
    expect(snapToGrid(100.1)).toBe(100.0);
    expect(snapToGrid(-99.7)).toBeCloseTo(-99.5, 10);
    expect(snapToGrid(-99.8)).toBeCloseTo(-100.0, 10);
  });

  it('value exactly at midpoint (0.25) rounds to 0.5', () => {
    // Math.round(0.25 / 0.5) = Math.round(0.5) = 1 (rounds up) => 1 * 0.5 = 0.5
    // Note: JS Math.round rounds 0.5 to 1, so 0.25 => 0.5
    expect(snapToGrid(0.25)).toBe(0.5);
  });

  it('midpoint between grid lines rounds consistently', () => {
    // 0.75 / 0.5 = 1.5 => Math.round(1.5) = 2 => 2 * 0.5 = 1.0
    expect(snapToGrid(0.75)).toBe(1.0);
    // 1.25 / 0.5 = 2.5 => Math.round(2.5) = 3 => 3 * 0.5 = 1.5
    expect(snapToGrid(1.25)).toBe(1.5);
  });
});

// ===========================================================================
// Additional integration: sanitizeConnections via loadFromStorage (multi-graph)
// ===========================================================================
describe('sanitizeConnections via loadFromStorage', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('sanitizes connections in loaded multi-graph data', () => {
    const nodes: Record<string, EditorNode> = {
      'node-1': makeNode('node-1', 'source'),
      'node-2': makeNode('node-2', 'math'),
    };
    const connections: Record<string, Connection> = {
      'conn-1': makeConnection('conn-1', 'node-1', 0, 'node-2', 0), // valid
      'conn-2': makeConnection('conn-2', 'node-1', 0, 'ghost', 0),  // orphaned target
      'conn-3': makeConnection('conn-3', 'node-1', 99, 'node-2', 0), // out-of-range port
    };
    const storage = {
      version: 2 as const,
      graphs: {
        default: { nodes, connections, groups: {}, customNodeDefs: {} },
      },
      graphTabs: {
        default: { id: 'default', name: 'Main', createdAt: 1000 },
      },
      activeGraphId: 'default',
      graphOrder: ['default'],
      templates: {},
    };
    saveMultiGraph(storage);
    const loaded = getState().loadFromStorage();
    expect(loaded).toBe(true);
    // Only the valid connection should survive
    expect(Object.keys(getState().connections)).toHaveLength(1);
    expect(getState().connections['conn-1']).toBeDefined();
  });
});

// ===========================================================================
// Additional integration: syncNextId via loadFromStorage
// ===========================================================================
describe('syncNextId via loadFromStorage', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('IDs generated after load are higher than loaded IDs', () => {
    const nodes: Record<string, EditorNode> = {
      'node-300': makeNode('node-300', 'source'),
    };
    const storage = {
      version: 2 as const,
      graphs: {
        default: { nodes, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs: {
        default: { id: 'default', name: 'Main', createdAt: 1000 },
      },
      activeGraphId: 'default',
      graphOrder: ['default'],
      templates: {},
    };
    saveMultiGraph(storage);
    getState().loadFromStorage();
    const newId = getState().addNode('math');
    const num = parseInt(newId.replace(/\D+/g, ''), 10);
    expect(num).toBeGreaterThan(300);
  });

  it('accounts for template IDs in syncNextId during load', () => {
    const storage = {
      version: 2 as const,
      graphs: {
        default: { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs: {
        default: { id: 'default', name: 'Main', createdAt: 1000 },
      },
      activeGraphId: 'default',
      graphOrder: ['default'],
      templates: {
        'template-999': {
          id: 'template-999',
          name: 'T',
          category: 'General',
          nodes: [],
          connections: [],
          createdAt: 1000,
        },
      },
    };
    saveMultiGraph(storage);
    getState().loadFromStorage();
    const newId = getState().addNode('source');
    const num = parseInt(newId.replace(/\D+/g, ''), 10);
    expect(num).toBeGreaterThan(999);
  });

  it('accounts for graphTab IDs in syncNextId during load', () => {
    const storage = {
      version: 2 as const,
      graphs: {
        'graph-777': { nodes: {}, connections: {}, groups: {}, customNodeDefs: {} },
      },
      graphTabs: {
        'graph-777': { id: 'graph-777', name: 'High ID', createdAt: 1000 },
      },
      activeGraphId: 'graph-777',
      graphOrder: ['graph-777'],
      templates: {},
    };
    saveMultiGraph(storage);
    getState().loadFromStorage();
    const newId = getState().addNode('source');
    const num = parseInt(newId.replace(/\D+/g, ''), 10);
    expect(num).toBeGreaterThan(777);
  });
});
