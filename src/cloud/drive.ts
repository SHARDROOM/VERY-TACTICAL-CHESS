import type { CloudDoc } from './sync';

/*
 * The cloud copy lives as one small JSON file in the player's own Google Drive, in the hidden
 * application data folder: only this game can see it (not even in the Drive screen), and its
 * scope (drive.appdata) is a non-sensitive one. Plain REST calls with the access token.
 */

const FILE = 'vtc-sync.json';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/** The access token is no longer good: the player has to connect again (a click). */
export class TokenExpired extends Error {}

export interface CloudDrive {
  read(): Promise<CloudDoc | null>;
  write(doc: CloudDoc): Promise<void>;
}

export class GoogleDrive implements CloudDrive {
  private fileId: string | null = null;

  constructor(
    private readonly token: string,
    private readonly doFetch: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.doFetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${this.token}` } });
    if (res.status === 401) throw new TokenExpired('토큰 만료');
    if (!res.ok) throw new Error(`Google Drive 오류 (HTTP ${res.status})`);
    return res;
  }

  private async find(): Promise<string | null> {
    if (this.fileId) return this.fileId;
    const q = encodeURIComponent(`name = '${FILE}'`);
    const res = await this.call(`${API}?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=1`);
    const body = (await res.json()) as { files?: { id: string }[] };
    this.fileId = body.files?.[0]?.id ?? null;
    return this.fileId;
  }

  async read(): Promise<CloudDoc | null> {
    const id = await this.find();
    if (!id) return null;
    const res = await this.call(`${API}/${id}?alt=media`);
    try {
      return (await res.json()) as CloudDoc;
    } catch {
      return null;
    }
  }

  async write(doc: CloudDoc): Promise<void> {
    const id = await this.find();
    const body = JSON.stringify(doc);
    if (id) {
      await this.call(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body });
      return;
    }
    // A new file in the hidden folder: its name and place, then its content.
    const boundary = `vtc${Math.random().toString(36).slice(2)}`;
    const multipart = [
      `--${boundary}`,
      'content-type: application/json; charset=UTF-8',
      '',
      JSON.stringify({ name: FILE, parents: ['appDataFolder'] }),
      `--${boundary}`,
      'content-type: application/json',
      '',
      body,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await this.call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: multipart });
    this.fileId = ((await res.json()) as { id?: string }).id ?? null;
  }
}
