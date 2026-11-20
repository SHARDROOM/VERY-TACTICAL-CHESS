import { useEffect, useRef, useState } from 'react';
import type { Precedent } from '../engine';
import { COLOR_NAME, OUTCOME_LABEL } from './messages';

/** Copies text to the clipboard (the old way where the clipboard API is missing or refused). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * Every ruling made in this game, newest first: what was declared, how the GM ruled, and what the
 * dice said. Each declaration can be copied, or put in the action box to try again (사용자 요청).
 */
export function PrecedentList({ precedents, onClose, onUse }: { precedents: Precedent[]; onClose: () => void; onUse?: (action: string) => void }) {
  const newestFirst = [...precedents].reverse();
  // Which one was just copied (or could not be), for a moment.
  const [copied, setCopied] = useState<{ i: number; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (i: number, action: string) => {
    const ok = await copyText(action);
    setCopied({ i, ok });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  };
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
                <div className="precedent-foot">
                  <span className="muted">
                    DC {p.dc}, AP {p.cost}
                  </span>
                  <span className="precedent-tools">
                    <button type="button" onClick={() => void copy(i, p.action)} aria-label={`"${p.action}" 복사`}>
                      {copied?.i === i ? (copied.ok ? '✓ 복사됨' : '복사하지 못함') : '📋 복사'}
                    </button>
                    {onUse && (
                      <button type="button" onClick={() => onUse(p.action)} title="이 행동을 입력칸에 넣습니다 (고쳐서 보낼 수 있음)">
                        ✏ 입력칸에 넣기
                      </button>
                    )}
                  </span>
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
