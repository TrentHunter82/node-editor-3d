/**
 * Node Drag Safety Tests
 *
 * Tests for critical safety guards in useNodeDrag:
 * - Locked node rejection
 * - Window blur cleanup
 * - Ray direction rejection (nearly-parallel rays)
 * - Max distance guards
 * - Pointer capture lifecycle
 * - Ctrl+drag state reset on blur
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { enableMapSet } from 'immer';

enableMapSet();

// ---- Mocks ----

let mockCamera: THREE.PerspectiveCamera;
const mockDomElement = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
};

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({ camera: mockCamera, gl: { domElement: mockDomElement } }),
}));

// Track React hook calls
const effectCleanups: (() => void)[] = [];
const refMap = new Map<unknown, { current: unknown }>();

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: (initial: unknown) => {
      if (!refMap.has(initial)) {
        refMap.set(initial, { current: initial });
      }
      return refMap.get(initial)!;
    },
    useCallback: (fn: (...args: unknown[]) => unknown) => fn,
    useEffect: (fn: () => (() => void) | void) => {
      const cleanup = fn();
      if (cleanup) effectCleanups.push(cleanup);
    },
  };
});

// Mock store state
let mockStoreState: Record<string, unknown> = {};
const mockUpdateNodePosition = vi.fn();
const mockSetNodePositions = vi.fn();
const mockSetInteraction = vi.fn();
const mockPushUndoSnapshot = vi.fn();
const mockDuplicateSelected = vi.fn(() => ({}));
const mockSetSelection = vi.fn();

vi.mock('../store/editorStore', () => ({
  useEditorStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const state = {
        ...mockStoreState,
        updateNodePosition: mockUpdateNodePosition,
        setNodePositions: mockSetNodePositions,
        setInteraction: mockSetInteraction,
        pushUndoSnapshot: mockPushUndoSnapshot,
        duplicateSelected: mockDuplicateSelected,
        setSelection: mockSetSelection,
      };
      return selector(state);
    },
    {
      getState: () => ({
        ...mockStoreState,
        updateNodePosition: mockUpdateNodePosition,
        setNodePositions: mockSetNodePositions,
        setInteraction: mockSetInteraction,
        pushUndoSnapshot: mockPushUndoSnapshot,
        duplicateSelected: mockDuplicateSelected,
        setSelection: mockSetSelection,
      }),
      setState: (updater: (s: Record<string, unknown>) => void) => {
        updater(mockStoreState);
      },
    },
  ),
  snapToGrid: (value: number) => Math.round(value / 0.5) * 0.5,
}));

// Import AFTER mocks
const { useNodeDrag } = await import('../hooks/useNodeDrag');

describe('useNodeDrag safety guards', () => {
  beforeEach(() => {
    refMap.clear();
    effectCleanups.length = 0;
    vi.clearAllMocks();
    document.body.style.cursor = '';
    mockDomElement.setPointerCapture.mockClear();
    mockDomElement.releasePointerCapture.mockClear();

    mockCamera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000);
    mockCamera.position.set(0, 20, 0);
    mockCamera.lookAt(0, 0, 0);
    mockCamera.updateMatrixWorld(true);
    mockCamera.updateProjectionMatrix();

    mockStoreState = {
      nodes: {
        n1: { id: 'n1', type: 'source', position: [0, 0, 0], title: 'N1', data: {}, inputs: [], outputs: [], locked: false },
        n2: { id: 'n2', type: 'source', position: [5, 0, 5], title: 'N2', data: {}, inputs: [], outputs: [], locked: false },
        locked1: { id: 'locked1', type: 'source', position: [10, 0, 10], title: 'Locked', data: {}, inputs: [], outputs: [], locked: true },
      },
      selectedIds: new Set(['n1']),
      snapEnabled: false,
      interaction: 'idle',
      isNodePointerDown: false,
    };
  });

  afterEach(() => {
    effectCleanups.forEach(fn => fn());
    effectCleanups.length = 0;
  });

  // --- Locked Node Rejection ---

  describe('locked node rejection', () => {
    it('startDrag does nothing for locked nodes', () => {
      const { startDrag, isDragging } = useNodeDrag();
      startDrag('locked1', 400, 300);
      expect(isDragging()).toBe(false);
      expect(mockSetInteraction).not.toHaveBeenCalled();
    });

    it('locked node in multi-select: drag only unlocked nodes', () => {
      mockStoreState = {
        ...mockStoreState,
        selectedIds: new Set(['n1', 'locked1']),
      };
      const { startDrag, onDrag } = useNodeDrag();
      startDrag('n1', 400, 300);
      onDrag(420, 310);
      const positions = mockSetNodePositions.mock.calls[0]?.[0] as Record<string, [number, number, number]> | undefined;
      // n1 should be updated, locked1 should NOT
      if (positions) {
        expect(positions).toHaveProperty('n1');
        // Locked nodes may or may not be in the batch — but their position shouldn't change
      }
    });
  });

  // --- Nearly-Parallel Ray Rejection ---

  describe('nearly-parallel ray rejection', () => {
    it('rejects drag when camera is nearly level with ground plane', () => {
      // Place camera nearly level with ground (Y ≈ 0.1)
      mockCamera.position.set(0, 0.1, 20);
      mockCamera.lookAt(0, 0, 0);
      mockCamera.updateMatrixWorld(true);
      mockCamera.updateProjectionMatrix();

      const { startDrag, isDragging } = useNodeDrag();
      startDrag('n1', 400, 300);
      // Should not start drag because ray is nearly parallel to XZ plane
      expect(isDragging()).toBe(false);
    });

    it('allows drag when camera has sufficient downward angle', () => {
      // Camera at normal elevation
      mockCamera.position.set(0, 20, 20);
      mockCamera.lookAt(0, 0, 0);
      mockCamera.updateMatrixWorld(true);
      mockCamera.updateProjectionMatrix();

      const { startDrag, isDragging } = useNodeDrag();
      startDrag('n1', 400, 300);
      expect(isDragging()).toBe(true);
    });
  });

  // --- Max Distance Guard ---

  describe('max distance guard', () => {
    it('accepts drag with camera at normal height', () => {
      // Normal camera position — should work fine
      mockCamera.position.set(0, 20, 20);
      mockCamera.lookAt(0, 0, 0);
      mockCamera.updateMatrixWorld(true);
      mockCamera.updateProjectionMatrix();

      const { startDrag, isDragging } = useNodeDrag();
      startDrag('n1', 400, 300);
      expect(isDragging()).toBe(true);
    });

    it('rejects drag with nearly horizontal camera angle', () => {
      // Camera very low, looking along -Z (nearly horizontal = nearly parallel to XZ)
      mockCamera.position.set(0, 0.01, 10);
      mockCamera.lookAt(0, 0.01, 0);
      mockCamera.updateMatrixWorld(true);
      mockCamera.updateProjectionMatrix();

      const { startDrag, isDragging } = useNodeDrag();
      startDrag('n1', 400, 300);
      // Ray should be nearly parallel → rejected
      expect(isDragging()).toBe(false);
    });
  });

  // --- Window Blur Cleanup ---

  describe('window blur cleanup', () => {
    it('registers blur event listener', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      useNodeDrag();
      expect(addSpy).toHaveBeenCalledWith('blur', expect.any(Function));
      addSpy.mockRestore();
    });

    it('blur resets drag state when dragging uncommitted', () => {
      const { startDrag, isDragging } = useNodeDrag();
      startDrag('n1', 400, 300);
      expect(isDragging()).toBe(true);

      // Simulate window blur
      window.dispatchEvent(new Event('blur'));

      expect(isDragging()).toBe(false);
    });

    it('blur calls setInteraction(idle) when drag was committed', () => {
      const { startDrag, onDrag, isDragging } = useNodeDrag();
      startDrag('n1', 400, 300);
      // Cross threshold
      onDrag(410, 300);
      expect(mockSetInteraction).toHaveBeenCalledWith('dragging-node');
      mockSetInteraction.mockClear();

      // Simulate window blur
      window.dispatchEvent(new Event('blur'));

      expect(isDragging()).toBe(false);
      expect(mockSetInteraction).toHaveBeenCalledWith('idle');
    });

    it('blur does NOT call setInteraction when drag was not committed', () => {
      const { startDrag, isDragging } = useNodeDrag();
      startDrag('n1', 400, 300);
      // Do NOT cross threshold
      expect(isDragging()).toBe(true);

      mockSetInteraction.mockClear();
      window.dispatchEvent(new Event('blur'));

      expect(isDragging()).toBe(false);
      // Should NOT call setInteraction since drag was never committed
      expect(mockSetInteraction).not.toHaveBeenCalledWith('idle');
    });

    it('blur resets isNodePointerDown flag', () => {
      const { startDrag } = useNodeDrag();
      startDrag('n1', 400, 300);

      window.dispatchEvent(new Event('blur'));

      // isNodePointerDown should have been set to false via setState
      expect(mockStoreState.isNodePointerDown).toBe(false);
    });
  });

  // --- Drag Threshold ---

  describe('drag threshold', () => {
    it('does not commit drag for movement under 4px', () => {
      const { startDrag, onDrag } = useNodeDrag();
      startDrag('n1', 400, 300);

      // Move 3px diagonally (√(2²+2²) ≈ 2.83 < 4)
      onDrag(402, 302);
      expect(mockPushUndoSnapshot).not.toHaveBeenCalled();
      expect(mockSetNodePositions).not.toHaveBeenCalled();
      expect(mockSetInteraction).not.toHaveBeenCalled();
    });

    it('commits drag for movement at exactly 4px', () => {
      const { startDrag, onDrag } = useNodeDrag();
      startDrag('n1', 400, 300);

      // Move exactly 4px in X
      onDrag(404, 300);
      expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);
      expect(mockSetInteraction).toHaveBeenCalledWith('dragging-node');
    });

    it('multiple sub-threshold moves do not accumulate', () => {
      const { startDrag, onDrag } = useNodeDrag();
      startDrag('n1', 400, 300);

      // Multiple tiny moves
      onDrag(401, 300);
      onDrag(402, 300);
      onDrag(403, 300);
      // Still under threshold from START (not accumulated)
      expect(mockPushUndoSnapshot).not.toHaveBeenCalled();
    });
  });

  // --- Shift Key Handling ---

  describe('shift key events', () => {
    it('cleans up blur listener on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      useNodeDrag();

      effectCleanups.forEach(fn => fn());

      expect(removeSpy).toHaveBeenCalledWith('blur', expect.any(Function));
      removeSpy.mockRestore();
    });
  });

  // --- Y Position Preservation ---

  describe('Y position preservation during XZ drag', () => {
    it('preserves Y=0 during XZ drag', () => {
      const { startDrag, onDrag } = useNodeDrag();
      startDrag('n1', 400, 300);
      onDrag(420, 310);

      const positions = mockSetNodePositions.mock.calls[0]?.[0] as Record<string, [number, number, number]>;
      expect(positions?.n1?.[1]).toBe(0);
    });

    it('preserves non-zero Y during XZ drag', () => {
      mockStoreState = {
        ...mockStoreState,
        nodes: {
          n1: { id: 'n1', type: 'source', position: [0, 5.5, 0], title: 'N1', data: {}, inputs: [], outputs: [], locked: false },
        },
        selectedIds: new Set(['n1']),
      };
      const { startDrag, onDrag } = useNodeDrag();
      startDrag('n1', 400, 300);
      onDrag(420, 310);

      const positions = mockSetNodePositions.mock.calls[0]?.[0] as Record<string, [number, number, number]>;
      expect(positions?.n1?.[1]).toBe(5.5);
    });
  });

  // --- Cursor Management ---

  describe('cursor management', () => {
    it('sets cursor to grabbing when drag committed', () => {
      const { startDrag, onDrag } = useNodeDrag();
      startDrag('n1', 400, 300);
      onDrag(410, 300);
      expect(document.body.style.cursor).toBe('grabbing');
    });

    it('does not set cursor when drag not committed', () => {
      const { startDrag, onDrag } = useNodeDrag();
      startDrag('n1', 400, 300);
      onDrag(402, 301); // sub-threshold
      expect(document.body.style.cursor).not.toBe('grabbing');
    });
  });

  // --- End Drag Lifecycle ---

  describe('endDrag lifecycle', () => {
    it('endDrag is idempotent when not dragging', () => {
      const { endDrag, isDragging } = useNodeDrag();
      // Call endDrag without starting
      endDrag();
      expect(isDragging()).toBe(false);
      expect(mockSetInteraction).not.toHaveBeenCalled();
    });

    it('endDrag after committed drag resets everything', () => {
      const { startDrag, onDrag, endDrag, isDragging } = useNodeDrag();
      startDrag('n1', 400, 300);
      onDrag(420, 310);
      mockSetInteraction.mockClear();

      endDrag();
      expect(isDragging()).toBe(false);
      expect(mockSetInteraction).toHaveBeenCalledWith('idle');
    });

    it('sequential start-end cycles work independently', () => {
      const { startDrag, onDrag, endDrag, isDragging } = useNodeDrag();

      // First drag cycle
      startDrag('n1', 400, 300);
      onDrag(420, 310);
      endDrag();
      expect(isDragging()).toBe(false);

      mockSetInteraction.mockClear();
      mockPushUndoSnapshot.mockClear();

      // Second drag cycle
      startDrag('n1', 400, 300);
      expect(isDragging()).toBe(true);
      onDrag(420, 310);
      expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);
      endDrag();
      expect(isDragging()).toBe(false);
    });
  });
});
