import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Store mock — must be declared before dynamic import of modules under test
// ---------------------------------------------------------------------------

const mockPushUndoSnapshot = vi.fn();
const mockSetState = vi.fn();

const mockStoreNodes: Record<string, { data: Record<string, unknown> }> = {};

vi.mock('../../store/editorStore', () => ({
  useEditorStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const state = {
        nodes: mockStoreNodes,
        connections: {},
        nodeOutputs: {},
        executionStates: {},
        executionErrors: {},
        pushUndoSnapshot: mockPushUndoSnapshot,
        updateNodeData: vi.fn(),
      };
      return selector(state);
    },
    {
      getState: () => ({
        nodes: mockStoreNodes,
        pushUndoSnapshot: mockPushUndoSnapshot,
        updateNodeData: vi.fn(),
      }),
      setState: mockSetState,
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

// React mock — minimal for non-rendering tests of ScrubLabel logic
const refMap = new Map<unknown, { current: unknown }>();

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: (initial: unknown) => {
      if (!refMap.has(initial)) {
        refMap.set(initial, { current: initial });
      }
      return refMap.get(initial)!;
    },
    useCallback: (fn: (...args: unknown[]) => unknown) => fn,
    useEffect: (fn: () => (() => void) | void) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanup();
    },
    useState: (init: unknown) => [init, vi.fn()],
    memo: (c: unknown) => c,
  };
});

// Import modules under test AFTER mocks are established
const { hexToRgba, pushUndoOnFocus, setDataDirect, ACCENT_HEX, NODE_SCREEN_FIELDS } =
  await import('./NodeScreen');
const { MiniSparkline, ScrubLabel } = await import('./ScreenExtras');

// =========================================================================
// 1. hexToRgba utility
// =========================================================================
describe('hexToRgba', () => {
  it('converts a standard hex color to rgba with alpha=1', () => {
    expect(hexToRgba('#2EC4B6', 1)).toBe('rgba(46, 196, 182, 1)');
  });

  it('handles alpha=0', () => {
    expect(hexToRgba('#FF6B35', 0)).toBe('rgba(255, 107, 53, 0)');
  });

  it('handles fractional alpha', () => {
    expect(hexToRgba('#E8453C', 0.5)).toBe('rgba(232, 69, 60, 0.5)');
  });

  it('converts black #000000 correctly', () => {
    expect(hexToRgba('#000000', 0.8)).toBe('rgba(0, 0, 0, 0.8)');
  });

  it('converts white #FFFFFF correctly', () => {
    expect(hexToRgba('#FFFFFF', 0.4)).toBe('rgba(255, 255, 255, 0.4)');
  });

  it('handles lower-case hex', () => {
    expect(hexToRgba('#aabbcc', 1)).toBe('rgba(170, 187, 204, 1)');
  });

  it('handles mixed-case hex', () => {
    expect(hexToRgba('#AaBbCc', 0.2)).toBe('rgba(170, 187, 204, 0.2)');
  });

  it('preserves precise alpha values', () => {
    const result = hexToRgba('#112233', 0.123);
    expect(result).toBe('rgba(17, 34, 51, 0.123)');
  });
});

// =========================================================================
// 2. ACCENT_HEX map
// =========================================================================
describe('ACCENT_HEX', () => {
  it('contains teal key', () => {
    expect(ACCENT_HEX).toHaveProperty('teal');
  });

  it('contains orange key', () => {
    expect(ACCENT_HEX).toHaveProperty('orange');
  });

  it('contains coral key', () => {
    expect(ACCENT_HEX).toHaveProperty('coral');
  });

  it('contains teal-coral key', () => {
    expect(ACCENT_HEX).toHaveProperty('teal-coral');
  });

  it('all values are valid hex color strings', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const [key, val] of Object.entries(ACCENT_HEX)) {
      expect(val, `ACCENT_HEX["${key}"] should be valid hex`).toMatch(hexPattern);
    }
  });

  it('teal maps to #2EC4B6', () => {
    expect(ACCENT_HEX.teal).toBe('#2EC4B6');
  });

  it('orange maps to #FF6B35', () => {
    expect(ACCENT_HEX.orange).toBe('#FF6B35');
  });
});

// =========================================================================
// 3. NODE_SCREEN_FIELDS definitions
// =========================================================================
describe('NODE_SCREEN_FIELDS', () => {
  const VALID_FIELD_TYPES: readonly string[] = ['number', 'text', 'select', 'color', 'textarea', 'boolean'];

  it('source has value(number) and label(text) fields', () => {
    const fields = NODE_SCREEN_FIELDS.source!;
    expect(fields).toBeDefined();
    const value = fields.find(f => f.key === 'value');
    const label = fields.find(f => f.key === 'label');
    expect(value).toBeDefined();
    expect(value!.type).toBe('number');
    expect(label).toBeDefined();
    expect(label!.type).toBe('text');
  });

  it('transform has multiplier(number) and offset(number)', () => {
    const fields = NODE_SCREEN_FIELDS.transform!;
    expect(fields).toBeDefined();
    const mult = fields.find(f => f.key === 'multiplier');
    const offset = fields.find(f => f.key === 'offset');
    expect(mult).toBeDefined();
    expect(mult!.type).toBe('number');
    expect(offset).toBeDefined();
    expect(offset!.type).toBe('number');
  });

  it('filter has threshold(number) and mode(select with options)', () => {
    const fields = NODE_SCREEN_FIELDS.filter!;
    expect(fields).toBeDefined();
    const thresh = fields.find(f => f.key === 'threshold');
    const mode = fields.find(f => f.key === 'mode');
    expect(thresh).toBeDefined();
    expect(thresh!.type).toBe('number');
    expect(mode).toBeDefined();
    expect(mode!.type).toBe('select');
    expect(mode!.options).toEqual(['greater', 'less', 'equal']);
  });

  it('math has operation(select) with six options', () => {
    const fields = NODE_SCREEN_FIELDS.math!;
    expect(fields).toBeDefined();
    const op = fields.find(f => f.key === 'operation');
    expect(op).toBeDefined();
    expect(op!.type).toBe('select');
    expect(op!.options).toContain('add');
    expect(op!.options).toContain('multiply');
    expect(op!.options).toHaveLength(6);
  });

  it('clamp has min and max (both number)', () => {
    const fields = NODE_SCREEN_FIELDS.clamp!;
    expect(fields).toBeDefined();
    expect(fields.find(f => f.key === 'min')!.type).toBe('number');
    expect(fields.find(f => f.key === 'max')!.type).toBe('number');
  });

  it('note has text(textarea)', () => {
    const fields = NODE_SCREEN_FIELDS.note!;
    expect(fields).toBeDefined();
    const text = fields.find(f => f.key === 'text');
    expect(text).toBeDefined();
    expect(text!.type).toBe('textarea');
  });

  it('all field types across all node types are valid FieldType values', () => {
    for (const [nodeType, fields] of Object.entries(NODE_SCREEN_FIELDS)) {
      if (!fields) continue;
      for (const field of fields) {
        expect(
          VALID_FIELD_TYPES,
          `${nodeType}.${field.key} has invalid type "${field.type}"`,
        ).toContain(field.type);
      }
    }
  });

  it('every field definition has a non-empty key and label', () => {
    for (const [nodeType, fields] of Object.entries(NODE_SCREEN_FIELDS)) {
      if (!fields) continue;
      for (const field of fields) {
        expect(field.key, `${nodeType} field key empty`).toBeTruthy();
        expect(field.label, `${nodeType} field label empty`).toBeTruthy();
      }
    }
  });

  it('select fields always have options array', () => {
    for (const [nodeType, fields] of Object.entries(NODE_SCREEN_FIELDS)) {
      if (!fields) continue;
      for (const field of fields) {
        if (field.type === 'select') {
          expect(
            Array.isArray(field.options),
            `${nodeType}.${field.key}: select field missing options`,
          ).toBe(true);
          expect(
            field.options!.length,
            `${nodeType}.${field.key}: select has 0 options`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});

// =========================================================================
// 4. pushUndoOnFocus behavior
// =========================================================================
describe('pushUndoOnFocus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls pushUndoSnapshot on the store', () => {
    pushUndoOnFocus();
    expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);
  });

  it('calls pushUndoSnapshot with no arguments', () => {
    pushUndoOnFocus();
    expect(mockPushUndoSnapshot).toHaveBeenCalledWith();
  });
});

// =========================================================================
// 5. setDataDirect behavior
// =========================================================================
describe('setDataDirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls useEditorStore.setState with a mutator function', () => {
    setDataDirect('node-1', 'value', 42);
    expect(mockSetState).toHaveBeenCalledTimes(1);
    expect(typeof mockSetState.mock.calls[0][0]).toBe('function');
  });

  it('mutator sets data[key] on the target node', () => {
    setDataDirect('node-1', 'value', 42);
    const mutator = mockSetState.mock.calls[0][0] as (s: typeof mockStoreNodes) => void;
    // Simulate store state
    const fakeState = {
      nodes: {
        'node-1': { data: { value: 0 } },
      },
    };
    mutator(fakeState as unknown as typeof mockStoreNodes);
    expect(fakeState.nodes['node-1'].data.value).toBe(42);
  });

  it('mutator does nothing if node does not exist', () => {
    setDataDirect('nonexistent', 'value', 99);
    const mutator = mockSetState.mock.calls[0][0] as (s: typeof mockStoreNodes) => void;
    const fakeState = { nodes: {} };
    // Should not throw
    expect(() => mutator(fakeState as unknown as typeof mockStoreNodes)).not.toThrow();
  });

  it('does NOT call pushUndoSnapshot', () => {
    setDataDirect('node-1', 'value', 1);
    expect(mockPushUndoSnapshot).not.toHaveBeenCalled();
  });

  it('can set string values', () => {
    setDataDirect('node-2', 'label', 'hello');
    const mutator = mockSetState.mock.calls[0][0] as (s: any) => void;
    const fakeState = {
      nodes: { 'node-2': { data: { label: '' } } },
    };
    mutator(fakeState);
    expect(fakeState.nodes['node-2'].data.label).toBe('hello');
  });

  it('can set boolean values', () => {
    setDataDirect('node-3', 'flag', true);
    const mutator = mockSetState.mock.calls[0][0] as (s: any) => void;
    const fakeState = {
      nodes: { 'node-3': { data: { flag: false } } },
    };
    mutator(fakeState);
    expect(fakeState.nodes['node-3'].data.flag).toBe(true);
  });
});

// =========================================================================
// 6. ScrubLabel unit tests (logic via simulated pointer events)
// =========================================================================
describe('ScrubLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refMap.clear();
  });

  // Helper: call ScrubLabel to get the rendered props (it returns a React element)
  function getScrubHandlers(props?: Partial<{
    nodeId: string;
    fieldKey: string;
    value: number;
    accentHex: string;
  }>) {
    const result = ScrubLabel({
      nodeId: props?.nodeId ?? 'n1',
      fieldKey: props?.fieldKey ?? 'value',
      value: props?.value ?? 10,
      accentHex: props?.accentHex ?? '#2EC4B6',
      children: 'Label',
    });
    // result is a React element (span) with event handler props
    return result.props as {
      onPointerDown: (e: any) => void;
      onPointerMove: (e: any) => void;
      onPointerUp: (e: any) => void;
      onPointerCancel: (e: any) => void;
      style: Record<string, unknown>;
    };
  }

  function makePointerEvent(overrides: Record<string, unknown> = {}) {
    return {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 100,
      pointerId: 1,
      shiftKey: false,
      target: {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      },
      ...overrides,
    };
  }

  it('pointer down captures pointer and records start state', () => {
    const h = getScrubHandlers({ value: 5 });
    const evt = makePointerEvent({ clientX: 200 });
    h.onPointerDown(evt);

    expect(evt.preventDefault).toHaveBeenCalled();
    expect(evt.stopPropagation).toHaveBeenCalled();
    expect(evt.target.setPointerCapture).toHaveBeenCalledWith(1);
  });

  it('pointer move without prior pointer down does nothing', () => {
    const h = getScrubHandlers();
    const evt = makePointerEvent({ clientX: 200 });
    // No pointerDown first
    h.onPointerMove(evt);

    // Should not call pushUndoSnapshot or setDataDirect
    expect(mockPushUndoSnapshot).not.toHaveBeenCalled();
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it('pointer move calculates delta with default sensitivity (0.1)', () => {
    const h = getScrubHandlers({ value: 10 });
    const downEvt = makePointerEvent({ clientX: 100 });
    h.onPointerDown(downEvt);

    vi.clearAllMocks();

    const moveEvt = makePointerEvent({ clientX: 150, shiftKey: false });
    h.onPointerMove(moveEvt);

    // delta = (150 - 100) * 0.1 = 5, new value = 10 + 5 = 15
    expect(mockSetState).toHaveBeenCalledTimes(1);
    const mutator = mockSetState.mock.calls[0][0] as (s: any) => void;
    const fakeState = { nodes: { n1: { data: { value: 0 } } } };
    mutator(fakeState);
    expect(fakeState.nodes.n1.data.value).toBe(15);
  });

  it('shift key reduces sensitivity to 0.01', () => {
    const h = getScrubHandlers({ value: 10 });
    const downEvt = makePointerEvent({ clientX: 100 });
    h.onPointerDown(downEvt);

    vi.clearAllMocks();

    const moveEvt = makePointerEvent({ clientX: 200, shiftKey: true });
    h.onPointerMove(moveEvt);

    // delta = (200 - 100) * 0.01 = 1, new value = 10 + 1 = 11
    const mutator = mockSetState.mock.calls[0][0] as (s: any) => void;
    const fakeState = { nodes: { n1: { data: { value: 0 } } } };
    mutator(fakeState);
    expect(fakeState.nodes.n1.data.value).toBe(11);
  });

  it('undo is pushed only once per scrub session (first move)', () => {
    const h = getScrubHandlers({ value: 10 });
    const downEvt = makePointerEvent({ clientX: 100 });
    h.onPointerDown(downEvt);

    vi.clearAllMocks();

    // First move pushes undo
    h.onPointerMove(makePointerEvent({ clientX: 110 }));
    expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);

    // Second move does NOT push undo again
    h.onPointerMove(makePointerEvent({ clientX: 120 }));
    expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);

    // Third move still no extra undo
    h.onPointerMove(makePointerEvent({ clientX: 130 }));
    expect(mockPushUndoSnapshot).toHaveBeenCalledTimes(1);
  });

  it('pointer up releases capture and clears scrub state', () => {
    const h = getScrubHandlers({ value: 10 });
    const target = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };
    const downEvt = makePointerEvent({ clientX: 100, target });
    h.onPointerDown(downEvt);

    const upEvt = makePointerEvent({ clientX: 150, target });
    h.onPointerUp(upEvt);

    expect(target.releasePointerCapture).toHaveBeenCalledWith(1);

    // After up, pointer move should do nothing
    vi.clearAllMocks();
    h.onPointerMove(makePointerEvent({ clientX: 200 }));
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it('pointer cancel handles same cleanup as pointer up', () => {
    const h = getScrubHandlers({ value: 10 });
    const target = {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    };
    const downEvt = makePointerEvent({ clientX: 100, target });
    h.onPointerDown(downEvt);

    const cancelEvt = makePointerEvent({ clientX: 100, target });
    h.onPointerCancel(cancelEvt);

    expect(target.releasePointerCapture).toHaveBeenCalledWith(1);

    // After cancel, pointer move should do nothing
    vi.clearAllMocks();
    h.onPointerMove(makePointerEvent({ clientX: 200 }));
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it('pointer up without prior down does not throw', () => {
    const h = getScrubHandlers();
    const upEvt = makePointerEvent();
    expect(() => h.onPointerUp(upEvt)).not.toThrow();
  });

  it('pointer cancel without prior down does not throw', () => {
    const h = getScrubHandlers();
    const cancelEvt = makePointerEvent();
    expect(() => h.onPointerCancel(cancelEvt)).not.toThrow();
  });

  it('renders with ew-resize cursor style', () => {
    const h = getScrubHandlers();
    expect(h.style.cursor).toBe('ew-resize');
  });

  it('negative delta decreases value', () => {
    const h = getScrubHandlers({ value: 20 });
    const downEvt = makePointerEvent({ clientX: 200 });
    h.onPointerDown(downEvt);

    vi.clearAllMocks();

    // Move left: delta = (100 - 200) * 0.1 = -10, new value = 20 - 10 = 10
    h.onPointerMove(makePointerEvent({ clientX: 100 }));
    const mutator = mockSetState.mock.calls[0][0] as (s: any) => void;
    const fakeState = { nodes: { n1: { data: { value: 0 } } } };
    mutator(fakeState);
    expect(fakeState.nodes.n1.data.value).toBe(10);
  });

  it('uses correct nodeId and fieldKey when setting data', () => {
    const h = getScrubHandlers({ nodeId: 'myNode', fieldKey: 'offset', value: 5 });
    const downEvt = makePointerEvent({ clientX: 100 });
    h.onPointerDown(downEvt);

    vi.clearAllMocks();

    h.onPointerMove(makePointerEvent({ clientX: 110 }));
    const mutator = mockSetState.mock.calls[0][0] as (s: any) => void;
    const fakeState = { nodes: { myNode: { data: { offset: 0 } } } };
    mutator(fakeState);
    // delta = (110 - 100) * 0.1 = 1, new = 5 + 1 = 6
    expect(fakeState.nodes.myNode.data.offset).toBe(6);
  });
});

// =========================================================================
// 7. MiniSparkline logic validation
// =========================================================================
describe('MiniSparkline', () => {
  it('returns null when data has fewer than 2 points', () => {
    expect(MiniSparkline({ data: [], color: '#fff' })).toBeNull();
    expect(MiniSparkline({ data: [5], color: '#fff' })).toBeNull();
  });

  it('returns a valid SVG element for 2+ data points', () => {
    const result = MiniSparkline({ data: [0, 10], color: '#2EC4B6' });
    expect(result).not.toBeNull();
    // It's a React element representing an SVG
    expect(result!.type).toBe('svg');
  });

  it('SVG has correct width and height', () => {
    const result = MiniSparkline({ data: [0, 5, 10], color: '#fff' });
    expect(result!.props.width).toBe(80);
    expect(result!.props.height).toBe(16);
  });

  it('polyline points string contains correct number of coordinate pairs', () => {
    const data = [1, 2, 3, 4, 5];
    const result = MiniSparkline({ data, color: '#fff' });
    // The polyline is the child of the svg
    const polyline = result!.props.children;
    const points: string = polyline.props.points;
    const pairs = points.split(' ');
    expect(pairs).toHaveLength(data.length);
  });

  it('handles flat data (all same values) without division by zero', () => {
    const result = MiniSparkline({ data: [5, 5, 5], color: '#fff' });
    expect(result).not.toBeNull();
    // Should not throw or produce NaN
    const polyline = result!.props.children;
    const points: string = polyline.props.points;
    expect(points).not.toContain('NaN');
  });

  it('passes color to polyline stroke', () => {
    const result = MiniSparkline({ data: [0, 10], color: '#FF6B35' });
    const polyline = result!.props.children;
    expect(polyline.props.stroke).toBe('#FF6B35');
  });
});
