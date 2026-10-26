import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { loadConfig } from '../src/config.js';

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/m4a',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
};

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npm run test:recognise -- path/to/audio-file');
  process.exit(1);
}

const config = loadConfig();
const port = config.PORT;
const apiKey = config.APP_API_KEY;

let audio: Buffer;
try {
  audio = readFileSync(filePath);
} catch (err) {
  console.error(`Could not read file: ${filePath}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const ext = extname(filePath).toLowerCase();
const mimeType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
const audioBase64 = audio.toString('base64');

const url = `http://localhost:${port}/v1/recognise`;
const headers: Record<string, string> = { 'content-type': 'application/json' };
if (apiKey) headers['x-api-key'] = apiKey;

console.log(`File:      ${filePath}`);
console.log(`Size:      ${audio.byteLength} bytes`);
console.log(`MIME:      ${mimeType}`);
console.log(`Endpoint:  ${url}`);
console.log('Sending...');

try {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ audio: audioBase64, mimeType }),
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }

  console.log(`Status:    ${res.status}`);
  console.log('Response:');
  console.log(JSON.stringify(body, null, 2));

  const b = body as { match?: { title?: string; artist?: string; album?: string }; error?: string; message?: string };
  if (res.ok && b?.match) {
    console.log('');
    console.log(`Matched: ${b.match.title ?? '?'} — ${b.match.artist ?? '?'}` +
      (b.match.album ? ` (${b.match.album})` : ''));
  } else if (!res.ok) {
    console.log('');
    console.log(`Error: ${b?.error ?? 'unknown'} — ${b?.message ?? text}`);
  }
} catch (err) {
  console.error('Network error:', err instanceof Error ? err.message : String(err));
  console.error('Is the server running? Start it with: npm run dev');
  process.exit(1);
}
