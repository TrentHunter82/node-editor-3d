import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children?: ReactNode;
  /** Label shown in fallback UI to identify which section crashed */
  label: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that catches render errors in child component trees.
 * Shows a styled fallback UI with the error message and a reload button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  handleHardReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          minHeight: 120,
          background: 'var(--panel-bg-solid)',
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          padding: 24,
          gap: 12,
        }}>
          <div style={{ color: 'var(--danger)', fontFamily: 'var(--font-display)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1.5 }}>
            {this.props.label} crashed
          </div>
          <div role="alert" style={{ color: 'var(--text-dim)', fontSize: 11, maxWidth: 400, textAlign: 'center', wordBreak: 'break-word' }}>
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 16px',
                background: 'color-mix(in srgb, var(--teal) 15%, transparent)',
                border: '1px solid color-mix(in srgb, var(--teal) 30%, transparent)',
                borderRadius: 6,
                color: 'var(--teal)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleHardReload}
              style={{
                padding: '8px 16px',
                background: 'var(--btn-bg)',
                border: '1px solid var(--btn-border)',
                borderRadius: 6,
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Hard Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
