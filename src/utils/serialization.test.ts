import { describe, it, expect, beforeEach } from 'vitest';
import { saveGraph, loadGraph, clearGraph } from './serialization';
import type { EditorNode, Connection } from '../types';

function makeNode(id: string, type: 'source' | 'transform' = 'source'): EditorNode {
  return {
    id,
    type,
    position: [0, 0, 0],
    title: 'Test',
    data: {},
    inputs: [],
    outputs: [{ id: 'out-0', label: 'out 0', portType: 'number' as const }],
  };
}

function makeConnection(id: string): Connection {
  return {
    id,
    sourceNodeId: 'n1',
    sourcePortIndex: 0,
    targetNodeId: 'n2',
    targetPortIndex: 0,
  };
}

describe('serialization', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('saveGraph / loadGraph roundtrip', () => {
    it('saves and loads nodes and connections', () => {
      const nodes = { n1: makeNode('n1'), n2: makeNode('n2') };
      const connections = { c1: makeConnection('c1') };

      saveGraph(nodes, connections);
      const loaded = loadGraph();

      expect(loaded).not.toBeNull();
      expect(loaded!.nodes).toEqual(nodes);
      expect(loaded!.connections).toEqual(connections);
    });

    it('returns null when nothing is saved', () => {
      expect(loadGraph()).toBeNull();
    });

    it('handles empty graph', () => {
      saveGraph({}, {});
      const loaded = loadGraph();
      expect(loaded).not.toBeNull();
      expect(Object.keys(loaded!.nodes)).toHaveLength(0);
      expect(Object.keys(loaded!.connections)).toHaveLength(0);
    });
  });

  describe('loadGraph error handling', () => {
    it('returns null for invalid JSON', () => {
      localStorage.setItem('node-editor-3d-graph', '{broken json');
      expect(loadGraph()).toBeNull();
    });

    it('returns null when nodes field is missing', () => {
      localStorage.setItem('node-editor-3d-graph', JSON.stringify({ connections: {} }));
      expect(loadGraph()).toBeNull();
    });

    it('returns null when connections field is missing', () => {
      localStorage.setItem('node-editor-3d-graph', JSON.stringify({ nodes: {} }));
      expect(loadGraph()).toBeNull();
    });
  });

  describe('clearGraph', () => {
    it('removes saved data', () => {
      saveGraph({ n1: makeNode('n1') }, {});
      clearGraph();
      expect(loadGraph()).toBeNull();
    });
  });
});
