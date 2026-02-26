/**
 * ErrorBoundary Component Tests
 *
 * Tests the ErrorBoundary React component which catches render errors in child
 * component trees and shows a styled fallback UI with error details and
 * recovery actions (Retry / Hard Reload).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, useState, type ReactNode } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A child component that always throws during render. */
function ThrowingChild({ message }: { message: string }): ReactNode {
  throw new Error(message);
}

/** A child component that renders normally. */
function GoodChild({ text }: { text: string }) {
  return createElement('div', { 'data-testid': 'good-child' }, text);
}

/**
 * A child component that throws on the first render but succeeds after
 * the ErrorBoundary resets (via Retry). Uses a module-level flag.
 */
let shouldThrow = true;
function ConditionalThrowChild() {
  if (shouldThrow) {
    throw new Error('conditional boom');
  }
  return createElement('div', { 'data-testid': 'recovered-child' }, 'Recovered!');
}

/**
 * A wrapper that lets a test trigger an error imperatively via a button click.
 * The child renders normally until the button is clicked, then it throws.
 */
function ToggleErrorChild() {
  const [doThrow, setDoThrow] = useState(false);
  if (doThrow) {
    throw new Error('toggled error');
  }
  return createElement('div', null,
    createElement('span', { 'data-testid': 'toggle-child' }, 'No error yet'),
    createElement('button', { 'data-testid': 'trigger-error', onClick: () => setDoThrow(true) }, 'Break'),
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Suppress React's default error boundary logging + our own console.error
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  shouldThrow = true;
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorBoundary', () => {
  // -------------------------------------------------------------------------
  // 1. Normal rendering (no error)
  // -------------------------------------------------------------------------

  describe('when children render without errors', () => {
    it('renders children normally', () => {
      render(
        createElement(ErrorBoundary, { label: 'TestPanel' },
          createElement(GoodChild, { text: 'Hello World' }),
        ),
      );

      expect(screen.getByTestId('good-child')).toBeInTheDocument();
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('does not show the fallback UI', () => {
      render(
        createElement(ErrorBoundary, { label: 'TestPanel' },
          createElement(GoodChild, { text: 'Healthy' }),
        ),
      );

      expect(screen.queryByText(/crashed/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText('Retry')).not.toBeInTheDocument();
      expect(screen.queryByText('Hard Reload')).not.toBeInTheDocument();
    });

    it('renders multiple children', () => {
      render(
        createElement(ErrorBoundary, { label: 'Multi' },
          createElement('span', { 'data-testid': 'child-a' }, 'A'),
          createElement('span', { 'data-testid': 'child-b' }, 'B'),
        ),
      );

      expect(screen.getByTestId('child-a')).toBeInTheDocument();
      expect(screen.getByTestId('child-b')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Error fallback UI
  // -------------------------------------------------------------------------

  describe('when a child throws during render', () => {
    it('shows the fallback UI instead of crashing', () => {
      render(
        createElement(ErrorBoundary, { label: 'Canvas' },
          createElement(ThrowingChild, { message: 'render exploded' }),
        ),
      );

      expect(screen.queryByTestId('good-child')).not.toBeInTheDocument();
      expect(screen.getByText(/crashed/i)).toBeInTheDocument();
    });

    it('displays the error message', () => {
      render(
        createElement(ErrorBoundary, { label: 'Canvas' },
          createElement(ThrowingChild, { message: 'WebGL context lost' }),
        ),
      );

      expect(screen.getByText('WebGL context lost')).toBeInTheDocument();
    });

    it('displays the label in the crashed heading', () => {
      render(
        createElement(ErrorBoundary, { label: 'Canvas' },
          createElement(ThrowingChild, { message: 'boom' }),
        ),
      );

      expect(screen.getByText('Canvas crashed')).toBeInTheDocument();
    });

    it('uses a different label correctly', () => {
      render(
        createElement(ErrorBoundary, { label: 'UI Panels' },
          createElement(ThrowingChild, { message: 'state error' }),
        ),
      );

      expect(screen.getByText('UI Panels crashed')).toBeInTheDocument();
    });

    it('has role="alert" on the error message element', () => {
      render(
        createElement(ErrorBoundary, { label: 'Canvas' },
          createElement(ThrowingChild, { message: 'alert test' }),
        ),
      );

      const alertEl = screen.getByRole('alert');
      expect(alertEl).toBeInTheDocument();
      expect(alertEl).toHaveTextContent('alert test');
    });

    it('shows a Retry button', () => {
      render(
        createElement(ErrorBoundary, { label: 'Canvas' },
          createElement(ThrowingChild, { message: 'boom' }),
        ),
      );

      expect(screen.getByText('Retry')).toBeInTheDocument();
      expect(screen.getByText('Retry').tagName).toBe('BUTTON');
    });

    it('shows a Hard Reload button', () => {
      render(
        createElement(ErrorBoundary, { label: 'Canvas' },
          createElement(ThrowingChild, { message: 'boom' }),
        ),
      );

      expect(screen.getByText('Hard Reload')).toBeInTheDocument();
      expect(screen.getByText('Hard Reload').tagName).toBe('BUTTON');
    });
  });

  // -------------------------------------------------------------------------
  // 3. componentDidCatch logging
  // -------------------------------------------------------------------------

  describe('componentDidCatch', () => {
    it('calls console.error with the boundary label', () => {
      render(
        createElement(ErrorBoundary, { label: '3D Scene' },
          createElement(ThrowingChild, { message: 'scene error' }),
        ),
      );

      // Find the call that contains our label format
      const labelCall = consoleErrorSpy.mock.calls.find(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('[ErrorBoundary:3D Scene]'),
      );
      expect(labelCall).toBeDefined();
    });

    it('passes the error object to console.error', () => {
      render(
        createElement(ErrorBoundary, { label: 'TestBoundary' },
          createElement(ThrowingChild, { message: 'specific error msg' }),
        ),
      );

      const labelCall = consoleErrorSpy.mock.calls.find(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('[ErrorBoundary:TestBoundary]'),
      );
      expect(labelCall).toBeDefined();
      // Second argument should be the Error object
      expect(labelCall![1]).toBeInstanceOf(Error);
      expect((labelCall![1] as Error).message).toBe('specific error msg');
    });

    it('passes the component stack to console.error', () => {
      render(
        createElement(ErrorBoundary, { label: 'StackTest' },
          createElement(ThrowingChild, { message: 'stack test' }),
        ),
      );

      const labelCall = consoleErrorSpy.mock.calls.find(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('[ErrorBoundary:StackTest]'),
      );
      expect(labelCall).toBeDefined();
      // Third argument should be the component stack (string)
      expect(typeof labelCall![2]).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Retry button
  // -------------------------------------------------------------------------

  describe('Retry button', () => {
    it('resets error state and re-renders children when they succeed', () => {
      shouldThrow = true;

      render(
        createElement(ErrorBoundary, { label: 'RecoverTest' },
          createElement(ConditionalThrowChild),
        ),
      );

      // Should be in error state
      expect(screen.getByText('RecoverTest crashed')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('conditional boom');

      // Now make the child succeed on next render
      shouldThrow = false;

      fireEvent.click(screen.getByText('Retry'));

      // Should recover and show the child
      expect(screen.queryByText('RecoverTest crashed')).not.toBeInTheDocument();
      expect(screen.getByTestId('recovered-child')).toBeInTheDocument();
      expect(screen.getByText('Recovered!')).toBeInTheDocument();
    });

    it('shows error fallback again if child still throws after retry', () => {
      shouldThrow = true;

      render(
        createElement(ErrorBoundary, { label: 'StillBroken' },
          createElement(ConditionalThrowChild),
        ),
      );

      expect(screen.getByText('StillBroken crashed')).toBeInTheDocument();

      // Do NOT flip shouldThrow - child will throw again
      fireEvent.click(screen.getByText('Retry'));

      // Should still show error fallback
      expect(screen.getByText('StillBroken crashed')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('conditional boom');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Hard Reload button
  // -------------------------------------------------------------------------

  describe('Hard Reload button', () => {
    it('calls window.location.reload', () => {
      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: reloadMock },
        writable: true,
        configurable: true,
      });

      render(
        createElement(ErrorBoundary, { label: 'HardReloadTest' },
          createElement(ThrowingChild, { message: 'fatal' }),
        ),
      );

      fireEvent.click(screen.getByText('Hard Reload'));
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Error triggered after initial render
  // -------------------------------------------------------------------------

  describe('error triggered after initial render', () => {
    it('catches errors that occur on re-render (not just mount)', () => {
      render(
        createElement(ErrorBoundary, { label: 'LateError' },
          createElement(ToggleErrorChild),
        ),
      );

      // Initially renders fine
      expect(screen.getByTestId('toggle-child')).toBeInTheDocument();
      expect(screen.getByText('No error yet')).toBeInTheDocument();

      // Trigger the error
      fireEvent.click(screen.getByTestId('trigger-error'));

      // Now should show error fallback
      expect(screen.getByText('LateError crashed')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('toggled error');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Sibling isolation
  // -------------------------------------------------------------------------

  describe('sibling ErrorBoundary isolation', () => {
    it('one boundary crashing does not affect a sibling boundary', () => {
      render(
        createElement('div', null,
          createElement(ErrorBoundary, { label: 'Broken Panel' },
            createElement(ThrowingChild, { message: 'panel died' }),
          ),
          createElement(ErrorBoundary, { label: 'Healthy Panel' },
            createElement(GoodChild, { text: 'I am fine' }),
          ),
        ),
      );

      // First boundary should show error
      expect(screen.getByText('Broken Panel crashed')).toBeInTheDocument();
      expect(screen.getByText('panel died')).toBeInTheDocument();

      // Second boundary should still render its children
      expect(screen.getByTestId('good-child')).toBeInTheDocument();
      expect(screen.getByText('I am fine')).toBeInTheDocument();
      expect(screen.queryByText('Healthy Panel crashed')).not.toBeInTheDocument();
    });

    it('retrying one boundary does not affect the sibling', () => {
      shouldThrow = true;

      render(
        createElement('div', null,
          createElement(ErrorBoundary, { label: 'Recoverable' },
            createElement(ConditionalThrowChild),
          ),
          createElement(ErrorBoundary, { label: 'Stable' },
            createElement(GoodChild, { text: 'Still here' }),
          ),
        ),
      );

      // First boundary crashed
      expect(screen.getByText('Recoverable crashed')).toBeInTheDocument();
      // Second boundary is fine
      expect(screen.getByText('Still here')).toBeInTheDocument();

      // Recover the first boundary
      shouldThrow = false;
      fireEvent.click(screen.getByText('Retry'));

      // First boundary recovered
      expect(screen.getByTestId('recovered-child')).toBeInTheDocument();
      // Second boundary still unaffected
      expect(screen.getByText('Still here')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 8. Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles an error with no message gracefully', () => {
      // Create a component that throws an Error with empty message
      function EmptyMessageThrow(): ReactNode {
        throw new Error('');
      }

      render(
        createElement(ErrorBoundary, { label: 'EmptyMsg' },
          createElement(EmptyMessageThrow),
        ),
      );

      expect(screen.getByText('EmptyMsg crashed')).toBeInTheDocument();
      // The alert element should exist even if the message is empty
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('handles a label with special characters', () => {
      render(
        createElement(ErrorBoundary, { label: '3D Scene (WebGL)' },
          createElement(ThrowingChild, { message: 'gpu crash' }),
        ),
      );

      expect(screen.getByText('3D Scene (WebGL) crashed')).toBeInTheDocument();
    });
  });
});
