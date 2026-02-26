/**
 * DependencyGraphPanel -- SVG-based DAG visualization of the execution graph.
 *
 * Layout: nodes arranged in horizontal tiers (one column per topological wave),
 * connected by cubic bezier SVG paths. Critical path is highlighted in gold.
 *
 * Features:
 * - Topological waves laid out left-to-right as columns
 * - Per-node execution timing / cache badges with % of total
 * - Critical path gold highlighting (nodes + edges) with toggle
 * - Bottleneck node highlighting (top 3 slowest non-cached)
 * - Filter cached nodes toggle
 * - Click-to-focus: selects node and zooms to it
 * - Error indicators with hover tooltips
 * - Summary stats header
 * - Scrollable container for large graphs
 * - Escape to close
 */
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { topologicalSort } from '../../utils/execution';
import { getCriticalPath, getBottleneckNodes } from '../../utils/profiling';
import type { EditorNode, NodeExecutionMetric } from '../../types';
import styles from '../../styles/panels.module.css';

// Layout constants
const NODE_W = 130;
const NODE_H = 40;
const COL_GAP = 50;
const ROW_GAP = 16;
const PAD_X = 24;
const PAD_Y = 16;

interface DependencyGraphPanelProps {
  open: boolean;
  onClose: () => void;
}

/** Position of a node rectangle in the SVG */
interface NodePos {
  x: number;
  y: number;
  waveIndex: number;
  rowIndex: number;
}

/** Edge between two nodes for SVG rendering */
interface DagEdge {
  sourceId: string;
  targetId: string;
  isCritical: boolean;
  isVariableDep?: boolean;
}

export function DependencyGraphPanel({ open, onClose }: DependencyGraphPanelProps) {
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const executionMetrics = useEditorStore(s => s.executionMetrics);
  const executionTotalDuration = useEditorStore(s => s.executionTotalDuration);
  const executionErrors = useEditorStore(s => s.executionErrors);
  const executionStates = useEditorStore(s => s.executionStates);
  const setSelection = useEditorStore(s => s.setSelection);
  const panelRef = useRef<HTMLDivElement>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [hideCached, setHideCached] = useState(false);

  // Compute topological waves (null = cycle detected)
  const waves = useMemo(() => {
    try {
      return topologicalSort(nodes, connections);
    } catch {
      return null;
    }
  }, [nodes, connections]);

  // Compute critical path
  const criticalPathResult = useMemo(() => {
    return getCriticalPath(nodes, connections, executionMetrics);
  }, [nodes, connections, executionMetrics]);

  const criticalPathSet = useMemo(
    () => showCriticalPath ? new Set(criticalPathResult.path) : new Set<string>(),
    [criticalPathResult, showCriticalPath],
  );

  // Build set of critical path edges for highlighting connections
  const criticalEdgeSet = useMemo(() => {
    if (!showCriticalPath) return new Set<string>();
    const set = new Set<string>();
    const path = criticalPathResult.path;
    for (let i = 0; i < path.length - 1; i++) {
      set.add(`${path[i]}->${path[i + 1]}`);
    }
    return set;
  }, [criticalPathResult, showCriticalPath]);

  // Compute bottleneck nodes (top 3 slowest non-cached)
  const bottleneckSet = useMemo(() => {
    const top = getBottleneckNodes(executionMetrics, 3);
    return new Set(top.map(b => b.nodeId));
  }, [executionMetrics]);

  // Set of cached node IDs (for filtering)
  const cachedNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const [id, m] of Object.entries(executionMetrics)) {
      if (m.cacheHit) set.add(id);
    }
    return set;
  }, [executionMetrics]);

  // Build node positions from waves (with optional cache filtering)
  const nodePositions = useMemo(() => {
    if (!waves) return new Map<string, NodePos>();
    const map = new Map<string, NodePos>();
    for (let wi = 0; wi < waves.length; wi++) {
      const wave = waves[wi];
      let ri = 0;
      for (const nodeId of wave) {
        if (hideCached && cachedNodeIds.has(nodeId)) continue;
        map.set(nodeId, {
          x: PAD_X + wi * (NODE_W + COL_GAP),
          y: PAD_Y + ri * (NODE_H + ROW_GAP),
          waveIndex: wi,
          rowIndex: ri,
        });
        ri++;
      }
    }
    return map;
  }, [waves, hideCached, cachedNodeIds]);

  // Build edges from connections + implicit variable dependency edges
  const edges = useMemo(() => {
    const result: DagEdge[] = [];
    const seen = new Set<string>();
    // Explicit connection edges
    for (const conn of Object.values(connections)) {
      const key = `${conn.sourceNodeId}->${conn.targetNodeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!nodePositions.has(conn.sourceNodeId) || !nodePositions.has(conn.targetNodeId)) continue;
      result.push({
        sourceId: conn.sourceNodeId,
        targetId: conn.targetNodeId,
        isCritical: criticalEdgeSet.has(key),
        isVariableDep: false,
      });
    }
    // Implicit variable dependency edges: set-var -> get-var for same variable name
    const setVarNodes: { id: string; varName: string }[] = [];
    const getVarNodes: { id: string; varName: string }[] = [];
    for (const node of Object.values(nodes)) {
      if (node.type === 'set-var') {
        const name = (node.data.variableName as string) ?? '';
        if (name) setVarNodes.push({ id: node.id, varName: name });
      } else if (node.type === 'get-var') {
        const name = (node.data.variableName as string) ?? '';
        if (name) getVarNodes.push({ id: node.id, varName: name });
      }
    }
    for (const sv of setVarNodes) {
      for (const gv of getVarNodes) {
        if (sv.varName === gv.varName) {
          const key = `${sv.id}->${gv.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!nodePositions.has(sv.id) || !nodePositions.has(gv.id)) continue;
          result.push({
            sourceId: sv.id,
            targetId: gv.id,
            isCritical: false,
            isVariableDep: true,
          });
        }
      }
    }
    return result;
  }, [connections, nodes, nodePositions, criticalEdgeSet]);

  // SVG viewBox dimensions
  const svgSize = useMemo(() => {
    if (!waves || waves.length === 0) return { width: 300, height: 100 };
    // Compute from actual node positions
    let maxX = 300;
    let maxY = 100;
    for (const pos of nodePositions.values()) {
      maxX = Math.max(maxX, pos.x + NODE_W + PAD_X);
      maxY = Math.max(maxY, pos.y + NODE_H + PAD_Y + 24);
    }
    return { width: maxX, height: maxY };
  }, [waves, nodePositions]);

  // Summary stats
  const stats = useMemo(() => {
    const totalNodes = Object.keys(nodes).length;
    const waveCount = waves ? waves.length : 0;
    const metricsArr = Object.values(executionMetrics);
    const totalDuration = metricsArr.reduce((sum, m) => sum + m.duration, 0);
    const cacheHits = metricsArr.filter(m => m.cacheHit).length;
    const cacheRate = metricsArr.length > 0
      ? Math.round((cacheHits / metricsArr.length) * 100)
      : 0;
    return { totalNodes, waveCount, totalDuration, cacheHits, cacheRate };
  }, [nodes, waves, executionMetrics]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelection(new Set([nodeId]));
    window.__zoomToFit?.();
  }, [setSelection]);

  // Close on Escape — use stopImmediatePropagation to prevent global handlers
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus on open
  useEffect(() => {
    if (!open || !panelRef.current) return;
    panelRef.current.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Dependency Graph"
        tabIndex={-1}
        style={{ maxWidth: 600, width: '90vw' }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--text-primary)',
          fontWeight: 600,
          fontSize: '14px',
        }}>
          <span>Dependency Graph</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-faint)',
              cursor: 'pointer',
              fontSize: '16px',
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Summary stats */}
        <div style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          gap: 12,
          fontSize: 10,
          color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)',
          flexWrap: 'wrap',
        }}>
          <span>{stats.totalNodes} nodes</span>
          <span style={{ color: 'var(--divider)' }}>|</span>
          <span>{stats.waveCount} waves</span>
          <span style={{ color: 'var(--divider)' }}>|</span>
          <span>{stats.totalDuration.toFixed(1)}ms total</span>
          {stats.cacheHits > 0 && (
            <>
              <span style={{ color: 'var(--divider)' }}>|</span>
              <span>{stats.cacheRate}% cached ({stats.cacheHits})</span>
            </>
          )}
        </div>

        {/* Controls bar */}
        <div style={{
          padding: '6px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: '9px',
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            color: showCriticalPath ? 'var(--warning)' : 'var(--text-faint)',
          }}>
            <input
              type="checkbox"
              checked={showCriticalPath}
              onChange={e => setShowCriticalPath(e.target.checked)}
              style={{ width: 12, height: 12 }}
            />
            Critical path
          </label>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            color: hideCached ? 'var(--teal)' : 'var(--text-faint)',
          }}>
            <input
              type="checkbox"
              checked={hideCached}
              onChange={e => setHideCached(e.target.checked)}
              style={{ width: 12, height: 12 }}
            />
            Hide cached
          </label>
          {criticalPathResult.path.length > 0 && showCriticalPath && (
            <span style={{ marginLeft: 'auto', color: 'var(--warning)' }}>
              Critical: {criticalPathResult.length.toFixed(1)}ms ({criticalPathResult.path.length} nodes)
            </span>
          )}
        </div>

        {/* Cycle warning */}
        {waves === null && (
          <div style={{
            padding: '16px',
            color: 'var(--danger)',
            fontSize: 12,
            textAlign: 'center',
          }}>
            Graph contains a cycle -- cannot compute execution order.
          </div>
        )}

        {/* Empty graph */}
        {waves !== null && waves.length === 0 && (
          <div style={{
            padding: '24px 16px',
            color: 'var(--text-faint)',
            fontSize: 11,
            textAlign: 'center',
          }}>
            No nodes in graph.
          </div>
        )}

        {/* SVG DAG area */}
        {waves !== null && waves.length > 0 && (
          <div style={{
            maxHeight: 'calc(100vh - 280px)',
            overflow: 'auto',
            background: 'color-mix(in srgb, var(--panel-bg) 80%, black 20%)',
          }}>
            <svg
              width={svgSize.width}
              height={svgSize.height}
              viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
              style={{ display: 'block' }}
            >
              {/* Render edges first (behind nodes) */}
              {edges.map(edge => {
                const src = nodePositions.get(edge.sourceId);
                const tgt = nodePositions.get(edge.targetId);
                if (!src || !tgt) return null;
                return (
                  <EdgePath
                    key={`${edge.sourceId}->${edge.targetId}`}
                    x1={src.x + NODE_W}
                    y1={src.y + NODE_H / 2}
                    x2={tgt.x}
                    y2={tgt.y + NODE_H / 2}
                    isCritical={edge.isCritical}
                    isVariableDep={edge.isVariableDep}
                  />
                );
              })}

              {/* Render nodes */}
              {Array.from(nodePositions.entries()).map(([nodeId, pos]) => {
                const node = nodes[nodeId];
                if (!node) return null;
                return (
                  <DagNode
                    key={nodeId}
                    node={node}
                    x={pos.x}
                    y={pos.y}
                    metric={executionMetrics[nodeId]}
                    error={executionErrors[nodeId]}
                    execState={executionStates[nodeId]}
                    isCriticalPath={criticalPathSet.has(nodeId)}
                    isBottleneck={bottleneckSet.has(nodeId)}
                    isHovered={hoveredNode === nodeId}
                    totalDuration={executionTotalDuration}
                    onClick={handleNodeClick}
                    onMouseEnter={setHoveredNode}
                    onMouseLeave={() => setHoveredNode(null)}
                  />
                );
              })}
            </svg>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '6px 16px',
          borderTop: '1px solid var(--divider)',
          fontSize: 10,
          color: 'var(--text-faint)',
          textAlign: 'center',
        }}>
          Click a node to select and zoom to it
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EdgePath -- Cubic bezier SVG connection between two nodes
// ---------------------------------------------------------------------------

function EdgePath({
  x1,
  y1,
  x2,
  y2,
  isCritical,
  isVariableDep,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isCritical: boolean;
  isVariableDep?: boolean;
}) {
  const dx = Math.abs(x2 - x1);
  const cpOffset = Math.max(dx * 0.4, 20);
  const d = `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;

  const stroke = isCritical
    ? 'var(--warning)'
    : isVariableDep
      ? 'rgba(180,130,255,0.5)'
      : 'var(--panel-border)';

  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={isCritical ? 2 : 1}
      strokeLinecap="round"
      strokeDasharray={isVariableDep ? '4 3' : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// DagNode -- SVG node rectangle with title, type badge, timing label
// ---------------------------------------------------------------------------

interface DagNodeProps {
  node: EditorNode;
  x: number;
  y: number;
  metric?: NodeExecutionMetric;
  error?: string;
  execState?: string;
  isCriticalPath: boolean;
  isBottleneck: boolean;
  isHovered: boolean;
  totalDuration: number;
  onClick: (nodeId: string) => void;
  onMouseEnter: (nodeId: string) => void;
  onMouseLeave: () => void;
}

function DagNode({
  node,
  x,
  y,
  metric,
  error,
  execState,
  isCriticalPath,
  isBottleneck,
  isHovered,
  totalDuration,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: DagNodeProps) {
  // Variable node detection (for visual distinction)
  const isVarNode = node.type === 'get-var' || node.type === 'set-var';
  const varName = isVarNode ? (node.data.variableName as string) ?? '' : '';

  // Border color based on state
  const borderColor = isCriticalPath
    ? 'var(--warning)'
    : isBottleneck
      ? 'var(--danger)'
      : error
        ? 'var(--danger)'
        : execState === 'running'
          ? 'var(--teal)'
          : execState === 'complete'
            ? 'var(--success)'
            : isVarNode
              ? 'rgba(180,130,255,0.4)'
              : 'var(--panel-border)';

  // Truncated title
  const maxTitleLen = 12;
  const title = node.title.length > maxTitleLen
    ? node.title.slice(0, maxTitleLen - 1) + '\u2026'
    : node.title;
  const typeBadge = isVarNode && varName
    ? `${node.type === 'get-var' ? '\u2190' : '\u2192'} ${varName.length > 6 ? varName.slice(0, 5) + '\u2026' : varName}`
    : node.type.length > 8
      ? node.type.slice(0, 7) + '\u2026'
      : node.type;

  // Timing label with percentage
  let timingLabel = '';
  if (metric) {
    if (metric.cacheHit) {
      timingLabel = 'cached';
    } else {
      const pct = totalDuration > 0 ? (metric.duration / totalDuration * 100) : 0;
      timingLabel = `${metric.duration.toFixed(1)}ms (${pct.toFixed(0)}%)`;
    }
  }

  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={() => onClick(node.id)}
      onMouseEnter={() => onMouseEnter(node.id)}
      onMouseLeave={onMouseLeave}
    >
      {/* Hover background glow */}
      {isHovered && (
        <rect
          x={x - 2}
          y={y - 2}
          width={NODE_W + 4}
          height={NODE_H + 4}
          rx={8}
          ry={8}
          fill="none"
          stroke="var(--teal)"
          strokeWidth={1}
          opacity={0.4}
        />
      )}

      {/* Bottleneck glow (subtle red) */}
      {isBottleneck && !isCriticalPath && (
        <rect
          x={x - 1}
          y={y - 1}
          width={NODE_W + 2}
          height={NODE_H + 2}
          rx={7}
          ry={7}
          fill="none"
          stroke="var(--danger)"
          strokeWidth={1}
          opacity={0.3}
        />
      )}

      {/* Node rectangle */}
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={6}
        ry={6}
        fill={isHovered ? 'var(--btn-bg)' : isBottleneck ? 'rgba(255,80,80,0.04)' : 'var(--bg-subtle)'}
        stroke={borderColor}
        strokeWidth={isCriticalPath ? 2 : isBottleneck ? 1.5 : 1}
      />

      {/* Error indicator icon (top-right) */}
      {error && (
        <g>
          <circle
            cx={x + NODE_W - 8}
            cy={y + 8}
            r={5}
            fill="var(--danger)"
          />
          <text
            x={x + NODE_W - 8}
            y={y + 11}
            textAnchor="middle"
            fontSize={8}
            fontWeight={700}
            fill="var(--text-bright)"
          >
            !
          </text>
          {/* Error tooltip on hover */}
          {isHovered && (
            <g>
              <rect
                x={x}
                y={y + NODE_H + 4}
                width={NODE_W}
                height={18}
                rx={3}
                ry={3}
                fill="var(--danger)"
                opacity={0.9}
              />
              <text
                x={x + 4}
                y={y + NODE_H + 16}
                fontSize={8}
                fill="var(--text-bright)"
                fontFamily="var(--font-mono)"
              >
                {error.length > 22 ? error.slice(0, 21) + '\u2026' : error}
              </text>
            </g>
          )}
        </g>
      )}

      {/* Title text */}
      <text
        x={x + 8}
        y={y + 16}
        fontSize={10}
        fontFamily="var(--font-mono)"
        fontWeight={isCriticalPath ? 700 : 400}
        fill="var(--text-primary)"
      >
        {title}
      </text>

      {/* Type badge */}
      <text
        x={x + 8}
        y={y + 28}
        fontSize={8}
        fontFamily="var(--font-mono)"
        fill="var(--text-faint)"
      >
        {typeBadge}
      </text>

      {/* Timing label (right-aligned, bottom) */}
      {timingLabel && (
        <text
          x={x + NODE_W - 6}
          y={y + 28}
          textAnchor="end"
          fontSize={7}
          fontFamily="var(--font-mono)"
          fill={metric?.cacheHit ? 'var(--text-faint)' : isBottleneck ? 'var(--danger)' : 'var(--teal)'}
        >
          {timingLabel}
        </text>
      )}
    </g>
  );
}
