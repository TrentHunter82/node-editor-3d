/**
 * Port-Release UX Tests (~15 tests).
 *
 * Verifies the port-release (drag-to-connect) menu logic:
 * - getCompatibleNodeTypes returns correct types for various port types
 * - Filters correctly by direction (sourceIsOutput)
 * - Custom node defs included when port types match
 * - isPortTypeCompatible function correctness
 * - NODE_TYPE_CONFIG covers all 93 node types
 * - addNodeAndConnect creates node + connection atomically
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES, isPortTypeCompatible } from '../types';
import type { PortType, NodeType, CustomNodeDef } from '../types';

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

// ---------------------------------------------------------------------------
// 1. isPortTypeCompatible
// ---------------------------------------------------------------------------

describe('isPortTypeCompatible', () => {
  it('same concrete types are compatible', () => {
    const types: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean'];
    for (const t of types) {
      expect(isPortTypeCompatible(t, t)).toBe(true);
    }
  });

  it('any is compatible with all types', () => {
    const types: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'any'];
    for (const t of types) {
      expect(isPortTypeCompatible('any', t)).toBe(true);
      expect(isPortTypeCompatible(t, 'any')).toBe(true);
    }
  });

  it('different concrete types are incompatible', () => {
    expect(isPortTypeCompatible('number', 'string')).toBe(false);
    expect(isPortTypeCompatible('string', 'vector3')).toBe(false);
    expect(isPortTypeCompatible('boolean', 'color')).toBe(false);
    expect(isPortTypeCompatible('vector3', 'number')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. getCompatibleNodeTypes — basic behavior
// ---------------------------------------------------------------------------

describe('getCompatibleNodeTypes', () => {
  beforeEach(resetStore);

  it('returns empty array for nonexistent source node', () => {
    const result = getState().getCompatibleNodeTypes('nonexistent', 0, true);
    expect(result).toEqual([]);
  });

  it('returns empty array for out-of-range output port index', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const outLen = getState().nodes[id].outputs.length;
    const result = getState().getCompatibleNodeTypes(id, outLen + 10, true);
    expect(result).toEqual([]);
  });

  it('returns empty array for out-of-range input port index', () => {
    const id = getState().addNode('transform', [0, 0, 0]);
    const inLen = getState().nodes[id].inputs.length;
    const result = getState().getCompatibleNodeTypes(id, inLen + 10, false);
    expect(result).toEqual([]);
  });

  it('dragging from number output returns types with number inputs', () => {
    // Source node has number output (port 0)
    const id = getState().addNode('source', [0, 0, 0]);
    const sourcePort = getState().nodes[id].outputs[0];
    expect(sourcePort.portType).toBe('number');

    const compatible = getState().getCompatibleNodeTypes(id, 0, true);
    expect(compatible.length).toBeGreaterThan(0);

    // Every compatible type must have at least one number or any input
    for (const { type } of compatible) {
      const config = NODE_TYPE_CONFIG[type];
      const hasNumberOrAnyInput = config.inputs.some(
        inp => inp.portType === 'number' || inp.portType === 'any'
      );
      expect(hasNumberOrAnyInput).toBe(true);
    }
  });

  it('dragging from number input returns types with number outputs', () => {
    // Transform has a number input (port 0)
    const id = getState().addNode('transform', [0, 0, 0]);
    const inputPort = getState().nodes[id].inputs[0];
    expect(inputPort.portType).toBe('number');

    const compatible = getState().getCompatibleNodeTypes(id, 0, false);
    expect(compatible.length).toBeGreaterThan(0);

    // Every compatible type must have at least one number or any output
    for (const { type } of compatible) {
      const config = NODE_TYPE_CONFIG[type];
      const hasNumberOrAnyOutput = config.outputs.some(
        out => out.portType === 'number' || out.portType === 'any'
      );
      expect(hasNumberOrAnyOutput).toBe(true);
    }
  });

  it('excludes note type (no ports)', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const compatible = getState().getCompatibleNodeTypes(id, 0, true);
    const noteEntry = compatible.find(c => c.type === 'note');
    expect(noteEntry).toBeUndefined();
  });

  it('each compatible type has a valid category', () => {
    const id = getState().addNode('source', [0, 0, 0]);
    const compatible = getState().getCompatibleNodeTypes(id, 0, true);

    for (const { type, category } of compatible) {
      expect(category).toBeDefined();
      expect(NODE_CATEGORIES[type]).toBe(category);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Port type direction filtering
// ---------------------------------------------------------------------------

describe('getCompatibleNodeTypes direction filtering', () => {
  beforeEach(resetStore);

  it('string output finds string-length but not source (number-only inputs)', () => {
    // concat has string output
    const id = getState().addNode('concat', [0, 0, 0]);
    const outputPort = getState().nodes[id].outputs[0];
    expect(outputPort.portType).toBe('string');

    const compatible = getState().getCompatibleNodeTypes(id, 0, true);
    const types = compatible.map(c => c.type);

    // string-length has string input → should be compatible
    expect(types).toContain('string-length');
    // source has no inputs → should not be in compatible list
    expect(types).not.toContain('source');
  });

  it('boolean output finds and/or/not nodes', () => {
    // and has boolean output
    const id = getState().addNode('and', [0, 0, 0]);
    const outputPort = getState().nodes[id].outputs[0];
    expect(outputPort.portType).toBe('boolean');

    const compatible = getState().getCompatibleNodeTypes(id, 0, true);
    const types = compatible.map(c => c.type);

    // and/or/not all have boolean inputs
    expect(types).toContain('and');
    expect(types).toContain('or');
    expect(types).toContain('not');
  });

  it('display node with any input: all node types with outputs are compatible (via input drag)', () => {
    // display has 'any' input
    const id = getState().addNode('display', [0, 0, 0]);
    const inputPort = getState().nodes[id].inputs[0];
    expect(inputPort.portType).toBe('any');

    const compatible = getState().getCompatibleNodeTypes(id, 0, false);
    // With 'any' input, nearly all node types with outputs should match
    expect(compatible.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// 4. NODE_TYPE_CONFIG completeness for port-release
// ---------------------------------------------------------------------------

describe('NODE_TYPE_CONFIG coverage for port-release menu', () => {
  it('has at least 93 node types', () => {
    const types = Object.keys(NODE_TYPE_CONFIG);
    expect(types.length).toBeGreaterThanOrEqual(93);
  });

  it('all types except note/custom/subgraph have at least one port', () => {
    // note, custom, and subgraph have 0 static ports in NODE_TYPE_CONFIG
    // (custom/subgraph ports are set dynamically from defs)
    const dynamicPortTypes = new Set(['note', 'custom', 'subgraph']);
    for (const [type, config] of Object.entries(NODE_TYPE_CONFIG)) {
      if (dynamicPortTypes.has(type)) continue;
      const totalPorts = config.inputs.length + config.outputs.length;
      expect(totalPorts).toBeGreaterThan(0);
    }
  });

  it('every type has a valid category in NODE_CATEGORIES', () => {
    for (const type of Object.keys(NODE_TYPE_CONFIG)) {
      expect(NODE_CATEGORIES[type as NodeType]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. addNodeAndConnect integration
// ---------------------------------------------------------------------------

describe('addNodeAndConnect for port-release', () => {
  beforeEach(resetStore);

  it('creates node and connection when dragging from output port', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);
    const connsBefore = Object.keys(getState().connections).length;

    const newNodeId = getState().addNodeAndConnect(
      'transform',
      [5, 0, 0],
      srcId,
      0,    // output port 0
      true  // sourceIsOutput
    );

    expect(newNodeId).not.toBeNull();
    expect(getState().nodes[newNodeId!]).toBeDefined();
    expect(getState().nodes[newNodeId!].type).toBe('transform');
    // Should have created exactly one new connection
    const conns = Object.values(getState().connections);
    expect(conns.length).toBe(connsBefore + 1);

    // Verify connection direction: source → new node
    const conn = conns.find(c => c.targetNodeId === newNodeId);
    expect(conn).toBeDefined();
    expect(conn!.sourceNodeId).toBe(srcId);
  });

  it('creates node and connection when dragging from input port', () => {
    const targetId = getState().addNode('transform', [5, 0, 0]);
    const connsBefore = Object.keys(getState().connections).length;

    const newNodeId = getState().addNodeAndConnect(
      'source',
      [0, 0, 0],
      targetId,
      0,     // input port 0
      false  // sourceIsOutput = false (dragging FROM input)
    );

    expect(newNodeId).not.toBeNull();
    expect(getState().nodes[newNodeId!]).toBeDefined();
    expect(getState().nodes[newNodeId!].type).toBe('source');
    // Should have created exactly one new connection
    const conns = Object.values(getState().connections);
    expect(conns.length).toBe(connsBefore + 1);

    // Verify connection direction: new source → existing target
    const conn = conns.find(c => c.sourceNodeId === newNodeId);
    expect(conn).toBeDefined();
    expect(conn!.targetNodeId).toBe(targetId);
  });

  it('addNodeAndConnect is atomic in undo (single undo reverts both)', () => {
    const srcId = getState().addNode('source', [0, 0, 0]);

    const newNodeId = getState().addNodeAndConnect('transform', [5, 0, 0], srcId, 0, true);
    expect(newNodeId).not.toBeNull();
    const connId = Object.keys(getState().connections).find(
      k => getState().connections[k].targetNodeId === newNodeId
    );
    expect(connId).toBeDefined();

    // Single undo should remove both node and connection
    getState().undo();
    expect(getState().nodes[newNodeId!]).toBeUndefined();
    expect(getState().connections[connId!]).toBeUndefined();
    // Source node should still exist (it was created by a separate addNode)
    expect(getState().nodes[srcId]).toBeDefined();
  });

  it('returns null for invalid source node', () => {
    const result = getState().addNodeAndConnect('transform', [0, 0, 0], 'nonexistent', 0, true);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Custom node defs port compatibility
// ---------------------------------------------------------------------------

describe('Custom node port compatibility for port-release', () => {
  beforeEach(resetStore);

  it('custom node with number input appears compatible with number output', () => {
    // Register a custom node def with a number input
    useEditorStore.setState(s => {
      s.customNodeDefs = {
        'custom-1': {
          id: 'custom-1',
          name: 'My Custom',
          color: 'teal',
          category: 'custom',
          inputs: [{ label: 'x', portType: 'number' }],
          outputs: [{ label: 'result', portType: 'number' }],
          expression: 'inputs[0] * 2',
        } as CustomNodeDef,
      };
    });

    const srcId = getState().addNode('source', [0, 0, 0]);
    const srcPort = getState().nodes[srcId].outputs[0];
    expect(srcPort.portType).toBe('number');

    // Custom node has number input → compatible with number output
    const customDef = getState().customNodeDefs['custom-1'];
    const hasCompatibleInput = customDef.inputs.some(
      inp => isPortTypeCompatible(srcPort.portType, inp.portType)
    );
    expect(hasCompatibleInput).toBe(true);
  });

  it('custom node with string input is NOT compatible with boolean output', () => {
    useEditorStore.setState(s => {
      s.customNodeDefs = {
        'custom-str': {
          id: 'custom-str',
          name: 'String Custom',
          color: 'orange',
          category: 'custom',
          inputs: [{ label: 'text', portType: 'string' }],
          outputs: [{ label: 'result', portType: 'string' }],
          expression: 'inputs[0].toUpperCase()',
        } as CustomNodeDef,
      };
    });

    // and node has boolean output
    const boolId = getState().addNode('and', [0, 0, 0]);
    const boolPort = getState().nodes[boolId].outputs[0];
    expect(boolPort.portType).toBe('boolean');

    const customDef = getState().customNodeDefs['custom-str'];
    const hasCompatibleInput = customDef.inputs.some(
      inp => isPortTypeCompatible(boolPort.portType, inp.portType)
    );
    expect(hasCompatibleInput).toBe(false);
  });

  it('custom node with any input is compatible with all output types', () => {
    useEditorStore.setState(s => {
      s.customNodeDefs = {
        'custom-any': {
          id: 'custom-any',
          name: 'Any Custom',
          color: 'coral',
          category: 'custom',
          inputs: [{ label: 'val', portType: 'any' }],
          outputs: [{ label: 'result', portType: 'any' }],
          expression: 'inputs[0]',
        } as CustomNodeDef,
      };
    });

    const types: PortType[] = ['number', 'string', 'boolean', 'vector3', 'color'];
    for (const sourceType of types) {
      const customDef = getState().customNodeDefs['custom-any'];
      const compatible = customDef.inputs.some(
        inp => isPortTypeCompatible(sourceType, inp.portType)
      );
      expect(compatible).toBe(true);
    }
  });
});
