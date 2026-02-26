import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';
import { executeGraph as execGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';

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
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    executionMetrics: {},
    executionTotalDuration: 0,
    errorStrategy: 'fail-fast',
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: 0 } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
  });
}

function getState() {
  return useEditorStore.getState();
}

// --- Helper: create plain node objects for direct executeGraph calls ---

function makeSourceNode(id: string, value: number = 0): EditorNode {
  return {
    id,
    type: 'source',
    position: [0, 0, 0],
    title: 'Source',
    data: { value },
    inputs: [],
    outputs: [
      { id: 'out-0', label: 'value', portType: 'number' },
      { id: 'out-1', label: 'label', portType: 'string' },
    ],
  };
}

function makeOutputNode(id: string): EditorNode {
  return {
    id,
    type: 'output',
    position: [10, 0, 0],
    title: 'Output',
    data: {},
    inputs: [
      { id: 'in-0', label: 'data', portType: 'any' },
      { id: 'in-1', label: 'label', portType: 'string' },
    ],
    outputs: [],
  };
}

function makeThrowingNode(id: string): EditorNode {
  return {
    id,
    type: 'custom',
    position: [5, 0, 0],
    title: 'Thrower',
    data: { expression: '(() => { throw new Error("boom") })()' },
    inputs: [{ id: 'in-0', label: 'in', portType: 'any' }],
    outputs: [{ id: 'out-0', label: 'out', portType: 'any' }],
  };
}

function makeConn(
  id: string,
  src: string,
  srcPort: number,
  tgt: string,
  tgtPort: number,
): Connection {
  return {
    id,
    sourceNodeId: src,
    sourcePortIndex: srcPort,
    targetNodeId: tgt,
    targetPortIndex: tgtPort,
  };
}

// ─── Tests ────────────────────────────────────────────────────

describe('Error Recovery (Phase 9)', () => {
  // ─── Store: setErrorStrategy ───────────────────────────────

  describe('setErrorStrategy store action', () => {
    beforeEach(() => {
      resetStore();
    });

    it('defaults to fail-fast', () => {
      expect(getState().errorStrategy).toBe('fail-fast');
    });

    it('sets error strategy to continue', () => {
      getState().setErrorStrategy('continue');
      expect(getState().errorStrategy).toBe('continue');
    });

    it('sets error strategy back to fail-fast', () => {
      getState().setErrorStrategy('continue');
      expect(getState().errorStrategy).toBe('continue');

      getState().setErrorStrategy('fail-fast');
      expect(getState().errorStrategy).toBe('fail-fast');
    });

    it('does NOT push undo', () => {
      getState().setErrorStrategy('continue');
      expect(getState().canUndo()).toBe(false);
    });
  });

  // ─── Direct executeGraph: fail-fast mode ───────────────────

  describe('Direct executeGraph with fail-fast strategy', () => {
    // Chain: source(42) -> thrower -> output
    const nodes: Record<string, EditorNode> = {
      src: makeSourceNode('src', 42),
      thrower: makeThrowingNode('thrower'),
      out: makeOutputNode('out'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'thrower', 0),
      c2: makeConn('c2', 'thrower', 0, 'out', 0),
    };

    it('fail-fast stops execution on first error', () => {
      const result = execGraph(nodes, connections, undefined, undefined, undefined, 'fail-fast');

      // Source should have executed successfully
      expect(result.results.has('src')).toBe(true);
      expect(result.results.get('src')?.outputs[0]).toBe(42);

      // Thrower should have an error entry
      expect(result.errors.has('thrower')).toBe(true);

      // Output should NOT have been processed (fail-fast stops after thrower)
      // It may have a result entry with empty outputs, or no entry at all.
      // In fail-fast, execution returns immediately after the error, so
      // output node is never reached.
      const outResult = result.results.get('out');
      expect(outResult).toBeUndefined();
    });

    it('fail-fast returns partial results', () => {
      const result = execGraph(nodes, connections, undefined, undefined, undefined, 'fail-fast');

      // Source was processed
      expect(result.results.get('src')?.outputs[0]).toBe(42);

      // Thrower has empty outputs (errored)
      expect(result.results.get('thrower')?.outputs).toEqual({});

      // Output was never reached
      expect(result.results.has('out')).toBe(false);
    });

    it('fail-fast includes error in errors map', () => {
      const result = execGraph(nodes, connections, undefined, undefined, undefined, 'fail-fast');

      expect(result.errors.has('thrower')).toBe(true);
      expect(result.errors.get('thrower')).toContain('boom');
    });
  });

  // ─── Direct executeGraph: continue mode ────────────────────

  describe('Direct executeGraph with continue strategy', () => {
    const nodes: Record<string, EditorNode> = {
      src: makeSourceNode('src', 42),
      thrower: makeThrowingNode('thrower'),
      out: makeOutputNode('out'),
    };
    const connections: Record<string, Connection> = {
      c1: makeConn('c1', 'src', 0, 'thrower', 0),
      c2: makeConn('c2', 'thrower', 0, 'out', 0),
    };

    it('continue mode processes all nodes despite errors', () => {
      const result = execGraph(nodes, connections, undefined, undefined, undefined, 'continue');

      // All three nodes should have result entries
      expect(result.results.has('src')).toBe(true);
      expect(result.results.has('thrower')).toBe(true);
      expect(result.results.has('out')).toBe(true);
    });

    it('continue mode records error but continues', () => {
      const result = execGraph(nodes, connections, undefined, undefined, undefined, 'continue');

      // Error is recorded for thrower
      expect(result.errors.has('thrower')).toBe(true);
      expect(result.errors.get('thrower')).toContain('boom');

      // But all nodes have entries in the results map
      expect(result.results.size).toBe(3);
    });

    it('continue mode provides empty outputs for errored nodes', () => {
      const result = execGraph(nodes, connections, undefined, undefined, undefined, 'continue');

      // Thrower's result should have empty outputs
      const throwerResult = result.results.get('thrower');
      expect(throwerResult).toBeDefined();
      expect(throwerResult!.outputs).toEqual({});
    });
  });

  // ─── Store-level error strategy integration ────────────────

  describe('Store-level error strategy integration', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      resetStore();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('store executeGraph uses configured errorStrategy', () => {
      // Set strategy to continue
      getState().setErrorStrategy('continue');

      // Add nodes via store: source -> custom(throws) -> output
      const srcId = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(srcId, 'value', 42);

      const customId = getState().addNode('custom', [5, 0, 0]);
      getState().updateNodeData(customId, 'expression', '(() => { throw new Error("boom") })()');

      const outId = getState().addNode('output', [10, 0, 0]);

      getState().addConnection(srcId, 0, customId, 0);
      getState().addConnection(customId, 0, outId, 0);

      // Execute
      getState().executeGraph();

      // In continue mode, the custom node errors but execution completes all nodes
      // The error should be recorded in executionErrors
      expect(getState().executionErrors[customId]).toBeDefined();
      expect(getState().executionErrors[customId]).toContain('boom');

      // All nodes should get execution states (isExecuting = true means animation started)
      expect(getState().isExecuting).toBe(true);

      // All nodes should have been initialized to idle
      expect(getState().executionStates[srcId]).toBeDefined();
      expect(getState().executionStates[customId]).toBeDefined();
      expect(getState().executionStates[outId]).toBeDefined();

      // Advance through all waves to completion
      // 3 waves (src, custom, out): delay = 3*600 = 1800, final = 1800 + 400 = 2200ms
      vi.advanceTimersByTime(2200);
      expect(getState().isExecuting).toBe(false);

      // After animation cleanup, all execution states are reset to idle
      expect(getState().executionStates[srcId]).toBe('idle');
      expect(getState().executionStates[customId]).toBe('idle');
      expect(getState().executionStates[outId]).toBe('idle');
    });

    it('clearGraph does not reset errorStrategy', () => {
      // Set to continue
      getState().setErrorStrategy('continue');
      expect(getState().errorStrategy).toBe('continue');

      // Add a node so clearGraph has something to clear (it early-returns on empty)
      getState().addNode('source');

      // Clear graph
      getState().clearGraph();

      // errorStrategy is a user preference, not graph data
      // clearGraph does not explicitly reset it, so it should remain 'continue'
      expect(getState().errorStrategy).toBe('continue');
    });
  });
});
