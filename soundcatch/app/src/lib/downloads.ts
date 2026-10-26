import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { authHeaders, downloadUrl, type Track } from '@/lib/api';
import { embedMetadata } from '@/lib/metadata';
import { library, trackKey } from '@/store/library';

export interface DownloadOptions {
  directory?: Directory;
  fileName?: string;
  metadata?: boolean;
}

export const downloadsDirectory = new Directory(Paths.document, 'downloads');

export async function downloadTrack(
  track: Track,
  format: 'original' | 'mp3' = 'original',
  options: DownloadOptions = {},
): Promise<void> {
  const key = trackKey(track);

  library.startDownload(track);
  try {
    const dir = options.directory ?? downloadsDirectory;
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(downloadUrl(track, format), dir, {
      headers: authHeaders(),
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        library.updateProgress(key, totalBytes > 0 ? bytesWritten / totalBytes : 0);
      },
    });

    let saved: File = file;
    if (options.fileName && file.name !== options.fileName) {
      const target = new File(dir, options.fileName);
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

    if (options.metadata !== false && saved.name.toLowerCase().endsWith('.mp3')) {
      await embedMetadata(saved, track);
    }

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
