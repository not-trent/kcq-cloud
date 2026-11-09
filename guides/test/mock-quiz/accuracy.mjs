// End-to-end accuracy check: real guide retrieval + a real free model.
// Mirrors background.js callModel exactly (same body, same reasoning flag).
//
//   OR_KEY=sk-or-... node guides/test/mock-quiz/accuracy.mjs [model]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, '../../../extension/extension');
const read = (name) => readFileSync(path.join(ext, name), 'utf8');

const key = process.env.OR_KEY;
const models = (process.argv[2] || 'dots-studio/dots-3-note-preview:free,nvidia/nemotron-3.5-lightning:free')
  .split(',').map((m) => m.trim()).filter(Boolean).slice(0, 4);
if (!key) { console.error('OR_KEY is required'); process.exit(1); }

const storage = {};
const sandbox = {
  console, crypto: globalThis.crypto, TextEncoder, AbortSignal, setTimeout, clearTimeout, URL,
  fetch: (...args) => fetch(...args),
  chrome: { storage: { local: {
    get: async (k) => (Array.isArray(k) ? Object.fromEntries(k.map((x) => [x, storage[x]])) : { [k]: storage[k] }),
    set: async (o) => Object.assign(storage, o),
  } } },
};
vm.createContext(sandbox);
vm.runInContext(`${read('shared.js')}; globalThis.KCQ = KCQ;`, sandbox);
vm.runInContext(`${read('ai.js')}; globalThis.KCQAI = KCQAI;`, sandbox);
const { KCQ, KCQAI } = sandbox;

// Same request shape and fallback as background.js callModel.
async function askModel(model, prompt) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const last = attempt === 1;
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0, max_tokens: 64,
          reasoning: { enabled: false },
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        if (response.status === 429 && !last) { await new Promise((r) => setTimeout(r, 900)); continue; }
        throw new Error(`${model}: HTTP ${response.status}`);
      }
      const data = await response.json();
      return data?.choices?.[0]?.message?.content || '';
    } catch (error) {
      if (!last && /fetch failed|network|socket|aborted|timeout/i.test(error.message || '')) {
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }
      throw error;
    }
  }
  return '';
}

async function callModel(prompt) {
  const failures = [];
  for (const model of models) {
    try {
      const content = await askModel(model, prompt);
      if (content?.trim()) return content;
      failures.push(`${model}: empty`);
    } catch (error) {
      failures.push(error.message);
    }
  }
  throw new Error(failures[0] || 'no model answered');
}

const answerer = KCQAI.createAnswerer({
  getExcerpts: (payload) => KCQ.searchGuidePassages(payload),
  getGuides: async () => ({}),
  getBank: async () => [],
  callModel,
  cacheGet: async () => ({}),
  cacheSet: async () => {},
});

const questions = [
  {
    expected: 'B',
    text: "According to Herzberg's motivation-hygiene theory, which of the following is a hygiene factor rather than a motivator?",
    options: [
      { letter: 'A', text: 'Recognition from supervisors' },
      { letter: 'B', text: 'Salary and working conditions' },
      { letter: 'C', text: 'Achievement of challenging goals' },
      { letter: 'D', text: 'Responsibility for own work' },
    ],
  },
  {
    expected: 'B',
    text: 'Diverse groups tend to be less cohesive than homogeneous groups. Which problem does this most directly create for an organisation?',
    options: [
      { letter: 'A', text: 'Faster decision making across the team' },
      { letter: 'B', text: 'Communication problems and slower, less accurate work' },
      { letter: 'C', text: 'Stronger group cohesion over time' },
      { letter: 'D', text: 'Reduced need for management coordination' },
    ],
  },
  {
    expected: 'B',
    text: 'In public financial management, irregular expenditure is best described as expenditure that is:',
    options: [
      { letter: 'A', text: 'Approved in the annual budget but not yet spent' },
      { letter: 'B', text: 'Incurred in contravention of legislation or without following the applicable requirements' },
      { letter: 'C', text: 'Spent on capital projects instead of operations' },
      { letter: 'D', text: 'Recorded in the wrong financial year' },
    ],
  },
  {
    expected: 'A',
    text: 'Grouping employees into units by function, product, customer or region is known as:',
    options: [
      { letter: 'A', text: 'Departmentalisation' },
      { letter: 'B', text: 'Delegation of authority' },
      { letter: 'C', text: 'Centralisation of decision making' },
      { letter: 'D', text: 'Benchmarking against competitors' },
    ],
  },
];

let correct = 0;
for (const [index, question] of questions.entries()) {
  const started = Date.now();
  const result = await answerer.answer({ moduleName: 'Business Management 2', question });
  const ms = Date.now() - started;
  const got = result.letter || (result.needsChecking ? 'needs-checking' : '?');
  if (got === question.expected) correct += 1;
  console.log(`Q${index + 1} expected ${question.expected} → ${got} ${got === question.expected ? 'OK' : 'WRONG'} `
    + `[${result.source || 'none'}${result.confidence ? `/${result.confidence}` : ''}] ${ms}ms `
    + `cite=${result.citations?.[0]?.title || '-'}${result.citations?.[0]?.pageRef ? ` p.${result.citations[0].pageRef}` : ''}`);
  if (result.needsChecking) console.log('     reason:', result.reason);
}

console.log(`\n${correct}/${questions.length} correct with ${models.join(' → ')}`);
process.exitCode = correct === questions.length ? 0 : 1;
