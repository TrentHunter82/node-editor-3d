import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { PORT_TYPE_COLORS } from '../../types';
import type { PortType } from '../../types';
import { getNodeLabel } from '../../types/nodeLabels';
import { useNodeHelp } from '../../hooks/useNodeHelp';
import styles from '../../styles/panels.module.css';

const TYPE_COLORS: Record<string, string> = {
  source: '#2EC4B6', transform: '#FF6B35', filter: '#E8453C', output: '#9B59B6',
  math: '#FF6B35', clamp: '#FF6B35', remap: '#FF6B35',
  concat: '#2EC4B6', template: '#2EC4B6',
  compare: '#E8453C', switch: '#E8453C',
  'compose-vec3': '#FF6B35', 'decompose-vec3': '#FF6B35',
  note: '#2EC4B6', reroute: '#2EC4B6', random: '#2EC4B6', display: '#9B59B6',
};

/** Default editable data fields per node type */
type FieldDef = { key: string; label: string; type: 'text' | 'number' | 'color' | 'select' | 'boolean'; options?: { value: string; label: string }[] };
const NODE_DATA_FIELDS: Record<string, FieldDef[]> = {
  source: [
    { key: 'value', label: 'Value', type: 'number' },
    { key: 'label', label: 'Label', type: 'text' },
  ],
  transform: [
    { key: 'multiplier', label: 'Multiplier', type: 'number' },
    { key: 'offset', label: 'Offset', type: 'number' },
  ],
  filter: [
    { key: 'threshold', label: 'Threshold', type: 'number' },
    { key: 'mode', label: 'Mode', type: 'select', options: [
      { value: 'greater', label: '> Greater' },
      { value: 'less', label: '< Less' },
      { value: 'equal', label: '= Equal' },
    ]},
  ],
  output: [
    { key: 'format', label: 'Format', type: 'text' },
    { key: 'color', label: 'Color', type: 'color' },
  ],
  math: [{ key: 'operation', label: 'Operation', type: 'select', options: [
    { value: 'add', label: '+ Add' },
    { value: 'subtract', label: '- Subtract' },
    { value: 'multiply', label: '* Multiply' },
    { value: 'divide', label: '/ Divide' },
    { value: 'power', label: '^ Power' },
    { value: 'modulo', label: '% Modulo' },
  ]}],
  clamp: [],
  remap: [],
  concat: [],
  template: [{ key: 'defaultTemplate', label: 'Default', type: 'text' }],
  compare: [{ key: 'mode', label: 'Mode', type: 'select', options: [
    { value: '>', label: '> Greater' },
    { value: '<', label: '< Less' },
    { value: '==', label: '== Equal' },
    { value: '!=', label: '!= Not Equal' },
    { value: '>=', label: '>= Greater/Equal' },
    { value: '<=', label: '<= Less/Equal' },
  ]}],
  switch: [],
  'compose-vec3': [],
  'decompose-vec3': [],
  note: [{ key: 'text', label: 'Text', type: 'text' }],
  reroute: [],
  random: [
    { key: 'min', label: 'Min', type: 'number' },
    { key: 'max', label: 'Max', type: 'number' },
    { key: 'seed', label: 'Seed', type: 'number' },
  ],
  display: [],
};

/** Format a computed output value for display */
function formatOutputValue(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(3) : String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value.length > 50 ? value.slice(0, 50) + '...' : value;
  if (Array.isArray(value)) {
    const json = JSON.stringify(value);
    return json.length > 60 ? json.slice(0, 60) + '...' : json;
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 60 ? json.slice(0, 60) + '...' : json;
  }
  return String(value);
}

/** Chevron icon for collapsible sections */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transition: 'transform 0.15s',
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        flexShrink: 0,
      }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** Collapsible section wrapper */
function Section({
  label,
  defaultOpen = true,
  badge,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={styles.inspectorSectionBtn}
      >
        <ChevronIcon open={open} />
        {label}
        {badge && <span style={{ marginLeft: 'auto' }}>{badge}</span>}
      </button>
      {open && children}
    </div>
  );
}

export const Inspector = memo(function Inspector() {
  const inspectorVisible = useSettingsStore(s => s.inspectorVisible);
  const selectedIds = useEditorStore(s => s.selectedIds);
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const removeNode = useEditorStore(s => s.removeNode);
  const removeConnection = useEditorStore(s => s.removeConnection);
  const updateNodeTitle = useEditorStore(s => s.updateNodeTitle);
  const updateNodeData = useEditorStore(s => s.updateNodeData);
  const updateNodeComment = useEditorStore(s => s.updateNodeComment);
  const focusNode = useEditorStore(s => s.focusNode);
  const nodeOutputs = useEditorStore(s => s.nodeOutputs);
  const updateConnectionLabel = useEditorStore(s => s.updateConnectionLabel);
  const updateConnectionColor = useEditorStore(s => s.updateConnectionColor);
  const executionMetrics = useEditorStore(s => s.executionMetrics);
  const executionErrors = useEditorStore(s => s.executionErrors);

  const selectedId = [...selectedIds][0];
  const node = selectedId ? nodes[selectedId] : null;
  const connection = selectedId ? connections[selectedId] : null;
  const nodeHelp = useNodeHelp(node?.type);

  // Build per-port connection map for the selected node
  const portConnectionMap = useMemo(() => {
    if (!node) return { inputs: new Map<number, string>(), outputs: new Map<number, string[]>() };
    const inputs = new Map<number, string>();
    const outputs = new Map<number, string[]>();
    for (const conn of Object.values(connections)) {
      if (conn.targetNodeId === node.id) {
        inputs.set(conn.targetPortIndex, nodes[conn.sourceNodeId]?.title ?? conn.sourceNodeId);
      }
      if (conn.sourceNodeId === node.id) {
        const arr = outputs.get(conn.sourcePortIndex) ?? [];
        arr.push(nodes[conn.targetNodeId]?.title ?? conn.targetNodeId);
        outputs.set(conn.sourcePortIndex, arr);
      }
    }
    return { inputs, outputs };
  }, [node, connections, nodes]);

  // Find connections for the selected node (for the connections section)
  const connectedNodes = useMemo(() => {
    if (!node) return { incoming: [] as { connId: string; nodeId: string; title: string; portIdx: number }[], outgoing: [] as { connId: string; nodeId: string; title: string; portIdx: number }[] };
    const incoming: { connId: string; nodeId: string; title: string; portIdx: number }[] = [];
    const outgoing: { connId: string; nodeId: string; title: string; portIdx: number }[] = [];
    for (const conn of Object.values(connections)) {
      if (conn.targetNodeId === node.id) {
        const src = nodes[conn.sourceNodeId];
        if (src) incoming.push({ connId: conn.id, nodeId: src.id, title: src.title, portIdx: conn.targetPortIndex });
      }
      if (conn.sourceNodeId === node.id) {
        const tgt = nodes[conn.targetNodeId];
        if (tgt) outgoing.push({ connId: conn.id, nodeId: tgt.id, title: tgt.title, portIdx: conn.sourcePortIndex });
      }
    }
    return { incoming, outgoing };
  }, [node, connections, nodes]);

  const copyTimerRef = useRef(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopyId = useCallback((id: string) => {
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedId(null), 1200);
  }, []);

  if (!inspectorVisible) return null;

  if (node) {
    const color = TYPE_COLORS[node.type] ?? '#888';
    const fields = NODE_DATA_FIELDS[node.type] ?? [];
    const errorMsg = executionErrors[node.id];
    const hasOutputs = nodeOutputs[node.id] && node.outputs.length > 0;
    const hasMetrics = !!executionMetrics[node.id];
    const hasConnections = connectedNodes.incoming.length > 0 || connectedNodes.outgoing.length > 0;

    return (
      <div className={styles.inspector}>
        <div className={styles.inspectorTitle}>Inspector</div>

        {/* Node identity header card */}
        <div style={{
          background: color + '08',
          borderRadius: 6,
          padding: '8px 10px',
          marginBottom: 6,
          borderLeft: `3px solid ${color}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className={styles.badge} style={{ background: color + '22', color, fontSize: '8px' }}>
              {getNodeLabel(node.type)}
            </span>
            {node.comment && (
              <span style={{ fontSize: '8px', color: 'var(--text-faint)' }} title={node.comment}>
                (annotated)
              </span>
            )}
            {nodeHelp && (
              <button
                onClick={() => window.__openNodeHelp?.(node.type)}
                title="View node help"
                style={{
                  marginLeft: 'auto',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: '1px solid var(--btn-border)',
                  background: 'var(--btn-bg)',
                  color: 'var(--text-dim)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ?
              </button>
            )}
          </div>
          <input
            className={styles.inspectorInput}
            aria-label="Node title"
            value={node.title}
            onChange={e => updateNodeTitle(node.id, e.target.value)}
            style={{ width: '100%', fontWeight: 600, fontSize: '12px' }}
          />
        </div>

        {/* Metadata section */}
        <Section label="Metadata" defaultOpen={false}>
          <div className={styles.inspectorRow}>
            <span className={styles.inspectorLabel}>ID</span>
            <button
              className={styles.inspectorLink}
              onClick={() => handleCopyId(node.id)}
              title="Copy ID"
              style={{ fontSize: '10px', opacity: 0.6 }}
            >
              {copiedId === node.id ? 'Copied!' : node.id}
            </button>
          </div>
          <div className={styles.inspectorRow}>
            <span className={styles.inspectorLabel}>Position</span>
            <span className={styles.inspectorValue} style={{ fontFamily: 'monospace', fontSize: '10px' }}>
              {node.position[0].toFixed(1)}, {node.position[2].toFixed(1)}
              {Math.abs(node.position[1]) > 0.01 && `, Y:${node.position[1].toFixed(1)}`}
            </span>
          </div>
          {node.groupId && (
            <div className={styles.inspectorRow}>
              <span className={styles.inspectorLabel}>Group</span>
              <span className={styles.inspectorValue} style={{ fontSize: '10px', opacity: 0.6 }}>
                {node.groupId}
              </span>
            </div>
          )}
          <div className={styles.inspectorRow}>
            <span className={styles.inspectorLabel}>Locked</span>
            <input
              type="checkbox"
              aria-label="Lock node"
              checked={!!node.locked}
              onChange={() => useEditorStore.getState().toggleNodeLock(node.id)}
              style={{ width: 14, height: 14, cursor: 'pointer' }}
            />
          </div>
        </Section>

        {/* Ports section */}
        <Section
          label="Ports"
          defaultOpen={true}
          badge={
            <span style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-faint)' }}>
              {node.inputs.length}in / {node.outputs.length}out
            </span>
          }
        >
          {node.inputs.length > 0 && (
            <>
              <div style={{ fontSize: '8px', color: 'var(--text-faint)', padding: '2px 0', letterSpacing: '0.5px' }}>INPUTS</div>
              {node.inputs.map((port, idx) => {
                const ptColor = PORT_TYPE_COLORS[port.portType as PortType] ?? PORT_TYPE_COLORS.any;
                const connectedFrom = portConnectionMap.inputs.get(idx);
                return (
                  <div key={port.id} className={styles.inspectorRow} style={{ padding: '3px 0' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span
                        role="img"
                        aria-label={connectedFrom ? 'connected' : 'disconnected'}
                        style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: connectedFrom ? ptColor : 'transparent',
                          border: `1.5px solid ${ptColor}`,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: '9px', color: 'var(--text)' }}>{port.label}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className={styles.badge} style={{
                        background: ptColor + '15',
                        color: ptColor,
                        fontSize: '7px',
                        padding: '1px 4px',
                      }}>
                        {port.portType}
                      </span>
                      {connectedFrom && (
                        <span style={{ fontSize: '8px', color: 'var(--text-faint)' }} title={`Connected from: ${connectedFrom}`}>
                          &#x25C0;
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </>
          )}
          {node.outputs.length > 0 && (
            <>
              <div style={{ fontSize: '8px', color: 'var(--text-faint)', padding: '4px 0 2px', letterSpacing: '0.5px' }}>OUTPUTS</div>
              {node.outputs.map((port, idx) => {
                const ptColor = PORT_TYPE_COLORS[port.portType as PortType] ?? PORT_TYPE_COLORS.any;
                const connectedTo = portConnectionMap.outputs.get(idx);
                return (
                  <div key={port.id} className={styles.inspectorRow} style={{ padding: '3px 0' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span
                        role="img"
                        aria-label={connectedTo ? 'connected' : 'disconnected'}
                        style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: connectedTo ? ptColor : 'transparent',
                          border: `1.5px solid ${ptColor}`,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: '9px', color: 'var(--text)' }}>{port.label}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className={styles.badge} style={{
                        background: ptColor + '15',
                        color: ptColor,
                        fontSize: '7px',
                        padding: '1px 4px',
                      }}>
                        {port.portType}
                      </span>
                      {connectedTo && (
                        <span style={{ fontSize: '8px', color: 'var(--text-faint)' }} title={`Connected to: ${connectedTo.join(', ')}`}>
                          &#x25B6;{connectedTo.length > 1 ? `×${connectedTo.length}` : ''}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </Section>

        {/* Editable data fields */}
        {fields.length > 0 && (
          <Section label="Properties">
            {fields.map(field => (
              <div key={field.key} className={styles.inspectorRow}>
                <span className={styles.inspectorLabel}>{field.label}</span>
                {field.type === 'select' && field.options ? (
                  <select
                    className={styles.inspectorInput}
                    aria-label={field.label}
                    value={(node.data[field.key] as string) ?? field.options[0]?.value ?? ''}
                    onChange={e => updateNodeData(node.id, field.key, e.target.value)}
                  >
                    {field.options.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : field.type === 'color' ? (
                  <input
                    type="color"
                    className={styles.inspectorColorInput}
                    aria-label={field.label}
                    value={(node.data[field.key] as string) || '#ffffff'}
                    onChange={e => updateNodeData(node.id, field.key, e.target.value)}
                  />
                ) : field.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    aria-label={field.label}
                    checked={!!node.data[field.key]}
                    onChange={e => updateNodeData(node.id, field.key, e.target.checked)}
                    style={{ width: 14, height: 14, cursor: 'pointer' }}
                  />
                ) : field.type === 'number' ? (
                  <input
                    type="number"
                    className={styles.inspectorInput}
                    aria-label={field.label}
                    style={{ width: '80px' }}
                    value={(node.data[field.key] as number) ?? ''}
                    placeholder="0"
                    onChange={e => updateNodeData(node.id, field.key, e.target.value === '' ? undefined : Number(e.target.value))}
                  />
                ) : (
                  <input
                    className={styles.inspectorInput}
                    aria-label={field.label}
                    value={(node.data[field.key] as string) ?? ''}
                    placeholder="..."
                    onChange={e => updateNodeData(node.id, field.key, e.target.value || undefined)}
                  />
                )}
              </div>
            ))}
          </Section>
        )}

        {/* Comment/Annotation */}
        <Section label="Comment" defaultOpen={!!node.comment}>
          <textarea
            className={styles.inspectorInput}
            aria-label="Node comment"
            value={node.comment ?? ''}
            placeholder="Add a note..."
            onChange={e => updateNodeComment(node.id, e.target.value || undefined)}
            style={{ width: '100%', minHeight: '48px', resize: 'vertical', fontFamily: "'JetBrains Mono', monospace", fontSize: '10px' }}
          />
        </Section>

        {/* Node Help */}
        {nodeHelp && (
          <Section label="Help" defaultOpen={false}>
            <div style={{ fontSize: '10px', color: 'var(--text)', lineHeight: 1.5, marginBottom: 6 }}>
              {nodeHelp.summary}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 6 }}>
              {nodeHelp.description}
            </div>
            {nodeHelp.tips && nodeHelp.tips.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {nodeHelp.tips.map((tip, i) => (
                  <div key={i} style={{ fontSize: '9px', color: 'var(--teal)', lineHeight: 1.4, marginBottom: 2, paddingLeft: 8, borderLeft: '2px solid color-mix(in srgb, var(--teal) 30%, transparent)' }}>
                    {tip}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Connected nodes */}
        {hasConnections && (
          <Section label="Connections" badge={
            <span style={{ fontSize: '8px', fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-faint)' }}>
              {connectedNodes.incoming.length + connectedNodes.outgoing.length}
            </span>
          }>
            {connectedNodes.incoming.map(c => (
              <div key={c.connId} className={styles.inspectorRow}>
                <span className={styles.inspectorLabel} style={{ color: 'var(--teal)' }}>
                  in[{c.portIdx}]
                </span>
                <button
                  className={styles.inspectorLink}
                  onClick={() => focusNode(c.nodeId)}
                  title={`Select ${c.title}`}
                >
                  {c.title}
                </button>
              </div>
            ))}
            {connectedNodes.outgoing.map(c => (
              <div key={c.connId} className={styles.inspectorRow}>
                <span className={styles.inspectorLabel} style={{ color: 'var(--orange)' }}>
                  out[{c.portIdx}]
                </span>
                <button
                  className={styles.inspectorLink}
                  onClick={() => focusNode(c.nodeId)}
                  title={`Select ${c.title}`}
                >
                  {c.title}
                </button>
              </div>
            ))}
          </Section>
        )}

        {/* Execution results */}
        {(hasOutputs || errorMsg) && (
          <Section label="Execution">
            {errorMsg && (
              <div style={{
                padding: '4px 8px',
                background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                borderRadius: 4,
                borderLeft: '2px solid var(--danger)',
                fontSize: '9px',
                color: 'var(--danger)',
                fontFamily: "'JetBrains Mono', monospace",
                marginBottom: 4,
                wordBreak: 'break-word',
              }}>
                {errorMsg}
              </div>
            )}
            {hasOutputs && node.outputs.map((outputPort, idx) => {
              const value = nodeOutputs[node.id]?.[idx];
              const ptColor = PORT_TYPE_COLORS[outputPort.portType as PortType] ?? PORT_TYPE_COLORS.any;
              return (
                <div key={outputPort.id} className={styles.inspectorRow}>
                  <span className={styles.inspectorLabel} style={{ color: ptColor }}>
                    {outputPort.label}
                  </span>
                  <span className={styles.inspectorValue} style={{
                    fontSize: '10px',
                    maxWidth: '140px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {formatOutputValue(value)}
                  </span>
                </div>
              );
            })}
            {hasMetrics && (
              <div style={{
                display: 'flex',
                gap: 8,
                padding: '4px 0',
                borderTop: '1px solid var(--divider)',
                marginTop: 4,
              }}>
                <span style={{ fontSize: '9px', color: 'var(--text-faint)', fontFamily: "'JetBrains Mono', monospace" }}>
                  {executionMetrics[node.id].duration.toFixed(2)}ms
                </span>
                <span style={{
                  fontSize: '9px',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: executionMetrics[node.id].cacheHit ? 'var(--success)' : 'var(--text-dim)',
                }}>
                  {executionMetrics[node.id].cacheHit ? 'cached' : 'computed'}
                </span>
              </div>
            )}
          </Section>
        )}

        <button className={styles.deleteBtn} onClick={() => removeNode(node.id)} aria-label={`Delete node ${node.title}`}>
          Delete Node
        </button>
      </div>
    );
  }

  if (connection) {
    const sourceNode = nodes[connection.sourceNodeId];
    const targetNode = nodes[connection.targetNodeId];

    return (
      <div className={styles.inspector}>
        <div className={styles.inspectorTitle}>Connection</div>

        <div className={styles.inspectorRow}>
          <span className={styles.inspectorLabel}>From</span>
          <button
            className={styles.inspectorLink}
            onClick={() => sourceNode && focusNode(sourceNode.id)}
          >
            {sourceNode?.title ?? '?'} [out {connection.sourcePortIndex}]
          </button>
        </div>

        <div className={styles.inspectorRow}>
          <span className={styles.inspectorLabel}>To</span>
          <button
            className={styles.inspectorLink}
            onClick={() => targetNode && focusNode(targetNode.id)}
          >
            {targetNode?.title ?? '?'} [in {connection.targetPortIndex}]
          </button>
        </div>

        <Section label="Details" defaultOpen={false}>
          <div className={styles.inspectorRow}>
            <span className={styles.inspectorLabel}>ID</span>
            <button
              className={styles.inspectorLink}
              onClick={() => handleCopyId(connection.id)}
              title="Copy ID"
              style={{ fontSize: '10px', opacity: 0.6 }}
            >
              {copiedId === connection.id ? 'Copied!' : connection.id}
            </button>
          </div>
        </Section>

        <Section label="Annotation">
          <div className={styles.inspectorRow}>
            <span className={styles.inspectorLabel}>Label</span>
            <input
              className={styles.inspectorInput}
              aria-label="Connection label"
              value={connection.label ?? ''}
              placeholder="..."
              onChange={e => updateConnectionLabel(connection.id, e.target.value || undefined)}
            />
          </div>
          <div className={styles.inspectorRow}>
            <span className={styles.inspectorLabel}>Color</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="color"
                className={styles.inspectorColorInput}
                aria-label="Connection color"
                value={connection.colorOverride ?? '#c0c8d0'}
                onChange={e => updateConnectionColor(connection.id, e.target.value)}
              />
              {connection.colorOverride && (
                <button
                  className={styles.inspectorLink}
                  onClick={() => updateConnectionColor(connection.id, undefined)}
                  title="Reset to default"
                  style={{ fontSize: '10px' }}
                >
                  reset
                </button>
              )}
            </div>
          </div>
        </Section>

        <button className={styles.deleteBtn} onClick={() => removeConnection(connection.id)} aria-label="Delete connection">
          Delete Connection
        </button>
      </div>
    );
  }

  return (
    <div className={styles.inspector} style={{ opacity: 0.6 }}>
      <div className={styles.inspectorTitle}>Inspector</div>
      <div style={{ fontSize: '11px', color: 'var(--text-faint)', lineHeight: 1.5, padding: '8px 0' }}>
        Select a node or connection to inspect its properties.
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-faint)', lineHeight: 1.6 }}>
        <kbd style={{ padding: '1px 4px', background: 'var(--btn-bg)', borderRadius: '3px', fontSize: '9px' }}>Ctrl+K</kbd> Command palette<br />
        <kbd style={{ padding: '1px 4px', background: 'var(--btn-bg)', borderRadius: '3px', fontSize: '9px' }}>?</kbd> All shortcuts
      </div>
    </div>
  );
});
