// Run: node extension/test/answer.test.mjs <dir-containing-node_modules/jsdom>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.resolve(process.argv[2] || '.', 'package.json'));
const { JSDOM } = require('jsdom');
const read = (name) => fs.readFileSync(path.join(extDir, name), 'utf8');

let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log(`ok - ${name}`); };
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const que = ({ no, classes = 'notyetanswered', body, options, image = '' }) => `
<div class="que multichoice ${classes}"><div class="info"><h3 class="no">Question <span class="qno">${no}</span></h3></div>
<div class="content"><div class="qtext">${body}${image}</div><div class="answer">
${options.map(([marker, text], i) => `<div class="r${i % 2}"><input type="radio"><div class="d-flex"><span class="answernumber">${marker}</span><div class="flex-fill">${text}</div></div></div>`).join('')}
</div></div></div>`;

const forensic = que({
  no: 1,
  body: '<p>Which factors could explain this inconsistency?</p><p>i. Metadata may change</p><p>ii. System clock settings</p><p>iii. File names</p><p>iv. Cloud synchronisation</p><p>v. Folder colour</p>',
  options: [['A. ', 'iii and v only'], ['B. ', 'i and iii only'], ['C. ', 'ii and iv only'], ['D. ', 'i, ii and iv only']],
});
const abc = que({
  no: 2,
  body: '<p>Pick the right pair.</p><p>a. first</p><p>b. second</p><p>c. third</p>',
  options: [['A. ', 'a and b'], ['B. ', 'b and c'], ['C. ', 'a and c'], ['D. ', 'all of them']],
});
const marked = que({ no: 3, classes: 'correct', body: 'Already marked', options: [['A. ', 'x'], ['B. ', 'y']] });
const diagram = que({
  no: 4,
  body: '<p>The production trend is shown below.</p>',
  image: '<p><img src="x.png" alt="quarterly output chart"></p><p>Which direction does output move?</p>',
  options: [['A. ', 'up'], ['B. ', 'down']],
});
const page = (inner) => `<html><body><h1>End User Computing Jul26</h1><div id="mod_quiz_navblock"></div>${inner}</body></html>`;

// ---------- extraction + letter mapping ----------
const attemptUrl = 'https://moodle.test/mod/quiz/attempt.php?attempt=77&page=0';
function load(html, { storage = {}, messages = [], reply } = {}) {
  const dom = new JSDOM(html, { url: attemptUrl, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const observers = [];
  w.IntersectionObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} };
  w.chrome = {
    runtime: { sendMessage: (msg, cb) => { messages.push(msg); setTimeout(() => cb(reply(msg)), 0); }, lastError: null },
    storage: { local: {
      get: async (key) => ({ [key]: storage[key] }),
      set: async (obj) => { Object.assign(storage, JSON.parse(JSON.stringify(obj))); },
    } },
  };
  w.eval(read('attempt.js'));
  return { dom, w, observers, storage, messages };
}

await test('extracts number, full text with statements, options, and skips marked questions', async () => {
  const { w } = load(page(forensic + abc + marked + diagram), { reply: () => ({}) });
  const questions = JSON.parse(JSON.stringify(w.KCQAttempt.parseAttemptQuestions().map(({ el, ...q }) => q)));
  assert.deepEqual(questions.map((q) => q.number), ['1', '2', '4']);
  assert.match(questions[0].text, /i\. Metadata may change.*v\. Folder colour/);
  assert.deepEqual(questions[0].options, [
    { letter: 'A', text: 'iii and v only' }, { letter: 'B', text: 'i and iii only' },
    { letter: 'C', text: 'ii and iv only' }, { letter: 'D', text: 'i, ii and iv only' },
  ]);
  assert.equal(questions[2].hasImage, true);
  assert.match(questions[2].text, /The production trend is shown below.*Which direction does output move/);
  assert.doesNotMatch(questions[2].text, /quarterly output chart/);
});

await test('answer letters come from option labels, never from statement labels a/b/c or i/ii', async () => {
  const { w } = load(page(abc), { reply: () => ({}) });
  const letters = (win) => JSON.parse(JSON.stringify(win.KCQAttempt.parseAttemptQuestions()[0].options.map((o) => o.letter)));
  assert.deepEqual(letters(w), ['A', 'B', 'C', 'D']);
  // Fallback when the theme hides labels or uses non-letter numbering.
  const numbered = que({ no: 1, body: 'Q', options: [['1. ', 'x'], ['2. ', 'y'], ['3. ', 'z']] });
  const { w: w2 } = load(page(numbered), { reply: () => ({}) });
  assert.deepEqual(letters(w2), ['A', 'B', 'C']);
});

// ---------- answerer: prompt, parsing, caching, dedupe ----------
const sandbox = { crypto: globalThis.crypto, TextEncoder, console };
vm.createContext(sandbox);
vm.runInContext(`${read('ai.js')}; globalThis.KCQAI = KCQAI;`, sandbox);
const { KCQAI } = sandbox;

const question = {
  text: 'Which factors could explain this inconsistency? i. Metadata may change ii. System clock v. Folder colour',
  options: [{ letter: 'A', text: 'iii and v only' }, { letter: 'B', text: 'i and iii only' }, { letter: 'C', text: 'ii and iv only' }, { letter: 'D', text: 'i, ii and iv only' }],
};
const makeAnswerer = (overrides = {}) => {
  const calls = [];
  let cache = {};
  const answerer = KCQAI.createAnswerer({
    getGuides: async () => ({ 'End User Computing': 'Metadata can change when files are copied.\n\nCloud synchronisation alters timestamps.\n\nBananas are yellow.' }),
    getBank: async () => [],
    callModel: async (prompt) => { calls.push(prompt); return 'D|high'; },
    cacheGet: async () => cache,
    cacheSet: async (next) => { cache = next; },
    ...overrides,
  });
  return { answerer, calls };
};

await test('reply parsing maps to a valid option letter only; low confidence or unknown letters need checking', async () => {
  const letters = ['A', 'B', 'C', 'D'];
  assert.equal(JSON.stringify(KCQAI.parseReply('d|high', letters)), JSON.stringify({ letter: 'D', confidence: 'high' }));
  assert.equal(KCQAI.parseReply('E|high', letters), null);
  assert.equal(KCQAI.parseReply('UNSURE', letters), null);
  assert.equal(KCQAI.parseReply('B|low', letters), null);
  const { answerer } = makeAnswerer({ callModel: async () => 'UNSURE' });
  const result = await answerer.answer({ moduleName: 'End User Computing', question });
  assert.equal(result.needsChecking, true);
});

await test('only relevant guide excerpts are sent with the question and options', async () => {
  const { answerer, calls } = makeAnswerer();
  const result = await answerer.answer({ moduleName: 'End User Computing Jul26', question });
  assert.equal(result.letter, 'D');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Metadata can change/);
  assert.doesNotMatch(calls[0], /Bananas/);
  assert.match(calls[0], /D\. i, ii and iv only/);
});

await test('duplicate requests: concurrent and repeated calls reach the model once', async () => {
  const { answerer, calls } = makeAnswerer({ callModel: async (p) => { await tick(); return 'D|high'; } });
  const payload = { moduleName: 'End User Computing', question };
  const [a, b] = await Promise.all([answerer.answer(payload), answerer.answer(payload)]);
  assert.equal(a.letter, 'D');
  assert.equal(b.letter, 'D');
  const again = await answerer.answer(payload);
  assert.equal(again.source, 'cache');
});

await test('incomplete questions and saved answers skip the model; diagrams use extracted text', async () => {
  let modelCalls = 0;
  const counting = async () => { modelCalls += 1; return 'A|high'; };
  const diagramQuestion = {
    text: 'The production trend is shown below. Which direction does output move?',
    hasImage: true,
    options: [{ letter: 'A', text: 'up' }, { letter: 'B', text: 'down' }],
  };

  const { answerer: withSavedDiagram } = makeAnswerer({
    callModel: counting,
    getBank: async () => [{ question: diagramQuestion.text, answer: 'up' }],
  });
  const fromBank = await withSavedDiagram.answer({ moduleName: 'x', question: diagramQuestion });
  assert.equal(`${fromBank.letter}|${fromBank.source}`, 'A|saved');

  const { answerer } = makeAnswerer({
    callModel: counting,
    getBank: async () => [{ question: question.text, answer: 'ii and iv only' }],
  });
  assert.equal((await answerer.answer({ moduleName: 'x', question: { text: 'Hi', options: [question.options[0]] } })).needsChecking, true);
  const saved = await answerer.answer({ moduleName: 'x', question });
  assert.equal(`${saved.letter}|${saved.source}`, 'C|saved');
  const unsavedDiagram = await answerer.answer({ moduleName: 'x', question: diagramQuestion });
  assert.equal(`${unsavedDiagram.letter}|${unsavedDiagram.source}`, 'A|ai');
  assert.equal(modelCalls, 1);
});

await test('known wrong picks eliminate to one answer or the most likely remaining option', async () => {
  let modelCalls = 0;
  const counting = async () => { modelCalls += 1; return 'A|high'; };
  const { answerer: oneLeft } = makeAnswerer({
    callModel: counting,
    getBank: async () => [{
      question: question.text,
      answer: '',
      wrong: ['iii and v only', 'i and iii only', 'ii and iv only'],
    }],
  });
  const last = await oneLeft.answer({ moduleName: 'x', question });
  assert.equal(`${last.letter}|${last.source}|${last.confidence}`, 'D|elimination|high');
  assert.deepEqual(last.eliminated.map((option) => option.letter), ['A', 'B', 'C']);

  const { answerer: likely } = makeAnswerer({
    callModel: counting,
    getBank: async () => [{ question: question.text, answer: '', wrong: ['iii and v only'] }],
  });
  const guess = await likely.answer({ moduleName: 'x', question });
  assert.equal(`${guess.letter}|${guess.source}|${guess.confidence}`, 'D|guess|medium');
  assert.deepEqual(guess.eliminated.map((option) => option.letter), ['A']);
  assert.equal(modelCalls, 0);
});

await test('model errors give Needs checking and are not cached or retried automatically', async () => {
  let attempts = 0;
  const { answerer } = makeAnswerer({ callModel: async () => { attempts += 1; throw new Error('Set the AI endpoint'); } });
  const result = await answerer.answer({ moduleName: 'x', question });
  assert.equal(result.needsChecking, true);
  assert.equal(attempts, 1);
});

// ---------- navigation: page updates, answers stay with the right question, no duplicate requests ----------
const intersect = (observer, el) => observer.cb([{ target: el, isIntersecting: true, intersectionRect: { height: 300 }, boundingClientRect: { height: 300 } }]);
const panelText = (w) => [...w.document.getElementById('mod_quiz_navblock').nextSibling.shadowRoot.querySelectorAll('.line')].map((l) => l.textContent.replace(/\s+/g, ' ').trim());

await test('panel lists Question N: LETTER per question, updates on navigation, and never re-asks unchanged questions', async () => {
  const reply = (msg) => ({ letter: msg.question.text.includes('Metadata') ? 'D' : 'B', confidence: 'high' });
  const first = load(page(forensic + abc), { reply });
  await tick();
  const [q1El, q2El] = [...first.w.document.querySelectorAll('.que')];
  intersect(first.observers[0], q1El);
  await tick();
  assert.equal(first.messages.length, 1);
  intersect(first.observers[0], q2El);
  await tick();
  assert.equal(first.messages.length, 2);
  intersect(first.observers[0], q1El); // scrolling back must not re-ask
  intersect(first.observers[0], q1El);
  await tick();
  assert.equal(first.messages.length, 2);
  const lines = panelText(first.w);
  assert.match(lines[0], /^Question 1: D/);
  assert.match(lines[1], /^Question 2: B/);

  // Next Moodle page: new document, same attempt. Earlier answers persist; only the new question is asked.
  const next = que({ no: 5, body: 'A fresh question about cloud storage.', options: [['A. ', 'one'], ['B. ', 'two']] });
  const second = load(page(next), { storage: first.storage, reply: () => ({ letter: 'A', confidence: 'medium' }) });
  await tick();
  intersect(second.observers[0], second.w.document.querySelector('.que'));
  await tick();
  assert.equal(second.messages.length, 1);
  const secondLines = panelText(second.w);
  assert.equal(secondLines.length, 3);
  assert.match(secondLines[0], /^Question 1: D/);
  assert.match(secondLines[2], /^Question 5: A.*\(likely\)/);
});

await test('panel shows a likely answer and which options were already wrong', async () => {
  const { w, observers } = load(page(forensic), {
    reply: () => ({
      letter: 'D',
      confidence: 'medium',
      source: 'guess',
      eliminated: [{ letter: 'A', text: 'iii and v only' }, { letter: 'B', text: 'i and iii only' }],
    }),
  });
  await tick();
  intersect(observers[0], w.document.querySelector('.que'));
  await tick();
  assert.match(panelText(w)[0], /^Question 1: D/);
  assert.match(panelText(w)[0], /likely/);
  assert.match(panelText(w)[0], /not A, B/);
});

await test('insufficient evidence shows Needs checking', async () => {
  const { w, observers } = load(page(forensic), { reply: () => ({ needsChecking: true, reason: 'Not enough evidence.' }) });
  await tick();
  intersect(observers[0], w.document.querySelector('.que'));
  await tick();
  assert.match(panelText(w)[0], /^Question 1: Needs checking/);
});

console.log(`\n${passed} tests passed`);
