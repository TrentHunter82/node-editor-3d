/**
 * ResizeHandles — corner drag handles for resizing nodes.
 *
 * Renders 4 corner handles on selected, non-collapsed, non-locked nodes.
 * Dragging a handle resizes the node symmetrically around its center.
 * Shift+drag constrains to proportional resize.
 * Grid snap is supported when enabled in settings.
 */
import { memo, useRef, useState, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT, MIN_NODE_WIDTH, MAX_NODE_WIDTH, MIN_NODE_HEIGHT, MAX_NODE_HEIGHT } from '../../store/slices/nodeSlice';
import { getMinNodeDepth } from '../../utils/nodeDepth';

// Shared geometry for all resize handle cubes (0.12 for better clickability)
const HANDLE_GEO = new THREE.BoxGeometry(0.12, 0.12, 0.12);

// Module-scoped reusables for hot path
const _mouse = new THREE.Vector2();
const _target = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const XZ_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const DRAG_THRESHOLD_PX = 4;

// Module-scoped clamp helper (pure function, no closure needed)
const clampW = (w: number) => Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, w));

interface ResizeState {
  nodeId: string;
  /** Corner sign: +1 or -1 for each axis */
  signX: number;
  signZ: number;
  /** Initial world position of the handle */
  startWorldX: number;
  startWorldZ: number;
  /** Initial node dimensions */
  startW: number;
  startD: number;
  /** Initial pointer pixel position for threshold check */
  startClientX: number;
  startClientY: number;
  committed: boolean;
  pointerId: number;
  /** Shift key state for proportional resize */
  shiftHeld: boolean;
  /** Initial aspect ratio for proportional mode */
  aspectRatio: number;
  /** Original sizes of all affected nodes (for Escape cancel) */
  originalSizes: Record<string, { width: number; height: number }>;
  /** Per-node minimum depth based on content */
  minDepths: Record<string, number>;
}

interface Props {
  nodeId: string;
  nodeW: number;
  nodeD: number;
  currentH: number;
}

export const ResizeHandles = memo(function ResizeHandles({ nodeId, nodeW, nodeD, currentH }: Props) {
  const { camera, gl } = useThree();
  const resizeRef = useRef<ResizeState | null>(null);
  const shiftRef = useRef(false);
  const [hoveredCorner, setHoveredCorner] = useState(-1);
  const [dragDims, setDragDims] = useState<{ w: number; d: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const setInteraction = useEditorStore(s => s.setInteraction);
  const setNodeSizes = useEditorStore(s => s.setNodeSizes);

  // Grid snap settings — snapEnabled is on editor store, gridSnapSize on settings store
  const snapEnabled = useEditorStore(s => s.snapEnabled);
  const gridSnapSize = useSettingsStore(s => s.gridSnapSize);

  const snapValue = useCallback((v: number) => {
    if (!snapEnabled || gridSnapSize <= 0) return v;
    return Math.round(v / gridSnapSize) * gridSnapSize;
  }, [snapEnabled, gridSnapSize]);

  // Clamp helpers — use module-scoped functions below

  const startResize = useCallback((
    e: import('@react-three/fiber').ThreeEvent<PointerEvent>,
    signX: number,
    signZ: number,
  ) => {
    e.stopPropagation();
    const ne = e.nativeEvent;

    // Get node world position for raycasting
    const state = useEditorStore.getState();
    const node = state.nodes[nodeId];
    if (!node || node.locked) return;

    const w = node.width ?? DEFAULT_NODE_WIDTH;
    const d = node.height ?? DEFAULT_NODE_HEIGHT;

    // Raycast to get initial world position of the pointer on XZ plane
    const rect = gl.domElement.getBoundingClientRect();
    _mouse.set(
      ((ne.clientX - rect.left) / rect.width) * 2 - 1,
      -((ne.clientY - rect.top) / rect.height) * 2 + 1
    );
    _raycaster.setFromCamera(_mouse, camera);
    const hit = _raycaster.ray.intersectPlane(XZ_PLANE, _target);
    if (!hit) return;

    // Capture original sizes and per-type minimum depths for all affected nodes
    const originalSizes: Record<string, { width: number; height: number }> = {};
    const minDepths: Record<string, number> = {};
    if (state.selectedIds.size > 1 && state.selectedIds.has(nodeId)) {
      for (const id of state.selectedIds) {
        const n = state.nodes[id];
        if (n && !n.locked) {
          originalSizes[id] = { width: n.width ?? DEFAULT_NODE_WIDTH, height: n.height ?? DEFAULT_NODE_HEIGHT };
          minDepths[id] = getMinNodeDepth(n.type, n.inputs.length, n.outputs.length);
        }
      }
    } else {
      originalSizes[nodeId] = { width: w, height: d };
      minDepths[nodeId] = getMinNodeDepth(node.type, node.inputs.length, node.outputs.length);
    }

    resizeRef.current = {
      nodeId,
      signX,
      signZ,
      startWorldX: _target.x,
      startWorldZ: _target.z,
      startW: w,
      startD: d,
      startClientX: ne.clientX,
      startClientY: ne.clientY,
      committed: false,
      pointerId: ne.pointerId,
      shiftHeld: ne.shiftKey,
      aspectRatio: w / d,
      originalSizes,
      minDepths,
    };

    try {
      gl.domElement.setPointerCapture(ne.pointerId);
    } catch { /* noop */ }
  }, [nodeId, camera, gl]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerMove = (e: PointerEvent) => {
      const rs = resizeRef.current;
      if (!rs) return;

      // Update shift state
      shiftRef.current = e.shiftKey;

      // Threshold check
      if (!rs.committed) {
        const dx = e.clientX - rs.startClientX;
        const dy = e.clientY - rs.startClientY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        rs.committed = true;
        // Push undo snapshot BEFORE first setNodeSizes mutation
        useEditorStore.getState().pushUndoSnapshot('Resize node');
        setInteraction('resizing-node');
        document.body.style.cursor = (rs.signX === rs.signZ) ? 'nwse-resize' : 'nesw-resize';
        setDragDims({ w: rs.startW, d: rs.startD });
      }

      // Raycast to XZ plane
      const rect = canvas.getBoundingClientRect();
      _mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      _raycaster.setFromCamera(_mouse, camera);
      const hit = _raycaster.ray.intersectPlane(XZ_PLANE, _target);
      if (!hit) return;

      // Delta from initial position
      const deltaX = (_target.x - rs.startWorldX) * rs.signX;
      const deltaZ = (_target.z - rs.startWorldZ) * rs.signZ;

      // New dimensions (symmetric resize: delta applied to both sides)
      let newW = rs.startW + deltaX * 2;
      let newD = rs.startD + deltaZ * 2;

      // Proportional resize with Shift
      if (e.shiftKey) {
        // Use the larger delta to drive both dimensions
        const deltaAbsX = Math.abs(deltaX);
        const deltaAbsZ = Math.abs(deltaZ);
        if (deltaAbsX > deltaAbsZ) {
          newW = rs.startW + deltaX * 2;
          newD = newW / rs.aspectRatio;
        } else {
          newD = rs.startD + deltaZ * 2;
          newW = newD * rs.aspectRatio;
        }
      }

      // Snap then clamp — clamp AFTER snap to ensure values stay within valid range
      // Use per-node minimum depth based on screen content
      const primaryMinD = rs.minDepths[rs.nodeId] ?? MIN_NODE_HEIGHT;
      newW = clampW(snapValue(newW));
      newD = Math.max(primaryMinD, Math.min(MAX_NODE_HEIGHT, snapValue(newD)));

      // Apply to all selected nodes
      const state = useEditorStore.getState();
      const selectedIds = state.selectedIds;
      const sizes: Record<string, { width: number; height: number }> = {};

      if (selectedIds.size > 1 && selectedIds.has(rs.nodeId)) {
        // Multi-select: scale all selected nodes by the same factor
        // Use originalSizes (captured at drag start) to avoid compounding scale
        const scaleX = newW / rs.startW;
        const scaleZ = newD / rs.startD;
        for (const id of selectedIds) {
          const n = state.nodes[id];
          if (!n || n.locked) continue;
          const orig = rs.originalSizes[id];
          if (!orig) continue;
          const nodeMinD = rs.minDepths[id] ?? MIN_NODE_HEIGHT;
          sizes[id] = {
            width: clampW(orig.width * scaleX),
            height: Math.max(nodeMinD, Math.min(MAX_NODE_HEIGHT, orig.height * scaleZ)),
          };
        }
      } else {
        sizes[rs.nodeId] = { width: newW, height: newD };
      }

      setNodeSizes(sizes);

      // Update tooltip imperatively for performance
      const primarySize = sizes[rs.nodeId];
      if (primarySize && tooltipRef.current) {
        tooltipRef.current.textContent = `${primarySize.width.toFixed(1)} × ${primarySize.height.toFixed(1)}`;
      }
    };

    const endResize = () => {
      const rs = resizeRef.current;
      if (!rs) return;

      try {
        gl.domElement.releasePointerCapture(rs.pointerId);
      } catch { /* noop */ }

      setDragDims(null);

      if (rs.committed) {
        // Undo was already pushed at drag commit (before first setNodeSizes).
        // setNodeSizes mutations during drag are the final state — no further action needed.
        setInteraction('idle');
      }
      // Always reset cursor — committed drag sets resize cursor, uncommitted may be in hover state
      document.body.style.cursor = 'auto';

      resizeRef.current = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && resizeRef.current) {
        const rs = resizeRef.current;
        // Release pointer capture
        try {
          gl.domElement.releasePointerCapture(rs.pointerId);
        } catch { /* noop */ }
        // Restore original dimensions
        if (rs.committed) {
          setNodeSizes(rs.originalSizes);
          setInteraction('idle');
          document.body.style.cursor = 'auto';
        }
        resizeRef.current = null;
        setDragDims(null);
        return;
      }
      shiftRef.current = e.shiftKey;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      shiftRef.current = e.shiftKey;
    };

    const onBlur = () => {
      if (resizeRef.current) {
        const rs = resizeRef.current;
        try {
          gl.domElement.releasePointerCapture(rs.pointerId);
        } catch { /* noop */ }
        if (rs.committed) {
          setInteraction('idle');
        }
        resizeRef.current = null;
      }
      document.body.style.cursor = 'auto';
      shiftRef.current = false;
      setDragDims(null);
      setHoveredCorner(-1);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endResize);
    window.addEventListener('pointercancel', endResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endResize);
      window.removeEventListener('pointercancel', endResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [camera, gl, setInteraction, setNodeSizes, snapValue]);

  const halfW = nodeW / 2;
  const halfD = nodeD / 2;
  // Place handles 0.04 units above node top face, well above the NodeScreen
  // overlay (at currentH/2 + 0.005), so they remain clickable
  const handleY = currentH / 2 + 0.04;

  // Corner handle positions: slightly outside node edges for easy access
  // even when NodeScreen HTML overlay is visible
  const outset = 0.06;
  const corners = [
    { pos: [halfW + outset, handleY, halfD + outset] as [number, number, number], sx: 1, sz: 1 },
    { pos: [halfW + outset, handleY, -halfD - outset] as [number, number, number], sx: 1, sz: -1 },
    { pos: [-halfW - outset, handleY, halfD + outset] as [number, number, number], sx: -1, sz: 1 },
    { pos: [-halfW - outset, handleY, -halfD - outset] as [number, number, number], sx: -1, sz: -1 },
  ];

  // Resize cursor per corner
  const cursorForCorner = (sx: number, sz: number): string => {
    if (sx === sz) return 'nwse-resize';
    return 'nesw-resize';
  };

  return (
    <group>
      {corners.map((c, i) => (
        <mesh
          key={i}
          geometry={HANDLE_GEO}
          position={c.pos}
          scale={hoveredCorner === i ? 1.4 : 1}
          onPointerDown={(e) => startResize(e, c.sx, c.sz)}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHoveredCorner(i);
            if (useEditorStore.getState().interaction === 'idle') {
              document.body.style.cursor = cursorForCorner(c.sx, c.sz);
            }
          }}
          onPointerOut={(e) => {
            e.stopPropagation();
            setHoveredCorner(-1);
            if (useEditorStore.getState().interaction === 'idle') {
              document.body.style.cursor = 'auto';
            }
          }}
        >
          <meshBasicMaterial
            color={hoveredCorner === i ? '#5DF5E7' : '#2EC4B6'}
            transparent
            opacity={hoveredCorner === i ? 0.9 : 0.6}
          />
        </mesh>
      ))}
      {dragDims && (
        <Html center position={[0, currentH + 0.15, 0]} zIndexRange={[50, 0]} wrapperClass="html-no-events" style={{ pointerEvents: 'none' }}>
          <div
            ref={tooltipRef}
            style={{
              background: 'rgba(0,0,0,0.8)',
              color: '#5DF5E7',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {dragDims.w.toFixed(1)} × {dragDims.d.toFixed(1)}
          </div>
        </Html>
      )}
    </group>
  );
});
