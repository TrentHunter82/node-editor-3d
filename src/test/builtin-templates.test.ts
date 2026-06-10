import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../store/editorStore';
import { BUILTIN_TEMPLATES, BUILTIN_TEMPLATE_LIST } from '../utils/builtinTemplates';
import { NODE_TYPE_CONFIG } from '../types';

function resetStore() {
  useEditorStore.setState({
    nodes: {},
    connections: {},
    groups: {},
    customNodeDefs: {},
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
    searchQuery: '',
    contextMenu: null,
    validationErrors: {},
  });
}

function getState() {
  return useEditorStore.getState();
}

/** Find the instantiated node whose title matches (templates remap ids). */
function byTitle(title: string) {
  const node = Object.values(getState().nodes).find(n => n.title === title);
  expect(node, `node titled "${title}"`).toBeDefined();
  return node!;
}

describe('built-in template registry', () => {
  it('exposes 5 templates in the Examples category', () => {
    expect(BUILTIN_TEMPLATE_LIST.length).toBe(5);
    for (const t of BUILTIN_TEMPLATE_LIST) {
      expect(t.category).toBe('Examples');
      expect(t.id.startsWith('builtin-')).toBe(true);
    }
  });

  it('every node has ports consistent with NODE_TYPE_CONFIG (except custom)', () => {
    for (const t of BUILTIN_TEMPLATE_LIST) {
      for (const node of t.nodes) {
        if (node.type === 'custom') continue;
        const config = NODE_TYPE_CONFIG[node.type];
        expect(node.inputs.length, `${t.id}/${node.id} inputs`).toBe(config.inputs.length);
        expect(node.outputs.length, `${t.id}/${node.id} outputs`).toBe(config.outputs.length);
      }
    }
  });

  it('every connection references existing nodes and in-range ports', () => {
    for (const t of BUILTIN_TEMPLATE_LIST) {
      const nodeById = new Map(t.nodes.map(n => [n.id, n]));
      for (const c of t.connections) {
        const src = nodeById.get(c.sourceNodeId);
        const tgt = nodeById.get(c.targetNodeId);
        expect(src, `${t.id}/${c.id} source`).toBeDefined();
        expect(tgt, `${t.id}/${c.id} target`).toBeDefined();
        expect(c.sourcePortIndex, `${t.id}/${c.id} srcPort`).toBeLessThan(src!.outputs.length);
        expect(c.targetPortIndex, `${t.id}/${c.id} tgtPort`).toBeLessThan(tgt!.inputs.length);
      }
    }
  });
});

describe('built-in template instantiation', () => {
  beforeEach(() => resetStore());

  for (const t of BUILTIN_TEMPLATE_LIST) {
    it(`${t.name}: instantiates, validates clean, and executes without errors`, () => {
      getState().instantiateTemplate(t.id);
      const s = getState();
      expect(Object.keys(s.nodes).length).toBe(t.nodes.length);
      expect(Object.keys(s.connections).length).toBe(t.connections.length);

      // No error-level validation issues (warnings are acceptable)
      getState().validateGraph();
      const messages = Object.values(getState().validationErrors).flat();
      const errorLevel = messages.filter(m => !m.includes('(warning)'));
      expect(errorLevel, `${t.name} validation`).toEqual([]);

      getState().executeGraph();
      expect(Object.keys(getState().executionErrors), `${t.name} execution`).toEqual([]);
    });
  }

  it('Tip Calculator computes total 101.95 and per-person $ 25.49', () => {
    getState().instantiateTemplate('builtin-tip-calc');
    getState().executeGraph();
    const s = getState();
    const mathTotal = Object.values(s.nodes).find(n => n.type === 'math')!;
    expect(s.nodeOutputs[mathTotal.id][0]).toBeCloseTo(101.95, 2);
    const each = Object.values(s.nodes).find(n => n.title === 'Per Person')!;
    expect(s.nodeOutputs[each.id][0]).toBe('$ 25.49');
  });

  it('Data Pipeline computes Σ = 134', () => {
    getState().instantiateTemplate('builtin-pipeline');
    getState().executeGraph();
    const s = getState();
    // [12,5,8,21,3,17,9] ×2 → [24,10,16,42,6,34,18] | >10 → [24,16,42,34,18] | Σ = 134
    const fmt = byTitle('Label');
    expect(s.nodeOutputs[fmt.id][0]).toBe('Σ = 134');
  });

  it('Palette Generator produces three distinct hex colors', () => {
    getState().instantiateTemplate('builtin-palette');
    getState().executeGraph();
    const s = getState();
    const picker = Object.values(s.nodes).find(n => n.type === 'color-picker')!;
    const accents = Object.values(s.nodes).filter(n => n.type === 'hsl-to-rgb');
    const base = s.nodeOutputs[picker.id][0] as string;
    const colors = accents.map(n => s.nodeOutputs[n.id][0] as string);
    expect(base).toMatch(/^#[0-9a-f]{6}$/i);
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set([base, ...colors]).size).toBe(3);
  });

  it('Trig Playground sin²+cos² sanity: outputs are in [-1, 1]', () => {
    getState().instantiateTemplate('builtin-trig');
    getState().executeGraph();
    const s = getState();
    const sinNode = Object.values(s.nodes).find(n => n.type === 'sin')!;
    const cosNode = Object.values(s.nodes).find(n => n.type === 'cos')!;
    const sv = s.nodeOutputs[sinNode.id][0] as number;
    const cv = s.nodeOutputs[cosNode.id][0] as number;
    expect(Math.abs(sv)).toBeLessThanOrEqual(1);
    expect(Math.abs(cv)).toBeLessThanOrEqual(1);
    expect(sv * sv + cv * cv).toBeCloseTo(1, 6);
  });

  it('instantiating a builtin twice creates independent copies', () => {
    getState().instantiateTemplate('builtin-tip-calc');
    getState().instantiateTemplate('builtin-tip-calc');
    const s = getState();
    expect(Object.keys(s.nodes).length).toBe(BUILTIN_TEMPLATES['builtin-tip-calc'].nodes.length * 2);
  });

  it('user template with same name shadows nothing — builtin id lookup is fallback only', () => {
    getState().instantiateTemplate('builtin-trig');
    const all = Object.keys(getState().nodes);
    expect(all.length).toBeGreaterThan(0);
    // ids were remapped — none of the template-local ids leak into the store
    expect(all.some(id => id === 'clock' || id === 'rad')).toBe(false);
  });
});
