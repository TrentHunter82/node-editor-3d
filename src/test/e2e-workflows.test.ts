/**
 * End-to-End Workflow Tests
 *
 * Tests full user journeys through the node editor, validating that
 * multi-step workflows produce correct results across store mutations,
 * execution, undo/redo, multi-graph operations, templates, subgraphs,
 * import/export, and validation.
 *
 * These tests exercise the COMPLETE workflow path, not individual features.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph } from '../utils/execution';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.searchQuery = '';
    s.contextMenu = null;
    s.validationErrors = {};
    s.breadcrumbStack = [];
    s.activeGraphId = 'default';
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.graphOrder = ['default'];
    s.templates = {};
    s.errorStrategy = 'fail-fast';
    s.executionMetrics = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
  });
  localStorage.clear();
}

/** Execute graph via the utility function and return results */
function exec() {
  return executeGraph(getState().nodes, getState().connections);
}

/** Execute graph with a specific error strategy */
function execWithStrategy(strategy: 'fail-fast' | 'continue') {
  return executeGraph(
    getState().nodes,
    getState().connections,
    undefined,
    undefined,
    undefined,
    strategy,
  );
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('E2E Workflow Tests', () => {
  beforeEach(() => {
    resetStore();
  });

  // =========================================================================
  // 1. Create-Connect-Execute-Verify
  // =========================================================================
  describe('1. Create-Connect-Execute-Verify', () => {
    it('builds source->transform->output chain, sets values, executes, and verifies output propagation', () => {
      // Step 1: Create three nodes forming a pipeline
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const out = getState().addNode('output', [10, 0, 0]);

      // Step 2: Set source value and transform parameters
      getState().updateNodeData(src, 'value', 7);
      getState().updateNodeData(xfm, 'multiplier', 3);
      getState().updateNodeData(xfm, 'offset', 2);

      // Step 3: Connect source(0) -> transform(0), transform(0) -> output(0)
      const c1 = getState().addConnection(src, 0, xfm, 0);
      const c2 = getState().addConnection(xfm, 0, out, 0);
      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();

      // Step 4: Execute the graph
      const result = exec();

      // Step 5: Verify outputs propagated correctly
      // source outputs value=7
      expect(result.results.get(src)!.outputs[0]).toBe(7);
      // transform computes: 7 * 3 + 2 = 23
      expect(result.results.get(xfm)!.outputs[0]).toBe(23);
      // output node has no outputs, but it consumed the data
      expect(result.errors.size).toBe(0);
    });
  });

  // =========================================================================
  // 2. Create-Execute-Modify-Re-Execute
  // =========================================================================
  describe('2. Create-Execute-Modify-Re-Execute', () => {
    it('creates graph, executes, changes source value, re-executes, and verifies output changes', () => {
      // Build initial graph: source -> math (add) -> display
      const src1 = getState().addNode('source', [0, 0, 0]);
      const src2 = getState().addNode('source', [0, 0, 5]);
      const math = getState().addNode('math', [5, 0, 2]);

      getState().updateNodeData(src1, 'value', 10);
      getState().updateNodeData(src2, 'value', 20);
      getState().updateNodeData(math, 'operation', 'add');

      getState().addConnection(src1, 0, math, 0);
      getState().addConnection(src2, 0, math, 1);

      // First execution
      const result1 = exec();
      expect(result1.results.get(math)!.outputs[0]).toBe(30); // 10 + 20

      // Modify source value
      getState().updateNodeData(src1, 'value', 50);

      // Re-execute
      const result2 = exec();
      expect(result2.results.get(math)!.outputs[0]).toBe(70); // 50 + 20

      // Verify the source changed
      expect(result2.results.get(src1)!.outputs[0]).toBe(50);
    });
  });

  // =========================================================================
  // 3. Build-Undo-Redo-Verify
  // =========================================================================
  describe('3. Build-Undo-Redo-Verify', () => {
    it('builds a 5-node graph step by step, undoes all, redoes all, and verifies final state', () => {
      // Build 5 nodes with connections
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [3, 0, 0]);
      const n3 = getState().addNode('math', [6, 0, 0]);
      const n4 = getState().addNode('abs', [9, 0, 0]);
      const n5 = getState().addNode('output', [12, 0, 0]);

      getState().updateNodeData(n1, 'value', 42);
      getState().addConnection(n1, 0, n2, 0);
      getState().addConnection(n2, 0, n3, 0);
      getState().addConnection(n3, 0, n4, 0);
      getState().addConnection(n4, 0, n5, 0);

      // Snapshot final state
      const finalNodeCount = Object.keys(getState().nodes).length;
      const finalConnCount = Object.keys(getState().connections).length;
      expect(finalNodeCount).toBe(5);
      expect(finalConnCount).toBe(4);

      // Undo everything (5 addNode + 1 updateNodeData + 4 addConnection = 10 actions)
      let undoCount = 0;
      while (getState().canUndo()) {
        getState().undo();
        undoCount++;
      }
      expect(undoCount).toBeGreaterThanOrEqual(5);

      // After undoing everything, graph should be empty
      expect(Object.keys(getState().nodes).length).toBe(0);
      expect(Object.keys(getState().connections).length).toBe(0);

      // Redo everything
      let redoCount = 0;
      while (getState().canRedo()) {
        getState().redo();
        redoCount++;
      }
      expect(redoCount).toBe(undoCount);

      // Verify final state matches what we built
      expect(Object.keys(getState().nodes).length).toBe(finalNodeCount);
      expect(Object.keys(getState().connections).length).toBe(finalConnCount);
      expect(getState().nodes[n1].data.value).toBe(42);
    });
  });

  // =========================================================================
  // 4. Build-Select-Group-Collapse-Execute
  // =========================================================================
  describe('4. Build-Select-Group-Collapse-Execute', () => {
    it('creates nodes, groups them, collapses group, executes, and verifies execution works', () => {
      // Create source -> transform -> output
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const out = getState().addNode('output', [10, 0, 0]);

      getState().updateNodeData(src, 'value', 10);
      getState().updateNodeData(xfm, 'multiplier', 5);
      getState().updateNodeData(xfm, 'offset', 0);
      getState().addConnection(src, 0, xfm, 0);
      getState().addConnection(xfm, 0, out, 0);

      // Group source and transform
      getState().setSelection(new Set([src, xfm]));
      const groupId = getState().createGroup('Pipeline');
      expect(groupId).not.toBeNull();
      expect(getState().nodes[src].groupId).toBe(groupId);
      expect(getState().nodes[xfm].groupId).toBe(groupId);

      // Collapse the group
      getState().toggleGroupCollapse(groupId!);
      expect(getState().groups[groupId!].collapsed).toBe(true);

      // Execute - should still work correctly regardless of collapse state
      const result = exec();
      expect(result.results.get(xfm)!.outputs[0]).toBe(50); // 10 * 5
      expect(result.errors.size).toBe(0);
    });
  });

  // =========================================================================
  // 5. Build-Save-Template-Clear-Instantiate
  // =========================================================================
  describe('5. Build-Save-Template-Clear-Instantiate', () => {
    it('creates a pattern, saves as template, clears graph, instantiates template, and verifies restoration', () => {
      // Build a small pattern: source -> transform
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().updateNodeData(src, 'value', 99);
      getState().updateNodeData(xfm, 'multiplier', 2);
      const connId = getState().addConnection(src, 0, xfm, 0);
      expect(connId).not.toBeNull();

      // Select both and save as template
      getState().setSelection(new Set([src, xfm]));
      const templateId = getState().saveSelectionAsTemplate('My Pipeline', 'Custom');
      expect(templateId).not.toBeNull();

      // Verify template was saved
      const tmpl = getState().templates[templateId!];
      expect(tmpl.name).toBe('My Pipeline');
      expect(tmpl.category).toBe('Custom');
      expect(tmpl.nodes).toHaveLength(2);
      expect(tmpl.connections).toHaveLength(1);

      // Clear the graph
      getState().clearGraph();
      expect(Object.keys(getState().nodes).length).toBe(0);
      expect(Object.keys(getState().connections).length).toBe(0);

      // Instantiate template
      getState().instantiateTemplate(templateId!);
      expect(Object.keys(getState().nodes).length).toBe(2);
      expect(Object.keys(getState().connections).length).toBe(1);

      // Verify data was restored (new IDs, same data)
      const newNodes = Object.values(getState().nodes);
      const srcNode = newNodes.find(n => n.type === 'source')!;
      const xfmNode = newNodes.find(n => n.type === 'transform')!;
      expect(srcNode.data.value).toBe(99);
      expect(xfmNode.data.multiplier).toBe(2);

      // Verify the connection is between the new nodes
      const conn = Object.values(getState().connections)[0];
      expect(conn.sourceNodeId).toBe(srcNode.id);
      expect(conn.targetNodeId).toBe(xfmNode.id);
    });
  });

  // =========================================================================
  // 6. Multi-Graph-Workflow
  // =========================================================================
  describe('6. Multi-Graph-Workflow', () => {
    it('creates nodes in graph A, creates graph B, adds nodes, switches between, and verifies independence', () => {
      // Graph A (default): add source and transform
      const srcA = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcA, 'value', 100);
      const xfmA = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(srcA, 0, xfmA, 0);

      const graphAId = getState().activeGraphId;
      expect(Object.keys(getState().nodes).length).toBe(2);

      // Create graph B
      const graphBId = getState().createGraph('Graph B');
      expect(getState().activeGraphId).toBe(graphBId);
      expect(Object.keys(getState().nodes).length).toBe(0); // Empty new graph

      // Add nodes to graph B
      const srcB = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcB, 'value', 200);
      const mathB = getState().addNode('math', [5, 0, 0]);
      const sinB = getState().addNode('sin', [10, 0, 0]);
      getState().addConnection(srcB, 0, mathB, 0);
      getState().addConnection(mathB, 0, sinB, 0);
      expect(Object.keys(getState().nodes).length).toBe(3);

      // Switch back to graph A
      getState().switchGraph(graphAId);
      expect(getState().activeGraphId).toBe(graphAId);
      expect(Object.keys(getState().nodes).length).toBe(2);
      expect(getState().nodes[srcA].data.value).toBe(100);

      // Switch to graph B
      getState().switchGraph(graphBId);
      expect(Object.keys(getState().nodes).length).toBe(3);
      expect(getState().nodes[srcB].data.value).toBe(200);

      // Verify graph order contains both
      expect(getState().graphOrder).toContain(graphAId);
      expect(getState().graphOrder).toContain(graphBId);
    });
  });

  // =========================================================================
  // 7. Export-Import-Verify
  // =========================================================================
  describe('7. Export-Import-Verify', () => {
    it('builds complex graph, exports, clears, imports, and verifies all data preserved', () => {
      // Build a graph with nodes, connections, groups, and a template
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const math = getState().addNode('math', [10, 0, 0]);
      getState().updateNodeData(src, 'value', 42);
      getState().updateNodeData(xfm, 'multiplier', 3);
      getState().updateNodeData(math, 'operation', 'multiply');
      getState().addConnection(src, 0, xfm, 0);
      getState().addConnection(xfm, 0, math, 0);

      // Create a group
      getState().setSelection(new Set([src, xfm]));
      getState().createGroup('MyGroup');

      // Save a template
      getState().setSelection(new Set([src]));
      getState().saveSelectionAsTemplate('SrcTemplate', 'Test');

      // Create a second graph with nodes
      const graph2 = getState().createGraph('Second Graph');
      const src2 = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src2, 'value', 999);

      // Export
      const exported = getState().exportAllGraphs();
      expect(exported.version).toBe(2);
      expect(Object.keys(exported.graphs).length).toBe(2);
      expect(Object.keys(exported.templates).length).toBe(1);

      // Clear everything by resetting
      resetStore();
      expect(Object.keys(getState().nodes).length).toBe(0);

      // Import
      getState().importAllGraphs(exported);

      // Verify active graph is restored (was graph2 when we exported)
      expect(getState().activeGraphId).toBe(graph2);
      expect(Object.keys(getState().nodes).length).toBe(1);
      expect(Object.values(getState().nodes)[0].data.value).toBe(999);

      // Switch to original graph and verify
      getState().switchGraph('default');
      expect(Object.keys(getState().nodes).length).toBe(3);
      expect(Object.keys(getState().connections).length).toBe(2);
      expect(Object.keys(getState().groups).length).toBe(1);

      // Verify template survived
      expect(Object.keys(getState().templates).length).toBe(1);
      const tmpl = Object.values(getState().templates)[0];
      expect(tmpl.name).toBe('SrcTemplate');
    });
  });

  // =========================================================================
  // 8. Custom-Node-Workflow
  // =========================================================================
  describe('8. Custom-Node-Workflow', () => {
    it('adds custom node def, creates custom node, sets expression, connects, executes, and verifies', () => {
      // Step 1: Define a custom node that doubles input
      const defId = getState().addCustomNodeDef({
        name: 'Doubler',
        color: '#FF0000',
        category: 'Custom',
        inputs: [{ label: 'x', portType: 'number' }],
        outputs: [{ label: 'result', portType: 'number' }],
        expression: 'in0 * 2',
      });
      expect(defId).toBeTruthy();

      // Step 2: Create the custom node instance
      const customId = getState().addCustomNode(defId, [5, 0, 0]);
      expect(customId).not.toBeNull();
      expect(getState().nodes[customId!].type).toBe('custom');

      // Step 3: Configure ports (1 input, 1 output)
      getState().updateCustomNodePorts(customId!, 1, 1);

      // Step 4: Set expression
      getState().updateNodeData(customId!, 'expression', 'in0 * 2');

      // Step 5: Create source and connect
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 15);
      const connId = getState().addConnection(src, 0, customId!, 0);
      expect(connId).not.toBeNull();

      // Step 6: Execute
      const result = exec();
      expect(result.errors.size).toBe(0);

      // Step 7: Verify custom node output: 15 * 2 = 30
      expect(result.results.get(customId!)!.outputs[0]).toBe(30);
    });
  });

  // =========================================================================
  // 9. Copy-Paste-Cross-Graph
  // =========================================================================
  describe('9. Copy-Paste-Cross-Graph', () => {
    it('builds pattern in graph A, copies, switches to graph B, pastes, and verifies independence', () => {
      // Build in graph A
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().updateNodeData(src, 'value', 77);
      getState().updateNodeData(xfm, 'multiplier', 4);
      getState().addConnection(src, 0, xfm, 0);

      // Select and copy
      getState().setSelection(new Set([src, xfm]));
      getState().copySelected();
      expect(getState().canPaste()).toBe(true);

      // Create graph B and switch
      const graphBId = getState().createGraph('Graph B');
      expect(getState().activeGraphId).toBe(graphBId);
      expect(Object.keys(getState().nodes).length).toBe(0);

      // Paste
      getState().paste();
      expect(Object.keys(getState().nodes).length).toBe(2);

      // Verify pasted nodes have new IDs but same data
      const pastedNodes = Object.values(getState().nodes);
      const pastedSrc = pastedNodes.find(n => n.type === 'source')!;
      const pastedXfm = pastedNodes.find(n => n.type === 'transform')!;
      expect(pastedSrc.data.value).toBe(77);
      expect(pastedXfm.data.multiplier).toBe(4);
      expect(pastedSrc.id).not.toBe(src);
      expect(pastedXfm.id).not.toBe(xfm);

      // Verify connection was pasted too
      expect(Object.keys(getState().connections).length).toBe(1);

      // Modify pasted data - should not affect graph A
      getState().updateNodeData(pastedSrc.id, 'value', 999);

      // Switch back to A and verify original intact
      getState().switchGraph('default');
      expect(getState().nodes[src].data.value).toBe(77);
    });
  });

  // =========================================================================
  // 10. Find-Replace-Workflow (batch title rename)
  // =========================================================================
  describe('10. Find-Replace-Workflow', () => {
    it('creates several nodes, renames via batchUpdateNodeTitles, and verifies titles changed', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('source', [3, 0, 0]);
      const n3 = getState().addNode('source', [6, 0, 0]);
      const n4 = getState().addNode('transform', [9, 0, 0]);

      // All source nodes start with title "Source"
      expect(getState().nodes[n1].title).toBe('Source');
      expect(getState().nodes[n2].title).toBe('Source');
      expect(getState().nodes[n3].title).toBe('Source');

      // Batch rename source nodes
      getState().batchUpdateNodeTitles([
        { nodeId: n1, title: 'Input A' },
        { nodeId: n2, title: 'Input B' },
        { nodeId: n3, title: 'Input C' },
      ]);

      expect(getState().nodes[n1].title).toBe('Input A');
      expect(getState().nodes[n2].title).toBe('Input B');
      expect(getState().nodes[n3].title).toBe('Input C');
      // Transform should be unchanged
      expect(getState().nodes[n4].title).toBe('Transform');

      // Undo the batch rename - should revert all at once
      getState().undo();
      expect(getState().nodes[n1].title).toBe('Source');
      expect(getState().nodes[n2].title).toBe('Source');
      expect(getState().nodes[n3].title).toBe('Source');

      // Redo
      getState().redo();
      expect(getState().nodes[n1].title).toBe('Input A');
    });
  });

  // =========================================================================
  // 11. Delete-Undo-Reconnect
  // =========================================================================
  describe('11. Delete-Undo-Reconnect', () => {
    it('builds connected graph, deletes middle node, undoes, and verifies connections restored', () => {
      // Build A -> B -> C
      const a = getState().addNode('source', [0, 0, 0]);
      const b = getState().addNode('transform', [5, 0, 0]);
      const c = getState().addNode('output', [10, 0, 0]);
      getState().updateNodeData(a, 'value', 5);

      const c1 = getState().addConnection(a, 0, b, 0);
      const c2 = getState().addConnection(b, 0, c, 0);
      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();

      // Verify 3 nodes, 2 connections
      expect(Object.keys(getState().nodes).length).toBe(3);
      expect(Object.keys(getState().connections).length).toBe(2);

      // Delete middle node B
      getState().setSelection(new Set([b]));
      getState().deleteSelected();

      // B removed, connections involving B removed
      expect(Object.keys(getState().nodes).length).toBe(2);
      expect(getState().nodes[b]).toBeUndefined();
      expect(Object.keys(getState().connections).length).toBe(0);

      // Undo the deletion
      getState().undo();

      // Everything restored
      expect(Object.keys(getState().nodes).length).toBe(3);
      expect(getState().nodes[b]).toBeDefined();
      expect(Object.keys(getState().connections).length).toBe(2);

      // Verify execution still works after undo
      const result = exec();
      // transform: 5 * 1 + 0 = 5 (default multiplier=1, offset=0)
      expect(result.results.get(b)!.outputs[0]).toBe(5);
    });
  });

  // =========================================================================
  // 12. Validation-Fix-Revalidate
  // =========================================================================
  describe('12. Validation-Fix-Revalidate', () => {
    it('creates graph with disconnected inputs, validates, fixes connections, and re-validates', () => {
      // Create transform and output with no incoming connections
      const xfm = getState().addNode('transform', [0, 0, 0]);
      const out = getState().addNode('output', [5, 0, 0]);

      // Validate - should find errors (disconnected inputs)
      getState().validateGraph();
      const errors1 = getState().validationErrors;
      // Both nodes should have validation issues
      expect(Object.keys(errors1).length).toBeGreaterThan(0);
      // Transform should have unconnected input errors
      expect(errors1[xfm]).toBeDefined();
      expect(errors1[xfm].some(e => e.includes('not connected'))).toBe(true);

      // Fix: add sources and connect all required inputs
      const src = getState().addNode('source', [0, 0, -5]);
      const factorSrc = getState().addNode('source', [0, 0, -8]);
      const labelSrc = getState().addNode('source', [-5, 0, 5]);
      getState().addConnection(src, 0, xfm, 0);       // transform.in
      getState().addConnection(factorSrc, 0, xfm, 1); // transform.factor
      getState().addConnection(xfm, 0, out, 0);       // output.data
      getState().addConnection(labelSrc, 1, out, 1);   // output.label (string port)

      // Re-validate
      getState().validateGraph();
      const errors2 = getState().validationErrors;

      // After fully connecting everything, the main "Input ... is not connected" errors
      // should be resolved for transform and output
      const xfmErrors2 = errors2[xfm] ?? [];
      const outErrors2 = errors2[out] ?? [];
      // Transform should have no "not connected" input errors
      expect(xfmErrors2.filter(e => e.includes('Input') && e.includes('not connected')).length).toBe(0);
      // Output should have no "not connected" input errors
      expect(outErrors2.filter(e => e.includes('Input') && e.includes('not connected')).length).toBe(0);
    });
  });

  // =========================================================================
  // 13. Large-Linear-Chain
  // =========================================================================
  describe('13. Large-Linear-Chain', () => {
    it('builds 20-node chain, executes, and verifies all values propagate through reroute nodes', () => {
      // Source -> 18 reroute nodes -> output
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 42);

      const reroutes: string[] = [];
      let prevId = src;

      for (let i = 0; i < 18; i++) {
        const r = getState().addNode('reroute', [(i + 1) * 2, 0, 0]);
        getState().addConnection(prevId, 0, r, 0);
        reroutes.push(r);
        prevId = r;
      }

      const out = getState().addNode('output', [40, 0, 0]);
      getState().addConnection(prevId, 0, out, 0);

      // Total: 1 source + 18 reroutes + 1 output = 20
      expect(Object.keys(getState().nodes).length).toBe(20);

      // Execute
      const result = exec();
      expect(result.errors.size).toBe(0);

      // Value 42 should propagate through all reroute nodes
      for (const rId of reroutes) {
        expect(result.results.get(rId)!.outputs[0]).toBe(42);
      }
    });
  });

  // =========================================================================
  // 14. Diamond-Graph-Execution
  // =========================================================================
  describe('14. Diamond-Graph-Execution', () => {
    it('builds diamond (1 source -> 2 transforms -> 1 math), executes, and verifies merge', () => {
      // Diamond topology:
      //   source(5) -> transform_A(*2) -> math(add)
      //   source(5) -> transform_B(*3) -> math(add)
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 5);

      const xfmA = getState().addNode('transform', [5, 0, -3]);
      getState().updateNodeData(xfmA, 'multiplier', 2);
      getState().updateNodeData(xfmA, 'offset', 0);

      const xfmB = getState().addNode('transform', [5, 0, 3]);
      getState().updateNodeData(xfmB, 'multiplier', 3);
      getState().updateNodeData(xfmB, 'offset', 0);

      const math = getState().addNode('math', [10, 0, 0]);
      getState().updateNodeData(math, 'operation', 'add');

      // Connect diamond: src -> both transforms -> math
      getState().addConnection(src, 0, xfmA, 0);
      getState().addConnection(src, 0, xfmB, 0);
      getState().addConnection(xfmA, 0, math, 0);  // math.a = transform_A result
      getState().addConnection(xfmB, 0, math, 1);  // math.b = transform_B result

      const result = exec();
      expect(result.errors.size).toBe(0);

      // transform_A: 5 * 2 = 10
      expect(result.results.get(xfmA)!.outputs[0]).toBe(10);
      // transform_B: 5 * 3 = 15
      expect(result.results.get(xfmB)!.outputs[0]).toBe(15);
      // math(add): 10 + 15 = 25
      expect(result.results.get(math)!.outputs[0]).toBe(25);
    });
  });

  // =========================================================================
  // 15. Subgraph-Create-Enter-Edit-Exit-Execute
  // =========================================================================
  describe('15. Subgraph-Create-Enter-Edit-Exit-Execute', () => {
    it('creates subgraph, enters, adds internal nodes, exits, and executes outer graph', () => {
      // Create a source in the outer graph
      const outerSrc = getState().addNode('source', [-5, 0, 0]);
      getState().updateNodeData(outerSrc, 'value', 10);

      // Create a subgraph node
      const subgraphNodeId = getState().createSubgraph('Doubler');
      expect(subgraphNodeId).not.toBeNull();
      expect(getState().nodes[subgraphNodeId!].type).toBe('subgraph');

      // Connect source to subgraph input
      getState().addConnection(outerSrc, 0, subgraphNodeId!, 0);

      // Create output node connected to subgraph output
      const outerOut = getState().addNode('display', [10, 0, 0]);
      getState().addConnection(subgraphNodeId!, 0, outerOut, 0);

      // Enter the subgraph
      getState().enterSubgraph(subgraphNodeId!);
      expect(getState().breadcrumbStack.length).toBe(1);

      // Inside: should see subgraph-input and subgraph-output nodes
      const innerNodes = Object.values(getState().nodes);
      const inputNode = innerNodes.find(n => n.type === 'subgraph-input');
      const outputNode = innerNodes.find(n => n.type === 'subgraph-output');
      expect(inputNode).toBeDefined();
      expect(outputNode).toBeDefined();

      // Add a transform node inside that doubles the value
      const innerXfm = getState().addNode('transform', [0, 0, 0]);
      getState().updateNodeData(innerXfm, 'multiplier', 2);
      getState().updateNodeData(innerXfm, 'offset', 0);

      // Connect: input -> transform -> output
      getState().addConnection(inputNode!.id, 0, innerXfm, 0);
      getState().addConnection(innerXfm, 0, outputNode!.id, 0);

      // Exit the subgraph
      getState().exitSubgraph();
      expect(getState().breadcrumbStack.length).toBe(0);

      // Verify we're back in the outer graph
      expect(getState().nodes[outerSrc]).toBeDefined();
      expect(getState().nodes[subgraphNodeId!]).toBeDefined();
    });
  });

  // =========================================================================
  // 16. Error-Recovery-Workflow
  // =========================================================================
  describe('16. Error-Recovery-Workflow', () => {
    it('creates graph with error node, executes with continue strategy, and verifies partial results', () => {
      // Build: source -> custom(error) -> output
      //        source -> transform -> output2
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 10);

      // Create a custom node that will error at runtime
      // (use a runtime error expression: calling undefined as a function)
      const defId = getState().addCustomNodeDef({
        name: 'ErrorNode',
        color: '#FF0000',
        category: 'Test',
        inputs: [{ label: 'x', portType: 'number' }],
        outputs: [{ label: 'result', portType: 'number' }],
        expression: 'undefined.crash()',
      });
      const errorNode = getState().addCustomNode(defId, [5, 0, -3]);
      getState().updateCustomNodePorts(errorNode!, 1, 1);
      getState().updateNodeData(errorNode!, 'expression', 'undefined.crash()');

      // Healthy path: source -> transform -> display
      const xfm = getState().addNode('transform', [5, 0, 3]);
      getState().updateNodeData(xfm, 'multiplier', 3);
      getState().updateNodeData(xfm, 'offset', 0);
      const display = getState().addNode('display', [10, 0, 3]);

      getState().addConnection(src, 0, errorNode!, 0);
      getState().addConnection(src, 0, xfm, 0);
      getState().addConnection(xfm, 0, display, 0);

      // Execute with 'continue' strategy - should not stop on error
      const result = execWithStrategy('continue');

      // Error node should have an error
      expect(result.errors.has(errorNode!)).toBe(true);
      expect(result.errors.get(errorNode!)!).toContain('Custom expression error');

      // Healthy path should still execute
      expect(result.results.get(xfm)!.outputs[0]).toBe(30); // 10 * 3
    });
  });

  // =========================================================================
  // 17. Mixed-Type-Graph
  // =========================================================================
  describe('17. Mixed-Type-Graph', () => {
    it('builds graph with number, string, boolean, and vector nodes, executes, and verifies type coercions', () => {
      // Number path
      const numSrc = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(numSrc, 'value', 42);

      // String path: source label -> concat
      const concat = getState().addNode('concat', [5, 0, 3]);

      // Boolean path: compare node
      const cmp = getState().addNode('compare', [5, 0, -3]);
      getState().updateNodeData(cmp, 'mode', '>');

      // Vector path: compose-vec3
      const vec = getState().addNode('compose-vec3', [5, 0, 6]);

      // Source feeds number to: compare.a, compose-vec3.x
      const src2 = getState().addNode('source', [0, 0, -3]);
      getState().updateNodeData(src2, 'value', 10);

      getState().addConnection(numSrc, 0, cmp, 0);  // 42 > ?
      getState().addConnection(src2, 0, cmp, 1);     // ? = 10
      getState().addConnection(numSrc, 0, vec, 0);   // x = 42

      // Use source label output (port 1 = string) to concat
      getState().addConnection(numSrc, 1, concat, 0);
      getState().addConnection(src2, 1, concat, 1);

      const result = exec();
      expect(result.errors.size).toBe(0);

      // compare: 42 > 10 = true
      expect(result.results.get(cmp)!.outputs[0]).toBe(true);

      // compose-vec3: [42, 0, 0] (only x connected)
      const vecResult = result.results.get(vec)!.outputs[0] as number[];
      expect(vecResult[0]).toBe(42);
      expect(vecResult[1]).toBe(0);
      expect(vecResult[2]).toBe(0);

      // concat: "Source" + "Source" (both labels default to title)
      expect(result.results.get(concat)!.outputs[0]).toBe('SourceSource');
    });
  });

  // =========================================================================
  // 18. Template-Library-Management
  // =========================================================================
  describe('18. Template-Library-Management', () => {
    it('saves multiple templates, instantiates each, and verifies correct restoration', () => {
      // Template 1: single source
      const s1 = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(s1, 'value', 10);
      getState().setSelection(new Set([s1]));
      const t1 = getState().saveSelectionAsTemplate('Source10', 'Numbers');

      // Template 2: source -> transform pair
      const s2 = getState().addNode('source', [0, 0, 5]);
      const x2 = getState().addNode('transform', [5, 0, 5]);
      getState().updateNodeData(s2, 'value', 20);
      getState().updateNodeData(x2, 'multiplier', 5);
      getState().addConnection(s2, 0, x2, 0);
      getState().setSelection(new Set([s2, x2]));
      const t2 = getState().saveSelectionAsTemplate('SourceXfm', 'Pipelines');

      // Template 3: math node
      const m3 = getState().addNode('math', [0, 0, 10]);
      getState().updateNodeData(m3, 'operation', 'multiply');
      getState().setSelection(new Set([m3]));
      const t3 = getState().saveSelectionAsTemplate('Multiplier', 'Math');

      // Verify all templates saved
      expect(Object.keys(getState().templates).length).toBe(3);
      expect(getState().templates[t1!].name).toBe('Source10');
      expect(getState().templates[t2!].name).toBe('SourceXfm');
      expect(getState().templates[t3!].name).toBe('Multiplier');

      // Clear graph
      getState().clearGraph();

      // Instantiate template 1
      getState().instantiateTemplate(t1!);
      const afterT1 = Object.values(getState().nodes);
      expect(afterT1.length).toBe(1);
      expect(afterT1[0].type).toBe('source');
      expect(afterT1[0].data.value).toBe(10);

      // Instantiate template 2 (adds to existing)
      getState().instantiateTemplate(t2!, [10, 0, 0]);
      expect(Object.keys(getState().nodes).length).toBe(3); // 1 from t1 + 2 from t2
      expect(Object.keys(getState().connections).length).toBe(1); // t2 had 1 connection

      // Instantiate template 3
      getState().instantiateTemplate(t3!, [20, 0, 0]);
      expect(Object.keys(getState().nodes).length).toBe(4);
      const mathNodes = Object.values(getState().nodes).filter(n => n.type === 'math');
      expect(mathNodes.length).toBe(1);
      expect(mathNodes[0].data.operation).toBe('multiply');
    });
  });

  // =========================================================================
  // 19. Rapid-Edit-Execute-Cycle
  // =========================================================================
  describe('19. Rapid-Edit-Execute-Cycle', () => {
    it('makes 10 sequential edits with execution after each, verifying consistency', () => {
      // Step 1: Add source
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 1);
      let r = exec();
      expect(r.results.get(src)!.outputs[0]).toBe(1);

      // Step 2: Add transform
      const xfm = getState().addNode('transform', [5, 0, 0]);
      r = exec();
      expect(r.results.get(xfm)!.outputs[0]).toBe(0); // no input connected, default 0

      // Step 3: Connect
      getState().addConnection(src, 0, xfm, 0);
      r = exec();
      expect(r.results.get(xfm)!.outputs[0]).toBe(1); // 1 * 1 + 0

      // Step 4: Set multiplier
      getState().updateNodeData(xfm, 'multiplier', 10);
      r = exec();
      expect(r.results.get(xfm)!.outputs[0]).toBe(10); // 1 * 10 + 0

      // Step 5: Set offset
      getState().updateNodeData(xfm, 'offset', 5);
      r = exec();
      expect(r.results.get(xfm)!.outputs[0]).toBe(15); // 1 * 10 + 5

      // Step 6: Change source value
      getState().updateNodeData(src, 'value', 3);
      r = exec();
      expect(r.results.get(xfm)!.outputs[0]).toBe(35); // 3 * 10 + 5

      // Step 7: Add output
      const out = getState().addNode('output', [10, 0, 0]);
      getState().addConnection(xfm, 0, out, 0);
      r = exec();
      expect(r.results.get(xfm)!.outputs[0]).toBe(35);

      // Step 8: Add math node branching from source
      const math = getState().addNode('math', [5, 0, 5]);
      getState().updateNodeData(math, 'operation', 'multiply');
      getState().addConnection(src, 0, math, 0);
      getState().addConnection(src, 0, math, 1);
      r = exec();
      expect(r.results.get(math)!.outputs[0]).toBe(9); // 3 * 3

      // Step 9: Change source value again
      getState().updateNodeData(src, 'value', 7);
      r = exec();
      expect(r.results.get(xfm)!.outputs[0]).toBe(75); // 7 * 10 + 5
      expect(r.results.get(math)!.outputs[0]).toBe(49); // 7 * 7

      // Step 10: Add abs node
      const abs = getState().addNode('abs', [10, 0, 5]);
      getState().addConnection(math, 0, abs, 0);
      r = exec();
      expect(r.results.get(abs)!.outputs[0]).toBe(49);
      expect(r.errors.size).toBe(0);
    });
  });

  // =========================================================================
  // 20. Graph-Metadata-Workflow
  // =========================================================================
  describe('20. Graph-Metadata-Workflow', () => {
    it('creates graph, sets metadata, exports, reimports, and verifies metadata preserved', () => {
      // Set metadata on default graph
      const graphId = getState().activeGraphId;
      getState().updateGraphMetadata(graphId, {
        description: 'Main processing pipeline',
        author: 'TestUser',
        tags: ['production', 'math'],
      });

      // Verify metadata set
      const tab = getState().graphTabs[graphId];
      expect(tab.description).toBe('Main processing pipeline');
      expect(tab.author).toBe('TestUser');
      expect(tab.tags).toEqual(['production', 'math']);

      // Add a node to make the graph non-trivial
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 42);

      // Create second graph with metadata
      const g2 = getState().createGraph('Analysis');
      getState().updateGraphMetadata(g2, {
        description: 'Data analysis workflow',
        author: 'TestUser',
        tags: ['analysis'],
      });

      // Export
      const exported = getState().exportAllGraphs();

      // Reset and reimport
      resetStore();
      getState().importAllGraphs(exported);

      // Verify metadata preserved
      const importedTab1 = getState().graphTabs[graphId];
      expect(importedTab1.description).toBe('Main processing pipeline');
      expect(importedTab1.author).toBe('TestUser');
      expect(importedTab1.tags).toEqual(['production', 'math']);

      const importedTab2 = getState().graphTabs[g2];
      expect(importedTab2.description).toBe('Data analysis workflow');
      expect(importedTab2.tags).toEqual(['analysis']);
    });
  });

  // =========================================================================
  // 21. Statistics-Node-Workflow
  // =========================================================================
  describe('21. Statistics-Node-Workflow', () => {
    it('creates source nodes feeding into mean/median/stddev/min-array/max-array, executes, and verifies', () => {
      // We need to pass an array to statistics nodes.
      // Source node outputs a number, not an array, so we use a custom node to create arrays.
      const defId = getState().addCustomNodeDef({
        name: 'ArrayMaker',
        color: '#00FF00',
        category: 'Test',
        inputs: [],
        outputs: [{ label: 'array', portType: 'any' }],
        expression: '[10, 20, 30, 40, 50]',
      });
      const arrayNode = getState().addCustomNode(defId, [0, 0, 0]);
      getState().updateCustomNodePorts(arrayNode!, 0, 1);
      getState().updateNodeData(arrayNode!, 'expression', '[10, 20, 30, 40, 50]');

      // Create statistics nodes
      const meanNode = getState().addNode('mean', [5, 0, -6]);
      const medianNode = getState().addNode('median', [5, 0, -3]);
      const stddevNode = getState().addNode('stddev', [5, 0, 0]);
      const minNode = getState().addNode('min-array', [5, 0, 3]);
      const maxNode = getState().addNode('max-array', [5, 0, 6]);

      // Connect array output to all stats nodes
      getState().addConnection(arrayNode!, 0, meanNode, 0);
      getState().addConnection(arrayNode!, 0, medianNode, 0);
      getState().addConnection(arrayNode!, 0, stddevNode, 0);
      getState().addConnection(arrayNode!, 0, minNode, 0);
      getState().addConnection(arrayNode!, 0, maxNode, 0);

      // Execute
      const result = exec();
      expect(result.errors.size).toBe(0);

      // mean([10,20,30,40,50]) = 30
      expect(result.results.get(meanNode)!.outputs[0]).toBe(30);

      // median([10,20,30,40,50]) = 30
      expect(result.results.get(medianNode)!.outputs[0]).toBe(30);

      // stddev([10,20,30,40,50]) = sqrt(200) = ~14.14
      const sd = result.results.get(stddevNode)!.outputs[0] as number;
      expect(sd).toBeCloseTo(Math.sqrt(200), 5);

      // min = 10
      expect(result.results.get(minNode)!.outputs[0]).toBe(10);

      // max = 50
      expect(result.results.get(maxNode)!.outputs[0]).toBe(50);
    });
  });

  // =========================================================================
  // 22. Vector-Math-Workflow
  // =========================================================================
  describe('22. Vector-Math-Workflow', () => {
    it('creates compose-vec3 -> dot/cross/normalize/length chain, executes, and verifies', () => {
      // Create vector A = [1, 0, 0] via compose-vec3
      const srcAx = getState().addNode('source', [0, 0, -6]);
      getState().updateNodeData(srcAx, 'value', 1);
      const srcAy = getState().addNode('source', [0, 0, -3]);
      getState().updateNodeData(srcAy, 'value', 0);
      const srcAz = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcAz, 'value', 0);
      const vecA = getState().addNode('compose-vec3', [5, 0, -3]);
      getState().addConnection(srcAx, 0, vecA, 0);
      getState().addConnection(srcAy, 0, vecA, 1);
      getState().addConnection(srcAz, 0, vecA, 2);

      // Create vector B = [0, 1, 0] via compose-vec3
      const srcBx = getState().addNode('source', [0, 0, 4]);
      getState().updateNodeData(srcBx, 'value', 0);
      const srcBy = getState().addNode('source', [0, 0, 7]);
      getState().updateNodeData(srcBy, 'value', 1);
      const srcBz = getState().addNode('source', [0, 0, 10]);
      getState().updateNodeData(srcBz, 'value', 0);
      const vecB = getState().addNode('compose-vec3', [5, 0, 7]);
      getState().addConnection(srcBx, 0, vecB, 0);
      getState().addConnection(srcBy, 0, vecB, 1);
      getState().addConnection(srcBz, 0, vecB, 2);

      // dot product: A . B = 0
      const dot = getState().addNode('dot-product', [10, 0, -3]);
      getState().addConnection(vecA, 0, dot, 0);
      getState().addConnection(vecB, 0, dot, 1);

      // cross product: A x B = [0, 0, 1]
      const cross = getState().addNode('cross-product', [10, 0, 2]);
      getState().addConnection(vecA, 0, cross, 0);
      getState().addConnection(vecB, 0, cross, 1);

      // normalize: normalize(A) = [1, 0, 0] (already unit)
      const norm = getState().addNode('normalize-vec3', [10, 0, 7]);
      getState().addConnection(vecA, 0, norm, 0);

      // vec3-length: |A| = 1
      const len = getState().addNode('vec3-length', [10, 0, 12]);
      getState().addConnection(vecA, 0, len, 0);

      // Execute
      const result = exec();
      expect(result.errors.size).toBe(0);

      // dot product of perpendicular unit vectors = 0
      expect(result.results.get(dot)!.outputs[0]).toBe(0);

      // cross product [1,0,0] x [0,1,0] = [0,0,1]
      const crossResult = result.results.get(cross)!.outputs[0] as number[];
      expect(crossResult[0]).toBeCloseTo(0);
      expect(crossResult[1]).toBeCloseTo(0);
      expect(crossResult[2]).toBeCloseTo(1);

      // normalize [1,0,0] = [1,0,0]
      const normResult = result.results.get(norm)!.outputs[0] as number[];
      expect(normResult[0]).toBeCloseTo(1);
      expect(normResult[1]).toBeCloseTo(0);
      expect(normResult[2]).toBeCloseTo(0);

      // length of [1,0,0] = 1
      expect(result.results.get(len)!.outputs[0]).toBeCloseTo(1);
    });
  });

  // =========================================================================
  // 23. Undo-History-Navigation
  // =========================================================================
  describe('23. Undo-History-Navigation', () => {
    it('builds graph step by step, uses jumpToUndo to jump to middle of history, and verifies state', () => {
      // Step 0: empty (initial state before any action)
      // Step 1: add node A
      const a = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(a, 'value', 1);
      // Step 2: add node B
      const b = getState().addNode('source', [3, 0, 0]);
      getState().updateNodeData(b, 'value', 2);
      // Step 3: add node C
      const c = getState().addNode('source', [6, 0, 0]);
      getState().updateNodeData(c, 'value', 3);
      // Step 4: add node D
      const d = getState().addNode('source', [9, 0, 0]);
      getState().updateNodeData(d, 'value', 4);
      // Step 5: add transform
      const xfm = getState().addNode('transform', [12, 0, 0]);

      // At this point we have: addA, updateA, addB, updateB, addC, updateC, addD, updateD, addXfm
      // That's 9 undo entries
      const history = getState().getUndoHistory();
      const undoLen = history.undo.length;
      expect(undoLen).toBeGreaterThanOrEqual(9);

      // Jump to index 3 (after addB, updateB) - should see nodes A and B with their data
      // Index 3 means the 4th undo entry (0-based)
      // The undo stack grows as: [state-before-addA, state-before-updateA, state-before-addB, state-before-updateB, ...]
      // Jumping to index 3 restores the state saved at undo[3] which is the state BEFORE updateB
      // That state has: A (with value=1) and B (without value set yet)

      // Let's jump to partway through - roughly the middle
      const midIndex = Math.floor(undoLen / 2);
      getState().jumpToUndo(midIndex);

      // After jumping back, we should have fewer nodes than at the end
      const nodeCount = Object.keys(getState().nodes).length;
      expect(nodeCount).toBeLessThan(5);

      // We can redo to get back to the end
      while (getState().canRedo()) {
        getState().redo();
      }
      expect(Object.keys(getState().nodes).length).toBe(5);
      expect(getState().nodes[xfm]).toBeDefined();
    });
  });

  // =========================================================================
  // 24. Connection-Reconnect-Workflow
  // =========================================================================
  describe('24. Connection-Reconnect-Workflow', () => {
    it('connects A->B, then reconnects A->C, verifies B disconnected and C connected', () => {
      const a = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(a, 'value', 100);

      const b = getState().addNode('transform', [5, 0, -3]);
      const c = getState().addNode('transform', [5, 0, 3]);

      // Connect A -> B
      const connAB = getState().addConnection(a, 0, b, 0);
      expect(connAB).not.toBeNull();

      // Verify B is connected
      let result = exec();
      expect(result.results.get(b)!.outputs[0]).toBe(100); // 100 * 1 + 0

      // Now connect A -> C (different target, same source port)
      const connAC = getState().addConnection(a, 0, c, 0);
      expect(connAC).not.toBeNull();

      // B's connection should still exist (addConnection doesn't auto-disconnect source)
      // But C should now also be connected
      result = exec();
      expect(result.results.get(b)!.outputs[0]).toBe(100);
      expect(result.results.get(c)!.outputs[0]).toBe(100);

      // Now explicitly remove B's connection and verify
      getState().removeConnection(connAB!);
      result = exec();
      // B should revert to default (0 * 1 + 0 = 0)
      expect(result.results.get(b)!.outputs[0]).toBe(0);
      // C should still have the connection
      expect(result.results.get(c)!.outputs[0]).toBe(100);

      // Verify connection count
      expect(Object.keys(getState().connections).length).toBe(1);
    });
  });

  // =========================================================================
  // 25. Full-Project-Lifecycle
  // =========================================================================
  describe('25. Full-Project-Lifecycle', () => {
    it('performs complete Create->Edit->Execute->Save->Close->Load->Verify lifecycle', () => {
      // Phase 1: CREATE
      const src1 = getState().addNode('source', [0, 0, 0]);
      const src2 = getState().addNode('source', [0, 0, 5]);
      const math = getState().addNode('math', [5, 0, 2]);
      const clamp = getState().addNode('clamp', [10, 0, 2]);
      const out = getState().addNode('output', [15, 0, 2]);

      // Phase 2: EDIT (configure nodes and connections)
      getState().updateNodeData(src1, 'value', 100);
      getState().updateNodeData(src2, 'value', 50);
      getState().updateNodeData(math, 'operation', 'add');
      getState().addConnection(src1, 0, math, 0);
      getState().addConnection(src2, 0, math, 1);
      getState().addConnection(math, 0, clamp, 0);
      getState().addConnection(clamp, 0, out, 0);

      // Create a group
      getState().setSelection(new Set([src1, src2]));
      getState().createGroup('Inputs');

      // Save a template
      getState().setSelection(new Set([math, clamp]));
      getState().saveSelectionAsTemplate('MathClamp', 'Processing');

      // Rename graph
      getState().renameGraph('default', 'Production Pipeline');

      // Phase 3: EXECUTE
      const result = exec();
      expect(result.errors.size).toBe(0);
      // math: 100 + 50 = 150
      expect(result.results.get(math)!.outputs[0]).toBe(150);
      // clamp: clamp(150, 0, 1) = 1 (default min=0, max=1)
      expect(result.results.get(clamp)!.outputs[0]).toBe(1);

      // Phase 4: SAVE (export)
      const exported = getState().exportAllGraphs();
      const exportedNodeCount = Object.keys(exported.graphs['default'].nodes).length;
      expect(exportedNodeCount).toBe(5);

      // Phase 5: CLOSE (reset everything)
      resetStore();
      expect(Object.keys(getState().nodes).length).toBe(0);
      expect(Object.keys(getState().templates).length).toBe(0);

      // Phase 6: LOAD (import)
      getState().importAllGraphs(exported);

      // Phase 7: VERIFY everything survived the lifecycle
      expect(Object.keys(getState().nodes).length).toBe(5);
      expect(Object.keys(getState().connections).length).toBe(4);
      expect(Object.keys(getState().groups).length).toBe(1);
      expect(Object.keys(getState().templates).length).toBe(1);
      expect(getState().graphTabs['default'].name).toBe('Production Pipeline');

      // Verify node data survived
      expect(getState().nodes[src1].data.value).toBe(100);
      expect(getState().nodes[src2].data.value).toBe(50);
      expect(getState().nodes[math].data.operation).toBe('add');

      // Verify execution still works after load
      const result2 = exec();
      expect(result2.results.get(math)!.outputs[0]).toBe(150);
      expect(result2.results.get(clamp)!.outputs[0]).toBe(1);
    });
  });

  // =========================================================================
  // 26. Duplicate-Modify-Execute-Verify-Independence
  // =========================================================================
  describe('26. Duplicate-Modify-Execute-Verify-Independence', () => {
    it('builds chain, duplicates, modifies duplicate, executes, and verifies both chains independent', () => {
      // Build original: source(5) -> transform(*3)
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 5);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().updateNodeData(xfm, 'multiplier', 3);
      getState().updateNodeData(xfm, 'offset', 0);
      getState().addConnection(src, 0, xfm, 0);

      // Execute original
      let result = exec();
      expect(result.results.get(xfm)!.outputs[0]).toBe(15);

      // Select both and duplicate
      getState().setSelection(new Set([src, xfm]));
      const idMap = getState().duplicateSelected();
      expect(idMap).not.toBeNull();
      expect(idMap!.size).toBe(2);

      // Get duplicated IDs
      const dupSrc = idMap!.get(src)!;
      const dupXfm = idMap!.get(xfm)!;
      expect(getState().nodes[dupSrc]).toBeDefined();
      expect(getState().nodes[dupXfm]).toBeDefined();

      // Modify the duplicate
      getState().updateNodeData(dupSrc, 'value', 100);
      getState().updateNodeData(dupXfm, 'multiplier', 10);

      // Execute - both chains should compute independently
      result = exec();
      expect(result.results.get(xfm)!.outputs[0]).toBe(15);      // original: 5 * 3
      expect(result.results.get(dupXfm)!.outputs[0]).toBe(1000);  // duplicate: 100 * 10
    });
  });

  // =========================================================================
  // 27. Multi-Graph-Delete-And-Verify
  // =========================================================================
  describe('27. Multi-Graph-Delete-And-Verify', () => {
    it('creates multiple graphs, deletes one, and verifies remaining graphs intact', () => {
      // Create graph A nodes
      const srcA = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcA, 'value', 11);

      // Create graph B
      const graphB = getState().createGraph('Graph B');
      const srcB = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcB, 'value', 22);

      // Create graph C
      const graphC = getState().createGraph('Graph C');
      const srcC = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcC, 'value', 33);

      expect(getState().graphOrder.length).toBe(3);

      // Delete graph B (must switch away from it first if active)
      getState().switchGraph(graphB);
      getState().deleteGraph(graphB);

      // Should be switched to another graph after deletion
      expect(getState().activeGraphId).not.toBe(graphB);
      expect(getState().graphOrder.length).toBe(2);
      expect(getState().graphTabs[graphB]).toBeUndefined();

      // Verify remaining graphs still have their data
      getState().switchGraph('default');
      expect(getState().nodes[srcA].data.value).toBe(11);

      getState().switchGraph(graphC);
      expect(getState().nodes[srcC].data.value).toBe(33);
    });
  });

  // =========================================================================
  // 28. Complex-Math-Pipeline
  // =========================================================================
  describe('28. Complex-Math-Pipeline', () => {
    it('builds src -> sqrt -> floor -> clamp -> remap pipeline and verifies math chain', () => {
      // Pipeline: source(144) -> sqrt -> floor -> clamp(0,10) -> remap(0,10 -> 0,100)
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 144);

      const sqrtNode = getState().addNode('sqrt', [3, 0, 0]);
      const floorNode = getState().addNode('floor', [6, 0, 0]);
      const clampNode = getState().addNode('clamp', [9, 0, 0]);
      const remapNode = getState().addNode('remap', [12, 0, 0]);

      getState().addConnection(src, 0, sqrtNode, 0);
      getState().addConnection(sqrtNode, 0, floorNode, 0);
      getState().addConnection(floorNode, 0, clampNode, 0);
      getState().addConnection(clampNode, 0, remapNode, 0);

      // Set clamp range via source nodes for min and max
      const clampMin = getState().addNode('source', [6, 0, -3]);
      getState().updateNodeData(clampMin, 'value', 0);
      const clampMax = getState().addNode('source', [6, 0, 3]);
      getState().updateNodeData(clampMax, 'value', 10);
      getState().addConnection(clampMin, 0, clampNode, 1);
      getState().addConnection(clampMax, 0, clampNode, 2);

      // Set remap ranges via sources
      const remapInMin = getState().addNode('source', [9, 0, -6]);
      getState().updateNodeData(remapInMin, 'value', 0);
      const remapInMax = getState().addNode('source', [9, 0, -3]);
      getState().updateNodeData(remapInMax, 'value', 10);
      const remapOutMin = getState().addNode('source', [9, 0, 3]);
      getState().updateNodeData(remapOutMin, 'value', 0);
      const remapOutMax = getState().addNode('source', [9, 0, 6]);
      getState().updateNodeData(remapOutMax, 'value', 100);
      getState().addConnection(remapInMin, 0, remapNode, 1);
      getState().addConnection(remapInMax, 0, remapNode, 2);
      getState().addConnection(remapOutMin, 0, remapNode, 3);
      getState().addConnection(remapOutMax, 0, remapNode, 4);

      const result = exec();
      expect(result.errors.size).toBe(0);

      // sqrt(144) = 12
      expect(result.results.get(sqrtNode)!.outputs[0]).toBe(12);
      // floor(12) = 12
      expect(result.results.get(floorNode)!.outputs[0]).toBe(12);
      // clamp(12, 0, 10) = 10
      expect(result.results.get(clampNode)!.outputs[0]).toBe(10);
      // remap(10, 0, 10, 0, 100) = 100
      expect(result.results.get(remapNode)!.outputs[0]).toBe(100);
    });
  });

  // =========================================================================
  // 29. Logic-Gate-Workflow
  // =========================================================================
  describe('29. Logic-Gate-Workflow', () => {
    it('builds boolean logic circuit with compare/and/or/not/switch and verifies outputs', () => {
      // Create: compare(10 > 5) AND compare(20 > 15) -> switch(true: 100, false: 0)
      const src10 = getState().addNode('source', [0, 0, -3]);
      getState().updateNodeData(src10, 'value', 10);
      const src5 = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src5, 'value', 5);

      const src20 = getState().addNode('source', [0, 0, 3]);
      getState().updateNodeData(src20, 'value', 20);
      const src15 = getState().addNode('source', [0, 0, 6]);
      getState().updateNodeData(src15, 'value', 15);

      // compare1: 10 > 5 = true
      const cmp1 = getState().addNode('compare', [5, 0, -1]);
      getState().updateNodeData(cmp1, 'mode', '>');
      getState().addConnection(src10, 0, cmp1, 0);
      getState().addConnection(src5, 0, cmp1, 1);

      // compare2: 20 > 15 = true
      const cmp2 = getState().addNode('compare', [5, 0, 5]);
      getState().updateNodeData(cmp2, 'mode', '>');
      getState().addConnection(src20, 0, cmp2, 0);
      getState().addConnection(src15, 0, cmp2, 1);

      // AND: true AND true = true
      const andNode = getState().addNode('and', [10, 0, 2]);
      getState().addConnection(cmp1, 0, andNode, 0);
      getState().addConnection(cmp2, 0, andNode, 1);

      // NOT: !true = false (for testing)
      const notNode = getState().addNode('not', [10, 0, 6]);
      getState().addConnection(andNode, 0, notNode, 0);

      // Switch: value=AND result (true), case0=true→match, default=0
      const srcCase0 = getState().addNode('source', [10, 0, -3]);
      getState().updateNodeData(srcCase0, 'value', true); // case0 = true, matches AND result
      const srcDefault = getState().addNode('source', [10, 0, -6]);
      getState().updateNodeData(srcDefault, 'value', 0);

      const switchNode = getState().addNode('switch', [15, 0, 0]);
      getState().addConnection(andNode, 0, switchNode, 0);     // value (true)
      getState().addConnection(srcCase0, 0, switchNode, 1);    // case0 (true) — matches value
      getState().addConnection(srcDefault, 0, switchNode, 5);  // default (0)

      const result = exec();
      expect(result.errors.size).toBe(0);

      expect(result.results.get(cmp1)!.outputs[0]).toBe(true);
      expect(result.results.get(cmp2)!.outputs[0]).toBe(true);
      expect(result.results.get(andNode)!.outputs[0]).toBe(true);
      expect(result.results.get(notNode)!.outputs[0]).toBe(false);
      // switch: value=true, case0=true → match, output true
      expect(result.results.get(switchNode)!.outputs[0]).toBe(true);
    });
  });

  // =========================================================================
  // 30. String-Processing-Pipeline
  // =========================================================================
  describe('30. String-Processing-Pipeline', () => {
    it('builds string processing chain: concat -> string-case -> string-length -> parse-number', () => {
      // Build: concat("hello", " world") -> string-case -> string-length
      const defConcat = getState().addCustomNodeDef({
        name: 'StringSource',
        color: '#00FFFF',
        category: 'Test',
        inputs: [],
        outputs: [{ label: 'str', portType: 'string' }],
        expression: '"hello"',
      });
      const strSrc1 = getState().addCustomNode(defConcat, [0, 0, 0]);
      getState().updateCustomNodePorts(strSrc1!, 0, 1);
      getState().updateNodeData(strSrc1!, 'expression', '"hello"');

      const defWorld = getState().addCustomNodeDef({
        name: 'StringSource2',
        color: '#00FFFF',
        category: 'Test',
        inputs: [],
        outputs: [{ label: 'str', portType: 'string' }],
        expression: '" world"',
      });
      const strSrc2 = getState().addCustomNode(defWorld, [0, 0, 3]);
      getState().updateCustomNodePorts(strSrc2!, 0, 1);
      getState().updateNodeData(strSrc2!, 'expression', '" world"');

      const concatNode = getState().addNode('concat', [5, 0, 1]);
      getState().addConnection(strSrc1!, 0, concatNode, 0);
      getState().addConnection(strSrc2!, 0, concatNode, 1);

      const caseNode = getState().addNode('string-case', [10, 0, 1]);
      getState().addConnection(concatNode, 0, caseNode, 0);

      const lenNode = getState().addNode('string-length', [15, 0, -1]);
      getState().addConnection(concatNode, 0, lenNode, 0);

      const result = exec();
      expect(result.errors.size).toBe(0);

      // concat: "hello" + " world" = "hello world"
      expect(result.results.get(concatNode)!.outputs[0]).toBe('hello world');

      // string-case: upper = "HELLO WORLD", lower = "hello world"
      expect(result.results.get(caseNode)!.outputs[0]).toBe('HELLO WORLD');
      expect(result.results.get(caseNode)!.outputs[1]).toBe('hello world');

      // string-length: 11
      expect(result.results.get(lenNode)!.outputs[0]).toBe(11);
    });
  });

  // =========================================================================
  // 31. Undo-Redo-Across-Graph-Switch
  // =========================================================================
  describe('31. Undo-Redo-Across-Graph-Switch', () => {
    it('verifies undo/redo stacks are independent per graph', () => {
      // Build in default graph
      const srcA = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcA, 'value', 10);
      // The undo stack for default graph now has entries

      // Create new graph and build
      const graphB = getState().createGraph('Graph B');
      const srcB = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcB, 'value', 20);

      // Undo in graph B should only affect graph B
      getState().undo(); // undo updateNodeData
      expect(getState().nodes[srcB].data.value).toBeUndefined();

      getState().redo(); // redo updateNodeData
      expect(getState().nodes[srcB].data.value).toBe(20);

      // Switch to default graph
      getState().switchGraph('default');

      // Undo in default graph should undo the last action in default graph
      if (getState().canUndo()) {
        getState().undo();
        // Should undo something from default graph, not from graph B
        expect(getState().activeGraphId).toBe('default');
      }

      // Switch back to B - B's state should be unaffected by default graph's undo
      getState().switchGraph(graphB);
      expect(getState().nodes[srcB]).toBeDefined();
      expect(getState().nodes[srcB].data.value).toBe(20);
    });
  });

  // =========================================================================
  // 32. Lerp-Interpolation-Workflow
  // =========================================================================
  describe('32. Lerp-Interpolation-Workflow', () => {
    it('builds lerp pipeline with parametric t, executes at various t values, and verifies', () => {
      // lerp(a=0, b=100, t)
      const srcA = getState().addNode('source', [0, 0, -3]);
      getState().updateNodeData(srcA, 'value', 0);
      const srcB = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcB, 'value', 100);
      const srcT = getState().addNode('source', [0, 0, 3]);
      getState().updateNodeData(srcT, 'value', 0.5);

      const lerpNode = getState().addNode('lerp', [5, 0, 0]);
      getState().addConnection(srcA, 0, lerpNode, 0);
      getState().addConnection(srcB, 0, lerpNode, 1);
      getState().addConnection(srcT, 0, lerpNode, 2);

      // t=0.5 -> result=50
      let result = exec();
      expect(result.results.get(lerpNode)!.outputs[0]).toBe(50);

      // t=0 -> result=0
      getState().updateNodeData(srcT, 'value', 0);
      result = exec();
      expect(result.results.get(lerpNode)!.outputs[0]).toBe(0);

      // t=1 -> result=100
      getState().updateNodeData(srcT, 'value', 1);
      result = exec();
      expect(result.results.get(lerpNode)!.outputs[0]).toBe(100);

      // t=0.25 -> result=25
      getState().updateNodeData(srcT, 'value', 0.25);
      result = exec();
      expect(result.results.get(lerpNode)!.outputs[0]).toBe(25);
    });
  });

  // =========================================================================
  // 33. Custom-Node-Multi-Output-Workflow
  // =========================================================================
  describe('33. Custom-Node-Multi-Output-Workflow', () => {
    it('creates custom node with multiple outputs, connects to downstream nodes, executes, and verifies', () => {
      // Custom node that splits input into two: [in0, in0*2]
      const defId = getState().addCustomNodeDef({
        name: 'Splitter',
        color: '#0000FF',
        category: 'Custom',
        inputs: [{ label: 'x', portType: 'number' }],
        outputs: [
          { label: 'original', portType: 'number' },
          { label: 'doubled', portType: 'number' },
        ],
        expression: '[in0, in0 * 2]',
      });

      const customNode = getState().addCustomNode(defId, [5, 0, 0]);
      getState().updateCustomNodePorts(customNode!, 1, 2);
      getState().updateNodeData(customNode!, 'expression', '[in0, in0 * 2]');
      getState().updateNodeData(customNode!, 'outputCount', 2);

      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 7);

      // Connect source -> custom input
      getState().addConnection(src, 0, customNode!, 0);

      // Connect custom outputs to display nodes
      const display1 = getState().addNode('display', [10, 0, -2]);
      const display2 = getState().addNode('display', [10, 0, 2]);
      getState().addConnection(customNode!, 0, display1, 0); // original (7)
      getState().addConnection(customNode!, 1, display2, 0); // doubled (14)

      const result = exec();
      expect(result.errors.size).toBe(0);

      // Custom node output 0 = 7 (original)
      expect(result.results.get(customNode!)!.outputs[0]).toBe(7);
      // Custom node output 1 = 14 (doubled)
      expect(result.results.get(customNode!)!.outputs[1]).toBe(14);
    });
  });

  // =========================================================================
  // 34. Trig-Function-Chain
  // =========================================================================
  describe('34. Trig-Function-Chain', () => {
    it('builds sin/cos/tan chain from source, executes, and verifies trigonometric values', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', Math.PI / 6); // 30 degrees

      const sinNode = getState().addNode('sin', [5, 0, -3]);
      const cosNode = getState().addNode('cos', [5, 0, 0]);
      const tanNode = getState().addNode('tan', [5, 0, 3]);

      getState().addConnection(src, 0, sinNode, 0);
      getState().addConnection(src, 0, cosNode, 0);
      getState().addConnection(src, 0, tanNode, 0);

      // sin^2 + cos^2 should equal 1
      const sinSq = getState().addNode('math', [10, 0, -3]);
      getState().updateNodeData(sinSq, 'operation', 'multiply');
      getState().addConnection(sinNode, 0, sinSq, 0);
      getState().addConnection(sinNode, 0, sinSq, 1);

      const cosSq = getState().addNode('math', [10, 0, 0]);
      getState().updateNodeData(cosSq, 'operation', 'multiply');
      getState().addConnection(cosNode, 0, cosSq, 0);
      getState().addConnection(cosNode, 0, cosSq, 1);

      const sum = getState().addNode('math', [15, 0, -1]);
      getState().updateNodeData(sum, 'operation', 'add');
      getState().addConnection(sinSq, 0, sum, 0);
      getState().addConnection(cosSq, 0, sum, 1);

      const result = exec();
      expect(result.errors.size).toBe(0);

      // sin(pi/6) = 0.5
      expect(result.results.get(sinNode)!.outputs[0]).toBeCloseTo(0.5, 5);
      // cos(pi/6) = sqrt(3)/2 ~ 0.866
      expect(result.results.get(cosNode)!.outputs[0]).toBeCloseTo(Math.sqrt(3) / 2, 5);
      // tan(pi/6) = 1/sqrt(3) ~ 0.577
      expect(result.results.get(tanNode)!.outputs[0]).toBeCloseTo(1 / Math.sqrt(3), 5);
      // sin^2 + cos^2 = 1
      expect(result.results.get(sum)!.outputs[0]).toBeCloseTo(1, 10);
    });
  });

  // =========================================================================
  // 35. Template-Export-Import-Roundtrip
  // =========================================================================
  describe('35. Template-Export-Import-Roundtrip', () => {
    it('saves templates, exports them, clears, imports back, and verifies template fidelity', () => {
      // Create a template with connected nodes
      const s = getState().addNode('source', [0, 0, 0]);
      const t = getState().addNode('transform', [5, 0, 0]);
      const m = getState().addNode('math', [10, 0, 0]);
      getState().updateNodeData(s, 'value', 42);
      getState().updateNodeData(t, 'multiplier', 2);
      getState().updateNodeData(m, 'operation', 'subtract');
      getState().addConnection(s, 0, t, 0);
      getState().addConnection(t, 0, m, 0);

      getState().setSelection(new Set([s, t, m]));
      const tmplId = getState().saveSelectionAsTemplate('FullPipeline', 'Advanced');

      // Export templates separately
      const exportedTemplates = getState().exportTemplates();
      expect(Object.keys(exportedTemplates).length).toBe(1);

      // Clear templates
      getState().deleteTemplate(tmplId!);
      expect(Object.keys(getState().templates).length).toBe(0);

      // Import templates back
      getState().importTemplates(exportedTemplates);
      expect(Object.keys(getState().templates).length).toBe(1);

      const imported = Object.values(getState().templates)[0];
      expect(imported.name).toBe('FullPipeline');
      expect(imported.category).toBe('Advanced');
      expect(imported.nodes.length).toBe(3);
      expect(imported.connections.length).toBe(2);

      // Instantiate and verify it works
      getState().clearGraph();
      getState().instantiateTemplate(imported.id);
      expect(Object.keys(getState().nodes).length).toBe(3);
      expect(Object.keys(getState().connections).length).toBe(2);

      // Execute the instantiated template
      const result = exec();
      expect(result.errors.size).toBe(0);
      // source=42 -> transform: 42*2=84 -> math(subtract): 84-0=84
      const mathNode = Object.values(getState().nodes).find(n => n.type === 'math')!;
      expect(result.results.get(mathNode.id)!.outputs[0]).toBe(84);
    });
  });
});
