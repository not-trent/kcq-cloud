import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { SoundCloudClient } from '../src/providers/soundcloud/client.js';
import { SoundCloudProvider } from '../src/providers/soundcloud/provider.js';

function fakeFetch(deezerData: any[], itunesData: any[], scTracks: any[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://secure.soundcloud.com/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://api.soundcloud.com/tracks?')) {
      return new Response(JSON.stringify({ collection: scTracks, next_href: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://api.deezer.com/search')) {
      return new Response(JSON.stringify({ data: deezerData }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://itunes.apple.com/search')) {
      return new Response(JSON.stringify({ results: itunesData }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unmocked fetch: ' + url);
  }) as typeof fetch;
}

let originalFetch: typeof fetch;

beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

function app(globalFetchFn: typeof fetch, scTracks: any[] = []) {
  globalThis.fetch = globalFetchFn;
  const c2 = new SoundCloudClient('id', 'secret', (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://secure.soundcloud.com/oauth/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://api.soundcloud.com/tracks?')) return new Response(JSON.stringify({ collection: scTracks, next_href: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error('unmocked sc fetch: ' + url);
  }) as typeof fetch);
  return buildApp(loadConfig({}), new ProviderRegistry([new SoundCloudProvider(c2)]));
}

describe('relevance filtering', () => {
  it('drops results that do not contain any query word', async () => {
    const deezerData = [
      { title: 'Mortal Man', artist: { name: 'Kendrick Lamar' }, album: { title: 'A', cover_big: 'x' } },
      { title: 'Banana Boat Song', artist: { name: 'Harry Belafonte' }, album: { title: 'B', cover_big: 'x' } },
      { title: 'Full Dior', artist: { name: 'Unknown' }, album: { title: 'C', cover_big: 'x' } },
    ];
    const gf = fakeFetch(deezerData, [], []);
    const a = app(gf, []);
    const r = await a.inject('/v1/search?q=mortal+man');
    const titles = r.json().items.map((i: any) => i.title);
    expect(titles).toContain('Mortal Man');
    expect(titles).not.toContain('Banana Boat Song');
    expect(titles).not.toContain('Full Dior');
  });
});

describe('ranking', () => {
  it('exact title match ranks before partial matches', async () => {
    const deezerData = [
      { title: 'Mortal Man (Live)', artist: { name: 'Kendrick Lamar' }, album: { title: 'A', cover_big: 'x' } },
      { title: 'Mortal Man', artist: { name: 'Kendrick Lamar' }, album: { title: 'A', cover_big: 'x' } },
    ];
    const gf = fakeFetch(deezerData, [], []);
    const a = app(gf, []);
    const r = await a.inject('/v1/search?q=mortal+man');
    const titles = r.json().items.map((i: any) => i.title);
    expect(titles[0]).toBe('Mortal Man');
  });
});

describe('dedup feat variants', () => {
  it('collapses feat variants into one result', async () => {
    const deezerData = [
      { title: 'Mortal Man (feat.Thriller U)', artist: { name: 'Sizzla' }, album: { title: 'A', cover_big: 'x' } },
    ];
    const itunesData = [
      { trackName: 'Mortal Man (feat. Thriller U)', artistName: 'Sizzla', collectionName: 'A', artworkUrl100: 'x' },
    ];
    const gf = fakeFetch(deezerData, itunesData, []);
    const a = app(gf, []);
    const r = await a.inject('/v1/search?q=mortal+man');
    const items = r.json().items.filter((i: any) => i.title.toLowerCase().includes('mortal man') && i.artist === 'Sizzla');
    expect(items).toHaveLength(1);
  });

  it('keeps remix and acoustic versions separate', async () => {
    const deezerData = [
      { title: 'Mortal Man (Remix)', artist: { name: 'Sizzla' }, album: { title: 'A', cover_big: 'x' } },
      { title: 'Mortal Man (Acoustic)', artist: { name: 'Sizzla' }, album: { title: 'A', cover_big: 'x' } },
    ];
    const gf = fakeFetch(deezerData, [], []);
    const a = app(gf, []);
    const r = await a.inject('/v1/search?q=mortal+man');
    const titles = r.json().items.map((i: any) => i.title);
    expect(titles).toContain('Mortal Man (Remix)');
    expect(titles).toContain('Mortal Man (Acoustic)');
  });
});