import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';

const XZ_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _mouse = new THREE.Vector2();
const _target = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const DRAG_THRESHOLD = 16; // px^2

// Shared camera reference set by CameraProvider inside the Canvas
export let sharedCamera: THREE.Camera | null = null;
export function setSharedCamera(cam: THREE.Camera) { sharedCamera = cam; }

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

/**
 * BoxSelection overlay: SVG rectangle during drag on empty canvas.
 * Activates only when left-dragging on empty space. If the interaction mode
 * changes to 'dragging-node' before we cross the threshold, we abort (the
 * user clicked a node and is dragging it instead).
 */
export function BoxSelection() {
  const interaction = useEditorStore(s => s.interaction);
  const setInteraction = useEditorStore(s => s.setInteraction);
  const boxSelect = useEditorStore(s => s.boxSelect);

  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{
    startClient: [number, number];
    startWorld: [number, number];
    committed: boolean;
  } | null>(null);

  useEffect(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const handleDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const state = useEditorStore.getState();
      if (state.interaction !== 'idle') return;

      const worldPos = getXZFromScreen(e.clientX, e.clientY, canvas);
      if (!worldPos) return;

      dragRef.current = {
        startClient: [e.clientX, e.clientY],
        startWorld: worldPos,
        committed: false,
      };
    };

    const handleMove = (e: PointerEvent) => {
      if (!dragRef.current) return;

      // If interaction changed before we committed (e.g. node drag started), abort.
      // Clear dragRef entirely so we don't leave stale state if pointerUp never fires.
      if (!dragRef.current.committed) {
        const state = useEditorStore.getState();
        if (state.interaction !== 'idle') {
          dragRef.current = null;
          return;
        }
      }

      if (!dragRef.current.committed) {
        const dx = e.clientX - dragRef.current.startClient[0];
        const dy = e.clientY - dragRef.current.startClient[1];
        if (dx * dx + dy * dy < DRAG_THRESHOLD) return;
        dragRef.current.committed = true;
        setInteraction('box-selecting');
        document.body.style.cursor = 'crosshair';
      }

      const sx = dragRef.current.startClient[0];
      const sy = dragRef.current.startClient[1];
      setRect({
        x: Math.min(sx, e.clientX),
        y: Math.min(sy, e.clientY),
        w: Math.abs(e.clientX - sx),
        h: Math.abs(e.clientY - sy),
      });
    };

    const handleUp = (e: PointerEvent) => {
      if (!dragRef.current) return;

      if (dragRef.current.committed) {
        const endWorld = getXZFromScreen(e.clientX, e.clientY, canvas);
        if (endWorld) {
          const [sx, sz] = dragRef.current.startWorld;
          const [ex, ez] = endWorld;
          boxSelect(
            Math.min(sx, ex), Math.min(sz, ez),
            Math.max(sx, ex), Math.max(sz, ez),
            e.shiftKey
          );
        }
        setInteraction('idle');
      }

      dragRef.current = null;
      setRect(null);
    };

    // pointercancel: browser interrupted the pointer (e.g. scroll, tab switch)
    const handleCancel = () => {
      if (!dragRef.current) return;
      if (dragRef.current.committed) {
        setInteraction('idle');
        // cursor reset handled by setInteraction('idle')
      }
      dragRef.current = null;
      setRect(null);
    };

    // Window blur: cancel active box selection if user alt-tabs mid-drag
    const handleBlur = () => handleCancel();

    canvas.addEventListener('pointerdown', handleDown);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('blur', handleBlur);
    return () => {
      canvas.removeEventListener('pointerdown', handleDown);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('blur', handleBlur);
    };
  }, [setInteraction, boxSelect]);

  if (!rect || interaction !== 'box-selecting') return null;

  return (
    <svg
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        fill="color-mix(in srgb, var(--teal) 8%, transparent)"
        stroke="color-mix(in srgb, var(--teal) 50%, transparent)"
        strokeWidth={1}
        strokeDasharray="4 2"
        rx={2}
      />
    </svg>
  );
}
