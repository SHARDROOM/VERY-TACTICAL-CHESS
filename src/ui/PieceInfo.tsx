import { RIDE, squareName, type Piece, type Square, type Tag } from '../engine';
import { COLOR_NAME, PIECE_NAME } from './messages';

function tagText(t: Tag) {
  return t.turnsLeft === null ? `${t.name} (영구)` : `${t.name} (${t.turnsLeft}턴 남음)`;
}

function Line({ piece }: { piece: Piece }) {
  const tags = (piece.tags ?? []).filter((t) => t.name !== RIDE);
  return (
    <>
      <strong>
        {COLOR_NAME[piece.color]} {PIECE_NAME[piece.type]}
      </strong>
      {tags.length > 0 ? (
        <ul>
          {tags.map((t) => (
            <li key={t.name}>{tagText(t)}</li>
          ))}
        </ul>
      ) : (
        <span className="muted">태그 없음</span>
      )}
    </>
  );
}

/** Small card describing the hovered or selected piece: its tags with turns left, and its rider. */
export function PieceInfo({ piece, square }: { piece: Piece; square: Square }) {
  return (
    <div className="hud piece-info">
      <div className="piece-info-square">{squareName(square)}</div>
      <Line piece={piece} />
      {piece.rider && (
        <div className="rider">
          <span className="muted">탑승 중: </span>
          <Line piece={piece.rider} />
        </div>
      )}
    </div>
  );
}
