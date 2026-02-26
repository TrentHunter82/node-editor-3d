/**
 * Coercion integration tests — execution, deletion, duplication, locking, and variables.
 *
 * These tests complement type-coercion-integration.test.ts by verifying
 * runtime behaviour: actual execution output through coerced connections,
 * cascade deletion, duplicate/paste preservation, node locking interactions,
 * and graph variable interplay.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph } from '../utils/execution';

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

function nodeCount(): number { return Object.keys(getStore().nodes).length; }
function connCount(): number { return Object.keys(getStore().connections).length; }
function allConns() { return Object.values(getStore().connections); }
function allNodes() { return Object.values(getStore().nodes); }

function connectPorts(srcId: string, srcPort: number, tgtId: string, tgtPort: number) {
  getStore().startConnection(srcId, srcPort);
  getStore().completeConnection(tgtId, tgtPort);
}

function findConverterNode() {
  return allNodes().find(n => n.title.includes('(auto)'));
}

function findConverterNodes() {
  return allNodes().filter(n => n.title.includes('(auto)'));
}

function exec() {
  return executeGraph(getStore().nodes, getStore().connections);
}

function execWithVars(vars: Record<string, unknown>) {
  return executeGraph(
    getStore().nodes,
    getStore().connections,
    undefined, undefined, undefined, undefined,
    vars,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Coercion Integration — execution, deletion, duplication, locking, variables', () => {
  beforeEach(() => {
    resetStore();
  });

  // =========================================================================
  // 1. Execution verification (6 tests)
  // =========================================================================
  describe('execution verification', () => {
    it('number->string via template: source(42) produces "42" at concat output', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(srcId, 'value', 42);
      const concatId = getStore().addNode('concat', [10, 0, 0]);

      // number(0) -> string(0) triggers template coercion
      connectPorts(srcId, 0, concatId, 0);
      expect(findConverterNode()).toBeDefined();

      const { results } = exec();
      // concat output 0 should contain "42" (from first input, second defaults to "")
      expect(results.get(concatId)?.outputs[0]).toBe('42');
    });

    it('string->number via parse-number: source string "123" produces numeric 123 at transform', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(srcId, 'label', '123');
      const transformId = getStore().addNode('transform', [10, 0, 0]);

      // source output 1 (string) -> transform input 0 (number) triggers parse-number coercion
      connectPorts(srcId, 1, transformId, 0);
      expect(findConverterNode()!.type).toBe('parse-number');

      const { results } = exec();
      // transform with default multiplier=1, offset=0 should output 123
      const output = results.get(transformId)?.outputs[0];
      expect(output).toBe(123);
      expect(typeof output).toBe('number');
    });

    it('number->boolean via compare: source(5) with mode ">" produces true at not node', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(srcId, 'value', 5);
      const notId = getStore().addNode('not', [10, 0, 0]);

      // number(0) -> boolean(0) triggers compare coercion with initialData { mode: '>' }
      connectPorts(srcId, 0, notId, 0);
      const converter = findConverterNode();
      expect(converter!.type).toBe('compare');

      const { results } = exec();
      // compare: 5 > 0 = true, not(true) = false
      expect(results.get(converter!.id)?.outputs[0]).toBe(true);
      expect(results.get(notId)?.outputs[0]).toBe(false);
    });

    it('vector3->number via decompose-vec3: extracts x component', () => {
      const composeId = getStore().addNode('compose-vec3', [0, 0, 0]);
      // Wire constant x=7 via a source node
      const srcX = getStore().addNode('source', [-5, 0, 0]);
      getStore().updateNodeData(srcX, 'value', 7);
      connectPorts(srcX, 0, composeId, 0); // 7 into x input

      const transformId = getStore().addNode('transform', [15, 0, 0]);
      // compose-vec3 output(vector3) -> transform input(number) triggers decompose-vec3
      connectPorts(composeId, 0, transformId, 0);
      const converter = findConverterNode();
      expect(converter!.type).toBe('decompose-vec3');

      const { results } = exec();
      // decompose x = 7, transform * 1 + 0 = 7
      expect(results.get(transformId)?.outputs[0]).toBe(7);
    });

    it('number->vector3 via compose-vec3: source(7) produces [7, 0, 0]', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(srcId, 'value', 7);
      const decomposeId = getStore().addNode('decompose-vec3', [10, 0, 0]);

      // number(0) -> vector3(0) triggers compose-vec3
      connectPorts(srcId, 0, decomposeId, 0);
      const converter = findConverterNode();
      expect(converter!.type).toBe('compose-vec3');

      const { results } = exec();
      // compose-vec3 gets x=7, y=0, z=0 → [7,0,0]
      // decompose-vec3 outputs: 0=7, 1=0, 2=0
      expect(results.get(decomposeId)?.outputs[0]).toBe(7);
      expect(results.get(decomposeId)?.outputs[1]).toBe(0);
      expect(results.get(decomposeId)?.outputs[2]).toBe(0);
    });

    it('boolean->string via template: compare result true becomes "true"', () => {
      // Create a compare node that outputs true (5 > 0)
      const src1 = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(src1, 'value', 5);
      const compareId = getStore().addNode('compare', [5, 0, 0]);
      getStore().updateNodeData(compareId, 'mode', '>');
      connectPorts(src1, 0, compareId, 0); // 5 into compare input a

      const concatId = getStore().addNode('concat', [15, 0, 0]);
      // compare output(boolean) -> concat input(string) triggers template coercion
      connectPorts(compareId, 0, concatId, 0);
      const converter = findConverterNode();
      expect(converter!.type).toBe('template');

      const { results } = exec();
      // template: "{value}" with value=true → "true"
      // concat: "true" + "" → "true"
      expect(results.get(concatId)?.outputs[0]).toBe('true');
    });
  });

  // =========================================================================
  // 2. initialData verification (3 tests)
  // =========================================================================
  describe('initialData verification', () => {
    it('number->boolean coercion applies initialData {mode: ">"} to compare node', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const notId = getStore().addNode('not', [10, 0, 0]);

      connectPorts(srcId, 0, notId, 0);

      const converter = findConverterNode();
      expect(converter!.type).toBe('compare');
      expect(converter!.data.mode).toBe('>');
    });

    it('coerced compare with mode ">" converts positive to true and zero to false', () => {
      // Positive case: 5 > 0 = true
      const src1 = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(src1, 'value', 5);
      const not1 = getStore().addNode('not', [10, 0, 0]);
      connectPorts(src1, 0, not1, 0);

      const { results: r1 } = exec();
      const converter1 = findConverterNode();
      expect(r1.get(converter1!.id)?.outputs[0]).toBe(true);

      // Zero case: rebuild graph
      resetStore();
      const src2 = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(src2, 'value', 0);
      const not2 = getStore().addNode('not', [10, 0, 0]);
      connectPorts(src2, 0, not2, 0);

      const { results: r2 } = exec();
      const converter2 = findConverterNode();
      // 0 > 0 = false
      expect(r2.get(converter2!.id)?.outputs[0]).toBe(false);
    });

    it('rules without initialData leave converter data empty', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);

      // number->string uses template, which has no initialData in the rule
      connectPorts(srcId, 0, concatId, 0);

      const converter = findConverterNode();
      expect(converter!.type).toBe('template');
      // The data should be an empty object (no initialData set by the rule)
      expect(Object.keys(converter!.data).length).toBe(0);
    });
  });

  // =========================================================================
  // 3. Deletion cascade (3 tests)
  // =========================================================================
  describe('deletion cascade', () => {
    it('deleting converter node removes both connections', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0);

      const converter = findConverterNode()!;
      expect(connCount()).toBe(2);

      getStore().removeNode(converter.id);

      // Converter gone, both connections cascade-deleted
      expect(nodeCount()).toBe(2);
      expect(connCount()).toBe(0);
    });

    it('deleting source node removes its connection but converter and second connection remain', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0);
      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);

      getStore().removeNode(srcId);

      // Source gone + its outgoing connection removed
      // Converter and target remain, converter->target connection survives
      expect(nodeCount()).toBe(2); // converter + concat
      expect(connCount()).toBe(1); // converter -> concat
      const remaining = allConns()[0];
      expect(remaining.targetNodeId).toBe(concatId);
    });

    it('deleteSelected with converter selected removes converter + both connections', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0);

      const converter = findConverterNode()!;
      getStore().setSelection(new Set([converter.id]));
      getStore().deleteSelected();

      expect(nodeCount()).toBe(2); // src + concat
      expect(connCount()).toBe(0);
      expect(findConverterNode()).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. Coercion + duplicate/paste (4 tests)
  // =========================================================================
  describe('coercion + duplicate/paste', () => {
    it('duplicate selection containing converter preserves type and connections', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0);

      const converter = findConverterNode()!;
      // Select all three nodes (src, converter, target)
      getStore().setSelection(new Set([srcId, converter.id, concatId]));
      const oldToNew = getStore().duplicateSelected()!;

      expect(oldToNew).not.toBeNull();
      // Now we have 6 nodes, 4 connections
      expect(nodeCount()).toBe(6);
      expect(connCount()).toBe(4);

      // The duplicated converter should have the same type
      const newConverterId = oldToNew.get(converter.id)!;
      const newConverter = getStore().nodes[newConverterId];
      expect(newConverter.type).toBe('template');
      expect(newConverter.title).toContain('(auto)');
    });

    it('paste graph with coerced connections recreates converters correctly', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0);

      const converter = findConverterNode()!;
      // Select and copy all three nodes
      getStore().setSelection(new Set([srcId, converter.id, concatId]));
      getStore().copySelected();

      // Clear nodes/connections without resetting module state (preserves clipboard)
      useEditorStore.setState((s) => {
        s.nodes = {};
        s.connections = {};
        s.selectedIds = new Set();
      });
      expect(nodeCount()).toBe(0);

      getStore().paste();

      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      const pastedConverter = findConverterNode();
      expect(pastedConverter).toBeDefined();
      expect(pastedConverter!.type).toBe('template');
    });

    it('converter node initialData preserved through duplicate', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const notId = getStore().addNode('not', [10, 0, 0]);
      // number->boolean coercion creates compare with { mode: '>' }
      connectPorts(srcId, 0, notId, 0);

      const converter = findConverterNode()!;
      expect(converter.data.mode).toBe('>');

      getStore().setSelection(new Set([srcId, converter.id, notId]));
      const oldToNew = getStore().duplicateSelected()!;

      const newConverterId = oldToNew.get(converter.id)!;
      const newConverter = getStore().nodes[newConverterId];
      expect(newConverter.data.mode).toBe('>');
    });

    it('coerced connections in duplicated set maintain correct wiring', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0);

      const converter = findConverterNode()!;
      getStore().setSelection(new Set([srcId, converter.id, concatId]));
      const oldToNew = getStore().duplicateSelected()!;

      const newSrcId = oldToNew.get(srcId)!;
      const newConverterId = oldToNew.get(converter.id)!;
      const newConcatId = oldToNew.get(concatId)!;

      // Find connections for the duplicated set
      const newConns = allConns().filter(
        c =>
          (c.sourceNodeId === newSrcId || c.sourceNodeId === newConverterId) &&
          (c.targetNodeId === newConverterId || c.targetNodeId === newConcatId),
      );
      expect(newConns).toHaveLength(2);

      // Verify wiring: src -> converter and converter -> concat
      const srcToConverter = newConns.find(c => c.sourceNodeId === newSrcId);
      const converterToConcat = newConns.find(c => c.sourceNodeId === newConverterId);
      expect(srcToConverter).toBeDefined();
      expect(srcToConverter!.targetNodeId).toBe(newConverterId);
      expect(converterToConcat).toBeDefined();
      expect(converterToConcat!.targetNodeId).toBe(newConcatId);
    });
  });

  // =========================================================================
  // 5. Coercion + node locking (3 tests)
  // =========================================================================
  describe('coercion + node locking', () => {
    it('locked target node still accepts coerced connection', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      // Lock the target before connecting
      getStore().toggleNodeLock(concatId);
      expect(getStore().nodes[concatId].locked).toBe(true);

      connectPorts(srcId, 0, concatId, 0);

      // Coercion should still work — locking prevents deletion/data-edit, not incoming connections
      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
      expect(findConverterNode()).toBeDefined();
    });

    it('locked converter node cannot be deleted via deleteSelected', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0);

      const converter = findConverterNode()!;
      getStore().toggleNodeLock(converter.id);
      expect(getStore().nodes[converter.id].locked).toBe(true);

      getStore().setSelection(new Set([converter.id]));
      getStore().deleteSelected();

      // Converter should survive because it's locked
      expect(getStore().nodes[converter.id]).toBeDefined();
      expect(nodeCount()).toBe(3);
      expect(connCount()).toBe(2);
    });

    it('toggleNodeLock on converter persists through undo/redo', () => {
      const srcId = getStore().addNode('source', [0, 0, 0]);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0);

      const converter = findConverterNode()!;
      getStore().toggleNodeLock(converter.id);
      expect(getStore().nodes[converter.id].locked).toBe(true);

      getStore().undo(); // undo lock
      expect(getStore().nodes[converter.id].locked).toBeFalsy();

      getStore().redo(); // redo lock
      expect(getStore().nodes[converter.id].locked).toBe(true);
    });
  });

  // =========================================================================
  // 6. Multiple coercions in execution (3 tests)
  // =========================================================================
  describe('multiple coercions in execution', () => {
    it('chain: number -> template -> parse-number -> transform produces correct value', () => {
      // source(42) -> [template coercion] -> concat(string "42")
      // But we want: number -> string -> number chain
      // source output 0 (number) -> concat input 0 (string) [coercion: template]
      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(srcId, 'value', 42);
      const concatId = getStore().addNode('concat', [8, 0, 0]);
      connectPorts(srcId, 0, concatId, 0); // number->string coercion

      // concat output 0 (string) -> transform input 0 (number) [coercion: parse-number]
      const transformId = getStore().addNode('transform', [16, 0, 0]);
      connectPorts(concatId, 0, transformId, 0); // string->number coercion

      const converters = findConverterNodes();
      expect(converters).toHaveLength(2);
      expect(converters.map(c => c.type).sort()).toEqual(['parse-number', 'template']);

      const { results } = exec();
      // 42 -> template -> "42" -> concat("42","") -> "42" -> parse-number -> 42 -> transform(42*1+0) -> 42
      expect(results.get(transformId)?.outputs[0]).toBe(42);
    });

    it('two independent coercions execute correctly in same graph', () => {
      // Path 1: source(10) -> template -> concat
      const src1 = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(src1, 'value', 10);
      const concat1 = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(src1, 0, concat1, 0); // number->string

      // Path 2: source(99) -> template -> different concat
      const src2 = getStore().addNode('source', [0, 0, 5]);
      getStore().updateNodeData(src2, 'value', 99);
      const concat2 = getStore().addNode('concat', [10, 0, 5]);
      connectPorts(src2, 0, concat2, 0); // number->string

      expect(findConverterNodes()).toHaveLength(2);

      const { results } = exec();
      expect(results.get(concat1)?.outputs[0]).toBe('10');
      expect(results.get(concat2)?.outputs[0]).toBe('99');
    });

    it('coercion + normal connection mixed graph executes correctly', () => {
      // Path: source(7) --[normal]--> transform(*2) --[coerced: number->string]--> concat
      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(srcId, 'value', 7);

      const transformId = getStore().addNode('transform', [6, 0, 0]);
      getStore().updateNodeData(transformId, 'multiplier', 2);
      getStore().updateNodeData(transformId, 'offset', 0);
      connectPorts(srcId, 0, transformId, 0); // number->number, direct

      const concatId = getStore().addNode('concat', [14, 0, 0]);
      connectPorts(transformId, 0, concatId, 0); // number->string, coerced

      expect(findConverterNodes()).toHaveLength(1);
      expect(findConverterNode()!.type).toBe('template');

      const { results } = exec();
      // 7 * 2 + 0 = 14 -> template -> "14" -> concat("14", "") -> "14"
      expect(results.get(concatId)?.outputs[0]).toBe('14');
    });
  });

  // =========================================================================
  // 7. Coercion + graph variables (3 tests)
  // =========================================================================
  describe('coercion + graph variables', () => {
    it('set-var output connects through coercion to typed target', () => {
      // set-var has output portType 'any', so connecting to a string port
      // won't trigger coercion (any is compatible with everything).
      // Instead, test: source(number) -> coerced -> not(boolean)
      // then chain the boolean output to set-var (which accepts any).
      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(srcId, 'value', 5);
      const notId = getStore().addNode('not', [10, 0, 0]);
      connectPorts(srcId, 0, notId, 0); // number->boolean coercion

      const setVarId = getStore().addNode('set-var', [18, 0, 0]);
      getStore().updateNodeData(setVarId, 'variableName', 'myBool');
      connectPorts(notId, 0, setVarId, 0); // boolean -> any (no coercion)

      expect(findConverterNodes()).toHaveLength(1); // only the number->boolean one
      const converter = findConverterNode()!;
      expect(converter.type).toBe('compare');

      const { results } = execWithVars({});
      // source(5) -> compare(5 > 0 = true) -> not(false) -> set-var stores false
      expect(results.get(setVarId)?.outputs[0]).toBe(false);
    });

    it('source -> coerced -> node executes correctly in graph with variables', () => {
      // Set up a graph variable and also have a coerced connection
      const getVarId = getStore().addNode('get-var', [0, 0, 5]);
      getStore().updateNodeData(getVarId, 'variableName', 'counter');

      const srcId = getStore().addNode('source', [0, 0, 0]);
      getStore().updateNodeData(srcId, 'value', 42);
      const concatId = getStore().addNode('concat', [10, 0, 0]);
      connectPorts(srcId, 0, concatId, 0); // number->string coercion

      expect(findConverterNode()).toBeDefined();

      const { results } = execWithVars({ counter: 100 });
      // Coerced path still works: 42 -> template -> "42" -> concat -> "42"
      expect(results.get(concatId)?.outputs[0]).toBe('42');
      // Variable path also works independently
      expect(results.get(getVarId)?.outputs[0]).toBe(100);
    });

    it('coercion does not interfere with graph variable pass-through', () => {
      // Use pre-set graph variables alongside a coerced connection path
      const getVarId = getStore().addNode('get-var', [0, 0, 0]);
      getStore().updateNodeData(getVarId, 'variableName', 'myVal');

      const displayId = getStore().addNode('display', [8, 0, 0]);
      connectPorts(getVarId, 0, displayId, 0); // any -> any (no coercion)

      // Separate coerced path: source(99) -> template(coercion) -> concat
      const srcId = getStore().addNode('source', [0, 0, 5]);
      getStore().updateNodeData(srcId, 'value', 99);
      const concatId = getStore().addNode('concat', [10, 0, 5]);
      connectPorts(srcId, 0, concatId, 0); // number->string coercion

      expect(findConverterNodes()).toHaveLength(1);

      // Pre-set 'myVal' to 77 so get-var reads it directly
      const { results } = execWithVars({ myVal: 77 });
      // get-var reads pre-set value
      expect(results.get(getVarId)?.outputs[0]).toBe(77);
      // Coerced path still works independently
      expect(results.get(concatId)?.outputs[0]).toBe('99');
    });
  });
});
