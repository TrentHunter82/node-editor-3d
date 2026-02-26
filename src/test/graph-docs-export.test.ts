/**
 * Tests for the graph documentation export feature.
 *
 * Uses the shared `generateGraphDocs` utility from src/utils/graphDocs.ts
 * (the same function Toolbar.tsx handleExportDocs calls).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
enableMapSet();

import { useEditorStore, _resetModuleState } from '../store/editorStore';
import { generateGraphDocs as _generateGraphDocs, generateMermaidDiagram } from '../utils/graphDocs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getState() {
  return useEditorStore.getState();
}

function resetStore() {
  _resetModuleState();
  useEditorStore.setState((s) => {
    s.nodes = {};
    s.connections = {};
    s.groups = {};
    s.customNodeDefs = {};
    s.subgraphDefs = {};
    s.selectedIds = new Set<string>();
    s.interaction = 'idle';
    s.pendingConnection = null;
    s.nearestSnapPort = null;
    s.hoveredConnectionId = null;
    s.snapEnabled = true;
    s.showValuePreviews = false;
    s.executionStates = {};
    s.nodeOutputs = {};
    s.executionErrors = {};
    s.isExecuting = false;
    s.searchQuery = '';
    s.contextMenu = null;
    s.validationErrors = {};
    s.breadcrumbStack = [];
    s.activeGraphId = 'default';
    s.graphTabs = { default: { id: 'default', name: 'Main', createdAt: Date.now() } };
    s.graphOrder = ['default'];
    s.templates = {};
    s.errorStrategy = 'fail-fast';
    s.executionMetrics = {};
    s.executionHistory = [];
    s.executionHistoryIndex = -1;
    s.checkpoints = {};
    s.graphVariables = {};
  });
  localStorage.clear();
}

/**
 * Convenience wrapper: calls the shared generateGraphDocs utility with
 * current store state and timestamp disabled (for deterministic tests).
 */
function generateGraphDocs(): string {
  const state = getState();
  const { nodes, connections, groups } = state;
  const graphTab = state.graphTabs[state.activeGraphId];
  const graphName = graphTab?.name ?? 'Untitled Graph';
  return _generateGraphDocs({ nodes, connections, groups, graphName, includeTimestamp: false });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Graph documentation export', () => {
  beforeEach(() => {
    resetStore();
  });

  // ── 1. Empty graph ──────────────────────────────────────────────────

  describe('empty graph', () => {
    it('produces markdown with "Main" as title', () => {
      const md = generateGraphDocs();
      expect(md).toContain('# Main');
    });

    it('shows "*No nodes*" placeholder', () => {
      const md = generateGraphDocs();
      expect(md).toContain('*No nodes*');
    });

    it('shows "*No connections*" placeholder', () => {
      const md = generateGraphDocs();
      expect(md).toContain('*No connections*');
    });
  });

  // ── 2. Node inventory ──────────────────────────────────────────────

  describe('node inventory', () => {
    it('single node appears in table with correct ID, type, title', () => {
      const id = getState().addNode('source', [1, 0, 2]);
      const md = generateGraphDocs();

      expect(md).toContain('## Nodes (1)');
      expect(md).toContain(`| ${id} | source | Source |`);
    });

    it('multiple nodes are all listed in the table', () => {
      const id1 = getState().addNode('source', [0, 0, 0]);
      const id2 = getState().addNode('math', [3, 0, 0]);
      const id3 = getState().addNode('output', [6, 0, 0]);
      const md = generateGraphDocs();

      expect(md).toContain('## Nodes (3)');
      expect(md).toContain(`| ${id1} |`);
      expect(md).toContain(`| ${id2} |`);
      expect(md).toContain(`| ${id3} |`);
    });

    it('node with custom title shows the custom title', () => {
      const id = getState().addNode('source', [0, 0, 0]);
      getState().updateNodeTitle(id, 'My Sensor');
      const md = generateGraphDocs();

      expect(md).toContain('| My Sensor |');
    });

    it('node position is formatted with 1 decimal place', () => {
      getState().addNode('source', [1.123, 2.456, 3.789]);
      const md = generateGraphDocs();

      // toFixed(1) rounds: 1.1, 2.5, 3.8
      expect(md).toContain('(1.1, 2.5, 3.8)');
    });

    it('node in group shows group label in the table', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('source', [2, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('Sensors');
      expect(groupId).toBeTruthy();

      const md = generateGraphDocs();
      // Both node rows should include the group label "Sensors"
      expect(md).toContain('| Sensors |');
    });
  });

  // ── 3. Connection table ────────────────────────────────────────────

  describe('connection table', () => {
    it('single connection shows source and target titles', () => {
      const srcId = getState().addNode('source', [0, 0, 0]);
      const mathId = getState().addNode('math', [3, 0, 0]);
      // source output 0 (number) -> math input 0 (number)
      const connId = getState().addConnection(srcId, 0, mathId, 0);
      expect(connId).not.toBeNull();

      const md = generateGraphDocs();
      expect(md).toContain('## Connections (1)');
      expect(md).toContain('| Source |');
      expect(md).toContain('| Math |');
    });

    it('connection port indices are shown correctly', () => {
      const srcId = getState().addNode('source', [0, 0, 0]);
      const mathId = getState().addNode('math', [3, 0, 0]);
      // source output 0 -> math input 1 (port "b")
      const connId = getState().addConnection(srcId, 0, mathId, 1);
      expect(connId).not.toBeNull();

      const md = generateGraphDocs();
      expect(md).toContain('out:0');
      expect(md).toContain('in:1');
    });

    it('connection with label shows the label', () => {
      const srcId = getState().addNode('source', [0, 0, 0]);
      const mathId = getState().addNode('math', [3, 0, 0]);
      const connId = getState().addConnection(srcId, 0, mathId, 0);
      expect(connId).not.toBeNull();
      getState().updateConnectionLabel(connId!, 'data-flow');

      const md = generateGraphDocs();
      expect(md).toContain('| data-flow |');
    });

    it('connection without label shows empty label cell', () => {
      const srcId = getState().addNode('source', [0, 0, 0]);
      const mathId = getState().addNode('math', [3, 0, 0]);
      const connId = getState().addConnection(srcId, 0, mathId, 0);
      expect(connId).not.toBeNull();

      const md = generateGraphDocs();
      // The row should end with "| |" (empty label cell)
      const connRow = md.split('\n').find((line) => line.includes('out:0'));
      expect(connRow).toBeDefined();
      expect(connRow!).toMatch(/\|\s*\|$/);
    });
  });

  // ── 4. Groups section ──────────────────────────────────────────────

  describe('groups section', () => {
    it('groups section appears when groups exist', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('source', [2, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      getState().createGroup('Inputs');

      const md = generateGraphDocs();
      expect(md).toContain('## Groups (1)');
    });

    it('groups section is absent when no groups exist', () => {
      getState().addNode('source', [0, 0, 0]);
      const md = generateGraphDocs();

      expect(md).not.toContain('## Groups');
    });

    it('group shows correct member count', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('source', [2, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      getState().createGroup('Pair');

      const md = generateGraphDocs();
      expect(md).toContain('**Pair** (2 nodes)');
    });

    it('collapsed group shows "collapsed" flag', () => {
      const n1 = getState().addNode('source', [0, 0, 0]);
      const n2 = getState().addNode('source', [2, 0, 0]);
      getState().setSelection(new Set([n1, n2]));
      const groupId = getState().createGroup('Hidden');
      expect(groupId).toBeTruthy();
      getState().toggleGroupCollapse(groupId!);

      const md = generateGraphDocs();
      expect(md).toContain('collapsed');
      expect(md).toContain('**Hidden** (2 nodes, collapsed)');
    });
  });

  // ── 5. Graph name ──────────────────────────────────────────────────

  describe('graph name', () => {
    it('uses active graph tab name as title', () => {
      getState().renameGraph('default', 'My Workflow');
      const md = generateGraphDocs();

      expect(md).toContain('# My Workflow');
      expect(md).not.toContain('# Main');
    });

    it('defaults to "Untitled Graph" when tab name is missing', () => {
      // Remove the graphTab entry to simulate missing name
      useEditorStore.setState((s) => {
        delete s.graphTabs[s.activeGraphId];
      });
      const md = generateGraphDocs();

      expect(md).toContain('# Untitled Graph');
    });
  });

  // ── 6. Execution order section ─────────────────────────────────────

  describe('execution order', () => {
    it('shows execution order with wave numbering for connected graph', () => {
      const srcId = getState().addNode('source', [0, 0, 0]);
      const mathId = getState().addNode('math', [3, 0, 0]);
      const outId = getState().addNode('output', [6, 0, 0]);

      const c1 = getState().addConnection(srcId, 0, mathId, 0);
      const c2 = getState().addConnection(mathId, 0, outId, 0);
      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();

      const md = generateGraphDocs();
      expect(md).toContain('## Execution Order');
      // Source is wave 1, Math is wave 2, Output is wave 3
      expect(md).toContain('1. Source');
      expect(md).toMatch(/\d+\.\s+Math/);
      expect(md).toMatch(/\d+\.\s+Output/);
    });

    it('shows correct wave count in header', () => {
      const srcId = getState().addNode('source', [0, 0, 0]);
      const mathId = getState().addNode('math', [3, 0, 0]);

      const c1 = getState().addConnection(srcId, 0, mathId, 0);
      expect(c1).not.toBeNull();

      const md = generateGraphDocs();
      expect(md).toContain('## Execution Order (2 waves)');
    });

    it('single wave shows singular "wave"', () => {
      // A single disconnected node is one wave
      getState().addNode('source', [0, 0, 0]);
      const md = generateGraphDocs();
      expect(md).toContain('## Execution Order (1 wave)');
    });

    it('parallel nodes appear in the same wave', () => {
      const src1 = getState().addNode('source', [0, 0, 0]);
      const src2 = getState().addNode('source', [0, 0, 3]);
      const mathId = getState().addNode('math', [4, 0, 1.5]);

      const c1 = getState().addConnection(src1, 0, mathId, 0);
      const c2 = getState().addConnection(src2, 0, mathId, 1);
      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();

      const md = generateGraphDocs();
      // Both sources should be in wave 1
      const wave1Line = md.split('\n').find(l => l.startsWith('1. '));
      expect(wave1Line).toBeDefined();
      expect(wave1Line!).toContain('Source');
      // Both source nodes in wave 1
      const sourceMatches = wave1Line!.match(/Source/g);
      expect(sourceMatches).toHaveLength(2);
    });

    it('empty graph has no execution order section', () => {
      const md = generateGraphDocs();
      expect(md).not.toContain('## Execution Order');
    });

    it('handles cyclic reference gracefully (no execution order section)', () => {
      // Create raw nodes/connections that form a cycle to test the try/catch
      const md = _generateGraphDocs({
        nodes: {
          a: { id: 'a', type: 'source', title: 'A', position: [0, 0, 0], inputs: [], outputs: [], data: {} } as any,
          b: { id: 'b', type: 'source', title: 'B', position: [1, 0, 0], inputs: [], outputs: [], data: {} } as any,
        },
        connections: {
          c1: { id: 'c1', sourceNodeId: 'a', sourcePortIndex: 0, targetNodeId: 'b', targetPortIndex: 0 },
          c2: { id: 'c2', sourceNodeId: 'b', sourcePortIndex: 0, targetNodeId: 'a', targetPortIndex: 0 },
        },
        groups: {},
        graphName: 'Cyclic',
        includeTimestamp: false,
      });

      // topologicalSort throws on cycle — generateGraphDocs catches it gracefully
      expect(md).not.toContain('## Execution Order');
    });
  });

  // ── 7. Node Type Statistics ────────────────────────────────────────

  describe('node type statistics', () => {
    it('shows type statistics section with counts for each type', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().addNode('source', [2, 0, 0]);
      getState().addNode('math', [4, 0, 0]);
      const md = generateGraphDocs();

      expect(md).toContain('## Node Type Statistics (2 types)');
      // source appears 2 times, should be first (sorted by count desc)
      expect(md).toContain('| source | 2 |');
      expect(md).toContain('| math | 1 |');
    });

    it('shows connectivity metrics from graphMetrics', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const math = getState().addNode('math', [4, 0, 0]);
      const out = getState().addNode('output', [8, 0, 0]);
      getState().addConnection(src, 0, math, 0);
      getState().addConnection(math, 0, out, 0);

      const md = generateGraphDocs();
      expect(md).toContain('### Connectivity');
      expect(md).toContain('| Avg connectivity |');
      expect(md).toContain('| Max fan-in |');
      expect(md).toContain('| Max fan-out |');
      expect(md).toContain('| Longest path |');
      expect(md).toContain('| Connected components |');
      expect(md).toContain('| Cyclomatic complexity |');
    });

    it('shows isolated nodes count when there are isolated nodes', () => {
      getState().addNode('source', [0, 0, 0]);
      getState().addNode('source', [2, 0, 0]); // isolated from each other

      const md = generateGraphDocs();
      expect(md).toContain('| Isolated nodes | 2 |');
    });

    it('hides isolated nodes row when none are isolated', () => {
      const src = getState().addNode('source', [0, 0, 0]);
      const math = getState().addNode('math', [4, 0, 0]);
      getState().addConnection(src, 0, math, 0);

      const md = generateGraphDocs();
      expect(md).not.toContain('| Isolated nodes |');
    });

    it('singular "type" label for single type', () => {
      getState().addNode('source', [0, 0, 0]);
      const md = generateGraphDocs();
      expect(md).toContain('## Node Type Statistics (1 type)');
    });

    it('not present for empty graph', () => {
      const md = generateGraphDocs();
      expect(md).not.toContain('## Node Type Statistics');
    });

    it('includes type descriptions', () => {
      getState().addNode('source', [0, 0, 0]);
      const md = generateGraphDocs();
      expect(md).toContain('| source | 1 | Numeric value input |');
    });
  });

  // ── 8. Timestamp option ─────────────────────────────────────────────

  describe('timestamp', () => {
    it('includes timestamp when includeTimestamp is true', () => {
      const state = getState();
      const md = _generateGraphDocs({
        nodes: state.nodes,
        connections: state.connections,
        groups: state.groups,
        graphName: 'Test',
        includeTimestamp: true,
      });
      expect(md).toContain('> Generated');
    });

    it('excludes timestamp when includeTimestamp is false', () => {
      const md = generateGraphDocs(); // uses includeTimestamp: false
      expect(md).not.toContain('> Generated');
    });
  });

  // ── 9. Complex graphs ─────────────────────────────────────────────

  describe('complex graphs', () => {
    it('multi-node connected graph produces complete markdown', () => {
      const src1 = getState().addNode('source', [0, 0, 0]);
      const src2 = getState().addNode('source', [0, 0, 3]);
      const mathId = getState().addNode('math', [4, 0, 1.5]);
      const outId = getState().addNode('output', [8, 0, 1.5]);

      // source1 out:0 -> math in:0
      const c1 = getState().addConnection(src1, 0, mathId, 0);
      // source2 out:0 -> math in:1
      const c2 = getState().addConnection(src2, 0, mathId, 1);
      // math out:0 -> output in:0 (math result is number, output data is any)
      const c3 = getState().addConnection(mathId, 0, outId, 0);

      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();
      expect(c3).not.toBeNull();

      const md = generateGraphDocs();

      // Title
      expect(md).toContain('# Main');

      // Node section
      expect(md).toContain('## Nodes (4)');
      expect(md).toContain(`| ${src1} | source |`);
      expect(md).toContain(`| ${src2} | source |`);
      expect(md).toContain(`| ${mathId} | math |`);
      expect(md).toContain(`| ${outId} | output |`);

      // Connection section
      expect(md).toContain('## Connections (3)');

      // Execution order present
      expect(md).toContain('## Execution Order');

      // No groups section
      expect(md).not.toContain('## Groups');
    });

    it('graph with groups, connections, and varied node types', () => {
      // Create nodes of different types
      const src = getState().addNode('source', [0, 0, 0]);
      const xform = getState().addNode('transform', [4, 0, 0]);
      const out = getState().addNode('output', [8, 0, 0]);

      // Rename for clarity
      getState().updateNodeTitle(src, 'Temperature Sensor');
      getState().updateNodeTitle(xform, 'Scale Converter');
      getState().updateNodeTitle(out, 'Dashboard');

      // Connect: source out:0 -> transform in:0
      const c1 = getState().addConnection(src, 0, xform, 0);
      expect(c1).not.toBeNull();
      getState().updateConnectionLabel(c1!, 'raw-temp');

      // Connect: transform out:0 -> output in:0 (result: number -> data: any)
      const c2 = getState().addConnection(xform, 0, out, 0);
      expect(c2).not.toBeNull();
      getState().updateConnectionLabel(c2!, 'scaled');

      // Create a group with src and xform
      getState().setSelection(new Set([src, xform]));
      const groupId = getState().createGroup('Processing');
      expect(groupId).toBeTruthy();

      getState().renameGraph('default', 'Temperature Pipeline');

      const md = generateGraphDocs();

      // Title
      expect(md).toContain('# Temperature Pipeline');

      // Nodes
      expect(md).toContain('## Nodes (3)');
      expect(md).toContain('| Temperature Sensor |');
      expect(md).toContain('| Scale Converter |');
      expect(md).toContain('| Dashboard |');

      // Node types
      expect(md).toContain('| source |');
      expect(md).toContain('| transform |');
      expect(md).toContain('| output |');

      // Connections with labels
      expect(md).toContain('## Connections (2)');
      expect(md).toContain('| raw-temp |');
      expect(md).toContain('| scaled |');

      // Connection titles (should use node titles, not IDs)
      expect(md).toContain('| Temperature Sensor | out:0 | Scale Converter |');
      expect(md).toContain('| Scale Converter | out:0 | Dashboard |');

      // Group section
      expect(md).toContain('## Groups (1)');
      expect(md).toContain('**Processing** (2 nodes)');

      // Grouped nodes show group label in the node table
      expect(md).toContain('| Processing |');

      // Execution order
      expect(md).toContain('## Execution Order (3 waves)');
    });
  });

  // ── 10. mdCell helper (tested indirectly via generateGraphDocs) ───

  describe('mdCell escaping (via generateGraphDocs)', () => {
    it('escapes pipe characters in node titles', () => {
      const md = _generateGraphDocs({
        nodes: {
          n1: {
            id: 'n1', type: 'source', title: 'A|B|C', position: [0, 0, 0],
            inputs: [], outputs: [], data: {},
          } as any,
        },
        connections: {},
        groups: {},
        graphName: 'Test',
        includeTimestamp: false,
      });
      // Pipes in the title should be escaped to \|
      expect(md).toContain('A\\|B\\|C');
      // Should not contain an unescaped pipe-delimited "A|B|C"
      expect(md).not.toMatch(/\| A\|B\|C \|/);
    });

    it('escapes newlines in node comments', () => {
      const md = _generateGraphDocs({
        nodes: {
          n1: {
            id: 'n1', type: 'source', title: 'Node', position: [0, 0, 0],
            inputs: [], outputs: [], data: {},
            comment: 'line1\nline2',
          } as any,
        },
        connections: {},
        groups: {},
        graphName: 'Test',
        includeTimestamp: false,
      });
      // Newlines in comments should be replaced with spaces
      expect(md).toContain('line1 line2');
      expect(md).not.toContain('line1\nline2');
    });

    it('handles empty strings gracefully in comments', () => {
      const md = _generateGraphDocs({
        nodes: {
          n1: {
            id: 'n1', type: 'source', title: 'Node', position: [0, 0, 0],
            inputs: [], outputs: [], data: {},
            comment: '',
          } as any,
        },
        connections: {},
        groups: {},
        graphName: 'Test',
        includeTimestamp: false,
      });
      // Should produce valid markdown without errors
      expect(md).toContain('## Nodes (1)');
      // The comment column should be empty (row ends with "| |")
      const nodeRow = md.split('\n').find(l => l.includes('| n1 |'));
      expect(nodeRow).toBeDefined();
      expect(nodeRow!).toMatch(/\|\s*\|$/);
    });

    it('handles null/undefined comment gracefully', () => {
      const md = _generateGraphDocs({
        nodes: {
          n1: {
            id: 'n1', type: 'source', title: 'Node', position: [0, 0, 0],
            inputs: [], outputs: [], data: {},
            // comment is undefined
          } as any,
        },
        connections: {},
        groups: {},
        graphName: 'Test',
        includeTimestamp: false,
      });
      // Should produce valid markdown without errors
      expect(md).toContain('## Nodes (1)');
    });
  });

  // ── 11. generateMermaidDiagram ────────────────────────────────────

  describe('generateMermaidDiagram', () => {
    it('empty graph produces basic Mermaid header', () => {
      const diagram = generateMermaidDiagram({}, {}, {});
      expect(diagram).toBe('graph LR');
    });

    it('single node produces node declaration', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const diagram = generateMermaidDiagram(nodes, {}, {});
      expect(diagram).toContain('graph LR');
      expect(diagram).toContain('  n1["Source"]');
    });

    it('connected nodes produce edge declarations', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
        n2: {
          id: 'n2', type: 'output' as const, title: 'Output', position: [3, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const connections = {
        c1: { id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 0, targetNodeId: 'n2', targetPortIndex: 0 },
      };
      const diagram = generateMermaidDiagram(nodes, connections, {});
      expect(diagram).toContain('  n1 --> n2');
    });

    it('multiple connections from same node', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
        n2: {
          id: 'n2', type: 'math' as const, title: 'Math', position: [3, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
        n3: {
          id: 'n3', type: 'output' as const, title: 'Output', position: [3, 0, 3] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const connections = {
        c1: { id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 0, targetNodeId: 'n2', targetPortIndex: 0 },
        c2: { id: 'c2', sourceNodeId: 'n1', sourcePortIndex: 0, targetNodeId: 'n3', targetPortIndex: 0 },
      };
      const diagram = generateMermaidDiagram(nodes, connections, {});
      expect(diagram).toContain('  n1 --> n2');
      expect(diagram).toContain('  n1 --> n3');
    });

    it('node titles with special Mermaid characters are escaped', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Node "A" [test] {data} (#1)', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const diagram = generateMermaidDiagram(nodes, {}, {});
      // Quotes should become single quotes; brackets, braces, parens, # & should become spaces
      // Input: Node "A" [test] {data} (#1)
      // " -> ', [ ] { } ( ) # -> space each
      expect(diagram).toContain("n1[\"Node 'A'  test   data    1 \"]");
      // Original special chars should not appear
      expect(diagram).not.toContain('"A"');
      expect(diagram).not.toContain('[test]');
      expect(diagram).not.toContain('{data}');
    });

    it('groups generate subgraph sections', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {}, groupId: 'g1',
        },
        n2: {
          id: 'n2', type: 'math' as const, title: 'Math', position: [3, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {}, groupId: 'g1',
        },
      };
      const groups = {
        g1: { id: 'g1', label: 'Processing', collapsed: false },
      };
      const diagram = generateMermaidDiagram(nodes, {}, groups);
      expect(diagram).toContain('  subgraph g1["Processing"]');
      expect(diagram).toContain('    n1');
      expect(diagram).toContain('    n2');
      expect(diagram).toContain('  end');
    });

    it('handles isolated nodes (no connections)', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Isolated A', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
        n2: {
          id: 'n2', type: 'source' as const, title: 'Isolated B', position: [3, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const diagram = generateMermaidDiagram(nodes, {}, {});
      expect(diagram).toContain('  n1["Isolated A"]');
      expect(diagram).toContain('  n2["Isolated B"]');
      // No arrow lines
      expect(diagram).not.toContain('-->');
    });

    it('direction defaults to LR (left-to-right)', () => {
      const diagram = generateMermaidDiagram({}, {}, {});
      expect(diagram).toMatch(/^graph LR/);
    });

    it('connection labels appear in edge declarations', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
        n2: {
          id: 'n2', type: 'output' as const, title: 'Output', position: [3, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const connections = {
        c1: { id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 0, targetNodeId: 'n2', targetPortIndex: 0, label: 'data flow' },
      };
      const diagram = generateMermaidDiagram(nodes, connections, {});
      expect(diagram).toContain('  n1 -->|"data flow"| n2');
    });

    it('connection without label produces plain edge', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
        n2: {
          id: 'n2', type: 'output' as const, title: 'Output', position: [3, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const connections = {
        c1: { id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 0, targetNodeId: 'n2', targetPortIndex: 0 },
      };
      const diagram = generateMermaidDiagram(nodes, connections, {});
      expect(diagram).toContain('  n1 --> n2');
      expect(diagram).not.toContain('-->|');
    });

    it('sanitizes node IDs with special characters', () => {
      const nodes = {
        'node-1': {
          id: 'node-1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
        'node.2': {
          id: 'node.2', type: 'output' as const, title: 'Output', position: [3, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const connections = {
        c1: { id: 'c1', sourceNodeId: 'node-1', sourcePortIndex: 0, targetNodeId: 'node.2', targetPortIndex: 0 },
      };
      const diagram = generateMermaidDiagram(nodes, connections, {});
      // Hyphens and dots should be replaced with underscores
      expect(diagram).toContain('node_1["Source"]');
      expect(diagram).toContain('node_2["Output"]');
      expect(diagram).toContain('  node_1 --> node_2');
    });

    it('empty group (no members) does not produce subgraph section', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
          // No groupId — not a member of g1
        },
      };
      const groups = {
        g1: { id: 'g1', label: 'Empty Group', collapsed: false },
      };
      const diagram = generateMermaidDiagram(nodes, {}, groups);
      expect(diagram).not.toContain('subgraph');
      expect(diagram).not.toContain('end');
    });

    it('connection label with special Mermaid characters is escaped', () => {
      const nodes = {
        n1: {
          id: 'n1', type: 'source' as const, title: 'Source', position: [0, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
        n2: {
          id: 'n2', type: 'output' as const, title: 'Output', position: [3, 0, 0] as [number, number, number],
          inputs: [], outputs: [], data: {},
        },
      };
      const connections = {
        c1: { id: 'c1', sourceNodeId: 'n1', sourcePortIndex: 0, targetNodeId: 'n2', targetPortIndex: 0, label: 'val[0]' },
      };
      const diagram = generateMermaidDiagram(nodes, connections, {});
      // Brackets should be escaped to spaces
      expect(diagram).toContain('-->|"val 0 "| n2');
      expect(diagram).not.toContain('[0]');
    });
  });
});
