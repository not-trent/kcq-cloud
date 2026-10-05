# KCQ Cloud

KCQ Cloud is a simple, installable photo library. Photos are stored in Supabase Storage and organized into named modules.

## Architecture

- Frontend: React and Vite in `client/`.
- Database and photo storage: Supabase, accessed by the frontend with the public anon key.
- Hosting: Vercel static hosting, configured by `vercel.json`.
- PWA: manifest and app-shell service worker in `client/public/`.

## Local development

Run `npm run dev` from the repository root. Copy `client/.env.example` to `client/.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your Supabase project.

Run `npm run supabase:check` to verify the client and server environment files and confirm Supabase connectivity. Copy `server/.env.example` to `server/.env` and add the service-role key for maintenance scripts only. Never expose that key to the browser or commit it.

## Data access

The current no-login starter configuration is shared and publicly readable/writable to anyone with the app URL. Do not store private or sensitive photos until user authentication and per-user access policies are configured.
