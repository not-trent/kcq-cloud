# SoundCatch Server

Fastify API for searching/resolving music and optional recognition/conversion.

## Environment

Copy `.env.example` to `.env` and fill values:

- `PORT`, `HOST`
- `APP_API_KEY` (optional)
- `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`
- `FFMPEG_PATH` (optional, for MP3 conversion)
- `AUDD_API_TOKEN` (optional, enables `/v1/recognise`)

## Run

```bash
npm install
npm run dev
```

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/v1/providers` | List providers + capabilities |
| GET | `/v1/search` | Search tracks |
| POST | `/v1/resolve` | Resolve a URL to a track |
| POST | `/v1/recognise` | Recognise a short audio clip (base64) via AudD |
| GET | `/v1/tracks/:provider/:id` | Track metadata |
| GET | `/v1/tracks/:provider/:id/download` | Download track |

## Tests

```bash
npm test
```
