import { describe, it, expect, vi } from 'vitest';
import {
  ComfyUIBackend,
  substituteWorkflowTokens,
  buildComfyPrompt,
  collectImageUrls,
  type WebSocketLike,
  type ComfyHistoryEntry,
} from '../utils/comfyBackend';
import type { RemoteRequest } from '../utils/remoteExecution';

// ── Helpers ────────────────────────────────────────────────────────────────

const WORKFLOW = JSON.stringify({
  '3': { class_type: 'KSampler', inputs: { seed: '%seed%', text: 'photo of %prompt%, 4k' } },
  '9': { class_type: 'SaveImage', inputs: {} },
});

function makeReq(data: Record<string, unknown> = { workflow: WORKFLOW }, inputs: Record<number, unknown> = {}): RemoteRequest {
  return { nodeId: 'n1', nodeType: 'comfy-workflow', inputs, data };
}

interface FakeServerOptions {
  /** History entry returned once `completeAfterPolls` history fetches have happened. */
  entry?: ComfyHistoryEntry;
  completeAfterPolls?: number;
  submitStatus?: number;
  submitBody?: Record<string, unknown>;
}

function makeFakeServer(opts: FakeServerOptions = {}) {
  const entry: ComfyHistoryEntry = opts.entry ?? {
    status: { completed: true },
    outputs: { '9': { images: [{ filename: 'img_0001.png', subfolder: '', type: 'output' }] } },
  };
  const completeAfter = opts.completeAfterPolls ?? 1;
  const calls: { url: string; init?: RequestInit }[] = [];
  let historyPolls = 0;

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/prompt')) {
      return {
        ok: (opts.submitStatus ?? 200) < 400,
        status: opts.submitStatus ?? 200,
        text: async () => JSON.stringify(opts.submitBody ?? {}),
        json: async () => opts.submitBody ?? { prompt_id: 'p-123' },
      } as unknown as Response;
    }
    if (url.includes('/history/')) {
      historyPolls++;
      const ready = historyPolls >= completeAfter;
      return {
        ok: true,
        status: 200,
        json: async () => (ready ? { 'p-123': entry } : {}),
      } as unknown as Response;
    }
    if (url.endsWith('/interrupt')) {
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  return { fetchFn: fetchFn as unknown as typeof fetch, calls, getHistoryPolls: () => historyPolls };
}

/** A fake WS the test can push messages through. */
function makeFakeWs() {
  const listeners = new Map<string, ((ev: { data?: unknown }) => void)[]>();
  let closed = false;
  const ws: WebSocketLike = {
    addEventListener(type, listener) {
      const arr = listeners.get(type) ?? [];
      arr.push(listener);
      listeners.set(type, arr);
    },
    close() { closed = true; },
  };
  return {
    ws,
    emit(type: string, data: unknown) {
      for (const l of listeners.get(type) ?? []) l({ data });
    },
    isClosed: () => closed,
  };
}

// ── Token substitution ─────────────────────────────────────────────────────

describe('substituteWorkflowTokens', () => {
  it('replaces quoted %seed% with a raw number', () => {
    const out = substituteWorkflowTokens('{"seed": "%seed%"}', { 1: 42 });
    expect(JSON.parse(out)).toEqual({ seed: 42 });
  });

  it('replaces in-string %prompt% with escaped text', () => {
    const out = substituteWorkflowTokens('{"text": "photo of %prompt%, 4k"}', { 0: 'a "cat"' });
    expect(JSON.parse(out)).toEqual({ text: 'photo of a "cat", 4k' });
  });

  it('replaces quoted %prompt% wholesale (stays a JSON string)', () => {
    const out = substituteWorkflowTokens('{"text": "%prompt%"}', { 0: 'hello' });
    expect(JSON.parse(out)).toEqual({ text: 'hello' });
  });

  it('generates a random seed when input 1 is unwired', () => {
    const out = JSON.parse(substituteWorkflowTokens('{"seed": "%seed%"}', {})) as { seed: number };
    expect(typeof out.seed).toBe('number');
    expect(Number.isInteger(out.seed)).toBe(true);
  });

  it('supports generic %inN% tokens', () => {
    const out = substituteWorkflowTokens('{"steps": "%in2%"}', { 2: 30 });
    expect(JSON.parse(out)).toEqual({ steps: 30 });
  });
});

describe('buildComfyPrompt', () => {
  it('throws a friendly error when no workflow is configured', () => {
    expect(() => buildComfyPrompt(makeReq({}))).toThrow(/No workflow configured/);
  });

  it('throws when substitution produces invalid JSON', () => {
    expect(() => buildComfyPrompt(makeReq({ workflow: '{broken' }))).toThrow(/not valid JSON/);
  });

  it('parses and substitutes a valid workflow', () => {
    const prompt = buildComfyPrompt(makeReq({ workflow: WORKFLOW }, { 0: 'a fox', 1: 7 })) as Record<string, { inputs: Record<string, unknown> }>;
    expect(prompt['3'].inputs.seed).toBe(7);
    expect(prompt['3'].inputs.text).toBe('photo of a fox, 4k');
  });
});

describe('collectImageUrls', () => {
  it('builds /view URLs from history outputs', () => {
    const entry: ComfyHistoryEntry = {
      outputs: {
        '9': { images: [{ filename: 'a.png', subfolder: 'sub', type: 'temp' }, { filename: 'b.png' }] },
      },
    };
    const urls = collectImageUrls(entry, 'http://host:8188');
    expect(urls).toEqual([
      'http://host:8188/view?filename=a.png&subfolder=sub&type=temp',
      'http://host:8188/view?filename=b.png&subfolder=&type=output',
    ]);
  });
});

// ── Backend end-to-end (fake fetch + fake WS) ──────────────────────────────

describe('ComfyUIBackend.execute', () => {
  it('submits, polls history, and returns image URLs', async () => {
    const server = makeFakeServer();
    const backend = new ComfyUIBackend({
      baseUrl: 'http://test:8188/',
      fetchFn: server.fetchFn,
      wsFactory: null,
      pollIntervalMs: 50,
    });

    const progress: number[] = [];
    const result = await backend.execute(makeReq(), p => progress.push(p));

    expect(result.status).toBe('ok');
    expect(result.outputs[0]).toBe('http://test:8188/view?filename=img_0001.png&subfolder=&type=output');
    expect(result.outputs[1]).toEqual(['http://test:8188/view?filename=img_0001.png&subfolder=&type=output']);
    expect(progress[progress.length - 1]).toBe(1);

    // Submit body contains the substituted prompt and a client id
    const submit = server.calls.find(c => c.url.endsWith('/prompt'))!;
    const body = JSON.parse(String(submit.init?.body)) as { prompt: unknown; client_id: string };
    expect(body.prompt).toBeTruthy();
    expect(body.client_id).toMatch(/^rosebud-/);
  });

  it('keeps polling until the history entry appears', async () => {
    const server = makeFakeServer({ completeAfterPolls: 3 });
    const backend = new ComfyUIBackend({
      baseUrl: 'http://test:8188',
      fetchFn: server.fetchFn,
      wsFactory: null,
      pollIntervalMs: 10,
    });
    const result = await backend.execute(makeReq(), () => {});
    expect(result.status).toBe('ok');
    expect(server.getHistoryPolls()).toBeGreaterThanOrEqual(3);
  });

  it('streams WS progress events into onProgress', async () => {
    const server = makeFakeServer({ completeAfterPolls: 2 });
    const fake = makeFakeWs();
    const backend = new ComfyUIBackend({
      baseUrl: 'http://test:8188',
      fetchFn: server.fetchFn,
      wsFactory: () => fake.ws,
      pollIntervalMs: 25,
    });

    const progress: { p: number; msg?: string }[] = [];
    const done = backend.execute(makeReq(), (p, msg) => progress.push({ p, msg }));

    // Let the submit happen, then push WS progress
    await new Promise(r => setTimeout(r, 5));
    fake.emit('message', JSON.stringify({ type: 'progress', data: { value: 5, max: 20, prompt_id: 'p-123' } }));

    const result = await done;
    expect(result.status).toBe('ok');
    expect(progress.some(e => e.p === 0.25 && e.msg === 'step 5/20')).toBe(true);
    expect(fake.isClosed()).toBe(true);
  });

  it('rejects with a friendly error when the server refuses the workflow', async () => {
    const server = makeFakeServer({ submitStatus: 400, submitBody: { error: 'bad node' } });
    const backend = new ComfyUIBackend({
      baseUrl: 'http://test:8188',
      fetchFn: server.fetchFn,
      wsFactory: null,
    });
    await expect(backend.execute(makeReq(), () => {})).rejects.toThrow(/ComfyUI rejected the workflow \(HTTP 400\)/);
  });

  it('cancellation interrupts the job and throws AbortError', async () => {
    const server = makeFakeServer({ completeAfterPolls: 1000 }); // never completes
    const backend = new ComfyUIBackend({
      baseUrl: 'http://test:8188',
      fetchFn: server.fetchFn,
      wsFactory: null,
      pollIntervalMs: 10,
    });
    const controller = new AbortController();
    const done = backend.execute(makeReq(), () => {}, controller.signal);
    setTimeout(() => controller.abort(), 30);

    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.calls.some(c => c.url.endsWith('/interrupt'))).toBe(true);
  });

  it('times out long jobs with a clear message', async () => {
    const server = makeFakeServer({ completeAfterPolls: 1000 });
    const backend = new ComfyUIBackend({
      baseUrl: 'http://test:8188',
      fetchFn: server.fetchFn,
      wsFactory: null,
      pollIntervalMs: 10,
      timeoutMs: 1000,
    });
    await expect(backend.execute(makeReq(), () => {})).rejects.toThrow(/timed out/);
  }, 10000);
});
