// Client-side request queue with de-duplication and batching.
//
// Per the task requirements:
//   * adding new elements is batched and flushed once every 10 seconds;
//   * reading and changing data is batched and flushed once every second;
//   * the queue de-duplicates, so the same value is never sent twice.
//
// Three independent queues are maintained:
//   * addSet      — IDs to create (Set → automatic de-dup), flushed every 10s.
//   * mutById     — select/deselect per ID (last write wins), plus the latest
//                   sort order, flushed every second.
//   * getMap      — GET requests keyed by URL (identical concurrent requests
//                   collapse into one), flushed every second.

export const ADD_INTERVAL_MS = 10_000;
export const RW_INTERVAL_MS = 1_000;

type MutationKind = 'select' | 'deselect';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json();
}

class RequestQueue {
  private addSet = new Set<number>();
  private mutById = new Map<number, MutationKind>();
  private pendingOrder: number[] | null = null;
  private getMap = new Map<string, Deferred<any>>();

  private addListeners = new Set<(data: any) => void>();
  private mutListeners = new Set<(data: any) => void>();

  start() {
    // Guard against double-start (React StrictMode mounts effects twice).
    if (this.started) return;
    this.started = true;
    this.addTimer = setInterval(() => void this.flushAdds(), ADD_INTERVAL_MS);
    this.rwTimer = setInterval(() => {
      void this.flushMutations();
      void this.flushGets();
    }, RW_INTERVAL_MS);
  }

  private started = false;
  private addTimer: ReturnType<typeof setInterval> | null = null;
  private rwTimer: ReturnType<typeof setInterval> | null = null;

  stop() {
    if (this.addTimer) clearInterval(this.addTimer);
    if (this.rwTimer) clearInterval(this.rwTimer);
    this.addTimer = null;
    this.rwTimer = null;
    this.started = false;
  }

  // ---- ADD queue (flushed every 10s) ------------------------------------
  enqueueAdd(id: number) {
    this.addSet.add(id);
  }

  get pendingAddCount() {
    return this.addSet.size;
  }

  onAddFlush(cb: (data: any) => void) {
    this.addListeners.add(cb);
    return () => this.addListeners.delete(cb);
  }

  async flushAdds() {
    if (this.addSet.size === 0) return;
    const ids = [...this.addSet];
    this.addSet.clear();
    try {
      const data = await postJson('/api/add', { ids });
      this.addListeners.forEach((cb) => cb(data));
    } catch {
      // Network failure: requeue so nothing is lost (still de-duplicated).
      ids.forEach((id) => this.addSet.add(id));
    }
  }

  // ---- MUTATION queue (flushed every 1s) --------------------------------
  enqueueSelect(id: number) {
    this.mutById.set(id, 'select');
  }

  enqueueDeselect(id: number) {
    this.mutById.set(id, 'deselect');
  }

  enqueueSetOrder(order: number[]) {
    this.pendingOrder = order.slice();
  }

  onMutationFlush(cb: (data: any) => void) {
    this.mutListeners.add(cb);
    return () => this.mutListeners.delete(cb);
  }

  async flushMutations() {
    if (this.mutById.size === 0 && this.pendingOrder === null) return;
    const operations: Array<Record<string, unknown>> = [];
    for (const [id, kind] of this.mutById) operations.push({ type: kind, id });
    if (this.pendingOrder !== null) {
      operations.push({ type: 'setOrder', order: this.pendingOrder });
    }
    this.mutById.clear();
    this.pendingOrder = null;
    try {
      const data = await postJson('/api/mutations', { operations });
      this.mutListeners.forEach((cb) => cb(data));
    } catch {
      // Best-effort: drop on failure (the client mirror stays optimistic).
    }
  }

  // ---- GET queue (de-duplicated, flushed every 1s) ----------------------
  enqueueGet<T = any>(url: string): Promise<T> {
    const existing = this.getMap.get(url);
    if (existing) return existing.promise as Promise<T>;
    const d = defer<T>();
    this.getMap.set(url, d);
    return d.promise;
  }

  async flushGets() {
    if (this.getMap.size === 0) return;
    const batch = [...this.getMap.entries()];
    this.getMap.clear();
    await Promise.all(
      batch.map(async ([url, d]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
          d.resolve(await res.json());
        } catch (err) {
          d.reject(err);
        }
      }),
    );
  }
}

export const queue = new RequestQueue();
