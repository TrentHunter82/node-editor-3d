import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../../store/editorStore';
import { NODE_CATEGORIES, NODE_TYPE_CONFIG } from '../../types';
import type { NodeType, NodeCategory } from '../../types';
import { getNodeLabel, COLOR_HEX } from '../../types/nodeLabels';

// ---------------------------------------------------------------------------
// Enable immer Map/Set support (required by editorStore)
// ---------------------------------------------------------------------------
enableMapSet();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  });
}

function getState() {
  return useEditorStore.getState();
}

// ---------------------------------------------------------------------------
// Replicate MENU_NODES construction logic from QuickNodeMenu.tsx
// ---------------------------------------------------------------------------
const EXCLUDED_TYPES: NodeType[] = ['subgraph-input', 'subgraph-output', 'custom'];

function buildMenuNodes() {
  return (Object.keys(NODE_CATEGORIES) as NodeType[])
    .filter(t => t !== 'subgraph-input' && t !== 'subgraph-output' && t !== 'custom')
    .map(type => ({
      type,
      label: getNodeLabel(type, true),
      color: COLOR_HEX[NODE_TYPE_CONFIG[type]?.color] ?? 'var(--teal)',
      category: NODE_CATEGORIES[type],
    }));
}

const MENU_NODES = buildMenuNodes();

// ---------------------------------------------------------------------------
// Replicate CATEGORY_ORDER from QuickNodeMenu.tsx
// ---------------------------------------------------------------------------
const CATEGORY_ORDER: string[] = [
  'Pinned', 'Recent', 'Core', 'Math', 'String', 'Logic',
  'Vector', 'Data', 'Color', 'Live', 'Utility', 'Subgraph', 'Plugin',
];

// ---------------------------------------------------------------------------
// Replicate search/filter logic from QuickNodeMenu.tsx
// ---------------------------------------------------------------------------
type MenuNode = {
  type: NodeType;
  label: string;
  color: string;
  category: string;
  customId?: string;
  pluginType?: string;
};

function filterNodes(
  allNodes: MenuNode[],
  search: string,
  compatibleTypes: Set<NodeType> | null,
): MenuNode[] {
  let list = allNodes;
  if (compatibleTypes) {
    list = list.filter(n => compatibleTypes.has(n.type));
  }
  if (!search.trim()) return list;
  const q = search.trim().toLowerCase();
  return list.filter(
    n =>
      n.category !== 'Recent' &&
      n.category !== 'Pinned' &&
      (n.label.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q)),
  );
}

// ---------------------------------------------------------------------------
// Replicate category grouping logic from QuickNodeMenu.tsx
// ---------------------------------------------------------------------------
function groupByCategory(nodes: MenuNode[]): Map<string, MenuNode[]> {
  const grouped = new Map<string, MenuNode[]>();
  for (const n of nodes) {
    const list = grouped.get(n.category) ?? [];
    list.push(n);
    grouped.set(n.category, list);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Replicate menu positioning logic from QuickNodeMenu.tsx
// ---------------------------------------------------------------------------
function computeMenuStyle(
  screenPos: { x: number; y: number } | undefined,
  windowWidth: number,
  windowHeight: number,
) {
  if (screenPos) {
    return {
      position: 'fixed' as const,
      top: Math.max(0, Math.min(screenPos.y, windowHeight - 350)),
      left: Math.max(0, Math.min(screenPos.x, windowWidth - 260)),
      maxWidth: '100vw',
    };
  }
  return {
    position: 'fixed' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: '100vw',
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('QuickNodeMenu logic', () => {
  beforeEach(() => {
    resetStore();
  });

  // =========================================================================
  // 1. MENU_NODES construction
  // =========================================================================
  describe('MENU_NODES construction', () => {
    it('excludes subgraph-input, subgraph-output, and custom types', () => {
      const types = MENU_NODES.map(n => n.type);
      expect(types).not.toContain('subgraph-input');
      expect(types).not.toContain('subgraph-output');
      expect(types).not.toContain('custom');
    });

    it('every entry has type, label, color, and category', () => {
      for (const node of MENU_NODES) {
        expect(node.type).toBeDefined();
        expect(typeof node.type).toBe('string');
        expect(node.type.length).toBeGreaterThan(0);

        expect(node.label).toBeDefined();
        expect(typeof node.label).toBe('string');
        expect(node.label.length).toBeGreaterThan(0);

        expect(node.color).toBeDefined();
        expect(typeof node.color).toBe('string');
        expect(node.color.length).toBeGreaterThan(0);

        expect(node.category).toBeDefined();
        expect(typeof node.category).toBe('string');
        expect(node.category.length).toBeGreaterThan(0);
      }
    });

    it('includes all NODE_CATEGORIES types except the excluded ones', () => {
      const allTypes = Object.keys(NODE_CATEGORIES) as NodeType[];
      const expectedTypes = allTypes.filter(t => !EXCLUDED_TYPES.includes(t));
      const menuTypes = MENU_NODES.map(n => n.type);

      for (const type of expectedTypes) {
        expect(menuTypes).toContain(type);
      }
      expect(menuTypes.length).toBe(expectedTypes.length);
    });

    it('assigns the correct category from NODE_CATEGORIES', () => {
      for (const node of MENU_NODES) {
        expect(node.category).toBe(NODE_CATEGORIES[node.type]);
      }
    });

    it('assigns the correct label via getNodeLabel(type, true)', () => {
      for (const node of MENU_NODES) {
        expect(node.label).toBe(getNodeLabel(node.type, true));
      }
    });

    it('assigns the correct color from COLOR_HEX or fallback', () => {
      for (const node of MENU_NODES) {
        const expectedColor = COLOR_HEX[NODE_TYPE_CONFIG[node.type]?.color] ?? 'var(--teal)';
        expect(node.color).toBe(expectedColor);
      }
    });

    it('has more than zero entries', () => {
      expect(MENU_NODES.length).toBeGreaterThan(0);
    });

    it('includes the subgraph type itself (not the boundary types)', () => {
      const types = MENU_NODES.map(n => n.type);
      expect(types).toContain('subgraph');
    });
  });

  // =========================================================================
  // 2. Search/filter logic
  // =========================================================================
  describe('search/filter logic', () => {
    const allNodes: MenuNode[] = [
      // Simulate Pinned
      { type: 'math', label: 'Math', color: 'var(--orange)', category: 'Pinned' },
      // Simulate Recent
      { type: 'source', label: 'Source', color: 'var(--teal)', category: 'Recent' },
      // Regular built-in nodes
      ...MENU_NODES.map(n => ({
        ...n,
        customId: undefined,
        pluginType: undefined,
      })),
    ];

    it('empty search returns all nodes', () => {
      const result = filterNodes(allNodes, '', null);
      expect(result.length).toBe(allNodes.length);
    });

    it('whitespace-only search returns all nodes', () => {
      const result = filterNodes(allNodes, '   ', null);
      expect(result.length).toBe(allNodes.length);
    });

    it('search by label substring matches', () => {
      const result = filterNodes(allNodes, 'Math', null);
      // Should match nodes whose label contains 'Math'
      expect(result.length).toBeGreaterThan(0);
      for (const n of result) {
        const matchesLabel = n.label.toLowerCase().includes('math');
        const matchesCategory = n.category.toLowerCase().includes('math');
        const matchesType = n.type.toLowerCase().includes('math');
        expect(matchesLabel || matchesCategory || matchesType).toBe(true);
      }
    });

    it('search by category name matches', () => {
      const result = filterNodes(allNodes, 'Logic', null);
      expect(result.length).toBeGreaterThan(0);
      // Every result should match via label, category, or type
      for (const n of result) {
        const matchesLabel = n.label.toLowerCase().includes('logic');
        const matchesCategory = n.category.toLowerCase().includes('logic');
        const matchesType = n.type.toLowerCase().includes('logic');
        expect(matchesLabel || matchesCategory || matchesType).toBe(true);
      }
    });

    it('search by type slug matches', () => {
      const result = filterNodes(allNodes, 'compose-vec3', null);
      expect(result.length).toBeGreaterThan(0);
      const types = result.map(n => n.type);
      expect(types).toContain('compose-vec3');
    });

    it('case insensitive matching', () => {
      const resultUpper = filterNodes(allNodes, 'MATH', null);
      const resultLower = filterNodes(allNodes, 'math', null);
      const resultMixed = filterNodes(allNodes, 'MaTh', null);
      expect(resultUpper.length).toBe(resultLower.length);
      expect(resultMixed.length).toBe(resultLower.length);
      expect(resultUpper.length).toBeGreaterThan(0);
    });

    it('Pinned and Recent categories are excluded when searching', () => {
      const result = filterNodes(allNodes, 'source', null);
      // 'Recent' entry for 'source' should be excluded
      const recentEntries = result.filter(n => n.category === 'Recent');
      const pinnedEntries = result.filter(n => n.category === 'Pinned');
      expect(recentEntries.length).toBe(0);
      expect(pinnedEntries.length).toBe(0);
    });

    it('Pinned items are present when not searching', () => {
      const result = filterNodes(allNodes, '', null);
      const pinnedEntries = result.filter(n => n.category === 'Pinned');
      expect(pinnedEntries.length).toBeGreaterThan(0);
    });

    it('Recent items are present when not searching', () => {
      const result = filterNodes(allNodes, '', null);
      const recentEntries = result.filter(n => n.category === 'Recent');
      expect(recentEntries.length).toBeGreaterThan(0);
    });

    it('no results for gibberish query', () => {
      const result = filterNodes(allNodes, 'xyzzy_nonsense_12345', null);
      expect(result.length).toBe(0);
    });

    it('search matches partial label substrings', () => {
      const result = filterNodes(allNodes, 'Clam', null);
      expect(result.length).toBeGreaterThan(0);
      expect(result.some(n => n.type === 'clamp')).toBe(true);
    });

    it('compatible type filtering restricts results', () => {
      const compat = new Set<NodeType>(['math', 'clamp', 'remap']);
      const result = filterNodes(allNodes, '', compat);
      for (const n of result) {
        expect(compat.has(n.type)).toBe(true);
      }
    });

    it('compatible type filtering combined with search', () => {
      const compat = new Set<NodeType>(['math', 'clamp', 'remap']);
      const result = filterNodes(allNodes, 'clamp', compat);
      expect(result.length).toBeGreaterThan(0);
      for (const n of result) {
        expect(compat.has(n.type)).toBe(true);
      }
      expect(result.some(n => n.type === 'clamp')).toBe(true);
    });
  });

  // =========================================================================
  // 3. Category grouping logic
  // =========================================================================
  describe('category grouping logic', () => {
    it('CATEGORY_ORDER has all expected categories', () => {
      const expectedCategories = [
        'Pinned', 'Recent', 'Core', 'Math', 'String', 'Logic',
        'Vector', 'Data', 'Color', 'Live', 'Utility', 'Subgraph', 'Plugin',
      ];
      expect(CATEGORY_ORDER).toEqual(expectedCategories);
    });

    it('CATEGORY_ORDER has 13 categories', () => {
      expect(CATEGORY_ORDER.length).toBe(13);
    });

    it('nodes group correctly by category', () => {
      const grouped = groupByCategory(MENU_NODES);

      // Each group should contain nodes with matching category
      for (const [category, nodes] of grouped) {
        for (const node of nodes) {
          expect(node.category).toBe(category);
        }
      }
    });

    it('all real NodeCategory values appear in CATEGORY_ORDER', () => {
      // NodeCategory = 'Core' | 'Math' | 'String' | 'Logic' | 'Vector' | 'Utility' | 'Color' | 'Live' | 'Data' | 'Subgraph'
      const realCategories: NodeCategory[] = [
        'Core', 'Math', 'String', 'Logic', 'Vector', 'Utility', 'Color', 'Live', 'Data', 'Subgraph',
      ];
      for (const cat of realCategories) {
        expect(CATEGORY_ORDER).toContain(cat);
      }
    });

    it('every MENU_NODES category appears in CATEGORY_ORDER', () => {
      const uniqueCategories = new Set(MENU_NODES.map(n => n.category));
      for (const cat of uniqueCategories) {
        expect(CATEGORY_ORDER).toContain(cat);
      }
    });

    it('grouping preserves all nodes (no nodes lost)', () => {
      const grouped = groupByCategory(MENU_NODES);
      let totalCount = 0;
      for (const nodes of grouped.values()) {
        totalCount += nodes.length;
      }
      expect(totalCount).toBe(MENU_NODES.length);
    });

    it('Core category contains source, transform, filter, output', () => {
      const grouped = groupByCategory(MENU_NODES);
      const coreTypes = (grouped.get('Core') ?? []).map(n => n.type);
      expect(coreTypes).toContain('source');
      expect(coreTypes).toContain('transform');
      expect(coreTypes).toContain('filter');
      expect(coreTypes).toContain('output');
    });

    it('Math category contains math, clamp, remap, sin, cos, etc.', () => {
      const grouped = groupByCategory(MENU_NODES);
      const mathTypes = (grouped.get('Math') ?? []).map(n => n.type);
      expect(mathTypes).toContain('math');
      expect(mathTypes).toContain('clamp');
      expect(mathTypes).toContain('remap');
      expect(mathTypes).toContain('sin');
      expect(mathTypes).toContain('cos');
      expect(mathTypes).toContain('lerp');
    });

    it('Logic category contains compare, switch, and, or, not, xor', () => {
      const grouped = groupByCategory(MENU_NODES);
      const logicTypes = (grouped.get('Logic') ?? []).map(n => n.type);
      expect(logicTypes).toContain('compare');
      expect(logicTypes).toContain('switch');
      expect(logicTypes).toContain('and');
      expect(logicTypes).toContain('or');
      expect(logicTypes).toContain('not');
      expect(logicTypes).toContain('xor');
    });
  });

  // =========================================================================
  // 4. Compatible type filtering (via store's getCompatibleNodeTypes)
  // =========================================================================
  describe('compatible type filtering via store', () => {
    it('returns compatible types for a source node output (number port)', () => {
      // Add a source node (outputs: number, string)
      getState().addNode('source', [0, 0, 0]);
      const nodes = Object.values(getState().nodes);
      expect(nodes.length).toBe(1);
      const sourceNode = nodes[0];

      // Get compatible types for the first output port (portType: 'number')
      const compatTypes = getState().getCompatibleNodeTypes(
        sourceNode.id, 0, true,
      );
      expect(compatTypes.length).toBeGreaterThan(0);

      // All compatible types should have at least one input that accepts 'number' or 'any'
      for (const ct of compatTypes) {
        const config = NODE_TYPE_CONFIG[ct.type];
        const hasCompatibleInput = config.inputs.some(
          inp => inp.portType === 'number' || inp.portType === 'any',
        );
        expect(hasCompatibleInput).toBe(true);
      }
    });

    it('returns compatible types for an input port (dragging from input)', () => {
      // Add a math node (inputs: number a, number b)
      getState().addNode('math', [0, 0, 0]);
      const nodes = Object.values(getState().nodes);
      const mathNode = nodes[0];

      // Get compatible types for the first input port (portType: 'number')
      const compatTypes = getState().getCompatibleNodeTypes(
        mathNode.id, 0, false,
      );
      expect(compatTypes.length).toBeGreaterThan(0);

      // All compatible types should have at least one output that provides 'number' or 'any'
      for (const ct of compatTypes) {
        const config = NODE_TYPE_CONFIG[ct.type];
        const hasCompatibleOutput = config.outputs.some(
          out => out.portType === 'number' || out.portType === 'any',
        );
        expect(hasCompatibleOutput).toBe(true);
      }
    });

    it('filtered list only contains compatible types', () => {
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      const compatTypes = getState().getCompatibleNodeTypes(sourceNode.id, 0, true);
      const compatSet = new Set<NodeType>(compatTypes.map(t => t.type));

      // Filter MENU_NODES the same way the component does
      const filtered = filterNodes(
        MENU_NODES.map(n => ({ ...n, customId: undefined, pluginType: undefined })),
        '',
        compatSet,
      );

      for (const n of filtered) {
        expect(compatSet.has(n.type)).toBe(true);
      }
    });

    it('compatible types exclude note node (it has no ports)', () => {
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      const compatTypes = getState().getCompatibleNodeTypes(sourceNode.id, 0, true);
      const typeNames = compatTypes.map(t => t.type);
      expect(typeNames).not.toContain('note');
    });

    it('returns empty for non-existent node ID', () => {
      const compatTypes = getState().getCompatibleNodeTypes('non-existent', 0, true);
      expect(compatTypes.length).toBe(0);
    });

    it('boolean output only matches boolean/any inputs', () => {
      // Add a compare node (output: boolean)
      getState().addNode('compare', [0, 0, 0]);
      const compareNode = Object.values(getState().nodes)[0];

      const compatTypes = getState().getCompatibleNodeTypes(compareNode.id, 0, true);
      expect(compatTypes.length).toBeGreaterThan(0);

      for (const ct of compatTypes) {
        const config = NODE_TYPE_CONFIG[ct.type];
        const hasCompatInput = config.inputs.some(
          inp => inp.portType === 'boolean' || inp.portType === 'any',
        );
        expect(hasCompatInput).toBe(true);
      }
    });
  });

  // =========================================================================
  // 5. Menu positioning logic
  // =========================================================================
  describe('menu positioning logic', () => {
    it('viewport clamping: screenPos.y clamped to windowHeight - 350', () => {
      const style = computeMenuStyle({ x: 100, y: 900 }, 1920, 1080);
      // Max y = 1080 - 350 = 730
      expect(style.top).toBe(730);
    });

    it('viewport clamping: screenPos.x clamped to windowWidth - 260', () => {
      const style = computeMenuStyle({ x: 1800, y: 100 }, 1920, 1080);
      // Max x = 1920 - 260 = 1660
      expect(style.left).toBe(1660);
    });

    it('both axes clamped simultaneously', () => {
      const style = computeMenuStyle({ x: 2000, y: 2000 }, 1920, 1080);
      expect(style.top).toBe(730);
      expect(style.left).toBe(1660);
    });

    it('no clamping when position is within bounds', () => {
      const style = computeMenuStyle({ x: 200, y: 300 }, 1920, 1080);
      expect(style.top).toBe(300);
      expect(style.left).toBe(200);
    });

    it('position cannot go below zero', () => {
      const style = computeMenuStyle({ x: -50, y: -100 }, 1920, 1080);
      expect(style.top).toBe(0);
      expect(style.left).toBe(0);
    });

    it('centered when no screenPos provided', () => {
      const style = computeMenuStyle(undefined, 1920, 1080);
      expect(style.top).toBe('50%');
      expect(style.left).toBe('50%');
      expect(style.transform).toBe('translate(-50%, -50%)');
    });

    it('centered style has no transform when screenPos is provided', () => {
      const style = computeMenuStyle({ x: 100, y: 100 }, 1920, 1080);
      expect('transform' in style).toBe(false);
    });

    it('clamping works with small window dimensions', () => {
      // window 400x400: max x = 400 - 260 = 140, max y = 400 - 350 = 50
      const style = computeMenuStyle({ x: 300, y: 200 }, 400, 400);
      expect(style.top).toBe(50);
      expect(style.left).toBe(140);
    });

    it('edge case: screenPos exactly at boundary', () => {
      // Exactly at the clamped boundary
      const style = computeMenuStyle({ x: 1660, y: 730 }, 1920, 1080);
      expect(style.top).toBe(730);
      expect(style.left).toBe(1660);
    });
  });

  // =========================================================================
  // 6. addNodeAndConnect integration
  // =========================================================================
  describe('addNodeAndConnect integration', () => {
    it('creates node at worldPos coordinates', () => {
      // Add a source node
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      const worldPos: [number, number, number] = [5, 0, 3];
      const newNodeId = getState().addNodeAndConnect(
        'math', worldPos,
        sourceNode.id, 0, true,
      );

      expect(newNodeId).not.toBeNull();
      const newNode = getState().nodes[newNodeId!];
      expect(newNode).toBeDefined();
      expect(newNode.position).toEqual([5, 0, 3]);
    });

    it('auto-connects new node to source (output to input)', () => {
      // Add a source node
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      const newNodeId = getState().addNodeAndConnect(
        'math', [2, 0, 0],
        sourceNode.id, 0, true,
      );

      expect(newNodeId).not.toBeNull();

      // Should have exactly one connection
      const connections = Object.values(getState().connections);
      expect(connections.length).toBe(1);

      const conn = connections[0];
      // source output -> new node input
      expect(conn.sourceNodeId).toBe(sourceNode.id);
      expect(conn.sourcePortIndex).toBe(0);
      expect(conn.targetNodeId).toBe(newNodeId);
    });

    it('auto-connects new node to source (input to output)', () => {
      // Add a math node and drag from its input
      getState().addNode('math', [0, 0, 0]);
      const mathNode = Object.values(getState().nodes)[0];

      // Drag from math's input port 0 (number type) -> create a source node
      const newNodeId = getState().addNodeAndConnect(
        'source', [-2, 0, 0],
        mathNode.id, 0, false,
      );

      expect(newNodeId).not.toBeNull();

      const connections = Object.values(getState().connections);
      expect(connections.length).toBe(1);

      const conn = connections[0];
      // new node output -> math input
      expect(conn.sourceNodeId).toBe(newNodeId);
      expect(conn.targetNodeId).toBe(mathNode.id);
      expect(conn.targetPortIndex).toBe(0);
    });

    it('returns null for non-existent source node', () => {
      const result = getState().addNodeAndConnect(
        'math', [0, 0, 0],
        'non-existent', 0, true,
      );
      expect(result).toBeNull();
    });

    it('returns null for out-of-range port index', () => {
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      const result = getState().addNodeAndConnect(
        'math', [0, 0, 0],
        sourceNode.id, 99, true,
      );
      expect(result).toBeNull();
    });

    it('new node has correct type', () => {
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      const newNodeId = getState().addNodeAndConnect(
        'clamp', [2, 0, 0],
        sourceNode.id, 0, true,
      );

      expect(newNodeId).not.toBeNull();
      const newNode = getState().nodes[newNodeId!];
      expect(newNode.type).toBe('clamp');
    });

    it('auto-selects the newly created node', () => {
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      const newNodeId = getState().addNodeAndConnect(
        'math', [2, 0, 0],
        sourceNode.id, 0, true,
      );

      expect(newNodeId).not.toBeNull();
      expect(getState().selectedIds.has(newNodeId!)).toBe(true);
      // Only the new node should be selected
      expect(getState().selectedIds.size).toBe(1);
    });

    it('connects to first compatible port on the new node', () => {
      // Source node output 0 is 'number' type
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      // Remap has 5 number inputs; should connect to the first one (index 0)
      const newNodeId = getState().addNodeAndConnect(
        'remap', [2, 0, 0],
        sourceNode.id, 0, true,
      );

      expect(newNodeId).not.toBeNull();
      const conn = Object.values(getState().connections)[0];
      expect(conn.targetPortIndex).toBe(0);
    });

    it('handles string port connection correctly', () => {
      // Source node has output port 1 which is 'string' type
      getState().addNode('source', [0, 0, 0]);
      const sourceNode = Object.values(getState().nodes)[0];

      // Concat has string inputs
      const newNodeId = getState().addNodeAndConnect(
        'concat', [2, 0, 0],
        sourceNode.id, 1, true,
      );

      expect(newNodeId).not.toBeNull();
      const conn = Object.values(getState().connections)[0];
      // Source output port 1 (string) -> concat input port 0 (string)
      expect(conn.sourcePortIndex).toBe(1);
      expect(conn.targetPortIndex).toBe(0);
    });
  });

  // =========================================================================
  // Additional edge cases
  // =========================================================================
  describe('handleSelect position logic', () => {
    it('worldPos maps to [x, 0, z] when provided', () => {
      // The component does: const pos = worldPos ? [worldPos[0], 0, worldPos[1]] : [0, 0, 0]
      const worldPos: [number, number] = [10, 20];
      const pos: [number, number, number] = [worldPos[0], 0, worldPos[1]];
      expect(pos).toEqual([10, 0, 20]);
    });

    it('defaults to [0, 0, 0] when no worldPos', () => {
      const worldPos: [number, number] | undefined = undefined;
      const pos: [number, number, number] = worldPos ? [worldPos[0], 0, worldPos[1]] : [0, 0, 0];
      expect(pos).toEqual([0, 0, 0]);
    });
  });

  describe('allNodes construction with Pinned and Recent', () => {
    it('pinned items appear as category Pinned from existing MENU_NODES entries', () => {
      const pinnedTypes: NodeType[] = ['math', 'source'];
      const pinnedItems = pinnedTypes
        .map(type => {
          const info = MENU_NODES.find(n => n.type === type);
          if (!info) return null;
          return { ...info, category: 'Pinned' as string };
        })
        .filter((n): n is NonNullable<typeof n> => n !== null);

      expect(pinnedItems.length).toBe(2);
      expect(pinnedItems[0].category).toBe('Pinned');
      expect(pinnedItems[0].type).toBe('math');
      expect(pinnedItems[1].category).toBe('Pinned');
      expect(pinnedItems[1].type).toBe('source');
    });

    it('recent items appear as category Recent from existing MENU_NODES entries', () => {
      const recentTypes: NodeType[] = ['clamp', 'remap'];
      const recentItems = recentTypes
        .map(type => {
          const info = MENU_NODES.find(n => n.type === type);
          if (!info) return null;
          return { ...info, category: 'Recent' as string };
        })
        .filter((n): n is NonNullable<typeof n> => n !== null);

      expect(recentItems.length).toBe(2);
      expect(recentItems[0].category).toBe('Recent');
      expect(recentItems[0].type).toBe('clamp');
    });

    it('pinned/recent are prepended to combined node list', () => {
      const pinnedItems: MenuNode[] = [
        { type: 'math', label: 'Math', color: 'var(--orange)', category: 'Pinned' },
      ];
      const recentItems: MenuNode[] = [
        { type: 'source', label: 'Source', color: 'var(--teal)', category: 'Recent' },
      ];
      const builtIn: MenuNode[] = MENU_NODES.map(n => ({ ...n }));

      const combined = [...pinnedItems, ...recentItems, ...builtIn];
      expect(combined[0].category).toBe('Pinned');
      expect(combined[1].category).toBe('Recent');
      expect(combined.length).toBe(1 + 1 + MENU_NODES.length);
    });

    it('invalid pinned type is filtered out', () => {
      const pinnedTypes = ['nonexistent-type' as NodeType];
      const pinnedItems = pinnedTypes
        .map(type => {
          const info = MENU_NODES.find(n => n.type === type);
          if (!info) return null;
          return { ...info, category: 'Pinned' as string };
        })
        .filter((n): n is NonNullable<typeof n> => n !== null);

      expect(pinnedItems.length).toBe(0);
    });
  });

  describe('category display ordering', () => {
    it('groups are rendered in CATEGORY_ORDER sequence', () => {
      const grouped = groupByCategory(MENU_NODES);
      const orderedCategories = CATEGORY_ORDER.filter(cat => grouped.has(cat));

      // Verify the ordering preserves CATEGORY_ORDER sequence
      for (let i = 0; i < orderedCategories.length - 1; i++) {
        const idxA = CATEGORY_ORDER.indexOf(orderedCategories[i]);
        const idxB = CATEGORY_ORDER.indexOf(orderedCategories[i + 1]);
        expect(idxA).toBeLessThan(idxB);
      }
    });

    it('Pinned and Recent come before Core in CATEGORY_ORDER', () => {
      const pinnedIdx = CATEGORY_ORDER.indexOf('Pinned');
      const recentIdx = CATEGORY_ORDER.indexOf('Recent');
      const coreIdx = CATEGORY_ORDER.indexOf('Core');
      expect(pinnedIdx).toBeLessThan(coreIdx);
      expect(recentIdx).toBeLessThan(coreIdx);
      expect(pinnedIdx).toBeLessThan(recentIdx);
    });

    it('Plugin is last in CATEGORY_ORDER', () => {
      expect(CATEGORY_ORDER[CATEGORY_ORDER.length - 1]).toBe('Plugin');
    });
  });
});
