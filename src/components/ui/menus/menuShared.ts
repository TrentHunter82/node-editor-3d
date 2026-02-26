/**
 * Shared constants, types, and utilities for context menu subcomponents.
 * Extracted from ContextMenu.tsx during Phase 42 architecture cleanup.
 */
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../../../types';
import type { NodeType, NodeCategory } from '../../../types';

/** Convert node type slug to human-readable label: 'array-filter' → 'Array Filter' */
export function typeToLabel(type: string): string {
  // Special-case abbreviations
  if (type === 'hsl-to-rgb') return 'HSL to RGB';
  if (type === 'rgb-to-hsl') return 'RGB to HSL';
  if (type === 'http-fetch') return 'HTTP Fetch';
  if (type === 'json-parse') return 'JSON Parse';
  if (type === 'json-stringify') return 'JSON Stringify';
  if (type === 'uri-encode') return 'URI Encode';
  if (type === 'uri-decode') return 'URI Decode';
  if (type === 'base64-encode') return 'Base64 Encode';
  if (type === 'base64-decode') return 'Base64 Decode';
  if (type === 'compose-vec3') return 'Compose Vec3';
  if (type === 'decompose-vec3') return 'Decompose Vec3';
  if (type === 'normalize-vec3') return 'Normalize Vec3';
  if (type === 'vec3-length') return 'Vec3 Length';
  if (type === 'stddev') return 'Std Dev';
  if (type === 'if-gate') return 'If Gate';
  if (type === 'get-var') return 'Get Variable';
  if (type === 'set-var') return 'Set Variable';
  return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export const COLOR_VAR: Record<string, string> = {
  teal: 'var(--teal)',
  orange: 'var(--orange)',
  coral: 'var(--coral)',
  'teal-coral': '#9B59B6',
};

/** Excluded from regular context menu: internal subgraph ports + subgraph (has its own button) */
export const EXCLUDED_FROM_MENU = new Set<string>(['subgraph', 'subgraph-input', 'subgraph-output']);

/** All node types dynamically generated from NODE_TYPE_CONFIG */
export const NODE_BUTTONS: { type: NodeType; label: string; color: string }[] = (
  Object.keys(NODE_TYPE_CONFIG) as NodeType[]
)
  .filter(type => !EXCLUDED_FROM_MENU.has(type))
  .map(type => ({
    type,
    label: typeToLabel(type),
    color: COLOR_VAR[NODE_TYPE_CONFIG[type].color] ?? 'var(--teal)',
  }));

/** Map from type → button for O(1) lookup in PortReleaseMenu */
export const NODE_BUTTON_MAP = new Map(NODE_BUTTONS.map(b => [b.type, b]));

export const CATEGORY_ORDER: NodeCategory[] = ['Core', 'Math', 'String', 'Logic', 'Vector', 'Data', 'Color', 'Live', 'Utility'];

/** Pre-grouped buttons by category */
export const BUTTONS_BY_CATEGORY: Record<string, typeof NODE_BUTTONS> = {};
for (const cat of CATEGORY_ORDER) BUTTONS_BY_CATEGORY[cat] = [];
for (const btn of NODE_BUTTONS) {
  const cat = NODE_CATEGORIES[btn.type] ?? 'Utility';
  if (BUTTONS_BY_CATEGORY[cat]) BUTTONS_BY_CATEGORY[cat].push(btn);
}

export const CONNECTION_STYLES = ['bezier', 'straight', 'right-angle', 'organic'] as const;

/** Exec wrapper type used by all menu components */
export type ExecFn = (fn: () => void) => void;
