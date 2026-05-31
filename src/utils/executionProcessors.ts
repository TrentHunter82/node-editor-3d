/**
 * Execution processors — stateless node processor functions for all 93 built-in node types.
 *
 * Extracted from execution.ts for modularity. Contains:
 * - NodeProcessor type definition
 * - Expression sandboxing and LRU compilation cache
 * - All built-in processor functions (core, math, string, logic, vector, utility,
 *   statistics, color, live, custom, array, object, encoding, flow control,
 *   variables, date/time)
 * - Graph variables context (get-var/set-var support)
 */
import type { EditorNode, NodeType } from '../types';

/**
 * Node processor functions.
 * Each node type defines how it transforms input data to output data.
 */
export type NodeProcessor = (
  node: EditorNode,
  inputs: Record<number, unknown>,
) => Record<number, unknown>;

// Shadowed globals for expression sandboxing (used by custom nodes and array expression processors)
// Note: 'eval' cannot be a param name in strict mode, so it's excluded from shadows.
export const _sandboxedGlobals = [
  'window', 'globalThis', 'self', 'document', 'fetch', 'XMLHttpRequest',
  'localStorage', 'sessionStorage', 'indexedDB',
  'Function', 'importScripts', 'setTimeout', 'setInterval',
  'process', 'require', 'module', 'exports', '__dirname', '__filename',
];
export const _sandboxedValues = _sandboxedGlobals.map(() => undefined);

// A compiled expression: callable with the param values (positional) and returns
// the evaluated result. Args/return are unknown because expressions are dynamic.
type CompiledExpression = (...args: unknown[]) => unknown;

// Expression function cache: avoids recompilation of identical expressions across execution cycles
// Key format: `${signature}|${expression}` where signature = param names joined
const _expressionCache = new Map<string, CompiledExpression>();
const MAX_EXPRESSION_CACHE_SIZE = 256;

/** Get or compile an expression function with the given parameter names.
 * Uses LRU eviction: most-recently-used entries survive, least-recently-used are evicted. */
export function getCompiledExpression(paramNames: string[], expression: string): CompiledExpression {
  const key = paramNames.join(',') + '|' + expression;
  let fn = _expressionCache.get(key);
  if (fn) {
    // Move to end (most-recently-used) by deleting and re-inserting
    _expressionCache.delete(key);
    _expressionCache.set(key, fn);
    return fn;
  }
  fn = new Function(...paramNames, `"use strict"; return (() => (${expression}))()`) as CompiledExpression;
  // Evict LRU (first entry in Map insertion order) if cache is full
  if (_expressionCache.size >= MAX_EXPRESSION_CACHE_SIZE) {
    const firstKey = _expressionCache.keys().next().value;
    if (firstKey !== undefined) _expressionCache.delete(firstKey);
  }
  _expressionCache.set(key, fn);
  return fn;
}

// Module-scoped graph variables for get-var/set-var processors
let _currentGraphVariables: Record<string, unknown> = {};

/** Set the graph variables context for execution. Call before executeGraph(). */
export function setGraphVariablesContext(vars: Record<string, unknown>): void {
  _currentGraphVariables = vars;
}

/** Get the current graph variables (may have been modified by set-var during execution). */
export function getGraphVariablesContext(): Record<string, unknown> {
  return _currentGraphVariables;
}

export const processors: Record<NodeType, NodeProcessor> = {
  // --- Core ---
  source: (node) => {
    const value = node.data.value ?? 0;
    const label = node.data.label ?? node.title;
    return { 0: value, 1: label };
  },

  transform: (node, inputs) => {
    const inputValue = typeof inputs[0] === 'number' ? inputs[0] : 0;
    // Prefer connected factor input (port 1), fall back to node.data.multiplier
    const multiplier = typeof inputs[1] === 'number' ? inputs[1]
      : typeof node.data.multiplier === 'number' ? node.data.multiplier : 1;
    const offset = typeof node.data.offset === 'number' ? node.data.offset : 0;
    const result = inputValue * multiplier + offset;
    return { 0: result, 1: `${inputValue}×${multiplier}+${offset}=${result}` };
  },

  filter: (node, inputs) => {
    const inputValue = inputs[0];
    const threshold = typeof node.data.threshold === 'number' ? node.data.threshold : 0;
    const mode = (node.data.mode as string) ?? 'greater';
    const numValue = typeof inputValue === 'number' ? inputValue : 0;

    let passes = false;
    switch (mode) {
      case 'greater': passes = numValue > threshold; break;
      case 'less': passes = numValue < threshold; break;
      case 'equal': passes = numValue === threshold; break;
      default: passes = numValue > threshold;
    }

    return { 0: passes ? inputValue : null };
  },

  output: () => {
    return {};
  },

  // --- Math ---
  math: (node, inputs) => {
    const a = typeof inputs[0] === 'number' ? inputs[0] : 0;
    const b = typeof inputs[1] === 'number' ? inputs[1] : 0;
    const op = (node.data.operation as string) ?? 'add';
    let result = 0;
    switch (op) {
      case 'add': result = a + b; break;
      case 'subtract': result = a - b; break;
      case 'multiply': result = a * b; break;
      case 'divide': result = b !== 0 ? a / b : 0; break;
      case 'power': { const p = Math.pow(a, b); result = Number.isFinite(p) ? p : 0; break; }
      case 'modulo': result = b !== 0 ? a % b : 0; break;
      default: result = a + b;
    }
    return { 0: result };
  },

  clamp: (_node, inputs) => {
    const value = typeof inputs[0] === 'number' ? inputs[0] : 0;
    let min = typeof inputs[1] === 'number' ? inputs[1] : 0;
    let max = typeof inputs[2] === 'number' ? inputs[2] : 1;
    // Handle NaN: fall back to defaults
    if (Number.isNaN(value)) return { 0: 0 };
    if (Number.isNaN(min)) min = 0;
    if (Number.isNaN(max)) max = 1;
    // Normalize min/max if inverted
    if (min > max) { const tmp = min; min = max; max = tmp; }
    return { 0: Math.min(Math.max(value, min), max) };
  },

  remap: (_node, inputs) => {
    const value = typeof inputs[0] === 'number' ? inputs[0] : 0;
    const inMin = typeof inputs[1] === 'number' ? inputs[1] : 0;
    const inMax = typeof inputs[2] === 'number' ? inputs[2] : 1;
    const outMin = typeof inputs[3] === 'number' ? inputs[3] : 0;
    const outMax = typeof inputs[4] === 'number' ? inputs[4] : 1;
    // Handle NaN: fall back to 0 (same pattern as clamp)
    if (Number.isNaN(value)) return { 0: 0 };
    const range = (Number.isNaN(inMax) ? 1 : inMax) - (Number.isNaN(inMin) ? 0 : inMin);
    const t = range !== 0 ? (value - inMin) / range : 0;
    return { 0: (Number.isNaN(outMin) ? 0 : outMin) + t * ((Number.isNaN(outMax) ? 1 : outMax) - (Number.isNaN(outMin) ? 0 : outMin)) };
  },

  sin: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 0;
    return { 0: Math.sin(v) };
  },
  cos: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 0;
    return { 0: Math.cos(v) };
  },
  tan: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 0;
    const r = Math.tan(v);
    return { 0: Number.isFinite(r) ? r : 0 };
  },
  abs: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 0;
    return { 0: Math.abs(v) };
  },
  floor: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 0;
    return { 0: Math.floor(v) };
  },
  ceil: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 0;
    return { 0: Math.ceil(v) };
  },
  round: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 0;
    return { 0: Math.round(v) };
  },
  log: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 1;
    return { 0: v > 0 ? Math.log(v) : 0 };
  },
  sqrt: (_node, inputs) => {
    const v = typeof inputs[0] === 'number' ? inputs[0] : 0;
    return { 0: v >= 0 ? Math.sqrt(v) : 0 };
  },
  lerp: (_node, inputs) => {
    const a = typeof inputs[0] === 'number' ? inputs[0] : 0;
    const b = typeof inputs[1] === 'number' ? inputs[1] : 1;
    const t = typeof inputs[2] === 'number' ? inputs[2] : 0.5;
    return { 0: a + (b - a) * t };
  },

  // --- String ---
  concat: (_node, inputs) => {
    const a = inputs[0] != null ? String(inputs[0]) : '';
    const b = inputs[1] != null ? String(inputs[1]) : '';
    return { 0: a + b };
  },

  template: (_node, inputs) => {
    const tpl = typeof inputs[0] === 'string' ? inputs[0] : '{value}';
    const value = inputs[1];
    return { 0: tpl.replace(/\{value\}/g, value != null ? String(value) : '') };
  },

  'string-length': (_node, inputs) => {
    const s = typeof inputs[0] === 'string' ? inputs[0] : '';
    return { 0: s.length };
  },
  'string-trim': (_node, inputs) => {
    const s = typeof inputs[0] === 'string' ? inputs[0] : '';
    return { 0: s.trim() };
  },
  'string-split': (_node, inputs) => {
    const s = typeof inputs[0] === 'string' ? inputs[0] : '';
    const delim = typeof inputs[1] === 'string' ? inputs[1] : ',';
    const parts = s.split(delim);
    return { 0: parts[0] ?? '', 1: parts.slice(1).join(delim), 2: parts.length };
  },
  'string-case': (_node, inputs) => {
    const s = typeof inputs[0] === 'string' ? inputs[0] : '';
    return { 0: s.toUpperCase(), 1: s.toLowerCase() };
  },
  'parse-number': (_node, inputs) => {
    const s = typeof inputs[0] === 'string' ? inputs[0] : '';
    const n = Number(s);
    const valid = s.trim() !== '' && Number.isFinite(n);
    return { 0: valid ? n : 0, 1: valid };
  },

  // --- Logic ---
  compare: (node, inputs) => {
    const a = typeof inputs[0] === 'number' ? inputs[0] : 0;
    const b = typeof inputs[1] === 'number' ? inputs[1] : 0;
    const mode = (node.data.mode as string) ?? '>';
    let result = false;
    switch (mode) {
      case '>': result = a > b; break;
      case '<': result = a < b; break;
      case '==': result = a === b; break;
      case '!=': result = a !== b; break;
      case '>=': result = a >= b; break;
      case '<=': result = a <= b; break;
      default: result = a > b;
    }
    return { 0: result };
  },

  switch: (node, inputs) => {
    const value = inputs[0];
    const strict = node.data.strictMode !== false; // default true for backwards compat
    for (let i = 1; i <= 4; i++) {
      if (inputs[i] !== undefined) {
        const match = strict ? inputs[i] === value : String(inputs[i]) === String(value);
        if (match) return { 0: inputs[i] };
      }
    }
    return { 0: inputs[5] ?? null };
  },

  and: (_node, inputs) => {
    return { 0: Boolean(inputs[0]) && Boolean(inputs[1]) };
  },
  or: (_node, inputs) => {
    return { 0: Boolean(inputs[0]) || Boolean(inputs[1]) };
  },
  not: (_node, inputs) => {
    return { 0: !Boolean(inputs[0]) };
  },
  xor: (_node, inputs) => {
    const a = Boolean(inputs[0]);
    const b = Boolean(inputs[1]);
    return { 0: (a && !b) || (!a && b) };
  },

  // --- Vector ---
  'compose-vec3': (_node, inputs) => {
    const x = typeof inputs[0] === 'number' ? inputs[0] : 0;
    const y = typeof inputs[1] === 'number' ? inputs[1] : 0;
    const z = typeof inputs[2] === 'number' ? inputs[2] : 0;
    return { 0: [x, y, z] };
  },

  'decompose-vec3': (_node, inputs) => {
    const vec = Array.isArray(inputs[0]) ? inputs[0] : [0, 0, 0];
    return {
      0: typeof vec[0] === 'number' ? vec[0] : 0,
      1: typeof vec[1] === 'number' ? vec[1] : 0,
      2: typeof vec[2] === 'number' ? vec[2] : 0,
    };
  },

  // --- Utility ---
  note: () => {
    return {};
  },

  reroute: (_node, inputs) => {
    return { 0: inputs[0] };
  },

  random: (node) => {
    const min = typeof node.data.min === 'number' ? node.data.min : 0;
    const max = typeof node.data.max === 'number' ? node.data.max : 1;
    const seed = node.data.seed;
    // Simple seeded random if seed provided, otherwise Math.random
    let value: number;
    if (typeof seed === 'number') {
      // Simple hash-based pseudo-random from seed
      const x = Math.sin(seed * 9301 + 49297) * 49297;
      value = x - Math.floor(x);
    } else {
      value = Math.random();
    }
    return { 0: min + value * (max - min) };
  },

  // Sink node: has an input but no output ports, so it produces no outputs.
  // The on-node DisplayReadout shows the value by reading its incoming edge.
  display: () => {
    return {};
  },

  // --- Subgraph ---
  // The subgraph processor is a placeholder — actual subgraph execution is handled
  // by executeSubgraphNode() which is called from executeGraph when context is provided.
  // If no context is provided, subgraph nodes pass through their first input.
  subgraph: (_node, inputs) => {
    return { 0: inputs[0] ?? null };
  },

  'subgraph-input': (node, inputs) => {
    // When executed inside a subgraph, the parent injects _injectedValue into node.data.
    // During standalone execution (no parent), fall back to inputs or null.
    if ('_injectedValue' in node.data) {
      return { 0: node.data._injectedValue ?? null };
    }
    return { 0: inputs[0] ?? null };
  },

  'subgraph-output': (_node, inputs) => {
    // Subgraph-output nodes collect results to pass back to the parent graph.
    // They have one input and no outputs — the value is read by the subgraph executor.
    return { 0: inputs[0] ?? null };
  },

  // --- 3D Math (vector operations) ---
  'dot-product': (_node, inputs) => {
    const a = Array.isArray(inputs[0]) ? inputs[0] : [0, 0, 0];
    const b = Array.isArray(inputs[1]) ? inputs[1] : [0, 0, 0];
    const ax = typeof a[0] === 'number' ? a[0] : 0;
    const ay = typeof a[1] === 'number' ? a[1] : 0;
    const az = typeof a[2] === 'number' ? a[2] : 0;
    const bx = typeof b[0] === 'number' ? b[0] : 0;
    const by = typeof b[1] === 'number' ? b[1] : 0;
    const bz = typeof b[2] === 'number' ? b[2] : 0;
    return { 0: ax * bx + ay * by + az * bz };
  },

  'cross-product': (_node, inputs) => {
    const a = Array.isArray(inputs[0]) ? inputs[0] : [0, 0, 0];
    const b = Array.isArray(inputs[1]) ? inputs[1] : [0, 0, 0];
    const ax = typeof a[0] === 'number' ? a[0] : 0;
    const ay = typeof a[1] === 'number' ? a[1] : 0;
    const az = typeof a[2] === 'number' ? a[2] : 0;
    const bx = typeof b[0] === 'number' ? b[0] : 0;
    const by = typeof b[1] === 'number' ? b[1] : 0;
    const bz = typeof b[2] === 'number' ? b[2] : 0;
    return { 0: [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx] };
  },

  'normalize-vec3': (_node, inputs) => {
    const v = Array.isArray(inputs[0]) ? inputs[0] : [0, 0, 0];
    const x = typeof v[0] === 'number' ? v[0] : 0;
    const y = typeof v[1] === 'number' ? v[1] : 0;
    const z = typeof v[2] === 'number' ? v[2] : 0;
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len === 0) return { 0: [0, 0, 0] };
    return { 0: [x / len, y / len, z / len] };
  },

  'vec3-length': (_node, inputs) => {
    const v = Array.isArray(inputs[0]) ? inputs[0] : [0, 0, 0];
    const x = typeof v[0] === 'number' ? v[0] : 0;
    const y = typeof v[1] === 'number' ? v[1] : 0;
    const z = typeof v[2] === 'number' ? v[2] : 0;
    return { 0: Math.sqrt(x * x + y * y + z * z) };
  },

  // --- Statistics (array operations) ---
  // NaN is filtered out (typeof NaN === 'number' but isNaN catches it).
  // min/max use loops instead of Math.min(...arr) to avoid stack overflow on large arrays.
  mean: (_node, inputs) => {
    const raw = inputs[0];
    const arr = Array.isArray(raw) ? (raw as unknown[]).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)) : [];
    if (arr.length === 0) return { 0: 0 };
    return { 0: arr.reduce((a, b) => a + b, 0) / arr.length };
  },

  median: (_node, inputs) => {
    const raw = inputs[0];
    const arr = Array.isArray(raw) ? (raw as unknown[]).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)) : [];
    if (arr.length === 0) return { 0: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return { 0: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid] };
  },

  stddev: (_node, inputs) => {
    const raw = inputs[0];
    const arr = Array.isArray(raw) ? (raw as unknown[]).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)) : [];
    if (arr.length === 0) return { 0: 0 };
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
    return { 0: Math.sqrt(variance) };
  },

  'min-array': (_node, inputs) => {
    const raw = inputs[0];
    const arr = Array.isArray(raw) ? (raw as unknown[]).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)) : [];
    if (arr.length === 0) return { 0: 0 };
    let result = arr[0];
    for (let i = 1; i < arr.length; i++) { if (arr[i] < result) result = arr[i]; }
    return { 0: result };
  },

  'max-array': (_node, inputs) => {
    const raw = inputs[0];
    const arr = Array.isArray(raw) ? (raw as unknown[]).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)) : [];
    if (arr.length === 0) return { 0: 0 };
    let result = arr[0];
    for (let i = 1; i < arr.length; i++) { if (arr[i] > result) result = arr[i]; }
    return { 0: result };
  },

  // --- Color ---
  'color-picker': (node, _inputs) => {
    const hex = typeof node.data.color === 'string' ? node.data.color : '#000000';
    // Parse hex to RGB — only accept 3 or 6 char hex (reject 8-char RGBA etc.)
    const clean = hex.replace(/^#/, '');
    if (clean.length !== 3 && clean.length !== 6) {
      return { 0: hex, 1: 0, 2: 0, 3: 0 };
    }
    const num = parseInt(clean.length === 3
      ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
      : clean, 16);
    const r = Number.isNaN(num) ? 0 : (num >> 16) & 0xFF;
    const g = Number.isNaN(num) ? 0 : (num >> 8) & 0xFF;
    const b = Number.isNaN(num) ? 0 : num & 0xFF;
    return { 0: hex, 1: r, 2: g, 3: b };
  },
  'color-mix': (_node, inputs) => {
    const c1 = typeof inputs[0] === 'string' ? inputs[0] : '#000000';
    const c2 = typeof inputs[1] === 'string' ? inputs[1] : '#ffffff';
    const t = typeof inputs[2] === 'number' ? Math.max(0, Math.min(1, inputs[2])) : 0.5;
    // Parse both hex colors
    function parseHex(hex: string): [number, number, number] {
      const clean = hex.replace(/^#/, '');
      if (clean.length !== 3 && clean.length !== 6) return [0, 0, 0];
      const expanded = clean.length === 3
        ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
        : clean;
      const num = parseInt(expanded, 16);
      if (Number.isNaN(num)) return [0, 0, 0];
      return [(num >> 16) & 0xFF, (num >> 8) & 0xFF, num & 0xFF];
    }
    const [r1, g1, b1] = parseHex(c1);
    const [r2, g2, b2] = parseHex(c2);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    return { 0: hex };
  },
  'hsl-to-rgb': (_node, inputs) => {
    const h = (typeof inputs[0] === 'number' && !Number.isNaN(inputs[0])) ? ((inputs[0] % 360) + 360) % 360 : 0;
    const s = (typeof inputs[1] === 'number' && !Number.isNaN(inputs[1])) ? Math.max(0, Math.min(100, inputs[1])) / 100 : 1;
    const l = (typeof inputs[2] === 'number' && !Number.isNaN(inputs[2])) ? Math.max(0, Math.min(100, inputs[2])) / 100 : 0.5;
    // HSL to RGB conversion
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;
    if (h < 60)      { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else              { r1 = c; g1 = 0; b1 = x; }
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    return { 0: hex, 1: r, 2: g, 3: b };
  },
  'rgb-to-hsl': (_node, inputs) => {
    const r = ((typeof inputs[0] === 'number' && !Number.isNaN(inputs[0])) ? Math.max(0, Math.min(255, inputs[0])) : 0) / 255;
    const g = ((typeof inputs[1] === 'number' && !Number.isNaN(inputs[1])) ? Math.max(0, Math.min(255, inputs[1])) : 0) / 255;
    const b = ((typeof inputs[2] === 'number' && !Number.isNaN(inputs[2])) ? Math.max(0, Math.min(255, inputs[2])) : 0) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { 0: 0, 1: 0, 2: Math.round(l * 100) };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    return { 0: Math.round(h), 1: Math.round(s * 100), 2: Math.round(l * 100) };
  },

  // --- Live ---
  timer: (node, _inputs) => {
    const intervalMs = typeof node.data.intervalMs === 'number' ? Math.max(1, node.data.intervalMs) : 1000;
    return { 0: Date.now() % intervalMs };
  },
  'http-fetch': (node, inputs) => {
    // http-fetch is non-deterministic and async — the processor returns cached data.
    // The actual fetch is handled by the store action fetchNodeData.
    const url = typeof inputs[0] === 'string' ? inputs[0] : '';
    // When no URL is connected, return empty state (not stale cache from a prior URL)
    if (!url) {
      return { 0: null, 1: 0, 2: '' };
    }
    void inputs[1]; // trigger is acted upon by the store, not here
    const cachedData = node.data._fetchResult ?? null;
    const cachedStatus = typeof node.data._fetchStatus === 'number' ? node.data._fetchStatus : 0;
    const cachedError = typeof node.data._fetchError === 'string' ? node.data._fetchError : '';
    return { 0: cachedData, 1: cachedStatus, 2: cachedError };
  },

  // --- Custom (expression-based) ---
  custom: (node, inputs) => {
    const expression = (node.data.expression as string) ?? 'in0';
    const outputCount = typeof node.data.outputCount === 'number' ? node.data.outputCount : 1;
    // Build named input variables: in0, in1, in2, etc.
    const inputCount = typeof node.data.inputCount === 'number' ? node.data.inputCount : node.inputs.length;
    const maxInputs = Math.max(inputCount, Object.keys(inputs).length, 2);
    const paramNames: string[] = ['inputs', 'Math'];
    const paramValues: unknown[] = [inputs, Math];
    for (let i = 0; i < maxInputs; i++) {
      paramNames.push(`in${i}`);
      paramValues.push(inputs[i] ?? 0);
    }
    // Shadow dangerous globals as function parameters to prevent access.
    // We use "use strict" + arrow function wrapper to:
    // 1. Prevent `this` from leaking globalThis (strict mode makes `this` undefined)
    // 2. Eliminate `arguments` object (arrow functions have no `arguments`)
    // 3. Block `arguments.callee.caller` stack walking
    // SECURITY NOTE: This sandbox is bypassable via constructor chain escape
    // (e.g. `(0).constructor.constructor("return globalThis")()`).
    // new Function() cannot be truly sandboxed in JS without a Web Worker or iframe.
    // This is a trust boundary: users who define custom expressions can execute
    // arbitrary JS in the browser context. Do not use with untrusted input.
    paramNames.push(..._sandboxedGlobals);
    paramValues.push(..._sandboxedValues);
    try {
      const fn = getCompiledExpression(paramNames, expression);
      const t0 = performance.now();
      const result = fn(...paramValues);
      const elapsed = performance.now() - t0;
      // Abort if expression took > 1 second — flag as error to prevent re-execution
      if (elapsed > 1000) {
        throw new Error(`Expression timed out (${(elapsed / 1000).toFixed(1)}s) — simplify or avoid heavy computation`);
      }
      // If result is an array and we have multiple outputs, spread across outputs
      if (Array.isArray(result) && outputCount > 1) {
        const outputs: Record<number, unknown> = {};
        for (let i = 0; i < outputCount; i++) {
          outputs[i] = result[i] ?? null;
        }
        return outputs;
      }
      // Non-array result with multiple outputs: populate output 0, null for rest
      if (outputCount > 1) {
        const outputs: Record<number, unknown> = { 0: result };
        for (let i = 1; i < outputCount; i++) outputs[i] = null;
        return outputs;
      }
      return { 0: result };
    } catch (err: unknown) {
      // Re-throw with context so executeGraph records the error
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Custom expression error: ${msg}`);
    }
  },

  // --- Array manipulation ---
  'create-array': (_node, inputs) => {
    const arr: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      if (inputs[i] !== undefined) arr.push(inputs[i]);
    }
    return { 0: arr };
  },
  'get-element': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    const raw = typeof inputs[1] === 'number' ? Math.floor(inputs[1]) : 0;
    const index = raw < 0 ? arr.length + raw : raw;
    if (index < 0 || index >= arr.length) return { 0: null };
    return { 0: arr[index] ?? null };
  },
  'set-element': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? [...inputs[0]] : [];
    const index = typeof inputs[1] === 'number' ? Math.floor(inputs[1]) : 0;
    const value = inputs[2];
    if (index >= 0 && index < arr.length) {
      arr[index] = value;
    } else if (index >= 0 && index <= 10_000) {
      // Extend array to fit (cap at 10K to prevent main-thread hang)
      while (arr.length <= index) arr.push(null);
      arr[index] = value;
    }
    return { 0: arr };
  },
  'array-length': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    return { 0: arr.length };
  },
  'array-push': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? [...inputs[0]] : [];
    arr.push(inputs[1] ?? null);
    return { 0: arr };
  },
  'array-filter': (node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    const expression = (node.data.expression as string) ?? 'x !== null';
    // Compile once (may throw SyntaxError) — include Math for Math.* access
    let fn: CompiledExpression;
    try {
      fn = getCompiledExpression(['Math', ..._sandboxedGlobals, 'x', 'i'], expression);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Array filter compile error: ${msg}`);
    }
    // Run per-element with index in error messages
    return { 0: arr.filter((x, i) => {
      try {
        return fn(Math, ..._sandboxedValues, x, i);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Array filter expression error at index ${i}: ${msg}`);
      }
    }) };
  },
  'array-map': (node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    const expression = (node.data.expression as string) ?? 'x';
    // Compile once (may throw SyntaxError) — include Math for Math.* access
    let fn: CompiledExpression;
    try {
      fn = getCompiledExpression(['Math', ..._sandboxedGlobals, 'x', 'i'], expression);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Array map compile error: ${msg}`);
    }
    // Run per-element with index in error messages
    return { 0: arr.map((x, i) => {
      try {
        return fn(Math, ..._sandboxedValues, x, i);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Array map expression error at index ${i}: ${msg}`);
      }
    }) };
  },
  'array-reduce': (node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    const initial = inputs[1] ?? 0;
    const expression = (node.data.expression as string) ?? 'acc + x';
    // Compile once (may throw SyntaxError) — include Math for Math.* access
    let fn: CompiledExpression;
    try {
      fn = getCompiledExpression(['Math', ..._sandboxedGlobals, 'acc', 'x', 'i'], expression);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Array reduce compile error: ${msg}`);
    }
    // Run per-element with index in error messages
    return { 0: arr.reduce((acc, x, i) => {
      try {
        return fn(Math, ..._sandboxedValues, acc, x, i);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Array reduce expression error at index ${i}: ${msg}`);
      }
    }, initial) };
  },

  // --- Object/Dictionary ---
  'create-object': (_node, inputs) => {
    const obj: Record<string, unknown> = {};
    // Pairs: key0=inputs[0]/val0=inputs[1], key1=inputs[2]/val1=inputs[3]
    for (let i = 0; i < 4; i += 2) {
      const key = inputs[i];
      if (key != null && key !== '') {
        obj[String(key)] = inputs[i + 1] ?? null;
      }
    }
    return { 0: obj };
  },
  'get-property': (_node, inputs) => {
    const obj = inputs[0];
    const key = typeof inputs[1] === 'string' ? inputs[1] : '';
    if (obj != null && typeof obj === 'object' && !Array.isArray(obj)) {
      return { 0: (obj as Record<string, unknown>)[key] ?? null };
    }
    return { 0: null };
  },
  'set-property': (_node, inputs) => {
    const obj = inputs[0];
    const key = typeof inputs[1] === 'string' ? inputs[1] : '';
    const value = inputs[2];
    if (obj != null && typeof obj === 'object' && !Array.isArray(obj)) {
      return { 0: { ...(obj as Record<string, unknown>), [key]: value } };
    }
    return { 0: { [key]: value } };
  },
  'object-keys': (_node, inputs) => {
    const obj = inputs[0];
    if (obj != null && typeof obj === 'object' && !Array.isArray(obj)) {
      return { 0: Object.keys(obj as Record<string, unknown>) };
    }
    return { 0: [] };
  },
  'object-values': (_node, inputs) => {
    const obj = inputs[0];
    if (obj != null && typeof obj === 'object' && !Array.isArray(obj)) {
      return { 0: Object.values(obj as Record<string, unknown>) };
    }
    return { 0: [] };
  },
  'merge-objects': (_node, inputs) => {
    const a = inputs[0];
    const b = inputs[1];
    const objA = (a != null && typeof a === 'object' && !Array.isArray(a)) ? a as Record<string, unknown> : {};
    const objB = (b != null && typeof b === 'object' && !Array.isArray(b)) ? b as Record<string, unknown> : {};
    return { 0: { ...objA, ...objB } };
  },

  // --- String enhancements ---
  'string-concat': (_node, inputs) => {
    const a = typeof inputs[0] === 'string' ? inputs[0] : String(inputs[0] ?? '');
    const b = typeof inputs[1] === 'string' ? inputs[1] : String(inputs[1] ?? '');
    return { 0: a + b };
  },
  'string-replace': (node, inputs) => {
    const str = typeof inputs[0] === 'string' ? inputs[0] : '';
    const search = typeof inputs[1] === 'string' ? inputs[1] : '';
    const replace = typeof inputs[2] === 'string' ? inputs[2] : '';
    const useRegex = Boolean(node.data.useRegex);
    if (search === '') return { 0: str };
    if (useRegex) {
      // Let invalid regex throw so executeGraph records the error (surfaced in ValidationPanel)
      return { 0: str.replace(new RegExp(search, 'g'), replace) };
    }
    // Literal replace all occurrences
    return { 0: str.split(search).join(replace) };
  },
  'string-includes': (_node, inputs) => {
    const str = typeof inputs[0] === 'string' ? inputs[0] : '';
    const search = typeof inputs[1] === 'string' ? inputs[1] : '';
    return { 0: str.includes(search) };
  },
  'string-template': (_node, inputs) => {
    let tpl = typeof inputs[0] === 'string' ? inputs[0] : '';
    for (let i = 0; i < 4; i++) {
      const val = inputs[i + 1];
      tpl = tpl.replace(new RegExp(`\\$\\{in${i}\\}`, 'g'), val != null ? String(val) : '');
    }
    return { 0: tpl };
  },

  // --- Flow control ---
  'if-gate': (_node, inputs) => {
    const condition = Boolean(inputs[0]);
    return { 0: condition ? inputs[1] : inputs[2] };
  },
  select: (_node, inputs) => {
    const index = typeof inputs[0] === 'number' ? Math.floor(inputs[0]) : 0;
    const clamped = Math.max(0, Math.min(3, index));
    return { 0: inputs[clamped + 1] ?? null };
  },

  // --- Variables ---
  'get-var': (node) => {
    const name = (node.data.variableName as string) ?? '';
    if (!name) throw new Error('get-var: variableName is not configured');
    return { 0: name in _currentGraphVariables ? _currentGraphVariables[name] : 0 };
  },
  'set-var': (node, inputs) => {
    const name = (node.data.variableName as string) ?? '';
    if (!name) throw new Error('set-var: variableName is not configured');
    const value = inputs[0] ?? null;
    _currentGraphVariables[name] = value;
    return { 0: value };
  },

  // --- Encoding / Data Conversion ---
  'json-parse': (_node, inputs) => {
    const str = typeof inputs[0] === 'string' ? inputs[0] : '';
    if (!str) return { 0: null };
    try {
      return { 0: JSON.parse(str) };
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`);
    }
  },
  'json-stringify': (_node, inputs) => {
    const value = inputs[0] ?? null;
    const pretty = !!inputs[1];
    try {
      return { 0: JSON.stringify(value, null, pretty ? 2 : undefined) };
    } catch (e) {
      throw new Error(`Cannot stringify: ${(e as Error).message}`);
    }
  },
  'base64-encode': (_node, inputs) => {
    const text = typeof inputs[0] === 'string' ? inputs[0] : String(inputs[0] ?? '');
    try {
      return { 0: btoa(unescape(encodeURIComponent(text))) };
    } catch (e) {
      throw new Error(`Base64 encode error: ${(e as Error).message}`);
    }
  },
  'base64-decode': (_node, inputs) => {
    const encoded = typeof inputs[0] === 'string' ? inputs[0] : '';
    if (!encoded) return { 0: '' };
    try {
      return { 0: decodeURIComponent(escape(atob(encoded))) };
    } catch (e) {
      throw new Error(`Base64 decode error: ${(e as Error).message}`);
    }
  },
  'uri-encode': (_node, inputs) => {
    const text = typeof inputs[0] === 'string' ? inputs[0] : String(inputs[0] ?? '');
    return { 0: encodeURIComponent(text) };
  },
  'uri-decode': (_node, inputs) => {
    const encoded = typeof inputs[0] === 'string' ? inputs[0] : '';
    if (!encoded) return { 0: '' };
    try {
      return { 0: decodeURIComponent(encoded) };
    } catch (e) {
      throw new Error(`URI decode error: ${(e as Error).message}`);
    }
  },

  // --- Advanced Array Operations ---
  'array-slice': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    const start = typeof inputs[1] === 'number' && Number.isFinite(inputs[1]) ? Math.floor(inputs[1]) : 0;
    const end = typeof inputs[2] === 'number' && Number.isFinite(inputs[2]) ? Math.floor(inputs[2]) : undefined;
    return { 0: arr.slice(start, end) };
  },
  'array-find': (node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    const expr = typeof inputs[1] === 'string' ? inputs[1] :
                 (typeof node.data.expression === 'string' ? node.data.expression : '');
    if (!expr) return { 0: null, 1: -1 };
    let fn: (...args: unknown[]) => unknown;
    try {
      fn = getCompiledExpression(['Math', ..._sandboxedGlobals, 'x', 'i'], expr) as (...args: unknown[]) => unknown;
    } catch (e) {
      throw new Error(`Array find compile error: ${(e as Error).message}`);
    }
    for (let i = 0; i < arr.length; i++) {
      try {
        if (fn(Math, ..._sandboxedValues, arr[i], i)) return { 0: arr[i], 1: i };
      } catch (e) {
        throw new Error(`Array find expression error at index ${i}: ${(e as Error).message}`);
      }
    }
    return { 0: null, 1: -1 };
  },
  'array-sort': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? [...inputs[0]] : [];
    arr.sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).localeCompare(String(b));
    });
    return { 0: arr };
  },
  'array-reverse': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    return { 0: [...arr].reverse() };
  },
  'array-flatten': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    const depth = typeof inputs[1] === 'number' && Number.isFinite(inputs[1]) ? Math.min(100, Math.max(0, Math.floor(inputs[1]))) : 1;
    return { 0: arr.flat(depth) };
  },
  'array-zip': (_node, inputs) => {
    const a = Array.isArray(inputs[0]) ? inputs[0] : [];
    const b = Array.isArray(inputs[1]) ? inputs[1] : [];
    const len = Math.min(a.length, b.length);
    const result: unknown[][] = [];
    for (let i = 0; i < len; i++) result.push([a[i], b[i]]);
    return { 0: result };
  },
  'array-unique': (_node, inputs) => {
    const arr = Array.isArray(inputs[0]) ? inputs[0] : [];
    const seen = new Set<unknown>();
    const unique: unknown[] = [];
    for (const item of arr) {
      let key: unknown;
      if (typeof item === 'object' && item !== null) {
        try { key = JSON.stringify(item); } catch { key = item; }
      } else { key = item; }
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }
    return { 0: unique, 1: unique.length };
  },

  // --- Date / Time ---
  'get-timestamp': () => {
    return { 0: Date.now() };
  },
  'format-date': (_node, inputs) => {
    const ts = typeof inputs[0] === 'number' ? inputs[0] : 0;
    const d = new Date(ts);
    if (isNaN(d.getTime())) throw new Error('Invalid timestamp');
    const iso = d.toISOString();
    return {
      0: iso,
      1: iso.slice(0, 10),
      2: iso.slice(11, 19),
    };
  },
  'parse-date': (_node, inputs) => {
    const str = typeof inputs[0] === 'string' ? inputs[0] : '';
    if (!str) return { 0: 0, 1: false };
    const ts = Date.parse(str);
    return { 0: isNaN(ts) ? 0 : ts, 1: !isNaN(ts) };
  },
};
