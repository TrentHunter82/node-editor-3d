import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { enableMapSet } from 'immer';

enableMapSet();

// ---- Mocks ----

let mockCamera: THREE.PerspectiveCamera;
const mockDomElement = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
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
      // Return existing ref if same initial (for raycaster)
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

vi.mock('../store/editorStore', () => ({
  useEditorStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const state = {
        ...mockStoreState,
        updateNodePosition: mockUpdateNodePosition,
        setNodePositions: mockSetNodePositions,
        setInteraction: mockSetInteraction,
        pushUndoSnapshot: mockPushUndoSnapshot,
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
      }),
      setState: (updater: (s: Record<string, unknown>) => void) => {
        updater(mockStoreState);
      },
    },
  ),
  snapToGrid: (value: number) => Math.round(value / 0.5) * 0.5,
}));

// Import AFTER mocks
const { useNodeDrag } = await import('./useNodeDrag');

describe('useNodeDrag', () => {
  beforeEach(() => {
    // Reset
    refMap.clear();
    effectCleanups.length = 0;
    vi.clearAllMocks();
    document.body.style.cursor = '';

    // Set up camera looking straight down at XZ plane
    mockCamera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000);
    mockCamera.position.set(0, 20, 0);
    mockCamera.lookAt(0, 0, 0);
    mockCamera.updateMatrixWorld(true);
    mockCamera.updateProjectionMatrix();

    // Default store state
    mockStoreState = {
      nodes: {
        n1: { id: 'n1', type: 'source', position: [0, 0, 0], title: 'N1', data: {}, inputs: [], outputs: [] },
        n2: { id: 'n2', type: 'source', position: [5, 0, 5], title: 'N2', data: {}, inputs: [], outputs: [] },
      },
      selectedIds: new Set(['n1']),
      snapEnabled: false,
    };
  });

  afterEach(() => {
    effectCleanups.forEach(fn => fn());
    effectCleanups.length = 0;
  });

  it('returns startDrag, onDrag, endDrag, isDragging', () => {
    const result = useNodeDrag();
    expect(typeof result.startDrag).toBe('function');
    expect(typeof result.onDrag).toBe('function');
    expect(typeof result.endDrag).toBe('function');
    expect(typeof result.isDragging).toBe('function');
  });

  it('isDragging returns false initially', () => {
    const { isDragging } = useNodeDrag();
    expect(isDragging()).toBe(false);
  });

  it('startDrag does NOT set interaction (deferred until threshold)', () => {
    const { startDrag } = useNodeDrag();
    // Click center of viewport — interaction stays idle until drag threshold crossed
    startDrag('n1', 400, 300);
    expect(mockSetInteraction).not.toHaveBeenCalled();
  });

  it('interaction set to dragging-node when threshold exceeded', () => {
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    expect(mockSetInteraction).not.toHaveBeenCalled();
    // Move past threshold
    onDrag(410, 300);
    expect(mockSetInteraction).toHaveBeenCalledWith('dragging-node');
  });

  it('startDrag does nothing for nonexistent node', () => {
    const { startDrag, isDragging } = useNodeDrag();
    startDrag('nonexistent', 400, 300);
    expect(isDragging()).toBe(false);
    expect(mockSetInteraction).not.toHaveBeenCalled();
  });

  it('isDragging returns true after startDrag', () => {
    const { startDrag, isDragging } = useNodeDrag();
    startDrag('n1', 400, 300);
    expect(isDragging()).toBe(true);
  });

  it('endDrag resets state; only sets interaction to idle if committed', () => {
    const { startDrag, endDrag, isDragging } = useNodeDrag();
    startDrag('n1', 400, 300);
    // End without crossing threshold — interaction never entered 'dragging-node'
    endDrag();
    expect(isDragging()).toBe(false);
    // Should NOT call setInteraction since drag was never committed
    expect(mockSetInteraction).not.toHaveBeenCalledWith('idle');
  });

  it('endDrag sets interaction to idle after committed drag', () => {
    const { startDrag, onDrag, endDrag, isDragging } = useNodeDrag();
    startDrag('n1', 400, 300);
    // Cross threshold to commit drag
    onDrag(410, 300);
    expect(mockSetInteraction).toHaveBeenCalledWith('dragging-node');
    mockSetInteraction.mockClear();
    endDrag();
    expect(isDragging()).toBe(false);
    expect(mockSetInteraction).toHaveBeenCalledWith('idle');
  });

  it('onDrag does nothing when not dragging', () => {
    const { onDrag } = useNodeDrag();
    onDrag(500, 400);
    expect(mockSetNodePositions).not.toHaveBeenCalled();
  });

  it('drag threshold prevents small movements from committing', () => {
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    // Move less than 4px
    onDrag(402, 301);
    expect(mockPushUndoSnapshot).not.toHaveBeenCalled();
    expect(mockSetNodePositions).not.toHaveBeenCalled();
  });

  it('drag commits after exceeding threshold', () => {
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    // Move more than 4px
    onDrag(410, 300);
    expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);
    // cursor should be set to grabbing
    expect(document.body.style.cursor).toBe('grabbing');
  });

  it('pushes undo only once per drag', () => {
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    // Exceed threshold
    onDrag(410, 300);
    expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);
    // Continue dragging
    onDrag(420, 300);
    onDrag(430, 300);
    // Still only one undo push
    expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);
  });

  it('endDrag resets cursor via setInteraction(idle)', () => {
    const { startDrag, onDrag, endDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    onDrag(410, 300);
    expect(document.body.style.cursor).toBe('grabbing');
    endDrag();
    // Cursor reset is handled centrally by setInteraction('idle')
    expect(mockSetInteraction).toHaveBeenCalledWith('idle');
  });

  it('calls setNodePositions during committed drag', () => {
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    // Exceed threshold
    onDrag(420, 310);
    expect(mockSetNodePositions).toHaveBeenCalled();
    const positions = mockSetNodePositions.mock.calls[0][0] as Record<string, [number, number, number]>;
    expect(positions).toHaveProperty('n1');
    expect(Array.isArray(positions['n1'])).toBe(true);
    expect(positions['n1']).toHaveLength(3);
  });

  it('handles multi-select drag when node is in selection', () => {
    mockStoreState = {
      ...mockStoreState,
      selectedIds: new Set(['n1', 'n2']),
    };
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    // Exceed threshold
    onDrag(420, 310);
    // Both selected nodes should be updated in batch
    const positions = mockSetNodePositions.mock.calls[0][0] as Record<string, [number, number, number]>;
    expect(positions).toHaveProperty('n1');
    expect(positions).toHaveProperty('n2');
  });

  it('single-drag when clicked node is not in selection', () => {
    mockStoreState = {
      ...mockStoreState,
      selectedIds: new Set(['n2']),
    };
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    // Exceed threshold
    onDrag(420, 310);
    // Only n1 should be moved (not n2)
    const positions = mockSetNodePositions.mock.calls[0][0] as Record<string, [number, number, number]>;
    expect(positions).toHaveProperty('n1');
    expect(positions).not.toHaveProperty('n2');
  });

  it('snap-to-grid applies when snapEnabled is true', () => {
    mockStoreState = {
      ...mockStoreState,
      snapEnabled: true,
    };
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    onDrag(420, 310);
    // Position should be snapped to 0.5 grid
    const positions = mockSetNodePositions.mock.calls[0][0] as Record<string, [number, number, number]>;
    const pos = positions['n1'];
    // X and Z should be multiples of 0.5
    expect(pos[0] % 0.5).toBeCloseTo(0, 5);
    expect(pos[2] % 0.5).toBeCloseTo(0, 5);
  });

  it('preserves Y position during XZ drag', () => {
    // Node with Y=3
    mockStoreState = {
      ...mockStoreState,
      nodes: {
        n1: { id: 'n1', type: 'source', position: [0, 3, 0], title: 'N1', data: {}, inputs: [], outputs: [] },
      },
      selectedIds: new Set(['n1']),
    };
    const { startDrag, onDrag } = useNodeDrag();
    startDrag('n1', 400, 300);
    onDrag(420, 310);
    // Y should be preserved as 3
    const positions = mockSetNodePositions.mock.calls[0][0] as Record<string, [number, number, number]>;
    expect(positions['n1'][1]).toBe(3);
  });

  it('registers shift key event listeners', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    useNodeDrag();

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('keyup', expect.any(Function));

    // Cleanup
    effectCleanups.forEach(fn => fn());
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('keyup', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
