import { memo, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CubicBezierLine, Html } from '@react-three/drei';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getPortWorldPos } from '../../utils/portPositions';
import { PORT_TYPE_COLORS } from '../../types';
import type { PortType } from '../../types';

// Theme-aware fallback colors for pending connection wire
const WIRE_COLOR_DARK = '#ffffff';
const WIRE_COLOR_LIGHT = '#2a2a3e';

const XZ_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// Module-scoped reusable objects to avoid per-frame allocation
const _mouse = new THREE.Vector2();
const _target = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();

// Shared geometry for snap glow ring at endpoint
const SNAP_RING_GEO = new THREE.TorusGeometry(0.12, 0.02, 8, 24);

// Module-scoped styles for HTML indicators (avoid per-render allocations)
const PLUS_HINT_OUTER: React.CSSProperties = {
  pointerEvents: 'none',
  userSelect: 'none',
  transform: 'translate(14px, -14px)',
};
const MISMATCH_OUTER: React.CSSProperties = {
  pointerEvents: 'none',
  userSelect: 'none',
  transform: 'translate(14px, -14px)',
};

export const PendingPipe = memo(function PendingPipe() {
  const pending = useEditorStore(s => s.pendingConnection);
  const sourcePos = useEditorStore(s => pending ? s.nodes[pending.sourceNodeId]?.position : null);
  const sourceOutputCount = useEditorStore(s => pending ? (s.nodes[pending.sourceNodeId]?.outputs.length ?? 0) : 0);
  const sourceNodeWidth = useEditorStore(s => pending ? s.nodes[pending.sourceNodeId]?.width : undefined);
  const sourceNodeHeight = useEditorStore(s => pending ? s.nodes[pending.sourceNodeId]?.height : undefined);
  const nearestSnapPort = useEditorStore(s => s.nearestSnapPort);
  const snapNodePos = useEditorStore(s => s.nearestSnapPort ? s.nodes[s.nearestSnapPort.nodeId]?.position : null);
  const snapInputCount = useEditorStore(s => s.nearestSnapPort ? (s.nodes[s.nearestSnapPort.nodeId]?.inputs.length ?? 0) : 0);
  const snapNodeWidth = useEditorStore(s => s.nearestSnapPort ? s.nodes[s.nearestSnapPort.nodeId]?.width : undefined);
  const snapNodeHeight = useEditorStore(s => s.nearestSnapPort ? s.nodes[s.nearestSnapPort.nodeId]?.height : undefined);
  const hoveredMismatchPort = useEditorStore(s => s.hoveredMismatchPort);
  const mismatchNodePos = useEditorStore(s => s.hoveredMismatchPort ? s.nodes[s.hoveredMismatchPort.nodeId]?.position : null);
  const mismatchInputCount = useEditorStore(s => s.hoveredMismatchPort ? (s.nodes[s.hoveredMismatchPort.nodeId]?.inputs.length ?? 0) : 0);
  const mismatchNodeWidth = useEditorStore(s => s.hoveredMismatchPort ? s.nodes[s.hoveredMismatchPort.nodeId]?.width : undefined);
  const mismatchNodeHeight = useEditorStore(s => s.hoveredMismatchPort ? s.nodes[s.hoveredMismatchPort.nodeId]?.height : undefined);
  const cancelConnection = useEditorStore(s => s.cancelConnection);
  const interaction = useEditorStore(s => s.interaction);
  const connectionStyle = useSettingsStore(s => s.connectionStyle);
  const theme = useSettingsStore(s => s.theme);
  // Get source port type for wire color
  const sourcePortType = useEditorStore(s => {
    if (!s.pendingConnection) return null;
    const srcNode = s.nodes[s.pendingConnection.sourceNodeId];
    if (!srcNode) return null;
    const srcPort = srcNode.outputs[s.pendingConnection.sourcePortIndex];
    return (srcPort?.portType ?? 'any') as PortType;
  });
  const { camera, gl } = useThree();

  // Local cursor position — avoids writing to Zustand every frame
  const [cursorPos, setCursorPos] = useState<[number, number, number]>([0, 0, 0]);

  // Refs for animated snap ring
  const snapRingRef = useRef<THREE.Mesh>(null);

  // Track pointer position via useEffect with proper cleanup
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = gl.domElement;
    const handler = (e: PointerEvent) => {
      pointerRef.current.x = e.clientX;
      pointerRef.current.y = e.clientY;
    };
    // Right-click cancels connection drawing (standard UX pattern)
    const downHandler = (e: PointerEvent) => {
      if (e.button === 2) {
        cancelConnection();
      }
    };
    const ctxHandler = (e: Event) => e.preventDefault();

    // Window blur cancels connection drawing (alt-tab, focus loss)
    const blurHandler = () => cancelConnection();

    canvas.addEventListener('pointermove', handler);
    canvas.addEventListener('pointerdown', downHandler);
    canvas.addEventListener('contextmenu', ctxHandler);
    window.addEventListener('blur', blurHandler);
    return () => {
      canvas.removeEventListener('pointermove', handler);
      canvas.removeEventListener('pointerdown', downHandler);
      canvas.removeEventListener('contextmenu', ctxHandler);
      window.removeEventListener('blur', blurHandler);
    };
  }, [gl, cancelConnection]);

  // ESC to cancel — stopPropagation prevents global handlers from firing side effects
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.stopImmediatePropagation();
        cancelConnection();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [cancelConnection]);

  // Track mouse position on XZ plane each frame + animate snap ring
  useFrame(({ clock, invalidate }) => {
    if (interaction !== 'drawing-connection' || !pending) return;

    const rect = gl.domElement.getBoundingClientRect();
    const pointer = pointerRef.current;

    _mouse.set(
      ((pointer.x - rect.left) / rect.width) * 2 - 1,
      -((pointer.y - rect.top) / rect.height) * 2 + 1
    );
    _raycaster.setFromCamera(_mouse, camera);
    const hit = _raycaster.ray.intersectPlane(XZ_PLANE, _target);
    if (hit) {
      setCursorPos([_target.x, 0, _target.z]);
    }

    // Animate snap ring pulse
    if (snapRingRef.current) {
      const t = clock.getElapsedTime();
      const pulse = 0.6 + Math.sin(t * 6) * 0.3;
      (snapRingRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
      snapRingRef.current.scale.setScalar(1 + Math.sin(t * 4) * 0.15);
    }

    invalidate(); // Request next frame for continuous cursor tracking
  });

  if (interaction !== 'drawing-connection' || !pending || !sourcePos) return null;

  // Compute source port position (with per-node dimensions for resized nodes)
  const start = getPortWorldPos(sourcePos, 'output', pending.sourcePortIndex, sourceOutputCount, sourceNodeWidth, sourceNodeHeight);

  // Snap to port if hovering one, otherwise follow cursor
  let end: [number, number, number];
  if (nearestSnapPort && snapNodePos) {
    end = getPortWorldPos(snapNodePos, 'input', nearestSnapPort.portIndex, snapInputCount, snapNodeWidth, snapNodeHeight);
  } else {
    end = cursorPos;
  }

  // Compute mismatch port world position for X indicator
  let mismatchPos: [number, number, number] | null = null;
  if (hoveredMismatchPort && mismatchNodePos) {
    mismatchPos = getPortWorldPos(mismatchNodePos, 'input', hoveredMismatchPort.portIndex, mismatchInputCount, mismatchNodeWidth, mismatchNodeHeight);
  }

  // Color wire by source port type for visual feedback; fall back to theme color for 'any'
  const themeWireColor = theme === 'light' ? WIRE_COLOR_LIGHT : WIRE_COLOR_DARK;
  const wireColor = sourcePortType && sourcePortType !== 'any'
    ? PORT_TYPE_COLORS[sourcePortType] ?? themeWireColor
    : themeWireColor;

  // Wire turns red when hovering a mismatched port
  const effectiveWireColor = hoveredMismatchPort ? '#E8453C' : wireColor;
  const effectiveOpacity = hoveredMismatchPort ? 0.5 : 0.7;

  let midA: [number, number, number];
  let midB: [number, number, number];
  if (connectionStyle === 'straight') {
    midA = [...start] as [number, number, number];
    midB = [...end] as [number, number, number];
  } else if (connectionStyle === 'right-angle') {
    const midX = (start[0] + end[0]) / 2;
    midA = [midX, start[1] + 0.05, start[2]];
    midB = [midX, end[1] + 0.05, end[2]];
  } else {
    const dx = Math.abs(end[0] - start[0]) * 0.4;
    midA = [start[0] + dx, start[1] + 0.15, start[2]];
    midB = [end[0] - dx, end[1] + 0.15, end[2]];
  }

  const showPlusHint = !nearestSnapPort && !hoveredMismatchPort;
  const showSnapIndicator = !!nearestSnapPort;
  const showMismatchIndicator = !!hoveredMismatchPort && !!mismatchPos;

  return (
    <group>
      <CubicBezierLine
        start={start}
        end={end}
        midA={midA}
        midB={midB}
        color={effectiveWireColor}
        lineWidth={3}
        segments={32 as any}
        transparent
        opacity={effectiveOpacity}
      />

      {/* Plus hint when not snapping to any port */}
      {showPlusHint && (
        <group position={end}>
          <Html
            center
            zIndexRange={[50, 0]}
            style={PLUS_HINT_OUTER}
          >
            <div style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'var(--bg-subtle)',
              border: `1.5px solid ${wireColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 700,
              color: wireColor,
              lineHeight: 1,
              fontFamily: 'monospace',
              boxShadow: `0 0 6px ${wireColor}40`,
            }}>+</div>
          </Html>
        </group>
      )}

      {/* Snap indicator: green glow ring at compatible port endpoint */}
      {showSnapIndicator && (
        <group position={end}>
          <mesh
            ref={snapRingRef}
            geometry={SNAP_RING_GEO}
            rotation={[0, 0, Math.PI / 2]}
          >
            <meshBasicMaterial color="#44DD88" transparent opacity={0.6} />
          </mesh>
        </group>
      )}

      {/* Type mismatch X indicator at incompatible port */}
      {showMismatchIndicator && mismatchPos && (
        <group position={mismatchPos}>
          <Html
            center
            zIndexRange={[50, 0]}
            style={MISMATCH_OUTER}
          >
            <div style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'rgba(232, 69, 60, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1,
              fontFamily: 'monospace',
              boxShadow: '0 0 8px rgba(232, 69, 60, 0.5)',
            }}>✕</div>
          </Html>
        </group>
      )}
    </group>
  );
});
