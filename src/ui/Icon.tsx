/** Small line icons for the table tools, drawn in the current text colour. */
export type IconName = 'reset' | 'top' | 'side' | 'pencil' | 'scroll' | 'gear' | 'note' | 'eraser' | 'undo' | 'check';

const PATHS: Record<IconName, string> = {
  // A circular arrow: back to the usual view.
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  // A square seen from straight above.
  top: 'M5 5h14v14H5zM9 12h6M12 9v6',
  // A square seen at an angle.
  side: 'M3 16l5-9h13l-5 9zM8 7v5',
  pencil: 'M15 4l5 5L9 20H4v-5zM13 6l5 5',
  // A rolled-up scroll: the precedents.
  scroll: 'M7 4h11a2 2 0 0 1 0 4H9v10a2 2 0 1 1-4 0V6a2 2 0 0 1 2-2zM9 12h6M9 15h4',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  // A letter on a slip: a written note.
  note: 'M5 4h14v16H5zM9 9h6M12 9v7',
  eraser: 'M15 4l6 6-9 9H7l-4-4zM10 9l6 6M12 20h9',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  check: 'M5 12l5 5L20 7',
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
