const queryInput = document.getElementById('query');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
let rows = [];

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function render() {
  resultsEl.replaceChildren();
  const found = KCQ.search(rows, queryInput.value);
  if (queryInput.value.trim().length >= 2 && !found.length) resultsEl.append(el('p', 'muted', 'No match.'));
  found.forEach((row) => {
    const card = el('div', 'card');
    card.append(el('small', '', row.moduleName), el('p', 'q', row.question));
    if (row.answer) card.append(el('p', 'a', `Answer: ${row.answer}`));
    else card.append(el('p', 'u', `Answer not confirmed${row.wrong.length ? ` — wrong: ${row.wrong.join(' / ')}` : ''}`));
    const guess = KCQ.suggest(row);
    if (!row.answer && guess) {
      const how = guess.remaining === 1 ? 'only option left after eliminating wrong picks' : `most likely of ${guess.remaining} left after eliminating wrong picks`;
      card.append(el('p', 'g', `Likely answer: ${guess.option} (${how})`));
    }
    resultsEl.append(card);
  });
}

async function refresh() {
  statusEl.textContent = 'Loading...';
  try {
    rows = await KCQ.loadAll();
    statusEl.textContent = `${rows.length} questions loaded.`;
    render();
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

document.getElementById('refresh').addEventListener('click', refresh);
queryInput.addEventListener('input', render);
document.getElementById('selection').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection()) });
    if (injection?.result) { queryInput.value = injection.result.slice(0, 200); render(); }
  } catch {
    statusEl.textContent = 'Could not read the page selection. Click the extension icon on that tab first.';
  }
});

refresh();
