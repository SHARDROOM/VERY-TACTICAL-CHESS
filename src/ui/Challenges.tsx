import { useEffect } from 'react';
import { CHALLENGES, type Challenge } from '../challenge/challenges';

/* 도전 판 (사용자 요청): the three set boards, from the lobby. */

export function ChallengesDialog({ gmName, onPick, onClose }: { gmName: string; onPick: (c: Challenge) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay records-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog records-dialog challenges-dialog" role="dialog" aria-modal="true" aria-labelledby="challenges-title">
        <header className="records-head">
          <h2 id="challenges-title">도전 판</h2>
          <button onClick={onClose}>닫기</button>
        </header>
        <p className="muted-line">정해진 판에서 몇 턴 안에 목표를 이루세요. 특수 행동은 지금 고른 GM({gmName})이 판정합니다. 흑은 쉬움 AI가 둡니다.</p>
        <ul className="challenge-list">
          {CHALLENGES.map((c) => (
            <li key={c.id}>
              <div>
                <h3>{c.title}</h3>
                <p className="challenge-goal">{c.goal}</p>
                <p className="muted-line">{c.hint}</p>
              </div>
              <button className="primary" onClick={() => onPick(c)}>
                도전
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
