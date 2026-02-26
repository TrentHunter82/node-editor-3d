import { memo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '../../store/editorStore';
import { useMatcap } from '../../hooks/useMatcap';
import { PORT_TYPE_COLORS, isPortTypeCompatible } from '../../types';
import type { PortType } from '../../types';
import type { EditorNode, Connection, InteractionMode, PendingConnection } from '../../types';
import type { LODLevel } from '../../hooks/useViewportCulling';
import { hasCoercion } from '../../utils/typeCoercions';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '../../store/slices/nodeSlice';

// Max instance count - generous to avoid reallocation
const MAX_PORTS = 2000;

// Shared geometries (same specs as Port.tsx)
const INST_SPHERE_GEO = new THREE.SphereGeometry(0.08, 16, 16);
const INST_TORUS_GEO = new THREE.TorusGeometry(0.1, 0.012, 8, 24);

// Module-scoped reusable objects for hot path (no allocations in useFrame)
const _obj = new THREE.Object3D();
const _color = new THREE.Color();
// Reusable Set for connected input lookup — avoids new Set() allocation every frame
const _connectedInputs = new Set<string>();

// Pre-compute the torus rotation quaternion once (90deg around Z, matching Port.tsx)
const _torusQuat = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, 0, Math.PI / 2)
);

/**
 * Compute the local X position of a port on a node.
 */
function getPortLocalX(isInput: boolean, nodeW: number): number {
  return isInput ? -nodeW / 2 - 0.05 : nodeW / 2 + 0.05;
}

/**
 * Compute the local Z position of a port given its index and total count.
 */
function getPortLocalZ(index: number, count: number, nodeD: number): number {
  if (count <= 1) return 0;
  return (index / (count - 1) - 0.5) * (nodeD - 0.2);
}

/**
 * InstancedPorts renders all port spheres and type indicator rings across
 * all visible, non-collapsed nodes using just 2 InstancedMesh draw calls.
 *
 * Individual Port.tsx components still handle interaction (invisible hit sphere,
 * snap/pulse rings, tooltips). This component replaces only the VISUAL meshes
 * that were previously rendered per-port.
 */
export const InstancedPorts = memo(function InstancedPorts({ getLOD, collapsedGroupNodeIds }: { getLOD: (nodeId: string) => LODLevel; collapsedGroupNodeIds?: Set<string> }) {
  const sphereRef = useRef<THREE.InstancedMesh>(null);
  const torusRef = useRef<THREE.InstancedMesh>(null);

  // Matcap texture for port spheres (dark chrome, same as Port.tsx default)
  const matcapDark = useMatcap('chrome-dark');

  // Track previous instance count so we can zero out stale entries
  const prevCountRef = useRef<number>(0);

  // Track compatible port instance indices and their base positions for pulsing animation
  const compatibleIndicesRef = useRef<number[]>([]);
  const compatiblePositionsRef = useRef<[number, number, number][]>([]);

  // --- Dirty flag: skip per-frame matrix/color rebuild when nothing changed ---
  // Track Zustand state references (immer structural sharing ensures same ref = same data)
  const prevNodesRef = useRef<Record<string, EditorNode> | null>(null);
  const prevConnectionsRef = useRef<Record<string, Connection> | null>(null);
  const prevInteractionRef = useRef<InteractionMode | null>(null);
  const prevPendingRef = useRef<PendingConnection | null>(null);
  // Track React re-renders (captures prop changes like getLOD/collapsedGroupNodeIds
  // which change when viewport culling epoch bumps or groups collapse)
  const renderVersionRef = useRef(0);
  const prevRenderVersionRef = useRef(-1);
  renderVersionRef.current += 1;

  // Initialize instanceColor buffer on the torus mesh once mounted.
  // Three.js InstancedMesh picks up instanceColor automatically once it exists.
  useEffect(() => {
    const torusMesh = torusRef.current;
    if (!torusMesh) return;
    // Calling setColorAt triggers internal creation of the instanceColor buffer
    _color.set('#888888');
    for (let i = 0; i < MAX_PORTS; i++) {
      torusMesh.setColorAt(i, _color);
    }
    if (torusMesh.instanceColor) {
      torusMesh.instanceColor.needsUpdate = true;
    }
  }, []);

  useFrame(({ clock }) => {
    const sphereMesh = sphereRef.current;
    const torusMesh = torusRef.current;
    if (!sphereMesh || !torusMesh) return;

    const state = useEditorStore.getState();
    const { nodes, connections, interaction, pendingConnection } = state;

    const isDrawing = interaction === 'drawing-connection';

    // Dirty check: skip expensive matrix/color rebuild when nothing port-relevant changed.
    // This saves ~1-5ms per frame during camera orbit/damping, idle animations, and
    // non-visual store updates where ports don't need updating.
    const storeChanged =
      nodes !== prevNodesRef.current ||
      connections !== prevConnectionsRef.current ||
      interaction !== prevInteractionRef.current ||
      pendingConnection !== prevPendingRef.current;
    const propsChanged = renderVersionRef.current !== prevRenderVersionRef.current;

    const needsFullRebuild = storeChanged || propsChanged;

    if (needsFullRebuild) {
      prevNodesRef.current = nodes;
      prevConnectionsRef.current = connections;
      prevInteractionRef.current = interaction;
      prevPendingRef.current = pendingConnection;
      prevRenderVersionRef.current = renderVersionRef.current;

      const sourceNodeId = pendingConnection?.sourceNodeId;

      // Get source port type for compatibility checking during connection drawing
      let sourcePortType: PortType | null = null;
      if (isDrawing && sourceNodeId && pendingConnection) {
        const sourceNode = nodes[sourceNodeId];
        if (sourceNode) {
          const srcPort = sourceNode.outputs[pendingConnection.sourcePortIndex];
          sourcePortType = srcPort?.portType ?? 'any';
        }
      }

      // Build connection lookup for unconnected input detection (only when idle)
      // Reuse module-scoped Set to avoid per-frame allocation at 60fps
      _connectedInputs.clear();
      if (!isDrawing) {
        for (const connId in connections) {
          const c = connections[connId];
          _connectedInputs.add(`${c.targetNodeId}:${c.targetPortIndex}`);
        }
      }

      // Reset compatible port tracking for pulsing
      const compatIndices: number[] = [];
      const compatPositions: [number, number, number][] = [];

      const nodeKeys = Object.keys(nodes);
      let idx = 0;

      for (let n = 0; n < nodeKeys.length; n++) {
        const nodeId = nodeKeys[n];
        const node = nodes[nodeId];

        // Skip culled and LOD nodes (LOD nodes don't render ports)
        const lod = getLOD(nodeId);
        if (lod === 'culled' || lod === 'lod') continue;

        // Skip collapsed nodes (ports are hidden when collapsed)
        if (node.collapsed) continue;

        // Skip nodes in collapsed groups
        if (collapsedGroupNodeIds?.has(nodeId)) continue;

        const [nx, ny, nz] = node.position;
        const nw = node.width ?? DEFAULT_NODE_WIDTH;
        const nd = node.height ?? DEFAULT_NODE_HEIGHT;

        // --- Input ports ---
        const inputCount = node.inputs.length;
        for (let i = 0; i < inputCount; i++) {
          if (idx >= MAX_PORTS) break;

          const portDef = node.inputs[i];
          const portType: PortType = portDef.portType ?? 'any';

          const localX = getPortLocalX(true, nw);
          const localZ = getPortLocalZ(i, inputCount, nd);
          const wx = nx + localX;
          const wy = ny;
          const wz = nz + localZ;

          const isSelfPort = isDrawing && sourceNodeId === nodeId;
          // Check type compatibility when drawing a connection
          const isTypeCompatible = sourcePortType !== null
            ? isPortTypeCompatible(sourcePortType, portType) || hasCoercion(sourcePortType, portType)
            : false;
          const isValidTarget = isDrawing && !isSelfPort && isTypeCompatible;
          const isIncompatibleTarget = isDrawing && !isSelfPort && !isTypeCompatible;
          const isDimmed = isDrawing && (isSelfPort || isIncompatibleTarget);
          const isUnconnectedInput = !isDrawing && _connectedInputs.size > 0
            && !_connectedInputs.has(`${nodeId}:${i}`);

          // Compatible targets scale up slightly for emphasis, incompatible shrink
          const scale = isDimmed ? 0.5 : isValidTarget ? 1.25 : 1;

          // Sphere instance
          _obj.position.set(wx, wy, wz);
          _obj.rotation.set(0, 0, 0);
          _obj.scale.setScalar(scale);
          _obj.updateMatrix();
          sphereMesh.setMatrixAt(idx, _obj.matrix);

          // Torus instance (rotated 90deg around Z)
          _obj.quaternion.copy(_torusQuat);
          _obj.updateMatrix();
          torusMesh.setMatrixAt(idx, _obj.matrix);

          // Torus color: compatible targets glow by port type, incompatible dim
          let ringColor: string;
          if (isValidTarget) {
            ringColor = PORT_TYPE_COLORS[portType] ?? '#44DD88';
          } else if (isIncompatibleTarget) {
            // Darker gray for stronger dimming (~30% visual prominence)
            ringColor = '#333333';
          } else if (isUnconnectedInput) {
            ringColor = '#E8453C';
          } else {
            ringColor = PORT_TYPE_COLORS[portType] ?? PORT_TYPE_COLORS.any;
          }
          _color.set(ringColor);
          torusMesh.setColorAt(idx, _color);

          // Record compatible ports for pulsing animation
          if (isValidTarget) {
            compatIndices.push(idx);
            compatPositions.push([wx, wy, wz]);
          }

          idx++;
        }

        // --- Output ports ---
        const outputCount = node.outputs.length;
        for (let i = 0; i < outputCount; i++) {
          if (idx >= MAX_PORTS) break;

          const portDef = node.outputs[i];
          const portType: PortType = portDef.portType ?? 'any';

          const localX = getPortLocalX(false, nw);
          const localZ = getPortLocalZ(i, outputCount, nd);
          const wx = nx + localX;
          const wy = ny;
          const wz = nz + localZ;

          // All outputs are dimmed during connection drawing
          const isDimmed = isDrawing;
          const scale = isDimmed ? 0.5 : 1;

          // Sphere instance
          _obj.position.set(wx, wy, wz);
          _obj.rotation.set(0, 0, 0);
          _obj.scale.setScalar(scale);
          _obj.updateMatrix();
          sphereMesh.setMatrixAt(idx, _obj.matrix);

          // Torus instance
          _obj.quaternion.copy(_torusQuat);
          _obj.updateMatrix();
          torusMesh.setMatrixAt(idx, _obj.matrix);

          // Torus color — dimmed outputs use darker color during drawing
          const ringColor = isDrawing
            ? '#333333'
            : PORT_TYPE_COLORS[portType] ?? PORT_TYPE_COLORS.any;
          _color.set(ringColor);
          torusMesh.setColorAt(idx, _color);

          idx++;
        }
      }

      // Zero out stale instances from previous frame
      const prevCount = prevCountRef.current;
      if (idx < prevCount) {
        _obj.scale.setScalar(0);
        _obj.position.set(0, 0, 0);
        _obj.rotation.set(0, 0, 0);
        _obj.updateMatrix();
        _color.set('#000000');
        for (let i = idx; i < prevCount; i++) {
          sphereMesh.setMatrixAt(i, _obj.matrix);
          torusMesh.setMatrixAt(i, _obj.matrix);
          torusMesh.setColorAt(i, _color);
        }
      }

      prevCountRef.current = idx;
      compatibleIndicesRef.current = compatIndices;
      compatiblePositionsRef.current = compatPositions;

      // Update visible instance count for the renderer
      sphereMesh.count = idx;
      torusMesh.count = idx;

      // Signal Three.js that instance data has changed
      sphereMesh.instanceMatrix.needsUpdate = true;
      torusMesh.instanceMatrix.needsUpdate = true;
      if (torusMesh.instanceColor) {
        torusMesh.instanceColor.needsUpdate = true;
      }
    }

    // --- Pulsing animation for compatible ports during drawing ---
    // Runs every frame when drawing (lightweight: only updates compatible port matrices)
    if (isDrawing && compatibleIndicesRef.current.length > 0) {
      const t = clock.getElapsedTime();
      const pulse = 1.15 + Math.sin(t * 5) * 0.15; // Scale oscillates 1.0 - 1.3

      for (let ci = 0; ci < compatibleIndicesRef.current.length; ci++) {
        const instIdx = compatibleIndicesRef.current[ci];
        const [wx, wy, wz] = compatiblePositionsRef.current[ci];

        // Update sphere with pulsing scale
        _obj.position.set(wx, wy, wz);
        _obj.rotation.set(0, 0, 0);
        _obj.scale.setScalar(pulse);
        _obj.updateMatrix();
        sphereMesh.setMatrixAt(instIdx, _obj.matrix);

        // Update torus with pulsing scale (rotated)
        _obj.quaternion.copy(_torusQuat);
        _obj.updateMatrix();
        torusMesh.setMatrixAt(instIdx, _obj.matrix);
      }

      sphereMesh.instanceMatrix.needsUpdate = true;
      torusMesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Instanced port spheres - matcap shaded */}
      <instancedMesh
        ref={sphereRef}
        args={[INST_SPHERE_GEO, undefined, MAX_PORTS]}
        frustumCulled={false}
      >
        <meshMatcapMaterial matcap={matcapDark} />
      </instancedMesh>

      {/* Instanced type indicator torus rings - per-instance color via instanceColor */}
      <instancedMesh
        ref={torusRef}
        args={[INST_TORUS_GEO, undefined, MAX_PORTS]}
        frustumCulled={false}
      >
        <meshBasicMaterial transparent opacity={0.45} />
      </instancedMesh>
    </group>
  );
});
