import type { CatalogTrack, DownloadAvailability, ReleaseKind } from '../types.js';

export interface RawSoundCloudTrack {
  kind?: string;
  id?: number | string;
  urn?: string;
  title?: string;
  duration?: number;
  artwork_url?: string | null;
  permalink_url?: string;
  genre?: string | null;
  license?: string | null;
  isrc?: string | null;
  metadata_artist?: string | null;
  release_year?: number | null;
  created_at?: string | null;
  tag_list?: string | null;
  downloadable?: boolean;
  download_url?: string | null;
  access?: 'playable' | 'preview' | 'blocked' | string;
  streamable?: boolean;
  user?: { username?: string; permalink_url?: string } | null;
}

const MIX_MIN_MS = 20 * 60 * 1000;

/** Heuristic only: SoundCloud has no "remix"/"mix" flag, so this is used for display grouping, never for policy. */
export function classifyKind(raw: RawSoundCloudTrack): ReleaseKind {
  const title = raw.title ?? '';
  const tags = raw.tag_list ?? '';
  if ((raw.duration ?? 0) >= MIX_MIN_MS || /\b(dj\s*mix|mixtape|live set|dj set|podcast)\b/i.test(`${title} ${tags}`)) return 'mix';
  if (/\b(remix|bootleg|rework|flip|vip)\b/i.test(title)) return 'remix';
  return 'song';
}

export function availabilityOf(raw: RawSoundCloudTrack): DownloadAvailability {
  if (raw.access === 'blocked') {
    return {
      status: 'unavailable',
      reason: 'blocked',
      message: 'SoundCloud does not allow access to this track in your region or for third-party apps.',
    };
  }
  if (raw.downloadable) {
    if (raw.download_url) return { status: 'available' };
    return {
      status: 'unavailable',
      reason: 'blocked',
      message: 'The creator enabled downloads, but SoundCloud did not give this integration access to the file.',
    };
  }
  if (raw.access === 'preview') {
    return {
      status: 'unavailable',
      reason: 'preview_only',
      message: 'Only a preview of this track is available, and the creator has not enabled downloads.',
    };
  }
  return {
    status: 'unavailable',
    reason: 'streaming_only',
    message: 'The creator has not enabled downloads for this track. You can listen to it on SoundCloud.',
  };
}

export function upscaleArtwork(url?: string | null): string | undefined {
  if (!url) return undefined;
  return url.replace(/-(large|t\d+x\d+|crop|small|tiny|badge|mini)\.(jpg|png|jpeg)/i, '-t500x500.$2');
}

export function toCatalogTrack(raw: RawSoundCloudTrack): CatalogTrack | null {
  const id = raw.urn ?? (raw.id !== undefined ? String(raw.id) : undefined);
  if (!id || !raw.title || !raw.permalink_url) return null;
  const year = raw.release_year ?? (raw.created_at ? new Date(raw.created_at).getUTCFullYear() : undefined);
  return {
    provider: 'soundcloud',
    id,
    title: raw.title.trim(),
    artist: (raw.metadata_artist || raw.user?.username || 'Unknown artist').trim(),
    durationMs: raw.duration ?? 0,
    artworkUrl: upscaleArtwork(raw.artwork_url),
    permalinkUrl: raw.permalink_url,
    genre: raw.genre || undefined,
    releaseYear: year && Number.isFinite(year) ? year : undefined,
    license: raw.license || undefined,
    isrc: raw.isrc || undefined,
    kind: classifyKind(raw),
    download: availabilityOf(raw),
    attribution: { providerName: 'SoundCloud', creatorUrl: raw.user?.permalink_url },
  };
}
