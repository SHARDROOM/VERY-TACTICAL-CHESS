import { useEffect, useState } from 'react';
import { getSoundSettings, onSoundSettings, playSfx, setSoundSettings } from '../audio/sfx';
import { setStagingLook, useStagingLook } from './stagingLook';
import { CloudSection } from './Cloud';

/** "연출: 풍부하게 / 가볍게": how much of the GM's staging this device draws. */
function StagingControls() {
  const look = useStagingLook();
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="연출">
        <button role="radio" aria-checked={look === 'rich'} className={look === 'rich' ? 'active' : ''} onClick={() => setStagingLook('rich')}>
          풍부하게
        </button>
        <button role="radio" aria-checked={look === 'light'} className={look === 'light' ? 'active' : ''} onClick={() => setStagingLook('light')}>
          가볍게
        </button>
      </div>
      <div className="menu-note">{look === 'rich' ? '입자와 화면 흔들림을 모두 보여 줍니다.' : '입자를 줄이고 화면 흔들림을 끕니다. 느린 기기에 맞습니다.'}</div>
    </>
  );
}

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
      <label className="menu-row">
        <input type="checkbox" checked={sound.music} onChange={(e) => setSoundSettings({ music: e.target.checked })} />
        배경음악
      </label>
      <label className="menu-row">
        <span>음악 음량</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sound.musicVolume}
          disabled={!sound.music}
          onChange={(e) => setSoundSettings({ musicVolume: Number(e.target.value) })}
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
  gm: { isAuthority: boolean; name: string; busy: boolean; onOpen: () => void; note?: string };
  fullscreen: ReturnType<typeof useFullscreen>;
  /** In a game: the way out, and ending it (기권, 무승부) when this screen may. Absent on the title screen. */
  game?: { onLeave: () => void; online: boolean; onResign?: () => void; onOfferDraw?: () => void; drawLabel?: string };
  /** The room's rules, shown read-only in a game. */
  rules?: string[];
}

/** Settings and rare actions (GM, fullscreen, sound, leaving); camera and precedents stay on screen. */
export function SettingsMenu({ onClose, gm, fullscreen, game, rules }: Props) {
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
          {gm.note && <div className="menu-note">{gm.note}</div>}
        </section>
        <CloudSection onAction={onClose} />
        {fullscreen.supported && (
          <section>
            <h3>화면</h3>
            <button onClick={act(fullscreen.toggle)}>{fullscreen.active ? '전체화면 끝내기' : '전체화면'}</button>
          </section>
        )}
        <section>
          <h3>연출</h3>
          <StagingControls />
        </section>
        <section>
          <h3>소리</h3>
          <SoundControls />
        </section>
        {rules && (
          <section>
            <h3>이 방의 규칙</h3>
            {rules.map((line) => (
              <div key={line} className="menu-note">
                {line}
              </div>
            ))}
          </section>
        )}
        {game && (
          <section>
            <h3>게임</h3>
            {game.onOfferDraw && <button onClick={act(game.onOfferDraw)}>{game.drawLabel ?? '무승부 제안'}</button>}
            {game.onResign && (
              <button className="danger" onClick={act(game.onResign)}>
                기권
              </button>
            )}
            <button className="danger" onClick={act(game.onLeave)}>
              {game.online ? '방에서 나가기' : '로비로 나가기'}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
