import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../store/slices/nodeSlice';
import { getMinNodeDepth } from '../utils/nodeDepth';
import { getPortWorldPos } from '../utils/portPositions';
import {
  buildNodeAABBs,
  buildPortPositionCache,
  getNodeAABB,
  findConnectionsInRect,
} from '../utils/nodeBounds';
// EditorNode type available from '../types' if needed

enableMapSet();

function getStore() {
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
    s.executionTimings = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionStats = { executionCount: 0, totalDuration: 0, errorCount: 0, timeoutCount: 0, totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null };
    s.searchHighlightIds = new Set();
    s.diffHighlightIds = new Map();
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.graphVariables = {};
    s.breakpoints = {};
    s.traceNodeId = null;
  });
}

// ============================================================================
// Section 1: Resize + port positions
// ============================================================================

describe('Phase 44 Integration: Resize + port positions', () => {
  beforeEach(resetStore);

  it('after resizeNode, port world positions shift proportionally', () => {
    const id = getStore().addNode('math', [0, 0, 0]);
    const node = getStore().nodes[id];

    // Default port positions (math: 2 inputs, 1 output)
    const outBefore = getPortWorldPos(node.position, 'output', 0, 1, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT);

    // Resize to a wider node
    getStore().resizeNode(id, 3.0, 1.2);
    const resized = getStore().nodes[id];
    const outAfter = getPortWorldPos(resized.position, 'output', 0, 1, resized.width!, resized.height!);

    // Output port X should be further right with wider node
    // Default: x = 0 + 1.6/2 + 0.05 = 0.85
    // Resized: x = 0 + 3.0/2 + 0.05 = 1.55
    expect(outAfter[0]).toBeGreaterThan(outBefore[0]);
    expect(outAfter[0]).toBeCloseTo(3.0 / 2 + 0.05, 5);
    expect(outBefore[0]).toBeCloseTo(DEFAULT_NODE_WIDTH / 2 + 0.05, 5);
  });

  it('buildPortPositionCache uses node.width/height (not defaults)', () => {
    const id = getStore().addNode('math', [0, 0, 0]);
    getStore().resizeNode(id, 4.0, 2.0);
    const resized = getStore().nodes[id];

    const cache = buildPortPositionCache(getStore().nodes);
    const cachedOut = cache.get(id, 'output', 0);
    const direct = getPortWorldPos(resized.position, 'output', 0, resized.outputs.length, 4.0, 2.0);

    expect(cachedOut).toBeDefined();
    expect(cachedOut![0]).toBeCloseTo(direct[0], 5);
    expect(cachedOut![1]).toBeCloseTo(direct[1], 5);
    expect(cachedOut![2]).toBeCloseTo(direct[2], 5);

    // Verify it differs from default-size computation
    const defaultOut = getPortWorldPos(resized.position, 'output', 0, resized.outputs.length, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT);
    expect(cachedOut![0]).not.toBeCloseTo(defaultOut[0], 3);
  });

  it('wider node spreads output ports further apart in X', () => {
    const id = getStore().addNode('math', [0, 0, 0]);

    // Default width: output port X = DEFAULT_NODE_WIDTH/2 + 0.05
    const defaultOutX = DEFAULT_NODE_WIDTH / 2 + 0.05;

    // Resize to max width
    getStore().resizeNode(id, 6.0, DEFAULT_NODE_HEIGHT);
    const resized = getStore().nodes[id];
    const wideOutX = resized.width! / 2 + 0.05;

    expect(wideOutX).toBeGreaterThan(defaultOutX);

    // Similarly, input ports shift further left
    const defaultInX = -(DEFAULT_NODE_WIDTH / 2 + 0.05);
    const wideInX = -(resized.width! / 2 + 0.05);

    expect(wideInX).toBeLessThan(defaultInX);
    // The total span (output - input) increases
    expect(wideOutX - wideInX).toBeGreaterThan(defaultOutX - defaultInX);
  });

  it('default-size nodes in cache match getPortWorldPos with defaults', () => {
    const id = getStore().addNode('math', [2, 0, 3]);
    const node = getStore().nodes[id];

    // Node has no width set (undefined = default); height is computed
    expect(node.width).toBeUndefined();
    expect(node.height).toBe(getMinNodeDepth('math', 2, 1));

    const cache = buildPortPositionCache(getStore().nodes);

    // Check all ports match direct computation with node dimensions
    for (let i = 0; i < node.inputs.length; i++) {
      const cached = cache.get(id, 'input', i);
      const direct = getPortWorldPos(node.position, 'input', i, node.inputs.length, node.width, node.height);
      expect(cached).toBeDefined();
      expect(cached![0]).toBeCloseTo(direct[0], 10);
      expect(cached![1]).toBeCloseTo(direct[1], 10);
      expect(cached![2]).toBeCloseTo(direct[2], 10);
    }
    for (let i = 0; i < node.outputs.length; i++) {
      const cached = cache.get(id, 'output', i);
      const direct = getPortWorldPos(node.position, 'output', i, node.outputs.length, node.width, node.height);
      expect(cached).toBeDefined();
      expect(cached![0]).toBeCloseTo(direct[0], 10);
      expect(cached![1]).toBeCloseTo(direct[1], 10);
      expect(cached![2]).toBeCloseTo(direct[2], 10);
    }
  });
});

// ============================================================================
// Section 2: Resize + AABB cache
// ============================================================================

describe('Phase 44 Integration: Resize + AABB cache', () => {
  beforeEach(resetStore);

  it('buildNodeAABBs reflects custom width/height', () => {
    const id = getStore().addNode('math', [0, 0, 0]);
    getStore().resizeNode(id, 3.0, 1.5);

    const aabbs = buildNodeAABBs(getStore().nodes);
    const aabb = aabbs.get(id)!;

    expect(aabb).toBeDefined();
    expect(aabb.width).toBeCloseTo(3.0, 5);
    expect(aabb.depth).toBeCloseTo(1.5, 5);
    expect(aabb.minX).toBeCloseTo(-1.5, 5);
    expect(aabb.maxX).toBeCloseTo(1.5, 5);
    expect(aabb.minZ).toBeCloseTo(-0.75, 5);
    expect(aabb.maxZ).toBeCloseTo(0.75, 5);
  });

  it('getNodeAABB for resized node has wider bounds', () => {
    const id = getStore().addNode('math', [0, 0, 0]);

    const defaultAABB = getNodeAABB(getStore().nodes[id]);
    expect(defaultAABB.width).toBeCloseTo(DEFAULT_NODE_WIDTH, 5);
    expect(defaultAABB.depth).toBeCloseTo(getMinNodeDepth('math', 2, 1), 5);

    getStore().resizeNode(id, 5.0, 3.0);
    const resizedAABB = getNodeAABB(getStore().nodes[id]);

    expect(resizedAABB.width).toBeCloseTo(5.0, 5);
    expect(resizedAABB.depth).toBeCloseTo(3.0, 5);
    expect(resizedAABB.width).toBeGreaterThan(defaultAABB.width);
    expect(resizedAABB.depth).toBeGreaterThan(defaultAABB.depth);
  });

  it('AABB center stays at node position after resize', () => {
    const id = getStore().addNode('math', [5, 0, -3]);

    getStore().resizeNode(id, 4.0, 2.5);
    const aabb = getNodeAABB(getStore().nodes[id]);

    expect(aabb.centerX).toBeCloseTo(5, 10);
    expect(aabb.centerZ).toBeCloseTo(-3, 10);
    // Bounds are symmetric around center
    expect((aabb.minX + aabb.maxX) / 2).toBeCloseTo(5, 10);
    expect((aabb.minZ + aabb.maxZ) / 2).toBeCloseTo(-3, 10);
  });
});

// ============================================================================
// Section 3: Resize + connections
// ============================================================================

describe('Phase 44 Integration: Resize + connections', () => {
  beforeEach(resetStore);

  it('findConnectionsInRect works correctly with resized source/target nodes', () => {
    // source at [-4, 0, 0], math at [0, 0, 0], sink at [4, 0, 0]
    const srcId = getStore().addNode('source', [-4, 0, 0]);
    const mathId = getStore().addNode('math', [0, 0, 0]);
    const sinkId = getStore().addNode('output', [4, 0, 0]);

    getStore().addConnection(srcId, 0, mathId, 0);
    getStore().addConnection(mathId, 0, sinkId, 0);

    const { connections, nodes } = getStore();

    // With default sizes, find connections whose midpoints fall in a centered rect
    const found = findConnectionsInRect(connections, nodes, -3, -1, 3, 1);
    expect(found.length).toBeGreaterThanOrEqual(1);

    // Now resize the source node to be very wide (6.0)
    getStore().resizeNode(srcId, 6.0, DEFAULT_NODE_HEIGHT);

    // Re-query with same rect — source output port moved, midpoint shifted
    const found2 = findConnectionsInRect(getStore().connections, getStore().nodes, -3, -1, 3, 1);

    // The result may differ because port positions changed
    // Specifically verify it processes without error and returns valid IDs
    for (const connId of found2) {
      expect(getStore().connections[connId]).toBeDefined();
    }
  });

  it('connection midpoint shifts when source node is resized (port positions move)', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const mathId = getStore().addNode('math', [4, 0, 0]);

    getStore().addConnection(srcId, 0, mathId, 0);

    const srcNode = getStore().nodes[srcId];
    const mathNode = getStore().nodes[mathId];

    // Default source output port X: 0 + DEFAULT_NODE_WIDTH/2 + 0.05 = 0.85
    const srcOutDefault = getPortWorldPos(srcNode.position, 'output', 0, 1, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT);
    const mathInDefault = getPortWorldPos(mathNode.position, 'input', 0, 2, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT);
    const midXDefault = (srcOutDefault[0] + mathInDefault[0]) / 2;

    // Resize source to width 4.0
    getStore().resizeNode(srcId, 4.0, DEFAULT_NODE_HEIGHT);
    const srcResized = getStore().nodes[srcId];

    // Resized source output port X: 0 + 4.0/2 + 0.05 = 2.05
    const srcOutResized = getPortWorldPos(srcResized.position, 'output', 0, 1, srcResized.width!, srcResized.height!);
    const midXResized = (srcOutResized[0] + mathInDefault[0]) / 2;

    expect(srcOutResized[0]).toBeGreaterThan(srcOutDefault[0]);
    expect(midXResized).toBeGreaterThan(midXDefault);
  });

  it('port position cache consistency: cache entry matches direct getPortWorldPos call after resize', () => {
    const id = getStore().addNode('math', [1, 0, -2]);
    getStore().resizeNode(id, 2.5, 1.0);

    const node = getStore().nodes[id];
    const cache = buildPortPositionCache(getStore().nodes);

    // Check each input port
    for (let i = 0; i < node.inputs.length; i++) {
      const cached = cache.get(id, 'input', i)!;
      const direct = getPortWorldPos(node.position, 'input', i, node.inputs.length, node.width, node.height);
      expect(cached[0]).toBeCloseTo(direct[0], 10);
      expect(cached[1]).toBeCloseTo(direct[1], 10);
      expect(cached[2]).toBeCloseTo(direct[2], 10);
    }

    // Check each output port
    for (let i = 0; i < node.outputs.length; i++) {
      const cached = cache.get(id, 'output', i)!;
      const direct = getPortWorldPos(node.position, 'output', i, node.outputs.length, node.width, node.height);
      expect(cached[0]).toBeCloseTo(direct[0], 10);
      expect(cached[1]).toBeCloseTo(direct[1], 10);
      expect(cached[2]).toBeCloseTo(direct[2], 10);
    }
  });
});

// ============================================================================
// Section 4: Resize + serialization roundtrip
// ============================================================================

describe('Phase 44 Integration: Resize + serialization roundtrip', () => {
  beforeEach(resetStore);

  it('resized nodes width/height survive export/import', () => {
    const id = getStore().addNode('math', [0, 0, 0]);
    getStore().resizeNode(id, 3.5, 1.8);

    // Verify dimensions set
    expect(getStore().nodes[id].width).toBeCloseTo(3.5, 5);
    expect(getStore().nodes[id].height).toBeCloseTo(1.8, 5);

    const exported = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(exported);

    // Find the imported node (ID may differ, find by type + position)
    const importedNodes = Object.values(getStore().nodes);
    const imported = importedNodes.find(n => n.type === 'math');
    expect(imported).toBeDefined();
    expect(imported!.width).toBeCloseTo(3.5, 5);
    expect(imported!.height).toBeCloseTo(1.8, 5);
  });

  it('default-size nodes have correct dimensions in exported data', () => {
    const id = getStore().addNode('source', [0, 0, 0]);

    // Default node has no explicit width; height is computed from port count
    expect(getStore().nodes[id].width).toBeUndefined();
    expect(getStore().nodes[id].height).toBe(getMinNodeDepth('source', 0, 2));

    const exported = getStore().exportAllGraphs();

    // Inspect exported data directly
    const activeId = exported.activeGraphId;
    const graphData = exported.graphs[activeId];
    const exportedNodes = Object.values(graphData.nodes);
    const exportedNode = exportedNodes.find(n => n.type === 'source');

    expect(exportedNode).toBeDefined();
    expect(exportedNode!.width).toBeUndefined();
    expect(exportedNode!.height).toBe(getMinNodeDepth('source', 0, 2));
  });

  it('connection metadata (label, color, style) survives export/import alongside resized nodes', () => {
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const mathId = getStore().addNode('math', [4, 0, 0]);
    const connId = getStore().addConnection(srcId, 0, mathId, 0);
    expect(connId).not.toBeNull();

    // Resize the source node
    getStore().resizeNode(srcId, 3.0, 1.0);

    // Set connection metadata
    getStore().updateConnectionLabel(connId!, 'data-flow');
    getStore().updateConnectionColor(connId!, '#ff5500');

    // Verify metadata is set
    const conn = getStore().connections[connId!];
    expect(conn.label).toBe('data-flow');
    expect(conn.colorOverride).toBe('#ff5500');

    const exported = getStore().exportAllGraphs();
    resetStore();
    getStore().importAllGraphs(exported);

    // Find the imported connection
    const importedConns = Object.values(getStore().connections);
    expect(importedConns.length).toBe(1);
    const importedConn = importedConns[0];

    expect(importedConn.label).toBe('data-flow');
    expect(importedConn.colorOverride).toBe('#ff5500');

    // Also verify the resized source survived
    const importedSrc = Object.values(getStore().nodes).find(n => n.type === 'source');
    expect(importedSrc).toBeDefined();
    expect(importedSrc!.width).toBeCloseTo(3.0, 5);
    expect(importedSrc!.height).toBeCloseTo(1.0, 5);
  });
});

// ============================================================================
// Section 5: Resize + groups
// ============================================================================

describe('Phase 44 Integration: Resize + groups', () => {
  beforeEach(resetStore);

  it('group bounding box accounts for variable-size nodes', () => {
    const id1 = getStore().addNode('source', [-3, 0, 0]);
    const id2 = getStore().addNode('math', [3, 0, 0]);

    // Resize math node to be wider
    getStore().resizeNode(id2, 4.0, 2.0);

    // Select both and create group
    useEditorStore.setState((s) => {
      s.selectedIds = new Set([id1, id2]);
    });
    const groupId = getStore().createGroup('Wide Group');
    expect(groupId).not.toBeNull();

    // Build AABBs to check spatial coverage
    const aabbs = buildNodeAABBs(getStore().nodes);
    const aabb1 = aabbs.get(id1)!;
    const aabb2 = aabbs.get(id2)!;

    // The combined bounding box should span from the left edge of source to right edge of resized math
    const groupMinX = Math.min(aabb1.minX, aabb2.minX);
    const groupMaxX = Math.max(aabb1.maxX, aabb2.maxX);
    const groupMinZ = Math.min(aabb1.minZ, aabb2.minZ);
    const groupMaxZ = Math.max(aabb1.maxZ, aabb2.maxZ);

    // Source at -3: minX = -3 - 0.8 = -3.8, maxX = -3 + 0.8 = -2.2
    // Resized math at 3: minX = 3 - 2.0 = 1.0, maxX = 3 + 2.0 = 5.0
    expect(groupMinX).toBeCloseTo(-3 - DEFAULT_NODE_WIDTH / 2, 5);
    expect(groupMaxX).toBeCloseTo(3 + 4.0 / 2, 5);
    // Source default height 0.8: minZ = -0.4, maxZ = 0.4
    // Resized math height 2.0: minZ = -1.0, maxZ = 1.0
    expect(groupMinZ).toBeCloseTo(-2.0 / 2, 5);
    expect(groupMaxZ).toBeCloseTo(2.0 / 2, 5);

    // Total span is wider than two default-size nodes would produce
    const defaultSpan = (3 + DEFAULT_NODE_WIDTH / 2) - (-3 - DEFAULT_NODE_WIDTH / 2);
    const actualSpan = groupMaxX - groupMinX;
    expect(actualSpan).toBeGreaterThan(defaultSpan);
  });

  it('group with mixed default/resized nodes computes correct bounds', () => {
    const id1 = getStore().addNode('source', [0, 0, 0]);   // default size
    const id2 = getStore().addNode('math', [5, 0, 0]);     // will be resized
    const id3 = getStore().addNode('output', [10, 0, 0]);    // default size

    getStore().resizeNode(id2, 2.0, 1.5);

    const aabbs = buildNodeAABBs(getStore().nodes);

    // source: default width, computed height
    expect(aabbs.get(id1)!.width).toBeCloseTo(DEFAULT_NODE_WIDTH, 5);
    expect(aabbs.get(id1)!.depth).toBeCloseTo(getMinNodeDepth('source', 0, 2), 5);

    // math: resized (2.0 x 1.5)
    expect(aabbs.get(id2)!.width).toBeCloseTo(2.0, 5);
    expect(aabbs.get(id2)!.depth).toBeCloseTo(1.5, 5);

    // output: default width, computed height
    expect(aabbs.get(id3)!.width).toBeCloseTo(DEFAULT_NODE_WIDTH, 5);
    expect(aabbs.get(id3)!.depth).toBeCloseTo(getMinNodeDepth('output', 2, 0), 5);

    // Overall bounding box
    const allAabbs = [aabbs.get(id1)!, aabbs.get(id2)!, aabbs.get(id3)!];
    const overallMinX = Math.min(...allAabbs.map(a => a.minX));
    const overallMaxX = Math.max(...allAabbs.map(a => a.maxX));
    const overallMinZ = Math.min(...allAabbs.map(a => a.minZ));
    const overallMaxZ = Math.max(...allAabbs.map(a => a.maxZ));

    // Source at 0: minX = -0.8, sink at 10: maxX = 10.8
    expect(overallMinX).toBeCloseTo(0 - DEFAULT_NODE_WIDTH / 2, 5);
    expect(overallMaxX).toBeCloseTo(10 + DEFAULT_NODE_WIDTH / 2, 5);
    // Tallest node is math at height 1.5, centered at z=0
    expect(overallMinZ).toBeCloseTo(-1.5 / 2, 5);
    expect(overallMaxZ).toBeCloseTo(1.5 / 2, 5);
  });
});

// ============================================================================
// Section 6: Resize + undo/redo cycle
// ============================================================================

describe('Phase 44 Integration: Resize + undo/redo cycle', () => {
  beforeEach(resetStore);

  it('undo after resize restores original dimensions (undefined = default)', () => {
    const id = getStore().addNode('math', [0, 0, 0]);

    // Before resize: no explicit width; height is computed
    expect(getStore().nodes[id].width).toBeUndefined();
    expect(getStore().nodes[id].height).toBe(getMinNodeDepth('math', 2, 1));

    getStore().resizeNode(id, 3.0, 1.5);
    expect(getStore().nodes[id].width).toBeCloseTo(3.0, 5);
    expect(getStore().nodes[id].height).toBeCloseTo(1.5, 5);

    getStore().undo();

    // After undo: should be back to original dimensions
    expect(getStore().nodes[id].width).toBeUndefined();
    expect(getStore().nodes[id].height).toBe(getMinNodeDepth('math', 2, 1));

    // AABB should reflect default size
    const aabb = getNodeAABB(getStore().nodes[id]);
    expect(aabb.width).toBeCloseTo(DEFAULT_NODE_WIDTH, 5);
    expect(aabb.depth).toBeCloseTo(getMinNodeDepth('math', 2, 1), 5);
  });

  it('multiple resize + undo steps restore correctly', () => {
    const id = getStore().addNode('math', [0, 0, 0]);

    // Resize #1
    getStore().resizeNode(id, 2.0, 1.0);
    expect(getStore().nodes[id].width).toBeCloseTo(2.0, 5);

    // Resize #2
    getStore().resizeNode(id, 4.0, 2.0);
    expect(getStore().nodes[id].width).toBeCloseTo(4.0, 5);

    // Resize #3
    getStore().resizeNode(id, 5.5, 3.5);
    expect(getStore().nodes[id].width).toBeCloseTo(5.5, 5);

    // Undo #3 → back to resize #2
    getStore().undo();
    expect(getStore().nodes[id].width).toBeCloseTo(4.0, 5);
    expect(getStore().nodes[id].height).toBeCloseTo(2.0, 5);

    // Undo #2 → back to resize #1
    getStore().undo();
    expect(getStore().nodes[id].width).toBeCloseTo(2.0, 5);
    expect(getStore().nodes[id].height).toBeCloseTo(1.0, 5);

    // Undo #1 → back to default (computed height)
    getStore().undo();
    expect(getStore().nodes[id].width).toBeUndefined();
    expect(getStore().nodes[id].height).toBe(getMinNodeDepth('math', 2, 1));

    // Redo #1
    getStore().redo();
    expect(getStore().nodes[id].width).toBeCloseTo(2.0, 5);
    expect(getStore().nodes[id].height).toBeCloseTo(1.0, 5);

    // Redo #2
    getStore().redo();
    expect(getStore().nodes[id].width).toBeCloseTo(4.0, 5);
    expect(getStore().nodes[id].height).toBeCloseTo(2.0, 5);
  });
});

// ============================================================================
// Section 7: Node bounds utilities edge cases
// ============================================================================

describe('Phase 44 Integration: Node bounds utilities edge cases', () => {
  beforeEach(resetStore);

  it('buildNodeAABBs with empty nodes record returns empty Map', () => {
    const aabbs = buildNodeAABBs({});
    expect(aabbs.size).toBe(0);
    expect(aabbs).toBeInstanceOf(Map);
  });

  it('findConnectionsInRect with missing source/target nodes skips gracefully', () => {
    // Create a connection that references non-existent nodes
    const connections: Record<string, { id: string; sourceNodeId: string; sourcePortIndex: number; targetNodeId: string; targetPortIndex: number }> = {
      'conn-orphan': {
        id: 'conn-orphan',
        sourceNodeId: 'non-existent-1',
        sourcePortIndex: 0,
        targetNodeId: 'non-existent-2',
        targetPortIndex: 0,
      },
    };

    // Should not throw, should return empty
    const found = findConnectionsInRect(connections, {}, -100, -100, 100, 100);
    expect(found).toEqual([]);
  });

  it('findConnectionsInRect with resized nodes finds different connections than default', () => {
    // Place source and math close together; connection midpoint depends on port positions
    const srcId = getStore().addNode('source', [0, 0, 0]);
    const mathId = getStore().addNode('math', [3, 0, 0]);
    getStore().addConnection(srcId, 0, mathId, 0);

    const { connections, nodes } = getStore();

    // Compute midpoint with default sizes
    const srcNode = nodes[srcId];
    const mathNode = nodes[mathId];
    const srcOut = getPortWorldPos(srcNode.position, 'output', 0, 1, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT);
    const mathIn = getPortWorldPos(mathNode.position, 'input', 0, 2, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT);
    const defaultMidX = (srcOut[0] + mathIn[0]) / 2;

    // Use a narrow rect around the default midpoint
    const margin = 0.1;
    const foundDefault = findConnectionsInRect(
      connections, nodes,
      defaultMidX - margin, -1,
      defaultMidX + margin, 1,
    );
    expect(foundDefault.length).toBe(1);

    // Now resize source to be very wide → output port shifts right → midpoint shifts
    getStore().resizeNode(srcId, 5.0, DEFAULT_NODE_HEIGHT);

    const nodesAfter = getStore().nodes;
    const srcResized = nodesAfter[srcId];
    const srcOutResized = getPortWorldPos(srcResized.position, 'output', 0, 1, srcResized.width!, srcResized.height!);
    const newMidX = (srcOutResized[0] + mathIn[0]) / 2;

    // The old narrow rect no longer catches the shifted midpoint
    const foundOldRect = findConnectionsInRect(
      getStore().connections, nodesAfter,
      defaultMidX - margin, -1,
      defaultMidX + margin, 1,
    );

    // The new narrow rect around the shifted midpoint should find it
    const foundNewRect = findConnectionsInRect(
      getStore().connections, nodesAfter,
      newMidX - margin, -1,
      newMidX + margin, 1,
    );
    expect(foundNewRect.length).toBe(1);

    // The old rect should NOT find it (midpoint moved away)
    expect(foundOldRect.length).toBe(0);
  });
});
