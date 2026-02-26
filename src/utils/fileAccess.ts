/**
 * File System Access API wrapper with graceful fallback.
 * Uses showSaveFilePicker/showOpenFilePicker when available,
 * falls back to download/upload for unsupported browsers.
 *
 * Supports file handle persistence for Ctrl+S "save in place".
 */

const FILE_EXTENSION = '.rne3d';
const FILE_DESCRIPTION = 'Rosebud Node Editor Graph';
const MIME_TYPE = 'application/json';

/** Check if File System Access API is available */
function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    'showOpenFilePicker' in window;
}

/** File type options for the native file picker */
const FILE_TYPES = [{
  description: FILE_DESCRIPTION,
  accept: { [MIME_TYPE]: [FILE_EXTENSION, '.json'] },
}];

// --- File handle persistence for Ctrl+S ---

/** The last-used file handle (persists until page reload) */
let _currentFileHandle: FileSystemFileHandle | null = null;
let _currentFileName: string | null = null;

/** Get the name of the currently open file (null if none) */
export function getCurrentFileName(): string | null {
  return _currentFileName;
}

/** Clear the current file handle (e.g., after new/import) */
export function clearFileHandle(): void {
  _currentFileHandle = null;
  _currentFileName = null;
}

/**
 * Save content directly to the current file handle (Ctrl+S behavior).
 * Returns the filename if successful, null if no handle exists.
 * Falls back to saveFile() if no handle is persisted.
 */
export async function saveToCurrentFile(content: string): Promise<string | null> {
  if (_currentFileHandle && hasFileSystemAccess()) {
    try {
      const writable = await _currentFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return _currentFileHandle.name;
    } catch {
      // Handle may have been invalidated (file moved/deleted)
      // Fall through to Save As
    }
  }
  return null;
}

/**
 * Save content to a file using File System Access API or download fallback.
 * Persists the file handle for subsequent Ctrl+S saves.
 * Returns the filename if successful, null if cancelled.
 */
export async function saveFile(
  content: string,
  suggestedName = 'node-graph',
): Promise<string | null> {
  if (hasFileSystemAccess()) {
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: suggestedName + FILE_EXTENSION,
        types: FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      // Persist handle for Ctrl+S
      _currentFileHandle = handle;
      _currentFileName = handle.name;
      return handle.name;
    } catch (e: unknown) {
      // User cancelled the picker
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }

  // Fallback: trigger download via hidden anchor
  const blob = new Blob([content], { type: MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName + FILE_EXTENSION;
  a.click();
  URL.revokeObjectURL(url);
  _currentFileName = suggestedName + FILE_EXTENSION;
  return suggestedName + FILE_EXTENSION;
}

/**
 * Open a file using File System Access API or file input fallback.
 * Persists the file handle for subsequent Ctrl+S saves.
 * Returns { name, content } if successful, null if cancelled.
 */
export async function openFile(): Promise<{ name: string; content: string } | null> {
  if (hasFileSystemAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker!({
        types: FILE_TYPES,
        multiple: false,
      });
      const file: File = await handle.getFile();
      const content = await file.text();
      // Persist handle for Ctrl+S
      _currentFileHandle = handle;
      _currentFileName = file.name;
      return { name: file.name, content };
    } catch (e: unknown) {
      // User cancelled the picker
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      throw e;
    }
  }

  // Fallback: use hidden file input
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},.json`;
    input.style.display = 'none';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const content = await file.text();
      _currentFileName = file.name;
      resolve({ name: file.name, content });
      document.body.removeChild(input);
    };

    // Handle cancel (no reliable event, clean up on focus return)
    input.oncancel = () => {
      resolve(null);
      document.body.removeChild(input);
    };

    document.body.appendChild(input);
    input.click();
  });
}
