/**
 * Template slice — node template management actions.
 *
 * Extracted from editorStore.ts for modularity. Contains:
 * - saveSelectionAsTemplate (save selected nodes as reusable template)
 * - instantiateTemplate (place a template into the graph)
 * - deleteTemplate / importTemplates / exportTemplates
 */
import type { Connection, NodeTemplate } from '../../types';
import type { EditorState } from '../editorStore';
import { BUILTIN_TEMPLATES } from '../../utils/builtinTemplates';

interface TemplateHelpers {
  pushUndo: (label?: string) => void;
  genId: () => string;
  genConnectionId: () => string;
  genTemplateId: () => string;
}

export function createTemplateActions(
  set: (fn: (state: EditorState) => void) => void,
  get: () => EditorState,
  helpers: TemplateHelpers,
) {
  const { pushUndo, genId, genConnectionId, genTemplateId } = helpers;

  return {
    saveSelectionAsTemplate: (name: string, category?: string): string | null => {
      const state = get();
      const selectedNodeIds = new Set(
        [...state.selectedIds].filter((id: string) => state.nodes[id])
      );
      if (selectedNodeIds.size === 0) return null;

      const nodes = [...selectedNodeIds].map((id: string) => structuredClone(state.nodes[id]));
      const connections = Object.values(state.connections as Record<string, Connection>)
        .filter((c: Connection) => selectedNodeIds.has(c.sourceNodeId) && selectedNodeIds.has(c.targetNodeId))
        .map((c: Connection) => structuredClone(c));

      const templateId = genTemplateId();
      const tmpl: NodeTemplate = {
        id: templateId,
        name,
        category: category ?? 'User',
        nodes,
        connections,
        createdAt: Date.now(),
      };

      set(s => {
        s.templates[templateId] = tmpl;
      });
      return templateId;
    },

    instantiateTemplate: (templateId: string, position?: [number, number, number]): void => {
      const state = get();
      // User templates first, then the built-in examples registry
      const tmpl = state.templates[templateId] ?? BUILTIN_TEMPLATES[templateId];
      if (!tmpl || tmpl.nodes.length === 0) return;

      pushUndo('Instantiate template');
      const idMap = new Map<string, string>();
      const newIds = new Set<string>();

      // Compute bounding center of template nodes
      let cx = 0, cz = 0;
      for (const node of tmpl.nodes) {
        cx += node.position[0];
        cz += node.position[2];
      }
      cx /= tmpl.nodes.length;
      cz /= tmpl.nodes.length;

      const targetPos = position ?? [0, 0, 0];
      const offsetX = targetPos[0] - cx;
      const offsetZ = targetPos[2] - cz;

      set(s => {
        for (const node of tmpl.nodes) {
          const newId = genId();
          idMap.set(node.id, newId);
          s.nodes[newId] = {
            id: newId,
            type: node.type,
            position: [node.position[0] + offsetX, node.position[1], node.position[2] + offsetZ],
            title: node.title,
            data: structuredClone(node.data),
            inputs: structuredClone(node.inputs),
            outputs: structuredClone(node.outputs),
            collapsed: node.collapsed,
            comment: node.comment,
            locked: node.locked,
            autoInserted: node.autoInserted,
            ...(node.width !== undefined && { width: node.width }),
            ...(node.height !== undefined && { height: node.height }),
            // Don't preserve groupId — the group may not exist in the target graph
          };
          newIds.add(newId);
        }
        for (const conn of tmpl.connections) {
          const newSource = idMap.get(conn.sourceNodeId);
          const newTarget = idMap.get(conn.targetNodeId);
          if (newSource && newTarget) {
            const connId = genConnectionId();
            s.connections[connId] = {
              id: connId,
              sourceNodeId: newSource,
              sourcePortIndex: conn.sourcePortIndex,
              targetNodeId: newTarget,
              targetPortIndex: conn.targetPortIndex,
              ...(conn.label !== undefined && { label: conn.label }),
              ...(conn.colorOverride !== undefined && { colorOverride: conn.colorOverride }),
              ...(conn.styleOverride !== undefined && { styleOverride: conn.styleOverride }),
            };
          }
        }
        s.selectedIds = newIds;
      });
    },

    deleteTemplate: (templateId: string): void => {
      if (!get().templates[templateId]) return;
      set(s => {
        delete s.templates[templateId];
      });
    },

    importTemplates: (templates: Record<string, NodeTemplate>): void => {
      set(s => {
        for (const [id, tmpl] of Object.entries(templates)) {
          s.templates[id] = tmpl;
        }
      });
    },

    exportTemplates: (): Record<string, NodeTemplate> => {
      return structuredClone(get().templates);
    },
  };
}
