/**
 * Phase 50 Accessibility Tests — Keyboard port navigation, aria-live
 * announcement state transitions, and focus trap logic.
 *
 * Tests exercise Zustand store actions directly (no R3F/Three.js rendering).
 * The keyboard handler (useKeyboardShortcuts) translates key events into these
 * store actions; we verify the state transitions that drive announcements,
 * port cycling, connection drawing, and focus trapping.
 *
 * Node port counts used:
 *   source    — 0 inputs, 2 outputs (value, label)
 *   transform — 2 inputs (in, factor), 2 outputs (result, debug)
 *   output    — 2 inputs (data, label), 0 outputs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import type { NodeType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.selectedIds = new Set<string>();
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.graphTabs = { default: { id: 'default', name: 'Graph 1', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.templates = {};
    s.contextMenu = null;
    s.pendingConnection = null;
    s.interaction = 'idle';
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.errorStrategy = 'fail-fast';
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.isExecuting = false;
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.validationErrors = {};
    s.searchQuery = '';
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.focusedPort = null;
  });
  localStorage.clear();
}

/** Add a node and return its ID. */
function addNode(type: NodeType = 'source', position?: [number, number, number]): string {
  return getState().addNode(type, position ?? [0, 0, 0]);
}

/**
 * Simulate Tab port cycling on a single selected node.
 * Reproduces the exact logic from useKeyboardShortcuts.ts lines 492-516.
 */
function simulatePortTab(shiftKey = false) {
  const state = getState();
  const nodeIds = Object.keys(state.nodes);
  if (nodeIds.length === 0) return;
  const selectedNodeIds = [...state.selectedIds].filter(id => state.nodes[id]);

  if (selectedNodeIds.length === 1) {
    const nodeId = selectedNodeIds[0];
    const node = state.nodes[nodeId];
    // Build flat port list: outputs first, then inputs
    const ports: { nodeId: string; portIndex: number; side: 'input' | 'output' }[] = [];
    for (let i = 0; i < node.outputs.length; i++) ports.push({ nodeId, portIndex: i, side: 'output' });
    for (let i = 0; i < node.inputs.length; i++) ports.push({ nodeId, portIndex: i, side: 'input' });
    if (ports.length === 0) return;

    const current = state.focusedPort;
    const currentIdx = current && current.nodeId === nodeId
      ? ports.findIndex(p => p.portIndex === current.portIndex && p.side === current.side)
      : -1;
    const dir = shiftKey ? -1 : 1;
    const nextIdx = (currentIdx + dir + ports.length) % ports.length;
    state.setFocusedPort(ports[nextIdx]);
    return;
  }

  // No single node selected -- cycle through nodes
  const currentId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  const currentIdx = currentId ? nodeIds.indexOf(currentId) : -1;
  const dir = shiftKey ? -1 : 1;
  const nextIdx = currentIdx === -1 ? 0 : (currentIdx + dir + nodeIds.length) % nodeIds.length;
  state.setSelection(new Set([nodeIds[nextIdx]]));
}

/**
 * Focus trap algorithm extracted from CustomNodeModal.tsx as a pure function.
 * Given a list of focusable elements, the active element, shift state, and
 * a focus function, determines whether to wrap and calls focus accordingly.
 * Returns true if wrapping occurred (preventDefault needed).
 */
function focusTrapLogic(
  focusableElements: { element: unknown; focus: () => void }[],
  activeElement: unknown,
  shiftKey: boolean,
): boolean {
  if (!focusableElements || focusableElements.length === 0) return false;
  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (shiftKey) {
    if (activeElement === first.element) {
      last.focus();
      return true;
    }
  } else {
    if (activeElement === last.element) {
      first.focus();
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Suite 1: Port cycling state transitions
// ===========================================================================

describe('Port cycling state transitions', () => {
  it('focusedPort is null initially', () => {
    addNode('source');
    expect(getState().focusedPort).toBeNull();
  });

  it('Tab on source node (0 inputs, 2 outputs) starts at output[0]', () => {
    const id = addNode('source');
    getState().setSelection(new Set([id]));
    simulatePortTab();

    const fp = getState().focusedPort;
    expect(fp).not.toBeNull();
    expect(fp!.nodeId).toBe(id);
    expect(fp!.portIndex).toBe(0);
    expect(fp!.side).toBe('output');
  });

  it('Tab on source node cycles output[0] -> output[1] -> output[0]', () => {
    const id = addNode('source');
    getState().setSelection(new Set([id]));

    // First Tab: output[0]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'output' });

    // Second Tab: output[1]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 1, side: 'output' });

    // Third Tab: wraps back to output[0] (source has no inputs)
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'output' });
  });

  it('Tab on transform node cycles outputs then inputs: o0->o1->i0->i1->o0', () => {
    const id = addNode('transform');
    getState().setSelection(new Set([id]));

    // output[0]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'output' });

    // output[1]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 1, side: 'output' });

    // input[0]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'input' });

    // input[1]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 1, side: 'input' });

    // wraps to output[0]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'output' });
  });

  it('Tab on output node (2 inputs, 0 outputs) cycles input[0] -> input[1] -> input[0]', () => {
    const id = addNode('output');
    getState().setSelection(new Set([id]));

    // First Tab: input[0] (no outputs to visit first)
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'input' });

    // Second Tab: input[1]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 1, side: 'input' });

    // Third Tab: wraps to input[0]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'input' });
  });

  it('Shift+Tab reverses cycle order on transform node', () => {
    const id = addNode('transform');
    getState().setSelection(new Set([id]));

    // Port array order: output[0], output[1], input[0], input[1] (indices 0,1,2,3)
    // From no focus (currentIdx=-1), Shift+Tab: (-1 + -1 + 4) % 4 = 2 => input[0]
    simulatePortTab(true);
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'input' });

    // Shift+Tab: index 1 => output[1]
    simulatePortTab(true);
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 1, side: 'output' });

    // Shift+Tab: index 0 => output[0]
    simulatePortTab(true);
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'output' });

    // Shift+Tab: wraps to index 3 => input[1]
    simulatePortTab(true);
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 1, side: 'input' });

    // Shift+Tab: index 2 => input[0]
    simulatePortTab(true);
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'input' });
  });

  it('Shift+Tab on source reverses cycle order', () => {
    const id = addNode('source');
    getState().setSelection(new Set([id]));

    // Port array: output[0], output[1] (indices 0,1)
    // From no focus (currentIdx=-1), Shift+Tab: (-1 + -1 + 2) % 2 = 0 => output[0]
    simulatePortTab(true);
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'output' });

    // Shift+Tab: wraps to index 1 => output[1]
    simulatePortTab(true);
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 1, side: 'output' });

    // Shift+Tab: index 0 => output[0]
    simulatePortTab(true);
    expect(getState().focusedPort).toEqual({ nodeId: id, portIndex: 0, side: 'output' });
  });

  it('setSelection clears focusedPort', () => {
    const id = addNode('source');
    getState().setSelection(new Set([id]));
    getState().setFocusedPort({ nodeId: id, portIndex: 0, side: 'output' });
    expect(getState().focusedPort).not.toBeNull();

    // Changing selection should clear focusedPort
    getState().setSelection(new Set([id]));
    expect(getState().focusedPort).toBeNull();
  });

  it('setFocusedPort(null) clears port focus', () => {
    const id = addNode('source');
    getState().setSelection(new Set([id]));
    getState().setFocusedPort({ nodeId: id, portIndex: 0, side: 'output' });
    expect(getState().focusedPort).not.toBeNull();

    getState().setFocusedPort(null);
    expect(getState().focusedPort).toBeNull();
  });

  it('Tab with 0 selected nodes cycles through nodes (not ports)', () => {
    addNode('source', [0, 0, 0]);
    addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set()); // none selected

    simulatePortTab();

    // Should select first node, not set focusedPort
    const nodeIds = Object.keys(getState().nodes);
    expect(getState().selectedIds.has(nodeIds[0])).toBe(true);
    expect(getState().selectedIds.size).toBe(1);
    expect(getState().focusedPort).toBeNull();
  });

  it('Tab with 2+ selected nodes cycles through nodes (not ports)', () => {
    const a = addNode('source', [0, 0, 0]);
    const b = addNode('transform', [5, 0, 0]);
    getState().setSelection(new Set([a, b])); // 2 selected

    simulatePortTab();

    // Should select first node (cycling), not set port focus
    Object.keys(getState().nodes);
    expect(getState().selectedIds.size).toBe(1);
    expect(getState().focusedPort).toBeNull();
  });
});

// ===========================================================================
// Suite 2: Keyboard connection flow
// ===========================================================================

describe('Keyboard connection flow', () => {
  it('startConnection from output port transitions to drawing-connection', () => {
    const srcId = addNode('source');
    getState().startConnection(srcId, 0);

    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().pendingConnection).not.toBeNull();
    expect(getState().pendingConnection!.sourceNodeId).toBe(srcId);
    expect(getState().pendingConnection!.sourcePortIndex).toBe(0);
  });

  it('completeConnection to input port creates connection and returns to idle', () => {
    const srcId = addNode('source', [0, 0, 0]);
    const tgtId = addNode('transform', [5, 0, 0]);

    // Start connection from source output[0]
    getState().startConnection(srcId, 0);
    expect(getState().interaction).toBe('drawing-connection');

    // Complete connection to transform input[0]
    getState().completeConnection(tgtId, 0);

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();

    const conns = Object.values(getState().connections);
    expect(conns.length).toBe(1);
    expect(conns[0].sourceNodeId).toBe(srcId);
    expect(conns[0].sourcePortIndex).toBe(0);
    expect(conns[0].targetNodeId).toBe(tgtId);
    expect(conns[0].targetPortIndex).toBe(0);
  });

  it('cancelConnection clears pendingConnection and focusedPort', () => {
    const srcId = addNode('source');
    getState().setFocusedPort({ nodeId: srcId, portIndex: 0, side: 'output' });
    getState().startConnection(srcId, 0);

    expect(getState().interaction).toBe('drawing-connection');
    expect(getState().focusedPort).not.toBeNull();

    getState().cancelConnection();

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().focusedPort).toBeNull();
  });

  it('startConnection validates output port index bounds', () => {
    const srcId = addNode('source');
    // source has 2 outputs (indices 0 and 1); index 2 is out of bounds
    getState().startConnection(srcId, 2);

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('startConnection with negative port index is a no-op', () => {
    const srcId = addNode('source');
    getState().startConnection(srcId, -1);

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
  });

  it('completeConnection validates type compatibility (no coercion available)', () => {
    // color-picker output[0] is "color" type, transform input[0] is "number"
    // No coercion rule exists for color->number, so connection should fail
    const srcId = addNode('color-picker', [0, 0, 0]);
    const tgtId = addNode('transform', [5, 0, 0]);

    getState().startConnection(srcId, 0); // output[0] = hex (color)
    getState().completeConnection(tgtId, 0); // input[0] = in (number)

    // Connection should fail due to type incompatibility (color -> number)
    // and cancelConnection should have been called
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    // No connection should have been created
    expect(Object.values(getState().connections).length).toBe(0);
  });

  it('full keyboard connection workflow: focus port -> Enter -> navigate -> Enter', () => {
    const srcId = addNode('source', [0, 0, 0]);
    const tgtId = addNode('transform', [5, 0, 0]);

    // Step 1: Select source node
    getState().setSelection(new Set([srcId]));

    // Step 2: Tab to focus output[0]
    simulatePortTab();
    expect(getState().focusedPort).toEqual({ nodeId: srcId, portIndex: 0, side: 'output' });

    // Step 3: Enter to start connection (simulating keyboard handler logic)
    const fp1 = getState().focusedPort!;
    if (fp1.side === 'output' && getState().interaction === 'idle') {
      getState().startConnection(fp1.nodeId, fp1.portIndex);
    }
    expect(getState().interaction).toBe('drawing-connection');

    // Step 4: Focus an input port on the target node
    getState().setFocusedPort({ nodeId: tgtId, portIndex: 0, side: 'input' });

    // Step 5: Enter to complete connection
    const fp2 = getState().focusedPort!;
    if (fp2.side === 'input' && getState().interaction === 'drawing-connection') {
      getState().completeConnection(fp2.nodeId, fp2.portIndex);
      getState().setFocusedPort(null);
    }

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().focusedPort).toBeNull();

    const conns = Object.values(getState().connections);
    expect(conns.length).toBe(1);
    expect(conns[0].sourceNodeId).toBe(srcId);
    expect(conns[0].targetNodeId).toBe(tgtId);
  });

  it('Escape during drawing-connection cancels and clears state', () => {
    const srcId = addNode('source');
    getState().startConnection(srcId, 0);
    expect(getState().interaction).toBe('drawing-connection');

    // Simulate Escape: cancelConnection + clear selection
    getState().cancelConnection();
    getState().setSelection(new Set());

    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(getState().selectedIds.size).toBe(0);
    expect(getState().focusedPort).toBeNull();
  });

  it('completeConnection prevents self-connections', () => {
    const srcId = addNode('transform', [0, 0, 0]);

    getState().startConnection(srcId, 0); // output[0]
    getState().completeConnection(srcId, 0); // input[0] on same node

    // Should have been cancelled -- self-connection not allowed
    expect(getState().interaction).toBe('idle');
    expect(getState().pendingConnection).toBeNull();
    expect(Object.values(getState().connections).length).toBe(0);
  });
});

// ===========================================================================
// Suite 3: Selection state announcements
// ===========================================================================

describe('Selection state announcements', () => {
  it('single node selection produces selectedIds with 1 element', () => {
    const id = addNode('source');
    getState().setSelection(new Set([id]));

    expect(getState().selectedIds.size).toBe(1);
    expect(getState().selectedIds.has(id)).toBe(true);
  });

  it('multi-node selection produces selectedIds with correct count', () => {
    const a = addNode('source', [0, 0, 0]);
    const b = addNode('transform', [5, 0, 0]);
    const c = addNode('output', [10, 0, 0]);

    getState().setSelection(new Set([a, b, c]));

    expect(getState().selectedIds.size).toBe(3);
    expect(getState().selectedIds.has(a)).toBe(true);
    expect(getState().selectedIds.has(b)).toBe(true);
    expect(getState().selectedIds.has(c)).toBe(true);
  });

  it('clear selection produces empty selectedIds', () => {
    const id = addNode('source');
    getState().setSelection(new Set([id]));
    expect(getState().selectedIds.size).toBe(1);

    getState().setSelection(new Set());
    expect(getState().selectedIds.size).toBe(0);
  });

  it('selection change clears focusedPort', () => {
    const a = addNode('source', [0, 0, 0]);
    const b = addNode('transform', [5, 0, 0]);

    // Focus a port on node a
    getState().setSelection(new Set([a]));
    getState().setFocusedPort({ nodeId: a, portIndex: 0, side: 'output' });
    expect(getState().focusedPort).not.toBeNull();

    // Change selection to node b -- focusedPort should clear
    getState().setSelection(new Set([b]));
    expect(getState().focusedPort).toBeNull();
  });

  it('store subscriber fires on selection size changes', () => {
    const id = addNode('source');
    const sizes: number[] = [];

    const unsub = useEditorStore.subscribe(
      s => s.selectedIds.size,
      (size) => { sizes.push(size); },
    );

    getState().setSelection(new Set([id]));   // -> 1
    getState().setSelection(new Set());       // -> 0

    unsub();
    expect(sizes).toEqual([1, 0]);
  });

  it('connection count change triggers store subscriber', () => {
    const srcId = addNode('source', [0, 0, 0]);
    const tgtId = addNode('transform', [5, 0, 0]);

    const counts: number[] = [];
    const unsub = useEditorStore.subscribe(
      s => Object.keys(s.connections).length,
      (count) => { counts.push(count); },
    );

    // Add a connection
    const connId = getState().addConnection(srcId, 0, tgtId, 0);
    expect(connId).not.toBeNull();

    // Remove the connection
    getState().removeConnection(connId!);

    unsub();
    expect(counts).toEqual([1, 0]);
  });
});

// ===========================================================================
// Suite 4: Focus trap logic (pure function tests)
// ===========================================================================

describe('Focus trap logic', () => {
  /** Helper to create mock focusable elements. */
  function makeFocusable(count: number) {
    const focused: unknown[] = [];
    return Array.from({ length: count }, (_, i) => {
      const element = { id: `el-${i}` };
      return {
        element,
        focus: () => { focused.push(element); },
        getFocused: () => focused,
      };
    });
  }

  it('Tab at last element wraps to first', () => {
    const elements = makeFocusable(3);
    const activeElement = elements[2].element; // last element

    const wrapped = focusTrapLogic(elements, activeElement, false);

    expect(wrapped).toBe(true);
    expect(elements[0].getFocused().length).toBe(1);
    expect(elements[0].getFocused()[0]).toBe(elements[0].element);
  });

  it('Shift+Tab at first element wraps to last', () => {
    const elements = makeFocusable(3);
    const activeElement = elements[0].element; // first element

    const wrapped = focusTrapLogic(elements, activeElement, true);

    expect(wrapped).toBe(true);
    expect(elements[2].getFocused().length).toBe(1);
    expect(elements[2].getFocused()[0]).toBe(elements[2].element);
  });

  it('Tab at non-last element does not wrap', () => {
    const elements = makeFocusable(3);
    const activeElement = elements[1].element; // middle element

    const wrapped = focusTrapLogic(elements, activeElement, false);

    expect(wrapped).toBe(false);
    // No focus calls should have happened
    for (const el of elements) {
      expect(el.getFocused().length).toBe(0);
    }
  });

  it('Shift+Tab at non-first element does not wrap', () => {
    const elements = makeFocusable(3);
    const activeElement = elements[1].element; // middle element

    const wrapped = focusTrapLogic(elements, activeElement, true);

    expect(wrapped).toBe(false);
  });

  it('empty focusable list does nothing', () => {
    const wrapped = focusTrapLogic([], {}, false);
    expect(wrapped).toBe(false);
  });

  it('single focusable element: Tab wraps to itself', () => {
    const elements = makeFocusable(1);
    const activeElement = elements[0].element;

    // Tab: active is last (and first) => wraps to first (itself)
    const wrapped = focusTrapLogic(elements, activeElement, false);
    expect(wrapped).toBe(true);
    expect(elements[0].getFocused().length).toBe(1);
  });

  it('single focusable element: Shift+Tab wraps to itself', () => {
    const elements = makeFocusable(1);
    const activeElement = elements[0].element;

    const wrapped = focusTrapLogic(elements, activeElement, true);
    expect(wrapped).toBe(true);
    expect(elements[0].getFocused().length).toBe(1);
  });
});

// ===========================================================================
// Suite 5: Port focus and connection interaction integration
// ===========================================================================

describe('Port focus and connection interaction integration', () => {
  it('focusedPort persists across port navigation within same node', () => {
    const id = addNode('transform');
    getState().setSelection(new Set([id]));

    // Navigate through all 4 ports
    const expected = [
      { nodeId: id, portIndex: 0, side: 'output' },
      { nodeId: id, portIndex: 1, side: 'output' },
      { nodeId: id, portIndex: 0, side: 'input' },
      { nodeId: id, portIndex: 1, side: 'input' },
    ];

    for (const exp of expected) {
      simulatePortTab();
      expect(getState().focusedPort).toEqual(exp);
    }
  });

  it('cancelConnection also clears nearestSnapPort', () => {
    const srcId = addNode('source');

    // Manually set nearestSnapPort to simulate snap state during drawing
    getState().setNearestSnapPort({ nodeId: srcId, portIndex: 0 });
    getState().startConnection(srcId, 0);

    getState().cancelConnection();

    expect(getState().nearestSnapPort).toBeNull();
    expect(getState().pendingConnection).toBeNull();
    expect(getState().focusedPort).toBeNull();
  });

  it('multiple connections can be created via keyboard workflow', () => {
    const srcId = addNode('source', [0, 0, 0]);
    const tgt1 = addNode('transform', [5, 0, 0]);
    const tgt2 = addNode('output', [10, 0, 0]);

    // First connection: source.output[0] -> transform.input[0]
    getState().startConnection(srcId, 0);
    getState().completeConnection(tgt1, 0);
    expect(Object.values(getState().connections).length).toBe(1);

    // Second connection: source.output[1] -> tgt2.input[1] (label:string -> label:string)
    getState().startConnection(srcId, 1);
    getState().completeConnection(tgt2, 1);
    expect(Object.values(getState().connections).length).toBe(2);
  });

  it('focusedPort subscriber fires on port focus changes', () => {
    const id = addNode('source');
    getState().setSelection(new Set([id]));

    const focusChanges: (ReturnType<typeof getState>['focusedPort'])[] = [];
    const unsub = useEditorStore.subscribe(
      s => s.focusedPort,
      (fp) => { focusChanges.push(fp); },
    );

    getState().setFocusedPort({ nodeId: id, portIndex: 0, side: 'output' });
    getState().setFocusedPort({ nodeId: id, portIndex: 1, side: 'output' });
    getState().setFocusedPort(null);

    unsub();

    expect(focusChanges.length).toBe(3);
    expect(focusChanges[0]).toEqual({ nodeId: id, portIndex: 0, side: 'output' });
    expect(focusChanges[1]).toEqual({ nodeId: id, portIndex: 1, side: 'output' });
    expect(focusChanges[2]).toBeNull();
  });

  it('interaction subscriber fires on drawing-connection transitions', () => {
    const srcId = addNode('source');
    const interactions: string[] = [];

    const unsub = useEditorStore.subscribe(
      s => s.interaction,
      (mode) => { interactions.push(mode); },
    );

    getState().startConnection(srcId, 0);  // -> drawing-connection
    getState().cancelConnection();          // -> idle

    unsub();

    expect(interactions).toEqual(['drawing-connection', 'idle']);
  });
});
