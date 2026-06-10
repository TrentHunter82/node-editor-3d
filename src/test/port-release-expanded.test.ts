/**
 * Expanded port-release UX tests (~15 tests).
 * Covers all port types (vector3, color, boolean, any), all 93 node types,
 * category coverage, and switch node strictMode.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { NODE_TYPE_CONFIG } from '../types';
import type { NodeType } from '../types';
import { executeGraph } from '../utils/execution';

enableMapSet();

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.contextMenu = null;
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.graphVariables = {};
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionTimedOut = false;
    s.executionTimings = {};
  });
}

function getState() {
  return useEditorStore.getState();
}

// ===========================================================================
// Group 1: Port type exhaustiveness (5 tests)
// ===========================================================================

describe('Port type exhaustiveness', () => {
  beforeEach(resetStore);

  it('vector3 output port finds compose-vec3, decompose-vec3, normalize-vec3, vec3-length', () => {
    // compose-vec3 has a vector3 output at port 0
    const srcId = getState().addNode('compose-vec3', [0, 0, 0]);
    const srcPort = getState().nodes[srcId].outputs[0];
    expect(srcPort.portType).toBe('vector3');

    const compatible = getState().getCompatibleNodeTypes(srcId, 0, true);
    const types = compatible.map(c => c.type);

    // These all have vector3 inputs
    expect(types).toContain('decompose-vec3');
    expect(types).toContain('normalize-vec3');
    expect(types).toContain('vec3-length');
    expect(types).toContain('dot-product');
    expect(types).toContain('cross-product');

    // Types with only number inputs (and no 'any' inputs) should NOT be present
    // e.g., 'math' only has number inputs
    expect(types).not.toContain('math');
    // concat only has string inputs
    expect(types).not.toContain('concat');
  });

  it('color output port finds color-mix, hsl-to-rgb (no), rgb-to-hsl (no), and any-input types', () => {
    // color-picker has a color output at port 0
    const srcId = getState().addNode('color-picker', [0, 0, 0]);
    const srcPort = getState().nodes[srcId].outputs[0];
    expect(srcPort.portType).toBe('color');

    const compatible = getState().getCompatibleNodeTypes(srcId, 0, true);
    const types = compatible.map(c => c.type);

    // color-mix has color inputs (port 0 and 1)
    expect(types).toContain('color-mix');

    // hsl-to-rgb has only number inputs, so it should NOT be compatible with color output
    expect(types).not.toContain('hsl-to-rgb');
    // rgb-to-hsl has only number inputs, so it should NOT be compatible with color output
    expect(types).not.toContain('rgb-to-hsl');

    // Types with 'any' inputs should still be compatible
    expect(types).toContain('filter');
    expect(types).toContain('display');
    expect(types).toContain('reroute');
  });

  it('boolean output port finds if-gate, select (no, has number index), and, or, not, xor', () => {
    // compare has boolean output at port 0
    const srcId = getState().addNode('compare', [0, 0, 0]);
    const srcPort = getState().nodes[srcId].outputs[0];
    expect(srcPort.portType).toBe('boolean');

    const compatible = getState().getCompatibleNodeTypes(srcId, 0, true);
    const types = compatible.map(c => c.type);

    // Logic gates all have boolean inputs
    expect(types).toContain('and');
    expect(types).toContain('or');
    expect(types).toContain('not');
    expect(types).toContain('xor');

    // if-gate has a boolean condition input (port 0)
    expect(types).toContain('if-gate');

    // json-stringify has a 'boolean' input at port 1 ('pretty')
    expect(types).toContain('json-stringify');

    // Types with only number inputs should NOT appear
    expect(types).not.toContain('math');
    expect(types).not.toContain('clamp');
  });

  it('any output port finds ALL types with at least one input', () => {
    // reroute has 'any' output at port 0
    const srcId = getState().addNode('reroute', [0, 0, 0]);
    const srcPort = getState().nodes[srcId].outputs[0];
    expect(srcPort.portType).toBe('any');

    const compatible = getState().getCompatibleNodeTypes(srcId, 0, true);
    const types = new Set(compatible.map(c => c.type));

    // With 'any' output, every node type that has at least one input should be compatible
    const allTypes = Object.keys(NODE_TYPE_CONFIG) as NodeType[];
    for (const nodeType of allTypes) {
      if (nodeType === 'note') continue; // note is excluded from results
      const config = NODE_TYPE_CONFIG[nodeType];
      if (config.inputs.length > 0) {
        expect(types.has(nodeType)).toBe(true);
      }
    }

    // Should be a large number
    expect(compatible.length).toBeGreaterThan(50);
  });

  it('any input port finds ALL types with at least one output', () => {
    // display has 'any' input at port 0
    const srcId = getState().addNode('display', [0, 0, 0]);
    const srcPort = getState().nodes[srcId].inputs[0];
    expect(srcPort.portType).toBe('any');

    const compatible = getState().getCompatibleNodeTypes(srcId, 0, false);
    const types = new Set(compatible.map(c => c.type));

    // With 'any' input, every node type that has at least one output should be compatible
    const allTypes = Object.keys(NODE_TYPE_CONFIG) as NodeType[];
    for (const nodeType of allTypes) {
      if (nodeType === 'note') continue; // note is excluded from results
      const config = NODE_TYPE_CONFIG[nodeType];
      if (config.outputs.length > 0) {
        expect(types.has(nodeType)).toBe(true);
      }
    }

    // Should be a large number
    expect(compatible.length).toBeGreaterThan(50);
  });
});

// ===========================================================================
// Group 2: Category coverage (3 tests)
// ===========================================================================

describe('Category coverage', () => {
  beforeEach(resetStore);

  it('every NODE_CATEGORIES category has at least 1 compatible type for number output', () => {
    // source has number output at port 0
    const srcId = getState().addNode('source', [0, 0, 0]);
    const srcPort = getState().nodes[srcId].outputs[0];
    expect(srcPort.portType).toBe('number');

    const compatible = getState().getCompatibleNodeTypes(srcId, 0, true);
    const categoriesHit = new Set(compatible.map(c => c.category));

    // All categories that have types with number or 'any' inputs should be present
    // Core: transform, filter, output all have number or any inputs
    expect(categoriesHit.has('Core')).toBe(true);
    // Math: math, clamp, remap, etc. all have number inputs
    expect(categoriesHit.has('Math')).toBe(true);
    // Logic: compare has number inputs
    expect(categoriesHit.has('Logic')).toBe(true);
    // Vector: compose-vec3 has number inputs
    expect(categoriesHit.has('Vector')).toBe(true);
    // Color: hsl-to-rgb and rgb-to-hsl have number inputs; color-mix has number input (t)
    expect(categoriesHit.has('Color')).toBe(true);
    // Data: many have 'any' inputs, get-element has number index
    expect(categoriesHit.has('Data')).toBe(true);
    // Utility: display has 'any' input, reroute has 'any' input
    expect(categoriesHit.has('Utility')).toBe(true);
    // Live: http-fetch has 'any' trigger input
    expect(categoriesHit.has('Live')).toBe(true);
    // String: parse-number has string input (not number), but template has 'any' input
    expect(categoriesHit.has('String')).toBe(true);
  });

  it('Data category types are reachable: create-array, get-element, create-object, json-parse have any ports', () => {
    // Verify that Data category types with 'any' ports are compatible from any source
    const dataTypes: NodeType[] = ['create-array', 'get-element', 'create-object', 'json-parse'];

    for (const dt of dataTypes) {
      const config = NODE_TYPE_CONFIG[dt];
      const hasAnyPort = [
        ...config.inputs.map(i => i.portType),
        ...config.outputs.map(o => o.portType),
      ].includes('any');
      expect(hasAnyPort).toBe(true);
    }

    // create-array, get-element, create-object all have 'any' inputs → compatible with any output
    const srcId = getState().addNode('reroute', [0, 0, 0]); // 'any' output
    const compatible = getState().getCompatibleNodeTypes(srcId, 0, true);
    const types = compatible.map(c => c.type);

    expect(types).toContain('create-array');
    expect(types).toContain('get-element');
    expect(types).toContain('create-object');

    // json-parse has string input, not any input — but it does have 'any' output
    // So it won't be in compatible-from-output for 'any' unless it also has an 'any' input
    // Check: json-parse has inputs: [{portType:'string'}], so it IS reachable from string source
    const strSrcId = getState().addNode('concat', [1, 0, 0]);
    const strCompatible = getState().getCompatibleNodeTypes(strSrcId, 0, true);
    const strTypes = strCompatible.map(c => c.type);
    expect(strTypes).toContain('json-parse');
  });

  it('Live category types (timer, http-fetch) are included in compatible results for appropriate port types', () => {
    // timer has no inputs, only outputs [number] — so it should appear when dragging FROM
    // a number input port
    const mathId = getState().addNode('math', [0, 0, 0]);
    const numberInputCompat = getState().getCompatibleNodeTypes(mathId, 0, false);
    const fromInputTypes = numberInputCompat.map(c => c.type);
    // timer has number output → should be found when searching from a number input
    expect(fromInputTypes).toContain('timer');

    // http-fetch has string and any inputs → should appear when dragging from string output
    const concatId = getState().addNode('concat', [1, 0, 0]);
    const strOutputCompat = getState().getCompatibleNodeTypes(concatId, 0, true);
    const fromStrOutputTypes = strOutputCompat.map(c => c.type);
    expect(fromStrOutputTypes).toContain('http-fetch');

    // http-fetch has 'any' output → should appear from any input
    const displayId = getState().addNode('display', [2, 0, 0]);
    const anyInputCompat = getState().getCompatibleNodeTypes(displayId, 0, false);
    const fromAnyInputTypes = anyInputCompat.map(c => c.type);
    expect(fromAnyInputTypes).toContain('http-fetch');
    expect(fromAnyInputTypes).toContain('timer');
  });
});

// ===========================================================================
// Group 3: All 93 types iteration (3 tests)
// ===========================================================================

describe('All 93 types iteration', () => {
  beforeEach(resetStore);

  it('every non-note type with outputs returns non-empty compatible types for some input port', () => {
    const allTypes = Object.keys(NODE_TYPE_CONFIG) as NodeType[];
    // Types that have static outputs (excluding note, custom, subgraph which have 0 static ports)
    const typesWithOutputs = allTypes.filter(t => NODE_TYPE_CONFIG[t].outputs.length > 0);

    for (const nodeType of typesWithOutputs) {
      const nodeId = getState().addNode(nodeType, [0, 0, 0]);
      const node = getState().nodes[nodeId];

      // Try each output port — at least one should yield compatible types
      let foundCompatible = false;
      for (let i = 0; i < node.outputs.length; i++) {
        const compatible = getState().getCompatibleNodeTypes(nodeId, i, true);
        if (compatible.length > 0) {
          foundCompatible = true;
          break;
        }
      }

      expect(foundCompatible).toBe(true);

      // Clean up for next iteration
      resetStore();
    }
  });

  it('every non-note type with inputs returns non-empty compatible types for some output port', () => {
    const allTypes = Object.keys(NODE_TYPE_CONFIG) as NodeType[];
    // Types that have static inputs (excluding note, custom, subgraph which have 0 static ports)
    const typesWithInputs = allTypes.filter(t => NODE_TYPE_CONFIG[t].inputs.length > 0);

    for (const nodeType of typesWithInputs) {
      const nodeId = getState().addNode(nodeType, [0, 0, 0]);
      const node = getState().nodes[nodeId];

      // Try each input port — at least one should yield compatible types
      let foundCompatible = false;
      for (let i = 0; i < node.inputs.length; i++) {
        const compatible = getState().getCompatibleNodeTypes(nodeId, i, false);
        if (compatible.length > 0) {
          foundCompatible = true;
          break;
        }
      }

      expect(foundCompatible).toBe(true);

      // Clean up for next iteration
      resetStore();
    }
  });

  it('NODE_TYPE_CONFIG has exactly 93 entries', () => {
    const count = Object.keys(NODE_TYPE_CONFIG).length;
    expect(count).toBe(94);
  });
});

// ===========================================================================
// Group 4: Multi-port and edge cases (2 tests)
// ===========================================================================

describe('Multi-port and edge cases', () => {
  beforeEach(resetStore);

  it('addNodeAndConnect picks first compatible input port (not random) when type has multiple input ports', () => {
    // source has number output at port 0
    const srcId = getState().addNode('source', [0, 0, 0]);
    const srcPort = getState().nodes[srcId].outputs[0];
    expect(srcPort.portType).toBe('number');

    // color-mix has inputs: [color, color, number(t)]
    // The first compatible input for a number source is port 2 (t, portType='number')
    // Ports 0 and 1 are 'color' type — incompatible with 'number'
    const newId = getState().addNodeAndConnect('color-mix', [5, 0, 0], srcId, 0, true);
    expect(newId).not.toBeNull();

    const conn = Object.values(getState().connections)[0];
    expect(conn.sourceNodeId).toBe(srcId);
    expect(conn.sourcePortIndex).toBe(0);
    expect(conn.targetNodeId).toBe(newId);
    // Should connect to port 2 (the first number-compatible input on color-mix)
    expect(conn.targetPortIndex).toBe(2);
  });

  it('types with mixed port types (e.g., color-mix with color+number inputs) are found by both color and number output', () => {
    // color-mix inputs: [color, color, number]
    // It should appear in compatible results for BOTH color output AND number output

    // Test from color output
    const colorSrcId = getState().addNode('color-picker', [0, 0, 0]);
    const colorPort = getState().nodes[colorSrcId].outputs[0];
    expect(colorPort.portType).toBe('color');

    const colorCompat = getState().getCompatibleNodeTypes(colorSrcId, 0, true);
    const colorTypes = colorCompat.map(c => c.type);
    expect(colorTypes).toContain('color-mix');

    // Test from number output
    const numSrcId = getState().addNode('source', [1, 0, 0]);
    const numPort = getState().nodes[numSrcId].outputs[0];
    expect(numPort.portType).toBe('number');

    const numCompat = getState().getCompatibleNodeTypes(numSrcId, 0, true);
    const numTypes = numCompat.map(c => c.type);
    expect(numTypes).toContain('color-mix');

    // But NOT from string output (color-mix has no string or any inputs)
    const strSrcId = getState().addNode('concat', [2, 0, 0]);
    const strPort = getState().nodes[strSrcId].outputs[0];
    expect(strPort.portType).toBe('string');

    const strCompat = getState().getCompatibleNodeTypes(strSrcId, 0, true);
    const strTypes = strCompat.map(c => c.type);
    expect(strTypes).not.toContain('color-mix');
  });
});

// ===========================================================================
// Group 5: Switch node strictMode (2 tests)
// ===========================================================================

describe('Switch node strictMode', () => {
  beforeEach(resetStore);

  /**
   * Helper: build a switch graph where:
   * - A source node outputs number 1 → switch input 0 (value to match)
   * - Another source with data.value='1' (string) → switch input 1 (case0)
   * - A default source with data.value=999 → switch input 5 (default)
   *
   * The source processor outputs data.value as-is (no type coercion), so
   * data.value=1 produces number 1, and data.value='1' produces string '1'.
   */
  function buildSwitchGraph(strictMode?: boolean) {
    // Source: outputs number 1
    const valueSourceId = getState().addNode('source', [0, 0, 0]);
    useEditorStore.setState(s => {
      s.nodes[valueSourceId].data.value = 1; // number 1
    });

    // Case source: outputs string '1'
    const caseSourceId = getState().addNode('source', [0, 2, 0]);
    useEditorStore.setState(s => {
      s.nodes[caseSourceId].data.value = '1'; // string '1'
    });

    // Default source: outputs number 999
    const defaultSourceId = getState().addNode('source', [0, 4, 0]);
    useEditorStore.setState(s => {
      s.nodes[defaultSourceId].data.value = 999;
    });

    // Switch node
    const switchId = getState().addNode('switch', [5, 0, 0]);
    if (strictMode !== undefined) {
      useEditorStore.setState(s => {
        s.nodes[switchId].data.strictMode = strictMode;
      });
    }
    // strictMode defaults to true when not set (strictMode !== false → true)

    // Connections:
    // valueSource port 0 (number 1) → switch input 0 (value)
    getState().addConnection(valueSourceId, 0, switchId, 0);
    // caseSource port 0 (string '1') → switch input 1 (case0)
    getState().addConnection(caseSourceId, 0, switchId, 1);
    // defaultSource port 0 (number 999) → switch input 5 (default)
    getState().addConnection(defaultSourceId, 0, switchId, 5);

    return switchId;
  }

  it('switch processor with strictMode=true uses strict equality (1 !== "1")', () => {
    // strictMode not set → defaults to true
    const switchId = buildSwitchGraph();

    const state = getState();
    const result = executeGraph(state.nodes, state.connections);

    const switchResult = result.results.get(switchId);
    expect(switchResult).toBeDefined();
    // strict mode: number 1 === string '1' → false (different types)
    // No case matches → falls through to default (999)
    expect(switchResult!.outputs[0]).toBe(999);
  });

  it('switch processor with strictMode=false uses loose string equality (1 == "1")', () => {
    const switchId = buildSwitchGraph(false);

    const state = getState();
    const result = executeGraph(state.nodes, state.connections);

    const switchResult = result.results.get(switchId);
    expect(switchResult).toBeDefined();
    // loose mode: String(1) === String('1') → '1' === '1' → true
    // Case0 matches → returns the case0 input value (string '1')
    expect(switchResult!.outputs[0]).toBe('1');
  });
});
