/**
 * Context menu orchestrator — dispatches to specialized sub-menus.
 * Handles viewport clamping, focus management, keyboard navigation, and click-away.
 * Sub-menu content extracted into src/components/ui/menus/ during Phase 42.
 */
import { memo, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { useEditorStore } from '../../store/editorStore';
import styles from '../../styles/panels.module.css';

import { NodeMenu } from './menus/NodeMenu';
import { ConnectionMenu } from './menus/ConnectionMenu';
import { CanvasMenu } from './menus/CanvasMenu';
import { PortReleaseMenu } from './menus/PortReleaseMenu';
import { PortMenu } from './menus/PortMenu';

export const ContextMenu = memo(function ContextMenu() {
  const contextMenu = useEditorStore(s => s.contextMenu);
  const closeContextMenu = useEditorStore(s => s.closeContextMenu);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusIndexRef = useRef(0);

  const close = useCallback(() => closeContextMenu(), [closeContextMenu]);

  // Viewport clamping after render
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    if (rect.right > window.innerWidth - pad) {
      el.style.left = `${window.innerWidth - rect.width - pad}px`;
    }
    if (rect.bottom > window.innerHeight - pad) {
      el.style.top = `${window.innerHeight - rect.height - pad}px`;
    }
  }, [contextMenu]);

  // Focus the first menu item when opened (canvas menu manages its own focus via search input)
  useEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    if (contextMenu.target.kind === 'canvas') {
      focusIndexRef.current = -1;
      return;
    }
    focusIndexRef.current = 0;
    const items = menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items[0]?.focus();
  }, [contextMenu]);

  // Close on Escape, click-away, scroll, resize
  useEffect(() => {
    if (!contextMenu) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.stopImmediatePropagation(); close(); return; }
      if (!menuRef.current) return;
      // PortReleaseMenu manages its own keyboard navigation — skip parent handling
      if (contextMenu.target.kind === 'port-release') return;

      // When a text input is focused (e.g. canvas menu search), skip menu navigation
      // — the input manages its own ArrowDown/ArrowUp/Enter handling
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        return;
      }

      const items = menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]');
      const len = items.length;
      if (!len) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusIndexRef.current = (focusIndexRef.current + 1) % len;
        items[focusIndexRef.current]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // Canvas menu: ArrowUp from first item returns to search input
        if (focusIndexRef.current === 0 && contextMenu.target.kind === 'canvas') {
          const searchInput = menuRef.current.querySelector<HTMLElement>('input[type="text"]');
          if (searchInput) {
            focusIndexRef.current = -1;
            searchInput.focus();
            return;
          }
        }
        focusIndexRef.current = (focusIndexRef.current - 1 + len) % len;
        items[focusIndexRef.current]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusIndexRef.current = 0;
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        focusIndexRef.current = len - 1;
        items[len - 1]?.focus();
      }
    };

    const onClickAway = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };

    // Close on external scroll, but ignore scrolls within the menu itself
    // (the menu has an internal scrollable area for node categories/search results)
    const onScroll = (e: Event) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      close();
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onClickAway, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onClickAway, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [contextMenu, close]);

  if (!contextMenu) return null;

  const { x, y, target } = contextMenu;

  const exec = (fn: () => void) => {
    fn();
    close();
  };

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{ left: x, top: y }}
      role="menu"
      aria-label="Context menu"
    >
      {target.kind === 'node' && <NodeMenu nodeId={target.nodeId} exec={exec} />}
      {target.kind === 'connection' && <ConnectionMenu connectionId={target.connectionId} exec={exec} />}
      {target.kind === 'canvas' && <CanvasMenu exec={exec} />}
      {target.kind === 'port-release' && <PortReleaseMenu sourceNodeId={target.sourceNodeId} sourcePortIndex={target.sourcePortIndex} screenX={x} screenY={y} exec={exec} />}
      {target.kind === 'port' && <PortMenu nodeId={target.nodeId} portIndex={target.portIndex} portType={target.portType} exec={exec} />}
    </div>
  );
});
