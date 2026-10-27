import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { authHeaders, downloadUrl, type Track } from '@/lib/api';
import { embedMetadata } from '@/lib/metadata';
import { library, trackKey, getSnapshot } from '@/store/library';
const { StorageAccessFramework } = FileSystem;

export interface DownloadOptions {
  directory?: Directory;
  fileName?: string;
  metadata?: boolean;
}

function sanitizeSegment(value: string | undefined): string {
  const cleaned = (value ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  return cleaned || 'Unknown';
}

async function ensureSharedDirectory(track: Track): Promise<string | null> {
  let rootUri = getSnapshot().sharedStorageUri;
  if (!rootUri) {
    try {
      const initial = StorageAccessFramework.getUriForDirectoryInRoot('Music');
      const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync(initial);
      if (!permission.granted) return null;
      rootUri = permission.directoryUri;
      library.setSharedStorageUri(rootUri);
    } catch {
      return null;
    }
  }
  if (!rootUri) return null;

  const createChild = async (parent: string, name: string): Promise<string> => {
    try {
      return await StorageAccessFramework.makeDirectoryAsync(parent, name);
    } catch {
      const entries = await StorageAccessFramework.readDirectoryAsync(parent);
      const match = entries.find((entry) => {
        try {
          return decodeURIComponent(entry).toLowerCase().includes(name.toLowerCase());
        } catch {
          return entry.toLowerCase().includes(name.toLowerCase());
        }
      });
      if (match) return match;
      throw new Error(`Unable to create or find directory ${name}`);
    }
  };

  try {
    let current = rootUri;
    current = await createChild(current, 'SoundCatch');
    current = await createChild(current, sanitizeSegment(track.artist));
    current = await createChild(current, sanitizeSegment(track.album || 'Singles'));
    return current;
  } catch {
    return null;
  }
}

async function exportToSharedStorage(track: Track, sourceFile: File): Promise<void> {
  const leaf = await ensureSharedDirectory(track);
  if (!leaf) return;
  const fileName = `${sanitizeSegment(track.artist)} - ${sanitizeSegment(track.title)}.mp3`;
  try {
    const targetUri = await StorageAccessFramework.createFileAsync(leaf, fileName, 'audio/mpeg');
    await FileSystem.copyAsync({ from: sourceFile.uri, to: targetUri });
  } catch {
    // Shared export is best-effort and must not break the download.
  }
}

export const downloadsDirectory = new Directory(Paths.document, 'downloads');

export async function exportFileToSharedDownloads(file: File): Promise<boolean> {
  let rootUri = getSnapshot().sharedStorageUri;
  // Reuse a separate persisted URI? Store in same field is for Music; for Downloads use a dedicated file.
  // For simplicity, request Downloads root each time if not cached in module scope.
  try {
    const initial = StorageAccessFramework.getUriForDirectoryInRoot('Download');
    const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync(initial);
    if (!permission.granted) return false;
    rootUri = permission.directoryUri;
  } catch {
    return false;
  }
  if (!rootUri) return false;

  const createChild = async (parent: string, name: string): Promise<string> => {
    try {
      return await StorageAccessFramework.makeDirectoryAsync(parent, name);
    } catch {
      const entries = await StorageAccessFramework.readDirectoryAsync(parent);
      const match = entries.find((entry) => {
        try {
          return decodeURIComponent(entry).toLowerCase().includes(name.toLowerCase());
        } catch {
          return entry.toLowerCase().includes(name.toLowerCase());
        }
      });
      if (match) return match;
      throw new Error(`Unable to create or find directory ${name}`);
    }
  };

  try {
    const leaf = await createChild(rootUri, 'SoundCatch');
    let targetName = file.name;
    try {
      const existing = await StorageAccessFramework.readDirectoryAsync(leaf);
      const names = existing.map((u) => decodeURIComponent(u).split('/').pop() ?? '');
      if (names.includes(targetName)) {
        const base = targetName.replace(/\.zip$/i, '');
        targetName = `${base}-${Date.now()}.zip`;
      }
    } catch {
      // Ignore directory read failures.
    }
    const targetUri = await StorageAccessFramework.createFileAsync(leaf, targetName, 'application/zip');
    await FileSystem.copyAsync({ from: file.uri, to: targetUri });
    return true;
  } catch {
    return false;
  }
}

export async function downloadTrack(
  track: Track,
  format: 'original' | 'mp3' = 'original',
  options: DownloadOptions = {},
): Promise<void> {
  const key = trackKey(track);
  const preferredName = options.fileName ?? `${sanitizeSegment(track.artist)} - ${sanitizeSegment(track.title)}.mp3`;
  const opts = { ...options, fileName: preferredName };

  library.startDownload(track);
  try {
    const dir = opts.directory ?? downloadsDirectory;
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(downloadUrl(track, format), dir, {
      headers: authHeaders(),
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        library.updateProgress(key, totalBytes > 0 ? bytesWritten / totalBytes : 0);
      },
    });

    let saved: File = file;
    if (opts.fileName && file.name !== opts.fileName) {
      const target = new File(dir, opts.fileName);
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await FileSystem.writeAsStringAsync(target.uri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      try {
        if (file.exists) file.delete();
      } catch {
        // Best-effort cleanup of the original server-named file.
      }
      saved = target;
    }

    if (opts.metadata !== false && saved.name.toLowerCase().endsWith('.mp3')) {
      await embedMetadata(saved, track);
    }

    void exportToSharedStorage(track, saved);

    library.finishDownload(key, {
      fileUri: saved.uri,
      fileName: saved.name,
      sizeBytes: safeSize(saved),
    });
  } catch (error) {
    library.failDownload(key, describeDownloadError(error));
  }
}

function safeSize(file: File): number | undefined {
  try {
    return file.size;
  } catch {
    return undefined;
  }
}

function describeDownloadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\b401\b/.test(message)) return 'The server rejected this request. Check the app API key.';
  if (/\b403\b/.test(message)) return 'This track cannot be downloaded — the creator has not enabled it.';
  if (/\b404\b/.test(message)) return 'The track is no longer available on SoundCloud.';
  if (/\b429\b/.test(message)) return 'Too many downloads right now. Try again in a minute.';
  if (/AbortError/.test(message)) return 'The download was cancelled.';
  return 'The download failed. Check the connection to the server and try again.';
}
