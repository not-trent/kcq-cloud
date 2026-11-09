# KCQ Cloud guide library

Text-only search over the recovered NotebookLM module guides. The recovered
`text.txt` exports are chunked, deduplicated and stored in Supabase with
PostgreSQL full-text search. No PDFs, HTML, images, ZIPs or embeddings are
uploaded.

## What is in here

| Path | Purpose |
| --- | --- |
| `config/review-overrides.json` | Reviewed completeness/classification corrections per source ID |
| `config/module-map.json` | Source → KCQ module mapping, only where evidence allows it |
| `scripts/build-plan.mjs` | Local dry run: classify, dedupe, chunk, page-map, estimate |
| `scripts/ingest.mjs` | Idempotent upload to Supabase (dry run unless `--apply`) |
| `scripts/validate-local.mjs` | Runs the real migration + retrieval in PGlite (local PostgreSQL) |
| `out/` | Generated plan, chunks, exclusions, reports (not committed) |

Migration: `../supabase/migrations/2026-11-08-guide-search.sql`
Rollback: `../supabase/migrations/2026-11-08-guide-search.rollback.sql`

## Data model

- `guide_documents` — one row per distinct extracted text, keyed by the SHA-256
  of the normalised text. Holds classification, completeness, quality flags,
  stated module/edition, page-map status and review status. There is no second
  copy of the full text.
- `guide_sources` — one row per recovered export (`S0022`…), keeping notebook,
  archive path, original filename and the module association. Exports with
  identical text share one document and keep separate provenance rows.
- `guide_chunks` — section-aware passages (~1,200 characters) with heading,
  character offsets into `text_version`, optional verified printed page, and a
  generated `tsvector` with a GIN index.

Offsets always refer to `takeout-2026-11-07/text-v1` (normalised text). Changing
normalisation means a new text version and a re-ingest; rerunning is safe.

## Classification

A source is a guide only when its own wording says so: the MANCOSA guide
template (`modulefeedback@mancosa.co.za`, a standalone "MODULE GUIDE" line), a
SANTS "CURRICULUM AND LEARNING GUIDE" heading, or a filename such as
`SG`/`Mod Guide`/`CLG`/`Guideline`. Resale exam packs (Stuvia) are excluded,
and anything shorter than 1,000 characters or without a marker is ambiguous.

Only `guide` sources are ingested and searchable (`review_status = approved`).
`ingest.mjs` hard-filters `classification === 'guide'`, so assignments, tutorial
letters, question papers, rubrics and exam packs are never uploaded — they are
written to `out/excluded.jsonl` and stay on disk only. Ambiguous items are
excluded too; admitting one requires an explicit entry in
`config/review-overrides.json` and a rerun of the plan.

## Page references

`findPageMarkers` accepts a printed-page footer only when one distinctive
running header repeats at least five times with strictly increasing numbers
(generic heads such as `SECTION`, `MANCOSA` or `PAGE` are ignored). Chunks
inherit the last footer at or before their start. Chunks without a verified
footer store `page_ref = null`; the function returns `page_ref_status` so the
caller can tell the difference between "no page" and "page unknown".

## Commands

```bash
cd guides
npm install                      # PGlite for local validation only

GUIDE_SOURCE_ROOT="C:/.../outputs" node scripts/build-plan.mjs
npm test                         # classification policy (guides vs assessments)
node scripts/validate-local.mjs  # migration + retrieval + RLS, no network
node scripts/ingest.mjs          # dry run: prints what would be written
node scripts/ingest.mjs --apply  # writes to Supabase (approval required)
node scripts/ingest.mjs --apply --only S0634,S0076   # pilot subset
```

`GUIDE_SOURCE_ROOT` defaults to the recovered Takeout folder on this machine.
The ingest script reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
`server/.env` and never prints them.

## Retrieval

`public.search_guide_chunks(query_text, p_module_id, p_limit, p_include_unassigned)`
returns ranked passages with source title, section heading, offsets, verified
page (nullable), completeness, page-map status and a highlighted snippet.
Module-mapped (`validated`) sources rank first when a module is supplied;
unassigned material is included unless `p_include_unassigned` is false. Only
`review_status = 'approved'` documents are searchable.

The extension uses it in `shared.js` → `KCQ.searchGuidePassages`, wired into
`background.js` as the `getExcerpts` dependency of `KCQAI.createAnswerer`.
`ai.js` prefers library passages, labels them with title/section/page in the
model prompt, warns the model when a source is partial, returns `citations` and
`evidence` with the answer, and falls back to locally pasted guides if the RPC
is missing or offline.

## Access control

RLS is enabled on all three tables with `select` policies only, matching the
project's public-read model. Writes require the service role used by the
ingestion script. Tested locally: a non-owner role can read but an insert fails
on the RLS policy.

## Current state (deployed 8 November 2026)

201 candidates → 125 guide sources → 102 distinct texts → 9,206 chunks,
259 with a verified printed page. 76 excluded (59 assessment, 7 generated,
10 ambiguous).

Measured in production: `guide_chunks` 32 MB (GIN index 6.9 MB),
`guide_documents` 152 kB, `guide_sources` 136 kB; whole database 48 MB.
That is 3.7× the 8.63 MiB of chunk text — the estimate before ingest was
26 MiB, so it under-called by about 23%.

## Deployment record (8 November 2026)

Applied with approval in this order: migration run in the SQL editor → 3-document
pilot (`--apply --limit 3`, 397 chunks) → retrieval fixtures → full ingest
(`--apply`, 102 documents, 0 failures) → `verify-retrieval.mjs` 7/7.

Re-running ingestion is safe at any time:

```bash
node guides/scripts/build-plan.mjs      # recompute from the recovered text
node guides/scripts/ingest.mjs          # dry run, compare counts
node guides/scripts/ingest.mjs --apply  # update in place, no duplicates
```

Rollback: run `2026-11-08-guide-search.rollback.sql`. It drops only the guide
tables and function; `modules`, `questions` and the screenshots bucket are
untouched.

## Free model setup (extension)

Endpoint `https://openrouter.ai/api/v1/chat/completions`, and put the free
models in priority order in the Model box — they fail one by one, so the
extension falls through to the next:

```
dots-studio/dots-3-note-preview:free, nvidia/nemotron-3.5-lightning:free, cohere/north-mini-code:free, google/gemma-4-31b-it:free
```

OpenRouter's free tier is almost entirely reasoning models; the extension sends
`reasoning: {enabled: false}`, without which they spend every token thinking and
return empty content. Free cap is 1,000 requests/day and 20/minute. Measured on
the 4-question mock quiz: 4/4 correct, ~3–16 s per answer.

Avoid the "free unlimited AI" proxy repos (g4f bridges, keyless gateways,
Puter account pools): they scrape provider web endpoints, break often, and would
send this guide text to an untrusted third party.

## Known limitations

- Some exports stop mid-document (S0076, S0505 and others flagged in
  `out/DRY-RUN-REPORT.md`); partial status is stored and surfaced, never hidden.
- Page maps exist for four documents only; elsewhere `page_ref` is null.
- No module is `validated` yet. `S0806` is a proposed match awaiting review, so
  module-filtered search currently relies on the unassigned pool.
- Tables, formulas and diagrams degraded in plain-text extraction; retrieval
  cannot recover what the export lost.
- NotebookLM notebook names are not module labels and are kept only as
  provenance.
