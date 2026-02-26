import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';

// Reusable objects for hot-path calculations (avoid allocations per frame)
const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
const _xzPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _intersect = new THREE.Vector3();
const _cursorBefore = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _offset = new THREE.Vector3();

/**
 * Smooth scroll-wheel zoom with momentum/inertia and zoom-to-cursor.
 *
 * Instead of OrbitControls' built-in zoom (which snaps per tick), this hook
 * accumulates wheel delta into a velocity that decays exponentially over
 * multiple frames, producing a buttery-smooth zoom feel.
 *
 * Zoom-to-cursor: the world point under the mouse cursor stays fixed during
 * zoom, making navigation feel natural (like Figma/Blender).
 *
 * - Normal wheel: standard zoom toward cursor
 * - Ctrl+Wheel: precision zoom (0.3x speed)
 */
export function useSmoothZoom() {
  const { camera, gl, invalidate } = useThree();
  const velocity = useRef(0);
  const isZooming = useRef(false);
  // Store the mouse NDC at the time of the wheel event
  const mouseNDC = useRef({ x: 0, y: 0 });

  const minDistance = 3;
  const maxDistance = 30;

  useEffect(() => {
    const canvas = gl.domElement;

    const onWheel = (e: WheelEvent) => {
      // Only zoom when interaction is idle (controls enabled)
      const interaction = useEditorStore.getState().interaction;
      if (interaction !== 'idle') return;

      e.preventDefault();

      const sensitivity = useSettingsStore.getState().zoomSensitivity;
      const precisionMultiplier = e.ctrlKey ? 0.3 : 1;

      // Normalize delta (different browsers/devices report different magnitudes)
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 36; // line mode → pixel approximation
      if (e.deltaMode === 2) delta *= window.innerHeight; // page mode

      // Clamp individual tick to prevent enormous jumps (e.g. trackpad fling)
      delta = Math.max(-200, Math.min(200, delta));

      // Accumulate into velocity (positive = zoom out, negative = zoom in)
      velocity.current += delta * 0.00025 * sensitivity * precisionMultiplier;
      // Cap velocity to prevent runaway zoom from rapid scroll or trackpad fling
      velocity.current = Math.max(-0.15, Math.min(0.15, velocity.current));
      isZooming.current = true;

      // Capture mouse position in NDC (-1 to +1) for zoom-to-cursor
      const rect = canvas.getBoundingClientRect();
      mouseNDC.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Ensure render loop runs
      invalidate();
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [gl, camera, invalidate]);

  useFrame(() => {
    if (!isZooming.current && Math.abs(velocity.current) < 0.001) return;

    const controls = window.__orbitControls;
    if (!controls) return;

    const target = controls.target;
    const currentDistance = camera.position.distanceTo(target);

    // Apply velocity: zoom proportional to current distance (feels uniform)
    const zoomAmount = velocity.current * currentDistance;
    const newDistance = Math.max(minDistance, Math.min(maxDistance, currentDistance + zoomAmount));

    if (Math.abs(newDistance - currentDistance) > 0.0001) {
      // --- Zoom-to-cursor ---
      // Raycast from mouse position to the XZ plane to find the world point
      // under the cursor. As we zoom, shift camera+target so this point
      // stays at the same screen position.
      _mouse.set(mouseNDC.current.x, mouseNDC.current.y);
      _raycaster.setFromCamera(_mouse, camera);
      const hit = _raycaster.ray.intersectPlane(_xzPlane, _intersect);

      if (hit) {
        // World point under cursor before zoom (copy to avoid clone() allocation)
        _cursorBefore.copy(_intersect);

        // Move camera along direction to/from target to new distance
        _direction.copy(camera.position).sub(target).normalize();
        camera.position.copy(target).addScaledVector(_direction, newDistance);

        // Raycast again from same screen point at new camera position
        _raycaster.setFromCamera(_mouse, camera);
        const hitAfter = _raycaster.ray.intersectPlane(_xzPlane, _intersect);

        if (hitAfter) {
          // Shift camera + target so cursor world point stays fixed
          _offset.copy(_cursorBefore).sub(_intersect);
          camera.position.add(_offset);
          target.add(_offset);
        }
      } else {
        // Fallback: no XZ hit (e.g. looking away), just zoom toward target
        _direction.copy(camera.position).sub(target).normalize();
        camera.position.copy(target).addScaledVector(_direction, newDistance);
      }

      controls.update();
    }

    // Exponential decay (0.75 per frame at 60fps — snappy deceleration, settles fast)
    velocity.current *= 0.75;

    // Stop when velocity is negligible
    if (Math.abs(velocity.current) < 0.001) {
      velocity.current = 0;
      isZooming.current = false;
    } else {
      invalidate(); // Keep rendering while decaying
    }
  });
}
