/**
 * Custom node slice — manages custom node definition CRUD and custom node
 * instance creation / port reconfiguration.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - addCustomNodeDef / removeCustomNodeDef / updateCustomNodeDef (definition CRUD)
 * - addCustomNode (instantiate a custom node from a definition)
 * - updateCustomNodePorts (reconfigure port counts on a custom node instance)
 */
import type { EditorNode, Connection, CustomNodeDef, PortConfig, PortDef, PortType } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomNodeHelpers {
  pushUndo: (label?: string) => void;
  genId: () => string;
  genCustomDefId: () => string;
  scheduleAutoExecute: (execute: () => void) => void;
  makePortDefs: (prefix: string, configs: { label: string; portType: PortType; description?: string; defaultValue?: unknown; min?: number; max?: number }[]) => PortDef[];
  invalidateDownstream: (nodeId: string, connections: Record<string, Connection>, cache: Map<string, unknown> | undefined) => void;
  getExecutionCache: (graphId: string) => Map<string, unknown> | undefined;
  getActiveUndoGraphId: () => string;
}

export interface CustomNodeActions {
  addCustomNodeDef: (def: Omit<CustomNodeDef, 'id'>) => string;
  removeCustomNodeDef: (id: string) => void;
  updateCustomNodeDef: (id: string, partial: Partial<Omit<CustomNodeDef, 'id'>>) => void;
  addCustomNode: (defId: string, position?: [number, number, number]) => string | null;
  updateCustomNodePorts: (nodeId: string, inputCount: number, outputCount: number) => void;
}

// ---------------------------------------------------------------------------
// Actions factory
// ---------------------------------------------------------------------------

/**
 * Creates custom node definition management actions.
 * @param set  - Zustand immer set function
 * @param get  - Zustand get function (returns full state)
 * @param helpers - Module-scoped utilities wrapped for the slice
 */
export function createCustomNodeActions(
  set: (fn: (state: { nodes: Record<string, EditorNode>; connections: Record<string, Connection>; customNodeDefs: Record<string, CustomNodeDef> }) => void) => void,
  get: () => {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    customNodeDefs: Record<string, CustomNodeDef>;
    executeGraph: () => void;
  },
  helpers: CustomNodeHelpers,
): CustomNodeActions {
  const {
    pushUndo, genId, genCustomDefId,
    scheduleAutoExecute, makePortDefs,
    invalidateDownstream, getExecutionCache, getActiveUndoGraphId,
  } = helpers;

  return {
    // --- Custom Node Definitions ---

    addCustomNodeDef: (def: Omit<CustomNodeDef, 'id'>) => {
      pushUndo('Add custom node definition');
      const id = genCustomDefId();
      const fullDef: CustomNodeDef = { ...def, id };
      set(s => {
        s.customNodeDefs[id] = fullDef;
      });
      return id;
    },

    removeCustomNodeDef: (id: string) => {
      if (!get().customNodeDefs[id]) return;
      pushUndo('Remove custom node definition');
      set(s => {
        delete s.customNodeDefs[id];
      });
    },

    updateCustomNodeDef: (id: string, partial: Partial<Omit<CustomNodeDef, 'id'>>) => {
      const existing = get().customNodeDefs[id];
      if (!existing) return;
      // No-op guard: skip undo if nothing actually changes
      const hasChange = Object.entries(partial).some(
        ([k, v]) => JSON.stringify(existing[k as keyof CustomNodeDef]) !== JSON.stringify(v)
      );
      if (!hasChange) return;
      pushUndo('Update custom node definition');
      set(s => {
        const def = s.customNodeDefs[id];
        if (!def) return;
        if (partial.name !== undefined) def.name = partial.name;
        if (partial.color !== undefined) def.color = partial.color;
        if (partial.category !== undefined) def.category = partial.category;
        if (partial.expression !== undefined) def.expression = partial.expression;
        if (partial.inputs !== undefined) def.inputs = partial.inputs;
        if (partial.outputs !== undefined) def.outputs = partial.outputs;
        // Update all custom nodes that reference this def
        for (const node of Object.values(s.nodes)) {
          if (node.type === 'custom' && node.data.customDefId === id) {
            if (partial.expression !== undefined) node.data.expression = partial.expression;
            if (partial.name !== undefined) node.title = partial.name;
            if (partial.inputs !== undefined) {
              node.inputs = makePortDefs('in', partial.inputs);
              node.data.inputCount = partial.inputs.length;
            }
            if (partial.outputs !== undefined) {
              node.outputs = makePortDefs('out', partial.outputs);
              node.data.outputCount = partial.outputs.length;
            }
            // Remove connections to ports that no longer exist
            if (partial.inputs !== undefined || partial.outputs !== undefined) {
              const ic = node.inputs.length;
              const oc = node.outputs.length;
              for (const [connId, conn] of Object.entries(s.connections)) {
                if (conn.targetNodeId === node.id && conn.targetPortIndex >= ic) {
                  delete s.connections[connId];
                }
                if (conn.sourceNodeId === node.id && conn.sourcePortIndex >= oc) {
                  delete s.connections[connId];
                }
              }
            }
          }
        }
      });
      // Invalidate cache for all nodes using this def
      const state = get();
      for (const node of Object.values(state.nodes)) {
        if (node.type === 'custom' && node.data.customDefId === id) {
          invalidateDownstream(node.id, state.connections, getExecutionCache(getActiveUndoGraphId()));
        }
      }
      scheduleAutoExecute(() => get().executeGraph());
    },

    addCustomNode: (defId: string, position?: [number, number, number]) => {
      const def = get().customNodeDefs[defId];
      if (!def) return null;
      pushUndo('Add custom node');
      const id = genId();
      const node: EditorNode = {
        id,
        type: 'custom',
        position: position ?? [Math.random() * 6 - 3, 0, Math.random() * 6 - 3],
        title: def.name,
        data: { customDefId: defId, expression: def.expression },
        inputs: makePortDefs('in', def.inputs),
        outputs: makePortDefs('out', def.outputs),
      };
      set(s => {
        s.nodes[id] = node;
      });
      return id;
    },

    // --- Custom node port configuration ---

    updateCustomNodePorts: (nodeId: string, inputCount: number, outputCount: number) => {
      const state = get();
      const node = state.nodes[nodeId];
      if (!node || node.type !== 'custom' || node.locked) return;
      // Clamp counts to reasonable bounds
      const ic = Math.max(0, Math.min(inputCount, 8));
      const oc = Math.max(1, Math.min(outputCount, 8));
      pushUndo('Update custom node ports');
      set(s => {
        const n = s.nodes[nodeId];
        if (!n) return;
        // Generate new port defs
        const newInputs: PortConfig[] = [];
        for (let i = 0; i < ic; i++) {
          newInputs.push({ label: `in${i}`, portType: 'any' });
        }
        const newOutputs: PortConfig[] = [];
        for (let i = 0; i < oc; i++) {
          newOutputs.push({ label: `out${i}`, portType: 'any' });
        }
        n.inputs = makePortDefs('in', newInputs);
        n.outputs = makePortDefs('out', newOutputs);
        n.data.inputCount = ic;
        n.data.outputCount = oc;

        // Remove connections to ports that no longer exist
        for (const [connId, conn] of Object.entries(s.connections)) {
          if (conn.targetNodeId === nodeId && conn.targetPortIndex >= ic) {
            delete s.connections[connId];
          }
          if (conn.sourceNodeId === nodeId && conn.sourcePortIndex >= oc) {
            delete s.connections[connId];
          }
        }
      });
      // Invalidate execution cache for downstream nodes (port changes affect output)
      invalidateDownstream(nodeId, get().connections, getExecutionCache(getActiveUndoGraphId()));
      scheduleAutoExecute(() => get().executeGraph());
    },
  };
}
