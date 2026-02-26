/**
 * String enhancement node processor tests.
 * Tests all 4 processors: string-concat, string-replace, string-includes, string-template.
 */
import { describe, it, expect } from 'vitest';
import { executeGraph } from '../utils/execution';
import type { EditorNode, Connection } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

// --- Helpers ---

function makeNode(
  id: string,
  type: EditorNode['type'],
  data: Record<string, unknown> = {},
  overrides: Partial<EditorNode> = {}
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position: [0, 0, 0],
    title: type,
    data,
    inputs: config.inputs.map((c, i) => ({ id: `in-${i}`, label: c.label, portType: c.portType })),
    outputs: config.outputs.map((c, i) => ({ id: `out-${i}`, label: c.label, portType: c.portType })),
    ...overrides,
  };
}

function makeConn(id: string, src: string, srcPort: number, tgt: string, tgtPort: number): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

function exec(nodes: Record<string, EditorNode>, connections: Record<string, Connection> = {}) {
  return executeGraph(nodes, connections);
}

function out(r: ReturnType<typeof exec>, nodeId: string, port = 0): unknown {
  return r.results.get(nodeId)?.outputs[port];
}

// ============================================================
// string-concat
// ============================================================
describe('string-concat processor', () => {
  it('concatenates two strings', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 'hello' }),
      b: makeNode('b', 'source', { value: ' world' }),
      cat: makeNode('cat', 'string-concat'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      c1: makeConn('c1', 'b', 0, 'cat', 1),
    };
    expect(out(exec(nodes, conns), 'cat')).toBe('hello world');
  });

  it('handles number + string concatenation', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 42 }),
      b: makeNode('b', 'source', { value: ' items' }),
      cat: makeNode('cat', 'string-concat'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      c1: makeConn('c1', 'b', 0, 'cat', 1),
    };
    expect(out(exec(nodes, conns), 'cat')).toBe('42 items');
  });

  it('handles empty strings', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: '' }),
      b: makeNode('b', 'source', { value: '' }),
      cat: makeNode('cat', 'string-concat'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      c1: makeConn('c1', 'b', 0, 'cat', 1),
    };
    expect(out(exec(nodes, conns), 'cat')).toBe('');
  });

  it('handles disconnected inputs (null → empty string)', () => {
    const nodes: Record<string, EditorNode> = {
      cat: makeNode('cat', 'string-concat'),
    };
    // No connections — both inputs undefined → String(undefined ?? '') = ''
    expect(out(exec(nodes), 'cat')).toBe('');
  });

  it('coerces non-string inputs to strings', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: true }),
      b: makeNode('b', 'source', { value: false }),
      cat: makeNode('cat', 'string-concat'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      c1: makeConn('c1', 'b', 0, 'cat', 1),
    };
    expect(out(exec(nodes, conns), 'cat')).toBe('truefalse');
  });
});

// ============================================================
// string-replace
// ============================================================
describe('string-replace processor', () => {
  it('replaces all occurrences of literal string (default mode)', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello world hello' }),
      search: makeNode('search', 'source', { value: 'hello' }),
      rep: makeNode('rep', 'source', { value: 'hi' }),
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Literal mode splits and joins, so replaces ALL occurrences
    expect(out(exec(nodes, conns), 'repl')).toBe('hi world hi');
  });

  it('replaces with regex when useRegex enabled', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'abc123def456' }),
      search: makeNode('search', 'source', { value: '\\d+' }),
      rep: makeNode('rep', 'source', { value: '#' }),
      repl: makeNode('repl', 'string-replace', { useRegex: true }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Regex with 'g' flag replaces all digit sequences
    expect(out(exec(nodes, conns), 'repl')).toBe('abc#def#');
  });

  it('handles no-match gracefully (returns original)', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello world' }),
      search: makeNode('search', 'source', { value: 'xyz' }),
      rep: makeNode('rep', 'source', { value: 'replaced' }),
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    expect(out(exec(nodes, conns), 'repl')).toBe('hello world');
  });

  it('handles empty search string (returns original)', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'test' }),
      search: makeNode('search', 'source', { value: '' }),
      rep: makeNode('rep', 'source', { value: 'x' }),
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    expect(out(exec(nodes, conns), 'repl')).toBe('test');
  });

  it('handles empty replacement string', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello world' }),
      search: makeNode('search', 'source', { value: ' world' }),
      rep: makeNode('rep', 'source', { value: '' }),
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    expect(out(exec(nodes, conns), 'repl')).toBe('hello');
  });

  it('handles non-string input gracefully', () => {
    const nodes: Record<string, EditorNode> = {
      num: makeNode('num', 'source', { value: 42 }),
      search: makeNode('search', 'source', { value: '4' }),
      rep: makeNode('rep', 'source', { value: 'X' }),
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'num', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Non-string input defaults to ''
    expect(out(exec(nodes, conns), 'repl')).toBe('');
  });

  it('handles regex special characters in literal mode', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'price is $10.00' }),
      search: makeNode('search', 'source', { value: '$10.00' }),
      rep: makeNode('rep', 'source', { value: '$20.00' }),
      repl: makeNode('repl', 'string-replace'), // literal mode (default)
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Literal mode uses split/join, so special regex chars are treated literally
    expect(out(exec(nodes, conns), 'repl')).toBe('price is $20.00');
  });

  it('handles invalid regex pattern gracefully', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'test string' }),
      search: makeNode('search', 'source', { value: '[invalid' }), // broken regex
      rep: makeNode('rep', 'source', { value: 'x' }),
      repl: makeNode('repl', 'string-replace', { useRegex: true }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Invalid regex now throws — surfaced as node error in result
    const r = exec(nodes, conns);
    expect(r.errors.has('repl')).toBe(true);
  });
});

// ============================================================
// string-includes
// ============================================================
describe('string-includes processor', () => {
  it('returns true when string contains search', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello world' }),
      search: makeNode('search', 'source', { value: 'world' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    expect(out(exec(nodes, conns), 'inc')).toBe(true);
  });

  it('returns false when string does not contain search', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello world' }),
      search: makeNode('search', 'source', { value: 'xyz' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    expect(out(exec(nodes, conns), 'inc')).toBe(false);
  });

  it('handles empty search string (always true)', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'anything' }),
      search: makeNode('search', 'source', { value: '' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    expect(out(exec(nodes, conns), 'inc')).toBe(true);
  });

  it('is case-sensitive', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'Hello World' }),
      search: makeNode('search', 'source', { value: 'hello' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    expect(out(exec(nodes, conns), 'inc')).toBe(false);
  });

  it('handles non-string inputs gracefully', () => {
    const nodes: Record<string, EditorNode> = {
      num: makeNode('num', 'source', { value: 12345 }),
      search: makeNode('search', 'source', { value: '23' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'num', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    // Non-string input defaults to '' → ''.includes('23') = false
    expect(out(exec(nodes, conns), 'inc')).toBe(false);
  });
});

// ============================================================
// string-template
// ============================================================
describe('string-template processor', () => {
  it('substitutes ${in0} placeholder with first input', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: 'Hello ${in0}!' }),
      v0: makeNode('v0', 'source', { value: 'World' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('Hello World!');
  });

  it('substitutes multiple placeholders ${in0}, ${in1}', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: '${in0} is ${in1} years old' }),
      v0: makeNode('v0', 'source', { value: 'Alice' }),
      v1: makeNode('v1', 'source', { value: 30 }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
      c2: makeConn('c2', 'v1', 0, 'tmpl', 2),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('Alice is 30 years old');
  });

  it('handles missing inputs (undefined → empty string)', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: 'a=${in0}, b=${in1}' }),
      v0: makeNode('v0', 'source', { value: 'X' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
      // in1 not connected
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('a=X, b=');
  });

  it('handles special characters in template', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: 'Price: $${in0}.00 (tax: ${in1}%)' }),
      v0: makeNode('v0', 'source', { value: 10 }),
      v1: makeNode('v1', 'source', { value: 8.5 }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
      c2: makeConn('c2', 'v1', 0, 'tmpl', 2),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('Price: $10.00 (tax: 8.5%)');
  });

  it('handles numeric inputs (coerced to string)', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: '${in0}+${in1}=${in2}' }),
      v0: makeNode('v0', 'source', { value: 2 }),
      v1: makeNode('v1', 'source', { value: 3 }),
      v2: makeNode('v2', 'source', { value: 5 }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
      c2: makeConn('c2', 'v1', 0, 'tmpl', 2),
      c3: makeConn('c3', 'v2', 0, 'tmpl', 3),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('2+3=5');
  });

  it('supports all 4 inputs', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: '${in0}-${in1}-${in2}-${in3}' }),
      v0: makeNode('v0', 'source', { value: 'a' }),
      v1: makeNode('v1', 'source', { value: 'b' }),
      v2: makeNode('v2', 'source', { value: 'c' }),
      v3: makeNode('v3', 'source', { value: 'd' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
      c2: makeConn('c2', 'v1', 0, 'tmpl', 2),
      c3: makeConn('c3', 'v2', 0, 'tmpl', 3),
      c4: makeConn('c4', 'v3', 0, 'tmpl', 4),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('a-b-c-d');
  });

  it('replaces repeated placeholders', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: '${in0} and ${in0} again' }),
      v0: makeNode('v0', 'source', { value: 'X' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
    };
    // Uses 'g' flag in regex, so all occurrences of ${in0} are replaced
    expect(out(exec(nodes, conns), 'tmpl')).toBe('X and X again');
  });
});

// ============================================================
// Integration tests
// ============================================================
describe('string node integration', () => {
  it('string-concat -> string-includes pipeline', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 'hello ' }),
      b: makeNode('b', 'source', { value: 'world' }),
      cat: makeNode('cat', 'string-concat'),
      search: makeNode('search', 'source', { value: 'lo wo' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      c1: makeConn('c1', 'b', 0, 'cat', 1),
      c2: makeConn('c2', 'cat', 0, 'inc', 0),
      c3: makeConn('c3', 'search', 0, 'inc', 1),
    };
    expect(out(exec(nodes, conns), 'inc')).toBe(true);
  });

  it('string-template -> string-replace pipeline', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: 'Hello ${in0}!' }),
      v0: makeNode('v0', 'source', { value: 'World' }),
      tmpl: makeNode('tmpl', 'string-template'),
      search: makeNode('search', 'source', { value: '!' }),
      rep: makeNode('rep', 'source', { value: '?' }),
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
      c2: makeConn('c2', 'tmpl', 0, 'repl', 0),
      c3: makeConn('c3', 'search', 0, 'repl', 1),
      c4: makeConn('c4', 'rep', 0, 'repl', 2),
    };
    expect(out(exec(nodes, conns), 'repl')).toBe('Hello World?');
  });

  it('string-concat with if-gate (conditional concatenation)', () => {
    const nodes: Record<string, EditorNode> = {
      cond: makeNode('cond', 'source', { value: true }),
      yes: makeNode('yes', 'source', { value: 'prefix-' }),
      no: makeNode('no', 'source', { value: '' }),
      gate: makeNode('gate', 'if-gate'),
      suffix: makeNode('suffix', 'source', { value: 'value' }),
      cat: makeNode('cat', 'string-concat'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'cond', 0, 'gate', 0),
      c1: makeConn('c1', 'yes', 0, 'gate', 1),
      c2: makeConn('c2', 'no', 0, 'gate', 2),
      c3: makeConn('c3', 'gate', 0, 'cat', 0),
      c4: makeConn('c4', 'suffix', 0, 'cat', 1),
    };
    expect(out(exec(nodes, conns), 'cat')).toBe('prefix-value');
  });
});

// ============================================================
// string-concat edge cases
// ============================================================
describe('string-concat edge cases', () => {
  it('asymmetric empty: one empty + one non-empty', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: '' }),
      b: makeNode('b', 'source', { value: 'world' }),
      cat: makeNode('cat', 'string-concat'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      c1: makeConn('c1', 'b', 0, 'cat', 1),
    };
    expect(out(exec(nodes, conns), 'cat')).toBe('world');
  });

  it('preserves newline and tab characters', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 'line1\n' }),
      b: makeNode('b', 'source', { value: '\tindented' }),
      cat: makeNode('cat', 'string-concat'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      c1: makeConn('c1', 'b', 0, 'cat', 1),
    };
    expect(out(exec(nodes, conns), 'cat')).toBe('line1\n\tindented');
  });

  it('handles null input → coerced to empty string (not "null")', () => {
    // If a source outputs null explicitly, String(null ?? '') = String('') = ''
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 'prefix' }),
      cat: makeNode('cat', 'string-concat'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      // port 1 disconnected → undefined → String(undefined ?? '') = ''
    };
    expect(out(exec(nodes, conns), 'cat')).toBe('prefix');
  });
});

// ============================================================
// string-replace edge cases
// ============================================================
describe('string-replace edge cases', () => {
  it('regex with capture group and $1 backreference', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'John Smith' }),
      search: makeNode('search', 'source', { value: '(\\w+) (\\w+)' }),
      rep: makeNode('rep', 'source', { value: '$2, $1' }),
      repl: makeNode('repl', 'string-replace', { useRegex: true }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    expect(out(exec(nodes, conns), 'repl')).toBe('Smith, John');
  });

  it('regex mode always uses global flag (replaces all matches)', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'aaa bbb aaa' }),
      search: makeNode('search', 'source', { value: 'aaa' }),
      rep: makeNode('rep', 'source', { value: 'x' }),
      repl: makeNode('repl', 'string-replace', { useRegex: true }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Global flag means ALL occurrences replaced
    expect(out(exec(nodes, conns), 'repl')).toBe('x bbb x');
  });

  it('regex is case-sensitive by default (no i flag)', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'Hello HELLO hello' }),
      search: makeNode('search', 'source', { value: 'hello' }),
      rep: makeNode('rep', 'source', { value: 'X' }),
      repl: makeNode('repl', 'string-replace', { useRegex: true }),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Only lowercase 'hello' matches (no 'i' flag)
    expect(out(exec(nodes, conns), 'repl')).toBe('Hello HELLO X');
  });

  it('number as search input defaults to empty string → returns original', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'test string' }),
      search: makeNode('search', 'source', { value: 42 }),  // non-string
      rep: makeNode('rep', 'source', { value: 'X' }),
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Non-string search defaults to '' → empty search is no-op
    expect(out(exec(nodes, conns), 'repl')).toBe('test string');
  });

  it('number as replacement input defaults to empty string → deletes matches', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'hello world' }),
      search: makeNode('search', 'source', { value: ' world' }),
      rep: makeNode('rep', 'source', { value: 123 }),  // non-string
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    // Non-string replace defaults to '' → effectively deletes matched substring
    expect(out(exec(nodes, conns), 'repl')).toBe('hello');
  });

  it('replaces literal newline character in non-regex mode', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'line1\nline2\nline3' }),
      search: makeNode('search', 'source', { value: '\n' }),
      rep: makeNode('rep', 'source', { value: ' | ' }),
      repl: makeNode('repl', 'string-replace'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
    };
    expect(out(exec(nodes, conns), 'repl')).toBe('line1 | line2 | line3');
  });
});

// ============================================================
// string-includes edge cases
// ============================================================
describe('string-includes edge cases', () => {
  it('empty haystack with non-empty needle returns false', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: '' }),
      search: makeNode('search', 'source', { value: 'abc' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    expect(out(exec(nodes, conns), 'inc')).toBe(false);
  });

  it('empty haystack with empty needle returns true', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: '' }),
      search: makeNode('search', 'source', { value: '' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    // ''.includes('') === true in JavaScript
    expect(out(exec(nodes, conns), 'inc')).toBe(true);
  });

  it('number as needle defaults to empty string → returns true', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'anything' }),
      search: makeNode('search', 'source', { value: 42 }), // non-string
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    // Non-string defaults to '' → 'anything'.includes('') === true
    expect(out(exec(nodes, conns), 'inc')).toBe(true);
  });

  it('finds newline character inside multiline string', () => {
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'line1\nline2' }),
      search: makeNode('search', 'source', { value: '\n' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'inc', 0),
      c1: makeConn('c1', 'search', 0, 'inc', 1),
    };
    expect(out(exec(nodes, conns), 'inc')).toBe(true);
  });
});

// ============================================================
// string-template edge cases
// ============================================================
describe('string-template edge cases', () => {
  it('empty template string with inputs connected outputs empty string', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: '' }),
      v0: makeNode('v0', 'source', { value: 'ignored' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('');
  });

  it('template with no placeholders outputs template unchanged', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: 'static text' }),
      v0: makeNode('v0', 'source', { value: 'ignored' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('static text');
  });

  it('out-of-range placeholder ${in4} is left literally in output', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: '${in0} and ${in4}' }),
      v0: makeNode('v0', 'source', { value: 'A' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
    };
    // Loop only covers in0-in3, so ${in4} is untouched
    expect(out(exec(nodes, conns), 'tmpl')).toBe('A and ${in4}');
  });

  it('null input value renders as empty string (not "null")', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: 'value=${in0}' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      // in0 (port 1) not connected → null/undefined → ''
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('value=');
  });

  it('zero (0) input renders as "0" not empty string', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: 'count=${in0}' }),
      v0: makeNode('v0', 'source', { value: 0 }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
    };
    // val != null check passes for 0; String(0) = '0'
    expect(out(exec(nodes, conns), 'tmpl')).toBe('count=0');
  });

  it('boolean true/false inputs coerce to "true"/"false"', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: '${in0} and ${in1}' }),
      v0: makeNode('v0', 'source', { value: true }),
      v1: makeNode('v1', 'source', { value: false }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
      c1: makeConn('c1', 'v0', 0, 'tmpl', 1),
      c2: makeConn('c2', 'v1', 0, 'tmpl', 2),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('true and false');
  });

  it('all four inputs disconnected → all placeholders become empty strings', () => {
    const nodes: Record<string, EditorNode> = {
      tpl: makeNode('tpl', 'source', { value: '[${in0}][${in1}][${in2}][${in3}]' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'tpl', 0, 'tmpl', 0),
    };
    expect(out(exec(nodes, conns), 'tmpl')).toBe('[][][][]');
  });
});

// ============================================================
// string node integration edge cases
// ============================================================
describe('string node integration edge cases', () => {
  it('string-replace (regex) -> string-template pipeline', () => {
    // Replace digits with X, then use result as template input
    const nodes: Record<string, EditorNode> = {
      str: makeNode('str', 'source', { value: 'item123' }),
      search: makeNode('search', 'source', { value: '\\d+' }),
      rep: makeNode('rep', 'source', { value: 'N' }),
      repl: makeNode('repl', 'string-replace', { useRegex: true }),
      tpl: makeNode('tpl', 'source', { value: 'Result: ${in0}' }),
      tmpl: makeNode('tmpl', 'string-template'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'str', 0, 'repl', 0),
      c1: makeConn('c1', 'search', 0, 'repl', 1),
      c2: makeConn('c2', 'rep', 0, 'repl', 2),
      c3: makeConn('c3', 'tpl', 0, 'tmpl', 0),
      c4: makeConn('c4', 'repl', 0, 'tmpl', 1),
    };
    // repl output = 'itemN', template = 'Result: itemN'
    expect(out(exec(nodes, conns), 'tmpl')).toBe('Result: itemN');
  });

  it('three-node chain: concat -> replace -> includes', () => {
    const nodes: Record<string, EditorNode> = {
      a: makeNode('a', 'source', { value: 'Hello ' }),
      b: makeNode('b', 'source', { value: 'World!' }),
      cat: makeNode('cat', 'string-concat'),
      search: makeNode('search', 'source', { value: '!' }),
      rep: makeNode('rep', 'source', { value: '?' }),
      repl: makeNode('repl', 'string-replace'),
      needle: makeNode('needle', 'source', { value: '?' }),
      inc: makeNode('inc', 'string-includes'),
    };
    const conns: Record<string, Connection> = {
      c0: makeConn('c0', 'a', 0, 'cat', 0),
      c1: makeConn('c1', 'b', 0, 'cat', 1),
      c2: makeConn('c2', 'cat', 0, 'repl', 0),
      c3: makeConn('c3', 'search', 0, 'repl', 1),
      c4: makeConn('c4', 'rep', 0, 'repl', 2),
      c5: makeConn('c5', 'repl', 0, 'inc', 0),
      c6: makeConn('c6', 'needle', 0, 'inc', 1),
    };
    // concat = 'Hello World!' → replace '!' with '?' = 'Hello World?' → includes '?' = true
    expect(out(exec(nodes, conns), 'inc')).toBe(true);
  });
});
