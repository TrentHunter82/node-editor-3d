/**
 * Per-type minimum node depth calculation.
 *
 * Extracted to its own file to avoid circular dependencies between
 * NodeScreen.tsx and nodeSlice.ts.
 */
import type { NodeType } from '../types';
import { NODE_SCREEN_FIELDS } from '../components/nodes/nodeFields';

// Same value as MIN_NODE_HEIGHT in nodeSlice.ts — duplicated here to avoid circular import
const MIN_NODE_DEPTH = 0.6;

/** Approximate CSS-pixel height constants for screen content */
const PX_HEADER = 30;        // 14px font + 10px padding + 6px bottom margin
const PX_SECTION_LABEL = 12; // "PARAMS" / "OUTPUTS"
const PX_FIELD_ROW = 28;     // 11px font + 8px input padding + 6px margin + 3px border
const PX_DIVIDER = 13;       // section separator
const PX_OUTPUT_ROW = 16;    // 9px font, 14px line-height + 2px gap
const PX_CONN_DOTS = 0;      // absolutely positioned — no flow contribution
const PX_PADDING = 10;       // bottom only — header -10px top margin eats top padding
const SCREEN_FACTOR = 110;   // nodeD-to-CSS-px conversion factor

/**
 * Compute the minimum node depth (world units) needed to display all screen
 * content without scrolling.
 *
 * Note: inputCount is part of the signature for symmetry with callers and
 * potential future use, but does not currently affect the computed depth
 * (inputs render as absolutely-positioned connection dots, not flow content).
 */
export function getMinNodeDepth(nodeType: NodeType, _inputCount: number, outputCount: number): number {
  const fields = NODE_SCREEN_FIELDS[nodeType] ?? [];
  const contentH = PX_PADDING + PX_HEADER
    + (fields.length > 0 ? PX_SECTION_LABEL : 0)
    + fields.length * PX_FIELD_ROW
    + PX_DIVIDER
    + PX_SECTION_LABEL + Math.max(1, outputCount) * PX_OUTPUT_ROW
    + PX_CONN_DOTS;
  return Math.max(MIN_NODE_DEPTH, Math.ceil((contentH / SCREEN_FACTOR) * 10) / 10);
}
