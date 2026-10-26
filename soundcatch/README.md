# SoundCatch

Identify music playing around you, find it on SoundCloud, and keep the tracks whose creators
allow downloads. The app never works around a creator's download setting.

```
soundcatch/
  app/      Expo + React Native client (Expo Router, routes in app/src/app)
  server/   Fastify API that talks to SoundCloud on the app's behalf
```

The server holds the provider credentials and enforces the download policy, so the mobile app
never sees a SoundCloud secret and never contacts SoundCloud directly.

## What works today

- Search the SoundCloud catalogue by track or artist, with paging.
- Paste a SoundCloud track link (including `on.soundcloud.com` short links) to resolve it.
- Track detail with artwork, duration, genre, licence, ISRC and attribution.
- Download creator-enabled tracks through the server, with progress, retry, share and delete.
- Licence-aware MP3 conversion when the server has `ffmpeg` and the licence permits it.
- Favourites, recent searches and downloads persisted on the device.
- Microphone capture for recognition — see the limitation below.

## Limitation: recognition is not connected

The Recognise tab records a short clip locally, then says plainly that matching is unavailable.
Turning audio into a track needs a fingerprint provider (ACRCloud, AudD, …) which this project
does not have credentials for, and the server has no `/v1/recognise` endpoint yet. The tab does
not invent matches.

## Server

```bash
cd server
cp .env.example .env      # fill in the values below
npm install
npm run dev               # http://localhost:8787
```

`.env` values:

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port, default `8787`. |
| `HOST` | Bind address, default `0.0.0.0`. |
| `APP_API_KEY` | Optional shared key; when set, the app must send `x-api-key`. |
| `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET` | Client-credentials app from <https://soundcloud.com/you/apps>. Without them the API returns `503`. |
| `FFMPEG_PATH` | Absolute path to `ffmpeg`; enables the MP3 option. |

`npm test` runs 31 tests against a fake SoundCloud, so no credentials are needed for testing.
`npm run typecheck` and `npm run build` compile with TypeScript.

### API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness, no API key required. |
| `GET` | `/v1/providers` | Which providers have credentials, and whether conversion is on. |
| `GET` | `/v1/search?q=&limit=&offset=` | Returns `{ items, nextOffset? }`. |
| `POST` | `/v1/resolve` | `{ url }` → a single track, or `400`/`422`/`404`. |
| `GET` | `/v1/tracks/:provider/:id` | Track details. |
| `GET` | `/v1/tracks/:provider/:id/download?format=original\|mp3` | Streams the file; honours `Range`. |

Every track carries `download` (`available` or `unavailable` with a reason) and `conversion`
(`available` or a message explaining why not).

## App

```bash
cd app
npm install
npx expo start            # then press a for Android, i for iOS
```

Point the app at the server with environment variables (Expo inlines `EXPO_PUBLIC_*` at build
time):

```bash
# .env.local in app/
EXPO_PUBLIC_API_URL=http://192.168.1.10:8787   # your machine's LAN IP for a physical device
EXPO_PUBLIC_API_KEY=                            # only if APP_API_KEY is set on the server
```

Without `EXPO_PUBLIC_API_URL` the app uses `http://10.0.2.2:8787` on Android (the emulator's
alias for the host) and `http://localhost:8787` elsewhere. A physical device needs your
machine's LAN address, and both devices must be on the same network.

Plain HTTP works in development builds; a production build needs HTTPS on Android.

Run the checks the project asks for:

```bash
npx tsc --noEmit
npx expo export --platform android    # bundle smoke test, no device needed
npx expo run:android                  # development build on a device/emulator
```

## Policy

- Only tracks where the creator enabled downloads are downloadable; the server re-checks this
  against SoundCloud on every request rather than trusting cached state.
- The original file is always the default. MP3 conversion is offered only when the licence
  permits format shifting **and** `ffmpeg` is configured; `all-rights-reserved` is treated as
  not permitting it.
- Attribution and a link back to the creator are shown on the track screen.
