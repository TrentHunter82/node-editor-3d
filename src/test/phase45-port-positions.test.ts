/**
 * Phase 45: Port position calculations with variable-size nodes.
 *
 * Covers scenarios NOT tested in node-resize-bounds.test.ts or phase44-integration.test.ts:
 *  - Port positions at MIN/MAX width and height extremes
 *  - Many-port nodes (5+ inputs) with custom height and even spacing verification
 *  - Different node types (source: 0 in/2 out, math: 2 in/1 out, output: 2 in/0 out)
 *  - Multi-port Z distribution formula verification
 *  - Port X offset consistency (always +-0.05 from node edge)
 *  - buildPortPositionCache consistency with getPortWorldPos across all dimensions
 *  - Port positions at world origin vs far from origin
 *  - Input/output port symmetry for same index/count
 *  - Cache rebuild after resize reflects updated positions
 *  - Multiple resized nodes in same cache build
 *  - Port Y always preserves node Y position
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import {
  MIN_NODE_WIDTH, MAX_NODE_WIDTH,
  MIN_NODE_HEIGHT, MAX_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT,
} from '../store/slices/nodeSlice';
import { getMinNodeDepth } from '../utils/nodeDepth';
import { getPortWorldPos } from '../utils/portPositions';
import { buildPortPositionCache } from '../utils/nodeBounds';
import type { EditorNode } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionTimings = {};
    s.breakpoints = {};
    s.breakpointConditions = {};
    s.searchHighlightIds = new Set();
    s.traceNodeId = null;
  });
}

function getState() { return useEditorStore.getState(); }

function makeNode(id: string, pos: [number, number, number] = [0, 0, 0], overrides: Partial<EditorNode> = {}): EditorNode {
  return {
    id, type: 'source', position: pos, title: id, data: {},
    inputs: [{ id: 'in-0', label: 'A', portType: 'number' }],
    outputs: [{ id: 'out-0', label: 'Out', portType: 'number' }],
    ...overrides,
  };
}

/** Build a port definition array with N entries. */
function makePorts(prefix: 'in' | 'out', count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    label: `${prefix === 'in' ? 'In' : 'Out'}${i}`,
    portType: 'number' as const,
  }));
}

// ============================================================================
// Tests
// ============================================================================

describe('Phase 45: Port positions with variable-size nodes', () => {
  beforeEach(() => resetStore());

  // --------------------------------------------------------------------------
  // 1. Port positions with MIN_NODE_WIDTH (1.0) — ports very close to center
  // --------------------------------------------------------------------------
  it('MIN_NODE_WIDTH places ports very close to center', () => {
    const pos: [number, number, number] = [0, 0, 0];
    const outPos = getPortWorldPos(pos, 'output', 0, 1, MIN_NODE_WIDTH);
    const inPos = getPortWorldPos(pos, 'input', 0, 1, MIN_NODE_WIDTH);

    // output X = 0 + 1.0/2 + 0.05 = 0.55
    expect(outPos[0]).toBeCloseTo(MIN_NODE_WIDTH / 2 + 0.05, 10);
    expect(outPos[0]).toBeCloseTo(0.55, 10);

    // input X = 0 - 1.0/2 - 0.05 = -0.55
    expect(inPos[0]).toBeCloseTo(-(MIN_NODE_WIDTH / 2 + 0.05), 10);
    expect(inPos[0]).toBeCloseTo(-0.55, 10);

    // Total span between input and output ports: 1.1
    const span = outPos[0] - inPos[0];
    expect(span).toBeCloseTo(MIN_NODE_WIDTH + 0.1, 10);
  });

  // --------------------------------------------------------------------------
  // 2. Port positions with MAX_NODE_WIDTH (6.0) — ports far from center
  // --------------------------------------------------------------------------
  it('MAX_NODE_WIDTH places ports far from center', () => {
    const pos: [number, number, number] = [0, 0, 0];
    const outPos = getPortWorldPos(pos, 'output', 0, 1, MAX_NODE_WIDTH);
    const inPos = getPortWorldPos(pos, 'input', 0, 1, MAX_NODE_WIDTH);

    // output X = 0 + 6.0/2 + 0.05 = 3.05
    expect(outPos[0]).toBeCloseTo(MAX_NODE_WIDTH / 2 + 0.05, 10);
    expect(outPos[0]).toBeCloseTo(3.05, 10);

    // input X = 0 - 6.0/2 - 0.05 = -3.05
    expect(inPos[0]).toBeCloseTo(-(MAX_NODE_WIDTH / 2 + 0.05), 10);
    expect(inPos[0]).toBeCloseTo(-3.05, 10);

    // Total span between input and output ports: 6.1
    const span = outPos[0] - inPos[0];
    expect(span).toBeCloseTo(MAX_NODE_WIDTH + 0.1, 10);
  });

  // --------------------------------------------------------------------------
  // 3. Port positions with MIN_NODE_HEIGHT (0.6) — ports nearly overlapping
  // --------------------------------------------------------------------------
  it('MIN_NODE_HEIGHT produces nearly overlapping multi-port Z positions', () => {
    const pos: [number, number, number] = [0, 0, 0];
    const depth = MIN_NODE_HEIGHT; // 0.6

    // Two input ports: spread = (depth - 0.2) = 0.4
    const p0 = getPortWorldPos(pos, 'input', 0, 2, DEFAULT_NODE_WIDTH, depth);
    const p1 = getPortWorldPos(pos, 'input', 1, 2, DEFAULT_NODE_WIDTH, depth);

    // index 0: z = 0 + (0/1 - 0.5) * 0.4 = -0.2
    // index 1: z = 0 + (1/1 - 0.5) * 0.4 = +0.2
    const spread = depth - 0.2;
    expect(p0[2]).toBeCloseTo(-spread / 2, 10);
    expect(p1[2]).toBeCloseTo(+spread / 2, 10);

    // Total gap between ports: 0.4 (very tight)
    expect(Math.abs(p1[2] - p0[2])).toBeCloseTo(spread, 10);
    expect(spread).toBeCloseTo(0.4, 10);
  });

  // --------------------------------------------------------------------------
  // 4. Port positions with MAX_NODE_HEIGHT (4.0) — wide port spread
  // --------------------------------------------------------------------------
  it('MAX_NODE_HEIGHT produces wide port spread in Z', () => {
    const pos: [number, number, number] = [0, 0, 0];
    const depth = MAX_NODE_HEIGHT; // 4.0

    // Two input ports: spread = (depth - 0.2) = 3.8
    const p0 = getPortWorldPos(pos, 'input', 0, 2, DEFAULT_NODE_WIDTH, depth);
    const p1 = getPortWorldPos(pos, 'input', 1, 2, DEFAULT_NODE_WIDTH, depth);

    const spread = depth - 0.2;
    expect(p0[2]).toBeCloseTo(-spread / 2, 10);
    expect(p1[2]).toBeCloseTo(+spread / 2, 10);
    expect(Math.abs(p1[2] - p0[2])).toBeCloseTo(spread, 10);
    expect(spread).toBeCloseTo(3.8, 10);

    // Confirm it is much wider than default
    const defaultSpread = DEFAULT_NODE_HEIGHT - 0.2;
    expect(spread).toBeGreaterThan(defaultSpread * 5);
  });

  // --------------------------------------------------------------------------
  // 5. Many-port nodes (5+ inputs) with custom height — verify even spacing
  // --------------------------------------------------------------------------
  it('5-input node with custom height has evenly spaced ports in Z', () => {
    const pos: [number, number, number] = [0, 0, 0];
    const customDepth = 3.0;
    const portCount = 5;
    const spread = customDepth - 0.2; // 2.8

    const positions: [number, number, number][] = [];
    for (let i = 0; i < portCount; i++) {
      positions.push(getPortWorldPos(pos, 'input', i, portCount, DEFAULT_NODE_WIDTH, customDepth));
    }

    // First port: z = (0/4 - 0.5) * 2.8 = -1.4
    expect(positions[0][2]).toBeCloseTo(-spread / 2, 10);
    // Last port: z = (4/4 - 0.5) * 2.8 = +1.4
    expect(positions[4][2]).toBeCloseTo(+spread / 2, 10);
    // Middle port: z = (2/4 - 0.5) * 2.8 = 0
    expect(positions[2][2]).toBeCloseTo(0, 10);

    // Verify even spacing: gap between consecutive ports should be constant
    const expectedGap = spread / (portCount - 1); // 2.8 / 4 = 0.7
    for (let i = 1; i < portCount; i++) {
      const gap = positions[i][2] - positions[i - 1][2];
      expect(gap).toBeCloseTo(expectedGap, 10);
    }
  });

  // --------------------------------------------------------------------------
  // 6. Port positions across different node types
  // --------------------------------------------------------------------------
  it('source (0 inputs, 2 outputs), math (2 inputs, 1 output), output (2 inputs, 0 outputs)', () => {
    const pos: [number, number, number] = [5, 1.5, -3];
    const w = 2.0;
    const d = 1.4;

    // Source: 0 inputs, 2 outputs
    const srcOut0 = getPortWorldPos(pos, 'output', 0, 2, w, d);
    const srcOut1 = getPortWorldPos(pos, 'output', 1, 2, w, d);
    // Both outputs on the right side
    expect(srcOut0[0]).toBeCloseTo(pos[0] + w / 2 + 0.05, 10);
    expect(srcOut1[0]).toBeCloseTo(pos[0] + w / 2 + 0.05, 10);
    // Z spread for 2 outputs: (d - 0.2) = 1.2
    expect(srcOut0[2]).toBeCloseTo(pos[2] - (d - 0.2) / 2, 10);
    expect(srcOut1[2]).toBeCloseTo(pos[2] + (d - 0.2) / 2, 10);

    // Math: 2 inputs, 1 output
    const mathIn0 = getPortWorldPos(pos, 'input', 0, 2, w, d);
    const mathIn1 = getPortWorldPos(pos, 'input', 1, 2, w, d);
    const mathOut0 = getPortWorldPos(pos, 'output', 0, 1, w, d);
    // Inputs on the left side
    expect(mathIn0[0]).toBeCloseTo(pos[0] - w / 2 - 0.05, 10);
    expect(mathIn1[0]).toBeCloseTo(pos[0] - w / 2 - 0.05, 10);
    // Single output centered in Z
    expect(mathOut0[2]).toBeCloseTo(pos[2], 10);

    // Output node: 2 inputs, 0 outputs
    const outIn0 = getPortWorldPos(pos, 'input', 0, 2, w, d);
    const outIn1 = getPortWorldPos(pos, 'input', 1, 2, w, d);
    expect(outIn0[0]).toBeCloseTo(pos[0] - w / 2 - 0.05, 10);
    expect(outIn1[0]).toBeCloseTo(pos[0] - w / 2 - 0.05, 10);
    expect(outIn0[2]).toBeCloseTo(pos[2] - (d - 0.2) / 2, 10);
    expect(outIn1[2]).toBeCloseTo(pos[2] + (d - 0.2) / 2, 10);
  });

  // --------------------------------------------------------------------------
  // 7. Port Z distribution formula verification
  // --------------------------------------------------------------------------
  it('multi-port Z formula: z = nodeZ + (i/(count-1) - 0.5) * (depth - 0.2)', () => {
    const nodeZ = 7.0;
    const depth = 2.5;
    const portCount = 4;
    const pos: [number, number, number] = [0, 0, nodeZ];

    for (let i = 0; i < portCount; i++) {
      const result = getPortWorldPos(pos, 'input', i, portCount, DEFAULT_NODE_WIDTH, depth);
      const expectedZ = nodeZ + (i / (portCount - 1) - 0.5) * (depth - 0.2);
      expect(result[2]).toBeCloseTo(expectedZ, 10);
    }

    // Single port should be centered at nodeZ (formula does not apply)
    const single = getPortWorldPos(pos, 'output', 0, 1, DEFAULT_NODE_WIDTH, depth);
    expect(single[2]).toBeCloseTo(nodeZ, 10);
  });

  // --------------------------------------------------------------------------
  // 8. Port X offset consistency: always +-0.05 from node edge
  // --------------------------------------------------------------------------
  it('port X offset is always exactly 0.05 from node edge regardless of width', () => {
    const pos: [number, number, number] = [0, 0, 0];
    const widths = [MIN_NODE_WIDTH, 1.5, DEFAULT_NODE_WIDTH, 2.5, 3.0, 4.5, MAX_NODE_WIDTH];

    for (const w of widths) {
      const outPos = getPortWorldPos(pos, 'output', 0, 1, w);
      const inPos = getPortWorldPos(pos, 'input', 0, 1, w);

      // Output port is 0.05 beyond the right edge (w/2)
      const outputOffset = outPos[0] - w / 2;
      expect(outputOffset).toBeCloseTo(0.05, 10);

      // Input port is 0.05 beyond the left edge (-w/2)
      const inputOffset = -w / 2 - inPos[0];
      expect(inputOffset).toBeCloseTo(0.05, 10);
    }
  });

  // --------------------------------------------------------------------------
  // 9. buildPortPositionCache consistency with getPortWorldPos for all dimensions
  // --------------------------------------------------------------------------
  it('cache matches getPortWorldPos for every port across multiple diverse nodes', () => {
    const nodes: Record<string, EditorNode> = {
      // Source-like: 0 inputs, 2 outputs, custom size
      n1: makeNode('n1', [10, 2, -5], {
        inputs: [],
        outputs: makePorts('out', 2),
        width: 3.0,
        height: 1.5,
      }),
      // Math-like: 3 inputs, 1 output, default size
      n2: makeNode('n2', [-4, 0, 8], {
        inputs: makePorts('in', 3),
        outputs: makePorts('out', 1),
      }),
      // Many-port: 6 inputs, 2 outputs, max height
      n3: makeNode('n3', [0, -1, 0], {
        inputs: makePorts('in', 6),
        outputs: makePorts('out', 2),
        width: 2.0,
        height: MAX_NODE_HEIGHT,
      }),
    };

    const cache = buildPortPositionCache(nodes);

    for (const id in nodes) {
      const node = nodes[id];
      const w = node.width ?? DEFAULT_NODE_WIDTH;
      const d = node.height ?? DEFAULT_NODE_HEIGHT;

      for (let i = 0; i < node.inputs.length; i++) {
        const cached = cache.get(id, 'input', i)!;
        const direct = getPortWorldPos(node.position, 'input', i, node.inputs.length, w, d);
        expect(cached).toBeDefined();
        expect(cached[0]).toBeCloseTo(direct[0], 10);
        expect(cached[1]).toBeCloseTo(direct[1], 10);
        expect(cached[2]).toBeCloseTo(direct[2], 10);
      }

      for (let i = 0; i < node.outputs.length; i++) {
        const cached = cache.get(id, 'output', i)!;
        const direct = getPortWorldPos(node.position, 'output', i, node.outputs.length, w, d);
        expect(cached).toBeDefined();
        expect(cached[0]).toBeCloseTo(direct[0], 10);
        expect(cached[1]).toBeCloseTo(direct[1], 10);
        expect(cached[2]).toBeCloseTo(direct[2], 10);
      }
    }

    // Total cache entries: n1(0+2) + n2(3+1) + n3(6+2) = 14
    expect(cache.size).toBe(14);
  });

  // --------------------------------------------------------------------------
  // 10. Port positions at node boundaries (world origin vs far from origin)
  // --------------------------------------------------------------------------
  it('port positions translate correctly at world origin and far from origin', () => {
    const originPos: [number, number, number] = [0, 0, 0];
    const farPos: [number, number, number] = [100, 50, -200];
    const w = 2.0;
    const d = 1.5;

    const originOut = getPortWorldPos(originPos, 'output', 0, 2, w, d);
    const farOut = getPortWorldPos(farPos, 'output', 0, 2, w, d);

    // The offset from node center should be identical
    const originOffsetX = originOut[0] - originPos[0];
    const farOffsetX = farOut[0] - farPos[0];
    expect(originOffsetX).toBeCloseTo(farOffsetX, 10);

    const originOffsetZ = originOut[2] - originPos[2];
    const farOffsetZ = farOut[2] - farPos[2];
    expect(originOffsetZ).toBeCloseTo(farOffsetZ, 10);

    // Absolute positions should differ by exactly the position delta
    expect(farOut[0] - originOut[0]).toBeCloseTo(farPos[0] - originPos[0], 10);
    expect(farOut[1] - originOut[1]).toBeCloseTo(farPos[1] - originPos[1], 10);
    expect(farOut[2] - originOut[2]).toBeCloseTo(farPos[2] - originPos[2], 10);
  });

  // --------------------------------------------------------------------------
  // 11. Symmetry: input port mirror matches output port for same index/count
  // --------------------------------------------------------------------------
  it('input and output ports are symmetric about node center X for same index/count', () => {
    const pos: [number, number, number] = [3, 1, -2];
    const w = 2.4;
    const d = 1.8;
    const portCount = 3;

    for (let i = 0; i < portCount; i++) {
      const inPort = getPortWorldPos(pos, 'input', i, portCount, w, d);
      const outPort = getPortWorldPos(pos, 'output', i, portCount, w, d);

      // X symmetry: input and output are equidistant from node center X, on opposite sides
      const inOffsetX = pos[0] - inPort[0];   // positive (input is to the left)
      const outOffsetX = outPort[0] - pos[0];  // positive (output is to the right)
      expect(inOffsetX).toBeCloseTo(outOffsetX, 10);
      expect(inOffsetX).toBeCloseTo(w / 2 + 0.05, 10);

      // Z identical: same index, same count, same depth => same Z position
      expect(inPort[2]).toBeCloseTo(outPort[2], 10);

      // Y identical
      expect(inPort[1]).toBeCloseTo(outPort[1], 10);
    }
  });

  // --------------------------------------------------------------------------
  // 12. Cache rebuild after resize reflects new positions
  // --------------------------------------------------------------------------
  it('rebuilding port position cache after resize reflects updated positions', () => {
    const id = getState().addNode('math', [0, 0, 0]);

    // Build cache with default dimensions
    const cacheBefore = buildPortPositionCache(getState().nodes);
    const outBefore = cacheBefore.get(id, 'output', 0)!;
    expect(outBefore[0]).toBeCloseTo(DEFAULT_NODE_WIDTH / 2 + 0.05, 10);

    // Resize node
    getState().resizeNode(id, 4.0, 2.5);

    // Build a NEW cache from the updated nodes
    const cacheAfter = buildPortPositionCache(getState().nodes);
    const outAfter = cacheAfter.get(id, 'output', 0)!;

    // Output port X must reflect the new width
    expect(outAfter[0]).toBeCloseTo(4.0 / 2 + 0.05, 10);
    expect(outAfter[0]).not.toBeCloseTo(outBefore[0], 3);

    // Input ports Z spacing must reflect the new depth
    const in0After = cacheAfter.get(id, 'input', 0)!;
    const in1After = cacheAfter.get(id, 'input', 1)!;
    const spreadAfter = Math.abs(in1After[2] - in0After[2]);
    expect(spreadAfter).toBeCloseTo(2.5 - 0.2, 10);

    const in0Before = cacheBefore.get(id, 'input', 0)!;
    const in1Before = cacheBefore.get(id, 'input', 1)!;
    const spreadBefore = Math.abs(in1Before[2] - in0Before[2]);
    expect(spreadBefore).toBeCloseTo(getMinNodeDepth('math', 2, 1) - 0.2, 10);

    expect(spreadAfter).toBeGreaterThan(spreadBefore);
  });

  // --------------------------------------------------------------------------
  // 13. Multiple resized nodes in same cache build
  // --------------------------------------------------------------------------
  it('cache correctly handles multiple resized nodes with different dimensions', () => {
    const nodes: Record<string, EditorNode> = {
      small: makeNode('small', [0, 0, 0], {
        inputs: makePorts('in', 2),
        outputs: makePorts('out', 1),
        width: MIN_NODE_WIDTH,
        height: MIN_NODE_HEIGHT,
      }),
      large: makeNode('large', [10, 0, 0], {
        inputs: makePorts('in', 2),
        outputs: makePorts('out', 1),
        width: MAX_NODE_WIDTH,
        height: MAX_NODE_HEIGHT,
      }),
      medium: makeNode('medium', [5, 0, 0], {
        inputs: makePorts('in', 2),
        outputs: makePorts('out', 1),
        width: 3.0,
        height: 1.5,
      }),
    };

    const cache = buildPortPositionCache(nodes);

    // Total entries: 3 nodes * (2 inputs + 1 output) = 9
    expect(cache.size).toBe(9);

    // small: output X = 0 + 1.0/2 + 0.05 = 0.55
    const smallOut = cache.get('small', 'output', 0)!;
    expect(smallOut[0]).toBeCloseTo(0.55, 10);

    // large: output X = 10 + 6.0/2 + 0.05 = 13.05
    const largeOut = cache.get('large', 'output', 0)!;
    expect(largeOut[0]).toBeCloseTo(13.05, 10);

    // medium: output X = 5 + 3.0/2 + 0.05 = 6.55
    const medOut = cache.get('medium', 'output', 0)!;
    expect(medOut[0]).toBeCloseTo(6.55, 10);

    // Input Z spread varies per node
    const smallSpread = Math.abs(cache.get('small', 'input', 1)![2] - cache.get('small', 'input', 0)![2]);
    const largeSpread = Math.abs(cache.get('large', 'input', 1)![2] - cache.get('large', 'input', 0)![2]);
    const medSpread = Math.abs(cache.get('medium', 'input', 1)![2] - cache.get('medium', 'input', 0)![2]);

    expect(smallSpread).toBeCloseTo(MIN_NODE_HEIGHT - 0.2, 10);
    expect(largeSpread).toBeCloseTo(MAX_NODE_HEIGHT - 0.2, 10);
    expect(medSpread).toBeCloseTo(1.5 - 0.2, 10);

    expect(largeSpread).toBeGreaterThan(medSpread);
    expect(medSpread).toBeGreaterThan(smallSpread);
  });

  // --------------------------------------------------------------------------
  // 14. Port position Y always preserves node Y position
  // --------------------------------------------------------------------------
  it('port Y always equals node Y for any width, height, or port configuration', () => {
    const yValues = [-10, -1, 0, 0.5, 3.14, 50];
    const widths = [MIN_NODE_WIDTH, DEFAULT_NODE_WIDTH, MAX_NODE_WIDTH];
    const depths = [MIN_NODE_HEIGHT, DEFAULT_NODE_HEIGHT, MAX_NODE_HEIGHT];

    for (const y of yValues) {
      for (const w of widths) {
        for (const d of depths) {
          const pos: [number, number, number] = [0, y, 0];

          // Single port
          const single = getPortWorldPos(pos, 'output', 0, 1, w, d);
          expect(single[1]).toBe(y);

          // Multi-port: first and last of 4
          const first = getPortWorldPos(pos, 'input', 0, 4, w, d);
          const last = getPortWorldPos(pos, 'input', 3, 4, w, d);
          expect(first[1]).toBe(y);
          expect(last[1]).toBe(y);
        }
      }
    }
  });

  // --------------------------------------------------------------------------
  // 15. 8-input node with MAX_NODE_HEIGHT: exhaustive Z position check
  // --------------------------------------------------------------------------
  it('8-input node at MAX_NODE_HEIGHT has correct Z for every port index', () => {
    const pos: [number, number, number] = [2, 0, -1];
    const depth = MAX_NODE_HEIGHT;
    const count = 8;
    const spread = depth - 0.2; // 3.8

    for (let i = 0; i < count; i++) {
      const p = getPortWorldPos(pos, 'input', i, count, DEFAULT_NODE_WIDTH, depth);
      const expectedZ = pos[2] + (i / (count - 1) - 0.5) * spread;
      expect(p[2]).toBeCloseTo(expectedZ, 10);

      // X is always the same for all inputs
      expect(p[0]).toBeCloseTo(pos[0] - DEFAULT_NODE_WIDTH / 2 - 0.05, 10);

      // Y is always preserved
      expect(p[1]).toBe(pos[1]);
    }

    // Verify total span
    const first = getPortWorldPos(pos, 'input', 0, count, DEFAULT_NODE_WIDTH, depth);
    const last = getPortWorldPos(pos, 'input', count - 1, count, DEFAULT_NODE_WIDTH, depth);
    expect(last[2] - first[2]).toBeCloseTo(spread, 10);
  });
});
