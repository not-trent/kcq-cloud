import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { SoundCloudClient } from '../src/providers/soundcloud/client.js';
import { SoundCloudProvider } from '../src/providers/soundcloud/provider.js';

type Call = { url: string; init?: RequestInit };

const dlTrack = {
  kind: 'track', urn: 'soundcloud:tracks:1', title: 'Free Song', permalink_url: 'https://soundcloud.com/a/free',
  duration: 1000, user: { username: 'A' }, downloadable: true, access: 'playable', license: 'cc-by',
  download_url: 'https://api.soundcloud.com/tracks/soundcloud:tracks:1/download',
};
const streamOnly = { ...dlTrack, urn: 'soundcloud:tracks:2', title: 'Free Stream', downloadable: false, download_url: null, license: 'all-rights-reserved' };

let calls: Call[];
let tokenRequests: number;

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (url.startsWith('https://secure.soundcloud.com/oauth/token')) {
      tokenRequests++;
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    if (url.startsWith('https://api.soundcloud.com/tracks?')) return json({ collection: [dlTrack, streamOnly, { id: 9 }], next_href: 'x' });
    if (url.startsWith('https://api.soundcloud.com/resolve')) {
      const target = new URL(url).searchParams.get('url');
      if (target === 'https://soundcloud.com/a/set') return new Response(null, { status: 302, headers: { location: 'https://api.soundcloud.com/playlists/5' } });
      if (target === 'https://soundcloud.com/a/missing') return json({}, 404);
      return new Response(null, { status: 302, headers: { location: 'https://api.soundcloud.com/tracks/soundcloud:tracks:1' } });
    }
    if (url.startsWith('https://api.soundcloud.com/playlists/5')) return json({ kind: 'playlist' });
    if (url.endsWith('/tracks/soundcloud%3Atracks%3A1') || url.endsWith('/tracks/soundcloud:tracks:1')) return json(dlTrack);
    if (url.includes('soundcloud%3Atracks%3A2') || url.endsWith('soundcloud:tracks:2')) return json(streamOnly);
    if (url === 'https://api.soundcloud.com/tracks/soundcloud:tracks:1/download') {
      return new Response(null, { status: 302, headers: { location: 'https://cf-media.sndcdn.com/file.wav?sig=1' } });
    }
    if (url.startsWith('https://cf-media.sndcdn.com/')) {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      return new Response('AUDIO', {
        status: range ? 206 : 200,
        headers: {
          'content-type': 'audio/wav',
          'content-length': '5',
          'content-disposition': 'attachment; filename="free song.wav"',
          ...(range ? { 'content-range': 'bytes 0-4/5' } : {}),
        },
      });
    }
    return json({}, 404);
  }) as typeof fetch;
}

function app(creds = true) {
  const client = new SoundCloudClient(creds ? 'id' : '', creds ? 'secret' : '', fakeFetch());
  return buildApp(loadConfig({}), new ProviderRegistry([new SoundCloudProvider(client)]));
}

let originalGlobalFetch: typeof fetch;

function fakeGlobalFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://api.deezer.com/search')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://itunes.apple.com/search')) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unmocked global fetch: ' + url);
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  tokenRequests = 0;
  originalGlobalFetch = globalThis.fetch;
  globalThis.fetch = fakeGlobalFetch();
});

afterEach(() => {
  globalThis.fetch = originalGlobalFetch;
});

describe('API', () => {
  it('search maps tracks, drops incomplete ones, and reuses one token', async () => {
    const a = app();
    const r1 = await a.inject('/v1/search?q=free');
    const r2 = await a.inject('/v1/search?q=again');
    expect(r1.statusCode).toBe(200);
    const body = r1.json();
    expect(body.items).toHaveLength(17);
    expect(body.items[0].download.status).toBe('available');
    expect(body.items[1].download).toMatchObject({ status: 'unavailable', reason: 'streaming_only' });
    expect(body.nextOffset).toBe(20);
    expect(r2.statusCode).toBe(200);
    expect(tokenRequests).toBe(1);
  });

  it('search validates input', async () => {
    expect((await app().inject('/v1/search?q=')).statusCode).toBe(400);
  });

  it('resolve returns a track for a pasted link', async () => {
    const r = await app().inject({ method: 'POST', url: '/v1/resolve', payload: { url: 'https://soundcloud.com/a/free?si=abc' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().title).toBe('Free Song');
  });

  it('resolve rejects non-SoundCloud links and playlists', async () => {
    const a = app();
    const bad = await a.inject({ method: 'POST', url: '/v1/resolve', payload: { url: 'https://example.com/x/y' } });
    expect(bad.statusCode).toBe(400);
    const set = await a.inject({ method: 'POST', url: '/v1/resolve', payload: { url: 'https://soundcloud.com/a/set' } });
    expect(set.statusCode).toBe(422);
    const missing = await a.inject({ method: 'POST', url: '/v1/resolve', payload: { url: 'https://soundcloud.com/a/missing' } });
    expect(missing.statusCode).toBe(404);
  });

  it('503 when credentials are missing', async () => {
    const r = await app(false).inject('/v1/search?q=x');
    expect(r.statusCode).toBe(200);
    expect(r.json().items.some((i: any) => i.source === 'soundcloud')).toBe(false);
  });

  it('downloads the original file; credentials go only to the API host', async () => {
    const r = await app().inject('/v1/tracks/soundcloud/soundcloud:tracks:1/download');
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('AUDIO');
    expect(r.headers['content-type']).toBe('audio/wav');
    expect(r.headers['content-disposition']).toBe("attachment; filename*=UTF-8''free%20song.wav");
    const file = calls.find((c) => c.url.startsWith('https://cf-media.sndcdn.com/'))!;
    expect(JSON.stringify(file.init?.headers ?? {})).not.toContain('tok');
    const api = calls.find((c) => c.url.endsWith('/download'))!;
    expect((api.init?.headers as Record<string, string>).Authorization).toBe('OAuth tok');
  });

  it('forwards Range for resume', async () => {
    const r = await app().inject({ url: '/v1/tracks/soundcloud/soundcloud:tracks:1/download', headers: { range: 'bytes=0-4' } });
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-range']).toBe('bytes 0-4/5');
  });

  it('refuses to download streaming-only tracks and never requests a file', async () => {
    const r = await app().inject('/v1/tracks/soundcloud/soundcloud:tracks:2/download');
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('not_downloadable');
    expect(calls.some((c) => c.url.includes('/download') || c.url.includes('sndcdn'))).toBe(false);
  });

  it('refuses mp3 conversion when ffmpeg is not configured', async () => {
    const r = await app().inject('/v1/tracks/soundcloud/soundcloud:tracks:1/download?format=mp3');
    expect(r.statusCode).toBe(403);
  });

  it('rejects malformed ids and unknown providers', async () => {
    const a = app();
    expect((await a.inject('/v1/tracks/soundcloud/..%2Fme/download')).statusCode).toBeGreaterThanOrEqual(400);
    expect((await a.inject('/v1/tracks/nope/1')).statusCode).toBe(404);
  });
});
