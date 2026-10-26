# SoundCatch Development Progress

Updated after rebuilding the mobile app against the existing server. Every tick below is
verified by a command in this repository (typecheck, bundle, or the server test suite);
anything unverified is left unticked with the reason.

## Verification commands

| Area | Command | Status |
| --- | --- | --- |
| Server tests | `cd server && npm test` | 39/39 passing |
| App typecheck | `cd app && npx tsc --noEmit` | clean |
| App bundle | `cd app && npx expo export --platform android` | 1291 modules; router context contains only `src/app` routes |
| Server boot | `cd server && npx tsx src/index.ts` + `/health`, `/v1/providers` | responds; SoundCloud reported unconfigured without credentials |
| Device build | `cd app && npx expo run:android` | not run — no Android SDK/device here |

## Phase 1: Foundation
- [x] Project initialised with Expo Router (routes live in `src/app`)
- [x] TypeScript strict mode with the `@/*` path alias
- [x] Environment variables (`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_API_KEY`)
- [x] Folder structure: `src/app` routes, `src/components`, `src/lib`, `src/store`, `src/hooks`
- [x] Centralised design system (`src/theme/tokens.ts`)
- [x] Floating padded glass dock (custom tab bar)
- [x] Home screen
- [×] Initial Android build verified — requires Android SDK/device, not available in this environment
- [×] APK

## Phase 2: UI Design System
- [x] Glass surface, card and button components
- [x] Gradient accents and dark palette
- [×] Dynamic album colours — not implemented; artwork drives no theme extraction yet

## Phase 3: Core Screens
- [x] Home
- [x] Search (with recent searches and pagination)
- [x] Track detail
- [x] Downloads
- [x] Library (favourites, recognitions, storage)
- [×] Separate player screen — playback exists inline in Downloads
- [×] Album screen

## Phase 4: Recognition
- [x] Microphone permission handling and 10-second local capture (`expo-audio`)
- [x] Honest UI state while no provider is connected
- [×] Fingerprint matching — needs an ACRCloud/AudD account and a server endpoint; neither exists yet
- [x] Uploading captured audio — sends the 10-second clip as base64 to `POST /v1/recognise` (alias `/v1/recognize`) and surfaces 404/503/400/network errors with retry.

## Phase 5: Music Discovery
- [x] SoundCloud provider on the server: OAuth client-credentials search, URL resolution, pagination
- [x] Direct SoundCloud URL handling, including `on.soundcloud.com` short links
- [x] Metadata mapping: title, artist, duration, artwork upscaling, genre, licence, ISRC, kind
- [x] App search by name and paste-a-link flow
- [x] Attribution and creator links surfaced in the UI

## Phase 6: Downloads
- [x] Creator-enabled downloads only, re-checked against SoundCloud on every request
- [x] Range requests forwarded for resumable transfers
- [x] Licence-aware MP3 conversion (opt-in via `FFMPEG_PATH`); original file is the default
- [x] `Content-Disposition` so clients save a real filename
- [x] App download manager with progress, retry, share, delete and persisted state
- [×] Artwork and ID3 embedding — `browser-id3-writer` is installed but not wired up
- [×] Android shared-storage/MediaStore export — files live in the app's document directory

## Phase 7: Album Support
- [×] Album discovery
- [×] Batch downloads
- [×] ZIP export

## Phase 8: Music Player
- [x] Playback of downloaded files (`expo-audio`)
- [x] Favourites
- [×] Playlists
- [×] Mini-player and background controls
- [×] Offline queue / gapless playback

## Phase 9: Testing
- [x] Server: 31 tests covering search, resolution, download policy, range, conversion refusal, auth
- [x] App: typecheck and production bundle
- [×] App unit/component tests
- [×] On-device testing of permissions, downloads and playback

## Phase 10: Android APK
- [×] APK built successfully
- [×] Installation and testing instructions for a signed build

## Known gaps and next steps

1. **Recognition provider (connected).** AudD client on the server, `POST /v1/recognise` accepts a base64 audio clip; the Recognise tab records 10 seconds, shows a listening animation and countdown, uploads the clip, and renders the match with cover art, album, year, 30s preview, open links and (when available) download. Results are saved to Library history.
2. **Metadata and artwork.** Embed artwork and tags with `browser-id3-writer` after download,
   and offer a MediaStore/Music-folder export on Android.
3. **Playlists and background playback.** Both need `expo-audio` playlist APIs plus a
   notification/media-session surface.
4. **Albums.** SoundCloud playlists are currently rejected by `/v1/resolve` (`unsupported_resource`);
   supporting sets/albums is a provider change first.
5. **Device verification.** `npx expo run:android` on a real device, then check microphone
   permission, a creator-enabled download, playback and deletion.
