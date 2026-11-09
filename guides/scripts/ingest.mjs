// Uploads the dry-run plan to Supabase. Dry run unless --apply is passed.
//
//   node guides/scripts/ingest.mjs                 # prints what would be written
//   node guides/scripts/ingest.mjs --apply         # writes (requires approval)
//   node guides/scripts/ingest.mjs --apply --only S0634,S0076
//   node guides/scripts/ingest.mjs --apply --limit 3
//
// Idempotent: documents key on content_hash, sources key on their S-id, and
// chunks key on (document_id, chunk_index). Re-running updates instead of
// duplicating, and deletes chunks that no longer exist in the plan.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guideRoot = path.resolve(here, '..');
const outDir = path.join(guideRoot, 'out');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const apply = flag('--apply');
const only = (value('--only') || '').split(',').map((id) => id.trim()).filter(Boolean);
const limit = Number(value('--limit') || 0);

function loadEnv() {
  const file = path.join(guideRoot, '..', 'server', '.env');
  const env = { ...process.env };
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const index = line.indexOf('=');
      const key = line.slice(0, index).trim();
      const val = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (!env[key]) env[key] = val;
    }
  }
  return env;
}

const env = loadEnv();
const baseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in server/.env.');
  process.exit(1);
}

async function request(route, { method = 'GET', body, prefer, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${route}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`${method} ${route.split('?')[0]} → HTTP ${response.status}: ${detail}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const plan = JSON.parse(fs.readFileSync(path.join(outDir, 'plan.json'), 'utf8'));
const chunks = fs.readFileSync(path.join(outDir, 'chunks.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

const byHash = new Map();
for (const chunk of chunks) {
  if (!byHash.has(chunk.content_hash)) byHash.set(chunk.content_hash, []);
  byHash.get(chunk.content_hash).push(chunk);
}

// Only module guides are ever uploaded. This is a hard filter, not a default:
// assessments, tutorial letters, question papers and exam packs never leave this machine.
let documents = plan.documents.filter((doc) => doc.classification === 'guide' && doc.review_status === 'approved');
if (only.length) documents = documents.filter((doc) => doc.sources.some((source) => only.includes(source.id)));
if (limit) documents = documents.slice(0, limit);

const selectedHashes = new Set(documents.map((doc) => doc.content_hash));
const chunkTotal = documents.reduce((sum, doc) => sum + (byHash.get(doc.content_hash)?.length || 0), 0);
const sourceTotal = documents.reduce((sum, doc) => sum + doc.sources.length, 0);

console.log(`Target: ${baseUrl}`);
console.log(`Documents: ${documents.length}, sources: ${sourceTotal}, chunks: ${chunkTotal}`);
if (!only.length && !limit) {
  console.log(`Library coverage: ${documents.length}/${plan.counts.approved_documents} approved documents (full plan).`);
}
if (!apply) {
  console.log('Dry run only. Nothing written. Re-run with --apply after the migration and approval.');
  process.exit(0);
}

// Guard: the migration must exist before writing.
try {
  await request('guide_documents?select=id&limit=1');
} catch (error) {
  if (/HTTP 404/.test(error.message)) {
    console.error('guide_documents does not exist. Run supabase/migrations/2026-11-08-guide-search.sql in the SQL editor first.');
  } else {
    console.error(`Preflight failed: ${error.message}`);
  }
  process.exit(1);
}

const moduleRows = await request('modules?select=id,slug');
const moduleIdBySlug = new Map(moduleRows.map((row) => [row.slug, row.id]));

const log = { started_at: new Date().toISOString(), target: baseUrl, documents: [], failures: [] };

const batch = (rows, size) => rows.reduce((acc, row, i) => {
  if (i % size === 0) acc.push([]);
  acc[acc.length - 1].push(row);
  return acc;
}, []);

for (const doc of documents) {
  const docChunks = (byHash.get(doc.content_hash) || [])
    .sort((a, b) => a.chunk_index - b.chunk_index);
  try {
    const [saved] = await request('guide_documents?on_conflict=content_hash&select=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: [{
        content_hash: doc.content_hash,
        title: doc.title,
        text_version: doc.text_version,
        char_count: doc.char_count,
        chunk_count: docChunks.length,
        classification: doc.classification,
        classification_reason: doc.classification_reason,
        completeness: doc.completeness,
        quality_flags: doc.quality_flags,
        review_status: doc.review_status,
        stated_module: doc.stated_module,
        stated_edition: doc.stated_edition,
        page_map: doc.page_map,
        updated_at: new Date().toISOString(),
      }],
    });

    const sourceRows = doc.sources.map((source) => {
      const moduleId = source.module_slug ? moduleIdBySlug.get(source.module_slug) : null;
      return {
        id: source.id,
        document_id: saved.id,
        title: source.title,
        notebook: source.notebook,
        archive_path: source.archive_path,
        original_type: source.original_type,
        module_id: moduleId || null,
        module_assignment: source.module_slug && moduleId ? source.module_assignment : 'unassigned',
        module_evidence: source.module_evidence,
      };
    });
    await request('guide_sources?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: sourceRows,
    });

    for (const rows of batch(docChunks.map((chunk) => ({
      document_id: saved.id,
      chunk_index: chunk.chunk_index,
      heading: chunk.heading,
      text: chunk.text,
      char_start: chunk.char_start,
      char_end: chunk.char_end,
      page_ref: chunk.page_ref,
      page_ref_status: chunk.page_ref_status,
      page_ref_evidence: chunk.page_ref_evidence,
    })), 100)) {
      await request('guide_chunks?on_conflict=document_id,chunk_index', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: rows,
      });
    }

    await request(`guide_chunks?document_id=eq.${saved.id}&chunk_index=gte.${docChunks.length}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });

    log.documents.push({ title: doc.title, chunks: docChunks.length, sources: sourceRows.length });
    console.log(`ok  ${doc.title} — ${docChunks.length} chunks, ${sourceRows.length} source(s)`);
  } catch (error) {
    log.failures.push({ title: doc.title, content_hash: doc.content_hash, error: error.message });
    console.error(`fail ${doc.title}: ${error.message}`);
  }
}

log.finished_at = new Date().toISOString();
fs.writeFileSync(path.join(outDir, 'ingest-log.json'), JSON.stringify(log, null, 2));

// Read back the real row counts so the report can quote measured numbers.
const countOf = async (route) => {
  const response = await fetch(`${baseUrl}/rest/v1/${route}&select=id`, {
    method: 'HEAD',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact' },
  });
  const range = response.headers.get('content-range');
  return range ? Number(range.split('/')[1]) : null;
};

const measured = {
  documents: await countOf('guide_documents?review_status=eq.approved&limit=1'),
  sources: await countOf('guide_sources?limit=1'),
  chunks: await countOf('guide_chunks?limit=1'),
  planned_documents: selectedHashes.size,
  planned_chunks: chunkTotal,
};
log.measured = measured;
fs.writeFileSync(path.join(outDir, 'ingest-log.json'), JSON.stringify(log, null, 2));

console.log(`\nWrote ${log.documents.length} documents, ${log.failures.length} failures.`);
console.log(`Measured rows — documents: ${measured.documents}, sources: ${measured.sources}, chunks: ${measured.chunks}`);
console.log('Log: guides/out/ingest-log.json');
