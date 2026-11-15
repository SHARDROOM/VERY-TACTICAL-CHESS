import type { Color, PromotionType } from '../engine';

/**
 * Flat silhouettes of the promotion pieces, shaped like the 3D set (wide foot, slim waist).
 * Drawn here rather than with the Unicode chess symbols, which look different on every device.
 */
const SHAPES: Record<PromotionType, string> = {
  queen:
    'M6 21h12v-2.2H6zM7.2 18.6h9.6l-1.6-3.4h-6.4zM9 15c.6-2 .8-4 .5-6h5c-.3 2-.1 4 .5 6zM7 8.6l1.6.4 1.2-2.6 1.3 2.4L12 5.2l.9 3.6 1.3-2.4 1.2 2.6 1.6-.4-1 1.4H8zM12 2.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z',
  rook: 'M6 21h12v-2.2H6zM7.2 18.6h9.6l-1.4-3.2H8.6zM9 15.2l.3-7h5.4l.3 7zM7.6 8V4h2v1.6h1.4V4h2v1.6h1.4V4h2v4z',
  bishop:
    'M6 21h12v-2.2H6zM7.2 18.6h9.6l-1.6-3.4H8.8zM9.4 15c.5-1.6.6-3 .4-4.4h4.4c-.2 1.4-.1 2.8.4 4.4zM9 10.4c-1-1.4-.6-4 1.4-5.6L12 3.6l1.6 1.2c2 1.6 2.4 4.2 1.4 5.6zM12 1.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z',
  knight:
    'M6 21h12v-2.2H6zM7.4 18.6h9.4l-.6-2.4c.4-3.8-.4-8-3.6-10.6L11.4 3l-1.2 2.2C8 6.4 6.6 8.4 6.4 10.6l.6 1.4 2.2-.6 1.4-1.2c.8 1.6.2 3.4-1.2 5.2z',
};

export function PieceSilhouette({ type, color }: { type: PromotionType; color: Color }) {
  return (
    <svg className={`silhouette silhouette-${color}`} viewBox="0 0 24 24" aria-hidden>
      <path d={SHAPES[type]} />
    </svg>
  );
}
