import { useState, useCallback, useEffect, useMemo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { generateSVG, downloadSVG } from '../../utils/svgExport';
import styles from '../../styles/panels.module.css';

export function ExportSVGDialog({ onClose }: { onClose: () => void }) {
  const nodes = useEditorStore(s => s.nodes);
  const connections = useEditorStore(s => s.connections);
  const groups = useEditorStore(s => s.groups);
  const graphTabs = useEditorStore(s => s.graphTabs);
  const activeGraphId = useEditorStore(s => s.activeGraphId);

  const defaultName = graphTabs[activeGraphId]?.name ?? 'Untitled Graph';

  const [title, setTitle] = useState(defaultName);
  const [scale, setScale] = useState(1);
  const [includeGroups, setIncludeGroups] = useState(true);
  const [bgColor, setBgColor] = useState('#1a1a2e');

  // Compute approximate SVG dimensions from nodes
  const dimensions = useMemo(() => {
    const nodeList = Object.values(nodes);
    if (nodeList.length === 0) return { width: 200, height: 100 };

    const SCALE_FACTOR = 100;
    const PADDING = 60;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodeList) {
      const cx = node.position[0] * SCALE_FACTOR;
      const cy = node.position[2] * SCALE_FACTOR;
      const w = ((node.width as number) ?? 1.6) * SCALE_FACTOR;
      const h = ((node.height as number) ?? 0.8) * SCALE_FACTOR;
      minX = Math.min(minX, cx - w / 2);
      minY = Math.min(minY, cy - h / 2);
      maxX = Math.max(maxX, cx + w / 2);
      maxY = Math.max(maxY, cy + h / 2);
    }
    return {
      width: Math.round(maxX - minX + PADDING * 2),
      height: Math.round(maxY - minY + PADDING * 2),
    };
  }, [nodes]);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleExport = useCallback(() => {
    const groupsToUse = includeGroups ? groups : {};
    let svg = generateSVG({ nodes, connections, groups: groupsToUse });

    // Insert <title> after the opening <svg> tag
    if (title.trim()) {
      const escaped = title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      svg = svg.replace(
        /(<svg[^>]*>)/,
        `$1\n  <title>${escaped}</title>`,
      );
    }

    // Apply scale: multiply width and height attributes (viewBox stays the same)
    if (scale !== 1) {
      svg = svg.replace(
        /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/,
        (_match, w, h) => {
          const newW = Math.round(parseFloat(w) * scale);
          const newH = Math.round(parseFloat(h) * scale);
          return `width="${newW}" height="${newH}"`;
        },
      );
    }

    // Apply background color if different from default
    if (bgColor !== '#1a1a2e') {
      svg = svg.replace(
        /fill="#1a1a2e"/,
        `fill="${bgColor}"`,
      );
    }

    const filename = `${(title || defaultName).replace(/[^a-zA-Z0-9_-]/g, '_')}.svg`;
    downloadSVG(svg, filename);
    onClose();
  }, [nodes, connections, groups, includeGroups, title, scale, bgColor, defaultName, onClose]);

  const nodeCount = Object.keys(nodes).length;
  const connectionCount = Object.keys(connections).length;
  const groupCount = Object.keys(groups).length;

  return (
    <div className={styles.searchBackdrop} onClick={onClose}>
      <div
        className={styles.searchPalette}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Export SVG"
        style={{ maxWidth: 420 }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: "'Archivo Black', sans-serif",
            fontSize: '13px',
            color: 'var(--text-bright)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Export SVG
          </span>
          <span style={{
            fontSize: '9px',
            color: 'var(--text-faint)',
            fontFamily: 'var(--font-mono)',
          }}>
            {nodeCount} nodes, {connectionCount} connections
          </span>
        </div>

        {/* Form body */}
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Title field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{
              fontSize: '9px',
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontFamily: 'var(--font-mono)',
            }}>
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                background: 'var(--divider)',
                border: '1px solid var(--panel-border)',
                borderRadius: 6,
                color: 'var(--text)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Scale */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{
              fontSize: '9px',
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              fontFamily: 'var(--font-mono)',
            }}>
              Scale
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                value={scale}
                min={0.25}
                max={10}
                step={0.25}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) setScale(v);
                }}
                style={{
                  width: 64,
                  padding: '5px 8px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--divider)',
                  border: '1px solid var(--panel-border)',
                  borderRadius: 6,
                  color: 'var(--text)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {[1, 2, 4].map(preset => (
                <button
                  key={preset}
                  onClick={() => setScale(preset)}
                  style={{
                    padding: '4px 10px',
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    background: scale === preset
                      ? 'var(--teal)'
                      : 'var(--bg-subtle)',
                    color: scale === preset
                      ? 'var(--bg)'
                      : 'var(--text-dim)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {preset}x
                </button>
              ))}
            </div>
          </div>

          {/* Include groups + Background color row */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
            {/* Include groups */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <label style={{
                fontSize: '9px',
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontFamily: 'var(--font-mono)',
              }}>
                Options
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text)',
              }}>
                <input
                  type="checkbox"
                  checked={includeGroups}
                  onChange={e => setIncludeGroups(e.target.checked)}
                  style={{ width: 14, height: 14 }}
                />
                Include groups ({groupCount})
              </label>
            </div>

            {/* Background color */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{
                fontSize: '9px',
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontFamily: 'var(--font-mono)',
              }}>
                Background
              </label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="color"
                  value={bgColor}
                  onChange={e => setBgColor(e.target.value)}
                  style={{
                    width: 28,
                    height: 28,
                    padding: 0,
                    border: '1px solid var(--panel-border)',
                    borderRadius: 4,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                />
                <span style={{
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-dim)',
                }}>
                  {bgColor}
                </span>
              </div>
            </div>
          </div>

          {/* Dimensions preview */}
          <div style={{
            padding: '8px 10px',
            background: 'color-mix(in srgb, var(--bg-subtle) 50%, transparent)',
            borderRadius: 6,
            border: '1px solid var(--divider)',
            display: 'flex',
            gap: 16,
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Width</span>
              <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{Math.round(dimensions.width * scale)}px</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Height</span>
              <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{Math.round(dimensions.height * scale)}px</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>ViewBox</span>
              <span style={{ color: 'var(--text-dim)' }}>{dimensions.width} x {dimensions.height}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: 'auto' }}>
              <span style={{ color: 'var(--text-faint)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Scale</span>
              <span style={{ color: 'var(--text-dim)' }}>{scale}x</span>
            </div>
          </div>
        </div>

        {/* Footer with action buttons */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--divider)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 16px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-subtle)',
              color: 'var(--text-dim)',
              border: '1px solid var(--panel-border)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={nodeCount === 0}
            style={{
              padding: '6px 20px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              background: nodeCount === 0 ? 'var(--bg-subtle)' : 'var(--teal)',
              color: nodeCount === 0 ? 'var(--text-faint)' : 'var(--bg)',
              border: 'none',
              borderRadius: 6,
              cursor: nodeCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
