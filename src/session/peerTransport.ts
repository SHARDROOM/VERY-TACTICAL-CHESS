import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Channel } from './channel';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const ID_PREFIX = 'vtc-'; // namespace on the shared public PeerJS server
const TIMEOUT_MS = 15_000;

export function newRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeRoomCode(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const peerIdFor = (code: string) => `${ID_PREFIX}${code.toLowerCase()}`;

/**
 * Where the signalling server is. Default: PeerJS's free public server.
 * For local development and tests, `?peer=localhost:9000` points at a local PeerServer.
 */
function peerOptions(): PeerOptions {
  const params = new URLSearchParams(location.search);
  const debug = params.has('peerdebug') ? { debug: 3 } : {};
  const custom = params.get('peer');
  if (!custom) return debug;
  const [host, port] = custom.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, ...debug };
}

/** Link a friend can open to join `code` (keeps any ?peer= override). */
export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}${location.search}#room=${code}`;
}

function wrap(conn: DataConnection): Channel {
  let closed = false;
  const closeListeners: (() => void)[] = [];
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeListeners.forEach((l) => l());
  };
  conn.on('close', fireClose);
  conn.on('error', fireClose);
  conn.on('iceStateChanged', (state) => {
    if (state === 'failed' || state === 'closed') fireClose();
  });
  return {
    send: (m) => {
      if (conn.open) void conn.send(m);
    },
    onMessage: (l) => void conn.on('data', l),
    onClose: (l) => void closeListeners.push(l),
    close: () => {
      conn.close();
      fireClose();
    },
  };
}

/** Player-facing explanation of a PeerJS failure. */
export function describePeerError(err: unknown): string {
  const type = (err as { type?: string } | null)?.type;
  switch (type) {
    case 'peer-unavailable':
      return '방을 찾을 수 없습니다. 방 코드를 확인하거나, 방장이 방을 열어 두었는지 확인해 주세요.';
    case 'browser-incompatible':
      return '이 브라우저는 P2P 연결(WebRTC)을 지원하지 않습니다. 다른 브라우저를 쓰거나 핫시트 모드를 이용해 주세요.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return '연결 중계 서버에 접속하지 못했습니다. 인터넷 연결을 확인하거나, 잠시 후 다시 시도해 주세요.';
    case 'timeout':
      return '연결 시간이 초과되었습니다. 회사나 학교 네트워크에서는 P2P 연결이 막힐 수 있습니다. 같은 화면에서 하는 핫시트 모드를 이용해 보세요.';
    default:
      return `연결에 실패했습니다${err instanceof Error ? ` (${err.message})` : ''}. 핫시트 모드를 이용해 보세요.`;
  }
}

function waitFor<T>(start: (resolve: (v: T) => void, reject: (e: unknown) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject({ type: 'timeout' }), TIMEOUT_MS);
    start(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface OpenRoom {
  code: string;
  close(): void;
}

/** Host: registers a room code on the signalling server and hands each incoming guest to `onGuest`. */
export async function openRoom(onGuest: (channel: Channel) => void): Promise<OpenRoom> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newRoomCode();
    const peer = new Peer(peerIdFor(code), peerOptions());
    try {
      await waitFor<void>((resolve, reject) => {
        peer.once('open', () => resolve());
        peer.once('error', reject);
      });
    } catch (err) {
      peer.destroy();
      if ((err as { type?: string }).type === 'unavailable-id') continue; // code taken: try another
      throw new Error(describePeerError(err));
    }
    peer.on('connection', (conn) => conn.once('open', () => onGuest(wrap(conn))));
    // Stay reachable if the signalling socket drops; open games keep running over WebRTC.
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    return { code, close: () => peer.destroy() };
  }
  throw new Error('방 코드를 만들지 못했습니다. 다시 시도해 주세요.');
}

/** Guest: connects to the host of `code`. */
export async function joinRoom(code: string): Promise<{ channel: Channel; close(): void }> {
  const peer = new Peer(peerOptions());
  try {
    await waitFor<void>((resolve, reject) => {
      peer.once('open', () => resolve());
      peer.once('error', reject);
    });
    const conn = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
    await waitFor<void>((resolve, reject) => {
      conn.once('open', () => resolve());
      conn.once('error', reject);
      peer.once('error', reject);
    });
    return { channel: wrap(conn), close: () => peer.destroy() };
  } catch (err) {
    peer.destroy();
    throw new Error(describePeerError(err));
  }
}
