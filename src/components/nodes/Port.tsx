import React, { useRef, useState, useCallback, useMemo, useEffect, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Mesh } from 'three';
import { useEditorStore } from '../../store/editorStore';
import { PORT_TYPE_COLORS, isPortTypeCompatible } from '../../types';
import type { PortDef, PortType } from '../../types';
import type { ThreeEvent } from '@react-three/fiber';
import { TOOLTIP_STYLE } from '../ui/Tooltip';
import { hasCoercion } from '../../utils/typeCoercions';

// Shared geometries - reused across all Port instances to reduce GPU memory
// NOTE: Visual port sphere and type ring are now rendered via InstancedPorts.tsx.
// Only hit target and conditional snap/pulse rings remain here.
const HIT_SPHERE_GEO = new THREE.SphereGeometry(0.15, 8, 8);
const SNAP_TORUS_GEO = new THREE.TorusGeometry(0.13, 0.02, 8, 24);
// Larger pulsing ring for snap target
const PULSE_TORUS_GEO = new THREE.TorusGeometry(0.16, 0.015, 8, 24);

interface PortProps {
  nodeId: string;
  portIndex: number;
  type: 'input' | 'output';
  position: [number, number, number];
}

export const Port = memo(function Port({ nodeId, portIndex, type, position }: PortProps) {
  const pulseRef = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const interaction = useEditorStore(s => s.interaction);
  const pendingConnection = useEditorStore(s => s.pendingConnection);
  const connections = useEditorStore(s => s.connections);
  const startConnection = useEditorStore(s => s.startConnection);
  const completeConnection = useEditorStore(s => s.completeConnection);
  const disconnectAndReroute = useEditorStore(s => s.disconnectAndReroute);
  const setNearestSnapPort = useEditorStore(s => s.setNearestSnapPort);
  const setHoveredMismatchPort = useEditorStore(s => s.setHoveredMismatchPort);

  // Keyboard port focus (Tab cycling)
  const isFocused = useEditorStore(s =>
    s.focusedPort !== null &&
    s.focusedPort.nodeId === nodeId &&
    s.focusedPort.portIndex === portIndex &&
    s.focusedPort.side === type
  );

  // Look up the port definition for color coding, tooltip info, and type checking
  const portDef = useEditorStore(s => {
    const node = s.nodes[nodeId];
    if (!node) return undefined;
    return type === 'input' ? node.inputs[portIndex] : node.outputs[portIndex];
  }) as PortDef | undefined;

  const portType = portDef?.portType ?? 'any' as const;

  // Look up source port type for type-aware compatibility during drawing
  const sourcePortType = useEditorStore(s => {
    if (!s.pendingConnection) return null;
    const srcNode = s.nodes[s.pendingConnection.sourceNodeId];
    if (!srcNode) return null;
    const srcPort = srcNode.outputs[s.pendingConnection.sourcePortIndex];
    return (srcPort?.portType ?? 'any') as PortType;
  });

  const isDrawing = interaction === 'drawing-connection';

  // During drawing: determine if this port is a valid, type-compatible connection target
  const sourceNodeId = pendingConnection?.sourceNodeId;
  const isSelfPort = isDrawing && sourceNodeId === nodeId;
  const isTypeCompatible = sourcePortType !== null
    ? isPortTypeCompatible(sourcePortType, portType) || hasCoercion(sourcePortType, portType)
    : false;
  // Mismatch target: incompatible input port on a different node during drawing
  const isMismatchTarget = isDrawing && type === 'input' && !isSelfPort && !isTypeCompatible;
  // Snap target: only compatible input ports get snap ring and pulse animation
  const isSnapTarget = isDrawing && type === 'input' && !isSelfPort && isTypeCompatible;

  // Animate the pulse ring on snap target
  useFrame(({ clock, invalidate }) => {
    if (pulseRef.current && hovered && isSnapTarget) {
      const t = clock.getElapsedTime();
      const pulse = 0.5 + Math.sin(t * 6) * 0.3;
      (pulseRef.current.material as THREE.MeshBasicMaterial).opacity = pulse;
      pulseRef.current.scale.setScalar(1 + Math.sin(t * 4) * 0.15);
      invalidate(); // Request next frame for continuous animation
    }
  });

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (type === 'output' && interaction === 'idle') {
      startConnection(nodeId, portIndex);
    } else if (type === 'input' && isDrawing) {
      completeConnection(nodeId, portIndex);
    } else if (type === 'input' && interaction === 'idle') {
      // ComfyUI-style: click occupied input to detach and reroute
      const existing = Object.values(connections).find(
        c => c.targetNodeId === nodeId && c.targetPortIndex === portIndex
      );
      if (existing) {
        disconnectAndReroute(existing.id);
      }
    }
  }, [type, interaction, isDrawing, nodeId, portIndex, connections,
      startConnection, completeConnection, disconnectAndReroute]);

  const openContextMenu = useEditorStore(s => s.openContextMenu);

  const handleContextMenu = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    openContextMenu({
      x: e.nativeEvent.clientX,
      y: e.nativeEvent.clientY,
      target: { kind: 'port', nodeId, portIndex, portType: type },
    });
  }, [nodeId, portIndex, type, openContextMenu]);

  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    // Only set cursor when not in a drag interaction
    const currentInteraction = useEditorStore.getState().interaction;
    if (currentInteraction === 'idle' || currentInteraction === 'drawing-connection') {
      document.body.style.cursor = isDrawing && isMismatchTarget ? 'not-allowed' : 'pointer';
    }
    if (isSnapTarget) {
      setNearestSnapPort({ nodeId, portIndex });
    }
    if (isMismatchTarget) {
      setHoveredMismatchPort({ nodeId, portIndex });
    }
  }, [isSnapTarget, isMismatchTarget, isDrawing, nodeId, portIndex, setNearestSnapPort, setHoveredMismatchPort]);

  const handlePointerOut = useCallback(() => {
    setHovered(false);
    // Only reset cursor if we're not in a drag
    const currentInteraction = useEditorStore.getState().interaction;
    if (currentInteraction === 'idle' || currentInteraction === 'drawing-connection') {
      document.body.style.cursor = 'auto';
    }
    if (isSnapTarget) {
      setNearestSnapPort(null);
    }
    if (isMismatchTarget) {
      setHoveredMismatchPort(null);
    }
  }, [isSnapTarget, isMismatchTarget, setNearestSnapPort, setHoveredMismatchPort]);

  // Current port value: output ports read from nodeOutputs, input ports trace through connections
  const portValue = useEditorStore(s => {
    if (type === 'output') {
      return s.nodeOutputs[nodeId]?.[portIndex];
    }
    // Input port: find connection feeding into this port
    const conn = Object.values(s.connections).find(
      c => c.targetNodeId === nodeId && c.targetPortIndex === portIndex
    );
    if (conn) {
      return s.nodeOutputs[conn.sourceNodeId]?.[conn.sourcePortIndex];
    }
    return undefined;
  });

  // 300ms delay before showing tooltip. Only hovered=true arms the timer;
  // the cleanup (run on unhover or unmount) clears the timer and hides the
  // tooltip — keeping setState out of the synchronous effect body.
  useEffect(() => {
    if (!hovered) return;
    hoverTimerRef.current = setTimeout(() => setShowTooltip(true), 300);
    return () => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setShowTooltip(false);
    };
  }, [hovered]);

  // Base color for tooltip display
  const baseColor = PORT_TYPE_COLORS[portType] ?? PORT_TYPE_COLORS.any;

  return (
    <group position={position}>
      {/* Invisible larger hit target for interaction
           (visual port sphere + type ring are now batched in InstancedPorts) */}
      <mesh
        geometry={HIT_SPHERE_GEO}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onPointerCancel={handlePointerOut}
        visible={false}
      >
        <meshBasicMaterial />
      </mesh>

      {/* Keyboard focus ring */}
      {isFocused && (
        <mesh geometry={SNAP_TORUS_GEO} rotation={[0, 0, Math.PI / 2]}>
          <meshBasicMaterial color="#00BFFF" transparent opacity={0.9} />
        </mesh>
      )}

      {/* Snap glow ring when hovering compatible input during connection drawing */}
      {hovered && isSnapTarget && (
        <mesh geometry={SNAP_TORUS_GEO} rotation={[0, 0, Math.PI / 2]}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
        </mesh>
      )}

      {/* Pulsing ring on compatible snap target */}
      {hovered && isSnapTarget && (
        <mesh ref={pulseRef} geometry={PULSE_TORUS_GEO} rotation={[0, 0, Math.PI / 2]}>
          <meshBasicMaterial color="#44DD88" transparent opacity={0.5} />
        </mesh>
      )}

      {/* Port tooltip on hover with 300ms delay (only when not drawing a connection) */}
      {showTooltip && !isDrawing && portDef && (
        <Html
          position={[type === 'input' ? -0.2 : 0.2, 0.15, 0]}
          center
          distanceFactor={6}
          zIndexRange={[50, 0]}
          wrapperClass="html-no-events"
          style={{ pointerEvents: 'none' }}
        >
          <PortTooltip portDef={portDef} portType={portType} baseColor={baseColor} value={portValue} />
        </Html>
      )}
    </group>
  );
}, (prev, next) =>
  prev.nodeId === next.nodeId &&
  prev.portIndex === next.portIndex &&
  prev.type === next.type &&
  prev.position[0] === next.position[0] &&
  prev.position[1] === next.position[1] &&
  prev.position[2] === next.position[2]
);

// Module-scoped PortTooltip styles to avoid per-render object creation
const PORT_TOOLTIP_CONTAINER: React.CSSProperties = {
  ...TOOLTIP_STYLE,
  fontSize: 9,
  padding: '3px 7px',
  whiteSpace: 'nowrap',
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
};
const PORT_TOOLTIP_DOT_BASE: React.CSSProperties = {
  display: 'inline-block',
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  flexShrink: 0,
};
const PORT_TOOLTIP_LABEL: React.CSSProperties = { fontWeight: 600 };
const PORT_TOOLTIP_TYPE: React.CSSProperties = { opacity: 0.4, fontSize: '8px' };
const PORT_TOOLTIP_DESC: React.CSSProperties = { opacity: 0.5, fontSize: '8px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' };
const PORT_TOOLTIP_VALUE: React.CSSProperties = { opacity: 0.7, fontSize: '8px', fontFamily: 'monospace', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/** Format a port value for compact display */
function formatPortValue(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') return val.length > 20 ? `"${val.slice(0, 17)}..."` : `"${val}"`;
  if (typeof val === 'number') return Number.isInteger(val) ? String(val) : val.toFixed(3);
  if (typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return `[${val.length}]`;
  if (typeof val === 'object') return '{...}';
  return String(val);
}

/** Compact tooltip showing port label, type, current value, and optional metadata.
 * Uses shared TOOLTIP_STYLE from Tooltip.tsx for visual consistency,
 * with size overrides for compact 3D world display. */
const PortTooltip = memo(function PortTooltip({ portDef, portType, baseColor, value }: { portDef: PortDef; portType: string; baseColor: string; value?: unknown }) {
  const dotStyle = useMemo(() => ({ ...PORT_TOOLTIP_DOT_BASE, background: baseColor }), [baseColor]);
  const formattedValue = formatPortValue(value);

  return (
    <div style={PORT_TOOLTIP_CONTAINER}>
      <span style={dotStyle} />
      <span style={PORT_TOOLTIP_LABEL}>{portDef.label}</span>
      <span style={PORT_TOOLTIP_TYPE}>{portType}</span>
      {formattedValue !== null && (
        <span style={PORT_TOOLTIP_VALUE}>= {formattedValue}</span>
      )}
      {portDef.description && (
        <span style={PORT_TOOLTIP_DESC}>
          {portDef.description}
        </span>
      )}
    </div>
  );
});
