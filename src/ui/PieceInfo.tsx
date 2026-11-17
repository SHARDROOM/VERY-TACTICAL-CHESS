import { BASE_CLASH, BURN, ELEMENT_NAME, RIDE, clashMultiplier, clashSkill, ridersOf, squareName, type Piece, type Square, type Tag } from '../engine';
import { ELEMENT_LOOK } from '../scene/fxLooks';
import { COLOR_NAME, PIECE_NAME, mindAndSkill, movePowers } from './messages';

function tagText(t: Tag) {
  if (t.name === BURN && t.turnsLeft !== null) return `${t.name} (${t.turnsLeft}턴 안에 움직이지 않으면 타 버림)`;
  const powers = [movePowers(t), t.clash ? `합 ×${t.clash}` : '', mindAndSkill(t)].filter(Boolean).join(', ');
  const time = t.turnsLeft === null ? '영구' : `${t.turnsLeft}턴 남음`;
  return `${t.name} (${time})${powers ? `: ${powers}` : ''}`;
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

/** Its clash multiplier (합 배율): the kind's base, times its weapon's if it has one. */
function ClashLine({ piece }: { piece: Piece }) {
  const base = piece.fuse?.base ?? BASE_CLASH[piece.type];
  const skill = clashSkill(piece);
  const total = clashMultiplier(piece);
  return (
    <span className="clash-base" title="합에서 주사위에 곱하는 수. 기물 점수가 높을수록 기본 배율이 높습니다.">
      합 ×{total}
      {piece.fuse && <span className="muted"> (융합 ×{piece.fuse.base}{total < Math.round(base * skill * 100) / 100 ? ', 최대 ×3' : ''})</span>}
      {!piece.fuse && skill > 1 && total === Math.round(base * skill * 100) / 100 && (
        <span className="muted">
          {' '}
          (기본 ×{base} × 태그 ×{skill})
        </span>
      )}
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
      <ClashLine piece={piece} />
      {piece.fuse && (
        <span className="muted">
          관: {piece.fuse.crowns.map((c) => `${PIECE_NAME[c.type]}(${COLOR_NAME[c.color]})`).join(' · ')}
        </span>
      )}
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
      {ridersOf(piece).map((r, i) => (
        <div className="rider" key={r.id}>
          <span className="muted">{i === 0 ? '탑승 중: ' : '그 위에: '}</span>
          <Line piece={r} />
        </div>
      ))}
    </div>
  );
}
