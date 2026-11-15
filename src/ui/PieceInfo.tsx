import { BURN, ELEMENT_NAME, RIDE, squareName, type Piece, type Square, type Tag } from '../engine';
import { ELEMENT_LOOK } from '../scene/fxLooks';
import { COLOR_NAME, PIECE_NAME } from './messages';

function tagText(t: Tag) {
  if (t.name === BURN && t.turnsLeft !== null) return `${t.name} (${t.turnsLeft}턴 안에 움직이지 않으면 타 버림)`;
  return t.turnsLeft === null ? `${t.name} (영구)` : `${t.name} (${t.turnsLeft}턴 남음)`;
}

/** The element a tag wraps its piece in, as a swatch of its colour and its name. */
function AuraMark({ tag }: { tag: Tag }) {
  if (!tag.aura) return null;
  const [from, to] = ELEMENT_LOOK[tag.aura.element].parts[0].colors;
  return (
    <span className="aura-mark" title={`오라 세기 ${tag.aura.strength}`}>
      <span className="aura-swatch" style={{ background: `radial-gradient(circle at 35% 35%, ${from}, ${to})` }} aria-hidden />
      {ELEMENT_NAME[tag.aura.element]} 오라
      <span className="aura-strength" aria-hidden>
        {'●'.repeat(tag.aura.strength)}
        {'○'.repeat(3 - tag.aura.strength)}
      </span>
    </span>
  );
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
            <li key={t.name}>
              {tagText(t)}
              <AuraMark tag={t} />
            </li>
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
