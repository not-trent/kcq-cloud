import {
  ProviderError,
  type CatalogTrack,
  type DownloadStream,
  type MusicProvider,
  type SearchResult,
} from '../types.js';
import { SoundCloudClient } from './client.js';
import { toCatalogTrack, type RawSoundCloudTrack } from './mapper.js';
import { isSafeRedirectTarget, parseSoundCloudUrl } from './urls.js';

interface Paged<T> {
  collection?: T[];
  next_href?: string | null;
}

export class SoundCloudProvider implements MusicProvider {
  readonly id = 'soundcloud';
  readonly displayName = 'SoundCloud';

  constructor(private readonly client: SoundCloudClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async search(query: string, opts: { limit: number; offset: number }): Promise<SearchResult> {
    const page = await this.client.get<Paged<RawSoundCloudTrack> | RawSoundCloudTrack[]>('/tracks', {
      q: query,
      limit: opts.limit,
      offset: opts.offset,
      linked_partitioning: true,
      access: 'playable,preview',
    });
    const raw = Array.isArray(page) ? page : (page.collection ?? []);
    const items = raw.map(toCatalogTrack).filter((t): t is CatalogTrack => t !== null);
    const hasNext = !Array.isArray(page) && Boolean(page.next_href);
    return { items, nextOffset: hasNext ? opts.offset + opts.limit : undefined };
  }

  async resolveUrl(url: string): Promise<CatalogTrack> {
    const parsed = parseSoundCloudUrl(url);
    if (!parsed) throw new ProviderError('unsupported_url', 'That is not a SoundCloud link.', 400);

    let pageUrl = parsed.url;
    if (parsed.isShortLink) pageUrl = await this.expandShortLink(parsed.url);

    const raw = await this.client.resolve<RawSoundCloudTrack>(pageUrl);
    if (raw.kind !== 'track') {
      throw new ProviderError('unsupported_resource', 'Only SoundCloud track links are supported (not playlists or profiles).', 422);
    }
    const track = toCatalogTrack(raw);
    if (!track) throw new ProviderError('upstream', 'SoundCloud returned incomplete track data.', 502);
    return track;
  }

  async getTrack(id: string): Promise<CatalogTrack> {
    const raw = await this.fetchRaw(id);
    const track = toCatalogTrack(raw);
    if (!track) throw new ProviderError('upstream', 'SoundCloud returned incomplete track data.', 502);
    return track;
  }

  /** Availability is re-checked against SoundCloud on every call; client-side state is never trusted. */
  async openDownload(id: string, range?: string): Promise<DownloadStream> {
    const raw = await this.fetchRaw(id);
    const track = toCatalogTrack(raw);
    if (!track || track.download.status !== 'available' || !raw.download_url) {
      throw new ProviderError(
        'not_downloadable',
        track?.download.status === 'unavailable' ? track.download.message : 'This track cannot be downloaded.',
        403,
      );
    }
    const res = await this.client.openDownload(raw.download_url, range);
    return {
      status: res.status === 206 ? 206 : 200,
      headers: {
        contentType: res.headers.get('content-type') ?? undefined,
        contentLength: res.headers.get('content-length') ?? undefined,
        contentRange: res.headers.get('content-range') ?? undefined,
        acceptRanges: res.headers.get('accept-ranges') ?? undefined,
        filename: filenameFrom(res.headers.get('content-disposition')),
      },
      body: res.body,
    };
  }

  private fetchRaw(id: string): Promise<RawSoundCloudTrack> {
    return this.client.get<RawSoundCloudTrack>(`/tracks/${encodeURIComponent(id)}`);
  }

  private async expandShortLink(url: string): Promise<string> {
    const res = await fetch(url, { redirect: 'manual' });
    const location = res.headers.get('location');
    await res.body?.cancel();
    const parsed = location && isSafeRedirectTarget(location) ? parseSoundCloudUrl(location) : null;
    if (!parsed || parsed.isShortLink) {
      throw new ProviderError('unsupported_url', 'That SoundCloud short link could not be expanded.', 400);
    }
    return parsed.url;
  }
}

function filenameFrom(disposition: string | null): string | undefined {
  if (!disposition) return undefined;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (!m?.[1]) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
