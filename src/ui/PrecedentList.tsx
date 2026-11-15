import type { Precedent } from '../engine';
import { COLOR_NAME, OUTCOME_LABEL } from './messages';

/** Every ruling made in this game, newest first: what was declared, how the GM ruled, and what the dice said. */
export function PrecedentList({ precedents, onClose }: { precedents: Precedent[]; onClose: () => void }) {
  const newestFirst = [...precedents].reverse();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog precedents" onClick={(e) => e.stopPropagation()}>
        <h2>판례</h2>
        <p className="muted">이번 게임에서 시도된 특수 행동과 GM의 판정입니다. GM은 비슷한 행동을 이 판례에 맞춰 판정합니다.</p>
        {newestFirst.length === 0 ? (
          <p className="muted">아직 판례가 없습니다.</p>
        ) : (
          <ol>
            {newestFirst.map((p, i) => (
              <li key={i}>
                <div className="precedent-head">
                  <span>
                    {p.turnNumber}턴, {COLOR_NAME[p.color]}
                  </span>
                  <span className={`outcome ${p.outcome}`}>
                    🎲 {p.roll} {OUTCOME_LABEL[p.outcome]}
                    {p.rerolls ? ` (다시 굴림 ${p.rerolls}번)` : ''}
                  </span>
                </div>
                <div className="precedent-action">“{p.action}”</div>
                <div className="muted">{p.interpretation}</div>
                <div className="muted">
                  DC {p.dc}, AP {p.cost}
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="choice-row">
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
