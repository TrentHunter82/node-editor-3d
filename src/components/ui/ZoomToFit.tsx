import { useCallback, useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import * as THREE from 'three';

// Module-scoped reusable objects to avoid per-call allocation
const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
const _expandPoint = new THREE.Vector3();

// Track active animation to cancel on re-trigger (prevents RAF stacking)
let activeZoomRaf = 0;

/**
 * Invisible R3F component that provides zoom-to-fit functionality.
 * Listens for the 'F' key and exposes a global function for the toolbar button.
 */
export function ZoomToFit() {
  const { camera, controls } = useThree();

  // Fly camera to a specific position+target (reused by zoomToFit, bookmarks, and view presets)
  // ~300ms ease-out cubic. Cancels on user interaction (orbit/pan/scroll).
  const flyCamera = useCallback((
    endPosition: [number, number, number],
    endTargetArr: [number, number, number],
  ) => {
    if (activeZoomRaf) cancelAnimationFrame(activeZoomRaf);
    activeZoomRaf = 0;

    const startPos = camera.position.clone();
    const orbitControls = controls as OrbitControlsImpl | null;
    const startTarget = orbitControls?.target?.clone() ?? new THREE.Vector3();
    const endPos = new THREE.Vector3(...endPosition);
    const endTarget = new THREE.Vector3(...endTargetArr);

    // Cancel animation if user starts orbiting/panning/scrolling
    let cancelled = false;
    const onUserInteraction = () => { cancelled = true; };
    const gl = (controls as unknown as { domElement?: HTMLElement })?.domElement
      ?? document.querySelector('canvas');
    if (gl) {
      gl.addEventListener('pointerdown', onUserInteraction, { once: true });
      gl.addEventListener('wheel', onUserInteraction, { once: true });
    }
    const cleanup = () => {
      if (gl) {
        gl.removeEventListener('pointerdown', onUserInteraction);
        gl.removeEventListener('wheel', onUserInteraction);
      }
    };

    let t = 0;
    const animate = () => {
      if (cancelled) {
        activeZoomRaf = 0;
        cleanup();
        return;
      }
      t += 0.055; // ~18 frames at 60fps ≈ 300ms
      if (t > 1) t = 1;
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      camera.position.lerpVectors(startPos, endPos, ease);
      if (orbitControls?.target) {
        orbitControls.target.lerpVectors(startTarget, endTarget, ease);
        orbitControls.update();
      }
      camera.lookAt(endTarget);
      window.__invalidate?.();
      if (t < 1) {
        activeZoomRaf = requestAnimationFrame(animate);
      } else {
        activeZoomRaf = 0;
        cleanup();
      }
    };
    animate();
  }, [camera, controls]);

  const zoomToFit = useCallback(() => {
    const nodes = useEditorStore.getState().nodes;
    const positions = Object.values(nodes).map(n => n.position);

    if (positions.length === 0) return;

    // Calculate bounding box
    _box.makeEmpty();
    for (const pos of positions) {
      _box.expandByPoint(_expandPoint.set(pos[0], pos[1], pos[2]));
    }

    // Expand box to account for node size (1.6 x 0.5 x 0.8)
    _box.expandByScalar(1.5);

    _box.getCenter(_center);
    _box.getSize(_size);

    // Calculate distance needed to fit
    const maxDim = Math.max(_size.x, _size.y, _size.z);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const distance = (maxDim / 2) / Math.tan(fov / 2) * 1.3;

    // Compute target position (offset above and to the side)
    const endPos: [number, number, number] = [
      _center.x + distance * 0.4,
      distance * 0.6,
      _center.z + distance * 0.6,
    ];
    const endTarget: [number, number, number] = [_center.x, _center.y, _center.z];

    flyCamera(endPos, endTarget);
  }, [camera, flyCamera]);

  // Recall a camera bookmark by slot number
  const recallBookmark = useCallback((slot: number) => {
    const bookmark = useSettingsStore.getState().cameraBookmarks[String(slot)];
    if (!bookmark) return;
    flyCamera(bookmark.position, bookmark.target);
  }, [flyCamera]);

  // Fly to a named view preset (top, front, right, left, isometric).
  // Preserves the current orbit target so the view centers on what the user was looking at.
  const flyToViewPreset = useCallback((preset: 'top' | 'front' | 'right' | 'left' | 'isometric') => {
    const orbitControls = controls as OrbitControlsImpl | null;
    const target = orbitControls?.target
      ? [orbitControls.target.x, orbitControls.target.y, orbitControls.target.z] as [number, number, number]
      : [0, 0, 0] as [number, number, number];
    const dist = camera.position.distanceTo(orbitControls?.target ?? new THREE.Vector3());
    const d = Math.max(dist, 10); // minimum distance for usable view

    let pos: [number, number, number];
    switch (preset) {
      case 'top':
        pos = [target[0], target[1] + d, target[2] + 0.01]; // tiny offset avoids gimbal lock
        break;
      case 'front':
        pos = [target[0], target[1] + d * 0.3, target[2] + d * 0.9];
        break;
      case 'right':
        pos = [target[0] + d * 0.9, target[1] + d * 0.3, target[2]];
        break;
      case 'left':
        pos = [target[0] - d * 0.9, target[1] + d * 0.3, target[2]];
        break;
      case 'isometric':
      default:
        pos = [target[0] + d * 0.5, target[1] + d * 0.6, target[2] + d * 0.6];
        break;
    }
    flyCamera(pos, target);
  }, [camera, controls, flyCamera]);

  // Store functions globally so the toolbar and keyboard shortcuts can call them
  useEffect(() => {
    window.__zoomToFit = zoomToFit;
    window.__recallCameraBookmark = recallBookmark;
    window.__flyToViewPreset = flyToViewPreset;
    return () => {
      window.__zoomToFit = undefined;
      window.__recallCameraBookmark = undefined;
      window.__flyToViewPreset = undefined;
      // Cancel any in-flight animation on unmount
      if (activeZoomRaf) {
        cancelAnimationFrame(activeZoomRaf);
        activeZoomRaf = 0;
      }
    };
  }, [zoomToFit, recallBookmark, flyToViewPreset]);

  // Auto zoom-to-fit on graph switch (smooth camera transition)
  const activeGraphId = useEditorStore(s => s.activeGraphId);
  const prevGraphId = useRef(activeGraphId);
  useEffect(() => {
    if (prevGraphId.current !== activeGraphId) {
      prevGraphId.current = activeGraphId;
      // Delay one frame to ensure graph data is loaded before computing bounds
      const raf = requestAnimationFrame(() => zoomToFit());
      return () => cancelAnimationFrame(raf);
    }
  }, [activeGraphId, zoomToFit]);

  return null;
}
