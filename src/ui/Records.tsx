import { useEffect, useState } from 'react';
import { readRecords, type GameRecord } from '../session/records';
import { COLOR_NAME, OUTCOME_LABEL, highlightLines } from './messages';
import { josa } from './josa';

/* 기록·전적 (사용자 요청): the finished games kept on this browser (and merged from the other devices). */

const MODE_NAME: Record<GameRecord['mode'], string> = { hotseat: '핫시트', ai: 'AI와', online: '온라인', watching: '관전' };
const END_NAME: Record<GameRecord['end'], string> = { king: '킹을 잡아 끝남', resign: '기권으로 끝남', agreed: '합의한 무승부', kingsOnly: '킹만 남아 무승부' };

/** "AI와 3승 1패 · 온라인 1승 1무 · 핫시트 2판 · 관전 1판": the modes in that order, those played only. */
export function recordSummary(records: readonly GameRecord[]): string {
  const parts: string[] = [];
  for (const mode of ['ai', 'online', 'hotseat', 'watching'] as const) {
    const mine = records.filter((r) => r.mode === mode);
    if (!mine.length) continue;
    const won = mine.filter((r) => r.result === 'won').length;
    const lost = mine.filter((r) => r.result === 'lost').length;
    const drawn = mine.filter((r) => r.result === 'draw').length;
    const scored = won + lost + drawn;
    const score = [won && `${won}승`, lost && `${lost}패`, drawn && `${drawn}무`].filter(Boolean).join(' ');
    // Two at one screen, or watching: no side of one's own, so only how many.
    parts.push(scored ? `${MODE_NAME[mode]} ${score}` : `${MODE_NAME[mode]} ${mine.length}판`);
  }
  return parts.join(' · ');
}

/** This screen's result, or (no side of its own) who won. */
export function resultLabel(r: GameRecord): string {
  if (r.result === 'won') return '승';
  if (r.result === 'lost') return '패';
  if (r.result === 'draw') return '무';
  return r.winner ? `${COLOR_NAME[r.winner]} 승리` : '무승부';
}

function when(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function modeLine(r: GameRecord): string {
  const against = r.ai ? Object.entries(r.ai).map(([c, level]) => `${COLOR_NAME[c as keyof typeof COLOR_NAME]} ${level}`).join(', ') : '';
  const side = r.me && r.me !== 'both' ? josa(COLOR_NAME[r.me], '으로/로') : '';
  return [MODE_NAME[r.mode] + (against ? `(${against})` : ''), side, r.map === 'hex3' ? '3인 판' : '', `${r.turns}턴`].filter(Boolean).join(' · ');
}

export function RecordsDialog({ onClose }: { onClose: () => void }) {
  const [records] = useState(() => readRecords());
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay records-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog records-dialog" role="dialog" aria-modal="true" aria-labelledby="records-title">
        <header className="records-head">
          <h2 id="records-title">전적</h2>
          <button onClick={onClose}>닫기</button>
        </header>
        {records.length ? (
          <p className="records-summary">{recordSummary(records)}</p>
        ) : (
          <p className="muted-line">아직 끝낸 게임이 없습니다. 한 판을 끝까지 두면 여기에 남습니다(AI끼리 보기는 남지 않습니다).</p>
        )}
        <ol className="records-list">
          {records.map((r) => (
            <li key={r.id}>
              <details>
                <summary>
                  <span className={`record-result record-${r.result ?? 'none'}`}>{resultLabel(r)}</span>
                  <span className="record-what">{modeLine(r)}</span>
                  <span className="record-when">{when(r.at)}</span>
                </summary>
                <div className="record-body">
                  <p className="muted-line">
                    {END_NAME[r.end]} · GM {r.gm}
                  </p>
                  {highlightLines(r.highlights).length > 0 && (
                    <ul className="record-moments">
                      {highlightLines(r.highlights).map((m) => (
                        <li key={m.kind}>
                          <span className="moment-title">{m.title}</span> {m.text}
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.precedents.length > 0 ? (
                    <ol className="record-precedents">
                      {r.precedents.map((p, i) => (
                        <li key={i}>
                          {p.turnNumber}턴 {COLOR_NAME[p.color]}: “{p.action}” DC {p.dc} → {OUTCOME_LABEL[p.outcome]}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="muted-line">특수 행동 없이 끝난 판입니다.</p>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
