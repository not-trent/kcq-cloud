import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

/**
 * Streams `source` through ffmpeg and returns MP3 data. Lossless sources get 320 kbps CBR;
 * lossy sources use the highest-quality VBR setting to limit generational loss.
 */
export function convertToMp3(ffmpegPath: string, source: ReadableStream<Uint8Array>, lossless: boolean): Readable {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-map_metadata', '-1',
    ...(lossless ? ['-b:a', '320k'] : ['-q:a', '0']),
    '-f', 'mp3', 'pipe:1',
  ];
  const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  const input = Readable.fromWeb(source as import('node:stream/web').ReadableStream<Uint8Array>);
  input.on('error', () => proc.kill());
  proc.stdin.on('error', () => undefined);
  input.pipe(proc.stdin);
  proc.stdout.on('close', () => input.destroy());
  return proc.stdout;
}

export function isLossless(contentType?: string, filename?: string): boolean {
  return /audio\/(wav|x-wav|wave|flac|x-flac|aiff|x-aiff)/i.test(contentType ?? '') || /\.(wav|flac|aiff?)$/i.test(filename ?? '');
}
