import { useEffect, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useEditorStore } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSmoothZoom } from '../hooks/useSmoothZoom';

// Module-scoped reusable vectors for alt-pan hot path (avoids per-move allocations)
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _panOffset = new THREE.Vector3();

/**
 * Subscribes to Zustand state changes and calls invalidate() to trigger
 * R3F re-renders in demand mode. Also exposes invalidate globally for
 * RAF-based animations (ZoomToFit, Minimap).
 */
function SceneInvalidator() {
  const invalidate = useThree(s => s.invalidate);
  const gl = useThree(s => s.gl);
  const scene = useThree(s => s.scene);
  const camera = useThree(s => s.camera);

  useEffect(() => {
    // Expose invalidate globally for external RAF animations
    window.__invalidate = invalidate;
    return () => { window.__invalidate = undefined; };
  }, [invalidate]);

  // Export image: render current view to PNG and download
  useEffect(() => {
    window.__exportImage = () => {
      if (!gl || !scene || !camera) return;
      // Force a fresh render to ensure the canvas is up to date
      gl.render(scene, camera);
      const dataUrl = gl.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'node-editor-graph.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };
    return () => { window.__exportImage = undefined; };
  }, [gl, scene, camera]);

  // Subscribe to Zustand store — invalidate only when visual state changes.
  // Excludes profiling metrics, execution state, debug state, and UI chrome
  // which don't affect 3D scene rendering. R3F's reconciler handles invalidation
  // for components that consume execution state via their own selectors.
  useEffect(() => {
    let prev = useEditorStore.getState();
    const unsub = useEditorStore.subscribe((state) => {
      if (
        state.nodes !== prev.nodes ||
        state.connections !== prev.connections ||
        state.groups !== prev.groups ||
        state.selectedIds !== prev.selectedIds ||
        state.interaction !== prev.interaction ||
        state.pendingConnection !== prev.pendingConnection ||
        state.hoveredConnectionId !== prev.hoveredConnectionId ||
        state.contextMenu !== prev.contextMenu ||
        state.validationErrors !== prev.validationErrors ||
        state.snapEnabled !== prev.snapEnabled ||
        state.showValuePreviews !== prev.showValuePreviews ||
        state.customNodeDefs !== prev.customNodeDefs ||
        state.subgraphDefs !== prev.subgraphDefs ||
        state.searchHighlightIds !== prev.searchHighlightIds ||
        state.diffHighlightIds !== prev.diffHighlightIds ||
        state.graphVariables !== prev.graphVariables
      ) {
        invalidate();
      }
      prev = state;
    });
    return unsub;
  }, [invalidate]);

  // Sync scene clear color with theme
  useEffect(() => {
    let prevTheme = useSettingsStore.getState().theme;
    const unsub = useSettingsStore.subscribe((state) => {
      if (state.theme !== prevTheme) {
        prevTheme = state.theme;
        gl.setClearColor(state.theme === 'light' ? '#D0D0D8' : '#000000');
        invalidate();
      }
    });
    // Set initial color based on current theme
    gl.setClearColor(prevTheme === 'light' ? '#D0D0D8' : '#000000');
    return unsub;
  }, [gl, invalidate]);

  return null;
}

export function SceneSetup() {
  const interaction = useEditorStore(s => s.interaction);
  const panSpeed = useSettingsStore(s => s.panSpeed);
  const rotateSpeed = useSettingsStore(s => s.rotateSpeed);
  const cameraDamping = useSettingsStore(s => s.cameraDamping);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // Smooth scroll-wheel zoom with momentum (replaces OrbitControls' built-in zoom)
  useSmoothZoom();

  // Expose OrbitControls globally for minimap click-to-navigate.
  // Uses RAF to set the global after R3F assigns the ref (first commit).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (controlsRef.current) {
        window.__orbitControls = controlsRef.current;
      }
    });
    return () => {
      cancelAnimationFrame(id);
      window.__orbitControls = undefined;
    };
  }, []);

  // Refs for damping animation keepalive (declared before effects that use them)
  const needsUpdate = useRef(false);
  const dampingTimeout = useRef<number>(0);

  // Imperatively sync OrbitControls.enabled with interaction state.
  // This bypasses React's render cycle to prevent the race condition where
  // OrbitControls captures a gesture before React re-renders with enabled=false.
  useEffect(() => {
    const unsub = useEditorStore.subscribe(
      s => s.interaction,
      (mode) => {
        if (controlsRef.current) {
          const shouldEnable = mode === 'idle';
          controlsRef.current.enabled = shouldEnable;
          // When disabling, clear internal damping velocities by toggling
          // enableDamping off and calling update() once. The non-damped path
          // zeros sphericalDelta and panOffset, so when damping is re-enabled
          // there's no residual momentum. This avoids the reset() hack which
          // snapped camera to initial position for one frame.
          if (!shouldEnable) {
            controlsRef.current.enableDamping = false;
            controlsRef.current.update();
            controlsRef.current.enableDamping = true;
            // Stop the damping animation loop — controls are now disabled
            clearTimeout(dampingTimeout.current);
            needsUpdate.current = false;
          }
        }
      }
    );
    return unsub;
  }, []);

  // Keep rendering while OrbitControls damping is active. In demand mode,
  // we must call controls.update() every frame for damping to work.
  // Track when the user is actively interacting plus a wind-down period
  // for damping to settle after they release.
  useEffect(() => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const onStart = () => {
      needsUpdate.current = true;
      clearTimeout(dampingTimeout.current);
    };
    const onEnd = () => {
      // Keep updating after release for damping to settle (duration from settings)
      const durationMs = useSettingsStore.getState().dampingDuration * 1000;
      dampingTimeout.current = window.setTimeout(() => {
        needsUpdate.current = false;
      }, durationMs);
    };
    ctrl.addEventListener('start', onStart);
    ctrl.addEventListener('end', onEnd);
    return () => {
      ctrl.removeEventListener('start', onStart);
      ctrl.removeEventListener('end', onEnd);
      clearTimeout(dampingTimeout.current);
    };
  }, []);

  // When OrbitControls is disabled (interaction != idle), immediately stop
  // damping animation. This prevents "sticky" camera drift when a drag starts
  // right after a pan/orbit gesture — without this, the camera continues
  // to drift for the remaining damping duration even though controls are disabled.
  useEffect(() => {
    if (interaction !== 'idle') {
      needsUpdate.current = false;
      clearTimeout(dampingTimeout.current);
    }
  }, [interaction]);

  // Alt+left-drag pan: manual pan when Alt key is held during left-drag.
  // This provides an alternative to right-click pan, matching Blender's convention.
  const altPan = useRef<{ lastX: number; lastY: number; pointerId: number } | null>(null);
  const { camera, invalidate: invalidateFrame } = useThree();
  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0 && e.altKey && useEditorStore.getState().interaction === 'idle') {
        e.preventDefault();
        altPan.current = { lastX: e.clientX, lastY: e.clientY, pointerId: e.pointerId };
        canvas.setPointerCapture(e.pointerId);
        document.body.style.cursor = 'move';
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!altPan.current || !controlsRef.current) return;
      const dx = e.clientX - altPan.current.lastX;
      const dy = e.clientY - altPan.current.lastY;
      altPan.current = { lastX: e.clientX, lastY: e.clientY, pointerId: altPan.current.pointerId };

      // Pan camera+target in screen space, proportional to distance
      const dist = camera.position.distanceTo(controlsRef.current.target);
      const factor = dist * 0.002 * panSpeed;
      // Get camera's right and up vectors in world space (reuse module-scoped vectors)
      camera.matrixWorld.extractBasis(_right, _up, _fwd);
      // Compute pan offset without mutating basis vectors
      _panOffset.copy(_right).multiplyScalar(-dx * factor);
      _panOffset.addScaledVector(_up, dy * factor);
      camera.position.add(_panOffset);
      controlsRef.current.target.add(_panOffset);
      controlsRef.current.update();
      invalidateFrame();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (altPan.current && e.button === 0) {
        altPan.current = null;
        document.body.style.cursor = 'auto';
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (altPan.current) {
        altPan.current = null;
        document.body.style.cursor = 'auto';
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }
    };
    // Reset alt-pan on window blur (tab switch during alt-drag)
    // Release pointer capture using the stored pointerId to prevent sticky pointer state
    const onBlur = () => {
      if (altPan.current) {
        try { canvas.releasePointerCapture(altPan.current.pointerId); } catch { /* noop */ }
        altPan.current = null;
        document.body.style.cursor = 'auto';
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', onBlur);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', onBlur);
    };
  }, [camera, invalidateFrame, panSpeed]);

  useFrame(({ invalidate }) => {
    if (needsUpdate.current && controlsRef.current) {
      controlsRef.current.update();
      invalidate();
    }
  });

  return (
    <>
      <SceneInvalidator />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={0.3} />
      {/* enabled and target are managed imperatively via Zustand subscription
           (bypasses React render cycle race). Do NOT set enabled or target as props —
           enabled would fight the imperative sync, and target={[0,0,0]} would create
           a new array reference every render, resetting the orbit pivot after every
           interaction state change and causing camera/culling glitches. */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={cameraDamping}
        enablePan
        enableZoom={false}
        enableRotate
        mouseButtons={{
          LEFT: undefined as unknown as THREE.MOUSE,
          MIDDLE: THREE.MOUSE.ROTATE,
          RIGHT: THREE.MOUSE.PAN,
        }}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={3}
        maxDistance={30}
        panSpeed={panSpeed}
        rotateSpeed={rotateSpeed}
      />
    </>
  );
}
