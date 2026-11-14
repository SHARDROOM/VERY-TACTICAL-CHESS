import { useEffect, useMemo, useRef, useState } from 'react';
import { GameScreen } from './ui/GameScreen';
import { Lobby } from './ui/Lobby';
import { GmSettings, type GmConfig } from './ui/GmSettings';
import { createGm } from './gm/createGm';
import { LocalSession } from './session/localSession';
import { HostSession } from './session/hostSession';
import { GuestSession } from './session/guestSession';
import { inviteLink, joinRoom, normalizeRoomCode, openRoom } from './session/peerTransport';
import { browserId, clearSavedGame, gmForSave, gmFromSave, loadSavedGame, saveGame, savedName, type SavedGame } from './session/storage';
import type { Session, SessionView } from './session/types';
import { WaitingRoom } from './ui/WaitingRoom';
import { rollD20 } from './dice';
import { playSfx, unlockAudio } from './audio/sfx';
import './App.css';

function roomFromHash(): string | null {
  const m = /room=([A-Za-z0-9]+)/.exec(location.hash);
  return m ? normalizeRoomCode(m[1]) : null;
}

function clearHash() {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

/** How the current game is saved (only the side that runs the game saves it). */
type SaveTarget = { kind: 'hotseat' } | { kind: 'host'; code: string } | null;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  // The API key lives only here, in memory: never persisted, never sent to the other player.
  const [gmConfig, setGmConfig] = useState<GmConfig>({ provider: 'fake' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const [saved, setSaved] = useState<SavedGame | null>(() => loadSavedGame());
  const [askForKey, setAskForKey] = useState(false);
  const [startNotice, setStartNotice] = useState<string | null>(null);
  const [lobbyGmSettings, setLobbyGmSettings] = useState(false);
  const gmName = useMemo(() => createGm(gmConfig).name, [gmConfig]);
  const autoJoined = useRef(false);
  const saveTarget = useRef<SaveTarget>(null);
  const gmRef = useRef(gmConfig);
  gmRef.current = gmConfig;

  const start = (s: Session, target: SaveTarget, notice: string | null = null) => {
    setError(null);
    setBusy(null);
    saveTarget.current = target;
    setStartNotice(notice);
    setSessionId((n) => n + 1);
    setSession(s);
  };

  // Auto-save: after every change in a game, the side that runs the game writes a snapshot.
  useEffect(() => {
    if (!session) return;
    let last = session.view().state;
    const write = () => {
      const target = saveTarget.current;
      const view = session.view();
      if (!target || view.phase !== 'playing') return;
      const black = session instanceof HostSession ? session.blackPlayer() ?? undefined : undefined;
      saveGame({ kind: target.kind, code: target.kind === 'host' ? target.code : undefined, state: view.state, gm: gmForSave(gmRef.current), black });
      last = view.state;
    };
    write();
    return session.subscribe((e) => {
      if (e.kind === 'notice' || e.kind === 'chat') return;
      if (session.view().state !== last) write();
    });
  }, [session]);

  const resumeGm = (game: SavedGame | null): GmConfig => {
    const config = game ? gmFromSave(game.gm) : gmConfig;
    setGmConfig(config);
    setAskForKey(config.provider !== 'fake' && !config.apiKey);
    return config;
  };

  const keyNotice = (config: GmConfig) =>
    config.provider !== 'fake' && !config.apiKey ? ' API 키는 저장되지 않으므로 ⚙ GM 설정에서 다시 입력해 주세요.' : '';

  const hotseat = (resume: SavedGame | null = null) => {
    const config = resumeGm(resume);
    start(
      new LocalSession(createGm(config), { roll: rollD20, initialState: resume?.state, phase: resume ? 'playing' : 'waiting' }),
      { kind: 'hotseat' },
      resume ? `저장된 게임을 이어 갑니다.${keyNotice(config)}` : null,
    );
  };

  const host = async (resume: SavedGame | null = null) => {
    setError(null);
    setBusy(resume?.code ? `방 ${resume.code}을(를) 다시 여는 중…` : '방을 여는 중…');
    const config = resumeGm(resume);
    let hostSession: HostSession | null = null;
    const pendingGuests: Parameters<HostSession['attachGuest']>[0][] = [];
    try {
      const room = await openRoom(
        (channel) => {
          if (hostSession) hostSession.attachGuest(channel);
          else pendingGuests.push(channel);
        },
        {
          preferredCode: resume?.code,
          onWaiting: (n) => setBusy(`방 ${resume?.code}을(를) 다시 여는 중… 이전 연결이 정리되기를 기다리고 있습니다 (${n}/10)`),
        },
      );
      hostSession = new HostSession(createGm(config), {
        code: room.code,
        link: inviteLink(room.code),
        initialState: resume?.state,
        black: resume?.black,
        hostName: savedName() || undefined,
        onDispose: room.close,
      });
      pendingGuests.forEach((c) => hostSession!.attachGuest(c));
      let notice: string | null = null;
      if (resume) {
        notice = room.reusedCode
          ? `저장된 게임을 같은 방 코드(${room.code})로 다시 열었습니다. 상대가 자동으로 다시 연결됩니다.`
          : `이전 방 코드를 다시 쓸 수 없어 새 코드 ${room.code}로 열었습니다. 친구에게 새 링크를 보내 주세요.`;
        notice += keyNotice(config);
      }
      start(hostSession, { kind: 'host', code: room.code }, notice);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const join = async (code: string) => {
    setError(null);
    setBusy(`방 ${code}에 연결하는 중…`);
    let closePeer: (() => void) | null = null;
    try {
      const first = await joinRoom(code);
      closePeer = first.close;
      const guest = new GuestSession(first.channel, {
        id: browserId(),
        name: savedName() || undefined,
        // If the host goes away (reload, network), keep knocking on the same room.
        reconnect: async () => {
          closePeer?.();
          const next = await joinRoom(code);
          closePeer = next.close;
          return next.channel;
        },
        onDispose: () => closePeer?.(),
      });
      start(guest, null);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Sound needs a user gesture to start; every button press gives a small click.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      unlockAudio();
      if ((e.target as Element | null)?.closest?.('button:not(:disabled)')) playSfx('click');
    };
    const onKey = () => unlockAudio();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // Opening an invite link joins straight away.
  useEffect(() => {
    if (autoJoined.current) return;
    autoJoined.current = true;
    const code = roomFromHash();
    if (code) void join(code);
  }, []);

  // Closing the tab says goodbye properly, so the other side notices at once.
  useEffect(() => {
    if (!session) return;
    const bye = () => session.dispose();
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [session]);

  const leave = () => {
    session?.dispose();
    setSession(null);
    saveTarget.current = null;
    setSaved(loadSavedGame());
    clearHash();
  };

  const changeGm = (config: GmConfig) => {
    setGmConfig(config);
    setAskForKey(false);
    session?.setGm(createGm(config));
  };

  if (!session) {
    return (
      <>
        <Lobby
          busy={busy}
          error={error}
          saved={saved}
          onHotseat={() => hotseat()}
          onHost={() => void host()}
          onJoin={join}
          onResume={() => (saved?.kind === 'host' ? void host(saved) : hotseat(saved))}
          onDiscard={() => {
            clearSavedGame();
            setSaved(null);
          }}
          gmName={gmName}
          onGmSettings={() => setLobbyGmSettings(true)}
        />
        {lobbyGmSettings && (
          <GmSettings
            current={gmConfig}
            onClose={() => setLobbyGmSettings(false)}
            onSave={(config) => {
              changeGm(config);
              setLobbyGmSettings(false);
            }}
          />
        )}
      </>
    );
  }
  return (
    <RoomScreen
      key={sessionId}
      session={session}
      gmConfig={gmConfig}
      onGmConfig={changeGm}
      onLeave={leave}
      openGmSettings={askForKey}
      startNotice={startNotice}
    />
  );
}

/** The waiting room or the game, whichever phase the room is in. */
function RoomScreen(props: { session: Session; gmConfig: GmConfig; onGmConfig: (c: GmConfig) => void; onLeave: () => void; openGmSettings: boolean; startNotice: string | null }) {
  const { session } = props;
  const [view, setView] = useState<SessionView>(() => session.view());
  const [gameNo, setGameNo] = useState(0);
  const [gmSettings, setGmSettings] = useState(false);
  useEffect(() => {
    const unsubscribe = session.subscribe((e) => e.kind === 'view' && setView(e.view));
    setView(session.view());
    return unsubscribe;
  }, [session]);
  // Every game gets a fresh screen (log, camera, dice).
  const phase = view.phase;
  useEffect(() => {
    if (phase === 'playing') setGameNo((n) => n + 1);
  }, [phase]);

  if (phase === 'waiting') {
    return (
      <>
        <WaitingRoom session={session} view={view} onLeave={props.onLeave} onGmSettings={() => setGmSettings(true)} />
        {gmSettings && (
          <GmSettings
            current={props.gmConfig}
            onClose={() => setGmSettings(false)}
            onSave={(config) => {
              props.onGmConfig(config);
              setGmSettings(false);
            }}
          />
        )}
      </>
    );
  }
  return (
    <GameScreen
      key={gameNo}
      session={session}
      gmConfig={props.gmConfig}
      onGmConfig={props.onGmConfig}
      onLeave={props.onLeave}
      openGmSettings={props.openGmSettings}
      startNotice={gameNo <= 1 ? props.startNotice : null}
    />
  );
}
