/**
 * Phase 15 Feature Tests
 *
 * Comprehensive tests for:
 * 1. Statistics node processors (mean, median, stddev, min-array, max-array)
 * 2. 3D Math node processors (dot-product, cross-product, normalize-vec3, vec3-length)
 * 3. Execution History (executionSlice — ExecutionHistoryEntry, scrubExecutionHistory, clearExecutionHistory)
 * 4. Undo History Browser (editorStore — UndoMeta, getUndoHistory, jumpToUndo)
 * 5. NODE_TYPE_CONFIG / NODE_CATEGORIES correctness for all 9 new types
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { _resetExecutionModuleState } from '../store/slices/executionSlice';
import { executeGraph } from '../utils/execution';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../types';
import type { EditorNode, Connection, NodeType } from '../types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {},
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${id}-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${id}-${i}`, label: c.label, portType: c.portType })),
    ...overrides,
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

/** Run executeGraph over a simple nodes+connections map. */
function exec(nodes: Record<string, EditorNode>, connections: Record<string, Connection> = {}) {
  return executeGraph(nodes, connections);
}

/** Build a source node that outputs a fixed value. */
function srcNum(id: string, value: number): EditorNode {
  return makeNode(id, 'source', { value });
}

/**
 * Build a source node that outputs an array value.
 * We inject the array via node.data.value; the source processor uses data.value directly.
 */
function srcArray(id: string, value: unknown[]): EditorNode {
  return makeNode(id, 'source', { value });
}

/**
 * Build a compose-vec3 node wired to three source nodes for the given x, y, z values.
 * Returns the nodes and connections needed to produce a vector3 output.
 */
function makeVec3Graph(prefix: string, x: number, y: number, z: number): {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  vecId: string;
} {
  const vecId = `${prefix}_vec`;
  const srcX = makeNode(`${prefix}_sx`, 'source', { value: x });
  const srcY = makeNode(`${prefix}_sy`, 'source', { value: y });
  const srcZ = makeNode(`${prefix}_sz`, 'source', { value: z });
  const vec = makeNode(vecId, 'compose-vec3');
  return {
    nodes: {
      [`${prefix}_sx`]: srcX,
      [`${prefix}_sy`]: srcY,
      [`${prefix}_sz`]: srcZ,
      [vecId]: vec,
    },
    connections: {
      [`${prefix}_cx`]: makeConn(`${prefix}_cx`, `${prefix}_sx`, 0, vecId, 0),
      [`${prefix}_cy`]: makeConn(`${prefix}_cy`, `${prefix}_sy`, 0, vecId, 1),
      [`${prefix}_cz`]: makeConn(`${prefix}_cz`, `${prefix}_sz`, 0, vecId, 2),
    },
    vecId,
  };
}

const getState = () => useEditorStore.getState();

function resetStore() {
  _resetModuleState();
  _resetExecutionModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.selectedIds = new Set<string>();
    s.templates = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.validationErrors = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.errorStrategy = 'fail-fast';
    s.debugMode = false;
    s.pausedAtWave = -1;
    s.debugWaves = [];
    s.traceNodeId = null;
    s.undoRedoEvent = null;
    s.hoveredConnectionId = null;
    s.nearestSnapPort = null;
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.contextMenu = null;
    s.searchQuery = '';
    // Multi-graph state
    s.graphTabs = { default: { id: 'default', name: 'Main Graph', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
  });
}

// ===========================================================================
// 1. Statistics Processors
// ===========================================================================

describe('Phase 15 — Statistics Processors', () => {

  // -------------------------------------------------------------------------
  // mean
  // -------------------------------------------------------------------------
  describe('mean processor', () => {
    it('computes arithmetic mean of a normal array', () => {
      const nodes = {
        src: srcArray('src', [1, 2, 3, 4, 5]),
        mean: makeNode('mean', 'mean'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('mean')!.outputs[0]).toBe(3);
    });

    it('returns 0 for an empty array', () => {
      const nodes = {
        src: srcArray('src', []),
        mean: makeNode('mean', 'mean'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('mean')!.outputs[0]).toBe(0);
    });

    it('returns the single element for a one-element array', () => {
      const nodes = {
        src: srcArray('src', [10]),
        mean: makeNode('mean', 'mean'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('mean')!.outputs[0]).toBe(10);
    });

    it('filters out non-numeric values before computing mean', () => {
      // [2, 'foo', 4, null, undefined, 6] → numeric only [2, 4, 6] → mean 4
      const nodes = {
        src: srcArray('src', [2, 'foo', 4, null, undefined, 6] as unknown[]),
        mean: makeNode('mean', 'mean'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('mean')!.outputs[0]).toBe(4);
    });

    it('returns 0 when input is not an array (scalar fallback)', () => {
      const nodes = {
        src: srcNum('src', 42),
        mean: makeNode('mean', 'mean'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
      const r = exec(nodes, conns);
      // source outputs a number, not array → filtered to empty → 0
      expect(r.results.get('mean')!.outputs[0]).toBe(0);
    });

    it('handles a two-element array correctly', () => {
      const nodes = {
        src: srcArray('src', [6, 14]),
        mean: makeNode('mean', 'mean'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'mean', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('mean')!.outputs[0]).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // median
  // -------------------------------------------------------------------------
  describe('median processor', () => {
    it('returns the middle element for an odd-length array', () => {
      const nodes = {
        src: srcArray('src', [1, 3, 5]),
        med: makeNode('med', 'median'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'med', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('med')!.outputs[0]).toBe(3);
    });

    it('returns the average of two middle elements for an even-length array', () => {
      const nodes = {
        src: srcArray('src', [1, 2, 3, 4]),
        med: makeNode('med', 'median'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'med', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('med')!.outputs[0]).toBe(2.5);
    });

    it('returns the single element for a one-element array', () => {
      const nodes = {
        src: srcArray('src', [7]),
        med: makeNode('med', 'median'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'med', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('med')!.outputs[0]).toBe(7);
    });

    it('returns 0 for an empty array', () => {
      const nodes = {
        src: srcArray('src', []),
        med: makeNode('med', 'median'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'med', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('med')!.outputs[0]).toBe(0);
    });

    it('sorts the array before finding the median (unsorted input)', () => {
      // [5, 1, 3] sorted → [1, 3, 5], median = 3
      const nodes = {
        src: srcArray('src', [5, 1, 3]),
        med: makeNode('med', 'median'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'med', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('med')!.outputs[0]).toBe(3);
    });

    it('filters non-numeric values before computing median', () => {
      // [1, 'x', 2, null, 3] → [1, 2, 3], median = 2
      const nodes = {
        src: srcArray('src', [1, 'x', 2, null, 3] as unknown[]),
        med: makeNode('med', 'median'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'med', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('med')!.outputs[0]).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // stddev
  // -------------------------------------------------------------------------
  describe('stddev processor', () => {
    it('computes population standard deviation correctly', () => {
      // [2,4,4,4,5,5,7,9] population stddev = 2
      const nodes = {
        src: srcArray('src', [2, 4, 4, 4, 5, 5, 7, 9]),
        std: makeNode('std', 'stddev'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'std', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('std')!.outputs[0]).toBeCloseTo(2, 10);
    });

    it('returns 0 for a uniform array (no spread)', () => {
      const nodes = {
        src: srcArray('src', [5, 5, 5, 5, 5]),
        std: makeNode('std', 'stddev'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'std', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('std')!.outputs[0]).toBe(0);
    });

    it('returns 0 for a single-element array', () => {
      const nodes = {
        src: srcArray('src', [42]),
        std: makeNode('std', 'stddev'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'std', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('std')!.outputs[0]).toBe(0);
    });

    it('returns 0 for an empty array', () => {
      const nodes = {
        src: srcArray('src', []),
        std: makeNode('std', 'stddev'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'std', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('std')!.outputs[0]).toBe(0);
    });

    it('filters non-numeric values before computing stddev', () => {
      // [5, 'x', 5, null, 5] → [5, 5, 5], stddev = 0
      const nodes = {
        src: srcArray('src', [5, 'x', 5, null, 5] as unknown[]),
        std: makeNode('std', 'stddev'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'std', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('std')!.outputs[0]).toBe(0);
    });

    it('computes stddev of [0, 10] correctly', () => {
      // mean = 5, variance = (25 + 25)/2 = 25, stddev = 5
      const nodes = {
        src: srcArray('src', [0, 10]),
        std: makeNode('std', 'stddev'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'std', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('std')!.outputs[0]).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // min-array
  // -------------------------------------------------------------------------
  describe('min-array processor', () => {
    it('returns the minimum value from an array', () => {
      const nodes = {
        src: srcArray('src', [3, 1, 4, 1, 5, 9, 2, 6]),
        minn: makeNode('minn', 'min-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'minn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('minn')!.outputs[0]).toBe(1);
    });

    it('returns 0 for an empty array', () => {
      const nodes = {
        src: srcArray('src', []),
        minn: makeNode('minn', 'min-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'minn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('minn')!.outputs[0]).toBe(0);
    });

    it('returns the only element for a one-element array', () => {
      const nodes = {
        src: srcArray('src', [99]),
        minn: makeNode('minn', 'min-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'minn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('minn')!.outputs[0]).toBe(99);
    });

    it('handles negative values correctly', () => {
      const nodes = {
        src: srcArray('src', [-5, -1, -10, -3]),
        minn: makeNode('minn', 'min-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'minn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('minn')!.outputs[0]).toBe(-10);
    });

    it('filters non-numeric values before finding minimum', () => {
      // [3, 'x', 1, null, 5] → [3, 1, 5], min = 1
      const nodes = {
        src: srcArray('src', [3, 'x', 1, null, 5] as unknown[]),
        minn: makeNode('minn', 'min-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'minn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('minn')!.outputs[0]).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // max-array
  // -------------------------------------------------------------------------
  describe('max-array processor', () => {
    it('returns the maximum value from an array', () => {
      const nodes = {
        src: srcArray('src', [3, 1, 4, 1, 5]),
        maxn: makeNode('maxn', 'max-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'maxn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('maxn')!.outputs[0]).toBe(5);
    });

    it('returns 0 for an empty array', () => {
      const nodes = {
        src: srcArray('src', []),
        maxn: makeNode('maxn', 'max-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'maxn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('maxn')!.outputs[0]).toBe(0);
    });

    it('returns the only element for a one-element array', () => {
      const nodes = {
        src: srcArray('src', [7]),
        maxn: makeNode('maxn', 'max-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'maxn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('maxn')!.outputs[0]).toBe(7);
    });

    it('handles negative values correctly', () => {
      const nodes = {
        src: srcArray('src', [-5, -1, -10, -3]),
        maxn: makeNode('maxn', 'max-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'maxn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('maxn')!.outputs[0]).toBe(-1);
    });

    it('filters non-numeric values before finding maximum', () => {
      // [3, 'x', 1, null, 5] → [3, 1, 5], max = 5
      const nodes = {
        src: srcArray('src', [3, 'x', 1, null, 5] as unknown[]),
        maxn: makeNode('maxn', 'max-array'),
      };
      const conns = { c1: makeConn('c1', 'src', 0, 'maxn', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('maxn')!.outputs[0]).toBe(5);
    });
  });
});

// ===========================================================================
// 2. 3D Math Processors
// ===========================================================================

describe('Phase 15 — 3D Math Processors', () => {

  // -------------------------------------------------------------------------
  // dot-product
  // -------------------------------------------------------------------------
  describe('dot-product processor', () => {
    it('returns 0 for perpendicular unit vectors', () => {
      // [1,0,0] · [0,1,0] = 0
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('a', 1, 0, 0);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('b', 0, 1, 0);
      const dp = makeNode('dp', 'dot-product');
      const nodes = { ...na, ...nb, dp };
      const conns = {
        ...ca, ...cb,
        cda: makeConn('cda', va, 0, 'dp', 0),
        cdb: makeConn('cdb', vb, 0, 'dp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('dp')!.outputs[0]).toBe(0);
    });

    it('computes dot product of two general vectors', () => {
      // [1,2,3] · [4,5,6] = 4+10+18 = 32
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('a', 1, 2, 3);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('b', 4, 5, 6);
      const dp = makeNode('dp', 'dot-product');
      const nodes = { ...na, ...nb, dp };
      const conns = {
        ...ca, ...cb,
        cda: makeConn('cda', va, 0, 'dp', 0),
        cdb: makeConn('cdb', vb, 0, 'dp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('dp')!.outputs[0]).toBe(32);
    });

    it('returns 0 for zero vectors', () => {
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('a', 0, 0, 0);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('b', 0, 0, 0);
      const dp = makeNode('dp', 'dot-product');
      const nodes = { ...na, ...nb, dp };
      const conns = {
        ...ca, ...cb,
        cda: makeConn('cda', va, 0, 'dp', 0),
        cdb: makeConn('cdb', vb, 0, 'dp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('dp')!.outputs[0]).toBe(0);
    });

    it('falls back to [0,0,0] for non-array inputs', () => {
      // Source node outputs a number (42), not an array — should treat as [0,0,0]
      const nodes = {
        a: srcNum('a', 42),
        b: srcNum('b', 7),
        dp: makeNode('dp', 'dot-product'),
      };
      const conns = {
        ca: makeConn('ca', 'a', 0, 'dp', 0),
        cb: makeConn('cb', 'b', 0, 'dp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('dp')!.outputs[0]).toBe(0);
    });

    it('computes dot product of parallel unit vectors as 1', () => {
      // [1,0,0] · [1,0,0] = 1
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('a', 1, 0, 0);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('b', 1, 0, 0);
      const dp = makeNode('dp', 'dot-product');
      const nodes = { ...na, ...nb, dp };
      const conns = {
        ...ca, ...cb,
        cda: makeConn('cda', va, 0, 'dp', 0),
        cdb: makeConn('cdb', vb, 0, 'dp', 1),
      };
      const r = exec(nodes, conns);
      expect(r.results.get('dp')!.outputs[0]).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // cross-product
  // -------------------------------------------------------------------------
  describe('cross-product processor', () => {
    it('computes cross product of X and Y unit vectors to get Z', () => {
      // [1,0,0] × [0,1,0] = [0,0,1]
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('a', 1, 0, 0);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('b', 0, 1, 0);
      const cp = makeNode('cp', 'cross-product');
      const nodes = { ...na, ...nb, cp };
      const conns = {
        ...ca, ...cb,
        cpa: makeConn('cpa', va, 0, 'cp', 0),
        cpb: makeConn('cpb', vb, 0, 'cp', 1),
      };
      const r = exec(nodes, conns);
      const out = r.results.get('cp')!.outputs[0] as number[];
      expect(out[0]).toBeCloseTo(0);
      expect(out[1]).toBeCloseTo(0);
      expect(out[2]).toBeCloseTo(1);
    });

    it('computes cross product of Z and X to get Y', () => {
      // [0,0,1] × [1,0,0] = [0,1,0]
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('za', 0, 0, 1);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('xb', 1, 0, 0);
      const cp = makeNode('cpzx', 'cross-product');
      const nodes = { ...na, ...nb, cpzx: cp };
      const conns = {
        ...ca, ...cb,
        cpa: makeConn('cpzxa', va, 0, 'cpzx', 0),
        cpb: makeConn('cpzxb', vb, 0, 'cpzx', 1),
      };
      const r = exec(nodes, conns);
      const out = r.results.get('cpzx')!.outputs[0] as number[];
      expect(out[0]).toBeCloseTo(0);
      expect(out[1]).toBeCloseTo(1);
      expect(out[2]).toBeCloseTo(0);
    });

    it('returns [0,0,0] for parallel vectors', () => {
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('pa', 1, 0, 0);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('pb', 2, 0, 0);
      const cp = makeNode('cpp', 'cross-product');
      const nodes = { ...na, ...nb, cpp: cp };
      const conns = {
        ...ca, ...cb,
        cpa: makeConn('cppa', va, 0, 'cpp', 0),
        cpb: makeConn('cppb', vb, 0, 'cpp', 1),
      };
      const r = exec(nodes, conns);
      const out = r.results.get('cpp')!.outputs[0] as number[];
      expect(out[0]).toBeCloseTo(0);
      expect(out[1]).toBeCloseTo(0);
      expect(out[2]).toBeCloseTo(0);
    });

    it('returns [0,0,0] for zero vectors', () => {
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('za', 0, 0, 0);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('zb', 0, 0, 0);
      const cp = makeNode('cpz', 'cross-product');
      const nodes = { ...na, ...nb, cpz: cp };
      const conns = {
        ...ca, ...cb,
        cpa: makeConn('cpza', va, 0, 'cpz', 0),
        cpb: makeConn('cpzb', vb, 0, 'cpz', 1),
      };
      const r = exec(nodes, conns);
      const out = r.results.get('cpz')!.outputs[0] as number[];
      expect(out).toEqual([0, 0, 0]);
    });

    it('returns an array (vector3) output', () => {
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('ga', 1, 2, 3);
      const { nodes: nb, connections: cb, vecId: vb } = makeVec3Graph('gb', 4, 5, 6);
      const cp = makeNode('cpg', 'cross-product');
      const nodes = { ...na, ...nb, cpg: cp };
      const conns = {
        ...ca, ...cb,
        cpa: makeConn('cpga', va, 0, 'cpg', 0),
        cpb: makeConn('cpgb', vb, 0, 'cpg', 1),
      };
      const r = exec(nodes, conns);
      const out = r.results.get('cpg')!.outputs[0];
      expect(Array.isArray(out)).toBe(true);
      expect((out as number[]).length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // normalize-vec3
  // -------------------------------------------------------------------------
  describe('normalize-vec3 processor', () => {
    it('normalizes a vector along the X axis', () => {
      // [3,0,0] → [1,0,0]
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('nx', 3, 0, 0);
      const norm = makeNode('normx', 'normalize-vec3');
      const nodes = { ...na, normx: norm };
      const conns = { ...ca, cnx: makeConn('cnx', va, 0, 'normx', 0) };
      const r = exec(nodes, conns);
      const out = r.results.get('normx')!.outputs[0] as number[];
      expect(out[0]).toBeCloseTo(1);
      expect(out[1]).toBeCloseTo(0);
      expect(out[2]).toBeCloseTo(0);
    });

    it('normalizes a diagonal vector to unit length', () => {
      // [1,1,1] → [1/√3, 1/√3, 1/√3]
      const inv = 1 / Math.sqrt(3);
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('nd', 1, 1, 1);
      const norm = makeNode('normd', 'normalize-vec3');
      const nodes = { ...na, normd: norm };
      const conns = { ...ca, cnd: makeConn('cnd', va, 0, 'normd', 0) };
      const r = exec(nodes, conns);
      const out = r.results.get('normd')!.outputs[0] as number[];
      expect(out[0]).toBeCloseTo(inv);
      expect(out[1]).toBeCloseTo(inv);
      expect(out[2]).toBeCloseTo(inv);
    });

    it('returns [0,0,0] for a zero vector (avoids division by zero)', () => {
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('nz', 0, 0, 0);
      const norm = makeNode('normz', 'normalize-vec3');
      const nodes = { ...na, normz: norm };
      const conns = { ...ca, cnz: makeConn('cnz', va, 0, 'normz', 0) };
      const r = exec(nodes, conns);
      const out = r.results.get('normz')!.outputs[0] as number[];
      expect(out).toEqual([0, 0, 0]);
    });

    it('resulting vector has unit length (magnitude ~1)', () => {
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('nm', 3, 4, 0);
      const norm = makeNode('normm', 'normalize-vec3');
      const nodes = { ...na, normm: norm };
      const conns = { ...ca, cnm: makeConn('cnm', va, 0, 'normm', 0) };
      const r = exec(nodes, conns);
      const out = r.results.get('normm')!.outputs[0] as number[];
      const mag = Math.sqrt(out[0] ** 2 + out[1] ** 2 + out[2] ** 2);
      expect(mag).toBeCloseTo(1);
    });

    it('falls back to [0,0,0] output for non-array input', () => {
      // Scalar input → treated as [0,0,0] → zero vector → returns [0,0,0]
      const nodes = {
        a: srcNum('a', 5),
        norm: makeNode('norm', 'normalize-vec3'),
      };
      const conns = { ca: makeConn('ca', 'a', 0, 'norm', 0) };
      const r = exec(nodes, conns);
      const out = r.results.get('norm')!.outputs[0] as number[];
      expect(out).toEqual([0, 0, 0]);
    });
  });

  // -------------------------------------------------------------------------
  // vec3-length
  // -------------------------------------------------------------------------
  describe('vec3-length processor', () => {
    it('computes length of a 3-4-0 right triangle', () => {
      // [3,4,0] → √(9+16+0) = 5
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('l1', 3, 4, 0);
      const len = makeNode('len1', 'vec3-length');
      const nodes = { ...na, len1: len };
      const conns = { ...ca, cl1: makeConn('cl1', va, 0, 'len1', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('len1')!.outputs[0]).toBe(5);
    });

    it('returns 0 for a zero vector', () => {
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('lz', 0, 0, 0);
      const len = makeNode('lenz', 'vec3-length');
      const nodes = { ...na, lenz: len };
      const conns = { ...ca, clz: makeConn('clz', va, 0, 'lenz', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('lenz')!.outputs[0]).toBe(0);
    });

    it('computes length of a diagonal unit cube vector', () => {
      // [1,1,1] → √3
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('ld', 1, 1, 1);
      const len = makeNode('lend', 'vec3-length');
      const nodes = { ...na, lend: len };
      const conns = { ...ca, cld: makeConn('cld', va, 0, 'lend', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('lend')!.outputs[0]).toBeCloseTo(Math.sqrt(3));
    });

    it('computes length of a unit X vector as 1', () => {
      const { nodes: na, connections: ca, vecId: va } = makeVec3Graph('lx', 1, 0, 0);
      const len = makeNode('lenx', 'vec3-length');
      const nodes = { ...na, lenx: len };
      const conns = { ...ca, clx: makeConn('clx', va, 0, 'lenx', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('lenx')!.outputs[0]).toBe(1);
    });

    it('falls back to length 0 for non-array input', () => {
      const nodes = {
        a: srcNum('a', 42),
        len: makeNode('len', 'vec3-length'),
      };
      const conns = { ca: makeConn('ca', 'a', 0, 'len', 0) };
      const r = exec(nodes, conns);
      expect(r.results.get('len')!.outputs[0]).toBe(0);
    });
  });
});

// ===========================================================================
// 3. Execution History
// ===========================================================================

describe('Phase 15 — Execution History', () => {
  beforeEach(() => {
    resetStore();
  });

  it('starts with an empty executionHistory and index -1 (live)', () => {
    expect(getState().executionHistory).toHaveLength(0);
    expect(getState().executionHistoryIndex).toBe(-1);
  });

  it('populates executionHistory after executeGraph runs', () => {
    const state = getState();
    state.addNode('source', [0, 0, 0]);
    state.executeGraph();
    expect(getState().executionHistory).toHaveLength(1);
  });

  it('each history entry has required fields', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    const entry = getState().executionHistory[0];
    expect(typeof entry.id).toBe('number');
    expect(typeof entry.timestamp).toBe('number');
    expect(typeof entry.nodeOutputs).toBe('object');
    expect(typeof entry.metrics).toBe('object');
    expect(typeof entry.errors).toBe('object');
    expect(typeof entry.totalDuration).toBe('number');
    expect(typeof entry.waveCount).toBe('number');
    expect(typeof entry.nodeCount).toBe('number');
  });

  it('records the correct nodeCount in history entry', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.addNode('source', [2, 0, 0]);
    st.executeGraph();
    const entry = getState().executionHistory[0];
    expect(entry.nodeCount).toBe(2);
  });

  it('accumulates multiple entries across multiple executions', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    // executeGraph sets isExecuting=true; must reset between calls for synchronous tests
    st.executeGraph();
    st.resetExecution();
    st.executeGraph();
    st.resetExecution();
    st.executeGraph();
    expect(getState().executionHistory).toHaveLength(3);
  });

  it('resets executionHistoryIndex to -1 (live) after each execution', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    st.resetExecution();
    st.executeGraph();
    // Index should be live (-1) after the most recent execution
    expect(getState().executionHistoryIndex).toBe(-1);
  });

  it('scrubExecutionHistory(0) sets index to 0 and restores outputs', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    const entry = getState().executionHistory[0];
    st.resetExecution();
    st.executeGraph();
    // Scrub to first entry
    getState().scrubExecutionHistory(0);
    const s = getState();
    expect(s.executionHistoryIndex).toBe(0);
    // Restored outputs should match entry 0's outputs
    expect(s.nodeOutputs).toEqual(entry.nodeOutputs);
  });

  it('scrubExecutionHistory(-1) returns to live view', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    getState().scrubExecutionHistory(0);
    expect(getState().executionHistoryIndex).toBe(0);
    getState().scrubExecutionHistory(-1);
    expect(getState().executionHistoryIndex).toBe(-1);
  });

  it('scrubExecutionHistory with out-of-bounds index returns to live', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    // Index 99 is way out of bounds
    getState().scrubExecutionHistory(99);
    expect(getState().executionHistoryIndex).toBe(-1);
  });

  it('clearExecutionHistory empties the history array', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    st.resetExecution();
    st.executeGraph();
    expect(getState().executionHistory).toHaveLength(2);
    getState().clearExecutionHistory();
    expect(getState().executionHistory).toHaveLength(0);
    expect(getState().executionHistoryIndex).toBe(-1);
  });

  it('history entries have monotonically increasing IDs', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    st.resetExecution();
    st.executeGraph();
    st.resetExecution();
    st.executeGraph();
    const history = getState().executionHistory;
    expect(history[0].id).toBeLessThan(history[1].id);
    expect(history[1].id).toBeLessThan(history[2].id);
  });

  it('does not add history entry when no nodes exist', () => {
    // Store is empty (resetStore already ran)
    getState().executeGraph();
    expect(getState().executionHistory).toHaveLength(0);
  });

  it('scrubExecutionHistory restores metrics from the entry', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    const entry = getState().executionHistory[0];
    // Reset and execute again so there are 2 entries; scrub back to 0
    st.resetExecution();
    st.executeGraph();
    getState().scrubExecutionHistory(0);
    expect(getState().executionMetrics).toEqual(entry.metrics);
  });

  it('scrubExecutionHistory restores totalDuration from the entry', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    const entry = getState().executionHistory[0];
    st.resetExecution();
    st.executeGraph();
    getState().scrubExecutionHistory(0);
    expect(getState().executionTotalDuration).toBe(entry.totalDuration);
  });

  it('clearExecutionHistory also resets index to -1', () => {
    const st = getState();
    st.addNode('source', [0, 0, 0]);
    st.executeGraph();
    getState().scrubExecutionHistory(0);
    expect(getState().executionHistoryIndex).toBe(0);
    getState().clearExecutionHistory();
    expect(getState().executionHistoryIndex).toBe(-1);
  });
});

// ===========================================================================
// 4. Undo History Browser
// ===========================================================================

describe('Phase 15 — Undo History Browser', () => {
  beforeEach(() => {
    resetStore();
  });

  it('getUndoHistory returns empty stacks on fresh store', () => {
    const history = getState().getUndoHistory();
    expect(history.undo).toHaveLength(0);
    expect(history.redo).toHaveLength(0);
  });

  it('undo stack grows after addNode (which pushes undo)', () => {
    getState().addNode('source', [0, 0, 0]);
    const history = getState().getUndoHistory();
    expect(history.undo.length).toBe(1);
  });

  it('undo stack grows with each action that pushes undo', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);
    getState().addNode('filter', [4, 0, 0]);
    const history = getState().getUndoHistory();
    expect(history.undo.length).toBe(3);
  });

  it('each UndoMeta entry has label, timestamp, nodeCount, connectionCount', () => {
    getState().addNode('source', [0, 0, 0]);
    const meta = getState().getUndoHistory().undo[0];
    expect(typeof meta.label).toBe('string');
    expect(typeof meta.timestamp).toBe('number');
    expect(typeof meta.nodeCount).toBe('number');
    expect(typeof meta.connectionCount).toBe('number');
  });

  it('after undo, meta entry moves from undo stack to redo stack', () => {
    getState().addNode('source', [0, 0, 0]);
    const undoBefore = getState().getUndoHistory().undo.length;
    const redoBefore = getState().getUndoHistory().redo.length;

    getState().undo();

    const history = getState().getUndoHistory();
    expect(history.undo.length).toBe(undoBefore - 1);
    expect(history.redo.length).toBe(redoBefore + 1);
  });

  it('after redo, meta entry moves from redo stack back to undo stack', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().undo();

    const undoBefore = getState().getUndoHistory().undo.length;
    const redoBefore = getState().getUndoHistory().redo.length;

    getState().redo();

    const history = getState().getUndoHistory();
    expect(history.undo.length).toBe(undoBefore + 1);
    expect(history.redo.length).toBe(redoBefore - 1);
  });

  it('new action clears redo meta stack', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().undo();
    expect(getState().getUndoHistory().redo.length).toBeGreaterThan(0);

    // New action should clear redo stack
    getState().addNode('transform', [2, 0, 0]);
    expect(getState().getUndoHistory().redo.length).toBe(0);
  });

  it('jumpToUndo with invalid index (out of range) is a no-op', () => {
    getState().addNode('source', [0, 0, 0]);
    const nodesBefore = Object.keys(getState().nodes).length;

    // Index 99 doesn't exist, should not crash or change anything
    getState().jumpToUndo(99);
    expect(Object.keys(getState().nodes).length).toBe(nodesBefore);
  });

  it('jumpToUndo moves back in history and transfers entries to redo', () => {
    // Add 3 nodes to create 3 undo entries
    getState().addNode('source', [0, 0, 0]);   // undo[0]
    getState().addNode('transform', [2, 0, 0]); // undo[1]
    getState().addNode('filter', [4, 0, 0]);    // undo[2]

    expect(getState().getUndoHistory().undo.length).toBe(3);
    // Jump to entry 0 — stepsBack = 2
    // i=0: push current → redo (no undo pop)
    // i=1: pop undo[2] → redo
    // post-loop: pop snap1 → restore (consumed)
    // Result: undo = [snap0], redo = [current, snap2]
    getState().jumpToUndo(0);

    const history = getState().getUndoHistory();
    expect(history.undo.length).toBeLessThan(3);
    expect(history.redo.length).toBe(2);
    // Graph should have fewer nodes (state was restored to an earlier point)
    expect(Object.keys(getState().nodes).length).toBeLessThan(3);
  });

  it('after jumpToUndo, redo stack contains intermediate entries', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [2, 0, 0]);
    getState().addNode('filter', [4, 0, 0]);

    const undoLen = getState().getUndoHistory().undo.length;
    // Jump to 0 — all others go to redo
    getState().jumpToUndo(0);
    const redoLen = getState().getUndoHistory().redo.length;
    // Redo should have the states we jumped over plus current
    expect(redoLen).toBeGreaterThan(0);
    // Total undo + redo should be close to original undo count
    const undoNow = getState().getUndoHistory().undo.length;
    expect(undoNow + redoLen).toBeGreaterThanOrEqual(undoLen);
  });

  it('undo meta label reflects the action that pushed it', () => {
    // addNode internally calls pushUndo with 'Add node' label
    getState().addNode('source', [0, 0, 0]);
    const meta = getState().getUndoHistory().undo[0];
    expect(meta.label).toBe('Add node');
  });

  it('undo meta nodeCount reflects state before action', () => {
    // Before first addNode: 0 nodes
    getState().addNode('source', [0, 0, 0]);
    // The snapshot pushed before addNode had 0 nodes
    const meta = getState().getUndoHistory().undo[0];
    expect(meta.nodeCount).toBe(0);
  });

  it('undo meta timestamp is a recent unix timestamp', () => {
    const before = Date.now();
    getState().addNode('source', [0, 0, 0]);
    const after = Date.now();
    const meta = getState().getUndoHistory().undo[0];
    expect(meta.timestamp).toBeGreaterThanOrEqual(before);
    expect(meta.timestamp).toBeLessThanOrEqual(after);
  });

  it('deleteSelected pushes an undo entry', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    // Select the node first so deleteSelected actually deletes it
    getState().setSelection(new Set([id]));
    const undoBefore = getState().getUndoHistory().undo.length;
    getState().deleteSelected();
    const undoAfter = getState().getUndoHistory().undo.length;
    expect(undoAfter).toBe(undoBefore + 1);
    // Node should be gone
    expect(getState().nodes[id]).toBeUndefined();
  });

  it('getUndoHistory returns independent copies (not live references)', () => {
    getState().addNode('source', [0, 0, 0]);
    const h1 = getState().getUndoHistory();
    const len1 = h1.undo.length;

    getState().addNode('transform', [2, 0, 0]);
    // h1 should NOT reflect the new addition (it's a snapshot copy)
    expect(h1.undo.length).toBe(len1);
    // A fresh call should show the new length
    expect(getState().getUndoHistory().undo.length).toBe(len1 + 1);
  });
});

// ===========================================================================
// 5. NODE_TYPE_CONFIG / NODE_CATEGORIES Correctness
// ===========================================================================

describe('Phase 15 — Node Type Config Correctness', () => {
  const NEW_STATS_TYPES: NodeType[] = ['mean', 'median', 'stddev', 'min-array', 'max-array'];
  const NEW_VECTOR_TYPES: NodeType[] = ['dot-product', 'cross-product', 'normalize-vec3', 'vec3-length'];
  const ALL_NEW_TYPES: NodeType[] = [...NEW_VECTOR_TYPES, ...NEW_STATS_TYPES];

  it('all 9 new types exist in NODE_TYPE_CONFIG', () => {
    for (const type of ALL_NEW_TYPES) {
      expect(NODE_TYPE_CONFIG[type], `Missing config for ${type}`).toBeDefined();
    }
  });

  it('all 5 statistics types are categorized as Math', () => {
    for (const type of NEW_STATS_TYPES) {
      expect(NODE_CATEGORIES[type], `Wrong category for ${type}`).toBe('Math');
    }
  });

  it('all 4 vector types are categorized as Vector', () => {
    for (const type of NEW_VECTOR_TYPES) {
      expect(NODE_CATEGORIES[type], `Wrong category for ${type}`).toBe('Vector');
    }
  });

  it('statistics types have exactly 1 input (portType array) and 1 output (portType number)', () => {
    for (const type of NEW_STATS_TYPES) {
      const config = NODE_TYPE_CONFIG[type];
      expect(config.inputs.length, `${type} should have 1 input`).toBe(1);
      expect(config.inputs[0].portType, `${type} input should be array`).toBe('array');
      expect(config.outputs.length, `${type} should have 1 output`).toBe(1);
      expect(config.outputs[0].portType, `${type} output should be number`).toBe('number');
    }
  });

  it('dot-product has 2 vector3 inputs and 1 number output', () => {
    const config = NODE_TYPE_CONFIG['dot-product'];
    expect(config.inputs.length).toBe(2);
    expect(config.inputs[0].portType).toBe('vector3');
    expect(config.inputs[1].portType).toBe('vector3');
    expect(config.outputs.length).toBe(1);
    expect(config.outputs[0].portType).toBe('number');
  });

  it('cross-product has 2 vector3 inputs and 1 vector3 output', () => {
    const config = NODE_TYPE_CONFIG['cross-product'];
    expect(config.inputs.length).toBe(2);
    expect(config.inputs[0].portType).toBe('vector3');
    expect(config.inputs[1].portType).toBe('vector3');
    expect(config.outputs.length).toBe(1);
    expect(config.outputs[0].portType).toBe('vector3');
  });

  it('normalize-vec3 has 1 vector3 input and 1 vector3 output', () => {
    const config = NODE_TYPE_CONFIG['normalize-vec3'];
    expect(config.inputs.length).toBe(1);
    expect(config.inputs[0].portType).toBe('vector3');
    expect(config.outputs.length).toBe(1);
    expect(config.outputs[0].portType).toBe('vector3');
  });

  it('vec3-length has 1 vector3 input and 1 number output', () => {
    const config = NODE_TYPE_CONFIG['vec3-length'];
    expect(config.inputs.length).toBe(1);
    expect(config.inputs[0].portType).toBe('vector3');
    expect(config.outputs.length).toBe(1);
    expect(config.outputs[0].portType).toBe('number');
  });

  it('addNode creates mean node with correct title', () => {
    resetStore();
    const id = getState().addNode('mean', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Mean');
  });

  it('addNode creates median node with correct title', () => {
    resetStore();
    const id = getState().addNode('median', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Median');
  });

  it('addNode creates stddev node with correct title', () => {
    resetStore();
    const id = getState().addNode('stddev', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Std Dev');
  });

  it('addNode creates min-array node with correct title', () => {
    resetStore();
    const id = getState().addNode('min-array', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Min Array');
  });

  it('addNode creates max-array node with correct title', () => {
    resetStore();
    const id = getState().addNode('max-array', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Max Array');
  });

  it('addNode creates dot-product node with correct title', () => {
    resetStore();
    const id = getState().addNode('dot-product', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Dot Product');
  });

  it('addNode creates cross-product node with correct title', () => {
    resetStore();
    const id = getState().addNode('cross-product', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Cross Product');
  });

  it('addNode creates normalize-vec3 node with correct title', () => {
    resetStore();
    const id = getState().addNode('normalize-vec3', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Normalize Vec3');
  });

  it('addNode creates vec3-length node with correct title', () => {
    resetStore();
    const id = getState().addNode('vec3-length', [0, 0, 0]);
    const node = getState().nodes[id];
    expect(node.title).toBe('Vec3 Length');
  });
});
