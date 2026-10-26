import { Directory, File, Paths } from 'expo-file-system';
import { authHeaders, downloadUrl, type Track } from '@/lib/api';
import { library, trackKey } from '@/store/library';

/** Downloads live in the app's document directory so the system never evicts them. */
export const downloadsDirectory = new Directory(Paths.document, 'downloads');

/**
 * Streams a track through the SoundCatch server into the downloads directory.
 * The server decides whether a download is allowed; this function never guesses.
 */
export async function downloadTrack(track: Track, format: 'original' | 'mp3' = 'original'): Promise<void> {
  const key = trackKey(track);
  library.startDownload(track);
  try {
    if (!downloadsDirectory.exists) downloadsDirectory.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(downloadUrl(track, format), downloadsDirectory, {
      headers: authHeaders(),
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        library.updateProgress(key, totalBytes > 0 ? bytesWritten / totalBytes : 0);
      },
    });
    library.finishDownload(key, {
      fileUri: file.uri,
      fileName: file.name,
      sizeBytes: safeSize(file),
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
