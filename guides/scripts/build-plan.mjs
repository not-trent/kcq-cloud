import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalize, chunkText, findPageMarkers, pageForOffset, statedIdentity, truncationFlags, TEXT_VERSION } from './lib/text.mjs';
import { classify, reviewStatus } from './lib/classify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const guideRoot = path.resolve(here, '..');
const repoRoot = path.resolve(guideRoot, '..');

const sourceRoot = process.env.GUIDE_SOURCE_ROOT
  || 'C:/Users/arnold/Documents/Codex/2026-11-07/referenced-chatgpt-conversation-this-is-an-2/outputs';
const inventoryPath = path.join(sourceRoot, 'module-guide-inventory.json');
const outDir = path.join(guideRoot, 'out');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const overrides = readJson(path.join(guideRoot, 'config', 'review-overrides.json'));
const moduleMap = readJson(path.join(guideRoot, 'config', 'module-map.json')).mappings || {};

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function titleRank(title = '') {
  const value = title.toLowerCase();
  if (/module guide/.test(value)) return 5;
  if (/study guide/.test(value)) return 4;
  if (/learning guide|\bclg\b/.test(value)) return 3;
  if (/\bsg\b|mod guide|guideline/.test(value)) return 2;
  return 1;
}

function build() {
  if (!fs.existsSync(inventoryPath)) {
    throw new Error(`Inventory not found: ${inventoryPath}\nSet GUIDE_SOURCE_ROOT to the folder holding module-guide-inventory.json and NotebookLM-recovered/.`);
  }
  const inventory = readJson(inventoryPath);
  fs.mkdirSync(outDir, { recursive: true });

  const failures = [];
  const excluded = [];
  const documents = new Map();

  for (const record of inventory) {
    const folder = path.join(sourceRoot, 'NotebookLM-recovered', record.id);
    const textPath = path.join(folder, 'text.txt');
    if (!fs.existsSync(textPath)) {
      failures.push({ id: record.id, title: record.title, reason: 'text.txt missing' });
      continue;
    }

    const raw = fs.readFileSync(textPath, 'utf8');
    const text = normalize(raw);
    if (!text) {
      excluded.push({ id: record.id, title: record.title, classification: 'empty', reason: 'no extracted text' });
      continue;
    }

    const verdict = classify(record, overrides.classification || {});
    const status = reviewStatus(verdict.classification);
    if (status !== 'approved') {
      excluded.push({ id: record.id, title: record.title, classification: verdict.classification, reason: verdict.reason, chars: text.length });
      continue;
    }

    const sourceOverride = overrides.sources?.[record.id] || {};
    const hash = sha256(text);
    let document = documents.get(hash);
    if (!document) {
      const pageMap = findPageMarkers(text);
      const identity = statedIdentity(text);
      const flags = [...truncationFlags(text), ...(sourceOverride.flags || [])];
      document = {
        content_hash: hash,
        text_version: TEXT_VERSION,
        char_count: text.length,
        title: record.title,
        classification: verdict.classification,
        classification_reason: verdict.reason,
        stated_module: identity.stated_module,
        stated_code: identity.stated_code,
        stated_edition: identity.stated_edition,
        completeness: sourceOverride.completeness || (flags.some((flag) => /mid-sentence|more pages/.test(flag)) ? 'partial' : 'substantial'),
        quality_flags: [...new Set(flags)],
        page_map: pageMap.status,
        page_map_evidence: pageMap.evidence,
        review_status: 'approved',
        sources: [],
        chunks: chunkText(text, { target: 1200, max: 2000 })
          // Contents pages are dot-leader rows, not prose: keep them out of the index.
          .filter((chunk) => (chunk.text.match(/\.{4,}/g) || []).length < 3 && chunk.text.replace(/[\d\s.,|]/g, '').length > 40)
          .map((chunk, index) => {
            const page = pageForOffset(pageMap, chunk.char_start);
            return { ...chunk, index, ...page };
          }),
      };
      documents.set(hash, document);
    }

    if (titleRank(record.title) > titleRank(document.title)) document.title = record.title;

    const mapping = moduleMap[record.id] || null;
    document.sources.push({
      id: record.id,
      title: record.title,
      notebook: record.notebook,
      archive_path: record.archive_path,
      original_type: record.original_type,
      module_slug: mapping?.module_slug || null,
      module_assignment: mapping?.status || 'unassigned',
      module_evidence: mapping?.evidence || null,
    });
  }

  const docs = [...documents.values()].sort((a, b) => a.content_hash.localeCompare(b.content_hash));
  const failuresFile = path.join(outDir, 'failures.jsonl');
  const excludedFile = path.join(outDir, 'excluded.jsonl');
  const chunksFile = path.join(outDir, 'chunks.jsonl');

  fs.writeFileSync(failuresFile, failures.map((row) => JSON.stringify(row)).join('\n') + (failures.length ? '\n' : ''));
  fs.writeFileSync(excludedFile, excluded.map((row) => JSON.stringify(row)).join('\n') + (excluded.length ? '\n' : ''));

  const chunkLines = [];
  for (const doc of docs) {
    for (const chunk of doc.chunks) {
      chunkLines.push(JSON.stringify({
        content_hash: doc.content_hash,
        chunk_index: chunk.index,
        heading: chunk.heading,
        text: chunk.text,
        char_start: chunk.char_start,
        char_end: chunk.char_end,
        page_ref: chunk.page_ref,
        page_ref_status: chunk.page_ref_status,
        page_ref_evidence: chunk.page_ref_evidence,
      }));
    }
  }
  fs.writeFileSync(chunksFile, chunkLines.join('\n') + (chunkLines.length ? '\n' : ''));

  const textBytes = docs.reduce((sum, doc) => sum + Buffer.byteLength(doc.chunks.map((chunk) => chunk.text).join(' '), 'utf8'), 0);
  const chunkCount = docs.reduce((sum, doc) => sum + doc.chunks.length, 0);
  const pageRefs = docs.reduce((sum, doc) => sum + doc.chunks.filter((chunk) => chunk.page_ref).length, 0);
  const estimate = {
    text_bytes: textBytes,
    chunk_rows: chunkCount,
    estimated_tsvector_bytes: Math.round(textBytes * 0.45),
    estimated_gin_index_bytes: Math.round(textBytes * 0.6),
    estimated_row_overhead_bytes: chunkCount * 220,
    estimated_total_bytes: Math.round(textBytes * 3.7),
    note: 'Estimate only, 3.7x chunk text — the ratio measured in production after the 2026-11-08 ingest (guide_chunks 32 MB for 8.63 MiB of text). Re-measure with pg_total_relation_size after any large ingest.',
  };

  const plan = {
    text_version: TEXT_VERSION,
    source_root: sourceRoot,
    inventory: inventoryPath,
    counts: {
      inventory_records: inventory.length,
      approved_documents: docs.length,
      approved_sources: docs.reduce((sum, doc) => sum + doc.sources.length, 0),
      chunks: chunkCount,
      chunks_with_verified_page: pageRefs,
      excluded: excluded.length,
      failures: failures.length,
    },
    storage_estimate: estimate,
    documents: docs.map((doc) => ({
      content_hash: doc.content_hash,
      title: doc.title,
      text_version: doc.text_version,
      char_count: doc.char_count,
      chunk_count: doc.chunks.length,
      classification: doc.classification,
      classification_reason: doc.classification_reason,
      stated_module: doc.stated_module,
      stated_code: doc.stated_code,
      stated_edition: doc.stated_edition,
      completeness: doc.completeness,
      quality_flags: doc.quality_flags,
      page_map: doc.page_map,
      page_map_evidence: doc.page_map_evidence,
      review_status: doc.review_status,
      sources: doc.sources,
    })),
  };
  fs.writeFileSync(path.join(outDir, 'plan.json'), JSON.stringify(plan, null, 2));

  const byReason = excluded.reduce((acc, row) => {
    acc[row.classification] = (acc[row.classification] || 0) + 1;
    return acc;
  }, {});

  const report = [
    '# Guide ingestion dry run',
    '',
    `Source root: \`${sourceRoot}\``,
    `Text version: \`${TEXT_VERSION}\``,
    '',
    '## Counts',
    '',
    `- Inventory records: ${plan.counts.inventory_records}`,
    `- Approved documents (deduplicated text): ${plan.counts.approved_documents}`,
    `- Approved sources (all provenance rows): ${plan.counts.approved_sources}`,
    `- Chunks: ${plan.counts.chunks}`,
    `- Chunks with a verified printed page: ${plan.counts.chunks_with_verified_page}`,
    `- Excluded: ${plan.counts.excluded} (${Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`,
    `- Failures: ${plan.counts.failures}`,
    '',
    '## Storage estimate (not measured)',
    '',
    `- Chunk text: ${(textBytes / 1024 / 1024).toFixed(2)} MiB`,
    `- Estimated total table footprint: ${(estimate.estimated_total_bytes / 1024 / 1024).toFixed(2)} MiB`,
    `- ${estimate.note}`,
    '',
    '## Page maps',
    '',
    ...docs.filter((doc) => doc.page_map !== 'none').map((doc) => `- ${doc.title}: ${doc.page_map} — ${doc.page_map_evidence}`),
    ...(docs.every((doc) => doc.page_map === 'none') ? ['- No document produced a trustworthy footer page map; all page references are null.'] : []),
    '',
    '## Partial or flagged documents',
    '',
    ...docs.filter((doc) => doc.completeness === 'partial' || doc.quality_flags.length).map((doc) => `- ${doc.title} (${doc.completeness}): ${doc.quality_flags.join('; ') || 'flagged by review override'}`),
    '',
    '## Duplicate texts',
    '',
    ...docs.filter((doc) => doc.sources.length > 1).map((doc) => `- ${doc.sources.map((source) => source.id).join(', ')} → one document "${doc.title}"`),
    '',
    '## Excluded',
    '',
    ...excluded.sort((a, b) => a.id.localeCompare(b.id)).map((row) => `- ${row.id} [${row.classification}] ${row.title} — ${row.reason}`),
    '',
    '## Failures',
    '',
    ...(failures.length ? failures.map((row) => `- ${row.id} ${row.title}: ${row.reason}`) : ['- None']),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'DRY-RUN-REPORT.md'), report);

  return plan;
}

const plan = build();
console.log(JSON.stringify(plan.counts, null, 2));
console.log(`estimated footprint: ${(plan.storage_estimate.estimated_total_bytes / 1024 / 1024).toFixed(2)} MiB (estimate)`);
console.log(`outputs: ${outDir}`);
