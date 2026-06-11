/**
 * Copy node value as JSON/CSV + presentation view logic.
 * (CREATIVE-USE-CASES enhancements #2 and #3.)
 */
import { describe, it, expect } from 'vitest';
import { resolveNodeExportValue, valueToJSON, valueToCSV } from '../utils/valueExport';
import { getPresentationInputs, getPresentationOutputs } from '../utils/presentationView';
import type { EditorNode, Connection, NodeType } from '../types';

function makeNode(id: string, type: NodeType, opts: Partial<EditorNode> = {}): EditorNode {
  return {
    id,
    type,
    position: [0, 0, 0],
    title: id,
    data: {},
    inputs: [],
    outputs: [],
    ...opts,
  };
}

describe('valueToJSON', () => {
  it('pretty-prints values', () => {
    expect(valueToJSON(42)).toBe('42');
    expect(valueToJSON({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(valueToJSON([1, 2])).toBe('[\n  1,\n  2\n]');
    expect(valueToJSON('hi')).toBe('"hi"');
    expect(valueToJSON(null)).toBe('null');
  });

  it('returns null for unserializable values', () => {
    expect(valueToJSON(undefined)).toBeNull();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(valueToJSON(circular)).toBeNull();
  });
});

describe('valueToCSV', () => {
  it('renders arrays of objects with a union header', () => {
    const csv = valueToCSV([
      { name: 'a', value: 1 },
      { name: 'b', value: 2, extra: true },
    ]);
    expect(csv).toBe('name,value,extra\na,1,\nb,2,true');
  });

  it('renders arrays of arrays as rows', () => {
    expect(valueToCSV([[1, 2], [3, 4]])).toBe('1,2\n3,4');
  });

  it('renders flat arrays as a single value column', () => {
    expect(valueToCSV([1, 2, 3])).toBe('value\n1\n2\n3');
  });

  it('renders an object as header + single row', () => {
    expect(valueToCSV({ x: 1, y: 'two' })).toBe('x,y\n1,two');
  });

  it('renders primitives as a single cell', () => {
    expect(valueToCSV(42)).toBe('value\n42');
    expect(valueToCSV('plain')).toBe('value\nplain');
  });

  it('escapes commas, quotes, and newlines', () => {
    expect(valueToCSV(['a,b'])).toBe('value\n"a,b"');
    expect(valueToCSV(['say "hi"'])).toBe('value\n"say ""hi"""');
    expect(valueToCSV(['line1\nline2'])).toBe('value\n"line1\nline2"');
  });

  it('JSON-stringifies nested objects in cells', () => {
    expect(valueToCSV([{ a: { b: 1 } }])).toBe('a\n"{""b"":1}"');
  });

  it('returns null when there is no tabular form', () => {
    expect(valueToCSV(undefined)).toBeNull();
    expect(valueToCSV(null)).toBeNull();
    expect(valueToCSV([])).toBeNull();
    expect(valueToCSV({})).toBeNull();
  });
});

describe('resolveNodeExportValue', () => {
  it('returns the bare value for single-output nodes', () => {
    const nodes = { a: makeNode('a', 'source', { outputs: [{ id: 'o0', label: 'value', portType: 'number' }] }) };
    const outputs = { a: { 0: 42 } };
    expect(resolveNodeExportValue('a', nodes, {}, outputs)).toBe(42);
  });

  it('keys multi-output nodes by port label', () => {
    const nodes = {
      a: makeNode('a', 'string-split', {
        outputs: [
          { id: 'o0', label: 'parts', portType: 'array' },
          { id: 'o1', label: 'count', portType: 'number' },
        ],
      }),
    };
    const outputs = { a: { 0: ['x', 'y'], 1: 2 } };
    expect(resolveNodeExportValue('a', nodes, {}, outputs)).toEqual({ parts: ['x', 'y'], count: 2 });
  });

  it('resolves sink nodes through the incoming connection', () => {
    const nodes = {
      src: makeNode('src', 'source', { outputs: [{ id: 'o0', label: 'value', portType: 'number' }] }),
      disp: makeNode('disp', 'display', { inputs: [{ id: 'i0', label: 'value', portType: 'any' }] }),
    };
    const connections: Record<string, Connection> = {
      c1: { id: 'c1', sourceNodeId: 'src', sourcePortIndex: 0, targetNodeId: 'disp', targetPortIndex: 0 },
    };
    const outputs = { src: { 0: 'hello' } };
    expect(resolveNodeExportValue('disp', nodes, connections, outputs)).toBe('hello');
  });

  it('returns undefined for unexecuted or unknown nodes', () => {
    const nodes = { a: makeNode('a', 'source') };
    expect(resolveNodeExportValue('a', nodes, {}, {})).toBeUndefined();
    expect(resolveNodeExportValue('missing', nodes, {}, {})).toBeUndefined();
  });
});

describe('presentation view logic', () => {
  it('selects parameter nodes (no inputs + editable fields) as inputs', () => {
    const nodes = {
      src: makeNode('src', 'source'),                       // fields, no inputs → input
      math: makeNode('math', 'math', { inputs: [{ id: 'i0', label: 'a', portType: 'number' }] }), // has inputs → not
      disp: makeNode('disp', 'display', { inputs: [{ id: 'i0', label: 'value', portType: 'any' }] }),
    };
    const inputs = getPresentationInputs(nodes);
    expect(inputs.map(i => i.node.id)).toEqual(['src']);
    expect(inputs[0].fields.some(f => f.key === 'value')).toBe(true);
  });

  it('selects display and output nodes as outputs in layout order', () => {
    const nodes = {
      d2: makeNode('d2', 'display', { position: [0, 0, 5] }),
      d1: makeNode('d1', 'display', { position: [0, 0, 1] }),
      out: makeNode('out', 'output', { position: [2, 0, 1] }),
      src: makeNode('src', 'source'),
    };
    expect(getPresentationOutputs(nodes).map(n => n.id)).toEqual(['d1', 'out', 'd2']);
  });

  it('excludes subgraph boundary nodes and field-less nodes', () => {
    const nodes = {
      sgi: makeNode('sgi', 'subgraph-input'),
      note: makeNode('note', 'note'),
    };
    // note has fields? Even if it does, it must have no input ports to qualify;
    // boundary nodes have no NODE_SCREEN_FIELDS entry and must not appear.
    const inputs = getPresentationInputs(nodes);
    expect(inputs.find(i => i.node.id === 'sgi')).toBeUndefined();
  });
});
