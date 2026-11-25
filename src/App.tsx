import { useEffect, useMemo, useRef, useState } from 'react';
import { GameScreen } from './ui/GameScreen';
import { Lobby } from './ui/Lobby';
import { GmSettings, type GmConfig } from './ui/GmSettings';
import { createGmChain, missingKey, serviceOf } from './gm/createGm';
import { LocalSession } from './session/localSession';
import { HostSession } from './session/hostSession';
import { GuestSession } from './session/guestSession';
import { inviteLink, joinRoom, normalizeRoomCode, openRoom } from './session/peerTransport';
import { simulateFalls } from './scene/boardPhysics';
import type { FallSimulator } from './session/authority';
import { browserId, clearSavedGame, gmForSave, gmFromSave, loadSavedGame, rememberBrains, rememberGm, rememberedBackups, rememberedBrains, rememberedGm, saveGame, savedName, type AiBrains, type SavedGame } from './session/storage';
import type { Session, SessionView } from './session/types';
import { isAiOnly, type Color } from './engine';
import type { GameMaster } from './gm/types';
import { WaitingRoom } from './ui/WaitingRoom';
import { rollDie } from './dice';
import { playSfx, reloadSoundSettings, unlockAudio } from './audio/sfx';
import { reloadStagingLook } from './ui/stagingLook';
import { CloudSync, type Item } from './cloud/sync';
import { GoogleDrive } from './cloud/drive';
import { GOOGLE_CLIENT_ID, googleAuth, preloadGoogle } from './cloud/google';
import { CloudContext, CloudDialogs } from './ui/Cloud';
import { FakeGameMaster } from './gm/fakeGm';
import { kindDice, markTutorialOffered, tutorialState } from './tutorial/tutorial';
import type { Challenge } from './challenge/challenges';
import './App.css';

function roomFromHash(): string | null {
  const m = /room=([A-Za-z0-9]+)/.exec(location.hash);
  return m ? normalizeRoomCode(m[1]) : null;
}

function clearHash() {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

/** Falls from the air (공중부양) are settled by the physics, on the side that runs the game. */
const landFalls: FallSimulator = (q) => simulateFalls(q).then((r) => r.landings);

/** Google 로그인과 Drive 저장: only in a build that has a Google client id (docs/GOOGLE_LOGIN.md). */
function makeCloud(): CloudSync | null {
  if (!GOOGLE_CLIENT_ID) return null;
  try {
    return new CloudSync({ storage: localStorage, auth: googleAuth, drive: (token) => new GoogleDrive(token) });
  } catch {
    return null; // no storage on this browser: nothing to keep in step
  }
}

/** A new game's id (kept in its save, so two devices can tell one game from another). */
const newGameId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** How the current game is saved (only the side that runs the game saves it). */
type SaveTarget = { kind: 'hotseat' } | { kind: 'host'; code: string } | null;

export default function App() {
  // 따라하기 is running (the coach shows, nothing is saved or kept as a record).
  const [tutorial, setTutorial] = useState(false);
  // 도전 판 being played (its goal shows; nothing is saved or kept as a record).
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // The GM and its API key are remembered on this browser only, never sent to the other player.
  const [gmConfig, setGmConfig] = useState<GmConfig>(() => rememberedGm().current);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const [saved, setSaved] = useState<SavedGame | null>(() => loadSavedGame());
  const [askForKey, setAskForKey] = useState(false);
  const [startNotice, setStartNotice] = useState<string | null>(null);
  const [lobbyGmSettings, setLobbyGmSettings] = useState(false);
  // The GM with its backups (예비 GM, kept on this browser): bumped when the settings are saved.
  const [gmVersion, setGmVersion] = useState(0);
  const chainOf = (config: GmConfig) => createGmChain(config, rememberedBackups());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gmName = useMemo(() => chainOf(gmConfig).name, [gmConfig, gmVersion]);
  const autoJoined = useRef(false);
  const saveTarget = useRef<SaveTarget>(null);
  const gameId = useRef(newGameId());
  const gmRef = useRef(gmConfig);
  gmRef.current = gmConfig;
  // Each AI seat's own model for its special actions (AI의 두뇌), kept on this browser like the GM's key.
  const [brains, setBrains] = useState<AiBrains>(() => rememberedBrains());
  useEffect(() => {
    if (!session) return;
    const made: Partial<Record<Color, GameMaster>> = {};
    // A seat's own model, blocked, goes on to the GM and its backups in turn.
    const backups = rememberedBackups();
    const gm = gmRef.current;
    const labels = (own: GmConfig) => [serviceOf(own), `GM(${serviceOf(gm)})`, ...backups.map((b, i) => `예비 ${i + 1} ${serviceOf(b)}`)];
    for (const [seat, config] of Object.entries(brains)) if (config) made[seat as Color] = createGmChain(config, [gm, ...backups], labels(config));
    session.setBrains(made);
  }, [session, brains, gmConfig, gmVersion]);
  // Signed in to Google: what comes from the Drive copy is taken up at once.
  const [cloud] = useState(makeCloud);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    if (!cloud) return;
    void preloadGoogle().catch(() => {});
    cloud.onApplied = (items: Item[]) => {
      if (items.includes('gm') || items.includes('backups')) {
        const config = rememberedGm().current;
        setGmConfig(config);
        setGmVersion((v) => v + 1);
        sessionRef.current?.setGm(chainOf(config));
      }
      if (items.includes('brains')) setBrains(rememberedBrains());
      if (items.includes('game')) setSaved(loadSavedGame());
      if (items.includes('sound')) reloadSoundSettings();
      if (items.includes('stagingLook')) reloadStagingLook();
    };
    const stop = cloud.start();
    return () => {
      stop();
      cloud.onApplied = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);
  const changeBrain = (seat: 'white' | 'black' | 'red', config: GmConfig | null) => {
    setBrains((b) => {
      const next = { ...b };
      if (config) next[seat] = config;
      else delete next[seat];
      rememberBrains(next);
      return next;
    });
  };

  const start = (s: Session, target: SaveTarget, notice: string | null = null, resumed: SavedGame | null = null) => {
    setTutorial(false);
    setChallenge(null);
    setError(null);
    setBusy(null);
    saveTarget.current = target;
    gameId.current = resumed?.id ?? newGameId();
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
      // A game only AIs play is for watching, not resuming: it never takes the save slot.
      if (!target || view.phase !== 'playing' || isAiOnly(view.state)) return;
      const seats = session instanceof HostSession ? session.seats() : undefined;
      saveGame({ id: gameId.current, kind: target.kind, code: target.kind === 'host' ? target.code : undefined, state: view.state, gm: gmForSave(gmRef.current), seats });
      last = view.state;
    };
    write();
    return session.subscribe((e) => {
      if (e.kind === 'notice' || e.kind === 'chat') return;
      if (session.view().state !== last) write();
    });
  }, [session]);

  const resumeGm = (game: SavedGame | null): GmConfig => {
    const config = game ? gmFromSave(game.gm, rememberedGm().keys) : gmConfig;
    setGmConfig(config);
    setAskForKey(missingKey(config));
    return config;
  };

  const keyNotice = (config: GmConfig) =>
    missingKey(config) ? ' ⚙ GM 설정에서 API 키를 입력해 주세요.' : '';

  /** One screen: two people (hotseat), against the AI ('vsAi', on black), or watching two AIs ('watch'). */
  const hotseat = (resume: SavedGame | null = null, mode: 'people' | 'vsAi' | 'watch' = 'people') => {
    const config = resumeGm(resume);
    const local = new LocalSession(chainOf(config), { roll: rollDie, initialState: resume?.state, phase: resume ? 'playing' : 'waiting', fall: landFalls });
    if (mode !== 'people') local.setAi('black', { level: mode === 'watch' ? 'hard' : 'normal', specials: 'some' });
    if (mode === 'watch') local.setAi('white', { level: 'normal', specials: 'some' });
    start(local, { kind: 'hotseat' }, resume ? `저장된 게임을 이어 갑니다.${keyNotice(config)}` : null, resume);
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
      hostSession = new HostSession(chainOf(config), {
        code: room.code,
        link: inviteLink(room.code),
        fall: landFalls,
        initialState: resume?.state,
        seats: resume?.seats,
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
      start(hostSession, { kind: 'host', code: room.code }, notice, resume);
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

  /** 따라하기: the lesson board with the fake GM and kind dice; it never takes the save slot. */
  const startTutorial = () => {
    markTutorialOffered();
    const local = new LocalSession(new FakeGameMaster(), { roll: kindDice(), initialState: tutorialState(), phase: 'playing', fall: landFalls });
    start(local, null, '📘 따라하기: 가짜 GM과 함께 한 걸음씩 배웁니다. 이어 하기 저장 칸은 건드리지 않습니다.');
    setTutorial(true);
  };

  /** 도전 판: its board, the player's own GM, black an easy AI; it never takes the save slot. */
  const startChallenge = (c: Challenge) => {
    session?.dispose();
    const config = resumeGm(null);
    const local = new LocalSession(chainOf(config), { roll: rollDie, initialState: c.start(), phase: 'playing', fall: landFalls });
    local.setAi('black', { level: 'easy', specials: 'off' });
    start(local, null, `🎯 도전: ${c.title}. ${c.goal}${keyNotice(config)}`);
    setChallenge(c);
  };

  const leave = () => {
    setTutorial(false);
    setChallenge(null);
    session?.dispose();
    setSession(null);
    saveTarget.current = null;
    setSaved(loadSavedGame());
    clearHash();
  };

  // A backup GM set, changed or taken out is saved at once: the GM in use takes it up now.
  const backupsChanged = () => {
    setGmVersion((v) => v + 1);
    session?.setGm(chainOf(gmRef.current));
  };

  const changeGm = (config: GmConfig) => {
    rememberGm(config);
    setGmConfig(config);
    setAskForKey(false);
    setGmVersion((v) => v + 1);
    session?.setGm(chainOf(config));
  };

  return (
    <CloudContext.Provider value={cloud}>
      {screen()}
      <CloudDialogs />
    </CloudContext.Provider>
  );

  function screen() {
  if (!session) {
    return (
      <>
        <Lobby
          busy={busy}
          error={error}
          saved={saved}
          onHotseat={() => hotseat()}
          onVsAi={() => hotseat(null, 'vsAi')}
          onWatchAi={() => hotseat(null, 'watch')}
          onTutorial={startTutorial}
          onChallenge={startChallenge}
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
            onBackups={backupsChanged}
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
      onBackups={backupsChanged}
      brains={brains}
      onBrain={changeBrain}
      onLeave={leave}
      openGmSettings={askForKey}
      startNotice={startNotice}
      tutorial={tutorial}
      challenge={challenge}
      onRetry={challenge ? () => startChallenge(challenge) : undefined}
    />
  );
  }
}

/** The waiting room or the game, whichever phase the room is in. */
function RoomScreen(props: {
  session: Session;
  gmConfig: GmConfig;
  onGmConfig: (c: GmConfig) => void;
  onBackups: () => void;
  brains: AiBrains;
  onBrain: (seat: 'white' | 'black' | 'red', config: GmConfig | null) => void;
  onLeave: () => void;
  openGmSettings: boolean;
  startNotice: string | null;
  tutorial: boolean;
  challenge: Challenge | null;
  onRetry?: () => void;
}) {
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
  // (A rematch between AIs is a new game too.)
  const phase = view.phase;
  const round = view.watch.round;
  useEffect(() => {
    if (phase === 'playing') setGameNo((n) => n + 1);
  }, [phase, round]);

  if (phase === 'waiting') {
    return (
      <>
        <WaitingRoom
          session={session}
          view={view}
          onLeave={props.onLeave}
          onGmSettings={() => setGmSettings(true)}
          brains={props.brains}
          gmConfig={props.gmConfig}
          onBrain={props.onBrain}
        />
        {gmSettings && (
          <GmSettings
            current={props.gmConfig}
            onClose={() => setGmSettings(false)}
            onSave={(config) => {
              props.onGmConfig(config);
              setGmSettings(false);
            }}
            onBackups={props.onBackups}
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
      onBackups={props.onBackups}
      onLeave={props.onLeave}
      openGmSettings={props.openGmSettings}
      startNotice={gameNo <= 1 ? props.startNotice : null}
      tutorial={props.tutorial && gameNo <= 1}
      challenge={props.challenge}
      onRetry={props.onRetry}
    />
  );
}
