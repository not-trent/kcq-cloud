import { ProviderError } from '../types.js';
import type { RecognitionMatch } from './types.js';

type FetchLike = typeof fetch;

const API_URL = 'https://api.audd.io/';

export class AudDClient {
  constructor(
    private readonly apiToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiToken);
  }

  async recognise(audio: Buffer, mimeType: string): Promise<RecognitionMatch | null> {
    if (!this.isConfigured()) {
      throw new ProviderError('not_configured', 'Music recognition is not configured on the server.', 503);
    }

    const form = new FormData();
    form.append('api_token', this.apiToken);
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), 'clip');
    form.append('return', 'apple_music,spotify');

    const res = await this.fetchImpl(API_URL, { method: 'POST', body: form });
    if (res.status === 429) throw rateLimited(res);
    if (!res.ok) throw new ProviderError('upstream', `Recognition request failed (${res.status}).`, 502);

    const json = (await res.json()) as {
      status?: string;
      result?: {
        artist?: string;
        title?: string;
        album?: string;
        release_date?: string;
        song_link?: string;
        apple_music?: {
          url?: string;
          artwork?: { url?: string };
          album?: { id?: string | number };
          previews?: Array<{ url?: string }>;
        };
        spotify?: {
          album?: { id?: string; images?: Array<{ url?: string; width?: number; height?: number }> };
          external_urls?: { spotify?: string };
          preview_url?: string;
        };
      } | null;
      error?: { error_code?: number; error_message?: string };
    };

    if (json.status === 'error') {
      if (json.error?.error_code === 901 || /no result/i.test(json.error?.error_message ?? '')) return null;
      throw new ProviderError('upstream', json.error?.error_message ?? 'Recognition failed.', 502);
    }
    if (!json.result || !json.result.title) return null;
    const r = json.result;

    // Pick highest-resolution cover art available.
    const spotifyImages = r.spotify?.album?.images ?? [];
    const spotifyCover = spotifyImages.reduce<{ url?: string; size: number }>(
      (best, img) => {
        const size = (img.width ?? 0) * (img.height ?? 0) || (img.width ?? 0);
        return size > best.size ? { url: img.url, size } : best;
      },
      { url: undefined, size: 0 },
    );
    const coverUrl = spotifyCover.url || r.apple_music?.artwork?.url;

    const previewUrl = r.spotify?.preview_url || r.apple_music?.previews?.[0]?.url;
    const appleMusicUrl = r.apple_music?.url || r.song_link || undefined;
    const spotifyUrl = r.spotify?.external_urls?.spotify;
    const albumId = r.spotify?.album?.id || (r.apple_music?.album?.id != null ? String(r.apple_music.album.id) : undefined);

    return {
      title: r.title ?? 'Unknown title',
      artist: r.artist ?? 'Unknown artist',
      album: r.album || undefined,
      releaseDate: r.release_date || undefined,
      songLink: r.song_link || undefined,
      coverUrl,
      albumId,
      previewUrl,
      appleMusicUrl,
      spotifyUrl,
    };
  }
}

function rateLimited(res: Response): ProviderError {
  const retry = Number(res.headers.get('retry-after'));
  return new ProviderError(
    'rate_limited',
    'Recognition provider is rate limiting requests. Please try again shortly.',
    429,
    Number.isFinite(retry) && retry > 0 ? retry : 60,
  );
}
