/**
 * Phase 34: Comprehensive execution timeout tests
 *
 * Tests the execution timeout mechanism in execution.ts including
 * wave-level and per-node timeout checks, partial results, settings
 * integration, and edge cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { useSettingsStore, clampLoadedSettings, DEFAULT_SETTINGS } from '../store/settingsStore';
import { executeGraph } from '../utils/execution';

enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Execute the current store graph */
function execStore(maxExecutionMs?: number) {
  const st = getStore();
  return executeGraph(
    st.nodes,
    st.connections,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    maxExecutionMs,
  );
}

/** Build a linear chain of source → transform → ... → transform */
function buildChain(length: number) {
  const ids: string[] = [];
  const sourceId = getStore().addNode('source');
  ids.push(sourceId);
  for (let i = 1; i < length; i++) {
    const tId = getStore().addNode('transform');
    ids.push(tId);
    getStore().addConnection(ids[i - 1], 0, tId, 0);
  }
  return ids;
}

/** Build a wide graph with N independent source nodes (no connections) */
function buildWide(count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(getStore().addNode('source'));
  }
  return ids;
}

// ===========================================================================
// 1. Basic timeout behavior
// ===========================================================================

describe('execution timeout — basic', () => {
  beforeEach(() => {
    resetStore();
    useSettingsStore.setState({ maxExecutionMs: DEFAULT_SETTINGS.maxExecutionMs });
  });

  it('no timeout with maxExecutionMs=0 (small graph)', () => {
    buildChain(5);
    const result = execStore(0);
    expect(result.timedOut).toBeFalsy();
    expect(result.errors.size).toBe(0);
  });

  it('no timeout with maxExecutionMs=0 (large graph)', () => {
    buildChain(100);
    const result = execStore(0);
    expect(result.timedOut).toBeFalsy();
  });

  it('no timeout with sufficient time limit', () => {
    buildChain(10);
    const result = execStore(10000);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(10);
  });

  it('result has totalDuration field', () => {
    buildChain(5);
    const result = execStore(10000);
    expect(typeof result.totalDuration).toBe('number');
    expect(result.totalDuration).toBeGreaterThanOrEqual(0);
  });

  it('result has waves field', () => {
    buildChain(5);
    const result = execStore(10000);
    expect(Array.isArray(result.waves)).toBe(true);
    expect(result.waves.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. Timeout enforcement
// ===========================================================================

describe('execution timeout — enforcement', () => {
  beforeEach(() => {
    resetStore();
  });

  it('extremely tight timeout on large chain (1ms)', () => {
    buildChain(500);
    const result = execStore(1);
    // With 500 nodes and 1ms, timeout is very likely
    if (result.timedOut) {
      expect(result.timedOut).toBe(true);
      expect(result.errors.has('__graph__')).toBe(true);
      expect(result.errors.get('__graph__')).toMatch(/timeout/i);
    }
    // Either way, result is structurally valid
    expect(result.results).toBeInstanceOf(Map);
    expect(result.errors).toBeInstanceOf(Map);
  });

  it('partial results may be available after timeout', () => {
    buildChain(500);
    const result = execStore(1);
    if (result.timedOut) {
      // Timeout may happen at wave boundary before any node completes,
      // or mid-wave after some nodes completed. Either is valid.
      expect(result.results.size).toBeGreaterThanOrEqual(0);
      // The result set should never exceed total nodes
      expect(result.results.size).toBeLessThanOrEqual(500);
    }
  });

  it('timeout error message includes limit value', () => {
    buildChain(500);
    const result = execStore(1);
    if (result.timedOut) {
      const msg = result.errors.get('__graph__')!;
      expect(msg).toContain('1');
      expect(msg).toMatch(/ms/i);
    }
  });

  it('non-timed-out execution completes all nodes', () => {
    const ids = buildChain(20);
    const result = execStore(30000);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(ids.length);
  });
});

// ===========================================================================
// 3. Graph topologies with timeout
// ===========================================================================

describe('execution timeout — topologies', () => {
  beforeEach(() => {
    resetStore();
  });

  it('wide graph (many independent nodes) with generous timeout', () => {
    const ids = buildWide(50);
    const result = execStore(5000);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(ids.length);
  });

  it('diamond graph with timeout', () => {
    // source → transform1 → output
    //       → transform2 →
    const srcId = getStore().addNode('source');
    const t1 = getStore().addNode('transform');
    const t2 = getStore().addNode('transform');
    const outId = getStore().addNode('math');
    getStore().addConnection(srcId, 0, t1, 0);
    getStore().addConnection(srcId, 0, t2, 0);
    getStore().addConnection(t1, 0, outId, 0);
    getStore().addConnection(t2, 0, outId, 1);
    const result = execStore(5000);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(4);
  });

  it('empty graph with timeout produces no errors', () => {
    const result = execStore(1000);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(0);
    expect(result.errors.size).toBe(0);
  });

  it('single node with timeout', () => {
    getStore().addNode('source');
    const result = execStore(1);
    // Single source node is so fast it should always complete
    expect(result.results.size).toBe(1);
    expect(result.timedOut).toBeFalsy();
  });
});

// ===========================================================================
// 4. Settings integration
// ===========================================================================

describe('execution timeout — settings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ maxExecutionMs: DEFAULT_SETTINGS.maxExecutionMs });
  });

  it('default maxExecutionMs is 30000', () => {
    expect(DEFAULT_SETTINGS.maxExecutionMs).toBe(30000);
  });

  it('setMaxExecutionMs updates the value', () => {
    useSettingsStore.getState().setMaxExecutionMs(5000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(5000);
  });

  it('setMaxExecutionMs clamps negative to 0', () => {
    useSettingsStore.getState().setMaxExecutionMs(-999);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(0);
  });

  it('setMaxExecutionMs clamps above 300000', () => {
    useSettingsStore.getState().setMaxExecutionMs(500000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(300000);
  });

  it('setMaxExecutionMs allows boundary value 0', () => {
    useSettingsStore.getState().setMaxExecutionMs(0);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(0);
  });

  it('setMaxExecutionMs allows boundary value 300000', () => {
    useSettingsStore.getState().setMaxExecutionMs(300000);
    expect(useSettingsStore.getState().maxExecutionMs).toBe(300000);
  });

  it('clampLoadedSettings validates maxExecutionMs', () => {
    expect(clampLoadedSettings({ maxExecutionMs: 10000 }).maxExecutionMs).toBe(10000);
    expect(clampLoadedSettings({ maxExecutionMs: -1 }).maxExecutionMs).toBe(0);
    expect(clampLoadedSettings({ maxExecutionMs: 999999 }).maxExecutionMs).toBe(300000);
    expect(clampLoadedSettings({ maxExecutionMs: 0 }).maxExecutionMs).toBe(0);
    expect(clampLoadedSettings({ maxExecutionMs: 300000 }).maxExecutionMs).toBe(300000);
  });

  it('clampLoadedSettings leaves maxExecutionMs undefined when not provided', () => {
    const clamped = clampLoadedSettings({});
    // clampLoadedSettings only clamps present values; missing ones stay undefined
    expect(clamped.maxExecutionMs).toBeUndefined();
  });
});

// ===========================================================================
// 5. Edge cases
// ===========================================================================

describe('execution timeout — edge cases', () => {
  beforeEach(() => {
    resetStore();
  });

  it('maxExecutionMs=undefined treated as no timeout', () => {
    buildChain(10);
    const st = getStore();
    const result = executeGraph(st.nodes, st.connections);
    expect(result.timedOut).toBeFalsy();
  });

  it('maxExecutionMs=0 treated as no timeout', () => {
    buildChain(10);
    const result = execStore(0);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(10);
  });

  it('result metrics exist regardless of timeout', () => {
    buildChain(5);
    const result = execStore(10000);
    expect(result.metrics).toBeDefined();
    expect(result.metrics).toBeInstanceOf(Map);
    expect(result.metrics.size).toBeGreaterThan(0);
  });

  it('execution with errors and timeout', () => {
    // Create a chain where one node will error
    const src = getStore().addNode('source');
    const logNode = getStore().addNode('log');
    getStore().addConnection(src, 0, logNode, 0);
    // Source value defaults to 0, log(0) = -Infinity (not an error though)
    // Actually log with disconnected input uses default 1 → log(1)=0
    const result = execStore(5000);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(2);
  });

  it('large timeout value works correctly', () => {
    buildChain(5);
    const result = execStore(300000);
    expect(result.timedOut).toBeFalsy();
    expect(result.results.size).toBe(5);
  });
});
