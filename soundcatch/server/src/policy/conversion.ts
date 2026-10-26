import type { CatalogTrack } from '../providers/types.js';

export type ConversionOffer =
  | { available: true; target: 'mp3' }
  | { available: false; message: string };

/** Licences under which a technical format change is expressly permitted. */
const CONVERSION_FRIENDLY = new Set([
  'no-rights-reserved',
  'cc-by',
  'cc-by-sa',
  'cc-by-nc',
  'cc-by-nc-sa',
  'cc-by-nd',
  'cc-by-nc-nd',
]);

/**
 * The original file is always the default. MP3 conversion is only offered when the track
 * is downloadable, the licence allows format shifting, and a converter is installed.
 * "all-rights-reserved" (or an unknown licence) is treated as not permitting conversion.
 */
export function conversionOffer(track: CatalogTrack, ffmpegAvailable: boolean): ConversionOffer {
  if (track.download.status !== 'available') {
    return { available: false, message: 'Conversion requires a downloadable track.' };
  }
  if (!track.license || !CONVERSION_FRIENDLY.has(track.license)) {
    return {
      available: false,
      message: 'The creator has not licensed this track for conversion. The original file can still be downloaded.',
    };
  }
  if (!ffmpegAvailable) {
    return { available: false, message: 'MP3 conversion is not enabled on this server.' };
  }
  return { available: true, target: 'mp3' };
}

/** True when the delivered file is already MP3, so converting would only lose quality. */
export function isMp3(contentType?: string, filename?: string): boolean {
  return /audio\/(mpeg|mp3)/i.test(contentType ?? '') || /\.mp3$/i.test(filename ?? '');
}
