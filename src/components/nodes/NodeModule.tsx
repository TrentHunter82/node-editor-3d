import { useRef, useState, useMemo, useCallback, useEffect, memo } from 'react';
import { Html, Text } from '@react-three/drei';
import { useSpring, animated, to } from '@react-spring/three';
import * as THREE from 'three';
import type { Group } from 'three';
import { useMatcap } from '../../hooks/useMatcap';
import { Port } from './Port';
import { NodeDecorations } from './NodeDecorations';
import { NodeScreen } from './NodeScreen';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { NODE_TYPE_CONFIG } from '../../types';
import type { EditorNode, ExecutionState } from '../../types';
import type { MatcapName } from '../../utils/matcap';
import { ResizeHandles } from './ResizeHandles';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../../store/slices/nodeSlice';
import { getMinNodeDepth } from '../../utils/nodeDepth';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { NodeQuickActions } from './NodeQuickActions';
import { ExecutionBadge, ExecutionGlow, ValidationBadgeIcon, ErrorSummary } from './NodeExecutionBadge';
import { ProfilingBadge, computeHeatmapColor } from './NodeProfilingOverlay';
import { InlineValueOverlay } from './NodeInlineOverlay';
import { FadingDiffHighlight, SelectionPulse, SubgraphFrame, ElevationIndicator } from './NodeEffects';
import { getCachedBasicMaterial, getCachedRoundedBoxGeo } from '../../utils/materialCache';
import { getBodyRef, removeBodyRef } from '../../utils/nodeBodyRegistry';


const COLOR_MAP: Record<string, MatcapName> = {
  teal: 'plastic-teal',
  orange: 'plastic-orange',
  coral: 'plastic-coral',
  'teal-coral': 'plastic-coral',
};

// Node body dimensions
const NODE_H = 0.5;

// Shared geometry for breakpoint indicator
const BREAKPOINT_SPHERE_GEO = new THREE.SphereGeometry(0.06, 12, 12);

// Shared overlay materials (keyed by color|opacity|transparent|depthWrite)
const MAT_DIM_OVERLAY = getCachedBasicMaterial('#000000', 0.4, true, false);
const MAT_SELECTION_GLOW = getCachedBasicMaterial('#ffffff', 0.15, true, false);
const MAT_SEARCH_HIGHLIGHT = getCachedBasicMaterial('#00FFD0', 0.2, true, false);
const MAT_COERCION_GLOW = getCachedBasicMaterial('#FFB347', 0.15, true, false);
const MAT_COERCION_DASH = getCachedBasicMaterial('#FFB347', 0.5, true, true);
const MAT_LABEL_STRIP = getCachedBasicMaterial('#000000', 0.3, true, true);
const MAT_BOUNDARY_TEAL = getCachedBasicMaterial('#2EC4B6', 0.1, true, false);
const MAT_BOUNDARY_PURPLE = getCachedBasicMaterial('#9B59B6', 0.1, true, false);
const MAT_BREAKPOINT_RED = getCachedBasicMaterial('#FF3333', 1, false, true);
const MAT_BREAKPOINT_YELLOW = getCachedBasicMaterial('#FFB800', 1, false, true);
const MAT_LOCK_OVERLAY = getCachedBasicMaterial('#FF8C00', 0.12, true, false);
const MAT_LOCK_BADGE = getCachedBasicMaterial('#FF8C00', 1, false, true);

const HOVER_SPRING_CONFIG = { tension: 600, friction: 26 };
const SPAWN_SPRING_CONFIG = { tension: 200, friction: 15 };

const TRACE_COLORS: Record<string, string> = {
  traced: '#2EC4B6',    // teal — the node being traced
  upstream: '#FF6B35',  // orange — feeds data into traced node
  downstream: '#9B59B6', // purple — receives data from traced node
};

interface NodeModuleProps {
  node: EditorNode;
  selected: boolean;
  onSelect: (id: string, e: PointerEvent | MouseEvent) => void;
  traceHighlight?: 'traced' | 'upstream' | 'downstream';
  searchHighlight?: boolean;
  diffHighlight?: 'added' | 'removed' | 'modified';
}

export const NodeModule = memo(function NodeModule({ node, selected, onSelect, traceHighlight, searchHighlight, diffHighlight }: NodeModuleProps) {
  const reducedMotion = useReducedMotion();
  const groupRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  // Selection pulse: track transition from unselected → selected
  const prevSelectedRef = useRef(selected);
  const [pulseKey, setPulseKey] = useState(0);
  useEffect(() => {
    if (selected && !prevSelectedRef.current) {
      setPulseKey(k => k + 1);
    }
    prevSelectedRef.current = selected;
  }, [selected]);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const updateNodeTitle = useEditorStore(s => s.updateNodeTitle);
  const openContextMenu = useEditorStore(s => s.openContextMenu);
  const enterSubgraph = useEditorStore(s => s.enterSubgraph);
  const execState = useEditorStore(s => s.executionStates[node.id]) as ExecutionState | undefined;
  const execError = useEditorStore(s => s.executionErrors[node.id]);
  const hasBreakpoint = useEditorStore(s => !!s.breakpoints[node.id]);
  const hasBreakpointCondition = useEditorStore(s => !!s.breakpointConditions[node.id]);
  const validationErrors = useEditorStore(s => s.validationErrors[node.id]);
  const metric = useEditorStore(s => s.executionMetrics[node.id]);
  const showHeatmap = useSettingsStore(s => s.showExecutionHeatmap);
  const showNodeScreens = useSettingsStore(s => s.showNodeScreens);
  // Pre-computed max node duration from executionSlice (O(1) instead of O(N) per-node)
  const executionMaxNodeDuration = useEditorStore(s => s.executionMaxNodeDuration);

  // During connection drawing: dim nodes with no compatible input ports (O(1) Set lookup)
  const isConnectionIncompatible = useEditorStore(s => s.incompatibleNodeIds.has(node.id));

  // Reset cursor on unmount if this node was hovered — prevents stuck 'grab' cursor
  // when a node is deleted, culled, or transitions to LOD while hovered
  useEffect(() => {
    return () => {
      if (useEditorStore.getState().interaction === 'idle') {
        document.body.style.cursor = 'auto';
      }
    };
  }, []);

  const handleDoubleClick = useCallback((e: { stopPropagation(): void }) => {
    e.stopPropagation();
    // Double-click subgraph node → enter the subgraph
    if (node.type === 'subgraph') {
      enterSubgraph(node.id);
      return;
    }
    if (node.locked) return;
    setEditValue(node.title);
    setEditing(true);
  }, [node.title, node.type, node.id, node.locked, enterSubgraph]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== node.title) {
      updateNodeTitle(node.id, trimmed);
    }
    setEditing(false);
  }, [editValue, node.title, node.id, updateNodeTitle]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setEditing(false);
  }, [commitRename]);

  const colorKey = NODE_TYPE_CONFIG[node.type]?.color ?? 'teal';

  const matcap = useMatcap(COLOR_MAP[colorKey]);

  const isCollapsed = node.collapsed === true;
  const currentH = isCollapsed ? 0.25 : NODE_H;

  // Per-node dimensions (defaults to constants for standard-size nodes)
  const nodeW = node.width ?? DEFAULT_NODE_WIDTH;
  // Floor nodeD to the content-based minimum so legacy nodes (height=undefined)
  // grow their mesh to fit the screen overlay instead of clipping it.
  const minD = getMinNodeDepth(node.type, node.inputs.length, node.outputs.length);
  const nodeD = Math.max(node.height ?? DEFAULT_NODE_HEIGHT, minD);

  // Heatmap color: green(fast) → yellow → red(slow) based on relative execution time
  const heatmapColor = useMemo(
    () => computeHeatmapColor(showHeatmap, metric, executionMaxNodeDuration),
    [showHeatmap, metric, executionMaxNodeDuration],
  );

  // Calculate port positions along the sides of the node (using per-node dimensions)
  const inputPositions = useMemo(() => {
    const count = node.inputs.length;
    if (count === 0) return [];
    return node.inputs.map((_, i) => {
      const z = count === 1 ? 0 : (i / (count - 1) - 0.5) * (nodeD - 0.2);
      return [-nodeW / 2 - 0.05, 0, z] as [number, number, number];
    });
  }, [node.inputs, nodeW, nodeD]);

  const outputPositions = useMemo(() => {
    const count = node.outputs.length;
    if (count === 0) return [];
    return node.outputs.map((_, i) => {
      const z = count === 1 ? 0 : (i / (count - 1) - 0.5) * (nodeD - 0.2);
      return [nodeW / 2 + 0.05, 0, z] as [number, number, number];
    });
  }, [node.outputs, nodeW, nodeD]);

  // Hover and spawn animations (skip when user prefers reduced motion)
  const { scale } = useSpring({
    scale: hovered ? 1.05 : 1,
    config: HOVER_SPRING_CONFIG,
    immediate: reducedMotion,
  });

  const { spawnScale } = useSpring({
    from: { spawnScale: 0 },
    to: { spawnScale: 1 },
    config: SPAWN_SPRING_CONFIG,
    immediate: reducedMotion,
  });

  // Register the body mesh ref for Html occlusion (synchronous so children see it)
  const bodyMeshRef = getBodyRef(node.id);
  useEffect(() => () => removeBodyRef(node.id), [node.id]);

  return (
    <animated.group
      ref={groupRef}
      position={node.position}
      scale={to([spawnScale, scale], (s, h) => [s * h, s * h, s * h])}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(node.id, e.nativeEvent);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        openContextMenu({
          x: e.nativeEvent.clientX,
          y: e.nativeEvent.clientY,
          target: { kind: 'node', nodeId: node.id },
        });
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        // Only set grab cursor when idle — during drag, useNodeDrag controls cursor
        if (useEditorStore.getState().interaction === 'idle') {
          document.body.style.cursor = node.locked ? 'not-allowed' : 'grab';
        }
      }}
      onPointerOut={() => {
        setHovered(false);
        // Only reset cursor if we're not in a drag (useNodeDrag will reset on endDrag)
        if (useEditorStore.getState().interaction === 'idle') {
          document.body.style.cursor = 'auto';
        }
      }}
      onPointerCancel={() => {
        setHovered(false);
        if (useEditorStore.getState().interaction === 'idle') {
          document.body.style.cursor = 'auto';
        }
      }}
    >
      {/* Main body — cached geometry shared across nodes with same dimensions */}
      <mesh ref={bodyMeshRef as React.RefObject<THREE.Mesh>} geometry={getCachedRoundedBoxGeo(nodeW, currentH, nodeD, 4, 0.08)}>
        <meshMatcapMaterial matcap={matcap} />
      </mesh>

      {/* Subgraph double-border: nested frame to distinguish from regular nodes */}
      {node.type === 'subgraph' && (
        <SubgraphFrame width={nodeW} height={currentH} depth={nodeD} hovered={hovered} />
      )}

      {/* Boundary node indicator: subtle tinted frame for subgraph-input/output */}
      {(node.type === 'subgraph-input' || node.type === 'subgraph-output') && (
        <mesh
          geometry={getCachedRoundedBoxGeo(nodeW + 0.03, currentH + 0.03, nodeD + 0.03, 4, 0.09)}
          material={node.type === 'subgraph-input' ? MAT_BOUNDARY_TEAL : MAT_BOUNDARY_PURPLE}
        />
      )}

      {/* Connection drawing: dim nodes with no compatible input ports */}
      {isConnectionIncompatible && (
        <mesh
          geometry={getCachedRoundedBoxGeo(nodeW + 0.02, currentH + 0.02, nodeD + 0.02, 4, 0.09)}
          material={MAT_DIM_OVERLAY}
        />
      )}

      {/* Selection glow outline */}
      {selected && (
        <mesh
          geometry={getCachedRoundedBoxGeo(nodeW + 0.06, currentH + 0.06, nodeD + 0.06, 4, 0.1)}
          material={MAT_SELECTION_GLOW}
        />
      )}
      {/* Brief expanding pulse when node becomes selected */}
      {pulseKey > 0 && <SelectionPulse key={pulseKey} width={nodeW} height={currentH} depth={nodeD} />}

      {/* Search highlight glow */}
      {searchHighlight && !selected && (
        <mesh
          geometry={getCachedRoundedBoxGeo(nodeW + 0.07, currentH + 0.07, nodeD + 0.07, 4, 0.1)}
          material={MAT_SEARCH_HIGHLIGHT}
        />
      )}

      {/* Graph diff highlight glow with fade-out (green=added, red=removed, yellow=modified) */}
      {diffHighlight && (
        <FadingDiffHighlight
          type={diffHighlight}
          width={nodeW}
          height={currentH}
          depth={nodeD}
        />
      )}

      {/* Execution state glow */}
      {execState && execState !== 'idle' && (
        <ExecutionGlow state={execState} width={nodeW} height={currentH} depth={nodeD} />
      )}

      {/* Execution heatmap overlay: green=fast, red=slow */}
      {heatmapColor && (
        <mesh
          geometry={getCachedRoundedBoxGeo(nodeW + 0.05, currentH + 0.05, nodeD + 0.05, 4, 0.1)}
          material={getCachedBasicMaterial(heatmapColor, 0.2, true, false)}
        />
      )}

      {/* Auto-inserted coercion node indicator: dashed amber border with glow */}
      {node.autoInserted && (
        <>
          <mesh
            geometry={getCachedRoundedBoxGeo(nodeW + 0.04, currentH + 0.04, nodeD + 0.04, 4, 0.09)}
            material={MAT_COERCION_GLOW}
          />
          {/* Top-edge dashed-line indicator (amber) — scaled geometry */}
          <mesh position={[0, currentH / 2 + 0.025, -nodeD / 2 + 0.01]} material={MAT_COERCION_DASH}>
            <planeGeometry args={[nodeW * 0.6, 0.015]} />
          </mesh>
          <mesh position={[0, currentH / 2 + 0.025, nodeD / 2 - 0.01]} material={MAT_COERCION_DASH}>
            <planeGeometry args={[nodeW * 0.6, 0.015]} />
          </mesh>
        </>
      )}

      {/* Data flow trace highlight glow */}
      {traceHighlight && (
        <mesh
          geometry={getCachedRoundedBoxGeo(nodeW + 0.08, currentH + 0.08, nodeD + 0.08, 4, 0.11)}
          material={getCachedBasicMaterial(
            TRACE_COLORS[traceHighlight],
            traceHighlight === 'traced' ? 0.25 : 0.15,
            true, false,
          )}
        />
      )}

      {/* Breakpoint indicator: red dot (unconditional) or yellow dot (conditional) — shared geometry */}
      {hasBreakpoint && (
        <mesh
          geometry={BREAKPOINT_SPHERE_GEO}
          position={[-nodeW / 2 + 0.15, currentH / 2 + 0.02, -nodeD / 2 + 0.15]}
          material={hasBreakpointCondition ? MAT_BREAKPOINT_YELLOW : MAT_BREAKPOINT_RED}
        />
      )}

      {/* Locked node indicator: amber overlay + lock badge on top-right corner */}
      {node.locked && (
        <>
          <mesh
            geometry={getCachedRoundedBoxGeo(nodeW + 0.04, currentH + 0.04, nodeD + 0.04, 4, 0.09)}
            material={MAT_LOCK_OVERLAY}
          />
          {/* Lock badge: amber sphere matching breakpoint indicator pattern */}
          <mesh
            geometry={BREAKPOINT_SPHERE_GEO}
            position={[nodeW / 2 - 0.15, currentH / 2 + 0.02, -nodeD / 2 + 0.15]}
            material={MAT_LOCK_BADGE}
          />
        </>
      )}

      {/* Corner screw decorations */}
      <NodeDecorations width={nodeW} height={currentH} depth={nodeD} />

      {/* Top label strip - darker band */}
      <mesh position={[0, currentH / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT_LABEL_STRIP}>
        <planeGeometry args={[nodeW - 0.1, nodeD - 0.1]} />
      </mesh>

      {/* Input ports */}
      {!isCollapsed && inputPositions.map((pos, i) => (
        <Port key={`in-${i}`} nodeId={node.id} portIndex={i} type="input" position={pos} />
      ))}

      {/* Output ports */}
      {!isCollapsed && outputPositions.map((pos, i) => (
        <Port key={`out-${i}`} nodeId={node.id} portIndex={i} type="output" position={pos} />
      ))}

      {/* Etched title — 3D text on node surface, oriented with the node */}
      {!editing && (
        <Text
          position={[0, currentH / 2 + 0.008, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.055}
          color="#c8d6e5"
          anchorX="center"
          anchorY="middle"
          maxWidth={nodeW - 0.12}
          textAlign="center"
          onDoubleClick={handleDoubleClick}
        >
          {(isCollapsed ? '\u25B8 ' : '')
            + (node.type === 'subgraph' ? '\u229E ' : '')
            + (node.type === 'subgraph-input' ? '\u25B7 ' : '')
            + (node.type === 'subgraph-output' ? '\u25C1 ' : '')
            + node.title}
        </Text>
      )}

      {/* Rename input — temporary Html overlay shown only during inline editing */}
      {editing && (
        <Html
          position={[0, currentH / 2 + 0.02, 0]}
          center
          distanceFactor={6}
          zIndexRange={[0, 0]}
          style={{ pointerEvents: 'auto' }}
        >
          <input
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
            style={{
              fontFamily: "'Archivo Black', sans-serif",
              fontSize: '13px',
              color: 'var(--text-bright)',
              background: 'var(--overlay-bg)',
              border: '1px solid color-mix(in srgb, var(--teal) 50%, transparent)',
              borderRadius: '4px',
              padding: '2px 6px',
              textAlign: 'center',
              outline: 'none',
              width: '120px',
            }}
          />
        </Html>
      )}

      {/* Quick actions bar — 3D mesh buttons on right face, shown on hover */}
      {hovered && !editing && !isCollapsed && (
        <NodeQuickActions nodeId={node.id} locked={node.locked} nodeW={nodeW} currentH={currentH} />
      )}

      {/* Execution state badge — front-left edge, below node top */}
      {execState && execState !== 'idle' && (
        <Html
          position={[nodeW / 2 - 0.08, 0, -nodeD / 2 - 0.06]}
          center
          distanceFactor={6}
          zIndexRange={[50, 0]}
          wrapperClass="html-no-events"
          style={{ pointerEvents: 'none' }}
        >
          <ExecutionBadge state={execState} />
        </Html>
      )}

      {/* Validation error badge — front-right edge, below node top */}
      {validationErrors && validationErrors.length > 0 && (
        <Html
          position={[-nodeW / 2 + 0.08, 0, -nodeD / 2 - 0.06]}
          center
          distanceFactor={6}
          zIndexRange={[0, 0]}
          wrapperClass="html-no-events"
          style={{ pointerEvents: 'none' }}
        >
          <ValidationBadgeIcon errors={validationErrors} />
        </Html>
      )}

      {/* Profiling badge — right side face, centered vertically */}
      {metric && !isCollapsed && (
        <Html
          position={[nodeW / 2 + 0.08, 0, 0]}
          center
          distanceFactor={6}
          zIndexRange={[50, 0]}
          wrapperClass="html-no-events"
          style={{ pointerEvents: 'none' }}
        >
          <ProfilingBadge duration={metric.duration} cacheHit={metric.cacheHit} />
        </Html>
      )}

      {/* Execution error summary — shown when node has an execution error */}
      {execError && !isCollapsed && (
        <Html
          position={[0, -currentH / 2 - 0.1, -nodeD / 2 + 0.1]}
          center
          distanceFactor={6}
          zIndexRange={[0, 0]}
          wrapperClass="html-no-events"
          style={{ pointerEvents: 'none' }}
        >
          <ErrorSummary error={execError} />
        </Html>
      )}

      {/* NodeScreen editing panel — shown always when showNodeScreens is on, or when selected */}
      {!isCollapsed && (showNodeScreens || selected) && (
        <NodeScreen node={node} currentH={currentH} nodeW={nodeW} nodeD={nodeD} />
      )}

      {/* Inline value overlay on node face — fallback when NodeScreen is hidden */}
      {!isCollapsed && !showNodeScreens && !selected && (
        <InlineValueOverlay node={node} currentH={currentH} />
      )}

      {/* Resize handles — visible on selected, non-collapsed, non-locked nodes */}
      {selected && !isCollapsed && !node.locked && (
        <ResizeHandles nodeId={node.id} nodeW={nodeW} nodeD={nodeD} currentH={currentH} />
      )}

      {/* Elevation indicator: vertical guide line + ground shadow when node is above Y=0 */}
      {node.position[1] > 0.01 && (
        <ElevationIndicator height={node.position[1]} />
      )}
    </animated.group>
  );
});

