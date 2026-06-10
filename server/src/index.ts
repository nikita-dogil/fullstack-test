import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import * as store from './store.js';
import { OperationQueue } from './queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// Single serialized write queue with de-duplication for all mutations.
const writeQueue = new OperationQueue();

interface WriteOutcome<T> {
  deduped: boolean;
  result: T | null;
}

/** Run a write through the queue and resolve once it has actually executed. */
function runWrite<T>(key: string | null, fn: () => T): Promise<WriteOutcome<T>> {
  return new Promise((resolve) => {
    const accepted = writeQueue.enqueue(key, () => {
      resolve({ deduped: false, result: fn() });
    });
    if (!accepted) resolve({ deduped: true, result: null });
  });
}

const clampLimit = (v: unknown, def = 20, max = 200): number => {
  const n = Number.parseInt(String(v), 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, 1), max);
};
const clampOffset = (v: unknown): number => {
  const n = Number.parseInt(String(v), 10);
  return Number.isNaN(n) || n < 0 ? 0 : n;
};

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

// Left window: everything except the selected items.
app.get('/api/items', (req: Request, res: Response) => {
  const page = store.getAvailable({
    search: String(req.query.search ?? '').trim(),
    offset: clampOffset(req.query.offset),
    limit: clampLimit(req.query.limit),
  });
  res.json(page);
});

// Right window: the selected items in their custom order.
app.get('/api/selected', (req: Request, res: Response) => {
  const page = store.getSelected({
    search: String(req.query.search ?? '').trim(),
    offset: clampOffset(req.query.offset),
    limit: clampLimit(req.query.limit),
  });
  res.json(page);
});

// Full selected order — lets the client rebuild its local mirror on reload.
app.get('/api/selected/order', (_req: Request, res: Response) => {
  res.json({ order: store.getSelectedOrder() });
});

// Persisted state snapshot.
app.get('/api/state', (_req: Request, res: Response) => {
  res.json(store.getState());
});

// ---------------------------------------------------------------------------
// Write endpoints (batched + de-duplicated by the client, serialized here)
// ---------------------------------------------------------------------------

interface MutationOp {
  type?: string;
  id?: unknown;
  order?: unknown;
}

interface MutationResult {
  type: string;
  id?: number;
  deduped?: boolean;
  ok?: boolean | null;
}

// Batched mutations: select / deselect / setOrder.
// Body: { operations: [{ type, id?, order? }, ...] }
app.post('/api/mutations', async (req: Request, res: Response) => {
  const operations: MutationOp[] = Array.isArray(req.body?.operations) ? req.body.operations : [];
  const results: MutationResult[] = [];

  for (const op of operations) {
    if (!op || typeof op !== 'object') continue;
    if (op.type === 'select') {
      const id = Number(op.id);
      const { deduped } = await runWrite(`select:${id}`, () => store.select(id));
      results.push({ type: 'select', id, deduped });
    } else if (op.type === 'deselect') {
      const id = Number(op.id);
      const { deduped } = await runWrite(`deselect:${id}`, () => store.deselect(id));
      results.push({ type: 'deselect', id, deduped });
    } else if (op.type === 'setOrder') {
      const order = Array.isArray(op.order) ? op.order.map(Number) : [];
      // setOrder is always "latest wins" — no dedup key.
      const { result } = await runWrite(null, () => store.setOrder(order));
      results.push({ type: 'setOrder', ok: result });
    }
  }

  res.json({ ok: true, results, state: store.getState() });
});

interface AddRejection {
  id: number;
  reason: string;
}

// Batched add of brand new custom items (flushed by the client every 10s).
// Body: { ids: [number, ...] }
app.post('/api/add', async (req: Request, res: Response) => {
  const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const added: number[] = [];
  const rejected: AddRejection[] = [];

  for (const raw of rawIds) {
    const id = Number(raw);
    const { result, deduped } = await runWrite(`add:${id}`, () => store.addItem(id));
    if (deduped) {
      rejected.push({ id, reason: 'queued' });
    } else if (result?.ok) {
      added.push(id);
    } else {
      rejected.push({ id, reason: result?.reason ?? 'invalid' });
    }
  }

  res.json({ ok: true, added, rejected, state: store.getState() });
});

// ---------------------------------------------------------------------------
// Static client (production build) + SPA fallback
// ---------------------------------------------------------------------------

const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true }));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});
