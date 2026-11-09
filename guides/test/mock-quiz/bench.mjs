// Synthetic benchmark: correctness, strict format compliance, latency, failures.
// No private data. Requires OR_KEY for the OpenRouter models.
//
//   OR_KEY=... node guides/test/mock-quiz/bench.mjs "model1:free,model2:free"
import { readFileSync } from 'node:fs';

const key = process.env.OR_KEY || '';
const models = (process.argv[2] || '').split(',').map((m) => m.trim()).filter(Boolean);

const items = [
  { q: 'Which gas do plants absorb from the atmosphere during photosynthesis?', o: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'], a: 'B' },
  { q: 'What is the value of 2 + 2 × 3?', o: ['8', '12', '6', '10'], a: 'A' },
  { q: 'What is the capital city of Australia?', o: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], a: 'C' },
  { q: 'Which of these is a prime number?', o: ['21', '27', '29', '33'], a: 'C' },
  { q: 'Which HTTP status code means Not Found?', o: ['200', '301', '404', '500'], a: 'C' },
  { q: 'Which unit measures electric current?', o: ['Volt', 'Watt', 'Ampere', 'Ohm'], a: 'C' },
];

const buildPrompt = (item) => [
  'Answer the multiple-choice question.',
  `Question: ${item.q}`,
  'Options:',
  ...item.o.map((text, i) => `${String.fromCharCode(65 + i)}. ${text}`),
  '',
  'Reply with exactly one of: LETTER|high, LETTER|medium, UNSURE.',
].join('\n');

async function ask(model, prompt) {
  const started = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 64,
      reasoning: { enabled: false },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  const ms = Date.now() - started;
  if (!res.ok) throw new Error(`HTTP ${res.status} after ${ms}ms`);
  const data = await res.json();
  return { content: data?.choices?.[0]?.message?.content || '', ms };
}

const strict = /^([A-D])\|(high|medium)$/i;
const loose = /([A-D])\s*\|\s*(high|medium)/i;

for (const model of models) {
  let correct = 0; let strictOk = 0; let answered = 0; const times = []; const failures = [];
  for (const item of items) {
    try {
      const { content, ms } = await ask(model, buildPrompt(item));
      times.push(ms);
      const text = content.trim();
      const s = text.match(strict);
      const l = text.match(loose);
      const letter = (s?.[1] || l?.[1] || '').toUpperCase();
      if (s) strictOk += 1;
      if (letter) answered += 1;
      if (letter === item.a) correct += 1;
      console.log(`  ${model} ${item.a}→${letter || 'none'} ${s ? 'strict' : l ? 'loose' : 'NO-FORMAT'} ${ms}ms ${JSON.stringify(text.slice(0, 30))}`);
    } catch (error) {
      failures.push(error.message);
      console.log(`  ${model} FAIL ${error.message}`);
    }
  }
  times.sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;
  console.log(`SUMMARY ${model}: correct ${correct}/${items.length}, strict-format ${strictOk}/${items.length}, answered ${answered}/${items.length}, median ${median}ms, failures ${failures.length}`);
}
