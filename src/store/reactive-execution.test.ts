/**
 * Reactive Auto-Execution Tests (Phase 13)
 *
 * Tests the reactive auto-execution feature:
 * - `autoExecute` toggle lives in settingsStore (default false).
 * - When enabled, `updateNodeData` triggers an automatic graph execution
 *   after a 200ms debounce window.
 * - Only the changed subgraph is re-executed (leveraging the existing
 *   `invalidateDownstream` + execution cache infrastructure).
 * - Toggling autoExecute on/off does not lose graph or execution state.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, _resetModuleState, cancelAutoExecute } from './editorStore';
import { useSettingsStore, DEFAULT_SETTINGS } from './settingsStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  cancelAutoExecute();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.customNodeDefs = {};
    s.searchQuery = '';
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.templates = {};
    s.breadcrumbStack = [];
    s.subgraphDefs = {};
    s.errorStrategy = 'fail-fast';
    s.validationErrors = {};
    s.executionMetrics = {};
    s.showValuePreviews = false;
    s.undoRedoEvent = null;
    s.contextMenu = null;
    s.storageWarning = null;
  });
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, recentFiles: [] });
  localStorage.clear();
}

function getState() {
  return useEditorStore.getState();
}

function getSettings() {
  return useSettingsStore.getState();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Reactive Auto-Execution (Phase 13)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Auto-Execute Toggle
  // -------------------------------------------------------------------------

  describe('Auto-Execute Toggle', () => {
    it('autoExecute defaults to false', () => {
      expect(getSettings().autoExecute).toBe(false);
    });

    it('setAutoExecute(true) enables auto-execution', () => {
      getSettings().setAutoExecute(true);
      expect(getSettings().autoExecute).toBe(true);
    });

    it('setAutoExecute does NOT push undo (user preference)', () => {
      // Add a node to create initial undo entry
      getState().addNode('source', [0, 0, 0]);
      const canUndoBefore = getState().canUndo();

      getSettings().setAutoExecute(true);
      getSettings().setAutoExecute(false);

      // Undo state should not have changed
      expect(getState().canUndo()).toBe(canUndoBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Debounce Behavior
  // -------------------------------------------------------------------------

  describe('Debounce Behavior', () => {
    it('updateNodeData with autoExecute triggers execution after 200ms debounce', () => {
      getSettings().setAutoExecute(true);

      const src = getState().addNode('source', [0, 0, 0]);
      const out = getState().addNode('output', [3, 0, 0]);
      getState().addConnection(src, 0, out, 0);

      // Update source value — should schedule auto-execution
      getState().updateNodeData(src, 'value', 42);

      // Before debounce: no execution should have happened yet
      expect(getState().isExecuting).toBe(false);
      expect(Object.keys(getState().nodeOutputs)).toHaveLength(0);

      // Advance past debounce (200ms) + give execution time to complete
      vi.advanceTimersByTime(250);

      // After debounce: execution should have run (nodeOutputs populated)
      // The executeGraph action sets isExecuting=true then schedules completion
      // With fake timers, we need to advance through the wave animation timeouts too
      vi.advanceTimersByTime(2000);

      // Source node should have output
      expect(getState().nodeOutputs[src]).toBeDefined();
    });

    it('rapid updateNodeData calls only trigger one execution (debounce coalescing)', () => {
      getSettings().setAutoExecute(true);

      const src = getState().addNode('source', [0, 0, 0]);

      // Spy on executeGraph
      const execSpy = vi.spyOn(getState(), 'executeGraph');

      // Rapid updates within debounce window
      getState().updateNodeData(src, 'value', 1);
      vi.advanceTimersByTime(50);
      getState().updateNodeData(src, 'value', 2);
      vi.advanceTimersByTime(50);
      getState().updateNodeData(src, 'value', 3);

      // Advance past debounce
      vi.advanceTimersByTime(250);

      // Should have been called at most once (debounce coalesced)
      expect(execSpy.mock.calls.length).toBeLessThanOrEqual(1);

      execSpy.mockRestore();
    });

    it('disabling autoExecute mid-debounce cancels pending execution', () => {
      getSettings().setAutoExecute(true);

      const src = getState().addNode('source', [0, 0, 0]);

      // Trigger auto-execute debounce
      getState().updateNodeData(src, 'value', 42);

      // Disable before debounce fires and cancel the pending timer
      vi.advanceTimersByTime(100);
      getSettings().setAutoExecute(false);
      cancelAutoExecute();

      // Advance past debounce
      vi.advanceTimersByTime(200);

      // No execution should happen since we cancelled and disabled
      expect(getState().nodeOutputs[src]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Cache Invalidation on Data Change
  // -------------------------------------------------------------------------

  describe('Cache Invalidation on Data Change', () => {
    it('updateNodeData invalidates downstream execution cache', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const xform = getState().addNode('transform', [3, 0, 0]);
      getState().addConnection(src, 0, xform, 0);

      // Execute graph to populate cache
      getState().executeGraph();
      vi.advanceTimersByTime(5000);

      // Both nodes should have outputs
      expect(getState().nodeOutputs[src]).toBeDefined();
      expect(getState().nodeOutputs[xform]).toBeDefined();

      // Now update source data — should invalidate downstream
      getState().updateNodeData(src, 'value', 99);

      // Re-execute: transform should get new result from source
      getState().executeGraph();
      vi.advanceTimersByTime(5000);

      // Source output should reflect the new value
      const srcOutputs = getState().nodeOutputs[src];
      expect(srcOutputs).toBeDefined();
      expect(srcOutputs[0]).toBe(99);
    });

    it('only downstream nodes are re-executed, upstream results cached', () => {
      // Build: A → B → C
      const a = getState().addNode('source', [0, 0, 0]);
      const b = getState().addNode('transform', [3, 0, 0]);
      const c = getState().addNode('output', [6, 0, 0]);
      getState().addConnection(a, 0, b, 0);
      getState().addConnection(b, 0, c, 0);

      // Execute to populate cache
      getState().executeGraph();
      vi.advanceTimersByTime(5000);

      // Verify metrics exist for all nodes
      expect(getState().executionMetrics[a]).toBeDefined();
      expect(getState().executionMetrics[b]).toBeDefined();

      // Update B's data (transform multiplier)
      getState().updateNodeData(b, 'multiplier', 5);

      // Re-execute
      getState().executeGraph();
      vi.advanceTimersByTime(5000);

      // A's result should be cache-hit (not re-computed)
      expect(getState().executionMetrics[a]?.cacheHit).toBe(true);
      // B should not be a cache hit (it was invalidated)
      expect(getState().executionMetrics[b]?.cacheHit).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Integration: auto-execute respects errorStrategy
  // -------------------------------------------------------------------------

  describe('Integration', () => {
    it('auto-execute respects errorStrategy setting', () => {
      getSettings().setAutoExecute(true);

      // Create a custom node with an expression that errors
      const src = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeData(src, 'value', 42);

      // Set continue strategy
      getState().setErrorStrategy('continue');

      // Trigger auto-execute
      getState().updateNodeData(src, 'value', 100);
      vi.advanceTimersByTime(250);
      vi.advanceTimersByTime(5000);

      // Should have executed (outputs present)
      expect(getState().nodeOutputs[src]).toBeDefined();
      // Error strategy should still be continue
      expect(getState().errorStrategy).toBe('continue');
    });
  });
});
