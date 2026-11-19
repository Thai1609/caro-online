import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

export const SIZE = 30;
export type Seat = 'X' | 'O';
export type Cell = { row: number; col: number };
export type Move = Cell & { mark: Seat };

const cells = Array.from({ length: SIZE * SIZE }, (_, index) => ({
  row: Math.floor(index / SIZE), col: index % SIZE
}));
const cellKey = ({ row, col }: Cell) => row * SIZE + col;

type Props = {
  moves: Move[];
  winning: Cell[];
  canPlay: boolean;
  onMove: (cell: Cell) => void;
};

type Gesture = {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
  dragged: boolean;
};

export function Board({ moves, winning, canPlay, onMove }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const marks = useMemo(() => new Map(moves.map(move => [cellKey(move), move.mark])), [moves]);
  const winningKeys = useMemo(() => new Set(winning.map(cellKey)), [winning]);
  const latest = moves.at(-1);

  function centerOn(cell?: Cell, behavior: ScrollBehavior = 'instant') {
    const frame = viewport.current;
    if (!frame) return;
    const target = cell ? frame.querySelector<HTMLButtonElement>(`[data-cell="${cellKey(cell)}"]`) : null;
    frame.scrollTo({
      left: (target ? target.offsetLeft + target.offsetWidth / 2 : frame.scrollWidth / 2) - frame.clientWidth / 2,
      top: (target ? target.offsetTop + target.offsetHeight / 2 : frame.scrollHeight / 2) - frame.clientHeight / 2,
      behavior
    });
  }

  useLayoutEffect(() => { centerOn(); }, []);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const frame = event.currentTarget;
    frame.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: frame.scrollLeft, top: frame.scrollTop, dragged: false
    };
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!active.dragged && Math.hypot(dx, dy) < 7) return;
    const frame = event.currentTarget;
    if (!active.dragged) {
      active.dragged = true;
      setDragging(true);
    }
    frame.scrollLeft = active.left - dx;
    frame.scrollTop = active.top - dy;
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (event.type !== 'pointerup' || active.dragged
        || Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 7) return;
    const tapped = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('[data-cell]');
    if (tapped && event.currentTarget.contains(tapped) && tapped.dataset.cell !== undefined) {
      play(cells[Number(tapped.dataset.cell)]);
    }
  }

  function play(cell: Cell) {
    if (canPlay && !marks.has(cellKey(cell))) onMove(cell);
  }

  function keyboardClick(event: MouseEvent<HTMLButtonElement>, cell: Cell) {
    if (event.detail === 0) play(cell);
  }

  return <>
    <div className={`viewport ${dragging ? 'dragging' : ''}`} ref={viewport}
      onPointerDown={start} onPointerMove={pan} onPointerUp={finish}
      onPointerCancel={finish} onLostPointerCapture={event => {
        if (event.target === event.currentTarget) finish(event);
      }} aria-label="Vùng xem bàn cờ">
      <div className="board" role="group" aria-label="Bàn cờ 30 × 30 ô">
        {cells.map(cell => {
          const id = cellKey(cell);
          const mark = marks.get(id);
          const isLatest = latest && id === cellKey(latest);
          const className = ['cell', mark?.toLowerCase(), isLatest && 'latest', winningKeys.has(id) && 'winning'].filter(Boolean).join(' ');
          return <button key={id} type="button" data-cell={id} className={className}
            aria-label={`Hàng ${cell.row + 1}, cột ${cell.col + 1}, ${mark ?? 'trống'}`}
            aria-disabled={!canPlay || Boolean(mark)}
            tabIndex={canPlay && !mark ? 0 : -1}
            onClick={event => keyboardClick(event, cell)}>{mark}</button>;
        })}
      </div>
    </div>
    <div className="board-tools">
      <span>Kéo để di chuyển bàn cờ.</span>
      <button className="secondary" type="button" onClick={() => centerOn(latest, 'smooth')}>
        {latest ? 'Về nước mới nhất' : 'Về giữa bàn'}
      </button>
    </div>
  </>;
}
