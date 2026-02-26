import { useRef, useCallback, useReducer } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { EditorNode } from '../types';
import { useEditorStore } from '../store/editorStore';
import { SpatialIndex } from '../utils/spatialIndex';

export type LODLevel = 'full' | 'lod' | 'culled';

// Module-scoped reusable objects — no allocations in hot path
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _point = new THREE.Vector3();
// Slightly expanded frustum planes to prevent popping at edges
const _expandedFrustum = new THREE.Frustum();
const _expandedMatrix = new THREE.Matrix4();
// For frustum-to-XZ-plane AABB calculation
const _invProjView = new THREE.Matrix4();
const _corner = new THREE.Vector3();
const _ray = new THREE.Ray();
const _xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y=0 plane
const _intersection = new THREE.Vector3();
const _farPoint = new THREE.Vector3();
// Camera movement detection vectors removed (unused after frustum projection rewrite)
// NDC corners for frustum-to-XZ projection (allocated once)
const NDC_CORNERS: ReadonlyArray<[number, number]> = [
  [-1, -1], [1, -1], [1, 1], [-1, 1],
];

/** Distance² from camera beyond which nodes switch to LOD (large graphs) */
const LOD_DISTANCE_SQ_LARGE = 20 * 20;  // 150+ nodes
const LOD_DISTANCE_SQ_MED   = 60 * 60;  // 50-149 nodes

/** Margin added to frustum planes to prevent popping (in NDC) */
const FRUSTUM_MARGIN = 0.20;
/** Larger margin during active interaction or camera movement */
const FRUSTUM_MARGIN_ACTIVE = 0.35;
/** Number of frames to keep a node visible after it would be culled (hysteresis) */
const HYSTERESIS_FRAMES = 15;

/** Node count threshold above which spatial indexing kicks in */
const SPATIAL_INDEX_THRESHOLD = 100;

/** Minimum camera movement to be considered "moving" */
const CAMERA_MOVE_THRESHOLD_SQ = 0.0001; // ~0.01 units
const CAMERA_ROT_THRESHOLD = 0.0001; // quaternion dot product difference

/** Number of frames of wider margin after camera stops moving */
const CAMERA_SETTLE_FRAMES = 20;

/**
 * Viewport frustum culling + LOD classification for node rendering.
 *
 * Returns a stable Map ref that classifies each node as:
 * - 'full': visible and close enough for full detail
 * - 'lod': visible but far away — render simplified
 * - 'culled': outside camera frustum — don't render
 *
 * For graphs with >100 nodes, uses a grid-based spatial index to avoid
 * the O(N) frustum test on every node. Instead, it queries only the
 * cells overlapping the camera's XZ footprint.
 *
 * Uses useFrame to update every frame. The returned ref is stable
 * (same Map object mutated in place) so consumers can read it
 * without triggering re-renders.
 *
 * Exposes a `cullingEpoch` counter that increments when any node
 * transitions between culled and non-culled states, enabling React
 * consumers (e.g. NodeGraph) to re-render in sync with LOD changes.
 */
export function useViewportCulling(nodes: Record<string, EditorNode>) {
  const { camera } = useThree();
  const lodMap = useRef<Map<string, LODLevel>>(new Map());
  const spatialIndexRef = useRef<SpatialIndex>(new SpatialIndex());
  const prevNodeCountRef = useRef(0);
  // Track whether any nodes were visible last frame — used to prevent
  // transient all-culled flashes during camera transitions or drag operations
  const hadVisibleRef = useRef(false);
  // Track how many frames each node has been pending cull (multi-frame hysteresis)
  const cullCounterRef = useRef<Map<string, number>>(new Map());
  // Track consecutive frames where ALL nodes are classified as culled
  const allCulledFramesRef = useRef(0);
  // Post-interaction stabilization: for the first few frames after interaction ends,
  // keep using the full interaction guard (all nodes visible, skip culling) to prevent
  // the flash where nodes disappear and pop back when frustum calculation glitches
  // on the transition frame. After that, use wider margin for a few more frames.
  const postInteractionGraceRef = useRef(0);
  const POST_INTERACTION_GUARD_FRAMES = 20; // full interaction guard extension
  const POST_INTERACTION_MARGIN_FRAMES = 24; // wider margin after guard
  // Snapshot of each node's LOD classification from the last frame with ≥1 visible node.
  // During all-culled grace frames, we restore from this snapshot instead of forcing
  // everything to 'full', which avoids the visible lod→full→lod pop.
  const prevLodSnapshotRef = useRef<Map<string, LODLevel>>(new Map());
  // Track whether previous frame was in full guard mode — when transitioning out,
  // force a spatial index rebuild to ensure cell assignments are completely fresh.
  const wasInGuardRef = useRef(false);

  // Camera movement detection: track previous camera state to detect orbiting/panning.
  // When camera is moving, use wider frustum margin to prevent edge popping.
  const prevCamPosRef = useRef(new THREE.Vector3(Infinity, Infinity, Infinity));
  const prevCamQuatRef = useRef(new THREE.Quaternion());
  const cameraSettleRef = useRef(0);
  const camInitializedRef = useRef(false);

  // React re-render trigger: increments when any node transitions between
  // culled and non-culled states. NodeGraph subscribes to this to stay in sync.
  const [cullingEpoch, bumpEpoch] = useReducer((c: number) => c + 1, 0);
  // Track count of non-culled nodes from the last React render to detect changes
  const prevVisibleCountRef = useRef(-1);

  useFrame(() => {
    // CRITICAL: Force camera matrix update BEFORE reading projectionMatrix or
    // matrixWorldInverse. In R3F, scene.updateMatrixWorld() is NOT called before
    // useFrame callbacks — it only happens inside gl.render() AFTER all callbacks.
    // OrbitControls with damping modifies camera.position in its own useFrame,
    // but matrixWorldInverse stays stale from the previous frame's render pass.
    // Without this, the frustum is computed from the PREVIOUS frame's camera
    // position, causing nodes at frustum edges to flash in/out for one frame.
    camera.updateMatrixWorld(true);

    const nodeKeys = Object.keys(nodes);
    const nodeCount = nodeKeys.length;
    const useSpatial = nodeCount >= SPATIAL_INDEX_THRESHOLD;
    const spatialIndex = spatialIndexRef.current;

    // Dynamic LOD: small graphs don't need distance-based LOD (frustum culling is enough),
    // larger graphs progressively tighten the threshold to limit Html overlays.
    const lodDistSq = nodeCount < 50  ? Infinity
                    : nodeCount < 150 ? LOD_DISTANCE_SQ_MED
                    : LOD_DISTANCE_SQ_LARGE;

    // Read interaction state imperatively to protect nodes from culling
    // during any active interaction (drag, box-select, connection drawing, etc.)
    const storeState = useEditorStore.getState();
    const interaction = storeState.interaction;
    const isNodePointerDown = storeState.isNodePointerDown;
    const isInteracting = interaction !== 'idle' || isNodePointerDown;
    const selectedIds = storeState.selectedIds;

    // --- Camera movement detection ---
    // Detect if camera position or rotation changed since last frame.
    // During camera orbit/pan (which doesn't set interaction state),
    // use wider frustum margin to prevent edge-of-frustum node popping.
    let cameraMoving = false;
    if (!camInitializedRef.current) {
      // First frame: initialize tracking state, don't flag as moving
      prevCamPosRef.current.copy(camera.position);
      prevCamQuatRef.current.copy(camera.quaternion);
      camInitializedRef.current = true;
    } else {
      const posDiffSq = prevCamPosRef.current.distanceToSquared(camera.position);
      const quatDot = prevCamQuatRef.current.dot(camera.quaternion);
      // Quaternion dot product of 1.0 means identical rotation
      const rotDiff = 1 - Math.abs(quatDot);
      if (posDiffSq > CAMERA_MOVE_THRESHOLD_SQ || rotDiff > CAMERA_ROT_THRESHOLD) {
        cameraMoving = true;
        cameraSettleRef.current = CAMERA_SETTLE_FRAMES;
      } else if (cameraSettleRef.current > 0) {
        cameraSettleRef.current--;
      }
      prevCamPosRef.current.copy(camera.position);
      prevCamQuatRef.current.copy(camera.quaternion);
    }
    const cameraUnsettled = cameraMoving || cameraSettleRef.current > 0;

    // Use a larger margin during any active interaction, camera movement,
    // or for a grace period after either ends.
    if (isInteracting) {
      postInteractionGraceRef.current = POST_INTERACTION_GUARD_FRAMES + POST_INTERACTION_MARGIN_FRAMES;
    } else if (postInteractionGraceRef.current > 0) {
      postInteractionGraceRef.current--;
    }
    const postInteractionGuard = !isInteracting && postInteractionGraceRef.current > POST_INTERACTION_MARGIN_FRAMES;
    // Active margin when: interacting, post-interaction grace, OR camera is moving/settling
    const activeMargin = (isInteracting || postInteractionGraceRef.current > 0 || cameraUnsettled)
      ? FRUSTUM_MARGIN_ACTIVE : FRUSTUM_MARGIN;

    // Build frustum from camera
    _projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    // Build expanded frustum for margin
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspCam = camera as THREE.PerspectiveCamera;
      const aspect = perspCam.aspect;
      const expandedFov = perspCam.fov * (1 + activeMargin);
      const expandedFovRad = THREE.MathUtils.degToRad(expandedFov);
      _expandedMatrix.makePerspective(
        -Math.tan(expandedFovRad / 2) * perspCam.near * aspect,
        Math.tan(expandedFovRad / 2) * perspCam.near * aspect,
        Math.tan(expandedFovRad / 2) * perspCam.near,
        -Math.tan(expandedFovRad / 2) * perspCam.near,
        perspCam.near,
        perspCam.far,
      );
      _expandedMatrix.multiply(camera.matrixWorldInverse);
      _expandedFrustum.setFromProjectionMatrix(_expandedMatrix);
    } else {
      // Orthographic camera: expand bounds by margin percentage
      const orthoCam = camera as THREE.OrthographicCamera;
      const hw = (orthoCam.right - orthoCam.left) * 0.5 * activeMargin;
      const hh = (orthoCam.top - orthoCam.bottom) * 0.5 * activeMargin;
      _expandedMatrix.makeOrthographic(
        orthoCam.left - hw,
        orthoCam.right + hw,
        orthoCam.top + hh,
        orthoCam.bottom - hh,
        orthoCam.near,
        orthoCam.far,
      );
      _expandedMatrix.multiply(camera.matrixWorldInverse);
      _expandedFrustum.setFromProjectionMatrix(_expandedMatrix);
    }

    const map = lodMap.current;
    const cameraPos = camera.position;
    const cullCounter = cullCounterRef.current;

    let visibleCount = 0;

    // During any active interaction (dragging, box-selecting, drawing connections)
    // AND for a few frames after interaction ends (post-interaction stabilization),
    // skip culling entirely — show all nodes at their distance-based LOD.
    // This prevents:
    // 1. Nodes disappearing during the drag threshold window (before 'dragging-node' is set)
    // 2. Box-selected nodes flickering at frustum edges
    // 3. Connection targets disappearing while drawing
    // 4. All nodes vanishing on the transition frame when drag ends (frustum calc glitch)
    if (isInteracting || postInteractionGuard) {
      for (const id in nodes) {
        const node = nodes[id];
        _point.set(node.position[0], node.position[1], node.position[2]);
        const dx = _point.x - cameraPos.x;
        const dy = _point.y - cameraPos.y;
        const dz = _point.z - cameraPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        map.set(id, distSq > lodDistSq ? 'lod' : 'full');
        visibleCount++;
      }
      // Clean up stale entries
      for (const id of map.keys()) {
        if (!(id in nodes)) map.delete(id);
      }
      // Keep spatial index in sync during interaction so it is never stale
      // when the interaction guard exits on the next frame. Without this,
      // dragged nodes may be in a stale cell and briefly cull on transition.
      if (useSpatial) {
        for (const id of nodeKeys) {
          const pos = nodes[id].position;
          spatialIndex.update(id, pos[0], pos[2]);
        }
        // Remove stale entries from spatial index
        for (const id of map.keys()) {
          if (!(id in nodes)) spatialIndex.remove(id);
        }
      }
      // Reset hysteresis and all-culled counters during interaction
      cullCounter.clear();
      allCulledFramesRef.current = 0;
      // Purge deleted node IDs from LOD snapshot to prevent memory leak
      const snapshot = prevLodSnapshotRef.current;
      for (const id of snapshot.keys()) {
        if (!(id in nodes)) snapshot.delete(id);
      }
      hadVisibleRef.current = true;
      prevNodeCountRef.current = nodeCount;
      wasInGuardRef.current = true;
      // Check if visible count changed — trigger React re-render sync
      if (prevVisibleCountRef.current !== -1 && prevVisibleCountRef.current !== visibleCount) {
        prevVisibleCountRef.current = visibleCount;
        bumpEpoch();
      } else {
        prevVisibleCountRef.current = visibleCount;
      }
      return;
    }

    if (useSpatial) {
      // --- Spatial index path (large graphs) ---

      // Rebuild if node count changed significantly (undo/redo/load),
      // transitioning from linear to spatial path, first population,
      // or just exiting the interaction guard (ensures cells are fresh)
      const wasLinear = prevNodeCountRef.current < SPATIAL_INDEX_THRESHOLD;
      const justExitedGuard = wasInGuardRef.current;
      if (wasLinear || justExitedGuard ||
          Math.abs(nodeCount - prevNodeCountRef.current) > nodeCount * 0.3 ||
          (prevNodeCountRef.current === 0 && nodeCount > 0)) {
        spatialIndex.rebuild(nodes);
      } else {
        // Incremental update: add/update existing, remove stale
        for (const id of nodeKeys) {
          const pos = nodes[id].position;
          spatialIndex.update(id, pos[0], pos[2]);
        }
        // Remove nodes no longer in the record
        for (const id of map.keys()) {
          if (!(id in nodes)) {
            spatialIndex.remove(id);
          }
        }
      }

      // Compute the camera frustum's XZ bounding box by projecting
      // NDC corners through the inverse view-projection onto the XZ plane.
      // IMPORTANT: Use the EXPANDED frustum matrix (not the original) so the
      // AABB covers the same area as the expanded frustum used for containsPoint.
      // Otherwise, nodes at the expanded frustum edges are missed by the spatial
      // index query and incorrectly culled (root cause of the "nodes disappear
      // during orbit/drag" user bug).
      _invProjView.copy(_expandedMatrix);

      // Guard against singular/near-singular matrices. When the projection-view
      // matrix is degenerate (camera in extreme position), invert() silently
      // produces all-zero results, causing all corners to project to (0,0,0)
      // and creating a tiny AABB that culls everything.
      const det = _invProjView.determinant();
      const matrixValid = Math.abs(det) > 1e-10;
      if (matrixValid) {
        _invProjView.invert();
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;

      // Project 4 NDC corners onto XZ plane via ray casting
      let hitCount = 0;
      if (matrixValid) {
        for (const [nx, nz] of NDC_CORNERS) {
          // Near plane point in NDC
          _corner.set(nx, nz, -1).applyMatrix4(_invProjView);
          // Far plane point in NDC — use _farPoint to avoid aliasing with _intersection
          _farPoint.set(nx, nz, 1).applyMatrix4(_invProjView);
          // Ray from near to far
          _ray.origin.copy(_corner);
          _ray.direction.copy(_farPoint).sub(_corner).normalize();
          const hit = _ray.intersectPlane(_xzPlane, _intersection);
          if (hit) {
            minX = Math.min(minX, hit.x);
            maxX = Math.max(maxX, hit.x);
            minZ = Math.min(minZ, hit.z);
            maxZ = Math.max(maxZ, hit.z);
            hitCount++;
          }
        }
      }

      // Detect degenerate AABB: even with 3+ hits, if all projected points
      // cluster within a tiny area (< 1 unit), the matrix produced garbage.
      // This happens when invert() "succeeds" but produces near-zero results.
      const aabbValid = hitCount >= 3 &&
        (maxX - minX) > 1 && (maxZ - minZ) > 1;

      // Fallback: use a generous margin around the camera position scaled by
      // distance to handle both near and far camera positions
      if (!aabbValid) {
        const camDist = cameraPos.length();
        const fallbackMargin = Math.max(100, camDist * 2);
        minX = cameraPos.x - fallbackMargin;
        maxX = cameraPos.x + fallbackMargin;
        minZ = cameraPos.z - fallbackMargin;
        maxZ = cameraPos.z + fallbackMargin;
      } else {
        // Add generous margin for nodes just outside frustum edges.
        // The expanded frustum AABB already covers the margin, but we add
        // extra padding to account for node width and numerical precision.
        const spanX = maxX - minX;
        const spanZ = maxZ - minZ;
        const pad = Math.max(spanX, spanZ) * 0.25 + 10;
        minX -= pad;
        maxX += pad;
        minZ -= pad;
        maxZ += pad;
      }

      // First mark all as culled, then check candidates
      for (const id of map.keys()) {
        if (!(id in nodes)) {
          map.delete(id);
        } else {
          map.set(id, 'culled');
        }
      }

      // Query spatial index for candidate nodes
      const candidates = spatialIndex.queryAABB(minX, maxX, minZ, maxZ);

      for (const id of candidates) {
        const node = nodes[id];
        if (!node) continue;
        _point.set(node.position[0], node.position[1], node.position[2]);

        if (!_expandedFrustum.containsPoint(_point)) {
          map.set(id, 'culled');
          continue;
        }

        const dx = _point.x - cameraPos.x;
        const dy = _point.y - cameraPos.y;
        const dz = _point.z - cameraPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const lod = distSq > lodDistSq ? 'lod' : 'full';
        map.set(id, lod);
        visibleCount++;
      }

      // Nodes not in any candidate cell are already 'culled'
      for (const id of nodeKeys) {
        if (!map.has(id)) {
          map.set(id, 'culled');
        }
      }
    } else {
      // --- Linear path (small graphs, <100 nodes) ---
      for (const id in nodes) {
        const node = nodes[id];
        _point.set(node.position[0], node.position[1], node.position[2]);

        if (!_expandedFrustum.containsPoint(_point)) {
          map.set(id, 'culled');
          continue;
        }

        const dx = _point.x - cameraPos.x;
        const dy = _point.y - cameraPos.y;
        const dz = _point.z - cameraPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        map.set(id, distSq > lodDistSq ? 'lod' : 'full');
        visibleCount++;
      }

      // Clean up stale entries
      for (const id of map.keys()) {
        if (!(id in nodes)) {
          map.delete(id);
        }
      }
    }

    // Multi-frame hysteresis: when a node transitions to 'culled', keep it visible
    // for HYSTERESIS_FRAMES frames before actually culling it. This smooths transitions
    // at frustum edges during camera movement and prevents brief disappearance pops.
    for (const id of nodeKeys) {
      const current = map.get(id);
      if (current === 'culled') {
        const counter = (cullCounter.get(id) ?? 0) + 1;
        cullCounter.set(id, counter);
        if (counter <= HYSTERESIS_FRAMES) {
          // Still within grace period — keep visible at reduced LOD
          map.set(id, 'lod');
          visibleCount++;
        }
      } else {
        // Node is visible — reset its cull counter
        cullCounter.delete(id);
      }
    }

    // Selected nodes should NEVER be culled — the user is looking at them
    // or about to interact with them. Override culled → 'full' for selections.
    if (selectedIds.size > 0) {
      for (const id of selectedIds) {
        if (id in nodes && map.get(id) === 'culled') {
          map.set(id, 'full');
          visibleCount++;
        }
      }
    }

    // Defensive guard: detect both all-culled AND sudden-drop glitches.
    // A sudden large drop in visible nodes (>50% in one frame) is almost
    // certainly a transient glitch (stale frustum, camera transition, orbit
    // inertia). Individual nodes leaving the frustum one by one is gradual;
    // a sudden majority disappearing is always a calculation glitch.
    const prevVisible = prevVisibleCountRef.current;
    const isSuddenDrop = prevVisible > 0 && nodeCount > 0 && hadVisibleRef.current &&
      visibleCount < prevVisible * 0.35;
    const isAllCulled = visibleCount === 0 && nodeCount > 0 && hadVisibleRef.current;

    if (isAllCulled || isSuddenDrop) {
      allCulledFramesRef.current++;
      // Restore each node's previous LOD from the snapshot instead of forcing
      // all to 'full'. This prevents the visible lod→full→lod pop that occurs
      // when a transient glitch is followed by the frustum recovering.
      const snapshot = prevLodSnapshotRef.current;
      for (const id of nodeKeys) {
        map.set(id, snapshot.get(id) ?? 'full');
      }
      visibleCount = nodeCount;
    } else {
      // Visible count is stable or gradually changing — reset counter
      allCulledFramesRef.current = 0;
    }

    // Take LOD snapshot whenever at least one node is visible (not during grace).
    // This captures the "last good" LOD state to restore from during grace frames.
    if (visibleCount > 0 && allCulledFramesRef.current === 0) {
      const snapshot = prevLodSnapshotRef.current;
      snapshot.clear();
      for (const id of nodeKeys) {
        snapshot.set(id, map.get(id) ?? 'full');
      }
    }

    // Clean up cull counters for nodes that no longer exist
    for (const id of cullCounter.keys()) {
      if (!(id in nodes)) cullCounter.delete(id);
    }
    // Clean up stale entries from LOD snapshot (deleted nodes)
    const snapshotCleanup = prevLodSnapshotRef.current;
    for (const id of snapshotCleanup.keys()) {
      if (!(id in nodes)) snapshotCleanup.delete(id);
    }

    hadVisibleRef.current = visibleCount > 0;
    prevNodeCountRef.current = nodeCount;
    wasInGuardRef.current = false;

    // Trigger React re-render when the set of visible nodes changes.
    // This ensures NodeGraph mounts/unmounts nodes in sync with LOD changes,
    // preventing the "delayed pop" where LOD changes in useFrame but React
    // doesn't re-render until some unrelated state change.
    if (prevVisibleCountRef.current !== -1 && prevVisibleCountRef.current !== visibleCount) {
      bumpEpoch();
    }
    prevVisibleCountRef.current = visibleCount;
  });

  const getLOD = useCallback((nodeId: string): LODLevel => {
    return lodMap.current.get(nodeId) ?? 'full';
  }, []);

  return { getLOD, lodMap, cullingEpoch };
}
