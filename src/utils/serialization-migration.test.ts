import { describe, it, expect, beforeEach } from 'vitest';
import { saveMultiGraph, loadMultiGraph, saveGraph, loadGraph, clearGraph, importFromJSON } from './serialization';
import type { MultiGraphStorage } from './serialization';
import type { EditorNode, Connection, NodeGroup, CustomNodeDef, NodeTemplate, SubgraphNodeDef } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'node-editor-3d-graph';

function makeNode(id: string, type: EditorNode['type'] = 'source'): EditorNode {
  return {
    id,
    type,
    position: [0, 0, 0],
    title: `Node ${id}`,
    data: {},
    inputs: [],
    outputs: [{ id: `${id}-out-0`, label: 'value', portType: 'number' }],
  };
}

function makeConnection(id: string, src = 'n1', tgt = 'n2'): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: 0,
    targetNodeId: tgt,
    targetPortIndex: 0,
  };
}

function makeGroup(id: string): NodeGroup {
  return { id, label: `Group ${id}`, collapsed: false };
}

function makeCustomNodeDef(id: string): CustomNodeDef {
  return {
    id,
    name: `Custom ${id}`,
    color: '#ff0000',
    category: 'Test',
    inputs: [{ label: 'in', portType: 'number' }],
    outputs: [{ label: 'out', portType: 'number' }],
    expression: 'return inputs[0] * 2',
  };
}

function makeTemplate(id: string): NodeTemplate {
  return {
    id,
    name: `Template ${id}`,
    category: 'Test',
    nodes: [makeNode('t1')],
    connections: [],
    createdAt: Date.now(),
  };
}

function makeSubgraphDef(id: string): SubgraphNodeDef {
  return {
    id,
    name: `Subgraph ${id}`,
    innerGraphId: `inner-${id}`,
    exposedInputs: [{ portIndex: 0, innerNodeId: 'si1' }],
    exposedOutputs: [{ portIndex: 0, innerNodeId: 'so1' }],
  };
}

/** Store a raw legacy (v1) object directly into localStorage. */
function storeLegacy(data: Record<string, unknown>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Build a minimal valid v2 MultiGraphStorage. */
function makeV2Storage(overrides: Partial<MultiGraphStorage> = {}): MultiGraphStorage {
  return {
    version: 2,
    graphs: {
      default: {
        nodes: { n1: makeNode('n1') },
        connections: { c1: makeConnection('c1') },
        groups: {},
        customNodeDefs: {},
      },
    },
    graphTabs: {
      default: { id: 'default', name: 'Main', createdAt: 1000 },
    },
    activeGraphId: 'default',
    graphOrder: ['default'],
    templates: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

describe('serialization — v1 to v2 migration', () => {
  // 1
  it('loading v1 (legacy single-graph) data migrates to v2 format', () => {
    storeLegacy({
      nodes: { n1: makeNode('n1') },
      connections: { c1: makeConnection('c1') },
    });

    const result = loadMultiGraph();

    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
    expect(result!.graphs).toBeDefined();
    expect(result!.graphTabs).toBeDefined();
    expect(result!.graphOrder).toBeDefined();
  });

  // 2
  it('migration preserves all nodes and connections', () => {
    const nodes = { n1: makeNode('n1'), n2: makeNode('n2', 'transform') };
    const connections = { c1: makeConnection('c1') };
    storeLegacy({ nodes, connections });

    const result = loadMultiGraph()!;

    expect(result.graphs['default'].nodes).toEqual(nodes);
    expect(result.graphs['default'].connections).toEqual(connections);
  });

  // 3
  it('migration preserves groups and customNodeDefs when present', () => {
    const groups = { g1: makeGroup('g1') };
    const customNodeDefs = { cd1: makeCustomNodeDef('cd1') };
    storeLegacy({
      nodes: { n1: makeNode('n1') },
      connections: {},
      groups,
      customNodeDefs,
    });

    const result = loadMultiGraph()!;

    expect(result.graphs['default'].groups).toEqual(groups);
    expect(result.graphs['default'].customNodeDefs).toEqual(customNodeDefs);
  });

  // 4
  it('migration handles missing optional fields (groups, customNodeDefs)', () => {
    storeLegacy({
      nodes: { n1: makeNode('n1') },
      connections: {},
      // deliberately omitting groups and customNodeDefs
    });

    const result = loadMultiGraph()!;

    expect(result.graphs['default'].groups).toEqual({});
    expect(result.graphs['default'].customNodeDefs).toEqual({});
  });

  // 5
  it('migration creates proper graphTabs with default ID', () => {
    storeLegacy({
      nodes: { n1: makeNode('n1') },
      connections: {},
    });

    const result = loadMultiGraph()!;

    expect(result.graphTabs).toHaveProperty('default');
    expect(result.graphTabs['default'].id).toBe('default');
    expect(result.graphTabs['default'].name).toBe('Main');
    expect(typeof result.graphTabs['default'].createdAt).toBe('number');
  });

  // 6
  it('migration sets activeGraphId to default', () => {
    storeLegacy({
      nodes: { n1: makeNode('n1') },
      connections: {},
    });

    const result = loadMultiGraph()!;
    expect(result.activeGraphId).toBe('default');
  });

  // 7
  it('migration creates proper graphOrder', () => {
    storeLegacy({
      nodes: { n1: makeNode('n1') },
      connections: {},
    });

    const result = loadMultiGraph()!;
    expect(result.graphOrder).toEqual(['default']);
  });
});

describe('serialization — v2 format', () => {
  // 8
  it('loading v2 data returns it directly', () => {
    const v2 = makeV2Storage();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v2));

    const result = loadMultiGraph();

    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
    expect(result!.activeGraphId).toBe('default');
    expect(result!.graphs['default'].nodes).toEqual(v2.graphs['default'].nodes);
  });

  // 9
  it('round-trip: save v2, load v2, data matches', () => {
    const v2 = makeV2Storage();
    saveMultiGraph(v2);

    const loaded = loadMultiGraph();
    // loadMultiGraph normalizes per-graph records (adds missing subgraphDefs, etc.)
    // so compare with normalization applied to the original
    const expected = JSON.parse(JSON.stringify(v2));
    for (const gId of Object.keys(expected.graphs)) {
      if (!expected.graphs[gId].subgraphDefs) expected.graphs[gId].subgraphDefs = {};
    }
    expect(loaded).toEqual(expected);
  });

  // 10
  it('v2 with templates preserved', () => {
    const v2 = makeV2Storage({
      templates: { t1: makeTemplate('t1'), t2: makeTemplate('t2') },
    });
    saveMultiGraph(v2);

    const loaded = loadMultiGraph()!;
    expect(Object.keys(loaded.templates)).toHaveLength(2);
    expect(loaded.templates['t1'].name).toBe('Template t1');
    expect(loaded.templates['t2'].name).toBe('Template t2');
  });

  // 11
  it('v2 with subgraphDefs preserved', () => {
    const v2 = makeV2Storage({
      subgraphDefs: { sg1: makeSubgraphDef('sg1') },
    });
    saveMultiGraph(v2);

    const loaded = loadMultiGraph()!;
    expect(loaded.subgraphDefs).toBeDefined();
    expect(loaded.subgraphDefs!['sg1'].innerGraphId).toBe('inner-sg1');
    expect(loaded.subgraphDefs!['sg1'].exposedInputs).toHaveLength(1);
    expect(loaded.subgraphDefs!['sg1'].exposedOutputs).toHaveLength(1);
  });
});

describe('serialization — edge cases', () => {
  // 12
  it('loading null/empty localStorage returns null', () => {
    expect(loadMultiGraph()).toBeNull();
  });

  // 13
  it('loading invalid JSON returns null', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
    expect(loadMultiGraph()).toBeNull();
  });

  // 14
  it('loading non-object returns null', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('just a string'));
    expect(loadMultiGraph()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    expect(loadMultiGraph()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadMultiGraph()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify(null));
    expect(loadMultiGraph()).toBeNull();
  });

  // 15
  it('loading data without nodes returns null', () => {
    storeLegacy({ connections: {} });
    expect(loadMultiGraph()).toBeNull();
  });

  // 16
  it('loading data without connections returns null', () => {
    storeLegacy({ nodes: { n1: makeNode('n1') } });
    expect(loadMultiGraph()).toBeNull();
  });

  // 17
  it('clearGraph removes data', () => {
    saveMultiGraph(makeV2Storage());
    expect(loadMultiGraph()).not.toBeNull();

    clearGraph();
    expect(loadMultiGraph()).toBeNull();
  });
});

describe('serialization — legacy API compatibility', () => {
  // 18
  it('loadGraph from v2 storage returns active graph as legacy format', () => {
    const nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
    const connections = { c1: makeConnection('c1') };
    const v2 = makeV2Storage({
      graphs: {
        default: { nodes, connections, groups: {}, customNodeDefs: {} },
      },
    });
    saveMultiGraph(v2);

    const legacy = loadGraph();

    expect(legacy).not.toBeNull();
    expect(legacy!.nodes).toEqual(nodes);
    expect(legacy!.connections).toEqual(connections);
  });

  // 19
  it('saveGraph saves in legacy format, loadMultiGraph migrates it', () => {
    const nodes = { n1: makeNode('n1') };
    const connections = { c1: makeConnection('c1') };
    saveGraph(nodes, connections);

    const result = loadMultiGraph();

    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
    expect(result!.graphs['default'].nodes).toEqual(nodes);
    expect(result!.graphs['default'].connections).toEqual(connections);
    expect(result!.activeGraphId).toBe('default');
  });

  // 20
  it('importFromJSON validates structure', () => {
    const valid = JSON.stringify({
      nodes: { n1: makeNode('n1') },
      connections: { c1: makeConnection('c1') },
    });
    const result = importFromJSON(valid);

    expect(result).not.toBeNull();
    expect(result!.nodes['n1'].id).toBe('n1');
    expect(result!.connections['c1'].id).toBe('c1');
  });

  // 21
  it('importFromJSON rejects invalid JSON', () => {
    expect(importFromJSON('{bad json}')).toBeNull();
    expect(importFromJSON('')).toBeNull();
    expect(importFromJSON('undefined')).toBeNull();
  });

  // 22
  it('importFromJSON rejects non-object data', () => {
    expect(importFromJSON('"a string"')).toBeNull();
    expect(importFromJSON('42')).toBeNull();
    expect(importFromJSON('[1,2]')).toBeNull();
    expect(importFromJSON('null')).toBeNull();
    expect(importFromJSON('true')).toBeNull();
  });

  // 23
  it('importFromJSON accepts valid data with optional fields', () => {
    const withGroups = JSON.stringify({
      nodes: { n1: makeNode('n1') },
      connections: {},
      groups: { g1: makeGroup('g1') },
    });
    expect(importFromJSON(withGroups)).not.toBeNull();

    const withCustomDefs = JSON.stringify({
      nodes: { n1: makeNode('n1') },
      connections: {},
      customNodeDefs: { cd1: makeCustomNodeDef('cd1') },
    });
    expect(importFromJSON(withCustomDefs)).not.toBeNull();

    const withBoth = JSON.stringify({
      nodes: { n1: makeNode('n1') },
      connections: {},
      groups: { g1: makeGroup('g1') },
      customNodeDefs: { cd1: makeCustomNodeDef('cd1') },
    });
    const result = importFromJSON(withBoth);
    expect(result).not.toBeNull();
    expect(result!.groups).toEqual({ g1: makeGroup('g1') });
    expect(result!.customNodeDefs).toEqual({ cd1: makeCustomNodeDef('cd1') });
  });
});

describe('serialization — storage quota handling', () => {
  // 24
  it('saveMultiGraph returns true on success', () => {
    const result = saveMultiGraph(makeV2Storage());
    expect(result).toBe(true);
  });

  // 25
  it('saveMultiGraph returns false on storage error', () => {
    const original = localStorage.setItem;
    // Temporarily replace setItem to simulate QuotaExceededError
    localStorage.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };

    const result = saveMultiGraph(makeV2Storage());
    expect(result).toBe(false);

    // Restore
    localStorage.setItem = original;
  });
});
