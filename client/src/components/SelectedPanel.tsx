import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { SortableItem } from './SortableItem';

interface Props {
  /** Items currently rendered (a prefix of the filtered selected list). */
  visible: number[];
  totalFiltered: number;
  hasMore: boolean;
  search: string;
  onSearch: (value: string) => void;
  onLoadMore: () => void;
  onDeselect: (id: number) => void;
  /** Receives the new order of the currently rendered items. */
  onReorder: (newVisibleOrder: number[]) => void;
}

export function SelectedPanel(props: Props) {
  const {
    visible, totalFiltered, hasMore, search,
    onSearch, onLoadMore, onDeselect, onReorder,
  } = props;

  // A small activation distance so a click on the handle still works.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const sentinelRef = useInfiniteScroll(onLoadMore, hasMore);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visible.indexOf(Number(active.id));
    const newIndex = visible.indexOf(Number(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(visible, oldIndex, newIndex));
  };

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Выбранные</h2>
        <span className="panel__count">{totalFiltered.toLocaleString('ru-RU')}</span>
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visible} strategy={verticalListSortingStrategy}>
          <ul className="list">
            {visible.map((id) => (
              <SortableItem key={id} id={id} onDeselect={onDeselect} />
            ))}
            {visible.length === 0 && (
              <li className="row row--empty">
                {search ? 'Ничего не найдено' : 'Пока ничего не выбрано'}
              </li>
            )}
            <div ref={sentinelRef} className="sentinel" />
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}
