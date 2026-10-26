import type { CatalogTrack, MusicProvider } from './providers/types.js';

export interface UnifiedTrack {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  previewUrl?: string;
  source: 'deezer' | 'itunes' | 'soundcloud';
  sourceUrl?: string;
  downloadable: boolean;
  // Back-compat fields for SoundCloud tracks
  provider?: string;
  id?: string;
  download?: CatalogTrack['download'];
  durationMs?: number;
  genre?: string;
  releaseYear?: number;
  license?: string;
  isrc?: string;
  attribution?: CatalogTrack['attribution'];
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function key(t: UnifiedTrack): string {
  return `${norm(t.title)}::${norm(t.artist)}`;
}

async function searchDeezer(query: string, limit: number): Promise<UnifiedTrack[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{
        title?: string;
        title_short?: string;
        artist?: { name?: string };
        album?: { title?: string; cover_medium?: string; cover_big?: string; cover_xl?: string };
        preview?: string;
        link?: string;
      }>;
    };
    return (json.data ?? []).map((d) => ({
      title: d.title ?? d.title_short ?? 'Unknown',
      artist: d.artist?.name ?? 'Unknown',
      album: d.album?.title,
      coverUrl: d.album?.cover_xl || d.album?.cover_big || d.album?.cover_medium,
      previewUrl: d.preview,
      source: 'deezer' as const,
      sourceUrl: d.link,
      downloadable: false,
      download: { status: 'unavailable', reason: 'preview_only', message: 'Preview only (Deezer).' },
    }));
  } catch {
    return [];
  }
}

async function searchItunes(query: string, limit: number): Promise<UnifiedTrack[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=${limit}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: Array<{
        trackName?: string;
        artistName?: string;
        collectionName?: string;
        artworkUrl100?: string;
        previewUrl?: string;
        trackViewUrl?: string;
      }>;
    };
    return (json.results ?? []).map((r) => {
      const cover = r.artworkUrl100?.replace(/100x100bb/, '600x600bb');
      return {
        title: r.trackName ?? 'Unknown',
        artist: r.artistName ?? 'Unknown',
        album: r.collectionName,
        coverUrl: cover,
        previewUrl: r.previewUrl,
        source: 'itunes' as const,
        sourceUrl: r.trackViewUrl,
        downloadable: false,
        download: { status: 'unavailable', reason: 'preview_only', message: 'Preview only (iTunes).' },
      };
    });
  } catch {
    return [];
  }
}

async function searchSoundCloud(query: string, registry: { get(id: string): MusicProvider | undefined; list(): MusicProvider[] }, limit: number): Promise<UnifiedTrack[]> {
  try {
    const provider = registry.get('soundcloud');
    if (!provider || !provider.isConfigured()) return [];
    const result = await provider.search(query, { limit, offset: 0 });
    return result.items.map((t) => ({
      title: t.title,
      artist: t.artist,
      album: undefined,
      coverUrl: t.artworkUrl,
      previewUrl: undefined,
      source: 'soundcloud' as const,
      sourceUrl: t.permalinkUrl,
      downloadable: t.download.status === 'available',
      provider: t.provider,
      id: t.id,
      download: t.download,
      durationMs: t.durationMs,
      genre: t.genre,
      releaseYear: t.releaseYear,
      license: t.license,
      isrc: t.isrc,
      attribution: t.attribution,
    }));
  } catch {
    return [];
  }
}

export async function unifiedSearch(
  query: string,
  registry: { get(id: string): MusicProvider | undefined; list(): MusicProvider[] },
  limit = 20,
): Promise<UnifiedTrack[]> {
  const [deezer, itunes, soundcloud] = await Promise.all([
    searchDeezer(query, limit),
    searchItunes(query, limit),
    searchSoundCloud(query, registry, limit),
  ]);

  const map = new Map<string, UnifiedTrack>();
  // Add non-SoundCloud first
  for (const t of [...deezer, ...itunes]) {
    const k = key(t);
    if (!map.has(k)) map.set(k, t);
  }
  // SoundCloud: replace if downloadable
  for (const t of soundcloud) {
    const k = key(t);
    const existing = map.get(k);
    if (!existing) {
      map.set(k, t);
    } else if (t.downloadable) {
      map.set(k, t);
    }
  }

  return Array.from(map.values()).slice(0, limit * 2);
}

export function soundCloudTrackToUnified(t: CatalogTrack): UnifiedTrack {
  return {
    title: t.title,
    artist: t.artist,
    album: undefined,
    coverUrl: t.artworkUrl,
    previewUrl: undefined,
    source: 'soundcloud',
    sourceUrl: t.permalinkUrl,
    downloadable: t.download.status === 'available',
    provider: t.provider,
    id: t.id,
    download: t.download,
    durationMs: t.durationMs,
    genre: t.genre,
    releaseYear: t.releaseYear,
    license: t.license,
    isrc: t.isrc,
    attribution: t.attribution,
  };
}