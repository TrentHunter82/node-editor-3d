/**
 * Graph variable system tests (get-var / set-var nodes)
 * Tests variable read/write, persistence across execution, topological ordering,
 * integration with executeGraph graphVariables parameter, and store-level operations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  executeGraph,
  setGraphVariablesContext,
  getGraphVariablesContext,
} from '../utils/execution';
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

function makeConn(
  id: string,
  src: string,
  srcPort: number,
  tgt: string,
  tgtPort: number
): Connection {
  return { id, sourceNodeId: src, sourcePortIndex: srcPort, targetNodeId: tgt, targetPortIndex: tgtPort };
}

function exec(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection> = {},
  graphVariables?: Record<string, unknown>
) {
  return executeGraph(nodes, connections, undefined, undefined, undefined, undefined, graphVariables);
}

function out(r: ReturnType<typeof exec>, nodeId: string, port = 0): unknown {
  return r.results.get(nodeId)?.outputs[port];
}

// ============================================================
// Context API
// ============================================================
describe('graph variables context API', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  it('setGraphVariablesContext / getGraphVariablesContext round-trip', () => {
    const vars = { x: 42, name: 'test' };
    setGraphVariablesContext(vars);
    expect(getGraphVariablesContext()).toBe(vars);
  });

  it('get returns same reference that was set', () => {
    const vars = { a: 1 };
    setGraphVariablesContext(vars);
    const retrieved = getGraphVariablesContext();
    retrieved.b = 2;
    expect(getGraphVariablesContext().b).toBe(2);
  });
});

// ============================================================
// get-var processor
// ============================================================
describe('get-var processor', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  it('returns 0 for unset variable', () => {
    const r = exec({ g: makeNode('g', 'get-var', { variableName: 'missing' }) });
    expect(out(r, 'g')).toBe(0);
  });

  it('reads pre-set variable', () => {
    setGraphVariablesContext({ myVal: 42 });
    const r = exec({ g: makeNode('g', 'get-var', { variableName: 'myVal' }) });
    expect(out(r, 'g')).toBe(42);
  });

  it('reads string variable', () => {
    setGraphVariablesContext({ greeting: 'hello' });
    const r = exec({ g: makeNode('g', 'get-var', { variableName: 'greeting' }) });
    expect(out(r, 'g')).toBe('hello');
  });

  it('reads array variable', () => {
    setGraphVariablesContext({ items: [1, 2, 3] });
    const r = exec({ g: makeNode('g', 'get-var', { variableName: 'items' }) });
    expect(out(r, 'g')).toEqual([1, 2, 3]);
  });

  it('throws error when variableName is not configured', () => {
    const r = exec({ g: makeNode('g', 'get-var', {}) });
    expect(r.errors.get('g')).toMatch(/variableName is not configured/);
  });
});

// ============================================================
// set-var processor
// ============================================================
describe('set-var processor', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  it('stores value in graph variables', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 99 }),
      setter: makeNode('setter', 'set-var', { variableName: 'counter' }),
    };
    const conns: Record<string, Connection> = {
      c: makeConn('c', 's', 0, 'setter', 0),
    };
    exec(nodes, conns);
    expect(getGraphVariablesContext().counter).toBe(99);
  });

  it('passes value through to output', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'abc' }),
      setter: makeNode('setter', 'set-var', { variableName: 'x' }),
    };
    const conns: Record<string, Connection> = {
      c: makeConn('c', 's', 0, 'setter', 0),
    };
    expect(out(exec(nodes, conns), 'setter')).toBe('abc');
  });

  it('defaults to null when input is not connected', () => {
    const r = exec({ setter: makeNode('setter', 'set-var', { variableName: 'y' }) });
    expect(out(r, 'setter')).toBeNull();
    expect(getGraphVariablesContext().y).toBeNull();
  });

  it('overwrites previous variable value', () => {
    setGraphVariablesContext({ x: 'old' });
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'new' }),
      setter: makeNode('setter', 'set-var', { variableName: 'x' }),
    };
    const conns: Record<string, Connection> = {
      c: makeConn('c', 's', 0, 'setter', 0),
    };
    exec(nodes, conns);
    expect(getGraphVariablesContext().x).toBe('new');
  });
});

// ============================================================
// set-var → get-var communication
// ============================================================
describe('set-var → get-var communication', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  it('set-var writes value visible to subsequent get-var calls', () => {
    // get-var has no input ports, so we can't force topological ordering.
    // Instead, verify that set-var correctly writes to the context during execution.
    setGraphVariablesContext({ shared: 0 });
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 42 }),
      setter: makeNode('setter', 'set-var', { variableName: 'shared' }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 's', 0, 'setter', 0),
    };
    exec(nodes, conns);
    // After execution, the context should have the new value
    expect(getGraphVariablesContext().shared).toBe(42);

    // A subsequent execution with get-var should see the value
    const r2 = exec({ getter: makeNode('getter', 'get-var', { variableName: 'shared' }) });
    expect(out(r2, 'getter')).toBe(42);
  });

  it('multiple set-var nodes with different variable names', () => {
    const nodes: Record<string, EditorNode> = {
      s1: makeNode('s1', 'source', { value: 10 }),
      s2: makeNode('s2', 'source', { value: 20 }),
      set1: makeNode('set1', 'set-var', { variableName: 'a' }),
      set2: makeNode('set2', 'set-var', { variableName: 'b' }),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 's1', 0, 'set1', 0),
      c2: makeConn('c2', 's2', 0, 'set2', 0),
    };
    exec(nodes, conns);
    const vars = getGraphVariablesContext();
    expect(vars.a).toBe(10);
    expect(vars.b).toBe(20);
  });

  it('set-var output can feed downstream nodes', () => {
    // set-var passes value through, so downstream nodes receive it
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 5 }),
      setter: makeNode('setter', 'set-var', { variableName: 'x' }),
      arr: makeNode('arr', 'create-array'),
    };
    const conns: Record<string, Connection> = {
      c1: makeConn('c1', 's', 0, 'setter', 0),
      c2: makeConn('c2', 'setter', 0, 'arr', 0), // setter passthrough (5) → create-array item0
    };
    const r = exec(nodes, conns);
    expect(out(r, 'setter')).toBe(5);
    expect(out(r, 'arr')).toEqual([5]);
  });
});

// ============================================================
// executeGraph graphVariables parameter
// ============================================================
describe('executeGraph graphVariables parameter', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  it('initializes context from graphVariables parameter', () => {
    const r = exec(
      { g: makeNode('g', 'get-var', { variableName: 'preset' }) },
      {},
      { preset: 'from-param' }
    );
    expect(out(r, 'g')).toBe('from-param');
  });

  it('set-var modifies context initialized from parameter', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 100 }),
      setter: makeNode('setter', 'set-var', { variableName: 'counter' }),
    };
    const conns: Record<string, Connection> = {
      c: makeConn('c', 's', 0, 'setter', 0),
    };
    exec(nodes, conns, { counter: 0 });
    expect(getGraphVariablesContext().counter).toBe(100);
  });

  it('preserves other variables when one is updated', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'new' }),
      setter: makeNode('setter', 'set-var', { variableName: 'a' }),
    };
    const conns: Record<string, Connection> = {
      c: makeConn('c', 's', 0, 'setter', 0),
    };
    exec(nodes, conns, { a: 'old', b: 'keep' });
    const vars = getGraphVariablesContext();
    expect(vars.a).toBe('new');
    expect(vars.b).toBe('keep');
  });
});

// ============================================================
// Non-deterministic cache bypass
// ============================================================
describe('variable nodes bypass execution cache', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  it('get-var re-executes even with cache hit', () => {
    const nodes: Record<string, EditorNode> = {
      getter: makeNode('getter', 'get-var', { variableName: 'counter' }),
    };

    // First execution
    setGraphVariablesContext({ counter: 1 });
    const cache = new Map();
    const r1 = executeGraph(nodes, {}, cache);
    expect(out(r1, 'getter')).toBe(1);

    // Change variable, run with same cache
    setGraphVariablesContext({ counter: 2 });
    const r2 = executeGraph(nodes, {}, cache);
    expect(out(r2, 'getter')).toBe(2);
  });

  it('set-var re-executes even with cache hit', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 10 }),
      setter: makeNode('setter', 'set-var', { variableName: 'x' }),
    };
    const conns: Record<string, Connection> = {
      c: makeConn('c', 's', 0, 'setter', 0),
    };

    setGraphVariablesContext({});
    const cache = new Map();
    executeGraph(nodes, conns, cache);
    expect(getGraphVariablesContext().x).toBe(10);

    // Reset and re-execute with cache — set-var should still write
    setGraphVariablesContext({});
    executeGraph(nodes, conns, cache);
    expect(getGraphVariablesContext().x).toBe(10);
  });
});

// ============================================================
// Edge cases
// ============================================================
describe('graph variable edge cases', () => {
  beforeEach(() => {
    setGraphVariablesContext({});
  });

  it('variable name with special characters', () => {
    const name = 'my.var-name_123';
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 'special' }),
      setter: makeNode('setter', 'set-var', { variableName: name }),
      getter: makeNode('getter', 'get-var', { variableName: name }),
    };
    const conns: Record<string, Connection> = {
      c: makeConn('c', 's', 0, 'setter', 0),
    };
    exec(nodes, conns);
    expect(getGraphVariablesContext()[name]).toBe('special');
  });

  it('stores complex objects as variables', () => {
    const obj = { nested: { value: [1, 2, 3] } };
    setGraphVariablesContext({ data: obj });
    const r = exec({ g: makeNode('g', 'get-var', { variableName: 'data' }) });
    expect(out(r, 'g')).toEqual({ nested: { value: [1, 2, 3] } });
  });

  it('handles null variable value', () => {
    setGraphVariablesContext({ nullable: null });
    const r = exec({ g: makeNode('g', 'get-var', { variableName: 'nullable' }) });
    // Variable was explicitly set to null — get-var preserves the stored value
    expect(out(r, 'g')).toBe(null);
  });

  it('handles false variable value', () => {
    setGraphVariablesContext({ flag: false });
    const r = exec({ g: makeNode('g', 'get-var', { variableName: 'flag' }) });
    // false ?? 0 = false because false is not nullish
    expect(out(r, 'g')).toBe(false);
  });

  it('execution result has no errors for variable operations', () => {
    const nodes: Record<string, EditorNode> = {
      s: makeNode('s', 'source', { value: 1 }),
      setter: makeNode('setter', 'set-var', { variableName: 'v' }),
      getter: makeNode('getter', 'get-var', { variableName: 'v' }),
    };
    const conns: Record<string, Connection> = {
      c: makeConn('c', 's', 0, 'setter', 0),
    };
    const r = exec(nodes, conns);
    expect(r.errors.size).toBe(0);
  });
});
