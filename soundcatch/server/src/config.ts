import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  APP_API_KEY: z.string().optional().default(''),
  SOUNDCLOUD_CLIENT_ID: z.string().optional().default(''),
  SOUNDCLOUD_CLIENT_SECRET: z.string().optional().default(''),
  FFMPEG_PATH: z.string().optional().default(''),
  // Recognition provider (AudD). Leave empty to disable /v1/recognise.
  AUDD_API_TOKEN: z.string().optional().default(''),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
