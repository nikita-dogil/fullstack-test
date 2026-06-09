import { useState } from 'react';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

interface Props {
  items: number[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  onLoadMore: () => void;
  onSelect: (id: number) => void;
  onAdd: (id: number) => void;
  pendingAddCount: number;
}

export function AvailablePanel(props: Props) {
  const {
    items, total, hasMore, loading, search,
    onSearch, onLoadMore, onSelect, onAdd, pendingAddCount,
  } = props;

  const [addValue, setAddValue] = useState('');
  const [addError, setAddError] = useState('');

  const sentinelRef = useInfiniteScroll(onLoadMore, hasMore && !loading);

  const submitAdd = () => {
    const trimmed = addValue.trim();
    if (!trimmed) return;
    const id = Number(trimmed);
    if (!Number.isInteger(id) || id < 1) {
      setAddError('Введите целое число ≥ 1');
      return;
    }
    setAddError('');
    onAdd(id);
    setAddValue('');
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Доступные</h2>
        <span className="panel__count">{total.toLocaleString('ru-RU')}</span>
      </header>

      <div className="panel__controls">
        <input
          className="input"
          type="search"
          placeholder="Фильтр по ID…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="panel__add">
        <input
          className="input"
          type="number"
          min={1}
          placeholder="Новый ID"
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
        />
        <button className="btn btn--primary" onClick={submitAdd}>
          Добавить
        </button>
      </div>
      {addError && <div className="panel__error">{addError}</div>}
      {pendingAddCount > 0 && (
        <div className="panel__hint">
          В очереди на добавление: {pendingAddCount} (отправка раз в 10 сек)
        </div>
      )}

      <ul className="list">
        {items.map((id) => (
          <li key={id} className="row">
            <span className="row__id">#{id.toLocaleString('ru-RU')}</span>
            <button
              className="btn btn--ghost"
              title="Выбрать"
              onClick={() => onSelect(id)}
            >
              Выбрать →
            </button>
          </li>
        ))}
        {!loading && items.length === 0 && (
          <li className="row row--empty">Ничего не найдено</li>
        )}
        <div ref={sentinelRef} className="sentinel" />
        {loading && <li className="row row--loading">Загрузка…</li>}
      </ul>
    </section>
  );
}
