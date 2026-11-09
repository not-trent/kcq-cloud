# Local validation (PGlite, PostgreSQL in WASM)

Migration: `supabase/migrations/2026-11-08-guide-search.sql`
Fixture: "BCOMSCM Business Management 2.pdf", "HCPM - Public Finance.pdf", "Generic - Microeconomic Essentials (2).pdf", "MAND152 2026 02 SG.pdf"

Result: 12/12 checks passed.

- PASS — migration applies on a database that already has modules/questions
- PASS — migration is idempotent
- PASS — fixture ingestion writes documents, provenance and chunks
- PASS — retrieval returns relevant passages with source title and section
- PASS — a full question with its options still matches (no AND-trap)
- PASS — incomplete guide is retrievable and marked partial
- PASS — page numbers appear only where a footer map was verified
- PASS — module filter can exclude unassigned material
- PASS — pending documents are not returned
- PASS — missing material returns nothing instead of a fabricated passage
- PASS — re-running ingestion keeps counts stable
- PASS — public role can read but not write guide tables

## Measured size of the fixture

- Chunk rows: 547
- Chunk text: 0.52 MiB
- guide_chunks total (text + tsvector + GIN + overhead): 1.55 MiB
- search index only: 0.38 MiB
- guide_documents + guide_sources: 128 KiB
- Ratio: 3.01x chunk text

These are fixture numbers from an in-process database, not the full library or the Supabase project.
