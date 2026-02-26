/**
 * Slice Integration Tests
 *
 * Tests cross-slice interactions using the full Zustand store:
 * - Selection + Connection
 * - Template + Undo
 * - Checkpoint + Restore
 * - Custom Node + Connection
 * - Group + Layout
 * - Connection Drawing Workflow
 * - Multi-Graph Isolation
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, DEFAULT_SETTINGS } from '../store/settingsStore';

function resetStore() {
  _resetModuleState();
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    showValuePreviews: false,
    contextMenu: null,
    customNodeDefs: {},
    searchQuery: '',
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    executionMetrics: {},
    executionTotalDuration: 0,
    debugMode: false,
    pausedAtWave: -1,
    debugWaves: [],
    traceNodeId: null,
    errorStrategy: 'fail-fast',
    validationErrors: {},
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: 0 } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    templates: {},
    subgraphDefs: {},
    breadcrumbStack: [],
  });
  useSettingsStore.setState({ ...DEFAULT_SETTINGS });
}

function getState() {
  return useEditorStore.getState();
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Slice Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Selection + Connection Cross-Slice
  // ────────────────────────────────────────────────────────────────────

  describe('Selection + Connection Cross-Slice', () => {
    it('selectConnected upstream traverses through connections', () => {
      // Build chain: source -> transform -> output
      const src = getState().addNode('source', [0, 0, 0]);
      const tf = getState().addNode('transform', [3, 0, 0]);
      const out = getState().addNode('output', [6, 0, 0]);
      getState().addConnection(src, 0, tf, 0);
      getState().addConnection(tf, 0, out, 0);

      // Select output node, then select upstream
      getState().setSelection(new Set([out]));
      getState().selectConnected('upstream');

      const selected = getState().selectedIds;
      // All three nodes should be selected (output + upstream chain)
      expect(selected.has(out)).toBe(true);
      expect(selected.has(tf)).toBe(true);
      expect(selected.has(src)).toBe(true);
    });

    it('selectConnected downstream traverses through connections', () => {
      // Build chain: source -> transform -> output
      const src = getState().addNode('source', [0, 0, 0]);
      const tf = getState().addNode('transform', [3, 0, 0]);
      const out = getState().addNode('output', [6, 0, 0]);
      getState().addConnection(src, 0, tf, 0);
      getState().addConnection(tf, 0, out, 0);

      // Select source, then select downstream
      getState().setSelection(new Set([src]));
      getState().selectConnected('downstream');

      const selected = getState().selectedIds;
      expect(selected.has(src)).toBe(true);
      expect(selected.has(tf)).toBe(true);
      expect(selected.has(out)).toBe(true);
    });

    it('boxSelect then createGroup workflow', () => {
      // Place nodes at known positions
      const n1 = getState().addNode('source', [1, 0, 1]);
      const n2 = getState().addNode('transform', [2, 0, 2]);
      const n3 = getState().addNode('output', [10, 0, 10]); // outside box

      // Box select a region that includes n1 and n2 but not n3
      getState().boxSelect(0, 0, 5, 5, false);

      const selected = getState().selectedIds;
      expect(selected.has(n1)).toBe(true);
      expect(selected.has(n2)).toBe(true);
      expect(selected.has(n3)).toBe(false);

      // Create group from box-selected nodes
      const groupId = getState().createGroup('Box Group');
      expect(groupId).not.toBeNull();
      expect(getState().groups[groupId!].label).toBe('Box Group');

      // Verify nodes are assigned to the group
      expect(getState().nodes[n1].groupId).toBe(groupId);
      expect(getState().nodes[n2].groupId).toBe(groupId);
      expect(getState().nodes[n3].groupId).toBeUndefined();
    });

    it('toggleSelection maintains independence from hoveredConnectionId', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('output', [3, 0, 0]);
      const connId = getState().addConnection(n1, 0, n2, 0)!;

      // Set hovered connection
      getState().setHoveredConnection(connId);
      expect(getState().hoveredConnectionId).toBe(connId);

      // Toggle selection of a node -- should not affect hoveredConnectionId
      getState().toggleSelection(n1);
      expect(getState().selectedIds.has(n1)).toBe(true);
      expect(getState().hoveredConnectionId).toBe(connId);

      // Toggle again to deselect
      getState().toggleSelection(n1);
      expect(getState().selectedIds.has(n1)).toBe(false);
      // hoveredConnectionId still intact
      expect(getState().hoveredConnectionId).toBe(connId);
    });

    it('selectConnected with both on diamond graph', () => {
      // Diamond: src -> tfA -> math, src -> tfB -> math
      const src = getState().addNode('source', [0, 0, 0]);
      const tfA = getState().addNode('transform', [3, 0, -2]);
      const tfB = getState().addNode('transform', [3, 0, 2]);
      const math = getState().addNode('math', [6, 0, 0]);

      getState().addConnection(src, 0, tfA, 0);
      getState().addConnection(src, 0, tfB, 0);
      getState().addConnection(tfA, 0, math, 0);
      getState().addConnection(tfB, 0, math, 1);

      // Select tfA and extend in both directions
      getState().setSelection(new Set([tfA]));
      getState().selectConnected('both');

      const selected = getState().selectedIds;
      // Upstream: src
      expect(selected.has(src)).toBe(true);
      // Self
      expect(selected.has(tfA)).toBe(true);
      // Downstream: math
      expect(selected.has(math)).toBe(true);
      // tfB is reachable downstream from src through math's upstream path
      // Actually: tfA -> (upstream) -> src. src -> (downstream via tfB) -> math
      // Since we go upstream AND downstream from tfA, we reach src upstream.
      // From src downstream, we reach tfB. So tfB should also be selected.
      expect(selected.has(tfB)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Template + Undo Integration
  // ────────────────────────────────────────────────────────────────────

  describe('Template + Undo Integration', () => {
    it('save template, instantiate it, undo restores previous state', () => {
      // Create a small graph
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      getState().addConnection(src, 0, out, 0);

      // Save as template
      getState().setSelection(new Set([src, out]));
      const templateId = getState().saveSelectionAsTemplate('My Template');
      expect(templateId).not.toBeNull();

      // Record state before instantiation
      const nodeCountBefore = Object.keys(getState().nodes).length;

      // Instantiate template at a different position
      getState().instantiateTemplate(templateId!, [10, 0, 0]);

      // Should have new nodes (original 2 + instantiated 2 = 4)
      expect(Object.keys(getState().nodes).length).toBe(4);

      // Undo instantiation
      getState().undo();
      expect(Object.keys(getState().nodes).length).toBe(nodeCountBefore);
    });

    it('template preserves node data and connection metadata', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 42);
      const out = getState().addNode('output', [3, 0, 0]);
      const connId = getState().addConnection(src, 0, out, 0)!;
      getState().updateConnectionLabel(connId, 'data-pipe');
      getState().updateConnectionColor(connId, '#00FF00');

      // Save as template
      getState().setSelection(new Set([src, out]));
      const templateId = getState().saveSelectionAsTemplate('Data Template');
      expect(templateId).not.toBeNull();

      // Instantiate
      getState().instantiateTemplate(templateId!, [10, 0, 0]);

      // Find the newly created nodes and connection
      const allNodes = Object.values(getState().nodes);
      const newNodes = allNodes.filter(n => n.id !== src && n.id !== out);
      expect(newNodes.length).toBe(2);

      // Find the new source node and verify data
      const newSource = newNodes.find(n => n.type === 'source');
      expect(newSource).toBeDefined();
      expect(newSource!.data.value).toBe(42);

      // Find the new connection and verify metadata
      const allConns = Object.values(getState().connections);
      const newConns = allConns.filter(c => c.id !== connId);
      expect(newConns.length).toBeGreaterThanOrEqual(1);
      const labeled = newConns.find(c => c.label === 'data-pipe');
      expect(labeled).toBeDefined();
      expect(labeled!.colorOverride).toBe('#00FF00');
    });

    it('templates survive graph switching (templates are global)', () => {
      // Create template in default graph
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      getState().addConnection(src, 0, out, 0);
      getState().setSelection(new Set([src, out]));
      const templateId = getState().saveSelectionAsTemplate('Cross-Graph Template');
      expect(templateId).not.toBeNull();

      // Switch to new graph
      const graphB = getState().createGraph('Graph B');
      getState().switchGraph(graphB);

      // Template should still exist
      expect(getState().templates[templateId!]).toBeDefined();
      expect(getState().templates[templateId!].name).toBe('Cross-Graph Template');

      // Instantiate template in graph B
      getState().instantiateTemplate(templateId!, [0, 0, 0]);
      expect(Object.keys(getState().nodes).length).toBe(2);
    });

    it('import/export templates round-trip', () => {
      // Create two templates
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('output', [3, 0, 0]);
      getState().addConnection(n1, 0, n2, 0);
      getState().setSelection(new Set([n1, n2]));
      const t1 = getState().saveSelectionAsTemplate('Template A', 'Category1');

      const n3 = getState().addNode('transform', [6, 0, 0]);
      getState().setSelection(new Set([n3]));
      const t2 = getState().saveSelectionAsTemplate('Template B', 'Category2');

      // Export
      const exported = getState().exportTemplates();
      expect(Object.keys(exported).length).toBe(2);
      expect(exported[t1!].name).toBe('Template A');
      expect(exported[t2!].name).toBe('Template B');

      // Reset store and import
      resetStore();
      expect(Object.keys(getState().templates).length).toBe(0);

      getState().importTemplates(exported);
      expect(Object.keys(getState().templates).length).toBe(2);
      expect(getState().templates[t1!].name).toBe('Template A');
      expect(getState().templates[t1!].category).toBe('Category1');
      expect(getState().templates[t2!].name).toBe('Template B');
      expect(getState().templates[t2!].category).toBe('Category2');
    });

    it('delete template removes it permanently', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([n1]));
      const templateId = getState().saveSelectionAsTemplate('Temp');
      expect(templateId).not.toBeNull();
      expect(getState().templates[templateId!]).toBeDefined();

      getState().deleteTemplate(templateId!);
      expect(getState().templates[templateId!]).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Checkpoint + Restore Integration
  // ────────────────────────────────────────────────────────────────────

  describe('Checkpoint + Restore Integration', () => {
    it('create checkpoint, modify graph, restore checkpoint returns to previous state', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const tf = getState().addNode('transform', [3, 0, 0]);
      getState().addConnection(src, 0, tf, 0);

      // Create checkpoint with 2 nodes
      const cpId = getState().createCheckpoint('Before modification');
      expect(cpId).toBeDefined();

      // Modify: add a third node
      const out = getState().addNode('output', [6, 0, 0]);
      getState().addConnection(tf, 0, out, 0);
      expect(Object.keys(getState().nodes).length).toBe(3);
      expect(Object.keys(getState().connections).length).toBe(2);

      // Restore checkpoint
      getState().restoreCheckpoint(cpId);

      // Should be back to 2 nodes and 1 connection
      expect(Object.keys(getState().nodes).length).toBe(2);
      expect(Object.keys(getState().connections).length).toBe(1);
      expect(getState().nodes[src]).toBeDefined();
      expect(getState().nodes[tf]).toBeDefined();
    });

    it('checkpoint restore clears selection', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [3, 0, 0]);

      const cpId = getState().createCheckpoint('Selection test');

      // Select nodes
      getState().setSelection(new Set([n1, n2]));
      expect(getState().selectedIds.size).toBe(2);

      // Restore -- selection should be cleared
      getState().restoreCheckpoint(cpId);
      expect(getState().selectedIds.size).toBe(0);
    });

    it('checkpoint with connections -- restoring preserves connection topology', () => {
      // Build: source -> transform -> output
      const src = getState().addNode('source', [0, 0, 0]);
      const tf = getState().addNode('transform', [3, 0, 0]);
      const out = getState().addNode('output', [6, 0, 0]);
      const c1 = getState().addConnection(src, 0, tf, 0)!;
      const c2 = getState().addConnection(tf, 0, out, 0)!;

      // Checkpoint with full topology
      const cpId = getState().createCheckpoint('Full topology');

      // Destroy the graph
      getState().removeConnection(c1);
      getState().removeConnection(c2);
      getState().removeNode(out);
      expect(Object.keys(getState().nodes).length).toBe(2);
      expect(Object.keys(getState().connections).length).toBe(0);

      // Restore
      getState().restoreCheckpoint(cpId);
      expect(Object.keys(getState().nodes).length).toBe(3);
      expect(Object.keys(getState().connections).length).toBe(2);

      // Verify connection topology is correct
      const conns = Object.values(getState().connections);
      const srcToTf = conns.find(c => c.sourceNodeId === src && c.targetNodeId === tf);
      const tfToOut = conns.find(c => c.sourceNodeId === tf && c.targetNodeId === out);
      expect(srcToTf).toBeDefined();
      expect(tfToOut).toBeDefined();
    });

    it('multiple checkpoints -- can restore any checkpoint, not just latest', () => {
      // Checkpoint A: 1 node
      const n1 = getState().addNode('source', [0, 0, 0]);
      const cpA = getState().createCheckpoint('One node');

      // Checkpoint B: 2 nodes
      const n2 = getState().addNode('transform', [3, 0, 0]);
      const cpB = getState().createCheckpoint('Two nodes');

      // Add a third node
      getState().addNode('output', [6, 0, 0]);
      expect(Object.keys(getState().nodes).length).toBe(3);

      // Restore checkpoint A (1 node) -- not the latest
      getState().restoreCheckpoint(cpA);
      expect(Object.keys(getState().nodes).length).toBe(1);
      expect(getState().nodes[n1]).toBeDefined();

      // Now restore checkpoint B (2 nodes)
      getState().restoreCheckpoint(cpB);
      expect(Object.keys(getState().nodes).length).toBe(2);
      expect(getState().nodes[n1]).toBeDefined();
      expect(getState().nodes[n2]).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Custom Node + Connection Integration
  // ────────────────────────────────────────────────────────────────────

  describe('Custom Node + Connection Integration', () => {
    it('create custom node def, add custom node, connect compatible ports', () => {
      // Create a custom node definition with 1 input and 1 output
      const defId = getState().addCustomNodeDef({
        name: 'Doubler',
        color: '#FF0000',
        category: 'math',
        inputs: [{ label: 'value', portType: 'number' }],
        outputs: [{ label: 'result', portType: 'number' }],
        expression: 'in0 * 2',
      });
      expect(defId).toBeDefined();

      // Add a custom node from the definition
      const customId = getState().addCustomNode(defId, [3, 0, 0]);
      expect(customId).not.toBeNull();

      // Custom nodes need updateCustomNodePorts to have actual ports
      // (addCustomNode from def already sets ports from the def)
      const customNode = getState().nodes[customId!];
      expect(customNode.inputs.length).toBe(1);
      expect(customNode.outputs.length).toBe(1);

      // Connect source -> custom -> output
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [6, 0, 0]);

      const c1 = getState().addConnection(src, 0, customId!, 0);
      const c2 = getState().addConnection(customId!, 0, out, 0);
      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();

      expect(Object.keys(getState().connections).length).toBe(2);
    });

    it('update custom node ports -- out-of-range connections removed', () => {
      const defId = getState().addCustomNodeDef({
        name: 'Multi',
        color: '#00FF00',
        category: 'custom',
        inputs: [{ label: 'a', portType: 'any' }, { label: 'b', portType: 'any' }],
        outputs: [{ label: 'out', portType: 'any' }],
        expression: 'in0 + in1',
      });

      const customId = getState().addCustomNode(defId, [3, 0, 0]);
      expect(customId).not.toBeNull();

      // Connect to both inputs
      const src1 = getState().addNode('source', [0, 0, -2]);
      const src2 = getState().addNode('source', [0, 0, 2]);
      const c1 = getState().addConnection(src1, 0, customId!, 0);
      const c2 = getState().addConnection(src2, 0, customId!, 1);
      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();
      expect(Object.keys(getState().connections).length).toBe(2);

      // Reduce inputs to 1 -- connection on port index 1 should be removed
      getState().updateCustomNodePorts(customId!, 1, 1);

      const node = getState().nodes[customId!];
      expect(node.inputs.length).toBe(1);

      // Connection on port 0 should survive, port 1 should be gone
      const conns = Object.values(getState().connections);
      expect(conns.length).toBe(1);
      expect(conns[0].targetPortIndex).toBe(0);
    });

    it('updateCustomNodeDef propagates to all instances', () => {
      const defId = getState().addCustomNodeDef({
        name: 'MyNode',
        color: '#0000FF',
        category: 'custom',
        inputs: [{ label: 'x', portType: 'any' }],
        outputs: [{ label: 'y', portType: 'any' }],
        expression: 'in0',
      });

      // Create two instances
      const inst1 = getState().addCustomNode(defId, [0, 0, 0])!;
      const inst2 = getState().addCustomNode(defId, [3, 0, 0])!;

      expect(getState().nodes[inst1].title).toBe('MyNode');
      expect(getState().nodes[inst2].title).toBe('MyNode');

      // Update the definition name and expression
      getState().updateCustomNodeDef(defId, { name: 'RenamedNode', expression: 'in0 * 10' });

      // Both instances should be updated
      expect(getState().nodes[inst1].title).toBe('RenamedNode');
      expect(getState().nodes[inst2].title).toBe('RenamedNode');
      expect(getState().nodes[inst1].data.expression).toBe('in0 * 10');
      expect(getState().nodes[inst2].data.expression).toBe('in0 * 10');
    });

    it('custom node in template round-trip', () => {
      const defId = getState().addCustomNodeDef({
        name: 'Processor',
        color: '#ABCDEF',
        category: 'custom',
        inputs: [{ label: 'in', portType: 'any' }],
        outputs: [{ label: 'out', portType: 'any' }],
        expression: 'in0 + 1',
      });

      const customId = getState().addCustomNode(defId, [3, 0, 0])!;
      const src = getState().addNode('source', [0, 0, 0]);
      getState().addConnection(src, 0, customId, 0);

      // Save as template
      getState().setSelection(new Set([src, customId]));
      const templateId = getState().saveSelectionAsTemplate('Custom Template');
      expect(templateId).not.toBeNull();

      // Instantiate
      getState().instantiateTemplate(templateId!, [10, 0, 0]);

      // Should have 4 nodes total
      expect(Object.keys(getState().nodes).length).toBe(4);

      // Find the new custom node
      const allNodes = Object.values(getState().nodes);
      const customNodes = allNodes.filter(n => n.type === 'custom');
      expect(customNodes.length).toBe(2);

      // The instantiated custom node should have same data
      const newCustom = customNodes.find(n => n.id !== customId)!;
      expect(newCustom.data.expression).toBe('in0 + 1');
      expect(newCustom.data.customDefId).toBe(defId);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. Group + Layout Integration
  // ────────────────────────────────────────────────────────────────────

  describe('Group + Layout Integration', () => {
    it('select nodes, create group, rename group, undo removes group', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [3, 0, 0]);

      // Select and create group
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('Original Name');
      expect(groupId).not.toBeNull();
      expect(getState().groups[groupId!].label).toBe('Original Name');

      // Rename
      getState().renameGroup(groupId!, 'Renamed');
      expect(getState().groups[groupId!].label).toBe('Renamed');

      // Undo rename -> should go back to 'Original Name'
      getState().undo();
      expect(getState().groups[groupId!].label).toBe('Original Name');

      // Undo createGroup -> group should be gone
      getState().undo();
      expect(Object.keys(getState().groups).length).toBe(0);
      expect(getState().nodes[n1].groupId).toBeUndefined();
      expect(getState().nodes[n2].groupId).toBeUndefined();
    });

    it('locked nodes skipped by layout actions (alignSelected, distributeSelected)', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [3, 0, 3]);
      const n3 = getState().addNode('output', [6, 0, 6]);

      // Lock n2
      getState().toggleNodeLock(n2);
      expect(getState().nodes[n2].locked).toBe(true);

      // Record locked node's position
      const lockedPosBefore = [...getState().nodes[n2].position];

      // Select all and align on x-axis (left)
      getState().setSelection(new Set([n1, n2, n3]));
      getState().alignSelected('left');

      // Locked node should NOT have moved
      expect(getState().nodes[n2].position[0]).toBe(lockedPosBefore[0]);
      expect(getState().nodes[n2].position[2]).toBe(lockedPosBefore[2]);

      // Unlocked nodes should have been aligned
      // (they should have same x position = leftmost, which is 0)
      expect(getState().nodes[n1].position[0]).toBeCloseTo(0);
      expect(getState().nodes[n3].position[0]).toBeCloseTo(0);
    });

    it('group collapse is view-state (no undo entry)', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [3, 0, 0]);

      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('Test')!;

      // canUndo should be true (createGroup pushes undo)
      expect(getState().canUndo()).toBe(true);

      // Toggle collapse -- this is view-state, should NOT push undo
      getState().toggleGroupCollapse(groupId);
      expect(getState().groups[groupId].collapsed).toBe(true);

      // Undo should undo the createGroup, NOT the toggleGroupCollapse
      getState().undo();
      // After undoing createGroup, the group should be gone
      expect(Object.keys(getState().groups).length).toBe(0);
    });

    it('ungroup then re-group workflow', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('transform', [3, 0, 0]);
      const n3 = getState().addNode('output', [6, 0, 0]);

      // Group n1 and n2
      getState().setSelection(new Set([n1, n2]));
      const groupId1 = getState().createGroup('First Group')!;
      expect(getState().nodes[n1].groupId).toBe(groupId1);

      // Ungroup
      getState().ungroupNodes(groupId1);
      expect(Object.keys(getState().groups).length).toBe(0);
      expect(getState().nodes[n1].groupId).toBeUndefined();
      expect(getState().nodes[n2].groupId).toBeUndefined();

      // Re-group with different nodes (n2 and n3)
      getState().setSelection(new Set([n2, n3]));
      const groupId2 = getState().createGroup('Second Group')!;
      expect(groupId2).not.toBeNull();
      expect(getState().nodes[n2].groupId).toBe(groupId2);
      expect(getState().nodes[n3].groupId).toBe(groupId2);
      expect(getState().nodes[n1].groupId).toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Connection Drawing Workflow
  // ────────────────────────────────────────────────────────────────────

  describe('Connection Drawing Workflow', () => {
    it('startConnection -> completeConnection creates connection with undo', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);

      // Start drawing a connection
      getState().startConnection(src, 0);
      expect(getState().interaction).toBe('drawing-connection');
      expect(getState().pendingConnection).not.toBeNull();
      expect(getState().pendingConnection!.sourceNodeId).toBe(src);

      // Complete the connection
      getState().completeConnection(out, 0);
      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();
      expect(Object.keys(getState().connections).length).toBe(1);

      // completeConnection pushes undo, so we can undo the connection
      getState().undo();
      expect(Object.keys(getState().connections).length).toBe(0);
    });

    it('startConnection -> cancelConnection leaves no trace', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().addNode('output', [3, 0, 0]);

      const connCountBefore = Object.keys(getState().connections).length;

      // Start drawing
      getState().startConnection(src, 0);
      expect(getState().interaction).toBe('drawing-connection');

      // Cancel
      getState().cancelConnection();
      expect(getState().interaction).toBe('idle');
      expect(getState().pendingConnection).toBeNull();

      // No connection should have been created
      expect(Object.keys(getState().connections).length).toBe(connCountBefore);
    });

    it('disconnectAndReroute workflow', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      const connId = getState().addConnection(src, 0, out, 0)!;
      expect(connId).not.toBeNull();

      // Disconnect and reroute: removes the connection and starts a new drawing from source
      getState().disconnectAndReroute(connId);

      // Old connection should be gone
      expect(getState().connections[connId]).toBeUndefined();
      // Should be in drawing-connection mode starting from the source
      expect(getState().interaction).toBe('drawing-connection');
      expect(getState().pendingConnection!.sourceNodeId).toBe(src);
      expect(getState().pendingConnection!.sourcePortIndex).toBe(0);

      // Complete to a different target
      const out2 = getState().addNode('output', [6, 0, 0]);
      getState().completeConnection(out2, 0);

      expect(getState().interaction).toBe('idle');
      // Should have exactly 1 connection (the new one)
      const conns = Object.values(getState().connections);
      expect(conns.length).toBe(1);
      expect(conns[0].sourceNodeId).toBe(src);
      expect(conns[0].targetNodeId).toBe(out2);
    });

    it('completeConnection on already-connected input replaces old connection', () => {
      const src1 = getState().addNode('source', [0, 0, 0]);
      const src2 = getState().addNode('source', [0, 0, 3]);
      const tf = getState().addNode('transform', [3, 0, 0]);

      // Connect src1 to transform input 0 via drawing workflow
      getState().startConnection(src1, 0);
      getState().completeConnection(tf, 0);
      expect(Object.keys(getState().connections).length).toBe(1);

      // Now connect src2 to the same transform input 0 (should replace)
      getState().startConnection(src2, 0);
      getState().completeConnection(tf, 0);

      // Only 1 connection should exist (the new one from src2)
      const conns = Object.values(getState().connections);
      expect(conns.length).toBe(1);
      expect(conns[0].sourceNodeId).toBe(src2);
      expect(conns[0].targetNodeId).toBe(tf);
      expect(conns[0].targetPortIndex).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Multi-Graph Isolation
  // ────────────────────────────────────────────────────────────────────

  describe('Multi-Graph Isolation', () => {
    it('nodes in graph A do not appear in graph B', () => {
      // Add nodes to default graph
      const srcA = getState().addNode('source', [0, 0, 0]);
      const tfA = getState().addNode('transform', [3, 0, 0]);
      getState().addConnection(srcA, 0, tfA, 0);
      expect(Object.keys(getState().nodes).length).toBe(2);

      // Create and switch to graph B
      const graphB = getState().createGraph('Graph B');
      getState().switchGraph(graphB);

      // Graph B should have no nodes
      expect(Object.keys(getState().nodes).length).toBe(0);
      expect(Object.keys(getState().connections).length).toBe(0);

      // Add a node to graph B
      const srcB = getState().addNode('source', [0, 0, 0]);
      expect(Object.keys(getState().nodes).length).toBe(1);

      // Switch back to default graph
      getState().switchGraph('default');

      // Default graph should still have its 2 nodes
      expect(Object.keys(getState().nodes).length).toBe(2);
      expect(getState().nodes[srcA]).toBeDefined();
      expect(getState().nodes[tfA]).toBeDefined();

      // srcB should NOT be in the default graph
      expect(getState().nodes[srcB]).toBeUndefined();
    });

    it('templates are global across graphs', () => {
      // Create template in default graph
      const n1 = getState().addNode('source', [0, 0, 0]);
      getState().setSelection(new Set([n1]));
      const templateId = getState().saveSelectionAsTemplate('Global Template');
      expect(templateId).not.toBeNull();

      // Switch to graph B
      const graphB = getState().createGraph('Graph B');
      getState().switchGraph(graphB);

      // Template should be available
      expect(getState().templates[templateId!]).toBeDefined();

      // Instantiate in graph B
      getState().instantiateTemplate(templateId!, [5, 0, 0]);
      expect(Object.keys(getState().nodes).length).toBe(1);

      // Switch back to default -- template still there
      getState().switchGraph('default');
      expect(getState().templates[templateId!]).toBeDefined();
    });

    it('checkpoints are per-graph', () => {
      // Create checkpoint in default graph
      getState().addNode('source', [0, 0, 0]);
      const cpDefault = getState().createCheckpoint('Default checkpoint');

      // Switch to graph B
      const graphB = getState().createGraph('Graph B');
      getState().switchGraph(graphB);

      // Graph B should have no checkpoints
      expect(Object.keys(getState().checkpoints).length).toBe(0);

      // Create checkpoint in graph B
      getState().addNode('source', [0, 0, 0]);
      const cpB = getState().createCheckpoint('Graph B checkpoint');

      // Graph B has its own checkpoint
      expect(Object.keys(getState().checkpoints).length).toBe(1);
      expect(getState().checkpoints[cpB]).toBeDefined();

      // Switch back to default graph
      getState().switchGraph('default');

      // Default graph should have its own checkpoint
      expect(getState().checkpoints[cpDefault]).toBeDefined();
      // Graph B's checkpoint should NOT be here
      expect(getState().checkpoints[cpB]).toBeUndefined();
    });
  });
});
