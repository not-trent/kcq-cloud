import type { CatalogTrack, MusicProvider } from './providers/types.js';

export type SourceClassification =
  | 'authorised_download'
  | 'purchase_required'
  | 'streaming_only'
  | 'download_rights_unverified'
  | 'download_prohibited';

export interface UnifiedTrack {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  previewUrl?: string;
  source: string;
  sourceName?: string;
  sourceUrl?: string;
  downloadable: boolean;
  classification?: SourceClassification;
  format?: string;
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

function normText(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripDecorations(s: string): string {
  let t = s;
  t = t.replace(/[\(\[][^)\]]*[\)\]]/g, (m) => {
    if (/feat|ft\.?|remaster|explicit|deluxe|bonus|anniversary|edition/i.test(m)) return '';
    return m;
  });
  t = t.replace(/\b(feat|ft)\.?\s+[a-z0-9][a-z0-9 &,'-]*/gi, '');
  return t;
}

function dedupKey(t: UnifiedTrack): string {
  const title = normText(stripDecorations(t.title));
  const artist = normText(stripDecorations(t.artist));
  return `${title}::${artist}`;
}

function queryWords(q: string): string[] {
  return normText(q).split(' ').filter(Boolean);
}

function score(t: UnifiedTrack, qWords: string[], qNorm: string): number {
  const title = normText(t.title);
  const artist = normText(t.artist);
  let s = 0;
  if (title === qNorm) s += 100;
  if (qNorm.length > 0 && title.includes(qNorm)) s += 50;
  for (const w of qWords) {
    if (title.includes(w)) s += 10;
    if (artist.includes(w)) s += 5;
  }
  if (artist === qNorm) s += 25;
  return s;
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
      source: 'deezer',
      sourceName: 'Deezer',
      sourceUrl: d.link,
      downloadable: false,
      classification: 'streaming_only',
      format: 'Preview',
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
        source: 'itunes',
        sourceName: 'iTunes',
        sourceUrl: r.trackViewUrl,
        downloadable: false,
        classification: 'purchase_required',
        format: 'Preview',
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
      source: 'soundcloud',
      sourceName: 'SoundCloud',
      sourceUrl: t.permalinkUrl,
      downloadable: t.download.status === 'available',
      classification: t.download.status === 'available' ? 'authorised_download' : 'streaming_only',
      format: t.download.status === 'available' ? t.download.originalFormat ?? 'Original' : 'Stream',
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
  const [deezer, itunes, soundcloud, archive, wikimedia] = await Promise.all([
    searchDeezer(query, limit),
    searchItunes(query, limit),
    searchSoundCloud(query, registry, limit),
    searchArchive(query, Math.min(limit, 10)),
    searchWikimedia(query, Math.min(limit, 10)),
  ]);

  const qWords = queryWords(query);
  const qNorm = normText(query);

  const discovery = discoveryEntries(query);

  const all = [...deezer, ...itunes, ...soundcloud, ...archive, ...wikimedia, ...discovery].filter((t) => {
    if (t.source === 'spotify' || t.source === 'apple-music' || t.source === 'itunes-store' || t.source === 'amazon-music' || t.source === 'bandcamp' || t.source === 'tidal' || t.source === 'qobuz' || t.source === 'youtube-music' || t.source === 'soundcloud-search' || t.source === 'jamendo' || t.source === 'free-music-archive' || t.source === 'ccmixter' || t.source === 'archive-search' || t.source === 'mp3juices' || t.source === 'mp3download') {
      return true;
    }
    const title = normText(t.title);
    const artist = normText(t.artist);
    return qWords.some((w) => title.includes(w) || artist.includes(w));
  });

  const discoverySources = new Set([
    'spotify', 'apple-music', 'itunes-store', 'amazon-music', 'bandcamp', 'tidal',
    'qobuz', 'youtube-music', 'soundcloud-search', 'jamendo', 'free-music-archive',
    'ccmixter', 'archive-search', 'mp3juices', 'mp3download',
  ]);
  const isDiscovery = (t: UnifiedTrack) => discoverySources.has(t.source);

  const realTracks = all.filter((t) => !isDiscovery(t));
  const discoveryTracks = all.filter((t) => isDiscovery(t));

  const map = new Map<string, UnifiedTrack>();
  // Non-SoundCloud real tracks first (first wins on dedup key).
  for (const t of realTracks.filter((t) => t.source !== 'soundcloud')) {
    const k = dedupKey(t);
    if (!map.has(k)) map.set(k, t);
  }
  // SoundCloud: replace when downloadable (creator-enabled).
  for (const t of realTracks.filter((t) => t.source === 'soundcloud')) {
    const k = dedupKey(t);
    const existing = map.get(k);
    if (!existing || t.downloadable) map.set(k, t);
  }
  // Discovery links stay distinct (one per source/site).
  for (const t of discoveryTracks) {
    const k = `discovery::${t.source}::${t.sourceUrl ?? t.title}`;
    if (!map.has(k)) map.set(k, t);
  }

  const scored = Array.from(map.values()).map((t) => ({
    t,
    s: isDiscovery(t) ? 0 : score(t, qWords, qNorm),
  }));
  scored.sort((a, b) => b.s - a.s || a.t.title.localeCompare(b.t.title));
  return scored.map((x) => x.t).slice(0, limit * 3);
}

function discoveryEntries(query: string): UnifiedTrack[] {
  const q = encodeURIComponent(query);
  const entries: Array<{ source: string; sourceName: string; classification: SourceClassification; format: string; url: string }> = [
    { source: 'spotify', sourceName: 'Spotify', classification: 'download_prohibited', format: 'DRM stream', url: `https://open.spotify.com/search/${q}` },
    { source: 'apple-music', sourceName: 'Apple Music', classification: 'download_prohibited', format: 'DRM stream', url: `https://music.apple.com/search?term=${q}` },
    { source: 'itunes-store', sourceName: 'iTunes Store', classification: 'purchase_required', format: 'Purchase', url: `https://music.apple.com/search?term=${q}` },
    { source: 'amazon-music', sourceName: 'Amazon Music', classification: 'purchase_required', format: 'Purchase', url: `https://music.amazon.com/search/${q}` },
    { source: 'bandcamp', sourceName: 'Bandcamp', classification: 'purchase_required', format: 'Purchase / stream', url: `https://bandcamp.com/search?q=${q}` },
    { source: 'tidal', sourceName: 'Tidal', classification: 'streaming_only', format: 'Stream', url: `https://tidal.com/search?q=${q}` },
    { source: 'qobuz', sourceName: 'Qobuz', classification: 'purchase_required', format: 'Purchase', url: `https://www.qobuz.com/search?q=${q}` },
    { source: 'youtube-music', sourceName: 'YouTube Music', classification: 'download_prohibited', format: 'DRM stream', url: `https://music.youtube.com/search?q=${q}` },
    { source: 'soundcloud-search', sourceName: 'SoundCloud search', classification: 'download_rights_unverified', format: 'Unknown', url: `https://soundcloud.com/search?q=${q}` },
    { source: 'jamendo', sourceName: 'Jamendo', classification: 'authorised_download', format: 'Licensed MP3', url: `https://www.jamendo.com/search?query=${q}` },
    { source: 'free-music-archive', sourceName: 'Free Music Archive', classification: 'download_rights_unverified', format: 'Licensed MP3', url: `https://freemusicarchive.org/search/?quicksearch=${q}` },
    { source: 'ccmixter', sourceName: 'ccMixter', classification: 'authorised_download', format: 'CC MP3', url: `https://ccmixter.org/search?search_text=${q}` },
    { source: 'archive-search', sourceName: 'Internet Archive', classification: 'download_rights_unverified', format: 'Archive audio', url: `https://archive.org/search?query=${q}&and[]=mediatype%3A%22audio%22` },
    { source: 'mp3juices', sourceName: 'Public MP3 index', classification: 'download_rights_unverified', format: 'MP3 (unverified)', url: `https://www.mp3juices.cc/search/${q}` },
    { source: 'mp3download', sourceName: 'Public MP3 index', classification: 'download_rights_unverified', format: 'MP3 (unverified)', url: `https://mp3download.to/search/${q}` },
  ];
  return entries.map((e) => ({
    title: query,
    artist: 'Unknown',
    source: e.source,
    sourceName: e.sourceName,
    sourceUrl: e.url,
    downloadable: false,
    classification: e.classification,
    format: e.format,
  }));
}

async function searchArchive(query: string, limit: number): Promise<UnifiedTrack[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`mediatype:audio AND (${query})`)}&fl[]=identifier,title,creator,licenseurl&rows=${limit}&output=json`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const json = (await res.json()) as { response?: { docs?: Array<{ identifier?: string; title?: string | string[]; creator?: string | string[] }> } };
    return (json.response?.docs ?? []).map((d) => {
      const title = Array.isArray(d.title) ? d.title[0] ?? 'Unknown' : d.title ?? 'Unknown';
      const creator = Array.isArray(d.creator) ? d.creator[0] ?? 'Unknown' : d.creator ?? 'Unknown';
      const id = d.identifier ?? '';
      return {
        title,
        artist: creator,
        source: 'archive.org',
        sourceName: 'Internet Archive',
        sourceUrl: id ? `https://archive.org/details/${encodeURIComponent(id)}` : undefined,
        downloadable: false,
        classification: 'download_rights_unverified',
        format: 'Archive audio',
      };
    });
  } catch {
    return [];
  }
}

async function searchWikimedia(query: string, limit: number): Promise<UnifiedTrack[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=${limit}&format=json&origin=*`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const json = (await res.json()) as { query?: { search?: Array<{ title?: string }> } };
    return (json.query?.search ?? []).map((r) => {
      const rawTitle = r.title ?? 'Unknown';
      const title = rawTitle.replace(/^File:/i, '').replace(/\\.[a-z0-9]{2,5}$/i, '');
      return {
        title: title || rawTitle,
        artist: 'Wikimedia Commons contributor',
        source: 'wikimedia-commons',
        sourceName: 'Wikimedia Commons',
        sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(rawTitle)}`,
        downloadable: false,
        classification: 'authorised_download',
        format: 'CC / public domain',
      };
    });
  } catch {
    return [];
  }
}

export function soundCloudTrackToUnified(t: CatalogTrack): UnifiedTrack {
  return {
    title: t.title,
    artist: t.artist,
    album: undefined,
    coverUrl: t.artworkUrl,
    previewUrl: undefined,
    source: 'soundcloud',
    sourceName: 'SoundCloud',
    sourceUrl: t.permalinkUrl,
    downloadable: t.download.status === 'available',
    classification: t.download.status === 'available' ? 'authorised_download' : 'streaming_only',
    format: t.download.status === 'available' ? t.download.originalFormat ?? 'Original' : 'Stream',
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