import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeHelpEntry } from '../../utils/nodeHelp';

// Lazy-load the node help data (1500+ lines of help data — not in initial bundle)
let _helpEntries: NodeHelpEntry[] | null = null;
let _loadPromise: Promise<NodeHelpEntry[]> | null = null;

function loadAllHelp(): Promise<NodeHelpEntry[]> {
  if (_helpEntries) return Promise.resolve(_helpEntries);
  if (!_loadPromise) {
    _loadPromise = import('../../utils/nodeHelp').then(mod => {
      _helpEntries = mod.getAllNodeHelp();
      return _helpEntries;
    });
  }
  return _loadPromise;
}

type Section = 'overview' | 'getting-started' | 'nodes' | 'connections' | 'patterns' | 'custom-nodes' | 'shortcuts';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'nodes', label: 'Node Reference' },
  { id: 'connections', label: 'Connection Rules' },
  { id: 'patterns', label: 'Common Patterns' },
  { id: 'custom-nodes', label: 'Custom Nodes' },
  { id: 'shortcuts', label: 'Key Shortcuts' },
];

const CATEGORY_ORDER = ['Core', 'Math', 'String', 'Logic', 'Vector', 'Data', 'Color', 'Live', 'Utility', 'Flow', 'Encoding', 'Date/Time'];

const PORT_TYPE_COLORS: Record<string, string> = {
  number: '#4ecdc4',
  string: '#ffe66d',
  boolean: '#ff6b6b',
  color: '#c77dff',
  vec3: '#7bdff2',
  any: '#aaa',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HelpGuidePanel({ open, onClose }: Props) {
  const [section, setSection] = useState<Section>('overview');
  const [helpEntries, setHelpEntries] = useState<NodeHelpEntry[]>(_helpEntries ?? []);
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Load help data on open
  useEffect(() => {
    if (open) {
      loadAllHelp().then(entries => setHelpEntries(entries));
    }
  }, [open]);

  // Focus trap and Escape handling
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [open, onClose]);

  // Group help entries by category
  const categorized = useMemo(() => {
    const map = new Map<string, NodeHelpEntry[]>();
    for (const cat of CATEGORY_ORDER) {
      map.set(cat, []);
    }
    for (const entry of helpEntries) {
      const list = map.get(entry.category);
      if (list) list.push(entry);
      else map.set(entry.category, [entry]);
    }
    // Remove empty categories
    for (const [key, val] of map) {
      if (val.length === 0) map.delete(key);
    }
    return map;
  }, [helpEntries]);

  // Filtered entries for search
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return helpEntries.filter(e =>
      e.nodeType.toLowerCase().includes(q) ||
      e.summary.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q)
    );
  }, [helpEntries, searchQuery]);

  const toggleNode = useCallback((nodeType: string) => {
    setExpandedNode(prev => prev === nodeType ? null : nodeType);
  }, []);

  // Scroll content to top when changing section
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [section]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 150,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--overlay-bg)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{
          background: 'var(--panel-bg-solid)',
          border: '1px solid var(--panel-border)',
          borderRadius: 16,
          width: 700,
          maxWidth: '90vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px 12px',
          borderBottom: '1px solid var(--divider)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span style={{ fontFamily: 'Archivo Black, sans-serif', fontSize: 14, color: 'var(--text-primary)', letterSpacing: 0.5 }}>
              Node Editor Guide
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-faint)',
              cursor: 'pointer',
              fontSize: 18,
              padding: '4px 8px',
              borderRadius: 4,
              lineHeight: 1,
            }}
            aria-label="Close help guide"
          >
            &times;
          </button>
        </div>

        {/* Navigation tabs */}
        <div style={{
          display: 'flex',
          gap: 2,
          padding: '8px 24px',
          borderBottom: '1px solid var(--divider)',
          flexWrap: 'wrap',
        }}>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => { setSection(s.id); setSearchQuery(''); }}
              style={{
                background: section === s.id ? 'var(--teal)' : 'transparent',
                color: section === s.id ? 'var(--bg)' : 'var(--text-secondary)',
                border: '1px solid ' + (section === s.id ? 'var(--teal)' : 'var(--divider)'),
                borderRadius: 6,
                padding: '4px 12px',
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div
          ref={contentRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 24px 24px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--scrollbar-thumb) transparent',
          }}
        >
          {section === 'overview' && <OverviewSection />}
          {section === 'getting-started' && <GettingStartedSection />}
          {section === 'nodes' && (
            <NodeReferenceSection
              categorized={categorized}
              filteredEntries={filteredEntries}
              expandedNode={expandedNode}
              toggleNode={toggleNode}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
            />
          )}
          {section === 'connections' && <ConnectionRulesSection />}
          {section === 'patterns' && <CommonPatternsSection />}
          {section === 'custom-nodes' && <CustomNodesSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
        </div>
      </div>
    </div>
  );
}

/* ---------- Section: Overview ---------- */
function OverviewSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle>What is this?</SectionTitle>
      <P>
        This is a <B>3D visual node editor</B> for building data flow pipelines.
        You create <B>nodes</B> (data sources, math operations, filters, outputs)
        and connect them with <B>wires</B> to define how data flows through your graph.
      </P>

      <SectionTitle>Core Concepts</SectionTitle>
      <ConceptGrid>
        <Concept icon="source" title="Nodes" desc="Processing units. Each node type performs a specific operation (math, string, logic, etc.)." />
        <Concept icon="connection" title="Connections" desc="Wires between output and input ports. Data flows from left to right through these wires." />
        <Concept icon="port" title="Ports" desc="Inputs (left side) and outputs (right side) on each node. Each port has a data type." />
        <Concept icon="execute" title="Execution" desc="Click Run to process data through the graph. Results appear as value previews on each node." />
      </ConceptGrid>

      <SectionTitle>Data Types</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {Object.entries(PORT_TYPE_COLORS).map(([type, color]) => (
          <span key={type} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 10px', borderRadius: 4,
            background: 'var(--node-bg)',
            border: `1px solid ${color}40`,
            fontSize: 10, fontFamily: 'var(--font-mono)',
            color: 'var(--text-secondary)',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
            {type}
          </span>
        ))}
      </div>
      <P style={{ fontSize: 10, color: 'var(--text-faint)' }}>
        Port colors indicate data type. <B>any</B> type ports accept all types.
        Incompatible types get auto-converted when possible (e.g. number to string).
      </P>
    </div>
  );
}

/* ---------- Section: Getting Started ---------- */
function GettingStartedSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle>Quick Start Guide</SectionTitle>
      <StepList>
        <Step n={1} title="Add a Source node">
          Double-click the canvas or press <Kbd>Ctrl+K</Kbd> to open the node palette.
          Search for <B>"source"</B> and click to add it. It produces a constant numeric value.
        </Step>
        <Step n={2} title="Add a Transform node">
          Add another node: <B>"transform"</B>. This multiplies the input by a factor and adds an offset.
        </Step>
        <Step n={3} title="Connect them">
          Click and drag from the Source's output port (right side) to the Transform's input port (left side).
          A wire appears showing the data flow.
        </Step>
        <Step n={4} title="Add an Output node">
          Add an <B>"output"</B> node and connect the Transform's result to it.
        </Step>
        <Step n={5} title="Execute the graph">
          Click the green <B>Run</B> button (top-right) or use the Execute menu.
          Values appear on each node showing the computed results.
        </Step>
      </StepList>

      <SectionTitle>Essential Controls</SectionTitle>
      <Table>
        <Row k="Add node" v="Double-click canvas or Ctrl+K" />
        <Row k="Connect" v="Drag from output port to input port" />
        <Row k="Select" v="Click node, or box-select by dragging empty space" />
        <Row k="Multi-select" v="Shift+Click or Shift+drag" />
        <Row k="Delete" v="Select, then press Delete or Backspace" />
        <Row k="Pan camera" v="Right-click drag" />
        <Row k="Orbit camera" v="Middle-click drag" />
        <Row k="Zoom" v="Scroll wheel" />
        <Row k="Undo / Redo" v="Ctrl+Z / Ctrl+Shift+Z" />
        <Row k="Duplicate" v="Ctrl+D or Ctrl+Drag" />
        <Row k="Group nodes" v="Select multiple, Ctrl+G" />
        <Row k="Fit view" v="Press F" />
        <Row k="Edit value" v="Double-click the node's value area" />
      </Table>
    </div>
  );
}

/* ---------- Section: Node Reference ---------- */
function NodeReferenceSection({
  categorized,
  filteredEntries,
  expandedNode,
  toggleNode,
  searchQuery,
  setSearchQuery,
}: {
  categorized: Map<string, NodeHelpEntry[]>;
  filteredEntries: NodeHelpEntry[] | null;
  expandedNode: string | null;
  toggleNode: (nodeType: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}) {
  const entries = filteredEntries ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px',
        background: 'var(--node-bg)',
        borderRadius: 6,
        border: '1px solid var(--divider)',
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search nodes..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontSize: 11, fontFamily: 'var(--font-mono)',
          }}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} style={{
            background: 'none', border: 'none', color: 'var(--text-faint)',
            cursor: 'pointer', fontSize: 12, padding: '0 2px',
          }}>&times;</button>
        )}
      </div>

      {filteredEntries ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <P style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            {entries.length} result{entries.length !== 1 ? 's' : ''} for "{searchQuery}"
          </P>
          {entries.map(entry => (
            <NodeHelpCard key={entry.nodeType} entry={entry} expanded={expandedNode === entry.nodeType} onToggle={toggleNode} />
          ))}
        </div>
      ) : (
        Array.from(categorized.entries()).map(([category, catEntries]) => (
          <div key={category}>
            <div style={{
              fontFamily: 'Archivo Black, sans-serif',
              fontSize: 10, color: 'var(--teal)',
              textTransform: 'uppercase', letterSpacing: 1.5,
              padding: '8px 0 4px', borderBottom: '1px solid var(--divider)',
              marginBottom: 6,
            }}>
              {category} ({catEntries.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {catEntries.map(entry => (
                <NodeHelpCard key={entry.nodeType} entry={entry} expanded={expandedNode === entry.nodeType} onToggle={toggleNode} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------- Node Help Card ---------- */
function NodeHelpCard({ entry, expanded, onToggle }: { entry: NodeHelpEntry; expanded: boolean; onToggle: (t: string) => void }) {
  return (
    <div style={{
      background: expanded ? 'var(--node-bg)' : 'transparent',
      border: `1px solid ${expanded ? 'var(--panel-border)' : 'transparent'}`,
      borderRadius: 8,
      overflow: 'hidden',
      transition: 'background 0.15s ease',
    }}>
      <button
        onClick={() => onToggle(entry.nodeType)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '6px 10px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s ease',
          fontSize: 10, color: 'var(--text-faint)', lineHeight: 1,
        }}>&#9654;</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--text-primary)', fontWeight: 600,
        }}>
          {entry.nodeType}
        </span>
        <span style={{
          fontSize: 10, color: 'var(--text-faint)', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.summary}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 10px 12px 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <P>{entry.description}</P>
          {entry.inputs.length > 0 && (
            <div>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: 1 }}>Inputs</span>
              {entry.inputs.map((p, i) => (
                <PortRow key={i} name={p.name} type={p.type} desc={p.description} />
              ))}
            </div>
          )}
          {entry.outputs.length > 0 && (
            <div>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: 1 }}>Outputs</span>
              {entry.outputs.map((p, i) => (
                <PortRow key={i} name={p.name} type={p.type} desc={p.description} />
              ))}
            </div>
          )}
          {entry.tips && entry.tips.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: 1 }}>Tips</span>
              {entry.tips.map((tip, i) => (
                <P key={i} style={{ fontSize: 10, color: 'var(--text-faint)', paddingLeft: 8 }}>
                  &bull; {tip}
                </P>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PortRow({ name, type, desc }: { name: string; type: string; desc: string }) {
  const color = PORT_TYPE_COLORS[type] ?? '#aaa';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 0 3px 8px' }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        marginTop: 4, flexShrink: 0,
      }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-primary)', fontWeight: 500, minWidth: 50 }}>
        {name}
      </span>
      <span style={{ fontSize: 10, color: color, fontFamily: 'var(--font-mono)', minWidth: 40 }}>
        {type}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-faint)', flex: 1 }}>
        {desc}
      </span>
    </div>
  );
}

/* ---------- Section: Connection Rules ---------- */
function ConnectionRulesSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle>How Connections Work</SectionTitle>
      <P>
        Connections carry data from one node's <B>output port</B> (right side)
        to another node's <B>input port</B> (left side). Data always flows left-to-right.
      </P>

      <SectionTitle>Connection Rules</SectionTitle>
      <RuleList>
        <Rule ok title="Output to Input only">
          You can only connect an output port to an input port. Not output-to-output or input-to-input.
        </Rule>
        <Rule ok title="Type compatibility">
          Ports have types (number, string, boolean, vec3, color). Compatible types connect directly.
          When types differ, a <B>converter node</B> is automatically inserted.
        </Rule>
        <Rule ok title="Any type accepts all">
          Ports with type <B>"any"</B> accept connections from any other type.
        </Rule>
        <Rule ok={false} title="No cycles allowed">
          You cannot create circular connections (A → B → C → A). The editor prevents this automatically.
        </Rule>
        <Rule ok title="One input, many outputs">
          Each input port accepts one connection. Each output port can connect to multiple inputs.
          Connecting to an occupied input replaces the existing connection.
        </Rule>
        <Rule ok title="Auto-conversion">
          Number ↔ String, Number ↔ Boolean, Boolean → String, Vec3 → Number (length):
          these convert automatically via an inserted converter node.
        </Rule>
      </RuleList>

      <SectionTitle>Connection Tips</SectionTitle>
      <Table>
        <Row k="Quick connect" v="Drag from port, release on empty space → palette opens with compatible nodes" />
        <Row k="Reconnect" v="Click an occupied input port to reroute the existing connection" />
        <Row k="Delete wire" v="Right-click a connection and choose Delete, or select and press Delete" />
        <Row k="Style" v="Right-click a connection to change its routing style (bezier, straight, right-angle, organic)" />
        <Row k="Annotate" v="Right-click a connection to add a label or color" />
      </Table>
    </div>
  );
}

/* ---------- Section: Common Patterns ---------- */
function CommonPatternsSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle>Common Node Combinations</SectionTitle>
      <P>
        These are proven patterns showing which nodes work well together. Use them
        as building blocks for your own graphs.
      </P>

      <PatternCard
        title="Basic Math Pipeline"
        nodes={['source', 'transform', 'output']}
        desc="Start with a Source (constant value), pipe through a Transform (multiply + offset), and display with Output."
        tip="Transform's factor and offset are editable inline. Double-click the value to change it."
      />

      <PatternCard
        title="Multi-Input Calculation"
        nodes={['source', 'source', 'math (add)', 'output']}
        desc="Two Source nodes feed into a Math (add/subtract/multiply/divide) node. Result goes to Output."
        tip="Change the Math node's operation by editing its 'operation' field inline."
      />

      <PatternCard
        title="String Formatting"
        nodes={['source', 'string-template', 'display']}
        desc="Feed numeric values into a String Template node to format output text. Template uses ${in0}, ${in1} placeholders."
        tip="String Template supports up to 4 inputs. Use backtick syntax in the template field."
      />

      <PatternCard
        title="Conditional Logic"
        nodes={['source', 'compare', 'if-gate', 'output']}
        desc="Compare checks a condition (>, <, ==). If-Gate passes or blocks data based on the boolean result."
        tip="If-Gate has 3 inputs: condition (boolean), value-if-true, value-if-false."
      />

      <PatternCard
        title="Array Processing"
        nodes={['create-array', 'array-map', 'array-filter', 'array-length']}
        desc="Create an array, transform each element with Map (expression), filter elements that match a condition, count results."
        tip="Map and Filter expressions use 'x' for current element and 'i' for index. Math.* functions work inside expressions."
      />

      <PatternCard
        title="Color Manipulation"
        nodes={['color-picker', 'rgb-to-hsl', 'hsl-to-rgb', 'color-mix']}
        desc="Pick a color, convert between RGB and HSL for manipulation (adjust hue/saturation/lightness), mix two colors together."
        tip="Color-Picker outputs hex string + R/G/B components. Color-Mix interpolates between two colors by a t parameter."
      />

      <PatternCard
        title="3D Vector Math"
        nodes={['compose-vec3', 'normalize-vec3', 'dot-product', 'cross-product']}
        desc="Build a vec3 from x/y/z components, normalize to unit length, compute angles (dot product) or perpendicular vectors (cross product)."
        tip="Decompose-Vec3 splits a vector back into x/y/z components. Vec3-Length returns the magnitude."
      />

      <PatternCard
        title="Data Transform Pipeline"
        nodes={['source', 'clamp', 'remap', 'lerp']}
        desc="Constrain a value to a range (Clamp), remap from one range to another (Remap), interpolate between two values (Lerp)."
        tip="Remap maps [inMin, inMax] to [outMin, outMax]. Lerp blends between two values using a 0-1 parameter."
      />

      <SectionTitle>Advanced Patterns</SectionTitle>

      <PatternCard
        title="Graph Variables"
        nodes={['set-var', 'get-var']}
        desc="Share data between distant parts of your graph without wires. Set-Var writes a named variable, Get-Var reads it."
        tip="Variables are per-graph. Name them clearly (e.g., 'globalScale', 'threshold'). Both nodes bypass execution cache."
      />

      <PatternCard
        title="Subgraph Encapsulation"
        nodes={['subgraph']}
        desc="Select a group of nodes, then create a Subgraph to encapsulate them. The subgraph becomes a single reusable node."
        tip="Double-click a subgraph node to enter it. Use breadcrumb navigation to exit. Input/output ports map to the inner graph."
      />

      <PatternCard
        title="Live Data Integration"
        nodes={['timer', 'http-fetch', 'json-parse']}
        desc="Timer produces periodic ticks. HTTP-Fetch retrieves data from a URL. JSON-Parse converts the response string to structured data."
        tip="HTTP-Fetch needs a URL input and a trigger. Timer's interval is configurable. These nodes always re-execute (bypass cache)."
      />

      <SectionTitle>Port Type Compatibility Quick Reference</SectionTitle>
      <P>When connecting ports of different types, converter nodes are inserted automatically:</P>
      <Table>
        <Row k="number &rarr; string" v="Converts via toString()" />
        <Row k="string &rarr; number" v="Converts via Number() — NaN if invalid" />
        <Row k="number &rarr; boolean" v="Compares against threshold (default: > 0)" />
        <Row k="boolean &rarr; string" v='Converts to "true" or "false"' />
        <Row k="vec3 &rarr; number" v="Returns vector length (magnitude)" />
        <Row k="any &rarr; anything" v="Passes through without conversion" />
      </Table>
      <P style={{ fontSize: 10, color: 'var(--text-faint)' }}>
        Auto-inserted converter nodes show an amber glow and &quot;(auto)&quot; suffix.
        You can delete them and wire differently if needed.
      </P>
    </div>
  );
}

function PatternCard({ title, nodes, desc, tip }: { title: string; nodes: string[]; desc: string; tip: string }) {
  return (
    <div style={{
      padding: '10px 14px',
      background: 'var(--node-bg)',
      borderRadius: 8,
      border: '1px solid var(--divider)',
    }}>
      <div style={{
        fontWeight: 600, fontSize: 11, color: 'var(--text-primary)',
        marginBottom: 6,
      }}>
        {title}
      </div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6,
      }}>
        {nodes.map((node, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              padding: '2px 8px',
              background: 'color-mix(in srgb, var(--teal) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--teal) 30%, transparent)',
              borderRadius: 4,
              fontSize: 10, fontFamily: 'var(--font-mono)',
              color: 'var(--teal)',
            }}>
              {node}
            </span>
            {i < nodes.length - 1 && (
              <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>&rarr;</span>
            )}
          </span>
        ))}
      </div>
      <P>{desc}</P>
      <P style={{ fontSize: 10, color: 'var(--warning)', marginTop: 4 }}>
        Tip: {tip}
      </P>
    </div>
  );
}

/* ---------- Section: Custom Nodes ---------- */
function CustomNodesSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionTitle>Creating Custom Nodes</SectionTitle>
      <P>
        Custom nodes let you define your own processing logic using JavaScript expressions.
        They're powerful for operations not covered by built-in node types.
      </P>

      <StepList>
        <Step n={1} title="Create a custom node">
          Press <Kbd>Ctrl+K</Kbd>, search for <B>"custom"</B>, and add it. Or use the
          <B> Custom</B> section in the toolbar sidebar.
        </Step>
        <Step n={2} title="Open the expression editor">
          Right-click the custom node and choose <B>"Edit Expression"</B> to open
          the custom node editor panel.
        </Step>
        <Step n={3} title="Configure ports">
          Add input and output ports. Name them and set their types. Each input becomes
          available as a variable in your expression.
        </Step>
        <Step n={4} title="Write your expression">
          Write a JavaScript expression. Access inputs as <Code>in0</Code>, <Code>in1</Code>,
          etc. or via <Code>inputs[0]</Code>. All <Code>Math.*</Code> functions are available.
        </Step>
      </StepList>

      <SectionTitle>Expression Examples</SectionTitle>
      <Table>
        <Row k="Pass through" v="in0" />
        <Row k="Add inputs" v="in0 + in1" />
        <Row k="Clamp" v="Math.min(Math.max(in0, 0), 1)" />
        <Row k="Ternary" v="in0 > 0.5 ? in1 : 0" />
        <Row k="Sine wave" v="Math.sin(in0 * Math.PI * 2)" />
        <Row k="Format" v="`Value: ${in0.toFixed(2)}`" />
        <Row k="Multi-output" v="[in0 + in1, in0 - in1, in0 * in1]" />
      </Table>
      <P style={{ fontSize: 10, color: 'var(--text-faint)' }}>
        For multi-output nodes, return an array. Each element maps to an output port (index 0, 1, 2...).
      </P>

      <SectionTitle>Subgraphs</SectionTitle>
      <P>
        Group complex logic into reusable subgraphs. Select nodes, then use the
        <B> Subgraph</B> section to create one. Double-click to enter and edit.
        Subgraphs appear as a single node in the parent graph.
      </P>
    </div>
  );
}

/* ---------- Section: Shortcuts ---------- */
function ShortcutsSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <P>
        Press <Kbd>?</Kbd> for the full keyboard shortcut overlay.
        Here are the most important ones:
      </P>

      <SectionTitle>Must-Know Shortcuts</SectionTitle>
      <Table>
        <Row k="Ctrl+K" v="Open command/node palette" />
        <Row k="Ctrl+Z / Ctrl+Shift+Z" v="Undo / Redo" />
        <Row k="Delete" v="Delete selected" />
        <Row k="Ctrl+D" v="Duplicate" />
        <Row k="F" v="Zoom to fit" />
        <Row k="V" v="Toggle value previews" />
        <Row k="G" v="Toggle snap to grid" />
        <Row k="L" v="Auto-layout" />
        <Row k="?" v="Full shortcut reference" />
      </Table>

      <SectionTitle>Navigation</SectionTitle>
      <Table>
        <Row k="Scroll" v="Zoom in/out" />
        <Row k="Right-drag" v="Pan camera" />
        <Row k="Middle-drag" v="Orbit camera" />
        <Row k="Alt+Arrow" v="Traverse connections" />
        <Row k="Arrow keys (no sel)" v="Camera view presets" />
        <Row k="Alt+1-9" v="Camera bookmarks" />
      </Table>

      <SectionTitle>Editing</SectionTitle>
      <Table>
        <Row k="Double-click canvas" v="Add new node" />
        <Row k="Double-click title" v="Rename node" />
        <Row k="Ctrl+G" v="Group selected" />
        <Row k="Ctrl+C / Ctrl+V" v="Copy / Paste" />
        <Row k="Ctrl+Drag" v="Duplicate and drag" />
        <Row k="Shift+Drag" v="Move on Y axis" />
        <Row k="H" v="Collapse/expand node" />
        <Row k="Shift+L" v="Lock/unlock node" />
      </Table>
    </div>
  );
}

/* ---------- Reusable mini-components ---------- */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'Archivo Black, sans-serif',
      fontSize: 11, color: 'var(--text-primary)',
      textTransform: 'uppercase', letterSpacing: 1,
      paddingBottom: 4,
      borderBottom: '1px solid var(--divider)',
    }}>
      {children}
    </div>
  );
}

function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <p style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)', ...style }}>
      {children}
    </p>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: 'inline-block',
      padding: '1px 5px',
      fontSize: 10,
      fontFamily: 'var(--font-mono)',
      background: 'var(--node-bg)',
      border: '1px solid var(--divider)',
      borderRadius: 3,
      color: 'var(--teal)',
    }}>
      {children}
    </kbd>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      background: 'var(--node-bg)',
      padding: '1px 4px',
      borderRadius: 3,
      color: 'var(--teal)',
    }}>
      {children}
    </code>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '4px 0',
      borderBottom: '1px solid color-mix(in srgb, var(--divider) 50%, transparent)',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--teal)',
        minWidth: 140, fontWeight: 500,
      }}>
        {k}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-secondary)', flex: 1 }}>
        {v}
      </span>
    </div>
  );
}

function ConceptGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      {children}
    </div>
  );
}

function Concept({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  const icons: Record<string, React.ReactNode> = {
    source: <rect x="3" y="3" width="18" height="18" rx="3" />,
    connection: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></>,
    port: <><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="8" strokeDasharray="4 4" /></>,
    execute: <polygon points="5 3 19 12 5 21 5 3" />,
  };
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--node-bg)',
      borderRadius: 8,
      border: '1px solid var(--divider)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {icons[icon]}
        </svg>
        <span style={{ fontFamily: 'Archivo Black, sans-serif', fontSize: 10, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </span>
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.5 }}>{desc}</span>
    </div>
  );
}

function StepList({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: 'var(--teal)', color: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
      }}>
        {n}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-primary)', marginBottom: 2 }}>{title}</div>
        <P>{children}</P>
      </div>
    </div>
  );
}

function RuleList({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>;
}

function Rule({ ok, title, children }: { ok: boolean; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '8px 12px',
      background: 'var(--node-bg)', borderRadius: 8,
      border: `1px solid ${ok ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'color-mix(in srgb, var(--error) 30%, transparent)'}`,
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1.3 }}>
        {ok ? '\u2705' : '\u274C'}
      </span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-primary)', marginBottom: 2 }}>{title}</div>
        <P>{children}</P>
      </div>
    </div>
  );
}
