import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCurrentFileName,
  clearFileHandle,
  saveToCurrentFile,
  saveFile,
  openFile,
} from './fileAccess';

// ---------------------------------------------------------------------------
// Helpers to install / remove native File System Access API mocks on window
// ---------------------------------------------------------------------------

function installNativeAPI(overrides?: {
  showSaveFilePicker?: ReturnType<typeof vi.fn>;
  showOpenFilePicker?: ReturnType<typeof vi.fn>;
}) {
  (window as any).showSaveFilePicker =
    overrides?.showSaveFilePicker ?? vi.fn();
  (window as any).showOpenFilePicker =
    overrides?.showOpenFilePicker ?? vi.fn();
}

function removeNativeAPI() {
  delete (window as any).showSaveFilePicker;
  delete (window as any).showOpenFilePicker;
}

/** Create a mock file-system file handle */
function createMockHandle(name = 'test.rne3d') {
  const writableStream = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    name,
    createWritable: vi.fn().mockResolvedValue(writableStream),
    getFile: vi.fn().mockResolvedValue(
      new File(['{"nodes":[]}'], name, { type: 'application/json' }),
    ),
    _writable: writableStream, // handy reference for assertions
  };
}

/** Create a DOMException with a given name */
function abortError() {
  return new DOMException('The user aborted a request.', 'AbortError');
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearFileHandle();
});

afterEach(() => {
  removeNativeAPI();
  vi.restoreAllMocks();
});

// ---- 1. hasFileSystemAccess detection ----

describe('hasFileSystemAccess detection', () => {
  it('treats the API as available when both pickers exist on window', async () => {
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(createMockHandle()),
    });
    // If the native path is taken, saveFile will call showSaveFilePicker
    await saveFile('data', 'test');
    expect((window as any).showSaveFilePicker).toHaveBeenCalled();
  });

  it('uses the fallback path when neither picker exists', async () => {
    removeNativeAPI();
    const revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const mockAnchor = { href: '', download: '', click: vi.fn() } as any;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return mockAnchor;
      return document.createElement(tag);
    });

    const result = await saveFile('data', 'graph');
    // Fallback path does NOT call showSaveFilePicker (it doesn't exist)
    expect((window as any).showSaveFilePicker).toBeUndefined();
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(result).toBe('graph.rne3d');

    createObjectURL.mockRestore();
    revokeURL.mockRestore();
  });

  afterEach(() => clearFileHandle());
});

// ---- 2. saveFile with native API ----

describe('saveFile with native API', () => {
  it('saves content through the native picker and returns filename', async () => {
    const handle = createMockHandle('mygraph.rne3d');
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(handle),
    });

    const result = await saveFile('{"nodes":[]}', 'mygraph');
    expect(result).toBe('mygraph.rne3d');
    expect(handle.createWritable).toHaveBeenCalled();
    expect(handle._writable.write).toHaveBeenCalledWith('{"nodes":[]}');
    expect(handle._writable.close).toHaveBeenCalled();
  });

  it('passes suggestedName + extension and FILE_TYPES to the picker', async () => {
    const mockPicker = vi.fn().mockResolvedValue(createMockHandle());
    installNativeAPI({ showSaveFilePicker: mockPicker });

    await saveFile('data', 'my-graph');

    expect(mockPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'my-graph.rne3d',
        types: expect.arrayContaining([
          expect.objectContaining({
            description: 'Rosebud Node Editor Graph',
            accept: { 'application/json': ['.rne3d', '.json'] },
          }),
        ]),
      }),
    );
  });

  it('uses default suggestedName when none provided', async () => {
    const mockPicker = vi.fn().mockResolvedValue(createMockHandle());
    installNativeAPI({ showSaveFilePicker: mockPicker });

    await saveFile('data');

    expect(mockPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'node-graph.rne3d',
      }),
    );
  });

  it('returns null when user cancels (AbortError)', async () => {
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockRejectedValue(abortError()),
    });

    const result = await saveFile('data');
    expect(result).toBeNull();
  });

  it('re-throws non-AbortError exceptions', async () => {
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockRejectedValue(new Error('disk full')),
    });

    await expect(saveFile('data')).rejects.toThrow('disk full');
  });

  afterEach(() => clearFileHandle());
});

// ---- 3. saveFile with fallback (download link) ----

describe('saveFile with fallback (download link)', () => {
  let mockAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };
  let createObjectURL: ReturnType<typeof vi.spyOn>;
  let revokeURL: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    removeNativeAPI();
    mockAnchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return mockAnchor as any;
      // Fall through for other tags (needed by jsdom internals)
      return document.createElement.call(document, tag) as any;
    });
    createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    createObjectURL.mockRestore();
    revokeURL.mockRestore();
    vi.restoreAllMocks();
    clearFileHandle();
  });

  it('creates a Blob, sets href/download on an anchor, and clicks it', async () => {
    const result = await saveFile('content-here', 'exported');

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(mockAnchor.href).toBe('blob:fake-url');
    expect(mockAnchor.download).toBe('exported.rne3d');
    expect(mockAnchor.click).toHaveBeenCalled();
    expect(result).toBe('exported.rne3d');
  });

  it('revokes the object URL after clicking', async () => {
    await saveFile('data', 'test');
    expect(revokeURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('sets _currentFileName for subsequent getCurrentFileName calls', async () => {
    await saveFile('data', 'my-project');
    expect(getCurrentFileName()).toBe('my-project.rne3d');
  });
});

// ---- 4. openFile with native API ----

describe('openFile with native API', () => {
  it('reads file content through the native picker', async () => {
    const handle = createMockHandle('opened.rne3d');
    installNativeAPI({
      showOpenFilePicker: vi.fn().mockResolvedValue([handle]),
    });

    const result = await openFile();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('opened.rne3d');
    expect(result!.content).toBe('{"nodes":[]}');
  });

  it('passes correct options to showOpenFilePicker', async () => {
    const mockPicker = vi.fn().mockResolvedValue([createMockHandle()]);
    installNativeAPI({ showOpenFilePicker: mockPicker });

    await openFile();

    expect(mockPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        types: expect.arrayContaining([
          expect.objectContaining({
            accept: { 'application/json': ['.rne3d', '.json'] },
          }),
        ]),
      }),
    );
  });

  it('returns null when user cancels (AbortError)', async () => {
    installNativeAPI({
      showOpenFilePicker: vi.fn().mockRejectedValue(abortError()),
    });

    const result = await openFile();
    expect(result).toBeNull();
  });

  it('re-throws non-AbortError exceptions', async () => {
    installNativeAPI({
      showOpenFilePicker: vi.fn().mockRejectedValue(new Error('permission denied')),
    });

    await expect(openFile()).rejects.toThrow('permission denied');
  });

  it('persists the file handle after successful open', async () => {
    const handle = createMockHandle('persisted.rne3d');
    installNativeAPI({
      showOpenFilePicker: vi.fn().mockResolvedValue([handle]),
    });

    await openFile();
    expect(getCurrentFileName()).toBe('persisted.rne3d');
  });

  afterEach(() => clearFileHandle());
});

// ---- 5. openFile with fallback (file input) ----

describe('openFile with fallback (file input)', () => {
  let mockInput: {
    type: string;
    accept: string;
    style: { display: string };
    onchange: (() => void) | null;
    oncancel: (() => void) | null;
    files: FileList | null;
    click: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    removeNativeAPI();
    mockInput = {
      type: '',
      accept: '',
      style: { display: '' },
      onchange: null,
      oncancel: null,
      files: null,
      click: vi.fn(),
    };
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'input') return mockInput as any;
      return document.createElement.call(document, tag) as any;
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: any) => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation((node: any) => node);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFileHandle();
  });

  it('creates a file input with correct attributes and appends it to body', async () => {
    const openPromise = openFile();

    // Simulate user selecting a file
    const file = new File(['graph-data'], 'test.rne3d', { type: 'application/json' });
    mockInput.files = { 0: file, length: 1, item: (_i: number) => file } as any;
    await mockInput.onchange!();

    const result = await openPromise;
    expect(mockInput.type).toBe('file');
    expect(mockInput.accept).toBe('.rne3d,.json');
    expect(mockInput.style.display).toBe('none');
    expect(document.body.appendChild).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test.rne3d');
    expect(result!.content).toBe('graph-data');
  });

  it('resolves null when user cancels via oncancel', async () => {
    const openPromise = openFile();

    // Simulate cancel
    mockInput.oncancel!();

    const result = await openPromise;
    expect(result).toBeNull();
    expect(document.body.removeChild).toHaveBeenCalled();
  });

  it('resolves null when onchange fires but no file selected', async () => {
    const openPromise = openFile();

    // Simulate onchange with empty files
    mockInput.files = { length: 0, item: () => null } as any;
    await mockInput.onchange!();

    const result = await openPromise;
    expect(result).toBeNull();
  });

  it('clicks the hidden input to trigger file dialog', async () => {
    const openPromise = openFile();

    // Verify click was called
    expect(mockInput.click).toHaveBeenCalled();

    // Clean up the promise
    mockInput.oncancel!();
    await openPromise;
  });

  it('sets _currentFileName after successful file selection', async () => {
    const openPromise = openFile();

    const file = new File(['data'], 'myfile.rne3d', { type: 'application/json' });
    mockInput.files = { 0: file, length: 1, item: () => file } as any;
    await mockInput.onchange!();

    await openPromise;
    expect(getCurrentFileName()).toBe('myfile.rne3d');
  });
});

// ---- 6. saveToCurrentFile ----

describe('saveToCurrentFile', () => {
  it('returns null when no file handle is persisted', async () => {
    installNativeAPI();
    const result = await saveToCurrentFile('data');
    expect(result).toBeNull();
  });

  it('writes to the persisted handle and returns filename', async () => {
    const handle = createMockHandle('saved.rne3d');
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(handle),
    });

    // First, save to persist the handle
    await saveFile('initial-content', 'saved');

    // Now saveToCurrentFile should use the persisted handle
    const result = await saveToCurrentFile('updated-content');
    expect(result).toBe('saved.rne3d');

    // The writable should have been written to twice
    // (once from saveFile, once from saveToCurrentFile)
    expect(handle._writable.write).toHaveBeenCalledTimes(2);
    expect(handle._writable.write).toHaveBeenLastCalledWith('updated-content');
    expect(handle._writable.close).toHaveBeenCalledTimes(2);
  });

  it('returns null when handle exists but native API is unavailable', async () => {
    // Persist a handle via native API
    const handle = createMockHandle('file.rne3d');
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(handle),
    });
    await saveFile('data', 'file');

    // Now remove the native API
    removeNativeAPI();

    const result = await saveToCurrentFile('new-data');
    expect(result).toBeNull();
  });

  it('returns null when the persisted handle throws (e.g., file deleted)', async () => {
    const handle = createMockHandle('gone.rne3d');
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(handle),
    });
    await saveFile('data', 'gone');

    // Now make the handle fail on next createWritable call
    handle.createWritable.mockRejectedValueOnce(new Error('file not found'));

    const result = await saveToCurrentFile('new-data');
    expect(result).toBeNull();
  });

  afterEach(() => clearFileHandle());
});

// ---- 7. getCurrentFileName / clearFileHandle ----

describe('getCurrentFileName / clearFileHandle', () => {
  it('returns null initially', () => {
    expect(getCurrentFileName()).toBeNull();
  });

  it('returns the filename after a native save', async () => {
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(createMockHandle('project.rne3d')),
    });
    await saveFile('data', 'project');
    expect(getCurrentFileName()).toBe('project.rne3d');
  });

  it('returns the filename after a native open', async () => {
    installNativeAPI({
      showOpenFilePicker: vi.fn().mockResolvedValue([createMockHandle('opened.rne3d')]),
    });
    await openFile();
    expect(getCurrentFileName()).toBe('opened.rne3d');
  });

  it('clearFileHandle resets to null', async () => {
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(createMockHandle('project.rne3d')),
    });
    await saveFile('data', 'project');
    expect(getCurrentFileName()).toBe('project.rne3d');

    clearFileHandle();
    expect(getCurrentFileName()).toBeNull();
  });

  it('clearFileHandle also clears the handle so saveToCurrentFile returns null', async () => {
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(createMockHandle('test.rne3d')),
    });
    await saveFile('data', 'test');

    clearFileHandle();
    const result = await saveToCurrentFile('new-data');
    expect(result).toBeNull();
  });

  afterEach(() => clearFileHandle());
});

// ---- 8. File extension and MIME type ----

describe('file extension and MIME type', () => {
  it('appends .rne3d extension to suggested filename in native save', async () => {
    const mockPicker = vi.fn().mockResolvedValue(createMockHandle());
    installNativeAPI({ showSaveFilePicker: mockPicker });

    await saveFile('data', 'custom-name');
    expect(mockPicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'custom-name.rne3d' }),
    );
  });

  it('uses application/json MIME type and accepts both .rne3d and .json', async () => {
    const mockPicker = vi.fn().mockResolvedValue(createMockHandle());
    installNativeAPI({ showSaveFilePicker: mockPicker });

    await saveFile('data');
    const typesArg = mockPicker.mock.calls[0][0].types[0];
    expect(typesArg.accept).toEqual({ 'application/json': ['.rne3d', '.json'] });
  });

  it('fallback download anchor uses .rne3d extension', async () => {
    removeNativeAPI();
    const mockAnchor = { href: '', download: '', click: vi.fn() } as any;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return mockAnchor;
      return document.createElement.call(document, tag) as any;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await saveFile('data', 'download-test');
    expect(mockAnchor.download).toBe('download-test.rne3d');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFileHandle();
  });
});

// ---- 9. Handle persistence across save then saveToCurrentFile ----

describe('handle persistence across save then saveToCurrentFile', () => {
  it('saveFile persists handle, then saveToCurrentFile reuses it', async () => {
    const handle = createMockHandle('workflow.rne3d');
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(handle),
    });

    // Step 1: Save via picker (persists handle)
    const savedName = await saveFile('{"v":1}', 'workflow');
    expect(savedName).toBe('workflow.rne3d');
    expect(getCurrentFileName()).toBe('workflow.rne3d');

    // Step 2: Ctrl+S via saveToCurrentFile (reuses handle)
    const ctrlSName = await saveToCurrentFile('{"v":2}');
    expect(ctrlSName).toBe('workflow.rne3d');

    // Verify write was called with updated content
    expect(handle._writable.write).toHaveBeenCalledWith('{"v":2}');
  });

  it('openFile persists handle, then saveToCurrentFile reuses it', async () => {
    const handle = createMockHandle('loaded.rne3d');
    installNativeAPI({
      showOpenFilePicker: vi.fn().mockResolvedValue([handle]),
    });

    // Step 1: Open file (persists handle)
    const opened = await openFile();
    expect(opened).not.toBeNull();
    expect(getCurrentFileName()).toBe('loaded.rne3d');

    // Step 2: saveToCurrentFile should use the handle from openFile
    const ctrlSName = await saveToCurrentFile('modified-data');
    expect(ctrlSName).toBe('loaded.rne3d');
    expect(handle._writable.write).toHaveBeenCalledWith('modified-data');
  });

  it('clearFileHandle breaks the persistence chain', async () => {
    const handle = createMockHandle('temp.rne3d');
    installNativeAPI({
      showSaveFilePicker: vi.fn().mockResolvedValue(handle),
    });

    await saveFile('data', 'temp');
    clearFileHandle();

    const result = await saveToCurrentFile('new-data');
    expect(result).toBeNull();
    expect(getCurrentFileName()).toBeNull();
  });

  afterEach(() => clearFileHandle());
});
