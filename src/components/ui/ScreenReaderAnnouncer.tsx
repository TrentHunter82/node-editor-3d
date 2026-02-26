import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';

/**
 * Invisible live region that announces graph state changes to screen readers.
 * Permanently in the DOM (unmounting defeats aria-live announcements).
 */
export function ScreenReaderAnnouncer() {
  const [message, setMessage] = useState('');
  const prevSelCount = useRef(0);
  const prevGraphId = useRef('');
  const prevNodeCount = useRef(0);
  const prevConnCount = useRef(0);
  const prevIsExecuting = useRef(false);
  const prevFocusedPort = useRef<{ nodeId: string; portIndex: number; side: 'input' | 'output' } | null>(null);
  const prevInteraction = useRef('');

  // Announce port focus changes (keyboard Tab navigation)
  useEffect(() => {
    const unsub = useEditorStore.subscribe(
      s => s.focusedPort,
      (focusedPort) => {
        if (!focusedPort) {
          if (prevFocusedPort.current) {
            setMessage('Port focus cleared');
          }
          prevFocusedPort.current = null;
          return;
        }
        const state = useEditorStore.getState();
        const node = state.nodes[focusedPort.nodeId];
        if (!node) {
          prevFocusedPort.current = focusedPort;
          return;
        }
        const ports = focusedPort.side === 'input' ? node.inputs : node.outputs;
        const port = ports[focusedPort.portIndex];
        if (port) {
          setMessage(`${focusedPort.side} port: ${port.label}, type ${port.portType}`);
        }
        prevFocusedPort.current = focusedPort;
      },
    );
    prevFocusedPort.current = useEditorStore.getState().focusedPort;
    return unsub;
  }, []);

  // Announce connection drawing start/complete/cancel
  useEffect(() => {
    const unsub = useEditorStore.subscribe(
      s => s.interaction,
      (interaction) => {
        const prev = prevInteraction.current;
        if (interaction === 'drawing-connection' && prev !== 'drawing-connection') {
          const state = useEditorStore.getState();
          const pc = state.pendingConnection;
          if (pc) {
            const node = state.nodes[pc.sourceNodeId];
            const portLabel = node?.outputs[pc.sourcePortIndex]?.label ?? `port ${pc.sourcePortIndex}`;
            setMessage(`Connection started from ${node?.title || node?.type || 'node'}, ${portLabel}`);
          }
        } else if (prev === 'drawing-connection' && interaction !== 'drawing-connection') {
          // Connection ended — check if a new connection was added or cancelled
          // A brief delay would be needed to check, but the connection add/remove
          // subscription already handles the "Connection added" announcement
        }
        prevInteraction.current = interaction;
      },
    );
    prevInteraction.current = useEditorStore.getState().interaction;
    return unsub;
  }, []);

  // Announce selection changes
  useEffect(() => {
    const unsub = useEditorStore.subscribe(s => s.selectedIds.size, (count) => {
      if (count === 0 && prevSelCount.current > 0) {
        setMessage('Selection cleared');
      } else if (count === 1) {
        const state = useEditorStore.getState();
        const id = [...state.selectedIds][0];
        const node = state.nodes[id];
        if (node) {
          setMessage(`Selected ${node.title || node.type} node`);
        }
      } else if (count > 1) {
        setMessage(`${count} items selected`);
      }
      prevSelCount.current = count;
    });
    prevSelCount.current = useEditorStore.getState().selectedIds.size;
    return unsub;
  }, []);

  // Announce graph switches
  useEffect(() => {
    const unsub = useEditorStore.subscribe(s => s.activeGraphId, (graphId) => {
      if (prevGraphId.current && graphId !== prevGraphId.current) {
        const state = useEditorStore.getState();
        const tab = state.graphTabs[graphId];
        if (tab) {
          setMessage(`Switched to graph: ${tab.name}`);
        }
      }
      prevGraphId.current = graphId;
    });
    prevGraphId.current = useEditorStore.getState().activeGraphId;
    return unsub;
  }, []);

  // Announce node creation/deletion
  useEffect(() => {
    const unsub = useEditorStore.subscribe(
      s => Object.keys(s.nodes).length,
      (count) => {
        const prev = prevNodeCount.current;
        if (prev === 0) {
          // Initial load / graph switch — skip announcement
          prevNodeCount.current = count;
          return;
        }
        const delta = count - prev;
        if (delta > 0) {
          setMessage(delta === 1 ? 'Node added' : `${delta} nodes added`);
        } else if (delta < 0) {
          const removed = -delta;
          setMessage(removed === 1 ? 'Node removed' : `${removed} nodes removed`);
        }
        prevNodeCount.current = count;
      },
    );
    prevNodeCount.current = Object.keys(useEditorStore.getState().nodes).length;
    return unsub;
  }, []);

  // Announce connection events
  useEffect(() => {
    const unsub = useEditorStore.subscribe(
      s => Object.keys(s.connections).length,
      (count) => {
        const prev = prevConnCount.current;
        if (prev === 0) {
          // Initial load / graph switch — skip announcement
          prevConnCount.current = count;
          return;
        }
        const delta = count - prev;
        if (delta > 0) {
          setMessage(delta === 1 ? 'Connection added' : `${delta} connections added`);
        } else if (delta < 0) {
          const removed = -delta;
          setMessage(removed === 1 ? 'Connection removed' : `${removed} connections removed`);
        }
        prevConnCount.current = count;
      },
    );
    prevConnCount.current = Object.keys(useEditorStore.getState().connections).length;
    return unsub;
  }, []);

  // Announce execution completion
  useEffect(() => {
    const unsub = useEditorStore.subscribe(
      s => s.isExecuting,
      (isExecuting) => {
        if (prevIsExecuting.current && !isExecuting) {
          // Transitioned from executing to idle
          const errors = useEditorStore.getState().executionErrors;
          const hasErrors = Object.keys(errors).length > 0;
          setMessage(hasErrors ? 'Execution complete with errors' : 'Execution complete');
        }
        prevIsExecuting.current = isExecuting;
      },
    );
    prevIsExecuting.current = useEditorStore.getState().isExecuting;
    return unsub;
  }, []);

  // Clear message after announcement delay so repeated same messages still announce
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 1500);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        clipPath: 'inset(100%)',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}
