import { File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { ID3Writer, ImageType } from 'browser-id3-writer';
import type { Track } from '@/lib/api';

export async function embedMetadata(file: File, track: Track): Promise<void> {
  if (!file.name.toLowerCase().endsWith('.mp3')) return;
  try {
    const base64 = await FileSystem.readAsStringAsync(file.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const writer = new ID3Writer(base64ToArrayBuffer(base64));
    writer.setFrame('TIT2', track.title);
    writer.setFrame('TPE1', [track.artist]);
    if (track.album) writer.setFrame('TALB', track.album);
    if (track.artist) writer.setFrame('TPE2', track.artist);
    if (track.genre) writer.setFrame('TCON', [track.genre]);
    if (track.releaseYear) writer.setFrame('TYER', track.releaseYear);
    if (track.isrc) writer.setFrame('TSRC', track.isrc);

    if (track.artworkUrl) {
      try {
        const artFile = new File(Paths.cache, `soundcatch-cover-${Date.now()}.jpg`);
        await FileSystem.downloadAsync(track.artworkUrl, artFile.uri);
        const artBase64 = await FileSystem.readAsStringAsync(artFile.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        writer.setFrame('APIC', {
          type: ImageType.CoverFront,
          data: base64ToArrayBuffer(artBase64),
          description: 'Cover',
        });
        try {
          if (artFile.exists) artFile.delete();
        } catch {
          // Ignore cleanup failures.
        }
      } catch {
        // Artwork embedding is best-effort.
      }
    }

    const tagged = writer.addTag();
    await FileSystem.writeAsStringAsync(file.uri, arrayBufferToBase64(tagged), {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    // Metadata embedding must never turn a successful download into a failure.
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
