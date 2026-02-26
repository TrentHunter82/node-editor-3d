/**
 * Store-level integration tests for the connection type coercion system.
 *
 * Phase 23: When completeConnection encounters incompatible port types,
 * it auto-inserts a converter node and creates two connections to bridge
 * the type gap. These tests verify the full coercion pipeline through
 * the Zustand store, including undo/redo, edge cases, and serialization.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

enableMapSet();

function getStore() { return useEditorStore.getState(); }

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.validationErrors = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.isExecuting = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count nodes in the store */
function nodeCount(): number { return Object.keys(getStore().nodes).length; }
/** Count connections in the store */
function connCount(): number { return Object.keys(getStore().connections).length; }
/** Get all connection objects */
function allConns() { return Object.values(getStore().connections); }
/** Get all node objects */
function allNodes() { return Object.values(getStore().nodes); }

/**
 * Perform a coercion connection: startConnection on sourceNode output,
 * completeConnection on targetNode input.
 */
function connectPorts(srcId: string, srcPort: number, tgtId: string, tgtPort: number) {
  getStore().startConnection(srcId, srcPort);
  getStore().completeConnection(tgtId, tgtPort);
}

/**
 * Find the auto-inserted converter node (title contains "(auto)").
 * Returns undefined if none found.
 */
function findConverterNode() {
  return allNodes().find(n => n.title.includes('(auto)'));
}

/**
 * Find the connection that has a label field set (converter→target connection).
 */
function findLabeledConnection() {
  return allConns().find(c => c.label !== undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Connection Type Coercion Integration', () => {
  beforeEach(() => {
    resetStore();
  });

  // =========================================================================
  // 1. Auto-insertion tests — one per coercion rule
  // =========================================================================
  describe('auto-insertion of converter nodes', () => {
    it('number->string: inserts template node between source and concat', () => {
      // source output 0 = number, concat input 0 = string
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);
      expect(nodeCount()).toBe(2);

      connectPorts(srcId, 0, tgtId, 0);

      // Should have 3 nodes (src + converter + tgt) and 2 connections
      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      const converter = findConverterNode();
      expect(converter).toBeDefined();
      expect(converter!.type).toBe('template');
    });

    it('string->number: inserts parse-number node between source(string) and transform', () => {
      // source output 1 = string, transform input 0 = number
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('transform', [10, 0, 0]);
      expect(nodeCount()).toBe(2);

      connectPorts(srcId, 1, tgtId, 0);

      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      const converter = findConverterNode();
      expect(converter).toBeDefined();
      expect(converter!.type).toBe('parse-number');
    });

    it('vector3->number: inserts decompose-vec3 node', () => {
      // compose-vec3 output 0 = vector3, transform input 0 = number
      const srcId = getStore().addNode('compose-vec3', [0, 0, 0]);
      const tgtId = getStore().addNode('transform', [10, 0, 0]);
      expect(nodeCount()).toBe(2);

      connectPorts(srcId, 0, tgtId, 0);

      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      const converter = findConverterNode();
      expect(converter).toBeDefined();
      expect(converter!.type).toBe('decompose-vec3');
    });

    it('number->vector3: inserts compose-vec3 node', () => {
      // source output 0 = number, decompose-vec3 input 0 = vector3
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('decompose-vec3', [10, 0, 0]);
      expect(nodeCount()).toBe(2);

      connectPorts(srcId, 0, tgtId, 0);

      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      const converter = findConverterNode();
      expect(converter).toBeDefined();
      expect(converter!.type).toBe('compose-vec3');
    });

    it('number->boolean: inserts compare node', () => {
      // source output 0 = number, not input 0 = boolean
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('not', [10, 0, 0]);
      expect(nodeCount()).toBe(2);

      connectPorts(srcId, 0, tgtId, 0);

      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      const converter = findConverterNode();
      expect(converter).toBeDefined();
      expect(converter!.type).toBe('compare');
    });

    it('boolean->string: inserts template node', () => {
      // compare output 0 = boolean, concat input 0 = string
      const srcId = getStore().addNode('compare', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);
      expect(nodeCount()).toBe(2);

      connectPorts(srcId, 0, tgtId, 0);

      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      const converter = findConverterNode();
      expect(converter).toBeDefined();
      expect(converter!.type).toBe('template');
    });
  });

  // =========================================================================
  // 2. Converter node properties
  // =========================================================================
  describe('converter node properties', () => {
    it('converter is positioned at midpoint between source and target', () => {
      const srcId = getStore().addNode('source', [0, 4, 6]);
      const tgtId = getStore().addNode('concat', [10, 8, 2]);

      connectPorts(srcId, 0, tgtId, 0);

      const converter = findConverterNode();
      expect(converter).toBeDefined();
      // Midpoint: [(0+10)/2, (4+8)/2, (6+2)/2] = [5, 6, 4]
      expect(converter!.position[0]).toBeCloseTo(5);
      expect(converter!.position[1]).toBeCloseTo(6);
      expect(converter!.position[2]).toBeCloseTo(4);
    });

    it('converter title contains "(auto)" suffix', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);

      connectPorts(srcId, 0, tgtId, 0);

      const converter = findConverterNode();
      expect(converter).toBeDefined();
      expect(converter!.title).toContain('(auto)');
      // For number->string, the converter is 'template', title should be 'Template (auto)'
      expect(converter!.title).toBe('Template (auto)');
    });

    it('auto-label on converter->target connection matches rule description', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);

      connectPorts(srcId, 0, tgtId, 0);

      const labeled = findLabeledConnection();
      expect(labeled).toBeDefined();
      // number->string description is 'Number to string'
      expect(labeled!.label).toBe('Number to string');
      // The labeled connection should go to the target node
      expect(labeled!.targetNodeId).toBe(tgtId);
    });
  });

  // =========================================================================
  // 3. Undo/Redo
  // =========================================================================
  describe('undo/redo of coerced connections', () => {
    it('single undo removes converter node and both connections', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);

      connectPorts(srcId, 0, tgtId, 0);
      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);

      getStore().undo();

      // Back to original: 2 nodes, 0 connections
      expect(nodeCount()).toBe(2);
      expect(connCount()).toBe(0);
      expect(findConverterNode()).toBeUndefined();
    });

    it('redo restores converter node and both connections', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);

      connectPorts(srcId, 0, tgtId, 0);
      expect(nodeCount()).toBe(3);

      getStore().undo();
      expect(nodeCount()).toBe(2);
      expect(connCount()).toBe(0);

      getStore().redo();
      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      expect(findConverterNode()).toBeDefined();
    });

    it('undo after coercion restores original node count', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().addNode('transform', [5, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);
      const originalCount = nodeCount(); // 3

      connectPorts(srcId, 0, tgtId, 0);
      expect(nodeCount()).toBe(originalCount + 1); // converter added

      getStore().undo();
      expect(nodeCount()).toBe(originalCount);
    });

    it('undo label is "Auto-coerce connection"', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);

      connectPorts(srcId, 0, tgtId, 0);

      const history = getStore().getUndoHistory();
      // The last undo entry (top of stack) should be the coercion
      expect(history.undo.length).toBeGreaterThan(0);
      const lastUndo = history.undo[history.undo.length - 1];
      expect(lastUndo.label).toBe('Auto-coerce connection');
    });
  });

  // =========================================================================
  // 4. No coercion available
  // =========================================================================
  describe('no coercion available', () => {
    it('color->number: connection fails silently when no rule exists', () => {
      // color-picker output 0 = color, transform input 0 = number
      const srcId = getStore().addNode('color-picker', [0, 0, 0]);
      const tgtId = getStore().addNode('transform', [10, 0, 0]);
      const beforeNodes = nodeCount();
      const beforeConns = connCount();

      connectPorts(srcId, 0, tgtId, 0);

      // No coercion rule for color->number: nothing should change
      expect(nodeCount()).toBe(beforeNodes);
      expect(connCount()).toBe(beforeConns);
    });

    it('string->vector3: connection fails silently when no rule exists', () => {
      // source output 1 = string, decompose-vec3 input 0 = vector3
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('decompose-vec3', [10, 0, 0]);

      connectPorts(srcId, 1, tgtId, 0);

      // No coercion rule for string->vector3
      expect(nodeCount()).toBe(2);
      expect(connCount()).toBe(0);
    });

    it('returns to idle state after failed coercion attempt', () => {
      const srcId = getStore().addNode('color-picker', [0, 0, 0]);
      const tgtId = getStore().addNode('transform', [10, 0, 0]);

      getStore().startConnection(srcId, 0);
      expect(getStore().interaction).toBe('drawing-connection');

      getStore().completeConnection(tgtId, 0);

      expect(getStore().interaction).toBe('idle');
      expect(getStore().pendingConnection).toBeNull();
    });
  });

  // =========================================================================
  // 5. Normal connections (no coercion needed)
  // =========================================================================
  describe('normal connections without coercion', () => {
    it('same-type connection works without inserting converter', () => {
      // source output 0 = number, transform input 0 = number
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('transform', [10, 0, 0]);

      connectPorts(srcId, 0, tgtId, 0);

      // Direct connection: 2 nodes, 1 connection, no converter
      expect(nodeCount()).toBe(2);
      expect(connCount()).toBe(1);
      expect(findConverterNode()).toBeUndefined();
    });

    it('any-type target accepts any source without coercion', () => {
      // source output 0 = number, display input 0 = any
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('display', [10, 0, 0]);

      connectPorts(srcId, 0, tgtId, 0);

      // Direct connection to 'any' port: no coercion
      expect(nodeCount()).toBe(2);
      expect(connCount()).toBe(1);
      expect(findConverterNode()).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('coercion replaces existing connection on target input', () => {
      // First: normal connection number->number on transform input 0
      const src1Id = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('transform', [10, 0, 0]);
      connectPorts(src1Id, 0, tgtId, 0); // number->number, direct
      expect(connCount()).toBe(1);

      // Second: coercion string->number on same target input 0
      const src2Id = getStore().addNode('source', [0, 0, 5]);
      connectPorts(src2Id, 1, tgtId, 0); // string->number, coerced

      // The old direct connection should be replaced, now we have 2 conns (src2->converter, converter->tgt)
      expect(connCount()).toBe(2);
      const converter = findConverterNode();
      expect(converter).toBeDefined();
      expect(converter!.type).toBe('parse-number');

      // Verify the old source is no longer connected
      const connToTarget = allConns().filter(c => c.targetNodeId === tgtId);
      expect(connToTarget).toHaveLength(1);
      expect(connToTarget[0].sourceNodeId).toBe(converter!.id);
    });

    it('coercion from same source to different targets creates independent converters', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgt1Id = getStore().addNode('concat', [10, 0, 0]);  // input 0 = string
      const tgt2Id = getStore().addNode('concat', [10, 0, 5]);  // input 0 = string

      // Connect source(number) -> concat1(string)
      connectPorts(srcId, 0, tgt1Id, 0);
      expect(nodeCount()).toBe(4); // src + converter1 + tgt1 + tgt2
      expect(connCount()).toBe(2);

      // Connect source(number) -> concat2(string)
      connectPorts(srcId, 0, tgt2Id, 0);
      expect(nodeCount()).toBe(5); // src + converter1 + converter2 + tgt1 + tgt2
      expect(connCount()).toBe(4); // 2 per coercion

      // Both converters should be template nodes with (auto)
      const converters = allNodes().filter(n => n.title.includes('(auto)'));
      expect(converters).toHaveLength(2);
      expect(converters[0].type).toBe('template');
      expect(converters[1].type).toBe('template');
      // They should be distinct nodes
      expect(converters[0].id).not.toBe(converters[1].id);
    });

    it('connection to same node (self-connection) fails even with coercion-compatible types', () => {
      // template: input 1 = any, output 0 = string. If we try connecting output 0 to input 0 (string->string),
      // it's same type but self-connection. For coercion case, use a node with mixed types.
      // Actually, self-connection is blocked before coercion check. Let's verify with a compose-vec3:
      // compose-vec3: inputs=[number, number, number], output 0 = vector3
      // Trying output 0 (vector3) -> input 0 (number) on the SAME node
      const nodeId = getStore().addNode('compose-vec3', [0, 0, 0]);

      connectPorts(nodeId, 0, nodeId, 0);

      // Self-connection should be blocked
      expect(connCount()).toBe(0);
      // No converter node should be created
      expect(nodeCount()).toBe(1);
    });

    it('pendingConnection is null after coercion completes', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);

      getStore().startConnection(srcId, 0);
      expect(getStore().pendingConnection).not.toBeNull();

      getStore().completeConnection(tgtId, 0);

      expect(getStore().pendingConnection).toBeNull();
      expect(getStore().interaction).toBe('idle');
    });
  });

  // =========================================================================
  // 7. Serialization roundtrip
  // =========================================================================
  describe('serialization roundtrip', () => {
    it('coerced connections survive export/import', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, tgtId, 0);

      const nodesBeforeExport = { ...getStore().nodes };
      const connsBeforeExport = { ...getStore().connections };
      const connCountBefore = connCount();
      const nodeCountBefore = nodeCount();

      // Export state
      const exported = {
        nodes: JSON.parse(JSON.stringify(nodesBeforeExport)),
        connections: JSON.parse(JSON.stringify(connsBeforeExport)),
      };

      // Reset and import
      resetStore();
      expect(nodeCount()).toBe(0);

      getStore().importWorkflow(exported);

      expect(nodeCount()).toBe(nodeCountBefore);
      expect(connCount()).toBe(connCountBefore);
    });

    it('converter nodes survive export/import with correct type and title', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, tgtId, 0);

      const converter = findConverterNode();
      expect(converter).toBeDefined();
      const converterId = converter!.id;
      const converterTitle = converter!.title;
      const converterType = converter!.type;

      // Export
      const exported = {
        nodes: JSON.parse(JSON.stringify(getStore().nodes)),
        connections: JSON.parse(JSON.stringify(getStore().connections)),
      };

      // Reset and import
      resetStore();
      getStore().importWorkflow(exported);

      // Converter should still exist with same properties
      const importedConverter = getStore().nodes[converterId];
      expect(importedConverter).toBeDefined();
      expect(importedConverter.title).toBe(converterTitle);
      expect(importedConverter.type).toBe(converterType);
      expect(importedConverter.title).toContain('(auto)');
    });

    it('auto-label preserved through serialization roundtrip', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const tgtId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, tgtId, 0);

      const labeled = findLabeledConnection();
      expect(labeled).toBeDefined();
      const labeledId = labeled!.id;
      const labelValue = labeled!.label;

      // Export
      const exported = {
        nodes: JSON.parse(JSON.stringify(getStore().nodes)),
        connections: JSON.parse(JSON.stringify(getStore().connections)),
      };

      // Reset and import
      resetStore();
      getStore().importWorkflow(exported);

      // The labeled connection should retain its label
      const importedConn = getStore().connections[labeledId];
      expect(importedConn).toBeDefined();
      expect(importedConn.label).toBe(labelValue);
      expect(importedConn.label).toBe('Number to string');
    });
  });
});
