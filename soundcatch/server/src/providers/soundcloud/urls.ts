const SOUNDCLOUD_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const SHORT_HOST = 'on.soundcloud.com';

export type ParsedSoundCloudUrl = { url: string; isShortLink: boolean };

/**
 * Validates a user-pasted URL. Only https URLs on SoundCloud hosts are accepted so the
 * backend can never be coerced into requesting arbitrary hosts (SSRF).
 */
export function parseSoundCloudUrl(input: string): ParsedSoundCloudUrl | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const isShortLink = host === SHORT_HOST;
  if (!isShortLink && !SOUNDCLOUD_HOSTS.has(host)) return null;
  const path = u.pathname.replace(/\/+$/, '');
  if (path.split('/').filter(Boolean).length === 0) return null;
  // The query string is dropped: it only carries tracking parameters.
  return { url: `https://${host === 'm.soundcloud.com' || host === 'www.soundcloud.com' ? 'soundcloud.com' : host}${path}`, isShortLink };
}

/** Rejects redirect targets that are not public https hosts. */
export function isSafeRedirectTarget(location: string): boolean {
  let u: URL;
  try {
    u = new URL(location);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (h.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  return true;
}
