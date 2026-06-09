import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AvailablePanel } from './components/AvailablePanel';
import { SelectedPanel } from './components/SelectedPanel';
import { fetchAvailable, fetchSelectedOrder, fetchState } from './api';
import { queue } from './requestQueue';
import type { AppState } from './types';

const PAGE = 20;

function matches(id: number, search: string): boolean {
  return !search || String(id).includes(search);
}

/** Insert `id` into an ascending-sorted loaded window, if it belongs there. */
function insertIntoLoaded(prev: number[], id: number, hasMore: boolean): number[] {
  let i = 0;
  while (i < prev.length && prev[i] < id) i++;
  if (prev[i] === id) return prev;
  // Insert when it falls inside the loaded range, or everything is loaded.
  if (i < prev.length || !hasMore) {
    const copy = prev.slice();
    copy.splice(i, 0, id);
    return copy;
  }
  return prev; // beyond the loaded window — it will arrive while scrolling
}

export default function App() {
  // ---- Left (available) window -----------------------------------------
  const [leftSearch, setLeftSearch] = useState('');
  const [leftItems, setLeftItems] = useState<number[]>([]);
  const [leftTotal, setLeftTotal] = useState(0);
  const [leftHasMore, setLeftHasMore] = useState(true);
  const [leftLoading, setLeftLoading] = useState(false);
  const leftOffset = useRef(0);
  const leftGen = useRef(0); // generation token to discard stale responses
  const leftSearchRef = useRef('');
  leftSearchRef.current = leftSearch;
  const leftHasMoreRef = useRef(true);
  leftHasMoreRef.current = leftHasMore;

  // ---- Right (selected) window -----------------------------------------
  const [selectedOrder, setSelectedOrder] = useState<number[]>([]);
  const [rightSearch, setRightSearch] = useState('');
  const [rightVisibleCount, setRightVisibleCount] = useState(PAGE);

  // ---- Misc ------------------------------------------------------------
  const [state, setState] = useState<AppState | null>(null);
  const [pendingAdds, setPendingAdds] = useState(0);

  // -------------------- Left loading ------------------------------------
  const loadLeftFirst = useCallback(async (search: string) => {
    const gen = ++leftGen.current;
    setLeftLoading(true);
    leftOffset.current = 0;
    try {
      const page = await fetchAvailable(search, 0, PAGE);
      if (gen !== leftGen.current) return;
      setLeftItems(page.items);
      setLeftTotal(page.total);
      setLeftHasMore(page.hasMore);
      leftOffset.current = page.items.length;
    } finally {
      if (gen === leftGen.current) setLeftLoading(false);
    }
  }, []);

  const loadLeftMore = useCallback(async () => {
    if (leftLoading || !leftHasMoreRef.current) return;
    const gen = leftGen.current;
    setLeftLoading(true);
    try {
      const page = await fetchAvailable(leftSearchRef.current, leftOffset.current, PAGE);
      if (gen !== leftGen.current) return;
      setLeftItems((prev) => {
        const known = new Set(prev);
        return [...prev, ...page.items.filter((id) => !known.has(id))];
      });
      setLeftTotal(page.total);
      setLeftHasMore(page.hasMore);
      leftOffset.current += page.items.length;
    } finally {
      if (gen === leftGen.current) setLeftLoading(false);
    }
  }, [leftLoading]);

  // Debounced reload whenever the left filter changes (incl. initial mount).
  useEffect(() => {
    const t = setTimeout(() => void loadLeftFirst(leftSearch), 250);
    return () => clearTimeout(t);
  }, [leftSearch, loadLeftFirst]);

  // -------------------- Initial sync + queue lifecycle ------------------
  useEffect(() => {
    queue.start();

    fetchSelectedOrder().then(({ order }) => setSelectedOrder(order)).catch(() => {});
    fetchState().then(setState).catch(() => {});

    const offAdd = queue.onAddFlush((data) => {
      setPendingAdds(queue.pendingAddCount);
      fetchState().then(setState).catch(() => {});
      const added: number[] = data?.added ?? [];
      const matching = added.filter((id) => matches(id, leftSearchRef.current));
      if (matching.length) setLeftTotal((t) => t + matching.length);
    });

    const offMut = queue.onMutationFlush((data) => {
      if (data?.state) setState(data.state);
    });

    const poll = setInterval(() => setPendingAdds(queue.pendingAddCount), 500);

    return () => {
      offAdd();
      offMut();
      clearInterval(poll);
    };
  }, []);

  // -------------------- Selection actions -------------------------------
  const handleSelect = useCallback((id: number) => {
    setSelectedOrder((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setLeftItems((prev) => prev.filter((x) => x !== id));
    setLeftTotal((t) => Math.max(0, t - 1));
    queue.enqueueSelect(id);
  }, []);

  const handleDeselect = useCallback((id: number) => {
    setSelectedOrder((prev) => prev.filter((x) => x !== id));
    queue.enqueueDeselect(id);
    if (matches(id, leftSearchRef.current)) {
      setLeftTotal((t) => t + 1);
      setLeftItems((prev) => insertIntoLoaded(prev, id, leftHasMoreRef.current));
    }
  }, []);

  // Translate a reorder of the *rendered* rows into the full selected order.
  const handleReorder = useCallback((newVisibleOrder: number[]) => {
    setSelectedOrder((prev) => {
      const subset = new Set(newVisibleOrder);
      let k = 0;
      const next = prev.map((item) => (subset.has(item) ? newVisibleOrder[k++] : item));
      queue.enqueueSetOrder(next);
      return next;
    });
  }, []);

  // -------------------- Add action --------------------------------------
  const handleAdd = useCallback((id: number) => {
    queue.enqueueAdd(id);
    setPendingAdds(queue.pendingAddCount);
  }, []);

  // -------------------- Right window derived data -----------------------
  const rightFiltered = useMemo(
    () => (rightSearch ? selectedOrder.filter((id) => matches(id, rightSearch)) : selectedOrder),
    [selectedOrder, rightSearch],
  );
  const rightVisible = useMemo(
    () => rightFiltered.slice(0, rightVisibleCount),
    [rightFiltered, rightVisibleCount],
  );
  const rightHasMore = rightVisibleCount < rightFiltered.length;

  // Reset the right window page size when its filter changes.
  useEffect(() => setRightVisibleCount(PAGE), [rightSearch]);

  const onRightSearch = useCallback((v: string) => setRightSearch(v), []);
  const onRightLoadMore = useCallback(
    () => setRightVisibleCount((c) => c + PAGE),
    [],
  );

  return (
    <div className="app">
      <header className="app__header">
        <h1>Выбор и сортировка элементов</h1>
        <div className="app__stats">
          <span>Всего: {(state?.universeSize ?? 1_000_000).toLocaleString('ru-RU')}</span>
          <span>Выбрано: {selectedOrder.length.toLocaleString('ru-RU')}</span>
          {state && state.customCount > 0 && (
            <span>Добавлено: {state.customCount.toLocaleString('ru-RU')}</span>
          )}
        </div>
      </header>

      <main className="app__panels">
        <AvailablePanel
          items={leftItems}
          total={leftTotal}
          hasMore={leftHasMore}
          loading={leftLoading}
          search={leftSearch}
          onSearch={setLeftSearch}
          onLoadMore={loadLeftMore}
          onSelect={handleSelect}
          onAdd={handleAdd}
          pendingAddCount={pendingAdds}
        />
        <SelectedPanel
          visible={rightVisible}
          totalFiltered={rightFiltered.length}
          hasMore={rightHasMore}
          search={rightSearch}
          onSearch={onRightSearch}
          onLoadMore={onRightLoadMore}
          onDeselect={handleDeselect}
          onReorder={handleReorder}
        />
      </main>
    </div>
  );
}
