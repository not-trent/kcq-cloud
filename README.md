# KCQ Cloud

KCQ Cloud is a shared quiz-question library. The web app organizes uploaded images into modules, while the Chrome extension saves quiz questions and marked answers from Moodle review pages. Both use the same Supabase project.

## Features

- Organize photos into modules and browse them in the web app.
- Upload photos individually, import a module folder, or import a ZIP of module folders.
- Save question text, answer options, selected answers, and grades from Moodle review pages with the Chrome extension.
- Search saved questions in the extension and use saved answers in the attempt-page helper.
- Optionally configure an OpenAI-compatible answer endpoint and module study guides in the extension.

The website's current image upload flow stores and displays photos; it does not OCR them. The extension reads quiz text from Moodle pages. It does not import arbitrary `.txt` question files.

## Technology

- React 18 and Vite for the web app.
- Supabase JS, Supabase Postgres/PostgREST, and Supabase Storage for cloud data and images.
- Chrome Extension Manifest V3 for Moodle integration, background messaging, and the lookup side panel.
- JSZip for ZIP image imports.
- Web Crypto API (SHA-256) for matching repeat question text within a module.
- Optional OpenAI-compatible chat completions endpoint for answer suggestions.

The repository also contains a Node/Express server and maintenance scripts. The current web client connects directly to Supabase.

## Use the shared KCQ Cloud

No Supabase account, new project, or individual login is needed. Everyone uses the same live app and shared question library.


- **Download the extension:** [Download the latest GitHub source ZIP](https://github.com/not-trent/kcq-cloud/archive/refs/heads/main.zip), then extract it.

To install the extension in Chrome or another Chromium browser:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `extension` folder inside the extracted repository.
3. Open the extension's **Options** page and enter the shared Supabase settings below. These are the same public client settings used by the live app; users do not need to create a Supabase account.

```text
Supabase URL: https://ewcworrjwtjtmkekddbq.supabase.co
Supabase anon/public key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3Y3dvcnJqd3RqdG1rZWtkZGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjA4NjcsImV4cCI6MjEwNTgzNjg2N30.pouenhxDfoL4vDCzJGJ2wUKstIMcDeFym1fNk4xDysg
```

On a Moodle quiz review page, select **Save to KCQ Cloud** and confirm the module name. Search saved questions in the extension side panel or in-page lookup. On a quiz attempt page, the helper checks for a confirmed shared answer before requesting an optional AI suggestion. Questions that include a diagram are matched from the surrounding extracted text; the image itself is ignored.

AI suggestions are optional. Configure an HTTPS OpenAI-compatible chat-completions endpoint, model, and API key in extension Options. You can also add a study guide by pasting text or loading a `.txt`/`.md` guide file. The extension stores these settings and guides in Chrome local storage. A saved cloud answer takes priority over an AI request. If the answer is not confirmed yet, known-wrong picks from earlier attempts are eliminated and the remaining or most likely option is shown. Uncertain suggestions are marked for checking. Image-only stems with no usable text still need checking.

**Shared-data warning:** The Supabase anon key is designed to be used in client applications, but the current database and storage policies allow anonymous read/write access. Anyone can view, add, change, or delete shared library data. Do not upload private or sensitive content. Never use or publish a Supabase service-role key.

## Develop or deploy your own copy

These steps are for contributors or maintainers, not regular users of the shared app.

Requirements: Node.js and npm, plus access to a Supabase project for a separate deployment.

1. Create `client/.env` with the Supabase URL and anon/public key for the intended deployment:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

2. For a new Supabase project, run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor. This creates the tables and screenshot bucket. Review and restrict the included public policies before using sensitive data.
3. From the repository root, install dependencies and start the web app:

	```powershell
	npm install
	npm run dev
	```

For folder and ZIP image imports, put each module's images in a folder named for that module. To deploy a separate web app, configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in its Vercel project environment; deployment settings are in [`vercel.json`](vercel.json).

## Useful commands

Run from the repository root:

```powershell
npm run dev
npm run build
npm run test:extension
npm run supabase:check
```

`npm run supabase:check` uses the server workspace's Supabase configuration. The extension tests cover question saving/merging, lookup behavior, parsing, and answer-suggestion behavior.

## Data flow

- **Website images:** The browser uploads image files to Supabase Storage and writes their module and storage-path metadata to `questions`. The app loads images with signed URLs.
- **Moodle quiz text:** The review-page content script reads question text, options, selected choice, and score. The extension service worker uses Supabase REST to create or update question rows. It hashes normalized question text to avoid duplicates within a module and keeps wrong picks so later results can update the saved record.
- **Saved questions:** The web app and extension read the same Supabase tables. The extension's attempt helper uses a matching confirmed cloud answer before its optional AI fallback.
