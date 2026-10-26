import { AudDClient } from './audDClient.js';
import type { RecognitionMatch, RecognitionProvider } from './types.js';

export class AudDRecognitionProvider implements RecognitionProvider {
  readonly id = 'audd';
  readonly displayName = 'AudD';

  constructor(private readonly client: AudDClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async recognise(audio: Buffer, mimeType: string): Promise<RecognitionMatch | null> {
    return this.client.recognise(audio, mimeType);
  }
}

export { AudDClient };
