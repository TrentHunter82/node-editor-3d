export type NodeType =
  | 'source' | 'transform' | 'filter' | 'output'
  | 'math' | 'clamp' | 'remap'
  | 'sin' | 'cos' | 'tan' | 'abs' | 'floor' | 'ceil' | 'round' | 'log' | 'sqrt'
  | 'lerp'
  | 'concat' | 'template'
  | 'string-length' | 'string-trim' | 'string-split' | 'string-case' | 'parse-number'
  | 'compare' | 'switch'
  | 'and' | 'or' | 'not' | 'xor'
  | 'compose-vec3' | 'decompose-vec3'
  | 'dot-product' | 'cross-product' | 'normalize-vec3' | 'vec3-length'
  | 'mean' | 'median' | 'stddev' | 'min-array' | 'max-array'
  | 'note' | 'reroute' | 'random' | 'display'
  | 'timer' | 'color-picker' | 'color-mix' | 'hsl-to-rgb' | 'rgb-to-hsl' | 'http-fetch'
  | 'create-array' | 'get-element' | 'set-element' | 'array-length' | 'array-push' | 'array-filter' | 'array-map' | 'array-reduce'
  | 'create-object' | 'get-property' | 'set-property' | 'object-keys' | 'object-values' | 'merge-objects'
  | 'string-concat' | 'string-replace' | 'string-includes' | 'string-template'
  | 'if-gate' | 'select'
  | 'get-var' | 'set-var'
  | 'json-parse' | 'json-stringify' | 'base64-encode' | 'base64-decode' | 'uri-encode' | 'uri-decode'
  | 'array-slice' | 'array-find' | 'array-sort' | 'array-reverse' | 'array-flatten' | 'array-zip' | 'array-unique'
  | 'get-timestamp' | 'format-date' | 'parse-date'
  | 'custom'
  | 'subgraph' | 'subgraph-input' | 'subgraph-output';

export type PortType = 'number' | 'string' | 'vector3' | 'color' | 'boolean' | 'array' | 'object' | 'image' | 'any';

export interface PortDef {
  id: string;
  label: string;
  portType: PortType;
  /** Human-readable description shown in tooltips */
  description?: string;
  /** Default value used when port is disconnected */
  defaultValue?: unknown;
  /** Minimum allowed value (for number ports) */
  min?: number;
  /** Maximum allowed value (for number ports) */
  max?: number;
}

export interface EditorNode {
  id: string;
  type: NodeType;
  position: [number, number, number];
  title: string;
  data: Record<string, unknown>;
  inputs: PortDef[];
  outputs: PortDef[];
  groupId?: string;
  collapsed?: boolean;
  /** Optional user annotation/comment for this node */
  comment?: string;
  /** When true, node cannot be moved, deleted, or have data edited */
  locked?: boolean;
  /** When true, node was auto-inserted by the type coercion system */
  autoInserted?: boolean;
  /** Optional custom width (X axis, world units). Defaults to NODE_W (1.6) if unset. */
  width?: number;
  /** Optional custom height (Z axis / depth, world units). Defaults to NODE_D (0.8) if unset. */
  height?: number;
}

export interface NodeGroup {
  id: string;
  label: string;
  collapsed: boolean;
  /** Optional user-chosen color override (hex string). Falls back to palette-derived color if unset. */
  color?: string;
  /** Optional description/notes for the group */
  description?: string;
}

export interface Connection {
  id: string;
  sourceNodeId: string;
  sourcePortIndex: number;
  targetNodeId: string;
  targetPortIndex: number;
  /** Optional user-defined label displayed on the connection */
  label?: string;
  /** Optional color override (hex string) for the connection line */
  colorOverride?: string;
  /** Optional per-connection rendering style override */
  styleOverride?: 'bezier' | 'straight' | 'right-angle' | 'organic';
}

export type InteractionMode =
  | 'idle'
  | 'dragging-node'
  | 'drawing-connection'
  | 'box-selecting'
  | 'resizing-node';

export interface ContextMenuState {
  /** Screen-space pixel position */
  x: number;
  y: number;
  /** What was right-clicked */
  target:
    | { kind: 'canvas' }
    | { kind: 'node'; nodeId: string }
    | { kind: 'connection'; connectionId: string }
    | { kind: 'port-release'; sourceNodeId: string; sourcePortIndex: number }
    | { kind: 'port'; nodeId: string; portIndex: number; portType: 'input' | 'output' };
}

export interface PendingConnection {
  sourceNodeId: string;
  sourcePortIndex: number;
  cursorPos: [number, number, number];
}

export type ExecutionState = 'idle' | 'running' | 'complete' | 'error';

/** Error handling strategy for graph execution */
export type ErrorStrategy = 'fail-fast' | 'continue';

/** Per-node execution metrics collected during graph execution */
export interface NodeExecutionMetric {
  /** Time in milliseconds for this node's processor to execute */
  duration: number;
  /** Whether the result was served from cache */
  cacheHit: boolean;
  /** Timestamp when the node started executing */
  timestamp: number;
}

/** Port type compatibility: 'any' is compatible with everything, otherwise exact match required */
export function isPortTypeCompatible(source: PortType, target: PortType): boolean {
  if (source === 'any' || target === 'any') return true;
  // Image payloads are URL strings — allow wiring them to/from string ports.
  if ((source === 'image' && target === 'string') || (source === 'string' && target === 'image')) return true;
  return source === target;
}

export interface PortConfig {
  label: string;
  portType: PortType;
  /** Human-readable description for tooltips */
  description?: string;
  /** Default value when port is disconnected */
  defaultValue?: unknown;
  /** Minimum value (number ports) */
  min?: number;
  /** Maximum value (number ports) */
  max?: number;
}

/** User-defined custom node definition */
export interface CustomNodeDef {
  id: string;
  name: string;
  color: string;
  category: string;
  inputs: PortConfig[];
  outputs: PortConfig[];
  expression: string;
}

/** Definition for a subgraph node - maps exposed ports to inner graph inputs/outputs */
export interface SubgraphNodeDef {
  id: string;
  name: string;
  /** The graph ID that contains the inner graph */
  innerGraphId: string;
  /** Maps exposed input port index → inner subgraph-input node ID */
  exposedInputs: { portIndex: number; innerNodeId: string }[];
  /** Maps exposed output port index → inner subgraph-output node ID */
  exposedOutputs: { portIndex: number; innerNodeId: string }[];
}

/** Named checkpoint for a graph state snapshot */
export interface CheckpointEntry {
  id: string;
  label: string;
  createdAt: number;
  snapshot: {
    nodes: Record<string, EditorNode>;
    connections: Record<string, Connection>;
    groups: Record<string, NodeGroup>;
    customNodeDefs: Record<string, CustomNodeDef>;
    subgraphDefs: Record<string, SubgraphNodeDef>;
    graphVariables?: Record<string, unknown>;
  };
}

/** Editable data field shown on a plugin node's screen (mirrors nodeFields.FieldDef). */
export interface PluginFieldDef {
  key: string;
  label: string;
  type: 'number' | 'text' | 'select' | 'color' | 'textarea' | 'boolean';
  options?: string[];
}

/** Plugin node definition registered at runtime */
export interface PluginNodeDef {
  /** Unique type identifier (must not collide with built-in NodeType) */
  type: string;
  /** Display name */
  name: string;
  /** Node color (e.g., 'teal', 'orange', 'coral') */
  color: string;
  /** Category for node palette grouping */
  category: string;
  /** Input port configuration */
  inputs: PortConfig[];
  /** Output port configuration */
  outputs: PortConfig[];
  /** Processor function: receives (node, inputs) and returns output values */
  processor: (node: EditorNode, inputs: Record<number, unknown>) => Record<number, unknown>;
  /** Editable data fields rendered on the node screen (like built-in NODE_SCREEN_FIELDS). */
  screenFields?: PluginFieldDef[];
}

/** Cumulative execution statistics for a graph */
export interface ExecutionStats {
  /** Total number of executions run */
  executionCount: number;
  /** Total accumulated duration across all executions (ms) */
  totalDuration: number;
  /** Total number of errors encountered */
  errorCount: number;
  /** Total cache hits across all executions */
  totalCacheHits: number;
  /** Total nodes executed (for cache hit rate calculation) */
  totalNodesExecuted: number;
  /** Timestamp of last execution */
  lastExecutedAt: number | null;
  /** Total number of executions that timed out */
  timeoutCount: number;
}

/** Persisted graph data (nodes, connections, groups, custom defs) */
export interface GraphData {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups: Record<string, NodeGroup>;
  customNodeDefs: Record<string, CustomNodeDef>;
  /** Subgraph definitions owned by this graph (maps subgraph node ID → def) */
  subgraphDefs?: Record<string, SubgraphNodeDef>;
  /** Error handling strategy for this graph's execution */
  errorStrategy?: ErrorStrategy;
  /** Optional: parent graph ID if this is a subgraph's inner graph */
  parentGraphId?: string;
  /** Optional: the subgraph node ID in the parent graph that owns this inner graph */
  parentNodeId?: string;
  /** Named checkpoints for this graph (max 20) */
  checkpoints?: Record<string, CheckpointEntry>;
  /** Per-graph variable store for get-var/set-var nodes */
  graphVariables?: Record<string, unknown>;
  /** Cumulative execution statistics for this graph */
  executionStats?: ExecutionStats;
}

/** Metadata for a graph tab */
export interface GraphTab {
  id: string;
  name: string;
  createdAt: number;
  /** Optional description of the graph's purpose */
  description?: string;
  /** Optional author name */
  author?: string;
  /** Optional tags for categorization */
  tags?: string[];
}

/** Node template for save/instantiate workflow */
export interface NodeTemplate {
  id: string;
  name: string;
  category: string;
  nodes: EditorNode[];
  connections: Connection[];
  createdAt: number;
}

/** Port type → color for visual distinction */
export const PORT_TYPE_COLORS: Record<PortType, string> = {
  number: '#FFD700',   // gold
  string: '#00CED1',   // cyan
  vector3: '#FF00FF',  // magenta
  color: '#FFFFFF',    // white
  boolean: '#44DD88',  // green
  array: '#FF8C42',    // orange
  object: '#9B59B6',   // purple
  image: '#E84393',    // pink — image handle (URL payload)
  any: '#888888',      // gray
};

/** Category metadata for toolbar grouping */
export type NodeCategory = 'Core' | 'Math' | 'String' | 'Logic' | 'Vector' | 'Utility' | 'Color' | 'Live' | 'Data' | 'Subgraph';

export const NODE_CATEGORIES: Record<NodeType, NodeCategory> = {
  source: 'Core', transform: 'Core', filter: 'Core', output: 'Core',
  math: 'Math', clamp: 'Math', remap: 'Math',
  sin: 'Math', cos: 'Math', tan: 'Math', abs: 'Math',
  floor: 'Math', ceil: 'Math', round: 'Math', log: 'Math', sqrt: 'Math',
  lerp: 'Math',
  concat: 'String', template: 'String',
  'string-length': 'String', 'string-trim': 'String', 'string-split': 'String',
  'string-case': 'String', 'parse-number': 'String',
  compare: 'Logic', switch: 'Logic',
  and: 'Logic', or: 'Logic', not: 'Logic', xor: 'Logic',
  'compose-vec3': 'Vector', 'decompose-vec3': 'Vector',
  'dot-product': 'Vector', 'cross-product': 'Vector', 'normalize-vec3': 'Vector', 'vec3-length': 'Vector',
  mean: 'Math', median: 'Math', stddev: 'Math', 'min-array': 'Math', 'max-array': 'Math',
  note: 'Utility', reroute: 'Utility', random: 'Utility', display: 'Utility',
  timer: 'Live', 'http-fetch': 'Live',
  'color-picker': 'Color', 'color-mix': 'Color', 'hsl-to-rgb': 'Color', 'rgb-to-hsl': 'Color',
  'create-array': 'Data', 'get-element': 'Data', 'set-element': 'Data',
  'array-length': 'Data', 'array-push': 'Data', 'array-filter': 'Data', 'array-map': 'Data', 'array-reduce': 'Data',
  'create-object': 'Data', 'get-property': 'Data', 'set-property': 'Data',
  'object-keys': 'Data', 'object-values': 'Data', 'merge-objects': 'Data',
  'string-concat': 'String', 'string-replace': 'String', 'string-includes': 'String', 'string-template': 'String',
  'if-gate': 'Logic', select: 'Logic',
  'get-var': 'Data', 'set-var': 'Data',
  'json-parse': 'Data', 'json-stringify': 'Data',
  'base64-encode': 'Data', 'base64-decode': 'Data',
  'uri-encode': 'Data', 'uri-decode': 'Data',
  'array-slice': 'Data', 'array-find': 'Data', 'array-sort': 'Data',
  'array-reverse': 'Data', 'array-flatten': 'Data', 'array-zip': 'Data', 'array-unique': 'Data',
  'get-timestamp': 'Utility', 'format-date': 'Utility', 'parse-date': 'Utility',
  custom: 'Utility',
  subgraph: 'Subgraph', 'subgraph-input': 'Subgraph', 'subgraph-output': 'Subgraph',
};

export const NODE_TYPE_CONFIG: Record<
  NodeType,
  { color: string; inputs: PortConfig[]; outputs: PortConfig[] }
> = {
  // --- Core ---
  source: {
    color: 'teal',
    inputs: [],
    outputs: [
      { label: 'value', portType: 'number', description: 'The numeric value of this source', defaultValue: 0 },
      { label: 'label', portType: 'string', description: 'Display label for this source' },
    ],
  },
  transform: {
    color: 'orange',
    inputs: [
      { label: 'in', portType: 'number', description: 'Input value to transform', defaultValue: 0 },
      { label: 'factor', portType: 'number', description: 'Multiplication factor', defaultValue: 1 },
    ],
    outputs: [
      { label: 'result', portType: 'number', description: 'in × factor + offset' },
      { label: 'debug', portType: 'string', description: 'Formatted calculation string' },
    ],
  },
  filter: {
    color: 'coral',
    inputs: [
      { label: 'in', portType: 'any', description: 'Value to filter based on threshold' },
    ],
    outputs: [
      { label: 'out', portType: 'any', description: 'Passes value if condition met, null otherwise' },
    ],
  },
  output: {
    color: 'teal-coral',
    inputs: [
      { label: 'data', portType: 'any', description: 'Data to output' },
      { label: 'label', portType: 'string', description: 'Output label' },
    ],
    outputs: [],
  },

  // --- Math ---
  math: {
    color: 'orange',
    inputs: [
      { label: 'a', portType: 'number', description: 'First operand', defaultValue: 0 },
      { label: 'b', portType: 'number', description: 'Second operand', defaultValue: 0 },
    ],
    outputs: [
      { label: 'result', portType: 'number', description: 'Result of a ○ b (operation set in data)' },
    ],
  },
  clamp: {
    color: 'orange',
    inputs: [
      { label: 'value', portType: 'number', description: 'Value to clamp', defaultValue: 0 },
      { label: 'min', portType: 'number', description: 'Lower bound', defaultValue: 0, min: -Infinity },
      { label: 'max', portType: 'number', description: 'Upper bound', defaultValue: 1, max: Infinity },
    ],
    outputs: [
      { label: 'result', portType: 'number', description: 'Clamped value between min and max' },
    ],
  },
  remap: {
    color: 'orange',
    inputs: [
      { label: 'value', portType: 'number', description: 'Value to remap', defaultValue: 0 },
      { label: 'inMin', portType: 'number', description: 'Input range minimum', defaultValue: 0 },
      { label: 'inMax', portType: 'number', description: 'Input range maximum', defaultValue: 1 },
      { label: 'outMin', portType: 'number', description: 'Output range minimum', defaultValue: 0 },
      { label: 'outMax', portType: 'number', description: 'Output range maximum', defaultValue: 1 },
    ],
    outputs: [
      { label: 'result', portType: 'number', description: 'Value remapped from [inMin,inMax] to [outMin,outMax]' },
    ],
  },
  sin: {
    color: 'orange',
    inputs: [{ label: 'angle', portType: 'number', description: 'Angle in radians', defaultValue: 0 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Sine of angle' }],
  },
  cos: {
    color: 'orange',
    inputs: [{ label: 'angle', portType: 'number', description: 'Angle in radians', defaultValue: 0 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Cosine of angle' }],
  },
  tan: {
    color: 'orange',
    inputs: [{ label: 'angle', portType: 'number', description: 'Angle in radians', defaultValue: 0 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Tangent of angle' }],
  },
  abs: {
    color: 'orange',
    inputs: [{ label: 'value', portType: 'number', description: 'Input value', defaultValue: 0 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Absolute value' }],
  },
  floor: {
    color: 'orange',
    inputs: [{ label: 'value', portType: 'number', description: 'Input value', defaultValue: 0 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Largest integer ≤ value' }],
  },
  ceil: {
    color: 'orange',
    inputs: [{ label: 'value', portType: 'number', description: 'Input value', defaultValue: 0 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Smallest integer ≥ value' }],
  },
  round: {
    color: 'orange',
    inputs: [{ label: 'value', portType: 'number', description: 'Input value', defaultValue: 0 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Nearest integer' }],
  },
  log: {
    color: 'orange',
    inputs: [{ label: 'value', portType: 'number', description: 'Input value (must be > 0)', defaultValue: 1 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Natural logarithm (base e)' }],
  },
  sqrt: {
    color: 'orange',
    inputs: [{ label: 'value', portType: 'number', description: 'Input value (must be ≥ 0)', defaultValue: 0 }],
    outputs: [{ label: 'result', portType: 'number', description: 'Square root' }],
  },
  lerp: {
    color: 'orange',
    inputs: [
      { label: 'a', portType: 'number', description: 'Start value', defaultValue: 0 },
      { label: 'b', portType: 'number', description: 'End value', defaultValue: 1 },
      { label: 't', portType: 'number', description: 'Interpolation factor (0–1)', defaultValue: 0.5, min: 0, max: 1 },
    ],
    outputs: [{ label: 'result', portType: 'number', description: 'Linear interpolation: a + (b - a) × t' }],
  },

  // --- String ---
  concat: {
    color: 'teal',
    inputs: [
      { label: 'a', portType: 'string', description: 'First string' },
      { label: 'b', portType: 'string', description: 'Second string' },
    ],
    outputs: [
      { label: 'result', portType: 'string', description: 'Concatenation of a + b' },
    ],
  },
  template: {
    color: 'teal',
    inputs: [
      { label: 'template', portType: 'string', description: 'Template string with {value} placeholder' },
      { label: 'value', portType: 'any', description: 'Value to substitute into {value}' },
    ],
    outputs: [
      { label: 'result', portType: 'string', description: 'Template with {value} replaced' },
    ],
  },
  'string-length': {
    color: 'teal',
    inputs: [{ label: 'str', portType: 'string', description: 'Input string' }],
    outputs: [{ label: 'length', portType: 'number', description: 'Number of characters' }],
  },
  'string-trim': {
    color: 'teal',
    inputs: [{ label: 'str', portType: 'string', description: 'Input string' }],
    outputs: [{ label: 'result', portType: 'string', description: 'String with whitespace trimmed' }],
  },
  'string-split': {
    color: 'teal',
    inputs: [
      { label: 'str', portType: 'string', description: 'Input string to split' },
      { label: 'delimiter', portType: 'string', description: 'Delimiter to split on' },
    ],
    outputs: [
      { label: 'first', portType: 'string', description: 'First part before delimiter' },
      { label: 'rest', portType: 'string', description: 'Remaining parts after first delimiter' },
      { label: 'count', portType: 'number', description: 'Number of parts' },
    ],
  },
  'string-case': {
    color: 'teal',
    inputs: [{ label: 'str', portType: 'string', description: 'Input string' }],
    outputs: [
      { label: 'upper', portType: 'string', description: 'UPPERCASE version' },
      { label: 'lower', portType: 'string', description: 'lowercase version' },
    ],
  },
  'parse-number': {
    color: 'teal',
    inputs: [{ label: 'str', portType: 'string', description: 'String containing a number' }],
    outputs: [
      { label: 'value', portType: 'number', description: 'Parsed numeric value (0 if invalid)' },
      { label: 'valid', portType: 'boolean', description: 'True if string was a valid number' },
    ],
  },

  // --- Logic ---
  compare: {
    color: 'coral',
    inputs: [
      { label: 'a', portType: 'number', description: 'Left-hand side of comparison', defaultValue: 0 },
      { label: 'b', portType: 'number', description: 'Right-hand side of comparison', defaultValue: 0 },
    ],
    outputs: [
      { label: 'result', portType: 'boolean', description: 'True if comparison passes (mode set in data)' },
    ],
  },
  switch: {
    color: 'coral',
    inputs: [
      { label: 'value', portType: 'any', description: 'Value to match against cases' },
      { label: 'case0', portType: 'any', description: 'Case 0 match value' },
      { label: 'case1', portType: 'any', description: 'Case 1 match value' },
      { label: 'case2', portType: 'any', description: 'Case 2 match value' },
      { label: 'case3', portType: 'any', description: 'Case 3 match value' },
      { label: 'default', portType: 'any', description: 'Default value if no case matches' },
    ],
    outputs: [
      { label: 'result', portType: 'any', description: 'Matched case value or default' },
    ],
  },
  and: {
    color: 'coral',
    inputs: [
      { label: 'a', portType: 'boolean', description: 'First boolean operand' },
      { label: 'b', portType: 'boolean', description: 'Second boolean operand' },
    ],
    outputs: [{ label: 'result', portType: 'boolean', description: 'True if both a AND b are true' }],
  },
  or: {
    color: 'coral',
    inputs: [
      { label: 'a', portType: 'boolean', description: 'First boolean operand' },
      { label: 'b', portType: 'boolean', description: 'Second boolean operand' },
    ],
    outputs: [{ label: 'result', portType: 'boolean', description: 'True if a OR b is true' }],
  },
  not: {
    color: 'coral',
    inputs: [{ label: 'value', portType: 'boolean', description: 'Boolean value to negate' }],
    outputs: [{ label: 'result', portType: 'boolean', description: 'Logical NOT of value' }],
  },
  xor: {
    color: 'coral',
    inputs: [
      { label: 'a', portType: 'boolean', description: 'First boolean operand' },
      { label: 'b', portType: 'boolean', description: 'Second boolean operand' },
    ],
    outputs: [{ label: 'result', portType: 'boolean', description: 'True if exactly one of a, b is true' }],
  },

  // --- Vector ---
  'compose-vec3': {
    color: 'orange',
    inputs: [
      { label: 'x', portType: 'number', description: 'X component', defaultValue: 0 },
      { label: 'y', portType: 'number', description: 'Y component', defaultValue: 0 },
      { label: 'z', portType: 'number', description: 'Z component', defaultValue: 0 },
    ],
    outputs: [
      { label: 'vector', portType: 'vector3', description: 'Combined [x, y, z] vector' },
    ],
  },
  'decompose-vec3': {
    color: 'orange',
    inputs: [
      { label: 'vector', portType: 'vector3', description: 'Vector3 to decompose into components' },
    ],
    outputs: [
      { label: 'x', portType: 'number', description: 'X component of the vector' },
      { label: 'y', portType: 'number', description: 'Y component of the vector' },
      { label: 'z', portType: 'number', description: 'Z component of the vector' },
    ],
  },
  'dot-product': {
    color: 'orange',
    inputs: [
      { label: 'a', portType: 'vector3', description: 'First vector' },
      { label: 'b', portType: 'vector3', description: 'Second vector' },
    ],
    outputs: [
      { label: 'dot', portType: 'number', description: 'Dot product (a · b)' },
    ],
  },
  'cross-product': {
    color: 'orange',
    inputs: [
      { label: 'a', portType: 'vector3', description: 'First vector' },
      { label: 'b', portType: 'vector3', description: 'Second vector' },
    ],
    outputs: [
      { label: 'cross', portType: 'vector3', description: 'Cross product (a × b)' },
    ],
  },
  'normalize-vec3': {
    color: 'orange',
    inputs: [
      { label: 'vector', portType: 'vector3', description: 'Vector to normalize' },
    ],
    outputs: [
      { label: 'normalized', portType: 'vector3', description: 'Unit vector in same direction' },
    ],
  },
  'vec3-length': {
    color: 'orange',
    inputs: [
      { label: 'vector', portType: 'vector3', description: 'Vector to measure' },
    ],
    outputs: [
      { label: 'length', portType: 'number', description: 'Euclidean length (magnitude)' },
    ],
  },

  // --- Statistics (array) ---
  mean: {
    color: 'orange',
    inputs: [
      { label: 'array', portType: 'array', description: 'Array of numbers' },
    ],
    outputs: [
      { label: 'mean', portType: 'number', description: 'Arithmetic mean' },
    ],
  },
  median: {
    color: 'orange',
    inputs: [
      { label: 'array', portType: 'array', description: 'Array of numbers' },
    ],
    outputs: [
      { label: 'median', portType: 'number', description: 'Median value' },
    ],
  },
  stddev: {
    color: 'orange',
    inputs: [
      { label: 'array', portType: 'array', description: 'Array of numbers' },
    ],
    outputs: [
      { label: 'stddev', portType: 'number', description: 'Standard deviation' },
    ],
  },
  'min-array': {
    color: 'orange',
    inputs: [
      { label: 'array', portType: 'array', description: 'Array of numbers' },
    ],
    outputs: [
      { label: 'min', portType: 'number', description: 'Minimum value in array' },
    ],
  },
  'max-array': {
    color: 'orange',
    inputs: [
      { label: 'array', portType: 'array', description: 'Array of numbers' },
    ],
    outputs: [
      { label: 'max', portType: 'number', description: 'Maximum value in array' },
    ],
  },

  // --- Color ---
  'color-picker': {
    color: 'coral',
    inputs: [],
    outputs: [
      { label: 'hex', portType: 'color', description: 'Hex color string (#RRGGBB)' },
      { label: 'r', portType: 'number', description: 'Red component (0-255)' },
      { label: 'g', portType: 'number', description: 'Green component (0-255)' },
      { label: 'b', portType: 'number', description: 'Blue component (0-255)' },
    ],
  },
  'color-mix': {
    color: 'coral',
    inputs: [
      { label: 'color1', portType: 'color', description: 'First color (hex string)' },
      { label: 'color2', portType: 'color', description: 'Second color (hex string)' },
      { label: 't', portType: 'number', description: 'Mix factor (0=color1, 1=color2)', defaultValue: 0.5, min: 0, max: 1 },
    ],
    outputs: [
      { label: 'result', portType: 'color', description: 'Mixed color (hex string)' },
    ],
  },
  'hsl-to-rgb': {
    color: 'coral',
    inputs: [
      { label: 'h', portType: 'number', description: 'Hue (0-360)', defaultValue: 0, min: 0, max: 360 },
      { label: 's', portType: 'number', description: 'Saturation (0-100)', defaultValue: 100, min: 0, max: 100 },
      { label: 'l', portType: 'number', description: 'Lightness (0-100)', defaultValue: 50, min: 0, max: 100 },
    ],
    outputs: [
      { label: 'hex', portType: 'color', description: 'RGB hex color string' },
      { label: 'r', portType: 'number', description: 'Red component (0-255)' },
      { label: 'g', portType: 'number', description: 'Green component (0-255)' },
      { label: 'b', portType: 'number', description: 'Blue component (0-255)' },
    ],
  },
  'rgb-to-hsl': {
    color: 'coral',
    inputs: [
      { label: 'r', portType: 'number', description: 'Red component (0-255)', defaultValue: 0, min: 0, max: 255 },
      { label: 'g', portType: 'number', description: 'Green component (0-255)', defaultValue: 0, min: 0, max: 255 },
      { label: 'b', portType: 'number', description: 'Blue component (0-255)', defaultValue: 0, min: 0, max: 255 },
    ],
    outputs: [
      { label: 'h', portType: 'number', description: 'Hue (0-360)' },
      { label: 's', portType: 'number', description: 'Saturation (0-100)' },
      { label: 'l', portType: 'number', description: 'Lightness (0-100)' },
    ],
  },

  // --- Live ---
  timer: {
    color: 'teal',
    inputs: [],
    outputs: [
      { label: 'tick', portType: 'number', description: 'Current tick value (Date.now() modulo intervalMs)' },
    ],
  },
  'http-fetch': {
    color: 'teal',
    inputs: [
      { label: 'url', portType: 'string', description: 'URL to fetch data from' },
      { label: 'trigger', portType: 'any', description: 'Any truthy value triggers the fetch' },
    ],
    outputs: [
      { label: 'data', portType: 'any', description: 'Fetched response data (parsed JSON or text)' },
      { label: 'status', portType: 'number', description: 'HTTP status code (0 if not fetched)' },
      { label: 'error', portType: 'string', description: 'Error message if fetch failed' },
    ],
  },

  // --- Utility ---
  note: {
    color: 'teal',
    inputs: [],
    outputs: [],
  },
  reroute: {
    color: 'teal',
    inputs: [
      { label: 'in', portType: 'any', description: 'Passthrough input' },
    ],
    outputs: [
      { label: 'out', portType: 'any', description: 'Same value as input' },
    ],
  },
  random: {
    color: 'teal',
    inputs: [],
    outputs: [
      { label: 'value', portType: 'number', description: 'Random number between min and max (set in data)' },
    ],
  },
  display: {
    color: 'teal-coral',
    inputs: [
      { label: 'value', portType: 'any', description: 'Value to display' },
    ],
    outputs: [],
  },

  // --- Data (array manipulation + variables) ---
  'create-array': {
    color: 'teal-coral',
    inputs: [
      { label: 'item0', portType: 'any', description: 'First array element' },
      { label: 'item1', portType: 'any', description: 'Second array element' },
      { label: 'item2', portType: 'any', description: 'Third array element' },
      { label: 'item3', portType: 'any', description: 'Fourth array element' },
    ],
    outputs: [
      { label: 'array', portType: 'array', description: 'Array of connected input values' },
    ],
  },
  'get-element': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Input array' },
      { label: 'index', portType: 'number', description: 'Element index (0-based)', defaultValue: 0 },
    ],
    outputs: [
      { label: 'value', portType: 'any', description: 'Element at the given index' },
    ],
  },
  'set-element': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Input array' },
      { label: 'index', portType: 'number', description: 'Index to set (0-based)', defaultValue: 0 },
      { label: 'value', portType: 'any', description: 'Value to set at index' },
    ],
    outputs: [
      { label: 'array', portType: 'array', description: 'Array with updated element' },
    ],
  },
  'array-length': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Input array' },
    ],
    outputs: [
      { label: 'length', portType: 'number', description: 'Number of elements' },
    ],
  },
  'array-push': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Input array' },
      { label: 'value', portType: 'any', description: 'Value to append' },
    ],
    outputs: [
      { label: 'array', portType: 'array', description: 'Array with appended element' },
    ],
  },
  'array-filter': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Input array to filter' },
    ],
    outputs: [
      { label: 'array', portType: 'array', description: 'Filtered array' },
    ],
  },
  'array-map': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Input array to transform' },
    ],
    outputs: [
      { label: 'array', portType: 'array', description: 'Transformed array' },
    ],
  },
  'array-reduce': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Input array to reduce' },
      { label: 'initial', portType: 'any', description: 'Initial accumulator value', defaultValue: 0 },
    ],
    outputs: [
      { label: 'result', portType: 'any', description: 'Accumulated result' },
    ],
  },

  // --- Object/Dictionary ---
  'create-object': {
    color: 'teal-coral',
    inputs: [
      { label: 'key0', portType: 'string', description: 'First key' },
      { label: 'val0', portType: 'any', description: 'First value' },
      { label: 'key1', portType: 'string', description: 'Second key' },
      { label: 'val1', portType: 'any', description: 'Second value' },
    ],
    outputs: [
      { label: 'object', portType: 'object', description: 'Created object' },
    ],
  },
  'get-property': {
    color: 'teal-coral',
    inputs: [
      { label: 'object', portType: 'object', description: 'Input object' },
      { label: 'key', portType: 'string', description: 'Property name to read' },
    ],
    outputs: [
      { label: 'value', portType: 'any', description: 'Property value' },
    ],
  },
  'set-property': {
    color: 'teal-coral',
    inputs: [
      { label: 'object', portType: 'object', description: 'Input object' },
      { label: 'key', portType: 'string', description: 'Property name to set' },
      { label: 'value', portType: 'any', description: 'Value to assign' },
    ],
    outputs: [
      { label: 'object', portType: 'object', description: 'Object with updated property' },
    ],
  },
  'object-keys': {
    color: 'teal-coral',
    inputs: [
      { label: 'object', portType: 'object', description: 'Input object' },
    ],
    outputs: [
      { label: 'keys', portType: 'array', description: 'Array of property names' },
    ],
  },
  'object-values': {
    color: 'teal-coral',
    inputs: [
      { label: 'object', portType: 'object', description: 'Input object' },
    ],
    outputs: [
      { label: 'values', portType: 'array', description: 'Array of property values' },
    ],
  },
  'merge-objects': {
    color: 'teal-coral',
    inputs: [
      { label: 'a', portType: 'object', description: 'First object' },
      { label: 'b', portType: 'object', description: 'Second object (overwrites a)' },
    ],
    outputs: [
      { label: 'object', portType: 'object', description: 'Merged object' },
    ],
  },

  // --- String enhancements ---
  'string-concat': {
    color: 'teal',
    inputs: [
      { label: 'a', portType: 'string', description: 'First string' },
      { label: 'b', portType: 'string', description: 'Second string' },
    ],
    outputs: [
      { label: 'result', portType: 'string', description: 'Concatenated string' },
    ],
  },
  'string-replace': {
    color: 'teal',
    inputs: [
      { label: 'str', portType: 'string', description: 'Input string' },
      { label: 'search', portType: 'string', description: 'Search pattern' },
      { label: 'replace', portType: 'string', description: 'Replacement text' },
    ],
    outputs: [
      { label: 'result', portType: 'string', description: 'String with replacements applied' },
    ],
  },
  'string-includes': {
    color: 'teal',
    inputs: [
      { label: 'str', portType: 'string', description: 'Input string to search in' },
      { label: 'search', portType: 'string', description: 'Substring to search for' },
    ],
    outputs: [
      { label: 'result', portType: 'boolean', description: 'True if string contains search' },
    ],
  },
  'string-template': {
    color: 'teal',
    inputs: [
      { label: 'template', portType: 'string', description: 'Template with ${in0}, ${in1}... placeholders' },
      { label: 'in0', portType: 'any', description: 'Value for ${in0}' },
      { label: 'in1', portType: 'any', description: 'Value for ${in1}' },
      { label: 'in2', portType: 'any', description: 'Value for ${in2}' },
      { label: 'in3', portType: 'any', description: 'Value for ${in3}' },
    ],
    outputs: [
      { label: 'result', portType: 'string', description: 'Formatted string with placeholders replaced' },
    ],
  },

  // --- Flow control ---
  'if-gate': {
    color: 'coral',
    inputs: [
      { label: 'condition', portType: 'boolean', description: 'Gate condition' },
      { label: 'true', portType: 'any', description: 'Value when condition is true' },
      { label: 'false', portType: 'any', description: 'Value when condition is false' },
    ],
    outputs: [
      { label: 'result', portType: 'any', description: 'Selected value based on condition' },
    ],
  },
  select: {
    color: 'coral',
    inputs: [
      { label: 'index', portType: 'number', description: 'Index to select (0-3)', defaultValue: 0 },
      { label: 'value0', portType: 'any', description: 'Value at index 0' },
      { label: 'value1', portType: 'any', description: 'Value at index 1' },
      { label: 'value2', portType: 'any', description: 'Value at index 2' },
      { label: 'value3', portType: 'any', description: 'Value at index 3' },
    ],
    outputs: [
      { label: 'result', portType: 'any', description: 'Value at the selected index' },
    ],
  },

  // --- Variables ---
  'get-var': {
    color: 'teal-coral',
    inputs: [],
    outputs: [
      { label: 'value', portType: 'any', description: 'Current variable value' },
    ],
  },
  'set-var': {
    color: 'teal-coral',
    inputs: [
      { label: 'value', portType: 'any', description: 'Value to store in the variable' },
    ],
    outputs: [
      { label: 'value', portType: 'any', description: 'Pass-through of stored value' },
    ],
  },

  // --- Encoding / Data Conversion ---
  'json-parse': {
    color: 'teal-coral',
    inputs: [{ label: 'json', portType: 'string', description: 'JSON string to parse' }],
    outputs: [{ label: 'value', portType: 'any', description: 'Parsed value' }],
  },
  'json-stringify': {
    color: 'teal-coral',
    inputs: [
      { label: 'value', portType: 'any', description: 'Value to serialize' },
      { label: 'pretty', portType: 'boolean', description: 'Pretty-print with indentation', defaultValue: false },
    ],
    outputs: [{ label: 'json', portType: 'string', description: 'JSON string' }],
  },
  'base64-encode': {
    color: 'teal-coral',
    inputs: [{ label: 'text', portType: 'string', description: 'Text to encode' }],
    outputs: [{ label: 'encoded', portType: 'string', description: 'Base64-encoded string' }],
  },
  'base64-decode': {
    color: 'teal-coral',
    inputs: [{ label: 'encoded', portType: 'string', description: 'Base64-encoded string' }],
    outputs: [{ label: 'text', portType: 'string', description: 'Decoded text' }],
  },
  'uri-encode': {
    color: 'teal-coral',
    inputs: [{ label: 'text', portType: 'string', description: 'Text to encode' }],
    outputs: [{ label: 'encoded', portType: 'string', description: 'URI-encoded string' }],
  },
  'uri-decode': {
    color: 'teal-coral',
    inputs: [{ label: 'encoded', portType: 'string', description: 'URI-encoded string' }],
    outputs: [{ label: 'text', portType: 'string', description: 'Decoded text' }],
  },

  // --- Advanced Array Operations ---
  'array-slice': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Input array' },
      { label: 'start', portType: 'number', description: 'Start index (inclusive)', defaultValue: 0 },
      { label: 'end', portType: 'number', description: 'End index (exclusive)' },
    ],
    outputs: [{ label: 'result', portType: 'array', description: 'Sliced sub-array' }],
  },
  'array-find': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Array to search' },
      { label: 'expr', portType: 'string', description: 'Expression (x, i) returning truthy for match' },
    ],
    outputs: [
      { label: 'value', portType: 'any', description: 'First matching element or null' },
      { label: 'index', portType: 'number', description: 'Index of match or -1' },
    ],
  },
  'array-sort': {
    color: 'teal-coral',
    inputs: [{ label: 'array', portType: 'array', description: 'Array to sort' }],
    outputs: [{ label: 'sorted', portType: 'array', description: 'Sorted array (ascending)' }],
  },
  'array-reverse': {
    color: 'teal-coral',
    inputs: [{ label: 'array', portType: 'array', description: 'Array to reverse' }],
    outputs: [{ label: 'reversed', portType: 'array', description: 'Reversed array' }],
  },
  'array-flatten': {
    color: 'teal-coral',
    inputs: [
      { label: 'array', portType: 'array', description: 'Nested array to flatten' },
      { label: 'depth', portType: 'number', description: 'Flatten depth (default 1)', defaultValue: 1 },
    ],
    outputs: [{ label: 'flat', portType: 'array', description: 'Flattened array' }],
  },
  'array-zip': {
    color: 'teal-coral',
    inputs: [
      { label: 'a', portType: 'array', description: 'First array' },
      { label: 'b', portType: 'array', description: 'Second array' },
    ],
    outputs: [{ label: 'zipped', portType: 'array', description: 'Array of [a[i], b[i]] pairs' }],
  },
  'array-unique': {
    color: 'teal-coral',
    inputs: [{ label: 'array', portType: 'array', description: 'Array with potential duplicates' }],
    outputs: [
      { label: 'unique', portType: 'array', description: 'Deduplicated array' },
      { label: 'count', portType: 'number', description: 'Number of unique elements' },
    ],
  },

  // --- Date / Time ---
  'get-timestamp': {
    color: 'coral',
    inputs: [],
    outputs: [{ label: 'timestamp', portType: 'number', description: 'Current epoch timestamp in milliseconds' }],
  },
  'format-date': {
    color: 'coral',
    inputs: [
      { label: 'timestamp', portType: 'number', description: 'Epoch timestamp in milliseconds' },
    ],
    outputs: [
      { label: 'iso', portType: 'string', description: 'ISO 8601 date string' },
      { label: 'date', portType: 'string', description: 'Date part (YYYY-MM-DD)' },
      { label: 'time', portType: 'string', description: 'Time part (HH:MM:SS)' },
    ],
  },
  'parse-date': {
    color: 'coral',
    inputs: [{ label: 'dateStr', portType: 'string', description: 'Date string to parse' }],
    outputs: [
      { label: 'timestamp', portType: 'number', description: 'Epoch timestamp in milliseconds' },
      { label: 'valid', portType: 'boolean', description: 'Whether the date string was valid' },
    ],
  },

  // --- Custom (ports set dynamically at creation from CustomNodeDef) ---
  custom: {
    color: 'teal',
    inputs: [],
    outputs: [],
  },

  // --- Subgraph (ports set dynamically from SubgraphNodeDef) ---
  subgraph: {
    color: 'coral',
    inputs: [],
    outputs: [],
  },
  // Subgraph boundary nodes (live inside a subgraph's inner graph)
  'subgraph-input': {
    color: 'teal',
    inputs: [],
    outputs: [{ label: 'value', portType: 'any', description: 'Data received from parent graph' }],
  },
  'subgraph-output': {
    color: 'teal-coral',
    inputs: [{ label: 'value', portType: 'any', description: 'Data to return to parent graph' }],
    outputs: [],
  },
};
