/**
 * Pure utility for generating an SVG representation of the node graph.
 * Projects 3D node positions (XZ plane) to 2D SVG coordinates.
 */
import type { EditorNode, Connection, NodeGroup, NodeType, PortType } from '../types';
import { NODE_TYPE_CONFIG, PORT_TYPE_COLORS } from '../types';
import { TYPE_LABELS } from '../types/nodeLabels';

// ── Constants ────────────────────────────────────────────────────────────

/** Default node width in world units */
const DEFAULT_W = 1.6;
/** Default node depth (height in XZ plane) in world units */
const DEFAULT_D = 0.8;
/** World-unit to SVG-pixel scale factor */
const SCALE = 100;
/** Padding around the viewBox in SVG pixels */
const PADDING = 60;
/** Node corner radius */
const CORNER_R = 8;
/** Port dot radius */
const PORT_R = 5;
/** Title bar height in SVG pixels */
const TITLE_H = 24;
/** Font size for node title */
const TITLE_FONT = 11;
/** Font size for port labels */
const PORT_FONT = 8;

/** Resolve the NODE_TYPE_CONFIG color key to a hex color for SVG */
const COLOR_MAP: Record<string, string> = {
  teal: '#2dd4bf',
  orange: '#fb923c',
  coral: '#f87171',
  'teal-coral': '#a78bfa',
};

// ── Types ────────────────────────────────────────────────────────────────

export interface GenerateSVGOptions {
  nodes: Record<string, EditorNode>;
  connections: Record<string, Connection>;
  groups: Record<string, NodeGroup>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Escape XML special characters */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Project a 3D position [x, y, z] to 2D SVG [px, py] (using X and Z) */
function project(pos: [number, number, number]): [number, number] {
  return [pos[0] * SCALE, pos[2] * SCALE];
}

/** Get the SVG rect (top-left corner) for a node */
function nodeRect(node: EditorNode): { x: number; y: number; w: number; h: number } {
  const [cx, cy] = project(node.position);
  const w = (node.width ?? DEFAULT_W) * SCALE;
  const h = (node.height ?? DEFAULT_D) * SCALE;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Compute the SVG position of a port on a node edge */
function portPos(
  node: EditorNode,
  side: 'input' | 'output',
  portIndex: number,
  portCount: number,
): [number, number] {
  const r = nodeRect(node);
  const x = side === 'output' ? r.x + r.w : r.x;
  if (portCount <= 1) {
    return [x, r.y + r.h / 2];
  }
  // Distribute ports evenly along the node height with some margin
  const margin = 10;
  const usableH = r.h - margin * 2;
  const y = r.y + margin + (portIndex / (portCount - 1)) * usableH;
  return [x, y];
}

/** Get hex color for a node type from NODE_TYPE_CONFIG */
function nodeColor(type: NodeType): string {
  const cfg = NODE_TYPE_CONFIG[type];
  if (!cfg) return COLOR_MAP.teal;
  return COLOR_MAP[cfg.color] ?? COLOR_MAP.teal;
}

/** Get display label for a node type */
function nodeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** Get hex color for a port type */
function portColor(pt: PortType): string {
  return PORT_TYPE_COLORS[pt] ?? PORT_TYPE_COLORS.any;
}

// ── Main generator ───────────────────────────────────────────────────────

/**
 * Generate a complete SVG document string from graph data.
 * Pure function with no store dependency.
 */
export function generateSVG(opts: GenerateSVGOptions): string {
  const { nodes, connections, groups } = opts;
  const nodeList = Object.values(nodes);
  const connList = Object.values(connections);
  const groupList = Object.values(groups);

  // Handle empty graph
  if (nodeList.length === 0) {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">',
      '  <text x="100" y="50" text-anchor="middle" fill="#888" font-family="sans-serif" font-size="14">Empty graph</text>',
      '</svg>',
    ].join('\n');
  }

  // ── Compute viewBox ──────────────────────────────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const node of nodeList) {
    const r = nodeRect(node);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }

  const vx = minX - PADDING;
  const vy = minY - PADDING;
  const vw = maxX - minX + PADDING * 2;
  const vh = maxY - minY + PADDING * 2;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">`,
  );

  // ── Defs (drop shadow) ──────────────────────────────────────────────
  lines.push('  <defs>');
  lines.push('    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">');
  lines.push('      <feDropShadow dx="1" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.3"/>');
  lines.push('    </filter>');
  lines.push('  </defs>');

  // ── Background ──────────────────────────────────────────────────────
  lines.push(`  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#1a1a2e" rx="0"/>`);

  // ── Groups (background rects) ───────────────────────────────────────
  // Build a map from groupId to member nodes so we can draw group bounds
  const groupMembers: Record<string, EditorNode[]> = {};
  for (const node of nodeList) {
    if (node.groupId) {
      if (!groupMembers[node.groupId]) groupMembers[node.groupId] = [];
      groupMembers[node.groupId].push(node);
    }
  }

  for (const group of groupList) {
    const members = groupMembers[group.id];
    if (!members || members.length === 0) continue;

    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    for (const m of members) {
      const r = nodeRect(m);
      gMinX = Math.min(gMinX, r.x);
      gMinY = Math.min(gMinY, r.y);
      gMaxX = Math.max(gMaxX, r.x + r.w);
      gMaxY = Math.max(gMaxY, r.y + r.h);
    }

    const gPad = 20;
    const labelH = 18;
    const gx = gMinX - gPad;
    const gy = gMinY - gPad - labelH;
    const gw = gMaxX - gMinX + gPad * 2;
    const gh = gMaxY - gMinY + gPad * 2 + labelH;
    const groupColor = esc(group.color ?? '#4a5568');

    lines.push(`  <rect x="${gx}" y="${gy}" width="${gw}" height="${gh}" rx="6" fill="${groupColor}" fill-opacity="0.12" stroke="${groupColor}" stroke-opacity="0.35" stroke-width="1"/>`);
    lines.push(`  <text x="${gx + 8}" y="${gy + 13}" font-family="sans-serif" font-size="10" fill="${groupColor}" fill-opacity="0.7">${esc(group.label)}</text>`);
  }

  // ── Connections (bezier paths) ──────────────────────────────────────
  // Build a node lookup for fast access
  const nodeMap = nodes;

  for (const conn of connList) {
    const srcNode = nodeMap[conn.sourceNodeId];
    const tgtNode = nodeMap[conn.targetNodeId];
    if (!srcNode || !tgtNode) continue;

    const srcPortCount = srcNode.outputs.length;
    const tgtPortCount = tgtNode.inputs.length;
    if (srcPortCount === 0 || tgtPortCount === 0) continue;

    const [sx, sy] = portPos(srcNode, 'output', conn.sourcePortIndex, srcPortCount);
    const [tx, ty] = portPos(tgtNode, 'input', conn.targetPortIndex, tgtPortCount);

    // Cubic bezier with horizontal control handles
    const dx = Math.abs(tx - sx) * 0.5;
    const cx1 = sx + dx;
    const cy1 = sy;
    const cx2 = tx - dx;
    const cy2 = ty;

    // Determine color from source port type (escape for SVG attribute safety)
    const srcPort = srcNode.outputs[conn.sourcePortIndex];
    const color = esc(conn.colorOverride
      ?? (srcPort ? portColor(srcPort.portType) : PORT_TYPE_COLORS.any));

    lines.push(
      `  <path d="M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tx} ${ty}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="0.7"/>`,
    );
  }

  // ── Nodes ───────────────────────────────────────────────────────────
  for (const node of nodeList) {
    const r = nodeRect(node);
    const color = nodeColor(node.type);
    const title = node.title || nodeLabel(node.type);

    // Node body with shadow
    lines.push(`  <g filter="url(#shadow)">`);
    // Background rect
    lines.push(`    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${CORNER_R}" fill="#252540" stroke="${color}" stroke-width="1.5"/>`);
    // Title bar
    lines.push(`    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${TITLE_H}" rx="${CORNER_R}" fill="${color}" fill-opacity="0.25"/>`);
    // Clip the bottom corners of the title bar so they don't overlap the rounded body
    lines.push(`    <rect x="${r.x}" y="${r.y + TITLE_H - CORNER_R}" width="${r.w}" height="${CORNER_R}" fill="${color}" fill-opacity="0.25"/>`);
    // Title text
    lines.push(`    <text x="${r.x + r.w / 2}" y="${r.y + TITLE_H - 7}" text-anchor="middle" font-family="sans-serif" font-size="${TITLE_FONT}" font-weight="600" fill="#e2e8f0">${esc(title)}</text>`);
    lines.push(`  </g>`);

    // Input ports
    const inputs = node.inputs;
    for (let i = 0; i < inputs.length; i++) {
      const [px, py] = portPos(node, 'input', i, inputs.length);
      const pc = portColor(inputs[i].portType);
      lines.push(`  <circle cx="${px}" cy="${py}" r="${PORT_R}" fill="${pc}" stroke="#1a1a2e" stroke-width="1.5"/>`);
      // Port label (right-aligned from port dot)
      lines.push(`  <text x="${px + PORT_R + 4}" y="${py + 3}" font-family="sans-serif" font-size="${PORT_FONT}" fill="#a0aec0">${esc(inputs[i].label)}</text>`);
    }

    // Output ports
    const outputs = node.outputs;
    for (let i = 0; i < outputs.length; i++) {
      const [px, py] = portPos(node, 'output', i, outputs.length);
      const pc = portColor(outputs[i].portType);
      lines.push(`  <circle cx="${px}" cy="${py}" r="${PORT_R}" fill="${pc}" stroke="#1a1a2e" stroke-width="1.5"/>`);
      // Port label (left-aligned from port dot)
      lines.push(`  <text x="${px - PORT_R - 4}" y="${py + 3}" text-anchor="end" font-family="sans-serif" font-size="${PORT_FONT}" fill="#a0aec0">${esc(outputs[i].label)}</text>`);
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}

// ── Download helper ──────────────────────────────────────────────────────

/**
 * Create a Blob from an SVG string and trigger a browser download.
 */
export function downloadSVG(svgString: string, filename = 'graph-export.svg'): void {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
