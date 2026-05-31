import { useCallback, useEffect, useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useSettingsStore } from '../store/settingsStore';
import { NodeModule } from './nodes/NodeModule';
import { NodeLOD } from './nodes/NodeLOD';
import { InstancedPorts } from './nodes/InstancedPorts';
import { GroupBoundingBox } from './nodes/GroupBoundingBox';
import { ValuePreview } from './nodes/ValuePreview';
import { useNodeDrag } from '../hooks/useNodeDrag';
import { useViewportCulling, type LODLevel } from '../hooks/useViewportCulling';
import { getUpstreamPath, getDownstreamPath } from '../utils/profiling';

export function NodeGraph() {
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const groups = useEditorStore(s => s.groups);
  const selectedIds = useEditorStore(s => s.selectedIds);
  const searchHighlightIds = useEditorStore(s => s.searchHighlightIds);
  const diffHighlightIds = useEditorStore(s => s.diffHighlightIds);
  const setSelection = useEditorStore(s => s.setSelection);
  const traceNodeId = useEditorStore(s => s.traceNodeId);
  const overviewMode = useSettingsStore(s => s.overviewMode);
  const { startDrag, onDrag, endDrag, isDragging } = useNodeDrag();
  // cullingEpoch triggers re-renders when node visibility changes,
  // keeping React in sync with the useFrame LOD updates.
  const { getLOD: getRawLOD, cullingEpoch: _cullingEpoch } = useViewportCulling(nodes);

  // In overview mode, force all visible nodes to 'lod' (no full detail, no culling)
  const getLOD = useCallback((nodeId: string): LODLevel => {
    if (overviewMode) return 'lod';
    return getRawLOD(nodeId);
  }, [overviewMode, getRawLOD]);

  // Compute trace highlight sets once for all nodes
  const traceHighlight = useMemo(() => {
    if (!traceNodeId || !nodes[traceNodeId]) return null;
    const upstream = new Set(getUpstreamPath(traceNodeId, nodes, connections));
    const downstream = new Set(getDownstreamPath(traceNodeId, nodes, connections));
    return { upstream, downstream, traceNodeId };
  }, [traceNodeId, nodes, connections]);

  const handleSelect = useCallback((id: string, e: PointerEvent | MouseEvent) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      useEditorStore.getState().toggleSelection(id);
    } else if (isCtrl) {
      // Ctrl+click: add to selection (for Ctrl+drag duplicate)
      // preserves existing multi-selection
      const current = useEditorStore.getState().selectedIds;
      if (!current.has(id)) {
        setSelection(new Set([...current, id]));
      }
    } else {
      setSelection(new Set([id]));
    }
    startDrag(id, e.clientX, e.clientY, (e as PointerEvent).pointerId, isCtrl);
  }, [setSelection, startDrag]);

  useEffect(() => {
    // Listen on window (not canvas) so pointerup/cancel fire even when
    // the cursor leaves the canvas during a drag — prevents stuck state
    const handleMove = (e: PointerEvent) => {
      if (isDragging()) {
        onDrag(e.clientX, e.clientY);
      }
    };

    // Only end drag on left-button (button 0) release. Right and middle
    // buttons are used for OrbitControls pan/orbit and should not interfere
    // with an ongoing node drag.
    const handleUp = (e: PointerEvent) => {
      if (e.button === 0) {
        endDrag();
      }
    };

    // pointercancel: browser interrupted the pointer — always end drag
    const handleCancel = () => {
      endDrag();
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    // Safety: if pointer capture is lost (e.g. browser interrupts), end drag
    const canvas = document.querySelector('canvas');
    const handleLostCapture = () => {
      if (isDragging()) endDrag();
    };
    canvas?.addEventListener('lostpointercapture', handleLostCapture);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      canvas?.removeEventListener('lostpointercapture', handleLostCapture);
    };
  }, [isDragging, onDrag, endDrag]);

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);

  // Set of node IDs hidden by collapsed groups
  const collapsedGroupNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of Object.values(groups)) {
      if (!g.collapsed) continue;
      for (const n of Object.values(nodes)) {
        if (n.groupId === g.id) set.add(n.id);
      }
    }
    return set;
  }, [groups, nodes]);

  const groupIds = useMemo(() => Object.keys(groups), [groups]);

  return (
    <group>
      {/* Batched instanced rendering for all port spheres + type rings (2 draw calls) */}
      <InstancedPorts getLOD={getLOD} collapsedGroupNodeIds={collapsedGroupNodeIds} />
      {groupIds.map(gid => (
        <GroupBoundingBox key={gid} groupId={gid} />
      ))}
      {nodeList.map(node => {
        // Skip nodes in collapsed groups
        if (collapsedGroupNodeIds.has(node.id)) return null;
        const lod = getLOD(node.id);
        if (lod === 'culled') return null;
        if (lod === 'lod') {
          return (
            <NodeLOD
              key={node.id}
              node={node}
              selected={selectedIds.has(node.id)}
              onSelect={handleSelect}
              showLabel={overviewMode}
            />
          );
        }
        return (
          <group key={node.id}>
            <NodeModule
              node={node}
              selected={selectedIds.has(node.id)}
              onSelect={handleSelect}
              traceHighlight={
                traceHighlight
                  ? node.id === traceHighlight.traceNodeId ? 'traced'
                  : traceHighlight.upstream.has(node.id) ? 'upstream'
                  : traceHighlight.downstream.has(node.id) ? 'downstream'
                  : undefined
                  : undefined
              }
              searchHighlight={searchHighlightIds.has(node.id)}
              diffHighlight={diffHighlightIds.get(node.id)}
            />
            <ValuePreview nodeId={node.id} position={node.position} />
          </group>
        );
      })}
    </group>
  );
}
