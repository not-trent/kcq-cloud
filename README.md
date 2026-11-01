<div align="center">

# KCQ Cloud

**Your shared quiz-question library.**

Save from Moodle. Find answers. Study by module.

![Brand accent](https://img.shields.io/badge/KCQ_Cloud-%23d9f26d-d9f26d?style=flat-square&labelColor=18181b)
![React](https://img.shields.io/badge/React-18-18181b?style=flat-square)
![Chrome Extension](https://img.shields.io/badge/Chrome-Manifest_V3-18181b?style=flat-square)

[Download extension](https://github.com/not-trent/kcq-cloud/archive/refs/heads/main.zip) · [Quick install](#quick-install) · [Deploy](#deploy)

</div>

---

KCQ Cloud brings Moodle quiz questions and marked answers into one shared Supabase library. Use the Chrome extension to save and search questions, and the web app to organize images by module. Its visual identity centers on a fresh lime accent (`#d9f26d`), clear typography, and a simple, focused study experience.

## Features

- Save question text, answer options, selected answers, and grades from Moodle review pages.
- Search saved questions in the extension side panel.
- Look up shared answers with the attempt-page helper.
- Enable optional AI suggestions through an OpenAI-compatible endpoint.
- Add module study guides by pasting text or loading `.txt` / `.md` files.
- Organize images into modules in the web app.
- Import images individually, by folder, or from ZIP files.
- Use one shared library without an individual account.

## Quick install

**Extension v1.1.0:** refreshed KCQ branding, local Manrope and Space Grotesk fonts, Chrome toolbar icons, and a light/dark theme shared between the side panel and settings.

1. [Download the source ZIP](https://github.com/not-trent/kcq-cloud/archive/refs/heads/main.zip), extract it, and open `chrome://extensions` with **Developer mode** enabled.
2. Click **Load unpacked** and select the extracted repository's `extension` folder.
3. Open the extension's **Options** page and enter the shared Supabase settings below.

**Updating an unpacked installation:** extract the latest download, replace the contents of your existing extension folder, then click **Reload** on its card at `chrome://extensions`. Reopen the side panel and Options page to see the new design. Keep the same installation and folder to retain your settings.

```text
Supabase URL: https://ewcworrjwtjtmkekddbq.supabase.co
Supabase anon/public key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3Y3dvcnJqd3RqdG1rZWtkZGJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjA4NjcsImV4cCI6MjEwNTgzNjg2N30.pouenhxDfoL4vDCzJGJ2wUKstIMcDeFym1fNk4xDysg
```

## Extension preview

<p align="center">
  <img src="docs/images/extension-light.png" width="280" alt="KCQ Cloud extension in light mode with lime buttons and a branded search panel">
  <img src="docs/images/extension-dark.png" width="280" alt="KCQ Cloud extension in dark mode with deep green surfaces">
</p>

## Tech stack

React 18 · Vite · Supabase · Chrome Extension Manifest V3

## Usage

On a Moodle quiz review page, select **Save to KCQ Cloud** and confirm the module; search in the side panel or use the attempt-page helper, which checks confirmed shared answers before optional AI suggestions.

Image uploads are stored for browsing without OCR; Moodle question matching uses extracted text, so image-only questions need manual checking.

## Shared data

**The shared library allows anonymous read/write access: anyone can view, add, change, or delete its data. Do not upload private or sensitive content.**

## Deploy

Requires Node.js, npm, and a Supabase project for your own deployment.

1. Run [`supabase/schema.sql`](supabase/schema.sql) in your project's SQL Editor and configure its access policies.
2. Create `client/.env`:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   ```

3. Run `npm install`, then `npm run dev` locally or `npm run build` for production. For Vercel, set the same environment variables; see [`vercel.json`](vercel.json).
