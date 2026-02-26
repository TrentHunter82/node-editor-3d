import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';

const NODE_DURATION = 400;

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
    debugMode: false,
    pausedAtWave: -1,
    debugWaves: [],
    traceNodeId: null,
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

describe('Execution Debugger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('toggleDebugMode', () => {
    it('defaults to false', () => {
      expect(getState().debugMode).toBe(false);
    });

    it('toggles debug mode on', () => {
      getState().toggleDebugMode();
      expect(getState().debugMode).toBe(true);
    });

    it('toggles debug mode off', () => {
      getState().toggleDebugMode();
      getState().toggleDebugMode();
      expect(getState().debugMode).toBe(false);
    });
  });

  describe('executeGraph in debug mode', () => {
    it('stores waves and pauses at wave -1 (before first wave)', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().toggleDebugMode();
      getState().executeGraph();

      expect(getState().isExecuting).toBe(true);
      expect(getState().pausedAtWave).toBe(-1);
      expect(getState().debugWaves.length).toBeGreaterThanOrEqual(2);
    });

    it('does not animate nodes immediately (waits for step)', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      getState().toggleDebugMode();
      getState().executeGraph();

      // No timers should fire - debug mode waits for stepExecution
      vi.advanceTimersByTime(5000);
      // Node should still be in initial 'idle' state, not 'complete'
      expect(getState().executionStates[src]).toBe('idle');
    });
  });

  describe('stepExecution', () => {
    it('no-ops when not executing', () => {
      getState().stepExecution();
      expect(getState().pausedAtWave).toBe(-1);
    });

    it('no-ops when debug mode is off', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().executeGraph(); // normal mode
      getState().stepExecution();
      // Should not change anything - normal execution handles itself
      expect(getState().pausedAtWave).toBe(-1);
    });

    it('advances to wave 0 on first step', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().toggleDebugMode();
      getState().executeGraph();

      getState().stepExecution();
      expect(getState().pausedAtWave).toBe(0);
      // Source should be set to 'running'
      expect(getState().executionStates[src]).toBe('running');
    });

    it('wave 0 nodes become complete after NODE_DURATION', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().toggleDebugMode();
      getState().executeGraph();
      getState().stepExecution(); // wave 0

      vi.advanceTimersByTime(NODE_DURATION);
      expect(getState().executionStates[src]).toBe('complete');
      // Transform should still be idle (not yet stepped)
      expect(getState().executionStates[xfm]).toBe('idle');
    });

    it('second step advances to wave 1', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().toggleDebugMode();
      getState().executeGraph();

      getState().stepExecution(); // wave 0
      vi.advanceTimersByTime(NODE_DURATION);

      getState().stepExecution(); // wave 1
      expect(getState().pausedAtWave).toBe(1);
      expect(getState().executionStates[xfm]).toBe('running');
    });

    it('stepping past last wave stops execution', () => {
      getState().addNode('source', [0, 0, 0]);

      getState().toggleDebugMode();
      getState().executeGraph();

      getState().stepExecution(); // wave 0
      vi.advanceTimersByTime(NODE_DURATION);

      getState().stepExecution(); // past last wave
      expect(getState().isExecuting).toBe(false);
      expect(getState().pausedAtWave).toBe(-1);
      expect(getState().debugWaves).toEqual([]);
    });

    it('steps through 3-wave chain correctly', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const out = getState().addNode('output', [10, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);
      getState().addConnection(xfm, 0, out, 0);

      getState().toggleDebugMode();
      getState().executeGraph();
      expect(getState().debugWaves).toHaveLength(3);

      // Step wave 0 (source)
      getState().stepExecution();
      expect(getState().pausedAtWave).toBe(0);
      expect(getState().executionStates[src]).toBe('running');
      vi.advanceTimersByTime(NODE_DURATION);
      expect(getState().executionStates[src]).toBe('complete');

      // Step wave 1 (transform)
      getState().stepExecution();
      expect(getState().pausedAtWave).toBe(1);
      expect(getState().executionStates[xfm]).toBe('running');
      vi.advanceTimersByTime(NODE_DURATION);
      expect(getState().executionStates[xfm]).toBe('complete');

      // Step wave 2 (output)
      getState().stepExecution();
      expect(getState().pausedAtWave).toBe(2);
      expect(getState().executionStates[out]).toBe('running');
      vi.advanceTimersByTime(NODE_DURATION);
      expect(getState().executionStates[out]).toBe('complete');

      // Step past end
      getState().stepExecution();
      expect(getState().isExecuting).toBe(false);
    });
  });

  describe('resumeExecution', () => {
    it('no-ops when not executing', () => {
      getState().resumeExecution();
      expect(getState().isExecuting).toBe(false);
    });

    it('no-ops when debug mode is off', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().executeGraph();
      getState().resumeExecution();
      // Normal execution continues on its own
    });

    it('resumes remaining waves after stepping', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      const out = getState().addNode('output', [10, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);
      getState().addConnection(xfm, 0, out, 0);

      getState().toggleDebugMode();
      getState().executeGraph();

      // Step through wave 0 only
      getState().stepExecution();
      vi.advanceTimersByTime(NODE_DURATION);
      expect(getState().executionStates[src]).toBe('complete');

      // Resume remaining waves (1 and 2)
      getState().resumeExecution();

      // Advance enough time for remaining waves
      vi.advanceTimersByTime(5000);

      expect(getState().executionStates[xfm]).toBe('complete');
      expect(getState().executionStates[out]).toBe('complete');
      expect(getState().isExecuting).toBe(false);
    });

    it('resumes from start if no steps taken', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xfm = getState().addNode('transform', [5, 0, 0]);
      getState().addConnection(src, 0, xfm, 0);

      getState().toggleDebugMode();
      getState().executeGraph();

      // Resume without any steps
      getState().resumeExecution();
      vi.advanceTimersByTime(5000);

      expect(getState().executionStates[src]).toBe('complete');
      expect(getState().executionStates[xfm]).toBe('complete');
      expect(getState().isExecuting).toBe(false);
    });
  });

  describe('debugger state clearing', () => {
    it('undo clears debugWaves and pausedAtWave', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().toggleDebugMode();
      getState().executeGraph();
      expect(getState().debugWaves.length).toBeGreaterThan(0);

      // Do another action to make undo possible
      getState().addNode('transform', [5, 0, 0]);
      getState().undo();

      expect(getState().pausedAtWave).toBe(-1);
      expect(getState().debugWaves).toEqual([]);
    });

    it('resetExecution clears debug state', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().toggleDebugMode();
      getState().executeGraph();
      getState().stepExecution();
      expect(getState().pausedAtWave).toBe(0);

      getState().resetExecution();
      expect(getState().pausedAtWave).toBe(-1);
      expect(getState().debugWaves).toEqual([]);
      expect(getState().isExecuting).toBe(false);
    });

    it('clearGraph clears debug state', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().toggleDebugMode();
      getState().executeGraph();

      getState().clearGraph();
      expect(getState().pausedAtWave).toBe(-1);
      expect(getState().debugWaves).toEqual([]);
    });
  });
});

describe('Data Flow Tracing (store)', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('setTraceNode', () => {
    it('defaults to null', () => {
      expect(getState().traceNodeId).toBeNull();
    });

    it('sets trace node ID', () => {
      const src = getState().addNode('source');
      getState().setTraceNode(src);
      expect(getState().traceNodeId).toBe(src);
    });

    it('clears trace node with null', () => {
      const src = getState().addNode('source');
      getState().setTraceNode(src);
      getState().setTraceNode(null);
      expect(getState().traceNodeId).toBeNull();
    });

    it('can switch trace between nodes', () => {
      const src = getState().addNode('source');
      const xfm = getState().addNode('transform');
      getState().setTraceNode(src);
      expect(getState().traceNodeId).toBe(src);

      getState().setTraceNode(xfm);
      expect(getState().traceNodeId).toBe(xfm);
    });
  });
});
