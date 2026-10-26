/**
 * The mobile client talks only to the SoundCatch server in `server/`, never to a
 * music provider directly. These types mirror `server/src/providers/types.ts` —
 * keep the two files in sync when the contract changes.
 */
export type ReleaseKind = 'song' | 'remix' | 'mix' | 'other';

export type UnavailableReason = 'streaming_only' | 'blocked' | 'preview_only' | 'not_configured' | 'unknown';

export type DownloadAvailability =
  | { status: 'available'; originalFormat?: string; sizeBytes?: number }
  | { status: 'unavailable'; reason: UnavailableReason; message: string };

export type ConversionOffer = { available: true; target: 'mp3' } | { available: false; message: string };

export interface Track {
  provider: string;
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl?: string;
  permalinkUrl: string;
  genre?: string;
  releaseYear?: number;
  license?: string;
  isrc?: string;
  kind: ReleaseKind;
  download: DownloadAvailability;
  attribution: { providerName: string; creatorUrl?: string };
  /** Present on every response the server builds through `present()`. */
  conversion: ConversionOffer;
}

export interface UnifiedTrack {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  previewUrl?: string;
  source: 'deezer' | 'itunes' | 'soundcloud';
  sourceUrl?: string;
  downloadable: boolean;
  provider?: string;
  id?: string;
  download?: DownloadAvailability;
  durationMs?: number;
  genre?: string;
  releaseYear?: number;
  license?: string;
  isrc?: string;
  attribution?: { providerName: string; creatorUrl?: string };
}

export interface RecognitionMatch {
  title: string;
  artist: string;
  album?: string;
  releaseDate?: string;
  score?: number;
  songLink?: string;
  coverUrl?: string;
  albumId?: string;
  previewUrl?: string;
  appleMusicUrl?: string;
  spotifyUrl?: string;
}

export interface RecogniseResult {
  match: RecognitionMatch;
  track: RecognitionMatch;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  albumId?: string;
  previewUrl?: string;
  appleMusicUrl?: string;
  spotifyUrl?: string;
  soundcloud?: UnifiedTrack | null;
}

export interface SearchPage {
  items: UnifiedTrack[];
  nextOffset?: number;
}

export interface ProviderSummary {
  id: string;
  displayName: string;
  configured: boolean;
}

export interface ServerInfo {
  providers: ProviderSummary[];
  conversion: boolean;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.0.186:8787').replace(/\/+$/, '');
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Headers for every server call, including file downloads. */
export function authHeaders(): Record<string, string> {
  return API_KEY ? { 'x-api-key': API_KEY } : {};
}

export function downloadUrl(track: Pick<Track, 'provider' | 'id'>, format: 'original' | 'mp3' = 'original'): string {
  const provider = encodeURIComponent(track.provider);
  const id = encodeURIComponent(track.id);
  return `${API_BASE}/v1/tracks/${provider}/${id}/download?format=${format}`;
}

/** True when the text the user typed is a link rather than a search phrase. */
export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: { accept: 'application/json', ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
    });
    const raw = await response.text();
    const body: unknown = raw ? safeJson(raw) : undefined;
    if (!response.ok) {
      const message = isRecord(body) && typeof body.message === 'string' ? body.message : `The server returned ${response.status}.`;
      const code = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
      throw new ApiError(message, response.status, code);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('The server took too long to respond.', 0, 'timeout');
    }
    throw new ApiError(`Cannot reach the SoundCatch server at ${API_BASE}. Is it running?`, 0, 'network');
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  health: (signal?: AbortSignal) => request<{ ok: boolean }>('/health', { signal }),
  serverInfo: (signal?: AbortSignal) => request<ServerInfo>('/v1/providers', { signal }),
  search: (query: string, { limit = 20, offset = 0, signal }: SearchOptions = {}) => {
    const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) });
    return request<SearchPage>(`/v1/search?${params.toString()}`, { signal });
  },
  resolve: (url: string, signal?: AbortSignal) =>
    request<UnifiedTrack>('/v1/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
      signal,
    }),
  track: (provider: string, id: string, signal?: AbortSignal) =>
    request<Track>(`/v1/tracks/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`, { signal }),
  recognise: (audioBase64: string, mimeType: string, signal?: AbortSignal) =>
    request<RecogniseResult>('/v1/recognise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64, mimeType }),
      signal,
    }),
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
