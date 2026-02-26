import { useState, useCallback, useRef, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import type { PortConfig, PortType } from '../../types';

const PORT_TYPES: PortType[] = ['number', 'string', 'vector3', 'color', 'boolean', 'any'];
const COLOR_OPTIONS = ['#2EC4B6', '#FF6B35', '#E8453C', '#9B59B6', '#FFD700', '#00CED1', '#FF00FF'];

/** Try to parse the expression and return an error message or null if valid */
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

interface CustomNodeModalProps {
  open: boolean;
  onClose: () => void;
}

export function CustomNodeModal({ open, onClose }: CustomNodeModalProps) {
  const addCustomNodeDef = useEditorStore(s => s.addCustomNodeDef);

  const [name, setName] = useState('My Node');
  const [color, setColor] = useState('#2EC4B6');
  const [expression, setExpression] = useState('inputs[0]');
  const [inputs, setInputs] = useState<PortConfig[]>([{ label: 'in', portType: 'number' }]);
  const [outputs, setOutputs] = useState<PortConfig[]>([{ label: 'out', portType: 'number' }]);

  const panelRef = useRef<HTMLDivElement>(null);

  // Expression validation (memoized)
  const exprError = useMemo(() => validateExpression(expression, inputs.length), [expression, inputs.length]);

  const handleSubmit = useCallback(() => {
    if (!name.trim() || exprError) return;
    addCustomNodeDef({
      name: name.trim(),
      color,
      category: 'Custom',
      inputs,
      outputs,
      expression,
    });
    // Reset form
    setName('My Node');
    setColor('#2EC4B6');
    setExpression('inputs[0]');
    setInputs([{ label: 'in', portType: 'number' }]);
    setOutputs([{ label: 'out', portType: 'number' }]);
    onClose();
  }, [name, color, expression, inputs, outputs, addCustomNodeDef, onClose, exprError]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation(); // Prevent global shortcuts
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && e.ctrlKey) handleSubmit();
    // Focus trap
    if (e.key === 'Tab') {
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'input, select, button, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
  }, [onClose, handleSubmit]);

  const addInput = () => setInputs(prev => [...prev, { label: `in${prev.length}`, portType: 'number' }]);
  const addOutput = () => setOutputs(prev => [...prev, { label: `out${prev.length}`, portType: 'number' }]);
  const removeInput = (idx: number) => setInputs(prev => prev.filter((_, i) => i !== idx));
  const removeOutput = (idx: number) => setOutputs(prev => prev.filter((_, i) => i !== idx));

  const updateInput = (idx: number, field: 'label' | 'portType', value: string) => {
    setInputs(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };
  const updateOutput = (idx: number, field: 'label' | 'portType', value: string) => {
    setOutputs(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  if (!open) return null;

  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--overlay-bg)',
    backdropFilter: 'blur(4px)',
    zIndex: 200,
  };

  const panelStyle: React.CSSProperties = {
    background: 'var(--panel-bg-solid)',
    border: '1px solid var(--panel-border)',
    borderRadius: '12px',
    padding: '20px',
    width: '380px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    overflowY: 'auto',
    fontFamily: 'var(--font-mono)',
    color: 'var(--text)',
  };

  const titleStyle: React.CSSProperties = {
    fontFamily: 'var(--font-display)',
    fontSize: '14px',
    color: 'var(--text-bright)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '16px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '10px',
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    marginBottom: '4px',
    marginTop: '12px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    background: 'var(--btn-bg)',
    border: '1px solid var(--btn-border)',
    borderRadius: '6px',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    width: '90px',
    padding: '4px 6px',
    fontSize: '10px',
  };

  const portRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '4px',
  };

  const smallBtnStyle: React.CSSProperties = {
    padding: '4px 8px',
    background: 'var(--btn-bg)',
    border: '1px solid var(--btn-border)',
    borderRadius: '4px',
    color: 'var(--text-dim)',
    fontSize: '10px',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
  };

  const removeBtnStyle: React.CSSProperties = {
    ...smallBtnStyle,
    color: 'var(--danger)',
    border: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)',
    padding: '4px 6px',
    lineHeight: 1,
  };

  return (
    <div style={modalStyle} onClick={onClose} onKeyDown={handleKeyDown} role="dialog" aria-modal="true" aria-label="Create custom node">
      <div ref={panelRef} style={panelStyle} onClick={e => e.stopPropagation()}>
        <div style={titleStyle}>Create Custom Node</div>

        <div style={labelStyle}>Name</div>
        <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} onKeyDown={handleKeyDown} aria-label="Node name" autoFocus />

        <div style={labelStyle}>Color</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }} role="radiogroup" aria-label="Node color">
          {COLOR_OPTIONS.map(c => (
            <div
              key={c}
              role="radio"
              aria-checked={c === color}
              aria-label={c}
              tabIndex={0}
              onClick={() => setColor(c)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setColor(c); } }}
              style={{
                width: '24px', height: '24px', borderRadius: '50%', background: c, cursor: 'pointer',
                border: c === color ? '2px solid var(--text-bright)' : '2px solid transparent',
                transition: 'border-color 0.15s',
              }}
            />
          ))}
        </div>

        <div style={labelStyle}>Input Ports</div>
        {inputs.map((port, i) => (
          <div key={i} style={portRowStyle}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={port.label}
              onChange={e => updateInput(i, 'label', e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="label"
              aria-label={`Input port ${i + 1} label`}
            />
            <select
              style={selectStyle}
              value={port.portType}
              onChange={e => updateInput(i, 'portType', e.target.value)}
              aria-label={`Input port ${i + 1} type`}
            >
              {PORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button style={removeBtnStyle} onClick={() => removeInput(i)} title="Remove" aria-label={`Remove input port ${i + 1}`}>&times;</button>
          </div>
        ))}
        <button style={smallBtnStyle} onClick={addInput}>+ Add Input</button>

        <div style={labelStyle}>Output Ports</div>
        {outputs.map((port, i) => (
          <div key={i} style={portRowStyle}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={port.label}
              onChange={e => updateOutput(i, 'label', e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="label"
              aria-label={`Output port ${i + 1} label`}
            />
            <select
              style={selectStyle}
              value={port.portType}
              onChange={e => updateOutput(i, 'portType', e.target.value)}
              aria-label={`Output port ${i + 1} type`}
            >
              {PORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button style={removeBtnStyle} onClick={() => removeOutput(i)} title="Remove" aria-label={`Remove output port ${i + 1}`}>&times;</button>
          </div>
        ))}
        <button style={smallBtnStyle} onClick={addOutput}>+ Add Output</button>

        <div style={labelStyle}>Expression</div>
        <input
          style={{
            ...inputStyle,
            borderColor: exprError ? 'color-mix(in srgb, var(--danger) 50%, transparent)' : undefined,
          }}
          value={expression}
          onChange={e => setExpression(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="inputs[0] * 2 + inputs[1]"
          aria-label="Expression"
          aria-invalid={!!exprError}
        />
        {exprError ? (
          <div style={{ fontSize: '9px', color: 'var(--danger)', marginTop: '4px' }} role="alert">
            {exprError}
          </div>
        ) : (
          <div style={{ fontSize: '9px', color: 'color-mix(in srgb, var(--success) 70%, transparent)', marginTop: '4px' }}>
            Expression is valid
          </div>
        )}
        <div style={{ fontSize: '9px', color: 'var(--text-faint)', marginTop: '2px' }}>
          Use inputs[0], in0, in1, etc. and Math functions
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            style={{
              flex: 1, padding: '8px',
              background: exprError ? 'var(--btn-bg)' : 'color-mix(in srgb, var(--teal) 15%, transparent)',
              border: `1px solid ${exprError ? 'var(--btn-border)' : 'color-mix(in srgb, var(--teal) 30%, transparent)'}`,
              borderRadius: '6px',
              color: exprError ? 'var(--text-dim)' : 'var(--teal)',
              fontSize: '11px',
              cursor: exprError ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-mono)',
            }}
            onClick={handleSubmit}
            disabled={!!exprError}
          >
            Create (Ctrl+Enter)
          </button>
          <button
            style={{
              padding: '8px 16px', background: 'var(--btn-bg)',
              border: '1px solid var(--btn-border)', borderRadius: '6px',
              color: 'var(--text-dim)', fontSize: '11px', cursor: 'pointer',
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
