/**
 * Lightweight registry of node body mesh refs for Html occlusion.
 *
 * NodeModule registers its main body mesh here on mount.
 * NodeScreen uses a custom useFrame check that raycasts against these
 * body meshes to hide screens behind other nodes — without relying on
 * drei's `occlude` prop (which causes infinite render loops with
 * frameloop="demand").
 */
import { Raycaster, Vector3 } from 'three';
import type { Object3D, Camera } from 'three';

interface RefLike {
  current: Object3D | null;
}

const bodyRefs = new Map<string, RefLike>();

// Module-level raycast objects (reused across frames to avoid GC)
const _raycaster = new Raycaster();
const _worldPos = new Vector3();
const _direction = new Vector3();

/** Get or create a stable ref-like object for a node's body mesh. */
export function getBodyRef(nodeId: string): RefLike {
  let ref = bodyRefs.get(nodeId);
  if (!ref) {
    ref = { current: null };
    bodyRefs.set(nodeId, ref);
  }
  return ref;
}

/** Remove a node's body ref (call on unmount). */
export function removeBodyRef(nodeId: string): void {
  bodyRefs.delete(nodeId);
}

/**
 * Check if a screen at `screenGroup`'s world position is occluded
 * by any OTHER node's body mesh (excludes the node's own body).
 *
 * This is called from useFrame — no React state, no invalidation,
 * just a pure raycast check.
 */
export function isScreenOccluded(
  camera: Camera,
  screenGroup: Object3D,
  nodeId: string,
): boolean {
  screenGroup.getWorldPosition(_worldPos);
  _direction.subVectors(_worldPos, camera.position).normalize();
  _raycaster.set(camera.position, _direction);

  const selfRef = bodyRefs.get(nodeId);
  const selfMesh = selfRef?.current ?? null;

  // Collect other nodes' body meshes
  const targets: Object3D[] = [];
  for (const [id, ref] of bodyRefs) {
    if (id !== nodeId && ref.current && ref.current !== selfMesh) {
      targets.push(ref.current);
    }
  }

  if (targets.length === 0) return false;

  const intersects = _raycaster.intersectObjects(targets, false);
  if (intersects.length === 0) return false;

  const distToScreen = camera.position.distanceTo(_worldPos);
  return intersects[0].distance < distToScreen;
}
