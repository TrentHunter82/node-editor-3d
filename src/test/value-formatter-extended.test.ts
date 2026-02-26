/**
 * Extended value formatter tests (~30 tests).
 * Covers: circular reference protection, locale formatting, deep nesting
 * in formatObjectTree, large string truncation, edge cases for all formatters.
 */
import { describe, it, expect } from 'vitest';
import {
  formatCompact,
  formatArrayCompact,
  formatArrayExpanded,
  formatObjectCompact,
  formatObjectTree,
  formatForTooltip,
  formatValueDetailed,
  formatVector3,
  formatNum,
  formatNumberPrecision,
  formatColor,
  isHexColor,
} from '../utils/valueFormat';

// ---------------------------------------------------------------------------
// Circular reference protection
// ---------------------------------------------------------------------------
describe('circular reference protection', () => {
  it('formatForTooltip handles deeply nested circular object', () => {
    const a: Record<string, unknown> = { id: 1 };
    const b: Record<string, unknown> = { id: 2, parent: a };
    a.child = b;
    // Should not throw, should return fallback
    const result = formatForTooltip(a);
    expect(typeof result).toBe('string');
    expect(result).toBe('{...}');
  });

  it('formatValueDetailed handles circular object gracefully', () => {
    const obj: Record<string, unknown> = { x: 10 };
    obj.self = obj;
    const result = formatValueDetailed(obj);
    expect(typeof result).toBe('string');
    // Falls back to formatObjectCompact
    expect(result).toContain('x:');
  });

  it('formatForTooltip handles circular array', () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr); // circular
    const result = formatForTooltip(arr);
    expect(typeof result).toBe('string');
    // Array(3) or fallback
    expect(result.length).toBeGreaterThan(0);
  });

  it('formatValueDetailed handles circular nested object', () => {
    const root: Record<string, unknown> = { a: { b: {} } };
    (root.a as Record<string, unknown>).b = root; // circular
    const result = formatValueDetailed(root);
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Locale formatting paths
// ---------------------------------------------------------------------------
describe('locale formatting in formatNumberPrecision', () => {
  it('de-DE locale uses comma as decimal separator for fractional', () => {
    const result = formatNumberPrecision(1.5, 'de-DE');
    // German locale uses comma: "1,50" or "1,5"
    expect(result).toContain(',');
  });

  it('en-US locale uses period as decimal separator', () => {
    const result = formatNumberPrecision(1.5, 'en-US');
    expect(result).toContain('.');
  });

  it('locale formatting for large integers', () => {
    // >= 1e6 goes to scientific notation regardless of locale
    const result = formatNumberPrecision(2_000_000, 'en-US');
    expect(result).toContain('e');
  });

  it('locale formatting for small decimals (abs < 1)', () => {
    const result = formatNumberPrecision(0.123, 'en-US');
    // 3 decimals for abs < 1
    expect(result).toBe('0.123');
  });

  it('locale formatting for medium decimals (1 <= abs < 100)', () => {
    const result = formatNumberPrecision(42.567, 'en-US');
    // 2 decimals for 1 <= abs < 100
    expect(result).toBe('42.57');
  });
});

// ---------------------------------------------------------------------------
// Deep nesting in formatObjectTree
// ---------------------------------------------------------------------------
describe('formatObjectTree deep nesting', () => {
  it('stops at maxDepth and shows {…}', () => {
    const deep = { a: { b: { c: { d: 'end' } } } };
    const result = formatObjectTree(deep, 2); // maxDepth=2
    expect(result).toContain('{…}');
    expect(result).not.toContain('end');
  });

  it('depth 0 returns {…} for any non-empty object', () => {
    const result = formatObjectTree({ x: 1 }, 0);
    expect(result).toBe('{…}');
  });

  it('handles mixed nested types correctly', () => {
    const obj = {
      str: 'hello',
      num: 42,
      arr: [1, 2, 3],
      nested: { inner: 'value' },
      nil: null,
    };
    const result = formatObjectTree(obj, 3, 10);
    expect(result).toContain('str:');
    expect(result).toContain('hello');
    expect(result).toContain('[1.0, 2.0, 3.0]');
    expect(result).toContain('inner:');
    expect(result).toContain('null');
  });

  it('respects maxKeys and shows remainder count', () => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 20; i++) obj[`field${i}`] = i;
    const result = formatObjectTree(obj, 2, 5);
    expect(result).toContain('…+15 more');
  });

  it('empty object at nested level returns {}', () => {
    const obj = { nested: {} };
    const result = formatObjectTree(obj, 3);
    expect(result).toContain('{}');
  });
});

// ---------------------------------------------------------------------------
// Large string truncation
// ---------------------------------------------------------------------------
describe('large string truncation', () => {
  it('formatCompact truncates at custom maxLen', () => {
    const str = 'a'.repeat(100);
    const result = formatCompact(str, 10);
    expect(result.length).toBe(11); // 10 + ellipsis
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('formatForTooltip truncates at 60 chars', () => {
    const str = 'b'.repeat(100);
    const result = formatForTooltip(str);
    expect(result.length).toBe(63); // 60 + "..."
    expect(result.endsWith('...')).toBe(true);
  });

  it('formatValueDetailed truncates strings longer than 200 chars', () => {
    const str = 'c'.repeat(500);
    const result = formatValueDetailed(str);
    expect(result.endsWith('…')).toBe(true);
    // Should be JSON-quoted substring
    expect(result.startsWith('"')).toBe(true);
  });

  it('formatCompact does not truncate short strings', () => {
    expect(formatCompact('hello')).toBe('hello');
    expect(formatCompact('ab')).toBe('ab');
  });

  it('formatForTooltip preserves short strings', () => {
    expect(formatForTooltip('short')).toBe('short');
  });

  it('formatValueDetailed wraps short strings in JSON quotes', () => {
    const result = formatValueDetailed('hello world');
    expect(result).toBe('"hello world"');
  });
});

// ---------------------------------------------------------------------------
// formatVector3 edge cases
// ---------------------------------------------------------------------------
describe('formatVector3 extended', () => {
  it('handles non-array input', () => {
    expect(formatVector3('not a vector')).toBe('(?, ?, ?)');
    expect(formatVector3(42)).toBe('(?, ?, ?)');
    expect(formatVector3(null)).toBe('(?, ?, ?)');
  });

  it('handles empty array', () => {
    expect(formatVector3([])).toBe('(?, ?, ?)');
  });

  it('handles partial array', () => {
    const result = formatVector3([1, 2]);
    // Third element is undefined → formatNum returns '?'
    expect(result).toBe('(1.0, 2.0, ?)');
  });

  it('formats large components correctly', () => {
    const result = formatVector3([150, -200, 0.5]);
    expect(result).toBe('(150, -200, 0.5)');
  });
});

// ---------------------------------------------------------------------------
// formatArrayCompact edge cases
// ---------------------------------------------------------------------------
describe('formatArrayCompact extended', () => {
  it('handles exactly 3 elements (boundary)', () => {
    const result = formatArrayCompact([1, 2, 3]);
    expect(result).toBe('[1.0, 2.0, 3.0]');
  });

  it('handles 4 elements → shows item count', () => {
    const result = formatArrayCompact([1, 2, 3, 4]);
    expect(result).toBe('[4 items]');
  });

  it('handles mixed types in small array', () => {
    const result = formatArrayCompact([1, 'hi', true]);
    expect(result).toContain('1.0');
    expect(result).toContain('hi');
    expect(result).toContain('?'); // boolean is not number or string
  });
});

// ---------------------------------------------------------------------------
// formatArrayExpanded edge cases
// ---------------------------------------------------------------------------
describe('formatArrayExpanded extended', () => {
  it('handles single element array', () => {
    const result = formatArrayExpanded([42]);
    expect(result).toEqual(['[0] 42.00']);
  });

  it('handles objects in array', () => {
    const result = formatArrayExpanded([{ a: 1 }]);
    expect(result[0]).toContain('[0]');
    expect(result[0]).toContain('a:');
  });

  it('handles null values in array', () => {
    const result = formatArrayExpanded([null, undefined]);
    expect(result[0]).toContain('[0]');
    expect(result[0]).toContain('\u2014'); // em dash for null
  });
});

// ---------------------------------------------------------------------------
// formatObjectCompact edge cases
// ---------------------------------------------------------------------------
describe('formatObjectCompact extended', () => {
  it('handles single key object', () => {
    const result = formatObjectCompact({ key: 'value' });
    expect(result).toContain('key:');
  });

  it('handles nested object as value', () => {
    const result = formatObjectCompact({ nested: { x: 1 } });
    expect(result).toContain('nested:');
  });
});

// ---------------------------------------------------------------------------
// formatColor edge cases
// ---------------------------------------------------------------------------
describe('formatColor extended', () => {
  it('returns empty string for non-string input', () => {
    expect(formatColor(42)).toBe('');
    expect(formatColor(null)).toBe('');
    expect(formatColor(undefined)).toBe('');
  });

  it('uppercases mixed case strings', () => {
    expect(formatColor('Hello')).toBe('HELLO');
  });
});

// ---------------------------------------------------------------------------
// formatNum boundary values
// ---------------------------------------------------------------------------
describe('formatNum boundary values', () => {
  it('handles exactly 100 (large threshold boundary)', () => {
    expect(formatNum(100)).toBe('100');
  });

  it('handles 99.99 (small value boundary)', () => {
    expect(formatNum(99.99)).toBe('100.0');
  });

  it('handles negative zero', () => {
    expect(formatNum(-0)).toBe('0.0');
  });

  it('handles very small positive number', () => {
    expect(formatNum(0.001)).toBe('0.0');
  });
});

// ---------------------------------------------------------------------------
// isHexColor boundary cases
// ---------------------------------------------------------------------------
describe('isHexColor boundary cases', () => {
  it('rejects 4-digit hex', () => {
    expect(isHexColor('#1234')).toBe(false);
  });

  it('rejects 9-digit hex', () => {
    expect(isHexColor('#123456789')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isHexColor('#aAbBcC')).toBe(true);
  });
});
