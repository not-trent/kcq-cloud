import type { MusicProvider } from './types.js';

export class ProviderRegistry {
  private readonly providers = new Map<string, MusicProvider>();

  constructor(providers: MusicProvider[]) {
    for (const p of providers) this.providers.set(p.id, p);
  }

  list(): MusicProvider[] {
    return [...this.providers.values()];
  }

  get(id: string): MusicProvider | undefined {
    return this.providers.get(id);
  }
}
