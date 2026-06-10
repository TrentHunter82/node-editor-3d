import { describe, it, expect, beforeEach } from 'vitest';
import {
  dispatchRemoteQueued,
  setMaxConcurrentRemote,
  getMaxConcurrentRemote,
  getRemoteQueueDepth,
  getRunningRemoteCount,
  setExecutionBackend,
  _resetRemoteExecution,
  _resetRemoteQueue,
  type ExecutionBackend,
  type RemoteRequest,
  type RemoteResult,
} from '../utils/remoteExecution';

function makeReq(id: string): RemoteRequest {
  return { nodeId: id, nodeType: 'remote-compute', inputs: {}, data: {} };
}

/** A backend whose executions resolve only when the test says so. */
function makeManualBackend() {
  const pending: { req: RemoteRequest; resolve: (r: RemoteResult) => void }[] = [];
  const backend: ExecutionBackend = {
    id: 'manual',
    execute(req) {
      return new Promise<RemoteResult>(resolve => {
        pending.push({ req, resolve });
      });
    },
  };
  return {
    backend,
    pending,
    finish(index = 0, outputs: Record<number, unknown> = { 0: 'done' }) {
      const job = pending.splice(index, 1)[0];
      job.resolve({ status: 'ok', outputs });
    },
  };
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('remote job queue', () => {
  beforeEach(() => {
    _resetRemoteExecution();
    _resetRemoteQueue();
  });

  it('caps in-flight dispatches at maxConcurrentRemote (default 2)', async () => {
    const manual = makeManualBackend();
    setExecutionBackend(manual.backend);

    const results = [1, 2, 3, 4].map(i => dispatchRemoteQueued(makeReq(`n${i}`)));
    await tick();

    expect(getMaxConcurrentRemote()).toBe(2);
    expect(getRunningRemoteCount()).toBe(2);
    expect(getRemoteQueueDepth()).toBe(2);
    expect(manual.pending.length).toBe(2);

    manual.finish(0);
    await tick();
    expect(getRunningRemoteCount()).toBe(2); // next job pulled in
    expect(getRemoteQueueDepth()).toBe(1);

    manual.finish(0);
    manual.finish(0);
    await tick();
    manual.finish(0);
    await tick();

    const all = await Promise.all(results);
    expect(all.every(r => r.status === 'ok')).toBe(true);
    expect(getRunningRemoteCount()).toBe(0);
    expect(getRemoteQueueDepth()).toBe(0);
  });

  it('runs jobs in FIFO order', async () => {
    const manual = makeManualBackend();
    setExecutionBackend(manual.backend);
    setMaxConcurrentRemote(1);

    void dispatchRemoteQueued(makeReq('first'));
    void dispatchRemoteQueued(makeReq('second'));
    void dispatchRemoteQueued(makeReq('third'));
    await tick();

    expect(manual.pending[0].req.nodeId).toBe('first');
    manual.finish(0);
    await tick();
    expect(manual.pending[0].req.nodeId).toBe('second');
    manual.finish(0);
    await tick();
    expect(manual.pending[0].req.nodeId).toBe('third');
  });

  it('reports queue positions and start (0)', async () => {
    const manual = makeManualBackend();
    setExecutionBackend(manual.backend);
    setMaxConcurrentRemote(1);

    const seen: Record<string, number[]> = { a: [], b: [], c: [] };
    void dispatchRemoteQueued(makeReq('a'), { onQueuePosition: p => seen.a.push(p) });
    void dispatchRemoteQueued(makeReq('b'), { onQueuePosition: p => seen.b.push(p) });
    void dispatchRemoteQueued(makeReq('c'), { onQueuePosition: p => seen.c.push(p) });
    await tick();

    expect(seen.a).toContain(0);       // started immediately
    expect(seen.b[seen.b.length - 1]).toBe(1); // waiting at #1
    expect(seen.c[seen.c.length - 1]).toBe(2); // waiting at #2

    manual.finish(0);
    await tick();
    expect(seen.b).toContain(0);       // b started
    expect(seen.c[seen.c.length - 1]).toBe(1); // c moved up
  });

  it('aborting a queued job removes it without dispatching', async () => {
    const manual = makeManualBackend();
    setExecutionBackend(manual.backend);
    setMaxConcurrentRemote(1);

    const p1 = dispatchRemoteQueued(makeReq('running'));
    const controller = new AbortController();
    const p2 = dispatchRemoteQueued(makeReq('queued'), { signal: controller.signal });
    await tick();

    expect(getRemoteQueueDepth()).toBe(1);
    controller.abort();

    const r2 = await p2;
    expect(r2.status).toBe('error');
    expect(r2.error).toBe('cancelled');
    expect(getRemoteQueueDepth()).toBe(0);
    // The queued job never reached the backend
    expect(manual.pending.length).toBe(1);
    expect(manual.pending[0].req.nodeId).toBe('running');

    manual.finish(0);
    await p1;
  });

  it('raising the concurrency cap drains the queue immediately', async () => {
    const manual = makeManualBackend();
    setExecutionBackend(manual.backend);
    setMaxConcurrentRemote(1);

    void dispatchRemoteQueued(makeReq('a'));
    void dispatchRemoteQueued(makeReq('b'));
    void dispatchRemoteQueued(makeReq('c'));
    await tick();
    expect(getRunningRemoteCount()).toBe(1);

    setMaxConcurrentRemote(3);
    await tick();
    expect(getRunningRemoteCount()).toBe(3);
    expect(getRemoteQueueDepth()).toBe(0);
  });

  it('an already-aborted job resolves cancelled without running', async () => {
    const manual = makeManualBackend();
    setExecutionBackend(manual.backend);
    const controller = new AbortController();
    controller.abort();

    const result = await dispatchRemoteQueued(makeReq('x'), { signal: controller.signal });
    expect(result.error).toBe('cancelled');
    expect(manual.pending.length).toBe(0);
  });
});
