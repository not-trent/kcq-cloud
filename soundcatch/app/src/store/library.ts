import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';
import type { Track } from '@/lib/api';

export const trackKey = (track: Pick<Track, 'provider' | 'id'>): string => `${track.provider}:${track.id}`;

export type DownloadStatus = 'downloading' | 'complete' | 'failed';

export interface DownloadRecord {
  key: string;
  track: Track;
  status: DownloadStatus;
  /** 0..1, or 0 while the server has not reported a total size. */
  progress: number;
  fileUri?: string;
  fileName?: string;
  sizeBytes?: number;
  downloadedAt?: number;
  error?: string;
}

export interface LibraryState {
  hydrated: boolean;
  favourites: Track[];
  history: Track[];
  downloads: DownloadRecord[];
  recentSearches: string[];
}

const initialState: LibraryState = {
  hydrated: false,
  favourites: [],
  history: [],
  downloads: [],
  recentSearches: [],
};

let state: LibraryState = initialState;
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): LibraryState {
  return state;
}

/** The whole library is small enough that re-rendering on any change is fine. */
export function useLibrary(): LibraryState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isFavourite(track: Pick<Track, 'provider' | 'id'>, from: LibraryState = state): boolean {
  const key = trackKey(track);
  return from.favourites.some((item) => trackKey(item) === key);
}

export function findDownload(key: string, from: LibraryState = state): DownloadRecord | undefined {
  return from.downloads.find((item) => item.key === key);
}

export const totalDownloadBytes = (from: LibraryState = state): number =>
  from.downloads.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);

function commit(patch: Partial<LibraryState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
  scheduleSave();
}

export const library = {
  toggleFavourite(track: Track): void {
    const key = trackKey(track);
    const exists = state.favourites.some((item) => trackKey(item) === key);
    commit({
      favourites: exists ? state.favourites.filter((item) => trackKey(item) !== key) : [track, ...state.favourites],
    });
  },

  addHistory(track: Track): void {
    const key = trackKey(track);
    commit({ history: [track, ...state.history.filter((item) => trackKey(item) !== key)].slice(0, 50) });
  },

  clearHistory(): void {
    commit({ history: [] });
  },

  addRecentSearch(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    commit({
      recentSearches: [trimmed, ...state.recentSearches.filter((item) => item !== trimmed)].slice(0, 8),
    });
  },

  clearRecentSearches(): void {
    commit({ recentSearches: [] });
  },

  startDownload(track: Track): void {
    const key = trackKey(track);
    const started: DownloadRecord = { key, track, status: 'downloading', progress: 0 };
    commit({ downloads: [started, ...state.downloads.filter((item) => item.key !== key)] });
  },

  updateProgress(key: string, progress: number): void {
    const downloads = state.downloads.map((item) =>
      item.key === key && item.status === 'downloading'
        ? { ...item, progress: Math.max(0, Math.min(1, progress)) }
        : item,
    );
    commit({ downloads });
  },

  finishDownload(key: string, file: { fileUri: string; fileName: string; sizeBytes?: number }): void {
    const downloads = state.downloads.map((item) =>
      item.key === key
        ? { ...item, status: 'complete' as const, progress: 1, ...file, downloadedAt: Date.now(), error: undefined }
        : item,
    );
    commit({ downloads });
  },

  failDownload(key: string, error: string): void {
    const downloads = state.downloads.map((item) => (item.key === key ? { ...item, status: 'failed' as const, error } : item));
    commit({ downloads });
  },

  removeDownload(key: string): void {
    const record = state.downloads.find((item) => item.key === key);
    if (record?.fileUri) {
      try {
        const file = new File(record.fileUri);
        if (file.exists) file.delete();
      } catch {
        // A missing file means the record is the only thing left to remove.
      }
    }
    commit({ downloads: state.downloads.filter((item) => item.key !== key) });
  },
};

const storageFile = (): File => new File(Paths.document, 'soundcatch-library.json');

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(): void {
  if (!state.hydrated) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 300);
}

async function persist(): Promise<void> {
  try {
    const file = storageFile();
    if (!file.exists) file.create({ intermediates: true });
    await file.write(
      JSON.stringify({
        favourites: state.favourites,
        history: state.history,
        downloads: state.downloads,
        recentSearches: state.recentSearches,
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Losing a persistence write must never break the running app.
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function hydrate(): Promise<void> {
  let next: LibraryState = { ...initialState, hydrated: true };
  try {
    const file = storageFile();
    if (file.exists) {
      const raw = JSON.parse(await file.text()) as Record<string, unknown>;
      const downloads = asArray<DownloadRecord>(raw.downloads).filter(
        (item) =>
          item.status !== 'complete' || (typeof item.fileUri === 'string' && safeExists(item.fileUri)),
      );
      next = {
        hydrated: true,
        favourites: asArray<Track>(raw.favourites),
        history: asArray<Track>(raw.history),
        downloads,
        recentSearches: asArray<string>(raw.recentSearches),
      };
    }
  } catch {
    next = { ...initialState, hydrated: true };
  }
  state = next;
  for (const listener of listeners) listener();
}

function safeExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

void hydrate();
