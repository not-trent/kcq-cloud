// Post-approval check against the real Supabase project, using the same anon
// key the extension uses (read-only). Run after the migration and ingest:
//
//   node guides/scripts/verify-retrieval.mjs
//
// Any failed assertion exits non-zero. It never writes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guideRoot = path.resolve(here, '..');
const repoRoot = path.resolve(guideRoot, '..');

function loadEnv(relative) {
  const file = path.join(repoRoot, relative);
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = { ...loadEnv('client/.env'), ...process.env };
const baseUrl = String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = env.VITE_SUPABASE_ANON_KEY;
if (!baseUrl || !anonKey) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required in client/.env.');
  process.exit(1);
}

async function search(query, { moduleId = null, limit = 5, includeUnassigned = true } = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/search_guide_chunks`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query_text: query,
      p_module_id: moduleId,
      p_limit: limit,
      p_include_unassigned: includeUnassigned,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    if (response.status === 404) throw new Error('search_guide_chunks is missing — run the migration first.');
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

const assert = (condition, message) => { if (!condition) throw new Error(message); };

await check('library is populated', async () => {
  const rows = await search('business management');
  assert(rows.length > 0, 'no passages returned');
  return `${rows.length} passages`;
});

await check('ranked passages carry title and section', async () => {
  const rows = await search('herzberg motivation hygiene factors');
  assert(rows.length > 0, 'no passages');
  assert(rows.every((row) => row.title), 'a passage has no source title');
  assert(rows[0].rank >= rows[rows.length - 1].rank, 'results are not ranked');
  return `top: "${rows[0].title}" — ${rows[0].heading || 'no heading'}`;
});

await check('page numbers only where a footer map was verified', async () => {
  const rows = await search('motivation diversity conflict');
  const withPage = rows.filter((row) => row.page_ref !== null);
  assert(withPage.every((row) => row.page_ref_status === 'verified_footer'), 'an unverified page number was returned');
  return `${withPage.length}/${rows.length} with page`;
});

await check('incomplete sources are labelled partial', async () => {
  const rows = await search('irregular expenditure treasury');
  const hit = rows.find((row) => /public finance/i.test(row.title || ''));
  assert(hit, 'Public Finance passage not found');
  assert(hit.completeness === 'partial', `expected partial, got ${hit.completeness}`);
  return '"HCPM - Public Finance.pdf" — partial, page ' + (hit.page_ref ?? 'none');
});

await check('missing material returns nothing', async () => {
  const rows = await search('photosynthesis chlorophyll thylakoid');
  assert(rows.length === 0, `${rows.length} passages returned for material outside the library`);
  return '0 passages';
});

await check('blank query returns nothing', async () => {
  const rows = await search('   ');
  assert(rows.length === 0, 'blank query matched passages');
  return '0 passages';
});

await check('module-scoped search can exclude unassigned material', async () => {
  const modulesResponse = await fetch(`${baseUrl}/rest/v1/modules?select=id,name&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const modules = await modulesResponse.json();
  assert(Array.isArray(modules) && modules.length, 'no modules found');
  const rows = await search('microeconomic demand elasticity', { moduleId: modules[0].id, includeUnassigned: false });
  assert(rows.every((row) => row.module_assignment === 'validated'), 'unassigned passages leaked into a scoped search');
  return `${rows.length} validated passages for "${modules[0].name}"`;
});

const failed = results.filter((row) => !row.ok);
fs.writeFileSync(path.join(guideRoot, 'out', 'RETRIEVAL-CHECK.md'), [
  '# Retrieval check against Supabase',
  '',
  `Target: ${baseUrl}`,
  `Result: ${results.length - failed.length}/${results.length} passed`,
  '',
  ...results.map((row) => `- ${row.ok ? 'PASS' : 'FAIL'} — ${row.name}${row.detail ? ` (${row.detail})` : ''}`),
  '',
].join('\n'));

console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) process.exitCode = 1;
