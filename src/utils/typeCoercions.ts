/**
 * Connection type coercion registry.
 *
 * When connecting incompatible port types, auto-inserts a conversion node
 * to bridge the type gap. For example:
 * - number → string: inserts a 'template' node
 * - vec3 → number: inserts a 'decompose-vec3' node (extracts x)
 * - string → number: inserts a 'parse-number' node
 *
 * The coercion registry maps (sourcePortType, targetPortType) → conversion config.
 */
import type { NodeType, PortType } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoercionRule {
  /** Node type to auto-insert */
  converterType: NodeType;
  /** Input port index on the converter that accepts the source type */
  inputPortIndex: number;
  /** Output port index on the converter that produces the target type */
  outputPortIndex: number;
  /** Human-readable description of the coercion */
  description: string;
  /** Optional initial data to set on the converter node (e.g. { mode: '>' } for compare) */
  initialData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Coercion rules keyed by `${sourcePortType}→${targetPortType}`.
 * Only concrete type pairs are registered (not 'any').
 */
const COERCION_REGISTRY: Record<string, CoercionRule> = {
  // number → string: template node, wire number to input 1 (value, type 'any'),
  // output 0 produces string representation. Default template "{value}" converts number to string.
  'number→string': {
    converterType: 'template',
    inputPortIndex: 1, // 'value' port (portType: any)
    outputPortIndex: 0,
    description: 'Number to string',
  },
  // string → number: parse-number extracts numeric value from string
  'string→number': {
    converterType: 'parse-number',
    inputPortIndex: 0,
    outputPortIndex: 0,
    description: 'String to number',
  },
  // vector3 → number: decompose-vec3 extracts x component
  'vector3→number': {
    converterType: 'decompose-vec3',
    inputPortIndex: 0,
    outputPortIndex: 0, // x component
    description: 'Extract X from vector',
  },
  // number → vector3: compose-vec3 uses number as x component (y, z default to 0)
  'number→vector3': {
    converterType: 'compose-vec3',
    inputPortIndex: 0, // x input
    outputPortIndex: 0,
    description: 'Number to vector (X)',
  },
  // number → boolean: compare node (input > 0 = true)
  'number→boolean': {
    converterType: 'compare',
    inputPortIndex: 0,
    outputPortIndex: 0,
    description: 'Number to boolean (> 0)',
    initialData: { mode: '>' },
  },
  // boolean → string: template node, wire boolean to input 1 (value, type 'any')
  'boolean→string': {
    converterType: 'template',
    inputPortIndex: 1, // 'value' port (portType: any)
    outputPortIndex: 0,
    description: 'Boolean to string',
  },
  // array → string: json-stringify converts array to JSON string
  'array→string': {
    converterType: 'json-stringify',
    inputPortIndex: 0, // 'value' port (portType: any)
    outputPortIndex: 0,
    description: 'Array to JSON string',
  },
  // object → string: json-stringify converts object to JSON string
  'object→string': {
    converterType: 'json-stringify',
    inputPortIndex: 0, // 'value' port (portType: any)
    outputPortIndex: 0,
    description: 'Object to JSON string',
  },
  // string → array: json-parse interprets string as JSON array
  'string→array': {
    converterType: 'json-parse',
    inputPortIndex: 0, // 'json' port (portType: string)
    outputPortIndex: 0,
    description: 'Parse JSON string as array',
  },
  // string → object: json-parse interprets string as JSON object
  'string→object': {
    converterType: 'json-parse',
    inputPortIndex: 0, // 'json' port (portType: string)
    outputPortIndex: 0,
    description: 'Parse JSON string as object',
  },
  // object → array: object-values extracts values as an array
  'object→array': {
    converterType: 'object-values',
    inputPortIndex: 0, // 'object' port (portType: object)
    outputPortIndex: 0,
    description: 'Object values to array',
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a coercion rule for converting from sourceType to targetType.
 * Returns null if no coercion is available (types are incompatible
 * and cannot be auto-bridged).
 */
export function getCoercionRule(
  sourceType: PortType,
  targetType: PortType,
): CoercionRule | null {
  // No coercion needed for compatible types
  if (sourceType === targetType || sourceType === 'any' || targetType === 'any') {
    return null;
  }

  const key = `${sourceType}→${targetType}`;
  return COERCION_REGISTRY[key] ?? null;
}

/**
 * Check if a coercion is available between two port types.
 */
export function hasCoercion(
  sourceType: PortType,
  targetType: PortType,
): boolean {
  return getCoercionRule(sourceType, targetType) !== null;
}

/**
 * Get all available coercion rules.
 */
export function getAllCoercions(): { from: PortType; to: PortType; rule: CoercionRule }[] {
  return Object.entries(COERCION_REGISTRY).map(([key, rule]) => {
    const [from, to] = key.split('→') as [PortType, PortType];
    return { from, to, rule };
  });
}
