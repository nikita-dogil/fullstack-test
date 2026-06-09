import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Props {
  id: number;
  onDeselect: (id: number) => void;
}

export function SortableItem({ id, onDeselect }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="row row--sortable">
      <button
        className="row__handle"
        title="Перетащить для сортировки"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="row__id">#{id.toLocaleString('ru-RU')}</span>
      <button
        className="btn btn--ghost"
        title="Убрать из выбранных"
        onClick={() => onDeselect(id)}
      >
        ← Убрать
      </button>
    </li>
  );
}
