import { useEffect, useState } from 'react';
import { getSoundSettings, onSoundSettings, playSfx, setSoundSettings } from '../audio/sfx';

function SoundControls() {
  const [sound, setSound] = useState(getSoundSettings);
  useEffect(() => onSoundSettings(setSound), []);
  return (
    <>
      <label className="menu-row">
        <input type="checkbox" checked={sound.enabled} onChange={(e) => setSoundSettings({ enabled: e.target.checked })} />
        효과음
      </label>
      <label className="menu-row">
        <span>음량</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sound.volume}
          disabled={!sound.enabled}
          onChange={(e) => setSoundSettings({ volume: Number(e.target.value) })}
          onPointerUp={() => playSfx('coinClink', { strength: 0.8 })}
        />
      </label>
    </>
  );
}

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
  fullscreen: ReturnType<typeof useFullscreen>;
  game: { onLeave: () => void; online: boolean };
}

/** Settings and rare actions (GM, fullscreen, sound, leaving); camera and precedents stay on screen. */
export function SettingsMenu({ onClose, gm, fullscreen, game }: Props) {
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
        {fullscreen.supported && (
          <section>
            <h3>화면</h3>
            <button onClick={act(fullscreen.toggle)}>{fullscreen.active ? '전체화면 끝내기' : '전체화면'}</button>
          </section>
        )}
        <section>
          <h3>소리</h3>
          <SoundControls />
        </section>
        <section>
          <h3>게임</h3>
          <button className="danger" onClick={act(game.onLeave)}>
            {game.online ? '방에서 나가기' : '로비로 나가기'}
          </button>
        </section>
      </div>
    </div>
  );
}
