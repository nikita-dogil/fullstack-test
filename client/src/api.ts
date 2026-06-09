import { queue } from './requestQueue';
import type { AppState, Page } from './types';

function qs(params: Record<string, string | number>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
  return sp.toString();
}

/** Left window page — everything except selected, de-duplicated GET. */
export function fetchAvailable(search: string, offset: number, limit = 20): Promise<Page> {
  return queue.enqueueGet<Page>(`/api/items?${qs({ search, offset, limit })}`);
}

/** Right window page (server-side) — kept for parity, not used for DnD. */
export function fetchSelectedPage(search: string, offset: number, limit = 20): Promise<Page> {
  return queue.enqueueGet<Page>(`/api/selected?${qs({ search, offset, limit })}`);
}

/** Full selected order — used to rebuild the client mirror on reload. */
export function fetchSelectedOrder(): Promise<{ order: number[] }> {
  return queue.enqueueGet<{ order: number[] }>(`/api/selected/order`);
}

/** Persisted state snapshot. */
export function fetchState(): Promise<AppState> {
  return queue.enqueueGet<AppState>(`/api/state`);
}
