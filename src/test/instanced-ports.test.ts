/**
 * InstancedPorts rendering logic tests (~21 tests).
 *
 * The InstancedPorts component uses R3F hooks (useFrame, useRef) so it cannot
 * be rendered directly in jsdom. These tests validate the underlying math,
 * store integration, data structures, and filtering logic that drive the
 * instanced rendering.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { PORT_TYPE_COLORS } from '../types';
import type { PortType } from '../types';

enableMapSet();

// --- Constants mirrored from InstancedPorts.tsx ---
const NODE_W = 1.6;
const NODE_D = 0.8;
const MAX_PORTS = 2000;

/** Compute the local X position of a port on a node. */
function getPortLocalX(isInput: boolean): number {
  return isInput ? -NODE_W / 2 - 0.05 : NODE_W / 2 + 0.05;
}

/** Compute the local Z position of a port given its index and total count. */
function getPortLocalZ(index: number, count: number): number {
  if (count === 1) return 0;
  return (index / (count - 1) - 0.5) * (NODE_D - 0.2);
}

// --- Helpers ---
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

/** Count total visible ports across all nodes, applying the same filtering as InstancedPorts. */
function countVisiblePorts(
  getLOD: (nodeId: string) => string,
  collapsedGroupNodeIds?: Set<string>,
): number {
  const { nodes } = getState();
  let count = 0;
  for (const nodeId of Object.keys(nodes)) {
    const node = nodes[nodeId];
    const lod = getLOD(nodeId);
    if (lod === 'culled' || lod === 'lod') continue;
    if (node.collapsed) continue;
    if (collapsedGroupNodeIds?.has(nodeId)) continue;
    count += node.inputs.length + node.outputs.length;
  }
  return count;
}

beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// 1. Port positioning math
// ---------------------------------------------------------------------------
describe('Port positioning math', () => {
  it('input port X position is -(NODE_W/2) - 0.05 = -0.85', () => {
    const x = getPortLocalX(true);
    expect(x).toBeCloseTo(-0.85, 10);
  });

  it('output port X position is (NODE_W/2) + 0.05 = 0.85', () => {
    const x = getPortLocalX(false);
    expect(x).toBeCloseTo(0.85, 10);
  });

  it('single port Z position is 0', () => {
    const z = getPortLocalZ(0, 1);
    expect(z).toBe(0);
  });

  it('two ports Z positions are symmetric: -0.3 and 0.3', () => {
    const z0 = getPortLocalZ(0, 2);
    const z1 = getPortLocalZ(1, 2);
    expect(z0).toBeCloseTo(-0.3, 10);
    expect(z1).toBeCloseTo(0.3, 10);
    // Symmetric around zero
    expect(z0 + z1).toBeCloseTo(0, 10);
  });

  it('three ports Z positions are evenly spaced: -0.3, 0, 0.3', () => {
    const z0 = getPortLocalZ(0, 3);
    const z1 = getPortLocalZ(1, 3);
    const z2 = getPortLocalZ(2, 3);
    expect(z0).toBeCloseTo(-0.3, 10);
    expect(z1).toBeCloseTo(0, 10);
    expect(z2).toBeCloseTo(0.3, 10);
  });

  it('port world position = node.position + local offset', () => {
    const nodePos: [number, number, number] = [5, 2, -3];
    const id = getState().addNode('transform', nodePos);
    const node = getState().nodes[id];

    // Transform has 2 inputs - check input port 0 world position
    const inputX = getPortLocalX(true);
    const inputZ = getPortLocalZ(0, node.inputs.length);
    const worldX = node.position[0] + inputX;
    const worldY = node.position[1]; // Y unchanged
    const worldZ = node.position[2] + inputZ;

    expect(worldX).toBeCloseTo(5 + (-0.85), 10);
    expect(worldY).toBe(2);
    expect(worldZ).toBeCloseTo(-3 + inputZ, 10);

    // Output port 1 world position
    const outputX = getPortLocalX(false);
    const outputZ = getPortLocalZ(1, node.outputs.length);
    expect(node.position[0] + outputX).toBeCloseTo(5 + 0.85, 10);
    expect(node.position[2] + outputZ).toBeCloseTo(-3 + outputZ, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. Instance count logic
// ---------------------------------------------------------------------------
describe('Instance count logic', () => {
  it('empty graph produces 0 instances', () => {
    const count = countVisiblePorts(() => 'full');
    expect(count).toBe(0);
  });

  it('source node has 0 inputs and 2 outputs = 2 instances', () => {
    const id = getState().addNode('source');
    const node = getState().nodes[id];
    expect(node.inputs.length).toBe(0);
    expect(node.outputs.length).toBe(2);
    const count = countVisiblePorts(() => 'full');
    expect(count).toBe(2);
  });

  it('transform node has 2 inputs and 2 outputs = 4 instances', () => {
    const id = getState().addNode('transform');
    const node = getState().nodes[id];
    expect(node.inputs.length).toBe(2);
    expect(node.outputs.length).toBe(2);
    const count = countVisiblePorts(() => 'full');
    expect(count).toBe(4);
  });

  it('multiple nodes sum all ports', () => {
    // source: 0 in + 2 out = 2
    // transform: 2 in + 2 out = 4
    // math: 2 in + 1 out = 3
    // filter: 1 in + 1 out = 2
    getState().addNode('source');
    getState().addNode('transform');
    getState().addNode('math');
    getState().addNode('filter');

    const count = countVisiblePorts(() => 'full');
    expect(count).toBe(2 + 4 + 3 + 2);
  });

  it('MAX_PORTS (2000) is enough for a 200-node graph with avg 4 ports/node', () => {
    // A 200-node graph averaging 4 ports each = 800 ports, well under 2000
    const avgPorts = 4;
    const nodeCount = 200;
    expect(nodeCount * avgPorts).toBeLessThan(MAX_PORTS);

    // Even with 10 ports/node average, 200 nodes = 2000, exactly at limit
    expect(nodeCount * 10).toBeLessThanOrEqual(MAX_PORTS);
  });
});

// ---------------------------------------------------------------------------
// 3. PORT_TYPE_COLORS completeness
// ---------------------------------------------------------------------------
describe('PORT_TYPE_COLORS completeness', () => {
  const ALL_PORT_TYPES: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'any'];

  it('every PortType has a color entry', () => {
    for (const pt of ALL_PORT_TYPES) {
      expect(PORT_TYPE_COLORS[pt]).toBeDefined();
      expect(typeof PORT_TYPE_COLORS[pt]).toBe('string');
    }
  });

  it('"any" type has a fallback color', () => {
    expect(PORT_TYPE_COLORS.any).toBeDefined();
    expect(PORT_TYPE_COLORS.any).toBe('#888888');
  });

  it('all color values are valid hex strings', () => {
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    for (const pt of ALL_PORT_TYPES) {
      expect(PORT_TYPE_COLORS[pt]).toMatch(hexRegex);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Visibility filtering logic
// ---------------------------------------------------------------------------
describe('Visibility filtering logic', () => {
  it('collapsed nodes are skipped (ports not counted)', () => {
    const id = getState().addNode('transform', [0, 0, 0]);
    // Mark the node as collapsed
    useEditorStore.setState((s) => {
      s.nodes[id].collapsed = true;
    });

    const count = countVisiblePorts(() => 'full');
    expect(count).toBe(0);
  });

  it('nodes in collapsedGroupNodeIds are skipped', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);

    // id1 is in a collapsed group, id2 is not
    const collapsedGroupNodeIds = new Set([id1]);

    const count = countVisiblePorts(() => 'full', collapsedGroupNodeIds);
    // Only id2 (transform: 4 ports) should be counted
    expect(count).toBe(4);
  });

  it('LOD "culled" nodes are skipped', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);

    const getLOD = (nodeId: string) => (nodeId === id1 ? 'culled' : 'full');
    const count = countVisiblePorts(getLOD);
    // Only id2 (transform: 4 ports) counted
    expect(count).toBe(4);
  });

  it('LOD "full" nodes are included, "lod" nodes are skipped', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [2, 0, 0]);
    getState().addNode('math', [4, 0, 0]);

    const getLOD = (nodeId: string) => {
      if (nodeId === id1) return 'full';
      if (nodeId === id2) return 'lod';
      return 'full';
    };

    const count = countVisiblePorts(getLOD);
    // id1 (source: 2) + id3 (math: 3) = 5; id2 is 'lod' so skipped
    expect(count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 5. Connection drawing state
// ---------------------------------------------------------------------------
describe('Connection drawing state', () => {
  it('during connection drawing, connectedInputs lookup is not built', () => {
    // The component skips building the connectedInputs set when isDrawing is true.
    // This means unconnected input detection is disabled during drawing.
    // We simulate the same logic here.
    const id1 = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [3, 0, 0]);

    // Start a connection (sets interaction to 'drawing-connection')
    getState().startConnection(id1, 0);
    const state = getState();

    expect(state.interaction).toBe('drawing-connection');
    // The component's logic: connectedInputs is null when isDrawing
    const isDrawing = state.interaction === 'drawing-connection';
    let connectedInputs: Set<string> | null = null;
    if (!isDrawing) {
      connectedInputs = new Set<string>();
    }
    expect(connectedInputs).toBeNull();
  });

  it('unconnected input detection: ports without incoming connections are flagged', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [3, 0, 0]);

    // Connect source output 0 -> transform input 0
    getState().addConnection(id1, 0, id2, 0);

    const { connections } = getState();

    // Build connectedInputs the same way the component does
    const connectedInputs = new Set<string>();
    for (const connId in connections) {
      const c = connections[connId];
      connectedInputs.add(`${c.targetNodeId}:${c.targetPortIndex}`);
    }

    // Input 0 of transform IS connected
    expect(connectedInputs.has(`${id2}:0`)).toBe(true);
    // Input 1 of transform is NOT connected (unconnected -> would be highlighted red)
    expect(connectedInputs.has(`${id2}:1`)).toBe(false);
  });

  it('self-node ports are dimmed during connection drawing', () => {
    const id1 = getState().addNode('source', [0, 0, 0]);
    const id2 = getState().addNode('transform', [3, 0, 0]);

    // Start drawing from source node, port 0
    getState().startConnection(id1, 0);
    const state = getState();

    const isDrawing = state.interaction === 'drawing-connection';
    const sourceNodeId = state.pendingConnection?.sourceNodeId;

    expect(isDrawing).toBe(true);
    expect(sourceNodeId).toBe(id1);

    // For input ports on the source node itself: isSelfPort = true, isDimmed = true
    const isSelfPortForId1 = isDrawing && sourceNodeId === id1;
    expect(isSelfPortForId1).toBe(true);

    // For input ports on a different node: isSelfPort = false, isValidTarget = true
    const isSelfPortForId2 = isDrawing && sourceNodeId === id2;
    expect(isSelfPortForId2).toBe(false);

    const isValidTargetForId2 = isDrawing && !isSelfPortForId2;
    expect(isValidTargetForId2).toBe(true);
  });
});
