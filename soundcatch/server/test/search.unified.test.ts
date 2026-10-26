import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { SoundCloudClient } from '../src/providers/soundcloud/client.js';
import { SoundCloudProvider } from '../src/providers/soundcloud/provider.js';

const dlTrack = {
  kind: 'track', urn: 'soundcloud:tracks:1', title: 'Free Song', permalink_url: 'https://soundcloud.com/a/free',
  duration: 1000, user: { username: 'A' }, downloadable: true, access: 'playable', license: 'cc-by',
  download_url: 'https://api.soundcloud.com/tracks/soundcloud:tracks:1/download',
};

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://secure.soundcloud.com/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://api.soundcloud.com/tracks?')) {
      return new Response(JSON.stringify({ collection: [dlTrack], next_href: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://api.deezer.com/search')) {
      return new Response(JSON.stringify({ data: [{ title: 'Deezer Hit', artist: { name: 'DZ' }, album: { title: 'Alb', cover_big: 'https://dz/cover.jpg' }, preview: 'https://dz/preview.mp3', link: 'https://deezer.com/track/1' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://itunes.apple.com/search')) {
      return new Response(JSON.stringify({ results: [{ trackName: 'Another', artistName: 'B', collectionName: 'Alb2', artworkUrl100: 'https://it/100x100bb.jpg', previewUrl: 'https://it/preview.m4a', trackViewUrl: 'https://itunes.apple.com/x' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://api.soundcloud.com/resolve')) {
      return new Response(null, { status: 302, headers: { location: 'https://api.soundcloud.com/tracks/soundcloud:tracks:1' } });
    }
    if (url.endsWith('/tracks/soundcloud:tracks:1') || url.endsWith('/tracks/soundcloud%3Atracks%3A1')) {
      return new Response(JSON.stringify(dlTrack), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unmocked fetch: ' + url);
  }) as typeof fetch;
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function app() {
  const client = new SoundCloudClient('id', 'secret', fakeFetch());
  return buildApp(loadConfig({}), new ProviderRegistry([new SoundCloudProvider(client)]));
}

describe('unified search', () => {
  it('merges deezer, itunes and soundcloud', async () => {
    const a = app();
    const r = await a.inject('/v1/search?q=free');
    expect(r.statusCode).toBe(200);
    const items = r.json().items;
    const sources = items.map((i: any) => i.source);
    expect(sources).toContain('deezer');
    expect(sources).toContain('itunes');
    expect(sources).toContain('soundcloud');
  });

  it('soundcloud downloadable flag is true for downloadable tracks', async () => {
    const a = app();
    const r = await a.inject('/v1/search?q=free');
    const sc = r.json().items.find((i: any) => i.source === 'soundcloud');
    expect(sc.downloadable).toBe(true);
    expect(sc.download.status).toBe('available');
  });

  it('dedups by title+artist keeping soundcloud when downloadable', async () => {
    const a = app();
    const r = await a.inject('/v1/search?q=free');
    const matches = r.json().items.filter((i: any) => i.title === 'Free Song' && i.artist === 'A');
    expect(matches).toHaveLength(1);
    expect(matches[0].source).toBe('soundcloud');
  });
});

describe('resolve', () => {
  it('returns unified shape for soundcloud url', async () => {
    const a = app();
    const r = await a.inject({ method: 'POST', url: '/v1/resolve', payload: { url: 'https://soundcloud.com/a/free' } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.source).toBe('soundcloud');
    expect(b.sourceUrl).toContain('soundcloud.com');
  });
});