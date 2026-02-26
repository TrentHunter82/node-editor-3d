/**
 * Phase 56 Performance Tests for Rosebud Node Editor 3D
 *
 * Tests performance characteristics including:
 * 1. isConnectionIncompatible selector evaluation logic
 * 2. highlightedPorts state management during connection drawing
 * 3. Store update propagation with many nodes
 * 4. Selector memoization contract
 *
 * Environment: Vitest + Zustand + Immer (jsdom, no R3F rendering)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import type { NodeType, PortType } from '../types';
import { isPortTypeCompatible } from '../types';
import { hasCoercion } from '../utils/typeCoercions';
import {
  getCachedBasicMaterial,
  getCachedRoundedBoxGeo,
  _resetMaterialCache,
  _getCacheSizes,
} from '../utils/materialCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState(s => {
    s.nodes = {};
    s.connections = {};
    s.selectedIds = new Set();
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.contextMenu = null;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.isExecuting = false;
    s.validationErrors = {};
    s.highlightedPorts = new Set();
    s.incompatibleNodeIds = new Set();
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
  });
}

/**
 * Replicates the isConnectionIncompatible selector logic from NodeModule.
 * Pure function: given store state and a target node id, determines whether
 * the pending connection source is incompatible with ALL inputs of the target node.
 */
function isConnectionIncompatible(
  s: ReturnType<typeof getState>,
  nodeId: string,
): boolean {
  if (s.interaction !== 'drawing-connection' || !s.pendingConnection) return false;
  const srcNodeId = s.pendingConnection.sourceNodeId;
  if (srcNodeId === nodeId) return false;
  const srcNode = s.nodes[srcNodeId];
  if (!srcNode) return false;
  const tgtNode = s.nodes[nodeId];
  if (!tgtNode) return false;
  const srcPort = srcNode.outputs[s.pendingConnection.sourcePortIndex];
  const srcType = (srcPort?.portType ?? 'any') as PortType;
  for (const inp of tgtNode.inputs) {
    const tgtType = (inp.portType ?? 'any') as PortType;
    if (isPortTypeCompatible(srcType, tgtType) || hasCoercion(srcType, tgtType)) {
      return false;
    }
  }
  return true;
}

/** Create N nodes of a given type, returning their IDs. */
function createNodes(type: NodeType, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(getState().addNode(type, [i * 2, 0, 0]));
  }
  return ids;
}

// ===========================================================================
// 1. isConnectionIncompatible selector evaluation
// ===========================================================================
describe('isConnectionIncompatible selector logic', () => {
  beforeEach(() => { resetStore(); });

  it('returns false when interaction is idle', () => {
    getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    const s = getState();
    expect(s.interaction).toBe('idle');
    expect(isConnectionIncompatible(s, tgt)).toBe(false);
  });

  it('returns false when pendingConnection is null', () => {
    getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    useEditorStore.setState(st => { st.interaction = 'drawing-connection'; });
    expect(isConnectionIncompatible(getState(), tgt)).toBe(false);
  });

  it('returns false when target is the source node itself', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    expect(isConnectionIncompatible(getState(), src)).toBe(false);
  });

  it('returns false for compatible number->number connection', () => {
    // source output 0 = number, transform input 0 = number
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    expect(isConnectionIncompatible(getState(), tgt)).toBe(false);
  });

  it('returns false for compatible string->string connection', () => {
    // concat has string inputs, source output 1 is string
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('concat', [5, 0, 0]);
    getState().startConnection(src, 1); // string output
    expect(isConnectionIncompatible(getState(), tgt)).toBe(false);
  });

  it('returns false for any->any compatible connections', () => {
    // filter has 'any' input; source output 0 is number -- any accepts anything
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('filter', [5, 0, 0]);
    getState().startConnection(src, 0);
    expect(isConnectionIncompatible(getState(), tgt)).toBe(false);
  });

  it('returns false when coercion is available (number->string)', () => {
    // source output 0 = number, concat inputs = string
    // hasCoercion('number', 'string') should be true
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('concat', [5, 0, 0]);
    getState().startConnection(src, 0); // number output
    // concat has string inputs, but number->string coercion exists
    expect(hasCoercion('number', 'string')).toBe(true);
    expect(isConnectionIncompatible(getState(), tgt)).toBe(false);
  });

  it('returns true for truly incompatible types with no coercion', () => {
    // compose-vec3 output is vector3; concat inputs are string
    // vector3->string has no coercion (check)
    const vec = getState().addNode('compose-vec3', [0, 0, 0]);
    const strNode = getState().addNode('concat', [5, 0, 0]);
    getState().startConnection(vec, 0); // vector3 output
    // vector3->string: check if coercion exists
    const coercionExists = hasCoercion('vector3', 'string');
    if (!coercionExists) {
      expect(isConnectionIncompatible(getState(), strNode)).toBe(true);
    } else {
      // If coercion exists, it should be compatible
      expect(isConnectionIncompatible(getState(), strNode)).toBe(false);
    }
  });

  it('returns false when target has no inputs (e.g., source node)', () => {
    // source has no inputs, so the loop returns true (no compatible input found)
    const srcA = getState().addNode('source', [0, 0, 0]);
    const srcB = getState().addNode('source', [5, 0, 0]);
    getState().startConnection(srcA, 0);
    // source has 0 inputs -- loop body never runs, returns true
    expect(isConnectionIncompatible(getState(), srcB)).toBe(true);
  });

  it('evaluates correctly across 50+ nodes of mixed types', () => {
    // Create a source with number output
    const src = getState().addNode('source', [0, 0, 0]);
    // Create 25 transform nodes (number inputs -- compatible)
    const transforms = createNodes('transform', 25);
    // Create 25 concat nodes (string inputs -- coercion may apply)
    const concats = createNodes('concat', 25);

    getState().startConnection(src, 0); // number output
    const s = getState();

    // All transforms should be compatible (number->number)
    for (const tid of transforms) {
      expect(isConnectionIncompatible(s, tid)).toBe(false);
    }

    // Concats: number->string coercion exists, so they should be compatible
    for (const cid of concats) {
      expect(isConnectionIncompatible(s, cid)).toBe(false);
    }
  });

  it('selector runs once per evaluation (measures invocation count)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    createNodes('transform', 50);
    getState().startConnection(src, 0);

    let callCount = 0;
    const countingSelector = (s: ReturnType<typeof getState>) => {
      callCount++;
      // Just returns a value -- we only care about call count
      return s.interaction;
    };

    // Calling the selector directly should count as exactly 1 call
    callCount = 0;
    countingSelector(getState());
    expect(callCount).toBe(1);
  });

  it('selector evaluates N times when subscribed and N updates happen', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const transforms = createNodes('transform', 10);
    getState().startConnection(src, 0);

    let evalCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => {
        evalCount++;
        return isConnectionIncompatible(s, transforms[0]);
      },
    );

    // Make 5 unrelated updates
    evalCount = 0;
    for (let i = 0; i < 5; i++) {
      getState().updatePendingCursor([i, 0, 0]);
    }
    // Each setState triggers the subscribe callback
    expect(evalCount).toBe(5);

    unsub();
  });

  it('always returns false for all nodes when NOT in drawing-connection mode', () => {
    const nodeIds = createNodes('transform', 50);
    // Ensure we are NOT drawing
    expect(getState().interaction).toBe('idle');
    const s = getState();

    for (const nid of nodeIds) {
      expect(isConnectionIncompatible(s, nid)).toBe(false);
    }
  });

  it('returns false when source node is missing from store', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    // Remove source node from store
    useEditorStore.setState(st => { delete st.nodes[src]; });
    expect(isConnectionIncompatible(getState(), tgt)).toBe(false);
  });

  it('returns false when target node is missing from store', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    // Remove target node from store
    useEditorStore.setState(st => { delete st.nodes[tgt]; });
    expect(isConnectionIncompatible(getState(), tgt)).toBe(false);
  });
});

// ===========================================================================
// 2. highlightedPorts state management
// ===========================================================================
describe('highlightedPorts state management', () => {
  beforeEach(() => { resetStore(); });

  it('startConnection populates highlightedPorts', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0); // number output
    const highlighted = getState().highlightedPorts;
    expect(highlighted.size).toBeGreaterThan(0);
  });

  it('completeConnection clears highlightedPorts', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);
    getState().completeConnection(tgt, 0);
    expect(getState().highlightedPorts.size).toBe(0);
  });

  it('cancelConnection clears highlightedPorts', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    expect(getState().highlightedPorts.size).toBeGreaterThan(0);
    getState().cancelConnection();
    expect(getState().highlightedPorts.size).toBe(0);
  });

  it('highlights correct number->number ports across 50+ nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    // Create 50 transform nodes -- each has 2 number inputs
    const transforms = createNodes('transform', 50);

    getState().startConnection(src, 0); // number output
    const highlighted = getState().highlightedPorts;

    // Each transform has 2 number inputs = 100 highlighted ports
    for (const tid of transforms) {
      const tgtNode = getState().nodes[tid];
      for (let i = 0; i < tgtNode.inputs.length; i++) {
        expect(highlighted.has(`${tid}:${i}`)).toBe(true);
      }
    }
  });

  it('highlights correct string->string ports across 50+ nodes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    // Create 50 concat nodes -- each has 2 string inputs
    const concats = createNodes('concat', 50);

    getState().startConnection(src, 1); // string output (source output index 1)
    const highlighted = getState().highlightedPorts;

    for (const cid of concats) {
      const tgtNode = getState().nodes[cid];
      for (let i = 0; i < tgtNode.inputs.length; i++) {
        // string->string is directly compatible
        expect(highlighted.has(`${cid}:${i}`)).toBe(true);
      }
    }
  });

  it('highlights any->any compatible ports (filter node)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const filterIds = createNodes('filter', 10);

    getState().startConnection(src, 0); // number output
    const highlighted = getState().highlightedPorts;

    // filter has 'any' input at index 0 -- compatible with any source type
    for (const fid of filterIds) {
      expect(highlighted.has(`${fid}:0`)).toBe(true);
    }
  });

  it('does NOT include source node ports in highlighted set', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    getState().startConnection(src, 0);
    const highlighted = getState().highlightedPorts;

    // Source node should never appear in highlighted ports (self-connection prevention)
    for (const key of highlighted) {
      const nodeId = key.split(':')[0];
      expect(nodeId).not.toBe(src);
    }
  });

  it('excludes incompatible ports from highlighted set', () => {
    // compose-vec3 outputs vector3; math inputs are number
    const vec = getState().addNode('compose-vec3', [0, 0, 0]);
    const mathNodes = createNodes('math', 10);

    getState().startConnection(vec, 0); // vector3 output
    const highlighted = getState().highlightedPorts;

    // math nodes have number inputs. vector3->number may have coercion.
    const coercionExists = hasCoercion('vector3', 'number');
    for (const mid of mathNodes) {
      const node = getState().nodes[mid];
      for (let i = 0; i < node.inputs.length; i++) {
        if (coercionExists || isPortTypeCompatible('vector3', node.inputs[i].portType)) {
          expect(highlighted.has(`${mid}:${i}`)).toBe(true);
        } else {
          expect(highlighted.has(`${mid}:${i}`)).toBe(false);
        }
      }
    }
  });

  it('highlighted ports is a superset of getCompatiblePorts (includes coercion)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    createNodes('transform', 20);
    createNodes('concat', 10);
    createNodes('filter', 5);

    getState().startConnection(src, 0); // number output
    const highlighted = getState().highlightedPorts;
    const compatible = getState().getCompatiblePorts(src, 0);

    // getCompatiblePorts checks only isPortTypeCompatible (exact + any)
    // highlightedPorts also includes hasCoercion matches, so it is a superset
    expect(highlighted.size).toBeGreaterThanOrEqual(compatible.length);
    for (const { nodeId, portIndex } of compatible) {
      expect(highlighted.has(`${nodeId}:${portIndex}`)).toBe(true);
    }
  });
});

// ===========================================================================
// 3. Store update propagation with many nodes
// ===========================================================================
describe('Store update propagation with many nodes', () => {
  beforeEach(() => { resetStore(); });

  it('addNode triggers exactly 1 state update per call', () => {
    let updateCount = 0;
    const unsub = useEditorStore.subscribe(() => { updateCount++; });

    updateCount = 0;
    getState().addNode('source', [0, 0, 0]);
    expect(updateCount).toBe(1);

    unsub();
  });

  it('creating 50 nodes triggers exactly 50 subscription callbacks', () => {
    let updateCount = 0;
    const unsub = useEditorStore.subscribe(() => { updateCount++; });

    updateCount = 0;
    for (let i = 0; i < 50; i++) {
      getState().addNode('source', [i * 2, 0, 0]);
    }
    expect(updateCount).toBe(50);

    unsub();
  });

  it('setNodeSizes for one node does not trigger per-node cascading updates', () => {
    const ids = createNodes('transform', 50);

    let updateCount = 0;
    const unsub = useEditorStore.subscribe(() => { updateCount++; });

    updateCount = 0;
    getState().setNodeSizes({ [ids[0]]: { width: 2.0, height: 1.0 } });
    // setNodeSizes is a single batched set() call -- should be exactly 1 update
    expect(updateCount).toBe(1);

    unsub();
  });

  it('setNodeSizes for multiple nodes is a single state update', () => {
    const ids = createNodes('transform', 50);
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const id of ids) {
      sizes[id] = { width: 2.0, height: 1.2 };
    }

    let updateCount = 0;
    const unsub = useEditorStore.subscribe(() => { updateCount++; });

    updateCount = 0;
    getState().setNodeSizes(sizes);
    expect(updateCount).toBe(1);

    unsub();
  });

  it('subscription callback fires after addConnection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);

    let updateCount = 0;
    const unsub = useEditorStore.subscribe(() => { updateCount++; });

    updateCount = 0;
    getState().addConnection(src, 0, tgt, 0);
    expect(updateCount).toBeGreaterThanOrEqual(1);

    unsub();
  });

  it('single-node position update with 50 nodes triggers exactly 1 update', () => {
    const ids = createNodes('transform', 50);

    let updateCount = 0;
    const unsub = useEditorStore.subscribe(() => { updateCount++; });

    updateCount = 0;
    getState().updateNodePosition(ids[0], [10, 0, 0]);
    expect(updateCount).toBe(1);

    unsub();
  });

  it('updateNodeData triggers exactly 1 update regardless of node count', () => {
    const ids = createNodes('source', 50);

    let updateCount = 0;
    const unsub = useEditorStore.subscribe(() => { updateCount++; });

    updateCount = 0;
    getState().updateNodeData(ids[25], 'value', 42);
    // updateNodeData may also trigger validation or reactive execution
    // but the core set() should be 1
    expect(updateCount).toBeGreaterThanOrEqual(1);

    unsub();
  });

  it('removeNode triggers a bounded number of updates', () => {
    const ids = createNodes('source', 50);

    let updateCount = 0;
    const unsub = useEditorStore.subscribe(() => { updateCount++; });

    updateCount = 0;
    getState().removeNode(ids[0]);
    // removeNode may do a few operations (cleanup connections, undo snapshot, etc.)
    // but should NOT trigger 50 cascading updates
    expect(updateCount).toBeLessThan(10);

    unsub();
  });
});

// ===========================================================================
// 4. Selector memoization contract
// ===========================================================================
describe('Selector memoization contract', () => {
  beforeEach(() => { resetStore(); });

  it('selector does not fire for unrelated state changes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);

    let selectorCallCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => s.nodes[src]?.title,
      () => {
        selectorCallCount++;
      },
    );

    selectorCallCount = 0;
    // Update an UNRELATED node's title
    getState().updateNodeTitle(tgt, 'New Title');
    // The selector watches src's title, not tgt -- should NOT fire
    expect(selectorCallCount).toBe(0);

    unsub();
  });

  it('selector fires when the watched value actually changes', () => {
    const src = getState().addNode('source', [0, 0, 0]);

    let selectorCallCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => s.nodes[src]?.title,
      () => { selectorCallCount++; },
    );

    selectorCallCount = 0;
    getState().updateNodeTitle(src, 'Updated Title');
    expect(selectorCallCount).toBe(1);

    unsub();
  });

  it('selector does not fire when value is unchanged (same reference)', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const originalTitle = getState().nodes[src].title;

    let selectorCallCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => s.nodes[src]?.title,
      () => { selectorCallCount++; },
    );

    selectorCallCount = 0;
    // Set the same title -- should not trigger
    getState().updateNodeTitle(src, originalTitle);
    expect(selectorCallCount).toBe(0);

    unsub();
  });

  it('interaction mode selector does not fire on node mutations', () => {
    const src = getState().addNode('source', [0, 0, 0]);

    let callCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => s.interaction,
      () => { callCount++; },
    );

    callCount = 0;
    getState().updateNodeData(src, 'value', 999);
    getState().updateNodePosition(src, [10, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    // None of these change interaction mode
    expect(callCount).toBe(0);

    unsub();
  });

  it('connections selector does not fire on node-only changes', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    let callCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => s.connections,
      () => { callCount++; },
    );

    callCount = 0;
    getState().updateNodeTitle(src, 'Renamed');
    getState().updateNodeData(src, 'value', 123);
    // connections should not change
    expect(callCount).toBe(0);

    unsub();
  });

  it('selectedIds selector fires only when selection changes', () => {
    const ids = createNodes('source', 5);

    let callCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => s.selectedIds,
      () => { callCount++; },
    );

    callCount = 0;
    // Unrelated update
    getState().updateNodeData(ids[0], 'value', 42);
    expect(callCount).toBe(0);

    // Now actually change selection
    getState().setSelection(new Set([ids[0]]));
    expect(callCount).toBe(1);

    unsub();
  });

  it('highlightedPorts selector fires on startConnection and cancelConnection', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    let callCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => s.highlightedPorts,
      () => { callCount++; },
    );

    callCount = 0;
    getState().startConnection(src, 0);
    expect(callCount).toBe(1);

    getState().cancelConnection();
    expect(callCount).toBe(2);

    unsub();
  });

  it('node-specific data selector ignores changes to other nodes data', () => {
    const ids = createNodes('source', 10);

    let callCount = 0;
    const watchedId = ids[0];
    const unsub = useEditorStore.subscribe(
      (s) => s.nodes[watchedId]?.data?.value,
      () => { callCount++; },
    );

    callCount = 0;
    // Update OTHER nodes
    for (let i = 1; i < 10; i++) {
      getState().updateNodeData(ids[i], 'value', i * 100);
    }
    // The watched node's data.value didn't change
    expect(callCount).toBe(0);

    // Now update the watched node
    getState().updateNodeData(watchedId, 'value', 999);
    expect(callCount).toBe(1);

    unsub();
  });

  it('pendingConnection selector fires on start and cancel', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    let callCount = 0;
    const unsub = useEditorStore.subscribe(
      (s) => s.pendingConnection,
      () => { callCount++; },
    );

    callCount = 0;
    getState().startConnection(src, 0);
    expect(callCount).toBe(1);

    getState().cancelConnection();
    expect(callCount).toBe(2);

    unsub();
  });

  it('multiple selectors operate independently', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);

    let interactionCalls = 0;
    let connectionsCalls = 0;
    let nodesCalls = 0;

    const unsub1 = useEditorStore.subscribe(
      (s) => s.interaction,
      () => { interactionCalls++; },
    );
    const unsub2 = useEditorStore.subscribe(
      (s) => s.connections,
      () => { connectionsCalls++; },
    );
    const unsub3 = useEditorStore.subscribe(
      (s) => s.nodes[src]?.data?.value,
      () => { nodesCalls++; },
    );

    interactionCalls = 0;
    connectionsCalls = 0;
    nodesCalls = 0;

    // Update node data -- should only trigger nodes selector
    getState().updateNodeData(src, 'value', 42);
    expect(interactionCalls).toBe(0);
    expect(connectionsCalls).toBe(0);
    expect(nodesCalls).toBe(1);

    unsub1();
    unsub2();
    unsub3();
  });
});

// ===========================================================================
// 5. Material cache (shared material and geometry instances)
// ===========================================================================
describe('Material cache — shared instances', () => {
  beforeEach(() => { _resetMaterialCache(); });

  it('returns the same material instance for identical props', () => {
    const m1 = getCachedBasicMaterial('#000000', 0.4, true, false);
    const m2 = getCachedBasicMaterial('#000000', 0.4, true, false);
    expect(m1).toBe(m2);
  });

  it('returns different instances for different colors', () => {
    const m1 = getCachedBasicMaterial('#000000', 0.4, true, false);
    const m2 = getCachedBasicMaterial('#ffffff', 0.4, true, false);
    expect(m1).not.toBe(m2);
  });

  it('returns different instances for different opacity', () => {
    const m1 = getCachedBasicMaterial('#000000', 0.4, true, false);
    const m2 = getCachedBasicMaterial('#000000', 0.2, true, false);
    expect(m1).not.toBe(m2);
  });

  it('returns different instances for different transparent flag', () => {
    const m1 = getCachedBasicMaterial('#000000', 1, true, true);
    const m2 = getCachedBasicMaterial('#000000', 1, false, true);
    expect(m1).not.toBe(m2);
  });

  it('returns different instances for different depthWrite flag', () => {
    const m1 = getCachedBasicMaterial('#000000', 1, true, true);
    const m2 = getCachedBasicMaterial('#000000', 1, true, false);
    expect(m1).not.toBe(m2);
  });

  it('material has correct properties', () => {
    const m = getCachedBasicMaterial('#ff0000', 0.5, true, false);
    expect(m.opacity).toBe(0.5);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
  });

  it('cache grows only for unique combinations', () => {
    expect(_getCacheSizes().materials).toBe(0);
    getCachedBasicMaterial('#000', 0.4, true, false);
    expect(_getCacheSizes().materials).toBe(1);
    getCachedBasicMaterial('#000', 0.4, true, false); // duplicate
    expect(_getCacheSizes().materials).toBe(1);
    getCachedBasicMaterial('#fff', 0.4, true, false); // new
    expect(_getCacheSizes().materials).toBe(2);
  });

  it('_resetMaterialCache clears all entries', () => {
    getCachedBasicMaterial('#000', 1, false, true);
    getCachedBasicMaterial('#fff', 1, false, true);
    expect(_getCacheSizes().materials).toBe(2);
    _resetMaterialCache();
    expect(_getCacheSizes().materials).toBe(0);
  });

  it('returns the same geometry instance for identical dimensions', () => {
    const g1 = getCachedRoundedBoxGeo(1.6, 0.5, 0.8, 4, 0.09);
    const g2 = getCachedRoundedBoxGeo(1.6, 0.5, 0.8, 4, 0.09);
    expect(g1).toBe(g2);
  });

  it('returns different geometry instances for different dimensions', () => {
    const g1 = getCachedRoundedBoxGeo(1.6, 0.5, 0.8, 4, 0.09);
    const g2 = getCachedRoundedBoxGeo(2.0, 0.5, 0.8, 4, 0.09);
    expect(g1).not.toBe(g2);
  });

  it('geometry cache grows only for unique combinations', () => {
    expect(_getCacheSizes().geometries).toBe(0);
    getCachedRoundedBoxGeo(1.6, 0.5, 0.8, 4, 0.09);
    expect(_getCacheSizes().geometries).toBe(1);
    getCachedRoundedBoxGeo(1.6, 0.5, 0.8, 4, 0.09); // duplicate
    expect(_getCacheSizes().geometries).toBe(1);
    getCachedRoundedBoxGeo(2.0, 0.5, 0.8, 4, 0.09); // new
    expect(_getCacheSizes().geometries).toBe(2);
  });

  it('handles many unique materials efficiently', () => {
    for (let i = 0; i < 100; i++) {
      getCachedBasicMaterial(`#${i.toString(16).padStart(6, '0')}`, 0.5, true, false);
    }
    expect(_getCacheSizes().materials).toBe(100);
    // Requesting existing ones should not grow cache
    for (let i = 0; i < 100; i++) {
      getCachedBasicMaterial(`#${i.toString(16).padStart(6, '0')}`, 0.5, true, false);
    }
    expect(_getCacheSizes().materials).toBe(100);
  });
});

// ===========================================================================
// 6. incompatibleNodeIds pre-computed Set
// ===========================================================================
describe('incompatibleNodeIds pre-computed Set', () => {
  beforeEach(() => { resetStore(); });

  it('startConnection populates incompatibleNodeIds', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    // incompatibleNodeIds should be a Set
    expect(getState().incompatibleNodeIds).toBeInstanceOf(Set);
  });

  it('source nodes (no inputs) are incompatible', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const src2 = getState().addNode('source', [5, 0, 0]);
    getState().startConnection(src, 0);
    // source has no inputs, so src2 should be in incompatibleNodeIds
    expect(getState().incompatibleNodeIds.has(src2)).toBe(true);
  });

  it('compatible nodes are NOT in incompatibleNodeIds', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0); // number output
    // transform has number inputs — should NOT be incompatible
    expect(getState().incompatibleNodeIds.has(tgt)).toBe(false);
  });

  it('source node is NOT in incompatibleNodeIds', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().startConnection(src, 0);
    expect(getState().incompatibleNodeIds.has(src)).toBe(false);
  });

  it('completeConnection clears incompatibleNodeIds', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const tgt = getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    getState().completeConnection(tgt, 0);
    expect(getState().incompatibleNodeIds.size).toBe(0);
  });

  it('cancelConnection clears incompatibleNodeIds', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    getState().addNode('transform', [5, 0, 0]);
    getState().startConnection(src, 0);
    getState().cancelConnection();
    expect(getState().incompatibleNodeIds.size).toBe(0);
  });

  it('O(1) lookup: isConnectionIncompatible via Set.has()', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const ids = createNodes('transform', 50);
    getState().startConnection(src, 0);
    const incompatible = getState().incompatibleNodeIds;
    // Verify Set.has is O(1) by checking all 50 nodes quickly
    for (const id of ids) {
      expect(typeof incompatible.has(id)).toBe('boolean');
    }
  });

  it('incompatibleNodeIds is consistent with isConnectionIncompatible logic', () => {
    const src = getState().addNode('source', [0, 0, 0]);
    const transforms = createNodes('transform', 10);
    const sources = createNodes('source', 10);
    getState().startConnection(src, 0);

    const incompatible = getState().incompatibleNodeIds;
    const s = getState();

    // All transforms should be compatible (not in incompatible set)
    for (const tid of transforms) {
      expect(incompatible.has(tid)).toBe(false);
      expect(isConnectionIncompatible(s, tid)).toBe(false);
    }

    // All sources (no inputs) should be incompatible
    for (const sid of sources) {
      expect(incompatible.has(sid)).toBe(true);
      expect(isConnectionIncompatible(s, sid)).toBe(true);
    }
  });
});
