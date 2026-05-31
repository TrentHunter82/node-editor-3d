import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from '../../styles/panels.module.css';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../../types';
import type { NodeType, NodeCategory } from '../../types';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../../store/slices/nodeSlice';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/** Map NODE_TYPE_CONFIG color key → CSS variable (theme-aware) */
const COLOR_KEY_HEX: Record<string, string> = {
  teal: 'var(--teal)',
  orange: 'var(--orange)',
  coral: 'var(--coral)',
  'teal-coral': 'var(--purple)',
};

/** Get the display color for a node type, derived from NODE_TYPE_CONFIG color key */
function getNodeColor(type: string): string {
  const config = NODE_TYPE_CONFIG[type as NodeType];
  if (!config) return 'var(--text-dim)';
  return COLOR_KEY_HEX[config.color] ?? 'var(--text-dim)';
}

/** Compute the most common color per category from NODE_TYPE_CONFIG */
function computeCategoryColor(category: NodeCategory): string {
  const counts: Record<string, number> = {};
  for (const [type, cat] of Object.entries(NODE_CATEGORIES)) {
    if (cat !== category) continue;
    const config = NODE_TYPE_CONFIG[type as NodeType];
    if (!config) continue;
    counts[config.color] = (counts[config.color] ?? 0) + 1;
  }
  let bestKey = 'teal';
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count > bestCount) { bestKey = key; bestCount = count; }
  }
  return COLOR_KEY_HEX[bestKey] ?? 'var(--text-dim)';
}

/** Legend entries — all 10 categories with their representative color derived from NODE_TYPE_CONFIG */
const CATEGORY_ORDER: NodeCategory[] = ['Core', 'Math', 'String', 'Logic', 'Vector', 'Data', 'Color', 'Live', 'Utility', 'Subgraph'];
const LEGEND_ENTRIES = CATEGORY_ORDER.map(cat => ({ label: cat, color: computeCategoryColor(cat) }));

// Group boundary color (muted teal)
const GROUP_COLOR = 'color-mix(in srgb, var(--teal) 30%, transparent)';
const GROUP_STROKE = 'color-mix(in srgb, var(--teal) 60%, transparent)';

// Padding for inner area (px)
const PAD_H = 16; // horizontal padding (8 each side)
const PAD_V = 28; // vertical (22 top label + 6 bottom)

type MinimapViewMode = 'position' | 'connectivity';

// Performance thresholds for large graph LOD
const CONN_SKIP_THRESHOLD = 200;  // Skip connection lines when >200 nodes
const DOTS_ONLY_THRESHOLD = 500;  // Render simplified dots (no groups/tooltips) when >500 nodes
const REDRAW_INTERVAL_MS = 100;   // Throttle minimap redraw to ~10fps

/**
 * Minimap: HTML/CSS overlay showing top-down view of all nodes.
 * Auto-scales to fit all nodes with padding.
 * Click to navigate the camera to a world position.
 * Drag the viewport rectangle to pan the camera.
 * Shows node labels on hover, group boundaries, zoom level, and scale indicator.
 */
export function Minimap() {
  const prefersReducedMotion = useReducedMotion();
  const minimapVisible = useSettingsStore(s => s.minimapVisible);
  const minimapWidth = useSettingsStore(s => s.minimapWidth);
  const minimapHeight = useSettingsStore(s => s.minimapHeight);
  const setMinimapSize = useSettingsStore(s => s.setMinimapSize);
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const groups = useEditorStore(s => s.groups);
  const selectedIds = useEditorStore(s => s.selectedIds);

  // Dynamic inner dimensions based on minimap size
  const MAP_W = minimapWidth - PAD_H;
  const MAP_H = minimapHeight - PAD_V;

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  const connList = useMemo(() => Object.values(connections), [connections]);
  const innerRef = useRef<HTMLDivElement>(null);

  // Hovered node ID for label tooltip
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Viewport indicator state: camera target XZ and distance (for rectangle size)
  const [viewport, setViewport] = useState<{ x: number; z: number; dist: number } | null>(null);

  // Viewport drag state
  const dragRef = useRef<{ dragging: boolean; startPx: number; startPy: number; startWorldX: number; startWorldZ: number } | null>(null);
  const dragCleanupRaf = useRef(0);

  // Minimap independent zoom level (1 = auto-fit, >1 = zoomed in)
  const [minimapZoom, setMinimapZoom] = useState(1);

  // View mode: position (default) or connectivity (color by connection count)
  const [viewMode, setViewMode] = useState<MinimapViewMode>('position');

  // Node drag on minimap
  const nodeDragRef = useRef<{ nodeId: string; startPx: number; startPy: number; startPos: [number, number, number] } | null>(null);

  // Rectangle selection
  const rectSelectRef = useRef<{ startPx: number; startPy: number } | null>(null);
  const [rectSelect, setRectSelect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Resize handle drag state
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  // Whether to show legend
  const [showLegend, setShowLegend] = useState(false);

  // Ref to track current scale/offset for use in event listener closures (avoids stale values)
  const scaleRef = useRef({ scale: 1, offsetX: 0, offsetZ: 0 });

  // Performance: throttle minimap content redraw for large graphs
  const lastDrawnRef = useRef(0);
  const [throttledNodes, setThrottledNodes] = useState(nodeList);
  const [throttledConns, setThrottledConns] = useState(connList);
  const nodeCount = nodeList.length;

  // Throttle content updates to ~10fps for large graphs (>50 nodes). All state
  // updates go through a timer (delay 0 for the immediate case) so setState
  // never runs synchronously in the effect body — a one-tick deferral that's
  // imperceptible for a minimap redraw.
  useEffect(() => {
    const now = performance.now();
    const elapsed = now - lastDrawnRef.current;
    const delay = nodeCount > 50 && elapsed < REDRAW_INTERVAL_MS
      ? REDRAW_INTERVAL_MS - elapsed
      : 0;
    const timer = setTimeout(() => {
      lastDrawnRef.current = performance.now();
      setThrottledNodes(nodeList);
      setThrottledConns(connList);
    }, delay);
    return () => clearTimeout(timer);
  }, [nodeList, connList, nodeCount]);

  // Determine LOD mode for rendering
  const skipConnections = nodeCount > CONN_SKIP_THRESHOLD;
  const dotsOnly = nodeCount > DOTS_ONLY_THRESHOLD;

  // Poll camera position every frame for viewport rectangle
  useEffect(() => {
    let raf: number;
    const update = () => {
      const oc = window.__orbitControls;
      if (oc) {
        const t = oc.target;
        const cam = oc.object;
        const dist = cam.position.distanceTo(t);
        setViewport(prev => {
          // Only update state if values changed meaningfully (avoid re-renders)
          if (prev && Math.abs(prev.x - t.x) < 0.01 && Math.abs(prev.z - t.z) < 0.01 && Math.abs(prev.dist - dist) < 0.01) {
            return prev;
          }
          return { x: t.x, z: t.z, dist };
        });
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Calculate world bounds and scale
  // Depend on `nodes` (stable Zustand ref) not `nodeList` (new array each render)
  const { scale, offsetX, offsetZ } = useMemo(() => {
    const list = Object.values(nodes);
    if (list.length === 0) return { scale: 1, offsetX: 0, offsetZ: 0, worldWidth: MAP_W };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const n of list) {
      const halfW = (n.width ?? DEFAULT_NODE_WIDTH) / 2;
      const halfD = (n.height ?? DEFAULT_NODE_HEIGHT) / 2;
      minX = Math.min(minX, n.position[0] - halfW);
      maxX = Math.max(maxX, n.position[0] + halfW);
      minZ = Math.min(minZ, n.position[2] - halfD);
      maxZ = Math.max(maxZ, n.position[2] + halfD);
    }
    const pad = 3;
    const worldW = (maxX - minX) + pad * 2;
    const worldH = (maxZ - minZ) + pad * 2;
    const baseScale = Math.min(MAP_W / worldW, MAP_H / worldH);
    const s = baseScale * minimapZoom;
    return {
      scale: s,
      offsetX: -(minX - pad) * s + (MAP_W - worldW * s) / 2,
      offsetZ: -(minZ - pad) * s + (MAP_H - worldH * s) / 2,
      worldWidth: worldW,
    };
  }, [nodes, minimapZoom, MAP_W, MAP_H]);

  // Keep scaleRef in sync with latest computed values. Done in an effect (runs
  // after every commit) rather than during render so the render stays pure;
  // pointer handlers read scaleRef.current asynchronously, so post-commit is
  // soon enough.
  useEffect(() => {
    scaleRef.current = { scale, offsetX, offsetZ };
  });

  const worldToMap = useCallback((x: number, z: number): [number, number] => {
    return [x * scale + offsetX, z * scale + offsetZ];
  }, [scale, offsetX, offsetZ]);

  /** Inverse of worldToMap: convert minimap pixel coords back to world XZ */
  const mapToWorld = useCallback((px: number, py: number): [number, number] => {
    const worldX = (px - offsetX) / scale;
    const worldZ = (py - offsetZ) / scale;
    return [worldX, worldZ];
  }, [scale, offsetX, offsetZ]);

  // Track active navigation RAF to prevent stacking on rapid clicks
  const navRafRef = useRef(0);
  // Cancel navigation RAF on unmount to prevent memory leaks
  useEffect(() => () => { if (navRafRef.current) cancelAnimationFrame(navRafRef.current); }, []);

  /** Animate camera to a world position */
  const flyToWorld = useCallback((worldX: number, worldZ: number) => {
    const oc = window.__orbitControls;
    if (!oc) return;

    // Cancel any in-flight navigation animation
    if (navRafRef.current) cancelAnimationFrame(navRafRef.current);
    navRafRef.current = 0;

    // Smooth animate the OrbitControls target to the clicked world position
    const startTarget = oc.target.clone();
    const startCamPos = oc.object.position.clone();
    const dx = worldX - startTarget.x;
    const dz = worldZ - startTarget.z;

    let t = 0;
    const animate = () => {
      t += 0.08;
      if (t > 1) t = 1;
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      oc.target.set(
        startTarget.x + dx * ease,
        0,
        startTarget.z + dz * ease,
      );
      // Move camera by the same delta to keep the same viewing angle
      oc.object.position.set(
        startCamPos.x + dx * ease,
        startCamPos.y,
        startCamPos.z + dz * ease,
      );
      oc.update();
      window.__invalidate?.(); // Trigger R3F re-render in demand mode

      if (t < 1) {
        navRafRef.current = requestAnimationFrame(animate);
      } else {
        navRafRef.current = 0;
      }
    };
    animate();
  }, []);

  /** Zoom minimap to fit selected nodes (or all nodes if none selected) */
  const zoomToSelection = useCallback(() => {
    const sel = useEditorStore.getState().selectedIds;
    const allNodes = useEditorStore.getState().nodes;
    const targetNodes = sel.size > 0
      ? [...sel].map(id => allNodes[id]).filter(Boolean)
      : Object.values(allNodes);
    if (targetNodes.length === 0) return;

    // Find bounds of target nodes (include node extents, not just centers)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const n of targetNodes) {
      const halfW = (n.width ?? DEFAULT_NODE_WIDTH) / 2;
      const halfD = (n.height ?? DEFAULT_NODE_HEIGHT) / 2;
      minX = Math.min(minX, n.position[0] - halfW);
      maxX = Math.max(maxX, n.position[0] + halfW);
      minZ = Math.min(minZ, n.position[2] - halfD);
      maxZ = Math.max(maxZ, n.position[2] + halfD);
    }
    const pad = 2;
    const worldW = (maxX - minX) + pad * 2;
    const worldH = (maxZ - minZ) + pad * 2;
    const fitScale = Math.min(MAP_W / worldW, MAP_H / worldH);
    // Calculate zoom multiplier relative to the all-nodes baseScale
    const allNodesList = Object.values(allNodes);
    if (allNodesList.length === 0) return;
    let aMinX = Infinity, aMaxX = -Infinity, aMinZ = Infinity, aMaxZ = -Infinity;
    for (const n of allNodesList) {
      const halfW = (n.width ?? DEFAULT_NODE_WIDTH) / 2;
      const halfD = (n.height ?? DEFAULT_NODE_HEIGHT) / 2;
      aMinX = Math.min(aMinX, n.position[0] - halfW);
      aMaxX = Math.max(aMaxX, n.position[0] + halfW);
      aMinZ = Math.min(aMinZ, n.position[2] - halfD);
      aMaxZ = Math.max(aMaxZ, n.position[2] + halfD);
    }
    const allW = (aMaxX - aMinX) + 6;
    const allH = (aMaxZ - aMinZ) + 6;
    const baseScale = Math.min(MAP_W / allW, MAP_H / allH);
    const targetZoom = Math.max(0.5, Math.min(5, fitScale / baseScale));

    // Smooth animated minimap zoom transition
    if (prefersReducedMotion) {
      setMinimapZoom(targetZoom);
    } else {
      const startZoom = minimapZoom;
      const duration = 300;
      const start = performance.now();
      if (navRafRef.current) cancelAnimationFrame(navRafRef.current);
      const animateZoom = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(1, elapsed / duration);
        const ease = 1 - (1 - t) * (1 - t) * (1 - t); // cubic ease-out
        setMinimapZoom(startZoom + (targetZoom - startZoom) * ease);
        if (t < 1) {
          navRafRef.current = requestAnimationFrame(animateZoom);
        } else {
          navRafRef.current = 0;
        }
      };
      navRafRef.current = requestAnimationFrame(animateZoom);
    }

    // Also fly camera to center of selection
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    flyToWorld(cx, cz);
  }, [MAP_W, MAP_H, flyToWorld, minimapZoom, prefersReducedMotion]);

  /** Start resizing the minimap via corner drag */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: minimapWidth,
      startH: minimapHeight,
    };
  }, [minimapWidth, minimapHeight]);

  // Global mouse handlers for resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      // Resize grows to the left (panel is right-anchored) and upward
      const dw = r.startX - e.clientX;
      const dh = r.startY - e.clientY;
      const newW = Math.max(120, Math.min(400, r.startW + dw));
      const newH = Math.max(100, Math.min(350, r.startH + dh));
      setMinimapSize(newW, newH);
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setMinimapSize]);

  // Connectivity mode: color nodes by connection count + store counts for tooltips
  const connectivityData = useMemo(() => {
    if (viewMode !== 'connectivity') return null;
    const counts: Record<string, number> = {};
    for (const c of Object.values(connections)) {
      counts[c.sourceNodeId] = (counts[c.sourceNodeId] ?? 0) + 1;
      counts[c.targetNodeId] = (counts[c.targetNodeId] ?? 0) + 1;
    }
    let maxCount = 1;
    for (const v of Object.values(counts)) maxCount = Math.max(maxCount, v);
    const colors: Record<string, string> = {};
    for (const node of Object.values(nodes)) {
      const count = counts[node.id] ?? 0;
      const t = count / maxCount;
      // Interpolate from red (0 connections) to teal (max connections)
      const r = Math.round(232 * (1 - t) + 46 * t);
      const g = Math.round(69 * (1 - t) + 196 * t);
      const b = Math.round(60 * (1 - t) + 182 * t);
      colors[node.id] = `rgb(${r},${g},${b})`;
    }
    return { colors, counts };
  }, [viewMode, connections, nodes]);
  const connectivityColors = connectivityData?.colors ?? null;

  /** Independent minimap zoom via mouse wheel */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setMinimapZoom(z => {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      return Math.max(0.5, Math.min(5, z * factor));
    });
  }, []);

  /** Click on minimap to navigate camera to that world position */
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Don't navigate if we just finished a viewport drag or node drag or rect select
    // dragRef is non-null between mousedown→setTimeout after mouseup, so any non-null means recent drag
    if (dragRef.current) return;
    if (nodeDragRef.current) return;
    if (rectSelectRef.current) return;
    const inner = innerRef.current;
    if (!inner) return;

    const rect = inner.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const [worldX, worldZ] = mapToWorld(px, py);
    flyToWorld(worldX, worldZ);
  }, [mapToWorld, flyToWorld]);

  /** Start dragging a node on the minimap */
  const handleNodeDragStart = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const node = nodes[nodeId];
    if (!node) return;
    // Push undo BEFORE drag starts (captures pre-move state)
    useEditorStore.getState().pushUndoSnapshot();
    nodeDragRef.current = {
      nodeId,
      startPx: e.clientX,
      startPy: e.clientY,
      startPos: [...node.position] as [number, number, number],
    };
  }, [nodes]);

  /** Rectangle selection: Shift+mousedown on minimap background */
  const handleRectSelectStart = useCallback((e: React.MouseEvent) => {
    if (!e.shiftKey) return;
    e.stopPropagation();
    e.preventDefault();
    const inner = innerRef.current;
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    rectSelectRef.current = {
      startPx: e.clientX - rect.left,
      startPy: e.clientY - rect.top,
    };
  }, []);

  /** Viewport rectangle drag-to-pan: mousedown starts drag */
  const handleViewportMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const oc = window.__orbitControls;
    if (!oc) return;
    dragRef.current = {
      dragging: true,
      startPx: e.clientX,
      startPy: e.clientY,
      startWorldX: oc.target.x,
      startWorldZ: oc.target.z,
    };
  }, []);

  // Global mouse move/up for viewport drag, node drag, and rect select.
  // Uses scaleRef to read current scale/offset without re-attaching listeners
  // on every scale/offset change.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Viewport drag
      const d = dragRef.current;
      if (d?.dragging) {
        const oc = window.__orbitControls;
        if (!oc) return;
        const dxPx = e.clientX - d.startPx;
        const dyPx = e.clientY - d.startPy;
        const curScale = scaleRef.current.scale;
        const dxWorld = dxPx / curScale;
        const dzWorld = dyPx / curScale;
        const newX = d.startWorldX + dxWorld;
        const newZ = d.startWorldZ + dzWorld;
        const camDx = newX - oc.target.x;
        const camDz = newZ - oc.target.z;
        oc.target.x = newX;
        oc.target.z = newZ;
        oc.object.position.x += camDx;
        oc.object.position.z += camDz;
        oc.update();
        window.__invalidate?.();
        return;
      }

      // Node drag on minimap
      const nd = nodeDragRef.current;
      if (nd) {
        const dxPx = e.clientX - nd.startPx;
        const dyPx = e.clientY - nd.startPy;
        const curScale = scaleRef.current.scale;
        const dxWorld = dxPx / curScale;
        const dzWorld = dyPx / curScale;
        const newPos: [number, number, number] = [
          nd.startPos[0] + dxWorld,
          nd.startPos[1],
          nd.startPos[2] + dzWorld,
        ];
        useEditorStore.getState().updateNodePosition(nd.nodeId, newPos);
        window.__invalidate?.();
        return;
      }

      // Rectangle selection
      const rs = rectSelectRef.current;
      if (rs) {
        const inner = innerRef.current;
        if (!inner) return;
        const rect = inner.getBoundingClientRect();
        const curPx = e.clientX - rect.left;
        const curPy = e.clientY - rect.top;
        setRectSelect({
          x: Math.min(rs.startPx, curPx),
          y: Math.min(rs.startPy, curPy),
          w: Math.abs(curPx - rs.startPx),
          h: Math.abs(curPy - rs.startPy),
        });
      }
    };

    const onUp = (e: MouseEvent) => {
      // Viewport drag cleanup — null out ref after clearing dragging flag
      if (dragRef.current) {
        dragRef.current.dragging = false;
        // Defer nulling so handleClick can still check dragging=false in the same event
        dragCleanupRaf.current = requestAnimationFrame(() => { dragRef.current = null; });
      }

      // Node drag cleanup (undo snapshot already pushed at drag start)
      if (nodeDragRef.current) {
        nodeDragRef.current = null;
      }

      // Rectangle selection cleanup
      if (rectSelectRef.current) {
        const rs = rectSelectRef.current;
        const inner = innerRef.current;
        if (inner) {
          const rect = inner.getBoundingClientRect();
          const endPx = e.clientX - rect.left;
          const endPy = e.clientY - rect.top;
          const x1 = Math.min(rs.startPx, endPx);
          const y1 = Math.min(rs.startPy, endPy);
          const x2 = Math.max(rs.startPx, endPx);
          const y2 = Math.max(rs.startPy, endPy);
          // Only select if dragged more than 4px
          if (x2 - x1 > 4 || y2 - y1 > 4) {
            const ids = new Set<string>();
            const { scale: s, offsetX: ox, offsetZ: oz } = scaleRef.current;
            for (const node of Object.values(useEditorStore.getState().nodes)) {
              const halfW = ((node.width ?? DEFAULT_NODE_WIDTH) * s) / 2;
              const halfD = ((node.height ?? DEFAULT_NODE_HEIGHT) * s) / 2;
              const cx = node.position[0] * s + ox;
              const cy = node.position[2] * s + oz;
              // Check if node AABB overlaps selection rect (not just center point)
              if (cx + halfW >= x1 && cx - halfW <= x2 && cy + halfD >= y1 && cy - halfD <= y2) {
                ids.add(node.id);
              }
            }
            if (ids.size > 0) {
              useEditorStore.getState().setSelection(ids);
            }
          }
        }
        rectSelectRef.current = null;
        setRectSelect(null);
      }
    };

    // Safety: if window loses focus during drag, clean up (same as mouseup)
    const onBlur = () => {
      if (dragRef.current || nodeDragRef.current || rectSelectRef.current) {
        onUp(new MouseEvent('mouseup'));
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
      cancelAnimationFrame(dragCleanupRaf.current);
      // Ensure drag refs are cleaned up on unmount to prevent stale state
      dragRef.current = null;
      nodeDragRef.current = null;
      rectSelectRef.current = null;
    };
   
  }, []);

  // Compute viewport rectangle in minimap pixel coordinates
  const viewportRect = useMemo(() => {
    if (!viewport) return null;
    const [cx, cy] = worldToMap(viewport.x, viewport.z);
    // Approximate visible world size based on camera distance
    // At distance d, with a ~50deg FOV, the visible half-width ~ d * tan(25deg) ~ d * 0.47
    const halfWorldSize = viewport.dist * 0.47;
    const rawW = halfWorldSize * 2 * scale;
    const rawH = halfWorldSize * 2 * scale;
    const w = Math.max(rawW, 8);  // minimum 8px so it's always visible
    const h = Math.max(rawH, 6);
    return {
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
    };
  }, [viewport, worldToMap, scale]);

  // Compute group bounding rectangles for minimap display
  const groupRects = useMemo(() => {
    const result: Array<{ id: string; label: string; x: number; y: number; w: number; h: number }> = [];
    for (const group of Object.values(groups)) {
      // Find all nodes in this group
      const memberNodes = Object.values(nodes).filter(n => n.groupId === group.id);
      if (memberNodes.length === 0) continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const n of memberNodes) {
        const halfW = (n.width ?? DEFAULT_NODE_WIDTH) / 2;
        const halfD = (n.height ?? DEFAULT_NODE_HEIGHT) / 2;
        minX = Math.min(minX, n.position[0] - halfW);
        maxX = Math.max(maxX, n.position[0] + halfW);
        minZ = Math.min(minZ, n.position[2] - halfD);
        maxZ = Math.max(maxZ, n.position[2] + halfD);
      }
      // Add padding around group
      const pad = 0.5;
      const [x1, y1] = worldToMap(minX - pad, minZ - pad);
      const [x2, y2] = worldToMap(maxX + pad, maxZ + pad);
      result.push({
        id: group.id,
        label: group.label,
        x: x1,
        y: y1,
        w: Math.max(x2 - x1, 4),
        h: Math.max(y2 - y1, 4),
      });
    }
    return result;
  }, [groups, nodes, worldToMap]);

  // Zoom level percentage from camera distance
  const zoomPercent = viewport ? Math.round(100 / (viewport.dist / 10)) : null;

  // Scale indicator: how many world units = ~30px on minimap
  const scaleBarWorldUnits = useMemo(() => {
    if (scale <= 0) return null;
    const targetPx = 30;
    const worldUnits = targetPx / scale;
    // Round to nice number
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100];
    let best = worldUnits;
    for (const n of nice) {
      if (Math.abs(n - worldUnits) < Math.abs(best - worldUnits)) best = n;
    }
    return { units: best, px: best * scale };
  }, [scale]);

  // Hovered node data for tooltip
  const hoveredNode = hoveredNodeId ? nodes[hoveredNodeId] : null;

  if (!minimapVisible) return null;

  return (
    <div
      className={styles.minimap}
      aria-label="Minimap navigation"
      style={{ width: minimapWidth, height: minimapHeight }}
    >
      {/* Resize handle (top-left corner — minimap is right-anchored) */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute', top: 0, left: 0, width: 12, height: 12,
          cursor: 'nwse-resize', zIndex: 20,
        }}
        title="Drag to resize minimap"
      >
        <svg width={10} height={10} style={{ position: 'absolute', top: 2, left: 2, opacity: 0.3 }}>
          <line x1={0} y1={8} x2={8} y2={0} stroke="var(--text-faint)" strokeWidth={1} />
          <line x1={3} y1={8} x2={8} y2={3} stroke="var(--text-faint)" strokeWidth={1} />
          <line x1={6} y1={8} x2={8} y2={6} stroke="var(--text-faint)" strokeWidth={1} />
        </svg>
      </div>
      <div className={styles.minimapLabel} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span>Minimap</span>
        {zoomPercent !== null && (
          <span style={{ opacity: 0.5, fontSize: 7, fontFamily: "'JetBrains Mono', monospace" }}>
            {zoomPercent}%
          </span>
        )}
        <span style={{ flex: 1 }} />
        {/* Zoom to selection */}
        {selectedIds.size > 0 && (
          <button
            onClick={zoomToSelection}
            title="Zoom to selection"
            style={{
              padding: '0 3px', fontSize: 7, background: 'none', border: 'none',
              color: 'var(--teal)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            sel
          </button>
        )}
        {/* Legend toggle */}
        <button
          onClick={() => setShowLegend(l => !l)}
          title="Toggle legend"
          style={{
            padding: '0 3px', fontSize: 7, background: 'none', border: 'none',
            color: showLegend ? 'var(--teal)' : 'var(--text-faint)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          leg
        </button>
        {/* View mode toggle */}
        <button
          onClick={() => setViewMode(m => m === 'position' ? 'connectivity' : 'position')}
          title={`View: ${viewMode}`}
          style={{
            padding: '0 3px', fontSize: 7, background: 'none', border: 'none',
            color: viewMode === 'connectivity' ? 'var(--teal)' : 'var(--text-faint)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {viewMode === 'position' ? 'pos' : 'conn'}
        </button>
        {/* Minimap zoom reset */}
        {minimapZoom !== 1 && (
          <button
            onClick={() => setMinimapZoom(1)}
            title="Reset minimap zoom"
            style={{
              padding: '0 3px', fontSize: 7, background: 'none', border: 'none',
              color: 'var(--text-faint)', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {Math.round(minimapZoom * 100)}%
          </button>
        )}
      </div>
      <div
        ref={innerRef}
        style={{ position: 'relative', width: MAP_W, height: MAP_H, margin: '22px 8px 6px', cursor: 'crosshair', overflow: 'hidden' }}
        onClick={handleClick}
        onWheel={handleWheel}
        onMouseDown={handleRectSelectStart}
      >
        {/* Connection lines, group rectangles, and viewport rectangle */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          {/* Group boundary rectangles (skip in dots-only mode for >500 nodes) */}
          {!dotsOnly && groupRects.map(gr => (
            <rect
              key={gr.id}
              x={gr.x}
              y={gr.y}
              width={gr.w}
              height={gr.h}
              fill={GROUP_COLOR}
              stroke={GROUP_STROKE}
              strokeWidth={0.5}
              rx={2}
            />
          ))}
          {/* Connection lines (skip for >200 nodes to maintain performance) */}
          {!skipConnections && throttledConns.map(conn => {
            const src = nodes[conn.sourceNodeId];
            const tgt = nodes[conn.targetNodeId];
            if (!src || !tgt) return null;
            const [x1, y1] = worldToMap(src.position[0], src.position[2]);
            const [x2, y2] = worldToMap(tgt.position[0], tgt.position[2]);
            return (
              <line
                key={conn.id}
                x1={x1} y1={y1}
                x2={x2} y2={y2}
                stroke="var(--text-faint)"
                strokeWidth={1}
              />
            );
          })}
          {/* Viewport rectangle — draggable to pan camera */}
          {viewportRect && (
            <rect
              x={viewportRect.x}
              y={viewportRect.y}
              width={viewportRect.w}
              height={viewportRect.h}
              fill="color-mix(in srgb, var(--teal) 8%, transparent)"
              stroke="color-mix(in srgb, var(--teal) 45%, transparent)"
              strokeWidth={1}
              rx={2}
              style={{ pointerEvents: 'all', cursor: 'grab' }}
              onMouseDown={handleViewportMouseDown}
            />
          )}
          {/* Scale indicator bar */}
          {scaleBarWorldUnits && (
            <g transform={`translate(${MAP_W - scaleBarWorldUnits.px - 4}, ${MAP_H - 8})`}>
              <line x1={0} y1={0} x2={scaleBarWorldUnits.px} y2={0} stroke="var(--text-faint)" strokeWidth={1} />
              <line x1={0} y1={-2} x2={0} y2={2} stroke="var(--text-faint)" strokeWidth={1} />
              <line x1={scaleBarWorldUnits.px} y1={-2} x2={scaleBarWorldUnits.px} y2={2} stroke="var(--text-faint)" strokeWidth={1} />
              <text
                x={scaleBarWorldUnits.px / 2}
                y={-3}
                textAnchor="middle"
                fill="var(--text-faint)"
                fontSize={6}
                fontFamily="'JetBrains Mono', monospace"
              >
                {scaleBarWorldUnits.units}u
              </text>
            </g>
          )}
        </svg>

        {/* Node rectangles — proportional to actual node dimensions in world space */}
        {throttledNodes.map(node => {
          const [cx, cy] = worldToMap(node.position[0], node.position[2]);
          const isSel = selectedIds.has(node.id);
          const color = isSel ? 'var(--text-bright)'
            : connectivityColors ? (connectivityColors[node.id] ?? 'var(--text-dim)')
            : getNodeColor(node.type);
          // Compute pixel dimensions from world-space node size
          const nw = (node.width ?? DEFAULT_NODE_WIDTH) * scale;
          const nd = (node.height ?? DEFAULT_NODE_HEIGHT) * scale;
          // Enforce minimum visible size (at least 4×4 for dotsOnly, 6×4 otherwise)
          const minW = dotsOnly ? 4 : 6;
          const minH = dotsOnly ? 4 : 4;
          const pw = Math.max(minW, Math.round(nw));
          const ph = Math.max(minH, Math.round(nd));
          if (dotsOnly) {
            // Simplified rendering for very large graphs (>500 nodes)
            return (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  left: cx - pw / 2,
                  top: cy - ph / 2,
                  width: pw,
                  height: ph,
                  borderRadius: 2,
                  background: color,
                  opacity: isSel ? 0.9 : 0.5,
                  pointerEvents: 'none',
                }}
              />
            );
          }
          return (
            <div
              key={node.id}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(prev => prev === node.id ? null : prev)}
              onMouseDown={e => handleNodeDragStart(node.id, e)}
              style={{
                position: 'absolute',
                left: cx - pw / 2,
                top: cy - ph / 2,
                width: pw,
                height: ph,
                borderRadius: 2,
                background: color,
                opacity: isSel ? 0.95 : 0.6,
                transition: prefersReducedMotion ? 'none' : 'opacity 0.1s',
                pointerEvents: 'auto',
                cursor: 'grab',
              }}
            />
          );
        })}

        {/* Rectangle selection overlay */}
        {rectSelect && (
          <div
            style={{
              position: 'absolute',
              left: rectSelect.x,
              top: rectSelect.y,
              width: rectSelect.w,
              height: rectSelect.h,
              border: '1px dashed var(--teal)',
              background: 'color-mix(in srgb, var(--teal) 15%, transparent)',
              pointerEvents: 'none',
              zIndex: 5,
            }}
          />
        )}

        {/* Hover label tooltip (shows connection count in connectivity mode, hidden in dots-only mode) */}
        {!dotsOnly && hoveredNode && (
          <div
            style={{
              position: 'absolute',
              left: worldToMap(hoveredNode.position[0], hoveredNode.position[2])[0] + 6,
              top: worldToMap(hoveredNode.position[0], hoveredNode.position[2])[1] - 12,
              background: 'var(--panel-bg)',
              border: '1px solid var(--panel-border)',
              borderRadius: 3,
              padding: '1px 4px',
              fontSize: 7,
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 10,
              maxWidth: 120,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {hoveredNode.title}
            {connectivityData && (
              <span style={{ color: 'var(--text-faint)', marginLeft: 3 }}>
                ({connectivityData.counts[hoveredNode.id] ?? 0} conn)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Legend panel (below the inner area) */}
      {showLegend && (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 6,
          padding: '2px 8px 4px', flexWrap: 'wrap',
        }}>
          {viewMode === 'position' ? (
            LEGEND_ENTRIES.map(e => (
              <div key={e.label} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <div style={{ width: 6, height: 4, borderRadius: 1, background: e.color, opacity: 0.8 }} />
                <span style={{ fontSize: 6, color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {e.label}
                </span>
              </div>
            ))
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 6, color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>few</span>
              <div style={{
                width: 30, height: 4, borderRadius: 1,
                background: 'linear-gradient(to right, rgb(232,69,60), rgb(46,196,182))',
              }} />
              <span style={{ fontSize: 6, color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>many</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
