import type { Connection, EditorNode, NodeTemplate, NodeType, PortDef } from '../types';
import { NODE_TYPE_CONFIG } from '../types';

/**
 * Built-in example templates ("Examples" category in the Template Library).
 *
 * These are not stored in the editor store — `instantiateTemplate` falls back
 * to this registry when an id isn't found among user templates, and the
 * TemplateLibrary always lists them (without delete buttons). Every template
 * is fully wired: no unconnected default-less inputs, so instantiating one
 * never produces error-level validation badges.
 *
 * Conventions used here:
 *  - String constants enter graphs through a `source` node's label output
 *    (output 1 = `data.label ?? title`).
 *  - `custom` nodes carry `expression`/`inputCount`/`outputCount` in data and
 *    hand-built `in-N`/`out-N` ports (same shape `updateCustomNodePorts` makes).
 */

function portsFromConfig(prefix: 'in' | 'out', configs: { label: string; portType: PortDef['portType']; description?: string; defaultValue?: unknown; min?: number; max?: number }[]): PortDef[] {
  return configs.map((cfg, i) => ({
    id: `${prefix}-${i}`,
    label: cfg.label,
    portType: cfg.portType,
    ...(cfg.description !== undefined && { description: cfg.description }),
    ...(cfg.defaultValue !== undefined && { defaultValue: cfg.defaultValue }),
    ...(cfg.min !== undefined && { min: cfg.min }),
    ...(cfg.max !== undefined && { max: cfg.max }),
  }));
}

/** Build a node of a built-in type, ports derived from NODE_TYPE_CONFIG. */
function n(
  id: string,
  type: NodeType,
  position: [number, number, number],
  opts: { title?: string; data?: Record<string, unknown> } = {},
): EditorNode {
  const config = NODE_TYPE_CONFIG[type];
  return {
    id,
    type,
    position,
    title: opts.title ?? type,
    data: opts.data ?? {},
    inputs: portsFromConfig('in', config.inputs),
    outputs: portsFromConfig('out', config.outputs),
  };
}

/** Build a `custom` expression node with N any-typed inputs and one output. */
function expr(
  id: string,
  position: [number, number, number],
  title: string,
  expression: string,
  inputLabels: string[],
  outputLabel = 'out',
): EditorNode {
  return {
    id,
    type: 'custom',
    position,
    title,
    data: { expression, inputCount: inputLabels.length, outputCount: 1 },
    inputs: inputLabels.map((label, i) => ({ id: `in-${i}`, label, portType: 'any' as const })),
    outputs: [{ id: 'out-0', label: outputLabel, portType: 'any' as const }],
  };
}

function c(id: string, sourceNodeId: string, sourcePortIndex: number, targetNodeId: string, targetPortIndex: number): Connection {
  return { id, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex };
}

function note(id: string, position: [number, number, number], text: string): EditorNode {
  return n(id, 'note', position, { title: 'Note', data: { text } });
}

const liveBtc: NodeTemplate = {
  id: 'builtin-live-btc',
  name: 'Live BTC Price',
  category: 'Examples',
  createdAt: 0,
  nodes: [
    note('u', [0, 0, -2.5], 'A live API dashboard: the source feeds a URL into http-fetch, the expression node extracts the price. Turn on LIVE in the execute bar to refresh continuously.'),
    n('api', 'source', [0, 0, 0], { title: 'BTC Spot API', data: { label: 'https://api.coinbase.com/v2/prices/BTC-USD/spot', value: 1 } }),
    n('fetch', 'http-fetch', [3.5, 0, 0], { title: 'Fetch' }),
    expr('price', [7, 0, 0], 'Extract Price', 'in0 && in0.data ? "BTC: $" + in0.data.amount : "fetching…"', ['data'], 'text'),
    n('show', 'display', [10.5, 0, 0], { title: 'Price' }),
  ],
  connections: [
    c('c1', 'api', 1, 'fetch', 0),
    c('c2', 'api', 0, 'fetch', 1),
    c('c3', 'fetch', 0, 'price', 0),
    c('c4', 'price', 0, 'show', 0),
  ],
};

const tipCalculator: NodeTemplate = {
  id: 'builtin-tip-calc',
  name: 'Tip Calculator',
  category: 'Examples',
  createdAt: 0,
  nodes: [
    note('u', [0, 0, -3], 'Click a source node and edit its value on the node screen — everything downstream recomputes instantly.'),
    n('bill', 'source', [0, 0, 0], { title: 'Bill $', data: { value: 86.4 } }),
    n('tip', 'source', [0, 0, 2], { title: 'Tip %', data: { value: 18 } }),
    n('people', 'source', [0, 0, 4], { title: 'People', data: { value: 4 } }),
    expr('tipAmt', [3.5, 0, 1], 'Tip Amount', 'Math.round(in0 * in1) / 100', ['bill', 'tip%']),
    n('total', 'math', [7, 0, 0], { title: 'Total', data: { operation: 'add' } }),
    n('showTotal', 'display', [10.5, 0, -1.5], { title: 'Total' }),
    expr('each', [10.5, 0, 1.5], 'Per Person', '"$ " + (in0 / in1).toFixed(2)', ['total', 'people']),
    n('showEach', 'display', [14, 0, 1.5], { title: 'Each' }),
  ],
  connections: [
    c('c1', 'bill', 0, 'tipAmt', 0),
    c('c2', 'tip', 0, 'tipAmt', 1),
    c('c3', 'bill', 0, 'total', 0),
    c('c4', 'tipAmt', 0, 'total', 1),
    c('c5', 'total', 0, 'showTotal', 0),
    c('c6', 'total', 0, 'each', 0),
    c('c7', 'people', 0, 'each', 1),
    c('c8', 'each', 0, 'showEach', 0),
  ],
};

const trigPlayground: NodeTemplate = {
  id: 'builtin-trig',
  name: 'Trig Playground',
  category: 'Examples',
  createdAt: 0,
  nodes: [
    note('u', [0, 0, -3], 'The timer emits milliseconds; the expression node converts them to radians. Turn on LIVE in the execute bar to watch the waves move.'),
    n('clock', 'timer', [0, 0, 0], { title: 'Clock', data: { intervalMs: 6283 } }),
    expr('rad', [3.5, 0, 0], 'To Radians', 'in0 / 1000', ['ms'], 'rad'),
    n('s', 'sin', [7, 0, -1.5], { title: 'sin' }),
    n('co', 'cos', [7, 0, 1.5], { title: 'cos' }),
    n('showS', 'display', [10.5, 0, -2.5], { title: 'sin θ' }),
    n('showC', 'display', [10.5, 0, 2.5], { title: 'cos θ' }),
    n('sum', 'math', [10.5, 0, 0], { title: 'sin + cos', data: { operation: 'add' } }),
    n('showSum', 'display', [14, 0, 0], { title: 'Sum' }),
  ],
  connections: [
    c('c1', 'clock', 0, 'rad', 0),
    c('c2', 'rad', 0, 's', 0),
    c('c3', 'rad', 0, 'co', 0),
    c('c4', 's', 0, 'showS', 0),
    c('c5', 'co', 0, 'showC', 0),
    c('c6', 's', 0, 'sum', 0),
    c('c7', 'co', 0, 'sum', 1),
    c('c8', 'sum', 0, 'showSum', 0),
  ],
};

const paletteGenerator: NodeTemplate = {
  id: 'builtin-palette',
  name: 'Palette Generator',
  category: 'Examples',
  createdAt: 0,
  nodes: [
    note('u', [0, 0, -3], 'Pick a base color on the color node — the +30° and +150° hue rotations update live. Use the hex values as design tokens.'),
    n('base', 'color-picker', [0, 0, 0], { title: 'Base Color', data: { color: '#1fb6ad' } }),
    n('showBase', 'display', [3.5, 0, -2.5], { title: 'Base' }),
    n('toHsl', 'rgb-to-hsl', [3.5, 0, 1], { title: 'To HSL' }),
    expr('rotA', [7, 0, -1], 'Hue +30°', '(in0 + 30) % 360', ['h'], 'h'),
    expr('rotB', [7, 0, 2], 'Hue +150°', '(in0 + 150) % 360', ['h'], 'h'),
    n('hslA', 'hsl-to-rgb', [10.5, 0, -1], { title: 'Accent' }),
    n('hslB', 'hsl-to-rgb', [10.5, 0, 2], { title: 'Contrast' }),
    n('showA', 'display', [14, 0, -1], { title: 'Accent' }),
    n('showB', 'display', [14, 0, 2], { title: 'Contrast' }),
  ],
  connections: [
    c('c1', 'base', 0, 'showBase', 0),
    c('c2', 'base', 1, 'toHsl', 0),
    c('c3', 'base', 2, 'toHsl', 1),
    c('c4', 'base', 3, 'toHsl', 2),
    c('c5', 'toHsl', 0, 'rotA', 0),
    c('c6', 'toHsl', 0, 'rotB', 0),
    c('c7', 'rotA', 0, 'hslA', 0),
    c('c8', 'toHsl', 1, 'hslA', 1),
    c('c9', 'toHsl', 2, 'hslA', 2),
    c('c10', 'rotB', 0, 'hslB', 0),
    c('c11', 'toHsl', 1, 'hslB', 1),
    c('c12', 'toHsl', 2, 'hslB', 2),
    c('c13', 'hslA', 0, 'showA', 0),
    c('c14', 'hslB', 0, 'showB', 0),
  ],
};

const dataPipeline: NodeTemplate = {
  id: 'builtin-pipeline',
  name: 'Data Pipeline',
  category: 'Examples',
  createdAt: 0,
  nodes: [
    note('u', [0, 0, -3], 'ETL in miniature: map doubles every number, filter keeps values over 10, reduce sums them. Click a stage to edit its expression.'),
    expr('data', [0, 0, 0], 'Data', '[12, 5, 8, 21, 3, 17, 9]', [], 'array'),
    n('map', 'array-map', [3.5, 0, 0], { title: 'Double', data: { expression: 'x * 2' } }),
    n('filt', 'array-filter', [7, 0, 0], { title: 'Keep > 10', data: { expression: 'x > 10' } }),
    n('showArr', 'display', [10.5, 0, -2.5], { title: 'Filtered' }),
    n('start', 'source', [7, 0, 2.5], { title: 'Start at', data: { value: 0 } }),
    n('sum', 'array-reduce', [10.5, 0, 0], { title: 'Sum', data: { expression: 'acc + x' } }),
    expr('fmt', [14, 0, 1], 'Label', '"Σ = " + in0', ['sum'], 'text'),
    n('showSum', 'display', [17.5, 0, 1], { title: 'Sum' }),
  ],
  connections: [
    c('c1', 'data', 0, 'map', 0),
    c('c2', 'map', 0, 'filt', 0),
    c('c3', 'filt', 0, 'showArr', 0),
    c('c4', 'filt', 0, 'sum', 0),
    c('c5', 'start', 0, 'sum', 1),
    c('c6', 'sum', 0, 'fmt', 0),
    c('c7', 'fmt', 0, 'showSum', 0),
  ],
};

export const BUILTIN_TEMPLATES: Record<string, NodeTemplate> = {
  [liveBtc.id]: liveBtc,
  [tipCalculator.id]: tipCalculator,
  [trigPlayground.id]: trigPlayground,
  [paletteGenerator.id]: paletteGenerator,
  [dataPipeline.id]: dataPipeline,
};

export const BUILTIN_TEMPLATE_LIST: NodeTemplate[] = Object.values(BUILTIN_TEMPLATES);
