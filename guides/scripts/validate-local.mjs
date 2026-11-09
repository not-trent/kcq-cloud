// Runs the real migration against an in-process PostgreSQL (PGlite) with a
// representative slice of the plan, then exercises retrieval, access control
// and re-ingestion. No Supabase project is contacted.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const guideRoot = path.resolve(here, '..');
const repoRoot = path.resolve(guideRoot, '..');
const outDir = path.join(guideRoot, 'out');

const plan = JSON.parse(fs.readFileSync(path.join(outDir, 'plan.json'), 'utf8'));
const chunks = fs.readFileSync(path.join(outDir, 'chunks.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const migration = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '2026-11-08-guide-search.sql'), 'utf8');

const byHash = new Map();
for (const chunk of chunks) {
  if (!byHash.has(chunk.content_hash)) byHash.set(chunk.content_hash, []);
  byHash.get(chunk.content_hash).push(chunk);
}

const pick = (title) => {
  const doc = plan.documents.find((entry) => entry.title === title);
  if (!doc) throw new Error(`Fixture missing from plan: ${title}`);
  return doc;
};

const fixtures = [
  pick('BCOMSCM Business Management 2.pdf'),            // substantially complete, footer page map
  pick('HCPM - Public Finance.pdf'),                    // incomplete export
  pick('Generic - Microeconomic Essentials (2).pdf'),   // proposed module mapping
  pick('MAND152 2026 02 SG.pdf'),                       // duplicate pair (S0039 / S0187 / S0192)
];

const db = await PGlite.create();
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
};

// Minimal stand-ins for the existing application tables the migration references.
await db.exec(`
  create table modules (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    slug text not null,
    created_at timestamptz not null default now()
  );
  create table questions (
    id uuid primary key default gen_random_uuid(),
    module_id uuid not null references modules(id) on delete cascade,
    question text not null default ''
  );
  insert into modules (name, slug) values ('Microeconomic Essentials (SCOM) Jan26 Y1 S2', 'microeconomic-essentials-jul26-y1-s1');
  insert into questions (module_id, question) select id, 'Existing question must survive' from modules;
`);

await check('migration applies on a database that already has modules/questions', async () => {
  await db.exec(migration);
  const { rows } = await db.query('select count(*)::int as n from guide_documents');
  assert.equal(rows[0].n, 0);
  const questions = await db.query('select count(*)::int as n from questions');
  assert.equal(questions.rows[0].n, 1);
});

await check('migration is idempotent', async () => {
  await db.exec(migration);
});

const moduleId = (await db.query('select id from modules limit 1')).rows[0].id;

async function insertFixture(docs) {
  for (const doc of docs) {
    const rows = (byHash.get(doc.content_hash) || []).sort((a, b) => a.chunk_index - b.chunk_index);
    const saved = await db.query(
      `insert into guide_documents
        (content_hash, title, text_version, char_count, chunk_count, classification, classification_reason,
         completeness, quality_flags, review_status, stated_module, stated_edition, page_map)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)
       on conflict (content_hash) do update set title = excluded.title, chunk_count = excluded.chunk_count,
         completeness = excluded.completeness, page_map = excluded.page_map, updated_at = now()
       returning id`,
      [doc.content_hash, doc.title, doc.text_version, doc.char_count, rows.length, doc.classification,
        doc.classification_reason, doc.completeness, JSON.stringify(doc.quality_flags), doc.review_status,
        doc.stated_module, doc.stated_edition, doc.page_map]
    );
    const documentId = saved.rows[0].id;

    for (const source of doc.sources) {
      await db.query(
        `insert into guide_sources (id, document_id, title, notebook, archive_path, original_type, module_id, module_assignment, module_evidence)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set document_id = excluded.document_id, title = excluded.title`,
        [source.id, documentId, source.title, source.notebook, source.archive_path, source.original_type,
          source.module_slug === 'microeconomic-essentials-jul26-y1-s1' ? moduleId : null,
          source.module_slug ? source.module_assignment : 'unassigned', source.module_evidence]
      );
    }

    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const values = [];
      const params = [];
      batch.forEach((chunk, index) => {
        const base = index * 9;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`);
        params.push(documentId, chunk.chunk_index, chunk.heading, chunk.text, chunk.char_start, chunk.char_end,
          chunk.page_ref, chunk.page_ref_status, chunk.page_ref_evidence);
      });
      await db.query(
        `insert into guide_chunks (document_id, chunk_index, heading, text, char_start, char_end, page_ref, page_ref_status, page_ref_evidence)
         values ${values.join(',')}
         on conflict (document_id, chunk_index) do update set text = excluded.text, heading = excluded.heading,
           char_start = excluded.char_start, char_end = excluded.char_end, page_ref = excluded.page_ref,
           page_ref_status = excluded.page_ref_status, page_ref_evidence = excluded.page_ref_evidence`,
        params
      );
    }
  }
}

await check('fixture ingestion writes documents, provenance and chunks', async () => {
  await insertFixture(fixtures);
  const counts = (await db.query(`select
      (select count(*)::int from guide_documents) as docs,
      (select count(*)::int from guide_sources) as sources,
      (select count(*)::int from guide_chunks) as chunks`)).rows[0];
  assert.equal(counts.docs, fixtures.length);
  assert.ok(counts.sources >= fixtures.length, 'duplicate sources must keep separate provenance rows');
  assert.ok(counts.chunks > 500, `expected a full slice of chunks, got ${counts.chunks}`);
});

const search = async (query, opts = {}) => (await db.query(
  'select * from search_guide_chunks($1, $2, $3, $4)',
  [query, opts.moduleId ?? null, opts.limit ?? 5, opts.includeUnassigned ?? true]
)).rows;

await check('retrieval returns relevant passages with source title and section', async () => {
  const rows = await search('herzberg motivation hygiene factors');
  assert.ok(rows.length > 0, 'no passages returned');
  assert.ok(rows.some((row) => /motivation|herzberg/i.test(row.chunk_text)), 'top passages are not about motivation');
  assert.ok(rows.every((row) => row.title && row.heading !== undefined));
  assert.ok(rows[0].rank >= rows[rows.length - 1].rank, 'results must be ranked');
});

await check('a full question with its options still matches (no AND-trap)', async () => {
  const rows = await search("According to Herzberg's motivation-hygiene theory, which of the following is a hygiene factor rather than a motivator? Recognition Salary Achievement Responsibility");
  assert.ok(rows.length > 0, 'a long natural-language question returned nothing');
  assert.ok(rows.some((row) => /BCOMSCM Business Management 2/i.test(row.title)), 'the motivation guide was not surfaced');
});

await check('incomplete guide is retrievable and marked partial', async () => {
  const rows = await search('irregular expenditure treasury control');
  const hit = rows.find((row) => /public finance/i.test(row.title));
  assert.ok(hit, 'Public Finance passages missing');
  const doc = (await db.query('select completeness from guide_documents where id = $1', [hit.document_id])).rows[0];
  assert.equal(doc.completeness, 'partial');
});

await check('page numbers appear only where a footer map was verified', async () => {
  const rows = await db.query(`select page_ref, page_ref_status, page_ref_evidence from guide_chunks where page_ref is not null limit 200`);
  assert.ok(rows.rows.length > 0, 'expected some verified page references');
  for (const row of rows.rows) {
    assert.equal(row.page_ref_status, 'verified_footer');
    assert.match(row.page_ref_evidence, /printed footers/);
  }
  const unverified = await db.query(`select count(*)::int as n from guide_chunks where page_ref is null and page_ref_status <> 'none'`);
  assert.equal(unverified.rows[0].n, 0);
});

await check('module filter can exclude unassigned material', async () => {
  await db.query(`update guide_sources set module_assignment = 'validated', module_id = $1 where id = 'S0806'`, [moduleId]);
  const scoped = await search('microeconomic demand elasticity', { moduleId, includeUnassigned: false });
  assert.ok(scoped.length > 0, 'module-scoped search returned nothing');
  assert.ok(scoped.every((row) => row.module_id === moduleId));

  const other = await db.query('insert into modules (name, slug) values ($1,$2) returning id', ['Other module', 'other-module']);
  const none = await search('microeconomic demand elasticity', { moduleId: other.rows[0].id, includeUnassigned: false });
  assert.equal(none.length, 0, 'unassigned guides leaked into a scoped search');
});

await check('pending documents are not returned', async () => {
  await db.query(`update guide_documents set review_status = 'pending_review' where title = $1`, ['HCPM - Public Finance.pdf']);
  const rows = await search('irregular expenditure treasury control');
  assert.ok(!rows.some((row) => /public finance/i.test(row.title)), 'pending document returned');
  await db.query(`update guide_documents set review_status = 'approved' where title = $1`, ['HCPM - Public Finance.pdf']);
});

await check('missing material returns nothing instead of a fabricated passage', async () => {
  const rows = await search('photosynthesis chlorophyll thylakoid membrane');
  assert.equal(rows.length, 0);
  const empty = await search('   ');
  assert.equal(empty.length, 0);
});

await check('re-running ingestion keeps counts stable', async () => {
  const before = (await db.query(`select
      (select count(*)::int from guide_documents) as docs,
      (select count(*)::int from guide_sources) as sources,
      (select count(*)::int from guide_chunks) as chunks`)).rows[0];
  await insertFixture(fixtures);
  const after = (await db.query(`select
      (select count(*)::int from guide_documents) as docs,
      (select count(*)::int from guide_sources) as sources,
      (select count(*)::int from guide_chunks) as chunks`)).rows[0];
  assert.deepEqual(after, before);
});

await check('public role can read but not write guide tables', async () => {
  const policies = await db.query(`select tablename from pg_policies where tablename like 'guide_%' order by tablename`);
  assert.equal(policies.rows.length, 3);
  await db.exec(`create role app_anon nologin; grant usage on schema public to app_anon;
    grant select, insert, update, delete on guide_documents, guide_sources, guide_chunks to app_anon;
    grant execute on function search_guide_chunks(text, uuid, integer, boolean) to app_anon;`);
  await db.exec('set role app_anon');
  const readable = await db.query('select count(*)::int as n from guide_documents');
  assert.ok(readable.rows[0].n > 0);
  // Supabase grants table privileges to anon too; RLS must be what blocks the write.
  await assert.rejects(
    db.query(`insert into guide_documents (content_hash, title, text_version, char_count) values ('x','x','x',1)`),
    /row-level security|permission denied/i
  );
  await db.exec('reset role');
});

await db.exec('vacuum full');

const sizes = (await db.query(`select
    pg_total_relation_size('guide_chunks') as chunks,
    pg_total_relation_size('guide_chunks_search_idx') as gin,
    pg_total_relation_size('guide_documents') as docs,
    pg_total_relation_size('guide_sources') as sources`)).rows[0];
const textBytes = (await db.query(`select coalesce(sum(octet_length(text)),0)::bigint as n from guide_chunks`)).rows[0].n;
const chunkRows = (await db.query('select count(*)::int as n from guide_chunks')).rows[0].n;

const failed = results.filter((row) => !row.ok);
const report = [
  '# Local validation (PGlite, PostgreSQL in WASM)',
  '',
  `Migration: \`supabase/migrations/2026-11-08-guide-search.sql\``,
  `Fixture: ${fixtures.map((doc) => `"${doc.title}"`).join(', ')}`,
  '',
  `Result: ${results.length - failed.length}/${results.length} checks passed.`,
  '',
  ...results.map((row) => `- ${row.ok ? 'PASS' : 'FAIL'} — ${row.name}${row.ok ? '' : `: ${row.error}`}`),
  '',
  '## Measured size of the fixture',
  '',
  `- Chunk rows: ${chunkRows}`,
  `- Chunk text: ${(Number(textBytes) / 1024 / 1024).toFixed(2)} MiB`,
  `- guide_chunks total (text + tsvector + GIN + overhead): ${(Number(sizes.chunks) / 1024 / 1024).toFixed(2)} MiB`,
  `- search index only: ${(Number(sizes.gin) / 1024 / 1024).toFixed(2)} MiB`,
  `- guide_documents + guide_sources: ${((Number(sizes.docs) + Number(sizes.sources)) / 1024).toFixed(0)} KiB`,
  `- Ratio: ${(Number(sizes.chunks) / Number(textBytes)).toFixed(2)}x chunk text`,
  '',
  'These are fixture numbers from an in-process database, not the full library or the Supabase project.',
  '',
].join('\n');

fs.writeFileSync(path.join(outDir, 'VALIDATION-LOCAL.md'), report);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Report: guides/out/VALIDATION-LOCAL.md`);
if (failed.length) process.exitCode = 1;
