/**
 * Presentation / "mini-app" view — pure logic.
 *
 * Surfaces a finished graph as a clean tool: parameter nodes (no input
 * ports, editable screen fields) become form inputs; display/output nodes
 * become live result readouts. The wiring stays hidden.
 */
import type { EditorNode, NodeType } from '../types';
import { NODE_SCREEN_FIELDS, type FieldDef } from '../components/nodes/nodeFields';

export interface PresentationInput {
  node: EditorNode;
  fields: FieldDef[];
}

/** Stable reading order: front-to-back (z), then left-to-right (x), then title */
function byLayoutOrder(a: EditorNode, b: EditorNode): number {
  if (a.position[2] !== b.position[2]) return a.position[2] - b.position[2];
  if (a.position[0] !== b.position[0]) return a.position[0] - b.position[0];
  return (a.title || '').localeCompare(b.title || '');
}

/**
 * Parameter nodes: no input ports + editable screen fields.
 * (Covers `source`, `random`, constant-style nodes — anything the user can
 * only influence by editing fields.)
 */
export function getPresentationInputs(nodes: Record<string, EditorNode>): PresentationInput[] {
  const result: PresentationInput[] = [];
  for (const node of Object.values(nodes)) {
    if (node.inputs.length > 0) continue;
    const fields = NODE_SCREEN_FIELDS[node.type as NodeType];
    if (!fields || fields.length === 0) continue;
    result.push({ node, fields });
  }
  return result.sort((a, b) => byLayoutOrder(a.node, b.node));
}

/** Result nodes surfaced in the presentation view */
const OUTPUT_TYPES = new Set<string>(['display', 'output']);

export function getPresentationOutputs(nodes: Record<string, EditorNode>): EditorNode[] {
  return Object.values(nodes)
    .filter(n => OUTPUT_TYPES.has(n.type))
    .sort(byLayoutOrder);
}
