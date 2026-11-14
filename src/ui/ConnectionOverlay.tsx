import type { ConnectionStatus } from '../session/types';

/** Joining, paused (host away) and disconnected screens, shared by the waiting room and the game. */
export function ConnectionOverlay({ connection, onLeave }: { connection: ConnectionStatus; onLeave: () => void }) {
  if (connection.kind === 'paused') {
    return (
      <div className="overlay">
        <div className="dialog">
          <h2>게임 일시정지</h2>
          <p>{connection.reason} 방장이 돌아오면 자동으로 이어집니다.</p>
          <p className="muted-line">다시 연결을 시도하고 있습니다…</p>
          <button onClick={onLeave}>나가기</button>
        </div>
      </div>
    );
  }
  if (connection.kind === 'connecting') {
    return (
      <div className="overlay">
        <div className="dialog">
          <h2>방에 들어가는 중…</h2>
          <p className="muted-line">방장의 응답을 기다리고 있습니다.</p>
          <button onClick={onLeave}>취소</button>
        </div>
      </div>
    );
  }
  if (connection.kind === 'disconnected') {
    return (
      <div className="overlay">
        <div className="dialog">
          <h2>연결이 끊겼습니다</h2>
          <p>{connection.reason}</p>
          <button className="primary" onClick={onLeave}>
            로비로
          </button>
        </div>
      </div>
    );
  }
  return null;
}
