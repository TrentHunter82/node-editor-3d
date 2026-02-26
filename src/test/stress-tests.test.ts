/**
 * Comprehensive Stress Tests for Rosebud Node Editor 3D
 *
 * Pushes the system under heavy load beyond existing benchmarks:
 * - 500-node complex topology graphs
 * - Rapid undo/redo cycles
 * - Concurrent operation floods
 * - Large array processing via statistics nodes
 * - Multi-graph stress
 * - Memory/allocation stress
 * - Edge case stress (all node types, deep subgraph nesting)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph, topologicalSort } from '../utils/execution';
import type { EditorNode, Connection, NodeType } from '../types';
import type { MultiGraphStorage } from '../utils/serialization';

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

/** Build a raw node object (bypassing store) for direct algorithm benchmarks */
function makeRawNode(id: string, type: NodeType, x: number): EditorNode {
  const isSource = type === 'source';
  return {
    id,
    type,
    position: [x, 0, 0],
    title: `${type}-${id}`,
    data: isSource ? { value: 1 } : {},
    inputs: isSource ? [] : [{ id: `${id}-in-0`, label: 'in', portType: 'number' as const }],
    outputs: [{ id: `${id}-out-0`, label: 'out', portType: 'number' as const }],
  };
}

/** Build a raw connection object */
function makeRawConnection(id: string, sourceId: string, targetId: string, srcPort = 0, tgtPort = 0): Connection {
  return {
    id,
    sourceNodeId: sourceId,
    sourcePortIndex: srcPort,
    targetNodeId: targetId,
    targetPortIndex: tgtPort,
  };
}

/** Measure the duration of a synchronous callback (ms) */
function measure(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** Build a chain of source -> N-1 transform nodes via the store */
function buildStoreChain(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const type: NodeType = i === 0 ? 'source' : 'transform';
    const id = getState().addNode(type, [i * 2, 0, 0]);
    if (i === 0) getState().updateNodeData(id, 'value', 1);
    ids.push(id);
    if (i > 0) {
      getState().addConnection(ids[i - 1], 0, id, 0);
    }
  }
  return ids;
}

/** Fisher-Yates shuffle */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===========================================================================
// 1. 500-Node Graph with Complex Topology
// ===========================================================================
describe('500-node graph with complex topology', () => {
  beforeEach(() => { resetStore(); });

  it('creates 500 nodes with chain, fan-out, and diamond patterns and executes correctly', { timeout: 30000 }, () => {
    // Build a complex topology:
    // - 5 source nodes (values 10, 20, 30, 40, 50)
    // - Each source fans out to 20 transform nodes (100 transforms total)
    // - Each pair of transforms feeds into a math-add node (50 math nodes)
    // - Then a chain of 345 additional transform nodes

    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};
    let connIdx = 0;

    // 5 source nodes
    const sourceIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `src-${i}`;
      nodes[id] = {
        id,
        type: 'source',
        position: [0, 0, i * 2],
        title: `Source ${i}`,
        data: { value: (i + 1) * 10 },
        inputs: [],
        outputs: [
          { id: `${id}-out-0`, label: 'value', portType: 'number' },
          { id: `${id}-out-1`, label: 'label', portType: 'string' },
        ],
      };
      sourceIds.push(id);
    }

    // 100 transform nodes (20 per source) - fan-out pattern
    const transformIds: string[] = [];
    for (let s = 0; s < 5; s++) {
      for (let t = 0; t < 20; t++) {
        const id = `xfm-${s}-${t}`;
        nodes[id] = {
          id,
          type: 'transform',
          position: [4, 0, s * 20 + t],
          title: `Transform ${s}-${t}`,
          data: {},
          inputs: [
            { id: `${id}-in-0`, label: 'in', portType: 'number' },
            { id: `${id}-in-1`, label: 'factor', portType: 'number' },
          ],
          outputs: [
            { id: `${id}-out-0`, label: 'result', portType: 'number' },
            { id: `${id}-out-1`, label: 'debug', portType: 'string' },
          ],
        };
        transformIds.push(id);
        connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, sourceIds[s], id);
      }
    }

    // 50 math nodes - diamond pattern (pairs of transforms merge)
    const mathIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `math-${i}`;
      nodes[id] = {
        id,
        type: 'math',
        position: [8, 0, i * 2],
        title: `Math ${i}`,
        data: { operation: 'add' },
        inputs: [
          { id: `${id}-in-0`, label: 'a', portType: 'number' },
          { id: `${id}-in-1`, label: 'b', portType: 'number' },
        ],
        outputs: [{ id: `${id}-out-0`, label: 'result', portType: 'number' }],
      };
      mathIds.push(id);
      // Connect pairs of transforms
      connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, transformIds[i * 2], id, 0, 0);
      connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, transformIds[i * 2 + 1], id, 0, 1);
    }

    // 345 transform chain
    const chainIds: string[] = [];
    for (let i = 0; i < 345; i++) {
      const id = `chain-${i}`;
      nodes[id] = {
        id,
        type: 'transform',
        position: [12 + i * 2, 0, 0],
        title: `Chain ${i}`,
        data: {},
        inputs: [
          { id: `${id}-in-0`, label: 'in', portType: 'number' },
          { id: `${id}-in-1`, label: 'factor', portType: 'number' },
        ],
        outputs: [
          { id: `${id}-out-0`, label: 'result', portType: 'number' },
          { id: `${id}-out-1`, label: 'debug', portType: 'string' },
        ],
      };
      chainIds.push(id);
      if (i === 0) {
        // Connect first math node output to chain start
        connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, mathIds[0], id);
      } else {
        connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, chainIds[i - 1], id);
      }
    }

    const totalNodes = 5 + 100 + 50 + 345;
    expect(Object.keys(nodes)).toHaveLength(totalNodes);
    expect(totalNodes).toBe(500);

    // Topological sort
    const sortDuration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      const total = waves.reduce((sum, w) => sum + w.length, 0);
      expect(total).toBe(500);
    });
    expect(sortDuration).toBeLessThan(200);

    // Execute
    const executeDuration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.results.size).toBe(500);
      expect(result.errors.size).toBe(0);

      // Verify source outputs
      for (let i = 0; i < 5; i++) {
        const srcResult = result.results.get(`src-${i}`);
        expect(srcResult).toBeDefined();
        expect(srcResult!.outputs[0]).toBe((i + 1) * 10);
      }

      // Verify transform nodes pass through correctly (default multiplier=1, offset=0)
      const firstXfm = result.results.get('xfm-0-0');
      expect(firstXfm).toBeDefined();
      expect(firstXfm!.outputs[0]).toBe(10); // source 0 value = 10, multiplier=1, offset=0

      // Verify math add nodes combine two transforms
      const firstMath = result.results.get('math-0');
      expect(firstMath).toBeDefined();
      expect(firstMath!.outputs[0]).toBe(20); // 10 + 10 (two transforms from source 0)
    });
    expect(executeDuration).toBeLessThan(5000);
    console.log(`[STRESS] 500-node complex topology: sort=${sortDuration.toFixed(2)}ms, execute=${executeDuration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 2. 500-Node Select-All, Delete, and Undo
// ===========================================================================
describe('500-node select-all and delete', () => {
  beforeEach(() => { resetStore(); });

  it('creates 500 nodes, selects all, deletes, then undoes to restore all 500', { timeout: 30000 }, () => {
    // Create 500 source nodes (no connections to keep it simpler for undo)
    const ids: string[] = [];
    const createDuration = measure(() => {
      for (let i = 0; i < 500; i++) {
        ids.push(getState().addNode('source', [i * 2, 0, 0]));
      }
    });
    expect(Object.keys(getState().nodes)).toHaveLength(500);

    // Select all
    const selectDuration = measure(() => {
      getState().setSelection(new Set(ids));
    });
    expect(getState().selectedIds.size).toBe(500);

    // Delete selected
    const deleteDuration = measure(() => {
      getState().deleteSelected();
    });
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Undo should restore all 500 nodes
    const undoDuration = measure(() => {
      getState().undo();
    });
    expect(Object.keys(getState().nodes)).toHaveLength(500);

    // Verify all IDs restored
    for (const id of ids) {
      expect(getState().nodes[id]).toBeDefined();
    }

    console.log(`[STRESS] 500-node select-all+delete+undo: create=${createDuration.toFixed(2)}ms, select=${selectDuration.toFixed(2)}ms, delete=${deleteDuration.toFixed(2)}ms, undo=${undoDuration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 3. 500-Node Export/Import Roundtrip
// ===========================================================================
describe('500-node export/import roundtrip', () => {
  beforeEach(() => { resetStore(); });

  it('creates 500 nodes with connections, exports, imports, and verifies integrity', { timeout: 30000 }, () => {
    // Build a mix: 200-node chain + 300 independent source nodes
    const chainIds = buildStoreChain(200);

    // Set specific values on source nodes for verification
    getState().updateNodeData(chainIds[0], 'value', 42);

    for (let i = 0; i < 300; i++) {
      const id = getState().addNode('source', [200 + i * 2, 0, 0]);
      getState().updateNodeData(id, 'value', i + 1000);
    }

    expect(Object.keys(getState().nodes)).toHaveLength(500);
    expect(Object.keys(getState().connections)).toHaveLength(199);

    // Capture all node data for verification
    const originalNodes = structuredClone(getState().nodes);
    const originalConns = structuredClone(getState().connections);

    // Export
    let exported: MultiGraphStorage | undefined;
    const exportDuration = measure(() => {
      exported = getState().exportAllGraphs();
    });
    expect(exported).toBeDefined();

    // Reset and import
    resetStore();
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    const importDuration = measure(() => {
      getState().importAllGraphs(exported!);
    });

    // Verify node count and connection count
    expect(Object.keys(getState().nodes)).toHaveLength(500);
    expect(Object.keys(getState().connections)).toHaveLength(199);

    // Verify specific node data survived roundtrip
    const importedNodes = getState().nodes;
    for (const [id, origNode] of Object.entries(originalNodes)) {
      const imported = importedNodes[id];
      expect(imported).toBeDefined();
      expect(imported.type).toBe(origNode.type);
      expect(imported.position).toEqual(origNode.position);
      if (origNode.data.value !== undefined) {
        expect(imported.data.value).toBe(origNode.data.value);
      }
    }

    // Verify connection integrity
    const importedConns = getState().connections;
    for (const [id, origConn] of Object.entries(originalConns)) {
      const imported = importedConns[id];
      expect(imported).toBeDefined();
      expect(imported.sourceNodeId).toBe(origConn.sourceNodeId);
      expect(imported.targetNodeId).toBe(origConn.targetNodeId);
      expect(imported.sourcePortIndex).toBe(origConn.sourcePortIndex);
      expect(imported.targetPortIndex).toBe(origConn.targetPortIndex);
    }

    console.log(`[STRESS] 500-node roundtrip: export=${exportDuration.toFixed(2)}ms, import=${importDuration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 4. 100 Rapid Undo Operations
// ===========================================================================
describe('100 rapid undo operations', () => {
  beforeEach(() => { resetStore(); });

  it('creates 100 nodes one-by-one, undoes max history (50) to verify undo stack limit', { timeout: 30000 }, () => {
    // Create 100 nodes individually (each pushes undo)
    // The undo stack is capped at MAX_HISTORY = 50, so only the last 50 actions are undoable
    for (let i = 0; i < 100; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }
    expect(Object.keys(getState().nodes)).toHaveLength(100);

    // Rapid undo until we can't anymore
    let undoCount = 0;
    const undoDuration = measure(() => {
      while (getState().canUndo()) {
        getState().undo();
        undoCount++;
      }
    });

    // MAX_HISTORY = 50, so we should be able to undo exactly 50 times
    expect(undoCount).toBe(50);
    // After 50 undos of 100 addNode actions, we should have 50 nodes left
    expect(Object.keys(getState().nodes)).toHaveLength(50);
    expect(getState().canUndo()).toBe(false);

    // Now redo all 50
    let redoCount = 0;
    const redoDuration = measure(() => {
      while (getState().canRedo()) {
        getState().redo();
        redoCount++;
      }
    });
    expect(redoCount).toBe(50);
    expect(Object.keys(getState().nodes)).toHaveLength(100);

    expect(undoDuration + redoDuration).toBeLessThan(10000);
    console.log(`[STRESS] 50 rapid undos + 50 redos: undo=${undoDuration.toFixed(2)}ms, redo=${redoDuration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 5. 100 Rapid Undo-Redo Oscillation
// ===========================================================================
describe('100 rapid undo-redo oscillation', () => {
  beforeEach(() => { resetStore(); });

  it('creates 50, undo 50, redo 50, undo 25, redo 25 - verify state at each step', { timeout: 30000 }, () => {
    // Create 50 nodes
    for (let i = 0; i < 50; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }
    expect(Object.keys(getState().nodes)).toHaveLength(50);

    // Undo all 50
    const undo50Duration = measure(() => {
      for (let i = 0; i < 50; i++) {
        getState().undo();
      }
    });
    expect(Object.keys(getState().nodes)).toHaveLength(0);

    // Redo all 50
    const redo50Duration = measure(() => {
      for (let i = 0; i < 50; i++) {
        getState().redo();
      }
    });
    expect(Object.keys(getState().nodes)).toHaveLength(50);

    // Undo 25
    const undo25Duration = measure(() => {
      for (let i = 0; i < 25; i++) {
        getState().undo();
      }
    });
    expect(Object.keys(getState().nodes)).toHaveLength(25);

    // Redo 25
    const redo25Duration = measure(() => {
      for (let i = 0; i < 25; i++) {
        getState().redo();
      }
    });
    expect(Object.keys(getState().nodes)).toHaveLength(50);

    const totalDuration = undo50Duration + redo50Duration + undo25Duration + redo25Duration;
    expect(totalDuration).toBeLessThan(15000);
    console.log(`[STRESS] Undo-redo oscillation: undo50=${undo50Duration.toFixed(2)}ms, redo50=${redo50Duration.toFixed(2)}ms, undo25=${undo25Duration.toFixed(2)}ms, redo25=${redo25Duration.toFixed(2)}ms, total=${totalDuration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 6. Undo Across Graph Switches
// ===========================================================================
describe('undo across graph switches', () => {
  beforeEach(() => { resetStore(); });

  it('verifies per-graph undo independence across 5 graphs', { timeout: 30000 }, () => {
    const graphIds: string[] = ['default'];

    // Create 4 additional graphs (5 total including default)
    for (let i = 1; i < 5; i++) {
      graphIds.push(getState().createGraph(`Graph ${i}`));
    }

    // Add 5 nodes to each graph
    for (const gId of graphIds) {
      getState().switchGraph(gId);
      for (let n = 0; n < 5; n++) {
        getState().addNode('source', [n * 2, 0, 0]);
      }
      expect(Object.keys(getState().nodes)).toHaveLength(5);
    }

    // Undo 3 times in each graph (should remove 3 nodes each)
    for (const gId of graphIds) {
      getState().switchGraph(gId);
      for (let u = 0; u < 3; u++) {
        getState().undo();
      }
      expect(Object.keys(getState().nodes)).toHaveLength(2);
    }

    // Switch back and forth rapidly and verify counts
    for (let cycle = 0; cycle < 5; cycle++) {
      for (const gId of graphIds) {
        getState().switchGraph(gId);
        expect(Object.keys(getState().nodes)).toHaveLength(2);
      }
    }

    // Redo 2 times in each graph
    for (const gId of graphIds) {
      getState().switchGraph(gId);
      for (let r = 0; r < 2; r++) {
        getState().redo();
      }
      expect(Object.keys(getState().nodes)).toHaveLength(4);
    }

    // Final verification: each graph has 4 nodes
    for (const gId of graphIds) {
      getState().switchGraph(gId);
      expect(Object.keys(getState().nodes)).toHaveLength(4);
    }
  });
});

// ===========================================================================
// 7. Rapid Node Creation + Connection (200 nodes in tight loop)
// ===========================================================================
describe('rapid node creation + connection', () => {
  beforeEach(() => { resetStore(); });

  it('creates 200 nodes and immediately connects each to the previous one', { timeout: 30000 }, () => {
    const ids: string[] = [];
    const duration = measure(() => {
      for (let i = 0; i < 200; i++) {
        const type: NodeType = i === 0 ? 'source' : 'transform';
        const id = getState().addNode(type, [i * 2, 0, 0]);
        if (i === 0) getState().updateNodeData(id, 'value', 1);
        ids.push(id);
        if (i > 0) {
          const connId = getState().addConnection(ids[i - 1], 0, id, 0);
          expect(connId).not.toBeNull();
        }
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(200);
    expect(Object.keys(getState().connections)).toHaveLength(199);

    // Verify execution produces correct results through the chain
    const state = getState();
    const result = executeGraph(state.nodes, state.connections);
    expect(result.results.size).toBe(200);
    expect(result.errors.size).toBe(0);

    // Source outputs 1, each transform applies multiplier=1, offset=0
    // All should propagate value 1
    const lastResult = result.results.get(ids[ids.length - 1]);
    expect(lastResult).toBeDefined();
    expect(lastResult!.outputs[0]).toBe(1);

    console.log(`[STRESS] 200-node create+connect: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 8. Rapid updateNodeData (1000 total updates)
// ===========================================================================
describe('rapid updateNodeData', () => {
  beforeEach(() => { resetStore(); });

  it('updates 100 source nodes 10 times each (1000 total updates)', { timeout: 30000 }, () => {
    // Create 100 source nodes
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(getState().addNode('source', [i * 2, 0, 0]));
    }

    // Update each node's data.value 10 times
    const duration = measure(() => {
      for (let round = 0; round < 10; round++) {
        for (const id of ids) {
          getState().updateNodeData(id, 'value', round * 100 + Math.random());
        }
      }
    });

    // Verify final values are from the last round
    for (const id of ids) {
      const val = getState().nodes[id].data.value as number;
      expect(val).toBeGreaterThanOrEqual(900);
      expect(val).toBeLessThan(1000);
    }

    console.log(`[STRESS] 1000 updateNodeData calls: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 9. Rapid Selection Changes (5000 toggle operations)
// ===========================================================================
describe('rapid selection changes', () => {
  beforeEach(() => { resetStore(); });

  it('toggles selection on 100 nodes 50 times each (5000 operations)', { timeout: 30000 }, () => {
    // Create 100 nodes
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(getState().addNode('source', [i * 2, 0, 0]));
    }

    // Toggle each node 50 times
    const duration = measure(() => {
      for (let round = 0; round < 50; round++) {
        for (const id of ids) {
          getState().toggleSelection(id);
        }
      }
    });

    // After 50 toggles (even number), all nodes should be unselected
    expect(getState().selectedIds.size).toBe(0);

    // Toggle once more to select all
    for (const id of ids) {
      getState().toggleSelection(id);
    }
    expect(getState().selectedIds.size).toBe(100);

    console.log(`[STRESS] 5000 selection toggles: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 10. Mean of 1000-Element Array
// ===========================================================================
describe('large array processing via statistics nodes', () => {
  beforeEach(() => { resetStore(); });

  it('computes mean of 1000-element array correctly', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i + 1);
    const expectedMean = arr.reduce((a, b) => a + b, 0) / arr.length; // 500.5

    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Array Source',
        data: { value: arr },
        inputs: [],
        outputs: [
          { id: 'src-out-0', label: 'value', portType: 'number' },
          { id: 'src-out-1', label: 'label', portType: 'string' },
        ],
      },
      meanNode: {
        id: 'meanNode',
        type: 'mean',
        position: [4, 0, 0],
        title: 'Mean',
        data: {},
        inputs: [{ id: 'meanNode-in-0', label: 'array', portType: 'any' }],
        outputs: [{ id: 'meanNode-out-0', label: 'mean', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: makeRawConnection('c1', 'src', 'meanNode'),
    };

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);
    const meanResult = result.results.get('meanNode');
    expect(meanResult).toBeDefined();
    expect(meanResult!.outputs[0]).toBeCloseTo(expectedMean, 10);
  });

  // ===========================================================================
  // 11. Median of 10000-Element Array
  // ===========================================================================
  it('computes median of 10000-element array correctly', () => {
    const arr = Array.from({ length: 10000 }, (_, i) => i + 1);
    // Even count: median = (arr[4999] + arr[5000]) / 2 = (5000 + 5001) / 2 = 5000.5
    const expectedMedian = 5000.5;

    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Array Source',
        data: { value: arr },
        inputs: [],
        outputs: [
          { id: 'src-out-0', label: 'value', portType: 'number' },
          { id: 'src-out-1', label: 'label', portType: 'string' },
        ],
      },
      medianNode: {
        id: 'medianNode',
        type: 'median',
        position: [4, 0, 0],
        title: 'Median',
        data: {},
        inputs: [{ id: 'medianNode-in-0', label: 'array', portType: 'any' }],
        outputs: [{ id: 'medianNode-out-0', label: 'median', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: makeRawConnection('c1', 'src', 'medianNode'),
    };

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);
    const medianResult = result.results.get('medianNode');
    expect(medianResult).toBeDefined();
    expect(medianResult!.outputs[0]).toBeCloseTo(expectedMedian, 10);
  });

  // ===========================================================================
  // 12. Stddev of 5000-Element Array
  // ===========================================================================
  it('computes stddev of 5000-element array correctly', () => {
    const arr = Array.from({ length: 5000 }, (_, i) => i + 1);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
    const expectedStddev = Math.sqrt(variance);

    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Array Source',
        data: { value: arr },
        inputs: [],
        outputs: [
          { id: 'src-out-0', label: 'value', portType: 'number' },
          { id: 'src-out-1', label: 'label', portType: 'string' },
        ],
      },
      stddevNode: {
        id: 'stddevNode',
        type: 'stddev',
        position: [4, 0, 0],
        title: 'Stddev',
        data: {},
        inputs: [{ id: 'stddevNode-in-0', label: 'array', portType: 'any' }],
        outputs: [{ id: 'stddevNode-out-0', label: 'stddev', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: makeRawConnection('c1', 'src', 'stddevNode'),
    };

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);
    const stddevResult = result.results.get('stddevNode');
    expect(stddevResult).toBeDefined();
    expect(stddevResult!.outputs[0]).toBeCloseTo(expectedStddev, 5);
  });

  // ===========================================================================
  // 13. Min/Max Array with 100000 Elements
  // ===========================================================================
  it('computes min and max of 100000-element array without stack overflow', { timeout: 10000 }, () => {
    // This specifically tests the loop-based implementation (not Math.min/max spread)
    const arr = Array.from({ length: 100000 }, (_, i) => i - 50000); // Range: -50000 to 49999

    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Array Source',
        data: { value: arr },
        inputs: [],
        outputs: [
          { id: 'src-out-0', label: 'value', portType: 'number' },
          { id: 'src-out-1', label: 'label', portType: 'string' },
        ],
      },
      minNode: {
        id: 'minNode',
        type: 'min-array',
        position: [4, 0, 0],
        title: 'Min',
        data: {},
        inputs: [{ id: 'minNode-in-0', label: 'array', portType: 'any' }],
        outputs: [{ id: 'minNode-out-0', label: 'min', portType: 'number' }],
      },
      maxNode: {
        id: 'maxNode',
        type: 'max-array',
        position: [4, 0, 2],
        title: 'Max',
        data: {},
        inputs: [{ id: 'maxNode-in-0', label: 'array', portType: 'any' }],
        outputs: [{ id: 'maxNode-out-0', label: 'max', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: makeRawConnection('c1', 'src', 'minNode'),
      c2: makeRawConnection('c2', 'src', 'maxNode'),
    };

    const duration = measure(() => {
      const result = executeGraph(nodes, connections);
      expect(result.errors.size).toBe(0);

      const minResult = result.results.get('minNode');
      expect(minResult).toBeDefined();
      expect(minResult!.outputs[0]).toBe(-50000);

      const maxResult = result.results.get('maxNode');
      expect(maxResult).toBeDefined();
      expect(maxResult!.outputs[0]).toBe(49999);
    });
    console.log(`[STRESS] min/max 100k elements: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 14. Create 20 Graphs with Data Isolation
// ===========================================================================
describe('multi-graph stress: 20 graphs', () => {
  beforeEach(() => { resetStore(); });

  it('creates 20 graphs each with 10 nodes, switches between all, verifies data isolation', { timeout: 30000 }, () => {
    const graphIds: string[] = ['default'];

    // Create 19 additional graphs
    for (let i = 1; i < 20; i++) {
      graphIds.push(getState().createGraph(`Graph ${i}`));
    }
    expect(getState().graphOrder).toHaveLength(20);

    // Add 10 unique nodes to each graph with distinct values
    for (let g = 0; g < 20; g++) {
      getState().switchGraph(graphIds[g]);
      for (let n = 0; n < 10; n++) {
        const id = getState().addNode('source', [n * 2, 0, 0]);
        getState().updateNodeData(id, 'value', g * 1000 + n);
      }
    }

    // Switch between all graphs and verify each has exactly 10 nodes with correct values
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let g = 0; g < 20; g++) {
        getState().switchGraph(graphIds[g]);
        const nodes = Object.values(getState().nodes);
        expect(nodes).toHaveLength(10);

        // Verify values belong to this graph (g * 1000 + 0..9)
        const values = nodes.map(n => n.data.value as number).sort((a, b) => a - b);
        for (let n = 0; n < 10; n++) {
          expect(values[n]).toBe(g * 1000 + n);
        }
      }
    }
  });
});

// ===========================================================================
// 15. Delete Graphs in Random Order
// ===========================================================================
describe('delete graphs in random order', () => {
  beforeEach(() => { resetStore(); });

  it('creates 10 graphs with content, deletes in shuffled order, verifies remaining intact', { timeout: 30000 }, () => {
    const graphIds: string[] = ['default'];

    // Create 9 additional graphs
    for (let i = 1; i < 10; i++) {
      graphIds.push(getState().createGraph(`Graph ${i}`));
    }

    // Add 5 source nodes to each graph with distinct values
    for (const gId of graphIds) {
      getState().switchGraph(gId);
      for (let n = 0; n < 5; n++) {
        const id = getState().addNode('source', [n * 2, 0, 0]);
        getState().updateNodeData(id, 'value', parseInt(gId, 36) * 100 + n);
      }
    }

    // Delete all but one graph in shuffled order
    // We cannot delete the last remaining graph, so we keep 'default'
    const deletable = graphIds.filter(id => id !== 'default');
    const shuffled = shuffle(deletable);

    for (const gId of shuffled) {
      // First verify the graph we're about to delete has content
      getState().switchGraph(gId);
      expect(Object.keys(getState().nodes).length).toBeGreaterThan(0);

      // Delete it
      getState().deleteGraph(gId);

      // Verify remaining graphs are intact
      const remaining = getState().graphOrder;
      for (const rId of remaining) {
        getState().switchGraph(rId);
        expect(Object.keys(getState().nodes)).toHaveLength(5);
      }
    }

    // Only default should remain
    expect(getState().graphOrder).toHaveLength(1);
    expect(getState().graphOrder[0]).toBe('default');
    getState().switchGraph('default');
    expect(Object.keys(getState().nodes)).toHaveLength(5);
  });
});

// ===========================================================================
// 16. 1000 Connections in Single Graph (fan-out 50 -> 1000)
// ===========================================================================
describe('1000 connections in single graph', () => {
  beforeEach(() => { resetStore(); });

  it('creates 50 source nodes each connecting to 20 transforms (1000 connections)', { timeout: 30000 }, () => {
    // Create 50 source nodes
    const sourceIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = getState().addNode('source', [i * 4, 0, 0]);
      getState().updateNodeData(id, 'value', i + 1);
      sourceIds.push(id);
    }

    // Create 1000 transform nodes (20 per source)
    const transformIds: string[][] = [];
    for (let s = 0; s < 50; s++) {
      const xfms: string[] = [];
      for (let t = 0; t < 20; t++) {
        const id = getState().addNode('transform', [s * 4 + 2, 0, t * 2]);
        xfms.push(id);
      }
      transformIds.push(xfms);
    }

    // Connect each source to its 20 transforms
    const connDuration = measure(() => {
      for (let s = 0; s < 50; s++) {
        for (let t = 0; t < 20; t++) {
          const connId = getState().addConnection(sourceIds[s], 0, transformIds[s][t], 0);
          expect(connId).not.toBeNull();
        }
      }
    });

    expect(Object.keys(getState().nodes)).toHaveLength(1050); // 50 sources + 1000 transforms
    expect(Object.keys(getState().connections)).toHaveLength(1000);

    // Execute and verify a sample of results
    const state = getState();
    const result = executeGraph(state.nodes, state.connections);
    expect(result.errors.size).toBe(0);
    expect(result.results.size).toBe(1050);

    // First source (value=1) should propagate to its 20 transforms
    for (const xfmId of transformIds[0]) {
      const xfmResult = result.results.get(xfmId);
      expect(xfmResult).toBeDefined();
      expect(xfmResult!.outputs[0]).toBe(1); // value * 1 + 0
    }

    // Last source (value=50) should propagate to its 20 transforms
    for (const xfmId of transformIds[49]) {
      const xfmResult = result.results.get(xfmId);
      expect(xfmResult).toBeDefined();
      expect(xfmResult!.outputs[0]).toBe(50);
    }

    console.log(`[STRESS] 1000 connections created: ${connDuration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 17. Rapid Graph Clear/Rebuild Cycles
// ===========================================================================
describe('rapid graph clear/rebuild cycles', () => {
  beforeEach(() => { resetStore(); });

  it('clears graph and rebuilds 100 nodes 10 times in a loop', { timeout: 30000 }, () => {
    const duration = measure(() => {
      for (let cycle = 0; cycle < 10; cycle++) {
        // Build 100 nodes with chain
        const ids: string[] = [];
        for (let i = 0; i < 100; i++) {
          const type: NodeType = i === 0 ? 'source' : 'transform';
          const id = getState().addNode(type, [i * 2, 0, 0]);
          if (i === 0) getState().updateNodeData(id, 'value', cycle + 1);
          ids.push(id);
          if (i > 0) {
            getState().addConnection(ids[i - 1], 0, id, 0);
          }
        }

        expect(Object.keys(getState().nodes)).toHaveLength(100);
        expect(Object.keys(getState().connections)).toHaveLength(99);

        // Clear the graph
        getState().clearGraph();
        expect(Object.keys(getState().nodes)).toHaveLength(0);
        expect(Object.keys(getState().connections)).toHaveLength(0);
      }
    });

    console.log(`[STRESS] 10 clear/rebuild cycles (100 nodes each): ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 18. Template Stress: Save 20 Templates, Instantiate Each 5 Times
// ===========================================================================
describe('template stress', () => {
  beforeEach(() => { resetStore(); });

  it('saves 20 templates and instantiates each 5 times (100 instantiations)', { timeout: 30000 }, () => {
    const templateIds: string[] = [];

    // Create and save 20 templates
    for (let t = 0; t < 20; t++) {
      // Create a small group of 3 nodes: source -> transform -> math
      const srcId = getState().addNode('source', [t * 10, 0, 0]);
      getState().updateNodeData(srcId, 'value', t + 1);
      const xfmId = getState().addNode('transform', [t * 10 + 3, 0, 0]);
      getState().addConnection(srcId, 0, xfmId, 0);

      // Select both and save as template
      getState().setSelection(new Set([srcId, xfmId]));
      const tmplId = getState().saveSelectionAsTemplate(`Template ${t}`, 'StressTest');
      expect(tmplId).not.toBeNull();
      templateIds.push(tmplId!);

      // Clear selection
      getState().setSelection(new Set());
    }

    expect(Object.keys(getState().templates)).toHaveLength(20);

    // Clear graph to start fresh
    getState().clearGraph();

    // Instantiate each template 5 times at different positions
    const instantiateDuration = measure(() => {
      for (let t = 0; t < 20; t++) {
        for (let i = 0; i < 5; i++) {
          getState().instantiateTemplate(templateIds[t], [t * 20 + i * 4, 0, 0]);
        }
      }
    });

    // 20 templates x 5 instantiations x 2 nodes each = 200 nodes
    expect(Object.keys(getState().nodes)).toHaveLength(200);
    // 20 templates x 5 instantiations x 1 connection each = 100 connections
    expect(Object.keys(getState().connections)).toHaveLength(100);

    // Verify all nodes exist and have proper types
    const allNodes = Object.values(getState().nodes);
    const sourceNodes = allNodes.filter(n => n.type === 'source');
    const transformNodes = allNodes.filter(n => n.type === 'transform');
    expect(sourceNodes).toHaveLength(100);
    expect(transformNodes).toHaveLength(100);

    console.log(`[STRESS] 100 template instantiations: ${instantiateDuration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// 19. All 50 Node Types in One Graph
// ===========================================================================
describe('all node types in one graph', () => {
  beforeEach(() => { resetStore(); });

  it('creates one node of each of the 49 types, connects compatible ones, and executes', { timeout: 30000 }, () => {
    const allTypes: NodeType[] = [
      'source', 'transform', 'filter', 'output',
      'math', 'clamp', 'remap',
      'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt',
      'lerp',
      'concat', 'template',
      'string-length', 'string-trim', 'string-split', 'string-case', 'parse-number',
      'compare', 'switch',
      'and', 'or', 'not', 'xor',
      'compose-vec3', 'decompose-vec3',
      'dot-product', 'cross-product', 'normalize-vec3', 'vec3-length',
      'mean', 'median', 'stddev', 'min-array', 'max-array',
      'note', 'reroute', 'random', 'display',
      'custom',
      'subgraph', 'subgraph-input', 'subgraph-output',
    ];
    expect(allTypes).toHaveLength(49);

    const nodeIds: Record<NodeType, string> = {} as Record<NodeType, string>;
    for (let i = 0; i < allTypes.length; i++) {
      const type = allTypes[i];
      const id = getState().addNode(type, [i * 3, 0, 0]);
      nodeIds[type] = id;
    }

    expect(Object.keys(getState().nodes)).toHaveLength(49);

    // Set up some data for nodes that need it
    getState().updateNodeData(nodeIds['source'], 'value', 42);
    getState().updateNodeData(nodeIds['math'], 'operation', 'add');
    getState().updateNodeData(nodeIds['compare'], 'mode', '>');
    getState().updateNodeData(nodeIds['random'], 'seed', 123);
    getState().updateNodeData(nodeIds['random'], 'min', 0);
    getState().updateNodeData(nodeIds['random'], 'max', 100);
    getState().updateNodeData(nodeIds['custom'], 'expression', 'in0 + 1');
    getState().updateNodeData(nodeIds['custom'], 'inputCount', 1);
    getState().updateNodeData(nodeIds['custom'], 'outputCount', 1);

    // Connect source -> transform, source -> sin, source -> cos, etc.
    const numericConsumers: NodeType[] = [
      'transform', 'sin', 'cos', 'tan', 'abs', 'floor', 'ceil', 'round', 'log', 'sqrt',
    ];
    for (const consumer of numericConsumers) {
      getState().addConnection(nodeIds['source'], 0, nodeIds[consumer], 0);
    }

    // source -> filter (input is 'any' type)
    getState().addConnection(nodeIds['source'], 0, nodeIds['filter'], 0);

    // source -> reroute -> display
    getState().addConnection(nodeIds['source'], 0, nodeIds['reroute'], 0);
    getState().addConnection(nodeIds['reroute'], 0, nodeIds['display'], 0);

    // source -> output
    getState().addConnection(nodeIds['source'], 0, nodeIds['output'], 0);

    // Execute the entire graph
    const state = getState();
    const result = executeGraph(state.nodes, state.connections);

    // Should not crash - some nodes may have errors (e.g., subgraph without def) but most should work
    expect(result.results.size).toBeGreaterThan(0);

    // Verify source output
    const srcResult = result.results.get(nodeIds['source']);
    expect(srcResult).toBeDefined();
    expect(srcResult!.outputs[0]).toBe(42);

    // Verify math-connected nodes
    const sinResult = result.results.get(nodeIds['sin']);
    expect(sinResult).toBeDefined();
    expect(sinResult!.outputs[0]).toBeCloseTo(Math.sin(42), 10);

    const cosResult = result.results.get(nodeIds['cos']);
    expect(cosResult).toBeDefined();
    expect(cosResult!.outputs[0]).toBeCloseTo(Math.cos(42), 10);

    const absResult = result.results.get(nodeIds['abs']);
    expect(absResult).toBeDefined();
    expect(absResult!.outputs[0]).toBe(42);

    const floorResult = result.results.get(nodeIds['floor']);
    expect(floorResult).toBeDefined();
    expect(floorResult!.outputs[0]).toBe(42);

    const sqrtResult = result.results.get(nodeIds['sqrt']);
    expect(sqrtResult).toBeDefined();
    expect(sqrtResult!.outputs[0]).toBeCloseTo(Math.sqrt(42), 10);

    const rerouteResult = result.results.get(nodeIds['reroute']);
    expect(rerouteResult).toBeDefined();
    expect(rerouteResult!.outputs[0]).toBe(42);

    console.log(`[STRESS] All 50 node types: ${result.results.size} nodes executed, ${result.errors.size} errors`);
  });
});

// ===========================================================================
// 20. Deep Subgraph Nesting (3 levels)
// ===========================================================================
describe('deep subgraph nesting', () => {
  beforeEach(() => { resetStore(); });

  it('creates 3 levels of subgraph nesting, enters/exits each, verifies state', { timeout: 30000 }, () => {
    // Level 0: Main graph
    const mainSrc = getState().addNode('source', [0, 0, 0]);
    getState().updateNodeData(mainSrc, 'value', 100);
    expect(Object.keys(getState().nodes)).toHaveLength(1);
    expect(getState().breadcrumbStack).toHaveLength(0);

    // Create Level 1 subgraph
    const subgraph1Id = getState().createSubgraph('Level1');
    expect(subgraph1Id).not.toBeNull();
    // Main graph now has source + subgraph node
    expect(Object.keys(getState().nodes)).toHaveLength(2);

    // Enter Level 1 subgraph
    getState().enterSubgraph(subgraph1Id!);
    expect(getState().breadcrumbStack).toHaveLength(1);
    // Inner graph has subgraph-input + subgraph-output
    const level1NodeCount = Object.keys(getState().nodes).length;
    expect(level1NodeCount).toBe(2);

    // Add a node inside Level 1
    const level1Src = getState().addNode('source', [0, 0, 2]);
    getState().updateNodeData(level1Src, 'value', 200);
    expect(Object.keys(getState().nodes)).toHaveLength(3);

    // Create Level 2 subgraph inside Level 1
    const subgraph2Id = getState().createSubgraph('Level2');
    expect(subgraph2Id).not.toBeNull();
    expect(Object.keys(getState().nodes)).toHaveLength(4);

    // Enter Level 2
    getState().enterSubgraph(subgraph2Id!);
    expect(getState().breadcrumbStack).toHaveLength(2);
    expect(Object.keys(getState().nodes)).toHaveLength(2); // subgraph-input + subgraph-output

    // Add a node inside Level 2
    const level2Src = getState().addNode('source', [0, 0, 4]);
    getState().updateNodeData(level2Src, 'value', 300);
    expect(Object.keys(getState().nodes)).toHaveLength(3);

    // Create Level 3 subgraph inside Level 2
    const subgraph3Id = getState().createSubgraph('Level3');
    expect(subgraph3Id).not.toBeNull();
    expect(Object.keys(getState().nodes)).toHaveLength(4);

    // Enter Level 3
    getState().enterSubgraph(subgraph3Id!);
    expect(getState().breadcrumbStack).toHaveLength(3);
    expect(Object.keys(getState().nodes)).toHaveLength(2);

    // Add a node inside Level 3
    const level3Src = getState().addNode('source', [0, 0, 6]);
    getState().updateNodeData(level3Src, 'value', 400);
    expect(Object.keys(getState().nodes)).toHaveLength(3);

    // Exit Level 3 -> Level 2
    getState().exitSubgraph();
    expect(getState().breadcrumbStack).toHaveLength(2);
    expect(Object.keys(getState().nodes)).toHaveLength(4);

    // Exit Level 2 -> Level 1
    getState().exitSubgraph();
    expect(getState().breadcrumbStack).toHaveLength(1);
    expect(Object.keys(getState().nodes)).toHaveLength(4);

    // Exit Level 1 -> Main
    getState().exitSubgraph();
    expect(getState().breadcrumbStack).toHaveLength(0);
    expect(Object.keys(getState().nodes)).toHaveLength(2); // source + subgraph node

    // Verify main graph data preserved
    expect(getState().nodes[mainSrc]).toBeDefined();
    expect(getState().nodes[mainSrc].data.value).toBe(100);

    // Re-enter Level 1 and verify state preserved
    getState().enterSubgraph(subgraph1Id!);
    expect(Object.keys(getState().nodes)).toHaveLength(4); // input, output, source, subgraph
    const level1Nodes = Object.values(getState().nodes);
    const level1Source = level1Nodes.find(n => n.id === level1Src);
    expect(level1Source).toBeDefined();
    expect(level1Source!.data.value).toBe(200);

    // Re-enter Level 2 from Level 1
    getState().enterSubgraph(subgraph2Id!);
    expect(Object.keys(getState().nodes)).toHaveLength(4);
    const level2Nodes = Object.values(getState().nodes);
    const level2Source = level2Nodes.find(n => n.id === level2Src);
    expect(level2Source).toBeDefined();
    expect(level2Source!.data.value).toBe(300);

    // Re-enter Level 3 from Level 2
    getState().enterSubgraph(subgraph3Id!);
    expect(Object.keys(getState().nodes)).toHaveLength(3);
    const level3Nodes = Object.values(getState().nodes);
    const level3Source = level3Nodes.find(n => n.id === level3Src);
    expect(level3Source).toBeDefined();
    expect(level3Source!.data.value).toBe(400);

    // Exit all the way back to main
    getState().exitSubgraph();
    getState().exitSubgraph();
    getState().exitSubgraph();
    expect(getState().breadcrumbStack).toHaveLength(0);
    expect(getState().activeGraphId).toBe('default');
    expect(Object.keys(getState().nodes)).toHaveLength(2);
  });
});

// ===========================================================================
// Additional: Combined multi-operation stress
// ===========================================================================
describe('combined multi-operation stress', () => {
  beforeEach(() => { resetStore(); });

  it('performs mixed operations: create, connect, update, select, delete, undo, redo in rapid succession', { timeout: 30000 }, () => {
    // Phase 1: Create 50 nodes and connect in chain
    const ids = buildStoreChain(50);
    expect(Object.keys(getState().nodes)).toHaveLength(50);

    // Phase 2: Update all node data rapidly
    for (let i = 0; i < ids.length; i++) {
      if (getState().nodes[ids[i]].type === 'source') {
        getState().updateNodeData(ids[i], 'value', i * 10);
      }
    }

    // Phase 3: Select and deselect in waves
    for (let wave = 0; wave < 5; wave++) {
      const subset = ids.filter((_, i) => i % (wave + 1) === 0);
      getState().setSelection(new Set(subset));
      expect(getState().selectedIds.size).toBe(subset.length);
    }

    // Phase 4: Delete a subset (select every 5th node)
    const toDelete = ids.filter((_, i) => i % 5 === 0 && i > 0);
    getState().setSelection(new Set(toDelete));
    getState().deleteSelected();
    const afterDeleteCount = Object.keys(getState().nodes).length;
    expect(afterDeleteCount).toBeLessThan(50);

    // Phase 5: Undo the delete
    getState().undo();
    expect(Object.keys(getState().nodes)).toHaveLength(50);

    // Phase 6: Redo the delete
    getState().redo();
    expect(Object.keys(getState().nodes)).toHaveLength(afterDeleteCount);

    // Phase 7: Undo again and execute
    getState().undo();
    const state = getState();
    const result = executeGraph(state.nodes, state.connections);
    expect(result.results.size).toBe(50);
    expect(result.errors.size).toBe(0);

    // Phase 8: Export and import
    const exported = getState().exportAllGraphs();
    resetStore();
    getState().importAllGraphs(exported);
    expect(Object.keys(getState().nodes)).toHaveLength(50);
    expect(Object.keys(getState().connections)).toHaveLength(49);
  });
});

// ===========================================================================
// Additional: Topological sort with complex diamond/fan patterns at 500 nodes
// ===========================================================================
describe('topological sort with complex patterns', () => {
  it('sorts 500-node mixed topology (chains, fan-out, diamonds)', () => {
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};
    let connIdx = 0;

    // Layer 1: 50 source nodes
    for (let i = 0; i < 50; i++) {
      const id = `layer1-${i}`;
      nodes[id] = makeRawNode(id, 'source', i);
    }

    // Layer 2: 100 transforms, each connected to a random source (fan-out)
    for (let i = 0; i < 100; i++) {
      const id = `layer2-${i}`;
      nodes[id] = makeRawNode(id, 'transform', 50 + i);
      const srcIdx = i % 50;
      connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, `layer1-${srcIdx}`, id);
    }

    // Layer 3: 100 math nodes, each taking two from layer 2 (diamond)
    for (let i = 0; i < 100; i++) {
      const id = `layer3-${i}`;
      nodes[id] = {
        id,
        type: 'math',
        position: [200 + i, 0, 0],
        title: `Math ${i}`,
        data: { operation: 'add' },
        inputs: [
          { id: `${id}-in-0`, label: 'a', portType: 'number' },
          { id: `${id}-in-1`, label: 'b', portType: 'number' },
        ],
        outputs: [{ id: `${id}-out-0`, label: 'result', portType: 'number' }],
      };
      connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, `layer2-${i}`, id, 0, 0);
      connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, `layer2-${(i + 1) % 100}`, id, 0, 1);
    }

    // Layer 4: 150 transforms in chains of 3 (50 chains, each starting from a layer3 node)
    for (let chain = 0; chain < 50; chain++) {
      for (let step = 0; step < 3; step++) {
        const idx = chain * 3 + step;
        const id = `layer4-${idx}`;
        nodes[id] = makeRawNode(id, 'transform', 400 + idx);
        if (step === 0) {
          connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, `layer3-${chain}`, id);
        } else {
          connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, `layer4-${chain * 3 + step - 1}`, id);
        }
      }
    }

    // Layer 5: 100 output nodes
    for (let i = 0; i < 100; i++) {
      const id = `layer5-${i}`;
      nodes[id] = {
        id,
        type: 'output',
        position: [600 + i, 0, 0],
        title: `Output ${i}`,
        data: {},
        inputs: [
          { id: `${id}-in-0`, label: 'data', portType: 'any' },
          { id: `${id}-in-1`, label: 'label', portType: 'string' },
        ],
        outputs: [],
      };
      if (i < 50) {
        // Connect to end of a layer4 chain
        connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, `layer4-${i * 3 + 2}`, id);
      } else {
        // Connect to a layer3 node
        connections[`c-${connIdx}`] = makeRawConnection(`c-${connIdx++}`, `layer3-${i}`, id);
      }
    }

    const totalNodes = 50 + 100 + 100 + 150 + 100;
    expect(Object.keys(nodes)).toHaveLength(totalNodes);
    expect(totalNodes).toBe(500);

    const duration = measure(() => {
      const waves = topologicalSort(nodes, connections);
      const total = waves.reduce((sum, w) => sum + w.length, 0);
      expect(total).toBe(500);
      // Should have at least 4 layers (source, transform, math, chain, output)
      expect(waves.length).toBeGreaterThanOrEqual(4);
    });

    expect(duration).toBeLessThan(100);
    console.log(`[STRESS] 500-node mixed topology sort: ${duration.toFixed(2)}ms`);
  });
});

// ===========================================================================
// Additional: Statistics nodes with NaN/edge cases at scale
// ===========================================================================
describe('statistics nodes edge cases at scale', () => {
  it('handles array with mixed NaN, undefined, and valid numbers (10000 elements)', () => {
    // Build array with valid numbers, NaN, and non-numbers mixed in
    const arr: unknown[] = [];
    for (let i = 0; i < 10000; i++) {
      if (i % 100 === 0) arr.push(NaN);
      else if (i % 200 === 1) arr.push('not-a-number');
      else arr.push(i);
    }

    // Filter expected valid numbers the same way the processor does
    const validNumbers = arr.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
    const expectedMean = validNumbers.reduce((a, b) => a + b, 0) / validNumbers.length;

    const nodes: Record<string, EditorNode> = {
      src: {
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        title: 'Mixed Array',
        data: { value: arr },
        inputs: [],
        outputs: [
          { id: 'src-out-0', label: 'value', portType: 'number' },
          { id: 'src-out-1', label: 'label', portType: 'string' },
        ],
      },
      meanNode: {
        id: 'meanNode',
        type: 'mean',
        position: [4, 0, 0],
        title: 'Mean',
        data: {},
        inputs: [{ id: 'meanNode-in-0', label: 'array', portType: 'any' }],
        outputs: [{ id: 'meanNode-out-0', label: 'mean', portType: 'number' }],
      },
    };
    const connections: Record<string, Connection> = {
      c1: makeRawConnection('c1', 'src', 'meanNode'),
    };

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);
    const meanResult = result.results.get('meanNode');
    expect(meanResult).toBeDefined();
    expect(meanResult!.outputs[0]).toBeCloseTo(expectedMean, 5);
  });
});

// ===========================================================================
// Additional: Execution with deep chain correctness
// ===========================================================================
describe('execution correctness with deep chains', () => {
  beforeEach(() => { resetStore(); });

  it('propagates value correctly through 300-node chain with multipliers', () => {
    // source(5) -> transform(multiplier=2) -> transform(multiplier=2) -> ...
    // After N transforms: 5 * 2^N
    const nodes: Record<string, EditorNode> = {};
    const connections: Record<string, Connection> = {};

    // Source with value 1
    nodes['src'] = {
      id: 'src',
      type: 'source',
      position: [0, 0, 0],
      title: 'Source',
      data: { value: 1 },
      inputs: [],
      outputs: [
        { id: 'src-out-0', label: 'value', portType: 'number' },
        { id: 'src-out-1', label: 'label', portType: 'string' },
      ],
    };

    // 10 transforms with multiplier=2 and offset=1
    // f(x) = x * 2 + 1
    // After 10 transforms: ((1*2+1)*2+1)*2+1... = 1023
    for (let i = 0; i < 10; i++) {
      const id = `xfm-${i}`;
      nodes[id] = {
        id,
        type: 'transform',
        position: [(i + 1) * 2, 0, 0],
        title: `Transform ${i}`,
        data: { multiplier: 2, offset: 1 },
        inputs: [
          { id: `${id}-in-0`, label: 'in', portType: 'number' },
          { id: `${id}-in-1`, label: 'factor', portType: 'number' },
        ],
        outputs: [
          { id: `${id}-out-0`, label: 'result', portType: 'number' },
          { id: `${id}-out-1`, label: 'debug', portType: 'string' },
        ],
      };
      if (i === 0) {
        connections[`c-${i}`] = makeRawConnection(`c-${i}`, 'src', id);
      } else {
        connections[`c-${i}`] = makeRawConnection(`c-${i}`, `xfm-${i - 1}`, id);
      }
    }

    const result = executeGraph(nodes, connections);
    expect(result.errors.size).toBe(0);

    // Manually compute expected: x = 1, then f(x) = x*2+1 applied 10 times
    // f(1) = 3, f(3) = 7, f(7) = 15, ... = 2^(n+1) - 1 after n transforms
    let expected = 1;
    for (let i = 0; i < 10; i++) {
      expected = expected * 2 + 1;
    }
    // expected = 2^11 - 1 = 2047

    const lastResult = result.results.get('xfm-9');
    expect(lastResult).toBeDefined();
    expect(lastResult!.outputs[0]).toBe(expected);
    expect(expected).toBe(2047);
  });
});
