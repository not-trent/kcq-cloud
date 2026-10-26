export interface RecognitionMatch {
  title: string;
  artist: string;
  album?: string;
  releaseDate?: string;
  score?: number;
  songLink?: string;
  // Enriched via AudD return=apple_music,spotify
  coverUrl?: string;
  albumId?: string;
  previewUrl?: string;
  appleMusicUrl?: string;
  spotifyUrl?: string;
}

export interface RecognitionProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  recognise(audio: Buffer, mimeType: string): Promise<RecognitionMatch | null>;
}
