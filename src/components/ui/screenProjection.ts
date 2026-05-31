import * as THREE from 'three';

const XZ_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _mouse = new THREE.Vector2();
const _target = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();

// Shared camera reference set by CameraProvider inside the Canvas
export let sharedCamera: THREE.Camera | null = null;
export function setSharedCamera(cam: THREE.Camera) { sharedCamera = cam; }

/** Project a screen-space point onto the y=0 ground plane, returning world [x, z]. */
export function getXZFromScreen(clientX: number, clientY: number, canvas: HTMLCanvasElement): [number, number] | null {
  if (!sharedCamera) return null;
  const rect = canvas.getBoundingClientRect();
  _mouse.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  _raycaster.setFromCamera(_mouse, sharedCamera);
  const hit = _raycaster.ray.intersectPlane(XZ_PLANE, _target);
  return hit ? [_target.x, _target.z] : null;
}
