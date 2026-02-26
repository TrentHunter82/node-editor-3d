/**
 * Value formatting utilities for node output display.
 * Shared between ValuePreview, Inspector, and other UI components.
 */

/** Check if a string is a valid hex color */
export function isHexColor(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s);
}

/** Format a number compactly (for vec3 components, etc.) */
export function formatNum(v: unknown): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '?';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  return Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1);
}

/** Precision-aware number formatting with locale support */
export function formatNumberPrecision(v: number, locale?: string): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  // Scientific notation for very large/small values
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) return v.toExponential(2);
  // Integer display for whole numbers
  if (Number.isInteger(v)) {
    return locale ? v.toLocaleString(locale) : v.toString();
  }
  // Adaptive precision: more decimals for smaller values
  const decimals = abs >= 100 ? 1 : abs >= 1 ? 2 : 3;
  return locale ? v.toLocaleString(locale, { maximumFractionDigits: decimals }) : v.toFixed(decimals);
}

/** Format any value to a compact string for inline display */
export function formatCompact(v: unknown, maxLen = 14, _seen?: WeakSet<object>): string {
  if (v === null || v === undefined) return '\u2014'; // em dash
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
    return Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(2);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') {
    if (isHexColor(v)) return v;
    return v.length > maxLen ? v.slice(0, maxLen) + '\u2026' : v;
  }
  const seen = _seen ?? new WeakSet();
  if (seen.has(v as object)) return '[Circular]';
  seen.add(v as object);
  if (Array.isArray(v)) {
    return formatArrayCompact(v, seen);
  }
  if (typeof v === 'object') {
    return formatObjectCompact(v as Record<string, unknown>, seen);
  }
  return String(v).slice(0, maxLen);
}

/** Format an array to a compact string with length badge */
export function formatArrayCompact(arr: unknown[], _seen?: WeakSet<object>): string {
  if (arr.length === 0) return '[]';
  if (arr.length <= 3) {
    const seen = _seen ?? new WeakSet();
    const items = arr.map(x => {
      if (typeof x === 'number') return Number.isNaN(x) ? 'NaN' : x.toFixed(1);
      if (typeof x === 'string') return x.length > 8 ? x.slice(0, 8) + '\u2026' : x;
      if (typeof x === 'object' && x !== null) {
        if (seen.has(x)) return '[Circular]';
        seen.add(x);
        return Array.isArray(x) ? formatArrayCompact(x, seen) : formatObjectCompact(x as Record<string, unknown>, seen);
      }
      return '?';
    });
    return `[${items.join(', ')}]`;
  }
  return `[${arr.length} items]`;
}

/** Format an array with expanded detail (first N elements) */
export function formatArrayExpanded(arr: unknown[], maxItems = 5): string[] {
  if (arr.length === 0) return ['(empty array)'];
  return arr.slice(0, maxItems).map((item, i) => {
    const val = formatCompact(item, 20);
    return `[${i}] ${val}`;
  });
}

/** Format an object to a compact string */
export function formatObjectCompact(obj: Record<string, unknown>, _seen?: WeakSet<object>): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  if (keys.length <= 2) {
    const seen = _seen ?? new WeakSet();
    const pairs = keys.map(k => `${k}: ${formatCompact(obj[k], 8, seen)}`);
    return `{${pairs.join(', ')}}`;
  }
  return `{${keys.length} keys}`;
}

/** Format an object tree with depth limiting (for Inspector / detailed views) */
export function formatObjectTree(obj: Record<string, unknown>, maxDepth = 2, maxKeys = 6, depth = 0, _seen?: WeakSet<object>): string {
  if (depth >= maxDepth) return '{…}';
  const seen = _seen ?? new WeakSet();
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';

  const indent = '  '.repeat(depth + 1);
  const closingIndent = '  '.repeat(depth);
  const shownKeys = keys.slice(0, maxKeys);

  const lines = shownKeys.map(k => {
    const val = obj[k];
    let formatted: string;
    if (val === null || val === undefined) {
      formatted = String(val);
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      formatted = formatObjectTree(val as Record<string, unknown>, maxDepth, maxKeys, depth + 1, seen);
    } else if (Array.isArray(val)) {
      formatted = formatArrayCompact(val, seen);
    } else {
      formatted = formatCompact(val, 30, seen);
    }
    return `${indent}${k}: ${formatted}`;
  });

  if (keys.length > maxKeys) {
    lines.push(`${indent}…+${keys.length - maxKeys} more`);
  }

  return `{\n${lines.join(',\n')}\n${closingIndent}}`;
}

/** Format a 3D vector as compact xyz display */
export function formatVector3(v: unknown): string {
  if (!Array.isArray(v)) return '(?, ?, ?)';
  return `(${formatNum(v[0])}, ${formatNum(v[1])}, ${formatNum(v[2])})`;
}

/** Format a color value for display */
export function formatColor(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.toUpperCase();
}

/** Format a value for hover/tooltip display (more detail than compact) */
export function formatForTooltip(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
    return v.toString();
  }
  if (typeof v === 'boolean') return v.toString();
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '...' : v;
  if (Array.isArray(v)) {
    if (v.length <= 5) {
      try { return JSON.stringify(v); } catch { return `[${v.length} items]`; }
    }
    return `Array(${v.length})`;
  }
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      return s.length > 80 ? s.slice(0, 80) + '...' : s;
    } catch {
      return '{...}';
    }
  }
  return String(v);
}

/** Format a value with full detail (for Inspector panel / copy-to-clipboard) */
export function formatValueDetailed(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'number') return formatNumberPrecision(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') {
    if (v.length > 200) return JSON.stringify(v.slice(0, 200)) + '…';
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.length <= 20) {
      try { return JSON.stringify(v, null, 2); } catch { return formatArrayCompact(v); }
    }
    const preview = v.slice(0, 10).map((x, i) => `  [${i}]: ${formatCompact(x, 20)}`);
    return `[\n${preview.join(',\n')},\n  …+${v.length - 10} more\n]`;
  }
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v, null, 2);
      return s.length > 500 ? s.slice(0, 500) + '\n…' : s;
    } catch {
      // JSON.stringify failed (e.g., circular reference) — use safe fallback
      return formatObjectCompact(v as Record<string, unknown>, new WeakSet([v as object]));
    }
  }
  try {
    return String(v);
  } catch {
    return '[object]';
  }
}
