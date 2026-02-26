import { describe, it, expect } from 'vitest';
import { generateSVG } from './svgExport';
import type { EditorNode, Connection, NodeGroup, PortDef } from '../types';
import { PORT_TYPE_COLORS } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a minimal EditorNode with sensible defaults */
function makeNode(
  overrides: Partial<EditorNode> & { id: string; type: EditorNode['type'] },
): EditorNode {
  return {
    position: [0, 0, 0],
    title: '',
    data: {},
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

/** Create a Connection */
function makeConn(
  id: string,
  sourceNodeId: string,
  sourcePortIndex: number,
  targetNodeId: string,
  targetPortIndex: number,
  extra?: Partial<Connection>,
): Connection {
  return { id, sourceNodeId, sourcePortIndex, targetNodeId, targetPortIndex, ...extra };
}

/** Create a PortDef shorthand */
function port(label: string, portType: PortDef['portType'] = 'number'): PortDef {
  return { id: label, label, portType };
}

/** Create a NodeGroup */
function makeGroup(overrides: Partial<NodeGroup> & { id: string; label: string }): NodeGroup {
  return { collapsed: false, ...overrides };
}

/** Empty-graph options shorthand */
const EMPTY_OPTS = { nodes: {}, connections: {}, groups: {} };

// ── Constants from the source (for assertion calculations) ───────────────
const SCALE = 100;
const DEFAULT_W = 1.6;
const DEFAULT_D = 0.8;
const PADDING = 60;

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe('generateSVG', () => {
  // ── 1. Empty graph ──────────────────────────────────────────────────
  describe('empty graph', () => {
    it('returns valid SVG with "Empty graph" text when no nodes are provided', () => {
      const svg = generateSVG(EMPTY_OPTS);
      expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('Empty graph');
      expect(svg).toContain('</svg>');
    });

    it('uses a fixed small viewBox for empty graphs', () => {
      const svg = generateSVG(EMPTY_OPTS);
      expect(svg).toContain('viewBox="0 0 200 100"');
    });

    it('ignores connections and groups when no nodes exist', () => {
      const svg = generateSVG({
        nodes: {},
        connections: { c1: makeConn('c1', 'a', 0, 'b', 0) },
        groups: { g1: makeGroup({ id: 'g1', label: 'Ghost Group' }) },
      });
      expect(svg).toContain('Empty graph');
      expect(svg).not.toContain('Ghost Group');
    });
  });

  // ── 2. XML/SVG structure ────────────────────────────────────────────
  describe('SVG structure', () => {
    const singleNode = {
      nodes: {
        n1: makeNode({
          id: 'n1',
          type: 'source',
          position: [0, 0, 0],
          outputs: [port('value')],
        }),
      },
      connections: {},
      groups: {},
    };

    it('starts with XML declaration', () => {
      const svg = generateSVG(singleNode);
      expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    });

    it('has an opening <svg> tag with xmlns attribute', () => {
      const svg = generateSVG(singleNode);
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    });

    it('closes with </svg>', () => {
      const svg = generateSVG(singleNode);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    });

    it('contains a <defs> section with a shadow filter', () => {
      const svg = generateSVG(singleNode);
      expect(svg).toContain('<defs>');
      expect(svg).toContain('filter id="shadow"');
      expect(svg).toContain('feDropShadow');
      expect(svg).toContain('</defs>');
    });

    it('contains a background <rect> element', () => {
      const svg = generateSVG(singleNode);
      expect(svg).toContain('fill="#1a1a2e"');
    });
  });

  // ── 3. Single node ─────────────────────────────────────────────────
  describe('single node rendering', () => {
    it('renders a node body rect with default dimensions', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0] }),
        },
        connections: {},
        groups: {},
      });

      const expectedW = DEFAULT_W * SCALE; // 160
      const expectedH = DEFAULT_D * SCALE; // 80
      // The node rect should have the right dimensions
      expect(svg).toContain(`width="${expectedW}"`);
      expect(svg).toContain(`height="${expectedH}"`);
    });

    it('uses the node title when provided', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', title: 'My Source' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('My Source');
    });

    it('falls back to TYPE_LABELS label when title is empty', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'math', title: '' }),
        },
        connections: {},
        groups: {},
      });
      // TYPE_LABELS['math'] === 'Math'
      expect(svg).toContain('>Math</text>');
    });

    it('applies the correct node color from NODE_TYPE_CONFIG', () => {
      // 'source' has color 'teal' which maps to '#2dd4bf'
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('#2dd4bf');
    });

    it('applies the correct node color for orange type nodes', () => {
      // 'math' has color 'orange' -> '#fb923c'
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'math' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('#fb923c');
    });

    it('applies the correct node color for coral type nodes', () => {
      // 'filter' has color 'coral' -> '#f87171'
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'filter' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('#f87171');
    });

    it('applies the correct node color for teal-coral type nodes', () => {
      // 'output' has color 'teal-coral' -> '#a78bfa'
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'output' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('#a78bfa');
    });
  });

  // ── 4. 3D to 2D projection ────────────────────────────────────────
  describe('3D to 2D projection (XZ plane)', () => {
    it('projects node.position[0] (X) to SVG X and position[2] (Z) to SVG Y', () => {
      // Node at position [2, 5, 3] -> SVG center at (200, 300)
      // with default width 160 and height 80, top-left is (120, 260)
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [2, 5, 3] }),
        },
        connections: {},
        groups: {},
      });

      const cx = 2 * SCALE;  // 200
      const cy = 3 * SCALE;  // 300
      const halfW = (DEFAULT_W * SCALE) / 2; // 80
      const halfH = (DEFAULT_D * SCALE) / 2; // 40
      const expectedX = cx - halfW; // 120
      const expectedY = cy - halfH; // 260

      expect(svg).toContain(`x="${expectedX}"`);
      expect(svg).toContain(`y="${expectedY}"`);
    });

    it('ignores the Y coordinate (up axis) entirely', () => {
      // Two nodes differing only in Y should produce identical rects
      const makeOpts = (y: number) => ({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [1, y, 2] }),
        },
        connections: {},
        groups: {},
      });

      const svg1 = generateSVG(makeOpts(0));
      const svg2 = generateSVG(makeOpts(100));
      // Strip the XML/SVG outer wrapper that might have different viewBox
      // The node-specific <g> element contents should be the same
      expect(svg1).toBe(svg2);
    });
  });

  // ── 5. Custom node dimensions ──────────────────────────────────────
  describe('custom node dimensions', () => {
    it('uses custom width when specified', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0], width: 3.0 }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain(`width="${3.0 * SCALE}"`); // 300
    });

    it('uses custom height when specified', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0], height: 2.0 }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain(`height="${2.0 * SCALE}"`); // 200
    });

    it('node rect position adjusts to custom dimensions (centered)', () => {
      const customW = 4.0;
      const customH = 2.0;
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            position: [0, 0, 0],
            width: customW,
            height: customH,
          }),
        },
        connections: {},
        groups: {},
      });

      const halfW = (customW * SCALE) / 2; // 200
      const halfH = (customH * SCALE) / 2; // 100
      // center at (0,0) -> top-left at (-200, -100)
      expect(svg).toContain(`x="${-halfW}"`);
      expect(svg).toContain(`y="${-halfH}"`);
    });
  });

  // ── 6. ViewBox calculation ─────────────────────────────────────────
  describe('viewBox', () => {
    it('pads the viewBox around the node bounds', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0] }),
        },
        connections: {},
        groups: {},
      });

      const halfW = (DEFAULT_W * SCALE) / 2;
      const halfH = (DEFAULT_D * SCALE) / 2;
      const expectedVx = -halfW - PADDING;
      const expectedVy = -halfH - PADDING;
      const expectedVw = DEFAULT_W * SCALE + PADDING * 2;
      const expectedVh = DEFAULT_D * SCALE + PADDING * 2;

      expect(svg).toContain(
        `viewBox="${expectedVx} ${expectedVy} ${expectedVw} ${expectedVh}"`,
      );
    });

    it('expands viewBox to contain multiple nodes', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [-5, 0, -5] }),
          n2: makeNode({ id: 'n2', type: 'source', position: [5, 0, 5] }),
        },
        connections: {},
        groups: {},
      });

      // n1 rect: left = -500 - 80 = -580, top = -500 - 40 = -540
      // n2 rect: right = 500 + 80 = 580, bottom = 500 + 40 = 540
      const halfW = (DEFAULT_W * SCALE) / 2;
      const halfH = (DEFAULT_D * SCALE) / 2;
      const minX = -5 * SCALE - halfW;
      const minY = -5 * SCALE - halfH;
      const maxX = 5 * SCALE + halfW;
      const maxY = 5 * SCALE + halfH;

      const vx = minX - PADDING;
      const vy = minY - PADDING;
      const vw = maxX - minX + PADDING * 2;
      const vh = maxY - minY + PADDING * 2;

      expect(svg).toContain(`viewBox="${vx} ${vy} ${vw} ${vh}"`);
    });
  });

  // ── 7. Port rendering ──────────────────────────────────────────────
  describe('port rendering', () => {
    it('renders input port circles', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'math',
            inputs: [port('a', 'number'), port('b', 'number')],
            outputs: [port('result', 'number')],
          }),
        },
        connections: {},
        groups: {},
      });

      // Should have circle elements for the ports
      const circleCount = (svg.match(/<circle /g) || []).length;
      // 2 inputs + 1 output = 3 circles
      expect(circleCount).toBe(3);
    });

    it('renders port labels as text elements', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'math',
            inputs: [port('alpha')],
            outputs: [port('beta')],
          }),
        },
        connections: {},
        groups: {},
      });

      expect(svg).toContain('>alpha</text>');
      expect(svg).toContain('>beta</text>');
    });

    it('colors ports according to PORT_TYPE_COLORS', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            inputs: [port('in', 'string')],
            outputs: [port('out', 'boolean')],
          }),
        },
        connections: {},
        groups: {},
      });

      expect(svg).toContain(`fill="${PORT_TYPE_COLORS.string}"`);
      expect(svg).toContain(`fill="${PORT_TYPE_COLORS.boolean}"`);
    });

    it('positions input ports on the left edge (x = rect.x)', () => {
      // Node at position [0,0,0], default dims -> rect left = -80
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            position: [0, 0, 0],
            inputs: [port('in')],
            outputs: [],
          }),
        },
        connections: {},
        groups: {},
      });

      const leftEdge = -(DEFAULT_W * SCALE) / 2; // -80
      expect(svg).toContain(`cx="${leftEdge}"`);
    });

    it('positions output ports on the right edge (x = rect.x + rect.w)', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            position: [0, 0, 0],
            inputs: [],
            outputs: [port('out')],
          }),
        },
        connections: {},
        groups: {},
      });

      const rightEdge = (DEFAULT_W * SCALE) / 2; // 80
      expect(svg).toContain(`cx="${rightEdge}"`);
    });

    it('vertically centers a single port', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            position: [0, 0, 0],
            inputs: [port('in')],
            outputs: [],
          }),
        },
        connections: {},
        groups: {},
      });

      // Single port is at r.y + r.h/2 = -40 + 40 = 0
      const halfH = (DEFAULT_D * SCALE) / 2;
      const centerY = -halfH + halfH; // 0
      expect(svg).toContain(`cy="${centerY}"`);
    });
  });

  // ── 8. Connections ─────────────────────────────────────────────────
  describe('connection rendering', () => {
    const srcNode = makeNode({
      id: 'src',
      type: 'source',
      position: [-2, 0, 0],
      outputs: [port('value', 'number')],
    });
    const tgtNode = makeNode({
      id: 'tgt',
      type: 'output',
      position: [2, 0, 0],
      inputs: [port('data', 'any')],
    });

    it('renders a cubic bezier <path> for each connection', () => {
      const svg = generateSVG({
        nodes: { src: srcNode, tgt: tgtNode },
        connections: { c1: makeConn('c1', 'src', 0, 'tgt', 0) },
        groups: {},
      });

      expect(svg).toContain('<path d="M ');
      expect(svg).toContain(' C ');
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('stroke-width="2"');
    });

    it('uses source port color for connection stroke', () => {
      const svg = generateSVG({
        nodes: { src: srcNode, tgt: tgtNode },
        connections: { c1: makeConn('c1', 'src', 0, 'tgt', 0) },
        groups: {},
      });

      // Source port is 'number' type -> gold color
      expect(svg).toContain(`stroke="${PORT_TYPE_COLORS.number}"`);
    });

    it('uses colorOverride when set on connection', () => {
      const svg = generateSVG({
        nodes: { src: srcNode, tgt: tgtNode },
        connections: {
          c1: makeConn('c1', 'src', 0, 'tgt', 0, { colorOverride: '#ff0000' }),
        },
        groups: {},
      });

      expect(svg).toContain('stroke="#ff0000"');
    });

    it('skips connections referencing non-existent nodes', () => {
      const svg = generateSVG({
        nodes: { src: srcNode },
        connections: { c1: makeConn('c1', 'src', 0, 'missing', 0) },
        groups: {},
      });

      // Should not crash and should not contain a path
      expect(svg).not.toContain('<path');
    });

    it('skips connections when source or target has zero ports', () => {
      const noPorts = makeNode({
        id: 'noPorts',
        type: 'note',
        position: [2, 0, 0],
      });

      const svg = generateSVG({
        nodes: { src: srcNode, noPorts },
        connections: { c1: makeConn('c1', 'src', 0, 'noPorts', 0) },
        groups: {},
      });

      expect(svg).not.toContain('<path');
    });
  });

  // ── 9. Multiple nodes with connections ─────────────────────────────
  describe('multiple nodes and connections', () => {
    it('renders all nodes and connections in one SVG', () => {
      const n1 = makeNode({
        id: 'n1', type: 'source', position: [-3, 0, 0],
        outputs: [port('value', 'number')],
      });
      const n2 = makeNode({
        id: 'n2', type: 'math', position: [0, 0, 0],
        inputs: [port('a', 'number'), port('b', 'number')],
        outputs: [port('result', 'number')],
      });
      const n3 = makeNode({
        id: 'n3', type: 'output', position: [3, 0, 0],
        inputs: [port('data', 'any')],
      });

      const svg = generateSVG({
        nodes: { n1, n2, n3 },
        connections: {
          c1: makeConn('c1', 'n1', 0, 'n2', 0),
          c2: makeConn('c2', 'n2', 0, 'n3', 0),
        },
        groups: {},
      });

      // Each node has a shadow <g> container
      const gFilterCount = (svg.match(/filter="url\(#shadow\)"/g) || []).length;
      expect(gFilterCount).toBe(3);

      // Two connections means two paths
      const pathCount = (svg.match(/<path /g) || []).length;
      expect(pathCount).toBe(2);
    });
  });

  // ── 10. XML escaping ──────────────────────────────────────────────
  describe('XML escaping', () => {
    it('escapes ampersand in node title', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', title: 'A & B' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('A &amp; B');
      expect(svg).not.toContain('>A & B<');
    });

    it('escapes angle brackets in node title', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', title: '<script>alert(1)</script>' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('&lt;script&gt;');
      expect(svg).not.toContain('<script>');
    });

    it('escapes quotes in node title', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', title: 'He said "hello"' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('&quot;hello&quot;');
    });

    it('escapes apostrophes in node title', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', title: "it's fine" }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('it&apos;s fine');
    });

    it('escapes special characters in port labels', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            inputs: [port('a<b')],
          }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('a&lt;b');
    });
  });

  // ── 11. Groups ────────────────────────────────────────────────────
  describe('group rendering', () => {
    it('renders a group rect when group has member nodes', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0], groupId: 'g1' }),
          n2: makeNode({ id: 'n2', type: 'math', position: [2, 0, 0], groupId: 'g1' }),
        },
        connections: {},
        groups: {
          g1: makeGroup({ id: 'g1', label: 'My Group' }),
        },
      });

      expect(svg).toContain('My Group');
      // Group should have its own rect with rounded corners
      expect(svg).toContain('rx="6"');
      expect(svg).toContain('fill-opacity="0.12"');
    });

    it('uses group color when specified', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0], groupId: 'g1' }),
        },
        connections: {},
        groups: {
          g1: makeGroup({ id: 'g1', label: 'Colored', color: '#ff5500' }),
        },
      });

      expect(svg).toContain('fill="#ff5500"');
      expect(svg).toContain('stroke="#ff5500"');
    });

    it('falls back to default color when group has no color', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0], groupId: 'g1' }),
        },
        connections: {},
        groups: {
          g1: makeGroup({ id: 'g1', label: 'Default Color' }),
        },
      });

      // Default is '#4a5568'
      expect(svg).toContain('#4a5568');
    });

    it('does not render a group that has no member nodes', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0] }),
        },
        connections: {},
        groups: {
          g1: makeGroup({ id: 'g1', label: 'Orphan Group' }),
        },
      });

      expect(svg).not.toContain('Orphan Group');
    });

    it('escapes group label text', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0], groupId: 'g1' }),
        },
        connections: {},
        groups: {
          g1: makeGroup({ id: 'g1', label: 'A & B <group>' }),
        },
      });

      expect(svg).toContain('A &amp; B &lt;group&gt;');
    });
  });

  // ── 12. Port distribution for multiple ports ─────────────────────
  describe('port distribution', () => {
    it('distributes multiple input ports evenly along the node height', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            position: [0, 0, 0],
            inputs: [port('a'), port('b'), port('c')],
            outputs: [],
          }),
        },
        connections: {},
        groups: {},
      });

      // With 3 inputs: margin=10, usableH = 80-20 = 60
      // positions: -40+10 = -30, -30+30 = 0, -30+60 = 30
      const halfH = (DEFAULT_D * SCALE) / 2; // 40
      const rY = -halfH; // -40
      const margin = 10;
      const usableH = DEFAULT_D * SCALE - margin * 2; // 60
      const y0 = rY + margin; // -30
      const y1 = rY + margin + (1 / 2) * usableH; // 0
      const y2 = rY + margin + (2 / 2) * usableH; // 30

      expect(svg).toContain(`cy="${y0}"`);
      expect(svg).toContain(`cy="${y1}"`);
      expect(svg).toContain(`cy="${y2}"`);
    });
  });

  // ── 13. Negative positions ────────────────────────────────────────
  describe('negative positions', () => {
    it('handles nodes at negative coordinates', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [-5, 0, -3] }),
        },
        connections: {},
        groups: {},
      });

      // Should produce valid SVG without errors
      expect(svg).toContain('<?xml');
      expect(svg).toContain('</svg>');

      // Center: (-500, -300), rect top-left: (-580, -340)
      const cx = -5 * SCALE;
      const cy = -3 * SCALE;
      const halfW = (DEFAULT_W * SCALE) / 2;
      const halfH = (DEFAULT_D * SCALE) / 2;
      expect(svg).toContain(`x="${cx - halfW}"`);
      expect(svg).toContain(`y="${cy - halfH}"`);
    });
  });

  // ── 14. Output-only node (e.g., source) ────────────────────────────
  describe('source node (output-only)', () => {
    it('renders output ports but no input circles', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            position: [0, 0, 0],
            outputs: [port('value', 'number'), port('label', 'string')],
          }),
        },
        connections: {},
        groups: {},
      });

      // 2 output circles, 0 input circles = 2 total
      const circleCount = (svg.match(/<circle /g) || []).length;
      expect(circleCount).toBe(2);
    });
  });

  // ── 15. Input-only node (e.g., output/display) ─────────────────────
  describe('display node (input-only)', () => {
    it('renders input ports but no output circles', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'display',
            position: [0, 0, 0],
            inputs: [port('value', 'any')],
          }),
        },
        connections: {},
        groups: {},
      });

      const circleCount = (svg.match(/<circle /g) || []).length;
      expect(circleCount).toBe(1);
    });
  });

  // ── 16. Width and height attributes on <svg> ──────────────────────
  describe('SVG width/height attributes', () => {
    it('sets width and height attributes matching the viewBox dimensions', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', position: [0, 0, 0] }),
        },
        connections: {},
        groups: {},
      });

      const expectedW = DEFAULT_W * SCALE + PADDING * 2;
      const expectedH = DEFAULT_D * SCALE + PADDING * 2;

      expect(svg).toContain(`width="${expectedW}"`);
      expect(svg).toContain(`height="${expectedH}"`);
    });
  });

  // ── 17. Connection path geometry ──────────────────────────────────
  describe('connection path geometry', () => {
    it('uses horizontal cubic bezier control points', () => {
      const src = makeNode({
        id: 'src',
        type: 'source',
        position: [0, 0, 0],
        outputs: [port('value', 'number')],
      });
      const tgt = makeNode({
        id: 'tgt',
        type: 'output',
        position: [4, 0, 0],
        inputs: [port('data', 'any')],
      });

      const svg = generateSVG({
        nodes: { src, tgt },
        connections: { c1: makeConn('c1', 'src', 0, 'tgt', 0) },
        groups: {},
      });

      // Source port x: 0 + 80 = 80 (right edge of src node)
      // Target port x: 400 - 80 = 320 (left edge of tgt node)
      // dx = |320 - 80| * 0.5 = 120
      // Control points: (80+120, sy) and (320-120, ty) = (200, 0) and (200, 0)
      const sx = (DEFAULT_W * SCALE) / 2;  // 80
      const tx = 4 * SCALE - (DEFAULT_W * SCALE) / 2;  // 320
      const dx = Math.abs(tx - sx) * 0.5;  // 120

      expect(svg).toContain(`M ${sx} 0 C ${sx + dx} 0, ${tx - dx} 0, ${tx} 0`);
    });
  });

  // ── 18. Font attributes ───────────────────────────────────────────
  describe('font attributes', () => {
    it('uses sans-serif font family throughout', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            title: 'Test',
            inputs: [port('in')],
          }),
        },
        connections: {},
        groups: {},
      });

      // All text elements should use sans-serif
      const textElements = svg.match(/<text [^>]*>/g) || [];
      for (const te of textElements) {
        expect(te).toContain('font-family="sans-serif"');
      }
    });

    it('uses font-size 11 for node titles', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', title: 'Title' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('font-size="11"');
    });

    it('uses font-size 8 for port labels', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({
            id: 'n1',
            type: 'source',
            inputs: [port('in')],
          }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('font-size="8"');
    });
  });

  // ── 19. Return type is a string ───────────────────────────────────
  describe('return type', () => {
    it('returns a string for non-empty graph', () => {
      const result = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source' }),
        },
        connections: {},
        groups: {},
      });
      expect(typeof result).toBe('string');
    });

    it('returns a string for empty graph', () => {
      const result = generateSVG(EMPTY_OPTS);
      expect(typeof result).toBe('string');
    });
  });

  // ── 20. Connection with 'any' port type ────────────────────────────
  describe('port type fallback', () => {
    it('uses the "any" color when source port type is "any"', () => {
      const src = makeNode({
        id: 'src',
        type: 'reroute',
        position: [0, 0, 0],
        outputs: [port('out', 'any')],
      });
      const tgt = makeNode({
        id: 'tgt',
        type: 'display',
        position: [3, 0, 0],
        inputs: [port('value', 'any')],
      });

      const svg = generateSVG({
        nodes: { src, tgt },
        connections: { c1: makeConn('c1', 'src', 0, 'tgt', 0) },
        groups: {},
      });

      expect(svg).toContain(`stroke="${PORT_TYPE_COLORS.any}"`);
    });
  });

  // ── 21. All port type colors appear correctly ─────────────────────
  describe('all port type colors', () => {
    const portTypes: Array<PortDef['portType']> = [
      'number', 'string', 'vector3', 'color', 'boolean', 'array', 'object', 'any',
    ];

    for (const pt of portTypes) {
      it(`renders correct color for port type "${pt}"`, () => {
        const svg = generateSVG({
          nodes: {
            n1: makeNode({
              id: 'n1',
              type: 'source',
              inputs: [port('in', pt)],
            }),
          },
          connections: {},
          groups: {},
        });

        expect(svg).toContain(`fill="${PORT_TYPE_COLORS[pt]}"`);
      });
    }
  });

  // ── 22. Title bar rendering ───────────────────────────────────────
  describe('title bar', () => {
    it('renders a title bar rect with height 24', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source' }),
        },
        connections: {},
        groups: {},
      });

      expect(svg).toContain('height="24"');
    });

    it('renders the title text centered horizontally', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'source', title: 'Centered Title' }),
        },
        connections: {},
        groups: {},
      });

      expect(svg).toContain('text-anchor="middle"');
      expect(svg).toContain('Centered Title');
    });
  });

  // ── 23. Node with no title falls back to type label ────────────────
  describe('node label fallback', () => {
    it('uses TYPE_LABELS for known types without a title', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'compare', title: '' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('>Compare</text>');
    });

    it('uses node.title when it is set', () => {
      const svg = generateSVG({
        nodes: {
          n1: makeNode({ id: 'n1', type: 'compare', title: 'Custom Name' }),
        },
        connections: {},
        groups: {},
      });
      expect(svg).toContain('>Custom Name</text>');
      expect(svg).not.toContain('>Compare</text>');
    });
  });
});
