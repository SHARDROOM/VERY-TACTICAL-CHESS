/*
 * Signing in with Google from the page itself (Google Identity Services, the token model): a
 * click opens Google's window and gives back a short-lived access token for the hidden Drive
 * folder and the email (shown as who is signed in). No server; when the token runs out, another
 * click gets a new one. The OAuth client id is public (it is in every page that signs in): this
 * game's own (Google Cloud project chess-drive, origins https://shardroom.github.io and
 * http://localhost:5173), unless a build gives another (VITE_GOOGLE_CLIENT_ID, e.g. for a fork on
 * another address). Setting one up: docs/GOOGLE_LOGIN.md.
 */

const OWN_CLIENT_ID = '473752168126-rrm8hadird8bj25mcntthlo6fd5bmer5.apps.googleusercontent.com';
export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || OWN_CLIENT_ID;
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata email';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
  callback: (r: TokenResponse) => void;
}
interface GoogleOAuth {
  initTokenClient(config: { client_id: string; scope: string; login_hint?: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth } };
  }
}

export interface Token {
  token: string;
  /** When it runs out (ms). */
  expiresAt: number;
}

/** How a sign-in is asked for, so the sync can be tried without Google (tests). */
export interface CloudAuth {
  /** Must be called from a click (Google opens a window). `hint`: the account signed in before (no account chooser). */
  requestToken(hint?: string): Promise<Token>;
  email(token: string): Promise<string | null>;
  revoke(token: string): void;
}

let loading: Promise<GoogleOAuth> | null = null;

/** Loads Google's script ahead of the first click (a click must open the window at once). */
export function preloadGoogle(): Promise<GoogleOAuth> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new Error('Google 로그인을 불러오지 못했습니다.')));
    script.onerror = () => {
      loading = null;
      reject(new Error('Google 로그인을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export const googleAuth: CloudAuth = {
  requestToken(hint) {
    const oauth = window.google?.accounts?.oauth2;
    if (!oauth) return preloadGoogle().then(() => Promise.reject(new Error('Google 로그인을 준비했습니다. 한 번 더 눌러 주세요.')));
    return new Promise((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE,
        ...(hint ? { login_hint: hint } : {}),
        callback: (r) => {
          if (r.access_token) resolve({ token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 - 60_000 });
          else reject(new Error(r.error === 'access_denied' ? '로그인을 취소했습니다.' : `Google 로그인 오류 (${r.error ?? '알 수 없음'})`));
        },
        error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? '로그인 창을 닫았습니다.' : 'Google 로그인 창을 열지 못했습니다(팝업 차단을 확인해 주세요).')),
      });
      client.requestAccessToken({ prompt: '' });
    });
  },
  async email(token) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const body = (await res.json()) as { email?: string };
      return body.email ?? null;
    } catch {
      return null;
    }
  },
  revoke(token) {
    window.google?.accounts?.oauth2?.revoke(token);
  },
};
