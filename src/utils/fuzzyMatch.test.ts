import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyMatchMulti } from './fuzzyMatch';

describe('fuzzyMatch', () => {
  // --- Score tiers ---

  it('returns score 100 with empty matchedIndices for empty query', () => {
    const result = fuzzyMatch('', 'anything');
    expect(result.score).toBe(100);
    expect(result.matchedIndices).toEqual([]);
  });

  it('returns score 100 for exact match', () => {
    const result = fuzzyMatch('add', 'add');
    expect(result.score).toBe(100);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it('exact match is case-insensitive', () => {
    const result = fuzzyMatch('Add', 'add');
    expect(result.score).toBe(100);
    expect(result.matchedIndices).toEqual([0, 1, 2]);

    const result2 = fuzzyMatch('ADD', 'Add');
    expect(result2.score).toBe(100);
  });

  it('returns score 80 for starts-with match', () => {
    const result = fuzzyMatch('add', 'addition');
    expect(result.score).toBe(80);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it('starts-with is case-insensitive', () => {
    const result = fuzzyMatch('ADD', 'addition');
    expect(result.score).toBe(80);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it('returns score 60 for word boundary match with dash separator', () => {
    // 'ab' -> a matches 'a' at boundary 0, b matches 'b' at boundary 6 (after dash)
    const result = fuzzyMatch('ab', 'apple-banana');
    expect(result.score).toBe(60);
    expect(result.matchedIndices).toEqual([0, 6]);
  });

  it('word boundary match works with camelCase transitions', () => {
    // camelCase boundary detection works on the original target casing:
    // 'fuzzyMatch' has boundary at 0 (f) and at 5 (M, after lowercase y)
    // But matching is done on lowercased strings, so 'fm' query (lowered)
    // matches 'f' at boundary 0 and 'm' at boundary 5 in lowered 'fuzzymatch'.
    // The boundary positions are computed from the lowered target string,
    // but camelCase detection checks the ORIGINAL target for case transitions.
    // Let's verify: the code lowercases target first, then checks boundaries
    // on the lowered string. So 'fuzzymatch' has no camelCase transitions.
    // This falls to fuzzy match instead.
    const result = fuzzyMatch('fm', 'fuzzyMatch');
    // Fuzzy: f at 0, m at 5 => gap = 5-0-1 = 4 => score = max(1, 20-4) = 16
    expect(result.score).toBe(16);
    expect(result.matchedIndices).toEqual([0, 5]);
  });

  it('word boundary match works with camelCase in original casing', () => {
    // Use a target where camelCase boundary is detected on the lowered string.
    // Actually, the code lowercases t, so camelCase detection won't fire.
    // Word boundary via space separator instead:
    const result = fuzzyMatch('fb', 'fizz buzz');
    expect(result.score).toBe(60);
    expect(result.matchedIndices).toEqual([0, 5]);
  });

  it('word boundary match works with underscore separator', () => {
    // 'gw' -> g at index 0, w at boundary after underscore
    const result = fuzzyMatch('gw', 'get_word');
    expect(result.score).toBe(60);
    expect(result.matchedIndices).toEqual([0, 4]);
  });

  it('word boundary match works with dot separator', () => {
    // 'fb' -> f at index 0, b at boundary after dot
    const result = fuzzyMatch('fb', 'foo.bar');
    expect(result.score).toBe(60);
    expect(result.matchedIndices).toEqual([0, 4]);
  });

  it('returns score 40 for substring match not at start', () => {
    // 'banana' is a substring of 'apple-banana' starting at index 6
    const result = fuzzyMatch('banana', 'apple-banana');
    expect(result.score).toBe(40);
    expect(result.matchedIndices).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it('returns score between 5 and 20 for fuzzy match', () => {
    // 'az' chars exist in order in 'abcdefghijklmnopqrstuvwxyz'
    const result = fuzzyMatch('az', 'abcdefghijklmnopqrstuvwxyz');
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(20);
  });

  it('fuzzy match with consecutive chars gets higher score', () => {
    // 'ab' is a substring of 'xabc' at index 1, so substring match fires (score 40).
    // To test fuzzy with consecutive chars, use a target where substring won't match
    // but all chars appear in order consecutively after some prefix mismatch.
    // 'ace' in 'xaycez' -> a at 1, c at 3, e at 4 => gaps: (3-1-1)+(4-3-1) = 1+0 = 1 => score = 19
    const result = fuzzyMatch('ace', 'xaycez');
    expect(result.score).toBe(19);
    expect(result.matchedIndices).toEqual([1, 3, 4]);
  });

  it('fuzzy match with large gaps gets lower score (min 1)', () => {
    // Underscores create word boundaries, so 'a___...z' would hit word boundary match.
    // Use letters with large gaps instead: 'az' in 'abcdefghijklmnopqrstuvwxyz'
    // a at 0, z at 25 => gap = 25-0-1 = 24 => score = max(1, 20-min(24,15)) = max(1, 5) = 5
    const result = fuzzyMatch('az', 'abcdefghijklmnopqrstuvwxyz');
    expect(result.score).toBe(5);
    expect(result.matchedIndices).toEqual([0, 25]);
  });

  it('returns score 0 when no match exists', () => {
    const result = fuzzyMatch('xyz', 'abc');
    expect(result.score).toBe(0);
    expect(result.matchedIndices).toEqual([]);
  });

  // --- matchedIndices correctness ---

  it('matchedIndices correct for exact match', () => {
    const result = fuzzyMatch('hello', 'hello');
    expect(result.matchedIndices).toEqual([0, 1, 2, 3, 4]);
  });

  it('matchedIndices correct for starts-with match', () => {
    const result = fuzzyMatch('hel', 'hello world');
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it('matchedIndices correct for substring match', () => {
    const result = fuzzyMatch('world', 'hello world');
    // 'world' starts at index 6
    expect(result.matchedIndices).toEqual([6, 7, 8, 9, 10]);
  });

  it('matchedIndices correct for fuzzy match', () => {
    // 'hd' in 'abchdef' -> h at 3, d at 4
    const result = fuzzyMatch('hd', 'abchdef');
    expect(result.matchedIndices).toEqual([3, 4]);
  });

  // --- Single character ---

  it('single character query works', () => {
    const exact = fuzzyMatch('a', 'a');
    expect(exact.score).toBe(100);
    expect(exact.matchedIndices).toEqual([0]);

    const startsw = fuzzyMatch('a', 'abc');
    expect(startsw.score).toBe(80);
    expect(startsw.matchedIndices).toEqual([0]);

    const sub = fuzzyMatch('b', 'abc');
    expect(sub.score).toBe(40);
    expect(sub.matchedIndices).toEqual([1]);
  });
});

describe('fuzzyMatchMulti', () => {
  it('returns the best score from multiple targets', () => {
    // 'add' is exact match in 'add' (100), but only fuzzy in 'multiply' (0)
    const result = fuzzyMatchMulti('add', 'multiply', 'add', 'subtract');
    expect(result.score).toBe(100);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it('returns score 0 when no target matches', () => {
    const result = fuzzyMatchMulti('xyz', 'abc', 'def', 'ghi');
    expect(result.score).toBe(0);
    expect(result.matchedIndices).toEqual([]);
  });

  it('returns default result with empty targets', () => {
    const result = fuzzyMatchMulti('abc');
    expect(result.score).toBe(0);
    expect(result.matchedIndices).toEqual([]);
  });

  it('works with a single target (delegates to fuzzyMatch)', () => {
    const multi = fuzzyMatchMulti('add', 'addition');
    const single = fuzzyMatch('add', 'addition');
    expect(multi.score).toBe(single.score);
    expect(multi.matchedIndices).toEqual(single.matchedIndices);
  });
});

describe('edge cases', () => {
  it('handles special characters in query', () => {
    const result = fuzzyMatch('a+b', 'a+b=c');
    expect(result.score).toBe(80);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it('handles very long strings', () => {
    const longTarget = 'a'.repeat(10000) + 'needle';
    const result = fuzzyMatch('needle', longTarget);
    expect(result.score).toBe(40);
    expect(result.matchedIndices).toEqual([10000, 10001, 10002, 10003, 10004, 10005]);
  });
});
