/**
 * Phase 49 tests — comprehensive coverage for previously untested processors
 * in executionProcessors.ts.
 *
 * Covers: vector operations, statistics, color operations, array operations,
 * object operations, string operations, flow control, variables, live, date/time.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { processors, setGraphVariablesContext, getGraphVariablesContext } from './executionProcessors';
import type { EditorNode } from '../types';

const makeNode = (type: string, data: Record<string, unknown> = {}): EditorNode => ({
  id: 'test',
  type: type as any,
  title: type,
  position: [0, 0, 0],
  inputs: [],
  outputs: [],
  data,
});

// ---------------------------------------------------------------------------
// 1. Vector operations
// ---------------------------------------------------------------------------
describe('Vector operations', () => {
  describe('dot-product', () => {
    it('computes the dot product of two 3D vectors', () => {
      const result = processors['dot-product'](makeNode('dot-product'), {
        0: [1, 2, 3],
        1: [4, 5, 6],
      });
      // 1*4 + 2*5 + 3*6 = 4+10+18 = 32
      expect(result[0]).toBe(32);
    });

    it('defaults non-array inputs to [0,0,0]', () => {
      const result = processors['dot-product'](makeNode('dot-product'), {
        0: 'not-an-array',
        1: [1, 2, 3],
      });
      expect(result[0]).toBe(0);
    });

    it('defaults non-number elements to 0', () => {
      const result = processors['dot-product'](makeNode('dot-product'), {
        0: ['a', 2, null],
        1: [4, 5, 6],
      });
      // 0*4 + 2*5 + 0*6 = 10
      expect(result[0]).toBe(10);
    });

    it('returns 0 for two zero vectors', () => {
      const result = processors['dot-product'](makeNode('dot-product'), {
        0: [0, 0, 0],
        1: [0, 0, 0],
      });
      expect(result[0]).toBe(0);
    });
  });

  describe('cross-product', () => {
    it('computes cross product of two unit vectors', () => {
      // i x j = k
      const result = processors['cross-product'](makeNode('cross-product'), {
        0: [1, 0, 0],
        1: [0, 1, 0],
      });
      expect(result[0]).toEqual([0, 0, 1]);
    });

    it('returns [0,0,0] for parallel vectors', () => {
      const result = processors['cross-product'](makeNode('cross-product'), {
        0: [2, 0, 0],
        1: [5, 0, 0],
      });
      expect(result[0]).toEqual([0, 0, 0]);
    });

    it('defaults non-array inputs to [0,0,0]', () => {
      const result = processors['cross-product'](makeNode('cross-product'), {
        0: 42,
        1: [1, 2, 3],
      });
      expect(result[0]).toEqual([0, 0, 0]);
    });
  });

  describe('normalize-vec3', () => {
    it('normalizes a vector to unit length', () => {
      const result = processors['normalize-vec3'](makeNode('normalize-vec3'), {
        0: [3, 0, 0],
      });
      expect(result[0]).toEqual([1, 0, 0]);
    });

    it('returns [0,0,0] for zero vector', () => {
      const result = processors['normalize-vec3'](makeNode('normalize-vec3'), {
        0: [0, 0, 0],
      });
      expect(result[0]).toEqual([0, 0, 0]);
    });

    it('normalizes an arbitrary vector correctly', () => {
      const result = processors['normalize-vec3'](makeNode('normalize-vec3'), {
        0: [1, 1, 1],
      });
      const vec = result[0] as number[];
      const len = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2);
      expect(len).toBeCloseTo(1, 10);
    });
  });

  describe('vec3-length', () => {
    it('computes length of a 3D vector', () => {
      const result = processors['vec3-length'](makeNode('vec3-length'), {
        0: [3, 4, 0],
      });
      expect(result[0]).toBe(5);
    });

    it('returns 0 for zero vector', () => {
      const result = processors['vec3-length'](makeNode('vec3-length'), {
        0: [0, 0, 0],
      });
      expect(result[0]).toBe(0);
    });

    it('defaults non-array input to [0,0,0]', () => {
      const result = processors['vec3-length'](makeNode('vec3-length'), {
        0: 'string',
      });
      expect(result[0]).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Statistics
// ---------------------------------------------------------------------------
describe('Statistics', () => {
  describe('mean', () => {
    it('computes the mean of numeric values', () => {
      const result = processors['mean'](makeNode('mean'), { 0: [2, 4, 6] });
      expect(result[0]).toBe(4);
    });

    it('returns 0 for empty array', () => {
      const result = processors['mean'](makeNode('mean'), { 0: [] });
      expect(result[0]).toBe(0);
    });

    it('filters out NaN values', () => {
      const result = processors['mean'](makeNode('mean'), { 0: [10, NaN, 20] });
      expect(result[0]).toBe(15);
    });

    it('returns 0 for non-array input', () => {
      const result = processors['mean'](makeNode('mean'), { 0: 'hello' });
      expect(result[0]).toBe(0);
    });
  });

  describe('median', () => {
    it('returns middle value for odd-length array', () => {
      const result = processors['median'](makeNode('median'), { 0: [3, 1, 2] });
      expect(result[0]).toBe(2);
    });

    it('returns average of two middle values for even-length array', () => {
      const result = processors['median'](makeNode('median'), { 0: [1, 2, 3, 4] });
      expect(result[0]).toBe(2.5);
    });

    it('returns 0 for empty array', () => {
      const result = processors['median'](makeNode('median'), { 0: [] });
      expect(result[0]).toBe(0);
    });
  });

  describe('stddev', () => {
    it('computes population standard deviation', () => {
      const result = processors['stddev'](makeNode('stddev'), { 0: [2, 4, 4, 4, 5, 5, 7, 9] });
      expect(result[0]).toBe(2);
    });

    it('returns 0 for empty array', () => {
      const result = processors['stddev'](makeNode('stddev'), { 0: [] });
      expect(result[0]).toBe(0);
    });

    it('returns 0 for single element', () => {
      const result = processors['stddev'](makeNode('stddev'), { 0: [5] });
      expect(result[0]).toBe(0);
    });

    it('filters NaN from input', () => {
      const result = processors['stddev'](makeNode('stddev'), { 0: [10, NaN, 10] });
      expect(result[0]).toBe(0);
    });
  });

  describe('min-array', () => {
    it('finds the minimum value', () => {
      const result = processors['min-array'](makeNode('min-array'), { 0: [5, 3, 8, 1, 7] });
      expect(result[0]).toBe(1);
    });

    it('returns 0 for empty array', () => {
      const result = processors['min-array'](makeNode('min-array'), { 0: [] });
      expect(result[0]).toBe(0);
    });

    it('filters NaN values', () => {
      const result = processors['min-array'](makeNode('min-array'), { 0: [NaN, 5, 2] });
      expect(result[0]).toBe(2);
    });
  });

  describe('max-array', () => {
    it('finds the maximum value', () => {
      const result = processors['max-array'](makeNode('max-array'), { 0: [5, 3, 8, 1, 7] });
      expect(result[0]).toBe(8);
    });

    it('returns 0 for empty array', () => {
      const result = processors['max-array'](makeNode('max-array'), { 0: [] });
      expect(result[0]).toBe(0);
    });

    it('handles negative numbers', () => {
      const result = processors['max-array'](makeNode('max-array'), { 0: [-5, -3, -8] });
      expect(result[0]).toBe(-3);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Color operations
// ---------------------------------------------------------------------------
describe('Color operations', () => {
  describe('color-picker', () => {
    it('parses a 6-char hex color', () => {
      const result = processors['color-picker'](makeNode('color-picker', { color: '#ff8040' }), {});
      expect(result[0]).toBe('#ff8040');
      expect(result[1]).toBe(255);
      expect(result[2]).toBe(128);
      expect(result[3]).toBe(64);
    });

    it('parses a 3-char hex color', () => {
      const result = processors['color-picker'](makeNode('color-picker', { color: '#f00' }), {});
      expect(result[0]).toBe('#f00');
      expect(result[1]).toBe(255);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(0);
    });

    it('returns 0,0,0 for invalid hex length', () => {
      const result = processors['color-picker'](makeNode('color-picker', { color: '#12345' }), {});
      expect(result[0]).toBe('#12345');
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(0);
    });

    it('defaults to #000000 when no color provided', () => {
      const result = processors['color-picker'](makeNode('color-picker'), {});
      expect(result[0]).toBe('#000000');
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(0);
    });
  });

  describe('color-mix', () => {
    it('mixes black and white at t=0.5 to get gray', () => {
      const result = processors['color-mix'](makeNode('color-mix'), {
        0: '#000000',
        1: '#ffffff',
        2: 0.5,
      });
      expect(result[0]).toBe('#808080');
    });

    it('returns first color at t=0', () => {
      const result = processors['color-mix'](makeNode('color-mix'), {
        0: '#ff0000',
        1: '#0000ff',
        2: 0,
      });
      expect(result[0]).toBe('#ff0000');
    });

    it('returns second color at t=1', () => {
      const result = processors['color-mix'](makeNode('color-mix'), {
        0: '#ff0000',
        1: '#0000ff',
        2: 1,
      });
      expect(result[0]).toBe('#0000ff');
    });

    it('clamps t to 0-1 range', () => {
      const atNeg = processors['color-mix'](makeNode('color-mix'), {
        0: '#ff0000',
        1: '#0000ff',
        2: -5,
      });
      expect(atNeg[0]).toBe('#ff0000');

      const atOver = processors['color-mix'](makeNode('color-mix'), {
        0: '#ff0000',
        1: '#0000ff',
        2: 10,
      });
      expect(atOver[0]).toBe('#0000ff');
    });
  });

  describe('hsl-to-rgb', () => {
    it('converts pure red (H=0, S=100, L=50)', () => {
      const result = processors['hsl-to-rgb'](makeNode('hsl-to-rgb'), {
        0: 0,
        1: 100,
        2: 50,
      });
      expect(result[0]).toBe('#ff0000');
      expect(result[1]).toBe(255);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(0);
    });

    it('converts pure green (H=120)', () => {
      const result = processors['hsl-to-rgb'](makeNode('hsl-to-rgb'), {
        0: 120,
        1: 100,
        2: 50,
      });
      expect(result[0]).toBe('#00ff00');
    });

    it('handles negative hue via modular wrapping', () => {
      // -60 should wrap to 300 (magenta region)
      const result = processors['hsl-to-rgb'](makeNode('hsl-to-rgb'), {
        0: -60,
        1: 100,
        2: 50,
      });
      // 300 degrees, S=100, L=50 => magenta #ff00ff
      expect(result[0]).toBe('#ff00ff');
    });

    it('clamps S and L to 0-100', () => {
      const result = processors['hsl-to-rgb'](makeNode('hsl-to-rgb'), {
        0: 0,
        1: 200,
        2: -50,
      });
      // S clamped to 100 (1.0), L clamped to 0 (0.0)
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
      expect(result[3]).toBe(0);
    });
  });

  describe('rgb-to-hsl', () => {
    it('converts pure red to H=0, S=100, L=50', () => {
      const result = processors['rgb-to-hsl'](makeNode('rgb-to-hsl'), {
        0: 255,
        1: 0,
        2: 0,
      });
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(100);
      expect(result[2]).toBe(50);
    });

    it('converts white to H=0, S=0, L=100', () => {
      const result = processors['rgb-to-hsl'](makeNode('rgb-to-hsl'), {
        0: 255,
        1: 255,
        2: 255,
      });
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(100);
    });

    it('converts black to H=0, S=0, L=0', () => {
      const result = processors['rgb-to-hsl'](makeNode('rgb-to-hsl'), {
        0: 0,
        1: 0,
        2: 0,
      });
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
      expect(result[2]).toBe(0);
    });

    it('clamps RGB values to 0-255', () => {
      const result = processors['rgb-to-hsl'](makeNode('rgb-to-hsl'), {
        0: 300,
        1: -50,
        2: 0,
      });
      // 300 clamped to 255, -50 clamped to 0
      // So equivalent to (255, 0, 0) => red
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(100);
      expect(result[2]).toBe(50);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Array operations
// ---------------------------------------------------------------------------
describe('Array operations', () => {
  describe('array-push', () => {
    it('appends element to array', () => {
      const result = processors['array-push'](makeNode('array-push'), {
        0: [1, 2, 3],
        1: 4,
      });
      expect(result[0]).toEqual([1, 2, 3, 4]);
    });

    it('does not mutate original array', () => {
      const original = [1, 2, 3];
      processors['array-push'](makeNode('array-push'), { 0: original, 1: 4 });
      expect(original).toEqual([1, 2, 3]);
    });

    it('creates new array if input is not an array', () => {
      const result = processors['array-push'](makeNode('array-push'), { 0: 'not-array', 1: 'x' });
      expect(result[0]).toEqual(['x']);
    });

    it('pushes null when no element is provided', () => {
      const result = processors['array-push'](makeNode('array-push'), { 0: [1] });
      expect(result[0]).toEqual([1, null]);
    });
  });

  describe('array-sort', () => {
    it('sorts numbers numerically', () => {
      const result = processors['array-sort'](makeNode('array-sort'), {
        0: [3, 1, 4, 1, 5],
      });
      expect(result[0]).toEqual([1, 1, 3, 4, 5]);
    });

    it('sorts strings with localeCompare', () => {
      const result = processors['array-sort'](makeNode('array-sort'), {
        0: ['banana', 'apple', 'cherry'],
      });
      expect(result[0]).toEqual(['apple', 'banana', 'cherry']);
    });

    it('does not mutate original array', () => {
      const original = [3, 1, 2];
      processors['array-sort'](makeNode('array-sort'), { 0: original });
      expect(original).toEqual([3, 1, 2]);
    });
  });

  describe('array-reverse', () => {
    it('reverses an array', () => {
      const result = processors['array-reverse'](makeNode('array-reverse'), {
        0: [1, 2, 3],
      });
      expect(result[0]).toEqual([3, 2, 1]);
    });

    it('does not mutate original array', () => {
      const original = [1, 2, 3];
      processors['array-reverse'](makeNode('array-reverse'), { 0: original });
      expect(original).toEqual([1, 2, 3]);
    });

    it('returns empty array for non-array input', () => {
      const result = processors['array-reverse'](makeNode('array-reverse'), { 0: null });
      expect(result[0]).toEqual([]);
    });
  });

  describe('array-zip', () => {
    it('pairs elements from two arrays', () => {
      const result = processors['array-zip'](makeNode('array-zip'), {
        0: [1, 2, 3],
        1: ['a', 'b', 'c'],
      });
      expect(result[0]).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
    });

    it('length is min of two arrays', () => {
      const result = processors['array-zip'](makeNode('array-zip'), {
        0: [1, 2],
        1: ['a', 'b', 'c', 'd'],
      });
      expect(result[0]).toEqual([[1, 'a'], [2, 'b']]);
    });

    it('returns empty array if one input is empty', () => {
      const result = processors['array-zip'](makeNode('array-zip'), {
        0: [],
        1: [1, 2, 3],
      });
      expect(result[0]).toEqual([]);
    });
  });

  describe('array-unique', () => {
    it('removes duplicate primitives', () => {
      const result = processors['array-unique'](makeNode('array-unique'), {
        0: [1, 2, 2, 3, 3, 3],
      });
      expect(result[0]).toEqual([1, 2, 3]);
      expect(result[1]).toBe(3);
    });

    it('deduplicates objects by JSON.stringify', () => {
      const result = processors['array-unique'](makeNode('array-unique'), {
        0: [{ a: 1 }, { a: 1 }, { b: 2 }],
      });
      expect(result[0]).toEqual([{ a: 1 }, { b: 2 }]);
      expect(result[1]).toBe(2);
    });

    it('returns empty array and count 0 for non-array', () => {
      const result = processors['array-unique'](makeNode('array-unique'), { 0: 'not-array' });
      expect(result[0]).toEqual([]);
      expect(result[1]).toBe(0);
    });
  });

  describe('array-map', () => {
    it('maps each element with an expression', () => {
      const result = processors['array-map'](
        makeNode('array-map', { expression: 'x * 2' }),
        { 0: [1, 2, 3] },
      );
      expect(result[0]).toEqual([2, 4, 6]);
    });

    it('provides index variable i', () => {
      const result = processors['array-map'](
        makeNode('array-map', { expression: 'x + i' }),
        { 0: [10, 20, 30] },
      );
      expect(result[0]).toEqual([10, 21, 32]);
    });

    it('provides Math object access', () => {
      const result = processors['array-map'](
        makeNode('array-map', { expression: 'Math.abs(x)' }),
        { 0: [-1, -2, 3] },
      );
      expect(result[0]).toEqual([1, 2, 3]);
    });

    it('throws on invalid expression syntax', () => {
      expect(() =>
        processors['array-map'](makeNode('array-map', { expression: '???' }), { 0: [1] }),
      ).toThrow('Array map compile error');
    });
  });

  describe('array-reduce', () => {
    it('reduces array with expression', () => {
      const result = processors['array-reduce'](
        makeNode('array-reduce', { expression: 'acc + x' }),
        { 0: [1, 2, 3, 4], 1: 0 },
      );
      expect(result[0]).toBe(10);
    });

    it('uses provided initial value', () => {
      const result = processors['array-reduce'](
        makeNode('array-reduce', { expression: 'acc + x' }),
        { 0: [1, 2, 3], 1: 100 },
      );
      expect(result[0]).toBe(106);
    });

    it('provides index variable i', () => {
      const result = processors['array-reduce'](
        makeNode('array-reduce', { expression: 'acc + i' }),
        { 0: ['a', 'b', 'c'], 1: 0 },
      );
      // 0 + 0 + 1 + 2 = 3
      expect(result[0]).toBe(3);
    });
  });

  describe('create-array', () => {
    it('creates array from up to 4 inputs', () => {
      const result = processors['create-array'](makeNode('create-array'), {
        0: 'a',
        1: 'b',
        2: 'c',
        3: 'd',
      });
      expect(result[0]).toEqual(['a', 'b', 'c', 'd']);
    });

    it('skips undefined inputs', () => {
      const result = processors['create-array'](makeNode('create-array'), {
        0: 'a',
        2: 'c',
      });
      expect(result[0]).toEqual(['a', 'c']);
    });

    it('returns empty array when no inputs', () => {
      const result = processors['create-array'](makeNode('create-array'), {});
      expect(result[0]).toEqual([]);
    });
  });

  describe('get-element', () => {
    it('gets element by positive index', () => {
      const result = processors['get-element'](makeNode('get-element'), {
        0: [10, 20, 30],
        1: 1,
      });
      expect(result[0]).toBe(20);
    });

    it('supports negative indexing', () => {
      const result = processors['get-element'](makeNode('get-element'), {
        0: [10, 20, 30],
        1: -1,
      });
      expect(result[0]).toBe(30);
    });

    it('returns null for out of bounds', () => {
      const result = processors['get-element'](makeNode('get-element'), {
        0: [10, 20],
        1: 5,
      });
      expect(result[0]).toBeNull();
    });

    it('returns null for negative out of bounds', () => {
      const result = processors['get-element'](makeNode('get-element'), {
        0: [10, 20],
        1: -5,
      });
      expect(result[0]).toBeNull();
    });
  });

  describe('set-element', () => {
    it('sets element at index (non-mutating)', () => {
      const original = [1, 2, 3];
      const result = processors['set-element'](makeNode('set-element'), {
        0: original,
        1: 1,
        2: 99,
      });
      expect(result[0]).toEqual([1, 99, 3]);
      expect(original).toEqual([1, 2, 3]);
    });

    it('extends array for out-of-bounds positive index', () => {
      const result = processors['set-element'](makeNode('set-element'), {
        0: [1],
        1: 3,
        2: 'x',
      });
      expect(result[0]).toEqual([1, null, null, 'x']);
    });

    it('ignores negative index', () => {
      const result = processors['set-element'](makeNode('set-element'), {
        0: [1, 2, 3],
        1: -1,
        2: 99,
      });
      expect(result[0]).toEqual([1, 2, 3]);
    });
  });

  describe('array-length', () => {
    it('returns length of array', () => {
      const result = processors['array-length'](makeNode('array-length'), {
        0: [1, 2, 3, 4, 5],
      });
      expect(result[0]).toBe(5);
    });

    it('returns 0 for non-array', () => {
      const result = processors['array-length'](makeNode('array-length'), {
        0: 'not-array',
      });
      expect(result[0]).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Object operations
// ---------------------------------------------------------------------------
describe('Object operations', () => {
  describe('create-object', () => {
    it('creates object from key-value pairs', () => {
      const result = processors['create-object'](makeNode('create-object'), {
        0: 'name',
        1: 'Alice',
        2: 'age',
        3: 30,
      });
      expect(result[0]).toEqual({ name: 'Alice', age: 30 });
    });

    it('skips pairs with null or empty keys', () => {
      const result = processors['create-object'](makeNode('create-object'), {
        0: '',
        1: 'skipped',
        2: 'valid',
        3: 42,
      });
      expect(result[0]).toEqual({ valid: 42 });
    });

    it('defaults value to null when only key provided', () => {
      const result = processors['create-object'](makeNode('create-object'), {
        0: 'key',
      });
      expect(result[0]).toEqual({ key: null });
    });
  });

  describe('get-property', () => {
    it('retrieves a property from an object', () => {
      const result = processors['get-property'](makeNode('get-property'), {
        0: { name: 'Bob', age: 25 },
        1: 'name',
      });
      expect(result[0]).toBe('Bob');
    });

    it('returns null for non-existent property', () => {
      const result = processors['get-property'](makeNode('get-property'), {
        0: { name: 'Bob' },
        1: 'missing',
      });
      expect(result[0]).toBeNull();
    });

    it('returns null for arrays', () => {
      const result = processors['get-property'](makeNode('get-property'), {
        0: [1, 2, 3],
        1: '0',
      });
      expect(result[0]).toBeNull();
    });

    it('returns null for null input', () => {
      const result = processors['get-property'](makeNode('get-property'), {
        0: null,
        1: 'key',
      });
      expect(result[0]).toBeNull();
    });
  });

  describe('set-property', () => {
    it('sets a property on a copy of object', () => {
      const original = { a: 1 };
      const result = processors['set-property'](makeNode('set-property'), {
        0: original,
        1: 'b',
        2: 2,
      });
      expect(result[0]).toEqual({ a: 1, b: 2 });
      expect(original).toEqual({ a: 1 });
    });

    it('creates new object if input is non-object', () => {
      const result = processors['set-property'](makeNode('set-property'), {
        0: 'string',
        1: 'key',
        2: 'val',
      });
      expect(result[0]).toEqual({ key: 'val' });
    });

    it('creates new object if input is array', () => {
      const result = processors['set-property'](makeNode('set-property'), {
        0: [1, 2],
        1: 'key',
        2: 'val',
      });
      expect(result[0]).toEqual({ key: 'val' });
    });
  });

  describe('object-keys', () => {
    it('returns keys of an object', () => {
      const result = processors['object-keys'](makeNode('object-keys'), {
        0: { a: 1, b: 2, c: 3 },
      });
      expect(result[0]).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for non-objects', () => {
      expect(processors['object-keys'](makeNode('object-keys'), { 0: 42 })[0]).toEqual([]);
      expect(processors['object-keys'](makeNode('object-keys'), { 0: [1, 2] })[0]).toEqual([]);
      expect(processors['object-keys'](makeNode('object-keys'), { 0: null })[0]).toEqual([]);
    });
  });

  describe('object-values', () => {
    it('returns values of an object', () => {
      const result = processors['object-values'](makeNode('object-values'), {
        0: { a: 1, b: 'two', c: true },
      });
      expect(result[0]).toEqual([1, 'two', true]);
    });

    it('returns empty array for non-objects', () => {
      expect(processors['object-values'](makeNode('object-values'), { 0: 'str' })[0]).toEqual([]);
    });
  });

  describe('merge-objects', () => {
    it('merges two objects with B overwriting A', () => {
      const result = processors['merge-objects'](makeNode('merge-objects'), {
        0: { a: 1, b: 2 },
        1: { b: 99, c: 3 },
      });
      expect(result[0]).toEqual({ a: 1, b: 99, c: 3 });
    });

    it('treats non-objects as empty objects', () => {
      const result = processors['merge-objects'](makeNode('merge-objects'), {
        0: 'not-obj',
        1: { key: 'val' },
      });
      expect(result[0]).toEqual({ key: 'val' });
    });

    it('returns empty object when both inputs are non-objects', () => {
      const result = processors['merge-objects'](makeNode('merge-objects'), {
        0: null,
        1: 42,
      });
      expect(result[0]).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// 6. String operations
// ---------------------------------------------------------------------------
describe('String operations', () => {
  describe('string-concat', () => {
    it('concatenates two strings', () => {
      const result = processors['string-concat'](makeNode('string-concat'), {
        0: 'hello',
        1: ' world',
      });
      expect(result[0]).toBe('hello world');
    });

    it('coerces non-string inputs with String()', () => {
      const result = processors['string-concat'](makeNode('string-concat'), {
        0: 42,
        1: true,
      });
      expect(result[0]).toBe('42true');
    });

    it('handles null/undefined as empty string', () => {
      const result = processors['string-concat'](makeNode('string-concat'), {});
      expect(result[0]).toBe('');
    });
  });

  describe('string-replace', () => {
    it('replaces all literal occurrences', () => {
      const result = processors['string-replace'](makeNode('string-replace'), {
        0: 'aabbcc',
        1: 'b',
        2: 'X',
      });
      expect(result[0]).toBe('aaXXcc');
    });

    it('returns original when search is empty', () => {
      const result = processors['string-replace'](makeNode('string-replace'), {
        0: 'hello',
        1: '',
        2: 'X',
      });
      expect(result[0]).toBe('hello');
    });

    it('supports regex mode', () => {
      const result = processors['string-replace'](
        makeNode('string-replace', { useRegex: true }),
        { 0: 'abc123def456', 1: '\\d+', 2: '#' },
      );
      expect(result[0]).toBe('abc#def#');
    });
  });

  describe('string-includes', () => {
    it('returns true when substring is found', () => {
      const result = processors['string-includes'](makeNode('string-includes'), {
        0: 'hello world',
        1: 'world',
      });
      expect(result[0]).toBe(true);
    });

    it('returns false when substring is not found', () => {
      const result = processors['string-includes'](makeNode('string-includes'), {
        0: 'hello world',
        1: 'xyz',
      });
      expect(result[0]).toBe(false);
    });

    it('returns true for empty search string', () => {
      const result = processors['string-includes'](makeNode('string-includes'), {
        0: 'hello',
        1: '',
      });
      expect(result[0]).toBe(true);
    });
  });

  describe('string-template', () => {
    it('replaces ${in0} through ${in3} placeholders', () => {
      const result = processors['string-template'](makeNode('string-template'), {
        0: 'Name: ${in0}, Age: ${in1}',
        1: 'Alice',
        2: 30,
      });
      expect(result[0]).toBe('Name: Alice, Age: 30');
    });

    it('replaces multiple occurrences of same placeholder', () => {
      const result = processors['string-template'](makeNode('string-template'), {
        0: '${in0} and ${in0}',
        1: 'x',
      });
      expect(result[0]).toBe('x and x');
    });

    it('replaces unset placeholders with empty string', () => {
      const result = processors['string-template'](makeNode('string-template'), {
        0: 'Value: ${in0}',
      });
      expect(result[0]).toBe('Value: ');
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Flow control
// ---------------------------------------------------------------------------
describe('Flow control', () => {
  describe('if-gate', () => {
    it('returns trueVal when condition is truthy', () => {
      const result = processors['if-gate'](makeNode('if-gate'), {
        0: 1,
        1: 'yes',
        2: 'no',
      });
      expect(result[0]).toBe('yes');
    });

    it('returns falseVal when condition is falsy', () => {
      const result = processors['if-gate'](makeNode('if-gate'), {
        0: 0,
        1: 'yes',
        2: 'no',
      });
      expect(result[0]).toBe('no');
    });

    it('treats empty string as falsy', () => {
      const result = processors['if-gate'](makeNode('if-gate'), {
        0: '',
        1: 'yes',
        2: 'no',
      });
      expect(result[0]).toBe('no');
    });

    it('treats non-empty string as truthy', () => {
      const result = processors['if-gate'](makeNode('if-gate'), {
        0: 'anything',
        1: 'yes',
        2: 'no',
      });
      expect(result[0]).toBe('yes');
    });
  });

  describe('select', () => {
    it('selects input by index', () => {
      const result = processors['select'](makeNode('select'), {
        0: 2,
        1: 'a',
        2: 'b',
        3: 'c',
        4: 'd',
      });
      expect(result[0]).toBe('c');
    });

    it('clamps index to 0-3 range (low)', () => {
      const result = processors['select'](makeNode('select'), {
        0: -5,
        1: 'first',
        2: 'second',
      });
      expect(result[0]).toBe('first');
    });

    it('clamps index to 0-3 range (high)', () => {
      const result = processors['select'](makeNode('select'), {
        0: 100,
        1: 'a',
        2: 'b',
        3: 'c',
        4: 'd',
      });
      expect(result[0]).toBe('d');
    });

    it('returns null when selected input is not provided', () => {
      const result = processors['select'](makeNode('select'), {
        0: 2,
        1: 'a',
      });
      expect(result[0]).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 8. Variables
// ---------------------------------------------------------------------------
describe('Variables', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  describe('get-var', () => {
    it('retrieves a variable from the context', () => {
      setGraphVariablesContext({ myVar: 42 });
      const result = processors['get-var'](makeNode('get-var', { variableName: 'myVar' }), {});
      expect(result[0]).toBe(42);
    });

    it('returns 0 if variable is not in context', () => {
      setGraphVariablesContext({});
      const result = processors['get-var'](makeNode('get-var', { variableName: 'missing' }), {});
      expect(result[0]).toBe(0);
    });

    it('throws if variableName is not set', () => {
      expect(() =>
        processors['get-var'](makeNode('get-var', {}), {}),
      ).toThrow('get-var: variableName is not configured');
    });

    it('throws if variableName is empty string', () => {
      expect(() =>
        processors['get-var'](makeNode('get-var', { variableName: '' }), {}),
      ).toThrow('get-var: variableName is not configured');
    });
  });

  describe('set-var', () => {
    it('sets a variable in the context and returns value', () => {
      setGraphVariablesContext({});
      const result = processors['set-var'](
        makeNode('set-var', { variableName: 'myVar' }),
        { 0: 'hello' },
      );
      expect(result[0]).toBe('hello');
      expect(getGraphVariablesContext()['myVar']).toBe('hello');
    });

    it('throws if variableName is not set', () => {
      expect(() =>
        processors['set-var'](makeNode('set-var', {}), { 0: 10 }),
      ).toThrow('set-var: variableName is not configured');
    });

    it('sets null when input is not provided', () => {
      setGraphVariablesContext({});
      const result = processors['set-var'](
        makeNode('set-var', { variableName: 'x' }),
        {},
      );
      expect(result[0]).toBeNull();
      expect(getGraphVariablesContext()['x']).toBeNull();
    });

    it('overwrites existing variable', () => {
      setGraphVariablesContext({ x: 'old' });
      processors['set-var'](makeNode('set-var', { variableName: 'x' }), { 0: 'new' });
      expect(getGraphVariablesContext()['x']).toBe('new');
    });
  });
});

// ---------------------------------------------------------------------------
// 9. Live
// ---------------------------------------------------------------------------
describe('Live', () => {
  describe('timer', () => {
    it('returns Date.now() % intervalMs', () => {
      const result = processors['timer'](makeNode('timer', { intervalMs: 1000 }), {});
      const val = result[0] as number;
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1000);
    });

    it('uses minimum intervalMs of 1', () => {
      const result = processors['timer'](makeNode('timer', { intervalMs: -100 }), {});
      // Date.now() % 1 is always 0
      expect(result[0]).toBe(0);
    });

    it('defaults intervalMs to 1000', () => {
      const result = processors['timer'](makeNode('timer'), {});
      const val = result[0] as number;
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1000);
    });
  });

  describe('http-fetch', () => {
    it('returns cached data from node.data', () => {
      const result = processors['http-fetch'](
        makeNode('http-fetch', {
          _fetchResult: { data: 'test' },
          _fetchStatus: 200,
          _fetchError: '',
        }),
        { 0: 'https://example.com' },
      );
      expect(result[0]).toEqual({ data: 'test' });
      expect(result[1]).toBe(200);
      expect(result[2]).toBe('');
    });

    it('returns empty state for empty URL', () => {
      const result = processors['http-fetch'](
        makeNode('http-fetch', {
          _fetchResult: { stale: true },
          _fetchStatus: 200,
        }),
        { 0: '' },
      );
      expect(result[0]).toBeNull();
      expect(result[1]).toBe(0);
      expect(result[2]).toBe('');
    });

    it('returns defaults when no cached data exists', () => {
      const result = processors['http-fetch'](makeNode('http-fetch'), {
        0: 'https://example.com',
      });
      expect(result[0]).toBeNull();
      expect(result[1]).toBe(0);
      expect(result[2]).toBe('');
    });

    it('returns cached error string', () => {
      const result = processors['http-fetch'](
        makeNode('http-fetch', {
          _fetchError: 'Network error',
          _fetchStatus: 0,
        }),
        { 0: 'https://example.com' },
      );
      expect(result[2]).toBe('Network error');
    });
  });
});

// ---------------------------------------------------------------------------
// 10. Date/Time
// ---------------------------------------------------------------------------
describe('Date/Time', () => {
  describe('get-timestamp', () => {
    it('returns a number close to Date.now()', () => {
      const before = Date.now();
      const result = processors['get-timestamp'](makeNode('get-timestamp'), {});
      const after = Date.now();
      const ts = result[0] as number;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe('format-date', () => {
    it('formats a valid timestamp into ISO, date, and time parts', () => {
      // 2024-01-15T12:30:45.000Z
      const ts = Date.UTC(2024, 0, 15, 12, 30, 45, 0);
      const result = processors['format-date'](makeNode('format-date'), { 0: ts });
      expect(result[0]).toBe('2024-01-15T12:30:45.000Z');
      expect(result[1]).toBe('2024-01-15');
      expect(result[2]).toBe('12:30:45');
    });

    it('formats timestamp 0 (epoch)', () => {
      const result = processors['format-date'](makeNode('format-date'), { 0: 0 });
      expect(result[0]).toBe('1970-01-01T00:00:00.000Z');
      expect(result[1]).toBe('1970-01-01');
      expect(result[2]).toBe('00:00:00');
    });

    it('throws for invalid timestamp (NaN)', () => {
      expect(() =>
        processors['format-date'](makeNode('format-date'), { 0: NaN }),
      ).toThrow('Invalid timestamp');
    });
  });

  describe('parse-date', () => {
    it('parses a valid date string', () => {
      const result = processors['parse-date'](makeNode('parse-date'), {
        0: '2024-01-15T12:30:45.000Z',
      });
      expect(result[0]).toBe(Date.UTC(2024, 0, 15, 12, 30, 45, 0));
      expect(result[1]).toBe(true);
    });

    it('returns {0: 0, 1: false} for empty string', () => {
      const result = processors['parse-date'](makeNode('parse-date'), { 0: '' });
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(false);
    });

    it('returns {0: 0, 1: false} for unparseable string', () => {
      const result = processors['parse-date'](makeNode('parse-date'), { 0: 'not-a-date' });
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(false);
    });

    it('parses simple date format', () => {
      const result = processors['parse-date'](makeNode('parse-date'), { 0: '2024-06-01' });
      expect(result[1]).toBe(true);
      expect(typeof result[0]).toBe('number');
      expect(result[0]).toBeGreaterThan(0);
    });
  });
});
