import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveMultiGraph,
  loadMultiGraph,
  loadGraph,
  clearGraph,
  importFromJSON,
  type MultiGraphStorage,
} from './serialization';
import type { EditorNode, Connection } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, type: EditorNode['type'] = 'source'): EditorNode {
  return {
    id,
    type,
    position: [0, 0, 0],
    title: `Node ${id}`,
    data: {},
    inputs: type === 'source' ? [] : [{ id: `in-0`, label: 'in 0', portType: 'number' as const }],
    outputs: type === 'output' ? [] : [{ id: `out-0`, label: 'out 0', portType: 'number' as const }],
  };
}

function makeConn(id: string, srcId: string, tgtId: string): Connection {
  return {
    id,
    sourceNodeId: srcId,
    sourcePortIndex: 0,
    targetNodeId: tgtId,
    targetPortIndex: 0,
  };
}

function makeMultiGraphStorage(overrides?: Partial<MultiGraphStorage>): MultiGraphStorage {
  return {
    version: 2,
    graphs: {
      default: {
        nodes: { n1: makeNode('n1') },
        connections: {},
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

const STORAGE_KEY = 'node-editor-3d-graph';

describe('serialization - extended', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // =========================================================================
  // saveMultiGraph / loadMultiGraph
  // =========================================================================
  describe('saveMultiGraph / loadMultiGraph', () => {
    it('round-trips a multi-graph workspace', () => {
      const storage = makeMultiGraphStorage();
      const ok = saveMultiGraph(storage);
      expect(ok).toBe(true);

      const loaded = loadMultiGraph();
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(2);
      expect(loaded!.activeGraphId).toBe('default');
      expect(loaded!.graphs['default'].nodes['n1'].id).toBe('n1');
    });

    it('preserves multiple graphs', () => {
      const storage = makeMultiGraphStorage({
        graphs: {
          default: { nodes: { n1: makeNode('n1') }, connections: {}, groups: {}, customNodeDefs: {} },
          graph2: { nodes: { n2: makeNode('n2', 'transform') }, connections: {}, groups: {}, customNodeDefs: {} },
        },
        graphTabs: {
          default: { id: 'default', name: 'Main', createdAt: 1000 },
          graph2: { id: 'graph2', name: 'Second', createdAt: 2000 },
        },
        graphOrder: ['default', 'graph2'],
      });

      saveMultiGraph(storage);
      const loaded = loadMultiGraph()!;

      expect(Object.keys(loaded.graphs)).toHaveLength(2);
      expect(loaded.graphs['graph2'].nodes['n2'].type).toBe('transform');
      expect(loaded.graphTabs['graph2'].name).toBe('Second');
      expect(loaded.graphOrder).toEqual(['default', 'graph2']);
    });

    it('preserves templates', () => {
      const storage = makeMultiGraphStorage({
        templates: {
          't1': {
            id: 't1',
            name: 'Template One',
            category: 'User',
            nodes: [makeNode('tn1')],
            connections: [],
            createdAt: 5000,
          },
        },
      });

      saveMultiGraph(storage);
      const loaded = loadMultiGraph()!;

      expect(loaded.templates['t1']).toBeDefined();
      expect(loaded.templates['t1'].name).toBe('Template One');
      expect(loaded.templates['t1'].nodes).toHaveLength(1);
    });

    it('preserves subgraphDefs when present', () => {
      const storage = makeMultiGraphStorage({
        subgraphDefs: {
          'sg1': {
            id: 'sg1',
            name: 'Sub 1',
            innerGraphId: 'inner-1',
            exposedInputs: [{ portIndex: 0, innerNodeId: 'in-node' }],
            exposedOutputs: [{ portIndex: 0, innerNodeId: 'out-node' }],
          },
        },
      });

      saveMultiGraph(storage);
      const loaded = loadMultiGraph()!;

      expect(loaded.subgraphDefs).toBeDefined();
      expect(loaded.subgraphDefs!['sg1']).toBeDefined();
      expect(loaded.subgraphDefs!['sg1'].name).toBe('Sub 1');
      expect(loaded.subgraphDefs!['sg1'].exposedInputs).toHaveLength(1);
      expect(loaded.subgraphDefs!['sg1'].exposedOutputs).toHaveLength(1);
    });

    it('preserves groups and customNodeDefs per graph', () => {
      const storage = makeMultiGraphStorage({
        graphs: {
          default: {
            nodes: { n1: makeNode('n1') },
            connections: {},
            groups: {
              g1: { id: 'g1', label: 'Group 1', collapsed: false },
            },
            customNodeDefs: {
              cd1: { id: 'cd1', name: 'Custom', color: '#ff0000', category: 'User', inputs: [], outputs: [], expression: 'inputs[0]' },
            },
          },
        },
      });

      saveMultiGraph(storage);
      const loaded = loadMultiGraph()!;

      expect(loaded.graphs['default'].groups!['g1']).toBeDefined();
      expect(loaded.graphs['default'].customNodeDefs!['cd1']).toBeDefined();
    });

    it('preserves connection metadata (label, colorOverride)', () => {
      const conn: Connection = {
        ...makeConn('c1', 'n1', 'n2'),
        label: 'Data Flow',
        colorOverride: '#ff6600',
      };
      const storage = makeMultiGraphStorage({
        graphs: {
          default: {
            nodes: { n1: makeNode('n1'), n2: makeNode('n2', 'transform') },
            connections: { c1: conn },
            groups: {},
            customNodeDefs: {},
          },
        },
      });

      saveMultiGraph(storage);
      const loaded = loadMultiGraph()!;

      const loadedConn = loaded.graphs['default'].connections['c1'];
      expect(loadedConn.label).toBe('Data Flow');
      expect(loadedConn.colorOverride).toBe('#ff6600');
    });
  });

  // =========================================================================
  // Legacy format migration
  // =========================================================================
  describe('legacy format migration', () => {
    it('migrates legacy single-graph data to v2 format', () => {
      const legacy = {
        nodes: { n1: makeNode('n1') },
        connections: { c1: makeConn('c1', 'n1', 'n1') },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

      const loaded = loadMultiGraph();
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(2);
      expect(loaded!.activeGraphId).toBe('default');
      expect(loaded!.graphOrder).toEqual(['default']);
      expect(loaded!.graphs['default'].nodes['n1']).toBeDefined();
      expect(loaded!.graphs['default'].connections['c1']).toBeDefined();
    });

    it('migrates legacy data with groups', () => {
      const legacy = {
        nodes: { n1: makeNode('n1') },
        connections: {},
        groups: { g1: { id: 'g1', name: 'Group', nodeIds: ['n1'], color: '#00ff00' } },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

      const loaded = loadMultiGraph()!;
      expect(loaded.graphs['default'].groups!['g1']).toBeDefined();
    });

    it('migrates legacy data with customNodeDefs', () => {
      const legacy = {
        nodes: { n1: makeNode('n1') },
        connections: {},
        customNodeDefs: { cd1: { id: 'cd1', name: 'Custom' } },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

      const loaded = loadMultiGraph()!;
      expect(loaded.graphs['default'].customNodeDefs!['cd1']).toBeDefined();
    });

    it('creates Main tab and empty templates on migration', () => {
      const legacy = { nodes: {}, connections: {} };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

      const loaded = loadMultiGraph()!;
      expect(loaded.graphTabs['default'].name).toBe('Main');
      expect(loaded.templates).toEqual({});
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================
  describe('loadMultiGraph error handling', () => {
    it('returns null for empty localStorage', () => {
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{corrupt json!!!');
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for non-object data', () => {
      localStorage.setItem(STORAGE_KEY, '"just a string"');
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for array data', () => {
      localStorage.setItem(STORAGE_KEY, '[1, 2, 3]');
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for null value', () => {
      localStorage.setItem(STORAGE_KEY, 'null');
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for v2 with missing graphs', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        graphTabs: {},
      }));
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for v2 with missing graphTabs', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        graphs: {},
      }));
      expect(loadMultiGraph()).toBeNull();
    });

    it('returns null for data with no recognizable format', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
      expect(loadMultiGraph()).toBeNull();
    });
  });

  // =========================================================================
  // loadGraph backward compatibility
  // =========================================================================
  describe('loadGraph with v2 data', () => {
    it('extracts active graph from v2 format', () => {
      const storage = makeMultiGraphStorage();
      saveMultiGraph(storage);

      const loaded = loadGraph();
      expect(loaded).not.toBeNull();
      expect(loaded!.nodes['n1']).toBeDefined();
    });

    it('returns null for v2 with bad activeGraphId', () => {
      const storage = makeMultiGraphStorage({
        activeGraphId: 'nonexistent',
      });
      saveMultiGraph(storage);

      const loaded = loadGraph();
      expect(loaded).toBeNull();
    });
  });

  // =========================================================================
  // importFromJSON
  // =========================================================================
  describe('importFromJSON', () => {
    it('parses valid JSON with nodes and connections', () => {
      const json = JSON.stringify({
        nodes: { n1: makeNode('n1') },
        connections: { c1: makeConn('c1', 'n1', 'n1') },
      });

      const result = importFromJSON(json);
      expect(result).not.toBeNull();
      expect(result!.nodes['n1']).toBeDefined();
      expect(result!.connections['c1']).toBeDefined();
    });

    it('returns null for invalid JSON', () => {
      expect(importFromJSON('{broken')).toBeNull();
    });

    it('returns null when nodes is missing', () => {
      expect(importFromJSON(JSON.stringify({ connections: {} }))).toBeNull();
    });

    it('returns null when connections is missing', () => {
      expect(importFromJSON(JSON.stringify({ nodes: {} }))).toBeNull();
    });

    it('returns null when nodes is not an object', () => {
      expect(importFromJSON(JSON.stringify({ nodes: 'invalid', connections: {} }))).toBeNull();
    });

    it('returns null when connections is not an object', () => {
      expect(importFromJSON(JSON.stringify({ nodes: {}, connections: [1, 2] }))).toBeNull();
    });

    it('returns null when groups is not an object', () => {
      expect(importFromJSON(JSON.stringify({
        nodes: {},
        connections: {},
        groups: 'bad',
      }))).toBeNull();
    });

    it('returns null when customNodeDefs is not an object', () => {
      expect(importFromJSON(JSON.stringify({
        nodes: {},
        connections: {},
        customNodeDefs: [1, 2],
      }))).toBeNull();
    });

    it('accepts optional groups and customNodeDefs', () => {
      const json = JSON.stringify({
        nodes: { n1: makeNode('n1') },
        connections: {},
        groups: { g1: { id: 'g1' } },
        customNodeDefs: { cd1: { id: 'cd1' } },
      });

      const result = importFromJSON(json);
      expect(result).not.toBeNull();
      expect(result!.groups!['g1']).toBeDefined();
      expect(result!.customNodeDefs!['cd1']).toBeDefined();
    });

    it('returns null for empty string', () => {
      expect(importFromJSON('')).toBeNull();
    });

    it('returns null for non-object root', () => {
      expect(importFromJSON('"hello"')).toBeNull();
      expect(importFromJSON('42')).toBeNull();
      expect(importFromJSON('true')).toBeNull();
    });
  });

  // =========================================================================
  // saveMultiGraph storage failures
  // =========================================================================
  describe('saveMultiGraph failure handling', () => {
    it('returns false when localStorage throws', () => {
      // Simulate storage quota exceeded
      const origSetItem = localStorage.setItem;
      localStorage.setItem = () => { throw new Error('QuotaExceeded'); };

      const result = saveMultiGraph(makeMultiGraphStorage());
      expect(result).toBe(false);

      localStorage.setItem = origSetItem;
    });
  });

  // =========================================================================
  // clearGraph
  // =========================================================================
  describe('clearGraph', () => {
    it('removes all saved data', () => {
      saveMultiGraph(makeMultiGraphStorage());
      expect(loadMultiGraph()).not.toBeNull();

      clearGraph();
      expect(loadMultiGraph()).toBeNull();
    });

    it('is idempotent', () => {
      clearGraph();
      clearGraph();
      expect(loadMultiGraph()).toBeNull();
    });
  });
});
