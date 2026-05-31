import { useState, useCallback, useRef, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import type { PortConfig, PortType } from '../../types';
import styles from '../../styles/panels.module.css';

const PORT_TYPES: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'any'];

// --- Expression autocomplete suggestions ---

const MATH_FUNCTIONS = [
  'Math.sin', 'Math.cos', 'Math.tan', 'Math.abs', 'Math.floor', 'Math.ceil',
  'Math.round', 'Math.sqrt', 'Math.log', 'Math.min', 'Math.max', 'Math.pow',
  'Math.PI', 'Math.E', 'Math.random', 'Math.sign', 'Math.trunc',
  'Math.atan2', 'Math.hypot', 'Math.cbrt', 'Math.exp', 'Math.log2', 'Math.log10',
];

const COMMON_PATTERNS = [
  'inputs[0]', 'inputs[1]', 'inputs[2]',
  'in0 + in1', 'in0 * in1', 'in0 - in1', 'in0 / in1',
  'in0 > in1 ? in0 : in1',  // max
  'in0 < in1 ? in0 : in1',  // min
  'Math.max(in0, Math.min(in1, in2))',  // clamp pattern
];

function getSuggestions(text: string, cursorPos: number, inputCount: number): string[] {
  // Get the word being typed (up to cursor)
  const before = text.slice(0, cursorPos);
  const match = before.match(/[\w.[\]]*$/);
  const prefix = match ? match[0].toLowerCase() : '';
  if (!prefix) return [];

  const candidates: string[] = [];

  // Input variables
  for (let i = 0; i < inputCount; i++) {
    candidates.push(`in${i}`);
    candidates.push(`inputs[${i}]`);
  }

  // Math functions/constants
  candidates.push(...MATH_FUNCTIONS);

  // Common patterns (only if prefix is short)
  if (prefix.length <= 3) {
    candidates.push(...COMMON_PATTERNS);
  }

  return candidates
    .filter(c => c.toLowerCase().startsWith(prefix) && c.toLowerCase() !== prefix)
    .slice(0, 12);
}

function validateExpression(expr: string, inputCount: number): string | null {
  if (!expr.trim()) return 'Expression is empty';
  try {
    const params: string[] = ['inputs'];
    for (let i = 0; i < inputCount; i++) params.push(`in${i}`);
    params.push('Math');
    new Function(...params, `return (${expr})`);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function evaluatePreview(expr: string, inputCount: number, testValues?: number[]): string {
  try {
    const params: string[] = ['inputs', 'Math'];
    const values: unknown[] = [{}, Math];
    const inputObj: Record<number, number> = {};
    for (let i = 0; i < inputCount; i++) {
      params.push(`in${i}`);
      const val = testValues && i < testValues.length ? testValues[i] : i + 1;
      values.push(val);
      inputObj[i] = val;
    }
    values[0] = inputObj;
    const fn = new Function(...params, `"use strict"; return (() => (${expr}))()`);
    const result = fn(...values);
    if (result === undefined) return 'undefined';
    if (result === null) return 'null';
    if (typeof result === 'number') return Number.isNaN(result) ? 'NaN' : String(result);
    if (typeof result === 'object') {
      const s = JSON.stringify(result);
      return s.length > 80 ? s.slice(0, 80) + '...' : s;
    }
    return String(result);
  } catch {
    return '—';
  }
}

/** Simple syntax highlighter for expressions — returns HTML string */
function highlightExpression(expr: string): string {
  return expr
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Numbers (including decimals)
    .replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#CE9178">$1</span>')
    // Math.* functions and constants
    .replace(/\b(Math)\.([\w]+)/g, '<span style="color:#4EC9B0">$1</span>.<span style="color:#DCDCAA">$2</span>')
    // Input variables (in0, in1, inputs)
    .replace(/\b(in\d+|inputs)\b/g, '<span style="color:#9CDCFE">$1</span>')
    // Keywords and operators
    .replace(/\b(true|false|null|undefined|NaN|Infinity)\b/g, '<span style="color:#569CD6">$1</span>')
    // String literals
    .replace(/'([^']*)'/g, '\'<span style="color:#CE9178">$1</span>\'')
    .replace(/"([^"]*)"/g, '"<span style="color:#CE9178">$1</span>"');
}

interface CustomNodeEditorPanelProps {
  open: boolean;
  onClose: () => void;
  nodeId: string | null;
}

export function CustomNodeEditorPanel({ open, onClose, nodeId }: CustomNodeEditorPanelProps) {
  const node = useEditorStore(s => nodeId ? s.nodes[nodeId] : undefined);
  const customNodeDefs = useEditorStore(s => s.customNodeDefs);
  const updateCustomNodeDef = useEditorStore(s => s.updateCustomNodeDef);
  const updateNodeData = useEditorStore(s => s.updateNodeData);

  // Local edit state
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2EC4B6');
  const [expression, setExpression] = useState('');
  const [inputs, setInputs] = useState<PortConfig[]>([]);
  const [outputs, setOutputs] = useState<PortConfig[]>([]);
  const [dirty, setDirty] = useState(false);

  // Autocomplete state
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Test input values for live preview
  const [testValues, setTestValues] = useState<number[]>([]);

  // Load node data into the form on the open transition (or when switching to a
  // different node). Done during render via a stored key rather than a
  // setState-in-effect, so opening the panel doesn't trigger a cascading render
  // — and in-progress edits are no longer clobbered by unrelated store updates.
  const loadKey = open && node ? nodeId : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (loadKey !== loadedKey) {
    setLoadedKey(loadKey);
    if (open && node) {
      const defId = node.data.customDefId as string | undefined;
      const def = defId ? customNodeDefs[defId] : undefined;
      setName(node.title || 'Custom Node');
      setColor(def?.color || '#2EC4B6');
      setExpression((node.data.expression as string) || 'in0');
      const inputDefs = def?.inputs || node.inputs.map(p => ({ label: p.label, portType: p.portType }));
      setInputs(inputDefs);
      setOutputs(def?.outputs || node.outputs.map(p => ({ label: p.label, portType: p.portType })));
      setTestValues(inputDefs.map((_: unknown, i: number) => i + 1));
      setDirty(false);
      setShowSuggestions(false);
    }
  }

  const exprError = useMemo(() => validateExpression(expression, inputs.length), [expression, inputs.length]);
  const preview = useMemo(() => evaluatePreview(expression, inputs.length, testValues), [expression, inputs.length, testValues]);
  const highlightedExpr = useMemo(() => highlightExpression(expression), [expression]);

  const handleSave = useCallback(() => {
    if (!node || exprError) return;
    const defId = node.data.customDefId as string | undefined;
    if (defId && customNodeDefs[defId]) {
      // Update the definition (this also updates all nodes referencing it)
      updateCustomNodeDef(defId, { name, color, expression, inputs, outputs });
    } else {
      // Node has no def — update just the node data directly
      updateNodeData(node.id, 'expression', expression);
    }
    setDirty(false);
    onClose();
  }, [node, name, color, expression, inputs, outputs, exprError, customNodeDefs, updateCustomNodeDef, updateNodeData, onClose]);

  const handleExpressionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setExpression(val);
    setDirty(true);
    // Update autocomplete
    const cursor = e.target.selectionStart ?? val.length;
    const s = getSuggestions(val, cursor, inputs.length);
    setSuggestions(s);
    setShowSuggestions(s.length > 0);
    setSelectedSuggestion(0);
  }, [inputs.length]);

  const insertSuggestion = useCallback((suggestion: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart ?? expression.length;
    const before = expression.slice(0, cursor);
    const after = expression.slice(cursor);
    // Find the word being replaced
    const match = before.match(/[\w.[\]]*$/);
    const prefix = match ? match[0] : '';
    const newBefore = before.slice(0, before.length - prefix.length) + suggestion;
    setExpression(newBefore + after);
    setDirty(true);
    setShowSuggestions(false);
    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newBefore.length, newBefore.length);
    });
  }, [expression]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation(); // Prevent global shortcuts

    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestion(i => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestion(i => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSuggestion(suggestions[selectedSuggestion]);
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
    }

    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
      return;
    }
  }, [showSuggestions, suggestions, selectedSuggestion, insertSuggestion, onClose, handleSave]);

  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && e.ctrlKey) handleSave();
  }, [onClose, handleSave]);

  // Port management
  const addInput = () => { setInputs(prev => [...prev, { label: `in${prev.length}`, portType: 'number' }]); setTestValues(prev => [...prev, prev.length + 1]); setDirty(true); };
  const addOutput = () => { setOutputs(prev => [...prev, { label: `out${prev.length}`, portType: 'number' }]); setDirty(true); };
  const removeInput = (idx: number) => { setInputs(prev => prev.filter((_, i) => i !== idx)); setTestValues(prev => prev.filter((_, i) => i !== idx)); setDirty(true); };
  const removeOutput = (idx: number) => { setOutputs(prev => prev.filter((_, i) => i !== idx)); setDirty(true); };
  const updateInput = (idx: number, field: 'label' | 'portType', value: string) => {
    setInputs(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
    setDirty(true);
  };
  const updateOutput = (idx: number, field: 'label' | 'portType', value: string) => {
    setOutputs(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
    setDirty(true);
  };

  if (!open || !node) return null;

  const COLOR_OPTIONS = ['#2EC4B6', '#FF6B35', '#E8453C', '#9B59B6', '#FFD700', '#00CED1', '#FF00FF'];

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.searchPalette}
        style={{ width: '420px', maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
        onKeyDown={handlePanelKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Edit custom node"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--text-bright)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Edit Custom Node
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 16 }}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div style={{ overflowY: 'auto', maxHeight: 'calc(85vh - 120px)' }}>
          {/* Name */}
          <Label>Name</Label>
          <input
            style={inputStyle}
            value={name}
            onChange={e => { setName(e.target.value); setDirty(true); }}
            onKeyDown={handlePanelKeyDown}
            aria-label="Node name"
          />

          {/* Color */}
          <Label>Color</Label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }} role="radiogroup" aria-label="Node color">
            {COLOR_OPTIONS.map(c => (
              <div
                key={c}
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                tabIndex={0}
                onClick={() => { setColor(c); setDirty(true); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setColor(c); setDirty(true); } }}
                style={{
                  width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: c === color ? '2px solid var(--text-bright)' : '2px solid transparent',
                }}
              />
            ))}
          </div>

          {/* Input Ports */}
          <Label>Input Ports ({inputs.length})</Label>
          {inputs.map((port, i) => (
            <PortRow key={i} port={port} index={i} kind="Input"
              onUpdate={updateInput} onRemove={removeInput}
              onKeyDown={handlePanelKeyDown} />
          ))}
          {inputs.length < 8 && (
            <button style={smallBtnStyle} onClick={addInput}>+ Add Input</button>
          )}

          {/* Output Ports */}
          <Label>Output Ports ({outputs.length})</Label>
          {outputs.map((port, i) => (
            <PortRow key={i} port={port} index={i} kind="Output"
              onUpdate={updateOutput} onRemove={removeOutput}
              onKeyDown={handlePanelKeyDown} />
          ))}
          {outputs.length < 8 && (
            <button style={smallBtnStyle} onClick={addOutput}>+ Add Output</button>
          )}

          {/* Expression with syntax highlighting and autocomplete */}
          <Label>Expression</Label>
          <div style={{ position: 'relative' }}>
            {/* Syntax highlighting overlay */}
            <pre
              aria-hidden="true"
              style={{
                ...inputStyle,
                minHeight: 60,
                fontFamily: 'var(--font-mono)',
                margin: 0,
                pointerEvents: 'none',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                overflow: 'hidden',
                position: 'absolute',
                inset: 0,
                borderColor: 'transparent',
                background: 'transparent',
                color: 'transparent',
              }}
              dangerouslySetInnerHTML={{ __html: highlightedExpr + '\n' }}
            />
            <textarea
              ref={textareaRef}
              style={{
                ...inputStyle,
                minHeight: 60,
                resize: 'vertical',
                fontFamily: 'var(--font-mono)',
                borderColor: exprError ? 'color-mix(in srgb, var(--danger) 50%, transparent)' : undefined,
                color: 'transparent',
                caretColor: 'var(--text)',
                background: 'color-mix(in srgb, var(--btn-bg) 40%, transparent)',
              }}
              value={expression}
              onChange={handleExpressionChange}
              onKeyDown={handleKeyDown}
              onBlur={() => { setTimeout(() => setShowSuggestions(false), 150); }}
              placeholder="in0 * 2 + in1"
              aria-label="Expression"
              aria-invalid={!!exprError}
              spellCheck={false}
            />
            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div style={dropdownStyle} role="listbox" aria-label="Expression suggestions">
                {suggestions.map((s, i) => (
                  <div
                    key={s}
                    role="option"
                    aria-selected={i === selectedSuggestion}
                    style={{
                      padding: '4px 8px',
                      cursor: 'pointer',
                      background: i === selectedSuggestion ? 'color-mix(in srgb, var(--teal) 20%, transparent)' : 'transparent',
                      color: i === selectedSuggestion ? 'var(--teal)' : 'var(--text)',
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                    }}
                    onMouseDown={e => { e.preventDefault(); insertSuggestion(s); }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>
          {exprError ? (
            <div style={{ fontSize: 9, color: 'var(--danger)', marginTop: 4 }} role="alert">{exprError}</div>
          ) : (
            <div style={{ fontSize: 9, color: 'color-mix(in srgb, var(--success) 70%, transparent)', marginTop: 4 }}>
              Expression is valid
            </div>
          )}
          <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>
            Use in0, in1, inputs[0], Math.* — Ctrl+Space for suggestions
          </div>

          {/* Test input values */}
          {inputs.length > 0 && (
            <>
              <Label>Test Inputs</Label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {inputs.map((inp, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      {inp.label || `in${i}`}=
                    </span>
                    <input
                      type="number"
                      value={testValues[i] ?? i + 1}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        setTestValues(prev => {
                          const next = [...prev];
                          next[i] = isNaN(v) ? 0 : v;
                          return next;
                        });
                      }}
                      style={{
                        ...inputStyle,
                        width: 56,
                        padding: '2px 4px',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                      }}
                      aria-label={`Test value for ${inp.label || `in${i}`}`}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Live preview */}
          <Label>Preview</Label>
          <div style={{
            padding: '6px 10px',
            background: 'color-mix(in srgb, var(--btn-bg) 70%, transparent)',
            borderRadius: 6,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: exprError ? 'var(--text-dim)' : 'var(--text-bright)',
          }}>
            {exprError ? '—' : `→ ${preview}`}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            style={{
              flex: 1, padding: 8,
              background: (exprError || !dirty) ? 'var(--btn-bg)' : 'color-mix(in srgb, var(--teal) 15%, transparent)',
              border: `1px solid ${(exprError || !dirty) ? 'var(--btn-border)' : 'color-mix(in srgb, var(--teal) 30%, transparent)'}`,
              borderRadius: 6,
              color: (exprError || !dirty) ? 'var(--text-dim)' : 'var(--teal)',
              fontSize: 11, cursor: (exprError || !dirty) ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
            onClick={handleSave}
            disabled={!!exprError || !dirty}
          >
            Save (Ctrl+Enter)
          </button>
          <button
            style={{
              padding: '8px 16px', background: 'var(--btn-bg)',
              border: '1px solid var(--btn-border)', borderRadius: 6,
              color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Shared sub-components and styles ---

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase',
      letterSpacing: 1, marginBottom: 4, marginTop: 10,
    }}>
      {children}
    </div>
  );
}

function PortRow({ port, index, kind, onUpdate, onRemove, onKeyDown }: {
  port: PortConfig;
  index: number;
  kind: string;
  onUpdate: (idx: number, field: 'label' | 'portType', value: string) => void;
  onRemove: (idx: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
      <input
        style={{ ...inputStyle, flex: 1 }}
        value={port.label}
        onChange={e => onUpdate(index, 'label', e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="label"
        aria-label={`${kind} port ${index + 1} label`}
      />
      <select
        style={{ ...inputStyle, width: 90, padding: '4px 6px', fontSize: 10 }}
        value={port.portType}
        onChange={e => onUpdate(index, 'portType', e.target.value)}
        aria-label={`${kind} port ${index + 1} type`}
      >
        {PORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <button
        style={{
          ...smallBtnStyle,
          color: 'var(--danger)',
          border: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)',
          padding: '4px 6px', lineHeight: 1,
        }}
        onClick={() => onRemove(index)}
        title="Remove"
        aria-label={`Remove ${kind.toLowerCase()} port ${index + 1}`}
      >
        &times;
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--btn-bg)',
  border: '1px solid var(--btn-border)',
  borderRadius: 6,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: 'var(--btn-bg)',
  border: '1px solid var(--btn-border)',
  borderRadius: 4,
  color: 'var(--text-dim)',
  fontSize: 10,
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  background: 'var(--panel-bg-solid)',
  border: '1px solid var(--panel-border)',
  borderRadius: 6,
  maxHeight: 160,
  overflowY: 'auto',
  zIndex: 10,
  boxShadow: '0 4px 12px var(--shadow)',
};
