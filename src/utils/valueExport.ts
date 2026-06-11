/**
 * Export node output values as JSON / CSV.
 *
 * Powers "Copy Value as JSON/CSV" in the node context menu and the value
 * readouts in the Presentation panel. SVG export covers the *diagram*;
 * this covers the *result* — calculators and ETL graphs deliver tangible,
 * paste-into-a-spreadsheet output.
 */
import type { Connection, EditorNode } from '../types';

/**
 * Resolve the exportable value of a node.
 *
 * - Nodes with computed outputs: a single output exports as the bare value;
 *   multiple outputs export as an object keyed by port label.
 * - Sink nodes (`display` etc.) have no outputs — resolve the value arriving
 *   at input port 0 through the incoming connection (the DisplayReadout model).
 *
 * Returns `undefined` when there is nothing to export (not yet executed,
 * or no incoming connection on a sink).
 */
export function resolveNodeExportValue(
  nodeId: string,
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
  nodeOutputs: Record<string, Record<number, unknown>>,
): unknown {
  const node = nodes[nodeId];
  if (!node) return undefined;

  const outputs = nodeOutputs[nodeId];
  const keys = outputs ? Object.keys(outputs) : [];
  if (keys.length === 1) return outputs![Number(keys[0])];
  if (keys.length > 1) {
    const result: Record<string, unknown> = {};
    for (const k of keys) {
      const idx = Number(k);
      const label = node.outputs[idx]?.label ?? `output${idx}`;
      // Disambiguate duplicate labels with the port index
      result[label in result ? `${label}_${idx}` : label] = outputs![idx];
    }
    return result;
  }

  // Sink: read the value arriving at input port 0
  const incoming = Object.values(connections).find(
    c => c.targetNodeId === nodeId && c.targetPortIndex === 0,
  );
  if (incoming) return nodeOutputs[incoming.sourceNodeId]?.[incoming.sourcePortIndex];
  return undefined;
}

/** Serialize a value as pretty-printed JSON. Returns null when unserializable. */
export function valueToJSON(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2) ?? null;
  } catch {
    return null; // circular structures, BigInt, etc.
  }
}

function csvEscape(cell: unknown): string {
  let s: string;
  if (cell === null || cell === undefined) s = '';
  else if (typeof cell === 'object') {
    try { s = JSON.stringify(cell); } catch { s = String(cell); }
  } else s = String(cell);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Convert a value to CSV text. Shapes:
 * - array of objects  → header = union of keys (first-seen order), one row each
 * - array of arrays   → rows as-is
 * - flat array        → single `value` column
 * - object            → keys as header, values as the single row
 * - primitive         → single `value` cell
 * Returns null when there's no sensible tabular form (undefined/null/empty).
 */
export function valueToCSV(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.every(row => row !== null && typeof row === 'object' && !Array.isArray(row))) {
      const headers: string[] = [];
      for (const row of value as Record<string, unknown>[]) {
        for (const k of Object.keys(row)) {
          if (!headers.includes(k)) headers.push(k);
        }
      }
      const lines = [headers.map(csvEscape).join(',')];
      for (const row of value as Record<string, unknown>[]) {
        lines.push(headers.map(h => csvEscape(row[h])).join(','));
      }
      return lines.join('\n');
    }
    if (value.every(row => Array.isArray(row))) {
      return (value as unknown[][]).map(row => row.map(csvEscape).join(',')).join('\n');
    }
    return ['value', ...value.map(csvEscape)].join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return null;
    return [
      entries.map(([k]) => csvEscape(k)).join(','),
      entries.map(([, v]) => csvEscape(v)).join(','),
    ].join('\n');
  }

  return `value\n${csvEscape(value)}`;
}

/** Write text to the clipboard with a textarea fallback for insecure contexts. */
export function copyTextToClipboard(text: string): void {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  };
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else {
      fallback();
    }
  } catch {
    fallback();
  }
}
