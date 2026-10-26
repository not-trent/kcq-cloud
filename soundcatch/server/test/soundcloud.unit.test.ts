import { describe, expect, it } from 'vitest';
import { availabilityOf, classifyKind, toCatalogTrack, upscaleArtwork } from '../src/providers/soundcloud/mapper.js';
import { isSafeRedirectTarget, parseSoundCloudUrl } from '../src/providers/soundcloud/urls.js';
import { conversionOffer } from '../src/policy/conversion.js';

const base = { id: 1, title: 'Song', permalink_url: 'https://soundcloud.com/a/song', duration: 180000, user: { username: 'Artist' } };

describe('availabilityOf', () => {
  it('available only when downloadable with a download_url', () => {
    expect(availabilityOf({ ...base, downloadable: true, download_url: 'https://api.soundcloud.com/tracks/1/download' }).status).toBe('available');
  });
  it('streaming-only tracks are never downloadable', () => {
    const a = availabilityOf({ ...base, downloadable: false, access: 'playable', download_url: 'https://api.soundcloud.com/tracks/1/download' });
    expect(a).toMatchObject({ status: 'unavailable', reason: 'streaming_only' });
  });
  it('downloadable flag without a file URL is unavailable', () => {
    expect(availabilityOf({ ...base, downloadable: true })).toMatchObject({ status: 'unavailable', reason: 'blocked' });
  });
  it('blocked access wins over downloadable', () => {
    expect(availabilityOf({ ...base, downloadable: true, download_url: 'x', access: 'blocked' })).toMatchObject({ reason: 'blocked' });
  });
  it('preview-only', () => {
    expect(availabilityOf({ ...base, access: 'preview' })).toMatchObject({ reason: 'preview_only' });
  });
});

describe('mapping', () => {
  it('prefers metadata_artist and upscales artwork', () => {
    const t = toCatalogTrack({ ...base, metadata_artist: 'Real Artist', artwork_url: 'https://i1.sndcdn.com/artworks-x-large.jpg', created_at: '2021-05-01T00:00:00Z' });
    expect(t).toMatchObject({ artist: 'Real Artist', releaseYear: 2021, artworkUrl: 'https://i1.sndcdn.com/artworks-x-t500x500.jpg' });
  });
  it('rejects incomplete records', () => {
    expect(toCatalogTrack({ id: 1 })).toBeNull();
  });
  it('classifies remixes and mixes', () => {
    expect(classifyKind({ title: 'Track (Foo Remix)' })).toBe('remix');
    expect(classifyKind({ title: 'Live', duration: 3600000 })).toBe('mix');
    expect(classifyKind({ title: 'Plain' })).toBe('song');
  });
  it('leaves missing artwork undefined', () => {
    expect(upscaleArtwork(null)).toBeUndefined();
  });
});

describe('url handling', () => {
  it('accepts SoundCloud links and strips tracking query', () => {
    expect(parseSoundCloudUrl('https://m.soundcloud.com/a/b?utm_source=x')).toEqual({ url: 'https://soundcloud.com/a/b', isShortLink: false });
    expect(parseSoundCloudUrl('https://on.soundcloud.com/AbCd')?.isShortLink).toBe(true);
  });
  it.each([
    'http://soundcloud.com/a/b',
    'https://evil.com/soundcloud.com/a/b',
    'https://soundcloud.com.evil.com/a/b',
    'https://user:pw@soundcloud.com/a/b',
    'https://soundcloud.com/',
    'not a url',
  ])('rejects %s', (u) => {
    expect(parseSoundCloudUrl(u)).toBeNull();
  });
  it('blocks unsafe redirect targets', () => {
    expect(isSafeRedirectTarget('https://cf-media.sndcdn.com/x')).toBe(true);
    for (const u of ['http://a.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://a.com:8080/x']) {
      expect(isSafeRedirectTarget(u)).toBe(false);
    }
  });
});

describe('conversionOffer', () => {
  const available = toCatalogTrack({ ...base, downloadable: true, download_url: 'u', license: 'cc-by' })!;
  it('needs ffmpeg', () => expect(conversionOffer(available, false).available).toBe(false));
  it('allowed for permissive licence with ffmpeg', () => expect(conversionOffer(available, true).available).toBe(true));
  it('refused for all-rights-reserved', () => {
    const t = { ...available, license: 'all-rights-reserved' };
    expect(conversionOffer(t, true).available).toBe(false);
  });
  it('refused when not downloadable', () => {
    const t = toCatalogTrack({ ...base, license: 'cc-by' })!;
    expect(conversionOffer(t, true).available).toBe(false);
  });
});
