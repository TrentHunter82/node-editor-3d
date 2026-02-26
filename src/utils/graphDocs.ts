/**
 * Pure utility for generating graph documentation as Markdown.
 * Extracted from Toolbar.tsx handleExportDocs for testability.
 */
import type { EditorNode, Connection, NodeGroup, ExecutionStats } from '../types';
import { topologicalSort } from './execution';
import { getGraphComplexity } from './graphMetrics';
import { TYPE_DESCRIPTIONS } from '../types/nodeLabels';

/** Escape pipe characters for Markdown table cells */
const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export interface GraphDocsOptions {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups: Record<string, NodeGroup>;
  graphName: string;
  /** When true, include a timestamp line. Default: true */
  includeTimestamp?: boolean;
  /** When true, include a Mermaid flowchart diagram. Default: false */
  includeMermaid?: boolean;
  /** Optional execution statistics to include in the docs */
  executionStats?: ExecutionStats;
}

/**
 * Generate markdown documentation from graph state.
 * Returns the complete markdown string.
 */
export function generateGraphDocs(opts: GraphDocsOptions): string {
  const { nodes, connections, groups, graphName, includeTimestamp = true, includeMermaid = false, executionStats } = opts;

  const lines: string[] = [];
  lines.push(`# ${graphName}`);
  lines.push('');

  if (includeTimestamp) {
    lines.push(`> Generated ${new Date().toLocaleString()}`);
    lines.push('');
  }

  // Node inventory table (with Description column)
  const nodeList = Object.values(nodes);
  lines.push(`## Nodes (${nodeList.length})`);
  lines.push('');
  if (nodeList.length > 0) {
    lines.push('| ID | Type | Title | Description | Position | Group | Comment |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const node of nodeList) {
      const groupLabel =
        node.groupId && groups[node.groupId]
          ? groups[node.groupId].label
          : '';
      const pos = `(${node.position[0].toFixed(1)}, ${node.position[1].toFixed(1)}, ${node.position[2].toFixed(1)})`;
      const desc = TYPE_DESCRIPTIONS[node.type] ?? '';
      lines.push(
        `| ${mdCell(node.id)} | ${mdCell(node.type)} | ${mdCell(node.title)} | ${mdCell(desc)} | ${pos} | ${mdCell(groupLabel)} | ${mdCell(node.comment ?? '')} |`,
      );
    }
  } else {
    lines.push('*No nodes*');
  }
  lines.push('');

  // Connection adjacency list
  const connList = Object.values(connections);
  lines.push(`## Connections (${connList.length})`);
  lines.push('');
  if (connList.length > 0) {
    lines.push('| Source | Port | Target | Port | Label |');
    lines.push('|---|---|---|---|---|');
    for (const conn of connList) {
      const srcTitle = nodes[conn.sourceNodeId]?.title ?? conn.sourceNodeId;
      const tgtTitle = nodes[conn.targetNodeId]?.title ?? conn.targetNodeId;
      lines.push(
        `| ${mdCell(srcTitle)} | out:${conn.sourcePortIndex} | ${mdCell(tgtTitle)} | in:${conn.targetPortIndex} | ${mdCell(conn.label ?? '')} |`,
      );
    }
  } else {
    lines.push('*No connections*');
  }
  lines.push('');

  // Groups summary (with descriptions)
  const groupList = Object.values(groups);
  if (groupList.length > 0) {
    lines.push(`## Groups (${groupList.length})`);
    lines.push('');
    for (const g of groupList) {
      const memberCount = nodeList.filter((n) => n.groupId === g.id).length;
      let line = `- **${g.label}** (${memberCount} nodes${g.collapsed ? ', collapsed' : ''})`;
      if (g.description) {
        line += ` — ${g.description}`;
      }
      lines.push(line);
    }
    lines.push('');
  }

  // Execution order (topological sort — may throw on cyclic graphs)
  let waves: string[][] = [];
  try {
    waves = topologicalSort(nodes, connections);
  } catch {
    // Cyclic graph — execution order unavailable
  }
  if (waves.length > 0) {
    lines.push(`## Execution Order (${waves.length} wave${waves.length > 1 ? 's' : ''})`);
    lines.push('');
    for (let i = 0; i < waves.length; i++) {
      const waveNodes = waves[i].map((id) => nodes[id]?.title ?? id).join(', ');
      lines.push(`${i + 1}. ${waveNodes}`);
    }
    lines.push('');
  }

  // Node type statistics
  if (nodeList.length > 0) {
    const typeCounts = new Map<string, number>();
    for (const node of nodeList) {
      typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
    }
    // Sort by count descending, then alphabetically
    const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    lines.push(`## Node Type Statistics (${sorted.length} type${sorted.length > 1 ? 's' : ''})`);
    lines.push('');
    lines.push('| Type | Count | Description |');
    lines.push('|---|---|---|');
    for (const [type, count] of sorted) {
      const desc = TYPE_DESCRIPTIONS[type] ?? '';
      lines.push(`| ${type} | ${count} | ${desc} |`);
    }
    lines.push('');

    // Graph connectivity summary from graphMetrics
    const complexity = getGraphComplexity(nodes, connections);
    lines.push('### Connectivity');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Avg connectivity | ${complexity.avgConnectivity} |`);
    lines.push(`| Max fan-in | ${complexity.maxFanIn} |`);
    lines.push(`| Max fan-out | ${complexity.maxFanOut} |`);
    lines.push(`| Longest path | ${complexity.longestPath} |`);
    lines.push(`| Connected components | ${complexity.connectedComponents} |`);
    if (complexity.isolatedNodes > 0) {
      lines.push(`| Isolated nodes | ${complexity.isolatedNodes} |`);
    }
    lines.push(`| Cyclomatic complexity | ${complexity.cyclomaticComplexity} |`);
    lines.push('');
  }

  // Execution statistics summary
  if (executionStats && executionStats.executionCount > 0) {
    lines.push('## Execution Statistics');
    lines.push('');
    const avgDuration = executionStats.totalDuration / executionStats.executionCount;
    const cacheHitRate = executionStats.totalNodesExecuted > 0
      ? ((executionStats.totalCacheHits / executionStats.totalNodesExecuted) * 100).toFixed(1)
      : '0.0';
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Total executions | ${executionStats.executionCount} |`);
    lines.push(`| Total duration | ${executionStats.totalDuration.toFixed(1)}ms |`);
    lines.push(`| Average duration | ${avgDuration.toFixed(1)}ms |`);
    lines.push(`| Errors | ${executionStats.errorCount} |`);
    lines.push(`| Cache hit rate | ${cacheHitRate}% |`);
    if (executionStats.lastExecutedAt) {
      lines.push(`| Last executed | ${new Date(executionStats.lastExecutedAt).toLocaleString()} |`);
    }
    lines.push('');
  }

  // Mermaid flowchart diagram
  if (includeMermaid && nodeList.length > 0) {
    lines.push('## Flowchart');
    lines.push('');
    lines.push('```mermaid');
    lines.push('graph LR');
    // Node definitions with sanitized IDs
    for (const node of nodeList) {
      const safeId = sanitizeMermaidId(node.id);
      const label = escapeMermaidLabel(node.title);
      lines.push(`  ${safeId}["${label}"]`);
    }
    // Connection edges
    for (const conn of connList) {
      const srcId = sanitizeMermaidId(conn.sourceNodeId);
      const tgtId = sanitizeMermaidId(conn.targetNodeId);
      if (conn.label) {
        lines.push(`  ${srcId} -->|"${escapeMermaidLabel(conn.label)}"| ${tgtId}`);
      } else {
        lines.push(`  ${srcId} --> ${tgtId}`);
      }
    }
    // Group subgraphs
    for (const g of groupList) {
      const members = nodeList.filter(n => n.groupId === g.id);
      if (members.length > 0) {
        lines.push(`  subgraph ${sanitizeMermaidId(g.id)}["${escapeMermaidLabel(g.label)}"]`);
        for (const m of members) {
          lines.push(`    ${sanitizeMermaidId(m.id)}`);
        }
        lines.push('  end');
      }
    }
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/** Sanitize a node/group ID for use as a Mermaid node identifier */
function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** Escape special characters in a Mermaid label */
function escapeMermaidLabel(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\]{}()#&]/g, ' ');
}

/**
 * Generate a Mermaid diagram string (standalone, without markdown fences).
 * Useful for embedding in other contexts.
 */
export function generateMermaidDiagram(
  nodes: Record<string, EditorNode>,
  connections: Record<string, Connection>,
  groups: Record<string, NodeGroup>,
): string {
  const lines: string[] = ['graph LR'];
  const nodeList = Object.values(nodes);
  const connList = Object.values(connections);
  const groupList = Object.values(groups);

  for (const node of nodeList) {
    const safeId = sanitizeMermaidId(node.id);
    const label = escapeMermaidLabel(node.title);
    lines.push(`  ${safeId}["${label}"]`);
  }
  for (const conn of connList) {
    const srcId = sanitizeMermaidId(conn.sourceNodeId);
    const tgtId = sanitizeMermaidId(conn.targetNodeId);
    if (conn.label) {
      lines.push(`  ${srcId} -->|"${escapeMermaidLabel(conn.label)}"| ${tgtId}`);
    } else {
      lines.push(`  ${srcId} --> ${tgtId}`);
    }
  }
  for (const g of groupList) {
    const members = nodeList.filter(n => n.groupId === g.id);
    if (members.length > 0) {
      lines.push(`  subgraph ${sanitizeMermaidId(g.id)}["${escapeMermaidLabel(g.label)}"]`);
      for (const m of members) {
        lines.push(`    ${sanitizeMermaidId(m.id)}`);
      }
      lines.push('  end');
    }
  }
  return lines.join('\n');
}
