import type { NodeType } from '../types';

/**
 * First-run starter graph.
 *
 * Seeded once when the app loads with no persisted data. Unlike the old
 * 4-unconnected-nodes seed (which lit up red validation errors as the user's
 * very first impression), this builds a small fully-connected pipeline with
 * meaningful values and executes it once so live values are visible
 * immediately:
 *
 *   Input (5) ──────▶ in      ┌──────────┐      ┌────────┐      ┌─────────┐
 *                             │transform │─────▶│ filter │─────▶│ display │
 *   Factor (2) ─────▶ factor  │ 5×2 = 10 │      │ 10 > 3 │      │   10    │
 *                             └──────────┘      └────────┘      └─────────┘
 */

/** The subset of editor-store actions the seed needs (keeps this module store-agnostic). */
export interface StarterGraphStore {
  addNode: (type: NodeType, position?: [number, number, number]) => string;
  addConnection: (
    sourceNodeId: string,
    sourcePortIndex: number,
    targetNodeId: string,
    targetPortIndex: number,
  ) => string | null;
  updateNodeData: (id: string, key: string, value: unknown) => void;
  updateNodeTitle: (id: string, title: string) => void;
  executeGraph: () => void;
}

export function seedStarterGraph(store: StarterGraphStore): void {
  const input = store.addNode('source', [0, 0, -1.5]);
  const factor = store.addNode('source', [0, 0, 1.5]);
  const transform = store.addNode('transform', [3.5, 0, 0]);
  const filter = store.addNode('filter', [7, 0, 0]);
  const display = store.addNode('display', [10.5, 0, 0]);

  store.updateNodeTitle(input, 'Input');
  store.updateNodeData(input, 'value', 5);
  store.updateNodeTitle(factor, 'Factor');
  store.updateNodeData(factor, 'value', 2);
  store.updateNodeData(filter, 'threshold', 3);
  store.updateNodeData(filter, 'mode', 'greater');

  store.addConnection(input, 0, transform, 0);
  store.addConnection(factor, 0, transform, 1);
  store.addConnection(transform, 0, filter, 0);
  store.addConnection(filter, 0, display, 0);

  // Run once so the first thing a new user sees is a *working* graph with
  // live values, regardless of the autoExecute setting.
  store.executeGraph();
}
