import { useMemo, useCallback, useEffect, useRef, useState, memo } from 'react';
import { CubicBezierLine, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Line2 } from 'three-stdlib';
import { useFrame } from '@react-three/fiber';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getPortWorldPos } from '../../utils/portPositions';
import { computeControlPoints } from '../../utils/connectionGeometry';
import { PORT_TYPE_COLORS } from '../../types';
import type { Connection } from '../../types';
import type { ThreeEvent } from '@react-three/fiber';
import type { ConnectionLOD } from './ConnectionGraph';
import { formatForTooltip } from '../../utils/valueFormat';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// Shared invisible material — single instance for all hit meshes
const HIT_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });
// Shared geometry for data flow pulse — per port type
const PULSE_SPHERE_GEO = new THREE.SphereGeometry(0.04, 8, 8);
const PULSE_BOX_GEO = new THREE.BoxGeometry(0.06, 0.06, 0.06);
const PULSE_OCTA_GEO = new THREE.OctahedronGeometry(0.04);
// Trail particle geometries (smaller)
const TRAIL_SPHERE_GEO = new THREE.SphereGeometry(0.025, 6, 6);
const TRAIL_BOX_GEO = new THREE.BoxGeometry(0.04, 0.04, 0.04);
const TRAIL_OCTA_GEO = new THREE.OctahedronGeometry(0.025);
// Port type → geometry mappings
const PULSE_GEOS: Record<string, THREE.BufferGeometry> = {
  number: PULSE_SPHERE_GEO,
  string: PULSE_BOX_GEO,
  vector3: PULSE_OCTA_GEO,
  color: PULSE_SPHERE_GEO,
  boolean: PULSE_SPHERE_GEO,
  array: PULSE_BOX_GEO,
  object: PULSE_OCTA_GEO,
  any: PULSE_SPHERE_GEO,
};
const TRAIL_GEOS: Record<string, THREE.BufferGeometry> = {
  number: TRAIL_SPHERE_GEO,
  string: TRAIL_BOX_GEO,
  vector3: TRAIL_OCTA_GEO,
  color: TRAIL_SPHERE_GEO,
  boolean: TRAIL_SPHERE_GEO,
  array: TRAIL_BOX_GEO,
  object: TRAIL_OCTA_GEO,
  any: TRAIL_SPHERE_GEO,
};
// Pulse materials per execution state — cached to avoid per-frame allocation
const PULSE_MATERIALS = {
  running: new THREE.MeshBasicMaterial({ color: '#44DD88', transparent: true, opacity: 0.9 }),
  complete: new THREE.MeshBasicMaterial({ color: '#44DD88', transparent: true, opacity: 0.6 }),
  error: new THREE.MeshBasicMaterial({ color: '#FF4444', transparent: true, opacity: 0.9 }),
};
// Trail particle material (more transparent)
const TRAIL_MATERIALS = {
  running: new THREE.MeshBasicMaterial({ color: '#44DD88', transparent: true, opacity: 0.5 }),
  complete: new THREE.MeshBasicMaterial({ color: '#44DD88', transparent: true, opacity: 0.3 }),
  error: new THREE.MeshBasicMaterial({ color: '#FF4444', transparent: true, opacity: 0.5 }),
};
// Flow dash colors per execution state
const FLOW_COLORS = {
  running: '#44DD88',
  complete: '#88DDAA',
  error: '#FF4444',
  cached: '#667788',
};
// Reusable vectors for pulse interpolation (useFrame only — safe from concurrent renders)
const _pulsePos = new THREE.Vector3();
const _trailPos1 = new THREE.Vector3();
const _trailPos2 = new THREE.Vector3();
// No-op raycast to prevent Line2 from intercepting pointer events
const NO_RAYCAST = () => {};
// NOTE: prefersReducedMotion is now provided by useReducedMotion() hook inside the component.

// Fallback position when nodes are not yet loaded
const ZERO_POS: [number, number, number] = [0, 0, 0];
/** Blend a hex color 60% toward white for a softer connection tint.
 * Uses a cache to avoid per-render allocation and prevent concurrent-mode
 * mutation of shared Color objects. */
const _blendCache = new Map<string, string>();
const _white = new THREE.Color('#ffffff');
function blendWithWhite(hex: string): string {
  const cached = _blendCache.get(hex);
  if (cached) return cached;
  const c = new THREE.Color(hex);
  c.lerp(_white, 0.4);
  const result = '#' + c.getHexString();
  _blendCache.set(hex, result);
  return result;
}

interface PipeProps {
  connection: Connection;
  isTraced?: boolean;
  getConnectionLOD?: (connId: string) => ConnectionLOD;
}

export const Pipe = memo(function Pipe({ connection, isTraced, getConnectionLOD }: PipeProps) {
  const sourcePos = useEditorStore(s => s.nodes[connection.sourceNodeId]?.position);
  const sourceOutputCount = useEditorStore(s => s.nodes[connection.sourceNodeId]?.outputs.length ?? 0);
  const sourceNodeWidth = useEditorStore(s => s.nodes[connection.sourceNodeId]?.width);
  const sourceNodeHeight = useEditorStore(s => s.nodes[connection.sourceNodeId]?.height);
  const targetPos = useEditorStore(s => s.nodes[connection.targetNodeId]?.position);
  const targetInputCount = useEditorStore(s => s.nodes[connection.targetNodeId]?.inputs.length ?? 0);
  const targetNodeWidth = useEditorStore(s => s.nodes[connection.targetNodeId]?.width);
  const targetNodeHeight = useEditorStore(s => s.nodes[connection.targetNodeId]?.height);
  const isSelected = useEditorStore(s => s.selectedIds.has(connection.id));
  const isHovered = useEditorStore(s => s.hoveredConnectionId === connection.id);
  // Data flow highlight: both endpoints are selected nodes (path glow via Shift+U/D/B)
  const isPathHighlighted = useEditorStore(s =>
    s.selectedIds.has(connection.sourceNodeId) && s.selectedIds.has(connection.targetNodeId)
  );
  const setSelection = useEditorStore(s => s.setSelection);
  const toggleSelection = useEditorStore(s => s.toggleSelection);
  const setHoveredConnection = useEditorStore(s => s.setHoveredConnection);
  const sourceNodeTitle = useEditorStore(s => s.nodes[connection.sourceNodeId]?.title);
  const targetNodeTitle = useEditorStore(s => s.nodes[connection.targetNodeId]?.title);
  const targetPortType = useEditorStore(s => s.nodes[connection.targetNodeId]?.inputs[connection.targetPortIndex]?.portType);
  const sourceExecState = useEditorStore(s => s.executionStates[connection.sourceNodeId]);
  const targetExecState = useEditorStore(s => s.executionStates[connection.targetNodeId]);
  const isExecuting = useEditorStore(s => s.isExecuting);
  const sourcePortType = useEditorStore(s => s.nodes[connection.sourceNodeId]?.outputs[connection.sourcePortIndex]?.portType);
  const globalConnectionStyle = useSettingsStore(s => s.connectionStyle);
  // Per-connection override takes precedence over global setting
  const connectionStyle = connection.styleOverride ?? globalConnectionStyle;
  const connectionFlowAnimation = useSettingsStore(s => s.connectionFlowAnimation);
  const prefersReducedMotion = useReducedMotion();

  // Data flow pulse: show when source node is running, complete, or error during execution
  const showPulse = isExecuting && (sourceExecState === 'running' || sourceExecState === 'complete' || sourceExecState === 'error');
  // Flow animation: animated dashes traveling along the connection
  const showFlow = connectionFlowAnimation && !prefersReducedMotion && showPulse;
  // Determine flow color based on execution state
  const flowColor = sourceExecState === 'error' ? FLOW_COLORS.error
    : sourceExecState === 'complete' ? FLOW_COLORS.complete
    : FLOW_COLORS.running;
  // Determine flow speed: fast while running, decelerating when complete
  const flowSpeed = sourceExecState === 'running' ? 0.25 : 0.08;
  const flowLineRef = useRef<Line2 | null>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  // Trail particles (follow behind main pulse)
  const trail1Ref = useRef<THREE.Mesh>(null);
  const trail2Ref = useRef<THREE.Mesh>(null);
  // Pulse at target: brief scale bump when data arrives at target node
  const targetPulseRef = useRef<THREE.Mesh>(null);
  const targetPulseStartRef = useRef(0);
  const groupRef = useRef<THREE.Group>(null);

  // Track pointer world position for cursor-following hover tooltip
  const hoverPosRef = useRef<[number, number, number] | null>(null);
  const [hoverPos, setHoverPos] = useState<[number, number, number] | null>(null);

  // Disable raycasting on the CubicBezierLine's Line2 object
  // so it doesn't intercept events meant for the hit mesh
  const lineRef = useRef<Line2 | null>(null);
  useEffect(() => {
    if (lineRef.current) {
      lineRef.current.raycast = NO_RAYCAST;
    }
  }, []);

  // Ref callback to disable raycasting on the flow animation overlay line immediately on mount
  const flowLineRefCallback = useCallback((obj: Line2 | null) => {
    flowLineRef.current = obj;
    if (obj) obj.raycast = NO_RAYCAST;
  }, []);

  // Cleanup hover state on unmount (pipe deleted while hovered)
  useEffect(() => {
    return () => {
      const store = useEditorStore.getState();
      if (store.hoveredConnectionId === connection.id) {
        store.setHoveredConnection(null);
      }
    };
  }, [connection.id]);

  // Compute endpoint positions (stable even when sourcePos/targetPos are null)
  const start = useMemo(
    () => sourcePos ? getPortWorldPos(sourcePos, 'output', connection.sourcePortIndex, sourceOutputCount, sourceNodeWidth, sourceNodeHeight) : ZERO_POS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourcePos?.[0], sourcePos?.[1], sourcePos?.[2], connection.sourcePortIndex, sourceOutputCount, sourceNodeWidth, sourceNodeHeight],
  );
  const end = useMemo(
    () => targetPos ? getPortWorldPos(targetPos, 'input', connection.targetPortIndex, targetInputCount, targetNodeWidth, targetNodeHeight) : ZERO_POS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetPos?.[0], targetPos?.[1], targetPos?.[2], connection.targetPortIndex, targetInputCount, targetNodeWidth, targetNodeHeight],
  );

  // Compute control points based on connection style setting
  // (shared with InstancedConnectionLines so far-LOD lines match exactly)
  const { midA, midB } = useMemo(
    () => computeControlPoints(start, end, connectionStyle),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [start[0], start[1], start[2], end[0], end[1], end[2], connectionStyle],
  );

  // Shared bezier curve — single instance reused for hit geometry, pulse animation, and label positioning.
  // Reuse the same CubicBezierCurve3 object by updating control points in-place to reduce GC pressure
  // during multi-node drag (dozens of connections update per frame).
  const curveRef = useRef<THREE.CubicBezierCurve3 | null>(null);
  const bezierCurve = useMemo(() => {
    if (curveRef.current) {
      // Mutate in-place instead of allocating a new curve
      curveRef.current.v0.set(start[0], start[1], start[2]);
      curveRef.current.v1.set(midA[0], midA[1], midA[2]);
      curveRef.current.v2.set(midB[0], midB[1], midB[2]);
      curveRef.current.v3.set(end[0], end[1], end[2]);
      return curveRef.current;
    }
    const c = new THREE.CubicBezierCurve3(
      new THREE.Vector3(...start),
      new THREE.Vector3(...midA),
      new THREE.Vector3(...midB),
      new THREE.Vector3(...end),
    );
    curveRef.current = c;
    return c;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start[0], start[1], start[2], midA[0], midA[1], midA[2], midB[0], midB[1], midB[2], end[0], end[1], end[2]]);

  // Track a version counter for the curve to trigger hitGeometry rebuild only when needed.
  // Using a counter avoids Object.is comparison issues with the mutated-in-place curve ref.
  const curveVersionRef = useRef(0);
  const curveVersion = useMemo(() => ++curveVersionRef.current,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [start[0], start[1], start[2], midA[0], midA[1], midA[2], midB[0], midB[1], midB[2], end[0], end[1], end[2]]);

  // Invisible TubeGeometry for raycasting — rebuilt when curve changes AND not during active drag.
  // During drag, hit testing is not needed (user is moving nodes, not clicking connections).
  const interaction = useEditorStore(s => s.interaction);
  const isDragging = interaction === 'dragging-node';
  const hitGeometry = useMemo(() => {
    if (!sourcePos || !targetPos || isDragging) return null;
    return new THREE.TubeGeometry(bezierCurve, 20, 0.08, 4, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curveVersion, !!sourcePos, !!targetPos, isDragging]);

  // Dispose old geometry when it changes
  useEffect(() => {
    return () => { hitGeometry?.dispose(); };
  }, [hitGeometry]);

  // Animate data flow pulse + flow dashes along the curve + LOD visibility toggling
  useFrame(({ clock, invalidate }) => {
    // Imperatively toggle visibility based on connection LOD.
    // 'lod' connections render via InstancedConnectionLines (one batched
    // draw call) — the full Pipe shows only at 'full' classification.
    if (groupRef.current && getConnectionLOD) {
      const lod = getConnectionLOD(connection.id);
      groupRef.current.visible = lod === 'full';
    }

    // Animate flow dashes with easing (dashOffset on the overlay line material)
    if (showFlow && flowLineRef.current) {
      const mat = flowLineRef.current.material;
      if (mat) {
        mat.dashOffset = -(clock.getElapsedTime() * flowSpeed);
        mat.needsUpdate = false; // dashOffset is a uniform, no recompile needed
      }
      invalidate();
    }

    // Animate pulse sphere along curve + trailing particles
    if (showPulse && pulseRef.current) {
      const speed = sourceExecState === 'running' ? 1.5 : 0.5;
      const t = (clock.getElapsedTime() * speed) % 1;
      bezierCurve.getPoint(t, _pulsePos);
      pulseRef.current.position.copy(_pulsePos);
      const pulseMatKey = sourceExecState === 'error' ? 'error' : sourceExecState === 'complete' ? 'complete' : 'running';
      pulseRef.current.material = PULSE_MATERIALS[pulseMatKey];

      // Trail particles follow with offset (during running, complete, and error)
      const trailMatKey = sourceExecState === 'error' ? 'error' : sourceExecState === 'complete' ? 'complete' : 'running';
      if (trail1Ref.current) {
        const t1 = ((clock.getElapsedTime() * speed) - 0.08 + 1) % 1;
        bezierCurve.getPoint(t1, _trailPos1);
        trail1Ref.current.position.copy(_trailPos1);
        trail1Ref.current.material = TRAIL_MATERIALS[trailMatKey];
        trail1Ref.current.visible = true;
      }
      if (trail2Ref.current) {
        const t2 = ((clock.getElapsedTime() * speed) - 0.16 + 1) % 1;
        bezierCurve.getPoint(t2, _trailPos2);
        trail2Ref.current.position.copy(_trailPos2);
        trail2Ref.current.material = TRAIL_MATERIALS[trailMatKey];
        trail2Ref.current.visible = true;
      }
      invalidate();
    }

    // Target arrival pulse: brief scale bump at the connection end point
    if (targetPulseRef.current) {
      if (targetExecState === 'running' && targetPulseStartRef.current === 0) {
        targetPulseStartRef.current = clock.getElapsedTime();
      }
      if (targetPulseStartRef.current > 0) {
        const elapsed = clock.getElapsedTime() - targetPulseStartRef.current;
        const duration = 0.3;
        if (elapsed < duration) {
          const progress = elapsed / duration;
          // Quick scale-up then scale-down (ease-out)
          const s = 1 + 0.8 * Math.sin(progress * Math.PI);
          targetPulseRef.current.scale.setScalar(s);
          targetPulseRef.current.visible = true;
          invalidate();
        } else {
          targetPulseRef.current.visible = false;
          targetPulseRef.current.scale.setScalar(1);
          targetPulseStartRef.current = 0;
        }
      }
    }
  });

  // Visual properties driven by state: tint default color by source port type
  // colorOverride takes precedence over the auto-derived port type color
  const autoColor = sourcePortType ? blendWithWhite(PORT_TYPE_COLORS[sourcePortType] ?? PORT_TYPE_COLORS.any) : '#c0c8d0';
  const defaultColor = connection.colorOverride ?? autoColor;
  const lineColor = showPulse
    ? (sourceExecState === 'error' ? '#FF4444' : sourceExecState === 'complete' ? '#66CC88' : '#44DD88')
    : isSelected ? '#ffffff' : isTraced ? '#2EC4B6' : isPathHighlighted ? '#2EC4B6' : isHovered ? '#e8e8ff' : defaultColor;
  const lineWidth = isSelected ? 4 : isTraced ? 4 : isPathHighlighted ? 3.5 : isHovered ? 4 : showPulse ? 3.5 : 3;

  // Label midpoint position (at t=0.5 on the shared bezier curve, slightly above)
  const labelPos = useMemo<[number, number, number]>(() => {
    const mid = new THREE.Vector3();
    bezierCurve.getPoint(0.5, mid);
    return [mid.x, mid.y + 0.12, mid.z];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curveVersion]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Cancel any in-progress connection drawing instead of selecting
    const currentInteraction = useEditorStore.getState().interaction;
    if (currentInteraction === 'drawing-connection') {
      useEditorStore.getState().cancelConnection();
      return;
    }
    if (e.nativeEvent.shiftKey) {
      toggleSelection(connection.id);
    } else {
      setSelection(new Set([connection.id]));
    }
  }, [connection.id, setSelection, toggleSelection]);

  const openContextMenu = useEditorStore(s => s.openContextMenu);
  const insertReroute = useEditorStore(s => s.insertRerouteOnConnection);

  // Source output value for hover display
  const sourceOutputValue = useEditorStore(s => s.nodeOutputs[connection.sourceNodeId]?.[connection.sourcePortIndex]);

  const handleDoubleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Don't insert reroute during connection drawing
    if (useEditorStore.getState().interaction !== 'idle') return;
    // Use the midpoint of the bezier curve as the reroute position
    const mid = new THREE.Vector3();
    bezierCurve.getPoint(0.5, mid);
    insertReroute(connection.id, [mid.x, mid.y, mid.z]);
  }, [connection.id, insertReroute, bezierCurve]);

  const handleContextMenu = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    openContextMenu({
      x: e.nativeEvent.clientX,
      y: e.nativeEvent.clientY,
      target: { kind: 'connection', connectionId: connection.id },
    });
  }, [connection.id, openContextMenu]);

  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoveredConnection(connection.id);
    // Capture intersection point for cursor-following tooltip
    if (e.point) {
      const pos: [number, number, number] = [e.point.x, e.point.y + 0.12, e.point.z];
      hoverPosRef.current = pos;
      setHoverPos(pos);
    }
    // Only set cursor when not in a drag interaction
    if (useEditorStore.getState().interaction === 'idle') {
      document.body.style.cursor = 'pointer';
    }
  }, [connection.id, setHoveredConnection]);

  const handlePointerOut = useCallback(() => {
    setHoveredConnection(null);
    hoverPosRef.current = null;
    setHoverPos(null);
    // Reset cursor when idle or drawing-connection (match Port.tsx pattern)
    const currentInteraction = useEditorStore.getState().interaction;
    if (currentInteraction === 'idle' || currentInteraction === 'drawing-connection') {
      document.body.style.cursor = 'auto';
    }
  }, [setHoveredConnection]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.point && hoverPosRef.current) {
      const pos: [number, number, number] = [e.point.x, e.point.y + 0.12, e.point.z];
      hoverPosRef.current = pos;
      setHoverPos(pos);
    }
  }, []);

  // Early return AFTER all hooks — nodes may not exist yet
  if (!sourcePos || !targetPos || !hitGeometry) return null;

  return (
    <group
      ref={groupRef}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onPointerCancel={handlePointerOut}
      onPointerMove={handlePointerMove}
    >
      {/* Glow line behind hovered/selected connections */}
      {(isHovered || isSelected || isTraced) && (
        <CubicBezierLine
          start={start}
          end={end}
          midA={midA}
          midB={midB}
          color={isSelected ? '#ffffff' : isTraced ? '#2EC4B6' : '#e8e8ff'}
          lineWidth={lineWidth + 4}
          transparent
          opacity={0.15}
        />
      )}
      {/* Visual bezier line */}
      <CubicBezierLine
        ref={lineRef}
        start={start}
        end={end}
        midA={midA}
        midB={midB}
        color={lineColor}
        lineWidth={lineWidth}
      />
      {/* Flow animation overlay: animated dashes during execution */}
      {showFlow && (
        <CubicBezierLine
          ref={flowLineRefCallback}
          start={start}
          end={end}
          midA={midA}
          midB={midB}
          color={flowColor}
          lineWidth={2}
          transparent
          opacity={sourceExecState === 'error' ? 0.8 : sourceExecState === 'complete' ? 0.4 : 0.7}
          dashed
          dashSize={0.06}
          gapSize={0.04}
          dashScale={1}
        />
      )}
      {/* Invisible hit mesh for raycasting */}
      <mesh geometry={hitGeometry} material={HIT_MATERIAL} />

      {/* Data flow pulse — shape matches port type */}
      {showPulse && (
        <>
          <mesh
            ref={pulseRef}
            geometry={PULSE_GEOS[sourcePortType ?? 'any'] ?? PULSE_SPHERE_GEO}
            material={PULSE_MATERIALS.running}
          />
          {/* Trail particles (smaller, only visible during 'running') */}
          <mesh
            ref={trail1Ref}
            geometry={TRAIL_GEOS[sourcePortType ?? 'any'] ?? TRAIL_SPHERE_GEO}
            material={TRAIL_MATERIALS.running}
            visible={false}
          />
          <mesh
            ref={trail2Ref}
            geometry={TRAIL_GEOS[sourcePortType ?? 'any'] ?? TRAIL_SPHERE_GEO}
            material={TRAIL_MATERIALS.running}
            visible={false}
          />
        </>
      )}

      {/* Target arrival pulse: burst at connection endpoint when data arrives */}
      {showPulse && !prefersReducedMotion && (
        <mesh
          ref={targetPulseRef}
          position={end}
          geometry={PULSE_GEOS[sourcePortType ?? 'any'] ?? PULSE_SPHERE_GEO}
          material={PULSE_MATERIALS[sourceExecState === 'error' ? 'error' : sourceExecState === 'complete' ? 'complete' : 'running']}
          visible={false}
        />
      )}

      {/* Connection hover preview — follows cursor position for natural UX */}
      {isHovered && !connection.label && sourceNodeTitle && targetNodeTitle && hoverPos && (
        <group position={hoverPos}>
          <Html center zIndexRange={[50, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <div style={{
              padding: '2px 6px',
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: 3,
              fontSize: 8,
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity: 0.9,
            }}>
              <span style={{ color: PORT_TYPE_COLORS[sourcePortType ?? 'any'] ?? '#888' }}>
                {sourceNodeTitle}
              </span>
              <span style={{ color: 'var(--text-faint)', margin: '0 3px' }}>&rarr;</span>
              <span style={{ color: PORT_TYPE_COLORS[targetPortType ?? 'any'] ?? '#888' }}>
                {targetNodeTitle}
              </span>
              {sourcePortType && (
                <span style={{ color: 'var(--text-faint)', marginLeft: 4, fontSize: 7 }}>
                  ({sourcePortType})
                </span>
              )}
              {sourceOutputValue !== undefined && (
                <div style={{ color: 'var(--success)', fontSize: 8, marginTop: 1, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {formatForTooltip(sourceOutputValue)}
                </div>
              )}
            </div>
          </Html>
        </group>
      )}

      {/* Connection label overlay — double-click to edit */}
      {connection.label && (
        <group position={labelPos}>
          <Html center zIndexRange={[0, 0]} style={{ pointerEvents: 'auto', userSelect: 'none' }}>
            <ConnectionLabel
              connectionId={connection.id}
              label={connection.label}
              color={connection.colorOverride ?? autoColor}
            />
          </Html>
        </group>
      )}
    </group>
  );
});

/** Inline-editable connection label — double-click to rename */
const ConnectionLabel = memo(function ConnectionLabel({ connectionId, label, color }: { connectionId: string; label: string; color: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const updateLabel = useEditorStore(s => s.updateConnectionLabel);

  const commit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== label) {
      updateLabel(connectionId, trimmed);
    } else if (!trimmed) {
      updateLabel(connectionId, undefined);
    }
    setEditing(false);
  }, [value, label, connectionId, updateLabel]);

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          color,
          background: 'var(--panel-bg)',
          border: '1px solid color-mix(in srgb, var(--teal) 50%, transparent)',
          borderRadius: 3,
          padding: '1px 6px',
          outline: 'none',
          width: 100,
          textAlign: 'center',
        }}
      />
    );
  }

  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation();
        setValue(label);
        setEditing(true);
      }}
      style={{
        padding: '1px 6px',
        background: 'var(--panel-bg)',
        borderRadius: 3,
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
        color,
        whiteSpace: 'nowrap',
        maxWidth: 120,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: 'default',
      }}
    >
      {label}
    </div>
  );
});
