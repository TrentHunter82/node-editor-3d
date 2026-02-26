/**
 * Node versioning / schema migration utility.
 *
 * Detects when a node's port schema has changed from what NODE_TYPE_CONFIG
 * currently defines (ports added/removed/renamed). Provides auto-migration
 * to add missing ports with defaults and flag removed ports for review.
 *
 * Shows migration warnings in ValidationPanel via the `(warning)` suffix convention.
 */
import type { EditorNode, NodeType, PortDef, PortType } from '../types';
import { NODE_TYPE_CONFIG } from '../types';
import { TYPE_LABELS } from '../types/nodeLabels';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortMismatch {
  nodeId: string;
  nodeTitle: string;
  nodeType: NodeType;
  /** Ports that exist in config but not on the node */
  missingInputs: { index: number; label: string; portType: PortType }[];
  missingOutputs: { index: number; label: string; portType: PortType }[];
  /** Ports on the node that no longer exist in config (excess) */
  excessInputs: number;
  excessOutputs: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Compare a node's current ports against the canonical NODE_TYPE_CONFIG.
 * Returns a mismatch descriptor if the node's ports don't match, or null if fine.
 *
 * Skips 'custom', 'subgraph', 'subgraph-input', 'subgraph-output' since
 * those have dynamic ports.
 */
export function detectPortMismatch(node: EditorNode): PortMismatch | null {
  // Dynamic port types — skip schema check
  if (node.type === 'custom' || node.type === 'subgraph' ||
      node.type === 'subgraph-input' || node.type === 'subgraph-output') {
    return null;
  }

  const config = NODE_TYPE_CONFIG[node.type];
  if (!config) return null; // Unknown type (plugin node) — skip

  const missingInputs: PortMismatch['missingInputs'] = [];
  const missingOutputs: PortMismatch['missingOutputs'] = [];

  // Check inputs: config has more ports than the node
  for (let i = node.inputs.length; i < config.inputs.length; i++) {
    const p = config.inputs[i];
    missingInputs.push({ index: i, label: p.label, portType: p.portType });
  }

  // Check outputs: config has more ports than the node
  for (let i = node.outputs.length; i < config.outputs.length; i++) {
    const p = config.outputs[i];
    missingOutputs.push({ index: i, label: p.label, portType: p.portType });
  }

  // Check for excess ports (node has more than config)
  const excessInputs = Math.max(0, node.inputs.length - config.inputs.length);
  const excessOutputs = Math.max(0, node.outputs.length - config.outputs.length);

  if (missingInputs.length === 0 && missingOutputs.length === 0 &&
      excessInputs === 0 && excessOutputs === 0) {
    return null;
  }

  return {
    nodeId: node.id,
    nodeTitle: node.title,
    nodeType: node.type,
    missingInputs,
    missingOutputs,
    excessInputs,
    excessOutputs,
  };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Auto-migrate a node's ports to match the current NODE_TYPE_CONFIG.
 * - Adds missing ports with default values
 * - Does NOT remove excess ports (preserves data; warns instead)
 *
 * Returns true if any changes were made.
 */
export function migrateNodePorts(node: EditorNode): boolean {
  if (node.type === 'custom' || node.type === 'subgraph' ||
      node.type === 'subgraph-input' || node.type === 'subgraph-output') {
    return false;
  }

  const config = NODE_TYPE_CONFIG[node.type];
  if (!config) return false;

  let changed = false;

  // Add missing inputs
  for (let i = node.inputs.length; i < config.inputs.length; i++) {
    const p = config.inputs[i];
    const portDef: PortDef = {
      id: `in-${i}`,
      label: p.label,
      portType: p.portType,
    };
    if (p.description) portDef.description = p.description;
    if (p.defaultValue !== undefined) portDef.defaultValue = p.defaultValue;
    if (p.min !== undefined) portDef.min = p.min;
    if (p.max !== undefined) portDef.max = p.max;
    node.inputs.push(portDef);
    changed = true;
  }

  // Add missing outputs
  for (let i = node.outputs.length; i < config.outputs.length; i++) {
    const p = config.outputs[i];
    const portDef: PortDef = {
      id: `out-${i}`,
      label: p.label,
      portType: p.portType,
    };
    if (p.description) portDef.description = p.description;
    if (p.min !== undefined) portDef.min = p.min;
    if (p.max !== undefined) portDef.max = p.max;
    node.outputs.push(portDef);
    changed = true;
  }

  return changed;
}

/**
 * Migrate a node's title from raw type key to the canonical human-readable label.
 * Only updates if the current title exactly matches the type key (e.g. "string-length")
 * and a proper label exists (e.g. "String Length"). Preserves user-renamed titles.
 *
 * Returns true if the title was updated.
 */
export function migrateNodeTitle(node: EditorNode): boolean {
  // Skip dynamic types whose titles are set by the user/definition
  if (node.type === 'custom' || node.type === 'subgraph' ||
      node.type === 'subgraph-input' || node.type === 'subgraph-output') {
    return false;
  }

  const canonicalLabel = TYPE_LABELS[node.type];
  if (!canonicalLabel) return false;

  // Only migrate if the title is still the raw type key
  if (node.title === node.type && node.title !== canonicalLabel) {
    node.title = canonicalLabel;
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

/**
 * Scan all nodes for schema mismatches.
 * Returns array of mismatch descriptors.
 */
export function detectAllMismatches(
  nodes: Record<string, EditorNode>,
): PortMismatch[] {
  const mismatches: PortMismatch[] = [];
  for (const node of Object.values(nodes)) {
    const m = detectPortMismatch(node);
    if (m) mismatches.push(m);
  }
  return mismatches;
}

/**
 * Generate validation warning messages for port mismatches.
 * Uses the `(warning)` suffix convention for ValidationPanel detection.
 */
export function generateMismatchWarnings(
  nodes: Record<string, EditorNode>,
): Record<string, string[]> {
  const warnings: Record<string, string[]> = {};
  for (const node of Object.values(nodes)) {
    const m = detectPortMismatch(node);
    if (!m) continue;

    const msgs: string[] = [];
    if (m.missingInputs.length > 0) {
      const labels = m.missingInputs.map(p => `"${p.label}"`).join(', ');
      msgs.push(`Missing input port${m.missingInputs.length > 1 ? 's' : ''}: ${labels} — will be auto-added (warning)`);
    }
    if (m.missingOutputs.length > 0) {
      const labels = m.missingOutputs.map(p => `"${p.label}"`).join(', ');
      msgs.push(`Missing output port${m.missingOutputs.length > 1 ? 's' : ''}: ${labels} — will be auto-added (warning)`);
    }
    if (m.excessInputs > 0) {
      msgs.push(`${m.excessInputs} extra input port${m.excessInputs > 1 ? 's' : ''} (schema changed) (warning)`);
    }
    if (m.excessOutputs > 0) {
      msgs.push(`${m.excessOutputs} extra output port${m.excessOutputs > 1 ? 's' : ''} (schema changed) (warning)`);
    }
    if (msgs.length > 0) {
      warnings[node.id] = msgs;
    }
  }
  return warnings;
}

/**
 * Auto-migrate all nodes to match current config (ports and titles).
 * Returns count of nodes migrated.
 */
export function migrateAllNodes(nodes: Record<string, EditorNode>): number {
  let count = 0;
  for (const node of Object.values(nodes)) {
    let changed = false;
    if (migrateNodePorts(node)) changed = true;
    if (migrateNodeTitle(node)) changed = true;
    if (changed) count++;
  }
  return count;
}
