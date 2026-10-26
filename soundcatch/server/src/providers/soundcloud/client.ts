import { ProviderError } from '../types.js';
import { isSafeRedirectTarget } from './urls.js';

const API_BASE = 'https://api.soundcloud.com';
const TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';

type FetchLike = typeof fetch;

export class SoundCloudClient {
  private token: { value: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  /** Client Credentials tokens are rate limited (50/12h), so one token is shared and reused. */
  private async getToken(force = false): Promise<string> {
    if (!this.isConfigured()) {
      throw new ProviderError('not_configured', 'SoundCloud credentials are not configured on the server.', 503);
    }
    if (!force && this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const res = await this.fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json; charset=utf-8',
        },
        body: 'grant_type=client_credentials',
      });
      if (res.status === 429) throw rateLimited(res);
      if (!res.ok) throw new ProviderError('upstream', `SoundCloud token request failed (${res.status}).`, 502);
      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new ProviderError('upstream', 'SoundCloud returned no access token.', 502);
      this.token = { value: json.access_token, expiresAt: this.now() + (json.expires_in ?? 3600) * 1000 };
      return json.access_token;
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Authenticated request; refreshes the token once on 401. Redirects are never followed implicitly. */
  private async authed(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getToken(attempt > 0);
      const res = await this.fetchImpl(url, {
        ...init,
        redirect: 'manual',
        headers: {
          Accept: 'application/json; charset=utf-8',
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `OAuth ${token}`,
        },
      });
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel();
        continue;
      }
      return res;
    }
    throw new ProviderError('upstream', 'SoundCloud authentication failed.', 502);
  }

  private async json<T>(res: Response): Promise<T> {
    if (res.status === 429) throw rateLimited(res);
    if (res.status === 404) throw new ProviderError('not_found', 'SoundCloud could not find that item.', 404);
    if (res.status === 403) throw new ProviderError('not_found', 'This item is not accessible to SoundCloud API clients.', 404);
    if (!res.ok) throw new ProviderError('upstream', `SoundCloud request failed (${res.status}).`, 502);
    return (await res.json()) as T;
  }

  async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
    return this.json<T>(await this.authed(url.toString()));
  }

  /** `/resolve` answers 302 to the canonical API resource; follow it only if it stays on the API host. */
  async resolve<T>(pageUrl: string): Promise<T> {
    const res = await this.authed(`${API_BASE}/resolve?url=${encodeURIComponent(pageUrl)}`);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location || !location.startsWith(`${API_BASE}/`)) {
        throw new ProviderError('upstream', 'SoundCloud returned an unexpected redirect.', 502);
      }
      return this.json<T>(await this.authed(location));
    }
    return this.json<T>(res);
  }

  /**
   * Opens the creator-enabled original file. The OAuth header is only sent to the API host;
   * the signed file URL it redirects to is fetched without credentials.
   */
  async openDownload(downloadUrl: string, range?: string): Promise<Response> {
    if (!downloadUrl.startsWith(`${API_BASE}/`)) {
      throw new ProviderError('upstream', 'Unexpected download URL host.', 502);
    }
    const first = await this.authed(downloadUrl);
    if (first.status === 429) throw rateLimited(first);
    if (first.status === 401 || first.status === 403 || first.status === 404) {
      await first.body?.cancel();
      throw new ProviderError('not_downloadable', 'SoundCloud did not grant this integration access to the file.', 403);
    }
    let res = first;
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get('location');
      await first.body?.cancel();
      if (!location || !isSafeRedirectTarget(location)) {
        throw new ProviderError('upstream', 'SoundCloud returned an unsafe download redirect.', 502);
      }
      res = await this.fetchImpl(location, {
        redirect: 'error',
        headers: range ? { Range: range } : undefined,
      });
    }
    if (res.status === 429) throw rateLimited(res);
    if (res.status !== 200 && res.status !== 206) {
      await res.body?.cancel();
      throw new ProviderError('upstream', `SoundCloud file request failed (${res.status}).`, 502);
    }
    return res;
  }
}

function rateLimited(res: Response): ProviderError {
  const retry = Number(res.headers.get('retry-after'));
  return new ProviderError(
    'rate_limited',
    'SoundCloud is rate limiting requests. Please try again shortly.',
    429,
    Number.isFinite(retry) && retry > 0 ? retry : 60,
  );
}
