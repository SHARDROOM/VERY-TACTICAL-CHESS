import { useState, type FormEvent } from 'react';
import { normalizeRoomCode } from '../session/peerTransport';
import type { SavedGame } from '../session/storage';

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`;
}

interface Props {
  busy: string | null;
  error: string | null;
  saved: SavedGame | null;
  onResume: () => void;
  onDiscard: () => void;
  onHotseat: () => void;
  onHost: () => void;
  onJoin: (code: string) => void;
}

export function Lobby({ busy, error, saved, onResume, onDiscard, onHotseat, onHost, onJoin }: Props) {
  const [code, setCode] = useState('');
  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (c.length === 6) onJoin(c);
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>아주 전략적인 체스</h1>
        <p className="tagline">체스판 위에서 무엇이든 선언하세요. GM이 판정하고, 주사위가 결정합니다.</p>

        {saved && (
          <div className="saved-card">
            <div>
              <strong>저장된 게임</strong>
              <div className="muted-line">
                {saved.kind === 'host' ? `온라인 방 ${saved.code}` : '핫시트'} · 턴 {saved.state.turnNumber}
                {saved.state.status.kind === 'won' ? ' · 끝난 게임' : ''} · {ago(saved.savedAt)}
              </div>
            </div>
            <div className="saved-actions">
              <button className="primary" onClick={onResume} disabled={!!busy}>
                이어 하기
              </button>
              <button className="link" onClick={onDiscard} disabled={!!busy}>
                지우기
              </button>
            </div>
          </div>
        )}

        <button className="primary big" onClick={onHost} disabled={!!busy}>
          온라인 방 만들기
        </button>
        <form className="join-row" onSubmit={join}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="방 코드 6자리"
            maxLength={8}
            disabled={!!busy}
            autoCapitalize="characters"
            spellCheck={false}
          />
          <button type="submit" disabled={!!busy || normalizeRoomCode(code).length !== 6}>
            참가
          </button>
        </form>
        <button className="big" onClick={onHotseat} disabled={!!busy}>
          한 화면에서 둘이 하기 (핫시트)
        </button>

        {busy && <p className="lobby-status">{busy}</p>}
        {error && <p className="lobby-error">{error}</p>}

        <p className="lobby-note">
          온라인 대전은 서버 없이 두 브라우저를 직접 연결합니다(P2P). 방장 브라우저가 게임을 진행하고 GM을 호출합니다. 회사나 학교
          네트워크에서는 연결이 막힐 수 있으니, 그럴 때는 핫시트 모드를 이용하세요.
        </p>
      </div>
    </div>
  );
}
