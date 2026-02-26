import { memo } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Tooltip } from './Tooltip';
import styles from '../../styles/panels.module.css';

export const ExecuteBar = memo(function ExecuteBar() {
  const isExecuting = useEditorStore(s => s.isExecuting);
  const executeGraph = useEditorStore(s => s.executeGraph);
  const resetExecution = useEditorStore(s => s.resetExecution);
  const debugMode = useEditorStore(s => s.debugMode);
  const toggleDebugMode = useEditorStore(s => s.toggleDebugMode);
  const stepExecution = useEditorStore(s => s.stepExecution);
  const resumeExecution = useEditorStore(s => s.resumeExecution);
  const pausedAtWave = useEditorStore(s => s.pausedAtWave);
  const debugWaves = useEditorStore(s => s.debugWaves);
  const errorStrategy = useEditorStore(s => s.errorStrategy);
  const setErrorStrategy = useEditorStore(s => s.setErrorStrategy);
  const executionTotalDuration = useEditorStore(s => s.executionTotalDuration);

  const handleExecute = () => {
    if (isExecuting) {
      resetExecution();
    } else {
      executeGraph();
    }
  };

  return (
    <div className={styles.executeBar}>
      <Tooltip label={isExecuting ? 'Stop execution' : 'Execute graph'}>
        <button
          className={`${styles.toolbarBtn} ${styles.executeBarBtn} ${isExecuting ? styles.toolbarBtnActive : ''}`}
          onClick={handleExecute}
          style={isExecuting ? {} : { color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {isExecuting ? (
              <rect x="6" y="6" width="12" height="12" rx="2" />
            ) : (
              <polygon points="5 3 19 12 5 21 5 3" />
            )}
          </svg>
          {isExecuting ? 'Stop' : 'Run'}
        </button>
      </Tooltip>

      <Tooltip label="Toggle debug mode (step through waves)">
        <button
          className={`${styles.toolbarBtn} ${styles.executeBarBtn} ${debugMode ? styles.toolbarBtnActive : ''}`}
          onClick={toggleDebugMode}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a3 3 0 0 0-3 3v1H6v2h3v1.3A7 7 0 0 0 5 16v1h14v-1a7 7 0 0 0-4-6.3V8h3V6h-3V5a3 3 0 0 0-3-3z" />
          </svg>
          Debug
        </button>
      </Tooltip>

      {debugMode && pausedAtWave >= 0 && (
        <>
          <Tooltip label="Step to next wave">
            <button className={`${styles.toolbarBtn} ${styles.executeBarBtn}`} onClick={stepExecution}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 4l10 8-10 8V4z" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
              Step
            </button>
          </Tooltip>
          <Tooltip label="Resume execution (run remaining waves)">
            <button className={`${styles.toolbarBtn} ${styles.executeBarBtn}`} onClick={resumeExecution}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 3l14 9-14 9V3z" />
              </svg>
              Resume
            </button>
          </Tooltip>
        </>
      )}

      {debugMode && pausedAtWave >= 0 && debugWaves.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px' }}>
          <div style={{ width: 40, height: 3, background: 'var(--divider)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${((pausedAtWave + 1) / debugWaves.length * 100)}%`,
              background: 'var(--teal)',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }} />
          </div>
          <span style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            {pausedAtWave + 1}/{debugWaves.length}
          </span>
        </div>
      )}

      <Tooltip label={errorStrategy === 'fail-fast' ? 'Stops on first error' : 'Skips errors, runs remaining'} shortcut="Shift+E">
        <button
          className={`${styles.toolbarBtn} ${styles.executeBarBtn}`}
          onClick={() => setErrorStrategy(errorStrategy === 'fail-fast' ? 'continue' : 'fail-fast')}
          style={errorStrategy === 'continue'
            ? { color: 'var(--warning)', borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)' }
            : {}}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {errorStrategy === 'fail-fast' ? (
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </>
            ) : (
              <>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </>
            )}
          </svg>
          {errorStrategy === 'fail-fast' ? 'Fail' : 'Continue'}
        </button>
      </Tooltip>

      {executionTotalDuration > 0 && (
        <span style={{
          fontSize: '9px',
          color: 'var(--btn-text)',
          fontFamily: 'var(--font-mono)',
          padding: '0 4px',
          whiteSpace: 'nowrap',
        }}>
          {executionTotalDuration.toFixed(1)}ms
        </span>
      )}
    </div>
  );
});
