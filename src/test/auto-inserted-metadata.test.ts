/**
 * Comprehensive tests for the `autoInserted` boolean field on EditorNode.
 *
 * The `autoInserted` flag is set to `true` when a node is auto-inserted by
 * the type coercion system. When connecting ports with incompatible types,
 * completeConnection() auto-inserts a converter node bridging the type gap
 * and marks it with autoInserted=true.
 *
 * Covers:
 *  - Basic flag semantics (manual nodes, coerced nodes)
 *  - All 6 coercion rules (number→string, string→number, vector3→number,
 *    number→vector3, number→boolean, boolean→string)
 *  - Converter node properties (title suffix, midpoint positioning)
 *  - Connection structure (src→converter, converter→tgt, label)
 *  - Compatible connections (no converter)
 *  - Multiple independent converters
 *  - Undo/redo semantics (single undo entry, flag preserved on redo)
 *  - Duplicate preserves autoInserted flag
 *  - Paste preserves autoInserted flag
 *  - Template instantiation preserves autoInserted flag
 *  - Execution through coerced connections
 *  - Cascade deletion of converter removes both connections
 *  - Serialization roundtrip via exportAllGraphs / importAllGraphs
 *  - Connection labels carry the rule description
 *  - updateNodeData does not affect autoInserted flag
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph } from '../utils/execution';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() { return useEditorStore.getState(); }
function nodeCount(): number { return Object.keys(getStore().nodes).length; }
function connCount(): number { return Object.keys(getStore().connections).length; }
function allNodes() { return Object.values(getStore().nodes); }
function allConns() { return Object.values(getStore().connections); }

function findAutoInsertedNodes() {
  return allNodes().filter(n => n.autoInserted === true);
}

function findConverterNode() {
  return allNodes().find(n => n.title.includes('(auto)'));
}

function connectPorts(srcId: string, srcPort: number, tgtId: string, tgtPort: number) {
  getStore().startConnection(srcId, srcPort);
  getStore().completeConnection(tgtId, tgtPort);
}

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
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.showValuePreviews = true;
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.errorStrategy = 'fail-fast';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.executionStats = { executionCount: 0, totalDuration: 0, errorCount: 0, totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null, timeoutCount: 0 };
  });
}

// ---------------------------------------------------------------------------
// 1. Manual node creation: autoInserted is undefined
// ---------------------------------------------------------------------------

describe('autoInserted field - manual node creation', () => {
  beforeEach(() => { resetStore(); });

  it('manually added source node does NOT have autoInserted set', () => {
    const id = getStore().addNode('source', [0, 0, 0]);
    expect(getStore().nodes[id].autoInserted).toBeUndefined();
  });

  it('manually added template node does NOT have autoInserted set', () => {
    const id = getStore().addNode('template', [0, 0, 0]);
    expect(getStore().nodes[id].autoInserted).toBeUndefined();
  });

  it('manually added compare node does NOT have autoInserted set', () => {
    const id = getStore().addNode('compare', [0, 0, 0]);
    expect(getStore().nodes[id].autoInserted).toBeUndefined();
  });

  it('manually added parse-number node does NOT have autoInserted set', () => {
    const id = getStore().addNode('parse-number', [0, 0, 0]);
    expect(getStore().nodes[id].autoInserted).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Coercion creates converter with autoInserted=true
// ---------------------------------------------------------------------------

describe('autoInserted field - coercion sets flag on converter', () => {
  beforeEach(() => { resetStore(); });

  it('coercion connection creates converter node with autoInserted=true', () => {
    // source output 0 (number) → concat input 0 (string) triggers coercion
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('autoInserted is strictly true (not truthy) on converter node', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const converter = findConverterNode();
    expect(converter).toBeDefined();
    // Must be boolean true, not just truthy
    expect(converter!.autoInserted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Converter node title contains "(auto)" suffix
// ---------------------------------------------------------------------------

describe('autoInserted field - converter title suffix', () => {
  beforeEach(() => { resetStore(); });

  it('number→string converter title is "Template (auto)"', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const converter = findConverterNode();
    expect(converter).toBeDefined();
    expect(converter!.title).toContain('(auto)');
    expect(converter!.title).toBe('Template (auto)');
  });

  it('string→number converter title contains "(auto)"', () => {
    // source output 1 is string, transform input 0 is number
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    connectPorts(srcId, 1, tfId, 0);

    const converter = findConverterNode();
    expect(converter).toBeDefined();
    expect(converter!.title).toContain('(auto)');
  });

  it('number→boolean converter title contains "(auto)"', () => {
    // source output 0 is number, not input 0 is boolean
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const notId = getStore().addNode('not', [5, 0, 0]);
    connectPorts(srcId, 0, notId, 0);

    const converter = findConverterNode();
    expect(converter).toBeDefined();
    expect(converter!.title).toContain('(auto)');
  });
});

// ---------------------------------------------------------------------------
// 4. Converter positioned at midpoint between source and target
// ---------------------------------------------------------------------------

describe('autoInserted field - converter midpoint positioning', () => {
  beforeEach(() => { resetStore(); });

  it('converter positioned at midpoint between source and target (all axes)', () => {
    const srcId = getStore().addNode('source', [0, 4, 6]);
    const concatId = getStore().addNode('concat', [10, 8, 2]);
    connectPorts(srcId, 0, concatId, 0);

    const converter = findConverterNode();
    expect(converter).toBeDefined();
    // Midpoint: [(0+10)/2, (4+8)/2, (6+2)/2] = [5, 6, 4]
    expect(converter!.position[0]).toBeCloseTo(5);
    expect(converter!.position[1]).toBeCloseTo(6);
    expect(converter!.position[2]).toBeCloseTo(4);
  });

  it('converter positioned at midpoint with asymmetric coordinates', () => {
    const srcId = getStore().addNode('source', [2, 0, 8]);
    const concatId = getStore().addNode('concat', [12, 0, 4]);
    connectPorts(srcId, 0, concatId, 0);

    const converter = findConverterNode();
    expect(converter).toBeDefined();
    // Midpoint: [(2+12)/2, 0, (8+4)/2] = [7, 0, 6]
    expect(converter!.position[0]).toBeCloseTo(7);
    expect(converter!.position[1]).toBeCloseTo(0);
    expect(converter!.position[2]).toBeCloseTo(6);
  });
});

// ---------------------------------------------------------------------------
// 5. Compatible connection does NOT create converter
// ---------------------------------------------------------------------------

describe('autoInserted field - no converter for compatible types', () => {
  beforeEach(() => { resetStore(); });

  it('number→number connection does not create any converter node', () => {
    // source output 0 (number) → transform input 0 (number): compatible
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    connectPorts(srcId, 0, tfId, 0);

    expect(findAutoInsertedNodes().length).toBe(0);
    expect(nodeCount()).toBe(2);
    expect(connCount()).toBe(1);
  });

  it('number→any connection does not create any converter node', () => {
    // source output 0 (number) → display input 0 (any): no coercion needed
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const displayId = getStore().addNode('display', [5, 0, 0]);
    connectPorts(srcId, 0, displayId, 0);

    expect(findAutoInsertedNodes().length).toBe(0);
    expect(nodeCount()).toBe(2);
    expect(connCount()).toBe(1);
  });

  it('boolean→boolean connection does not create any converter node', () => {
    // compare output 0 (boolean) → not input 0 (boolean): compatible
    const srcId = getStore().addNode('compare', [0, 0, 0]);
    const notId = getStore().addNode('not', [5, 0, 0]);
    connectPorts(srcId, 0, notId, 0);

    expect(findAutoInsertedNodes().length).toBe(0);
    expect(nodeCount()).toBe(2);
    expect(connCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Multiple coercion paths create independent converters
// ---------------------------------------------------------------------------

describe('autoInserted field - multiple independent converters', () => {
  beforeEach(() => { resetStore(); });

  it('two coercion connections create two independent autoInserted nodes', () => {
    const src1 = getStore().addNode('source', [0, 0, 0]);
    const src2 = getStore().addNode('source', [0, 0, 4]);
    const concat1 = getStore().addNode('concat', [6, 0, 0]);
    const concat2 = getStore().addNode('concat', [6, 0, 4]);

    // Both: number → string coercion
    connectPorts(src1, 0, concat1, 0);
    connectPorts(src2, 0, concat2, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(2);
    expect(autoNodes[0].id).not.toBe(autoNodes[1].id);
    expect(autoNodes[0].autoInserted).toBe(true);
    expect(autoNodes[1].autoInserted).toBe(true);
  });

  it('two converters from same source to different targets are distinct', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concat1 = getStore().addNode('concat', [6, 0, 0]);
    const concat2 = getStore().addNode('concat', [6, 0, 5]);

    // number → string coercion to two different targets
    connectPorts(srcId, 0, concat1, 0);
    connectPorts(srcId, 0, concat2, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(2);
    // Both should be template nodes
    expect(autoNodes[0].type).toBe('template');
    expect(autoNodes[1].type).toBe('template');
  });
});

// ---------------------------------------------------------------------------
// 7. Undo removes converter + both connections (single undo entry)
// ---------------------------------------------------------------------------

describe('autoInserted field - undo behavior', () => {
  beforeEach(() => { resetStore(); });

  it('single undo removes converter node and both connections', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    expect(nodeCount()).toBe(3);
    expect(connCount()).toBe(2);
    expect(findAutoInsertedNodes().length).toBe(1);

    getStore().undo();

    // Back to 2 nodes, 0 connections, no converter
    expect(nodeCount()).toBe(2);
    expect(connCount()).toBe(0);
    expect(findAutoInsertedNodes().length).toBe(0);
    expect(findConverterNode()).toBeUndefined();
  });

  it('undo coercion does not affect unrelated nodes', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const mathId = getStore().addNode('math', [3, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    // Normal connection first
    getStore().addConnection(srcId, 0, mathId, 0);

    // Coercion connection
    connectPorts(srcId, 0, concatId, 0);
    expect(nodeCount()).toBe(4); // src + math + concat + converter

    getStore().undo();

    // Should restore to 3 nodes + 1 connection (the normal one)
    expect(nodeCount()).toBe(3);
    expect(connCount()).toBe(1);
    const conns = Object.values(getStore().connections);
    expect(conns[0].targetNodeId).toBe(mathId);
  });

  it('coercion wraps entire operation in a single undo entry', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    // 3 nodes + 2 connections after coercion
    expect(nodeCount()).toBe(3);
    expect(connCount()).toBe(2);

    // Single undo should revert all coercion changes atomically
    getStore().undo();
    expect(nodeCount()).toBe(2);
    expect(connCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Redo restores converter with autoInserted flag
// ---------------------------------------------------------------------------

describe('autoInserted field - redo behavior', () => {
  beforeEach(() => { resetStore(); });

  it('redo restores converter node with autoInserted=true', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNodeId = findAutoInsertedNodes()[0].id;

    getStore().undo();
    expect(findAutoInsertedNodes().length).toBe(0);

    getStore().redo();
    expect(findAutoInsertedNodes().length).toBe(1);
    expect(getStore().nodes[autoNodeId]?.autoInserted).toBe(true);
  });

  it('redo restores both connections after coercion undo', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    getStore().undo();
    expect(connCount()).toBe(0);

    getStore().redo();
    expect(connCount()).toBe(2);
    expect(nodeCount()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 9. Duplicate preserves autoInserted flag
// ---------------------------------------------------------------------------

describe('autoInserted field - duplicate preserves flag', () => {
  beforeEach(() => { resetStore(); });

  it('duplicating a converter node preserves autoInserted=true', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    expect(autoNode).toBeDefined();

    // Select only the converter node and duplicate
    useEditorStore.setState(s => { s.selectedIds = new Set([autoNode.id]); });
    getStore().duplicateSelected();

    // Should now have 2 auto-inserted nodes (original + duplicate)
    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(2);
    const duped = autoNodes.find(n => n.id !== autoNode.id);
    expect(duped?.autoInserted).toBe(true);
  });

  it('duplicating all nodes preserves autoInserted on converter copy', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    findAutoInsertedNodes()[0]; // verify auto-inserted node exists

    // Select all and duplicate
    const allIds = Object.keys(getStore().nodes);
    useEditorStore.setState(s => { for (const id of allIds) s.selectedIds.add(id); });
    getStore().duplicateSelected();

    // Both original + duplicated converter should have autoInserted=true
    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(2);
    for (const n of autoNodes) {
      expect(n.autoInserted).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Paste preserves autoInserted flag
// ---------------------------------------------------------------------------

describe('autoInserted field - paste preserves flag', () => {
  beforeEach(() => { resetStore(); });

  it('pasting a copied converter node preserves autoInserted=true', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    expect(autoNode).toBeDefined();

    // Copy the converter and paste it
    useEditorStore.setState(s => { s.selectedIds = new Set([autoNode.id]); });
    getStore().copySelected();
    getStore().paste();

    // Should have 2 auto-inserted nodes
    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(2);
    const pasted = autoNodes.find(n => n.id !== autoNode.id);
    expect(pasted?.autoInserted).toBe(true);
  });

  it('pasting all nodes preserves autoInserted on converter', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    // Copy all nodes and paste
    const allIds = Object.keys(getStore().nodes);
    useEditorStore.setState(s => { for (const id of allIds) s.selectedIds.add(id); });
    getStore().copySelected();
    getStore().paste();

    // Now we have 6 nodes (3 original + 3 pasted), 2 of which should be autoInserted
    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(2);
    for (const n of autoNodes) {
      expect(n.autoInserted).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Template instantiation preserves autoInserted flag
// ---------------------------------------------------------------------------

describe('autoInserted field - template instantiation preserves flag', () => {
  beforeEach(() => { resetStore(); });

  it('template containing converter node instantiates with autoInserted=true', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    // Save all nodes as a template
    const allIds = Object.keys(getStore().nodes);
    useEditorStore.setState(s => { for (const id of allIds) s.selectedIds.add(id); });
    const templateId = getStore().saveSelectionAsTemplate('TestTemplate');
    expect(templateId).not.toBeNull();

    // Capture the template before clearing the graph
    const savedTemplate = structuredClone(getStore().templates[templateId!]);

    // Clear graph content but keep the template in a variable
    useEditorStore.setState(s => {
      s.nodes = {};
      s.connections = {};
      s.selectedIds = new Set();
    });
    expect(nodeCount()).toBe(0);

    // Restore template into store and instantiate
    useEditorStore.setState(s => { s.templates[templateId!] = savedTemplate; });
    getStore().instantiateTemplate(templateId!, [0, 0, 0]);

    // Should have 3 nodes, one of which is autoInserted
    expect(nodeCount()).toBe(3);
    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].autoInserted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Execution works correctly through coerced connection
// ---------------------------------------------------------------------------

describe('autoInserted field - execution through coerced connection', () => {
  beforeEach(() => { resetStore(); });

  it('number→string coercion produces correct string output at concat node', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 42);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const { results } = executeGraph(getStore().nodes, getStore().connections);
    // concat input 0 receives the string "42" (via template converter), input 1 is empty string
    expect(results.get(concatId)?.outputs[0]).toBe('42');
  });

  it('autoInserted flag is not modified by execution', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 10);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];

    // Execute graph
    executeGraph(getStore().nodes, getStore().connections);

    // Flag should be unchanged
    expect(getStore().nodes[autoNode.id].autoInserted).toBe(true);
  });

  it('execution results are produced for all nodes including converter', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 7);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const { results } = executeGraph(getStore().nodes, getStore().connections);
    expect(results.size).toBeGreaterThan(0);
    // All 3 nodes should have results
    expect(results.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 13. Deleting converter cascades to remove both connections
// ---------------------------------------------------------------------------

describe('autoInserted field - delete converter cascades connections', () => {
  beforeEach(() => { resetStore(); });

  it('removing converter node removes both its connections', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    expect(connCount()).toBe(2);

    getStore().removeNode(autoNode.id);

    // Both connections should be gone
    expect(connCount()).toBe(0);
    expect(findAutoInsertedNodes().length).toBe(0);
    const remaining = allConns().filter(
      c => c.sourceNodeId === autoNode.id || c.targetNodeId === autoNode.id
    );
    expect(remaining.length).toBe(0);
  });

  it('removing converter leaves source and target nodes intact', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    getStore().removeNode(autoNode.id);

    // Source and target should still exist
    expect(getStore().nodes[srcId]).toBeDefined();
    expect(getStore().nodes[concatId]).toBeDefined();
    expect(nodeCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 14. number→string coercion: template converter
// ---------------------------------------------------------------------------

describe('autoInserted field - number→string coercion rule', () => {
  beforeEach(() => { resetStore(); });

  it('number→string inserts template converter with autoInserted=true', () => {
    // source output 0 = number, concat input 0 = string
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].type).toBe('template');
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('number→string: source connects to converter input port 1 (any/value port)', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connToConverter = allConns().find(c => c.targetNodeId === autoNode.id);
    expect(connToConverter).toBeDefined();
    // template input port 1 is the 'value' (any) port
    expect(connToConverter!.targetPortIndex).toBe(1);
    expect(connToConverter!.sourceNodeId).toBe(srcId);
  });

  it('number→string: converter output port 0 connects to target', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connFromConverter = allConns().find(c => c.sourceNodeId === autoNode.id);
    expect(connFromConverter).toBeDefined();
    expect(connFromConverter!.sourcePortIndex).toBe(0);
    expect(connFromConverter!.targetNodeId).toBe(concatId);
  });
});

// ---------------------------------------------------------------------------
// 15. string→number coercion: parse-number converter
// ---------------------------------------------------------------------------

describe('autoInserted field - string→number coercion rule', () => {
  beforeEach(() => { resetStore(); });

  it('string→number inserts parse-number converter with autoInserted=true', () => {
    // source output 1 = string, transform input 0 = number
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    connectPorts(srcId, 1, tfId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].type).toBe('parse-number');
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('string→number: creates exactly 2 connections through parse-number', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    connectPorts(srcId, 1, tfId, 0);

    expect(connCount()).toBe(2);
    expect(nodeCount()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 16. number→boolean coercion: compare converter with initialData
// ---------------------------------------------------------------------------

describe('autoInserted field - number→boolean coercion rule', () => {
  beforeEach(() => { resetStore(); });

  it('number→boolean inserts compare converter with autoInserted=true', () => {
    // source output 0 = number, not input 0 = boolean
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const notId = getStore().addNode('not', [5, 0, 0]);
    connectPorts(srcId, 0, notId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].type).toBe('compare');
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('number→boolean compare converter has initialData mode=">"', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const notId = getStore().addNode('not', [5, 0, 0]);
    connectPorts(srcId, 0, notId, 0);

    const converter = findConverterNode();
    expect(converter).toBeDefined();
    expect(converter!.data.mode).toBe('>');
  });

  it('number→boolean compare converter has correct port connections', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const notId = getStore().addNode('not', [5, 0, 0]);
    connectPorts(srcId, 0, notId, 0);

    const converter = findConverterNode();
    expect(converter).toBeDefined();
    const toConverter = allConns().find(c => c.targetNodeId === converter!.id);
    const fromConverter = allConns().find(c => c.sourceNodeId === converter!.id);
    expect(toConverter!.targetPortIndex).toBe(0);  // compare input 0
    expect(fromConverter!.sourcePortIndex).toBe(0); // compare output 0 (boolean)
    expect(fromConverter!.targetNodeId).toBe(notId);
  });
});

// ---------------------------------------------------------------------------
// 17. boolean→string coercion: template converter
// ---------------------------------------------------------------------------

describe('autoInserted field - boolean→string coercion rule', () => {
  beforeEach(() => { resetStore(); });

  it('boolean→string inserts template converter with autoInserted=true', () => {
    // compare output 0 = boolean, concat input 0 = string
    const srcId = getStore().addNode('compare', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].type).toBe('template');
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('boolean→string: boolean source connects to converter input port 1 (any/value port)', () => {
    const srcId = getStore().addNode('compare', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connToConverter = allConns().find(c => c.targetNodeId === autoNode.id);
    expect(connToConverter).toBeDefined();
    expect(connToConverter!.targetPortIndex).toBe(1);
    expect(connToConverter!.sourceNodeId).toBe(srcId);
  });
});

// ---------------------------------------------------------------------------
// 18. Serialization roundtrip preserves autoInserted flag
// ---------------------------------------------------------------------------

describe('autoInserted field - serialization roundtrip', () => {
  beforeEach(() => { resetStore(); });

  it('exportAllGraphs / importAllGraphs preserves autoInserted=true on converter', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    expect(autoNode).toBeDefined();
    const autoNodeId = autoNode.id;

    // Export the full workspace
    const storage = getStore().exportAllGraphs();

    // Reset and reimport
    resetStore();
    expect(nodeCount()).toBe(0);

    getStore().importAllGraphs(storage);

    // Converter should be restored with autoInserted=true
    const restoredConverter = allNodes().find(n => n.id === autoNodeId);
    expect(restoredConverter).toBeDefined();
    expect(restoredConverter!.autoInserted).toBe(true);
  });

  it('serialization roundtrip preserves all 3 nodes and 2 connections', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const nodeCountBefore = nodeCount();
    const connCountBefore = connCount();

    const storage = getStore().exportAllGraphs();

    resetStore();
    getStore().importAllGraphs(storage);

    expect(nodeCount()).toBe(nodeCountBefore);
    expect(connCount()).toBe(connCountBefore);
  });

  it('serialization roundtrip: converter title still contains "(auto)"', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const storage = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(storage);

    const restored = allNodes().find(n => n.title.includes('(auto)'));
    expect(restored).toBeDefined();
    expect(restored!.autoInserted).toBe(true);
  });

  it('serialization roundtrip: connection labels are preserved', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    // The converter→target connection should have a label
    const labeledConn = allConns().find(c => c.label !== undefined);
    expect(labeledConn).toBeDefined();
    const labelValue = labeledConn!.label;
    const labeledConnId = labeledConn!.id;

    const storage = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(storage);

    const restoredConn = getStore().connections[labeledConnId];
    expect(restoredConn).toBeDefined();
    expect(restoredConn!.label).toBe(labelValue);
  });
});

// ---------------------------------------------------------------------------
// 19. Converter connections have correct labels (rule.description)
// ---------------------------------------------------------------------------

describe('autoInserted field - connection labels from rule description', () => {
  beforeEach(() => { resetStore(); });

  it('number→string coercion: converter→target connection has label "Number to string"', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connFromConverter = allConns().find(c => c.sourceNodeId === autoNode.id);
    expect(connFromConverter).toBeDefined();
    expect(connFromConverter!.label).toBe('Number to string');
  });

  it('string→number coercion: converter→target connection has label "String to number"', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    connectPorts(srcId, 1, tfId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connFromConverter = allConns().find(c => c.sourceNodeId === autoNode.id);
    expect(connFromConverter).toBeDefined();
    expect(connFromConverter!.label).toBe('String to number');
  });

  it('number→boolean coercion: converter→target connection has label "Number to boolean (> 0)"', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const notId = getStore().addNode('not', [5, 0, 0]);
    connectPorts(srcId, 0, notId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connFromConverter = allConns().find(c => c.sourceNodeId === autoNode.id);
    expect(connFromConverter).toBeDefined();
    expect(connFromConverter!.label).toBe('Number to boolean (> 0)');
  });

  it('boolean→string coercion: converter→target connection has label "Boolean to string"', () => {
    const srcId = getStore().addNode('compare', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connFromConverter = allConns().find(c => c.sourceNodeId === autoNode.id);
    expect(connFromConverter).toBeDefined();
    expect(connFromConverter!.label).toBe('Boolean to string');
  });

  it('source→converter connection does NOT have a label', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connToConverter = allConns().find(c => c.targetNodeId === autoNode.id);
    expect(connToConverter).toBeDefined();
    // The source→converter connection carries no label
    expect(connToConverter!.label).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 20. autoInserted field not affected by updateNodeData
// ---------------------------------------------------------------------------

describe('autoInserted field - updateNodeData does not affect flag', () => {
  beforeEach(() => { resetStore(); });

  it('updateNodeData on source does not affect converter autoInserted flag', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const autoNodeId = autoNode.id;

    // Update data on source node
    getStore().updateNodeData(srcId, 'value', 99);

    // Converter flag should be unchanged
    expect(getStore().nodes[autoNodeId].autoInserted).toBe(true);
  });

  it('updateNodeData on non-autoInserted node does not create autoInserted flag', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    getStore().updateNodeData(srcId, 'value', 42);

    expect(getStore().nodes[srcId].autoInserted).toBeUndefined();
  });

  it('updateNodeData on converter node preserves autoInserted=true', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const notId = getStore().addNode('not', [5, 0, 0]);
    connectPorts(srcId, 0, notId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const autoNodeId = autoNode.id;

    // Update data on the converter itself (not locked, so data can change)
    getStore().updateNodeData(autoNodeId, 'mode', '<');

    // autoInserted flag should remain true
    expect(getStore().nodes[autoNodeId].autoInserted).toBe(true);
    // Data should be updated
    expect(getStore().nodes[autoNodeId].data.mode).toBe('<');
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: vector3 coercion rules
// ---------------------------------------------------------------------------

describe('autoInserted field - vector3 coercion rules', () => {
  beforeEach(() => { resetStore(); });

  it('vector3→number: inserts decompose-vec3 converter with autoInserted=true', () => {
    // compose-vec3 output 0 = vector3, transform input 0 = number
    const srcId = getStore().addNode('compose-vec3', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    connectPorts(srcId, 0, tfId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].type).toBe('decompose-vec3');
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('number→vector3: inserts compose-vec3 converter with autoInserted=true', () => {
    // source output 0 = number, decompose-vec3 input 0 = vector3
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const decompId = getStore().addNode('decompose-vec3', [5, 0, 0]);
    connectPorts(srcId, 0, decompId, 0);

    const autoNodes = findAutoInsertedNodes();
    expect(autoNodes.length).toBe(1);
    expect(autoNodes[0].type).toBe('compose-vec3');
    expect(autoNodes[0].autoInserted).toBe(true);
  });

  it('vector3→number: correct connection label "Extract X from vector"', () => {
    const srcId = getStore().addNode('compose-vec3', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    connectPorts(srcId, 0, tfId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connFromConverter = allConns().find(c => c.sourceNodeId === autoNode.id);
    expect(connFromConverter!.label).toBe('Extract X from vector');
  });

  it('number→vector3: correct connection label "Number to vector (X)"', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const decompId = getStore().addNode('decompose-vec3', [5, 0, 0]);
    connectPorts(srcId, 0, decompId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const connFromConverter = allConns().find(c => c.sourceNodeId === autoNode.id);
    expect(connFromConverter!.label).toBe('Number to vector (X)');
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: connection structure validation
// ---------------------------------------------------------------------------

describe('autoInserted field - connection structure integrity', () => {
  beforeEach(() => { resetStore(); });

  it('coercion creates exactly 2 connections (src→converter, converter→target)', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);
    connectPorts(srcId, 0, concatId, 0);

    const autoNode = findAutoInsertedNodes()[0];
    const toConverter = allConns().filter(c => c.targetNodeId === autoNode.id);
    const fromConverter = allConns().filter(c => c.sourceNodeId === autoNode.id);
    expect(toConverter.length).toBe(1);
    expect(fromConverter.length).toBe(1);
    expect(toConverter[0].sourceNodeId).toBe(srcId);
    expect(fromConverter[0].targetNodeId).toBe(concatId);
  });

  it('interaction state returns to idle after coercion', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const concatId = getStore().addNode('concat', [5, 0, 0]);

    getStore().startConnection(srcId, 0);
    expect(getStore().interaction).toBe('drawing-connection');

    getStore().completeConnection(concatId, 0);

    expect(getStore().interaction).toBe('idle');
    expect(getStore().pendingConnection).toBeNull();
  });

  it('no coercion available: incompatible types leave state unchanged', () => {
    // color-picker output 0 = color, transform input 0 = number — no rule exists
    const srcId = getStore().addNode('color-picker', [0, 0, 0]);
    const tfId = getStore().addNode('transform', [5, 0, 0]);
    const beforeNodes = nodeCount();
    const beforeConns = connCount();

    connectPorts(srcId, 0, tfId, 0);

    expect(nodeCount()).toBe(beforeNodes);
    expect(connCount()).toBe(beforeConns);
    expect(findAutoInsertedNodes().length).toBe(0);
  });
});
