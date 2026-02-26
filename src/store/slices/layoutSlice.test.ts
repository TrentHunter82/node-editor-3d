/**
 * Unit tests for layoutSlice — autoLayout, alignSelected, distributeSelected.
 *
 * Tests the slice logic directly by constructing `set`, `get`, and `pushUndo`
 * stubs and exercising each action against mock layout utilities.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EditorNode, Connection } from '../../types';
import type { AlignDirection, DistributeDirection } from '../../utils/layout';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../utils/layout', () => ({
  layeredLayout: vi.fn(() => ({})),
  forceDirectedLayout: vi.fn(() => ({})),
  alignNodes: vi.fn(() => ({})),
  distributeNodes: vi.fn(() => ({})),
}));

vi.mock('../settingsStore', () => ({
  useSettingsStore: { getState: () => ({ layoutMode: 'layered' }) },
}));

import { layeredLayout, forceDirectedLayout, alignNodes, distributeNodes } from '../../utils/layout';
import { useSettingsStore } from '../settingsStore';
import { createLayoutActions } from './layoutSlice';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, x = 0, z = 0, locked = false): EditorNode {
  return {
    id,
    type: 'source',
    position: [x, 0, z],
    title: `Node ${id}`,
    data: {},
    inputs: [],
    outputs: [{ id: 'out-0', label: 'value', portType: 'number' }],
    ...(locked ? { locked: true } : {}),
  };
}

function makeConnection(id: string, sourceId: string, targetId: string): Connection {
  return {
    id,
    sourceNodeId: sourceId,
    sourcePortIndex: 0,
    targetNodeId: targetId,
    targetPortIndex: 0,
  };
}

// ---------------------------------------------------------------------------
// Test harness — mimics Zustand immer set/get
// ---------------------------------------------------------------------------

interface TestState {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  selectedIds: Set<string>;
}

function createTestHarness(initial: TestState) {
  let state = initial;

  const set = (fn: (draft: { nodes: Record<string, EditorNode> }) => void) => {
    // Imitate immer: clone nodes, apply mutator, replace
    const draft = { nodes: structuredClone(state.nodes) };
    fn(draft);
    state = { ...state, nodes: draft.nodes };
  };

  const get = () => state;

  const pushUndo = vi.fn();

  const actions = createLayoutActions(set, get, pushUndo);

  return { getState: () => state, setState: (s: Partial<TestState>) => { state = { ...state, ...s }; }, pushUndo, actions };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('layoutSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // autoLayout
  // =========================================================================
  describe('autoLayout', () => {
    it('no-ops on empty graph and does not push undo', () => {
      const { actions, pushUndo } = createTestHarness({
        nodes: {},
        connections: {},
        selectedIds: new Set(),
      });

      actions.autoLayout();

      expect(pushUndo).not.toHaveBeenCalled();
      expect(layeredLayout).not.toHaveBeenCalled();
      expect(forceDirectedLayout).not.toHaveBeenCalled();
    });

    it('applies layered layout when layoutMode is "layered"', () => {
      const n1 = makeNode('n1', 0, 0);
      const n2 = makeNode('n2', 1, 1);
      (layeredLayout as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [10, 0, 0],
        n2: [20, 0, 5],
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1, n2 },
        connections: {},
        selectedIds: new Set(),
      });

      actions.autoLayout();

      expect(layeredLayout).toHaveBeenCalledWith(
        expect.objectContaining({ n1, n2 }),
        expect.any(Object),
      );
      expect(forceDirectedLayout).not.toHaveBeenCalled();
      expect(getState().nodes.n1.position).toEqual([10, 0, 0]);
      expect(getState().nodes.n2.position).toEqual([20, 0, 5]);
    });

    it('applies force-directed layout when layoutMode is "force"', () => {
      // Override the mock to return 'force' for this test
      (useSettingsStore as any).getState = () => ({ layoutMode: 'force' });

      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      (forceDirectedLayout as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [5, 0, 3],
        n2: [15, 0, 8],
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1, n2 },
        connections: {},
        selectedIds: new Set(),
      });

      actions.autoLayout();

      expect(forceDirectedLayout).toHaveBeenCalled();
      expect(layeredLayout).not.toHaveBeenCalled();
      expect(getState().nodes.n1.position).toEqual([5, 0, 3]);
      expect(getState().nodes.n2.position).toEqual([15, 0, 8]);

      // Restore default mock
      (useSettingsStore as any).getState = () => ({ layoutMode: 'layered' });
    });

    it('pushes undo when graph is non-empty', () => {
      const n1 = makeNode('n1');
      (layeredLayout as ReturnType<typeof vi.fn>).mockReturnValue({ n1: [0, 0, 0] });

      const { actions, pushUndo } = createTestHarness({
        nodes: { n1 },
        connections: {},
        selectedIds: new Set(),
      });

      actions.autoLayout();

      expect(pushUndo).toHaveBeenCalledTimes(1);
      expect(pushUndo).toHaveBeenCalledWith('Auto layout');
    });

    it('does NOT move locked nodes', () => {
      const n1 = makeNode('n1', 0, 0, false);
      const n2 = makeNode('n2', 5, 5, true); // locked
      (layeredLayout as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [10, 0, 0],
        n2: [20, 0, 0],
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1, n2 },
        connections: {},
        selectedIds: new Set(),
      });

      actions.autoLayout();

      // n1 should be moved
      expect(getState().nodes.n1.position).toEqual([10, 0, 0]);
      // n2 is locked — should remain at original position
      expect(getState().nodes.n2.position).toEqual([5, 0, 5]);
    });

    it('passes both nodes and connections to the layout function', () => {
      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      const c1 = makeConnection('c1', 'n1', 'n2');
      (layeredLayout as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [0, 0, 0],
        n2: [5, 0, 0],
      });

      const { actions } = createTestHarness({
        nodes: { n1, n2 },
        connections: { c1 },
        selectedIds: new Set(),
      });

      actions.autoLayout();

      expect(layeredLayout).toHaveBeenCalledWith(
        expect.objectContaining({ n1, n2 }),
        expect.objectContaining({ c1 }),
      );
    });

    it('handles layout returning positions for non-existent node ids gracefully', () => {
      const n1 = makeNode('n1');
      (layeredLayout as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [10, 0, 0],
        ghost: [99, 0, 99], // does not exist in state
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1 },
        connections: {},
        selectedIds: new Set(),
      });

      // Should not throw
      actions.autoLayout();

      expect(getState().nodes.n1.position).toEqual([10, 0, 0]);
      expect(getState().nodes['ghost']).toBeUndefined();
    });
  });

  // =========================================================================
  // alignSelected
  // =========================================================================
  describe('alignSelected', () => {
    it('no-ops if fewer than 2 nodes selected and does not push undo', () => {
      const n1 = makeNode('n1');
      const { actions, pushUndo } = createTestHarness({
        nodes: { n1 },
        connections: {},
        selectedIds: new Set(['n1']),
      });

      actions.alignSelected('left');

      expect(pushUndo).not.toHaveBeenCalled();
      expect(alignNodes).not.toHaveBeenCalled();
    });

    it('no-ops if zero nodes selected', () => {
      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      const { actions, pushUndo } = createTestHarness({
        nodes: { n1, n2 },
        connections: {},
        selectedIds: new Set(),
      });

      actions.alignSelected('left');

      expect(pushUndo).not.toHaveBeenCalled();
      expect(alignNodes).not.toHaveBeenCalled();
    });

    it('applies alignment to selected nodes', () => {
      const n1 = makeNode('n1', 0, 0);
      const n2 = makeNode('n2', 5, 3);
      (alignNodes as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [0, 0, 0],
        n2: [0, 0, 3],
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1, n2 },
        connections: {},
        selectedIds: new Set(['n1', 'n2']),
      });

      actions.alignSelected('left');

      expect(alignNodes).toHaveBeenCalledWith(
        expect.arrayContaining(['n1', 'n2']),
        expect.objectContaining({ n1, n2 }),
        'left',
      );
      expect(getState().nodes.n1.position).toEqual([0, 0, 0]);
      expect(getState().nodes.n2.position).toEqual([0, 0, 3]);
    });

    it('pushes undo when alignment is applied', () => {
      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      (alignNodes as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [0, 0, 0],
        n2: [0, 0, 0],
      });

      const { actions, pushUndo } = createTestHarness({
        nodes: { n1, n2 },
        connections: {},
        selectedIds: new Set(['n1', 'n2']),
      });

      actions.alignSelected('center-x');

      expect(pushUndo).toHaveBeenCalledTimes(1);
      expect(pushUndo).toHaveBeenCalledWith('Align nodes');
    });

    it('does NOT move locked nodes', () => {
      const n1 = makeNode('n1', 0, 0, false);
      const n2 = makeNode('n2', 5, 5, true); // locked
      const n3 = makeNode('n3', 10, 10, false);
      (alignNodes as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [0, 0, 0],
        n2: [0, 0, 5],
        n3: [0, 0, 10],
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1, n2, n3 },
        connections: {},
        selectedIds: new Set(['n1', 'n2', 'n3']),
      });

      actions.alignSelected('left');

      expect(getState().nodes.n1.position).toEqual([0, 0, 0]);
      // n2 is locked — should stay at original position
      expect(getState().nodes.n2.position).toEqual([5, 0, 5]);
      expect(getState().nodes.n3.position).toEqual([0, 0, 10]);
    });

    it('filters out selected ids that do not exist in nodes', () => {
      const n1 = makeNode('n1');
      const { actions, pushUndo } = createTestHarness({
        nodes: { n1 },
        connections: {},
        selectedIds: new Set(['n1', 'ghost']),
      });

      // Only 1 valid selected node (n1), so should no-op (< 2)
      actions.alignSelected('top');

      expect(pushUndo).not.toHaveBeenCalled();
      expect(alignNodes).not.toHaveBeenCalled();
    });

    it.each<AlignDirection>(['left', 'right', 'top', 'bottom', 'center-x', 'center-z'])(
      'passes direction "%s" to alignNodes',
      (direction) => {
        const n1 = makeNode('n1');
        const n2 = makeNode('n2');
        (alignNodes as ReturnType<typeof vi.fn>).mockReturnValue({});

        const { actions } = createTestHarness({
          nodes: { n1, n2 },
          connections: {},
          selectedIds: new Set(['n1', 'n2']),
        });

        actions.alignSelected(direction);

        expect(alignNodes).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(Object),
          direction,
        );
      },
    );
  });

  // =========================================================================
  // distributeSelected
  // =========================================================================
  describe('distributeSelected', () => {
    it('no-ops if fewer than 3 nodes selected and does not push undo', () => {
      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      const { actions, pushUndo } = createTestHarness({
        nodes: { n1, n2 },
        connections: {},
        selectedIds: new Set(['n1', 'n2']),
      });

      actions.distributeSelected('horizontal');

      expect(pushUndo).not.toHaveBeenCalled();
      expect(distributeNodes).not.toHaveBeenCalled();
    });

    it('no-ops with zero selected nodes', () => {
      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      const n3 = makeNode('n3');
      const { actions, pushUndo } = createTestHarness({
        nodes: { n1, n2, n3 },
        connections: {},
        selectedIds: new Set(),
      });

      actions.distributeSelected('vertical');

      expect(pushUndo).not.toHaveBeenCalled();
      expect(distributeNodes).not.toHaveBeenCalled();
    });

    it('no-ops with exactly 2 selected nodes (threshold is 3)', () => {
      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      const n3 = makeNode('n3');
      const { actions, pushUndo } = createTestHarness({
        nodes: { n1, n2, n3 },
        connections: {},
        selectedIds: new Set(['n1', 'n2']),
      });

      actions.distributeSelected('horizontal');

      expect(pushUndo).not.toHaveBeenCalled();
      expect(distributeNodes).not.toHaveBeenCalled();
    });

    it('applies distribution to selected nodes', () => {
      const n1 = makeNode('n1', 0, 0);
      const n2 = makeNode('n2', 10, 5);
      const n3 = makeNode('n3', 20, 10);
      (distributeNodes as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [0, 0, 0],
        n2: [10, 0, 5],
        n3: [20, 0, 10],
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1, n2, n3 },
        connections: {},
        selectedIds: new Set(['n1', 'n2', 'n3']),
      });

      actions.distributeSelected('horizontal');

      expect(distributeNodes).toHaveBeenCalledWith(
        expect.arrayContaining(['n1', 'n2', 'n3']),
        expect.objectContaining({ n1, n2, n3 }),
        'horizontal',
      );
      expect(getState().nodes.n1.position).toEqual([0, 0, 0]);
      expect(getState().nodes.n2.position).toEqual([10, 0, 5]);
      expect(getState().nodes.n3.position).toEqual([20, 0, 10]);
    });

    it('pushes undo when distribution is applied', () => {
      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      const n3 = makeNode('n3');
      (distributeNodes as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [0, 0, 0],
        n2: [5, 0, 0],
        n3: [10, 0, 0],
      });

      const { actions, pushUndo } = createTestHarness({
        nodes: { n1, n2, n3 },
        connections: {},
        selectedIds: new Set(['n1', 'n2', 'n3']),
      });

      actions.distributeSelected('horizontal');

      expect(pushUndo).toHaveBeenCalledTimes(1);
      expect(pushUndo).toHaveBeenCalledWith('Distribute nodes');
    });

    it('does NOT move locked nodes', () => {
      const n1 = makeNode('n1', 0, 0, false);
      const n2 = makeNode('n2', 5, 5, true); // locked
      const n3 = makeNode('n3', 10, 10, false);
      (distributeNodes as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [0, 0, 0],
        n2: [5, 0, 5],
        n3: [10, 0, 10],
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1, n2, n3 },
        connections: {},
        selectedIds: new Set(['n1', 'n2', 'n3']),
      });

      actions.distributeSelected('horizontal');

      expect(getState().nodes.n1.position).toEqual([0, 0, 0]);
      // n2 is locked — should remain at original position
      expect(getState().nodes.n2.position).toEqual([5, 0, 5]);
      expect(getState().nodes.n3.position).toEqual([10, 0, 10]);
    });

    it('filters out selected ids that do not exist in nodes', () => {
      const n1 = makeNode('n1');
      const n2 = makeNode('n2');
      const { actions, pushUndo } = createTestHarness({
        nodes: { n1, n2 },
        connections: {},
        // 3 selected ids, but 'ghost' is not in nodes, leaving only 2 valid
        selectedIds: new Set(['n1', 'n2', 'ghost']),
      });

      actions.distributeSelected('vertical');

      expect(pushUndo).not.toHaveBeenCalled();
      expect(distributeNodes).not.toHaveBeenCalled();
    });

    it.each<DistributeDirection>(['horizontal', 'vertical'])(
      'passes direction "%s" to distributeNodes',
      (direction) => {
        const n1 = makeNode('n1');
        const n2 = makeNode('n2');
        const n3 = makeNode('n3');
        (distributeNodes as ReturnType<typeof vi.fn>).mockReturnValue({});

        const { actions } = createTestHarness({
          nodes: { n1, n2, n3 },
          connections: {},
          selectedIds: new Set(['n1', 'n2', 'n3']),
        });

        actions.distributeSelected(direction);

        expect(distributeNodes).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(Object),
          direction,
        );
      },
    );

    it('correctly repositions nodes when distribution returns new positions', () => {
      const n1 = makeNode('n1', 0, 0);
      const n2 = makeNode('n2', 3, 3);
      const n3 = makeNode('n3', 12, 12);
      (distributeNodes as ReturnType<typeof vi.fn>).mockReturnValue({
        n1: [0, 0, 0],
        n2: [6, 0, 6],
        n3: [12, 0, 12],
      });

      const { actions, getState } = createTestHarness({
        nodes: { n1, n2, n3 },
        connections: {},
        selectedIds: new Set(['n1', 'n2', 'n3']),
      });

      actions.distributeSelected('vertical');

      // n2 should have moved from (3, 0, 3) to (6, 0, 6) per mock return
      expect(getState().nodes.n2.position).toEqual([6, 0, 6]);
    });
  });
});
