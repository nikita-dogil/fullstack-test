// In-memory data store (no database, lives for the lifetime of the process).
//
// Universe of items = base range [1 .. BASE_MAX] plus any custom IDs added at
// runtime. The "selected" list is an ordered array (the right window order).
// The "left window" is the universe minus the selected set, in ascending order.

export const BASE_MAX = 1_000_000;

/** A paginated slice of item IDs. */
export interface Page {
  items: number[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** Snapshot of the whole persisted state. */
export interface State {
  selectedOrder: number[];
  selectedCount: number;
  customCount: number;
  universeSize: number;
  baseMax: number;
}

/** Result of attempting to add a custom item. */
export interface AddResult {
  ok: boolean;
  reason?: 'invalid' | 'exists';
}

export interface PageQuery {
  search?: string;
  offset?: number;
  limit?: number;
}

/** Ordered list of selected IDs — this IS the right-window sort order. */
const selectedOrder: number[] = [];
/** Fast membership lookup for selected IDs. */
const selectedSet = new Set<number>();

/** Custom IDs added at runtime (all > BASE_MAX), kept sorted ascending. */
const customIds: number[] = [];
/** Fast membership lookup for custom IDs. */
const customSet = new Set<number>();

/** Does the given id exist anywhere in the universe? */
function existsInUniverse(id: number): boolean {
  return (id >= 1 && id <= BASE_MAX) || customSet.has(id);
}

/** Total number of items in the universe. */
function universeSize(): number {
  return BASE_MAX + customIds.length;
}

/** Insert a value into a sorted array (ascending), keeping it sorted. */
function sortedInsert(arr: number[], value: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, value);
}

/**
 * Iterate the universe in ascending order, invoking `cb(id)` for every id.
 * Stops early when `cb` returns `false`.
 */
function forEachAscending(cb: (id: number) => boolean | void): void {
  for (let id = 1; id <= BASE_MAX; id++) {
    if (cb(id) === false) return;
  }
  for (let i = 0; i < customIds.length; i++) {
    if (cb(customIds[i]) === false) return;
  }
}

/** Does `id` match the search string (substring match on its decimal form)? */
function matchesSearch(id: number, search: string): boolean {
  if (!search) return true;
  return String(id).includes(search);
}

// Bumped on every write so cached search counts are invalidated.
let stateVersion = 0;
function bumpVersion(): void {
  stateVersion++;
}

// Cache of exact "available count" per (stateVersion, search). Computing it
// requires a full scan of the universe, so we memoize it: repeated page
// requests for the same filter (e.g. while infinite-scrolling) reuse the count
// instead of re-scanning 1M elements every time.
const countCache = new Map<string, number>();

function countAvailable(search: string): number {
  if (!search) return universeSize() - selectedOrder.length;
  const key = `${stateVersion} ${search}`;
  const cached = countCache.get(key);
  if (cached !== undefined) return cached;
  let total = 0;
  forEachAscending((id) => {
    if (selectedSet.has(id)) return;
    if (matchesSearch(id, search)) total++;
  });
  if (countCache.size > 100) countCache.clear();
  countCache.set(key, total);
  return total;
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Left window: every item NOT selected, ascending, optionally filtered by ID.
 * Returns a page { items, total, offset, limit, hasMore }.
 */
export function getAvailable({ search = '', offset = 0, limit = 20 }: PageQuery = {}): Page {
  const total = countAvailable(search);
  const items: number[] = [];
  let index = 0; // position among matching, non-selected items

  // Collect just the requested page and stop early — for offset 0 this only
  // scans until the 20th match instead of walking the whole universe.
  forEachAscending((id) => {
    if (selectedSet.has(id)) return true;
    if (!matchesSearch(id, search)) return true;
    if (index >= offset) items.push(id);
    index++;
    if (items.length >= limit) return false;
    return true;
  });

  return {
    items,
    total,
    offset,
    limit,
    hasMore: offset + items.length < total,
  };
}

/**
 * Right window: selected items in their custom order, optionally filtered.
 * Returns a page { items, total, offset, limit, hasMore }.
 */
export function getSelected({ search = '', offset = 0, limit = 20 }: PageQuery = {}): Page {
  const filtered = search
    ? selectedOrder.filter((id) => matchesSearch(id, search))
    : selectedOrder;
  const items = filtered.slice(offset, offset + limit);
  return {
    items,
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + items.length < filtered.length,
  };
}

/** Full selected order (used by the client to keep its local mirror in sync). */
export function getSelectedOrder(): number[] {
  return selectedOrder.slice();
}

/** Snapshot of the whole persisted state. */
export function getState(): State {
  return {
    selectedOrder: selectedOrder.slice(),
    selectedCount: selectedOrder.length,
    customCount: customIds.length,
    universeSize: universeSize(),
    baseMax: BASE_MAX,
  };
}

// ---------------------------------------------------------------------------
// Write operations (each is idempotent / dedup-safe)
// ---------------------------------------------------------------------------

/** Select an id (append to the end of the order if not already selected). */
export function select(id: number): boolean {
  if (!Number.isInteger(id) || !existsInUniverse(id)) return false;
  if (selectedSet.has(id)) return false;
  selectedSet.add(id);
  selectedOrder.push(id);
  bumpVersion();
  return true;
}

/** Deselect an id (it returns to the left window in its natural position). */
export function deselect(id: number): boolean {
  if (!selectedSet.has(id)) return false;
  selectedSet.delete(id);
  const idx = selectedOrder.indexOf(id);
  if (idx !== -1) selectedOrder.splice(idx, 1);
  bumpVersion();
  return true;
}

/**
 * Replace the selected order with `order`. Only accepted when `order` is a
 * permutation of the current selected set (no items added/removed) so that a
 * reorder cannot silently change the selection.
 */
export function setOrder(order: number[]): boolean {
  if (!Array.isArray(order)) return false;
  if (order.length !== selectedOrder.length) return false;
  const seen = new Set<number>();
  for (const id of order) {
    if (!selectedSet.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  selectedOrder.length = 0;
  selectedOrder.push(...order);
  return true;
}

/**
 * Add a brand new custom id to the universe.
 * Rejects ids that already exist (dedup guarantee).
 */
export function addItem(id: number): AddResult {
  if (!Number.isInteger(id) || id < 1) return { ok: false, reason: 'invalid' };
  if (existsInUniverse(id)) return { ok: false, reason: 'exists' };
  customSet.add(id);
  sortedInsert(customIds, id);
  bumpVersion();
  return { ok: true };
}
