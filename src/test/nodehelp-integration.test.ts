/// <reference types="vitest/config" />
/**
 * Node help system integration tests.
 *
 * Cross-validates nodeHelp.ts against NODE_TYPE_CONFIG, NODE_CATEGORIES,
 * executeGraph, and the editor store. Verifies that help entries are
 * accurate, complete, and consistent with the rest of the system.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { executeGraph } from '../utils/execution';
import { getNodeHelp, getAllNodeHelp, getNodeHelpByCategory } from '../utils/nodeHelp';
import { NODE_TYPE_CONFIG, NODE_CATEGORIES } from '../types';
import type { NodeType } from '../types';

enableMapSet();

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.templates = {};
    s.validationErrors = {};
    s.selectedIds = new Set();
    s.pendingConnection = null;
    s.contextMenu = null;
    s.interaction = 'idle';
    s.isExecuting = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.executionMetrics = {};
    s.executionTimings = {};
    s.executionTotalDuration = 0;
    s.executionMaxNodeDuration = 0;
    s.executionStats = {
      executionCount: 0, totalDuration: 0, errorCount: 0,
      totalCacheHits: 0, totalNodesExecuted: 0, lastExecutedAt: null,
      timeoutCount: 0,
    };
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.activeGraphId = 'default';
    s.graphOrder = ['default'];
    s.breadcrumbStack = [];
    s.checkpoints = {};
    s.graphVariables = {};
    s.lastSaveTime = null;
    s.searchHighlightIds = new Set();
    s.searchQuery = '';
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.breakpoints = {};
    s.breakpointConditions = {};
  });
}

// ---------------------------------------------------------------------------
// Node types that have dynamic ports (help shows "(dynamic)" placeholder)
// ---------------------------------------------------------------------------
const DYNAMIC_PORT_TYPES = new Set<string>(['custom', 'subgraph', 'subgraph-input', 'subgraph-output']);

// Node types that are sources (0 config inputs, not an error if help also has 0)
const SOURCE_LIKE = new Set<string>([
  'source', 'random', 'timer', 'color-picker', 'get-var', 'get-timestamp',
  'subgraph-input', 'note',
]);

// Node types whose help intentionally uses a variadic shorthand that differs
// from the exact config port count (e.g. create-array documents item0/item1/...
// but config has 4 literal ports for item0-item3)
const VARIADIC_INPUT_TYPES = new Set<string>(['create-array']);

// Node types that are sinks (0 outputs, not an error)
const SINK_LIKE = new Set<string>(['output', 'display', 'note', 'set-var', 'subgraph-output']);

// ---------------------------------------------------------------------------
// 1. Help + Execution Cross-Validation
// ---------------------------------------------------------------------------

describe('help+execution cross-validation', () => {
  beforeEach(resetStore);

  it('every node type with a help entry executes without crashing on a single isolated node', () => {
    // Types that require special graph setup to run without crashing
    const skipTypes = new Set<string>([
      'subgraph', 'subgraph-input', 'subgraph-output', 'custom',
    ]);

    const all = getAllNodeHelp();
    const errors: string[] = [];

    for (const entry of all) {
      if (skipTypes.has(entry.nodeType)) continue;

      const config = NODE_TYPE_CONFIG[entry.nodeType as NodeType];
      if (!config) continue;

      // Build a minimal node using the config
      const node = {
        id: 'n1',
        type: entry.nodeType as NodeType,
        position: [0, 0, 0] as [number, number, number],
        title: entry.nodeType,
        data: { value: 1 },
        inputs: config.inputs.map((p, i) => ({
          id: `in-${i}`, label: p.label, portType: p.portType,
        })),
        outputs: config.outputs.map((p, i) => ({
          id: `out-${i}`, label: p.label, portType: p.portType,
        })),
      };

      try {
        executeGraph({ n1: node }, {});
      } catch (e) {
        errors.push(`${entry.nodeType}: ${(e as Error).message}`);
      }
    }

    expect(errors).toEqual([]);
  });

  it('node help input count matches NODE_TYPE_CONFIG for non-source, non-dynamic nodes', () => {
    const mismatches: string[] = [];

    for (const entry of getAllNodeHelp()) {
      const type = entry.nodeType as NodeType;
      if (DYNAMIC_PORT_TYPES.has(type)) continue;
      if (SOURCE_LIKE.has(type)) continue;
      if (VARIADIC_INPUT_TYPES.has(type)) continue;

      const config = NODE_TYPE_CONFIG[type];
      if (!config) continue;

      const configInputCount = config.inputs.length;
      const helpInputCount = entry.inputs.length;

      if (configInputCount !== helpInputCount) {
        mismatches.push(
          `${type}: config has ${configInputCount} inputs but help has ${helpInputCount}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('node help output count matches NODE_TYPE_CONFIG for non-sink, non-dynamic nodes', () => {
    const mismatches: string[] = [];

    for (const entry of getAllNodeHelp()) {
      const type = entry.nodeType as NodeType;
      if (DYNAMIC_PORT_TYPES.has(type)) continue;
      if (SINK_LIKE.has(type)) continue;

      const config = NODE_TYPE_CONFIG[type];
      if (!config) continue;

      const configOutputCount = config.outputs.length;
      const helpOutputCount = entry.outputs.length;

      if (configOutputCount !== helpOutputCount) {
        mismatches.push(
          `${type}: config has ${configOutputCount} outputs but help has ${helpOutputCount}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('source help correctly documents 0 inputs (producer with no upstream)', () => {
    const help = getNodeHelp('source');
    expect(help).toBeDefined();
    expect(help!.inputs.length).toBe(0);
    // source is a producer: NODE_TYPE_CONFIG also has 0 inputs
    expect(NODE_TYPE_CONFIG['source'].inputs.length).toBe(0);
  });

  it('output help correctly documents 0 outputs (consumer/sink with no downstream)', () => {
    const help = getNodeHelp('output');
    expect(help).toBeDefined();
    expect(help!.outputs.length).toBe(0);
    // output is a sink: NODE_TYPE_CONFIG also has 0 outputs
    expect(NODE_TYPE_CONFIG['output'].outputs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Help Category + Config Consistency
// ---------------------------------------------------------------------------

describe('help category+config consistency', () => {
  it('every NODE_CATEGORIES[type] matches the help entry category for all types', () => {
    const mismatches: string[] = [];

    for (const [type, expectedCategory] of Object.entries(NODE_CATEGORIES)) {
      const help = getNodeHelp(type as NodeType);
      if (!help) continue;
      if (help.category !== expectedCategory) {
        mismatches.push(
          `${type}: NODE_CATEGORIES says "${expectedCategory}" but help says "${help.category}"`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('getAllNodeHelp() length equals Object.keys(NODE_TYPE_CONFIG).length', () => {
    const helpCount = getAllNodeHelp().length;
    const configCount = Object.keys(NODE_TYPE_CONFIG).length;
    expect(helpCount).toBe(configCount);
  });

  it('no help entries exist for node types absent from NODE_TYPE_CONFIG', () => {
    const configTypes = new Set(Object.keys(NODE_TYPE_CONFIG));
    const orphaned = getAllNodeHelp()
      .filter(entry => !configTypes.has(entry.nodeType))
      .map(entry => entry.nodeType);

    expect(orphaned).toEqual([]);
  });

  it('each help entry nodeType field matches its lookup key', () => {
    const mismatches: string[] = [];

    for (const type of Object.keys(NODE_TYPE_CONFIG) as NodeType[]) {
      const help = getNodeHelp(type);
      if (!help) continue;
      if (help.nodeType !== type) {
        mismatches.push(`help for "${type}" has nodeType="${help.nodeType}"`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('sum of getNodeHelpByCategory counts equals total getAllNodeHelp entries', () => {
    const allEntries = getAllNodeHelp();
    const categories = [...new Set(allEntries.map(e => e.category))];

    let sumByCategory = 0;
    for (const cat of categories) {
      sumByCategory += getNodeHelpByCategory(cat).length;
    }

    expect(sumByCategory).toBe(allEntries.length);
  });
});

// ---------------------------------------------------------------------------
// 3. Help Accessor Edge Cases
// ---------------------------------------------------------------------------

describe('help accessor edge cases', () => {
  it('getNodeHelp with empty string returns undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getNodeHelp('' as any)).toBeUndefined();
  });

  it('getNodeHelp with a valid type returns a well-formed entry', () => {
    const help = getNodeHelp('math');
    expect(help).toBeDefined();
    expect(help!.nodeType).toBe('math');
    expect(typeof help!.summary).toBe('string');
    expect(typeof help!.description).toBe('string');
    expect(Array.isArray(help!.inputs)).toBe(true);
    expect(Array.isArray(help!.outputs)).toBe(true);
  });

  it('getNodeHelpByCategory with a non-existent category returns an empty array', () => {
    const result = getNodeHelpByCategory('NonExistentCategory');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('getAllNodeHelp returns a new array reference each call (not cached/shared)', () => {
    const first = getAllNodeHelp();
    const second = getAllNodeHelp();
    // Different references
    expect(first).not.toBe(second);
    // But same content
    expect(first.length).toBe(second.length);
    expect(first.map(e => e.nodeType).sort()).toEqual(second.map(e => e.nodeType).sort());
  });
});

// ---------------------------------------------------------------------------
// 4. Help Content Quality
// ---------------------------------------------------------------------------

describe('help content quality', () => {
  it('every entry has a non-empty summary of at least 10 characters', () => {
    const failing: string[] = [];

    for (const entry of getAllNodeHelp()) {
      if (entry.summary.length < 10) {
        failing.push(`${entry.nodeType}: summary too short (${entry.summary.length} chars)`);
      }
    }

    expect(failing).toEqual([]);
  });

  it('every entry has a non-empty description of at least 20 characters', () => {
    const failing: string[] = [];

    for (const entry of getAllNodeHelp()) {
      if (entry.description.length < 20) {
        failing.push(`${entry.nodeType}: description too short (${entry.description.length} chars)`);
      }
    }

    expect(failing).toEqual([]);
  });

  it('summary is different from description for all entries', () => {
    const failing: string[] = [];

    for (const entry of getAllNodeHelp()) {
      if (entry.summary === entry.description) {
        failing.push(`${entry.nodeType}: summary and description are identical`);
      }
    }

    expect(failing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Help Integration with Execution Errors
// ---------------------------------------------------------------------------

describe('help integration with execution errors', () => {
  beforeEach(resetStore);

  it('nodes that have tips in help also have substantive tip content', () => {
    // Tips-having nodes should have useful, non-trivial tips
    const tipsNodes = getAllNodeHelp().filter(e => e.tips && e.tips.length > 0);
    expect(tipsNodes.length).toBeGreaterThan(0);

    const badTips: string[] = [];
    for (const entry of tipsNodes) {
      for (const tip of entry.tips!) {
        if (tip.trim().length < 5) {
          badTips.push(`${entry.nodeType}: tip too short: "${tip}"`);
        }
      }
    }
    expect(badTips).toEqual([]);
  });

  it('help for custom node mentions expression error and inputs[] syntax', () => {
    const help = getNodeHelp('custom');
    expect(help).toBeDefined();
    expect(help!.tips).toBeDefined();
    expect(help!.tips!.length).toBeGreaterThan(0);

    // Should mention inputs[] syntax (key for expression errors)
    const tipsText = help!.tips!.join(' ');
    expect(tipsText).toMatch(/inputs\[/);
  });

  it('help for array-filter mentions expression usage helpful for error recovery', () => {
    const help = getNodeHelp('array-filter');
    expect(help).toBeDefined();

    // description or tips should mention expression/item usage
    const allText = [help!.description, ...(help!.tips ?? [])].join(' ').toLowerCase();
    expect(allText).toMatch(/expression|item/);
  });

  it('help for source node includes a tip about data.value configuration', () => {
    const help = getNodeHelp('source');
    expect(help).toBeDefined();
    expect(help!.tips).toBeDefined();
    expect(help!.tips!.length).toBeGreaterThan(0);

    // Source node should have actionable configuration tips (value editing)
    const tipsText = help!.tips!.join(' ').toLowerCase();
    // Either mentions editing the value or chaining sources
    expect(tipsText).toMatch(/value|edit|chain/);
  });
});
