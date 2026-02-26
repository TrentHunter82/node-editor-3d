import { describe, it, expect, beforeEach } from 'vitest';
import { NODE_TYPE_CONFIG } from './index';
import type { PortConfig, EditorNode } from './index';
import { useEditorStore, _resetModuleState } from '../store/editorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function setState(partial: Record<string, unknown>) {
  useEditorStore.setState((s: Record<string, unknown>) => { Object.assign(s, partial); });
}

function resetStore() {
  _resetModuleState();
  setState({
    nodes: {},
    connections: {},
    groups: {},
    selectedIds: new Set<string>(),
    interaction: 'idle' as const,
    pendingConnection: null,
    contextMenu: null,
    snapEnabled: false,
    isExecuting: false,
    executionStates: {},
    nodeOutputs: {},
    executionErrors: {},
    executionMetrics: {},
    executionTotalDuration: 0,
    validationErrors: {},
    customNodeDefs: {},
    subgraphDefs: {},
    graphTabs: { default: { id: 'default', name: 'Main', createdAt: Date.now() } },
    activeGraphId: 'default',
    graphOrder: ['default'],
    breadcrumbStack: [],
    templates: {},
  });
}

// ---------------------------------------------------------------------------
// NODE_TYPE_CONFIG port descriptions
// ---------------------------------------------------------------------------

describe('Port Metadata', () => {
  describe('NODE_TYPE_CONFIG port descriptions', () => {
    it('all source ports have descriptions', () => {
      const cfg = NODE_TYPE_CONFIG['source'];
      for (const port of cfg.outputs) {
        expect(port.description).toBeDefined();
        expect(typeof port.description).toBe('string');
        expect(port.description!.length).toBeGreaterThan(0);
      }
    });

    it('all transform ports have descriptions', () => {
      const cfg = NODE_TYPE_CONFIG['transform'];
      for (const port of [...cfg.inputs, ...cfg.outputs]) {
        expect(port.description).toBeDefined();
        expect(typeof port.description).toBe('string');
        expect(port.description!.length).toBeGreaterThan(0);
      }
    });

    it('every port in NODE_TYPE_CONFIG has a description', () => {
      const missing: string[] = [];

      for (const [nodeType, config] of Object.entries(NODE_TYPE_CONFIG)) {
        for (const [side, ports] of [['input', config.inputs], ['output', config.outputs]] as const) {
          for (let i = 0; i < ports.length; i++) {
            const port = ports[i];
            if (!port.description || typeof port.description !== 'string' || port.description.length === 0) {
              missing.push(`${nodeType}.${side}[${i}] (${port.label})`);
            }
          }
        }
      }

      expect(missing, `Ports missing descriptions:\n  ${missing.join('\n  ')}`).toHaveLength(0);
    });

    it('source output[0] has defaultValue of 0', () => {
      const port = NODE_TYPE_CONFIG['source'].outputs[0];
      expect(port.defaultValue).toBe(0);
    });

    it('transform factor input has defaultValue of 1', () => {
      const port = NODE_TYPE_CONFIG['transform'].inputs[1];
      expect(port.label).toBe('factor');
      expect(port.defaultValue).toBe(1);
    });

    it('math inputs have defaultValue of 0', () => {
      const inputs = NODE_TYPE_CONFIG['math'].inputs;
      expect(inputs[0].defaultValue).toBe(0);
      expect(inputs[1].defaultValue).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PortConfig shape validation
  // ---------------------------------------------------------------------------

  describe('PortConfig shape validation', () => {
    it('PortConfig fields are correct types', () => {
      // Check that descriptions are strings where present
      for (const config of Object.values(NODE_TYPE_CONFIG)) {
        const allPorts: PortConfig[] = [...config.inputs, ...config.outputs];
        for (const port of allPorts) {
          if (port.description !== undefined) {
            expect(typeof port.description).toBe('string');
          }
          if (port.defaultValue !== undefined) {
            // defaultValue can be any type but it should exist
            expect(port).toHaveProperty('defaultValue');
          }
          if (port.min !== undefined) {
            expect(typeof port.min).toBe('number');
          }
          if (port.max !== undefined) {
            expect(typeof port.max).toBe('number');
          }
        }
      }

      // Verify specific expected defaultValues exist
      expect(NODE_TYPE_CONFIG['source'].outputs[0].defaultValue).toBeDefined();
      expect(NODE_TYPE_CONFIG['transform'].inputs[0].defaultValue).toBeDefined();
      expect(NODE_TYPE_CONFIG['transform'].inputs[1].defaultValue).toBeDefined();
    });

    it('clamp node has min/max metadata on inputs', () => {
      const clampInputs = NODE_TYPE_CONFIG['clamp'].inputs;

      // clamp min input has min: -Infinity
      const minInput = clampInputs.find(p => p.label === 'min');
      expect(minInput).toBeDefined();
      expect(minInput!.min).toBe(-Infinity);

      // clamp max input has max: Infinity
      const maxInput = clampInputs.find(p => p.label === 'max');
      expect(maxInput).toBeDefined();
      expect(maxInput!.max).toBe(Infinity);
    });
  });

  // ---------------------------------------------------------------------------
  // Metadata survival through node creation
  // ---------------------------------------------------------------------------

  describe('metadata survival through node creation', () => {
    beforeEach(() => {
      resetStore();
      localStorage.clear();
    });

    it('nodes created via addNode have port descriptions', () => {
      const id = getState().addNode('source');
      const node = getState().nodes[id];

      expect(node.outputs.length).toBeGreaterThan(0);
      expect(node.outputs[0].description).toBeDefined();
      expect(typeof node.outputs[0].description).toBe('string');
      expect(node.outputs[0].description!.length).toBeGreaterThan(0);
    });

    it('nodes created via addNode have port defaultValues', () => {
      const id = getState().addNode('source');
      const node = getState().nodes[id];

      expect(node.outputs[0].defaultValue).toBe(0);
    });

    it('duplicate preserves port metadata', () => {
      const id = getState().addNode('source');

      // Select and duplicate
      setState({ selectedIds: new Set([id]) });
      getState().duplicateSelected();

      // Find the duplicated node (the one that is not the original)
      const allNodes = Object.values(getState().nodes) as EditorNode[];
      const duplicate = allNodes.find(n => n.id !== id);
      expect(duplicate).toBeDefined();

      // Verify descriptions survived duplication
      expect(duplicate!.outputs[0].description).toBe(
        NODE_TYPE_CONFIG['source'].outputs[0].description
      );
      expect(duplicate!.outputs[0].defaultValue).toBe(0);
    });

    it('port metadata survives JSON round-trip (paste/template)', () => {
      const id = getState().addNode('transform');
      const node = getState().nodes[id];

      // Simulate a JSON round-trip (as happens with paste or template instantiation)
      const roundTripped = JSON.parse(JSON.stringify(node));

      // Verify all metadata fields survive
      for (let i = 0; i < node.inputs.length; i++) {
        const original = node.inputs[i];
        const restored = roundTripped.inputs[i];

        expect(restored.description).toBe(original.description);
        if (original.defaultValue !== undefined) {
          expect(restored.defaultValue).toBe(original.defaultValue);
        }
        if (original.min !== undefined) {
          expect(restored.min).toBe(original.min);
        }
        if (original.max !== undefined) {
          expect(restored.max).toBe(original.max);
        }
      }

      for (let i = 0; i < node.outputs.length; i++) {
        const original = node.outputs[i];
        const restored = roundTripped.outputs[i];

        expect(restored.description).toBe(original.description);
      }
    });
  });
});
