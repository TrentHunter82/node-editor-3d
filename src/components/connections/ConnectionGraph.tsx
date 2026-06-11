import { memo, useMemo, useRef, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { Pipe } from './Pipe';
import { PendingPipe } from './PendingPipe';
import { InstancedConnectionLines } from './InstancedConnectionLines';
import { getUpstreamPath, getDownstreamPath } from '../../utils/profiling';
import type { Connection } from '../../types';

// Reusable objects for frustum culling (no per-frame allocations)
const _frustum = new THREE.Frustum();
const _projMatrix = new THREE.Matrix4();
const _midpoint = new THREE.Vector3();
const _endpointTest = new THREE.Vector3();

/** Distance (squared) beyond which connections switch to LOD rendering */
const CONNECTION_LOD_DISTANCE_SQ = 18 * 18;

export type ConnectionLOD = 'full' | 'lod' | 'culled';

/** A bundled group of parallel connections between the same node pair. */
interface ConnectionBundle {
  key: string; // "srcId→tgtId"
  representative: Connection; // first connection (used for rendering)
  count: number;
  midpoint: [number, number, number];
}

export const ConnectionGraph = memo(function ConnectionGraph() {
  const connections = useEditorStore(s => s.connections);
  const nodes = useEditorStore(s => s.nodes);
  const traceNodeId = useEditorStore(s => s.traceNodeId);
  const overviewMode = useSettingsStore(s => s.overviewMode);
  const connList = useMemo(() => Object.values(connections), [connections]);
  const { camera } = useThree();

  // Per-connection LOD map, updated every frame
  const connLodMap = useRef<Map<string, ConnectionLOD>>(new Map());

  const groups = useEditorStore(s => s.groups);

  const getConnectionLOD = useCallback((connId: string): ConnectionLOD => {
    return connLodMap.current.get(connId) ?? 'full';
  }, []);

  // Compute the set of node IDs involved in the trace path
  const traceNodeSet = useMemo(() => {
    if (!traceNodeId || !nodes[traceNodeId]) return null;
    const upstream = getUpstreamPath(traceNodeId, nodes, connections);
    const downstream = getDownstreamPath(traceNodeId, nodes, connections);
    const all = new Set([traceNodeId, ...upstream, ...downstream]);
    return all;
  }, [traceNodeId, nodes, connections]);

  // In overview mode, bundle parallel connections between the same node pairs
  const bundles = useMemo((): ConnectionBundle[] | null => {
    if (!overviewMode) return null;
    const bundleMap = new Map<string, { conns: Connection[]; count: number }>();
    for (const conn of connList) {
      // Use sorted pair to group bidirectional connections
      const key = conn.sourceNodeId < conn.targetNodeId
        ? `${conn.sourceNodeId}→${conn.targetNodeId}`
        : `${conn.targetNodeId}→${conn.sourceNodeId}`;
      const existing = bundleMap.get(key);
      if (existing) {
        existing.conns.push(conn);
        existing.count++;
      } else {
        bundleMap.set(key, { conns: [conn], count: 1 });
      }
    }
    const result: ConnectionBundle[] = [];
    for (const [key, { conns, count }] of bundleMap) {
      if (count <= 1) continue; // Only bundle groups of 2+
      const src = nodes[conns[0].sourceNodeId];
      const tgt = nodes[conns[0].targetNodeId];
      if (!src || !tgt) continue;
      result.push({
        key,
        representative: conns[0],
        count,
        midpoint: [
          (src.position[0] + tgt.position[0]) * 0.5,
          (src.position[1] + tgt.position[1]) * 0.5 + 0.35,
          (src.position[2] + tgt.position[2]) * 0.5,
        ],
      });
    }
    return result;
  }, [overviewMode, connList, nodes]);

  // In overview mode, the set of connection IDs that are part of a bundle (2+ parallel)
  const bundledConnIds = useMemo(() => {
    if (!bundles) return null;
    const set = new Set<string>();
    // Rebuild from connList to find all conns that share a node-pair
    const pairCount = new Map<string, string[]>();
    for (const conn of connList) {
      const key = conn.sourceNodeId < conn.targetNodeId
        ? `${conn.sourceNodeId}→${conn.targetNodeId}`
        : `${conn.targetNodeId}→${conn.sourceNodeId}`;
      const ids = pairCount.get(key) ?? [];
      ids.push(conn.id);
      pairCount.set(key, ids);
    }
    for (const ids of pairCount.values()) {
      if (ids.length >= 2) {
        for (const id of ids) set.add(id);
      }
    }
    return set;
  }, [bundles, connList]);

  // Bundle representatives stay individually rendered (the badge needs them)
  const bundleRepresentativeIds = useMemo(() => {
    if (!bundles) return null;
    return new Set(bundles.map(b => b.representative.id));
  }, [bundles]);

  useFrame(() => {
    _projMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projMatrix);

    const map = connLodMap.current;
    const camPos = camera.position;
    // Interactive state read imperatively — classification runs per frame,
    // subscriptions here would defeat the purpose
    const st = useEditorStore.getState();
    const { selectedIds, hoveredConnectionId, isExecuting, executionStates } = st;

    for (const conn of connList) {
      // Bundled (non-representative) connections are not rendered at all
      if (bundledConnIds && bundledConnIds.has(conn.id) && !bundleRepresentativeIds?.has(conn.id)) {
        map.set(conn.id, 'culled');
        continue;
      }

      const src = nodes[conn.sourceNodeId];
      const tgt = nodes[conn.targetNodeId];

      // If either endpoint node is missing, cull
      if (!src || !tgt) {
        map.set(conn.id, 'culled');
        continue;
      }

      // Hide connections where both endpoints are in the same collapsed group
      if (src.groupId && src.groupId === tgt.groupId && groups[src.groupId]?.collapsed) {
        map.set(conn.id, 'culled');
        continue;
      }

      // Hide connections where either endpoint is in a collapsed group
      // (boundary connections would need rerouting, which is complex — for now hide them)
      if ((src.groupId && groups[src.groupId]?.collapsed) ||
          (tgt.groupId && groups[tgt.groupId]?.collapsed)) {
        map.set(conn.id, 'culled');
        continue;
      }

      // Compute midpoint of the connection for frustum/distance checks
      _midpoint.set(
        (src.position[0] + tgt.position[0]) * 0.5,
        (src.position[1] + tgt.position[1]) * 0.5,
        (src.position[2] + tgt.position[2]) * 0.5,
      );

      // Frustum cull: if midpoint is outside camera frustum, cull
      // (conservative — long connections may still be visible, but midpoint
      // is a good enough heuristic for typical node graphs)
      if (!_frustum.containsPoint(_midpoint)) {
        // Also check both endpoints before culling, in case the connection
        // spans across the viewport. Use separate vector to preserve midpoint.
        _endpointTest.set(src.position[0], src.position[1], src.position[2]);
        const srcVisible = _frustum.containsPoint(_endpointTest);
        _endpointTest.set(tgt.position[0], tgt.position[1], tgt.position[2]);
        const tgtVisible = _frustum.containsPoint(_endpointTest);

        if (!srcVisible && !tgtVisible) {
          map.set(conn.id, 'culled');
          continue;
        }
      }

      // Distance-based LOD: midpoint is still valid (not overwritten by endpoint checks)
      const dx = _midpoint.x - camPos.x;
      const dy = _midpoint.y - camPos.y;
      const dz = _midpoint.z - camPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= CONNECTION_LOD_DISTANCE_SQ) {
        map.set(conn.id, 'full');
        continue;
      }

      // Far connections render via InstancedConnectionLines — but anything
      // the user is interacting with (or that carries extra visuals: labels,
      // trace highlight, execution pulse) keeps its full Pipe.
      const srcExec = executionStates[conn.sourceNodeId];
      const forceFull =
        selectedIds.has(conn.id) ||
        hoveredConnectionId === conn.id ||
        conn.label !== undefined ||
        (selectedIds.has(conn.sourceNodeId) && selectedIds.has(conn.targetNodeId)) ||
        (traceNodeSet !== null && traceNodeSet.has(conn.sourceNodeId) && traceNodeSet.has(conn.targetNodeId)) ||
        (isExecuting && (srcExec === 'running' || srcExec === 'complete' || srcExec === 'error'));
      map.set(conn.id, forceFull ? 'full' : 'lod');
    }

    // Clean up stale entries
    for (const id of map.keys()) {
      if (!connections[id]) {
        map.delete(id);
      }
    }
  });

  return (
    <group>
      {connList.map(conn => {
        // In overview mode, skip bundled connections (rendered as single thick line + badge)
        if (bundledConnIds && bundledConnIds.has(conn.id)) return null;
        return (
          <Pipe
            key={conn.id}
            connection={conn}
            isTraced={traceNodeSet !== null &&
              traceNodeSet.has(conn.sourceNodeId) &&
              traceNodeSet.has(conn.targetNodeId)}
            getConnectionLOD={getConnectionLOD}
          />
        );
      })}
      {/* Bundled connections in overview mode: render representative + count badge */}
      {bundles && bundles.map(bundle => (
        <group key={bundle.key}>
          <Pipe
            connection={bundle.representative}
            isTraced={traceNodeSet !== null &&
              traceNodeSet.has(bundle.representative.sourceNodeId) &&
              traceNodeSet.has(bundle.representative.targetNodeId)}
            getConnectionLOD={getConnectionLOD}
          />
          {/* Count badge at midpoint */}
          <Html
            position={bundle.midpoint}
            center
            zIndexRange={[50, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: 'var(--panel-bg-solid, #1a1a2e)',
              border: '1px solid var(--panel-border, #333)',
              color: 'var(--text-bright, #fff)',
              fontSize: 9,
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700,
              padding: '0 4px',
              boxShadow: '0 1px 4px var(--shadow)',
            }}>
              {bundle.count}
            </span>
          </Html>
        </group>
      ))}
      {/* All far-LOD connections batched into one LineSegments draw call */}
      <InstancedConnectionLines lodMapRef={connLodMap} />
      <PendingPipe />
    </group>
  );
});
