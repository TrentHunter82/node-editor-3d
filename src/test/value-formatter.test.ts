/**
 * Comprehensive tests for src/utils/valueFormat.ts (30 tests)
 *
 * Covers all 12 exported functions:
 * - isHexColor (5 tests)
 * - formatNum (4 tests)
 * - formatNumberPrecision (4 tests — complements phase36-features)
 * - formatCompact (4 tests)
 * - formatArrayCompact (3 tests)
 * - formatArrayExpanded (3 tests)
 * - formatObjectCompact (3 tests)
 * - formatObjectTree (3 tests)
 * - formatVector3 (1 test — edge cases)
 * - formatColor (1 test)
 * - formatForTooltip (2 tests — edge cases)
 * - formatValueDetailed (2 tests — edge cases)
 */
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
} from '../utils/valueFormat';

// ---------------------------------------------------------------------------
// isHexColor
// ---------------------------------------------------------------------------
describe('isHexColor', () => {
  it('accepts 3-digit hex', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#FFF')).toBe(true);
    expect(isHexColor('#000')).toBe(true);
  });

  it('accepts 6-digit hex', () => {
    expect(isHexColor('#ff00ff')).toBe(true);
    expect(isHexColor('#ABCDEF')).toBe(true);
    expect(isHexColor('#123456')).toBe(true);
  });

  it('accepts 8-digit hex (RGBA)', () => {
    expect(isHexColor('#ff00ff80')).toBe(true);
    expect(isHexColor('#00000000')).toBe(true);
    expect(isHexColor('#FFFFFFFF')).toBe(true);
  });

  it('rejects invalid hex strings', () => {
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#gg0000')).toBe(false);
    expect(isHexColor('FF0000')).toBe(false);    // missing #
    expect(isHexColor('#12345')).toBe(false);     // 5 digits
    expect(isHexColor('#1234567')).toBe(false);   // 7 digits
    expect(isHexColor('')).toBe(false);
    expect(isHexColor('#')).toBe(false);
  });

  it('rejects non-hex characters after #', () => {
    expect(isHexColor('#xyz')).toBe(false);
    expect(isHexColor('#12G456')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatNum
// ---------------------------------------------------------------------------
describe('formatNum', () => {
  it('returns "?" for NaN and non-numbers', () => {
    expect(formatNum(NaN)).toBe('?');
    expect(formatNum('hello')).toBe('?');
    expect(formatNum(undefined)).toBe('?');
    expect(formatNum(null)).toBe('?');
  });

  it('returns infinity symbols', () => {
    expect(formatNum(Infinity)).toBe('∞');
    expect(formatNum(-Infinity)).toBe('-∞');
  });

  it('rounds large values (>= 100)', () => {
    expect(formatNum(150.7)).toBe('151');
    expect(formatNum(100)).toBe('100');
    expect(formatNum(999.9)).toBe('1000');
  });

  it('shows 1 decimal for values < 100', () => {
    expect(formatNum(0)).toBe('0.0');
    expect(formatNum(42.56)).toBe('42.6');
    expect(formatNum(-3.14)).toBe('-3.1');
    expect(formatNum(99.99)).toBe('100.0');
  });
});

// ---------------------------------------------------------------------------
// formatNumberPrecision (edge cases beyond phase36-features)
// ---------------------------------------------------------------------------
describe('formatNumberPrecision — edge cases', () => {
  it('handles negative zero', () => {
    expect(formatNumberPrecision(-0)).toBe('0');
  });

  it('handles negative large numbers with scientific notation', () => {
    const result = formatNumberPrecision(-2_500_000);
    expect(result).toMatch(/e/);
    expect(result).toBe('-2.50e+6');
  });

  it('respects locale parameter for integers', () => {
    // In en-US locale, 1000 gets a comma
    const result = formatNumberPrecision(1000, 'en-US');
    expect(result).toBe('1,000');
  });

  it('uses adaptive decimals for negative fractional values', () => {
    expect(formatNumberPrecision(-0.5)).toBe('-0.500');  // abs < 1 => 3 decimals
    expect(formatNumberPrecision(-50.5)).toBe('-50.50');  // abs >= 1, < 100 => 2 decimals
  });
});

// ---------------------------------------------------------------------------
// formatCompact
// ---------------------------------------------------------------------------
describe('formatCompact', () => {
  it('truncates long strings with ellipsis', () => {
    const long = 'a'.repeat(20);
    const result = formatCompact(long);
    expect(result.length).toBeLessThanOrEqual(15); // 14 + ellipsis
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('preserves hex color strings without truncation', () => {
    expect(formatCompact('#FF0000')).toBe('#FF0000');
    expect(formatCompact('#abc')).toBe('#abc');
  });

  it('formats objects via formatObjectCompact', () => {
    expect(formatCompact({ a: 1 })).toContain('a:');
    expect(formatCompact({ a: 1, b: 2, c: 3, d: 4 })).toBe('{4 keys}');
  });

  it('respects custom maxLen parameter', () => {
    const result = formatCompact('short text here', 5);
    expect(result).toBe('short\u2026');
  });
});

// ---------------------------------------------------------------------------
// formatArrayCompact
// ---------------------------------------------------------------------------
describe('formatArrayCompact', () => {
  it('formats empty array as "[]"', () => {
    expect(formatArrayCompact([])).toBe('[]');
  });

  it('truncates long string items in small arrays', () => {
    const result = formatArrayCompact(['a very long string']);
    // String > 8 chars gets truncated
    expect(result).toContain('\u2026');
  });

  it('shows "?" for non-number non-string items', () => {
    const result = formatArrayCompact([true, null, undefined]);
    expect(result).toBe('[?, ?, ?]');
  });
});

// ---------------------------------------------------------------------------
// formatArrayExpanded
// ---------------------------------------------------------------------------
describe('formatArrayExpanded', () => {
  it('returns "(empty array)" for empty array', () => {
    expect(formatArrayExpanded([])).toEqual(['(empty array)']);
  });

  it('shows first maxItems elements with index', () => {
    const result = formatArrayExpanded([10, 20, 30, 40, 50, 60, 70], 3);
    expect(result.length).toBe(3);
    expect(result[0]).toBe('[0] 10.00');
    expect(result[1]).toBe('[1] 20.00');
    expect(result[2]).toBe('[2] 30.00');
  });

  it('defaults to 5 items', () => {
    const arr = Array.from({ length: 10 }, (_, i) => i);
    const result = formatArrayExpanded(arr);
    expect(result.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// formatObjectCompact
// ---------------------------------------------------------------------------
describe('formatObjectCompact', () => {
  it('formats empty object as "{}"', () => {
    expect(formatObjectCompact({})).toBe('{}');
  });

  it('shows key-value pairs for 1-2 keys', () => {
    const result = formatObjectCompact({ x: 1, y: 2 });
    expect(result).toContain('x:');
    expect(result).toContain('y:');
  });

  it('shows key count for 3+ keys', () => {
    expect(formatObjectCompact({ a: 1, b: 2, c: 3 })).toBe('{3 keys}');
    expect(formatObjectCompact({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toBe('{5 keys}');
  });
});

// ---------------------------------------------------------------------------
// formatObjectTree
// ---------------------------------------------------------------------------
describe('formatObjectTree — extended', () => {
  it('truncates shown keys to maxKeys and shows remainder', () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) obj[`k${i}`] = i;
    const result = formatObjectTree(obj, 2, 3); // maxKeys=3
    expect(result).toContain('…+7 more');
  });

  it('formats arrays inside objects using formatArrayCompact', () => {
    const result = formatObjectTree({ arr: [1, 2, 3] });
    expect(result).toContain('[1.0, 2.0, 3.0]');
  });

  it('handles null/undefined values', () => {
    const result = formatObjectTree({ a: null, b: undefined });
    expect(result).toContain('null');
    expect(result).toContain('undefined');
  });
});

// ---------------------------------------------------------------------------
// formatVector3
// ---------------------------------------------------------------------------
describe('formatVector3 — edge cases', () => {
  it('handles NaN and Infinity components', () => {
    expect(formatVector3([NaN, Infinity, -Infinity])).toBe('(?, ∞, -∞)');
  });
});

// ---------------------------------------------------------------------------
// formatColor
// ---------------------------------------------------------------------------
describe('formatColor', () => {
  it('uppercases hex color strings', () => {
    expect(formatColor('#ff00aa')).toBe('#FF00AA');
    expect(formatColor('#ABC')).toBe('#ABC');
    expect(formatColor('rgb(0,0,0)')).toBe('RGB(0,0,0)');
  });
});

// ---------------------------------------------------------------------------
// formatForTooltip — edge cases
// ---------------------------------------------------------------------------
describe('formatForTooltip — edge cases', () => {
  it('truncates long strings at 60 chars', () => {
    const long = 'x'.repeat(80);
    const result = formatForTooltip(long);
    expect(result.length).toBe(63); // 60 + "..."
    expect(result.endsWith('...')).toBe(true);
  });

  it('handles circular object references gracefully', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj; // circular
    const result = formatForTooltip(obj);
    expect(result).toBe('{...}');
  });
});

// ---------------------------------------------------------------------------
// formatValueDetailed — edge cases
// ---------------------------------------------------------------------------
describe('formatValueDetailed — edge cases', () => {
  it('returns "undefined" for undefined input', () => {
    expect(formatValueDetailed(undefined)).toBe('undefined');
  });

  it('truncates very long strings with ellipsis', () => {
    const long = 'z'.repeat(300);
    const result = formatValueDetailed(long);
    // Should be JSON-quoted, truncated to 200 chars
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThan(210);
  });
});
