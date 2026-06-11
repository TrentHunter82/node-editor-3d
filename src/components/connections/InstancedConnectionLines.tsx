/**
 * InstancedConnectionLines — all far-LOD connections in ONE draw call.
 *
 * Each `Pipe` costs 1–3 Line2 objects (own geometry/material/draw call), a
 * tube hit-mesh, and ~15 store subscriptions; at the 1000-node target the
 * far connections dominate. ConnectionGraph classifies connections per frame
 * ('full' | 'lod' | 'culled'); Pipes render only 'full', and this component
 * batches every 'lod' connection into a single LineSegments buffer with
 * vertex colors (sampled from the same bezier math via connectionGeometry).
 *
 * Entirely imperative: reads store state via getState() inside useFrame —
 * zero React subscriptions, rebuilds only on invalidated frames (demand
 * frameloop), and grows its buffers geometrically.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getPortWorldPos } from '../../utils/portPositions';
import { computeControlPoints, writeBezierSegments } from '../../utils/connectionGeometry';
import { PORT_TYPE_COLORS } from '../../types';
import type { ConnectionLOD } from './ConnectionGraph';

/** Curve segments per far connection (visual fidelity vs. vertex count) */
const SEGMENTS = 8;
const FLOATS_PER_CONN = SEGMENTS * 2 * 3;

const NO_RAYCAST = () => {};

// Cached, white-blended THREE.Color per hex (matches Pipe's blendWithWhite)
const _colorCache = new Map<string, THREE.Color>();
const _white = new THREE.Color('#ffffff');
function lodColor(hex: string): THREE.Color {
  let c = _colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex).lerp(_white, 0.4);
    _colorCache.set(hex, c);
  }
  return c;
}

interface InstancedConnectionLinesProps {
  /** Per-frame LOD classification map owned by ConnectionGraph */
  lodMapRef: React.RefObject<Map<string, ConnectionLOD>>;
}

export const InstancedConnectionLines = memo(function InstancedConnectionLines({ lodMapRef }: InstancedConnectionLinesProps) {
  const lineRef = useRef<THREE.LineSegments>(null);

  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    // Start with room for 256 connections; grows geometrically below
    const capacity = 256 * FLOATS_PER_CONN;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    return { geometry, material };
  }, []);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(() => {
    const line = lineRef.current;
    const lodMap = lodMapRef.current;
    if (!line || !lodMap) return;

    const state = useEditorStore.getState();
    const { nodes, connections } = state;
    const style = useSettingsStore.getState().connectionStyle;

    // Count 'lod' connections to size the buffers
    let lodCount = 0;
    for (const lod of lodMap.values()) {
      if (lod === 'lod') lodCount++;
    }
    if (lodCount === 0) {
      line.geometry.setDrawRange(0, 0);
      line.visible = false;
      return;
    }
    line.visible = true;

    let posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    let colAttr = line.geometry.getAttribute('color') as THREE.BufferAttribute;
    const needed = lodCount * FLOATS_PER_CONN;
    if (posAttr.array.length < needed) {
      let capacity = posAttr.array.length;
      while (capacity < needed) capacity *= 2;
      posAttr = new THREE.BufferAttribute(new Float32Array(capacity), 3);
      colAttr = new THREE.BufferAttribute(new Float32Array(capacity), 3);
      line.geometry.setAttribute('position', posAttr);
      line.geometry.setAttribute('color', colAttr);
    }
    const positions = posAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;

    let offset = 0;
    for (const [connId, lod] of lodMap) {
      if (lod !== 'lod') continue;
      const conn = connections[connId];
      if (!conn) continue;
      const src = nodes[conn.sourceNodeId];
      const tgt = nodes[conn.targetNodeId];
      if (!src || !tgt) continue;

      const start = getPortWorldPos(src.position, 'output', conn.sourcePortIndex, src.outputs.length, src.width, src.height);
      const end = getPortWorldPos(tgt.position, 'input', conn.targetPortIndex, tgt.inputs.length, tgt.width, tgt.height);
      const { midA, midB } = computeControlPoints(start, end, conn.styleOverride ?? style);

      const colorStart = offset;
      offset = writeBezierSegments(positions, offset, start, midA, midB, end, SEGMENTS);

      // Per-connection color: override or white-blended port-type color
      const portType = src.outputs[conn.sourcePortIndex]?.portType ?? 'any';
      const c = conn.colorOverride
        ? lodColor(conn.colorOverride)
        : lodColor(PORT_TYPE_COLORS[portType] ?? PORT_TYPE_COLORS.any);
      for (let i = colorStart; i < offset; i += 3) {
        colors[i] = c.r;
        colors[i + 1] = c.g;
        colors[i + 2] = c.b;
      }
    }

    line.geometry.setDrawRange(0, offset / 3);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  });

  return (
    <lineSegments
      ref={lineRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    />
  );
});
