import { describe, it, expect } from 'vitest';
import {
  isHexColor,
  formatNum,
  formatNumberPrecision,
  formatCompact,
  formatArrayCompact,
  formatArrayExpanded,
  formatObjectCompact,
  formatObjectTree,
  formatVector3,
  formatColor,
  formatForTooltip,
  formatValueDetailed,
} from './valueFormat';

// ── isHexColor ──────────────────────────────────────────────────────

describe('isHexColor', () => {
  it('accepts valid 3-digit hex (#RGB)', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#FFF')).toBe(true);
  });

  it('accepts valid 6-digit hex (#RRGGBB)', () => {
    expect(isHexColor('#ff00aa')).toBe(true);
    expect(isHexColor('#123456')).toBe(true);
  });

  it('accepts valid 8-digit hex (#RRGGBBAA)', () => {
    expect(isHexColor('#ff00aa80')).toBe(true);
    expect(isHexColor('#00000000')).toBe(true);
  });

  it('rejects strings without leading #', () => {
    expect(isHexColor('ff00aa')).toBe(false);
    expect(isHexColor('abc')).toBe(false);
  });

  it('rejects wrong-length hex strings', () => {
    expect(isHexColor('#abcd')).toBe(false);   // 4 digits
    expect(isHexColor('#abcde')).toBe(false);  // 5 digits
    expect(isHexColor('#abcdefabc')).toBe(false); // 9 digits
  });

  it('rejects non-hex characters', () => {
    expect(isHexColor('#xyz')).toBe(false);
    expect(isHexColor('#gggggg')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isHexColor('')).toBe(false);
  });
});

// ── formatNum ───────────────────────────────────────────────────────

describe('formatNum', () => {
  it('formats regular numbers < 100 with one decimal place', () => {
    expect(formatNum(3.14159)).toBe('3.1');
    expect(formatNum(0)).toBe('0.0');
    expect(formatNum(-42.789)).toBe('-42.8');
  });

  it('rounds large numbers (abs >= 100) to integers', () => {
    expect(formatNum(123.456)).toBe('123');
    expect(formatNum(-999.9)).toBe('-1000');
  });

  it('returns "?" for NaN', () => {
    expect(formatNum(NaN)).toBe('?');
  });

  it('returns "?" for non-number types', () => {
    expect(formatNum('hello')).toBe('?');
    expect(formatNum(null)).toBe('?');
    expect(formatNum(undefined)).toBe('?');
  });

  it('returns "∞" for Infinity', () => {
    expect(formatNum(Infinity)).toBe('∞');
  });

  it('returns "-∞" for -Infinity', () => {
    expect(formatNum(-Infinity)).toBe('-∞');
  });
});

// ── formatCompact ───────────────────────────────────────────────────

describe('formatCompact', () => {
  it('returns em dash for null', () => {
    expect(formatCompact(null)).toBe('\u2014');
  });

  it('returns em dash for undefined', () => {
    expect(formatCompact(undefined)).toBe('\u2014');
  });

  it('returns "NaN" for NaN', () => {
    expect(formatCompact(NaN)).toBe('NaN');
  });

  it('returns "∞" for Infinity and "-∞" for -Infinity', () => {
    expect(formatCompact(Infinity)).toBe('∞');
    expect(formatCompact(-Infinity)).toBe('-∞');
  });

  it('uses exponential notation for numbers with abs >= 1000', () => {
    expect(formatCompact(5000)).toBe('5.0e+3');
    expect(formatCompact(-12345)).toBe('-1.2e+4');
  });

  it('formats smaller numbers with two decimal places', () => {
    expect(formatCompact(3.14159)).toBe('3.14');
    expect(formatCompact(0)).toBe('0.00');
  });

  it('formats booleans as "true"/"false"', () => {
    expect(formatCompact(true)).toBe('true');
    expect(formatCompact(false)).toBe('false');
  });

  it('passes through hex color strings without truncation', () => {
    expect(formatCompact('#ff0000')).toBe('#ff0000');
    expect(formatCompact('#abc')).toBe('#abc');
  });

  it('truncates long strings with ellipsis at maxLen', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz';
    const result = formatCompact(long);
    // default maxLen=14, so 14 chars + ellipsis
    expect(result).toBe('abcdefghijklmn\u2026');
    expect(result.length).toBe(15);
  });

  it('delegates arrays to formatArrayCompact', () => {
    expect(formatCompact([1, 2, 3])).toBe(formatArrayCompact([1, 2, 3]));
  });

  it('delegates objects to formatObjectCompact', () => {
    const obj = { a: 1 };
    expect(formatCompact(obj)).toBe(formatObjectCompact(obj));
  });
});

// ── formatArrayCompact ──────────────────────────────────────────────

describe('formatArrayCompact', () => {
  it('returns "[]" for empty array', () => {
    expect(formatArrayCompact([])).toBe('[]');
  });

  it('inlines items for arrays of 1-3 elements', () => {
    expect(formatArrayCompact([1])).toBe('[1.0]');
    expect(formatArrayCompact([1, 2, 3])).toBe('[1.0, 2.0, 3.0]');
  });

  it('returns "[N items]" badge for arrays with >3 elements', () => {
    expect(formatArrayCompact([1, 2, 3, 4])).toBe('[4 items]');
    expect(formatArrayCompact([1, 2, 3, 4, 5, 6])).toBe('[6 items]');
  });

  it('truncates long string items at 8 characters', () => {
    const result = formatArrayCompact(['abcdefghij']);
    expect(result).toBe('[abcdefgh\u2026]');
  });
});

// ── formatArrayExpanded ─────────────────────────────────────────────

describe('formatArrayExpanded', () => {
  it('returns ["(empty array)"] for empty array', () => {
    expect(formatArrayExpanded([])).toEqual(['(empty array)']);
  });

  it('formats each item with index prefix up to maxItems', () => {
    const result = formatArrayExpanded([10, 20, 30]);
    expect(result).toEqual(['[0] 10.00', '[1] 20.00', '[2] 30.00']);
  });

  it('limits output to maxItems entries', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = formatArrayExpanded(arr, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('[0] 1.00');
    expect(result[2]).toBe('[2] 3.00');
  });
});

// ── formatObjectCompact ─────────────────────────────────────────────

describe('formatObjectCompact', () => {
  it('returns "{}" for empty object', () => {
    expect(formatObjectCompact({})).toBe('{}');
  });

  it('inlines key-value pairs for objects with 1-2 keys', () => {
    expect(formatObjectCompact({ x: 1 })).toBe('{x: 1.00}');
    expect(formatObjectCompact({ a: 1, b: 2 })).toBe('{a: 1.00, b: 2.00}');
  });

  it('returns "{N keys}" badge for objects with >2 keys', () => {
    expect(formatObjectCompact({ a: 1, b: 2, c: 3 })).toBe('{3 keys}');
    expect(formatObjectCompact({ w: 1, x: 2, y: 3, z: 4 })).toBe('{4 keys}');
  });
});

// ── formatForTooltip ────────────────────────────────────────────────

describe('formatForTooltip', () => {
  it('returns "null" for null and undefined', () => {
    expect(formatForTooltip(null)).toBe('null');
    expect(formatForTooltip(undefined)).toBe('null');
  });

  it('returns "NaN" for NaN', () => {
    expect(formatForTooltip(NaN)).toBe('NaN');
  });

  it('returns full toString for regular numbers', () => {
    expect(formatForTooltip(3.14159)).toBe('3.14159');
    expect(formatForTooltip(42)).toBe('42');
  });

  it('returns Infinity strings for infinite values', () => {
    expect(formatForTooltip(Infinity)).toBe('Infinity');
    expect(formatForTooltip(-Infinity)).toBe('-Infinity');
  });

  it('JSON.stringifies small arrays (length <= 5)', () => {
    expect(formatForTooltip([1, 2, 3])).toBe('[1,2,3]');
    expect(formatForTooltip(['a', 'b'])).toBe('["a","b"]');
  });

  it('returns "Array(N)" for large arrays (length > 5)', () => {
    expect(formatForTooltip([1, 2, 3, 4, 5, 6])).toBe('Array(6)');
    expect(formatForTooltip(new Array(100))).toBe('Array(100)');
  });

  it('JSON.stringifies objects, truncating at 80 chars', () => {
    const small = { a: 1, b: 2 };
    expect(formatForTooltip(small)).toBe('{"a":1,"b":2}');

    // Build an object whose JSON is longer than 80 chars
    const big: Record<string, string> = {};
    for (let i = 0; i < 20; i++) big[`key${i}`] = 'value';
    const result = formatForTooltip(big);
    expect(result.length).toBeLessThanOrEqual(83); // 80 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncates long strings at 60 characters', () => {
    const long = 'a'.repeat(100);
    const result = formatForTooltip(long);
    expect(result).toBe('a'.repeat(60) + '...');
  });

  it('returns "{...}" for objects that fail JSON.stringify (circular)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatForTooltip(circular)).toBe('{...}');
  });
});

// ── formatNumberPrecision ───────────────────────────────────────────

describe('formatNumberPrecision', () => {
  it('returns "NaN" for NaN', () => {
    expect(formatNumberPrecision(NaN)).toBe('NaN');
  });

  it('returns infinity symbols for ±Infinity', () => {
    expect(formatNumberPrecision(Infinity)).toBe('∞');
    expect(formatNumberPrecision(-Infinity)).toBe('-∞');
  });

  it('returns "0" for zero', () => {
    expect(formatNumberPrecision(0)).toBe('0');
  });

  it('uses scientific notation for very large values (>= 1e6)', () => {
    expect(formatNumberPrecision(1_500_000)).toBe('1.50e+6');
    expect(formatNumberPrecision(-2e7)).toBe('-2.00e+7');
  });

  it('uses scientific notation for very small values (< 1e-3)', () => {
    expect(formatNumberPrecision(0.00042)).toBe('4.20e-4');
    expect(formatNumberPrecision(-5e-5)).toBe('-5.00e-5');
  });

  it('displays integers without decimals', () => {
    expect(formatNumberPrecision(42)).toBe('42');
    expect(formatNumberPrecision(-7)).toBe('-7');
    expect(formatNumberPrecision(999)).toBe('999');
  });

  it('uses adaptive decimal precision by magnitude', () => {
    // abs >= 100 → 1 decimal
    expect(formatNumberPrecision(150.678)).toBe('150.7');
    // abs >= 1, < 100 → 2 decimals
    expect(formatNumberPrecision(42.456)).toBe('42.46');
    // abs < 1 → 3 decimals
    expect(formatNumberPrecision(0.5678)).toBe('0.568');
  });

  it('supports locale formatting for integers', () => {
    const result = formatNumberPrecision(1234, 'en-US');
    expect(result).toBe('1,234');
  });

  it('supports locale formatting for fractional values', () => {
    const result = formatNumberPrecision(42.5, 'en-US');
    // en-US should produce something like "42.5" with proper separator
    expect(result).toContain('42');
  });

  it('negative zero is displayed as "0"', () => {
    expect(formatNumberPrecision(-0)).toBe('0');
  });
});

// ── formatObjectTree ────────────────────────────────────────────────

describe('formatObjectTree', () => {
  it('returns "{}" for empty object', () => {
    expect(formatObjectTree({})).toBe('{}');
  });

  it('formats a flat object with key-value lines', () => {
    const result = formatObjectTree({ a: 1, b: 'hello' });
    expect(result).toContain('a:');
    expect(result).toContain('b:');
  });

  it('formats nested objects recursively', () => {
    const result = formatObjectTree({ outer: { inner: 42 } });
    expect(result).toContain('outer:');
    expect(result).toContain('inner:');
    expect(result).toContain('42');
  });

  it('replaces deep objects with {…} when depth limit reached', () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const result = formatObjectTree(deep, 2);
    expect(result).toContain('{…}');
  });

  it('truncates keys beyond maxKeys and shows remainder count', () => {
    const wide = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    const result = formatObjectTree(wide, 3, 3);
    expect(result).toContain('…+7 more');
  });

  it('formats null and undefined values correctly', () => {
    const result = formatObjectTree({ a: null, b: undefined } as Record<string, unknown>);
    expect(result).toContain('null');
    expect(result).toContain('undefined');
  });

  it('formats array values using formatArrayCompact', () => {
    const result = formatObjectTree({ items: [1, 2, 3] });
    expect(result).toContain('[1.0, 2.0, 3.0]');
  });
});

// ── formatVector3 ───────────────────────────────────────────────────

describe('formatVector3', () => {
  it('formats a basic vector as (x, y, z)', () => {
    expect(formatVector3([1.5, 2.5, 3.5])).toBe('(1.5, 2.5, 3.5)');
  });

  it('formats the zero vector', () => {
    expect(formatVector3([0, 0, 0])).toBe('(0.0, 0.0, 0.0)');
  });

  it('rounds large components (>= 100) to integers', () => {
    expect(formatVector3([150, 200, 300])).toBe('(150, 200, 300)');
  });

  it('handles negative components', () => {
    expect(formatVector3([-1.5, 0, 3.14])).toBe('(-1.5, 0.0, 3.1)');
  });

  it('handles NaN and Infinity in components', () => {
    expect(formatVector3([NaN, Infinity, -Infinity])).toBe('(?, ∞, -∞)');
  });
});

// ── formatColor ─────────────────────────────────────────────────────

describe('formatColor', () => {
  it('uppercases hex color strings', () => {
    expect(formatColor('#ff0000')).toBe('#FF0000');
    expect(formatColor('#abc')).toBe('#ABC');
  });

  it('preserves already uppercase strings', () => {
    expect(formatColor('#FF0000')).toBe('#FF0000');
  });
});

// ── formatValueDetailed ─────────────────────────────────────────────

describe('formatValueDetailed', () => {
  it('returns "null" for null and "undefined" for undefined', () => {
    expect(formatValueDetailed(null)).toBe('null');
    expect(formatValueDetailed(undefined)).toBe('undefined');
  });

  it('uses formatNumberPrecision for numbers', () => {
    expect(formatValueDetailed(42)).toBe('42');
    expect(formatValueDetailed(NaN)).toBe('NaN');
    expect(formatValueDetailed(Infinity)).toBe('∞');
    expect(formatValueDetailed(0)).toBe('0');
  });

  it('formats booleans as strings', () => {
    expect(formatValueDetailed(true)).toBe('true');
    expect(formatValueDetailed(false)).toBe('false');
  });

  it('JSON-quotes short strings', () => {
    expect(formatValueDetailed('hello')).toBe('"hello"');
    expect(formatValueDetailed('')).toBe('""');
  });

  it('truncates strings over 200 characters', () => {
    const long = 'x'.repeat(300);
    const result = formatValueDetailed(long);
    expect(result).toContain('…');
    // Should be JSON of first 200 chars + ellipsis
    expect(result.length).toBeLessThan(310);
  });

  it('pretty-prints small arrays as JSON', () => {
    const result = formatValueDetailed([1, 2, 3]);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it('shows preview + count for large arrays (> 20 items)', () => {
    const large = Array.from({ length: 30 }, (_, i) => i);
    const result = formatValueDetailed(large);
    expect(result).toContain('[0]:');
    expect(result).toContain('more');
  });

  it('pretty-prints objects as JSON', () => {
    const result = formatValueDetailed({ x: 1, y: 2 });
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('handles circular reference objects without crashing', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const result = formatValueDetailed(circular);
    expect(typeof result).toBe('string');
    expect(result).toContain('a');
  });

  it('truncates very large JSON objects', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 100; i++) big[`longKeyName${i}`] = 'long value content here';
    const result = formatValueDetailed(big);
    // Should be truncated at 500 chars + ellipsis
    expect(result).toContain('…');
    expect(result.length).toBeLessThanOrEqual(505);
  });
});
