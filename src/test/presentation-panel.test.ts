/**
 * Presentation / "mini-app" panel — component tests.
 *
 * The panel hides the wiring and surfaces parameter nodes as form inputs and
 * display/output nodes as live readouts; edits re-execute the graph.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { PresentationPanel } from '../components/ui/PresentationPanel';

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
    graphTabs: { default: { id: 'default', name: 'My Calculator', createdAt: Date.now() } },
    graphOrder: ['default'],
    templates: {},
    storageWarning: null,
  });
}

function getState() {
  return useEditorStore.getState();
}

/** source(5, titled "Amount") → display */
function buildMiniApp() {
  const src = getState().addNode('source', [0, 0, 0]);
  getState().updateNodeData(src, 'value', 5);
  getState().updateNodeTitle(src, 'Amount');
  const disp = getState().addNode('display', [4, 0, 0]);
  getState().addConnection(src, 0, disp, 0);
  return { src, disp };
}

describe('PresentationPanel', () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { cleanup(); });

  it('renders nothing when closed', () => {
    buildMiniApp();
    const { container } = render(createElement(PresentationPanel, { open: false, onClose: () => {} }));
    expect(container.innerHTML).toBe('');
  });

  it('shows the graph name, parameter inputs, and output readouts', () => {
    const { src } = buildMiniApp();
    render(createElement(PresentationPanel, { open: true, onClose: () => {} }));

    expect(screen.getByText('My Calculator')).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();
    // Opening executes the graph, so the display card shows the source value
    expect(getState().nodeOutputs[src][0]).toBe(5);
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('editing a number field updates node data and re-executes after the debounce', () => {
    vi.useFakeTimers();
    try {
      const { src } = buildMiniApp();
      const { container } = render(createElement(PresentationPanel, { open: true, onClose: () => {} }));

      const numberInput = container.querySelector('input[type="number"]')!;
      expect(numberInput).toBeTruthy();
      fireEvent.change(numberInput, { target: { value: '9' } });

      expect(getState().nodes[src].data.value).toBe(9);
      act(() => { vi.advanceTimersByTime(4000); });
      expect(getState().nodeOutputs[src][0]).toBe(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape closes the panel', () => {
    buildMiniApp();
    const onClose = vi.fn();
    render(createElement(PresentationPanel, { open: true, onClose }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows placeholders for graphs without parameters or outputs', () => {
    render(createElement(PresentationPanel, { open: true, onClose: () => {} }));
    expect(screen.getByText(/No parameter nodes/)).toBeTruthy();
    expect(screen.getByText(/No display\/output nodes/)).toBeTruthy();
  });
});
