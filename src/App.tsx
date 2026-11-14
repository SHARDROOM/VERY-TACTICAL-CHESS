import { useEffect, useRef, useState } from 'react';
import { GameScreen } from './ui/GameScreen';
import { Lobby } from './ui/Lobby';
import type { GmConfig } from './ui/GmSettings';
import { createGm } from './gm/createGm';
import { LocalSession } from './session/localSession';
import { HostSession } from './session/hostSession';
import { GuestSession } from './session/guestSession';
import { inviteLink, joinRoom, normalizeRoomCode, openRoom } from './session/peerTransport';
import type { Session } from './session/types';
import './App.css';

function roomFromHash(): string | null {
  const m = /room=([A-Za-z0-9]+)/.exec(location.hash);
  return m ? normalizeRoomCode(m[1]) : null;
}

function clearHash() {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  // The API key lives only here, in memory: never persisted, never sent to the other player.
  const [gmConfig, setGmConfig] = useState<GmConfig>({ provider: 'fake' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(0);
  const autoJoined = useRef(false);

  const start = (s: Session) => {
    setError(null);
    setBusy(null);
    setSessionId((n) => n + 1);
    setSession(s);
  };

  const hotseat = () => start(new LocalSession(createGm(gmConfig)));

  const host = async () => {
    setError(null);
    setBusy('방을 여는 중…');
    let hostSession: HostSession | null = null;
    const pendingGuests: Parameters<HostSession['attachGuest']>[0][] = [];
    try {
      const room = await openRoom((channel) => {
        if (hostSession) hostSession.attachGuest(channel);
        else pendingGuests.push(channel);
      });
      hostSession = new HostSession(createGm(gmConfig), { code: room.code, link: inviteLink(room.code), onDispose: room.close });
      pendingGuests.forEach((c) => hostSession!.attachGuest(c));
      start(hostSession);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const join = async (code: string) => {
    setError(null);
    setBusy(`방 ${code}에 연결하는 중…`);
    try {
      const { channel, close } = await joinRoom(code);
      start(new GuestSession(channel, close));
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
    clearHash();
  };

  const changeGm = (config: GmConfig) => {
    setGmConfig(config);
    session?.setGm(createGm(config));
  };

  if (!session) return <Lobby busy={busy} error={error} onHotseat={hotseat} onHost={host} onJoin={join} />;
  return <GameScreen key={sessionId} session={session} gmConfig={gmConfig} onGmConfig={changeGm} onLeave={leave} />;
}
