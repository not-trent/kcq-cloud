const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export const questionKey = (text = '') => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const optionKey = questionKey;

export async function loadBank() {
  const response = await fetch(`${API_BASE}/api/bank`);
  if (!response.ok) throw new Error('Could not load the question bank. Is the server running?');
  return response.json();
}

export async function saveBank(bank) {
  const response = await fetch(`${API_BASE}/api/bank`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bank),
  });
  if (!response.ok) throw new Error('Could not save the question bank.');
}

// If three options are known wrong, the fourth must be correct.
function resolveByElimination(item) {
  if (item.correct || !item.options.length) return;
  const wrongKeys = new Set(item.wrong.map(optionKey));
  const remaining = item.options.filter((option) => !wrongKeys.has(optionKey(option)));
  if (remaining.length === 1 && item.options.length >= 3) item.correct = remaining[0];
}

// Merges one scanned question into a module's list, learning from correct (1/1) and wrong (0/1) results.
export function mergeQuestion(items, scanned) {
  const key = questionKey(scanned.question);
  if (!key) return items;

  const picked = scanned.pickedIndex >= 0 ? scanned.options[scanned.pickedIndex] : '';
  let item = items.find((existing) => questionKey(existing.question) === key);
  if (!item) {
    item = { id: crypto.randomUUID(), question: scanned.question, options: scanned.options, correct: '', wrong: [] };
    items = [...items, item];
  } else if (!item.options.length && scanned.options.length) {
    item.options = scanned.options;
  }

  if (picked && scanned.score === 1) item.correct = picked;
  if (picked && scanned.score === 0 && !item.wrong.some((w) => optionKey(w) === optionKey(picked))) item.wrong.push(picked);
  resolveByElimination(item);
  return items;
}

export function searchBank(bank, query, moduleId = '') {
  const queryKey = questionKey(query);
  if (queryKey.length < 2) return [];
  const queryTokens = queryKey.split(' ');

  const results = [];
  bank.modules
    .filter((module) => !moduleId || module.id === moduleId)
    .forEach((module) => {
      module.questions.forEach((item) => {
        const key = questionKey(item.question);
        let score = 0;
        if (key.startsWith(queryKey)) score = 100;
        else if (key.includes(queryKey)) score = 80;
        else {
          const keyTokens = new Set(key.split(' '));
          const hits = queryTokens.filter((token) => keyTokens.has(token)).length;
          if (hits / queryTokens.length >= 0.6) score = 60 * (hits / queryTokens.length);
        }
        if (score > 0) results.push({ score, item, moduleName: module.name });
      });
    });

  return results.sort((a, b) => b.score - a.score).slice(0, 8);
}
