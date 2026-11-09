// Run: node extension/test/extension.test.mjs <path-to-jsdom-package-dir>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, '..');
const require = createRequire(path.resolve(process.argv[2] || '.', 'package.json'));
const { JSDOM } = require('jsdom');
const read = (name) => fs.readFileSync(path.join(extDir, name), 'utf8');

// ---------- in-memory Supabase REST ----------
const db = { modules: [], questions: [] };
let idCounter = 0;
const parseFilters = (query) => Object.fromEntries(new URLSearchParams(query));

async function fakeFetch(url, init = {}) {
  const u = new URL(url);
  const table = u.pathname.split('/').pop();
  const filters = parseFilters(u.search);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  const json = (data, status = 200) => ({ ok: true, status, text: async () => JSON.stringify(data) });

  if (method === 'POST') {
    const rows = (Array.isArray(body) ? body : [body]).map((row) => ({ id: `id${++idCounter}`, image_path: null, ...row }));
    db[table].push(...rows);
    // Real PostgREST returns an empty body unless Prefer: return=representation is sent.
    if (!String(init.headers?.Prefer || '').includes('return=representation')) {
      return { ok: true, status: 201, text: async () => '' };
    }
    return json(rows, 201);
  }
  if (method === 'PATCH') {
    const id = filters.id.replace('eq.', '');
    Object.assign(db[table].find((r) => r.id === id), body);
    return { ok: true, status: 204, text: async () => '' };
  }
  let rows = db[table];
  if (filters.name) rows = rows.filter((r) => r.name.toLowerCase() === decodeURIComponent(filters.name.replace('ilike.', '')).toLowerCase());
  if (filters.module_id) rows = rows.filter((r) => r.module_id === filters.module_id.replace('eq.', ''));
  if (filters.image_hash) {
    const list = filters.image_hash.replace(/^in\.\(|\)$/g, '').split(',');
    rows = rows.filter((r) => list.includes(r.image_hash));
  }
  return json(rows);
}

// ---------- load shared.js ----------
const sandbox = {
  chrome: { storage: { local: { get: async () => ({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' }) } } },
  fetch: fakeFetch, crypto: globalThis.crypto, TextEncoder, URL, AbortSignal, console,
};
vm.createContext(sandbox);
vm.runInContext(`${read('shared.js')}; globalThis.KCQ = KCQ;`, sandbox);
const { KCQ } = sandbox;

const options = ['a, c, e', 'c, d, e', 'c, b, d', 'a, b, c'];
const Q = 'A company is struggling to retain employees. Why might this occur? a. neglects b. innovation';
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`); };

await test('first save with 0/1 records a wrong pick, no answer', async () => {
  const r = await KCQ.saveQuestions('Intro Business', [{ question: Q, options, picked: ['c, d, e'], score: 'wrong' }]);
  assert.deepEqual([r.added, r.updated], [1, 0]);
  assert.equal(db.questions[0].answer, '');
  assert.equal(db.questions[0].status, 'incorrect');
});

await test('same question saved again updates, not duplicates; 1/1 sets the answer', async () => {
  const r = await KCQ.saveQuestions('intro business', [{ question: Q, options: [...options].reverse(), picked: ['a, c, e'], score: 'correct' }]);
  assert.deepEqual([r.added, r.updated], [0, 1]);
  assert.equal(db.questions.length, 1);
  assert.equal(db.modules.length, 1);
  assert.equal(db.questions[0].answer, 'a, c, e');
  assert.equal(db.questions[0].status, 'correct');
});

await test('three wrong picks eliminate to the fourth option', async () => {
  const q2 = 'Which one is right here?';
  for (const pick of ['c, d, e', 'c, b, d', 'a, b, c']) {
    await KCQ.saveQuestions('Intro Business', [{ question: q2, options, picked: [pick], score: 'wrong' }]);
  }
  assert.equal(db.questions.find((r) => r.question === q2).answer, 'a, c, e');
});

await test('repeated question in one save, or differing only in punctuation/case, is not duplicated', async () => {
  const q = 'Duplicate check: what is GDP?';
  const before = db.questions.length;
  await KCQ.saveQuestions('Intro Business', [
    { question: q, options, picked: ['c, d, e'], score: 'wrong' },
    { question: q.toUpperCase().replace('?', ' ?'), options, picked: ['a, c, e'], score: 'correct' },
  ]);
  assert.equal(db.questions.length, before + 1);
  await KCQ.saveQuestions('Intro Business', [{ question: q, options, picked: ['c, d, e'], score: 'wrong' }]);
  assert.equal(db.questions.length, before + 1);
  assert.equal(db.questions.find((r) => r.question.startsWith('Duplicate check')).answer, 'a, c, e');
});

await test('suggest gives a labelled best guess that excludes wrong picks, and nothing once confirmed', async () => {
  const row = { question: 'Which?', answer: '', options, wrong: ['c, d, e'] };
  const guess = KCQ.suggest(row);
  assert.ok(guess.option !== 'c, d, e');
  assert.equal(guess.remaining, 3);
  assert.equal(guess.option, 'a, c, e'); // shares the most letters with the other options
  assert.equal(KCQ.suggest({ ...row, answer: 'a, c, e' }), null);
});

await test('loadAll hides old image/OCR rows and search ranks answered first', async () => {
  db.questions.push({ id: 'old', module_id: db.modules[0].id, question: 'A company OCR junk RRR', answer: '', options: [], ocr_text: 'raw', image_path: 'x/y.png' });
  const rows = await KCQ.loadAll();
  assert.ok(!rows.some((r) => r.id === 'old'));
  const hits = KCQ.search(rows, 'a company is struggling');
  assert.equal(hits[0].answer, 'a, c, e');
});

// ---------- content.js on a Moodle-like review page ----------
const html = `<body><h1>Introduction to Business Management Jul26 Y1 S1</h1>
<div class="que multichoice"><div class="info"><div class="state">Correct</div><div class="grade">Mark 1.00 out of 1.00</div></div>
<div class="content"><div class="qtext"><p>A company is struggling. Why?</p><p><img src="org-chart.png" alt="organisation chart"></p><p>a. It neglects.</p></div>
<div class="answer">
<div class="r0"><input type="radio" checked><div class="d-flex"><span class="answernumber">A. </span><div class="flex-fill">a, c, e</div></div></div>
<div class="r1"><input type="radio"><div class="d-flex"><span class="answernumber">B. </span><div class="flex-fill">c, d, e</div></div></div>
<div class="r0"><input type="radio"><div class="d-flex"><span class="answernumber">C. </span><div class="flex-fill">c, b, d</div></div></div>
<div class="r1"><input type="radio"><div class="d-flex"><span class="answernumber">D. </span><div class="flex-fill">a, b, c</div></div></div>
</div></div></div>
<div class="que multichoice"><div class="info"><div class="state">Incorrect</div><div class="grade">Mark 0.00 out of 1.00</div></div>
<div class="qtext">Second question?</div>
<div class="answer"><div class="r0"><label><input type="radio"><span class="answernumber">a. </span>Yes</label></div>
<div class="r1"><label><input type="radio" checked><span class="answernumber">b. </span>No</label></div></div></div>
<div class="que shortanswer"><div class="qtext">Ignored</div></div></body>`;

await test('content script parses questions, picks and scores, and sends them', async () => {
  const dom = new JSDOM(html, { url: 'https://moodle.test/mod/quiz/review.php?attempt=1', runScripts: 'outside-only' });
  const sent = [];
  dom.window.chrome = { runtime: { sendMessage: (msg, cb) => { sent.push(msg); cb({ ok: true, moduleName: msg.moduleName, added: 2, updated: 0 }); } } };
  dom.window.prompt = (_m, def) => def;
  dom.window.eval(`${read('shared.js')}\n${read('content.js')}`);
  const hosts = [...dom.window.document.body.children].filter((el) => el.shadowRoot || el.querySelector('button'));
  const saveButton = dom.window.document.querySelector('button');
  assert.equal(saveButton.textContent, 'Save to KCQ Cloud');
  saveButton.click();
  assert.equal(sent.length, 1);
  const { moduleName, items } = JSON.parse(JSON.stringify(sent[0]));
  assert.equal(moduleName, 'Introduction to Business Management Jul26 Y1 S1');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].options, ['a, c, e', 'c, d, e', 'c, b, d', 'a, b, c']);
  assert.match(items[0].question, /A company is struggling\. Why\?\s*a\. It neglects/);
  assert.doesNotMatch(items[0].question, /organisation chart/);
  assert.deepEqual([items[0].picked, items[0].score], [['a, c, e'], 'correct']);
  assert.deepEqual([items[1].options, items[1].picked, items[1].score], [['Yes', 'No'], ['No'], 'wrong']);
  assert.ok(hosts.length >= 1);
});

console.log(`\n${passed} tests passed`);
