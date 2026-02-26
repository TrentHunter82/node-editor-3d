/**
 * Simple fuzzy matching with scoring for search palette.
 * Scores:
 * - Exact match: 100
 * - Starts with query: 80
 * - Word boundary match (all query chars at word starts): 60
 * - Substring match: 40
 * - Fuzzy match (all chars in order): 20
 * - No match: 0
 */

export interface FuzzyResult {
  score: number;
  /** Indices of matched characters in the target string (for highlighting) */
  matchedIndices: number[];
}

/**
 * Score how well `query` matches `target`.
 * Returns { score: 0 } if no match.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  if (!query) return { score: 100, matchedIndices: [] };

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact match
  if (t === q) {
    return { score: 100, matchedIndices: Array.from({ length: t.length }, (_, i) => i) };
  }

  // Starts-with match
  if (t.startsWith(q)) {
    return { score: 80, matchedIndices: Array.from({ length: q.length }, (_, i) => i) };
  }

  // Word boundary match: check if all chars of query match start-of-word chars
  // (evaluated before substring to prefer the higher score of 60 vs 40-50)
  const wordBoundaryIndices = getWordBoundaryMatch(q, t);
  if (wordBoundaryIndices) {
    return { score: 60, matchedIndices: wordBoundaryIndices };
  }

  // Substring match
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    return {
      score: 40 + (subIdx === 0 ? 10 : 0),
      matchedIndices: Array.from({ length: q.length }, (_, i) => subIdx + i),
    };
  }

  // Fuzzy: all query chars appear in order
  const fuzzyIndices = getFuzzyIndices(q, t);
  if (fuzzyIndices) {
    // Bonus for consecutive matches and shorter gaps
    const gapPenalty = fuzzyIndices.reduce((sum, _idx, i) => {
      if (i === 0) return sum;
      return sum + (fuzzyIndices[i] - fuzzyIndices[i - 1] - 1);
    }, 0);
    const score = Math.max(1, 20 - Math.min(gapPenalty, 15));
    return { score, matchedIndices: fuzzyIndices };
  }

  return { score: 0, matchedIndices: [] };
}

/** Check if query chars match at word boundaries in target */
function getWordBoundaryMatch(q: string, t: string): number[] | null {
  // Find word boundary positions in target
  const boundaries: number[] = [0]; // First char is always a boundary
  for (let i = 1; i < t.length; i++) {
    const prev = t[i - 1];
    // Word boundary: after space, dash, underscore, or case change
    if (prev === ' ' || prev === '-' || prev === '_' || prev === '.' ||
        (prev >= 'a' && prev <= 'z' && t[i] >= 'A' && t[i] <= 'Z')) {
      boundaries.push(i);
    }
  }

  if (boundaries.length < q.length) return null;

  // Try to match each query char to a boundary char
  const indices: number[] = [];
  let bIdx = 0;
  for (let qi = 0; qi < q.length; qi++) {
    let found = false;
    while (bIdx < boundaries.length) {
      if (t[boundaries[bIdx]] === q[qi]) {
        indices.push(boundaries[bIdx]);
        bIdx++;
        found = true;
        break;
      }
      bIdx++;
    }
    if (!found) return null;
  }
  return indices;
}

/** Find indices of all query chars in order within target */
function getFuzzyIndices(q: string, t: string): number[] | null {
  const indices: number[] = [];
  let tIdx = 0;
  for (let qi = 0; qi < q.length; qi++) {
    let found = false;
    while (tIdx < t.length) {
      if (t[tIdx] === q[qi]) {
        indices.push(tIdx);
        tIdx++;
        found = true;
        break;
      }
      tIdx++;
    }
    if (!found) return null;
  }
  return indices;
}

/**
 * Multi-field fuzzy match: returns the best score across multiple fields.
 */
export function fuzzyMatchMulti(query: string, ...targets: string[]): FuzzyResult {
  let best: FuzzyResult = { score: 0, matchedIndices: [] };
  for (const target of targets) {
    const result = fuzzyMatch(query, target);
    if (result.score > best.score) {
      best = result;
    }
  }
  return best;
}
