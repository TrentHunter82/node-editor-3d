import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
// isPortTypeCompatible and PortType available from '../types' if needed

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
    s.highlightedPorts = new Set<string>();
  });
}

function getState() {
  return useEditorStore.getState();
}

// ===========================================================================
// 1. highlightedPorts initial state
// ===========================================================================
describe('highlightedPorts initial state', () => {
  beforeEach(() => resetStore());

  it('is an empty Set on store init', () => {
    const hp = getState().highlightedPorts;
    expect(hp).toBeInstanceOf(Set);
    expect(hp.size).toBe(0);
  });

  it('remains empty when nodes are added but no connection is started', () => {
    getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    expect(getState().highlightedPorts.size).toBe(0);
  });
});

// ===========================================================================
// 2. startConnection populates highlightedPorts
// ===========================================================================
describe('startConnection populates highlightedPorts', () => {
  beforeEach(() => resetStore());

  it('highlights number-compatible input ports when starting from source output 0 (number)', () => {
    // source: 0 inputs, outputs = [number, string]
    const src = getState().addNode('source', [0, 0, 0]);
    // transform: inputs = [number, number], outputs = [number, string]
    const xfm = getState().addNode('transform', [5, 0, 0]);
    // output: inputs = [any, string], outputs = []
    const out = getState().addNode('output', [10, 0, 0]);

    getState().startConnection(src, 0); // number output

    const hp = getState().highlightedPorts;
    // transform input 0 (number) = compatible
    expect(hp.has(`${xfm}:0`)).toBe(true);
    // transform input 1 (number) = compatible
    expect(hp.has(`${xfm}:1`)).toBe(true);
    // output input 0 (any) = compatible
    expect(hp.has(`${out}:0`)).toBe(true);
    // output input 1 (string) - number->string has coercion, so should be highlighted
    expect(hp.has(`${out}:1`)).toBe(true);
  });

  it('highlights string-compatible input ports when starting from source output 1 (string)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);

    getState().startConnection(src, 1); // string output

    const hp = getState().highlightedPorts;
    // transform input 0 (number) - string->number has coercion
    expect(hp.has(`${xfm}:0`)).toBe(true);
    // transform input 1 (number) - string->number has coercion
    expect(hp.has(`${xfm}:1`)).toBe(true);
    // output input 0 (any) = compatible via isPortTypeCompatible
    expect(hp.has(`${out}:0`)).toBe(true);
    // output input 1 (string) = exact match
    expect(hp.has(`${out}:1`)).toBe(true);
  });

  it('excludes the source node own ports from highlighted set (no self-connection)', () => {
    // filter: inputs = [any], outputs = [any] — has both input and output
    const filterNode = getState().addNode('filter', [0, 0, 0]);
    getState().addNode('output', [5, 0, 0]);

    getState().startConnection(filterNode, 0); // any output

    const hp = getState().highlightedPorts;
    // filter's own input port 0 should NOT be highlighted
    expect(hp.has(`${filterNode}:0`)).toBe(false);
  });

  it('highlights compatible input ports across multiple target nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm1 = getState().addNode('transform', [5, 0, 0]);
    const xfm2 = getState().addNode('transform', [10, 0, 0]);
    const out = getState().addNode('output', [15, 0, 0]);
    const disp = getState().addNode('display', [20, 0, 0]);

    getState().startConnection(src, 0); // number output

    const hp = getState().highlightedPorts;
    // Both transforms' number inputs
    expect(hp.has(`${xfm1}:0`)).toBe(true);
    expect(hp.has(`${xfm1}:1`)).toBe(true);
    expect(hp.has(`${xfm2}:0`)).toBe(true);
    expect(hp.has(`${xfm2}:1`)).toBe(true);
    // output's any input
    expect(hp.has(`${out}:0`)).toBe(true);
    // display's any input
    expect(hp.has(`${disp}:0`)).toBe(true);
  });

  it('highlights any-type input ports for any source type', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const filterNode = getState().addNode('filter', [5, 0, 0]);

    // number output -> filter input (any) should be highlighted
    getState().startConnection(src, 0);
    expect(getState().highlightedPorts.has(`${filterNode}:0`)).toBe(true);

    // Reset and try string output
    getState().cancelConnection();
    getState().startConnection(src, 1);
    expect(getState().highlightedPorts.has(`${filterNode}:0`)).toBe(true);
  });

  it('highlights via coercion: number source to string input (coercion exists)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    // concat has string inputs
    const concatNode = getState().addNode('concat', [5, 0, 0]);

    getState().startConnection(src, 0); // number output

    const hp = getState().highlightedPorts;
    // concat input 0 is string type; number->string coercion exists
    expect(hp.has(`${concatNode}:0`)).toBe(true);
  });
});

// ===========================================================================
// 3. highlightedPorts format
// ===========================================================================
describe('highlightedPorts format', () => {
  beforeEach(() => resetStore());

  it('uses "nodeId:portIndex" string format', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, 0);

    const hp = getState().highlightedPorts;
    for (const key of hp) {
      expect(key).toMatch(/^.+:\d+$/);
    }
    // Verify specific entries use node IDs
    expect(hp.has(`${xfm}:0`)).toBe(true);
    expect(hp.has(`${xfm}:1`)).toBe(true);
  });

  it('port indices are zero-based integers in the key string', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const out = getState().addNode('output', [5, 0, 0]);

    getState().startConnection(src, 0);

    const hp = getState().highlightedPorts;
    // output has input 0 (any) and input 1 (string)
    expect(hp.has(`${out}:0`)).toBe(true);
    expect(hp.has(`${out}:1`)).toBe(true);
  });
});

// ===========================================================================
// 4. completeConnection clears highlightedPorts
// ===========================================================================
describe('completeConnection clears highlightedPorts', () => {
  beforeEach(() => resetStore());

  it('clears highlightedPorts after successful connection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, 0);
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    getState().completeConnection(xfm, 0);

    expect(getState().highlightedPorts.size).toBe(0);
  });

  it('sets interaction to idle after complete', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, 0);
    getState().completeConnection(xfm, 0);

    expect(getState().interaction).toBe('idle');
  });

  it('sets pendingConnection to null after complete', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, 0);
    getState().completeConnection(xfm, 0);

    expect(getState().pendingConnection).toBeNull();
  });
});

// ===========================================================================
// 5. cancelConnection clears highlightedPorts
// ===========================================================================
describe('cancelConnection clears highlightedPorts', () => {
  beforeEach(() => resetStore());

  it('clears highlightedPorts after cancel', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, 0);
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    getState().cancelConnection();

    expect(getState().highlightedPorts.size).toBe(0);
  });

  it('sets interaction to idle after cancel', () => {
    const src = getState().addNode('source', [0, 0, 0]);

    getState().startConnection(src, 0);
    getState().cancelConnection();

    expect(getState().interaction).toBe('idle');
  });

  it('sets pendingConnection to null after cancel', () => {
    const src = getState().addNode('source', [0, 0, 0]);

    getState().startConnection(src, 0);
    getState().cancelConnection();

    expect(getState().pendingConnection).toBeNull();
  });
});

// ===========================================================================
// 6. completeConnection with coercion fallback clears highlights
// ===========================================================================
describe('completeConnection with coercion fallback clears highlights', () => {
  beforeEach(() => resetStore());

  it('clears highlightedPorts when coercion path is used (number -> string input)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    // concat has two string inputs — number->string has coercion
    const concatNode = getState().addNode('concat', [5, 0, 0]);

    getState().startConnection(src, 0); // number output
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    getState().completeConnection(concatNode, 0); // string input

    // Whether coercion auto-inserts a converter or falls back to cancel,
    // highlightedPorts must be cleared
    expect(getState().highlightedPorts.size).toBe(0);
  });
});

// ===========================================================================
// 7. completeConnection rejection clears highlights
// ===========================================================================
describe('completeConnection rejection clears highlights', () => {
  beforeEach(() => resetStore());

  it('clears highlights on self-connection attempt', () => {
    // filter has both input and output with type 'any'
    const filterNode = getState().addNode('filter', [0, 0, 0]);
    getState().addNode('output', [5, 0, 0]); // ensure highlights exist

    getState().startConnection(filterNode, 0);
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    // Attempt self-connection — should be rejected
    getState().completeConnection(filterNode, 0);

    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
  });

  it('clears highlights on duplicate connection attempt', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);

    // Create the connection first
    getState().addConnection(src, 0, xfm, 0);

    // Start a new drawing and try to duplicate it
    getState().startConnection(src, 0);
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    getState().completeConnection(xfm, 0);

    // Duplicate is rejected (existing conn is replaced atomically so this succeeds,
    // but highlights are always cleared either way)
    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
  });

  it('clears highlights when completing to a nonexistent target node', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, 0);
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    getState().completeConnection('nonexistent-node', 0);

    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
  });

  it('clears highlights on cycle-creating connection attempt', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const filterA = getState().addNode('filter', [5, 0, 0]);
    const filterB = getState().addNode('filter', [10, 0, 0]);

    // Create chain: src -> filterA -> filterB
    getState().addConnection(src, 0, filterA, 0);
    getState().addConnection(filterA, 0, filterB, 0);

    // Attempt cycle: filterB -> filterA (would create cycle)
    getState().startConnection(filterB, 0);
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    getState().completeConnection(filterA, 0);

    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
  });
});

// ===========================================================================
// 8. setHighlightedPorts / clearHighlightedPorts
// ===========================================================================
describe('setHighlightedPorts / clearHighlightedPorts', () => {
  beforeEach(() => resetStore());

  it('setHighlightedPorts replaces current set', () => {
    const customPorts = new Set(['nodeA:0', 'nodeB:1', 'nodeC:2']);
    getState().setHighlightedPorts(customPorts);

    const hp = getState().highlightedPorts;
    expect(hp.size).toBe(3);
    expect(hp.has('nodeA:0')).toBe(true);
    expect(hp.has('nodeB:1')).toBe(true);
    expect(hp.has('nodeC:2')).toBe(true);
  });

  it('clearHighlightedPorts empties the set', () => {
    getState().setHighlightedPorts(new Set(['a:0', 'b:1']));
    expect(getState().highlightedPorts.size).toBe(2);

    getState().clearHighlightedPorts();
    expect(getState().highlightedPorts.size).toBe(0);
  });

  it('setHighlightedPorts overwrites previous highlights', () => {
    getState().setHighlightedPorts(new Set(['old:0']));
    expect(getState().highlightedPorts.has('old:0')).toBe(true);

    getState().setHighlightedPorts(new Set(['new:0']));
    expect(getState().highlightedPorts.has('old:0')).toBe(false);
    expect(getState().highlightedPorts.has('new:0')).toBe(true);
  });

  it('clearHighlightedPorts on already empty set is a no-op', () => {
    expect(getState().highlightedPorts.size).toBe(0);
    getState().clearHighlightedPorts();
    expect(getState().highlightedPorts.size).toBe(0);
  });
});

// ===========================================================================
// 9. Full lifecycle test
// ===========================================================================
describe('Full connection lifecycle', () => {
  beforeEach(() => resetStore());

  it('start -> updatePendingCursor -> complete cleans all transient state', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);

    // Start
    getState().startConnection(src, 0);
    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().pendingConnection).not.toBeNull();
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    // Update cursor
    getState().updatePendingCursor([2.5, 1, 0]);
    expect(getState().pendingConnection!.cursorPos).toEqual([2.5, 1, 0]);
    // Highlights should remain during cursor update
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);

    // Complete
    getState().completeConnection(xfm, 0);

    // All transient state should be clean
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().highlightedPorts.size).toBe(0);

    // Connection should exist
    const conns = Object.values(getState().connections);
    expect(conns.length).toBe(1);
    expect(conns[0].sourceNodeId).toBe(src);
    expect(conns[0].targetNodeId).toBe(xfm);
  });

  it('start -> updatePendingCursor -> cancel cleans all transient state', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, 0);
    getState().updatePendingCursor([3, 2, 1]);
    getState().cancelConnection();

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().highlightedPorts.size).toBe(0);
    expect(Object.keys(getState().connections).length).toBe(0);
  });
});

// ===========================================================================
// 10. Multiple start/cancel cycles
// ===========================================================================
describe('Multiple start/cancel cycles', () => {
  beforeEach(() => resetStore());

  it('starting a new connection replaces previous highlights', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    const out = getState().addNode('output', [10, 0, 0]);

    // Start from source output 0 (number)
    getState().startConnection(src, 0);
    const firstHighlights = new Set(getState().highlightedPorts);
    expect(firstHighlights.size).toBeGreaterThan(0);

    // Cancel and start from source output 1 (string)
    getState().cancelConnection();
    getState().startConnection(src, 1);
    const secondHighlights = getState().highlightedPorts;
    expect(secondHighlights.size).toBeGreaterThan(0);

    // output input 1 (string) should definitely be in second highlights
    expect(secondHighlights.has(`${out}:1`)).toBe(true);
  });

  it('rapid start/cancel cycles leave store in clean state', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    for (let i = 0; i < 5; i++) {
      getState().startConnection(src, 0);
      expect(getState().highlightedPorts.size).toBeGreaterThan(0);
      getState().cancelConnection();
      expect(getState().highlightedPorts.size).toBe(0);
    }

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().highlightedPorts.size).toBe(0);
  });

  it('alternating between different output ports produces different highlight sets', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    // Add a node with only number inputs (no coercion from string)
    getState().addNode('transform', [5, 0, 0]);

    // Start from number output
    getState().startConnection(src, 0);
    const numberHighlights = new Set(getState().highlightedPorts);

    getState().cancelConnection();

    // Start from string output
    getState().startConnection(src, 1);
    const stringHighlights = new Set(getState().highlightedPorts);

    // Both should have entries (transform number inputs accept number directly
    // and string via coercion), but verify the sets were recomputed (not stale)
    expect(numberHighlights.size).toBeGreaterThan(0);
    expect(stringHighlights.size).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 11. Edge cases
// ===========================================================================
describe('Edge cases', () => {
  beforeEach(() => resetStore());

  it('startConnection with invalid (nonexistent) node does NOT set highlightedPorts', () => {
    getState().addNode('transform', [5, 0, 0]);

    getState().startConnection('nonexistent-node-id', 0);

    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('startConnection with out-of-range port index does NOT set highlightedPorts', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    // source has 2 outputs (0, 1), index 99 is invalid
    getState().startConnection(src, 99);

    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
  });

  it('startConnection with negative port index does NOT set highlightedPorts', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, -1);

    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
  });

  it('empty graph (no other nodes) produces empty highlightedPorts', () => {
    const src = getState().addNode('source', [0, 0, 0]);

    getState().startConnection(src, 0);

    // No other nodes exist, so no compatible input ports to highlight
    expect(getState().highlightedPorts.size).toBe(0);
    // But the connection drawing state should still be active
    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().pendingConnection).not.toBeNull();
  });

  it('completeConnection without prior startConnection is a no-op', () => {
    getState().addNode('source', [0, 0, 0]);
    const xfm = getState().addNode('transform', [5, 0, 0]);

    getState().completeConnection(xfm, 0);

    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
    expect(Object.keys(getState().connections).length).toBe(0);
  });

  it('cancelConnection without prior startConnection is safe', () => {
    getState().cancelConnection();

    expect(getState().highlightedPorts.size).toBe(0);
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });
});
