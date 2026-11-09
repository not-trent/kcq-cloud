// Exercises the extension's real code against the live guide library.
// Loads shared.js + ai.js unchanged, wires getExcerpts exactly as background.js
// does, and stubs only the model call. Network access is the same anon key the
// extension uses.
//
//   node guides/test/extension-live.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, '../../extension/extension');
const read = (name) => fs.readFileSync(path.join(extDir, name), 'utf8');

const storage = {};
const sandbox = {
  console,
  crypto: globalThis.crypto,
  TextEncoder,
  AbortSignal,
  setTimeout,
  clearTimeout,
  URL,
  fetch: (...args) => fetch(...args),
  chrome: {
    storage: {
      local: {
        get: async (key) => (Array.isArray(key)
          ? Object.fromEntries(key.map((k) => [k, storage[k]]))
          : { [key]: storage[key] }),
        set: async (obj) => Object.assign(storage, obj),
      },
    },
  },
};
vm.createContext(sandbox);
vm.runInContext(`${read('shared.js')}; globalThis.KCQ = KCQ;`, sandbox);
vm.runInContext(`${read('ai.js')}; globalThis.KCQAI = KCQAI;`, sandbox);
const { KCQ, KCQAI } = sandbox;

let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`); };

let prompt = '';
let cache = {};
const answerer = KCQAI.createAnswerer({
  getExcerpts: (payload) => KCQ.searchGuidePassages(payload),
  getGuides: async () => ({}),
  getBank: async () => [],
  callModel: async (text) => { prompt = text; return 'B|high'; },
  cacheGet: async () => cache,
  cacheSet: async (next) => { cache = next; },
});

const question = {
  text: "According to Herzberg's motivation-hygiene theory, which of the following is a hygiene factor rather than a motivator?",
  options: [
    { letter: 'A', text: 'Recognition from supervisors' },
    { letter: 'B', text: 'Salary and working conditions' },
    { letter: 'C', text: 'Achievement of challenging goals' },
    { letter: 'D', text: 'Responsibility for own work' },
  ],
};

const result = await answerer.answer({ moduleName: 'Business Management 2', question });

await test('the extension fetches passages from the live library', async () => {
  assert.equal(result.evidence, 'library', `evidence was ${result.evidence}${result.libraryError ? ` (${result.libraryError})` : ''}`);
  assert.ok(result.citations.length > 0, 'no citations returned');
  assert.ok(result.citations[0].title, 'citation has no title');
  console.log(`     top passage: ${result.citations[0].title} — ${result.citations[0].section || 'no heading'}${result.citations[0].pageRef ? ` — p. ${result.citations[0].pageRef}` : ''}`);
});

await test('the model prompt carries title, section and page for checking', async () => {
  assert.match(prompt, /Reference excerpts \(primary source\)/);
  assert.match(prompt, /BCOMSCM Business Management 2\.pdf/);
  assert.match(prompt, /— (CHAPTER \d|[\d.]+\s|)/);
  assert.doesNotMatch(prompt, /p\. null/);
  assert.match(prompt, /B\. Salary and working conditions/);
});

await test('the answer keeps the citations for the panel', async () => {
  assert.equal(result.letter, 'B');
  assert.equal(result.source, 'ai');
  assert.ok(result.citations.every((citation) => citation.sourceId && citation.title));
});

const second = KCQAI.createAnswerer({
  getExcerpts: (payload) => KCQ.searchGuidePassages(payload),
  getGuides: async () => ({}),
  getBank: async () => [],
  callModel: async () => 'UNSURE',
  cacheGet: async () => ({}),
  cacheSet: async () => {},
});
const offTopic = await second.answer({
  moduleName: 'Business Management 2',
  question: {
    text: 'Describe the thylakoid membrane and chlorophyll absorbance.',
    options: [{ letter: 'A', text: 'Thylakoid lumen' }, { letter: 'B', text: 'Chlorophyll a' }],
  },
});

await test('a question with no matching guide reports no library evidence', async () => {
  assert.equal(offTopic.evidence, 'none');
  assert.equal(offTopic.citations.length, 0);
  assert.equal(offTopic.needsChecking, true);
});

await test('module names resolve to KCQ module ids without breaking unassigned search', async () => {
  const rows = await KCQ.searchGuidePassages({ moduleName: 'Introduction to Human Resource Management Jul26 Y1 S1', query: 'recruitment selection process' });
  assert.ok(Array.isArray(rows), 'no array returned');
  console.log(`     ${rows.length} passages for a KCQ module with no mapped guide (falls back to the unassigned pool)`);
});

console.log(`\n${passed} live checks passed`);
