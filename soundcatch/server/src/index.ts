import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { ProviderRegistry } from './providers/registry.js';
import { SoundCloudClient } from './providers/soundcloud/client.js';
import { SoundCloudProvider } from './providers/soundcloud/provider.js';
import { AudDRecognitionProvider, AudDClient } from './providers/recognition/index.js';

const config = loadConfig();
const registry = new ProviderRegistry([
  new SoundCloudProvider(new SoundCloudClient(config.SOUNDCLOUD_CLIENT_ID, config.SOUNDCLOUD_CLIENT_SECRET)),
]);

const recognition = new AudDRecognitionProvider(new AudDClient(config.AUDD_API_TOKEN));

const app = buildApp(config, registry, recognition);
app.listen({ port: config.PORT, host: config.HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
