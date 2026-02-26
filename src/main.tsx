import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Expose store for console debugging (lazy to avoid circular init order)
if (import.meta.env.DEV) {
  import('./store/editorStore').then(({ useEditorStore }) => {
    window.__store = useEditorStore;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
