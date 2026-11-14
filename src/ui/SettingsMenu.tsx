import { useEffect, useState } from 'react';

/** Fullscreen for the whole page, where the browser allows it (not on iPhone Safari). */
export function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const [active, setActive] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  return { supported, active, toggle };
}

interface Props {
  onClose: () => void;
  gm: { isAuthority: boolean; name: string; busy: boolean; onOpen: () => void };
  view: { topDown: boolean; onReset: () => void; onToggleTop: () => void };
  fullscreen: ReturnType<typeof useFullscreen>;
  game: { precedents: number; onShowPrecedents: () => void; onLeave: () => void; online: boolean };
}

/** Everything that is a setting or an occasional action, in one menu. */
export function SettingsMenu({ onClose, gm, view, fullscreen, game }: Props) {
  const act = (f: () => void) => () => {
    f();
    onClose();
  };
  return (
    <div className="menu-backdrop" onClick={onClose}>
      <div className="settings-menu" role="menu" onClick={(e) => e.stopPropagation()}>
        <section>
          <h3>GM</h3>
          <div className="menu-note">{gm.name}</div>
          {gm.isAuthority ? (
            <button onClick={act(gm.onOpen)} disabled={gm.busy}>
              GM 설정 (제공자, API 키, 모델)
            </button>
          ) : (
            <div className="menu-note">GM은 방장이 설정합니다.</div>
          )}
        </section>
        <section>
          <h3>화면</h3>
          <button onClick={act(view.onReset)}>시점 초기화</button>
          <button onClick={act(view.onToggleTop)}>{view.topDown ? '비스듬히 보기' : '위에서 보기'}</button>
          {fullscreen.supported && (
            <button onClick={act(fullscreen.toggle)}>{fullscreen.active ? '전체화면 끝내기' : '전체화면'}</button>
          )}
        </section>
        <section>
          <h3>게임</h3>
          <button onClick={act(game.onShowPrecedents)}>판례 보기 ({game.precedents})</button>
          <button className="danger" onClick={act(game.onLeave)}>
            {game.online ? '방에서 나가기' : '로비로 나가기'}
          </button>
        </section>
      </div>
    </div>
  );
}
