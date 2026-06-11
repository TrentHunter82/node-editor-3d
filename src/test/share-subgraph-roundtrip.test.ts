/**
 * Share links for subgraph-containing graphs.
 *
 * The share payload bundles subgraph internals (recursively) via
 * collectInnerGraphsForExport, and importWorkflow restores them with
 * remapped graph ids so foreign ids can never clobber other graphs in
 * the importing workspace (same model as clipboard paste).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { encodeGraphToShareParam, decodeShareParam } from '../utils/shareUrl';
import type { LegacyGraphData } from '../utils/serialization';

function resetStore() {
  _resetModuleState();
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
    subgraphDefs: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    showValuePreviews: false,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
    breadcrumbStack: [],
    activeGraphId: 'default',
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    graphOrder: ['default'],
    templates: {},
    storageWarning: null,
  });
}

function getState() {
  return useEditorStore.getState();
}

/** source(42) → [subgraph "Outer"] → output, built through the real actions. */
function buildSubgraphGraph() {
  const src = getState().addNode('source', [0, 0, 0]);
  getState().updateNodeData(src, 'value', 42);
  const out = getState().addNode('output', [5, 0, 0]);
  getState().addConnection(src, 0, out, 0);
  getState().setSelection(new Set([src]));
  const sgId = getState().convertSelectionToSubgraph('Outer')!;
  return { sgId, out };
}

/** Same as above, but the source inside "Outer" is wrapped again into "Nested". */
function buildNestedSubgraphGraph() {
  const { sgId, out } = buildSubgraphGraph();
  getState().enterSubgraph(sgId);
  const innerSrc = Object.values(getState().nodes).find(n => n.type === 'source')!;
  getState().setSelection(new Set([innerSrc.id]));
  const nestedId = getState().convertSelectionToSubgraph('Nested')!;
  getState().exitSubgraph();
  return { sgId, nestedId, out };
}

/** Build the exact payload the Share button puts in the URL (JSON round-tripped). */
function buildSharePayload(): LegacyGraphData {
  const s = getState();
  const { innerGraphs, innerGraphTabs } = s.collectInnerGraphsForExport();
  return JSON.parse(JSON.stringify({
    nodes: s.nodes,
    connections: s.connections,
    groups: s.groups,
    customNodeDefs: s.customNodeDefs,
    ...(Object.keys(s.subgraphDefs).length > 0 ? { subgraphDefs: s.subgraphDefs } : {}),
    ...(Object.keys(innerGraphs).length > 0 ? { innerGraphs, innerGraphTabs } : {}),
  }));
}

describe('collectInnerGraphsForExport', () => {
  beforeEach(() => { resetStore(); });

  it('bundles the inner graph of a subgraph node', () => {
    const { sgId } = buildSubgraphGraph();
    const innerGraphId = getState().subgraphDefs[sgId].innerGraphId;
    const { innerGraphs, innerGraphTabs } = getState().collectInnerGraphsForExport();
    expect(Object.keys(innerGraphs)).toEqual([innerGraphId]);
    expect(innerGraphTabs[innerGraphId]?.name).toBe('Outer');
    // The bundled graph holds the converted source node
    const types = Object.values(innerGraphs[innerGraphId].nodes).map(n => n.type);
    expect(types).toContain('source');
    expect(types).toContain('subgraph-output');
  });

  it('bundles nested subgraph inner graphs recursively', () => {
    const { sgId } = buildNestedSubgraphGraph();
    const outerInnerId = getState().subgraphDefs[sgId].innerGraphId;
    const { innerGraphs } = getState().collectInnerGraphsForExport();
    expect(innerGraphs[outerInnerId]).toBeDefined();
    // The nested subgraph node lives inside the outer inner graph
    const nestedNode = Object.values(innerGraphs[outerInnerId].nodes).find(n => n.type === 'subgraph');
    expect(nestedNode).toBeDefined();
    const nestedInnerId = nestedNode!.data.innerGraphId as string;
    expect(innerGraphs[nestedInnerId]).toBeDefined();
    expect(Object.keys(innerGraphs).length).toBe(2);
  });

  it('returns empty bundles for graphs without subgraphs', () => {
    getState().addNode('source', [0, 0, 0]);
    const { innerGraphs, innerGraphTabs } = getState().collectInnerGraphsForExport();
    expect(Object.keys(innerGraphs).length).toBe(0);
    expect(Object.keys(innerGraphTabs).length).toBe(0);
  });
});

describe('share URL codec with inner graphs', () => {
  beforeEach(() => { resetStore(); });

  it('round-trips innerGraphs and innerGraphTabs losslessly', async () => {
    buildSubgraphGraph();
    const payload = buildSharePayload();
    const decoded = await decodeShareParam(await encodeGraphToShareParam(payload));
    expect(decoded).not.toBeNull();
    expect(decoded!.innerGraphs).toEqual(payload.innerGraphs);
    expect(decoded!.innerGraphTabs).toEqual(payload.innerGraphTabs);
    expect(decoded!.subgraphDefs).toEqual(payload.subgraphDefs);
  });

  it('rejects payloads with malformed innerGraphs', async () => {
    const bogus = (obj: unknown) => {
      const b64 = btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return decodeShareParam(`0.${b64}`);
    };
    expect(await bogus({ nodes: {}, connections: {}, innerGraphs: 'nope' })).toBeNull();
    expect(await bogus({ nodes: {}, connections: {}, innerGraphs: { g: 'nope' } })).toBeNull();
    expect(await bogus({ nodes: {}, connections: {}, innerGraphs: { g: { nodes: {} } } })).toBeNull();
    expect(await bogus({ nodes: {}, connections: {}, innerGraphs: { g: { nodes: {}, connections: {} } } })).not.toBeNull();
  });
});

describe('importWorkflow with bundled inner graphs', () => {
  beforeEach(() => { resetStore(); });

  it('restores subgraph internals into a fresh workspace', () => {
    buildSubgraphGraph();
    const payload = buildSharePayload();

    resetStore();
    getState().importWorkflow(payload);

    const sgNode = Object.values(getState().nodes).find(n => n.type === 'subgraph')!;
    expect(sgNode).toBeDefined();
    const def = getState().subgraphDefs[sgNode.data.subgraphDefId as string];
    expect(def).toBeDefined();
    // def and node agree on the (remapped) inner graph id, and a tab exists for it
    expect(def.innerGraphId).toBe(sgNode.data.innerGraphId);
    expect(getState().graphTabs[def.innerGraphId]).toBeDefined();

    // Entering the subgraph reveals the bundled internals
    getState().enterSubgraph(sgNode.id);
    const innerTypes = Object.values(getState().nodes).map(n => n.type);
    expect(innerTypes).toContain('source');
    expect(innerTypes).toContain('subgraph-output');
    getState().exitSubgraph();
    expect(getState().nodes[sgNode.id]).toBeDefined();
  });

  it('executes the imported subgraph end-to-end', () => {
    buildSubgraphGraph();
    const payload = buildSharePayload();

    resetStore();
    getState().importWorkflow(payload);
    getState().executeGraph();

    expect(Object.keys(getState().executionErrors)).toEqual([]);
    const sgNode = Object.values(getState().nodes).find(n => n.type === 'subgraph')!;
    expect(getState().nodeOutputs[sgNode.id][0]).toBe(42);
  });

  it('restores nested subgraphs recursively', () => {
    buildNestedSubgraphGraph();
    const payload = buildSharePayload();

    resetStore();
    getState().importWorkflow(payload);

    const sgNode = Object.values(getState().nodes).find(n => n.type === 'subgraph')!;
    getState().enterSubgraph(sgNode.id);
    const nested = Object.values(getState().nodes).find(n => n.type === 'subgraph')!;
    expect(nested).toBeDefined();
    expect(nested.title).toBe('Nested');
    getState().enterSubgraph(nested.id);
    expect(Object.values(getState().nodes).some(n => n.type === 'source')).toBe(true);
    getState().exitSubgraph();
    getState().exitSubgraph();

    // Nested execution still works
    getState().executeGraph();
    expect(Object.keys(getState().executionErrors)).toEqual([]);
    expect(getState().nodeOutputs[sgNode.id][0]).toBe(42);
  });

  it('remaps graph ids so imports cannot clobber existing workspace graphs', () => {
    const { sgId } = buildSubgraphGraph();
    const originalInnerId = getState().subgraphDefs[sgId].innerGraphId;
    const payload = buildSharePayload();

    // Import into a SECOND tab of the SAME workspace — the bundled ids
    // collide with the live originals and must be remapped.
    const newTabId = getState().createGraph('Import target');
    getState().switchGraph(newTabId);
    getState().importWorkflow(payload);

    const importedSg = Object.values(getState().nodes).find(n => n.type === 'subgraph')!;
    const importedInnerId = importedSg.data.innerGraphId as string;
    expect(importedInnerId).not.toBe(originalInnerId);
    // Original tab entry survives untouched
    expect(getState().graphTabs[originalInnerId]).toBeDefined();
    expect(getState().graphTabs[importedInnerId]).toBeDefined();

    // Mutating the imported copy must not affect the original
    getState().enterSubgraph(importedSg.id);
    const importedSrc = Object.values(getState().nodes).find(n => n.type === 'source')!;
    getState().updateNodeData(importedSrc.id, 'value', 99);
    getState().exitSubgraph();

    getState().switchGraph('default');
    expect(getState().nodes[sgId]).toBeDefined();
    getState().enterSubgraph(sgId);
    const originalSrc = Object.values(getState().nodes).find(n => n.type === 'source')!;
    expect(originalSrc.data.value).toBe(42);
  });

  it('keeps legacy payloads without innerGraphs importable', () => {
    getState().addNode('source', [0, 0, 0]);
    const payload = buildSharePayload();
    expect(payload.innerGraphs).toBeUndefined();

    resetStore();
    getState().importWorkflow(payload);
    expect(Object.values(getState().nodes).some(n => n.type === 'source')).toBe(true);
  });

  it('imported subgraph internals survive an undo/redo cycle', () => {
    buildSubgraphGraph();
    const payload = buildSharePayload();

    resetStore();
    getState().addNode('note', [0, 0, 0]);
    getState().importWorkflow(payload);
    const sgNode = Object.values(getState().nodes).find(n => n.type === 'subgraph')!;

    getState().undo();
    expect(Object.values(getState().nodes).some(n => n.type === 'subgraph')).toBe(false);
    expect(Object.values(getState().nodes).some(n => n.type === 'note')).toBe(true);

    getState().redo();
    expect(getState().nodes[sgNode.id]).toBeDefined();
    // Inner graph data was restored along with the redo (createdInactiveGraphs)
    getState().enterSubgraph(sgNode.id);
    expect(Object.values(getState().nodes).some(n => n.type === 'source')).toBe(true);
    getState().exitSubgraph();
  });
});
