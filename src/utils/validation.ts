import type { EditorNode, Connection } from '../types';

export interface ValidationIssue {
  nodeId: string;
  portIndex: number;
  type: 'disconnected-input' | 'type-mismatch' | 'disconnected-output' | 'no-connections' | 'invalid-data' | 'invalid-expression';
  message?: string;
}

/** Valid port type values for shape validation */
const VALID_PORT_TYPES = new Set<string>(['number', 'string', 'vector3', 'color', 'boolean', 'array', 'object', 'any']);

/** Node types that use expression-based processing */
const EXPRESSION_NODE_TYPES = new Set(['custom', 'array-filter', 'array-map', 'array-reduce']);

/** Terminal node types that are expected to have no outgoing connections */
const TERMINAL_TYPES = new Set(['output', 'display', 'subgraph-output', 'note']);

/**
 * Validate the graph and return issues.
 * Checks: disconnected inputs, type mismatches, disconnected outputs, isolated nodes.
 */
export function validateGraph(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const connectedInputs = new Set<string>();
  const connectedOutputs = new Set<string>();
  const connectedNodes = new Set<string>();

  // Build sets of connected ports and nodes
  for (const conn of Object.values(connections)) {
    connectedInputs.add(`${conn.targetNodeId}:${conn.targetPortIndex}`);
    connectedOutputs.add(`${conn.sourceNodeId}:${conn.sourcePortIndex}`);
    connectedNodes.add(conn.sourceNodeId);
    connectedNodes.add(conn.targetNodeId);
  }

  // Type mismatch warnings: concrete-to-concrete mismatches
  for (const conn of Object.values(connections)) {
    const srcNode = nodes[conn.sourceNodeId];
    const tgtNode = nodes[conn.targetNodeId];
    if (!srcNode || !tgtNode) continue;
    const srcPort = srcNode.outputs[conn.sourcePortIndex];
    const tgtPort = tgtNode.inputs[conn.targetPortIndex];
    if (!srcPort || !tgtPort) continue;
    if (srcPort.portType !== 'any' && tgtPort.portType !== 'any' && srcPort.portType !== tgtPort.portType) {
      issues.push({
        nodeId: conn.targetNodeId,
        portIndex: conn.targetPortIndex,
        type: 'type-mismatch',
        message: `Type mismatch: ${srcPort.portType} → ${tgtPort.portType}`,
      });
    }
  }

  // Check each node
  for (const node of Object.values(nodes)) {
    // Skip note nodes (no ports)
    if (node.type === 'note') continue;

    // Check unconnected required inputs
    for (let i = 0; i < node.inputs.length; i++) {
      const key = `${node.id}:${i}`;
      if (!connectedInputs.has(key)) {
        issues.push({ nodeId: node.id, portIndex: i, type: 'disconnected-input' });
      }
    }

    // Check for totally disconnected nodes
    if ((node.inputs.length > 0 || node.outputs.length > 0) && !connectedNodes.has(node.id)) {
      issues.push({ nodeId: node.id, portIndex: -1, type: 'no-connections' });
    }

    // Check for leaf nodes with unused outputs
    if (!TERMINAL_TYPES.has(node.type) && node.outputs.length > 0 && connectedNodes.has(node.id)) {
      const hasOutgoing = node.outputs.some((_, i) => connectedOutputs.has(`${node.id}:${i}`));
      if (!hasOutgoing) {
        issues.push({ nodeId: node.id, portIndex: -1, type: 'disconnected-output' });
      }
    }
  }

  return issues;
}

/**
 * Validate a single node: port types, data shape, and expression syntax.
 * Returns issues specific to this node (does not check graph-level concerns
 * like disconnected ports — use `validateGraph` for those).
 */
export function validateNode(
  nodeId: string,
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
): ValidationIssue[] {
  const node = nodes[nodeId];
  if (!node) return [];

  const issues: ValidationIssue[] = [];

  // --- Port type shape validation ---
  for (let i = 0; i < node.inputs.length; i++) {
    const port = node.inputs[i];
    if (!port.id || typeof port.id !== 'string') {
      issues.push({ nodeId, portIndex: i, type: 'invalid-data', message: `Input port ${i} has invalid or missing id` });
    }
    if (!port.portType || !VALID_PORT_TYPES.has(port.portType)) {
      issues.push({ nodeId, portIndex: i, type: 'invalid-data', message: `Input port ${i} has invalid type "${port.portType}"` });
    }
  }
  for (let i = 0; i < node.outputs.length; i++) {
    const port = node.outputs[i];
    if (!port.id || typeof port.id !== 'string') {
      issues.push({ nodeId, portIndex: i, type: 'invalid-data', message: `Output port ${i} has invalid or missing id` });
    }
    if (!port.portType || !VALID_PORT_TYPES.has(port.portType)) {
      issues.push({ nodeId, portIndex: i, type: 'invalid-data', message: `Output port ${i} has invalid type "${port.portType}"` });
    }
  }

  // --- Connection port type mismatches for this node ---
  for (const conn of Object.values(connections)) {
    if (conn.targetNodeId !== nodeId) continue;
    const srcNode = nodes[conn.sourceNodeId];
    if (!srcNode) continue;
    const srcPort = srcNode.outputs[conn.sourcePortIndex];
    const tgtPort = node.inputs[conn.targetPortIndex];
    if (!srcPort || !tgtPort) continue;
    if (srcPort.portType !== 'any' && tgtPort.portType !== 'any' && srcPort.portType !== tgtPort.portType) {
      issues.push({
        nodeId,
        portIndex: conn.targetPortIndex,
        type: 'type-mismatch',
        message: `Type mismatch on "${tgtPort.label}": ${srcPort.portType} → ${tgtPort.portType}`,
      });
    }
  }

  // --- Data shape validation ---
  if (typeof node.data !== 'object' || node.data === null || Array.isArray(node.data)) {
    issues.push({ nodeId, portIndex: -1, type: 'invalid-data', message: 'Node data is not a valid object' });
    return issues; // Can't validate further if data is corrupt
  }

  // --- Expression syntax validation (for expression-based node types) ---
  if (EXPRESSION_NODE_TYPES.has(node.type)) {
    const expression = node.data.expression;
    if (expression !== undefined && expression !== null) {
      if (typeof expression !== 'string') {
        issues.push({ nodeId, portIndex: -1, type: 'invalid-expression', message: 'Expression must be a string' });
      } else if (expression.trim().length > 0) {
        // Try to compile the expression to check syntax
        try {
          // Use the same compilation pattern as executionProcessors
          new Function('x', `"use strict"; return (() => (${expression}))()`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          issues.push({ nodeId, portIndex: -1, type: 'invalid-expression', message: `Expression syntax error: ${msg}` });
        }
      }
    }
  }

  // --- Variable name validation for get-var/set-var nodes ---
  if (node.type === 'get-var' || node.type === 'set-var') {
    const varName = node.data.variableName;
    if (!varName || typeof varName !== 'string' || varName.trim().length === 0) {
      issues.push({ nodeId, portIndex: -1, type: 'invalid-data', message: 'Variable name is not configured' });
    }
  }

  // --- Subgraph node validation ---
  if (node.type === 'subgraph') {
    const innerGraphId = node.data.innerGraphId;
    if (!innerGraphId || typeof innerGraphId !== 'string') {
      issues.push({ nodeId, portIndex: -1, type: 'invalid-data', message: 'Subgraph has no inner graph configured' });
    }
  }

  return issues;
}

/**
 * Validate and sanitize graph variables on load.
 * Returns a clean Record<string, unknown> with invalid entries removed.
 * Invalid entries: non-object root, non-string keys, non-serializable values.
 */
export function validateGraphVariables(
  raw: unknown,
): { variables: Record<string, unknown>; issues: string[] } {
  const issues: string[] = [];

  // Must be a plain object
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push('Graph variables must be a plain object, got ' + (Array.isArray(raw) ? 'array' : typeof raw));
    return { variables: {}, issues };
  }

  const variables: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    // Keys must be non-empty strings (guaranteed by Object.entries, but check trimmed)
    if (key.trim().length === 0) {
      issues.push('Skipped variable with empty key');
      continue;
    }

    // Values must be JSON-serializable (no functions, symbols, undefined)
    if (typeof value === 'function' || typeof value === 'symbol') {
      issues.push(`Skipped variable "${key}": value is ${typeof value}`);
      continue;
    }
    if (value === undefined) {
      issues.push(`Skipped variable "${key}": value is undefined`);
      continue;
    }

    // Test serialization round-trip
    try {
      JSON.stringify(value);
      variables[key] = value;
    } catch {
      issues.push(`Skipped variable "${key}": value is not serializable`);
    }
  }

  return { variables, issues };
}
