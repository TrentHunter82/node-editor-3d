/**
 * Subgraph slice — manages subgraph creation, navigation, deletion, and expansion.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - createSubgraph (create empty subgraph node + inner graph)
 * - convertSelectionToSubgraph (wrap selected nodes into a subgraph)
 * - enterSubgraph / exitSubgraph (navigate into/out of subgraph inner graphs)
 * - deleteSubgraphNode (remove subgraph node and cascade-cleanup inner graphs)
 * - expandSubgraph (inline inner graph nodes back into parent)
 */
import type { EditorNode, Connection, NodeGroup, SubgraphNodeDef, GraphData, PortConfig, PortType } from '../../types';
import { invalidateDownstream } from '../../utils/execution';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePortDefs(prefix: string, configs: { label: string; portType: PortType; description?: string; defaultValue?: unknown; min?: number; max?: number }[]) {
  return configs.map((cfg, i) => {
    const def: { id: string; label: string; portType: PortType; description?: string; defaultValue?: unknown; min?: number; max?: number } = {
      id: `${prefix}-${i}`,
      label: cfg.label,
      portType: cfg.portType,
    };
    if (cfg.description !== undefined) def.description = cfg.description;
    if (cfg.defaultValue !== undefined) def.defaultValue = cfg.defaultValue;
    if (cfg.min !== undefined) def.min = cfg.min;
    if (cfg.max !== undefined) def.max = cfg.max;
    return def;
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubgraphHelpers {
  pushUndo: (label?: string) => void;
  genId: () => string;
  genGraphId: () => string;
  genConnectionId: () => string;
  scheduleAutoExecute: (execute: () => void) => void;
  cancelAutoExecute: () => void;
  syncNextId: (nodes: Record<string, EditorNode>, connections: Record<string, Connection>, groups?: Record<string, NodeGroup>, extraKeys?: string[]) => void;
  clearExecutionTimeouts: () => void;
  getExecutionCache: (graphId: string) => Map<string, unknown> | undefined;
  clearAllTransientState: (state: any) => void;
  executionInitialStats: any;
  inactiveGraphs: Record<string, GraphData>;
  saveInactiveGraphsToUndo: (graphIds: string[]) => void;
  markCreatedInactiveGraphs: (graphIds: string[]) => void;
  collectInnerGraphIds: (graphData: GraphData | undefined) => string[];
  cleanupGraphResources: (graphIds: string[]) => void;
  setActiveUndoGraphId: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Actions factory
// ---------------------------------------------------------------------------

export function createSubgraphActions(
  set: (fn: (state: any) => void) => void,
  get: () => any,
  helpers: SubgraphHelpers,
) {
  const {
    pushUndo, genId, genGraphId, genConnectionId,
    scheduleAutoExecute, cancelAutoExecute,
    syncNextId, clearExecutionTimeouts,
    getExecutionCache, clearAllTransientState, executionInitialStats,
    inactiveGraphs, saveInactiveGraphsToUndo, markCreatedInactiveGraphs,
    collectInnerGraphIds, cleanupGraphResources,
    setActiveUndoGraphId,
  } = helpers;

  return {
    createSubgraph: (name?: string) => {
      const state = get();
      pushUndo('Create subgraph');

      const subgraphNodeId = genId();
      const innerGraphId = genGraphId();
      const subgraphName = name || 'Subgraph';

      const inputNodeId = genId();
      const outputNodeId = genId();

      const innerGraph: GraphData = {
        nodes: {
          [inputNodeId]: {
            id: inputNodeId,
            type: 'subgraph-input',
            position: [-3, 0, 0],
            title: 'Input',
            data: { portIndex: 0 },
            inputs: [],
            outputs: makePortDefs('out', [{ label: 'value', portType: 'any' }]),
          },
          [outputNodeId]: {
            id: outputNodeId,
            type: 'subgraph-output',
            position: [3, 0, 0],
            title: 'Output',
            data: { portIndex: 0 },
            inputs: makePortDefs('in', [{ label: 'value', portType: 'any' }]),
            outputs: [],
          },
        },
        connections: {},
        groups: {},
        customNodeDefs: {},
        parentGraphId: state.activeGraphId,
        parentNodeId: subgraphNodeId,
      };

      const def: SubgraphNodeDef = {
        id: subgraphNodeId,
        name: subgraphName,
        innerGraphId,
        exposedInputs: [{ portIndex: 0, innerNodeId: inputNodeId }],
        exposedOutputs: [{ portIndex: 0, innerNodeId: outputNodeId }],
      };

      inactiveGraphs[innerGraphId] = innerGraph;

      set(s => {
        s.graphTabs[innerGraphId] = { id: innerGraphId, name: subgraphName, createdAt: Date.now() };

        s.nodes[subgraphNodeId] = {
          id: subgraphNodeId,
          type: 'subgraph',
          position: [0, 0, 0],
          title: subgraphName,
          data: { innerGraphId, subgraphDefId: subgraphNodeId },
          inputs: makePortDefs('in', [{ label: 'in', portType: 'any' }]),
          outputs: makePortDefs('out', [{ label: 'out', portType: 'any' }]),
        };
        s.subgraphDefs[subgraphNodeId] = def;
        s.selectedIds = new Set([subgraphNodeId]);
      });
      markCreatedInactiveGraphs([innerGraphId]);

      return subgraphNodeId;
    },

    convertSelectionToSubgraph: (name?: string) => {
      const state = get();
      const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);
      if (selectedNodeIds.length === 0) return null;

      if (selectedNodeIds.some(id => state.nodes[id].type === 'subgraph-input' || state.nodes[id].type === 'subgraph-output')) return null;

      pushUndo('Convert to subgraph');

      const subgraphName = name || 'Subgraph';
      const subgraphNodeId = genId();
      const innerGraphId = genGraphId();

      const selectedSet = new Set(selectedNodeIds);
      const conns = Object.values(state.connections) as Connection[];

      // Incoming: external → selected
      const incomingConns: { conn: Connection; portKey: string }[] = [];
      const incomingKeys = new Set<string>();
      for (const conn of conns) {
        if (selectedSet.has(conn.targetNodeId) && !selectedSet.has(conn.sourceNodeId)) {
          const key = `${conn.targetNodeId}:${conn.targetPortIndex}`;
          incomingConns.push({ conn, portKey: key });
          incomingKeys.add(key);
        }
      }

      // Outgoing: selected → external
      const outgoingConns: { conn: Connection; portKey: string }[] = [];
      const outgoingKeys = new Set<string>();
      for (const conn of conns) {
        if (selectedSet.has(conn.sourceNodeId) && !selectedSet.has(conn.targetNodeId)) {
          const key = `${conn.sourceNodeId}:${conn.sourcePortIndex}`;
          outgoingConns.push({ conn, portKey: key });
          outgoingKeys.add(key);
        }
      }

      // Create subgraph-input nodes
      const uniqueIncoming = [...incomingKeys];
      const inputNodes: Record<string, EditorNode> = {};
      const exposedInputs: SubgraphNodeDef['exposedInputs'] = [];
      const inputPortConfigs: PortConfig[] = [];

      for (let i = 0; i < uniqueIncoming.length; i++) {
        const inputNodeId = genId();
        const [targetNodeId, targetPortIndexStr] = uniqueIncoming[i].split(':');
        const targetPortIndex = parseInt(targetPortIndexStr, 10);
        const targetNode = state.nodes[targetNodeId];
        if (!targetNode) continue;
        const portType = targetNode.inputs[targetPortIndex]?.portType ?? 'any';
        const portLabel = targetNode.inputs[targetPortIndex]?.label ?? `in${i}`;

        inputNodes[inputNodeId] = {
          id: inputNodeId,
          type: 'subgraph-input',
          position: [-5, 0, i * 2],
          title: `Input: ${portLabel}`,
          data: { portIndex: i },
          inputs: [],
          outputs: makePortDefs('out', [{ label: portLabel, portType }]),
        };
        exposedInputs.push({ portIndex: i, innerNodeId: inputNodeId });
        inputPortConfigs.push({ label: portLabel, portType });
      }

      // Create subgraph-output nodes
      const uniqueOutgoing = [...outgoingKeys];
      const outputNodes: Record<string, EditorNode> = {};
      const exposedOutputs: SubgraphNodeDef['exposedOutputs'] = [];
      const outputPortConfigs: PortConfig[] = [];

      for (let i = 0; i < uniqueOutgoing.length; i++) {
        const outputNodeId = genId();
        const [sourceNodeId, sourcePortIndexStr] = uniqueOutgoing[i].split(':');
        const sourcePortIndex = parseInt(sourcePortIndexStr, 10);
        const sourceNode = state.nodes[sourceNodeId];
        if (!sourceNode) continue;
        const portType = sourceNode.outputs[sourcePortIndex]?.portType ?? 'any';
        const portLabel = sourceNode.outputs[sourcePortIndex]?.label ?? `out${i}`;

        outputNodes[outputNodeId] = {
          id: outputNodeId,
          type: 'subgraph-output',
          position: [5, 0, i * 2],
          title: `Output: ${portLabel}`,
          data: { portIndex: i },
          inputs: makePortDefs('in', [{ label: portLabel, portType }]),
          outputs: [],
        };
        exposedOutputs.push({ portIndex: i, innerNodeId: outputNodeId });
        outputPortConfigs.push({ label: portLabel, portType });
      }

      // Build inner graph connections
      const innerConnections: Record<string, Connection> = {};

      // Internal connections
      for (const conn of conns) {
        if (selectedSet.has(conn.sourceNodeId) && selectedSet.has(conn.targetNodeId)) {
          innerConnections[conn.id] = structuredClone(conn);
        }
      }

      // Connections from subgraph-input → inner nodes
      for (const { conn, portKey } of incomingConns) {
        const inputIdx = uniqueIncoming.indexOf(portKey);
        const inputNodeId = exposedInputs[inputIdx].innerNodeId;
        const connId = genConnectionId();
        innerConnections[connId] = {
          id: connId,
          sourceNodeId: inputNodeId,
          sourcePortIndex: 0,
          targetNodeId: conn.targetNodeId,
          targetPortIndex: conn.targetPortIndex,
        };
      }

      // Connections from inner nodes → subgraph-output
      for (const { conn, portKey } of outgoingConns) {
        const outputIdx = uniqueOutgoing.indexOf(portKey);
        const outputNodeId = exposedOutputs[outputIdx].innerNodeId;
        const connId = genConnectionId();
        innerConnections[connId] = {
          id: connId,
          sourceNodeId: conn.sourceNodeId,
          sourcePortIndex: conn.sourcePortIndex,
          targetNodeId: outputNodeId,
          targetPortIndex: 0,
        };
      }

      // Build inner nodes
      const innerNodes: Record<string, EditorNode> = {};
      for (const nodeId of selectedNodeIds) {
        innerNodes[nodeId] = structuredClone(state.nodes[nodeId]);
        delete innerNodes[nodeId].groupId;
      }
      Object.assign(innerNodes, inputNodes, outputNodes);

      const innerGraph: GraphData = {
        nodes: innerNodes,
        connections: innerConnections,
        groups: {},
        customNodeDefs: structuredClone(state.customNodeDefs),
        parentGraphId: state.activeGraphId,
        parentNodeId: subgraphNodeId,
      };

      const def: SubgraphNodeDef = {
        id: subgraphNodeId,
        name: subgraphName,
        innerGraphId,
        exposedInputs,
        exposedOutputs,
      };

      inactiveGraphs[innerGraphId] = innerGraph;

      // Compute center of selected nodes
      let cx = 0, cz = 0;
      for (const id of selectedNodeIds) {
        cx += state.nodes[id].position[0];
        cz += state.nodes[id].position[2];
      }
      cx /= selectedNodeIds.length;
      cz /= selectedNodeIds.length;

      set(s => {
        s.graphTabs[innerGraphId] = { id: innerGraphId, name: subgraphName, createdAt: Date.now() };

        // Remove selected nodes and their connections
        for (const nodeId of selectedNodeIds) {
          delete s.nodes[nodeId];
        }
        for (const [connId, conn] of Object.entries(s.connections) as [string, Connection][]) {
          if (selectedSet.has(conn.sourceNodeId) || selectedSet.has(conn.targetNodeId)) {
            delete s.connections[connId];
          }
        }

        // Clean up empty groups
        for (const [groupId] of Object.entries(s.groups) as [string, NodeGroup][]) {
          const hasMembers = (Object.values(s.nodes) as EditorNode[]).some(n => n.groupId === groupId);
          if (!hasMembers) {
            delete s.groups[groupId];
          }
        }

        // Create the subgraph node
        s.nodes[subgraphNodeId] = {
          id: subgraphNodeId,
          type: 'subgraph',
          position: [cx, 0, cz],
          title: subgraphName,
          data: { innerGraphId, subgraphDefId: subgraphNodeId },
          inputs: makePortDefs('in', inputPortConfigs.length > 0 ? inputPortConfigs : [{ label: 'in', portType: 'any' }]),
          outputs: makePortDefs('out', outputPortConfigs.length > 0 ? outputPortConfigs : [{ label: 'out', portType: 'any' }]),
        };
        s.subgraphDefs[subgraphNodeId] = def;

        // Reconnect external connections to subgraph node
        for (const { conn, portKey } of incomingConns) {
          const inputIdx = uniqueIncoming.indexOf(portKey);
          const connId = genConnectionId();
          s.connections[connId] = {
            id: connId,
            sourceNodeId: conn.sourceNodeId,
            sourcePortIndex: conn.sourcePortIndex,
            targetNodeId: subgraphNodeId,
            targetPortIndex: inputIdx,
          };
        }

        for (const { conn, portKey } of outgoingConns) {
          const outputIdx = uniqueOutgoing.indexOf(portKey);
          const connId = genConnectionId();
          s.connections[connId] = {
            id: connId,
            sourceNodeId: subgraphNodeId,
            sourcePortIndex: outputIdx,
            targetNodeId: conn.targetNodeId,
            targetPortIndex: conn.targetPortIndex,
          };
        }

        s.selectedIds = new Set([subgraphNodeId]);
      });
      markCreatedInactiveGraphs([innerGraphId]);
      scheduleAutoExecute(() => get().executeGraph());

      return subgraphNodeId;
    },

    enterSubgraph: (subgraphNodeId: string) => {
      cancelAutoExecute();
      const state = get();
      const node = state.nodes[subgraphNodeId];
      if (!node || node.type !== 'subgraph') return;

      const innerGraphId = node.data.innerGraphId as string;
      if (!innerGraphId) return;

      const breadcrumb = { graphId: state.activeGraphId, subgraphNodeId };

      // Save current graph state to inactive storage
      const currentData: GraphData = {
        nodes: structuredClone(state.nodes),
        connections: structuredClone(state.connections),
        groups: structuredClone(state.groups),
        customNodeDefs: structuredClone(state.customNodeDefs),
        subgraphDefs: Object.keys(state.subgraphDefs).length > 0 ? structuredClone(state.subgraphDefs) : undefined,
        errorStrategy: state.errorStrategy !== 'fail-fast' ? state.errorStrategy : undefined,
        checkpoints: Object.keys(state.checkpoints).length > 0 ? structuredClone(state.checkpoints) : undefined,
        graphVariables: Object.keys(state.graphVariables).length > 0 ? structuredClone(state.graphVariables) : undefined,
        executionStats: state.executionStats.executionCount > 0 ? structuredClone(state.executionStats) : undefined,
      };
      inactiveGraphs[state.activeGraphId] = currentData;

      clearExecutionTimeouts();

      setActiveUndoGraphId(innerGraphId);
      const targetData = inactiveGraphs[innerGraphId];

      if (targetData) {
        const currentState = get();
        syncNextId(targetData.nodes, targetData.connections, targetData.groups, [
          ...Object.keys(currentState.graphTabs),
          ...Object.keys(currentState.templates),
        ]);
        set(s => {
          s.activeGraphId = innerGraphId;
          s.nodes = targetData.nodes;
          s.connections = targetData.connections;
          s.groups = targetData.groups;
          s.customNodeDefs = targetData.customNodeDefs;
          s.subgraphDefs = targetData.subgraphDefs ?? {};
          s.errorStrategy = targetData.errorStrategy ?? 'fail-fast';
          s.checkpoints = targetData.checkpoints ?? {};
          s.graphVariables = targetData.graphVariables ?? {};
          s.executionStats = targetData.executionStats ?? executionInitialStats;
          s.validationErrors = {};
          s.selectedIds = new Set<string>();
          clearAllTransientState(s);
          s.executionHistory = [];
          s.breadcrumbStack = [...s.breadcrumbStack, breadcrumb];
        });
        delete inactiveGraphs[innerGraphId];
      } else {
        set(s => {
          s.activeGraphId = innerGraphId;
          s.nodes = {};
          s.connections = {};
          s.groups = {};
          s.customNodeDefs = {};
          s.subgraphDefs = {};
          s.checkpoints = {};
          s.graphVariables = {};
          s.errorStrategy = 'fail-fast';
          s.validationErrors = {};
          s.selectedIds = new Set<string>();
          clearAllTransientState(s);
          s.executionHistory = [];
          s.breadcrumbStack = [...s.breadcrumbStack, breadcrumb];
        });
      }
    },

    exitSubgraph: () => {
      cancelAutoExecute();
      const state = get();
      if (state.breadcrumbStack.length === 0) return;

      const breadcrumb = state.breadcrumbStack[state.breadcrumbStack.length - 1];
      const parentGraphId = breadcrumb.graphId;

      // Save current (inner) graph state
      const currentData: GraphData = {
        nodes: structuredClone(state.nodes),
        connections: structuredClone(state.connections),
        groups: structuredClone(state.groups),
        customNodeDefs: structuredClone(state.customNodeDefs),
        subgraphDefs: Object.keys(state.subgraphDefs).length > 0 ? structuredClone(state.subgraphDefs) : undefined,
        errorStrategy: state.errorStrategy !== 'fail-fast' ? state.errorStrategy : undefined,
        checkpoints: Object.keys(state.checkpoints).length > 0 ? structuredClone(state.checkpoints) : undefined,
        graphVariables: Object.keys(state.graphVariables).length > 0 ? structuredClone(state.graphVariables) : undefined,
        executionStats: state.executionStats.executionCount > 0 ? structuredClone(state.executionStats) : undefined,
      };
      inactiveGraphs[state.activeGraphId] = currentData;

      clearExecutionTimeouts();

      // Invalidate parent graph's cache for the subgraph node
      const parentCache = getExecutionCache(parentGraphId);
      const parentConns = inactiveGraphs[parentGraphId]?.connections;
      if (parentCache && parentConns) {
        invalidateDownstream(breadcrumb.subgraphNodeId, parentConns, parentCache);
      }

      setActiveUndoGraphId(parentGraphId);
      const parentData = inactiveGraphs[parentGraphId];

      if (parentData) {
        const currentState = get();
        syncNextId(parentData.nodes, parentData.connections, parentData.groups ?? {}, [
          ...Object.keys(currentState.graphTabs),
          ...Object.keys(currentState.templates),
        ]);
        set(s => {
          s.activeGraphId = parentGraphId;
          s.nodes = parentData.nodes;
          s.connections = parentData.connections;
          s.groups = parentData.groups ?? {};
          s.customNodeDefs = parentData.customNodeDefs ?? {};
          s.subgraphDefs = parentData.subgraphDefs ?? {};
          s.errorStrategy = parentData.errorStrategy ?? 'fail-fast';
          s.checkpoints = parentData.checkpoints ?? {};
          s.graphVariables = parentData.graphVariables ?? {};
          s.executionStats = parentData.executionStats ?? executionInitialStats;
          s.validationErrors = {};
          const selectNode = parentData.nodes[breadcrumb.subgraphNodeId]
            ? new Set([breadcrumb.subgraphNodeId])
            : new Set<string>();
          s.selectedIds = selectNode;
          clearAllTransientState(s);
          s.executionHistory = [];
          s.breadcrumbStack = s.breadcrumbStack.slice(0, -1);
        });
        delete inactiveGraphs[parentGraphId];
      } else {
        set(s => {
          s.breadcrumbStack = s.breadcrumbStack.slice(0, -1);
        });
      }
    },

    deleteSubgraphNode: (nodeId: string) => {
      const state = get();
      const node = state.nodes[nodeId];
      if (!node || node.type !== 'subgraph') return;
      if (node.locked) return;

      const innerGraphId = node.data.innerGraphId as string;
      pushUndo('Delete subgraph');

      const allInnerIds = innerGraphId
        ? [innerGraphId, ...collectInnerGraphIds(inactiveGraphs[innerGraphId])]
        : [];
      saveInactiveGraphsToUndo(allInnerIds);
      cleanupGraphResources(allInnerIds);

      set(s => {
        delete s.nodes[nodeId];
        delete s.breakpoints[nodeId];
        delete s.breakpointConditions[nodeId];
        delete s.subgraphDefs[nodeId];
        for (const [connId, conn] of Object.entries(s.connections) as [string, Connection][]) {
          if (conn.sourceNodeId === nodeId || conn.targetNodeId === nodeId) {
            delete s.connections[connId];
          }
        }
        s.selectedIds.delete(nodeId);
        for (const gId of allInnerIds) {
          if (s.graphTabs[gId]) delete s.graphTabs[gId];
        }
      });
      scheduleAutoExecute(() => get().executeGraph());
    },

    expandSubgraph: (nodeId: string) => {
      const state = get();
      const node = state.nodes[nodeId];
      if (!node || node.type !== 'subgraph') return;

      const defId = node.data.subgraphDefId as string | undefined;
      const def: SubgraphNodeDef | undefined = defId ? state.subgraphDefs[defId] : undefined;
      const innerGraphId = node.data.innerGraphId as string | undefined;
      if (!innerGraphId) return;

      const innerGraph = inactiveGraphs[innerGraphId];
      if (!innerGraph) return;

      const hasContentNodes = (Object.values(innerGraph.nodes) as EditorNode[]).some(
        n => n.type !== 'subgraph-input' && n.type !== 'subgraph-output'
      );
      if (!hasContentNodes) return;

      cancelAutoExecute();
      pushUndo('Expand subgraph');

      // Compute offset
      let innerCx = 0, innerCz = 0, innerCount = 0;
      for (const innerNode of Object.values(innerGraph.nodes) as EditorNode[]) {
        if (innerNode.type !== 'subgraph-input' && innerNode.type !== 'subgraph-output') {
          innerCx += innerNode.position[0];
          innerCz += innerNode.position[2];
          innerCount++;
        }
      }
      if (innerCount > 0) {
        innerCx /= innerCount;
        innerCz /= innerCount;
      }
      const offsetX = node.position[0] - innerCx;
      const offsetZ = node.position[2] - innerCz;

      // Collect connections to/from the subgraph node
      const parentConnsToSubgraph: Connection[] = [];
      const parentConnsFromSubgraph: Connection[] = [];
      for (const conn of Object.values(state.connections) as Connection[]) {
        if (conn.targetNodeId === nodeId) parentConnsToSubgraph.push(conn);
        if (conn.sourceNodeId === nodeId) parentConnsFromSubgraph.push(conn);
      }

      set(s => {
        // Add inner graph's non-boundary nodes
        const addedNodeIds = new Set<string>();
        for (const [innerId, innerNode] of Object.entries(innerGraph.nodes)) {
          if (innerNode.type === 'subgraph-input' || innerNode.type === 'subgraph-output') continue;
          const clone: EditorNode = structuredClone(innerNode);
          clone.position = [clone.position[0] + offsetX, clone.position[1], clone.position[2] + offsetZ];
          delete clone.groupId;
          s.nodes[innerId] = clone;
          addedNodeIds.add(innerId);
        }

        // Add inner graph's non-boundary connections
        for (const [connId, conn] of Object.entries(innerGraph.connections)) {
          const isBoundary =
            innerGraph.nodes[conn.sourceNodeId]?.type === 'subgraph-input' ||
            innerGraph.nodes[conn.targetNodeId]?.type === 'subgraph-output';
          if (!isBoundary) {
            s.connections[connId] = structuredClone(conn);
          }
        }

        // Reconnect incoming connections
        if (def) {
          for (const parentConn of parentConnsToSubgraph) {
            const exposedInput = def.exposedInputs.find((ei: { portIndex: number; innerNodeId: string }) => ei.portIndex === parentConn.targetPortIndex);
            if (!exposedInput) continue;
            if (!s.nodes[parentConn.sourceNodeId]) continue;
            for (const innerConn of Object.values(innerGraph.connections) as Connection[]) {
              if (innerConn.sourceNodeId === exposedInput.innerNodeId) {
                if (!addedNodeIds.has(innerConn.targetNodeId)) continue;
                const connId = genConnectionId();
                const newConn: Connection = {
                  id: connId,
                  sourceNodeId: parentConn.sourceNodeId,
                  sourcePortIndex: parentConn.sourcePortIndex,
                  targetNodeId: innerConn.targetNodeId,
                  targetPortIndex: innerConn.targetPortIndex,
                };
                if (parentConn.label) newConn.label = parentConn.label;
                if (parentConn.colorOverride) newConn.colorOverride = parentConn.colorOverride;
                if (parentConn.styleOverride !== undefined) newConn.styleOverride = parentConn.styleOverride;
                s.connections[connId] = newConn;
              }
            }
          }

          // Reconnect outgoing connections
          for (const parentConn of parentConnsFromSubgraph) {
            const exposedOutput = def.exposedOutputs.find((eo: { portIndex: number; innerNodeId: string }) => eo.portIndex === parentConn.sourcePortIndex);
            if (!exposedOutput) continue;
            if (!s.nodes[parentConn.targetNodeId]) continue;
            for (const innerConn of Object.values(innerGraph.connections) as Connection[]) {
              if (innerConn.targetNodeId === exposedOutput.innerNodeId) {
                if (!addedNodeIds.has(innerConn.sourceNodeId)) continue;
                const connId = genConnectionId();
                const newConn: Connection = {
                  id: connId,
                  sourceNodeId: innerConn.sourceNodeId,
                  sourcePortIndex: innerConn.sourcePortIndex,
                  targetNodeId: parentConn.targetNodeId,
                  targetPortIndex: parentConn.targetPortIndex,
                };
                if (parentConn.label) newConn.label = parentConn.label;
                if (parentConn.colorOverride) newConn.colorOverride = parentConn.colorOverride;
                if (parentConn.styleOverride !== undefined) newConn.styleOverride = parentConn.styleOverride;
                s.connections[connId] = newConn;
              }
            }
          }
        }

        // Remove the subgraph node and its connections
        delete s.nodes[nodeId];
        if (defId) delete s.subgraphDefs[defId];
        for (const [connId, conn] of Object.entries(s.connections) as [string, Connection][]) {
          if (conn.sourceNodeId === nodeId || conn.targetNodeId === nodeId) {
            delete s.connections[connId];
          }
        }
        s.selectedIds.delete(nodeId);

        if (s.graphTabs[innerGraphId]) {
          delete s.graphTabs[innerGraphId];
        }

        // Clean up orphaned groups
        for (const [gid] of Object.entries(s.groups) as [string, NodeGroup][]) {
          const hasMembers = (Object.values(s.nodes) as EditorNode[]).some(n => n.groupId === gid);
          if (!hasMembers) delete s.groups[gid];
        }

        s.selectedIds = addedNodeIds;
      });

      cleanupGraphResources([innerGraphId]);
      scheduleAutoExecute(() => get().executeGraph());
    },
  };
}
