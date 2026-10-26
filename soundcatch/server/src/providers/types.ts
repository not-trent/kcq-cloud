export type ReleaseKind = 'song' | 'remix' | 'mix' | 'other';

export type UnavailableReason =
  | 'streaming_only' // creator has not enabled downloads
  | 'blocked' // provider blocks access (region, rights holder, private)
  | 'preview_only' // only a snippet is accessible
  | 'not_configured' // provider credentials are missing
  | 'unknown';

export type DownloadAvailability =
  | { status: 'available'; originalFormat?: string; sizeBytes?: number }
  | { status: 'unavailable'; reason: UnavailableReason; message: string };

export interface CatalogTrack {
  provider: string;
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl?: string;
  permalinkUrl: string;
  genre?: string;
  releaseYear?: number;
  license?: string;
  isrc?: string;
  kind: ReleaseKind;
  download: DownloadAvailability;
  /** Provider-required credit shown wherever the track is displayed. */
  attribution: { providerName: string; creatorUrl?: string };
}

export interface SearchResult {
  items: CatalogTrack[];
  nextOffset?: number;
}

export interface DownloadStream {
  status: 200 | 206;
  headers: {
    contentType?: string;
    contentLength?: string;
    contentRange?: string;
    acceptRanges?: string;
    filename?: string;
  };
  body: ReadableStream<Uint8Array> | null;
}

export class ProviderError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'unsupported_url'
      | 'unsupported_resource'
      | 'not_downloadable'
      | 'rate_limited'
      | 'not_configured'
      | 'upstream',
    message: string,
    public readonly httpStatus: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** Contract every music source implements; the rest of the backend only talks to this. */
export interface MusicProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  search(query: string, opts: { limit: number; offset: number }): Promise<SearchResult>;
  /** Accepts a pasted URL. Throws ProviderError('unsupported_url') if it does not belong to this provider. */
  resolveUrl(url: string): Promise<CatalogTrack>;
  getTrack(id: string): Promise<CatalogTrack>;
  /** Only permitted for tracks whose download availability is `available`. */
  openDownload(id: string, range?: string): Promise<DownloadStream>;
}
