import { useCallback, useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { snapToGrid } from '../store/editorStore';

const XZ_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const DRAG_THRESHOLD_PX = 4;
// Maximum distance from camera for a valid XZ intersection.
// When the camera is nearly level with the ground plane, the ray-plane
// intersection can be thousands of units away, causing wild node jumps.
const MAX_DRAG_DISTANCE_FACTOR = 3; // multiplier on camera distance
const MIN_DRAG_DISTANCE = 100; // absolute floor (reduced from 200 to prevent wild jumps)
// Maximum distance a node can move in a single drag frame.
// At 60fps with typical camera height ~10, normal drag moves ~0.5-2 units/frame.
// Anything larger than this is a glitch (shallow angle, degenerate ray, etc.).
const MAX_SINGLE_FRAME_DELTA = 50;

// Reusable vectors to avoid per-frame allocation
const _mouse = new THREE.Vector2();
const _target = new THREE.Vector3();
const _newPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _planeNormal = new THREE.Vector3();
const _coplanarPoint = new THREE.Vector3();
const _right = new THREE.Vector3();
const _verticalPlane = new THREE.Plane();
// Reserved for future smoothing: const _prevIntersection = new THREE.Vector3();

// Ctrl+drag state: set in startDrag, consumed once when threshold is crossed
let ctrlHeldAtStart = false;

export function useNodeDrag() {
  const { camera, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const shiftHeld = useRef(false);
  const pointerId = useRef<number | null>(null);
  const dragState = useRef<{
    nodeId: string;
    offset: THREE.Vector3;
    startClientX: number;
    startClientY: number;
    committed: boolean;
    // Multi-drag: offsets from cursor for each selected node
    multiOffsets: Map<string, THREE.Vector3>;
    snapshotPushed: boolean;
    // Y-axis drag: locked XZ positions when Shift is pressed
    lockedPositions: Map<string, [number, number, number]> | null;
    // Y offset from vertical plane intersection to node Y
    verticalOffsets: Map<string, number> | null;
    // Last valid XZ intersection point for per-frame delta clamping
    lastIntersection: THREE.Vector3 | null;
    // Last valid vertical intersection Y for per-frame delta clamping
    lastVerticalY: number | null;
  } | null>(null);

  const setNodePositions = useEditorStore(s => s.setNodePositions);
  const setInteraction = useEditorStore(s => s.setInteraction);

  // Track Shift key state during drag, and reset on window blur
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftHeld.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        shiftHeld.current = false;
        // Clear locked positions so next Shift press recaptures
        if (dragState.current) {
          dragState.current.lockedPositions = null;
          dragState.current.verticalOffsets = null;
          dragState.current.lastVerticalY = null;
        }
      }
    };
    // Reset shift state and end any active drag when window loses focus.
    // Without this, pointer capture stays active and drag state becomes stale
    // after tab-switching, causing "sticky" controls on refocus.
    const onBlur = () => {
      shiftHeld.current = false;
      ctrlHeldAtStart = false;
      if (dragState.current) {
        const wasCommitted = dragState.current.committed;
        dragState.current = null;
        useEditorStore.setState(s => { s.isNodePointerDown = false; });
        // Release pointer capture to prevent stale capture on refocus
        if (pointerId.current != null) {
          try { gl.domElement.releasePointerCapture(pointerId.current); } catch { /* noop */ }
          pointerId.current = null;
        }
        if (wasCommitted) {
          setInteraction('idle');
          // cursor reset handled by setInteraction('idle')
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, setInteraction]);

  // Cleanup on unmount: if a drag is active, reset interaction and cursor
  useEffect(() => {
    return () => {
      ctrlHeldAtStart = false;
      if (dragState.current) {
        const wasCommitted = dragState.current.committed;
        dragState.current = null;
        useEditorStore.setState(s => { s.isNodePointerDown = false; });
        if (pointerId.current != null) {
          try { gl.domElement.releasePointerCapture(pointerId.current); } catch { /* noop */ }
          pointerId.current = null;
        }
        if (wasCommitted) {
          setInteraction('idle');
          // cursor reset handled by setInteraction('idle')
        }
      }
    };
  }, [setInteraction, gl]);

  const setMouseFromClient = useCallback((clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    _mouse.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.current.setFromCamera(_mouse, camera);
  }, [camera, gl]);

  const getXZIntersection = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    setMouseFromClient(clientX, clientY);
    // Reject nearly-parallel rays BEFORE intersection to prevent wild coordinates.
    // When the camera is nearly level with the ground plane, the ray-plane intersection
    // can be thousands of units from the cursor, causing nodes to fly off-screen.
    const rayDirY = Math.abs(raycaster.current.ray.direction.y);
    if (rayDirY < 0.08) return null;
    const hit = raycaster.current.ray.intersectPlane(XZ_PLANE, _target);
    if (!hit) return null;
    // Secondary guard: reject intersections too far from the camera.
    // Uses camera height as primary reference (more stable than distance from origin)
    // plus the existing absolute-distance guard as a fallback.
    const cameraHeight = Math.abs(camera.position.y);
    const maxDist = Math.max(MIN_DRAG_DISTANCE, cameraHeight * 20, camera.position.length() * MAX_DRAG_DISTANCE_FACTOR);
    if (_target.distanceTo(camera.position) > maxDist) return null;
    return _target;
  }, [camera, setMouseFromClient]);

  /** Raycast against a vertical plane facing the camera at a given XZ position */
  const getVerticalIntersection = useCallback((clientX: number, clientY: number, atX: number, atZ: number): number | null => {
    setMouseFromClient(clientX, clientY);
    // Create a vertical plane facing the camera through the node's XZ position
    camera.getWorldDirection(_camDir);
    _planeNormal.set(_camDir.x, 0, _camDir.z).normalize();
    // If camera is looking straight down, fall back to camera right vector
    if (_planeNormal.lengthSq() < 0.001) {
      _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      _planeNormal.set(_right.x, 0, _right.z);
      // Degenerate case: camera straight down AND right vector is also degenerate
      if (_planeNormal.lengthSq() < 0.001) return null;
      _planeNormal.normalize();
    }
    _coplanarPoint.set(atX, 0, atZ);
    _verticalPlane.setFromNormalAndCoplanarPoint(_planeNormal, _coplanarPoint);
    const hit = raycaster.current.ray.intersectPlane(_verticalPlane, _target);
    if (!hit) return null;
    // Reject wild vertical intersections — consistent with getXZIntersection
    const cameraHeight = Math.abs(camera.position.y);
    const maxDist = Math.max(MIN_DRAG_DISTANCE, cameraHeight * 20, camera.position.length() * MAX_DRAG_DISTANCE_FACTOR);
    if (_target.distanceTo(camera.position) > maxDist) return null;
    return _target.y;
  }, [camera, setMouseFromClient]);

  const startDrag = useCallback((nodeId: string, clientX: number, clientY: number, ptrId?: number, ctrlKey?: boolean) => {
    const state = useEditorStore.getState();
    const node = state.nodes[nodeId];
    if (!node) return;
    // Locked nodes cannot be dragged
    if (node.locked) return;

    const point = getXZIntersection(clientX, clientY);
    if (!point) return;

    const nodePos = new THREE.Vector3(...node.position);
    const offset = nodePos.clone().sub(point);

    // Calculate offsets for all selected nodes (multi-drag)
    const multiOffsets = new Map<string, THREE.Vector3>();
    const selected = state.selectedIds;
    if (selected.has(nodeId) && selected.size > 1) {
      for (const id of selected) {
        const n = state.nodes[id];
        if (n && !n.locked) {
          multiOffsets.set(id, new THREE.Vector3(...n.position).sub(point));
        }
      }
    } else {
      multiOffsets.set(nodeId, offset);
    }

    // Capture the pointer on the canvas for reliable event delivery
    // This ensures pointerup always fires even if cursor leaves the window
    if (ptrId != null) {
      try {
        gl.domElement.setPointerCapture(ptrId);
        pointerId.current = ptrId;
      } catch {
        // setPointerCapture can fail if pointer was already released
      }
    }

    // Track Ctrl state at drag start for duplicate-drag feature
    ctrlHeldAtStart = !!ctrlKey;

    // DON'T set interaction to 'dragging-node' yet — wait for the drag
    // threshold to be crossed in onDrag(). This prevents briefly disabling
    // OrbitControls on every node click (which causes "sticky" feel when
    // clicking nodes then immediately trying to orbit/pan).
    //
    // However, signal that a node pointer is down so viewport culling can
    // skip frustum tests during the pre-threshold window (prevents node
    // disappearing flash).
    useEditorStore.setState(s => { s.isNodePointerDown = true; });

    dragState.current = {
      nodeId,
      offset,
      startClientX: clientX,
      startClientY: clientY,
      committed: false,
      multiOffsets,
      snapshotPushed: false,
      lockedPositions: null,
      verticalOffsets: null,
      lastIntersection: point.clone(),
      lastVerticalY: null,
    };
  }, [getXZIntersection, gl]);

  const onDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragState.current) return;

    // Check threshold before committing to drag
    if (!dragState.current.committed) {
      const dx = clientX - dragState.current.startClientX;
      const dy = clientY - dragState.current.startClientY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;

      // Threshold crossed — commit to drag
      dragState.current.committed = true;
      // NOW set interaction to disable OrbitControls (not before threshold)
      setInteraction('dragging-node');
      document.body.style.cursor = 'grabbing';

      // Ctrl+drag: duplicate the selected nodes in-place, then drag the copies
      if (ctrlHeldAtStart) {
        ctrlHeldAtStart = false; // consumed
        // duplicateSelected(true) pushes undo, creates copies at same position,
        // duplicates internal connections, and selects the copies
        const oldToNew = useEditorStore.getState().duplicateSelected(true);
        if (oldToNew && oldToNew.size > 0) {
          dragState.current.snapshotPushed = true; // undo already pushed by duplicateSelected

          // Remap multiOffsets from old IDs to new duplicated IDs
          const newMultiOffsets = new Map<string, THREE.Vector3>();
          for (const [oldId, offset] of dragState.current.multiOffsets) {
            const newId = oldToNew.get(oldId);
            if (newId) {
              newMultiOffsets.set(newId, offset);
            }
          }
          // Remap primary drag node
          const newPrimaryId = oldToNew.get(dragState.current.nodeId);
          if (newPrimaryId) {
            dragState.current.nodeId = newPrimaryId;
            dragState.current.offset = newMultiOffsets.get(newPrimaryId) ?? dragState.current.offset;
          }
          dragState.current.multiOffsets = newMultiOffsets;
        }
      } else {
        // Normal drag — push undo snapshot once
        if (!dragState.current.snapshotPushed) {
          useEditorStore.getState().pushUndoSnapshot();
          dragState.current.snapshotPushed = true;
        }
      }
    }

    const { snapEnabled: snap, nodes } = useEditorStore.getState();

    if (shiftHeld.current) {
      // --- Shift held: Y-axis (vertical) drag mode ---
      // Lock XZ positions on first Shift frame
      if (!dragState.current.lockedPositions) {
        dragState.current.lockedPositions = new Map();
        dragState.current.verticalOffsets = new Map();
        for (const [id] of dragState.current.multiOffsets) {
          const n = nodes[id];
          if (n) {
            dragState.current.lockedPositions.set(id, [...n.position]);
            // Calculate Y offset: difference between node's current Y and the vertical intersection
            const vertY = getVerticalIntersection(clientX, clientY, n.position[0], n.position[2]);
            if (vertY !== null) {
              const offset = n.position[1] - vertY;
              // Reject suspiciously large offsets (indicates bad intersection)
              if (Math.abs(offset) < MAX_SINGLE_FRAME_DELTA) {
                dragState.current.verticalOffsets!.set(id, offset);
              }
            }
          }
        }
      }

      // Raycast using the primary node's locked XZ for the vertical plane
      const primaryLocked = dragState.current.lockedPositions.get(dragState.current.nodeId);
      if (!primaryLocked) return;

      const vertY = getVerticalIntersection(clientX, clientY, primaryLocked[0], primaryLocked[2]);
      if (vertY === null) return;

      // Per-frame Y-delta clamp: reject if vertical intersection jumps too far
      // (mirrors the XZ lastIntersection delta check, prevents wild Y jumps)
      if (dragState.current.lastVerticalY !== null) {
        const dy = Math.abs(vertY - dragState.current.lastVerticalY);
        if (dy > MAX_SINGLE_FRAME_DELTA) return;
      }
      dragState.current.lastVerticalY = vertY;

      // The primary offset determines how all nodes move
      const primaryVertOffset = dragState.current.verticalOffsets?.get(dragState.current.nodeId) ?? 0;
      const rawY = vertY + primaryVertOffset;
      const newY = Math.max(0, snap ? snapToGrid(rawY) : rawY); // Clamp to ground

      // Batch all vertical position updates into a single set() call
      const vertPositions: Record<string, [number, number, number]> = {};
      for (const [id] of dragState.current.multiOffsets) {
        const locked = dragState.current.lockedPositions.get(id);
        if (!locked) continue;
        const nodeVertOffset = dragState.current.verticalOffsets?.get(id) ?? 0;
        const deltaFromPrimary = nodeVertOffset - primaryVertOffset;
        const nodeY = Math.max(0, newY + deltaFromPrimary);
        vertPositions[id] = [locked[0], nodeY, locked[2]];
      }
      setNodePositions(vertPositions);
    } else {
      // --- Default: XZ-plane (horizontal) drag mode ---
      const point = getXZIntersection(clientX, clientY);
      if (!point) return;

      // Per-frame delta clamp: reject intersection if it jumps too far from
      // the previous frame's intersection. This catches degenerate ray-plane
      // intersections that slip through the distance guard (e.g., when the
      // camera is at a borderline angle). Without this, nodes can "fly off screen".
      if (dragState.current.lastIntersection) {
        const dx = point.x - dragState.current.lastIntersection.x;
        const dz = point.z - dragState.current.lastIntersection.z;
        if (dx * dx + dz * dz > MAX_SINGLE_FRAME_DELTA * MAX_SINGLE_FRAME_DELTA) {
          return; // reject this frame's movement as wild
        }
      }
      // Update last intersection for next frame's delta check
      if (!dragState.current.lastIntersection) {
        dragState.current.lastIntersection = point.clone();
      } else {
        dragState.current.lastIntersection.copy(point);
      }

      // Batch all horizontal position updates into a single set() call
      const xzPositions: Record<string, [number, number, number]> = {};
      for (const [id, offset] of dragState.current.multiOffsets) {
        _newPos.copy(point).add(offset);
        const x = snap ? snapToGrid(_newPos.x) : _newPos.x;
        const z = snap ? snapToGrid(_newPos.z) : _newPos.z;
        const currentY = nodes[id]?.position[1] ?? 0;
        xzPositions[id] = [x, currentY, z];
      }
      setNodePositions(xzPositions);
    }
  }, [getXZIntersection, getVerticalIntersection, setNodePositions, setInteraction]);

  const endDrag = useCallback(() => {
    if (dragState.current) {
      const wasCommitted = dragState.current.committed;
      dragState.current = null;
      // Clear the pointer-down signal so viewport culling resumes normal operation
      useEditorStore.setState(s => { s.isNodePointerDown = false; });
      // Release pointer capture if we hold it
      if (pointerId.current != null) {
        try {
          gl.domElement.releasePointerCapture(pointerId.current);
        } catch {
          // May already be released
        }
        pointerId.current = null;
      }
      // Only reset interaction if we actually entered 'dragging-node' state
      // (i.e., the drag threshold was crossed). For clicks that didn't cross
      // the threshold, interaction is still 'idle' and shouldn't be touched.
      if (wasCommitted) {
        setInteraction('idle');
        // cursor reset handled by setInteraction('idle') centrally
      }
    }
  }, [setInteraction, gl]);

  const isDragging = useCallback(() => dragState.current !== null, []);

  return { startDrag, onDrag, endDrag, isDragging };
}
