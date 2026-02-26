import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, _resetModuleState } from './editorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    interaction: 'idle',
    pendingConnection: null,
    nearestSnapPort: null,
    hoveredConnectionId: null,
    snapEnabled: true,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    isExecuting: false,
    executionMetrics: {},
    executionTotalDuration: 0,
    errorStrategy: 'fail-fast',
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: 0 } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
  });
}

/** Creates a source -> transform connection and returns the connection ID. */
function createConnection(): string {
  const srcId = getState().addNode('source', [0, 0, 0]);
  const xfmId = getState().addNode('transform', [5, 0, 0]);
  const connId = getState().addConnection(srcId, 0, xfmId, 0);
  expect(connId).not.toBeNull();
  return connId as string;
}

// ===========================================================================
// updateConnectionLabel
// ===========================================================================
describe('updateConnectionLabel', () => {
  beforeEach(() => resetStore());

  it('sets label on a connection', () => {
    const connId = createConnection();

    getState().updateConnectionLabel(connId, 'Data Flow');

    expect(getState().connections[connId].label).toBe('Data Flow');
  });

  it('removes label when set to undefined', () => {
    const connId = createConnection();

    getState().updateConnectionLabel(connId, 'Temp Label');
    expect(getState().connections[connId].label).toBe('Temp Label');

    getState().updateConnectionLabel(connId, undefined);
    expect(getState().connections[connId].label).toBeUndefined();
    expect('label' in getState().connections[connId]).toBe(false);
  });

  it('no-ops for nonexistent connection', () => {
    createConnection();
    const before = { ...getState().connections };

    getState().updateConnectionLabel('nonexistent-id', 'Ghost');

    // No crash, no state change
    expect(getState().connections).toEqual(before);
  });

  it('pushes undo when setting label', () => {
    const connId = createConnection();

    getState().updateConnectionLabel(connId, 'Data Flow');
    expect(getState().canUndo()).toBe(true);

    // Undo should restore the connection without a label
    getState().undo();
    expect(getState().connections[connId]).toBeDefined();
    expect(getState().connections[connId].label).toBeUndefined();
  });

  it('undo restores previous label', () => {
    const connId = createConnection();

    getState().updateConnectionLabel(connId, 'A');
    expect(getState().connections[connId].label).toBe('A');

    getState().updateConnectionLabel(connId, 'B');
    expect(getState().connections[connId].label).toBe('B');

    getState().undo();
    expect(getState().connections[connId].label).toBe('A');
  });
});

// ===========================================================================
// updateConnectionColor
// ===========================================================================
describe('updateConnectionColor', () => {
  beforeEach(() => resetStore());

  it('sets colorOverride on a connection', () => {
    const connId = createConnection();

    getState().updateConnectionColor(connId, '#ff0000');

    expect(getState().connections[connId].colorOverride).toBe('#ff0000');
  });

  it('removes colorOverride when set to undefined', () => {
    const connId = createConnection();

    getState().updateConnectionColor(connId, '#00ff00');
    expect(getState().connections[connId].colorOverride).toBe('#00ff00');

    getState().updateConnectionColor(connId, undefined);
    expect(getState().connections[connId].colorOverride).toBeUndefined();
    expect('colorOverride' in getState().connections[connId]).toBe(false);
  });

  it('no-ops for nonexistent connection', () => {
    createConnection();
    const before = { ...getState().connections };

    getState().updateConnectionColor('nonexistent-id', '#ff0000');

    expect(getState().connections).toEqual(before);
  });

  it('pushes undo when setting color', () => {
    const connId = createConnection();

    getState().updateConnectionColor(connId, '#ff0000');
    expect(getState().canUndo()).toBe(true);

    // Undo should restore the connection without a colorOverride
    getState().undo();
    expect(getState().connections[connId]).toBeDefined();
    expect(getState().connections[connId].colorOverride).toBeUndefined();
  });
});

// ===========================================================================
// Combined label + color
// ===========================================================================
describe('combined label and color', () => {
  beforeEach(() => resetStore());

  it('can set both label and color on same connection', () => {
    const connId = createConnection();

    getState().updateConnectionLabel(connId, 'Signal');
    getState().updateConnectionColor(connId, '#ff0000');

    const conn = getState().connections[connId];
    expect(conn.label).toBe('Signal');
    expect(conn.colorOverride).toBe('#ff0000');
  });

  it('undo label change does not affect color', () => {
    const connId = createConnection();

    getState().updateConnectionColor(connId, '#0000ff');
    getState().updateConnectionLabel(connId, 'Temporary');

    // Undo the label change
    getState().undo();

    const conn = getState().connections[connId];
    expect(conn.colorOverride).toBe('#0000ff');
    expect(conn.label).toBeUndefined();
  });
});

// ===========================================================================
// Serialization
// ===========================================================================
describe('connection label/color serialization', () => {
  beforeEach(() => resetStore());

  it('label and colorOverride survive JSON round-trip', () => {
    const connId = createConnection();

    getState().updateConnectionLabel(connId, 'Data Flow');
    getState().updateConnectionColor(connId, '#ff6600');

    const original = getState().connections[connId];
    const roundTripped = JSON.parse(JSON.stringify(original));

    expect(roundTripped.label).toBe('Data Flow');
    expect(roundTripped.colorOverride).toBe('#ff6600');
    expect(roundTripped.id).toBe(original.id);
    expect(roundTripped.sourceNodeId).toBe(original.sourceNodeId);
    expect(roundTripped.targetNodeId).toBe(original.targetNodeId);
  });
});
