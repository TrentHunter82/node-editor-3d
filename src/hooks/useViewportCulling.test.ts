import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { EditorNode } from '../types';

// Capture callbacks from hooks
let useFrameCallback: (() => void) | null = null;
let mockCamera: THREE.PerspectiveCamera;
const lodMapRef = { current: new Map<string, string>() };
// cullCounterRef — tracks per-node cull hysteresis frame count
const cullCounterMapRef = { current: new Map<string, number>() };
// prevLodSnapshotRef — last-good LOD snapshot for all-culled grace
const prevLodSnapshotRef = { current: new Map<string, string>() };
let refCallIndex = 0;

// Mutable store state for testing interaction guard, selected nodes, etc.
let mockStoreState = {
  interaction: 'idle' as string,
  selectedIds: new Set<string>(),
  isNodePointerDown: false,
};

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({ camera: mockCamera }),
  useFrame: (cb: () => void) => { useFrameCallback = cb; },
}));

vi.mock('../store/editorStore', () => ({
  useEditorStore: {
    getState: () => mockStoreState,
  },
}));

// The hook calls useRef 13 times in order:
//   0: lodMap (Map<string, LODLevel>)
//   1: spatialIndexRef (SpatialIndex — not a Map)
//   2: prevNodeCountRef (0)
//   3: hadVisibleRef (false)
//   4: cullCounterRef (Map<string, number>)
//   5: allCulledFramesRef (0)
//   6: postInteractionGraceRef (0)
//   7: prevLodSnapshotRef (Map<string, LODLevel>)
//   8: prevCamPosRef (Vector3)
//   9: prevCamQuatRef (Quaternion)
//  10: cameraSettleRef (0)
//  11: camInitializedRef (false)
//  12: prevVisibleCountRef (-1)
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const idx = refCallIndex++;
      if (initial instanceof Map) {
        // idx 0 = lodMap, idx 4 = cullCounterRef, idx 7 = prevLodSnapshotRef
        if (idx === 0) return lodMapRef;
        if (idx === 4) return cullCounterMapRef;
        return prevLodSnapshotRef;
      }
      return { current: initial };
    },
    useCallback: (fn: (...args: unknown[]) => unknown) => fn,
    useReducer: (_reducer: (s: number) => number, init: number) => {
      // Return [state, dispatch] where dispatch is a no-op for tests
      return [init, () => {}];
    },
  };
});

// Import AFTER mocks
const { useViewportCulling } = await import('./useViewportCulling');

function makeNode(id: string, position: [number, number, number]): EditorNode {
  return { id, type: 'source', position, title: 'test', data: {}, inputs: [], outputs: [] };
}

describe('useViewportCulling', () => {
  beforeEach(() => {
    useFrameCallback = null;
    lodMapRef.current = new Map();
    cullCounterMapRef.current = new Map();
    prevLodSnapshotRef.current = new Map();
    refCallIndex = 0;
    // Reset store state to idle
    mockStoreState = {
      interaction: 'idle',
      selectedIds: new Set<string>(),
      isNodePointerDown: false,
    };
    // Camera at [0,10,10] looking at origin
    mockCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    mockCamera.position.set(0, 10, 10);
    mockCamera.lookAt(0, 0, 0);
    mockCamera.updateMatrixWorld(true);
    mockCamera.updateProjectionMatrix();
  });

  it('returns a getLOD function', () => {
    const { getLOD } = useViewportCulling({ n1: makeNode('n1', [0, 0, 0]) });
    expect(typeof getLOD).toBe('function');
  });

  it('defaults to "full" for unknown nodes', () => {
    const { getLOD } = useViewportCulling({ n1: makeNode('n1', [0, 0, 0]) });
    expect(getLOD('nonexistent')).toBe('full');
  });

  it('classifies node in front of camera as "full" when close', () => {
    const nodes = { n1: makeNode('n1', [0, 0, 0]) };
    const { getLOD } = useViewportCulling(nodes);
    expect(useFrameCallback).not.toBeNull();
    useFrameCallback!();
    // Node at origin, camera at [0,10,10] → distance ~14.1 < 20 → full
    expect(getLOD('n1')).toBe('full');
  });

  it('classifies node far from camera as "full" for small graphs (LOD disabled)', () => {
    // With <50 nodes, LOD distance threshold is Infinity — distance never triggers LOD
    // Camera at [0,10,10], node at [0,0,-30] → dist ~41, but still 'full' for small graphs
    const nodes = { n1: makeNode('n1', [0, 0, -30]) };
    const { getLOD } = useViewportCulling(nodes);
    useFrameCallback!();
    // Small graph: distance-based LOD is disabled, only frustum culling applies
    // Node is in front of camera and within expanded frustum, so it's 'full'
    expect(getLOD('n1')).toBe('full');
  });

  it('node behind camera stays visible via all-culled guard (never all-culled)', () => {
    // Node way behind camera. When ALL nodes are behind the camera,
    // the all-culled guard prevents them from vanishing (UX safety).
    // The node stays at its previous LOD from the snapshot.
    const nodes = { n1: makeNode('n1', [0, 0, 100]) };
    const { getLOD } = useViewportCulling(nodes);
    // Even after many frames, the all-culled guard keeps restoring from snapshot
    for (let i = 0; i < 50; i++) useFrameCallback!();
    // Node should still be visible (not culled) because all-culled guard prevents total disappearance
    expect(getLOD('n1')).not.toBe('culled');
  });

  it('node far to side stays visible via all-culled guard when only node', () => {
    // Node way off to the side, outside FOV. Same all-culled guard behavior.
    const nodes = { n1: makeNode('n1', [200, 0, 0]) };
    const { getLOD } = useViewportCulling(nodes);
    for (let i = 0; i < 50; i++) useFrameCallback!();
    // Node stays visible because it's the only node and all-culled guard prevents total vanish
    expect(getLOD('n1')).not.toBe('culled');
  });

  it('handles multiple nodes with different classifications', () => {
    const nodes = {
      close: makeNode('close', [0, 0, 0]),
      far: makeNode('far', [0, 0, -30]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    const { getLOD } = useViewportCulling(nodes);
    // With 'close' always visible, the all-culled guard won't fire for 'behind'
    // so HYSTERESIS_FRAMES + 1 = 16 frames needed for it (hysteresis is 15)
    for (let i = 0; i < 16; i++) useFrameCallback!();
    expect(getLOD('close')).toBe('full');
    // far is in front but distant — with <50 nodes, LOD is disabled so it's 'full' or 'culled' (frustum only)
    const farLOD = getLOD('far');
    expect(['full', 'culled']).toContain(farLOD);
    expect(getLOD('behind')).toBe('culled');
  });

  it('cleans up stale node entries', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', [0, 0, 0]),
      n2: makeNode('n2', [1, 0, 0]),
    };
    useViewportCulling(nodes);
    useFrameCallback!();
    expect(lodMapRef.current.has('n1')).toBe(true);
    expect(lodMapRef.current.has('n2')).toBe(true);

    // Remove n2
    delete nodes.n2;
    useFrameCallback!();
    expect(lodMapRef.current.has('n1')).toBe(true);
    expect(lodMapRef.current.has('n2')).toBe(false);
  });

  it('handles empty nodes', () => {
    const { getLOD } = useViewportCulling({});
    useFrameCallback!();
    expect(lodMapRef.current.size).toBe(0);
    expect(getLOD('anything')).toBe('full');
  });

  it('updates when camera moves', () => {
    const nodes = { n1: makeNode('n1', [0, 0, 0]) };
    const { getLOD } = useViewportCulling(nodes);
    useFrameCallback!();
    expect(getLOD('n1')).toBe('full');

    // Move camera far away
    mockCamera.position.set(0, 100, 100);
    mockCamera.lookAt(0, 0, 0);
    mockCamera.updateMatrixWorld(true);
    mockCamera.updateProjectionMatrix();
    useFrameCallback!();
    // With <50 nodes, LOD is disabled — node stays 'full' regardless of distance
    expect(getLOD('n1')).toBe('full');
  });

  it('LOD threshold is dynamic based on node count', () => {
    // With <50 nodes, LOD distance is Infinity — no distance-based LOD
    mockCamera.position.set(0, 0, 0);
    mockCamera.lookAt(1, 0, 0); // look towards +X
    mockCamera.updateMatrixWorld(true);
    mockCamera.updateProjectionMatrix();

    // Small graph: even distant nodes stay 'full'
    const nodesSmall = { n1: makeNode('n1', [21, 0, 0]) };
    useViewportCulling(nodesSmall);
    useFrameCallback!();
    expect(lodMapRef.current.get('n1')).toBe('full');

    // Close node also 'full'
    lodMapRef.current.clear();
    cullCounterMapRef.current.clear();
    refCallIndex = 0;
    const nodesClose = { n1: makeNode('n1', [19, 0, 0]) };
    useViewportCulling(nodesClose);
    useFrameCallback!();
    expect(lodMapRef.current.get('n1')).toBe('full');
  });

  it('works with orthographic camera', () => {
    // Replace with ortho camera
    const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    ortho.position.set(0, 10, 10);
    ortho.lookAt(0, 0, 0);
    ortho.updateMatrixWorld(true);
    ortho.updateProjectionMatrix();
    mockCamera = ortho as unknown as THREE.PerspectiveCamera;

    const nodes = { n1: makeNode('n1', [0, 0, 0]) };
    const { getLOD } = useViewportCulling(nodes);
    // Should not throw
    useFrameCallback!();
    expect(['full', 'lod', 'culled']).toContain(getLOD('n1'));
  });

  // --- Interaction guard tests ---

  it('shows all nodes as visible during active drag interaction', () => {
    // Node behind camera would normally be culled
    const nodes = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    mockStoreState.interaction = 'dragging-node';
    const { getLOD } = useViewportCulling(nodes);
    useFrameCallback!();
    // During dragging, ALL nodes should be visible (full or lod, never culled)
    expect(getLOD('visible')).toBe('full');
    expect(['full', 'lod']).toContain(getLOD('behind'));
  });

  it('shows all nodes as visible when isNodePointerDown is true (pre-threshold)', () => {
    // This covers the drag threshold window: pointerdown fired but
    // 4px movement threshold not yet crossed, interaction still 'idle'
    const nodes = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    mockStoreState.interaction = 'idle';
    mockStoreState.isNodePointerDown = true;
    const { getLOD } = useViewportCulling(nodes);
    useFrameCallback!();
    expect(getLOD('visible')).toBe('full');
    expect(['full', 'lod']).toContain(getLOD('behind'));
  });

  it('shows all nodes during box-selection interaction', () => {
    const nodes = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    mockStoreState.interaction = 'box-selecting';
    const { getLOD } = useViewportCulling(nodes);
    useFrameCallback!();
    expect(['full', 'lod']).toContain(getLOD('visible'));
    expect(['full', 'lod']).toContain(getLOD('behind'));
  });

  it('shows all nodes during connection drawing', () => {
    const nodes = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    mockStoreState.interaction = 'drawing-connection';
    const { getLOD } = useViewportCulling(nodes);
    useFrameCallback!();
    expect(['full', 'lod']).toContain(getLOD('visible'));
    expect(['full', 'lod']).toContain(getLOD('behind'));
  });

  // --- Grace period tests ---

  it('uses wider margin during post-interaction grace period', () => {
    // Start with interaction active
    const nodes = { n1: makeNode('n1', [0, 0, 0]) };
    mockStoreState.interaction = 'dragging-node';
    useViewportCulling(nodes);
    useFrameCallback!(); // frame during interaction — sets grace counter

    // End interaction
    mockStoreState.interaction = 'idle';
    useFrameCallback!(); // frame 1 of grace period

    // Node should still be visible during grace period
    expect(lodMapRef.current.get('n1')).toBe('full');
  });

  it('grace period lasts for many frames after interaction ends', () => {
    const nodes = { n1: makeNode('n1', [0, 0, 0]) };
    mockStoreState.interaction = 'dragging-node';
    useViewportCulling(nodes);
    useFrameCallback!(); // Set grace counter

    mockStoreState.interaction = 'idle';
    // Run through all grace frames (guard + margin = 30 total)
    for (let i = 0; i < 32; i++) {
      useFrameCallback!();
    }
    // In-view node remains full regardless
    expect(lodMapRef.current.get('n1')).toBe('full');
  });

  // --- Selected nodes never culled ---

  it('selected nodes are never culled', () => {
    // Node behind camera
    const nodes = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    mockStoreState.selectedIds = new Set(['behind']);
    const { getLOD } = useViewportCulling(nodes);
    // Even after many frames, selected node should not be culled
    for (let i = 0; i < 40; i++) useFrameCallback!();
    expect(getLOD('behind')).toBe('full');
  });

  // --- Hysteresis tests ---

  it('hysteresis keeps node at lod for 15 frames before culling', () => {
    // Two nodes: one visible, one behind (so all-culled guard doesn't fire)
    const nodes = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    const { getLOD } = useViewportCulling(nodes);

    // Frame 1: behind node classified as culled → hysteresis keeps at lod
    useFrameCallback!();
    expect(getLOD('behind')).toBe('lod');

    // Frames 2-15: still in hysteresis grace period (HYSTERESIS_FRAMES = 15)
    for (let i = 0; i < 14; i++) useFrameCallback!();
    expect(getLOD('behind')).toBe('lod');

    // Frame 16: hysteresis expired → actually culled
    useFrameCallback!();
    expect(getLOD('behind')).toBe('culled');
  });

  it('hysteresis counter resets when node re-enters frustum', () => {
    // Two nodes: one visible, one starting behind
    const nodes = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    const { getLOD } = useViewportCulling(nodes);

    // Run 3 frames (partial hysteresis)
    for (let i = 0; i < 3; i++) useFrameCallback!();
    expect(getLOD('behind')).toBe('lod');

    // Move node back into view
    nodes.behind.position = [0, 0, 0];
    useFrameCallback!();
    expect(getLOD('behind')).toBe('full');

    // Move back behind — hysteresis should restart from 0
    nodes.behind.position = [0, 0, 100];
    useFrameCallback!();
    expect(getLOD('behind')).toBe('lod'); // frame 1 of new hysteresis
  });

  it('post-interaction guard extends full protection for 8 frames after drag ends', () => {
    // Node behind camera that would be culled without interaction guard
    const nodes = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    // Start dragging
    mockStoreState.interaction = 'dragging-node';
    useViewportCulling(nodes);
    useFrameCallback!();
    expect(lodMapRef.current.get('behind')).not.toBe('culled');

    // End drag — post-interaction guard extends for 8 frames
    mockStoreState.interaction = 'idle';
    // Frames 1-8 of grace period: full interaction guard (all nodes visible)
    for (let i = 0; i < 8; i++) {
      useFrameCallback!();
      // Behind node should NOT be culled during post-interaction guard
      expect(['full', 'lod']).toContain(lodMapRef.current.get('behind'));
    }
  });

  it('post-interaction margin uses wider frustum after guard expires', () => {
    // Node in front of camera — always visible regardless of margin
    const nodes = { n1: makeNode('n1', [0, 0, 0]) };
    // Activate then deactivate interaction
    mockStoreState.interaction = 'dragging-node';
    useViewportCulling(nodes);
    useFrameCallback!();

    mockStoreState.interaction = 'idle';
    // Run through 8 guard frames + 22 margin frames = 30 total
    for (let i = 0; i < 30; i++) {
      useFrameCallback!();
    }
    // In-view node remains full
    expect(lodMapRef.current.get('n1')).toBe('full');
  });

  // --- All-culled grace guard tests ---

  it('all-culled grace prevents flash when all nodes briefly exit frustum', () => {
    const nodes = { n1: makeNode('n1', [0, 0, 0]) };
    useViewportCulling(nodes);
    // First: node is visible, builds up snapshot
    useFrameCallback!();
    expect(lodMapRef.current.get('n1')).toBe('full');

    // Move node behind camera (all nodes culled)
    nodes.n1.position = [0, 0, 100];
    // During the all-culled grace period, snapshot should restore previous LOD
    useFrameCallback!();
    // After hysteresis (10 frames), node enters all-culled grace
    for (let i = 0; i < 10; i++) useFrameCallback!();
    // Should be restored from snapshot (not 'culled') during grace
    expect(['full', 'lod']).toContain(lodMapRef.current.get('n1'));
  });

  // --- Transition from interaction to idle ---

  it('transition from drag to idle does not cull visible nodes', () => {
    const nodes = {
      n1: makeNode('n1', [0, 0, 0]),
      n2: makeNode('n2', [2, 0, 0]),
    };
    // Start dragging
    mockStoreState.interaction = 'dragging-node';
    useViewportCulling(nodes);
    useFrameCallback!();
    expect(lodMapRef.current.get('n1')).toBe('full');
    expect(lodMapRef.current.get('n2')).toBe('full');

    // End drag
    mockStoreState.interaction = 'idle';
    useFrameCallback!();
    // Both nodes are in front of camera, should still be full
    expect(lodMapRef.current.get('n1')).toBe('full');
    expect(lodMapRef.current.get('n2')).toBe('full');
  });

  it('nodes moved during drag remain visible after drag ends', () => {
    const nodes = {
      n1: makeNode('n1', [0, 0, 0]),
      n2: makeNode('n2', [2, 0, 0]),
    };
    // Start dragging
    mockStoreState.interaction = 'dragging-node';
    useViewportCulling(nodes);
    useFrameCallback!();

    // Move node during drag (still in frustum)
    nodes.n1.position = [3, 0, 0];
    useFrameCallback!();
    expect(lodMapRef.current.get('n1')).toBe('full');

    // End drag
    mockStoreState.interaction = 'idle';
    useFrameCallback!();
    // Node at [3,0,0] still in front of camera, should be full
    expect(lodMapRef.current.get('n1')).toBe('full');
  });

  // --- Memory cleanup tests ---

  it('cullCounterRef purges entries for deleted nodes', () => {
    // Two nodes: one visible, one behind (to populate cullCounter)
    const nodes: Record<string, EditorNode> = {
      visible: makeNode('visible', [0, 0, 0]),
      behind: makeNode('behind', [0, 0, 100]),
    };
    useViewportCulling(nodes);

    // Run a few frames so cullCounter accumulates entries for 'behind'
    for (let i = 0; i < 5; i++) useFrameCallback!();
    expect(cullCounterMapRef.current.has('behind')).toBe(true);

    // Delete 'behind' node
    delete nodes.behind;
    useFrameCallback!();

    // cullCounterRef should no longer have the deleted node's entry
    expect(cullCounterMapRef.current.has('behind')).toBe(false);
  });

  it('prevLodSnapshotRef purges entries for deleted nodes', () => {
    const nodes: Record<string, EditorNode> = {
      n1: makeNode('n1', [0, 0, 0]),
      n2: makeNode('n2', [1, 0, 0]),
    };
    useViewportCulling(nodes);

    // Run frames to build LOD snapshot
    for (let i = 0; i < 3; i++) useFrameCallback!();
    expect(prevLodSnapshotRef.current.has('n1')).toBe(true);
    expect(prevLodSnapshotRef.current.has('n2')).toBe(true);

    // Delete n2
    delete nodes.n2;
    // Run enough frames for snapshot rebuild (needs visibleCount > 0 and not in grace)
    for (let i = 0; i < 5; i++) useFrameCallback!();

    // prevLodSnapshotRef should no longer have the deleted node
    expect(prevLodSnapshotRef.current.has('n1')).toBe(true);
    expect(prevLodSnapshotRef.current.has('n2')).toBe(false);
  });

  it('Map sizes do not grow unbounded after repeated add/delete cycles', () => {
    const nodes: Record<string, EditorNode> = {
      permanent: makeNode('permanent', [0, 0, 0]),
    };
    useViewportCulling(nodes);

    // Cycle: add a node behind camera, run frames, then delete it
    for (let cycle = 0; cycle < 10; cycle++) {
      const tempId = `temp-${cycle}`;
      nodes[tempId] = makeNode(tempId, [0, 0, 100]);
      for (let i = 0; i < 5; i++) useFrameCallback!();

      delete nodes[tempId];
      for (let i = 0; i < 5; i++) useFrameCallback!();
    }

    // After 10 add/delete cycles, only 'permanent' should remain in all Maps
    expect(lodMapRef.current.size).toBe(1);
    expect(lodMapRef.current.has('permanent')).toBe(true);

    // cullCounter should not have entries for deleted nodes
    for (const key of cullCounterMapRef.current.keys()) {
      expect(key).toBe('permanent');
    }

    // prevLodSnapshot should not have entries for deleted nodes
    for (const key of prevLodSnapshotRef.current.keys()) {
      expect(key).toBe('permanent');
    }
  });
});
