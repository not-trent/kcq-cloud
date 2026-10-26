import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import type { Config } from './config.js';
import { convertToMp3, isLossless } from './convert.js';
import { conversionOffer, isMp3 } from './policy/conversion.js';
import type { ProviderRegistry } from './providers/registry.js';
import type { RecognitionProvider } from './providers/recognition/types.js';
import { AudDRecognitionProvider, AudDClient } from './providers/recognition/index.js';
import { unifiedSearch, soundCloudTrackToUnified, type UnifiedTrack } from './search.js';
import { ProviderError, type CatalogTrack, type MusicProvider } from './providers/types.js';

const idSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/);
const providerSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

export function buildApp(config: Config, registry: ProviderRegistry, recognition?: RecognitionProvider | null): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info', redact: ['req.headers.authorization', 'req.headers["x-api-key"]'] } });
  const ffmpeg = config.FFMPEG_PATH;
  const recognitionProvider =
    recognition === undefined
      ? config.AUDD_API_TOKEN
        ? new AudDRecognitionProvider(new AudDClient(config.AUDD_API_TOKEN))
        : null
      : recognition;

  void app.register(helmet);
  void app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.addHook('onRequest', async (req, reply) => {
    if (!config.APP_API_KEY || req.url === '/health') return;
    const given = Buffer.from(String(req.headers['x-api-key'] ?? ''));
    const expected = Buffer.from(config.APP_API_KEY);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid API key.' });
    }
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ProviderError) {
      if (err.retryAfterSeconds) void reply.header('retry-after', String(err.retryAfterSeconds));
      return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid_request', message: 'Invalid request parameters.' });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: 'request_error', message: e.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Unexpected server error.' });
  });

  const present = (track: CatalogTrack) => ({ ...track, conversion: conversionOffer(track, Boolean(ffmpeg)) });

  const providerOr404 = (id: string): MusicProvider => {
    const p = registry.get(providerSchema.parse(id));
    if (!p) throw new ProviderError('not_found', 'Unknown provider.', 404);
    return p;
  };

  app.get('/health', async () => ({ ok: true }));

  app.get('/v1/providers', async () => ({
    providers: registry.list().map((p) => ({ id: p.id, displayName: p.displayName, configured: p.isConfigured() })),
    conversion: Boolean(ffmpeg),
    recognition: recognitionProvider
      ? { id: recognitionProvider.id, displayName: recognitionProvider.displayName, configured: recognitionProvider.isConfigured() }
      : null,
  }));

  app.get('/v1/search', async (req) => {
    const q = z
      .object({
        q: z.string().trim().min(1).max(200),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    const items = await unifiedSearch(q.q, registry, q.limit);
    return { items, nextOffset: q.limit };
  });

  app.post('/v1/resolve', async (req) => {
    const { url } = z.object({ url: z.string().trim().min(8).max(500) }).parse(req.body);
    for (const provider of registry.list()) {
      try {
        const track = await provider.resolveUrl(url);
        return soundCloudTrackToUnified(track);
      } catch (e) {
        if (e instanceof ProviderError && e.code === 'unsupported_url') continue;
        throw e;
      }
    }
    throw new ProviderError('unsupported_url', 'That link is not from a supported music source.', 400);
  });

  const recogniseHandler = async (req: any) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const audioField =
      body.audio ?? body.audioBase64 ?? body.data ?? body.file ?? body.clip;
    const mimeField = body.mimeType ?? body.contentType ?? body.type;

    const audioSchema = z.string().trim().min(1).max(3_000_000);
    const mimeTypeSchema = z.string().trim().min(3).max(120).default('audio/m4a');

    const audio = audioSchema.parse(audioField);
    const mimeType = mimeTypeSchema.parse(mimeField ?? 'audio/m4a');

    const cleanedAudio = audio.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleanedAudio)) {
      throw new ProviderError('upstream', 'Invalid audio payload.', 400);
    }
    const buf = Buffer.from(cleanedAudio, 'base64');
    if (buf.length === 0) {
      throw new ProviderError('upstream', 'Invalid audio payload.', 400);
    }
    if (buf.length > 2_000_000) {
      throw new ProviderError('upstream', 'Audio clip is too large (max ~2 MB).', 400);
    }

    if (!recognitionProvider || !recognitionProvider.isConfigured()) {
      throw new ProviderError('not_configured', 'Music recognition is not configured on this server.', 503);
    }

    const match = await recognitionProvider.recognise(buf, mimeType);
    if (!match) {
      throw new ProviderError('not_found', 'No matching track found.', 404);
    }

    // Also search SoundCloud for the same title + artist.
    let soundcloud: UnifiedTrack | null = null;
    try {
      const scProvider = registry.get('soundcloud');
      if (scProvider && scProvider.isConfigured()) {
        const res = await scProvider.search(`${match.title} ${match.artist}`, { limit: 5, offset: 0 });
        const best = res.items[0];
        if (best) soundcloud = soundCloudTrackToUnified(best);
      }
    } catch {
      soundcloud = null;
    }

    return {
      match,
      track: match,
      title: match.title,
      artist: match.artist,
      album: match.album,
      coverUrl: match.coverUrl,
      albumId: match.albumId,
      previewUrl: match.previewUrl,
      appleMusicUrl: match.appleMusicUrl,
      spotifyUrl: match.spotifyUrl,
      soundcloud,
    };
  };

  app.post('/v1/recognise', { bodyLimit: 5 * 1024 * 1024 }, recogniseHandler);
  app.post('/v1/recognize', { bodyLimit: 5 * 1024 * 1024 }, recogniseHandler);

  app.get('/v1/tracks/:provider/:id', async (req) => {
    const p = z.object({ provider: providerSchema, id: idSchema }).parse(req.params);
    return present(await providerOr404(p.provider).getTrack(p.id));
  });

  app.get('/v1/tracks/:provider/:id/download', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = z.object({ provider: providerSchema, id: idSchema }).parse(req.params);
    const { format } = z.object({ format: z.enum(['original', 'mp3']).default('original') }).parse(req.query);
    const provider = providerOr404(p.provider);
    const range = typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined;

    if (format === 'mp3') {
      const track = await provider.getTrack(p.id);
      const offer = conversionOffer(track, Boolean(ffmpeg));
      if (!offer.available) throw new ProviderError('not_downloadable', offer.message, 403);
      const file = await provider.openDownload(p.id);
      if (!file.body) throw new ProviderError('upstream', 'Empty download response.', 502);
      if (isMp3(file.headers.contentType, file.headers.filename)) {
        return sendFile(reply, file);
      }
      return reply
        .header('content-type', 'audio/mpeg')
        .header('cache-control', 'no-store')
        .send(convertToMp3(ffmpeg, file.body, isLossless(file.headers.contentType, file.headers.filename)));
    }

    const file = await provider.openDownload(p.id, range);
    return sendFile(reply, file);
  });

  return app;
}

function sendFile(reply: import('fastify').FastifyReply, file: Awaited<ReturnType<MusicProvider['openDownload']>>) {
  const h = file.headers;
  void reply.code(file.status).header('cache-control', 'no-store');
  if (h.contentType) void reply.header('content-type', h.contentType);
  if (h.contentLength) void reply.header('content-length', h.contentLength);
  if (h.contentRange) void reply.header('content-range', h.contentRange);
  if (h.acceptRanges) void reply.header('accept-ranges', h.acceptRanges);
  if (h.filename) void reply.header('x-original-filename', encodeURIComponent(h.filename));
  // Clients that save the stream to disk need a real filename; UTF-8 form survives non-ASCII titles.
  if (h.filename) void reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(h.filename)}`);
  if (!file.body) return reply.send();
  return reply.send(Readable.fromWeb(file.body as import('node:stream/web').ReadableStream<Uint8Array>));
}
